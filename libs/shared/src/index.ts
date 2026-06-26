/**
 * Types partagés entre le serveur et le client web.
 *
 * Périmètre MVP (tranche 1 « boucle ») : on ne modélise que ce qui est
 * nécessaire pour lire un morceau avec intro / boucle / fin personnalisée.
 * Les variantes, stems et couches dynamiques viendront dans les tranches 4-5.
 */

/** Repères de boucle, exprimés en secondes depuis le début du fichier. */
export interface LoopInfo {
  /** Début de la section qui se répète. L'intro est [0, loopStart]. */
  loopStart: number;
  /** Fin de la section qui se répète. La queue est [loopEnd, durée]. */
  loopEnd: number;
}

/** Un morceau jouable. */
export interface Track {
  id: string;
  title: string;
  game: string;
  composer?: string;
  platform?: string;
  /** Durée totale du fichier audio, en secondes. */
  duration: number;
  /** Présent uniquement si le morceau a une boucle. */
  loop?: LoopInfo;
  /** URL relative de streaming, ex. `/api/stream/<id>`. */
  streamUrl: string;
}

/** Morceaux regroupés par jeu (organisation produit centrale). */
export interface GameGroup {
  game: string;
  tracks: Track[];
}

export interface Library {
  games: GameGroup[];
}

/** Comportements de lecture proposés à l'utilisateur. */
export type PlaybackMode =
  | 'once' // lecture normale, du début à la fin
  | 'loopInfinite' // boucle à l'infini
  | 'loopCount' // N boucles puis queue (fin personnalisée)
  | 'loopCountFade'; // N boucles puis fondu de sortie

export interface PlaybackOptions {
  mode: PlaybackMode;
  /** Nombre de répétitions de la section de boucle (modes loopCount*). */
  loopCount: number;
  /** Durée du fondu final en secondes (mode loopCountFade). */
  fadeSeconds: number;
}
