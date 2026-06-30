/**
 * Réglages applicatifs PERSISTÉS (petit JSON dans `media/`, à côté des manifestes).
 * Pour l'instant un seul réglage : la surveillance du dossier `library/`. Le fichier
 * est optionnel — au premier démarrage on retombe sur le défaut (`WATCH_DEFAULT`).
 *
 * Lecture/écriture tolérantes : un fichier absent ou corrompu n'empêche jamais le
 * serveur de démarrer (on repart des défauts).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { SETTINGS_FILE, WATCH_DEFAULT } from './config.js';

export interface AppSettings {
  /** Le dossier `library/` est-il surveillé (auto-import à chaque changement) ? */
  watchLibrary: boolean;
}

function defaults(): AppSettings {
  return { watchLibrary: WATCH_DEFAULT };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as Partial<AppSettings>;
    return { ...defaults(), ...raw, watchLibrary: Boolean(raw.watchLibrary ?? WATCH_DEFAULT) };
  } catch {
    // Fichier absent (premier run) ou illisible : on part des défauts, sans bruit.
    return defaults();
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[vdm] échec de l’écriture des réglages :', err);
  }
}
