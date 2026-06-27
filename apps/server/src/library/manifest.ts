import { readFile } from 'node:fs/promises';
import type { MetaFile, MetaTrack } from './types.js';

/** Lit un manifeste de morceaux ; renvoie [] s'il est absent ou illisible. */
export async function readManifest(path: string): Promise<MetaTrack[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return (JSON.parse(raw) as MetaFile).tracks ?? [];
  } catch {
    return [];
  }
}
