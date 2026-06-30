/**
 * Surveillance d'un dossier PAR SCRUTATION (polling), sans dépendance externe.
 *
 * Pourquoi pas `fs.watch` ? Les évènements inotify ne traversent pas de façon
 * fiable les bind-mounts Docker sur macOS (c'est précisément pourquoi Vite tourne
 * en `usePolling`). On scrute donc le dossier à intervalle régulier et on compare
 * une EMPREINTE (nom → mtime:taille) des fichiers pertinents.
 *
 * Anti-rebond intégré : un changement doit rester STABLE sur deux scrutations
 * consécutives avant de déclencher `onChange` — on évite ainsi de ré-importer au
 * milieu de la copie d'un gros fichier.
 */

import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

export interface FolderWatcher {
  stop(): void;
}

/**
 * @param dir       dossier scruté (top-level uniquement, comme l'import)
 * @param exts      extensions retenues (les autres fichiers sont ignorés)
 * @param intervalMs période de scrutation
 * @param onChange  appelé (sans await) à chaque changement stabilisé
 */
export function watchFolder(
  dir: string,
  exts: Set<string>,
  intervalMs: number,
  onChange: () => void
): FolderWatcher {
  /** Empreinte du dossier : signature triée des entrées pertinentes. */
  async function signature(): Promise<string> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return ''; // dossier absent : empreinte vide (réapparition gérée nativement)
    }
    const parts: string[] = [];
    for (const name of names.sort()) {
      if (!exts.has(extname(name).toLowerCase())) continue;
      try {
        const s = await stat(join(dir, name));
        parts.push(`${name}:${s.mtimeMs}:${s.size}`);
      } catch {
        /* fichier disparu entre readdir et stat : ignoré */
      }
    }
    return parts.join('|');
  }

  let committed: string | null = null; // dernière empreinte « actée »
  let pending: string | null = null; // empreinte changée, en attente de stabilité
  let busy = false; // anti-recouvrement des scrutations lentes
  let stopped = false;

  async function tick(): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    try {
      const snap = await signature();
      // `signature()` est asynchrone (readdir/stat, lents en bind-mount) : la
      // surveillance a pu être coupée pendant l'attente — ne pas émettre après stop().
      if (stopped) return;
      if (committed === null) {
        // Première scrutation : on acte l'état initial sans déclencher (le scan de
        // démarrage l'a déjà pris en compte).
        committed = snap;
        return;
      }
      if (snap === committed) {
        pending = null; // revenu à l'état acté : on annule un changement transitoire
        return;
      }
      if (pending !== null && snap === pending) {
        // Stable depuis une scrutation : on acte et on déclenche.
        committed = snap;
        pending = null;
        onChange();
      } else {
        // Premier signe de changement (ou encore en mouvement) : on attend confirmation.
        pending = snap;
      }
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  // `unref` : ce timer ne doit pas, à lui seul, maintenir le process en vie.
  timer.unref?.();
  // Amorce immédiate pour fixer l'empreinte de base sans attendre un intervalle.
  void tick();

  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
