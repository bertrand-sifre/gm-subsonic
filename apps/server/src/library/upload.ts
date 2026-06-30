/**
 * Écriture des fichiers DÉPOSÉS (upload) dans `library/`, avant import.
 *
 * Chaque fichier est validé : nom assaini (basename seul → AUCUNE traversée de
 * chemin), extension de source connue (`SOURCE_EXTENSIONS`), taille bornée
 * (`MAX_UPLOAD_BYTES`). Les fichiers conformes sont écrits ; les autres sont
 * signalés (`rejected`) sans interrompre les suivants. Un même nom écrase
 * l'existant (mise à jour ; l'import est idempotent/incrémental par mtime).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { UploadOutcome } from '@vdm/shared';
import { LIBRARY_DIR, MAX_UPLOAD_BYTES, SOURCE_EXTENSIONS } from '../config.js';

export async function saveUploads(files: File[]): Promise<UploadOutcome> {
  await mkdir(LIBRARY_DIR, { recursive: true });
  const accepted: string[] = [];
  const rejected: { name: string; reason: string }[] = [];

  for (const file of files) {
    const original = file.name ?? '';
    // basename → on neutralise tout composant de chemin (../, sous-dossier, absolu).
    const name = basename(original).trim();
    if (!name || name.startsWith('.')) {
      rejected.push({ name: original || '(sans nom)', reason: 'nom de fichier invalide' });
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(extname(name).toLowerCase())) {
      rejected.push({ name, reason: 'extension non prise en charge' });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name, reason: `trop volumineux (> ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} Mo)` });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(join(LIBRARY_DIR, name), buf);
      accepted.push(name);
    } catch (err) {
      rejected.push({ name, reason: `échec d'écriture : ${String(err)}` });
    }
  }

  return { accepted, rejected };
}
