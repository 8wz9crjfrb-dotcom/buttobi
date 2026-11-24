// 名刺カードの背景（スタンプ＆背景ガチャの景品）。
// 番号で保存・送信するので、並びを変えない・新しいものは最後に足す（数は CARD_BG_COUNT と合わせる）。
// レア度で見た目の格をそろえる：
//   SR  … 動かない絵（ステージ12種・全キャラ11種）
//   SSR … 情景がゆっくり動く（1つの動き）
//   UR  … いくつもの動きが重なり、カードの縁が金色に光る
// 背景は CSS の background（何枚か重ねる）で描く。模様は小さな SVG を繰り返す。動きは styles.css の .fx-○○

export type CardBgGroup = 'stage' | 'char' | 'ssr' | 'ur';

export interface CardBgDef {
  name: string;
  group: CardBgGroup;
  /** 4=SR 5=SSR 6=UR */
  rarity: 4 | 5 | 6;
  bg: string;
  /** 動き（SSR・UR だけ） */
  fx?: 'stars' | 'aurora' | 'sakura' | 'snow' | 'sea' | 'firefly' | 'galaxy' | 'fireworks' | 'spotlight';
}

/** SVG を CSS の url() にする */
const svg = (w: number, h: number, body: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;
/** カード全体に1枚で敷く SVG（繰り返さない。中で SMIL のアニメーションを動かせる） */
const full = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='xMidYMid slice'>${body}</svg>`)}") center / cover no-repeat`;
/** 花火1発（中心 x,y・半径 r・色。dur 秒ごと、そのうち最初の vis の割合だけ見える） */
const burst = (x: number, y: number, r: number, c: string, dur: number, begin: number, vis = 0.9) => {
  const rays = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const x2 = (Math.cos(a) * r).toFixed(1);
    const y2 = (Math.sin(a) * r).toFixed(1);
    return `<line x1='${(Math.cos(a) * r * 0.35).toFixed(1)}' y1='${(Math.sin(a) * r * 0.35).toFixed(1)}' x2='${x2}' y2='${y2}'/><circle cx='${x2}' cy='${y2}' r='${(r / 22).toFixed(1)}' fill='${c}' stroke='none'/>`;
  }).join('');
  const k = (n: number) => (n * vis).toFixed(3);
  return `<g transform='translate(${x} ${y})'><g stroke='${c}' stroke-width='${(r / 26).toFixed(1)}' stroke-linecap='round' opacity='0'>${rays}<animateTransform attributeName='transform' type='scale' values='0.15;1;1.12;1.12' keyTimes='0;${k(0.4)};${k(1)};1' dur='${dur}s' begin='${begin}s' repeatCount='indefinite'/><animate attributeName='opacity' values='0;1;0;0' keyTimes='0;${k(0.12)};${k(1)};1' dur='${dur}s' begin='${begin}s' repeatCount='indefinite'/></g></g>`;
};
/** またたく星（SMIL） */
const twinkle = (x: number, y: number, r: number, dur: number) => `<circle cx='${x}' cy='${y}' r='${r}' fill='#fff'><animate attributeName='opacity' values='1;.15;1' dur='${dur}s' repeatCount='indefinite'/></circle>`;
/** 舞い落ちる紙吹雪（SMIL。カードの上から下へ） */
const confetti = (x: number, c: string, dur: number, begin: number, rot: number) =>
  `<g><rect x='${x}' y='-12' width='5' height='9' fill='${c}' transform='rotate(${rot} ${x + 2} -8)'/><animateTransform attributeName='transform' type='translate' values='0 0;${rot > 0 ? 14 : -14} 230' dur='${dur}s' begin='${begin}s' repeatCount='indefinite'/></g>`;

/** 明るい背景の上でも白い文字が読めるよう、うすく暗くする層 */
const SHADE = 'linear-gradient(rgba(10,12,30,.28), rgba(10,12,30,.28))';

const heart = (x: number, y: number, s: number, c: string, o = 1) =>
  `<path d='M${x} ${y + s * 0.9}C${x - s * 1.3} ${y} ${x - s * 0.9} ${y - s * 1.1} ${x} ${y - s * 0.35}C${x + s * 0.9} ${y - s * 1.1} ${x + s * 1.3} ${y} ${x} ${y + s * 0.9}Z' fill='${c}' opacity='${o}'/>`;

/** 1 番から（0 は「なし」） */
export const CARD_BGS: CardBgDef[] = [
  // ================================================================ SR：ステージ（動かない）
  {
    name: 'そらの台地',
    group: 'stage',
    rarity: 4,
    bg: `${SHADE}, ${svg(220, 120, `<g fill='#fff' opacity='.85'><ellipse cx='40' cy='34' rx='28' ry='10'/><ellipse cx='58' cy='28' rx='18' ry='10'/><ellipse cx='160' cy='86' rx='34' ry='11'/><ellipse cx='178' cy='78' rx='20' ry='11'/></g>`)}, linear-gradient(180deg, #5bb8ff, #a8e3ff 70%, #c9f2d0)`,
  },
  {
    name: 'ガチャ会場',
    group: 'stage',
    rarity: 4,
    bg: `${SHADE}, ${svg(90, 90, `<g stroke='#fff' stroke-width='2'><circle cx='22' cy='22' r='11' fill='#ff4fa3'/><path d='M11 22h22' /><circle cx='67' cy='67' r='11' fill='#4fc3ff'/><path d='M56 67h22'/><circle cx='68' cy='20' r='7' fill='#ffd84a'/><circle cx='20' cy='70' r='7' fill='#8be36a'/></g>`)}, linear-gradient(135deg, #ff9ccf, #b08cff)`,
  },
  {
    name: 'スマホのタイムライン',
    group: 'stage',
    rarity: 4,
    bg: `${svg(120, 160, `<g fill='#fff' opacity='.08'><rect x='10' y='10' width='46' height='64' rx='8'/><rect x='64' y='40' width='46' height='64' rx='8'/><rect x='10' y='86' width='46' height='64' rx='8'/></g><g fill='#ff4f6d' opacity='.5'><circle cx='20' cy='20' r='3'/><circle cx='74' cy='50' r='3'/></g>`)}, linear-gradient(160deg, #2a1f5a, #120e2a)`,
  },
  {
    name: 'データセンター屋上',
    group: 'stage',
    rarity: 4,
    bg: `${svg(60, 40, `<rect x='4' y='6' width='52' height='28' rx='3' fill='#1a2a4a' stroke='#2c4a7a'/><g fill='#3cf0ff'><circle cx='12' cy='14' r='1.6'/><circle cx='18' cy='14' r='1.6' opacity='.5'/></g><circle cx='12' cy='24' r='1.6' fill='#4fff8a'/><path d='M26 14h24M26 24h24' stroke='#2c4a7a' stroke-width='2'/>`)}, linear-gradient(180deg, #0d1a33, #1c2f55)`,
  },
  {
    name: '電脳空間',
    group: 'stage',
    rarity: 4,
    bg: `repeating-linear-gradient(0deg, rgba(57,255,136,.22) 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, rgba(57,255,136,.22) 0 1px, transparent 1px 22px), radial-gradient(ellipse at 50% 120%, #0f5a34, #03120a 70%)`,
  },
  {
    name: '深夜の金庫室',
    group: 'stage',
    rarity: 4,
    bg: `repeating-linear-gradient(115deg, transparent 0 60px, rgba(255,40,60,.55) 60px 62px, transparent 62px 130px), ${svg(48, 48, `<circle cx='24' cy='24' r='3' fill='#5a6070'/>`)}, linear-gradient(150deg, #3a3f4c, #16181f)`,
  },
  {
    name: '配信スタジオ',
    group: 'stage',
    rarity: 4,
    bg: `radial-gradient(circle at 82% 30%, transparent 0 46px, rgba(255,255,255,.75) 47px 53px, transparent 54px), radial-gradient(circle at 82% 30%, rgba(255,255,255,.25), transparent 60%), linear-gradient(135deg, #8a4dff, #ff5aa8)`,
  },
  {
    name: 'ネオン商店街',
    group: 'stage',
    rarity: 4,
    bg: `linear-gradient(90deg, transparent 8%, rgba(255,60,200,.9) 8% 9%, transparent 9% 70%, rgba(60,240,255,.9) 70% 71%, transparent 71%), linear-gradient(0deg, transparent 30%, rgba(255,230,80,.6) 30% 31%, transparent 31%), radial-gradient(ellipse at 20% 100%, rgba(255,60,200,.45), transparent 60%), linear-gradient(180deg, #140a2a, #2a0f3f)`,
  },
  {
    name: 'AIラボ',
    group: 'stage',
    rarity: 4,
    bg: `${SHADE}, ${svg(100, 100, `<g fill='none' stroke='#4f8dff' stroke-width='2' opacity='.6'><path d='M0 30h30l10 10h30l10-10h20'/><path d='M0 75h20l10-10h40l10 10h20'/></g><g fill='#4f8dff' opacity='.8'><circle cx='30' cy='30' r='3'/><circle cx='70' cy='40' r='3'/><circle cx='30' cy='65' r='3'/><circle cx='70' cy='65' r='3'/></g>`)}, linear-gradient(135deg, #e8f1ff, #9fc2ff)`,
  },
  {
    name: '24時間ジム',
    group: 'stage',
    rarity: 4,
    bg: `repeating-linear-gradient(135deg, rgba(255,140,40,.55) 0 14px, transparent 14px 28px) 0 100% / 100% 18% no-repeat, linear-gradient(180deg, #5a5f6a, #2e3138)`,
  },
  {
    name: '夜のライブバー',
    group: 'stage',
    rarity: 4,
    bg: `conic-gradient(from 160deg at 20% -10%, transparent 0 8deg, rgba(255,220,120,.35) 8deg 22deg, transparent 22deg), conic-gradient(from 170deg at 80% -10%, transparent 0 10deg, rgba(180,120,255,.4) 10deg 24deg, transparent 24deg), linear-gradient(180deg, #2a1040, #0e0718)`,
  },
  {
    name: '深夜のワンルーム',
    group: 'stage',
    rarity: 4,
    bg: `${svg(80, 80, `${heart(20, 22, 8, '#ff9ccf', 0.55)}${heart(60, 60, 6, '#ffd1e3', 0.45)}`)}, radial-gradient(circle at 85% 18%, #ffe9a8 0 14px, transparent 15px), linear-gradient(160deg, #3a1f55, #1a0f2e)`,
  },
  // ================================================================ SR：キャラ（全員・動かない）
  {
    name: '立入禁止テープ（警備員）',
    group: 'char',
    rarity: 4,
    bg: `${svg(320, 200, `<defs><pattern id='t' width='24' height='24' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='12' height='24' fill='#1b1b28'/></pattern></defs><g transform='rotate(-10 160 100)'><rect x='-40' y='182' width='400' height='30' fill='#ffd23f'/><rect x='-40' y='182' width='400' height='30' fill='url(#t)' opacity='.9'/><rect x='-40' y='150' width='400' height='26' fill='#ffd23f'/><text x='160' y='169' font-size='16' font-weight='900' fill='#1b1b28' text-anchor='middle' font-family='sans-serif'>立入禁止　立入禁止　立入禁止</text></g>`)} center / cover no-repeat, linear-gradient(150deg, #2a3a6a, #121a33)`,
  },
  {
    name: '0と1の壁（ハッカー）',
    group: 'char',
    rarity: 4,
    bg: `${svg(60, 120, `<g fill='#39ff88' font-family='monospace' font-size='12'><text x='4' y='20' opacity='.9'>1</text><text x='4' y='36' opacity='.6'>0</text><text x='4' y='52' opacity='.3'>1</text><text x='26' y='70' opacity='.9'>0</text><text x='26' y='86' opacity='.5'>1</text><text x='46' y='30' opacity='.7'>1</text><text x='46' y='46' opacity='.35'>0</text></g>`)}, linear-gradient(180deg, #021008, #062a14)`,
  },
  {
    name: '盗んだ宝石（データ泥棒）',
    group: 'char',
    rarity: 4,
    bg: `${svg(90, 80, `<g stroke='#fff' stroke-width='1.5' stroke-linejoin='round'><path d='M10 22l8-10h16l8 10-16 20z' fill='#ff4f6d' opacity='.45'/><path d='M52 58l7-8h14l7 8-14 17z' fill='#4fc3ff' opacity='.45'/></g><g fill='#fff' opacity='.6'><circle cx='70' cy='18' r='2'/><circle cx='30' cy='66' r='1.6'/></g>`)}, linear-gradient(150deg, #2a1f3a, #0f0b18)`,
  },
  {
    name: 'コメント欄（配信者）',
    group: 'char',
    rarity: 4,
    bg: `${svg(220, 90, `<g fill='#fff' opacity='.45'><rect x='8' y='12' width='70' height='14' rx='7'/><rect x='120' y='40' width='90' height='14' rx='7'/><rect x='30' y='66' width='60' height='14' rx='7'/></g>${heart(16, 19, 4, '#ff5aa8')}${heart(128, 47, 4, '#ff5aa8')}`)}, linear-gradient(135deg, #ff7eb6, #7a5cff)`,
  },
  {
    name: '再生ボタン（ドパガキ）',
    group: 'char',
    rarity: 4,
    bg: `${svg(80, 80, `<g fill='#fff' opacity='.28'><rect x='8' y='8' width='26' height='18' rx='5'/><rect x='46' y='48' width='26' height='18' rx='5'/></g><g fill='#ff5a2a' opacity='.6'><path d='M18 12l8 5-8 5z'/><path d='M56 52l8 5-8 5z'/></g><path d='M60 14v12M54 20l6 6 6-6' stroke='#fff' stroke-width='2.5' fill='none' opacity='.6' stroke-linecap='round'/>`)}, linear-gradient(160deg, #ffb02e, #ff5a2a)`,
  },
  {
    name: 'カプセルいっぱい（ガチャ廃人）',
    group: 'char',
    rarity: 4,
    bg: `${svg(70, 70, `<g stroke='#1b1f3b' stroke-width='2'><circle cx='18' cy='18' r='12' fill='#fff'/><path d='M6 18a12 12 0 0 1 24 0z' fill='#ff4fa3'/><circle cx='52' cy='52' r='12' fill='#fff'/><path d='M40 52a12 12 0 0 1 24 0z' fill='#ffd84a'/></g>`)}, linear-gradient(135deg, #ffe27a, #ff8a3d)`,
  },
  {
    name: '配達ルート（配達員）',
    group: 'char',
    rarity: 4,
    bg: `${svg(160, 110, `<path d='M10 90C40 90 40 30 80 40S120 90 150 20' fill='none' stroke='#fff' stroke-width='3' stroke-dasharray='8 6' opacity='.7'/><circle cx='10' cy='90' r='5' fill='#fff'/><path d='M150 8c-6 0-10 4-10 9 0 7 10 15 10 15s10-8 10-15c0-5-4-9-10-9z' fill='#ff4f6d'/><rect x='70' y='60' width='20' height='16' rx='2' fill='#ffd84a' stroke='#1b1f3b' stroke-width='2'/>`)}, linear-gradient(150deg, #3fc98a, #1a7a5a)`,
  },
  {
    name: 'ニューラルネット（AIエンジニア）',
    group: 'char',
    rarity: 4,
    bg: `${svg(120, 90, `<g stroke='#b9a8ff' stroke-width='1.2' opacity='.35'><path d='M20 20L60 45M20 20L60 15M20 70L60 45M20 70L60 75M60 15L100 45M60 45L100 45M60 75L100 45M20 45L60 15M20 45L60 75'/></g><g fill='#fff' opacity='.45'><circle cx='20' cy='20' r='4'/><circle cx='20' cy='45' r='4'/><circle cx='20' cy='70' r='4'/><circle cx='60' cy='15' r='4'/><circle cx='60' cy='45' r='4'/><circle cx='60' cy='75' r='4'/></g><circle cx='100' cy='45' r='6' fill='#ffd84a'/>`)}, linear-gradient(150deg, #5a3fd0, #1f1660)`,
  },
  {
    name: 'ダンベル柄（トレーナー）',
    group: 'char',
    rarity: 4,
    bg: `${svg(70, 50, `<g fill='#fff' opacity='.35'><rect x='10' y='20' width='30' height='6' rx='2'/><rect x='6' y='14' width='6' height='18' rx='2'/><rect x='38' y='14' width='6' height='18' rx='2'/></g>`)}, linear-gradient(135deg, #ff6a3d, #b3261e)`,
  },
  {
    name: 'ハサミとギターとグラス（3B）',
    group: 'char',
    rarity: 4,
    bg: `${svg(150, 70, `<g stroke='#fff' stroke-width='2' fill='none' opacity='.35'><circle cx='14' cy='50' r='5'/><circle cx='28' cy='50' r='5'/><path d='M17 46L34 22M25 46L10 22'/><path d='M66 52c-8 0-10-10-4-14l10-6 3 4-8 8c4 2 4 8-1 8z'/><path d='M75 34l18-20'/><path d='M118 20h20l-4 16h-12z'/><path d='M128 36v14M121 50h14'/></g>`)}, linear-gradient(140deg, #8a4dff, #2a1040)`,
  },
  {
    name: '赤い糸とハート（メンヘラ）',
    group: 'char',
    rarity: 4,
    bg: `${svg(160, 100, `<path d='M-5 70C30 30 60 90 90 50S140 20 170 40' fill='none' stroke='#ff2a5a' stroke-width='3' stroke-linecap='round'/>${heart(30, 30, 9, '#ff7eb6', 0.8)}${heart(130, 78, 7, '#fff', 0.7)}`)}, linear-gradient(160deg, #ffb3d1, #c46bff)`,
  },
  // ================================================================ SSR：情景がゆっくり動く
  {
    name: '流れ星の夜空',
    group: 'ssr',
    rarity: 5,
    fx: 'stars',
    bg: `${svg(120, 80, `<g fill='#fff'><circle cx='10' cy='12' r='1.2'/><circle cx='60' cy='30' r='.9'/><circle cx='100' cy='8' r='1.4'/><circle cx='30' cy='60' r='1'/><circle cx='90' cy='66' r='.8'/></g>`)}, linear-gradient(180deg, #0a0f2e, #2a1f5a 70%, #4a2a6a)`,
  },
  {
    name: 'オーロラ',
    group: 'ssr',
    rarity: 5,
    fx: 'aurora',
    bg: `${svg(140, 90, `<g fill='#fff' opacity='.7'><circle cx='14' cy='10' r='1'/><circle cx='90' cy='22' r='.8'/><circle cx='120' cy='60' r='1'/></g>`)}, linear-gradient(180deg, #06102a, #0b2a3a)`,
  },
  {
    name: '桜吹雪',
    group: 'ssr',
    rarity: 5,
    fx: 'sakura',
    bg: `radial-gradient(ellipse at 80% 0%, rgba(255,255,255,.35), transparent 55%), linear-gradient(160deg, #ffc4dc, #ff8fb8 55%, #c86bb0)`,
  },
  {
    name: '雪の夜',
    group: 'ssr',
    rarity: 5,
    fx: 'snow',
    bg: `radial-gradient(ellipse at 50% 120%, rgba(255,255,255,.35), transparent 50%), linear-gradient(180deg, #1a2a55, #3a5a99)`,
  },
  {
    name: '夕焼けの海',
    group: 'ssr',
    rarity: 5,
    fx: 'sea',
    bg: `radial-gradient(circle at 88% 50%, #fff3b0 0 16px, #ffb347 17px 20px, transparent 21px), linear-gradient(180deg, #ff7a59 0%, #ffb37a 48%, #2a5a99 52%, #142a55 100%)`,
  },
  {
    name: '蛍の森',
    group: 'ssr',
    rarity: 5,
    fx: 'firefly',
    bg: `${svg(160, 100, `<g fill='#0c2a1a'><path d='M0 100V60l12-20 12 20V40l14-26 14 26v60z'/><path d='M100 100V50l14-24 14 24V36l14-22 18 30v56z'/></g>`)} 0 100% / 100% auto repeat-x, linear-gradient(180deg, #0a1f2a, #133a2a)`,
  },
  // ================================================================ UR：いくつもの動き＋金色に光る縁
  {
    name: '銀河の渦',
    group: 'ur',
    rarity: 6,
    fx: 'galaxy',
    bg: `${full(320, 200, `${twinkle(30, 30, 1.6, 1.7)}${twinkle(250, 24, 1.3, 2.3)}${twinkle(290, 150, 2, 1.4)}${twinkle(110, 170, 1.5, 2.9)}${twinkle(180, 60, 1.1, 1.9)}${twinkle(60, 120, 1.2, 2.6)}${twinkle(220, 120, 1.4, 2.1)}`)}, radial-gradient(ellipse at 50% 50%, #3a1f7a, #0a0620 75%)`,
  },
  {
    name: '打ち上げ花火',
    group: 'ur',
    rarity: 6,
    fx: 'fireworks',
    bg: `${svg(200, 60, `<g fill='#0a0f22'><rect x='0' y='30' width='24' height='30'/><rect x='28' y='18' width='18' height='42'/><rect x='50' y='36' width='30' height='24'/><rect x='120' y='24' width='20' height='36'/><rect x='144' y='34' width='26' height='26'/><rect x='174' y='14' width='26' height='46'/></g>`)} 0 100% / 100% auto repeat-x, ${full(400, 200, `${burst(95, 70, 62, '#ffc850', 2.6, 0)}${burst(235, 58, 50, '#78dcff', 2.6, 1.3)}${burst(362, 40, 24, '#ff7eb6', 7.8, 3.1, 0.33)}${burst(318, 26, 16, '#c8ff78', 11, 6.5, 0.24)}`)}, linear-gradient(180deg, #0a0a2a, #1f1650 80%)`,
  },
  {
    name: '黄金の大舞台',
    group: 'ur',
    rarity: 6,
    fx: 'spotlight',
    bg: `${full(320, 200, `${confetti(40, '#ffd84a', 4.2, 0, 25)}${confetti(110, '#fff6c9', 5.1, 1.2, -30)}${confetti(170, '#ffd84a', 3.8, 2.3, 40)}${confetti(230, '#ffb347', 4.6, 0.6, -20)}${confetti(280, '#fff6c9', 5.4, 3, 30)}${confetti(80, '#ffb347', 4.9, 3.6, -40)}${confetti(200, '#ffd84a', 4.4, 4.4, 15)}`)}, linear-gradient(90deg, #7a0f1f 0 7%, transparent 7% 93%, #7a0f1f 93%), repeating-linear-gradient(90deg, rgba(0,0,0,.25) 0 3px, transparent 3px 12px) 0 0 / 7% 100% no-repeat, linear-gradient(180deg, #2a0f1a, #120608 70%, #6a4a12)`,
  },
];

export const CARD_BG_GROUPS: { id: CardBgGroup; name: string }[] = [
  { id: 'stage', name: 'SR：ステージ' },
  { id: 'char', name: 'SR：キャラ' },
  { id: 'ssr', name: 'SSR：情景が動く' },
  { id: 'ur', name: 'UR：光と動きの特別演出' },
];

/** カードに付ける style と class（bg = 1〜。0 ならなし） */
export function cardBgAttrs(bg: number | undefined): { style: string; cls: string } {
  const d = bg ? CARD_BGS[bg - 1] : undefined;
  if (!d) return { style: '', cls: '' };
  // 模様の SVG に " が入るので、HTML の属性に入れられる形にする
  return { style: `background:${d.bg};`.replace(/"/g, '&quot;'), cls: `has-bg bg-r${d.rarity}${d.fx ? ` fx-${d.fx}` : ''}` };
}
