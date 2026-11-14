// アプリのアイコン（案A：紺の背景に、ロゴと同じ黄色い斜めの「ト」と流れる線、「！」）を PNG で書き出す。
// フォント（Dela Gothic One、Google Fonts の無料フォント）を読み込むため、ネットにつながる環境で実行する。
// 使い方：npm run icons   → public/icons/ の4つのファイル
import { createRequire } from 'node:module';

// Playwright はこの端末に入っているものを使う（プロジェクトの依存には入れていない）
const { chromium } = createRequire(import.meta.url)('playwright');

/**
 * 512×512 の絵を、size の大きさで書き出す。
 * inner は絵柄の縮小率（Android の丸く切り抜かれるアイコン用に、大事な部分を真ん中の安全な範囲に収める）
 */
const page = (size, inner) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${size}px;height:${size}px;overflow:hidden}
body{background:radial-gradient(circle at 35% 30%,#3a3f8f,#1b1f3b 70%)}
.stage{position:absolute;left:0;top:0;width:512px;height:512px;transform-origin:0 0;transform:scale(${size / 512}) translate(${(512 * (1 - inner)) / 2}px,${(512 * (1 - inner)) / 2}px) scale(${inner});font-family:"Dela Gothic One",sans-serif}
.t{position:absolute;left:150px;top:60px;font-size:330px;line-height:1;color:#ffd23f;-webkit-text-stroke:16px #1b1f3b;paint-order:stroke fill;text-shadow:14px 14px 0 #ff5a3d,24px 24px 0 #0e1024;transform:skewX(-12deg) rotate(-6deg)}
.x{position:absolute;right:52px;top:40px;font-size:150px;line-height:1.2;color:#fff;-webkit-text-stroke:12px #1b1f3b;paint-order:stroke fill;transform:rotate(22deg)}
.lines i{position:absolute;height:18px;border-radius:18px;background:linear-gradient(90deg,rgba(255,255,255,0),#fff)}
</style></head><body><div class="stage"><div class="lines"><i style="left:30px;top:200px;width:150px"></i><i style="left:60px;top:250px;width:120px"></i><i style="left:90px;top:300px;width:90px"></i></div><div class="t">ト</div><div class="x">！</div></div></body></html>`;

const outputs = [
  { file: 'public/icons/icon-512.png', size: 512, inner: 1 },
  { file: 'public/icons/icon-192.png', size: 192, inner: 1 },
  { file: 'public/icons/apple-touch-icon.png', size: 180, inner: 1 },
  // Android の「丸く切り抜かれるアイコン」は、真ん中の 80% の円の中だけが確実に見える
  { file: 'public/icons/icon-512-maskable.png', size: 512, inner: 0.74 },
];

const b = await chromium.launch();
const p = await b.newPage();
for (const o of outputs) {
  await p.setViewportSize({ width: o.size, height: o.size });
  await p.setContent(page(o.size, o.inner), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const ok = await p.evaluate(() => document.fonts.check('100px "Dela Gothic One"'));
  if (!ok) throw new Error('フォントが読み込めませんでした');
  await p.screenshot({ path: o.file });
  console.log(`${o.file}（${o.size}×${o.size}）を書き出しました`);
}
await b.close();
