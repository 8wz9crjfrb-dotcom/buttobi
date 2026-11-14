// 衣装（着せ替え）のデータ。各キャラに「いつもの服」と、ガチャで引ける SR 2着・SSR 1着。
// SSR はまわりに舞うエフェクトと、攻撃が当たったときの特別なエフェクトが付く。

/** 衣装に付ける小物 */
export type Accessory =
  | 'sunglasses'
  | 'sash'
  | 'cape'
  | 'crown'
  | 'headphones'
  | 'catEars'
  | 'halo'
  | 'scarf'
  | 'starClip'
  | 'bow'
  | 'wings'
  | 'capBack'
  | 'headband'
  | 'coat'
  /** フェスのタオル（片方の肩にかけて垂らす。しま模様） */
  | 'festTowel'
  /** フェスのリストバンド（両手首） */
  | 'fesBand';

/** SSR のエフェクト：まわりに舞う粒の種類と色、攻撃が当たったときの色 */
export interface CostumeFx {
  particle: 'sparkle' | 'data' | 'petal' | 'heart' | 'star' | 'coin' | 'flame';
  color: number;
  /** 当たったときに出す粒の色（虹色は -1） */
  hit: number;
}

export interface Costume {
  id: string;
  charId: string;
  name: string;
  /** レア度：1=いつもの服、4=SR、5=SSR、6=UR */
  rarity: number;
  /** 小物 */
  extras?: Accessory[];
  /** 小物の色（なければ差し色） */
  extraColor?: number;
  /** SSR のエフェクト */
  fx?: CostumeFx;
  /** 3B：仕事ごとの髪色（美容師・バンドマン・バーテンダー）。バーテンダーはいつも黒髪 */
  jobHair?: [number, number, number];
  colors: {
    /** 服のメインの色 */
    main: number;
    /** 服のサブの色（ベスト・パーカーの中など） */
    sub: number;
    /** 差し色（光る部分・小物） */
    accent: number;
    hair: number;
    skin: number;
    /** ズボン */
    pants: number;
    /** 靴 */
    shoes: number;
  };
}

export const COSTUMES: Costume[] = [
  {
    id: 'guard-default',
    charId: 'guard',
    name: 'いつもの制服',
    rarity: 1,
    colors: { main: 0x2c3e75, sub: 0xffd23f, accent: 0xd9dde6, hair: 0x3a2a20, skin: 0xf1c8a0, pants: 0x1f2a4d, shoes: 0x1a1a1a },
  },
  {
    id: 'hacker-default',
    charId: 'hacker',
    name: 'いつものパーカー',
    rarity: 1,
    colors: { main: 0x24242c, sub: 0x15151a, accent: 0x39ff88, hair: 0x1c1c22, skin: 0xf3d2b3, pants: 0x2d3a52, shoes: 0x39ff88 },
  },
  {
    id: 'thief-default',
    charId: 'thief',
    name: 'いつものジャケット',
    rarity: 1,
    colors: { main: 0x3b2a5c, sub: 0x1e1630, accent: 0xff4fa3, hair: 0xff4fa3, skin: 0xe9c3a3, pants: 0x1e1630, shoes: 0xff4fa3 },
  },
  {
    id: 'streamer-default',
    charId: 'streamer',
    name: 'いつもの配信服',
    rarity: 1,
    colors: { main: 0xff9ec8, sub: 0xffffff, accent: 0x7ef0d0, hair: 0xb79cff, skin: 0xffe0cc, pants: 0x6d6a8a, shoes: 0xffffff },
  },
  {
    id: 'dopa-default',
    charId: 'dopa',
    name: 'いつもの蛍光パーカー',
    rarity: 1,
    colors: { main: 0xb6ff3b, sub: 0x2a2a35, accent: 0xff7a1a, hair: 0x2b2b33, skin: 0xffe0cc, pants: 0x3a4a6a, shoes: 0xff7a1a },
  },
  {
    id: 'gacha-default',
    charId: 'gacha',
    name: 'いつものジャージ',
    rarity: 1,
    colors: { main: 0x5a5f8f, sub: 0x2a2c44, accent: 0xffd23f, hair: 0x3b3046, skin: 0xead2c0, pants: 0x2a2c44, shoes: 0x9aa0b8 },
  },
  {
    id: 'courier-default',
    charId: 'courier',
    name: 'いつもの配達服',
    rarity: 1,
    colors: { main: 0x2fbf71, sub: 0x1d2a24, accent: 0xffffff, hair: 0x5a3a24, skin: 0xd9a77e, pants: 0x1d2a24, shoes: 0x2fbf71 },
  },
  {
    id: 'ai-default',
    charId: 'ai',
    name: 'いつものカーディガン',
    rarity: 1,
    colors: { main: 0xe8ecf4, sub: 0x2d4a7a, accent: 0x4fd8ff, hair: 0x2d3a5a, skin: 0xf3d6bd, pants: 0x3a3f4a, shoes: 0x2d3a5a },
  },
  {
    id: 'trainer-default',
    charId: 'trainer',
    name: 'いつものタンクトップ',
    rarity: 1,
    colors: { main: 0xff6a3d, sub: 0x1f1f2a, accent: 0xffffff, hair: 0x2a1a12, skin: 0xc98a5e, pants: 0x1f1f2a, shoes: 0xff6a3d },
  },
  {
    id: 'threeb-default',
    charId: 'threeb',
    name: 'いつもの3B',
    rarity: 1,
    jobHair: [0xeedcb4, 0x4a3048, 0x16161c],
    colors: { main: 0xf2f2f5, sub: 0x1a1a22, accent: 0xc77dff, hair: 0x4a3048, skin: 0xf3d6bd, pants: 0x2a2a34, shoes: 0x1a1a22 },
  },
];


// ---------------------------------------------------------------- ガチャで引ける衣装（キャラごとに SR 2着・SSR 1着）
const c = (main: number, sub: number, accent: number, hair: number, skin: number, pants: number, shoes: number) => ({ main, sub, accent, hair, skin, pants, shoes });
COSTUMES.push(
  // データセンター警備員
  { id: 'guard-night', charId: 'guard', name: '夜勤シフト', rarity: 4, colors: c(0x1b1c26, 0xff3a3a, 0xc0c4cc, 0x2a2420, 0xf1c8a0, 0x14151c, 0x101010), extras: ['sunglasses'] },
  { id: 'guard-formal', charId: 'guard', name: '白の礼装', rarity: 4, colors: c(0xf2f2f5, 0xd9b44a, 0xd9b44a, 0x3a2a20, 0xf1c8a0, 0xe0e2ea, 0x2a2a2a), extras: ['sash'], extraColor: 0xc23a3a },
  {
    id: 'guard-ssr', charId: 'guard', name: '黄金の守護者', rarity: 5, colors: c(0x1c1a14, 0xffd23f, 0xffe9a0, 0x2a2018, 0xf1c8a0, 0x14120c, 0xffd23f),
    extras: ['cape', 'crown'], extraColor: 0xffd23f, fx: { particle: 'sparkle', color: 0xffd23f, hit: 0xffd23f },
  },
  // ハッカー
  { id: 'hacker-white', charId: 'hacker', name: 'ホワイトハット', rarity: 4, colors: c(0xeef0f5, 0xc9ced8, 0x2f8cff, 0xd8c8a8, 0xf3d2b3, 0x6a7a92, 0x2f8cff), extras: ['headphones'], extraColor: 0x2a2f3a },
  { id: 'hacker-cat', charId: 'hacker', name: 'ネコミミパーカー', rarity: 4, colors: c(0xff8fc0, 0xffd6e8, 0xffffff, 0x3a2a3a, 0xf3d2b3, 0x5a4a6a, 0xffffff), extras: ['catEars'], extraColor: 0xff8fc0 },
  {
    id: 'hacker-ssr', charId: 'hacker', name: 'ゼロデイの亡霊', rarity: 5, colors: c(0x1a0f2a, 0x0d0816, 0xc77dff, 0xe8e0ff, 0xd8c8e8, 0x241638, 0xc77dff),
    extras: ['halo'], extraColor: 0xc77dff, fx: { particle: 'data', color: 0xc77dff, hit: 0xc77dff },
  },
  // データ泥棒
  { id: 'thief-rouge', charId: 'thief', name: '怪盗ルージュ', rarity: 4, colors: c(0x1a1418, 0x0e0a0c, 0xe5303f, 0xe5303f, 0xe9c3a3, 0x0e0a0c, 0xe5303f), extras: ['scarf'], extraColor: 0xe5303f },
  { id: 'thief-dawn', charId: 'thief', name: '夜明けの盗人', rarity: 4, colors: c(0x1f2f5a, 0x121a33, 0xffc845, 0xffc845, 0xe9c3a3, 0x121a33, 0xffc845), extras: ['sunglasses'] },
  {
    id: 'thief-ssr', charId: 'thief', name: '月下の大怪盗', rarity: 5, colors: c(0xf2f4fa, 0x2a3a6a, 0x6aa8ff, 0xdfe6ff, 0xf0d8c0, 0x2a3a6a, 0xf2f4fa),
    extras: ['cape'], extraColor: 0x2a3a6a, fx: { particle: 'petal', color: 0xe5303f, hit: 0xe5303f },
  },
  // 配信者
  { id: 'streamer-mint', charId: 'streamer', name: 'ミント配信', rarity: 4, colors: c(0x9ff0d8, 0xffffff, 0xff9ec8, 0xf5f0a8, 0xffe0cc, 0x5a8a8a, 0xffffff), extras: ['starClip'], extraColor: 0xffd23f },
  { id: 'streamer-goth', charId: 'streamer', name: 'ゴシック配信', rarity: 4, colors: c(0x1e1826, 0x8a5cff, 0xff4f8a, 0x2a1f3a, 0xf8e0e0, 0x1e1826, 0x1e1826), extras: ['bow'], extraColor: 0x8a5cff },
  {
    id: 'streamer-ssr', charId: 'streamer', name: 'トップアイドル', rarity: 5, colors: c(0xffffff, 0xffd6ea, 0xffd23f, 0xfff0a8, 0xffe0cc, 0xffd6ea, 0xffffff),
    extras: ['wings', 'crown'], extraColor: 0xffd23f, fx: { particle: 'heart', color: 0xff5ea8, hit: 0xff5ea8 },
  },
  // ドパガキ
  { id: 'dopa-pink', charId: 'dopa', name: 'ピンクパーカー', rarity: 4, colors: c(0xff7ab8, 0x2a2a35, 0x4ad8ff, 0x2b2b33, 0xffe0cc, 0x3a4a6a, 0x4ad8ff), extras: ['capBack'], extraColor: 0x4ad8ff },
  { id: 'dopa-neon', charId: 'dopa', name: 'ネオン迷彩', rarity: 4, colors: c(0x2fd8ff, 0x1a1a28, 0xc77dff, 0x1a1a28, 0xffe0cc, 0x3a2a5a, 0xc77dff), extras: ['sunglasses'] },
  {
    id: 'dopa-ssr', charId: 'dopa', name: '100万再生', rarity: 5, colors: c(0xffffff, 0x1a1a28, 0xff5ea8, 0xffd23f, 0xffe0cc, 0x2a2a3a, 0xffd23f),
    extras: ['crown'], extraColor: 0xffd23f, fx: { particle: 'star', color: 0xffd23f, hit: -1 },
  },
  // ガチャ廃人
  { id: 'gacha-red', charId: 'gacha', name: '赤ジャージ', rarity: 4, colors: c(0xd8323f, 0x8a1a24, 0xffffff, 0x3b3046, 0xead2c0, 0x8a1a24, 0xffffff), extras: ['headband'], extraColor: 0xffffff },
  { id: 'gacha-oil', charId: 'gacha', name: '石油王', rarity: 4, colors: c(0xf6f6f2, 0xe8e4d8, 0xd9b44a, 0x2a2018, 0xd8b090, 0xf6f6f2, 0x8a6a3a), extras: ['sunglasses'] },
  {
    id: 'gacha-ssr', charId: 'gacha', name: '天井到達者', rarity: 5, colors: c(0x1c1a14, 0x0e0d0a, 0xffd23f, 0xffd23f, 0xead2c0, 0x0e0d0a, 0xffd23f),
    extras: ['crown', 'cape'], extraColor: 0xffd23f, fx: { particle: 'coin', color: 0xffd23f, hit: 0xffd23f },
  },
  // フードデリバリー配達員
  { id: 'courier-night', charId: 'courier', name: '深夜便', rarity: 4, colors: c(0x1f2f5a, 0x121a33, 0xff8a1a, 0x5a3a24, 0xd9a77e, 0x121a33, 0xff8a1a), extras: ['scarf'], extraColor: 0xff8a1a },
  { id: 'courier-sakura', charId: 'courier', name: 'サクラ便', rarity: 4, colors: c(0xffb3d1, 0x7a3a5a, 0xffffff, 0x5a3a24, 0xd9a77e, 0x7a3a5a, 0xffffff), extras: ['starClip'], extraColor: 0xffffff },
  {
    id: 'courier-ssr', charId: 'courier', name: '光速便', rarity: 5, colors: c(0xeaf6ff, 0x1a3a6a, 0x2fd8ff, 0x2fd8ff, 0xd9a77e, 0x1a3a6a, 0x2fd8ff),
    extras: ['wings'], extraColor: 0x2fd8ff, fx: { particle: 'flame', color: 0x2fd8ff, hit: 0x2fd8ff },
  },
  // AIエンジニア
  { id: 'ai-dark', charId: 'ai', name: 'ダークモード', rarity: 4, colors: c(0x1e2028, 0x8a5cff, 0x8a5cff, 0x15161c, 0xf3d6bd, 0x15161c, 0x8a5cff), extras: ['sunglasses'] },
  { id: 'ai-labcoat', charId: 'ai', name: '研究室の白衣', rarity: 4, colors: c(0xf8f9fb, 0x3a8a5a, 0x7dffcf, 0x2d3a5a, 0xf3d6bd, 0x3a3f4a, 0x2a2f3a), extras: ['coat'], extraColor: 0xf8f9fb },
  {
    id: 'ai-ssr', charId: 'ai', name: 'シンギュラリティ', rarity: 5, colors: c(0x0e1420, 0x0a0e16, 0x2fe8ff, 0xd8f6ff, 0xe8e0f0, 0x0a0e16, 0x2fe8ff),
    extras: ['halo'], extraColor: 0x2fe8ff, fx: { particle: 'data', color: 0x2fe8ff, hit: 0x2fe8ff },
  },
  // パーソナルトレーナー
  { id: 'trainer-aerobics', charId: 'trainer', name: 'エアロビ講師', rarity: 4, colors: c(0xff4fa3, 0x2fd8ff, 0xffe14f, 0x6a3a1a, 0xe0b08a, 0x2fd8ff, 0xffffff), extras: ['headband'], extraColor: 0xffe14f },
  { id: 'trainer-coach', charId: 'trainer', name: '鬼コーチ', rarity: 4, colors: c(0x1d2a5a, 0xffffff, 0xff3a3a, 0x111111, 0xc98a5e, 0x1d2a5a, 0x111111), extras: ['sunglasses', 'capBack'], extraColor: 0xff3a3a },
  {
    id: 'trainer-ssr', charId: 'trainer', name: '鋼の肉体', rarity: 5, colors: c(0x1c1c22, 0x0e0e12, 0xffd23f, 0xfff0b0, 0xd8a070, 0x0e0e12, 0xffd23f),
    extras: ['cape'], extraColor: 0xff6a3d, fx: { particle: 'flame', color: 0xff8a1a, hit: 0xffd23f },
  },
  // 3B
  // 3B の衣装は、仕事ごとの髪色（jobHair）も変わる。3つの仕事のどれにも合うテーマにする
  {
    id: 'threeb-visual', charId: 'threeb', name: 'ヴィジュアル系', rarity: 4, colors: c(0x2a1a2e, 0x0e0a12, 0xff3a6a, 0xd8d8e8, 0xf3e0e8, 0x0e0a12, 0x2a1a2e),
    extras: ['scarf'], extraColor: 0xff3a6a, jobHair: [0xe2e2f0, 0x1a1420, 0x16161c],
  },
  {
    id: 'threeb-summer', charId: 'threeb', name: '夏フェス', rarity: 4, colors: c(0x1c1c24, 0x4a6fa5, 0xffd23f, 0xd9a050, 0xe8b890, 0x6a8cc0, 0xf4f4f6),
    extras: ['festTowel', 'fesBand'], extraColor: 0xff4f8b, jobHair: [0xf8d878, 0xe09a48, 0x16161c],
  },
  {
    id: 'threeb-ssr', charId: 'threeb', name: 'カリスマ', rarity: 5, colors: c(0x14141a, 0x0a0a0e, 0xffd23f, 0xfff0b0, 0xf3d6bd, 0x0a0a0e, 0xffd23f),
    extras: ['crown'], extraColor: 0xffd23f, fx: { particle: 'heart', color: 0xff5ea8, hit: 0xff5ea8 }, jobHair: [0xfff3c8, 0xe8b830, 0x16161c],
  },
);

/** ガチャで引ける衣装 */
export const GACHA_COSTUMES = COSTUMES.filter((x) => x.rarity >= 4);

/** レア度の表示名 */
export function rarityName(r: number): string {
  return r >= 6 ? 'UR' : r >= 5 ? 'SSR' : r >= 4 ? 'SR' : '';
}

export function defaultCostume(charId: string): Costume {
  return COSTUMES.find((c) => c.charId === charId && c.rarity === 1) ?? COSTUMES[0];
}

export function getCostume(id: string | undefined, charId: string): Costume {
  const c = id ? COSTUMES.find((x) => x.id === id && x.charId === charId) : undefined;
  return c ?? defaultCostume(charId);
}
