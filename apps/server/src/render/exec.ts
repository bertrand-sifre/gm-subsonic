/**
 * Exécution d'une commande externe (ffmpeg, nsftool). Unique wrapper de spawn :
 * on ignore stdin/stdout, on capture stderr et on rejette avec un message
 * lisible (nom de commande + code + stderr) en cas d'échec.
 */

import { spawn } from 'node:child_process';

export function exec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} (code ${code}) : ${stderr.trim()}`))
    );
  });
}
