# gm-subsonic

**Serveur musical spécialisé dans les bandes-son de jeux vidéo.**

[![container](https://github.com/bertrand-sifre/gm-subsonic/actions/workflows/container.yml/badge.svg)](https://github.com/bertrand-sifre/gm-subsonic/actions/workflows/container.yml)

Là où un serveur classique sait « jouer un fichier audio », celui-ci veut **jouer une
musique de jeu avec son comportement original** : intro, boucle à l'échantillon près, fin
personnalisée, et — à terme — variantes, pistes (stems) et couches dynamiques.

Il décode nativement les formats des puces sonores rétro (NES, Game Boy, SNES, Megadrive,
Amiga, C64, PC AdLib…) et les sert de deux façons :

- **Clients Subsonic classiques** (Symfonium, Feishin, DSub…) → le serveur « rend » la
  musique en un flux audio normal via **ffmpeg** (*intro + N boucles + fondu*). Le client
  ne voit qu'une chanson ordinaire.
- **Client web avancé** (inclus) → lecteur **Web Audio** qui reproduit la boucle à
  l'échantillon près et, à terme, mixe les stems en direct.

> Le projet s'appelle `vdm-subsonic` dans le code (monorepo), publié sous le dépôt
> `gm-subsonic`.

---

## Démarrage rapide (Docker)

L'image de production est **tout-en-un** : un seul conteneur sert l'interface web **et**
l'API Subsonic sur le port `8787`.

### Avec `docker run`

```bash
docker run -d --name gm-subsonic \
  -p 8787:8787 \
  -v "$PWD/library:/app/library:ro" \
  -v gm-media:/app/media \
  ghcr.io/bertrand-sifre/gm-subsonic:latest
```

- `-v $PWD/library:/app/library:ro` → tes fichiers de musique (NSF, GBS, SPC…), en lecture seule.
- `-v gm-media:/app/media` → catalogue généré + cache audio rendu à la demande (à persister).

Puis ouvre **http://localhost:8787**. Au démarrage, le conteneur décode (incrémental) les
fichiers trouvés dans `library/` et construit le catalogue.

### Avec Docker Compose

Le dépôt fournit `compose.prod.yaml` :

```bash
docker compose -f compose.prod.yaml up -d      # construit l'image et lance
```

> **Accès au registre** : si le package GHCR est privé, fais d'abord
> `echo $GHCR_TOKEN | docker login ghcr.io -u <ton-user> --password-stdin`, ou
> [construis l'image toi-même](#construire-limage-soi-même).

---

## Ajouter de la musique

Dépose tes fichiers dans le dossier monté sur `/app/library` (sous-dossiers acceptés) :

```
library/
├── Zelda - Link's Awakening.gbs
├── Super Mario Bros.nsfe
└── Chrono Trigger.spc
```

Redémarre le conteneur (`docker restart gm-subsonic`) : l'**import** se relance, décode les
nouveaux fichiers (cache par taille/date → rapide), détecte les points de boucle quand le
format le permet, et met à jour le catalogue. Pour sauter l'import à un démarrage, passe
`-e VDM_SKIP_IMPORT=1`.

---

## Écouter

### Depuis un client Subsonic

Le serveur parle l'**API Subsonic / OpenSubsonic** sur `/rest/*` (browse + lecture :
`ping`, `getArtists`, `getAlbumList2`, `getAlbum`, `stream`, `getCoverArt`, `scrobble`…).
Configure ton client (Symfonium, Feishin, DSub, airsonic-refix…) avec :

| Champ | Valeur |
|---|---|
| URL serveur | `http://<hôte>:8787` |
| Identifiant / mot de passe | **n'importe lesquels** (auth = stub local, mono-utilisateur) |

### Depuis le lecteur web intégré

Ouvre simplement **http://localhost:8787** : le SPA liste la bibliothèque par jeu et la joue
avec le lecteur Web Audio (`LoopPlayer`) — choix du comportement (`once`, `loopInfinite`,
`loopCount`, `loopCountFade`), nombre de boucles, durée de fondu.

---

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8787` | Port d'écoute du serveur. |
| `VDM_SKIP_IMPORT` | `0` | `1` = ne pas (ré)importer la bibliothèque au démarrage. |
| `VDM_GBS_LOOP` | `1` | Détection de boucle GBS (Game Boy). `0` pour la désactiver. |
| `VDM_NSFPLAY` | `nsftool` | Chemin/nom du binaire nsftool (NES). |
| `VDM_GDM` | `gdm` | Chemin/nom du binaire gdm (GBS). |

| Volume | Rôle |
|---|---|
| `/app/library` | **Tes sources** VGM (montage lecture seule conseillé). |
| `/app/media` | Catalogue généré + caches de boucle/stems + OGG rendus à la demande (`_cache/`) — **à persister**. |

Port exposé : **`8787`** (interface web + `/api/*` + `/rest/*`).

---

## Formats supportés

Plus de 40 formats de puces et trackers rétro. Légende : **Oui** = supporté nativement ;
**Partiel** = faisable mais à granularité grossière ou via contournement ; **Non** = absent.

<details>
<summary><b>Voir le tableau complet</b></summary>

| Format | Console | Lecture | Intro | Loop | Canal | Émulateur |
|---|---|---|---|---|---|---|
| AHX | Commodore Amiga | Oui | Partiel | Partiel | Oui | libhvl |
| AY | Amstrad CPC/ZX/Atari ST | Oui | Non | Non | Oui | libgme / ZXTune |
| COP | Sam Coupé | Oui | Non | Oui | Non | SCPlayer (+ SAASound) |
| DSF | Sega Dreamcast | Oui | Non | Partiel | Non | Highly_Theoretical |
| GBS | Nintendo Game Boy | Oui | Oui | Oui | Oui | `gdm` (libgme patchée) |
| GSF | Nintendo Game Boy Advance | Oui | Non | Non | Non/Partiel | mGBA + psflib |
| GYM | Sega Megadrive/Genesis | Oui | Partiel | Partiel | Oui | libgme / libvgm |
| HES | PC Engine | Oui | Non | Non | Oui | libgme (`Hes_Emu`) |
| HVL | Commodore Amiga | Oui | Partiel | Partiel | Oui | libhvl |
| IMF | PC (Apogee) | Oui | Non | Partiel | Non | AdPlug |
| KSS | MSX | Oui (sans FM) | Non | Non | Oui | libgme / libkss |
| MDX | Sharp X68000 | Oui | Non | Partiel | Partiel | mdxmini |
| MOD | Commodore Amiga | Oui | Partiel | Partiel | Oui | libopenmpt |
| NSF | Nintendo NES | Oui | Oui | Oui | Oui | libgme + nsftool |
| NSFE | Nintendo NES (tags) | Oui | Oui | Oui | Oui | libgme + nsftool |
| ORC | TRS-80 Orchestra-90 | Partiel | Non | Non | Non | trs80gp (hors MVP) |
| PSF | Sony PlayStation | Oui | Non | Partiel | Non | aopsf/aosdk |
| PSF2 | Sony PlayStation 2 | Oui | Non | Partiel | Non | aopsf/aosdk |
| QSF | Capcom QSound | Oui | Non | Partiel | Non | aosdk (`eng_qsf`) |
| RAW | PC AdLib | Oui | Non | Partiel | Non | AdPlug |
| ROL | PC AdLib (Visual Composer) | Oui | Non | Non | Non | AdPlug |
| S3M | PC (GUS/SoundBlaster) | Oui | Partiel | Partiel | Oui | libopenmpt |
| S98 | NEC PC-98 | Oui | Oui (v3) | Oui (v3) | Oui | libvgm (`s98player`) |
| SAP | Atari XL/XE | Oui | Non | Partiel | Oui | ASAP / libgme |
| SCI | PC (Sierra) | Partiel | Non | Partiel | Non | AdPlug |
| SID | Commodore 64 | Oui | Non | Partiel | Oui | libsidplayfp (+ reSIDfp) |
| SNDH | Atari ST | Oui | Non | Partiel | Partiel | AtariAudio / sc68 |
| SPC | Super Nintendo | Oui | Partiel (xid6) | Partiel (xid6) | Oui | snes_spc (libgme) |
| SPU | Sony PlayStation | Oui | Partiel | Oui (bloc) | Non | vgmstream / aosdk |
| SSF | Sega Saturn | Oui | Non | Partiel | Non | Highly_Theoretical |
| VGM | Sega Master System/Game Gear… | Oui | Oui | Oui | Oui | libvgm / libgme |
| VTX | Spectrum Vortex Tracker | Oui | Oui (frame) | Oui (frame) | Oui | ZXTune / ayfly |
| WSR | Bandai WonderSwan | Oui | Non | Non | Partiel | Mednafen (wswan) |
| YM | Amstrad CPC/ZX/Atari ST | Oui | Oui (frame) | Oui (frame) | Non | StSound (+ ZXTune) |

*(frame)* = boucle à la frame (~20 ms), pas à l'échantillon ; *(v3)* = révision S98 v3 ;
*(xid6)* = si le tag xid6 est présent. Détail des familles d'émulateurs et de la stratégie
boucle/stems : voir [`CLAUDE.md`](CLAUDE.md).

</details>

À ce jour, la chaîne complète (décodage, boucle frame-exacte, stems par canal) est validée
de bout en bout pour **NSF/NSFE** (NES) et **GBS** (Game Boy).

---

## Construire l'image soi-même

```bash
docker build -f Dockerfile.prod -t gm-subsonic:prod .
```

Le build est multi-stage : compilation de `nsftool` (cœur de nsfplay) et de `gdm` (libgme
**patchée**, liée en statique), build du front (`nx build web`), puis image finale lean
(Node 20 + ffmpeg + binaires + dépendances de production via `npm ci --omit=dev`).

### Publication automatique (CI)

`.github/workflows/container.yml` construit l'image via **Nx** (`nx run server:container`,
exécuteur `@nx-tools/nx-container`) et la **pousse sur GHCR** à chaque push sur `main` (et
sur les tags). Tags générés : `:main`, `:latest`, `:sha-<court>` ; un push de tag `vX.Y.Z`
ajoute `:vX.Y.Z` et `:X.Y.Z`. Les PR ne font qu'un build de validation (pas de push).

---

## Développement

Le dev se fait dans un conteneur (Node 20 + ffmpeg), avec rechargement à chaud (Vite + tsx) :

```bash
docker compose build                          # une fois
docker compose run --rm app npm install       # installe les deps (volume nommé)
docker compose run --rm app npm run fixtures   # génère des fixtures de test
docker compose up                              # lance front + API
#   front : http://localhost:5173   (proxy /api -> 8787)
#   API   : http://localhost:8787
```

Commandes Nx utiles (dans le conteneur) : `npm run dev`, `npm run typecheck`, `npm run build`.

---

## Architecture (monorepo Nx)

```
apps/
  server/   API Hono : scan de bibliothèque + rendu + streaming + API Subsonic
  web/      Front Svelte 4 + lecteur Web Audio (LoopPlayer)
libs/
  shared/   Types TypeScript partagés (@vdm/shared)
tools/
  gdm/      CLI C++ (libgme patchée) : boucle + stems GBS
  nsftool/  CLI C++ (nsfplay) : canal isolé + détection de boucle NES
```

Documentation détaillée par module : [`CLAUDE.md`](CLAUDE.md),
[`apps/server/CLAUDE.md`](apps/server/CLAUDE.md), [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md).

Stack : TypeScript full-stack, Nx, Vite 5, Svelte 4, Hono, music-metadata, ffmpeg.

---

## Licences

Le serveur orchestre plusieurs émulateurs aux licences variées (libgme **LGPL-2.1** liée en
statique avec patch + sources épinglées ; libopenmpt/StSound permissives ; libvgm/ASAP/
libsidplayfp/AdPlug **GPL** ; aosdk usage non commercial). Voir [`CLAUDE.md`](CLAUDE.md) pour
l'arbitrage par famille de formats.
</content>
