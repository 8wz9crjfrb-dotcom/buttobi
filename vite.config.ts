import { defineConfig } from 'vite';

// base: './' にすると GitHub Pages の「ユーザー名.github.io/リポジトリ名/」でも動く
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // 3D の部品（three.js）は別のファイルにする。アプリを更新しても three.js のファイル名は変わらないので、
        // 端末に保存したものをそのまま使え、更新のたびに読み込み直さずにすむ
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
