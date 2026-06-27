/** Verbes « albums » (= jeux) + listes. getAlbumInfo(2) : métadonnées vides. */

import { ERR } from '../errors.js';
import { albumNode, songNode } from '../nodes.js';
import { failed, ok } from '../respond.js';
import type { VerbMap } from '../types.js';

export const albumVerbs: VerbMap = {
  getAlbum: {
    requires: ['id'],
    handle: (c, { catalog }) => {
      const album = catalog.albumById.get(c.req.query('id')!);
      if (!album) return failed(c, ERR.NOT_FOUND, 'album introuvable');
      return ok(c, 'album', {
        ...albumNode(album),
        lists: { song: album.tracks.map((t) => songNode(t, album)) },
      });
    },
  },
  // Listes d'albums : on ignore type/size/offset (MVP) -> tous les albums.
  getAlbumList2: {
    handle: (c, { catalog }) => ok(c, 'albumList2', { lists: { album: catalog.albums.map(albumNode) } }),
  },
  getAlbumList: {
    handle: (c, { catalog }) => ok(c, 'albumList', { lists: { album: catalog.albums.map(albumNode) } }),
  },
  // Métadonnées étendues (notes, pochettes externes) : vides mais valides — sans
  // ça le client lève une exception (appel en // de getAlbum) et masque les pistes.
  getAlbumInfo2: { handle: (c) => ok(c, 'albumInfo', {}) },
  getAlbumInfo: { handle: (c) => ok(c, 'albumInfo', {}) },
};
