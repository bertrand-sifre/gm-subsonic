import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { GameGroup, Library, Track } from '@vdm/shared';

/**
 * Entrée de manifeste. Deux familles :
 *  - STATIQUE : un fichier audio prêt à servir (`file`), avec points de boucle
 *    optionnels (`loopStart`/`loopEnd`) ;
 *  - ÉMULÉE : une sous-piste d'un format émulé (NSF/NSFe/SPC…), référencée par
 *    `source` + `trackIndex`, rendue à la demande par le serveur (durée/fondu).
 */
interface MetaTrack {
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
}

interface MetaFile {
  tracks: MetaTrack[];
}

/** Référence permettant de rendre une sous-piste émulée à la demande. */
export interface RenderRef {
  sourcePath: string;
  trackIndex: number;
  defaultSeconds: number;
  defaultFade: number;
}

export interface ScanResult {
  library: Library;
  /** id -> chemin absolu, pour les morceaux à servir statiquement. */
  files: Map<string, string>;
  /** id -> référence de rendu, pour les morceaux émulés. */
  renders: Map<string, RenderRef>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Lit un manifeste de morceaux ; renvoie [] s'il est absent ou illisible. */
async function readManifest(path: string): Promise<MetaTrack[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return (JSON.parse(raw) as MetaFile).tracks ?? [];
  } catch {
    return [];
  }
}

/**
 * Construit la bibliothèque en mémoire à partir des manifestes.
 * @param mediaDir   dossier des fichiers servis statiquement + manifestes
 * @param libraryDir dossier des sources émulées (NSF/NSFe/SPC…)
 */
export async function scanLibrary(mediaDir: string, libraryDir: string): Promise<ScanResult> {
  const entries = [
    ...(await readManifest(join(mediaDir, 'meta.json'))),
    ...(await readManifest(join(mediaDir, 'library.generated.json'))),
  ];

  const tracks: Track[] = [];
  const files = new Map<string, string>();
  const renders = new Map<string, RenderRef>();

  for (const entry of entries) {
    const isEmulated = entry.source != null && entry.trackIndex != null;
    const track = isEmulated
      ? await buildEmulated(entry, libraryDir, renders)
      : await buildStatic(entry, mediaDir, files);
    if (track) tracks.push(track);
  }

  // Regroupement par jeu (concept d'organisation central du produit).
  const byGame = new Map<string, Track[]>();
  for (const track of tracks) {
    const list = byGame.get(track.game) ?? [];
    list.push(track);
    byGame.set(track.game, list);
  }
  const games: GameGroup[] = [...byGame.entries()].map(([game, list]) => ({ game, tracks: list }));

  return { library: { games }, files, renders };
}

/** Morceau émulé : rendu à la demande, durée/fondu par défaut depuis la source. */
async function buildEmulated(
  entry: MetaTrack,
  libraryDir: string,
  renders: Map<string, RenderRef>
): Promise<Track | null> {
  const sourcePath = join(libraryDir, entry.source!);
  try {
    await stat(sourcePath);
  } catch {
    console.warn(`[library] source émulée introuvable, ignorée : ${entry.source}`);
    return null;
  }

  const id = entry.id ?? `${slugify(entry.source!)}-${entry.trackIndex}`;
  const defaultSeconds = entry.defaultSeconds ?? 120;
  const defaultFade = entry.defaultFade ?? 0;

  renders.set(id, { sourcePath, trackIndex: entry.trackIndex!, defaultSeconds, defaultFade });

  return {
    id,
    title: entry.title,
    game: entry.game,
    composer: entry.composer,
    platform: entry.platform,
    duration: defaultSeconds,
    render: { defaultSeconds, defaultFade },
    streamUrl: `/api/stream/${id}`,
  };
}

/** Morceau statique : fichier audio servi tel quel (durée + boucle lues du fichier). */
async function buildStatic(
  entry: MetaTrack,
  mediaDir: string,
  files: Map<string, string>
): Promise<Track | null> {
  const filePath = join(mediaDir, entry.file!);
  try {
    await stat(filePath);
  } catch {
    console.warn(`[library] fichier introuvable, ignoré : ${entry.file}`);
    return null;
  }

  let duration = 0;
  try {
    const parsed = await parseFile(filePath, { duration: true });
    duration = parsed.format.duration ?? 0;
  } catch (err) {
    console.warn(`[library] métadonnées illisibles pour ${entry.file}:`, err);
  }

  const id = slugify(entry.file!);
  const hasLoop =
    typeof entry.loopStart === 'number' &&
    typeof entry.loopEnd === 'number' &&
    entry.loopEnd > entry.loopStart;

  files.set(id, filePath);
  return {
    id,
    title: entry.title,
    game: entry.game,
    composer: entry.composer,
    platform: entry.platform,
    duration,
    loop: hasLoop ? { loopStart: entry.loopStart!, loopEnd: entry.loopEnd! } : undefined,
    streamUrl: `/api/stream/${id}`,
  };
}
