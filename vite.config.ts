import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  // relative base so the built app works from any GitHub Pages project path
  // without hardcoding the repo name
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: page('./index.html'),
        design: page('./design.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
