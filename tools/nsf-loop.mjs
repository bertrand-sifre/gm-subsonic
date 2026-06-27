/**
 * tools/nsf-loop.mjs
 *
 * Détecteur de boucle UNIQUE pour la musique NES (NSF/NSFe), déterministe et
 * indépendant du taux de rendu. Source de vérité : l'AUTOCORRÉLATION du log de
 * registres APU produit par nsftool (`--log 1`).
 *
 * Pourquoi le log et pas `--detect` : le log de registres est ce que le CPU
 * 6502 écrit dans l'APU à chaque frame ; il est strictement périodique quand la
 * musique boucle (la séquence d'écritures se répète à l'identique), peu importe
 * la phase des oscillateurs ou le taux de rendu. On cherche donc la plus petite
 * période de frames qui « pave » exactement la queue du log. La valeur de
 * `--detect` (fausse / sensible au rate) n'est PAS utilisée : son rôle de
 * « oui/non » est couvert par l'autocorrélation, qui renvoie null si la piste
 * n'est pas périodique (→ repli paramétrique côté serveur).
 *
 * Logique portée trait pour trait de l'analyseur de référence empirique
 * (scratchpad/loopexact.py), validé sur SMB1/SMB3.
 *
 * Export : detectLoop({ sourcePath, trackIndex, nsftool, mediaDir, defaultSeconds })
 *   -> { startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null
 *
 * Usage CLI :  node tools/nsf-loop.mjs <source> <trackIndex> [defaultSeconds]
 */

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FPS = 60.0988; // taux de frame NTSC NSF (1789772.7 / 29780.5)
const SR = 44100; // taux du rendu serveur (pour convertir frames -> échantillons)
const LOG_RATE = 8000; // rendu rapide ; le log de registres est rate-indépendant
const LOG_LEN_MS = 200000; // 200 s : couvre toute boucle <= ~100 s avec marge >= 1 période
const PMIN_SEC = 1; // période minimale cherchée
const PMAX_SEC = 100; // période maximale cherchée
// Garde-fou anti faux-positif : un flux de registres constant/quasi-constant
// (note tenue, silence, SFX one-shot) « boucle » trivialement à PMIN. Une vraie
// boucle musicale a beaucoup de frames distinctes ; on rejette les périodes pauvres.
const MIN_DISTINCT_FRAMES = 8;
const SPAWN_TIMEOUT_MS = 30000; // garde-fou : tue nsftool si un fichier bloque

/**
 * Exécute une commande ; ne rejette jamais. Tue le process après un timeout
 * (protège le boot d'un fichier pathologique). Renvoie { code, stdout, stderr }.
 */
function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeoutMs
      ? setTimeout(() => { timedOut = true; c.kill('SIGKILL'); }, timeoutMs)
      : null;
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('error', (err) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }); });
    c.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout, stderr });
    });
  });
}

/**
 * Parse un log de registres (miroir exact de loadFrames de loopexact.py) :
 * ignore BEGIN/INIT ; chaque PLAY(...) ouvre une frame ; les WRITE(...) qui
 * suivent sont accumulés ; la collecte démarre à la 1re PLAY. Chaque frame est
 * internée (join des WRITE -> entier) pour des comparaisons entières rapides.
 *
 * @returns {{ H: Int32Array, N: number }}
 */
function parseLog(text) {
  const frames = [];
  let cur = [];
  let started = false;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('PLAY')) {
      if (started) frames.push(cur.join('\n'));
      cur = [];
      started = true;
    } else if (raw.startsWith('WRITE')) {
      cur.push(raw.trim());
    }
    // BEGIN / INIT / lignes vides : ignorés.
  }
  if (started) frames.push(cur.join('\n'));

  // Internement : chaque contenu de frame -> id entier via une Map.
  const ids = new Map();
  const N = frames.length;
  const H = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const key = frames[i];
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); }
    H[i] = id;
  }
  return { H, N };
}

/**
 * Autocorrélation exacte (port direct de analyze de loopexact.py).
 *  - tailrun(p) : nb de frames contiguës H[i]==H[i+p] depuis i=N-p-1 (descendant).
 *  - candidats : p in [round(1·FPS), min(N-round(2·FPS), round(100·FPS))) avec
 *    tailrun(p) >= p (au moins une période parfaite répétée).
 *  - fondamentaux : candidats qui ne sont multiples d'aucun candidat plus petit.
 *    p_star = plus petit fondamental. Aucun candidat -> null (non périodique).
 *  - loop_start : (dernier mismatch descendant depuis N-p_star-1) + 1.
 *
 * @returns {{ periodFrames: number, loopStartFrames: number } | null}
 */
function analyze(H, N) {
  // tailrun : la longueur de queue exactement répétée à la période p.
  const tailrun = (p) => {
    let i = N - p - 1;
    let r = 0;
    while (i >= 0 && H[i] === H[i + p]) { r++; i--; }
    return r;
  };

  const pmin = Math.round(PMIN_SEC * FPS);
  const pmax = Math.min(N - Math.round(2 * FPS), Math.round(PMAX_SEC * FPS));
  const cands = [];
  for (let p = pmin; p < pmax; p++) {
    if (tailrun(p) >= p) cands.push(p); // au moins une période entière se répète parfaitement
  }
  if (cands.length === 0) return null; // non proprement périodique <= 100 s -> repli paramétrique

  // Fondamentaux = candidats non multiples d'un candidat strictement plus petit.
  // (cands est déjà trié croissant ; on prend le plus petit fondamental.)
  let pStar = -1;
  for (const p of cands) {
    let isFundamental = true;
    for (const q of cands) {
      if (q < p && p % q === 0) { isFundamental = false; break; }
    }
    if (isFundamental) { pStar = p; break; }
  }
  if (pStar < 0) pStar = cands[0];

  // loop_start : 1re frame à partir de laquelle la queue est exactement périodique.
  let i = N - pStar - 1;
  let lastMismatch = -1;
  while (i >= 0) {
    if (H[i] !== H[i + pStar]) { lastMismatch = i; break; }
    i--;
  }
  const loopStart = lastMismatch + 1; // les frames avant peuvent différer (intro)

  return { periodFrames: pStar, loopStartFrames: loopStart };
}

/**
 * Détecte la boucle à partir du TEXTE d'un log de registres déjà rendu.
 * Exporté pour test/CLI hors nsftool. La boucle est exprimée en FRAMES
 * (exacte) puis convertie en secondes / échantillons au taux natif.
 *
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export function detectLoopFromLog(text) {
  const { H, N } = parseLog(text);
  if (N < Math.round(PMIN_SEC * FPS) + Math.round(2 * FPS)) return null; // log trop court
  const a = analyze(H, N);
  if (!a) return null;
  const { periodFrames, loopStartFrames } = a;

  // Rejet des « boucles » triviales (flux constant : SFX, note tenue, silence).
  const seen = new Set();
  for (let i = loopStartFrames; i < loopStartFrames + periodFrames && i < N; i++) {
    seen.add(H[i]);
    if (seen.size >= MIN_DISTINCT_FRAMES) break;
  }
  if (seen.size < MIN_DISTINCT_FRAMES) return null;

  return {
    startSeconds: +(loopStartFrames / FPS).toFixed(4),
    lengthSeconds: +(periodFrames / FPS).toFixed(4),
    startSamples: Math.round((loopStartFrames * SR) / FPS),
    lengthSamples: Math.round((periodFrames * SR) / FPS),
    sampleRate: SR,
  };
}

/**
 * Détecte la boucle d'une sous-piste NES : rend un log de registres via nsftool
 * (rapide, r=8000, rate-indépendant) puis l'autocorrèle. Renvoie les repères de
 * boucle (secondes canoniques + échantillons natifs) ou null si non bouclée /
 * non convergente / nsftool indisponible.
 *
 * @param {object} o
 * @param {string} o.sourcePath        chemin de la source NSF/NSFe
 * @param {number} o.trackIndex        index de sous-piste 0-based
 * @param {string} [o.nsftool]         binaire nsftool (défaut 'nsftool')
 * @param {string} [o.mediaDir]        (réservé ; le log temporaire vit dans os.tmpdir())
 * @param {number} [o.defaultSeconds]  (réservé ; le log couvre toujours LOG_LEN_MS)
 */
export async function detectLoop({ sourcePath, trackIndex, nsftool = 'nsftool' }) {
  const logfile = join(tmpdir(), `vdm-loop-${trackIndex}-${process.pid}-${Date.now()}.log`);
  try {
    const r = await run(
      nsftool,
      ['-t', String(trackIndex + 1), '-l', String(LOG_LEN_MS), '-r', String(LOG_RATE),
        '-c', '1', '--log', '1', '--logfile', logfile, sourcePath],
      SPAWN_TIMEOUT_MS
    );
    if (r.code !== 0) return null; // nsftool indispo / échec / timeout -> repli

    let text;
    try {
      text = readFileSync(logfile, 'utf8');
    } catch {
      return null; // log absent
    }
    return detectLoopFromLog(text);
  } finally {
    await rm(logfile, { force: true }).catch(() => {});
  }
}

// ---- CLI de test ----------------------------------------------------------
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const [, , source, trackIndex, defaultSeconds] = process.argv;
  if (!source || trackIndex == null) {
    console.error('Usage: node tools/nsf-loop.mjs <source> <trackIndex> [defaultSeconds]');
    process.exit(1);
  }
  detectLoop({
    sourcePath: source,
    trackIndex: Number(trackIndex),
    nsftool: process.env.VDM_NSFPLAY ?? 'nsftool',
    defaultSeconds: Number(defaultSeconds) || 120,
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error('échec :', err.message); process.exit(1); });
}
