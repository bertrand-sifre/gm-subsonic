import type { Library, Track } from '@vdm/shared';

/**
 * Entrée de manifeste. Deux familles :
 *  - STATIQUE : un fichier audio prêt à servir (`file`), avec points de boucle
 *    optionnels (`loopStart`/`loopEnd`) ;
 *  - ÉMULÉE : une sous-piste d'un format émulé (NSF/NSFe/SPC…), référencée par
 *    `source` + `trackIndex`, rendue à la demande par le serveur (durée/fondu).
 */
export interface MetaTrack {
  title: string;
  game: string;
  composer?: string;
  platform?: string;
  // statique
  file?: string;
  loopStart?: number;
  loopEnd?: number;
  // émulée
  id?: string;
  source?: string;
  trackIndex?: number;
  defaultSeconds?: number;
  defaultFade?: number;
  /** Boucle détectée (tools/nsf-loop.mjs) pour une piste émulée. */
  loop?: {
    startSeconds: number;
    lengthSeconds: number;
    startSamples: number;
    lengthSamples: number;
    sampleRate: number;
  };
  /** Voix (stems) cataloguées (tools/nsf-stems.mjs) pour une piste NES. */
  channels?: {
    sampleRate: number;
    voices: {
      id: string;
      label: string;
      chip?: string;
      kind?: string;
      channelIndex: number;
      enabledByDefault?: boolean;
    }[];
  };
}

export interface MetaFile {
  tracks: MetaTrack[];
}

/** Référence permettant de rendre une sous-piste émulée à la demande (paramétrique). */
export interface RenderRef {
  sourcePath: string;
  trackIndex: number;
  defaultSeconds: number;
  defaultFade: number;
}

/**
 * Référence d'un rendu SANS COUTURE (artefact de boucle ou stem d'une voix).
 * Les deux ne diffèrent que par `channelIndex` : absent → le mix complet (moteur
 * libgme) ; présent → la voix isolée (moteur nsftool). Mêmes bornes pour toutes
 * les voix d'une piste → stems alignés à l'échantillon.
 */
export interface SeamlessRenderRef {
  sourcePath: string;
  trackIndex: number;
  introSamples: number;
  loopLengthSamples: number;
  /** Présent → stem d'une voix (canal APU) ; absent → artefact de boucle (mix). */
  channelIndex?: number;
}

export interface ScanResult {
  library: Library;
  /** id -> chemin absolu, pour les morceaux à servir statiquement. */
  files: Map<string, string>;
  /** id -> référence de rendu paramétrique (durée/fondu), pour les morceaux émulés. */
  renders: Map<string, RenderRef>;
  /** id -> référence de l'artefact de boucle, pour les pistes émulées bouclées. */
  loops: Map<string, SeamlessRenderRef>;
  /** `${id}::${chanId}` -> référence de rendu d'un stem (rendu à la demande). */
  channelRenders: Map<string, SeamlessRenderRef>;
}

/**
 * Index mutables qu'un builder remplit au fil du scan (les `Map` de `ScanResult`
 * en cours de construction) + les dossiers de résolution. Passé à chaque builder.
 */
export interface BuildContext {
  mediaDir: string;
  libraryDir: string;
  files: Map<string, string>;
  renders: Map<string, RenderRef>;
  loops: Map<string, SeamlessRenderRef>;
  channelRenders: Map<string, SeamlessRenderRef>;
}

/**
 * Stratégie de construction d'un `Track` à partir d'une entrée de manifeste.
 * Le scan essaie les builders dans l'ordre et prend le premier qui `match`.
 * Point d'extension : une nouvelle famille de source = un nouveau builder.
 */
export interface TrackBuilder {
  /** Cette entrée relève-t-elle de ce builder ? */
  match(entry: MetaTrack): boolean;
  /** Construit le `Track` et enregistre ses refs dans `ctx` ; `null` = ignorée. */
  build(entry: MetaTrack, ctx: BuildContext): Promise<Track | null>;
}
