/**
 * Résolution d'un id de morceau vers le CHEMIN d'un fichier servable, partagée
 * par l'API maison (`/api/stream`) et l'API Subsonic (`/rest/stream`) — les deux
 * systèmes streament donc EXACTEMENT la même chose. Précédence :
 *  - statique : le fichier tel quel ;
 *  - émulé bouclé + aucun paramètre : artefact de boucle (rendu à la demande) ;
 *  - émulé : OGG paramétrique (durée/fondu, défauts de la source).
 *
 * Renvoie `null` si l'id est inconnu ; peut throw si un rendu paramétrique échoue
 * (l'échec du rendu de boucle, lui, est rattrapé → repli paramétrique).
 */

import { MAX_FADE, MAX_SECONDS } from './config.js';
import type { ScanResult } from './library/types.js';
import { ensureLoopRender, ensureParametricRender } from './render/index.js';

export async function resolveStream(
  scan: ScanResult,
  id: string,
  secondsRaw?: string,
  fadeRaw?: string
): Promise<string | null> {
  const staticPath = scan.files.get(id);
  if (staticPath) return staticPath;

  const loopRef = scan.loops.get(id);
  if (loopRef && secondsRaw == null && fadeRaw == null) {
    try {
      return await ensureLoopRender(id, loopRef);
    } catch (err) {
      console.error(`[vdm] rendu boucle échoué (${id}), repli paramétrique :`, err);
    }
  }

  const ref = scan.renders.get(id);
  if (ref) {
    const seconds = clamp(finiteOr(secondsRaw, ref.defaultSeconds), 1, MAX_SECONDS);
    const fade = clamp(finiteOr(fadeRaw, ref.defaultFade), 0, MAX_FADE);
    return ensureParametricRender(id, ref, Math.round(seconds), round1(fade));
  }

  return null;
}

function finiteOr(raw: string | undefined, fallback: number): number {
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
