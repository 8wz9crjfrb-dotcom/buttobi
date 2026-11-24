// 名刺カードの背景（ガチャの景品の候補。テスト版では全部選べる）。
// 番号で保存・送信するので、並びを変えない・新しいものは最後に足す（数は CARD_BG_COUNT と合わせる）。
// 背景は CSS の background（何枚か重ねる）で描く。模様は小さな SVG を繰り返す。
// fx = 動く飾り（styles.css の .pcard.fx-○○）

export type CardBgGroup = 'stage' | 'char' | 'special';

export interface CardBgDef {
  name: string;
  group: CardBgGroup;
  /** 2=R 3=SR 4=SSR 6=UR（ガチャに入れるときの目安） */
  rarity: number;
  bg: string;
  /** 動く飾り */
  fx?: 'rain' | 'stars' | 'aurora' | 'rainbow' | 'flow' | 'glitter';
}

/** SVG を CSS の url() にする */
const svg = (w: number, h: number, body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;
/** 明るい背景の上でも白い文字が読めるよう、うすく暗くする層 */
const SHADE = 'linear-gradient(rgba(10,12,30,.28), rgba(10,12,30,.28))';

const heart = (x: number, y: number, s: number, c: string, o = 1) =>
  `<path d='M${x} ${y + s * 0.9}C${x - s * 1.3} ${y} ${x - s * 0.9} ${y - s * 1.1} ${x} ${y - s * 0.35}C${x + s * 0.9} ${y - s * 1.1} ${x + s * 1.3} ${y} ${x} ${y + s * 0.9}Z' fill='${c}' opacity='${o}'/>`;

/** 1 番から（0 は「なし」） */
export const CARD_BGS: CardBgDef[] = [
  // ---------------------------------------------------------------- ステージ
  {
    name: 'そらの台地',
    group: 'stage',
    rarity: 2,
    bg: `${SHADE}, ${svg(220, 120, `<g fill='#fff' opacity='.85'><ellipse cx='40' cy='34' rx='28' ry='10'/><ellipse cx='58' cy='28' rx='18' ry='10'/><ellipse cx='160' cy='86' rx='34' ry='11'/><ellipse cx='178' cy='78' rx='20' ry='11'/></g>`)}, linear-gradient(180deg, #5bb8ff, #a8e3ff 70%, #c9f2d0)`,
  },
  {
    name: 'ガチャ会場',
    group: 'stage',
    rarity: 2,
    bg: `${SHADE}, ${svg(90, 90, `<g stroke='#fff' stroke-width='2'><circle cx='22' cy='22' r='11' fill='#ff4fa3'/><path d='M11 22h22' /><circle cx='67' cy='67' r='11' fill='#4fc3ff'/><path d='M56 67h22'/><circle cx='68' cy='20' r='7' fill='#ffd84a'/><circle cx='20' cy='70' r='7' fill='#8be36a'/></g>`)}, linear-gradient(135deg, #ff9ccf, #b08cff)`,
  },
  {
    name: 'スマホのタイムライン',
    group: 'stage',
    rarity: 2,
    bg: `${svg(120, 160, `<g fill='#fff' opacity='.08'><rect x='10' y='10' width='46' height='64' rx='8'/><rect x='64' y='40' width='46' height='64' rx='8'/><rect x='10' y='86' width='46' height='64' rx='8'/></g><g fill='#ff4f6d' opacity='.5'><circle cx='20' cy='20' r='3'/><circle cx='74' cy='50' r='3'/></g>`)}, linear-gradient(160deg, #2a1f5a, #120e2a)`,
  },
  {
    name: 'データセンター屋上',
    group: 'stage',
    rarity: 2,
    bg: `${svg(60, 40, `<rect x='4' y='6' width='52' height='28' rx='3' fill='#1a2a4a' stroke='#2c4a7a'/><g fill='#3cf0ff'><circle cx='12' cy='14' r='1.6'/><circle cx='18' cy='14' r='1.6' opacity='.5'/></g><circle cx='12' cy='24' r='1.6' fill='#4fff8a'/><path d='M26 14h24M26 24h24' stroke='#2c4a7a' stroke-width='2'/>`)}, linear-gradient(180deg, #0d1a33, #1c2f55)`,
  },
  {
    name: '電脳空間',
    group: 'stage',
    rarity: 3,
    bg: `repeating-linear-gradient(0deg, rgba(57,255,136,.22) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(57,255,136,.22) 0 1px, transparent 1px 22px), radial-gradient(ellipse at 50% 120%, #0f5a34, #03120a 70%)`,
  },
  {
    name: '深夜の金庫室',
    group: 'stage',
    rarity: 3,
    bg: `repeating-linear-gradient(115deg, transparent 0 60px, rgba(255,40,60,.55) 60px 62px, transparent 62px 130px), ${svg(48, 48, `<circle cx='24' cy='24' r='3' fill='#5a6070'/>`)}, linear-gradient(150deg, #3a3f4c, #16181f)`,
  },
  {
    name: '配信スタジオ',
    group: 'stage',
    rarity: 2,
    bg: `radial-gradient(circle at 82% 30%, transparent 0 46px, rgba(255,255,255,.75) 47px 53px, transparent 54px), radial-gradient(circle at 82% 30%, rgba(255,255,255,.25), transparent 60%), linear-gradient(135deg, #8a4dff, #ff5aa8)`,
  },
  {
    name: 'ネオン商店街',
    group: 'stage',
    rarity: 3,
    bg: `linear-gradient(90deg, transparent 8%, rgba(255,60,200,.9) 8% 9%, transparent 9% 70%, rgba(60,240,255,.9) 70% 71%, transparent 71%), linear-gradient(0deg, transparent 30%, rgba(255,230,80,.6) 30% 31%, transparent 31%), radial-gradient(ellipse at 20% 100%, rgba(255,60,200,.45), transparent 60%), linear-gradient(180deg, #140a2a, #2a0f3f)`,
  },
  {
    name: 'AIラボ',
    group: 'stage',
    rarity: 2,
    bg: `${SHADE}, ${svg(100, 100, `<g fill='none' stroke='#4f8dff' stroke-width='2' opacity='.6'><path d='M0 30h30l10 10h30l10-10h20'/><path d='M0 75h20l10-10h40l10 10h20'/></g><g fill='#4f8dff' opacity='.8'><circle cx='30' cy='30' r='3'/><circle cx='70' cy='40' r='3'/><circle cx='30' cy='65' r='3'/><circle cx='70' cy='65' r='3'/></g>`)}, linear-gradient(135deg, #e8f1ff, #9fc2ff)`,
  },
  {
    name: '24時間ジム',
    group: 'stage',
    rarity: 2,
    bg: `repeating-linear-gradient(135deg, rgba(255,140,40,.55) 0 14px, transparent 14px 28px) 0 100% / 100% 18% no-repeat, linear-gradient(180deg, #5a5f6a, #2e3138)`,
  },
  {
    name: '夜のライブバー',
    group: 'stage',
    rarity: 3,
    bg: `conic-gradient(from 160deg at 20% -10%, transparent 0 8deg, rgba(255,220,120,.35) 8deg 22deg, transparent 22deg), conic-gradient(from 170deg at 80% -10%, transparent 0 10deg, rgba(180,120,255,.4) 10deg 24deg, transparent 24deg), linear-gradient(180deg, #2a1040, #0e0718)`,
  },
  {
    name: '深夜のワンルーム',
    group: 'stage',
    rarity: 3,
    bg: `${svg(80, 80, `${heart(20, 22, 8, '#ff9ccf', 0.55)}${heart(60, 60, 6, '#ffd1e3', 0.45)}`)}, radial-gradient(circle at 85% 18%, #ffe9a8 0 14px, transparent 15px), linear-gradient(160deg, #3a1f55, #1a0f2e)`,
  },
  // ---------------------------------------------------------------- キャラ
  {
    name: '立入禁止テープ（警備員）',
    group: 'char',
    rarity: 3,
    bg: `${svg(320, 200, `<defs><pattern id='t' width='24' height='24' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='12' height='24' fill='#1b1b28'/></pattern></defs><g transform='rotate(-10 160 100)'><rect x='-40' y='182' width='400' height='30' fill='#ffd23f'/><rect x='-40' y='182' width='400' height='30' fill='url(#t)' opacity='.9'/><rect x='-40' y='150' width='400' height='26' fill='#ffd23f'/><text x='160' y='169' font-size='16' font-weight='900' fill='#1b1b28' text-anchor='middle' font-family='sans-serif'>立入禁止　立入禁止　立入禁止</text></g>`)} center / cover no-repeat, linear-gradient(150deg, #2a3a6a, #121a33)`,
  },
  {
    name: '文字の雨（ハッカー）',
    group: 'char',
    rarity: 4,
    fx: 'rain',
    bg: `${svg(60, 120, `<g fill='#39ff88' font-family='monospace' font-size='12'><text x='4' y='20' opacity='.9'>1</text><text x='4' y='36' opacity='.6'>0</text><text x='4' y='52' opacity='.3'>1</text><text x='26' y='70' opacity='.9'>0</text><text x='26' y='86' opacity='.5'>1</text><text x='46' y='30' opacity='.7'>1</text><text x='46' y='46' opacity='.35'>0</text></g>`)}, linear-gradient(180deg, #021008, #062a14)`,
  },
  {
    name: 'コメントが流れる（配信者）',
    group: 'char',
    rarity: 4,
    fx: 'flow',
    bg: `${svg(220, 90, `<g fill='#fff' opacity='.45'><rect x='8' y='12' width='70' height='14' rx='7'/><rect x='120' y='40' width='90' height='14' rx='7'/><rect x='30' y='66' width='60' height='14' rx='7'/></g><g fill='#ff5aa8'>${heart(16, 19, 4, '#ff5aa8')}${heart(128, 47, 4, '#ff5aa8')}</g>`)}, linear-gradient(135deg, #ff7eb6, #7a5cff)`,
  },
  {
    name: 'カプセルいっぱい（ガチャ廃人）',
    group: 'char',
    rarity: 3,
    bg: `${svg(70, 70, `<g stroke='#1b1f3b' stroke-width='2'><circle cx='18' cy='18' r='12' fill='#fff'/><path d='M6 18a12 12 0 0 1 24 0z' fill='#ff4fa3'/><circle cx='52' cy='52' r='12' fill='#fff'/><path d='M40 52a12 12 0 0 1 24 0z' fill='#ffd84a'/></g>`)}, linear-gradient(135deg, #ffe27a, #ff8a3d)`,
  },
  {
    name: 'ダンベル柄（トレーナー）',
    group: 'char',
    rarity: 3,
    bg: `${svg(70, 50, `<g fill='#fff' opacity='.35'><rect x='10' y='20' width='30' height='6' rx='2'/><rect x='6' y='14' width='6' height='18' rx='2'/><rect x='38' y='14' width='6' height='18' rx='2'/></g>`)}, linear-gradient(135deg, #ff6a3d, #b3261e)`,
  },
  {
    name: '赤い糸とハート（メンヘラ）',
    group: 'char',
    rarity: 4,
    bg: `${svg(160, 100, `<path d='M-5 70C30 30 60 90 90 50S140 20 170 40' fill='none' stroke='#ff2a5a' stroke-width='3' stroke-linecap='round'/>${heart(30, 30, 9, '#ff7eb6', 0.8)}${heart(130, 78, 7, '#fff', 0.7)}`)}, linear-gradient(160deg, #ffb3d1, #c46bff)`,
  },
  // ---------------------------------------------------------------- 特別
  {
    name: '流れ星の夜空',
    group: 'special',
    rarity: 4,
    fx: 'stars',
    bg: `${svg(120, 80, `<g fill='#fff'><circle cx='10' cy='12' r='1.2'/><circle cx='60' cy='30' r='.9'/><circle cx='100' cy='8' r='1.4'/><circle cx='30' cy='60' r='1'/><circle cx='90' cy='66' r='.8'/></g>`)}, linear-gradient(180deg, #0a0f2e, #2a1f5a 70%, #4a2a6a)`,
  },
  {
    name: 'オーロラ',
    group: 'special',
    rarity: 4,
    fx: 'aurora',
    bg: `linear-gradient(180deg, #06102a, #0b2a3a)`,
  },
  {
    name: '金箔',
    group: 'special',
    rarity: 4,
    fx: 'glitter',
    bg: `${SHADE}, ${svg(90, 90, `<g fill='#fff8d0' opacity='.7'><rect x='10' y='14' width='9' height='6' transform='rotate(20 14 17)'/><rect x='60' y='50' width='12' height='7' transform='rotate(-15 66 53)'/><rect x='40' y='76' width='7' height='5'/></g>`)}, linear-gradient(135deg, #b8860b, #ffd86b 45%, #c99a2e 70%, #fff1b0)`,
  },
  {
    name: '虹色に輝く枠',
    group: 'special',
    rarity: 6,
    fx: 'rainbow',
    bg: `linear-gradient(135deg, #2a1f5a, #121633)`,
  },
];

export const CARD_BG_GROUPS: { id: CardBgGroup; name: string }[] = [
  { id: 'stage', name: 'ステージ' },
  { id: 'char', name: 'キャラ' },
  { id: 'special', name: '特別' },
];

/** カードに付ける style と class（bg = 1〜。0 ならなし） */
export function cardBgAttrs(bg: number | undefined): { style: string; cls: string } {
  const d = bg ? CARD_BGS[bg - 1] : undefined;
  if (!d) return { style: '', cls: '' };
  // 模様の SVG に " が入るので、HTML の属性に入れられる形にする
  return { style: `background:${d.bg};`.replace(/"/g, '&quot;'), cls: `has-bg${d.fx ? ` fx-${d.fx}` : ''}` };
}
