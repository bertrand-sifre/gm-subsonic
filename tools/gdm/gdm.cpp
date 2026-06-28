/* tools/gdm/gdm.cpp
 *
 * gdm : petit CLI C++ lié à libgme (API C, gme.h) — l'équivalent GBS de
 * tools/nsftool/nsftool.cpp, mais via gme.h au lieu du cœur xgm de nsfplay.
 *
 * Trois sous-commandes partageant le setup de l'émulateur :
 *
 *   gdm probe  <file>                          -> JSON (stdout) : devices/voices
 *                                                  statiques + tags d'en-tête.
 *   gdm render <file> --track N --end-sample S [--channel K | --mute-mask M]
 *              [--rate R] [-o OUT]              -> WAV PCM16 borné (mix ou voix
 *                                                  isolée par mute).
 *   gdm loop   <file> --track N [--len-ms MS]
 *              [--rate R]                       -> LOG d'écritures de registres
 *                                                  APU par frame (stdout, texte) +
 *                                                  frame-rate exact. Consommé par
 *                                                  tools/gdm-loop.mjs (parité
 *                                                  nsf-loop). GBS uniquement.
 *
 * `probe` = couche métadonnées (header-only, instantané) consommée par
 * tools/gdm-probe.mjs. `render` = moteur PCM (cf. apps/server/src/render/
 * engines/gdm.ts) ; il N'ENCODE jamais — ffmpeg garde l'encodage OGG, les
 * fondus et le crossfade (chaîne renderSeamless existante). `loop` = détection
 * de boucle haute-fidélité (log de registres, pas d'autocorrélation PCM).
 *
 * On imprime aussi le RMS/PEAK par rendu (sur stderr) pour rendre la
 * séparation de canal MESURABLE, comme nsftool.
 *
 * `loop` (et tous les appels gme_vdm_*) est GARDÉ par #ifdef GME_HAS_VDM_REGLOG,
 * défini uniquement dans le gme.h de la libgme PATCHÉE (cf. tools/gdm/patches/
 * libgme-reglog.patch). Contre une libgme STOCK (brew/apt, sans le define),
 * probe/render compilent toujours ; `loop` répond une erreur runtime.
 *
 * Licence : libgme est LGPL-2.1 ; gdm la lie en STATIQUE (libgme.a) -> clause de
 * relink LGPL §6 satisfaite (le patch et les sources épinglées sont versionnés).
 * GME_ZLIB=OFF au build de libgme : pas de VGZ dans gdm (GBS uniquement ; le VGZ
 * passe par ffmpeg). gdm reste lancé en sous-processus par le serveur.
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <math.h>
#include <getopt.h>
#include <algorithm>
#include <vector>
#include <string>

#include <gme/gme.h>

#include "wav.h"

/* NB : le multi-channel libgme (chaque voix sur sa propre paire stéréo en une
 * seule passe) est volontairement HORS de ce binaire MVP. Il exigerait le chemin
 * C++ `load_file` (libgme fixe le sample rate dès `gme_open_file`, or
 * `set_multi_channel` doit précéder) — cf. docs/etude-gbs-libgme.md §2.4/§6.1.
 * Le MVP isole les voix par mute (un rendu par canal), suffisant pour stems +
 * visualisation web. */

/** Taux de rendu par défaut (= SAMPLE_RATE côté serveur). */
static const int SR = 44100;

/* ------------------------------------------------------------------ helpers */

/** gme_err_t == const char* (NULL = succès). Sinon : message sur stderr + exit. */
static void die(const char* ctx, gme_err_t e) {
  if (e) { fprintf(stderr, "%s: %s\n", ctx, e); exit(1); }
}

/** Échappe une chaîne pour insertion entre guillemets JSON (sans les guillemets). */
static std::string esc(const char* s) {
  std::string out;
  if (!s) return out;
  for (const unsigned char* p = (const unsigned char*)s; *p; ++p) {
    unsigned char c = *p;
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); out += b; }
        else out += (char)c; // octets >= 0x20 (dont UTF-8) recopiés tels quels
    }
  }
  return out;
}

/** Émet une chaîne JSON entre guillemets, ou `null` si vide/absente. */
static void emit_str_or_null(FILE* f, const char* s) {
  if (!s || !s[0]) { fputs("null", f); return; }
  fprintf(f, "\"%s\"", esc(s).c_str());
}

/** Émet une durée JSON en SECONDES depuis des millisecondes, ou `null` si <= 0. */
static void emit_sec_or_null(FILE* f, long ms) {
  if (ms <= 0) { fputs("null", f); return; } // GBS : length/intro = -1 -> null
  fprintf(f, "%g", ms / 1000.0);
}

/** Recherche insensible à la casse d'un sous-mot. */
static bool icontains(const char* hay, const char* needle) {
  std::string h(hay ? hay : ""); for (auto& c : h) c = (char)tolower((unsigned char)c);
  std::string n(needle); for (auto& c : n) c = (char)tolower((unsigned char)c);
  return h.find(n) != std::string::npos;
}

/** Famille de voix déduite du nom (heuristique ; suffit pour GBS/DMG-APU). */
static const char* voice_kind(const char* name) {
  if (icontains(name, "square") || icontains(name, "pulse")) return "pulse";
  if (icontains(name, "wave"))     return "wave";
  if (icontains(name, "noise"))    return "noise";
  if (icontains(name, "triangle")) return "triangle";
  return "unknown";
}

/** Puce déduite du système (Game Boy -> DMG-APU ; sinon le système tel quel). */
static std::string chip_for_system(const char* sys) {
  if (sys && (icontains(sys, "game boy") || icontains(sys, "gameboy"))) return "DMG-APU";
  if (sys && sys[0]) return sys;
  return "unknown";
}

/** Extension du fichier en minuscules (défaut "gbs"). */
static std::string format_from_path(const char* path) {
  std::string p(path);
  size_t slash = p.find_last_of("/\\");
  size_t dot = p.find_last_of('.');
  if (dot == std::string::npos || (slash != std::string::npos && dot < slash)) return "gbs";
  std::string ext = p.substr(dot + 1);
  for (auto& c : ext) c = (char)tolower((unsigned char)c);
  return ext.empty() ? "gbs" : ext;
}

/** Nom de fichier (sans le répertoire). */
static std::string base_name(const char* path) {
  std::string p(path);
  size_t slash = p.find_last_of("/\\");
  return slash == std::string::npos ? p : p.substr(slash + 1);
}

/* --------------------------------------------------------------------- probe */

/*
 * probe : ouvre le fichier (lecture d'en-tête, pas d'émulation), liste les voix
 * statiques (gme_voice_count/gme_voice_name) regroupées en une puce, et émet le
 * JSON schemaVersion 1. Le bloc `devices[]` est le SEUL consommé par
 * gdm-probe.mjs ; `trackCount`/`tracks[]` sont FORWARD-LOOKING (les
 * métadonnées de piste viennent déjà de ffprobe côté importeur).
 */
static int cmd_probe(const char* path) {
  Music_Emu* emu = nullptr;
  die("probe: open", gme_open_file(path, &emu, SR));

  int track_count = gme_track_count(emu);

  // system : champ partagé par l'émulateur, lu via les infos de la 1re piste.
  std::string system = "unknown";
  if (track_count > 0) {
    gme_info_t* gi = nullptr;
    if (!gme_track_info(emu, &gi, 0) && gi) {
      if (gi->system && gi->system[0]) system = gi->system;
      gme_free_info(gi);
    }
  }
  std::string chip = chip_for_system(system.c_str());
  std::string format = format_from_path(path);
  std::string file = base_name(path);
  int vc = gme_voice_count(emu);

  printf("{\n");
  printf("  \"schemaVersion\": 1,\n");
  printf("  \"format\": \"%s\",\n", esc(format.c_str()).c_str());
  printf("  \"system\": \"%s\",\n", esc(system.c_str()).c_str());
  printf("  \"file\": \"%s\",\n", esc(file.c_str()).c_str());

  // devices[] : SEUL bloc consommé par gdm-probe.mjs (une puce pour GBS).
  printf("  \"devices\": [\n");
  printf("    {\n");
  printf("      \"chip\": \"%s\",\n", esc(chip.c_str()).c_str());
  printf("      \"voices\": [\n");
  for (int i = 0; i < vc; i++) {
    const char* nm = gme_voice_name(emu, i);
    if (!nm) nm = "";
    printf("        { \"index\": %d, \"name\": \"%s\", \"kind\": \"%s\" }%s\n",
           i, esc(nm).c_str(), voice_kind(nm), i + 1 < vc ? "," : "");
  }
  printf("      ]\n");
  printf("    }\n");
  printf("  ],\n");

  // ---- FORWARD-LOOKING : non consommé par l'importeur MVP (anti sur-spec) ----
  printf("  \"trackCount\": %d,\n", track_count);
  printf("  \"tracks\": [\n");
  for (int t = 0; t < track_count; t++) {
    gme_info_t* gi = nullptr;
    gme_err_t te = gme_track_info(emu, &gi, t);
    const char* title     = (!te && gi) ? gi->song : nullptr;
    const char* author    = (!te && gi) ? gi->author : nullptr;
    const char* copyright = (!te && gi) ? gi->copyright : nullptr;
    long length = (!te && gi) ? gi->length : -1;       // GBS -> -1 -> null
    long intro  = (!te && gi) ? gi->intro_length : -1; // GBS -> -1 -> null

    printf("    { \"index\": %d, \"title\": ", t);
    emit_str_or_null(stdout, title);
    printf(", \"author\": ");
    emit_str_or_null(stdout, author);
    printf(", \"copyright\": ");
    emit_str_or_null(stdout, copyright);
    printf(", \"length\": ");
    emit_sec_or_null(stdout, length);
    printf(", \"intro\": ");
    emit_sec_or_null(stdout, intro);
    // loop : jamais émis par probe (la boucle GBS vient de gdm-loop.mjs).
    printf(", \"loop\": null }%s\n", t + 1 < track_count ? "," : "");

    if (gi) gme_free_info(gi);
  }
  printf("  ]\n");
  printf("}\n");

  gme_delete(emu);
  return 0;
}

/* -------------------------------------------------------------------- render */

/*
 * render : émule la sous-piste et écrit un WAV PCM16 borné à --end-sample.
 * Mix complet par défaut ; voix isolée si --channel (mute des autres) ou masque
 * explicite --mute-mask. Sortie vers le fichier -o (utilisé par le serveur :
 * exec.ts ignore stdout) ou, à défaut, sur stdout (debug CLI).
 */
static int cmd_render(const char* path, int track, int channel, int mute_mask,
                      long end_sample, int rate, const char* out) {
  if (end_sample <= 0) {
    fprintf(stderr, "render: --end-sample requis (> 0)\n");
    return 2;
  }

  Music_Emu* emu = nullptr;
  die("render: open", gme_open_file(path, &emu, rate));

  // ALIGNEMENT frame<->échantillon : sans ceci, gme_start_track saute jusqu'à
  // max_initial_silence frames en FAISANT avancer l'émulateur (cf. Music_Emu.cpp),
  // ce qui désaligne le sample 0 du rendu de la frame 0 du log de `gdm loop`. À
  // appeler AVANT gme_start_track. GBS-only ; le rendu GBS n'a pas encore de boucle
  // -> pas de régression, et l'éventuel silence initial (<= ~0.35 s) reste correct.
  gme_ignore_silence(emu, 1);

  int vc = gme_voice_count(emu);

  // Masque de mute calculé AVANT start_track (besoin de voice_count), APPLIQUÉ
  // après (cf. ordre canonique plus bas). bit i = voix i mutée.
  int mask = -1;
  if (channel >= 0) {
    if (channel >= vc) {
      fprintf(stderr, "render: --channel %d hors plage (%d voix)\n", channel, vc);
      gme_delete(emu);
      return 2;
    }
    mask = ((1 << vc) - 1) & ~(1 << channel); // ne garder que la voix `channel`
  } else if (mute_mask >= 0) {
    mask = mute_mask;
  }

  const int out_ch = 2; // gme_play sort toujours 2 canaux (stéréo).

  // ORDRE CANONIQUE (porteur) : open -> start_track -> mute_voices -> render.
  die("render: start_track", gme_start_track(emu, track)); // 0-based (PAS de +1)

  // IMPORTANT (revue) : muter APRÈS gme_start_track. En Release (-DNDEBUG) le
  // require() de blargg est compilé out : muter AVANT start_track ne plante pas
  // mais peut être ignoré / ré-appliqué selon la version -> stems == mix.
  // L'ordre est porteur ; le RMS imprimé plus bas rend la séparation mesurable.
  if (mask >= 0) gme_mute_voices(emu, mask);

  FILE* f = out ? fopen(out, "wb") : stdout;
  if (!f) { perror("render: out"); gme_delete(emu); return 1; }
  write_wav_header(f, (uint64_t)end_sample, out_ch, rate);

  const int CHUNK = 4096; // trames par passe
  std::vector<short> buf((size_t)CHUNK * out_ch);
  std::vector<uint8_t> pac((size_t)CHUNK * out_ch * 2);

  double sumsq = 0; long nsamp = 0; int peak = 0;
  long done = 0;
  while (done < end_sample) {
    int nf = (int)std::min<long>(CHUNK, end_sample - done);
    int count = nf * out_ch; // gme_play : nombre de shorts (trames * canaux)
    die("render: play", gme_play(emu, count, buf.data()));
    for (int i = 0; i < count; i++) {
      int s = buf[i];
      sumsq += (double)s * s; nsamp++;
      if (abs(s) > peak) peak = abs(s);
      pack16(&pac[(size_t)i * 2], (uint16_t)buf[i]);
    }
    fwrite(pac.data(), 2 * out_ch, nf, f);
    done += nf;
  }
  if (f != stdout) fclose(f);

  double rms = nsamp ? sqrt(sumsq / nsamp) : 0;
  fprintf(stderr, "RMS=%.1f PEAK=%d (16-bit; rms_dBFS=%.1f)\n",
          rms, peak, rms > 0 ? 20 * log10(rms / 32768.0) : -999.0);

  gme_delete(emu);
  return 0;
}

/* ---------------------------------------------------------------------- loop */

#ifdef GME_HAS_VDM_REGLOG
/*
 * loop : émule la sous-piste sur une fenêtre fixe en COLLECTANT le log d'écritures
 * APU par frame (via la libgme patchée, cf. tools/gdm/patches/libgme-reglog.patch),
 * puis émet ce log sur stdout pour tools/gdm-loop.mjs. PARITÉ SÉMANTIQUE avec
 * nsf-loop : une frame = la séquence ordonnée des (reg,data) écrits par la play
 * routine de cette frame ; la détection (autocorrélation) se fait côté JS.
 *
 * Sortie (texte) :
 *   ligne 1            : `fps=<f> frames=<N>`  (frame-rate exact + nb de frames)
 *   lignes 2..(N+1)    : 1 par frame ; octets reg,data en hex minuscule, sans
 *                        séparateur (reg = addr-0xFF10 dans 0..47, data 0..255).
 *                        Une frame SANS écriture -> ligne vide (frame valide).
 *
 * gme_ignore_silence(1) aligne la frame 0 du log sur le sample 0 (cf. cmd_render).
 * gme_vdm_enable_reg_log AVANT start_track ; gme_vdm_finish flush la dernière frame
 * partielle (aucun frame-hook ne la ferme).
 */
static int cmd_loop(const char* path, int track, int rate, long len_ms) {
  Music_Emu* emu = nullptr;
  die("loop: open", gme_open_file(path, &emu, rate));

  if (gme_type(emu) != gme_gbs_type) {
    fprintf(stderr, "loop: GBS uniquement (log d'écritures APU)\n");
    gme_delete(emu);
    return 2;
  }

  gme_ignore_silence(emu, 1);     // aligne frame 0 <-> sample 0 (idem cmd_render)
  gme_vdm_enable_reg_log(emu, 1); // armer AVANT start_track

  die("loop: start_track", gme_start_track(emu, track)); // 0-based (PAS de +1)

  long total = len_ms * (long)rate / 1000; // trames à rendre sur la fenêtre
  const int out_ch = 2;                    // gme_play sort toujours 2 canaux
  const int CHUNK = 4096;
  std::vector<short> buf((size_t)CHUNK * out_ch);
  for (long done = 0; done < total; ) {
    int nf = (int)std::min<long>(CHUNK, total - done);
    die("loop: play", gme_play(emu, nf * out_ch, buf.data()));
    done += nf;
  }

  // NB : on ne flush PAS la frame en cours (pas de gme_vdm_finish). gme_play rend un
  // nombre EXACT de trames, donc la dernière frame est PARTIELLE (writes incomplets) :
  // la logger créerait un état unique en fin de log et casserait l'autocorrélation.
  // Toutes les frames COMPLÈTES sont déjà fermées par leur frame-hook suivant.
  int frames = gme_vdm_reg_log_frames(emu);
  printf("fps=%.6f frames=%d\n", gme_vdm_frame_rate(emu), frames);
  for (int f = 0; f < frames; f++) {
    int n = gme_vdm_frame_size(emu, f);
    const unsigned char* d = gme_vdm_frame_data(emu, f);
    for (int b = 0; b < n; b++) printf("%02x", d[b]);
    putchar('\n');
  }

  gme_delete(emu);
  return 0;
}
#endif /* GME_HAS_VDM_REGLOG */

/* ---------------------------------------------------------------------- main */

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: gdm <probe|render|loop> [options] file.gbs\n");
    return 2;
  }
  const char* sub = argv[1];

  int track = 0;          // 0-based
  long end_sample = -1;   // trames à --rate
  int channel = -1;       // voix à isoler (-1 = mix)
  int mute_mask = -1;     // masque explicite (-1 = aucun)
  int rate = SR;
  const char* out = nullptr;
  long len_ms = 200000;   // fenêtre d'analyse de `loop` (miroir nsf-loop : 200 s)

  static struct option lo[] = {
    {"track",         1, 0, 't'},
    {"end-sample",    1, 0, 'e'},
    {"channel",       1, 0, 'k'},
    {"mute-mask",     1, 0, 'm'},
    {"rate",          1, 0, 'r'},
    {"out",           1, 0, 'o'},
    {"len-ms",        1, 0, 'L'}, // fenêtre d'analyse (ms) pour la sous-commande loop
    {0, 0, 0, 0}
  };

  // getopt sur argv+1 : on saute le nom de la sous-commande (argv[1]).
  int sc = argc - 1;
  char** sv = argv + 1;
  int o;
  while ((o = getopt_long(sc, sv, "t:e:k:m:r:o:L:", lo, 0)) != -1) {
    switch (o) {
      case 't': track = atoi(optarg); break;
      case 'e': end_sample = atol(optarg); break;
      case 'k': channel = atoi(optarg); break;
      case 'm': mute_mask = (int)strtol(optarg, 0, 0); break; // décimal/hex (0x), pas 0b
      case 'r': rate = atoi(optarg); break;
      case 'o': out = optarg; break;
      case 'L': len_ms = atol(optarg); break;
      default: return 2;
    }
  }

  if (optind >= sc) { fprintf(stderr, "gdm: fichier manquant\n"); return 2; }
  const char* path = sv[optind];

  if (strcmp(sub, "probe") == 0) return cmd_probe(path);
  if (strcmp(sub, "render") == 0)
    return cmd_render(path, track, channel, mute_mask, end_sample, rate, out);
  if (strcmp(sub, "loop") == 0) {
#ifdef GME_HAS_VDM_REGLOG
    return cmd_loop(path, track, rate, len_ms);
#else
    // libgme STOCK (non patchée) : le log d'écritures APU n'est pas exposé.
    (void)len_ms; // sinon « set but not used » contre une libgme stock
    fprintf(stderr, "gdm: 'loop' indisponible (libgme non patchée — voir "
                    "tools/gdm/patches/libgme-reglog.patch)\n");
    return 3;
#endif
  }

  fprintf(stderr, "gdm: sous-commande inconnue '%s' (probe|render|loop)\n", sub);
  return 2;
}
