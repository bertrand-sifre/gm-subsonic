/**
 * API publique du rendu à la demande. Trois entrées, toutes mises en cache et
 * dédoublonnées (cf. `cache.ts`) :
 *  - `ensureParametricRender` : durée + fondu choisis (moteur libgme) ;
 *  - `ensureLoopRender`       : artefact de boucle sans couture (mix, libgme) ;
 *  - `ensureChannelRender`    : stem d'une voix — SEAMLESS si la piste boucle,
 *    PARAMÉTRIQUE (durée bornée, joué une fois) si la piste est finie.
 *
 * Le moteur PCM est choisi par `engineFor(sourcePath, channelIndex)` : GBS → gdm
 * (mix *et* voix), sinon voix isolée → nsftool (NES), mix → libgme.
 */

import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { CACHE_DIR, SAMPLE_RATE } from '../config.js';
import type { ChannelRenderRef, ParametricChannelRef, RenderRef, SeamlessRenderRef } from '../library/types.js';
import { ensureCached } from './cache.js';
import { encodePlainOgg, encodeSeamlessOgg, LOOP_EPSILON_SAMPLES } from './encode.js';
import { gdmEngine } from './engines/gdm.js';
import { libgmeEngine, renderParametricOgg } from './engines/libgme.js';
import { nsftoolEngine } from './engines/nsftool.js';
import type { PcmEngine } from './engines/types.js';

/**
 * Choix du moteur PCM selon la SOURCE et le mode (mix vs voix isolée). GBS → gdm
 * (libgme natif : MIX *et* voix isolée via mute). Toute autre source garde
 * EXACTEMENT le dispatch d'origine : voix isolée → nsftool (NES), mix → libgme.
 * Le chemin NSF n'est jamais modifié.
 */
function engineFor(sourcePath: string, channelIndex?: number): PcmEngine {
  if (extname(sourcePath).toLowerCase() === '.gbs') return gdmEngine;
  return channelIndex != null ? nsftoolEngine : libgmeEngine;
}

/**
 * Rendu sans couture [intro + corps bouclable]. Le moteur PCM est choisi par la
 * présence de `channelIndex` (voix isolée nsftool vs mix libgme) ; on rend
 * [intro + boucle + ε] en WAV, puis on encode l'OGG bouclable + tags de boucle.
 */
async function renderSeamless(outPath: string, ref: SeamlessRenderRef): Promise<void> {
  const engine = engineFor(ref.sourcePath, ref.channelIndex);
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

/**
 * Rendu PARAMÉTRIQUE d'une voix isolée (piste FINIE, sans boucle) : on rend la
 * voix bornée à `seconds` (durée réelle mesurée) puis on encode un OGG SIMPLE
 * (fondu optionnel, pas de tags de boucle). Le lecteur la joue UNE FOIS.
 */
async function renderParametricChannel(outPath: string, ref: ParametricChannelRef): Promise<void> {
  const engine = engineFor(ref.sourcePath, ref.channelIndex);
  const endSample = Math.round(ref.seconds * SAMPLE_RATE);
  const wav = `${outPath}.tmp.wav`;
  try {
    await engine.renderWav(wav, {
      sourcePath: ref.sourcePath,
      trackIndex: ref.trackIndex,
      endSample,
      channelIndex: ref.channelIndex,
    });
    await encodePlainOgg(wav, outPath, ref.fade, ref.seconds);
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

/**
 * Signature des bornes de boucle, incluse dans la clé de cache : si la détection
 * change (loopStart/longueur), la clé change → re-rendu frais. Sinon un artefact
 * PÉRIMÉ (rendu avec d'anciennes bornes, donc d'une autre durée) serait resservi
 * et le lecteur boucle au bout du buffer, décalé de la barre.
 */
function loopSig(ref: SeamlessRenderRef): string {
  return `${ref.introSamples}_${ref.loopLengthSamples}`;
}

/** Garantit l'artefact de boucle en cache (clé = id + bornes de boucle). */
export function ensureLoopRender(id: string, ref: SeamlessRenderRef): Promise<string> {
  return ensureCached(join(CACHE_DIR, `${id}__loop_${loopSig(ref)}.ogg`), (out) => renderSeamless(out, ref));
}

/**
 * Garantit le stem d'une voix en cache. Deux modes selon le type de référence :
 *  - SEAMLESS (piste bouclée) : clé = id + canal + bornes de boucle ;
 *  - PARAMÉTRIQUE (piste finie) : clé = id + canal + durée + fondu.
 * On discrimine par la présence des bornes de boucle (`loopLengthSamples`).
 */
export function ensureChannelRender(id: string, chan: string, ref: ChannelRenderRef): Promise<string> {
  if ('loopLengthSamples' in ref) {
    return ensureCached(join(CACHE_DIR, `${id}__ch_${chan}__${loopSig(ref)}.ogg`), (out) => renderSeamless(out, ref));
  }
  const sig = `s${ref.seconds}__f${String(ref.fade).replace('.', 'p')}__c${ref.channelIndex}`;
  return ensureCached(join(CACHE_DIR, `${id}__ch_${chan}__${sig}.ogg`), (out) => renderParametricChannel(out, ref));
}
