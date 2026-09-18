import { defineConfig } from 'vite';

export default defineConfig({
  // relative base so the built app works from any GitHub Pages project path
  // without hardcoding the repo name
  base: './',
  test: {
    environment: 'node',
  },
});
