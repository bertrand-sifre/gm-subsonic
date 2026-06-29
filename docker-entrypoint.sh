#!/bin/sh
# Entrypoint de PRODUCTION (cf. Dockerfile.prod). Prépare les dossiers de données,
# importe la bibliothèque (décodage incrémental des sources de library/), puis
# lance le serveur Hono via tsx. Volontairement en /bin/sh (pas de bashisme).
set -e

# Dossiers de données (montés en volume en prod). config.ts fige media/ et
# library/ relativement au code (/app, via import.meta.url) -> chemins en dur.
# On garantit leur présence, un cache inscriptible, et un manifeste lisible (le
# scan tolère un manifeste vide mais lit le fichier).
mkdir -p /app/media/_cache /app/library
[ -f /app/media/meta.json ] || echo '{"tracks":[]}' > /app/media/meta.json

# Import incrémental : ffprobe/gdm/nsftool décodent les nouveaux fichiers de
# library/ et écrivent media/library.generated.json (caché par mtime/size, donc
# rapide aux démarrages suivants). Désactivable via VDM_SKIP_IMPORT=1. Le `||`
# garantit que le serveur démarre même si l'import échoue (catalogue partiel
# plutôt que conteneur qui refuse de démarrer).
if [ "${VDM_SKIP_IMPORT:-0}" != "1" ]; then
  echo "[vdm] import de la bibliothèque…"
  node /app/tools/import-library.mjs || echo "[vdm] import échoué — démarrage quand même"
fi

# cwd = /app : serveStatic résout apps/web/dist relativement au cwd. `exec` pour
# que le serveur devienne le process suivi par tini (signaux/arrêt propres).
cd /app
exec node_modules/.bin/tsx apps/server/src/main.ts
