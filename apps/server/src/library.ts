import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { GameGroup, Library, Track } from '@vdm/shared';

/**
 * Description brute d'un morceau telle qu'on la trouve dans `media/meta.json`.
 * Pour le MVP on ne formalise pas davantage : un simple manifeste plat suffit.
 */
interface MetaTrack {
  file: string;
  title: string;
  game: string;
  composer?: string;
  platform?: string;
  loopStart?: number;
  loopEnd?: number;
}

interface MetaFile {
  tracks: MetaTrack[];
}

export interface ScanResult {
  library: Library;
  /** id du morceau -> chemin absolu du fichier audio. */
  files: Map<string, string>;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Scanne le dossier média et construit la bibliothèque en mémoire.
 * La durée réelle est lue dans l'en-tête du fichier audio ; les points de
 * boucle proviennent du manifeste (faute de tags fiables sur le WAV de test).
 */
export async function scanLibrary(mediaDir: string): Promise<ScanResult> {
  const metaRaw = await readFile(join(mediaDir, 'meta.json'), 'utf8');
  const meta = JSON.parse(metaRaw) as MetaFile;

  const tracks: Track[] = [];
  const files = new Map<string, string>();

  for (const entry of meta.tracks) {
    const filePath = join(mediaDir, entry.file);
    try {
      await stat(filePath);
    } catch {
      console.warn(`[library] fichier introuvable, ignoré : ${entry.file}`);
      continue;
    }

    let duration = 0;
    try {
      const parsed = await parseFile(filePath, { duration: true });
      duration = parsed.format.duration ?? 0;
    } catch (err) {
      console.warn(`[library] métadonnées illisibles pour ${entry.file}:`, err);
    }

    const id = slugify(entry.file);
    const hasLoop =
      typeof entry.loopStart === 'number' &&
      typeof entry.loopEnd === 'number' &&
      entry.loopEnd > entry.loopStart;

    tracks.push({
      id,
      title: entry.title,
      game: entry.game,
      composer: entry.composer,
      platform: entry.platform,
      duration,
      loop: hasLoop
        ? { loopStart: entry.loopStart!, loopEnd: entry.loopEnd! }
        : undefined,
      streamUrl: `/api/stream/${id}`,
    });
    files.set(id, filePath);
  }

  // Regroupement par jeu (concept d'organisation central du produit).
  const byGame = new Map<string, Track[]>();
  for (const track of tracks) {
    const list = byGame.get(track.game) ?? [];
    list.push(track);
    byGame.set(track.game, list);
  }
  const games: GameGroup[] = [...byGame.entries()].map(([game, list]) => ({
    game,
    tracks: list,
  }));

  return { library: { games }, files };
}
