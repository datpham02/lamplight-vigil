import { resolve } from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    open: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        // The game.
        main: resolve(import.meta.dirname, 'index.html'),
        // The GAM-41 embedding harness. Built as well as served, because the
        // criteria it checks — two instances, leak-free destroy, letterboxing
        // inside a container — are about the shipped bundle, not the dev
        // server. It shares every chunk with the game, so it costs one HTML
        // file.
        embed: resolve(import.meta.dirname, 'embed.html'),
      },
    },
  },
});
