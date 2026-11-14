// タイトルロゴ「トバセ！」を画像（背景が透明な PNG）に書き出す。
// フォント（Dela Gothic One・Mochiy Pop One、Google Fonts の無料フォント）を読み込むため、ネットにつながる環境で実行する。
// 使い方：node scripts/make-logo.mjs   → src/client/assets/logo.png
import { createRequire } from 'node:module';

// Playwright はこの端末に入っているものを使う（プロジェクトの依存には入れていない）
const { chromium } = createRequire(import.meta.url)('playwright');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Mochiy+Pop+One&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent}
#logo{display:inline-block;padding:70px 50px 20px 190px;font-family:"Dela Gothic One",sans-serif}
.l{position:relative;transform:skewX(-12deg) rotate(-4deg)}
.t{font-size:150px;line-height:1;color:#ffd23f;-webkit-text-stroke:11px #1b1f3b;paint-order:stroke fill;text-shadow:9px 9px 0 #ff5a3d,16px 16px 0 #1b1f3b;letter-spacing:-.02em;white-space:nowrap}
.t .x{display:inline-block;transform:translate(14px,-36px) rotate(18deg);color:#fff}
.lines{position:absolute;left:-190px;top:30px;width:190px}
.lines i{display:block;height:12px;margin:12px 0;border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,0),#fff)}
.lines i:nth-child(2){width:80%;margin-left:20%}.lines i:nth-child(3){width:60%;margin-left:40%}
.sub{font-family:"Mochiy Pop One",sans-serif;color:#fff;font-size:24px;letter-spacing:.4em;text-align:center;margin-top:10px;padding-left:40px;-webkit-text-stroke:5px #1b1f3b;paint-order:stroke fill}
</style></head><body><div id="logo"><div class="l"><div class="lines"><i></i><i></i><i></i></div><div class="t">トバセ<span class="x">！</span></div></div><div class="sub">TOBASE!</div></div></body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: 2 });
await p.setContent(html, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
const ok = await p.evaluate(() => document.fonts.check('150px "Dela Gothic One"'));
if (!ok) throw new Error('フォントが読み込めませんでした');
await p.locator('#logo').screenshot({ path: 'src/client/assets/logo.png', omitBackground: true });
await b.close();
console.log('src/client/assets/logo.png を書き出しました');
