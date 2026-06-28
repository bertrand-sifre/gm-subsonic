/**
 * tools/gdm-loop.mjs  —  détecteur de boucle GBS (REGISTER-LOG haute-fidélité)
 *
 * Détection de boucle pour la musique Game Boy (GBS, `Gbs_Emu` de libgme), sur le
 * même principe DÉTERMINISTE et EXACT que tools/nsf-loop.mjs pour le NES :
 * l'AUTOCORRÉLATION d'un LOG D'ÉCRITURES de registres APU, frame par frame.
 *
 *   NSF  : log de registres APU produit par nsftool (`--log 1`).
 *   GBS  : log d'écritures APU produit par la sous-commande `gdm loop`, exposé par
 *          une libgme PATCHÉE (GME_APU_HOOK dans Gb_Cpu.cpp + GME_FRAME_HOOK dans
 *          Gbs_Emu.cpp). Une frame = la séquence ordonnée des écritures (reg,data)
 *          de la play routine de cette frame ; deux frames sont égales ssi mêmes
 *          écritures dans le même ordre.
 *
 * On ABANDONNE l'ancienne voie PCM (enveloppe RMS + corrélation croisée NCC,
 * coarse->fine), intrinsèquement approchée et fragile, au profit de cette PARITÉ
 * SÉMANTIQUE avec nsf-loop : égalité ENTIÈRE exacte de frames, indépendante du
 * taux de rendu, sans dérive du loopStart. La même fonction d'analyse est
 * réutilisée — `analyzeStates(states, fps)` de tools/nsf-loop.mjs — simplement
 * PARAMÉTRÉE par le fps GB AUTORITAIRE émis par l'émulateur (4194304 / play_period,
 * soit ~59.73 Hz par défaut, et la valeur exacte si la sous-piste utilise le timer
 * TMA/TAC), au lieu du 60.0988 Hz NTSC codé en dur du NES.
 *
 * Format du log lu sur STDOUT de `gdm loop` :
 *   - LIGNE 1 : `fps=<f> frames=<N>`  (compteur indispensable : une frame sans
 *     écriture APU produit une LIGNE VIDE, qui reste une frame valide).
 *   - LIGNES 2..(N+1) : 1 par frame de jeu ; chaque ligne = les octets de la frame
 *     (paires reg,data) en hex minuscule sans séparateur ; une ligne vide = frame
 *     sans écriture. Les frames d'INIT (avant la 1re PLAY) ne sont PAS loggées.
 *
 * Export : detectLoop({ sourcePath, trackIndex, gdm })
 *   -> { startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null
 * (mêmes champs que nsf-loop.detectLoop -> contrat MetaTrack.loop / @vdm/shared
 *  intact ; null = non bouclée / non convergente / gdm indisponible -> repli
 *  paramétrique côté serveur.)
 *
 * Usage CLI :  node tools/gdm-loop.mjs <source.gbs> <trackIndex>
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyzeStates } from './nsf-loop.mjs';

const LEN_MS = 200000; // 200 s : couvre toute boucle <= ~100 s avec marge >= 1 période
const RATE = 8000; // rendu rapide ; le compte de frames est rate-indépendant
const SPAWN_TIMEOUT_MS = 30000; // garde-fou : tue gdm si un fichier bloque

/**
 * Exécute une commande ; ne rejette jamais. Tue le process après un timeout
 * (protège l'import d'un fichier pathologique). Renvoie { code, stdout, stderr }.
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
 * Parse la sortie STDOUT de `gdm loop` (en-tête + N lignes hex) en DEUX vues par
 * frame, prêtes pour analyzeStates :
 *  - delta : id de la ligne d'écritures (égalité de chaîne exacte, parité nsf-loop) ;
 *            sert à la période et au loopStart.
 *  - full  : id de l'ÉTAT des 48 registres APU (FF10..FF3F) obtenu en REJOUANT les
 *            écritures ; capte la NOTE TENUE (invisible au delta), sert au raffinement
 *            seamless du loopStart.
 * Le compteur `frames=N` de l'en-tête lève l'ambiguïté du newline final de split.
 *
 * @returns {{ delta: Int32Array, full: Int32Array, fps: number } | null}
 */
function parseRegLog(stdout) {
  const lines = stdout.split('\n');
  const m = /^fps=([0-9.]+)\s+frames=(\d+)/.exec(lines[0] ?? '');
  if (!m) return null;
  const fps = parseFloat(m[1]);
  const N = parseInt(m[2], 10);
  if (!(fps > 0) || !(N > 0)) return null;

  const dIds = new Map();
  const sIds = new Map();
  const delta = new Int32Array(N);
  const full = new Int32Array(N);
  const reg = new Uint8Array(48); // état courant des 48 registres APU (FF10..FF3F)
  for (let f = 0; f < N; f++) {
    const line = lines[1 + f] ?? ''; // frame sans écriture -> ligne vide
    let dId = dIds.get(line);
    if (dId === undefined) { dId = dIds.size; dIds.set(line, dId); }
    delta[f] = dId;
    for (let i = 0; i + 4 <= line.length; i += 4) { // rejoue les paires (reg,data)
      const rr = parseInt(line.slice(i, i + 2), 16);
      const dd = parseInt(line.slice(i + 2, i + 4), 16);
      if (rr < 48) reg[rr] = dd;
    }
    const key = Buffer.from(reg).toString('latin1'); // snapshot des 48 octets
    let sId = sIds.get(key);
    if (sId === undefined) { sId = sIds.size; sIds.set(key, sId); }
    full[f] = sId;
  }
  return { delta, full, fps };
}

/**
 * Détecte la boucle d'une sous-piste GBS : demande à `gdm loop` un log d'écritures
 * APU par frame (rapide, r=8000, compte de frames rate-indépendant) + le fps GB
 * autoritaire, interne les frames puis les autocorrèle via analyzeStates (algo
 * partagé avec le NES, paramétré par le fps du log). Renvoie les repères de boucle
 * (secondes canoniques + échantillons natifs) ou null si non bouclée / non
 * convergente / gdm indisponible.
 *
 * La sortie EST l'objet stocké dans entry.loop (forme MetaTrack.loop) ;
 * analyzeStates porte sa propre garde courte et son rejet des boucles triviales
 * (pas de garde ad hoc redondante ici).
 *
 * @param {object} o
 * @param {string} o.sourcePath  chemin de la source GBS
 * @param {number} o.trackIndex  index de sous-piste 0-based (gdm/gme_start_track)
 * @param {string} [o.gdm]       binaire gdm (défaut 'gdm')
 * @returns {{ startSeconds, lengthSeconds, startSamples, lengthSamples, sampleRate } | null}
 */
export async function detectLoop({ sourcePath, trackIndex, gdm = 'gdm' }) {
  const r = await run(
    gdm,
    ['loop', sourcePath,
      '--track', String(trackIndex), // 0-based : gdm/gme_start_track, PAS de +1
      '--len-ms', String(LEN_MS),
      '--rate', String(RATE)],
    SPAWN_TIMEOUT_MS
  );
  if (r.code !== 0) return null; // gdm indispo / échec / timeout / libgme non patchée -> repli

  const parsed = parseRegLog(r.stdout);
  if (!parsed) return null; // en-tête absente / fps ou frames invalides -> repli
  const { delta, full, fps } = parsed;

  // Période + loopStart sur le delta (parité nsf-loop), en IGNORANT l'artefact d'init
  // de la frame 0 (sinon fausse intro d'1 frame sur les pistes qui bouclent dès 0) et
  // en RAFFINANT loopStart via l'état complet (full) pour un raccord seamless propre
  // (sinon la note tenue à la frontière vient de l'intro).
  const loop = analyzeStates(delta, fps, { ignoreFirstFrameMismatch: true, refineStates: full });

  if (process.env.VDM_GBS_LOOP_DEBUG) {
    process.stderr.write(
      `[gdm-loop] method=register-log fps=${fps.toFixed(4)} frames=${delta.length} ` +
      `loop=${loop
        ? `start=${loop.startSeconds}s length=${loop.lengthSeconds}s ` +
          `samples[start=${loop.startSamples} len=${loop.lengthSamples}]`
        : 'aucune'}\n`
    );
  }

  return loop;
}

// ---- CLI de test ----------------------------------------------------------
const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  const [, , source, trackIndex] = process.argv;
  if (!source || trackIndex == null) {
    console.error('Usage: node tools/gdm-loop.mjs <source.gbs> <trackIndex>');
    process.exit(1);
  }
  detectLoop({
    sourcePath: source,
    trackIndex: Number(trackIndex),
    gdm: process.env.VDM_GDM ?? 'gdm',
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error('échec :', err.message); process.exit(1); });
}
