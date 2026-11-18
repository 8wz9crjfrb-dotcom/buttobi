// 攻撃力・スピードの上がり下がりの目印（どのキャラでも共通）：剣とブーツに、上がりは緑の↑、下がりは青の↓。
// 画面の枠（HUD）には SVG、キャラの頭の上には同じ絵をキャンバスに描いて使う

export type BuffKind = 'atk' | 'spd';

const UP_COLOR = '#3ce07a';
const DOWN_COLOR = '#4fa8ff';

/** 剣とブーツは白（↑↓だけ色を付ける） */
const SWORD = `<path d="M30 6 L40 6 L40 16 L20 36 L12 28 Z" fill="#ffffff" stroke="#1b1f3b" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M9 25 L23 39" stroke="#1b1f3b" stroke-width="7" stroke-linecap="round"/>
<path d="M9 25 L23 39" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
<path d="M14 34 L7 41" stroke="#1b1f3b" stroke-width="7" stroke-linecap="round"/>
<path d="M14 34 L7 41" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>`;
const BOOT = `<path d="M12 6 L26 6 L26 26 L38 30 Q42 32 42 36 L42 40 L8 40 L8 34 L12 32 Z" fill="#ffffff" stroke="#1b1f3b" stroke-width="2.5" stroke-linejoin="round"/>
<path d="M8 36 L42 36" stroke="#1b1f3b" stroke-width="2.5"/>`;

function arrowSvg(up: boolean): string {
  const c = up ? UP_COLOR : DOWN_COLOR;
  return up
    ? `<path d="M40 22 L48 34 L43 34 L43 46 L37 46 L37 34 L32 34 Z" fill="${c}" stroke="#1b1f3b" stroke-width="2" stroke-linejoin="round"/>`
    : `<path d="M40 46 L48 34 L43 34 L43 22 L37 22 L37 34 L32 34 Z" fill="${c}" stroke="#1b1f3b" stroke-width="2" stroke-linejoin="round"/>`;
}

/** 枠（HUD）に出す小さな目印 */
export function buffSvg(kind: BuffKind, up: boolean): string {
  const label = `${kind === 'atk' ? '攻撃力' : 'スピード'}${up ? 'アップ' : 'ダウン'}`;
  return `<svg class="bf-ico ${up ? 'up' : 'down'}" viewBox="0 0 50 50" aria-label="${label}"><title>${label}</title>${kind === 'atk' ? SWORD : BOOT}${arrowSvg(up)}</svg>`;
}

/** 頭の上に出す目印の絵（64×64 のキャンバス） */
export function drawBuff(g: CanvasRenderingContext2D, kind: BuffKind, up: boolean): void {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 50 50"><circle cx="25" cy="25" r="23" fill="rgba(20,16,36,0.75)"/>${kind === 'atk' ? SWORD : BOOT}${arrowSvg(up)}</svg>`;
  // SVG を画像として読み込んで描く（読み込みは非同期なので、読めたら描き足す）
  const img = new Image();
  img.onload = () => {
    g.drawImage(img, 0, 0, 64, 64);
    onDrawn.forEach((f) => f());
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** 絵を描き終えたときに呼ぶ（テクスチャの更新に使う） */
const onDrawn = new Set<() => void>();
export function whenBuffDrawn(f: () => void): void {
  onDrawn.add(f);
}
