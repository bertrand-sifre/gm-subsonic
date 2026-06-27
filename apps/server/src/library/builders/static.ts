/**
 * Builder STATIQUE : un fichier audio servi tel quel (durée + boucle lues du
 * fichier). La boucle vient du manifeste (`loopStart`/`loopEnd`) ou des
 * commentaires Vorbis LOOPSTART/LOOPLENGTH (convention des OST rippées).
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { Track } from '@vdm/shared';
import { slugify } from '../slug.js';
import type { BuildContext, MetaTrack, TrackBuilder } from '../types.js';

export const staticBuilder: TrackBuilder = {
  match: (entry) => entry.file != null,
  build: buildStatic,
};

async function buildStatic(entry: MetaTrack, ctx: BuildContext): Promise<Track | null> {
  const filePath = join(ctx.mediaDir, entry.file!);
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

  ctx.files.set(id, filePath);
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
 * Lit les commentaires Vorbis LOOPSTART/LOOPLENGTH (ou LOOPEND) d'un fichier et
 * les convertit en secondes. Les valeurs sont en FRAMES (par canal) → on divise
 * par le sampleRate.
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
