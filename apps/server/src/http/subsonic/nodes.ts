/**
 * Constructeurs de nœuds `SNode` (cf. respond.ts) à partir des entités du
 * catalogue. Partagés par les verbes artistes/albums — d'où un fichier dédié.
 */

import type { Track } from '@vdm/shared';
import { albumDuration, type SubAlbum, type SubArtist, type SubCatalog } from './catalog.js';
import type { SNode } from './respond.js';

/** Conteneur « vide mais bien formé » (tableaux présents) pour les favoris. */
export const EMPTY_LIBRARY: SNode = { lists: { artist: [], album: [], song: [] } };

export function artistNode(a: SubArtist): SNode {
  return { attrs: { id: a.id, name: a.name, albumCount: a.albums.length, coverArt: a.id } };
}

export function albumNode(al: SubAlbum): SNode {
  return {
    attrs: {
      id: al.id,
      name: al.name,
      artist: al.artist,
      artistId: al.artistId,
      songCount: al.tracks.length,
      duration: albumDuration(al),
      coverArt: al.id,
    },
  };
}

export function songNode(t: Track, al: SubAlbum): SNode {
  return {
    attrs: {
      id: t.id,
      parent: al.id,
      isDir: false,
      title: t.title,
      album: al.name,
      artist: al.artist,
      duration: Math.round(t.duration || 0),
      coverArt: al.id,
      suffix: 'ogg',
      contentType: 'audio/ogg',
      type: 'music',
    },
  };
}

/** `<artists>` : artistes groupés par initiale (index). */
export function artistsNode(catalog: SubCatalog): SNode {
  const byLetter = new Map<string, SubArtist[]>();
  for (const a of catalog.artists) {
    const letter = (a.name[0] || '#').toUpperCase();
    const list = byLetter.get(letter) ?? [];
    list.push(a);
    byLetter.set(letter, list);
  }
  const index: SNode[] = [...byLetter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ attrs: { name }, lists: { artist: list.map(artistNode) } }));
  return { attrs: { ignoredArticles: '' }, lists: { index } };
}
