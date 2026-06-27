/**
 * Service d'un fichier sur disque avec support des requêtes Range (HTTP 206),
 * conforme RFC 7233 : borne de fin tronquée à `size-1` (pas de 416 superflu),
 * suffix-range `bytes=-N` géré, 416 seulement si la plage est réellement
 * invalide. On utilise `Readable.toWeb(createReadStream(...))` pour bénéficier de
 * la backpressure native (ne pas rebufferiser tout en mémoire).
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';
import { CONTENT_TYPES } from '../config.js';

export async function serveFile(c: Context, filePath: string): Promise<Response> {
  const { size } = await stat(filePath);
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = c.req.header('range');

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }

    let start: number;
    let end: number;
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (suffix === 0) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
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

  return c.body(Readable.toWeb(createReadStream(filePath)) as ReadableStream, 200, {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  });
}
