import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { ChannelInfo, GameGroup, Library, Track } from '@vdm/shared';

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

/** Référence permettant de rendre l'artefact de boucle [intro + 1 boucle + ε]. */
export interface LoopRenderRef {
  sourcePath: string;
  trackIndex: number;
  introSamples: number;
  loopLengthSamples: number;
}

/** Référence permettant de rendre un stem (une voix) à la demande. */
export interface ChannelRenderRef {
  sourcePath: string;
  trackIndex: number;
  channelIndex: number;
  introSamples: number;
  loopLengthSamples: number;
}

export interface ScanResult {
  library: Library;
  /** id -> chemin absolu, pour les morceaux à servir statiquement. */
  files: Map<string, string>;
  /** id -> référence de rendu paramétrique (durée/fondu), pour les morceaux émulés. */
  renders: Map<string, RenderRef>;
  /** id -> référence de rendu de boucle, pour les pistes émulées bouclées. */
  loops: Map<string, LoopRenderRef>;
  /** `${id}::${chanId}` -> référence de rendu d'un stem (rendu à la demande). */
  channelRenders: Map<string, ChannelRenderRef>;
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
  const loops = new Map<string, LoopRenderRef>();
  const channelRenders = new Map<string, ChannelRenderRef>();

  for (const entry of entries) {
    const isEmulated = entry.source != null && entry.trackIndex != null;
    const track = isEmulated
      ? await buildEmulated(entry, libraryDir, mediaDir, renders, loops, channelRenders)
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

  return { library: { games }, files, renders, loops, channelRenders };
}

/** Morceau émulé : rendu à la demande, durée/fondu par défaut depuis la source. */
async function buildEmulated(
  entry: MetaTrack,
  libraryDir: string,
  mediaDir: string,
  renders: Map<string, RenderRef>,
  loops: Map<string, LoopRenderRef>,
  channelRenders: Map<string, ChannelRenderRef>
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

  // Repli paramétrique : toujours disponible (filet de sécurité).
  renders.set(id, { sourcePath, trackIndex: entry.trackIndex!, defaultSeconds, defaultFade });

  const track: Track = {
    id,
    title: entry.title,
    game: entry.game,
    composer: entry.composer,
    platform: entry.platform,
    duration: defaultSeconds,
    render: { defaultSeconds, defaultFade },
    streamUrl: `/api/stream/${id}`,
  };

  // Boucle détectée : lecture interactive (prime sur le paramétrique).
  if (entry.loop) {
    const loopStart = entry.loop.startSeconds;
    const loopEnd = entry.loop.startSeconds + entry.loop.lengthSeconds;
    track.loop = { loopStart, loopEnd };
    // L'artefact rendu dure intro + 1 boucle : recaler la durée pour que le
    // client ne calcule pas de fausse queue.
    track.duration = loopEnd;
    loops.set(id, {
      sourcePath,
      trackIndex: entry.trackIndex!,
      introSamples: entry.loop.startSamples,
      loopLengthSamples: entry.loop.lengthSamples,
    });
  }

  // Voix (stems) : mode le plus riche (précédence channels > loop > render).
  // Rendu de chaque voix À LA DEMANDE -> on n'enregistre qu'une référence ; les
  // bornes viennent de la boucle (les voix n'existent que si entry.loop).
  if (entry.loop && entry.channels?.voices?.length) {
    const voices: ChannelInfo[] = [];
    for (const v of entry.channels.voices) {
      channelRenders.set(`${id}::${v.id}`, {
        sourcePath,
        trackIndex: entry.trackIndex!,
        channelIndex: v.channelIndex,
        introSamples: entry.loop.startSamples,
        loopLengthSamples: entry.loop.lengthSamples,
      });
      voices.push({
        id: v.id,
        label: v.label,
        chip: v.chip,
        kind: v.kind,
        streamUrl: `/api/stream/${id}/channel/${v.id}`,
        enabledByDefault: v.enabledByDefault,
      });
    }
    if (voices.length) track.channels = { sampleRate: entry.channels.sampleRate, voices };
  }

  return track;
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
  let embeddedLoop: { loopStart: number; loopEnd: number } | undefined;
  try {
    const parsed = await parseFile(filePath, { duration: true });
    duration = parsed.format.duration ?? 0;
    embeddedLoop = readEmbeddedLoop(parsed);
  } catch (err) {
    console.warn(`[library] métadonnées illisibles pour ${entry.file}:`, err);
  }

  const id = slugify(entry.file!);
  // Le manifeste (meta.json) prime sur les tags du fichier.
  const manifestLoop =
    typeof entry.loopStart === 'number' &&
    typeof entry.loopEnd === 'number' &&
    entry.loopEnd > entry.loopStart
      ? { loopStart: entry.loopStart, loopEnd: entry.loopEnd }
      : undefined;

  files.set(id, filePath);
  return {
    id,
    title: entry.title,
    game: entry.game,
    composer: entry.composer,
    platform: entry.platform,
    duration,
    loop: manifestLoop ?? embeddedLoop,
    streamUrl: `/api/stream/${id}`,
  };
}

/**
 * Lit les commentaires Vorbis LOOPSTART/LOOPLENGTH (ou LOOPEND) d'un fichier
 * (convention répandue des OST rippées) et les convertit en secondes.
 * Les valeurs sont en FRAMES (par canal) → on divise par le sampleRate.
 */
function readEmbeddedLoop(
  parsed: Awaited<ReturnType<typeof parseFile>>
): { loopStart: number; loopEnd: number } | undefined {
  const sr = parsed.format.sampleRate;
  if (!sr) return undefined;

  let startFrames: number | undefined;
  let lengthFrames: number | undefined;
  let endFrames: number | undefined;
  for (const group of Object.values(parsed.native ?? {})) {
    for (const tag of group) {
      const tid = tag.id.toUpperCase();
      const v = Number(tag.value);
      if (!Number.isFinite(v)) continue;
      if (tid === 'LOOPSTART') startFrames = v;
      else if (tid === 'LOOPLENGTH') lengthFrames = v;
      else if (tid === 'LOOPEND') endFrames = v;
    }
  }
  if (startFrames == null) return undefined;

  const loopStart = startFrames / sr;
  const loopEnd =
    endFrames != null
      ? endFrames / sr
      : lengthFrames != null
        ? (startFrames + lengthFrames) / sr
        : NaN;
  if (!Number.isFinite(loopEnd) || loopEnd <= loopStart) return undefined;
  return { loopStart, loopEnd };
}
