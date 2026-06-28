/**
 * API publique du rendu à la demande. Trois entrées, toutes mises en cache et
 * dédoublonnées (cf. `cache.ts`) :
 *  - `ensureParametricRender` : durée + fondu choisis (moteur libgme) ;
 *  - `ensureLoopRender`       : artefact de boucle sans couture (mix, libgme) ;
 *  - `ensureChannelRender`    : stem d'une voix sans couture (solo, nsftool).
 *
 * Les deux derniers passent par `renderSeamless`, qui ne diffère QUE par le
 * moteur PCM choisi selon `ref.channelIndex` — toute la chaîne ε → crossfade →
 * encode → tags est commune.
 */

import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CACHE_DIR } from '../config.js';
import type { RenderRef, SeamlessRenderRef } from '../library/types.js';
import { ensureCached } from './cache.js';
import { encodeSeamlessOgg, LOOP_EPSILON_SAMPLES } from './encode.js';
import { gdmEngine } from './engines/gdm.js';
import { libgmeEngine, renderParametricOgg } from './engines/libgme.js';
import { nsftoolEngine } from './engines/nsftool.js';
import type { PcmEngine } from './engines/types.js';

/**
 * Choix du moteur PCM seamless. GBS → gdm (libgme natif : MIX *et* voix isolée
 * via mute). Toute autre source garde EXACTEMENT le dispatch d'origine : voix
 * isolée → nsftool (NES), mix → libgme. Le chemin NSF n'est jamais modifié.
 */
function pickSeamlessEngine(ref: SeamlessRenderRef): PcmEngine {
  if (extname(ref.sourcePath).toLowerCase() === '.gbs') return gdmEngine;
  return ref.channelIndex != null ? nsftoolEngine : libgmeEngine;
}

/**
 * Rendu sans couture [intro + corps bouclable]. Le moteur PCM est choisi par la
 * présence de `channelIndex` (voix isolée nsftool vs mix libgme) ; on rend
 * [intro + boucle + ε] en WAV, puis on encode l'OGG bouclable + tags de boucle.
 */
async function renderSeamless(outPath: string, ref: SeamlessRenderRef): Promise<void> {
  const engine = pickSeamlessEngine(ref);
  const endSample = ref.introSamples + ref.loopLengthSamples + LOOP_EPSILON_SAMPLES;
  const wav = `${outPath}.tmp.wav`;
  try {
    await engine.renderWav(wav, {
      sourcePath: ref.sourcePath,
      trackIndex: ref.trackIndex,
      endSample,
      channelIndex: ref.channelIndex,
    });
    await encodeSeamlessOgg(wav, outPath, ref.introSamples, ref.loopLengthSamples);
  } finally {
    await rm(wav, { force: true }).catch(() => {});
  }
}

/** Garantit l'OGG paramétrique (durée/fondu) en cache et renvoie son chemin. */
export function ensureParametricRender(
  id: string,
  ref: RenderRef,
  seconds: number,
  fade: number
): Promise<string> {
  const outPath = join(CACHE_DIR, `${id}__s${seconds}__f${String(fade).replace('.', 'p')}.ogg`);
  return ensureCached(outPath, (out) => renderParametricOgg(ref, seconds, fade, out));
}

/** Garantit l'artefact de boucle en cache (clé stable, sans paramètre). */
export function ensureLoopRender(id: string, ref: SeamlessRenderRef): Promise<string> {
  return ensureCached(join(CACHE_DIR, `${id}__loop.ogg`), (out) => renderSeamless(out, ref));
}

/** Garantit le stem d'une voix en cache (clé stable par piste + canal). */
export function ensureChannelRender(id: string, chan: string, ref: SeamlessRenderRef): Promise<string> {
  return ensureCached(join(CACHE_DIR, `${id}__ch_${chan}.ogg`), (out) => renderSeamless(out, ref));
}
