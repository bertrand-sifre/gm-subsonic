import type { PlaybackOptions, Track } from '@vdm/shared';

/**
 * Lecteur Web Audio des musiques de jeu : intro, boucle répétée, queue, fondu,
 * MIXAGE DE STEMS (une voix = un canal APU), volume master et SEEK.
 *
 * Modèle d'un morceau :
 *   [==== intro ====|==== boucle ====|== queue ==]
 *   0           loopStart        loopEnd        durée
 *
 * Multi-voix : chaque voix a sa propre source -> son gain de canal -> un analyseur
 * -> le gain de FONDU (master) -> le gain UTILISATEUR (volume) -> destination.
 * Toutes les sources démarrent au MÊME instant avec les MÊMES loopStart/loopEnd
 * (stems de longueur identique par construction) -> verrouillées en phase. Régler
 * le gain d'une voix = rampe SANS arrêter la source (pas de resynchro). Le cas mono
 * (un fichier mixé) = une seule voix.
 *
 * Le gain de FONDU porte l'automation `loopCountFade` ; le gain UTILISATEUR porte le
 * volume réglé par l'auditeur — deux nœuds distincts pour qu'ils ne se battent pas.
 *
 * SEEK : `play()` accepte un `startOffset` (secondes déjà écoulées dans l'arrangement).
 * On ancre un `virtualT0 = actualStart - startOffset` ; chaque source démarre à
 * `actualStart` avec l'offset de buffer correspondant à `startOffset`. Comme la zone
 * de boucle est périodique et que les bornes (fin des boucles, fondu) sont ancrées sur
 * `virtualT0`, la phase et le compte de boucles sont préservés où qu'on saute.
 *
 * La FIN est pilotée par `onended` d'UN nœud « timekeeper » (horloge audio),
 * jamais par setTimeout (un timer mural se déclencherait trop tôt après pause).
 */

interface Voice {
  buffer: AudioBuffer;
  /** Gain de mixage de la voix (0..1) appliqué à la création de la source. */
  gain: number;
}

/** Plan de programmation figé au play(), partagé par toutes les voix. */
interface Plan {
  noLoop: boolean;
  mode: PlaybackOptions['mode'];
  loop: { loopStart: number; loopEnd: number } | undefined;
  /** Instant réel de démarrage des sources (horloge du contexte). */
  actualStart: number;
  /** Origine virtuelle de l'arrangement : actualStart - startOffset. */
  virtualT0: number;
  introDur: number;
  loopDur: number;
  /** Position de départ dans l'arrangement (secondes écoulées). */
  startOffset: number;
  /** Nombre de boucles visé (modes loopCount*). */
  repeats: number;
  /** Fin des boucles, en secondes d'arrangement (introDur + repeats*loopDur). */
  endOfLoopsElapsed: number;
  /** Fin des boucles, en horloge du contexte (virtualT0 + endOfLoopsElapsed). */
  endOfLoopsTime: number;
}

/** État de planification figé au play(), pour calculer la progression à l'horloge audio. */
interface Timing {
  /** Origine virtuelle (horloge du contexte) ; elapsed = currentTime - t0. */
  t0: number;
  introDur: number;
  loopDur: number;
  /** Durée totale du buffer (= intro+boucle pour un artefact émulé, +queue sinon). */
  bufferDur: number;
  /** Aucune boucle (mode `once` ou piste sans boucle) → progression linéaire. */
  noLoop: boolean;
  /** Nombre de boucles visé (`null` = infini). */
  totalLoops: number | null;
  /** Durée totale de l'arrangement (s) si finie, sinon `null` (boucle infinie). */
  arrangementDur: number | null;
}

/** Progression instantanée, pour la barre intro/boucle + le compteur de boucles. */
export interface Progress {
  /** Phase courante du morceau. */
  phase: 'intro' | 'loop' | 'tail' | 'linear';
  /** Avancement dans la phase courante (0..1). */
  frac: number;
  introDur: number;
  loopDur: number;
  /** Boucle courante (1-based) ; 0 pendant l'intro / en linéaire. */
  iteration: number;
  /** Total de boucles (`null` = infini). */
  totalLoops: number | null;
  /** Temps écoulé depuis le départ (horloge audio), en secondes. */
  elapsed: number;
  /**
   * Position dans le MATÉRIAU source en secondes : monte en intro [0, loopStart],
   * puis CYCLE dans [loopStart, loopEnd] à chaque boucle (≠ elapsed qui ne fait que
   * croître). Multiplié par `LoopInfo.frameRate`, donne le n° de frame du moteur.
   */
  sourceTime: number;
  /** Durée totale de l'arrangement (s), `null` si boucle infinie. */
  arrangementDur: number | null;
}

export class LoopPlayer {
  private ctx: AudioContext | null = null;
  private track: Track | null = null;

  /** Voix chargées (id -> buffer + gain de mixage). */
  private voices = new Map<string, Voice>();
  /** Gains de canal créés au play (id -> GainNode), pour le réglage en direct. */
  private channelGains = new Map<string, GainNode>();
  /** Analyseurs par voix (id -> AnalyserNode), pour visualiser chaque voix en direct. */
  private analysers = new Map<string, AnalyserNode>();
  /** Gain de FONDU (automation loopCountFade), partagé par toutes les voix. */
  private fadeGain: GainNode | null = null;
  /** Gain UTILISATEUR (volume réglable), en aval du fondu. */
  private userGain: GainNode | null = null;
  private userVolume = 1;
  private sources: AudioBufferSourceNode[] = [];
  /** Options de lecture figées au dernier play(), pour seek()/setMode(). */
  private options: PlaybackOptions | null = null;
  /** Planification figée au play(), pour la progression (null si arrêté). */
  private timing: Timing | null = null;

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
    this.setTrack(track, [{ id: '__main__', buffer, gain: 1 }]);
  }

  /** Charge un morceau en STEMS : une voix par canal, jouées en synchro. */
  async loadChannels(
    track: Track,
    voices: { id: string; url: string; gain?: number }[]
  ): Promise<void> {
    const decoded = await Promise.all(
      voices.map(async (v) => ({
        id: v.id,
        buffer: await this.fetchBuffer(v.url),
        gain: v.gain ?? 1,
      }))
    );
    this.setTrack(track, decoded);
  }

  private setTrack(track: Track, list: { id: string; buffer: AudioBuffer; gain: number }[]): void {
    this.stop();
    this.track = track;
    this.voices.clear();
    for (const v of list) this.voices.set(v.id, { buffer: v.buffer, gain: v.gain });
  }

  /** Y a-t-il un morceau chargé et prêt à (re)jouer ? */
  get loaded(): boolean {
    return !!this.track && this.voices.size > 0;
  }

  /**
   * Démarre (ou reprend à `startOffset`) la lecture selon le comportement choisi.
   * `startOffset` = secondes déjà écoulées dans l'arrangement (0 = depuis le début).
   */
  async play(options: PlaybackOptions, startOffset = 0): Promise<void> {
    if (!this.track || this.voices.size === 0) throw new Error('aucun morceau chargé');
    const ctx = this.ensureContext();
    // stop() AVANT l'await : évite tout entrelacement si play() est rappelé.
    this.stop();
    if (ctx.state === 'suspended') await ctx.resume();
    this.options = options;

    // Chaîne master : fondu -> volume utilisateur -> destination.
    const userGain = ctx.createGain();
    userGain.gain.value = this.userVolume;
    userGain.connect(ctx.destination);
    this.userGain = userGain;
    const fadeGain = ctx.createGain();
    fadeGain.connect(userGain);
    this.fadeGain = fadeGain;

    const loop = this.track.loop;
    const actualStart = ctx.currentTime + 0.05;
    const startO = Math.max(0, startOffset);
    const virtualT0 = actualStart - startO;
    const noLoop = !loop || options.mode === 'once';
    const introDur = loop ? loop.loopStart : 0;
    const loopDur = loop ? loop.loopEnd - loop.loopStart : 0;
    const repeats = Math.max(1, Math.floor(Number.isFinite(options.loopCount) ? options.loopCount : 1));
    const endOfLoopsElapsed = introDur + repeats * loopDur;
    const endOfLoopsTime = virtualT0 + endOfLoopsElapsed;

    // Fondu de sortie : sur le gain de FONDU (partagé), une seule fois. On le place à
    // partir de l'instant réel de départ si on a déjà dépassé le début du fondu (seek).
    if (!noLoop && options.mode === 'loopCountFade') {
      const fade = Math.max(0.01, Number.isFinite(options.fadeSeconds) ? options.fadeSeconds : 0.01);
      const effectiveFade = Math.min(fade, endOfLoopsElapsed);
      const fadeStart = Math.max(actualStart, endOfLoopsTime - effectiveFade);
      fadeGain.gain.setValueAtTime(1, Math.max(actualStart, fadeStart - 0.0001));
      fadeGain.gain.setValueAtTime(1, fadeStart);
      fadeGain.gain.exponentialRampToValueAtTime(0.0001, endOfLoopsTime);
    }

    const firstBuffer = this.voices.values().next().value!.buffer;
    const bufferDur = firstBuffer.duration;
    const tailDur = loop ? Math.max(0, bufferDur - loop.loopEnd) : 0;
    this.timing = {
      t0: virtualT0,
      introDur,
      loopDur,
      bufferDur,
      noLoop,
      totalLoops: noLoop || options.mode === 'loopInfinite' ? null : repeats,
      arrangementDur:
        noLoop ? bufferDur
        : options.mode === 'loopInfinite' ? null
        : endOfLoopsElapsed + (options.mode === 'loopCount' ? tailDur : 0),
    };

    const plan: Plan = {
      noLoop, mode: options.mode, loop, actualStart, virtualT0,
      introDur, loopDur, startOffset: startO, repeats, endOfLoopsElapsed, endOfLoopsTime,
    };

    // Une (ou deux) source(s) par voix, via son gain de canal -> analyseur -> fondu.
    let timekeeper: AudioBufferSourceNode | null = null;
    for (const [id, voice] of this.voices) {
      const chGain = ctx.createGain();
      chGain.gain.value = voice.gain;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      chGain.connect(analyser);
      analyser.connect(fadeGain);
      this.channelGains.set(id, chGain);
      this.analysers.set(id, analyser);

      const terminal = this.scheduleVoice(voice.buffer, chGain, plan);
      if (terminal && !timekeeper) timekeeper = terminal;
    }

    // Fin pilotée par UN seul nœud (sinon onEnded tirerait N fois).
    if (timekeeper) this.armEnd(timekeeper);
  }

  /** Offset de buffer correspondant à une position d'arrangement (intro puis boucle cyclique). */
  private bufferOffsetFor(startOffset: number, loop: { loopStart: number; loopEnd: number }, introDur: number, loopDur: number): number {
    if (startOffset < introDur || loopDur <= 0) return Math.min(startOffset, loop.loopEnd);
    const posInLoop = (startOffset - introDur) % loopDur;
    return loop.loopStart + posInLoop;
  }

  /** Programme la (ou les) source(s) d'une voix selon le plan ; renvoie le nœud terminal. */
  private scheduleVoice(buffer: AudioBuffer, out: GainNode, p: Plan): AudioBufferSourceNode | null {
    if (p.noLoop) {
      const off = Math.min(p.startOffset, Math.max(0, buffer.duration - 0.001));
      const src = this.newSource(buffer, out);
      src.start(p.actualStart, off);
      return src;
    }
    const loop = p.loop!;

    if (p.mode === 'loopInfinite') {
      const src = this.newSource(buffer, out);
      src.loop = true;
      src.loopStart = loop.loopStart;
      src.loopEnd = loop.loopEnd;
      src.start(p.actualStart, this.bufferOffsetFor(p.startOffset, loop, p.introDur, p.loopDur));
      return null; // jamais de fin automatique
    }

    // loopCount / loopCountFade : intro + N boucles (+ queue pour loopCount).
    // Cas seek au-delà de la fin des boucles : on est dans la queue.
    if (p.startOffset >= p.endOfLoopsElapsed) {
      if (p.mode === 'loopCountFade') return null; // déjà éteint
      const tailOff = loop.loopEnd + (p.startOffset - p.endOfLoopsElapsed);
      if (tailOff < buffer.duration - 0.02) {
        const tail = this.newSource(buffer, out);
        tail.start(p.actualStart, tailOff);
        return tail;
      }
      return null;
    }

    const loopPart = this.newSource(buffer, out);
    loopPart.loop = true;
    loopPart.loopStart = loop.loopStart;
    loopPart.loopEnd = loop.loopEnd;
    loopPart.start(p.actualStart, this.bufferOffsetFor(p.startOffset, loop, p.introDur, p.loopDur));
    loopPart.stop(p.endOfLoopsTime);
    if (p.mode === 'loopCountFade') return loopPart;

    // loopCount : enchaîner la queue [loopEnd, durée].
    const hasTail = buffer.duration - loop.loopEnd > 0.02;
    if (hasTail) {
      const tail = this.newSource(buffer, out);
      tail.start(p.endOfLoopsTime, loop.loopEnd);
      return tail;
    }
    return loopPart;
  }

  /**
   * Saute à `elapsed` secondes dans l'arrangement courant (re-planifie depuis l'offset).
   * Sans effet si rien n'est chargé / aucune option mémorisée.
   */
  async seek(elapsed: number): Promise<void> {
    if (!this.options || !this.loaded) return;
    const dur = this.timing?.arrangementDur ?? null;
    const target = dur != null ? Math.max(0, Math.min(elapsed, dur - 0.05)) : Math.max(0, elapsed);
    await this.play(this.options, target);
  }

  /** Change le comportement de lecture en conservant la position courante. */
  async setMode(options: PlaybackOptions): Promise<void> {
    const at = this.getProgress()?.elapsed ?? 0;
    await this.play(options, at);
  }

  /** Règle le gain (0..1) d'une voix EN DIRECT (rampe anti-clic, sans resynchro). */
  setChannelGain(id: string, value: number): void {
    const voice = this.voices.get(id);
    if (voice) voice.gain = value;
    const g = this.channelGains.get(id);
    if (g && this.ctx) {
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(value, now, 0.01); // ~10 ms
    }
  }

  /** Règle le volume utilisateur (0..1), indépendant du fondu. */
  setMasterVolume(value: number): void {
    this.userVolume = Math.max(0, Math.min(1, value));
    if (this.userGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.userGain.gain.cancelScheduledValues(now);
      this.userGain.gain.setTargetAtTime(this.userVolume, now, 0.01);
    }
  }

  /** Analyseurs par voix (id -> AnalyserNode) pour visualiser chaque voix. */
  getAnalysers(): Map<string, AnalyserNode> {
    return this.analysers;
  }

  /**
   * Peaks d'amplitude (0..1) du matériau décodé, en `buckets` tranches — pour
   * tracer une forme d'onde statique (style SoundCloud) sous le scrubber. Somme
   * des voix chargées (canal 0). `null` si rien n'est chargé.
   */
  getPeaks(buckets: number): Float32Array | null {
    const first = this.voices.values().next().value as Voice | undefined;
    if (!first) return null;
    const len = first.buffer.length;
    if (len === 0 || buckets <= 0) return null;
    // Mélange des canaux 0 de toutes les voix (stems) en un signal sommé.
    const mix = new Float32Array(len);
    for (const v of this.voices.values()) {
      const data = v.buffer.getChannelData(0);
      const n = Math.min(len, data.length);
      for (let i = 0; i < n; i++) mix[i] += data[i];
    }
    const out = new Float32Array(buckets);
    const step = len / buckets;
    let max = 1e-6;
    for (let b = 0; b < buckets; b++) {
      const start = Math.floor(b * step);
      const end = Math.min(len, Math.floor((b + 1) * step));
      let peak = 0;
      for (let i = start; i < end; i++) {
        const a = Math.abs(mix[i]);
        if (a > peak) peak = a;
      }
      out[b] = peak;
      if (peak > max) max = peak;
    }
    // Normalisation sur le pic global.
    for (let b = 0; b < buckets; b++) out[b] /= max;
    return out;
  }

  /**
   * Progression instantanée, calculée à l'HORLOGE AUDIO (et donc figée pendant
   * une pause `suspend()`, comme l'audio). `null` si rien n'est planifié.
   */
  getProgress(): Progress | null {
    if (!this.ctx || !this.timing) return null;
    const t = this.timing;
    const elapsed = Math.max(0, this.ctx.currentTime - t.t0);

    if (t.noLoop) {
      const dur = t.bufferDur || 1;
      return { phase: 'linear', frac: Math.min(1, elapsed / dur), introDur: 0, loopDur: dur, iteration: 0, totalLoops: null, elapsed, sourceTime: Math.min(elapsed, dur), arrangementDur: t.arrangementDur };
    }
    if (elapsed < t.introDur) {
      return { phase: 'intro', frac: t.introDur ? elapsed / t.introDur : 1, introDur: t.introDur, loopDur: t.loopDur, iteration: 0, totalLoops: t.totalLoops, elapsed, sourceTime: elapsed, arrangementDur: t.arrangementDur };
    }

    const loopElapsed = elapsed - t.introDur;
    const iter = Math.floor(loopElapsed / t.loopDur); // 0-based

    // loopCount / loopCountFade : au-delà du nombre de boucles -> queue éventuelle.
    if (t.totalLoops != null && iter >= t.totalLoops) {
      const loopEnd = t.introDur + t.loopDur;
      const tailDur = Math.max(0, t.bufferDur - loopEnd);
      const tailElapsed = loopElapsed - t.totalLoops * t.loopDur;
      return {
        phase: 'tail',
        frac: tailDur ? Math.min(1, tailElapsed / tailDur) : 1,
        introDur: t.introDur,
        loopDur: t.loopDur,
        iteration: t.totalLoops,
        totalLoops: t.totalLoops,
        elapsed,
        sourceTime: loopEnd + Math.min(tailElapsed, tailDur),
        arrangementDur: t.arrangementDur,
      };
    }

    const posInLoop = loopElapsed - iter * t.loopDur;
    return {
      phase: 'loop',
      frac: t.loopDur ? posInLoop / t.loopDur : 0,
      introDur: t.introDur,
      loopDur: t.loopDur,
      iteration: iter + 1,
      totalLoops: t.totalLoops,
      elapsed,
      sourceTime: t.introDur + posInLoop,
      arrangementDur: t.arrangementDur,
    };
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
    for (const a of this.analysers.values()) a.disconnect();
    this.analysers.clear();
    this.timing = null;
    if (this.fadeGain) {
      this.fadeGain.disconnect();
      this.fadeGain = null;
    }
    if (this.userGain) {
      this.userGain.disconnect();
      this.userGain = null;
    }
  }

  async suspend(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend();
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Le contexte est-il suspendu (pause) ? */
  get suspended(): boolean {
    return this.ctx?.state === 'suspended';
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
