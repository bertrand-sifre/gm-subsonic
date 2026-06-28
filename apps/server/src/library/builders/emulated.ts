/**
 * Builder ÉMULÉ : une sous-piste d'un format émulé (NSF/NSFe/SPC…), rendue à la
 * demande. Enregistre dans le contexte : une ref paramétrique (toujours, filet
 * de sécurité), une ref d'artefact de boucle (si boucle détectée) et une ref par
 * voix (si stems catalogués). Précédence à la lecture : channels > loop > render.
 */

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChannelInfo, Track } from '@vdm/shared';
import { slugify } from '../slug.js';
import type { BuildContext, MetaTrack, TrackBuilder } from '../types.js';

export const emulatedBuilder: TrackBuilder = {
  match: (entry) => entry.source != null && entry.trackIndex != null,
  build: buildEmulated,
};

async function buildEmulated(entry: MetaTrack, ctx: BuildContext): Promise<Track | null> {
  const sourcePath = join(ctx.libraryDir, entry.source!);
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
  ctx.renders.set(id, { sourcePath, trackIndex: entry.trackIndex!, defaultSeconds, defaultFade });

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
    track.loop = { loopStart, loopEnd, frameRate: entry.loop.frameRate };
    // L'artefact rendu dure intro + 1 boucle : recaler la durée pour que le
    // client ne calcule pas de fausse queue.
    track.duration = loopEnd;
    ctx.loops.set(id, {
      sourcePath,
      trackIndex: entry.trackIndex!,
      introSamples: entry.loop.startSamples,
      loopLengthSamples: entry.loop.lengthSamples,
    });
  }

  // Voix (stems) : mode le plus riche. Rendu de chaque voix À LA DEMANDE -> on
  // n'enregistre qu'une référence (avec channelIndex). Les voix d'une puce sont
  // STATIQUES (indépendantes de la boucle) : on les expose AUSSI sur les pistes
  // FINIES (sans boucle). Les bornes du rendu suivent le mode de lecture :
  //  - boucle détectée  -> raccord seamless (intro + corps bouclable) ;
  //  - piste finie       -> rendu paramétrique borné à la durée (joué une fois).
  if (entry.channels?.voices?.length) {
    const voices: ChannelInfo[] = [];
    for (const v of entry.channels.voices) {
      ctx.channelRenders.set(
        `${id}::${v.id}`,
        entry.loop
          ? {
              sourcePath,
              trackIndex: entry.trackIndex!,
              introSamples: entry.loop.startSamples,
              loopLengthSamples: entry.loop.lengthSamples,
              channelIndex: v.channelIndex,
            }
          : {
              sourcePath,
              trackIndex: entry.trackIndex!,
              channelIndex: v.channelIndex,
              seconds: defaultSeconds,
              fade: defaultFade,
            }
      );
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
