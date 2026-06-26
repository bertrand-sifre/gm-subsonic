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

# --- Image finale -------------------------------------------------------------
FROM node:20-bookworm-slim

# ffmpeg (libvorbis) pour le rendu/transcodage ; ca-certificates pour npm HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Le binaire nsftool (Debian bookworm = même base que l'image finale).
COPY --from=nsfbuilder /nsftool /usr/local/bin/nsftool

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
