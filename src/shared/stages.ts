// ステージ定義。足場の上面の高さを y とする（上が +）

export interface Platform {
  x1: number;
  x2: number;
  y: number;
  /** 動く足場：x方向の振れ幅と周期（フレーム） */
  moveAmp?: number;
  movePeriod?: number;
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
  theme: { sky: number; skyBottom: number; ground: number; side: number; plat: number };
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
    theme: { sky: 0x7ec8ff, skyBottom: 0xdff3ff, ground: 0x6cc56c, side: 0x8a6a4a, plat: 0xffffff },
  },
  {
    id: 'tiers',
    name: 'みはらし広場',
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
    theme: { sky: 0xffb47a, skyBottom: 0xffe9c9, ground: 0xc9a66b, side: 0x7a5a3a, plat: 0xfff2d6 },
  },
  {
    id: 'drift',
    name: 'ただよう浮島',
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
    theme: { sky: 0x2b3a67, skyBottom: 0x7d5ba6, ground: 0x9ad1d4, side: 0x4a4e69, plat: 0xc9f2ff },
  },
];

export function getStage(id: string): StageDef {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

/** フレーム番号から動く足場の現在位置を求める */
export function platformAt(p: Platform, frame: number): { x1: number; x2: number; y: number; dx: number } {
  if (!p.moveAmp || !p.movePeriod) return { x1: p.x1, x2: p.x2, y: p.y, dx: 0 };
  const t = (frame / p.movePeriod) * Math.PI * 2;
  const off = Math.sin(t) * p.moveAmp;
  const prev = Math.sin(((frame - 1) / p.movePeriod) * Math.PI * 2) * p.moveAmp;
  return { x1: p.x1 + off, x2: p.x2 + off, y: p.y, dx: off - prev };
}
