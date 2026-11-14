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
  // ホーム画面に追加：スマホと下向き矢印
  install: svg(`<rect x="13" y="5" width="22" height="38" rx="5"/><path d="M24 14v14"/><path d="M18.5 23l5.5 5.5 5.5-5.5"/><path d="M21 37h6"/>`),
};

/** 色つきの台に載せたアイコン（メニューの大きなボタン用） */
export function iconTile(name: string, color: string): string {
  return `<span class="m-ic" style="--ic:${color}">${ICONS[name] ?? ''}</span>`;
}
