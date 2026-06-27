/**
 * Adaptateur du modèle maison (bibliothèque regroupée par JEU) vers le modèle
 * Subsonic (ARTISTE → ALBUM → CHANSON). Mapping minimal :
 *  - artiste = compositeur (repli plateforme, puis « Divers ») ;
 *  - album   = jeu ;
 *  - chanson = morceau (l'id Subsonic d'une chanson EST notre id de morceau, donc
 *    `stream` le résout directement via `resolveStream`).
 *
 * Construit une fois au démarrage à partir du `ScanResult` (déjà en mémoire).
 */

import type { Track } from '@vdm/shared';
import type { ScanResult } from '../../library/types.js';

export interface SubAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  tracks: Track[];
}

export interface SubArtist {
  id: string;
  name: string;
  albums: SubAlbum[];
}

export interface SubCatalog {
  artists: SubArtist[];
  albums: SubAlbum[];
  albumById: Map<string, SubAlbum>;
  artistById: Map<string, SubArtist>;
}

/** Slug d'id Subsonic (sans retrait d'extension : noms de jeux/compositeurs). */
function idSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'x'
  );
}

export function buildCatalog(scan: ScanResult): SubCatalog {
  const albums: SubAlbum[] = [];
  const albumById = new Map<string, SubAlbum>();
  const artistById = new Map<string, SubArtist>();

  for (const group of scan.library.games) {
    const composer =
      group.tracks.find((t) => t.composer)?.composer ??
      group.tracks.find((t) => t.platform)?.platform ??
      'Divers';
    const artistId = `ar-${idSlug(composer)}`;
    const albumId = `al-${idSlug(group.game)}`;

    const album: SubAlbum = { id: albumId, name: group.game, artist: composer, artistId, tracks: group.tracks };
    albums.push(album);
    albumById.set(albumId, album);

    let artist = artistById.get(artistId);
    if (!artist) {
      artist = { id: artistId, name: composer, albums: [] };
      artistById.set(artistId, artist);
    }
    artist.albums.push(album);
  }

  const artists = [...artistById.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { artists, albums, albumById, artistById };
}

/** Durée totale d'un album (somme arrondie des morceaux). */
export function albumDuration(album: SubAlbum): number {
  return Math.round(album.tracks.reduce((s, t) => s + (t.duration || 0), 0));
}
