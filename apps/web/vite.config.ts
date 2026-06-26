import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Écoute sur 0.0.0.0 : indispensable dans Docker pour que Vite soit
    // joignable depuis l'hôte via le port publié (sinon il ne bind que
    // 127.0.0.1 du conteneur, inaccessible).
    host: true,
    port: 5173,
    // Échec immédiat si 5173 est pris, plutôt que de glisser sur 5174 et de
    // casser le mapping de ports 1:1.
    strictPort: true,
    // Le port étant publié 1:1 (5173:5173), on indique au client HMR le port à
    // joindre côté navigateur de l'hôte ; sinon le websocket HMR échoue.
    hmr: {
      clientPort: 5173,
    },
    // Les bind-mounts (Docker Desktop/macOS) ne propagent pas toujours les
    // évènements fs : le polling garantit le hot-reload.
    watch: {
      usePolling: true,
    },
    proxy: {
      // Le front parle au serveur Hono via un proxy en développement.
      // localhost fonctionne car web et serveur tournent dans le même conteneur.
      '/api': 'http://localhost:8787',
    },
  },
});
