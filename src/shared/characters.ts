// キャラクター定義（すべてオリジナル）

export interface CharacterDef {
  id: string;
  name: string;
  /** タイプの説明 */
  role: string;
  color: number;
  accent: number;
  walkSpeed: number;
  runSpeed: number;
  airSpeed: number;
  airAccel: number;
  jumpV: number;
  airJumpV: number;
  airJumps: number;
  gravity: number;
  fallMax: number;
  /** 重さ（大きいほど飛びにくい） */
  weight: number;
  /** 攻撃力の倍率 */
  dmgMul: number;
  /** ふっとばし力の倍率 */
  kbMul: number;
  /** 技の発生・後隙の倍率（大きいほど遅い） */
  frameMul: number;
  /** 上必殺技の上昇速度 */
  recoveryV: number;
  /** 飛び道具の速度・威力倍率 */
  shotMul: number;
  /** 体の大きさ（当たり判定と見た目） */
  scale: number;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'mira',
    name: 'ミラ',
    role: '標準',
    color: 0x4f8cff,
    accent: 0xffffff,
    walkSpeed: 3.6,
    runSpeed: 7.6,
    airSpeed: 5.6,
    airAccel: 40,
    jumpV: 13.2,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 34,
    fallMax: 14,
    weight: 1.0,
    dmgMul: 1.0,
    kbMul: 1.0,
    frameMul: 1.0,
    recoveryV: 16,
    shotMul: 1.0,
    scale: 1.0,
  },
  {
    id: 'bolt',
    name: 'ボルト',
    role: 'スピード',
    color: 0xffc83d,
    accent: 0x30343f,
    walkSpeed: 4.4,
    runSpeed: 9.6,
    airSpeed: 6.4,
    airAccel: 48,
    jumpV: 13.6,
    airJumpV: 12.4,
    airJumps: 1,
    gravity: 38,
    fallMax: 16,
    weight: 0.85,
    dmgMul: 0.85,
    kbMul: 0.92,
    frameMul: 0.82,
    recoveryV: 16.5,
    shotMul: 0.9,
    scale: 0.92,
  },
  {
    id: 'gran',
    name: 'グラン',
    role: 'パワー',
    color: 0xe5484d,
    accent: 0x2b2b2b,
    walkSpeed: 2.9,
    runSpeed: 6.2,
    airSpeed: 4.8,
    airAccel: 32,
    jumpV: 12.4,
    airJumpV: 11.2,
    airJumps: 1,
    gravity: 36,
    fallMax: 15,
    weight: 1.3,
    dmgMul: 1.25,
    kbMul: 1.15,
    frameMul: 1.2,
    recoveryV: 15,
    shotMul: 1.1,
    scale: 1.15,
  },
  {
    id: 'pico',
    name: 'ピコ',
    role: '飛び道具・空中',
    color: 0x46c47e,
    accent: 0xfff3c4,
    walkSpeed: 3.3,
    runSpeed: 7.0,
    airSpeed: 5.8,
    airAccel: 44,
    jumpV: 12.6,
    airJumpV: 11.6,
    airJumps: 2,
    gravity: 30,
    fallMax: 12,
    weight: 0.9,
    dmgMul: 0.95,
    kbMul: 0.95,
    frameMul: 1.0,
    recoveryV: 15.5,
    shotMul: 1.35,
    scale: 0.95,
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** プレイヤー番号ごとの色（頭上の目印・HUDに使う） */
export const SLOT_COLORS = [0xff5a5a, 0x4f9dff, 0xffd23f, 0x4fd18b, 0xc77dff, 0xff9f43];
