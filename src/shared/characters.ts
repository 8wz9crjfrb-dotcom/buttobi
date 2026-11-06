// キャラクター定義（職業がそのままキャラクター）

export interface CharacterDef {
  id: string;
  name: string;
  /** タイプの説明 */
  role: string;
  /** キャラ選択画面の説明文 */
  desc: string;
  /** 基本の色（衣装で変わる） */
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
  /** 体の大きさ（当たり判定と見た目） */
  scale: number;
  /** 必殺技の名前（そのまま・横・下・上） */
  specialNames: { n: string; s: string; d: string; u: string };
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'guard',
    name: 'データセンター警備員',
    role: '盾役・重量級',
    desc: 'サーバーを守るたたき上げの警備員。重くて飛ばされにくい。',
    color: 0x2c3e75,
    accent: 0xffd23f,
    walkSpeed: 2.9,
    runSpeed: 6.4,
    airSpeed: 4.9,
    airAccel: 32,
    jumpV: 12.6,
    airJumpV: 11.6,
    airJumps: 1,
    gravity: 36,
    fallMax: 15,
    weight: 1.35,
    dmgMul: 1.15,
    kbMul: 1.1,
    frameMul: 1.15,
    scale: 1.1,
    specialNames: { n: '利用規約を読み上げる', s: '物理ファイアウォール', d: 'クレーム対応', u: '非常口ダッシュ' },
  },
  {
    id: 'hacker',
    name: 'ハッカー',
    role: '火力・軽量級',
    desc: 'ハッキングで大ダメージ。そのかわり打たれ弱い。',
    color: 0x24242c,
    accent: 0x39ff88,
    walkSpeed: 3.4,
    runSpeed: 7.4,
    airSpeed: 5.6,
    airAccel: 42,
    jumpV: 13.0,
    airJumpV: 12.0,
    airJumps: 1,
    gravity: 33,
    fallMax: 13.5,
    weight: 0.85,
    dmgMul: 1.12,
    kbMul: 1.1,
    frameMul: 1.0,
    scale: 0.95,
    specialNames: { n: 'DDoS', s: '全体メール誤送信', d: 'キャッシュ', u: 'ポップアップ広告' },
  },
  {
    id: 'thief',
    name: 'データ泥棒',
    role: '妨害・スピード',
    desc: 'すばやく動き、ウイルスでじわじわ削る。',
    color: 0x3b2a5c,
    accent: 0xff4fa3,
    walkSpeed: 4.4,
    runSpeed: 9.8,
    airSpeed: 6.4,
    airAccel: 50,
    jumpV: 13.8,
    airJumpV: 12.6,
    airJumps: 1,
    gravity: 38,
    fallMax: 16,
    weight: 0.85,
    dmgMul: 0.85,
    kbMul: 0.92,
    frameMul: 0.82,
    scale: 0.92,
    specialNames: { n: 'マルウェア', s: 'スクショ', d: 'オフライン表示', u: '炎上させる' },
  },
  {
    id: 'streamer',
    name: '配信者',
    role: '邪魔・牽制',
    desc: 'なかまを盛り上げ、相手を眠らせる。標準的な性能。',
    color: 0xff7eb6,
    accent: 0x7ef0d0,
    walkSpeed: 3.6,
    runSpeed: 7.6,
    airSpeed: 5.8,
    airAccel: 42,
    jumpV: 13.2,
    airJumpV: 12.2,
    airJumps: 1,
    gravity: 32,
    fallMax: 13,
    weight: 1.0,
    dmgMul: 1.08,
    kbMul: 1.0,
    frameMul: 1.0,
    scale: 1.0,
    specialNames: { n: '投げ銭', s: '切り抜き', d: '強制アップデート', u: 'スパチャ読み' },
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** プレイヤー番号ごとの色（頭上の目印・HUDに使う） */
export const SLOT_COLORS = [0xff5a5a, 0x4f9dff, 0xffd23f, 0x4fd18b, 0xc77dff, 0xff9f43];
