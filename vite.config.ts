import { defineConfig, type Plugin } from 'vite';

/** この版の印（ビルドした時刻）。アプリに埋め込み、同じ値を version.json にも書き出す。
 *  開いているアプリは version.json をときどき読み、値が違えば「新しいバージョンがあります」と知らせる */
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) });
    },
  };
}

// base: './' にすると GitHub Pages の「ユーザー名.github.io/リポジトリ名/」でも動く
export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile()],
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
