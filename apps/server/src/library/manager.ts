/**
 * Gestionnaire de bibliothèque VIVANT : détient le `ScanResult` courant et sait le
 * RECONSTRUIRE à la demande (bouton « Importer ») ou automatiquement (surveillance
 * du dossier `library/`). Un re-scan = lancer l'import (régénère le manifeste) puis
 * re-scanner en mémoire, et enfin ÉCHANGER atomiquement le scan courant.
 *
 * Pourquoi un gestionnaire mutable ? À l'origine `createApp(scan)` figeait le scan
 * au démarrage. Ici les routes et l'API Subsonic lisent `manager.current` à chaque
 * requête (et le catalogue Subsonic est reconstruit via `onChange`), si bien qu'un
 * import met à jour la bibliothèque SANS redémarrage.
 *
 * Sûreté : les re-scans sont SÉRIALISÉS (une file via chaînage de promesses) — jamais
 * deux imports concurrents (les caches de `import-library.mjs` ne le supporteraient
 * pas), et le swap de `current` est atomique (les rendus en vol gardent leurs refs ;
 * le cache OGG disque survit au swap).
 */

import type { ImportRecord, LibraryStatus } from '@vdm/shared';
import { LIBRARY_DIR, MEDIA_DIR, SOURCE_EXTENSIONS, WATCH_INTERVAL_MS } from '../config.js';
import { loadSettings, saveSettings } from '../settings.js';
import { runImport } from './import.js';
import { scanLibrary } from './scan.js';
import type { ScanResult } from './types.js';
import { watchFolder, type FolderWatcher } from './watcher.js';

export type RescanTrigger = ImportRecord['trigger'];

export class LibraryManager {
  /** Scan courant — lu par les routes et l'API Subsonic à chaque requête. */
  current: ScanResult;

  private readonly listeners: Array<(s: ScanResult) => void> = [];
  /** File de sérialisation des re-scans (chaînage). */
  private chain: Promise<unknown> = Promise.resolve();
  /** Nombre de re-scans en cours ou en attente (→ `importing`). */
  private pending = 0;
  private watcher: FolderWatcher | null = null;
  private watchingState = false;
  /** File de sérialisation des écritures de réglages (évite writes concurrents). */
  private saveChain: Promise<unknown> = Promise.resolve();
  private lastImport: ImportRecord | null = null;

  constructor(initial: ScanResult) {
    this.current = initial;
  }

  get watching(): boolean {
    return this.watchingState;
  }

  get importing(): boolean {
    return this.pending > 0;
  }

  /** S'abonner aux échanges de scan (l'API Subsonic reconstruit son catalogue). */
  onChange(fn: (s: ScanResult) => void): void {
    this.listeners.push(fn);
  }

  /** Charge le réglage persisté et démarre la surveillance si elle était activée. */
  async init(): Promise<void> {
    const settings = await loadSettings();
    if (settings.watchLibrary) this.startWatch();
  }

  /**
   * Relance import + re-scan. Les appels sont mis EN FILE : un seul re-scan tourne
   * à la fois ; les suivants attendent la fin du précédent (chacun refait son propre
   * import, incrémental donc bon marché). Renvoie le compte rendu de CE re-scan.
   */
  rescan(trigger: RescanTrigger): Promise<ImportRecord> {
    this.pending += 1;
    const run = (): Promise<ImportRecord> => this.doRescan(trigger);
    const next = this.chain.then(run, run).finally(() => {
      this.pending -= 1;
    });
    // La file ne doit jamais rejeter (sinon les re-scans suivants seraient ignorés).
    this.chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async doRescan(trigger: RescanTrigger): Promise<ImportRecord> {
    const start = Date.now();
    const imp = await runImport();

    let scanOk = true;
    let scanError: string | undefined;
    try {
      const next = await scanLibrary(MEDIA_DIR, LIBRARY_DIR);
      this.current = next; // swap atomique
      for (const fn of this.listeners) fn(next);
    } catch (err) {
      scanOk = false;
      scanError = `re-scan échoué : ${String(err)}`;
      console.error('[vdm] re-scan échoué :', err);
    }

    const record: ImportRecord = {
      at: Date.now(),
      ok: imp.ok && scanOk,
      durationMs: Date.now() - start,
      trigger,
      summary: imp.summary,
      error: imp.error ?? scanError,
    };
    this.lastImport = record;
    const count = this.current.library.games.reduce((n, g) => n + g.tracks.length, 0);
    console.log(
      `[vdm] import (${trigger}) ${record.ok ? 'OK' : 'ÉCHEC'} en ${record.durationMs} ms — ${count} morceau(x)`
    );
    return record;
  }

  /** Active/désactive la surveillance et PERSISTE le choix. */
  async setWatching(on: boolean): Promise<void> {
    if (on) this.startWatch();
    else this.stopWatch();
    // On persiste l'ÉTAT RÉEL courant (pas l'argument `on`) et on sérialise les
    // écritures : sur deux PUT quasi simultanés, le fichier reflète l'état mémoire
    // final (la dernière intention) et jamais un fichier corrompu par writes concurrents.
    this.saveChain = this.saveChain.then(() => saveSettings({ watchLibrary: this.watchingState }));
    await this.saveChain;
  }

  private startWatch(): void {
    if (this.watcher) return;
    this.watcher = watchFolder(LIBRARY_DIR, SOURCE_EXTENSIONS, WATCH_INTERVAL_MS, () => {
      void this.rescan('watch');
    });
    this.watchingState = true;
  }

  private stopWatch(): void {
    this.watcher?.stop();
    this.watcher = null;
    this.watchingState = false;
  }

  status(): LibraryStatus {
    return {
      watching: this.watchingState,
      watchInterval: WATCH_INTERVAL_MS,
      importing: this.importing,
      games: this.current.library.games.length,
      tracks: this.current.library.games.reduce((n, g) => n + g.tracks.length, 0),
      lastImport: this.lastImport,
    };
  }
}
