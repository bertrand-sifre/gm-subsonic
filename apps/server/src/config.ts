/**
 * Configuration centrale du serveur : chemins, port, garde-fous de rendu,
 * binaire nsftool, types MIME. Aucune dépendance — tout le reste en dépend.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/server/src -> racine du dépôt
export const ROOT = join(__dirname, '../../..');
export const MEDIA_DIR = join(ROOT, 'media');
export const LIBRARY_DIR = join(ROOT, 'library');
export const CACHE_DIR = join(MEDIA_DIR, '_cache'); // OGG rendus à la demande

export const PORT = Number(process.env.PORT ?? 8787);

/** Fréquence d'échantillonnage de référence (tous les rendus sont à 44.1 kHz). */
export const SAMPLE_RATE = 44100;

// Garde-fous du rendu paramétrable.
export const MAX_SECONDS = 900;
export const MAX_FADE = 30;

/** CLI maison (cœur xgm de nsfplay) ; surchargeable pour les tests/CI. */
export const NSFTOOL = process.env.VDM_NSFPLAY ?? 'nsftool';

/** CLI gdm (libgme) pour le format GBS : probe + render par canal. Surchargeable (tests/CI). */
export const GDM = process.env.VDM_GDM ?? 'gdm';

export const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
};
