import type { MoveId } from './types';

export interface Hitbox {
  /** 選手の足元からの相対位置（x は向きで反転） */
  x: number;
  y: number;
  r: number;
}

export interface MoveDef {
  startup: number;
  active: number;
  end: number;
  hitboxes: Hitbox[];
  dmg: number;
  /** 基礎ふっとばし（m/秒） */
  base: number;
  /** ダメージ100%あたりのふっとばし増加（m/秒） */
  growth: number;
  /** ふっとぶ角度（度）。0=前、90=上、負は下向き */
  angle: number;
  air: boolean;
  /** 地上で出したとき、技中に前へ進む速度 */
  moveX?: number;
  special?: 'shot' | 'dash' | 'recovery' | 'pound' | 'grab' | 'smash';
  /** 着地したときの硬直（空中技） */
  landLag?: number;
}

export const MOVES: Record<MoveId, MoveDef> = {
  jab: { startup: 3, active: 3, end: 9, hitboxes: [{ x: 0.85, y: 0.95, r: 0.55 }], dmg: 3, base: 4, growth: 2.5, angle: 40, air: false },
  side: { startup: 7, active: 4, end: 15, hitboxes: [{ x: 1.0, y: 0.9, r: 0.62 }], dmg: 8, base: 5.5, growth: 9, angle: 35, air: false },
  smash: {
    startup: 14,
    active: 4,
    end: 26,
    hitboxes: [
      { x: 1.25, y: 0.9, r: 0.75 },
      { x: 0.6, y: 0.9, r: 0.55 },
    ],
    dmg: 15,
    base: 7,
    growth: 17,
    angle: 40,
    air: false,
    special: 'smash',
  },
  up: { startup: 6, active: 6, end: 13, hitboxes: [{ x: 0.25, y: 1.95, r: 0.72 }], dmg: 7, base: 6, growth: 8.5, angle: 88, air: false },
  down: { startup: 5, active: 3, end: 11, hitboxes: [{ x: 0.95, y: 0.25, r: 0.6 }], dmg: 6, base: 5, growth: 6, angle: 25, air: false },
  nair: { startup: 4, active: 8, end: 10, hitboxes: [{ x: 0, y: 0.95, r: 0.95 }], dmg: 7, base: 5, growth: 7, angle: 45, air: true, landLag: 6 },
  fair: { startup: 7, active: 4, end: 14, hitboxes: [{ x: 1.0, y: 0.95, r: 0.66 }], dmg: 9, base: 5.5, growth: 10, angle: 40, air: true, landLag: 8 },
  bair: { startup: 6, active: 4, end: 14, hitboxes: [{ x: -1.1, y: 0.95, r: 0.66 }], dmg: 11, base: 6.5, growth: 11.5, angle: 145, air: true, landLag: 8 },
  uair: { startup: 5, active: 5, end: 12, hitboxes: [{ x: 0.1, y: 2.05, r: 0.72 }], dmg: 8, base: 5.5, growth: 9, angle: 85, air: true, landLag: 6 },
  dair: { startup: 9, active: 4, end: 18, hitboxes: [{ x: 0, y: -0.05, r: 0.66 }], dmg: 12, base: 5, growth: 9, angle: -80, air: true, landLag: 12 },
  nspecial: { startup: 12, active: 1, end: 18, hitboxes: [], dmg: 5, base: 3.5, growth: 3.5, angle: 30, air: true, special: 'shot' },
  sspecial: {
    startup: 8,
    active: 12,
    end: 18,
    hitboxes: [{ x: 0.75, y: 0.9, r: 0.72 }],
    dmg: 10,
    base: 6.5,
    growth: 9,
    angle: 35,
    air: true,
    special: 'dash',
    landLag: 10,
  },
  uspecial: { startup: 4, active: 22, end: 4, hitboxes: [{ x: 0.3, y: 1.3, r: 0.85 }], dmg: 6, base: 6, growth: 6, angle: 80, air: true, special: 'recovery' },
  dspecial: {
    startup: 10,
    active: 5,
    end: 20,
    hitboxes: [{ x: 0, y: 0.4, r: 1.35 }],
    dmg: 11,
    base: 6.5,
    growth: 10,
    angle: 70,
    air: true,
    special: 'pound',
    landLag: 14,
  },
  grab: { startup: 6, active: 3, end: 24, hitboxes: [{ x: 0.9, y: 0.95, r: 0.55 }], dmg: 9, base: 6.5, growth: 9.5, angle: 40, air: false, special: 'grab' },
};

/** 飛び道具の基本値 */
export const SHOT = { speed: 13, life: 55, r: 0.38 };
