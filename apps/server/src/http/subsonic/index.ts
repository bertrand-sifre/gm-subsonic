/**
 * API Subsonic MINIMALE (browse + play), montée sur `/rest/*` à côté de `/api/*`.
 * Les deux serveurs coexistent sur le même process.
 *
 * Les verbes ne sont PAS un `switch` : chacun est DÉCLARÉ (cf. `types.ts` : un
 * `Verb` = params requis + handler) et regroupé PAR RESSOURCE dans `verbs/`
 * (system, artists, albums, media, favorites). Le registre `VERBS` les agrège et
 * un dispatcher unique route `/rest/:verb`. Ajouter un verbe = une entrée dans le
 * fichier de sa ressource, rien d'autre.
 *
 * Forme externe FIGÉE (OpenSubsonic, clients tiers) — on ne touche pas à la
 * sérialisation (`respond.ts`). Auth : acceptée telle quelle (local, mono-user).
 */

import type { Hono } from 'hono';
import type { ScanResult } from '../../library/types.js';
import { buildCatalog } from './catalog.js';
import { ERR } from './errors.js';
import { failed } from './respond.js';
import type { VerbDeps, VerbMap } from './types.js';
import { albumVerbs } from './verbs/albums.js';
import { artistVerbs } from './verbs/artists.js';
import { favoriteVerbs } from './verbs/favorites.js';
import { mediaVerbs } from './verbs/media.js';
import { systemVerbs } from './verbs/system.js';

/** Registre agrégé (un fichier de `verbs/` par ressource). */
const VERBS: VerbMap = {
  ...systemVerbs,
  ...artistVerbs,
  ...albumVerbs,
  ...mediaVerbs,
  ...favoriteVerbs,
};

export function mountSubsonic(app: Hono, scan: ScanResult): void {
  const deps: VerbDeps = { scan, catalog: buildCatalog(scan) };

  // Dispatcher unique : strip `.view`, lookup déclaratif, contrôle des params
  // requis, puis délégation au handler du verbe. Verbe inconnu -> erreur propre.
  app.get('/rest/:verb', (c) => {
    const name = c.req.param('verb').replace(/\.view$/, '');
    const verb = VERBS[name];
    if (!verb) return failed(c, ERR.GENERIC, `méthode non gérée : ${name}`);
    for (const param of verb.requires ?? []) {
      if (c.req.query(param) == null) {
        return failed(c, ERR.MISSING_PARAM, `paramètre requis manquant : ${param}`);
      }
    }
    return verb.handle(c, deps);
  });
}
