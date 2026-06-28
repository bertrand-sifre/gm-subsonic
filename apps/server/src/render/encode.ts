/**
 * Encodage de l'artefact de boucle en OGG BOUCLABLE sans couture.
 *
 * Un WAV [intro + boucle + ε] est transformé en [intro + corps bouclable] : la
 * queue ε (début de boucle rejoué, continu en phase avec la fin) est crossfadée
 * (équiénergie qsin) sur le début de la boucle → le corps boucle sans clic en
 * lecture native, et la jointure fin↔début est parfaitement continue. On y
 * appose les tags Vorbis LOOPSTART/LOOPLENGTH (échantillons) lus par le client.
 */

import { SAMPLE_RATE } from '../config.js';
import { exec } from './exec.js';

/** Queue rendue après loopEnd (sert de matière au crossfade). */
export const LOOP_EPSILON_SAMPLES = Math.round(0.05 * SAMPLE_RATE);
/** Durée du crossfade de jointure (~25 ms). */
export const XFADE_SAMPLES = Math.round(0.025 * SAMPLE_RATE);

/**
 * Filtre ffmpeg : transforme [intro + boucle + ε] en [intro + corps bouclable].
 * La queue ε (début de boucle rejoué, continu en phase avec la fin) est
 * crossfadée (équiénergie qsin) sur le début de la boucle → le corps boucle
 * sans clic en lecture native. La fin du corps == fin de boucle, et le début du
 * corps reprend exactement la queue → jointure parfaitement continue.
 */
export function seamlessFilter(introSamples: number, loopLengthSamples: number, xfade: number): string {
  const I = introSamples;
  const L = loopLengthSamples;
  const X = xfade;
  const hasIntro = I > 0;
  const splitN = hasIntro ? 4 : 3;
  const parts: string[] = [
    `[0:a]asplit=${splitN}` + Array.from({ length: splitN }, (_, i) => `[s${i}]`).join(''),
  ];
  let si = 0;
  let concat = '';
  let nConcat = 0;
  if (hasIntro) {
    parts.push(`[s${si++}]atrim=start_sample=0:end_sample=${I},asetpts=PTS-STARTPTS[intro]`);
    concat += '[intro]';
    nConcat++;
  }
  parts.push(`[s${si++}]atrim=start_sample=${I}:end_sample=${I + X},asetpts=PTS-STARTPTS[head]`);
  parts.push(`[s${si++}]atrim=start_sample=${I + L}:end_sample=${I + L + X},asetpts=PTS-STARTPTS[tail]`);
  parts.push(`[s${si++}]atrim=start_sample=${I + X}:end_sample=${I + L},asetpts=PTS-STARTPTS[mid]`);
  parts.push(`[tail][head]acrossfade=ns=${X}:c1=qsin:c2=qsin[seam]`);
  concat += '[seam][mid]';
  nConcat += 2;
  parts.push(`${concat}concat=n=${nConcat}:v=0:a=1[out]`);
  return parts.join(';');
}

/** Encode un WAV [intro+boucle+ε] en OGG bouclable (crossfade) + tags de boucle. */
export function encodeSeamlessOgg(
  wav: string,
  outPath: string,
  introSamples: number,
  loopLengthSamples: number
): Promise<void> {
  const X = Math.min(XFADE_SAMPLES, Math.floor(loopLengthSamples / 4));
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav];
  if (X >= 64) {
    args.push('-filter_complex', seamlessFilter(introSamples, loopLengthSamples, X), '-map', '[out]');
  } else {
    // Boucle trop courte pour un crossfade -> simple coupe à loopEnd.
    args.push('-af', `atrim=end_sample=${introSamples + loopLengthSamples}`);
  }
  args.push(
    '-metadata', `LOOPSTART=${introSamples}`,
    '-metadata', `LOOPLENGTH=${loopLengthSamples}`,
    '-c:a', 'libvorbis', '-qscale:a', '4', outPath
  );
  return exec('ffmpeg', args);
}

/**
 * Encode un WAV en OGG SIMPLE (pas de boucle), avec fondu de sortie optionnel.
 * Sert aux stems d'une piste FINIE (non-bouclante) : le lecteur les joue UNE FOIS,
 * sans tags de boucle. `fade <= 0` -> simple ré-encodage (les pistes GBS finies se
 * taisent d'elles-mêmes, donc fade = 0 par défaut côté builder).
 */
export function encodePlainOgg(
  wav: string,
  outPath: string,
  fade: number,
  seconds: number
): Promise<void> {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav];
  if (fade > 0) {
    args.push('-af', `afade=t=out:st=${Math.max(0, seconds - fade)}:d=${fade}`);
  }
  args.push('-c:a', 'libvorbis', '-qscale:a', '4', outPath);
  return exec('ffmpeg', args);
}
