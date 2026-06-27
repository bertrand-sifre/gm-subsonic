/**
 * API Subsonic MINIMALE (browse + play), montée sur `/rest/*` à côté de `/api/*`.
 * Objectif : qu'un client Subsonic (Symfonium, Feishin, DSub…) se connecte,
 * parcoure la bibliothèque et joue un morceau — la lecture réutilisant tel quel
 * notre pipeline de rendu via `resolveStream`. On n'implémente que le strict
 * nécessaire ; les verbes manquants renvoient une erreur Subsonic propre.
 *
 * Auth : acceptée telle quelle (serveur local mono-utilisateur) — stub assumé.
 */

import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Track } from '@vdm/shared';
import type { ScanResult } from '../../library/types.js';
import { resolveStream } from '../../stream.js';
import { serveFile } from '../serve-file.js';
import { albumDuration, buildCatalog, type SubAlbum, type SubArtist, type SubCatalog } from './catalog.js';
import { failed, ok, type SNode } from './respond.js';

// PNG 1×1 transparent : pochette par défaut (les clients tolèrent l'absence,
// mais en servir une évite des requêtes en erreur).
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

// Conteneur « vide mais bien formé » (tableaux présents) pour les verbes de
// favoris non gérés : le client itère sur des tableaux vides sans planter.
const EMPTY_LIBRARY: SNode = { lists: { artist: [], album: [], song: [] } };

export function mountSubsonic(app: Hono, scan: ScanResult): void {
  const catalog = buildCatalog(scan);
  // Les clients suffixent les verbes par `.view` (ex. `/rest/ping.view`).
  app.get('/rest/:verb', (c) => handle(c, scan, catalog, c.req.param('verb').replace(/\.view$/, '')));
}

function handle(c: Context, scan: ScanResult, catalog: SubCatalog, verb: string): Response | Promise<Response> {
  switch (verb) {
    case 'ping':
      return ok(c);
    case 'getLicense':
      return ok(c, 'license', { attrs: { valid: true } });
    case 'getMusicFolders':
      return ok(c, 'musicFolders', { lists: { musicFolder: [{ attrs: { id: 0, name: 'VDM' } }] } });
    case 'getArtists':
      return ok(c, 'artists', artistsNode(catalog));
    case 'getArtist':
      return getArtist(c, catalog);
    case 'getAlbum':
      return getAlbum(c, catalog);
    case 'getAlbumList2':
    case 'getAlbumList':
      return ok(c, verb === 'getAlbumList' ? 'albumList' : 'albumList2', {
        lists: { album: catalog.albums.map(albumNode) },
      });
    case 'getCoverArt':
      return coverArt(c);
    case 'getAlbumInfo2':
    case 'getAlbumInfo':
      // Métadonnées étendues (notes, pochettes externes) : tous champs
      // optionnels -> on renvoie un albumInfo vide. Sans ça, le client lève une
      // exception (appel en // de getAlbum) et n'affiche pas les pistes.
      return ok(c, 'albumInfo', {});
    case 'getArtistInfo2':
    case 'getArtistInfo':
      // Équivalent côté artiste (biographie, artistes similaires) : vide.
      return ok(c, verb === 'getArtistInfo' ? 'artistInfo' : 'artistInfo2', {
        lists: { similarArtist: [] },
      });
    case 'scrobble':
      // Historique d'écoute : on accuse réception sans rien stocker.
      return ok(c);
    case 'getStarred2':
      return ok(c, 'starred2', EMPTY_LIBRARY);
    case 'getStarred':
      return ok(c, 'starred', EMPTY_LIBRARY);
    case 'getPlaylists':
      return ok(c, 'playlists', { lists: { playlist: [] } });
    case 'stream':
      return stream(c, scan);
    default:
      return failed(c, 0, `méthode non gérée : ${verb}`);
  }
}

// ---- Constructeurs de nœuds ------------------------------------------------

function artistNode(a: SubArtist): SNode {
  return { attrs: { id: a.id, name: a.name, albumCount: a.albums.length, coverArt: a.id } };
}

function albumNode(al: SubAlbum): SNode {
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

function songNode(t: Track, al: SubAlbum): SNode {
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
function artistsNode(catalog: SubCatalog): SNode {
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

// ---- Handlers paramétrés ---------------------------------------------------

function getArtist(c: Context, catalog: SubCatalog): Response {
  const id = c.req.query('id');
  const artist = id ? catalog.artistById.get(id) : undefined;
  if (!artist) return failed(c, 70, 'artiste introuvable');
  return ok(c, 'artist', {
    attrs: { id: artist.id, name: artist.name, albumCount: artist.albums.length, coverArt: artist.id },
    lists: { album: artist.albums.map(albumNode) },
  });
}

function getAlbum(c: Context, catalog: SubCatalog): Response {
  const id = c.req.query('id');
  const album = id ? catalog.albumById.get(id) : undefined;
  if (!album) return failed(c, 70, 'album introuvable');
  return ok(c, 'album', {
    attrs: {
      id: album.id,
      name: album.name,
      artist: album.artist,
      artistId: album.artistId,
      songCount: album.tracks.length,
      duration: albumDuration(album),
      coverArt: album.id,
    },
    lists: { song: album.tracks.map((t) => songNode(t, album)) },
  });
}

async function stream(c: Context, scan: ScanResult): Promise<Response> {
  const id = c.req.query('id');
  if (!id) return failed(c, 10, 'paramètre requis manquant : id');
  try {
    const path = await resolveStream(scan, id);
    if (!path) return failed(c, 70, 'morceau introuvable');
    return serveFile(c, path);
  } catch (err) {
    console.error(`[subsonic] stream échoué (${id}) :`, err);
    return failed(c, 0, 'échec du rendu');
  }
}

function coverArt(c: Context): Response {
  const bytes = Buffer.from(PLACEHOLDER_PNG, 'base64');
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return c.body(ab, 200, { 'Content-Type': 'image/png' });
}
