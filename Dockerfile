# Image de DÉVELOPPEMENT (pas de build de prod).
# Le code applicatif est monté en bind-mount au runtime (voir compose.yaml) ;
# ici on apporte Node 20 + ffmpeg + nsftool (émulateur NES nsfplay).

# --- Stage builder : compile nsftool sur le cœur portable de nsfplay ----------
# nsftool = petit CLI maison (tools/nsftool/nsftool.cpp) sur la bibliothèque
# xgm de bbbradsmith/nsfplay. Il expose ce que libgme ne donne pas : rendu par
# canal (MASK/solo), log des écritures de registres APU (LOG_CPU) et détection
# de boucle moteur (--detect). Compilé ici, seul le binaire part dans l'image.
FROM debian:bookworm-slim AS nsfbuilder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# TODO repro : épingler un commit précis de nsfplay plutôt que la branche par défaut.
RUN git clone --depth 1 https://github.com/bbbradsmith/nsfplay nsfplay
COPY tools/nsftool/nsftool.cpp nsfplay/contrib/nsftool.cpp
RUN cd nsfplay/contrib \
 && make release \
 && g++ -O2 -std=c++17 -Wall -Wno-deprecated-declarations \
      -o /nsftool nsftool.cpp libnsfplay.a -lm

# --- Stage builder : compile libgme PATCHÉE (from-source) puis gdm ------------
# gdm = petit CLI maison (tools/gdm/gdm.cpp) lié à libgme (API C, gme.h). Il expose
# pour le GBS ce que le démuxeur ffmpeg `-f libgme` ne donne pas : rendu par canal
# (mute des autres voix), probe des voix/tags, et — via un PATCH from-source — un
# LOG D'ÉCRITURES de registres APU par frame (sous-commande `loop`, détection de
# boucle haute-fidélité en parité avec nsftool ; cf. tools/gdm/patches/
# libgme-reglog.patch et tools/nsf-loop.mjs). On NE prend donc PLUS libgme d'apt :
# on clone le dépôt à un SHA ÉPINGLÉ (libgme 0.6.4), on applique le patch, puis on
# build/install une libgme.a STATIQUE (le gme.h patché définit GME_HAS_VDM_REGLOG
# -> `loop` est compilé ; probe/render compileraient aussi contre une libgme stock).
# Le lien STATIQUE confine la libgme patchée DANS le binaire gdm : aucun recouvrement
# avec le libgme0 STOCK tiré par ffmpeg dans l'image finale. git/cmake/sources ne
# servent QU'ICI (l'image finale ne les embarque pas). GME_ZLIB=OFF : pas de VGZ dans
# gdm (GBS uniquement ; le VGZ passe par ffmpeg) -> évite -lz au lien statique.
# Licence : libgme LGPL-2.1, lien statique -> clause de relink §6 satisfaite (patch
# + sources épinglées versionnés).
FROM debian:bookworm-slim AS gdmbuilder
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake pkg-config git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# libgme PATCHÉE, from-source, SHA ÉPINGLÉ (TODO repro satisfait : libgme 0.6.4).
ARG LIBGME_SHA=f0d9517c5c3e0b712f553baa62e213336587d52e
RUN git clone https://github.com/libgme/game-music-emu libgme \
 && git -C libgme checkout ${LIBGME_SHA}
COPY tools/gdm/patches/libgme-reglog.patch ./
# `git apply --check` d'abord (échoue tôt et clairement si les ancres dérivent).
RUN git -C libgme apply --check ../libgme-reglog.patch \
 && git -C libgme apply ../libgme-reglog.patch
RUN cmake -S libgme -B libgme/build -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF -DGME_BUILD_SHARED=OFF -DGME_BUILD_STATIC=ON \
      -DGME_BUILD_EXAMPLES=OFF -DGME_BUILD_TESTING=OFF -DGME_ZLIB=OFF \
      -DCMAKE_INSTALL_PREFIX=/usr/local \
 && cmake --build libgme/build -j \
 && cmake --install libgme/build
# Copier UNIQUEMENT les sources de gdm (pas un éventuel gdm/build/ compilé sur
# l'hôte : son CMakeCache.txt pointe des chemins/compilateur macOS et casserait ce
# stage). pkg-config résout /usr/local/lib/pkgconfig/libgme.pc (libgme.a + gme.h
# patché -> GME_HAS_VDM_REGLOG défini -> `loop` compile).
COPY tools/gdm/CMakeLists.txt tools/gdm/gdm.cpp tools/gdm/wav.h ./gdm/
RUN cmake -S gdm -B gdm/build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build gdm/build --target gdm -j

# --- Image finale -------------------------------------------------------------
FROM node:20-bookworm-slim

# ffmpeg (libvorbis) pour le rendu/transcodage ; ca-certificates pour npm HTTPS.
# Plus de token `libgme0` explicite : gdm embarque sa libgme PATCHÉE en STATIQUE, et
# ffmpeg re-tire de toute façon libgme0 (STOCK) transitivement pour ffprobe `-f libgme`
# (probeGlobal/probeTrack). Ce libgme0 stock reste séparé de la libgme patchée confinée
# dans le binaire gdm (pas de recouvrement de symboles).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Le binaire nsftool (Debian bookworm = même base que l'image finale).
COPY --from=nsfbuilder /nsftool /usr/local/bin/nsftool
# Le binaire gdm (libgme patchée liée en STATIQUE), résolu par nom dans le PATH côté
# serveur (VDM_GDM). NEEDED : libstdc++/libm/libc/libgcc_s ; PLUS de libgme.so.
COPY --from=gdmbuilder /build/gdm/build/gdm /usr/local/bin/gdm

# Réglages confort de dev :
#  - pas de prompts/fund/audit npm ;
#  - polling pour le file-watching (bind-mounts macOS) ;
#  - démon Nx désactivé (soucis de socket à travers le mount).
ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NX_DAEMON=false

WORKDIR /app

# On ne COPY pas le code et on n'installe rien ici : tout est monté/installé
# au runtime par compose pour garder l'image légère et le cycle de dev rapide.
EXPOSE 5173 8787

CMD ["npm", "run", "dev"]
