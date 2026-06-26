import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { scanLibrary, type ScanResult } from './library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/server/src -> racine du dépôt -> media/
const MEDIA_DIR = join(__dirname, '../../../media');
const PORT = Number(process.env.PORT ?? 8787);

const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
};

let scan: ScanResult;

const app = new Hono();
app.use('*', cors());

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/library', (c) => c.json(scan.library));

/**
 * Streaming d'un fichier audio avec support des requêtes Range (HTTP 206).
 * Le client Web Audio télécharge le fichier entier, mais Range reste utile
 * pour les lecteurs `<audio>` classiques et la future compat Subsonic.
 */
app.get('/api/stream/:id', async (c) => {
  const id = c.req.param('id');
  const filePath = scan.files.get(id);
  if (!filePath) return c.notFound();

  const { size } = await stat(filePath);
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = c.req.header('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    // Plage vide/illisible : non satisfiable.
    if (!match || (!match[1] && !match[2])) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }

    let start: number;
    let end: number;
    if (!match[1]) {
      // Suffix-range `bytes=-N` : les N derniers octets (clampé à 0).
      const suffix = Number(match[2]);
      if (suffix === 0) {
        return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      }
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
      // Borne de fin tronquée à size-1 (RFC 7233) plutôt que de renvoyer 416.
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }

    if (start >= size || start > end) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }

    const stream = createReadStream(filePath, { start, end });
    return c.body(Readable.toWeb(stream) as ReadableStream, 206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
    });
  }

  // Pas de Range : fichier entier. Readable.toWeb gère la backpressure
  // (lecture disque pilotée par le drainage du socket) et l'annulation.
  return c.body(Readable.toWeb(createReadStream(filePath)) as ReadableStream, 200, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  });
});

async function main() {
  scan = await scanLibrary(MEDIA_DIR);
  const count = scan.files.size;
  console.log(`[vdm] bibliothèque chargée : ${count} morceau(x), ${scan.library.games.length} jeu(x)`);
  serve({ fetch: app.fetch, port: PORT }, ({ port }) => {
    console.log(`[vdm] serveur en écoute sur http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('[vdm] échec du démarrage :', err);
  process.exit(1);
});
