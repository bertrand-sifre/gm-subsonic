/** Verbes favoris / playlists : stubs vides (pas de persistance pour le MVP). */

import { EMPTY_LIBRARY } from '../nodes.js';
import { ok } from '../respond.js';
import type { VerbMap } from '../types.js';

export const favoriteVerbs: VerbMap = {
  getStarred2: { handle: (c) => ok(c, 'starred2', EMPTY_LIBRARY) },
  getStarred: { handle: (c) => ok(c, 'starred', EMPTY_LIBRARY) },
  getPlaylists: { handle: (c) => ok(c, 'playlists', { lists: { playlist: [] } }) },
};
