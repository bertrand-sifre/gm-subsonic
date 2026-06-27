/**
 * Moteur libgme (via le demuxer `-f libgme` de ffmpeg) : rend le MIX complet
 * d'une sous-piste émulée. Deux usages :
 *  - `renderParametricOgg` : rendu paramétrable (durée bornée + fondu) → OGG, le
 *    filet de sécurité de tout format émulé (NSF/NSFe/SPC/VGM/GBS…) ;
 *  - `libgmeEngine` : producteur PCM borné (WAV) pour l'artefact de boucle.
 */

import { SAMPLE_RATE } from '../../config.js';
import type { RenderRef } from '../../library/types.js';
import { exec } from '../exec.js';
import type { PcmEngine, PcmRequest } from './types.js';

/** Rend une sous-piste en OGG (durée bornée + fondu de sortie) via ffmpeg/libgme. */
export function renderParametricOgg(
  ref: RenderRef,
  seconds: number,
  fade: number,
  outPath: string
): Promise<void> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'libgme', '-track_index', String(ref.trackIndex), '-sample_rate', String(SAMPLE_RATE),
    '-i', ref.sourcePath,
    '-t', String(seconds),
  ];
  if (fade > 0) {
    args.push('-af', `afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}`);
  }
  args.push('-c:a', 'libvorbis', '-qscale:a', '5', outPath);
  return exec('ffmpeg', args);
}

/** Producteur PCM : le mix complet, borné à `endSample` (ignore `channelIndex`). */
export const libgmeEngine: PcmEngine = {
  renderWav(outWav: string, req: PcmRequest): Promise<void> {
    return exec('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'libgme', '-track_index', String(req.trackIndex), '-sample_rate', String(SAMPLE_RATE),
      '-i', req.sourcePath,
      '-af', `atrim=end_sample=${req.endSample}`, outWav,
    ]);
  },
};
