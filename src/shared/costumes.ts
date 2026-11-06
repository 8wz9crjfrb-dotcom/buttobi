// 衣装（着せ替え）のデータ。
// 今は各キャラの「いつもの服」だけ。後でガチャで引ける衣装を、ここに追加していく。

export interface Costume {
  id: string;
  charId: string;
  name: string;
  /** レア度（ガチャ用）：1=ふつう 〜 5=最高 */
  rarity: number;
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
];

export function defaultCostume(charId: string): Costume {
  return COSTUMES.find((c) => c.charId === charId && c.rarity === 1) ?? COSTUMES[0];
}

export function getCostume(id: string | undefined, charId: string): Costume {
  const c = id ? COSTUMES.find((x) => x.id === id && x.charId === charId) : undefined;
  return c ?? defaultCostume(charId);
}
