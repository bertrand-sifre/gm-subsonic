/** Verbes média : streaming (réutilise notre pipeline de rendu) + pochette. */

import { resolveStream } from '../../../stream.js';
import { serveFile } from '../../serve-file.js';
import { ERR } from '../errors.js';
import { failed } from '../respond.js';
import type { VerbMap } from '../types.js';

// PNG 1×1 transparent : pochette par défaut (les clients tolèrent l'absence,
// mais en servir une évite des requêtes en erreur).
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

export const mediaVerbs: VerbMap = {
  stream: {
    requires: ['id'],
    handle: async (c, { scan }) => {
      const id = c.req.query('id')!;
      try {
        const path = await resolveStream(scan, id);
        if (!path) return failed(c, ERR.NOT_FOUND, 'morceau introuvable');
        return serveFile(c, path);
      } catch (err) {
        console.error(`[subsonic] stream échoué (${id}) :`, err);
        return failed(c, ERR.GENERIC, 'échec du rendu');
      }
    },
  },
  getCoverArt: {
    handle: (c) => {
      const bytes = Buffer.from(PLACEHOLDER_PNG, 'base64');
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return c.body(ab, 200, { 'Content-Type': 'image/png' });
    },
  },
};
