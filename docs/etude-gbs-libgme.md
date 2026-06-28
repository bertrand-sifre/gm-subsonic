# Étude — Étendre le support GBS via libgme (infos manquantes + contrôle des canaux)

> But : faire passer le format **GBS** (Nintendo Game Boy, `Gbs_Emu` de libgme) du
> niveau « lecture seule (mix) » au niveau de richesse déjà atteint pour le **NSF** :
> boucle/intro, **isolation des canaux (stems)** et **visualisation par canal**.
> On évalue ce que libgme expose, ce qui nous manque, et **comment le modifier**.

---

## 1. Point de départ dans le repo

| Brique | NSF (cible de parité) | GBS (aujourd'hui) |
|---|---|---|
| Lecture / rendu paramétrique | `libgme` via ffmpeg `-f libgme` | **idem** (`apps/server/src/render/engines/libgme.ts`) |
| Détection de boucle | `tools/nsf-loop.mjs` (autocorrélation du log APU) | **`tools/gdm-loop.mjs`** (même log APU via libgme patchée — cf. §6.3) |
| Catalogue de stems | `tools/nsf-stems.mjs` (lit la puce NSF) | **absent** |
| Rendu d'un canal isolé | `nsftool.ts` (`PcmEngine` avec `channelIndex`) | **absent** |
| Visualisation par canal | `AnalyserNode` par voix dans `LoopPlayer.ts` (web) | **inutilisé** (pas de stems à analyser) |

Le constat clé : **la chaîne web est déjà prête** (`LoopPlayer.loadChannels`,
`Voice → ChannelGain → Analyser → Master`), et les **types partagés** le sont aussi
(`ChannelSet`, `ChannelInfo`, `LoopInfo` dans `libs/shared/src/index.ts`). Le builder
`emulated.ts` est **générique** : dès qu'un manifeste fournit `channels`/`loop`, il
câble stems et boucle sans code spécifique au format. **Tout le manque est côté
extraction serveur**, et il vient surtout du **démuxeur ffmpeg `-f libgme`** qui ne
donne qu'un **mix stéréo**.

---

## 2. Ce que libgme expose nativement pour GBS

### 2.1 Le Game Boy APU : 4 voix fixes

`Gbs_Emu` déclare exactement 4 voix (`Gb_Apu::osc_count == 4`) :

```cpp
static const char* const names [Gb_Apu::osc_count] = {
    "Square 1", "Square 2", "Wave", "Noise"
};
set_voice_names( names );
set_voice_count( Gb_Apu::osc_count );
```

→ via l'API publique : `gme_voice_count()` = 4, `gme_voice_name(0..3)` = ces 4 noms.
Le catalogue de stems GBS est donc **statique et connu d'avance** (contrairement au
NSF où il faut lire les bits d'extension de puce). Pas besoin d'émuler pour le bâtir.

### 2.2 Muting de canal : **déjà natif**

C'est le point fort. Le muting existe au niveau du noyau, pas besoin de patch :

```c
void gme_mute_voice ( Music_Emu*, int index, int mute );
void gme_mute_voices( Music_Emu*, int muting_mask ); /* -1 = tout muter, 0x01 = voix 0 */
```

Mécaniquement, `Gbs_Emu::set_voice(i, center, left, right)` route chaque oscillateur
vers un `Blip_Buffer` via `apu.osc_output(i, …)` ; muter = router vers `NULL`.
**On peut donc produire un stem en mutant les 3 autres voix.**

### 2.3 Métadonnées de piste : structure présente, **valeurs absentes pour GBS**

```c
typedef struct gme_info_t {
    int length;        /* longueur totale, -1 si inconnue */
    int intro_length;  /* longueur jusqu'à la boucle, -1 si inconnue */
    int loop_length;   /* longueur de la section bouclée, -1 si inconnue */
    int play_length;   /* défaut 150000 ms (2.5 min) si rien d'autre */
    int fade_length;   /* -1 si inconnue */
    const char *system, *game, *song, *author, *copyright, *comment, *dumper;
} gme_info_t;
```

Pour GBS, `Gbs_Emu` **n'a aucune longueur native** : la lecture est pilotée par un
**timer** (`update_timer()` → `play_period`, 59.73 Hz par défaut ou TMA/TAC), et tourne
jusqu'à une adresse idle. Donc `length`/`intro_length`/`loop_length` ressortent à
**-1** et `play_length` retombe sur le défaut 150 000 ms. **C'est exactement la même
situation que le NSF** : aucune intro/boucle exposée par l'API.

L'en-tête GBS ne contient lui-même aucune durée ni point de boucle — uniquement :
identifiant `GBS`, version, `track_count`, `first_song`, adresses `load`/`init`/`play`,
`stack pointer`, `TMA`/`TAC` (timer), puis `title`/`author`/`copyright` (32 o chacun).
→ `track_count` et les tags texte sont récupérables ; **rien sur la durée/boucle**.

### 2.4 Le mode « multi-channel » : la fonctionnalité méconnue

libgme sait rendre **chaque voix sur sa propre paire stéréo** en un seul passage :

> *"whether the pcm output retrieved by gme_play() will have all 8 voices rendered to
> their individual stereo channel or (if false) these voices get mixed into one single
> stereo channel"*

- Côté C++ : `Music_Emu::set_multi_channel(bool)` + `Multi_Buffer`/`Effects_Buffer`
  (`channel(index, type)` → `{center,left,right}` par voix).
- Quand actif, `gme_play()` sort **2 × 8 = 16 canaux entrelacés** (8 paires ; GBS
  n'en remplit que 4, les autres sont silencieuses).
- **Piège majeur** : l'API **C** n'a qu'un *getter* `gme_multi_channel()` ; **il
  n'existe pas de `gme_set_multi_channel()` dans le mainline**. L'activation passe
  donc par le **C++**, ou par un **patch** ajoutant le setter C.

### 2.5 Autres leviers utiles déjà présents

`gme_set_fade`, `gme_set_tempo`, `gme_set_stereo_depth`, `gme_set_equalizer`,
`gme_enable_accuracy`, `gme_ignore_silence`, `gme_seek_samples`/`gme_tell_samples`,
`gme_track_ended`. → de quoi piloter finement un rendu hors-ligne.

---

## 3. Analyse du manque (gap analysis)

| Besoin | Exposé par libgme ? | Exposé par le démuxeur ffmpeg `-f libgme` ? |
|---|---|---|
| **Mute d'un canal** | ✅ `gme_mute_voice(s)` | ❌ non transmis |
| **Stem propre (1 voix)** | ✅ via multi-channel *(setter C manquant)* ou via mute | ❌ |
| **Flux par canal pour visualisation** | ✅ via multi-channel | ❌ |
| **Intro / point de boucle** | ❌ (-1, comme NSF) | ❌ |
| **Durée « correcte »** | ❌ (timer → défaut 150 s) | ❌ |
| Noms/nombre de voix | ✅ statique (4) | ❌ |

**Deux verrous distincts :**

1. **Le transport (ffmpeg).** Le démuxeur `-f libgme` ne fait que `gme_play()` en mix.
   Il ignore `gme_mute_voice`, le multi-channel et `gme_track_info`. → **impossible
   d'obtenir stems/visualisation par ffmpeg seul.** C'est le même mur que pour le NES,
   contourné là-bas par `nsftool`.
2. **Le contenu (boucle/intro).** libgme **ne fournit pas** la boucle pour GBS, point.
   Aucun patch ne la « révèle » : il faut la **détecter** (ou la sourcer).

---

## 4. Trois stratégies

### Stratégie A — Rester sur ffmpeg + options
Filtres ffmpeg uniquement (`-f libgme`, `-track_index`, `afade`, `atrim`).
→ Suffit pour le **rendu paramétrique** (déjà en place) mais **incapable** de stems,
mute ou visualisation par canal. **Rejetée** pour la cible.

### Stratégie B — Outil natif « gbstool » lié à libgme *(recommandée)*
Sur le modèle exact de `nsftool` : un petit binaire C/C++ qui ouvre le GBS, applique
`gme_mute_voices()`, et écrit le PCM/WAV d'un canal (ou du mix borné). Réutilise
**toute** l'architecture existante :

- implémente l'interface `PcmEngine` (`PcmRequest { trackIndex, endSample, channelIndex? }`)
  → branché dans `render/index.ts` (`ensureChannelRender` / `renderSeamless`) ;
- `channelIndex` présent → muter les 3 autres voix ; absent → mix complet ;
- côté manifeste, un `tools/gbs-stems.mjs` **statique** (4 voix toujours identiques) ;
- côté boucle, un `tools/gbs-loop.mjs` calqué sur `nsf-loop.mjs`.

**Avantage** : licence **LGPL-2.1** de libgme → **linkable** sans contamination (≠ GPL
de libvgm/ASAP). Aucune dépendance lourde nouvelle. Cohérent avec les briques NES.

### Stratégie C — Patcher libgme
Réservé à ce que B ne couvre pas proprement :
- **Ajouter `gme_set_multi_channel()` à l'API C** (3 lignes dans `gme.cpp`/`gme.h`)
  pour obtenir les 4 stems en **un seul passage** (16 canaux) au lieu de 4 rendus mutés.
- **Exposer un log/visualisation chip-level** (amplitudes ou écritures registres APU)
  pour une viz « fidèle au chip » — voir §6. C'est du GPL/LGPL selon le fork ; à n'ouvrir
  que si la viz côté web (§5) ne suffit pas.

---

## 5. Visualisation : surtout un problème déjà résolu côté web

`LoopPlayer.ts` câble **un `AnalyserNode` par voix**
(`Voice → ChannelGain → Analyser → Master`). Donc **dès qu'on fournit les 4 stems GBS**
en streaming, la visualisation par canal (VU-mètre, oscilloscope, FFT) **fonctionne
sans aucune modification de libgme** — exactement comme pour les stems NES.

→ La **visualisation ne justifie pas, à elle seule, un patch libgme.** Elle est un
sous-produit gratuit des stems. Un patch chip-level (§6) ne se justifie que pour une
viz « par registre » (enveloppe, duty, fréquence du canal) impossible à reconstruire
fidèlement depuis le seul PCM.

---

## 6. Détail des modifications, par besoin

### 6.1 Mute / stems — **aucune modif de libgme**
`gme_mute_voices(emu, mask)` avec `mask` = tout sauf la voix voulue. 4 rendus (un par
canal) suffisent. C'est le coût « N passages » de l'approche soustractive.

*Optimisation (Stratégie C)* : patch C
```c
// gme.h
BLARGG_EXPORT void gme_set_multi_channel( Music_Emu*, int enabled );
// gme.cpp
void gme_set_multi_channel( Music_Emu* me, int e ) { me->set_multi_channel( e != 0 ); }
```
→ un seul `gme_play()` rend les 4 voix sur 4 paires stéréo (lire 16 shorts entrelacés,
dont 8 utiles). Diviser les 4 rendus mutés par 1.

### 6.2 Visualisation
- **Voie recommandée** : stems → `AnalyserNode` web (§5). Zéro patch.
- **Voie chip-level (optionnelle, patch)** : tracer `Gb_Apu::write_register` (plage
  `0xFF10–0xFF3F`) avec horodatage, ou exposer l'amplitude par oscillateur, et émettre
  un sidecar JSON synchronisé. Utile pour afficher duty/enveloppe/fréquence, pas
  l'amplitude (que le PCM donne déjà).

### 6.3 Intro / boucle — détection, pas extraction
libgme ne la connaît pas. **Décision actée (juin 2026)** : on autocorrèle un **LOG
D'ÉCRITURES de registres APU par frame**, exactement comme `nsf-loop.mjs` pour le NES
— même fonction `analyzeStates` partagée, **égalité ENTIÈRE de frames** (pas une
similarité PCM approchée), sans dérive du `loopStart`, indépendant du taux de rendu.

Subtilité résolue **sans patcher `Gb_Apu`** : le hook d'écriture existe **déjà** dans
le code. `gb_cpu_io.h` appelle `GME_APU_HOOK( this, reg, data )` à chaque écriture APU
du chemin CPU (dans `Gbs_Emu::cpu_write`, `this == Gbs_Emu*`), et `GME_FRAME_HOOK( this )`
est tiré 1×/`play_period` dans `run_clocks`. On **définit** ces deux macros (scopées à
`Gb_Cpu.cpp` et `Gbs_Emu.cpp`) pour qu'elles appellent des méthodes membres de
`Gbs_Emu` accumulant un log par frame, exposé en C via `gme_vdm_*` (feature macro
`GME_HAS_VDM_REGLOG`). Le patch complet (5 fichiers, ~25 l., **PAS** `Gb_Apu`) est
versionné : `tools/gdm/patches/libgme-reglog.patch` (libgme 0.6.4 épinglé), appliqué
from-source dans le stage Docker `gdmbuilder`. La voie PCM initiale (enveloppe RMS +
NCC coarse→fine) est **abandonnée** (fragile, imprécise sur `loopStart`).

Frame-rate exact (conversion frame→échantillon côté JS) : `fps = 4194304 / play_period`
(horloge CPU GB, déjà corrigée TMA/TAC/tempo par `update_timer`), **émis par
l'émulateur** et autoritaire (jamais recalculé en JS).

Alternative non retenue : **base de durées / tags** (équivalent HVSC du SID) si une
source fiable existait.

### 6.4 Durée
À défaut de boucle détectée, garder le **rendu paramétrique** (`RenderInfo`
`defaultSeconds`/`defaultFade`) déjà en place — comportement actuel, inchangé.

---

## 7. Plan d'intégration concret (réutilisation maximale)

```
apps/server/src/render/engines/gbstool.ts   PcmEngine: mute_voices selon channelIndex
tools/gbs-stems.mjs                          catalogue statique des 4 voix (header GBS)
tools/gbs-loop.mjs                           détection boucle (PCM, ou log si patch §6.3b)
tools/import-library.mjs                     ajouter le routage GBS (déjà multi-format)
```

Inchangés (génériques) : `builders/emulated.ts`, `render/index.ts`
(`ensureChannelRender`/`renderSeamless`), `libs/shared` (`ChannelSet`/`LoopInfo`),
`LoopPlayer.ts`. Le manifeste GBS produit ressemble alors à un manifeste NSF
(`source`, `trackIndex`, `channels.voices[4]`, `loop?`).

---

## 8. Recommandation

1. **Stratégie B (gbstool lié à libgme), mute-based** : couvre stems + visualisation
   (via web) **sans patcher libgme**, sous licence **LGPL-2.1 linkable**. C'est le
   meilleur rapport effort/risque et c'est aligné sur l'existant NES.
2. **Patch optionnel `gme_set_multi_channel`** (Stratégie C, ~5 lignes) si le coût des
   4 rendus mutés devient gênant : 1 passage au lieu de 4.
3. **Boucle** : **log d'écritures de registres APU** (§6.3), via le hook **déjà
   présent** dans libgme (patch from-source, **sans** modifier `Gb_Apu`) → parité
   exacte avec le NES. La voie PCM initiale a été abandonnée (imprécise).
4. **Pas de patch viz** tant que la viz web sur stems suffit.

### Ordre de bataille
1. `gbstool.ts` (mute-based) + brancher dans `render/index.ts`.
2. `gbs-stems.mjs` (statique) → stems jouables + viz web immédiate.
3. `tools/gdm-loop.mjs` (log d'écritures APU, libgme patchée) → boucle sans couture.
4. *(option)* patch `gme_set_multi_channel` → perf.
5. *(option)* viz chip-level (duty/enveloppe par registre) si la viz web ne suffit pas.

---

## Annexe A — Architecture `gdm` (probe / render)

### A.1 Principe

Un **seul binaire C++** lié à libgme (API C++ : `Music_Emu`, `Gbs_Emu`,
`set_multi_channel`, `Multi_Buffer`), exposant **deux sous-commandes** sur le modèle
ffprobe/ffmpeg qui **partagent libav\*** — ici elles partagent le code d'ouverture/setup
de l'émulateur :

```
gdm probe  <file>                                    → JSON métadonnées (stdout)
gdm render <file> --track N [--channel K]
                  [--mute-mask 0xE] [--end-sample S]  → WAV/PCM (stdout)
gdm loop   <file> --track N [--len-ms MS] [--rate R]  → log d'écritures APU (stdout)
```

- **`probe`** = la couche « métadonnées », qui **unifie** `nsf-stems.mjs` derrière un
  contrat unique. Elle remplace à terme les scripts JS par format.
- **`render`** = un nouveau `PcmEngine` (interface `PcmRequest`), qui remplace l'appel
  ffmpeg `-f libgme` **pour ce format**. `channelIndex` présent → `gme_mute_voices()`
  des autres voix (ou multi-channel si patché).
- **`loop`** = détection de boucle haute-fidélité : émule la piste et collecte le **log
  d'écritures de registres APU par frame** (via la libgme **patchée**, gardé par
  `GME_HAS_VDM_REGLOG`), consommé par `tools/gdm-loop.mjs` (autocorrélation
  `analyzeStates`, parité `nsf-loop`). GBS uniquement.

### A.2 Frontières — qui fait quoi

```
                ┌─────────── gdm (C++ / libgme) ───────────┐
fichier GBS ──▶ │ probe  → JSON (devices, voices, tags…)    │
                │ loop   → log d'écritures APU (texte)      │
               └│ render → WAV PCM (mix | canal isolé)      │──▶ ffmpeg ──▶ OGG
                └──────────────────────────────────────────┘   (encode,
                       ▲ émulation (coûteux pour `loop`)         fade, crossfade)
```

- **`gdm` n'encode jamais.** Il sort du **PCM/WAV brut** (ou du texte pour `loop`) ;
  **ffmpeg garde** l'encodage OGG/Vorbis, les fondus et le crossfade — exactement la
  chaîne `renderSeamless` actuelle (« engine rend WAV → ffmpeg encode OGG »).
- **Coût.** `probe` = lecture d'en-tête, **instantané**. `loop` = **émulation de la
  piste** (collecte du log de registres APU) → réservé à l'import offline. L'analyse de
  boucle est **par piste** (`--track` requis).

### A.3 Contrat JSON `probe` (l'artefact durable)

Règles : **durées en secondes, `null` = inconnu** (jamais `-1` côté contrat) ;
**`devices[] → voices[]`** (un VGM a plusieurs puces, on le prévoit dès maintenant) ;
**boucle heuristique → `confidence`**. Le schéma est **format-agnostique** : seul le
backend GBS est implémenté d'abord, les autres moteurs s'accrètent dessous.

```jsonc
{
  "schemaVersion": 1,
  "format": "gbs",            // gbs | nsf | vgm | …
  "system": "Game Boy",
  "file": "zelda.gbs",
  "trackCount": 18,
  "tracks": [
    {
      "index": 0,             // 0-based, comme trackIndex côté serveur
      "title": "Title Theme",
      "author": "Koji Kondo",
      "copyright": "1993 Nintendo",
      "length": null,         // null tant que non détecté (timer GBS → pas de durée native)
      "intro": null,          // secondes, null si inconnu
      "loop": {               // probe émet toujours null ; la boucle vient de gdm-loop.mjs
        "start": 12.34,       // secondes
        "length": 30.10,      // secondes
        "confidence": 1.0,    // 1.0 = boucle EXACTE (égalité de frames), pas une heuristique
        "method": "register-log"   // register-log (GBS/NES) | tag | database
      }
    }
  ],
  "devices": [
    {
      "chip": "DMG-APU",      // mappe ChannelInfo.chip ; plusieurs entrées possibles (VGM)
      "voices": [
        { "index": 0, "name": "Square 1", "kind": "pulse" },
        { "index": 1, "name": "Square 2", "kind": "pulse" },
        { "index": 2, "name": "Wave",     "kind": "wave"  },
        { "index": 3, "name": "Noise",    "kind": "noise" }
      ]
    }
  ]
}
```

Correspondance avec `@vdm/shared` (**aucun changement de type requis pour démarrer**) :

| Contrat `gdm` | Type existant |
|---|---|
| `tracks[].loop.{start,length}` | `LoopInfo { loopStart, loopEnd }` (dérivé : `loopEnd = start + length`) |
| `tracks[].length` / `intro` | `RenderInfo` (fallback paramétrique) ou `LoopInfo` |
| `devices[].voices[]` aplati | `ChannelSet.voices[] : ChannelInfo` (`id`, `label`, `chip`, `kind`) |
| `devices[].chip` | `ChannelInfo.chip` (regroupement par puce à l'affichage) |

> L'aplatissement `devices→voices` vers `ChannelSet` se fait **côté importeur** ; le
> regroupement par `chip` est purement présentationnel et n'impose pas de type `Device`
> tant que le MVP ne le réclame pas.

### A.4 Contrat `render`

- Sortie : **WAV PCM 16-bit 44.1 kHz** (ou PCM brut entrelacé) sur stdout, **borné**
  par `--end-sample` (réutilise la logique `endSample` de `PcmRequest`).
- Sélection de canal : `--channel K` (mute des autres via `gme_mute_voices`) **ou**
  `--mute-mask` explicite (décimal ou hexadécimal `0x…`, **pas** de littéral `0b`).
  Absent → **mix complet**.
- *(Stratégie C — différée, hors binaire MVP)* le multi-channel « une passe » (chaque
  voix sur sa propre paire stéréo) exige le chemin **C++ `load_file`** : libgme fixe le
  sample rate dès `gme_open_file`, donc `set_multi_channel` doit être appelé **avant**
  (cf. §2.4/§6.1). Non implémenté dans `gdm` ; le MVP isole par mute (un rendu/voix).

### A.5 Migration — pas de big-bang

1. `gdm` est le chemin **GBS** d'abord (backend libgme déjà couvrant aussi le NSF).
2. **`nsftool` reste** tant que `gdm` n'a pas prouvé la **parité** sur la détection de
   boucle NES ; remplacement seulement après validation comparée.
3. **CLI standalone** (JSON/PCM sur stdout), **pas d'addon N-API** : build Docker propre,
   débogable à la main, agnostique du langage (cohérent avec `nsftool`, et évite la
   galère des binaires natifs en volume Docker signalée dans CLAUDE.md).

### A.6 Découpage de fichiers visé

```
tools/gdm/                       sources C++ (probe + render + loop, setup libgme partagé)
tools/gdm/patches/               patch from-source de libgme (log d'écritures APU)
apps/server/src/render/engines/gdm.ts   PcmEngine → `gdm render …`
tools/gdm-probe.mjs              wrapper d'import → `gdm probe …` → manifeste
tools/gdm-loop.mjs               wrapper d'import → `gdm loop …` → boucle (analyzeStates)
```

Inchangés (génériques) : `builders/emulated.ts`, `render/index.ts`, `libs/shared`,
`LoopPlayer.ts`.

---

### Sources
- libgme — dépôt et entêtes : `gme/gme.h`, `gme/Music_Emu.h`, `gme/Gbs_Emu.{h,cpp}`,
  `gme/Gb_Cpu.cpp`, `gme/gb_cpu_io.h` (call-sites `GME_APU_HOOK`/`GME_FRAME_HOOK`),
  `gme/Classic_Emu.h` (gardes des hooks), `gme/Gb_Apu.h`, `gme/Multi_Buffer.h`
  (<https://github.com/libgme/game-music-emu>, SHA épinglé 0.6.4 `f0d9517`).
- Code du repo : `apps/server/src/render/engines/{libgme,nsftool,types}.ts`,
  `apps/server/src/render/index.ts`, `tools/nsf-{loop,stems}.mjs`,
  `apps/web/src/lib/LoopPlayer.ts`, `libs/shared/src/index.ts`.
