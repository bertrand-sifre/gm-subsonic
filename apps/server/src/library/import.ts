/**
 * Exécute le script de catalogage `tools/import-library.mjs` (le même que
 * `npm run library:import`) : il (re)génère `media/library.generated.json` à partir
 * des sources de `library/`. On le lance dans un process Node enfant (le serveur
 * tourne sous tsx, mais `process.execPath` pointe sur Node, qui exécute le `.mjs`).
 *
 * L'import est INCRÉMENTAL (cache par mtime/size) : relancer sans nouveau fichier
 * est quasi gratuit. On en récupère la ligne de récapitulatif pour l'UI.
 */

import { spawn } from 'node:child_process';
import { IMPORT_SCRIPT, ROOT } from '../config.js';

export interface ImportResult {
  ok: boolean;
  /** Ligne « [catalogue] terminé : … » si présente. */
  summary?: string;
  /** Message d'erreur (code de sortie + dernières lignes stderr) si échec. */
  error?: string;
}

export function runImport(): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(process.execPath, [IMPORT_SCRIPT], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('error', (err) => {
      resolve({ ok: false, error: `lancement impossible : ${err.message}` });
    });

    child.on('close', (code) => {
      // Ligne de récap : la dernière contenant « terminé » (cf. import-library.mjs).
      const summary = stdout
        .split('\n')
        .filter((l) => l.includes('terminé'))
        .pop()
        ?.trim();
      if (code === 0) {
        resolve({ ok: true, summary });
      } else {
        const tail = (stderr || stdout).trim().split('\n').slice(-3).join(' ');
        resolve({ ok: false, summary, error: `import sorti en code ${code} : ${tail}` });
      }
    });
  });
}
