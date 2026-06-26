# Image de DÉVELOPPEMENT (pas de build de prod).
# Le code est monté en bind-mount et les deps vivent dans un volume dédié
# (voir compose.yaml) : ici on ne fait qu'apporter Node 20 + ffmpeg.
FROM node:20-bookworm-slim

# ffmpeg (compilé avec libvorbis sur Debian) pour transcoder les fixtures en
# Ogg Vorbis. ca-certificates au cas où npm doit parler en HTTPS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Réglages confort de dev :
#  - pas de prompts/fund/audit npm ;
#  - polling pour le file-watching (les bind-mounts macOS ne propagent pas
#    toujours les évènements inotify) ;
#  - démon Nx désactivé (évite les soucis de socket à travers le mount).
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
