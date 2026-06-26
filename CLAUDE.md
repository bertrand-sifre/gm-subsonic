# vdm-subsonic

Serveur musical spécialisé dans les **bandes-son de jeux vidéo**. Là où un serveur
classique sait « jouer un fichier audio », celui-ci veut « jouer une musique de jeu
avec son comportement original » : intro, boucle, fin personnalisée, variantes,
pistes (stems) et couches dynamiques.

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

## Phasage

| Tranche | Contenu | État |
|---|---|---|
| T1 | Boucle : intro / boucle / fin personnalisée + UI web | **fait, vérifié end-to-end** |
| T2 | Modèle bibliothèque Jeu→Compositeur→Plateforme→Album→Morceau, recherche | à venir |
| T3 | Compat Subsonic (rendu serveur ffmpeg) | à venir |
| T4 | Variantes + stems synchronisés (Web Audio) | à venir |
| T5 | Musique dynamique : couches + machine à états (exploration↔combat) | à venir |
