import type { PlaybackOptions, Track } from '@vdm/shared';

/**
 * Lecteur Web Audio des musiques de jeu : intro, boucle répétée, queue, fondu,
 * et MIXAGE DE STEMS (une voix = un canal APU).
 *
 * Modèle d'un morceau :
 *   [==== intro ====|==== boucle ====|== queue ==]
 *   0           loopStart        loopEnd        durée
 *
 * Multi-voix : chaque voix a sa propre source -> son gain de canal -> un gain
 * master -> destination. Toutes les sources démarrent au MÊME t0 avec les MÊMES
 * loopStart/loopEnd (stems de longueur identique par construction) -> verrouillées
 * en phase. Activer/désactiver une voix = rampe sur son gain SANS arrêter la
 * source (pas de resynchro). Le cas mono (un fichier mixé) = une seule voix.
 *
 * La FIN est pilotée par `onended` d'UN nœud « timekeeper » (horloge audio),
 * jamais par setTimeout (un timer mural se déclencherait trop tôt après pause).
 */

interface Voice {
  buffer: AudioBuffer;
  enabled: boolean;
}

interface Plan {
  noLoop: boolean;
  mode: PlaybackOptions['mode'];
  loop: { loopStart: number; loopEnd: number } | undefined;
  t0: number;
  endOfLoops: number;
}

export class LoopPlayer {
  private ctx: AudioContext | null = null;
  private track: Track | null = null;

  /** Voix chargées (id -> buffer + état d'activation). */
  private voices = new Map<string, Voice>();
  /** Gains de canal créés au play (id -> GainNode), pour le toggle en direct. */
  private channelGains = new Map<string, GainNode>();
  private master: GainNode | null = null;
  private sources: AudioBufferSourceNode[] = [];

  /** Callback appelé quand la lecture se termine d'elle-même (pas sur stop()). */
  onEnded: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`stream ${url}: HTTP ${res.status}`);
    return this.ensureContext().decodeAudioData(await res.arrayBuffer());
  }

  /**
   * Charge un morceau mono (fichier mixé). `streamUrl` surcharge l'URL (ex.
   * paramètres de rendu serveur `?seconds=&fade=`).
   */
  async load(track: Track, streamUrl: string = track.streamUrl): Promise<void> {
    const buffer = await this.fetchBuffer(streamUrl);
    this.setTrack(track, [{ id: '__main__', buffer, enabled: true }]);
  }

  /** Charge un morceau en STEMS : une voix par canal, jouées en synchro. */
  async loadChannels(
    track: Track,
    voices: { id: string; url: string; enabledByDefault?: boolean }[]
  ): Promise<void> {
    const decoded = await Promise.all(
      voices.map(async (v) => ({
        id: v.id,
        buffer: await this.fetchBuffer(v.url),
        enabled: v.enabledByDefault !== false,
      }))
    );
    this.setTrack(track, decoded);
  }

  private setTrack(track: Track, list: { id: string; buffer: AudioBuffer; enabled: boolean }[]): void {
    this.stop();
    this.track = track;
    this.voices.clear();
    for (const v of list) this.voices.set(v.id, { buffer: v.buffer, enabled: v.enabled });
  }

  /** Démarre la lecture selon le comportement choisi. */
  async play(options: PlaybackOptions): Promise<void> {
    if (!this.track || this.voices.size === 0) throw new Error('aucun morceau chargé');
    const ctx = this.ensureContext();
    // stop() AVANT l'await : évite tout entrelacement si play() est rappelé.
    this.stop();
    if (ctx.state === 'suspended') await ctx.resume();

    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;

    const loop = this.track.loop;
    const t0 = ctx.currentTime + 0.05;
    const noLoop = !loop || options.mode === 'once';
    const introDur = loop ? loop.loopStart : 0;
    const loopDur = loop ? loop.loopEnd - loop.loopStart : 0;
    const repeats = Math.max(1, Math.floor(Number.isFinite(options.loopCount) ? options.loopCount : 1));
    const endOfLoops = t0 + introDur + repeats * loopDur;

    // Fondu de sortie : sur le MASTER (partagé par toutes les voix), une seule fois.
    if (!noLoop && options.mode === 'loopCountFade') {
      const fade = Math.max(0.01, Number.isFinite(options.fadeSeconds) ? options.fadeSeconds : 0.01);
      const effectiveFade = Math.min(fade, endOfLoops - t0);
      const fadeStart = endOfLoops - effectiveFade;
      master.gain.setValueAtTime(1, fadeStart);
      master.gain.exponentialRampToValueAtTime(0.0001, endOfLoops);
    }

    const plan: Plan = { noLoop, mode: options.mode, loop, t0, endOfLoops };

    // Une source (ou deux) par voix, via son gain de canal -> master.
    let timekeeper: AudioBufferSourceNode | null = null;
    for (const [id, voice] of this.voices) {
      const chGain = ctx.createGain();
      chGain.gain.value = voice.enabled ? 1 : 0;
      chGain.connect(master);
      this.channelGains.set(id, chGain);

      const terminal = this.scheduleVoice(voice.buffer, chGain, plan);
      if (terminal && !timekeeper) timekeeper = terminal;
    }

    // Fin pilotée par UN seul nœud (sinon onEnded tirerait N fois).
    if (timekeeper) this.armEnd(timekeeper);
  }

  /** Programme la (ou les) source(s) d'une voix selon le plan ; renvoie le nœud terminal. */
  private scheduleVoice(buffer: AudioBuffer, out: GainNode, p: Plan): AudioBufferSourceNode | null {
    if (p.noLoop) {
      const src = this.newSource(buffer, out);
      src.start(p.t0);
      return src;
    }
    const loop = p.loop!;

    if (p.mode === 'loopInfinite') {
      const src = this.newSource(buffer, out);
      src.loop = true;
      src.loopStart = loop.loopStart;
      src.loopEnd = loop.loopEnd;
      src.start(p.t0);
      return null; // jamais de fin automatique
    }

    // loopCount / loopCountFade : intro + N boucles.
    const loopPart = this.newSource(buffer, out);
    loopPart.loop = true;
    loopPart.loopStart = loop.loopStart;
    loopPart.loopEnd = loop.loopEnd;
    loopPart.start(p.t0);
    loopPart.stop(p.endOfLoops);
    if (p.mode === 'loopCountFade') return loopPart;

    // loopCount : enchaîner la queue [loopEnd, durée].
    const hasTail = buffer.duration - loop.loopEnd > 0.02;
    if (hasTail) {
      const tail = this.newSource(buffer, out);
      tail.start(p.endOfLoops, loop.loopEnd);
      return tail;
    }
    return loopPart;
  }

  /** Active/désactive une voix EN DIRECT (rampe anti-clic, sans resynchro). */
  setChannelEnabled(id: string, on: boolean): void {
    const voice = this.voices.get(id);
    if (voice) voice.enabled = on;
    const g = this.channelGains.get(id);
    if (g && this.ctx) {
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(on ? 1 : 0, now, 0.01); // ~10 ms
    }
  }

  stop(): void {
    for (const src of this.sources) {
      try {
        src.onended = null; // empêche armEnd de tirer onEnded sur un arrêt manuel
        src.stop();
      } catch {
        /* déjà arrêté */
      }
      src.disconnect();
    }
    this.sources = [];
    for (const g of this.channelGains.values()) g.disconnect();
    this.channelGains.clear();
    if (this.master) {
      this.master.disconnect();
      this.master = null;
    }
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Libère le contexte audio (les navigateurs limitent leur nombre). */
  async dispose(): Promise<void> {
    this.stop();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }

  private newSource(buffer: AudioBuffer, out: GainNode): AudioBufferSourceNode {
    const src = this.ensureContext().createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    this.sources.push(src);
    return src;
  }

  private armEnd(node: AudioBufferSourceNode): void {
    node.onended = () => {
      this.stop();
      this.onEnded?.();
    };
  }
}
