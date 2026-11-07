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
  /** 見た目：下に岩をつけた浮島にする（昼のステージ） */
  island?: boolean;
}

/** 昼のステージ（最初からある3つ）の見た目 */
export interface DayTheme {
  kind: 'day';
  sky: number;
  skyBottom: number;
  /** 台の上面・側面・すり抜け足場の色 */
  ground: number;
  side: number;
  plat: number;
}

export type StageTheme = DayTheme | NightTheme;

/** 夜のステージ（サイバーパンク風。追加の3つ）の見た目 */
export interface NightTheme {
  /** 見た目の種類 */
  kind: 'rooftop' | 'arcade' | 'cyber';
  /** 夜空の上と下の色 */
  sky: number;
  skyBottom: number;
  fog: number;
  /** ネオンの2色 */
  neonA: number;
  neonB: number;
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
  theme: StageTheme;
}

export const STAGES: StageDef[] = [
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
    theme: { kind: 'day', sky: 0x7ec8ff, skyBottom: 0xdff3ff, ground: 0x6cc56c, side: 0x8a6a4a, plat: 0xffffff },
  },
  {
    // 広い台。左右のすり抜け床がエレベーターのように上下する
    id: 'tiers',
    name: 'みはらし広場',
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
    theme: { kind: 'day', sky: 0xffb47a, skyBottom: 0xffe9c9, ground: 0xc9a66b, side: 0x7a5a3a, plat: 0xfff2d6 },
  },
  {
    // 小さな島と、まわりを漂う浮島。床は左右・上下・円を描いて動き、台の外まで出ていく
    id: 'drift',
    name: 'ただよう浮島',
    main: { x1: -6.5, x2: 6.5, top: 0, bottom: -4 },
    platforms: [
      // 島の上を大きく横切る床（台の外まで出るので、復帰の足場にもなる）
      { x1: -2, x2: 2, y: 3.4, moveAmp: 8, movePeriod: 600 },
      // 上で円を描く床
      { x1: -1.6, x2: 1.6, y: 7.2, moveAmp: -3.5, moveAmpY: 1.5, movePhaseY: Math.PI / 2, movePeriod: 420 },
      // 島の左右の外で上下する浮島
      { x1: -12, x2: -9, y: 0.5, moveAmpY: 2.5, movePeriod: 360, island: true },
      { x1: 9, x2: 12, y: 0.5, moveAmpY: -2.5, movePeriod: 360, island: true },
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
    theme: { kind: 'day', sky: 0x2b3a67, skyBottom: 0x7d5ba6, ground: 0x9ad1d4, side: 0x4a4e69, plat: 0xc9f2ff },
  },
];

// ---- 追加ステージ（サイバーパンク風）。見た目は夜の街
const base = (id: string) => STAGES.find((s) => s.id === id)!;
STAGES.push(
  { ...base('plain'), id: 'rooftop', name: 'データセンター屋上', theme: { kind: 'rooftop', sky: 0x070a1f, skyBottom: 0x2a1850, fog: 0x1a1236, neonA: 0x39d0ff, neonB: 0xff3fa4 } },
  {
    id: 'arcade',
    name: 'ネオン商店街',
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
    theme: { kind: 'arcade', sky: 0x10051c, skyBottom: 0x4a0f3a, fog: 0x2a0a2a, neonA: 0xff3fa4, neonB: 0xffd23f },
  },
  {
    id: 'cyber',
    name: '電脳空間',
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
    theme: { kind: 'cyber', sky: 0x000814, skyBottom: 0x002a3a, fog: 0x001a26, neonA: 0x00ffc8, neonB: 0x4f7dff },
  },
);

export function getStage(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

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
