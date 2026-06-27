/** Verbes « artistes » (= compositeurs). getArtistInfo(2) : métadonnées vides. */

import { ERR } from '../errors.js';
import { albumNode, artistNode, artistsNode } from '../nodes.js';
import { failed, ok } from '../respond.js';
import type { VerbMap } from '../types.js';

export const artistVerbs: VerbMap = {
  getArtists: {
    handle: (c, { catalog }) => ok(c, 'artists', artistsNode(catalog)),
  },
  getArtist: {
    requires: ['id'],
    handle: (c, { catalog }) => {
      const artist = catalog.artistById.get(c.req.query('id')!);
      if (!artist) return failed(c, ERR.NOT_FOUND, 'artiste introuvable');
      return ok(c, 'artist', { ...artistNode(artist), lists: { album: artist.albums.map(albumNode) } });
    },
  },
  // Métadonnées étendues (biographie, artistes similaires) : vides mais valides.
  getArtistInfo2: { handle: (c) => ok(c, 'artistInfo2', { lists: { similarArtist: [] } }) },
  getArtistInfo: { handle: (c) => ok(c, 'artistInfo', { lists: { similarArtist: [] } }) },
};
