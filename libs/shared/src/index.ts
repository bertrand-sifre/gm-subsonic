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

/**
 * Rendu serveur paramétrable, pour les formats émulés (NSF/NSFe/SPC…) qui sont
 * infinis et ne portent qu'une durée + un fondu, pas de points de boucle.
 * Le client choisit la durée et le fondu ; le serveur rend l'OGG à la demande
 * (`/api/stream/:id?seconds=&fade=`).
 */
export interface RenderInfo {
  /** Durée par défaut (s), issue de la source (ex. chunk `time` du NSFe). */
  defaultSeconds: number;
  /** Fondu de sortie par défaut (s). */
  defaultFade: number;
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
  /** Présent uniquement si le morceau a de vrais points de boucle. */
  loop?: LoopInfo;
  /** Présent pour les formats émulés : lecture choisie via rendu serveur. */
  render?: RenderInfo;
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
