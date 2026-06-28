/**
 * Moteur gdm (libgme, API C native) : rend une sous-piste GBS via le binaire maison
 * `gdm render`. Deux usages selon `channelIndex` :
 *  - absent → le MIX complet ;
 *  - présent → une VOIX ISOLÉE (les autres canaux sont mutés côté libgme).
 * Sortie WAV PCM16 STÉRÉO bornée à `endSample` ; l'encodage OGG reste à ffmpeg via
 * `encodeSeamlessOgg` (atrim/acrossfade à la frame, agnostique du nombre de canaux).
 * gdm raisonne en pistes 0-based (PAS de +1, contrairement à nsftool) et en échantillons.
 */

import { GDM, SAMPLE_RATE } from '../../config.js';
import { exec } from '../exec.js';
import type { PcmEngine, PcmRequest } from './types.js';

/** Producteur PCM : mix complet, ou voix isolée si `channelIndex` est présent. */
export const gdmEngine: PcmEngine = {
  renderWav(outWav: string, req: PcmRequest): Promise<void> {
    const args = [
      'render', req.sourcePath,
      '--track', String(req.trackIndex), // 0-based, PAS de +1
      '--end-sample', String(req.endSample), // échantillons @44100
      '--rate', String(SAMPLE_RATE),
      '-o', outWav, // fichier -> exec.ts inchangé (stdout 'ignore')
    ];
    if (req.channelIndex != null) {
      args.push('--channel', String(req.channelIndex));
    }
    return exec(GDM, args);
  },
};
