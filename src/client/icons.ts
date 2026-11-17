// メニューのアイコン（専用の絵。SVG を文字列で持つ）。線は太く丸く、白一色（色は台の色で分ける）

const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<string, string> = {
  // ひとりで：ガッツポーズのキャラ
  solo: svg(
    `<circle cx="24" cy="13" r="7" fill="currentColor" stroke="none"/>
     <path d="M15 42v-9a9 9 0 0 1 18 0v9" fill="currentColor" stroke="none"/>
     <path d="M33 30l6-9" /><path d="M39 21l2-5"/>
     <path d="M15 30l-5-6"/>`,
  ),
  // みんなで：3人
  multi: svg(
    `<circle cx="24" cy="14" r="6" fill="currentColor" stroke="none"/>
     <path d="M15 40v-6a9 9 0 0 1 18 0v6z" fill="currentColor" stroke="none"/>
     <circle cx="10" cy="19" r="4.5" fill="currentColor" stroke="none" opacity=".75"/>
     <path d="M3 40v-4a7 7 0 0 1 11-5.7V40z" fill="currentColor" stroke="none" opacity=".75"/>
     <circle cx="38" cy="19" r="4.5" fill="currentColor" stroke="none" opacity=".75"/>
     <path d="M45 40v-4a7 7 0 0 0-11-5.7V40z" fill="currentColor" stroke="none" opacity=".75"/>`,
  ),
  // ガチャ・衣装：ガチャのカプセル（上半分は色つき）
  gacha: svg(
    `<circle cx="24" cy="24" r="16"/>
     <path d="M8 24a16 16 0 0 1 32 0z" fill="currentColor" stroke="none"/>
     <path d="M8 24h32"/>
     <circle cx="24" cy="24" r="4.5" fill="#1b1f3b" stroke="currentColor"/>
     <path d="M15 14.5a10 10 0 0 1 5-3" stroke="#1b1f3b" stroke-width="2.6"/>`,
  ),
  // 戦績・ミッション：トロフィー
  records: svg(
    `<path d="M15 7h18v10a9 9 0 0 1-18 0z" fill="currentColor" stroke="none"/>
     <path d="M15 10H8v3a7 7 0 0 0 7 7"/><path d="M33 10h7v3a7 7 0 0 1-7 7"/>
     <path d="M24 26v7"/><path d="M16 41h16"/><path d="M19 41l1.5-8h7l1.5 8" fill="currentColor"/>`,
  ),
  // CPUと対戦：ロボットの顔
  cpu: svg(
    `<rect x="9" y="14" width="30" height="24" rx="7" fill="currentColor" stroke="none"/>
     <circle cx="18" cy="25" r="3.2" fill="#1b1f3b" stroke="none"/><circle cx="30" cy="25" r="3.2" fill="#1b1f3b" stroke="none"/>
     <path d="M19 32h10" stroke="#1b1f3b" stroke-width="3"/>
     <path d="M24 14V8"/><circle cx="24" cy="6" r="2.4" fill="currentColor"/>
     <path d="M9 24H5v6h4"/><path d="M39 24h4v6h-4"/>`,
  ),
  // 100人組手：次々に来る敵（3人の影）と「100」
  horde: svg(
    `<circle cx="11" cy="17" r="4" fill="currentColor" stroke="none" opacity=".55"/>
     <circle cx="24" cy="14" r="4.6" fill="currentColor" stroke="none" opacity=".8"/>
     <circle cx="37" cy="17" r="4" fill="currentColor" stroke="none" opacity=".55"/>
     <path d="M5 30a6 6 0 0 1 12 0M17 28a7 7 0 0 1 14 0M31 30a6 6 0 0 1 12 0" fill="currentColor" stroke="none" opacity=".7"/>
     <rect x="8" y="31" width="32" height="12" rx="4" fill="currentColor" stroke="none"/>
     <text x="24" y="40.5" text-anchor="middle" font-size="10.5" font-weight="900" font-family="sans-serif" fill="#1b1f3b" stroke="none">100</text>`,
  ),
  // 練習モード：的
  training: svg(
    `<circle cx="22" cy="26" r="15"/><circle cx="22" cy="26" r="8.5"/><circle cx="22" cy="26" r="3" fill="currentColor"/>
     <path d="M22 26L40 8"/><path d="M34 8h6v6"/>`,
  ),
  // ルームを作る：家と＋
  create: svg(
    `<path d="M6 22L24 7l18 15"/><path d="M11 19v21h26V19" fill="currentColor" stroke="none"/>
     <path d="M24 24v11M18.5 29.5h11" stroke="#1b1f3b"/>`,
  ),
  // コードで参加：数字のボタン
  join: svg(
    `<rect x="7" y="7" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/><rect x="19.5" y="7" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/><rect x="32" y="7" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/>
     <rect x="7" y="19.5" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/><rect x="19.5" y="19.5" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/><rect x="32" y="19.5" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/>
     <rect x="7" y="32" width="9" height="9" rx="2.5" fill="currentColor" stroke="none" opacity=".5"/><rect x="19.5" y="32" width="9" height="9" rx="2.5" fill="currentColor" stroke="none"/><rect x="32" y="32" width="9" height="9" rx="2.5" fill="currentColor" stroke="none" opacity=".5"/>`,
  ),
  // 遊び方：はてな
  help: svg(`<circle cx="24" cy="24" r="17"/><path d="M18.5 19a5.5 5.5 0 1 1 7.5 5.1c-1.3.6-2 1.6-2 3v1.4"/><circle cx="24" cy="34.5" r="1.2" fill="currentColor"/>`),
  // 設定：歯車
  settings: svg(
    `<path d="M24 5l3 4.5 5.3-1.2 1.2 5.3L38 16.5l-1.2 5.3L41 24l-4.2 2.2 1.2 5.3-4.5 2.9-1.2 5.3-5.3-1.2L24 43l-3-4.5-5.3 1.2-1.2-5.3-4.5-2.9 1.2-5.3L7 24l4.2-2.2-1.2-5.3 4.5-2.9 1.2-5.3 5.3 1.2z" stroke-width="3"/><circle cx="24" cy="24" r="6"/>`,
  ),
  // フレンド：並んだ2人と、ハート
  friends: svg(
    `<circle cx="17" cy="15" r="6" fill="currentColor" stroke="none"/>
     <path d="M7 40v-5a10 10 0 0 1 20 0v5z" fill="currentColor" stroke="none"/>
     <circle cx="33" cy="17" r="5" fill="currentColor" stroke="none" opacity=".75"/>
     <path d="M25 40v-4a8 8 0 0 1 16 0v4z" fill="currentColor" stroke="none" opacity=".75"/>
     <path d="M36 4.5c-1.6-1.8-4.4-.6-4.2 1.7.1 1.6 2.4 3 4.2 4.6 1.8-1.6 4.1-3 4.2-4.6.2-2.3-2.6-3.5-4.2-1.7z" fill="currentColor" stroke="none"/>`,
  ),
  // 対戦に戻る：くるっと戻る矢印
  rejoin: svg(`<path d="M14 18h17a9 9 0 0 1 0 18H18"/><path d="M20 10l-8 8 8 8"/>`),
  // 友達にゲームを教える：くさりのリンク
  invite: svg(
    `<path d="M20 28l8-8"/>
     <path d="M17 23l-4 4a6.4 6.4 0 0 0 9 9l4-4"/>
     <path d="M31 25l4-4a6.4 6.4 0 0 0-9-9l-4 4"/>`,
  ),
  // ホーム画面に追加：スマホと下向き矢印
  install: svg(`<rect x="13" y="5" width="22" height="38" rx="5"/><path d="M24 14v14"/><path d="M18.5 23l5.5 5.5 5.5-5.5"/><path d="M21 37h6"/>`),
};

/** 勝敗予想の「予想チケット」：両側に切り込みのある券。当たりはチェック、ハズレは×。左側にミシン目 */
const TICKET = 'M9 12h30a4 4 0 0 1 4 4v4.5a3.5 3.5 0 0 0 0 7V32a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-4.5a3.5 3.5 0 0 0 0-7V16a4 4 0 0 1 4-4z';
export function predictMark(hit: boolean): string {
  const fill = hit ? '#ffd84a' : '#8a90a8';
  const sign = hit ? '<path d="M21 24.5l4.5 4.5 9-10" stroke="#1b1f3b" stroke-width="3.6"/>' : '<path d="M23 19.5l9 9M32 19.5l-9 9" stroke="#1b1f3b" stroke-width="3.4"/>';
  return `<svg class="predict-mark" viewBox="3 10 42 28" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${TICKET}" fill="${fill}"/><path d="M15 15v18" stroke="#1b1f3b" stroke-width="2" stroke-dasharray="2.5 3" opacity=".55"/><circle cx="10.5" cy="24" r="2" fill="#1b1f3b" opacity=".45"/>${sign}</svg>`;
}

/** 色つきの台に載せたアイコン（メニューの大きなボタン用） */
export function iconTile(name: string, color: string): string {
  return `<span class="m-ic" style="--ic:${color}">${ICONS[name] ?? ''}</span>`;
}

/** トーナメント優勝の「優勝旗」：先に玉の付いた旗ざおと、燕尾（えんび）形の金色の旗。旗に星 */
export function championMark(): string {
  return `<svg class="champ-mark" viewBox="6 4 38 40" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 9v33" stroke="#d9dbe8" stroke-width="3"/><circle cx="11" cy="7" r="3" fill="#ffd84a"/><path d="M12.5 10H41l-7 9 7 9H12.5z" fill="#ffd84a"/><path d="M12.5 10H41l-7 9 7 9H12.5z" stroke="#c9a21a" stroke-width="1.6"/><path d="M24 13.2l1.7 3.5 3.8.5-2.8 2.6.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" fill="#1b1f3b"/></svg>`;
}

/** ミッション達成・称号の「ごほうびバッジ」：ぎざぎざの丸いメダルに星、下に2本のリボン */
export function rewardMark(): string {
  const pts: string[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 11.2 : 13;
    pts.push(`${(24 + Math.cos(a) * r).toFixed(1)},${(19 + Math.sin(a) * r).toFixed(1)}`);
  }
  return `<svg class="reward-mark" viewBox="6 4 36 42" aria-hidden="true"><path d="M17 27l-5 15 6-3 4 5 4-14z" fill="#ff6b6b"/><path d="M31 27l5 15-6-3-4 5-4-14z" fill="#4f9dff"/><polygon points="${pts.join(' ')}" fill="#ffd84a"/><circle cx="24" cy="19" r="8.4" fill="none" stroke="#c9a21a" stroke-width="1.4"/><path d="M24 13.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-1.9-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" fill="#1b1f3b"/></svg>`;
}

/** エリアの「取り合い中」：左右から2本の矢印がぶつかり、間に火花 */
export function clashMark(): string {
  return `<svg class="clash-mark" viewBox="0 0 48 32" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16h13M12 10l6 6-6 6" stroke="#ffffff" stroke-width="3.6"/><path d="M44 16H31M36 10l-6 6 6 6" stroke="#ffffff" stroke-width="3.6"/><path d="M24 7v4M24 21v4M20 9.5l1.6 2.4M28 9.5l-1.6 2.4M20 22.5l1.6-2.4M28 22.5l-1.6-2.4" stroke="#ffd84a" stroke-width="2.2"/></svg>`;
}

/** 「ランダム」のサイコロ（白い角丸の箱に黒い目が5つ） */
export function diceMark(): string {
  return `<svg class="dice-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="#ffffff"/><g fill="#1b1f3b"><circle cx="8" cy="8" r="1.9"/><circle cx="16" cy="8" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="8" cy="16" r="1.9"/><circle cx="16" cy="16" r="1.9"/></g></svg>`;
}

/** ひとことの吹き出し（角丸の四角としっぽ、中に3つの点） */
export function chatMark(): string {
  return `<svg class="chat-mark" viewBox="0 0 24 22" aria-hidden="true"><path d="M5 2h14a3.5 3.5 0 0 1 3.5 3.5v7A3.5 3.5 0 0 1 19 16h-8l-5 4.5V16H5a3.5 3.5 0 0 1-3.5-3.5v-7A3.5 3.5 0 0 1 5 2z" fill="currentColor"/><g fill="#1b1f3b"><circle cx="7.5" cy="9" r="1.5"/><circle cx="12" cy="9" r="1.5"/><circle cx="16.5" cy="9" r="1.5"/></g></svg>`;
}
