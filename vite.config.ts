import { defineConfig } from 'vite';

// base: './' にすると GitHub Pages の「ユーザー名.github.io/リポジトリ名/」でも動く
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 900 },
});
