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

const FPS = 60.0988; // fps NTSC NSF (1789772.7 / 29780.5) — fps autoritaire NES du wrapper
const LOG_RATE = 8000; // rendu rapide ; le log de registres est rate-indépendant
const LOG_LEN_MS = 200000; // 200 s : couvre toute boucle <= ~100 s avec marge >= 1 période
const SPAWN_TIMEOUT_MS = 30000; // garde-fou : tue nsftool si un fichier bloque
// Les seuils d'analyse (sampleRate 44100, pmin 1 s, pmax 100 s, garde de queue 2 s,
// minDistinctFrames 8) vivent désormais comme défauts d'`opts` d'analyzeStates.

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
 * Autocorrélation exacte d'une suite d'états de frame INTERNÉS (port direct de
 * analyze + detectLoopFromLog de loopexact.py), PARTAGÉE entre le NES (nsftool) et
 * le GBS (tools/gdm-loop.mjs via `gdm loop`). `states` = un id entier par frame de
 * jeu (frames égales <=> mêmes écritures de registres dans le même ordre) ; `fps` =
 * le frame-rate AUTORITAIRE du log (60.0988 Hz NTSC pour le NES ; 4194304/play_period
 * émis par l'émulateur pour le GBS). Les seuils vivent dans `opts` (défauts = les
 * constantes historiques NES -> wrapper NES inchangé bit pour bit).
 *
 *  - garde courte : log trop court pour intro + >= 1 période + garde de queue -> null.
 *  - tailrun(p) : nb de frames contiguës states[i]==states[i+p] depuis i=N-p-1.
 *  - candidats : p in [round(pminSec·fps), min(N-round(tailGuardSec·fps),
 *    round(pmaxSec·fps))) avec tailrun(p) >= p (au moins une période parfaite répétée).
 *  - fondamentaux : candidats non multiples d'un candidat plus petit ; p_star = plus
 *    petit fondamental. Aucun candidat -> null (non périodique).
 *  - loop_start : (dernier mismatch descendant depuis N-p_star-1) + 1.
 *  - rejet des boucles triviales : période avec < minDistinctFrames états distincts
 *    (flux constant : SFX, note tenue, silence) -> null.
 *
 * @param {Int32Array|number[]} states  un id de frame par frame de jeu
 * @param {number} fps                  frame-rate autoritaire (Hz)
 * @param {object} [opts]               sampleRate/pminSec/pmaxSec/tailGuardSec/minDistinctFrames
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export function analyzeStates(states, fps, opts = {}) {
  const {
    sampleRate = 44100,
    pminSec = 1,
    pmaxSec = 100,
    tailGuardSec = 2,
    minDistinctFrames = 8,
    // GBS : la 1re frame de jeu porte le one-shot d'init (upload wave RAM, config)
    // jamais rejoué à la boucle -> mismatch BÉNIN. Quand activé, on exclut la frame 0
    // du scan loopStart (=> boucle dès la frame 0 si le reste est périodique).
    ignoreFirstFrameMismatch = false,
    // GBS : le log d'ÉCRITURES (delta) est aveugle à la NOTE TENUE. refineStates (un
    // id d'ÉTAT complet des registres par frame) avance loopStart vers la 1re frame
    // dont l'état coïncide une période plus loin -> raccord sans note résiduelle.
    refineStates = null,
  } = opts;

  const H = states;
  const N = H.length;

  const pminFrames = Math.round(pminSec * fps);
  const tailGuardFrames = Math.round(tailGuardSec * fps);
  if (N < pminFrames + tailGuardFrames) return null; // log trop court

  // tailrun : la longueur de queue exactement répétée à la période p.
  const tailrun = (p) => {
    let i = N - p - 1;
    let r = 0;
    while (i >= 0 && H[i] === H[i + p]) { r++; i--; }
    return r;
  };

  const pmin = pminFrames;
  const pmax = Math.min(N - tailGuardFrames, Math.round(pmaxSec * fps));
  const cands = [];
  for (let p = pmin; p < pmax; p++) {
    if (tailrun(p) >= p) cands.push(p); // au moins une période entière se répète parfaitement
  }
  if (cands.length === 0) return null; // non proprement périodique -> repli paramétrique

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
  // scanFloor=1 (ignoreFirstFrameMismatch) saute la frame 0 (artefact d'init GBS).
  const scanFloor = ignoreFirstFrameMismatch ? 1 : 0;
  let i = N - pStar - 1;
  let lastMismatch = -1;
  while (i >= scanFloor) {
    if (H[i] !== H[i + pStar]) { lastMismatch = i; break; }
    i--;
  }
  let loopStartFrames = lastMismatch + 1; // les frames avant peuvent différer (intro)
  const periodFrames = pStar;

  // Raffinement seamless : si une vraie intro précède la boucle, avancer loopStart
  // vers la 1re frame dont l'ÉTAT complet (refineStates) coïncide une période plus
  // loin -> la note tenue à la frontière provient de l'intérieur de la boucle, donc
  // pas de raccord sur une note résiduelle de l'intro. (Sans refineStates : no-op.)
  if (refineStates && loopStartFrames > 0) {
    for (let L = loopStartFrames; L < loopStartFrames + periodFrames && L + periodFrames < N; L++) {
      if (refineStates[L] === refineStates[L + periodFrames]) { loopStartFrames = L; break; }
    }
  }

  // Rejet des « boucles » triviales (flux constant : SFX, note tenue, silence).
  const seen = new Set();
  for (let j = loopStartFrames; j < loopStartFrames + periodFrames && j < N; j++) {
    seen.add(H[j]);
    if (seen.size >= minDistinctFrames) break;
  }
  if (seen.size < minDistinctFrames) return null;

  return {
    startSeconds: +(loopStartFrames / fps).toFixed(4),
    lengthSeconds: +(periodFrames / fps).toFixed(4),
    startSamples: Math.round((loopStartFrames * sampleRate) / fps),
    lengthSamples: Math.round((periodFrames * sampleRate) / fps),
    sampleRate,
    frameRate: +fps.toFixed(4), // repère « frame » côté lecteur (diagnostic)
  };
}

/**
 * Détecte la boucle à partir du TEXTE d'un log de registres NES déjà rendu.
 * Exporté pour test/CLI hors nsftool. Wrapper mince autour d'analyzeStates au fps
 * NTSC NES (défauts d'opts = constantes historiques) -> comportement bit pour bit
 * identique à la version pré-refactor.
 *
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export function detectLoopFromLog(text) {
  const { H } = parseLog(text);
  return analyzeStates(H, FPS);
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
