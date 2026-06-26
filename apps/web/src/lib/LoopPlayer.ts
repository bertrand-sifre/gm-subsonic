import type { PlaybackOptions, Track } from '@vdm/shared';

/**
 * Lecteur Web Audio gérant les particularités des musiques de jeu vidéo :
 * intro, boucle répétée, queue (fin personnalisée) et fondu de sortie.
 *
 * Pourquoi la Web Audio API et pas une balise <audio> :
 *  - <audio> ne sait pas boucler à l'échantillon près ni au bon endroit ;
 *  - on a besoin d'un timing exact pour enchaîner boucle -> queue sans trou ;
 *  - cela prépare le terrain pour le mixage de stems (tranches 4-5).
 *
 * Modèle d'un morceau :
 *   [==== intro ====|==== boucle ====|== queue ==]
 *   0           loopStart        loopEnd        durée
 *
 * La FIN de lecture est pilotée par l'événement `onended` du nœud terminal
 * (horloge audio), jamais par setTimeout : un timer mural se déclencherait trop
 * tôt après une pause (suspend() fige l'horloge audio mais pas l'horloge murale).
 */
export class LoopPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private track: Track | null = null;

  private sources: AudioBufferSourceNode[] = [];
  private gain: GainNode | null = null;

  /** Callback appelé quand la lecture se termine d'elle-même (pas sur stop()). */
  onEnded: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Télécharge et décode le fichier audio du morceau. */
  async load(track: Track): Promise<void> {
    const ctx = this.ensureContext();
    const res = await fetch(track.streamUrl);
    if (!res.ok) throw new Error(`stream ${track.id}: HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    this.buffer = await ctx.decodeAudioData(data);
    this.track = track;
  }

  /** Démarre la lecture selon le comportement choisi. */
  async play(options: PlaybackOptions): Promise<void> {
    if (!this.buffer || !this.track) throw new Error('aucun morceau chargé');
    const ctx = this.ensureContext();
    // stop() AVANT l'await : évite tout entrelacement si play() est rappelé
    // pendant la reprise du contexte (états transitoires / churn de nœuds).
    this.stop();
    if (ctx.state === 'suspended') await ctx.resume();

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.gain = gain;

    const loop = this.track.loop;
    const t0 = ctx.currentTime + 0.05; // petite marge avant le démarrage

    // Pas de boucle, ou lecture normale demandée : on joue le fichier entier.
    if (!loop || options.mode === 'once') {
      const src = this.newSource(gain);
      src.start(t0);
      this.armEnd(src);
      return;
    }

    const introDur = loop.loopStart;
    const loopDur = loop.loopEnd - loop.loopStart;

    if (options.mode === 'loopInfinite') {
      const src = this.newSource(gain);
      src.loop = true;
      src.loopStart = loop.loopStart;
      src.loopEnd = loop.loopEnd;
      src.start(t0);
      return; // jamais de fin automatique
    }

    // Modes loopCount / loopCountFade : intro + N boucles, puis queue ou fondu.
    const repeats = Math.max(
      1,
      Math.floor(Number.isFinite(options.loopCount) ? options.loopCount : 1)
    );
    const loopPart = this.newSource(gain);
    loopPart.loop = true;
    loopPart.loopStart = loop.loopStart;
    loopPart.loopEnd = loop.loopEnd;
    loopPart.start(t0);

    // Instant exact du repeats-ième retour au point de boucle (tête à loopEnd).
    const endOfLoops = t0 + introDur + repeats * loopDur;

    if (options.mode === 'loopCountFade') {
      const fade = Math.max(
        0.01,
        Number.isFinite(options.fadeSeconds) ? options.fadeSeconds : 0.01
      );
      // On garde exactement `repeats` boucles : si le fondu est plus long que
      // toute la lecture, on le raccourcit pour qu'il s'achève à endOfLoops.
      const effectiveFade = Math.min(fade, endOfLoops - t0);
      const fadeStart = endOfLoops - effectiveFade;
      gain.gain.setValueAtTime(1, fadeStart);
      // Rampe quasi-exponentielle (perçue plus naturelle qu'un fondu linéaire) ;
      // exponentialRamp ne peut pas viser 0, on cible un epsilon inaudible.
      gain.gain.exponentialRampToValueAtTime(0.0001, endOfLoops);
      loopPart.stop(endOfLoops);
      this.armEnd(loopPart);
      return;
    }

    // loopCount : on coupe la boucle et on enchaîne la queue [loopEnd, durée].
    loopPart.stop(endOfLoops);
    const hasTail = this.buffer.duration - loop.loopEnd > 0.02;
    if (hasTail) {
      const tail = this.newSource(gain);
      tail.start(endOfLoops, loop.loopEnd);
      this.armEnd(tail);
    } else {
      this.armEnd(loopPart);
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
    if (this.gain) {
      this.gain.disconnect();
      this.gain = null;
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

  private newSource(out: GainNode): AudioBufferSourceNode {
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(out);
    this.sources.push(src);
    return src;
  }

  /**
   * Arme la fin de lecture sur le nœud terminal via l'horloge audio. Quand ce
   * nœud s'arrête (fin naturelle ou stop() programmé), on nettoie et on notifie.
   */
  private armEnd(node: AudioBufferSourceNode): void {
    node.onended = () => {
      this.stop();
      this.onEnded?.();
    };
  }
}
