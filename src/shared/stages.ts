import { PREVIEW } from './characters';
// ステージ定義。足場の上面の高さを y とする（上が +）

export interface Platform {
  x1: number;
  x2: number;
  y: number;
  /** 動く足場：x方向の振れ幅と周期（フレーム） */
  moveAmp?: number;
  movePeriod?: number;
  /** 動く足場：y方向の振れ幅と、x方向の動きとのずれ（ラジアン。π/2 で円を描く） */
  moveAmpY?: number;
  movePhaseY?: number;
}

/** ステージの見た目の種類（キャラごとのステージ。sky はキャラに関係ないデフォルト） */
export type StageKind = 'room' | 'sky' | 'rooftop' | 'cyber' | 'vault' | 'studio' | 'timeline' | 'gacha' | 'arcade' | 'lab' | 'gym' | 'livebar';

export interface StageTheme {
  kind: StageKind;
  /** 明るい照明（昼・明るい室内）。false は夜・暗い室内で、光のにじみをかける */
  bright: boolean;
  /** 空（背景）の上と下の色、霞の色 */
  sky: number;
  skyBottom: number;
  fog: number;
  /** アクセントの2色（ネオン・照明・飾り） */
  accentA: number;
  accentB: number;
}

export interface StageDef {
  id: string;
  name: string;
  /** すり抜けできない本体の台 */
  main: { x1: number; x2: number; top: number; bottom: number };
  platforms: Platform[];
  blast: { left: number; right: number; top: number; bottom: number };
  spawns: { x: number; y: number }[];
  respawnY: number;
  /** 大人数（WIDE_PLAYERS 人以上）のときに使う、広い形（台・足場・場外の線・出てくる場所） */
  wide?: Pick<StageDef, 'main' | 'platforms' | 'blast' | 'spawns' | 'respawnY'>;
  theme: StageTheme;
  /** 関係するキャラ（デフォルトのステージは無し） */
  charId?: string;
}

/** すべてのステージ（まだ公開していないステージも含む） */
export const ALL_STAGES: StageDef[] = [
  {
    id: 'plain',
    name: 'そらの台地',
    main: { x1: -9, x2: 9, top: 0, bottom: -3 },
    platforms: [],
    blast: { left: -21, right: 21, top: 17, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 8,
    theme: { kind: 'sky', bright: true, sky: 0x5fb4ff, skyBottom: 0xe6f6ff, fog: 0xd6eeff, accentA: 0x7fd36a, accentB: 0x9a7350 },
  },
  {
    // ガチャ会場：広い台。左右のすり抜け床（カプセル型のリフト）が上下する
    id: 'gacha',
    name: 'ガチャ会場',
    charId: 'gacha',
    main: { x1: -13, x2: 13, top: 0, bottom: -3 },
    platforms: [
      { x1: -11.5, x2: -7.5, y: 4.2, moveAmpY: 2.6, movePeriod: 300 },
      { x1: 7.5, x2: 11.5, y: 4.2, moveAmpY: -2.6, movePeriod: 300 },
      { x1: -2.6, x2: 2.6, y: 3.6 },
      { x1: -1.8, x2: 1.8, y: 7.4 },
    ],
    blast: { left: -26, right: 26, top: 19, bottom: -11 },
    spawns: [
      { x: -8, y: 0 },
      { x: 8, y: 0 },
      { x: -3, y: 0 },
      { x: 3, y: 0 },
      { x: -11, y: 0 },
      { x: 11, y: 0 },
    ],
    respawnY: 11,
    theme: { kind: 'gacha', bright: true, sky: 0x3a1f6e, skyBottom: 0xff8fb8, fog: 0x7a3f8a, accentA: 0xffd23f, accentB: 0xff5ea8 },
  },
  {
    // スマホのタイムライン：小さな台と、流れていく動画の画面（床は左右・上下・円を描いて動き、台の外まで出ていく）
    id: 'timeline',
    name: 'スマホのタイムライン',
    charId: 'dopa',
    main: { x1: -6.5, x2: 6.5, top: 0, bottom: -4 },
    platforms: [
      // 島の上を大きく横切る床（台の外まで出るので、復帰の足場にもなる）
      { x1: -2, x2: 2, y: 3.4, moveAmp: 8, movePeriod: 600 },
      // 上で円を描く床
      { x1: -1.6, x2: 1.6, y: 7.2, moveAmp: -3.5, moveAmpY: 1.5, movePhaseY: Math.PI / 2, movePeriod: 420 },
      // 島の左右の外で上下する浮島
      { x1: -12, x2: -9, y: 0.5, moveAmpY: 2.5, movePeriod: 360 },
      { x1: 9, x2: 12, y: 0.5, moveAmpY: -2.5, movePeriod: 360 },
    ],
    blast: { left: -23, right: 23, top: 19, bottom: -12 },
    spawns: [
      { x: -4.5, y: 0 },
      { x: 4.5, y: 0 },
      { x: -1.5, y: 0 },
      { x: 1.5, y: 0 },
      { x: -6, y: 0 },
      { x: 6, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'timeline', bright: false, sky: 0x0d0f1a, skyBottom: 0x26163d, fog: 0x1a1430, accentA: 0xb6ff3a, accentB: 0xff7a1a },
  },
];

// ---- キャラごとのステージ（並びはキャラの順。ガチャ会場とタイムラインは上で定義済み）
const base = (id: string) => ALL_STAGES.find((s) => s.id === id)!;
const plainShape = base('plain');
const gachaStage = base('gacha');
const timelineStage = base('timeline');
ALL_STAGES.length = 1; // そらの台地だけ残して、キャラの順に並べ直す
ALL_STAGES.push(
  {
    ...plainShape,
    id: 'rooftop',
    name: 'データセンター屋上',
    charId: 'guard',
    theme: { kind: 'rooftop', bright: false, sky: 0x070a1f, skyBottom: 0x2a1850, fog: 0x1a1236, accentA: 0x39d0ff, accentB: 0xff3fa4 },
  },
  {
    id: 'cyber',
    name: '電脳空間',
    charId: 'hacker',
    main: { x1: -8, x2: 8, top: 0, bottom: -4 },
    platforms: [
      { x1: -2.5, x2: 2.5, y: 3.6, moveAmp: 5, movePeriod: 480 },
      { x1: -2, x2: 2, y: 7.0, moveAmp: -3, movePeriod: 360 },
    ],
    blast: { left: -21, right: 21, top: 18, bottom: -11 },
    spawns: [
      { x: -5.5, y: 0 },
      { x: 5.5, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -7, y: 0 },
      { x: 7, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'cyber', bright: false, sky: 0x000805, skyBottom: 0x002418, fog: 0x00140c, accentA: 0x39ff88, accentB: 0x2fd8ff },
  },
  {
    // 深夜の金庫室：左右の足場と、上下にゆっくり動く上の足場
    id: 'vault',
    name: '深夜の金庫室',
    charId: 'thief',
    main: { x1: -9, x2: 9, top: 0, bottom: -3 },
    platforms: [
      { x1: -6.5, x2: -2.6, y: 3.0 },
      { x1: 2.6, x2: 6.5, y: 3.0 },
      { x1: -1.6, x2: 1.6, y: 6.0, moveAmpY: 1.2, movePeriod: 420 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 9,
    theme: { kind: 'vault', bright: false, sky: 0x08080f, skyBottom: 0x1a0d14, fog: 0x120a10, accentA: 0xff2a3a, accentB: 0xffc845 },
  },
  {
    // 配信スタジオ：広い台。左右のカメラクレーン（足場）が円を描いて動き、中央の上にリングライトの足場
    id: 'studio',
    name: '配信スタジオ',
    charId: 'streamer',
    main: { x1: -11, x2: 11, top: 0, bottom: -3 },
    platforms: [
      { x1: -8.5, x2: -5, y: 3.4, moveAmp: 1.5, moveAmpY: 1.0, movePhaseY: Math.PI / 2, movePeriod: 480 },
      { x1: 5, x2: 8.5, y: 3.4, moveAmp: -1.5, moveAmpY: 1.0, movePhaseY: Math.PI / 2, movePeriod: 480 },
      { x1: -2, x2: 2, y: 5.6 },
    ],
    blast: { left: -24, right: 24, top: 19, bottom: -11 },
    spawns: [
      { x: -7, y: 0 },
      { x: 7, y: 0 },
      { x: -2.5, y: 0 },
      { x: 2.5, y: 0 },
      { x: -9.5, y: 0 },
      { x: 9.5, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'studio', bright: true, sky: 0xffc6e0, skyBottom: 0xfff1f7, fog: 0xffe0ee, accentA: 0xff5ea8, accentB: 0x8a5cff },
  },
  { ...timelineStage },
  { ...gachaStage },
  {
    id: 'arcade',
    name: 'ネオン商店街',
    charId: 'courier',
    main: { x1: -10, x2: 10, top: 0, bottom: -3 },
    platforms: [
      { x1: -7, x2: -2.5, y: 3.2 },
      { x1: 2.5, x2: 7, y: 3.2 },
      { x1: -2.5, x2: 2.5, y: 6.2 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -7, y: 0 },
      { x: 7, y: 0 },
      { x: -4.7, y: 3.2 },
      { x: 4.7, y: 3.2 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'arcade', bright: false, sky: 0x10051c, skyBottom: 0x4a0f3a, fog: 0x2a0a2a, accentA: 0xff3fa4, accentB: 0xffd23f },
  },
  {
    // AIラボ：左右の足場が逆向きに横へ動き、上に動かない足場
    id: 'lab',
    name: 'AIラボ',
    charId: 'ai',
    main: { x1: -9, x2: 9, top: 0, bottom: -3 },
    platforms: [
      { x1: -7, x2: -3.6, y: 2.8, moveAmp: 1.4, movePeriod: 300 },
      { x1: 3.6, x2: 7, y: 2.8, moveAmp: -1.4, movePeriod: 300 },
      { x1: -2, x2: 2, y: 5.6 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 9,
    theme: { kind: 'lab', bright: true, sky: 0xdfeefa, skyBottom: 0xf6fbff, fog: 0xe6f1fa, accentA: 0x2aa8ff, accentB: 0x7dffcf },
  },
  {
    // 24時間ジム：左右のベンチと、上下に動くバーベルの足場
    id: 'gym',
    name: '24時間ジム',
    charId: 'trainer',
    main: { x1: -9.5, x2: 9.5, top: 0, bottom: -3 },
    platforms: [
      { x1: -7.5, x2: -4, y: 2.6 },
      { x1: 4, x2: 7.5, y: 2.6 },
      { x1: -2, x2: 2, y: 4.6, moveAmpY: 1.3, movePeriod: 360 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'gym', bright: true, sky: 0xf3ece2, skyBottom: 0xfff8ee, fog: 0xf2e8da, accentA: 0xff6a3d, accentB: 0x2fbfa0 },
  },
  {
    // 夜のライブバー：左はライブのステージ、右はバーカウンター、上をミラーボールの足場が左右に動く
    id: 'livebar',
    name: '夜のライブバー',
    charId: 'threeb',
    main: { x1: -9.5, x2: 9.5, top: 0, bottom: -3 },
    platforms: [
      { x1: -7.5, x2: -3.5, y: 2.4 },
      { x1: 3.5, x2: 7.5, y: 2.4 },
      { x1: -1.8, x2: 1.8, y: 5.2, moveAmp: 2.2, movePeriod: 420 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'livebar', bright: false, sky: 0x0c0612, skyBottom: 0x2a0f2a, fog: 0x1a0a1e, accentA: 0xc77dff, accentB: 0xff5ea8 },
  },
  {
    // 深夜のワンルーム（メンヘラ）：ベッドと棚の足場。まだ公開していない
    id: 'room',
    name: '深夜のワンルーム',
    charId: 'menhera',
    main: { x1: -9.5, x2: 9.5, top: 0, bottom: -3 },
    platforms: [
      { x1: -7.2, x2: -3.6, y: 2.4 },
      { x1: 3.6, x2: 7.2, y: 2.4 },
      { x1: -1.8, x2: 1.8, y: 4.4 },
    ],
    blast: { left: -22, right: 22, top: 18, bottom: -11 },
    spawns: [
      { x: -6, y: 0 },
      { x: 6, y: 0 },
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: -4, y: 0 },
      { x: 4, y: 0 },
    ],
    respawnY: 10,
    theme: { kind: 'room', bright: false, sky: 0x120a1c, skyBottom: 0x2a1238, fog: 0x1c1028, accentA: 0xff7ab8, accentB: 0x9b7dff },
  },
);

/** まだ公開していないステージ */
export const HIDDEN_STAGES: string[] = [];
/** 選べるステージ（ふだんは公開しているステージだけ） */
export const STAGES: StageDef[] = PREVIEW ? ALL_STAGES : ALL_STAGES.filter((s) => !HIDDEN_STAGES.includes(s.id));

/** ステージ「おまかせ」：試合ごとにランダムなステージにする */
export const RANDOM_STAGE = 'random';

/** 「おまかせ」なら、決まった値（試合の種など）からステージを選ぶ。それ以外はそのまま */
export function resolveStage(id: string, seed: number): string {
  if (id !== RANDOM_STAGE) return id;
  return STAGES[Math.abs(Math.floor(seed)) % STAGES.length].id;
}

export function getStage(id: string): StageDef {
  return ALL_STAGES.find((s) => s.id === id) ?? ALL_STAGES[0];
}

/** この人数（CPUも含む）以上なら、狭いステージは広い形で戦う */
export const WIDE_PLAYERS = 4;
/** 試合で使うステージの形：人数が多いときは広い形（あれば）。100人組手はいつもふつうの形 */
export function stageFor(id: string, players: number, horde = false): StageDef {
  const s = getStage(id);
  return s.wide && players >= WIDE_PLAYERS && !horde ? { ...s, ...s.wide } : s;
}

/** 試合で使うステージの形。玉入れでは、どのステージも上の足場（すり抜け床）をなくす（広さは人数で変わるのは同じ） */
export function stageForMatch(id: string, players: number, rules: { mode?: string; horde?: unknown }): StageDef {
  const s = stageFor(id, players, !!rules.horde);
  return rules.mode === 'ball' && !rules.horde ? { ...s, platforms: [] } : s;
}

// ---- 狭いステージの、大人数用の広い形
/** そらの台地・データセンター屋上：台を 18m → 25m に広げ、左右にすり抜け床を足す */
const WIDE_PLAIN: StageDef['wide'] = {
  main: { x1: -12.5, x2: 12.5, top: 0, bottom: -3 },
  platforms: [
    { x1: -9, x2: -5, y: 3.4 },
    { x1: 5, x2: 9, y: 3.4 },
  ],
  // 場外の線は少し内側に（広いと撃墜されにくくなるため）
  blast: { left: -22, right: 22, top: 17, bottom: -11 },
  spawns: [
    { x: -9, y: 0 },
    { x: 9, y: 0 },
    { x: -3, y: 0 },
    { x: 3, y: 0 },
    { x: -6, y: 0 },
    { x: 6, y: 0 },
  ],
  respawnY: 9,
};
for (const id of ['plain', 'rooftop']) getStage(id).wide = WIDE_PLAIN;
/** 電脳空間：台を 16m → 23m に。動く足場の動く幅も広げる */
getStage('cyber').wide = {
  main: { x1: -11.5, x2: 11.5, top: 0, bottom: -4 },
  platforms: [
    { x1: -2.5, x2: 2.5, y: 3.6, moveAmp: 7.5, movePeriod: 540 },
    { x1: -2, x2: 2, y: 7.0, moveAmp: -4.5, movePeriod: 420 },
  ],
  blast: { left: -22, right: 22, top: 17, bottom: -11 },
  spawns: [
    { x: -8, y: 0 },
    { x: 8, y: 0 },
    { x: -3, y: 0 },
    { x: 3, y: 0 },
    { x: -10, y: 0 },
    { x: 10, y: 0 },
  ],
  respawnY: 10,
};
/** スマホのタイムライン：台を 13m → 19m に。横切る床と、左右の浮島も外へ */
getStage('timeline').wide = {
  main: { x1: -9.5, x2: 9.5, top: 0, bottom: -4 },
  platforms: [
    { x1: -2, x2: 2, y: 3.4, moveAmp: 10.5, movePeriod: 660 },
    { x1: -1.6, x2: 1.6, y: 7.2, moveAmp: -4.5, moveAmpY: 1.5, movePhaseY: Math.PI / 2, movePeriod: 480 },
    { x1: -15, x2: -12, y: 0.5, moveAmpY: 2.5, movePeriod: 360 },
    { x1: 12, x2: 15, y: 0.5, moveAmpY: -2.5, movePeriod: 360 },
  ],
  blast: { left: -22, right: 22, top: 17, bottom: -12 },
  spawns: [
    { x: -6.5, y: 0 },
    { x: 6.5, y: 0 },
    { x: -2, y: 0 },
    { x: 2, y: 0 },
    { x: -8.5, y: 0 },
    { x: 8.5, y: 0 },
  ],
  respawnY: 10,
};

/** 動く足場の、元の位置からのずれ */
function platformOffset(p: Platform, frame: number): [number, number] {
  if (!p.movePeriod) return [0, 0];
  const t = (frame / p.movePeriod) * Math.PI * 2;
  return [Math.sin(t) * (p.moveAmp ?? 0), Math.sin(t + (p.movePhaseY ?? 0)) * (p.moveAmpY ?? 0)];
}

/** フレーム番号から動く足場の現在位置を求める（dx/dy は前のフレームからの移動量、prevY は前のフレームの高さ） */
export function platformAt(p: Platform, frame: number): { x1: number; x2: number; y: number; dx: number; dy: number; prevY: number } {
  if (!p.movePeriod) return { x1: p.x1, x2: p.x2, y: p.y, dx: 0, dy: 0, prevY: p.y };
  const [ox, oy] = platformOffset(p, frame);
  const [px, py] = platformOffset(p, frame - 1);
  return { x1: p.x1 + ox, x2: p.x2 + ox, y: p.y + oy, dx: ox - px, dy: oy - py, prevY: p.y + py };
}
