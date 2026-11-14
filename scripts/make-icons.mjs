// アプリのアイコン（爆発と、×目で吹っ飛ぶ青い丸いキャラ。背景に集中線）を PNG で書き出す。
// 絵はすべて SVG で描くので、フォントやネットは要らない。
// 使い方：npm run icons   → public/icons/ の4つのファイル
import { createRequire } from 'node:module';

// Playwright はこの端末に入っているものを使う（プロジェクトの依存には入れていない）
const { chromium } = createRequire(import.meta.url)('playwright');

const star = (cx, cy, n, r1, r2, rot = 0) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = (i / (n * 2)) * Math.PI * 2 + rot;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  // 角を丸めた線（二次ベジェ）
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    d += i === 0 ? `M${m[0]},${m[1]}` : '';
    const nq = pts[(i + 1) % pts.length], nm = [(nq[0] + pts[(i + 2) % pts.length][0]) / 2, (nq[1] + pts[(i + 2) % pts.length][1]) / 2];
    d += ` Q${nq[0]},${nq[1]} ${nm[0]},${nm[1]}`;
  }
  return d + 'Z';
};
const face = (cx, cy, r, col, dark, eyes = 'normal') => `
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" stroke="#1b1f3b" stroke-width="${r * 0.12}"/>
  <ellipse cx="${cx - r * 0.32}" cy="${cy - r * 0.38}" rx="${r * 0.28}" ry="${r * 0.16}" fill="#fff" opacity=".45" transform="rotate(-30 ${cx - r * 0.32} ${cy - r * 0.38})"/>
  ${eyes === 'x'
    ? `<g stroke="#1b1f3b" stroke-width="${r * 0.12}" stroke-linecap="round"><path d="M${cx - r * .42},${cy - r * .12} l${r * .22},${r * .22} M${cx - r * .2},${cy - r * .12} l-${r * .22},${r * .22} M${cx + r * .2},${cy - r * .12} l${r * .22},${r * .22} M${cx + r * .42},${cy - r * .12} l-${r * .22},${r * .22}"/></g><ellipse cx="${cx}" cy="${cy + r * .38}" rx="${r * .16}" ry="${r * .2}" fill="#1b1f3b"/>`
    : `<circle cx="${cx - r * 0.25}" cy="${cy - r * 0.02}" r="${r * 0.14}" fill="#1b1f3b"/><circle cx="${cx + r * 0.25}" cy="${cy - r * 0.02}" r="${r * 0.14}" fill="#1b1f3b"/><circle cx="${cx - r * 0.21}" cy="${cy - r * 0.07}" r="${r * 0.05}" fill="#fff"/><circle cx="${cx + r * 0.29}" cy="${cy - r * 0.07}" r="${r * 0.05}" fill="#fff"/><ellipse cx="${cx}" cy="${cy + r * 0.36}" rx="${r * 0.17}" ry="${r * 0.21}" fill="#1b1f3b"/>`}`;
const lines = (x, y, ang, col = '#fff') => `<g transform="translate(${x} ${y}) rotate(${ang})" stroke="${col}" stroke-linecap="round">
  <path d="M0 0 h-120" stroke-width="20"/><path d="M-10 40 h-90" stroke-width="16" opacity=".85"/><path d="M-6 -40 h-80" stroke-width="14" opacity=".7"/></g>`;
const svg = (bg, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${bg}${body}</svg>`;

const ICON = svg(`<defs><radialGradient id="g" cx=".38" cy=".6" r=".8"><stop offset="0" stop-color="#5a3fa8"/><stop offset="1" stop-color="#1b1f3b"/></radialGradient></defs><rect width="512" height="512" fill="url(#g)"/>
      <g opacity=".12" fill="#fff">${Array.from({ length: 18 }, (_, i) => `<path d="M190 320 L${190 + Math.cos(i / 18 * 6.283) * 700} ${320 + Math.sin(i / 18 * 6.283) * 700} L${190 + Math.cos((i + .45) / 18 * 6.283) * 700} ${320 + Math.sin((i + .45) / 18 * 6.283) * 700}Z"/>`).join('')}</g>`,
    `<path d="${star(190, 320, 9, 215, 100, 0)}" fill="#ff8a3d" stroke="#1b1f3b" stroke-width="12" stroke-linejoin="round"/>
     <path d="${star(190, 320, 9, 160, 78, 0.35)}" fill="#ffd23f"/>
     <path d="${star(190, 320, 9, 88, 46, 0)}" fill="#fff6c9"/>
     ${lines(300, 214, -42)}
     ${face(372, 138, 86, '#4f8bff', '', 'x')}`);

/**
 * size の大きさで書き出す。inner は絵柄の縮小率（Android の丸く切り抜かれるアイコン用に、
 * 大事な部分を真ん中の安全な範囲に収める。背景の色は端まで塗る）
 */
const page = (size, inner) => `<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#1b1f3b">
<div style="width:512px;height:512px;transform-origin:0 0;transform:scale(${size / 512}) translate(${(512 * (1 - inner)) / 2}px,${(512 * (1 - inner)) / 2}px) scale(${inner})">${ICON}</div></body></html>`;

const outputs = [
  { file: 'public/icons/icon-512.png', size: 512, inner: 1 },
  { file: 'public/icons/icon-192.png', size: 192, inner: 1 },
  { file: 'public/icons/apple-touch-icon.png', size: 180, inner: 1 },
  // Android の「丸く切り抜かれるアイコン」は、真ん中の 80% の円の中だけが確実に見える
  { file: 'public/icons/icon-512-maskable.png', size: 512, inner: 0.7 },
];

const b = await chromium.launch();
const p = await b.newPage();
for (const o of outputs) {
  await p.setViewportSize({ width: o.size, height: o.size });
  await p.setContent(page(o.size, o.inner));
  await p.screenshot({ path: o.file });
  console.log(`${o.file}（${o.size}×${o.size}）を書き出しました`);
}
await b.close();
