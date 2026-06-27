/**
 * Moteur nsftool : rend une VOIX ISOLÉE (canal APU) d'une sous-piste NES via
 * `--solo`. Déterministe → toutes les voix rendues sur les mêmes bornes sont
 * alignées à l'échantillon. nsftool raisonne en pistes 1-based et en durée (ms).
 */

import { NSFTOOL, SAMPLE_RATE } from '../../config.js';
import { exec } from '../exec.js';
import type { PcmEngine, PcmRequest } from './types.js';

/** Producteur PCM : une seule voix (`channelIndex` requis), bornée à `endSample`. */
export const nsftoolEngine: PcmEngine = {
  renderWav(outWav: string, req: PcmRequest): Promise<void> {
    if (req.channelIndex == null) {
      throw new Error('nsftoolEngine : channelIndex requis (rendu d\'une voix isolée)');
    }
    const lengthMs = Math.round((req.endSample / SAMPLE_RATE) * 1000);
    return exec(NSFTOOL, [
      '-t', String(req.trackIndex + 1), '-l', String(lengthMs), '-r', String(SAMPLE_RATE), '-c', '1',
      '--solo', String(req.channelIndex), '-o', outWav, req.sourcePath,
    ]);
  },
};
