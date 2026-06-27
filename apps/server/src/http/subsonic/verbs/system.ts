/** Verbes système : connexion, licence, dossiers, scrobble. */

import { ok } from '../respond.js';
import type { VerbMap } from '../types.js';

export const systemVerbs: VerbMap = {
  ping: { handle: (c) => ok(c) },
  getLicense: { handle: (c) => ok(c, 'license', { attrs: { valid: true } }) },
  getMusicFolders: {
    handle: (c) => ok(c, 'musicFolders', { lists: { musicFolder: [{ attrs: { id: 0, name: 'VDM' } }] } }),
  },
  // Historique d'écoute : on accuse réception sans rien stocker.
  scrobble: { handle: (c) => ok(c) },
};
