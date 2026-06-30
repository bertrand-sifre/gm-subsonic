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

/** Script de catalogage (`npm run library:import`) lancé par l'import à la demande. */
export const IMPORT_SCRIPT = join(ROOT, 'tools/import-library.mjs');
/** Réglages applicatifs persistés (toggle de surveillance) — dans `media/` (volume monté). */
export const SETTINGS_FILE = join(MEDIA_DIR, 'app-settings.json');

/**
 * Surveillance du dossier `library/` PAR SCRUTATION (polling) : les évènements
 * inotify ne traversent pas les bind-mounts Docker sur macOS (raison du
 * `CHOKIDAR_USEPOLLING` côté Vite) — on scrute donc le dossier à intervalle.
 */
const rawWatchInterval = Number(process.env.VDM_WATCH_INTERVAL ?? 3000);
// Plancher de 500 ms ; une valeur non numérique (ex. `3s`) → NaN, on retombe sur 3000
// (sinon `Math.max(500, NaN) === NaN` annulerait le plancher → scrutation en rafale).
export const WATCH_INTERVAL_MS = Number.isFinite(rawWatchInterval) ? Math.max(500, rawWatchInterval) : 3000;
/** Surveillance active au démarrage en l'absence de réglage persisté (`VDM_WATCH=1`). */
export const WATCH_DEFAULT = process.env.VDM_WATCH === '1';

/**
 * Extensions de sources émulées déposées dans `library/` (miroir de `VGM_EXT` de
 * `tools/import-library.mjs`) : seules celles-ci déclenchent un ré-import. Évite
 * les faux positifs (`.DS_Store`, `README.md`, `.gitkeep`).
 */
export const SOURCE_EXTENSIONS = new Set([
  '.nsf', '.nsfe', '.spc', '.vgm', '.vgz', '.gbs', '.gym', '.ay', '.hes', '.kss',
]);

/** Garde-fou de taille pour un fichier déposé (upload) — les sources chiptune font des Ko. */
export const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.VDM_MAX_UPLOAD_MB) || 64) * 1024 * 1024;
/**
 * Plafond du CORPS d'un upload (toutes parties confondues), appliqué AVANT le parsing
 * multipart (`bodyLimit`) — sinon `formData()` bufferiserait tout en RAM avant le moindre
 * contrôle, ouvrant un OOM. Borne donc la taille totale ET le nombre de fichiers de fait.
 */
export const MAX_UPLOAD_TOTAL_BYTES = Math.max(1, Number(process.env.VDM_MAX_UPLOAD_TOTAL_MB) || 256) * 1024 * 1024;
/**
 * SPA Svelte buildé (`vite build`). Servi par le serveur UNIQUEMENT s'il existe
 * (image de production « tout-en-un ») ; absent en dev, où Vite sert le front et
 * proxifie `/api`. cf. `http/routes.ts` (montage conditionnel + fallback SPA).
 */
export const WEB_DIR = join(ROOT, 'apps/web/dist');

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
