/**
 * Construit la bibliothèque en mémoire à partir des manifestes (`meta.json` +
 * `library.generated.json`). Chaque entrée passe par le PREMIER builder qui la
 * `match` (émulé prioritaire, puis statique en repli) ; les refs de rendu sont
 * accumulées dans le contexte. Les morceaux sont ensuite regroupés par jeu.
 */

import { join } from 'node:path';
import type { GameGroup, Track } from '@vdm/shared';
import { emulatedBuilder } from './builders/emulated.js';
import { staticBuilder } from './builders/static.js';
import { readManifest } from './manifest.js';
import type { BuildContext, ScanResult, TrackBuilder } from './types.js';

/** Registry des stratégies de construction (ordre = priorité). */
const BUILDERS: TrackBuilder[] = [emulatedBuilder, staticBuilder];

/**
 * @param mediaDir   dossier des fichiers servis statiquement + manifestes
 * @param libraryDir dossier des sources émulées (NSF/NSFe/SPC…)
 */
export async function scanLibrary(mediaDir: string, libraryDir: string): Promise<ScanResult> {
  const entries = [
    ...(await readManifest(join(mediaDir, 'meta.json'))),
    ...(await readManifest(join(mediaDir, 'library.generated.json'))),
  ];

  const ctx: BuildContext = {
    mediaDir,
    libraryDir,
    files: new Map(),
    renders: new Map(),
    loops: new Map(),
    channelRenders: new Map(),
  };

  const tracks: Track[] = [];
  for (const entry of entries) {
    const builder = BUILDERS.find((b) => b.match(entry));
    if (!builder) {
      // Entrée dégénérée (ni fichier statique ni source émulée) : on la trace
      // au lieu de la perdre en silence (l'ancien code plantait ici).
      console.warn(`[library] entrée ignorée (ni fichier ni source) : ${entry.title}`);
      continue;
    }
    const track = await builder.build(entry, ctx);
    if (track) tracks.push(track);
  }

  // Regroupement par jeu (concept d'organisation central du produit).
  const byGame = new Map<string, Track[]>();
  for (const track of tracks) {
    const list = byGame.get(track.game) ?? [];
    list.push(track);
    byGame.set(track.game, list);
  }
  const games: GameGroup[] = [...byGame.entries()].map(([game, list]) => ({ game, tracks: list }));

  return {
    library: { games },
    files: ctx.files,
    renders: ctx.renders,
    loops: ctx.loops,
    channelRenders: ctx.channelRenders,
  };
}
