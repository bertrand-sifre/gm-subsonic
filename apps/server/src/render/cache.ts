/**
 * Cache d'artefacts rendus + dédoublonnage des rendus concurrents.
 *
 * `ensureCached(outPath, produce)` : si l'artefact existe déjà (taille > 0) on
 * renvoie son chemin ; sinon on appelle `produce(outPath)` UNE SEULE FOIS, même
 * si plusieurs requêtes le demandent en même temps (map `inflight` indexée par
 * chemin). C'est le motif partagé par tous les rendus (paramétrique, boucle, voix).
 */

import { stat } from 'node:fs/promises';

const inflight = new Map<string, Promise<void>>();

export async function ensureCached(
  outPath: string,
  produce: (outPath: string) => Promise<void>
): Promise<string> {
  const existing = await stat(outPath).catch(() => null);
  if (existing && existing.size > 0) return outPath;

  let pending = inflight.get(outPath);
  if (!pending) {
    pending = produce(outPath).finally(() => inflight.delete(outPath));
    inflight.set(outPath, pending);
  }
  await pending;
  return outPath;
}
