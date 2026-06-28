# vdm-subsonic

Serveur musical spécialisé dans les **bandes-son de jeux vidéo**. Là où un serveur
classique sait « jouer un fichier audio », celui-ci veut « jouer une musique de jeu
avec son comportement original » : intro, boucle, fin personnalisée, variantes,
pistes (stems) et couches dynamiques.

# Support des formats

Voici la liste des formats pour chaque format on ecrit le statut de son implémentation.

| Format | Console | Lecture | Intro | Loop | Canal | Émulateur |
|---|---|---|---|---|---|---|
| AHX | Commodore Amiga | Oui | Partiel | Partiel | Oui | libhvl (replayer HivelyTracker) |
| AY | Amstrad CPC/Spectrum ZX/Atari ST | Oui | Non | Non | Oui | libgme (`Ay_Emu`) / ZXTune |
| COP | Sam Coupe | Oui | Non | Oui | Non | SCPlayer (+ SAASound) |
| DSF | Sega Dreamcast | Oui | Non | Partiel | Non | Highly_Theoretical (aosdk) |
| GBS | Nintendo Gameboy | Oui | Oui | Oui | Oui | `gdm` : libgme `Gbs_Emu` patchée (mix + canal par mute + log registres APU) |
| GSF | Nintendo Gameboy Advance | Oui | Non | Non | Non/Partiel | mGBA + psflib |
| GYM | Sega Megadrive/Genesis | Oui | Partiel | Partiel | Oui | libgme / libvgm |
| HES | PC Engine | Oui | Non | Non | Oui | libgme (`Hes_Emu`) |
| HVL | Commodore Amiga | Oui | Partiel | Partiel | Oui | libhvl (replayer HivelyTracker) |
| IMF | PC-compatibles, various Apogee games | Oui | Non | Partiel | Non | AdPlug |
| KSS | MSX | Oui (sans FM) | Non | Non | Oui | libgme (`Kss_Emu`) / libkss (FM) |
| MDX | Sharp X68000 | Oui | Non | Partiel | Partiel | mdxmini |
| MOD | Commodore Amiga | Oui | Partiel | Partiel | Oui | libopenmpt |
| NSF | Nintendo NES | Oui | Oui | Oui | Oui | libgme (mix) + nsftool (canal isolé) |
| NSFE | Nintendo NES (enhanced tags) | Oui | Oui | Oui | Oui | libgme (mix) + nsftool (canal isolé) |
| ORC | TRS-80 Orchestra-90 | Partiel | Non | Non | Non | trs80gp/TRS32 (émulateur, hors MVP) |
| PSF | Sony PlayStation | Oui | Non | Partiel | Non | aopsf/aosdk (Highly Experimental) |
| PSF2 | Sony PlayStation II | Oui | Non | Partiel | Non | aopsf/aosdk |
| QSF | Capcom QSound | Oui | Non | Partiel | Non | aosdk (`eng_qsf`) |
| RAW | PC-compatibles with an AdLib | Oui | Non | Partiel | Non | AdPlug |
| ROL | PC-compatibles, AdLib Visual Composer | Oui | Non | Non | Non | AdPlug |
| S3M | PC-compatibles with a GUS or SoundBlaster | Oui | Partiel | Partiel | Oui | libopenmpt |
| S98 | NEC PC-98 | Oui | Oui (v3) | Oui (v3) | Oui | libvgm (`s98player`) |
| SAP | Atari XL/XE | Oui | Non | Partiel | Oui | ASAP / libgme (`Sap_Emu`) |
| SCI | PC-compatibles, various Sierra games | Partiel | Non | Partiel | Non | AdPlug |
| SID | Commodore 64 | Oui | Non | Partiel | Oui | libsidplayfp (+ reSIDfp) |
| SNDH | Atari ST | Oui | Non | Partiel | Partiel | AtariAudio / sc68 |
| SPC | Super Nintendo | Oui | Partiel (xid6) | Partiel (xid6) | Oui | snes_spc (via libgme) |
| SPU | Sony Playstation | Oui | Partiel | Oui (bloc) | Non | vgmstream / aosdk (`eng_spu`) |
| SSF | Sega Saturn | Oui | Non | Partiel | Non | Highly_Theoretical (aosdk) |
| VGM | Sega Master System/Game Gear (and lots more) | Oui | Oui | Oui | Oui | libvgm (`vgmplayer`) / libgme |
| VTX | Spectrum Vortex Tracker | Oui | Oui (frame) | Oui (frame) | Oui | ZXTune / ayfly |
| WSR | Bandai WonderSwan/Wonderswan Color | Oui | Non | Non | Partiel | Mednafen (cœur wswan) |
| YM | Amstrad CPC/Spectrum ZX/Atari ST | Oui | Oui (frame) | Oui (frame) | Non | StSound (+ ZXTune pour le canal) |

Légende : **Oui** = supporté nativement par une API ; **Partiel** = faisable mais sans API
dédiée, à granularité grossière (frame ~20 ms, bloc ADPCM = 28 échantillons) ou via
contournement ; **Non** = absent. Précisions : *(frame)* = boucle à la frame, pas à
l'échantillon ; *(v3)* = uniquement la révision S98 v3 ; *(xid6)* = seulement si le tag
xid6 est présent ; KSS sans le son FM/OPLL (→ libkss pour le FM).

Trois familles selon ce que le format expose :
- **Logs de registres** (VGM, S98 v3, YM, VTX, GYM) → meilleurs candidats : point de boucle
  explicite **et** mute de canal. Cible idéale **libvgm** (`SetDeviceMuting` + `loopTick`).
- **Émulation chip + driver** (SID, SPC, SAP, GBS, HES, KSS, AY…) → lecture + mute de canal
  OK (`gme_mute_voice`, `mute()`…), mais **pas de point de boucle natif** : recourir aux
  tags (xid6), à une base de durées (HVSC pour SID) ou à une détection de boucle maison.
  **Réalisé pour le GBS** : binaire `gdm` (libgme **patchée**, liée en statique) → log
  d'écritures de registres APU par frame → boucle **frame-exacte** (parité nsf-loop) +
  stems par mute. Détails : `docs/etude-gbs-libgme.md`.
- **Famille *SF / exécutable émulé** (PSF, PSF2, QSF, DSF, SSF, GSF) → lecture excellente
  mais **ni intro/loop exposés, ni isolation de canal** par API (boucle interne au
  séquenceur). Mal adaptés aux stems Web Audio sans patcher l'émulateur.

⚠️ La famille **\*SF** (PSF/PSF2/QSF/DSF/SSF/GSF) relève de **aosdk / Highly Experimental**,
**pas de vgmstream** : vgmstream ne lit que **SPU** (flux PS-ADPCM brut). Licences à
arbitrer : libgme (LGPL-2.1), libopenmpt/StSound/AtariAudio (permissives) sont linkables ;
libvgm/ASAP/libsidplayfp/AdPlug (GPL), Highly_Theoretical (GPL-3.0), aosdk (licence non-OSI,
usage non commercial). **Hors MVP** : ORC (aucune lib réutilisable) et GSF (cœur GBA complet).

## Décision d'architecture : compat Subsonic + modèle hybride

L'exigence de compatibilité avec les lecteurs existants est satisfaite en implémentant
(à terme) l'**API Subsonic / OpenSubsonic**, parlée par de nombreux clients (Symfonium,
Feishin, DSub…). La lecture suit un **modèle hybride** :

- **Clients classiques** → le serveur « rend » la musique de jeu en un flux audio
  normal via **ffmpeg** (ex. *intro + N boucles + fondu*). Le client ne voit qu'une
  chanson ordinaire.
- **Client web avancé** → une API enrichie expose points de boucle, variantes, stems ;
  la lecture interactive se fait dans le navigateur via la **Web Audio API** (boucle à
  l'échantillon près, mixage des stems en direct). Une balise `<audio>` ne suffit pas.

## Monorepo (Nx)

```
apps/
  server/   API Hono : scan de bibliothèque + streaming      → voir apps/server/CLAUDE.md
  web/      Front Svelte 4 + lecteur Web Audio (LoopPlayer)   → voir apps/web/CLAUDE.md
libs/
  shared/   Types TypeScript partagés (@vdm/shared)           → voir libs/shared/CLAUDE.md
tools/
  gen-fixtures.mjs   Génère les fixtures audio de test (OGG + tags de boucle)
media/
  meta.json          Manifeste plat de la bibliothèque (+ fichiers .ogg générés)
```

Stack : TypeScript full-stack, Nx, Vite 5, Svelte 4, Hono, music-metadata.

## Développement (dans Docker)

Le dev se fait dans un conteneur (Node 20 + **ffmpeg**), cf. `Dockerfile` / `compose.yaml`.

```bash
docker compose build                          # une fois (image Node 20 + ffmpeg)
docker compose run --rm app npm install       # installe les deps (volume nommé)
docker compose run --rm app npm run fixtures   # génère media/*.ogg + tags de boucle
docker compose up                              # lance les 2 serveurs (dev)
#   front  : http://localhost:5173   (proxy /api -> 8787)
#   API    : http://localhost:8787
docker compose down                            # arrêt  (-v pour réinitialiser les deps)
```

Commandes Nx utiles (à lancer dans le conteneur) :
`npm run dev` (serve web+server), `npm run typecheck` (les 3 projets), `npm run build`.

## Conventions

- **Commentaires et docs en français.** Identifiants et termes techniques en anglais.
- Types partagés dans `@vdm/shared` ; ne pas dupliquer un type côté app.
- Modules **ESM** partout (`"type": "module"`).
- Périmètre **MVP volontairement réduit** : on ne modélise que l'intro/boucle/fin.
  Variantes, stems et couches viendront aux tranches 4-5 — ne pas sur-spécifier avant.

## Pièges connus

- `slugify` (server) **retire l'extension** : l'id de `gerudo-valley.ogg` est `gerudo-valley`.
- `media/meta.json` est **requis** au démarrage du serveur (sinon il quitte). Les `.ogg`
  absents ne sont qu'un warning.
- `node_modules` vit dans un **volume Docker nommé**, jamais le `node_modules` de l'hôte
  (binaires macOS arm64 vs linux). Après changement de deps : `docker compose down -v`.
