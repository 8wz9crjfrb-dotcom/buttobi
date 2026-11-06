import type { MoveId } from './types';

export interface Hitbox {
  /** 選手の足元からの相対位置（x は向きで反転） */
  x: number;
  y: number;
  r: number;
}

/** 飛び道具の見た目の種類 */
export type ShotKind = 'text' | 'bullet' | 'mail' | 'malware' | 'coin' | 'thanks';

export interface ShotSpec {
  /** 技が出てから何フレーム後に出すか */
  at: number;
  kind: ShotKind;
  /** 出る位置（足元から。x は向きで反転） */
  x: number;
  y: number;
  /** 速さ（vx は向きで反転） */
  vx: number;
  vy: number;
  /** 重力（山なりに飛ぶもの） */
  gravity?: number;
  life: number;
  r: number;
  dmg: number;
  base: number;
  growth: number;
  angle: number;
  /** ひるみ時間の倍率 */
  hitstunMul?: number;
  /** 毒：当たった相手がこのフレーム数の間、少しずつダメージを受ける */
  poison?: number;
}

export type SpecialKind =
  | 'shot'
  | 'dash'
  | 'recovery'
  | 'grab'
  | 'smash'
  | 'wall'
  | 'counter'
  | 'trap'
  | 'platform'
  | 'invis'
  | 'teleport'
  | 'sleep';

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
  special?: SpecialKind;
  /** 着地したときの硬直（空中技） */
  landLag?: number;
  /** 飛び道具 */
  shots?: ShotSpec[];
  /** 突進の速さ（dash） */
  dashSpeed?: number;
  /** 上昇の速さ（recovery / platform）。riseVx は向きで反転する横方向の速さ */
  riseV?: number;
  riseVx?: number;
  /** 何フレームごとに同じ相手に再び当たるか（連続ヒット） */
  rehit?: number;
  /** 使った後、着地まで無防備になる */
  helpless?: boolean;
}

/** 4体共通の通常技（キャラごとの攻撃力・速さの倍率がかかる） */
const NORMALS: Record<string, MoveDef> = {
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
  grab: { startup: 6, active: 3, end: 24, hitboxes: [{ x: 0.9, y: 0.95, r: 0.55 }], dmg: 9, base: 6.5, growth: 9.5, angle: 40, air: false, special: 'grab' },
};

type Specials = { nspecial: MoveDef; sspecial: MoveDef; dspecial: MoveDef; uspecial: MoveDef };

/** キャラごとの必殺技 */
const SPECIALS: Record<string, Specials> = {
  guard: {
    // 利用規約を読み上げる：ゆっくり進む大きな文字。当たると長くひるむ
    nspecial: {
      startup: 16,
      active: 1,
      end: 22,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      shots: [{ at: 0, kind: 'text', x: 0.9, y: 1.0, vx: 4.5, vy: 0, life: 120, r: 0.55, dmg: 7, base: 4, growth: 4, angle: 20, hitstunMul: 2.2 }],
    },
    // 物理ファイアウォール：前に壁を出す（飛び道具を消し、相手を押し返す）
    sspecial: { startup: 8, active: 4, end: 18, hitboxes: [{ x: 1.0, y: 0.9, r: 0.7 }], dmg: 4, base: 7, growth: 4, angle: 30, air: true, special: 'wall', landLag: 10 },
    // クレーム対応：構えている間に攻撃されたら1.3倍で返す
    dspecial: { startup: 4, active: 30, end: 24, hitboxes: [], dmg: 0, base: 7, growth: 10, angle: 40, air: true, special: 'counter' },
    // 非常口ダッシュ：斜め上へ突進して復帰
    uspecial: {
      startup: 6,
      active: 18,
      end: 6,
      hitboxes: [{ x: 0.5, y: 1.0, r: 0.8 }],
      dmg: 8,
      base: 6,
      growth: 7,
      angle: 55,
      air: true,
      special: 'recovery',
      riseV: 13.5,
      riseVx: 7,
      helpless: true,
    },
  },
  hacker: {
    // DDoS：小さな弾を3連射
    nspecial: {
      startup: 8,
      active: 12,
      end: 14,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      shots: [0, 5, 10].map((at) => ({ at, kind: 'bullet' as const, x: 0.9, y: 1.0, vx: 16, vy: 0, life: 40, r: 0.25, dmg: 2.2, base: 2.5, growth: 2, angle: 25 })),
    },
    // 全体メール誤送信：封筒が3方向に広がって飛ぶ
    sspecial: {
      startup: 12,
      active: 1,
      end: 20,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      landLag: 10,
      shots: [-3.5, 0, 3.5].map((vy) => ({ at: 0, kind: 'mail' as const, x: 0.8, y: 1.0, vx: 10, vy, life: 45, r: 0.35, dmg: 4, base: 4, growth: 5, angle: 35 })),
    },
    // キャッシュ：足元に罠を置く（1個まで）。触れると爆発
    dspecial: { startup: 10, active: 1, end: 16, hitboxes: [], dmg: 10, base: 7, growth: 10, angle: 80, air: true, special: 'trap' },
    // ポップアップ広告：足元に窓を出し、足場にして上昇
    uspecial: {
      startup: 4,
      active: 18,
      end: 4,
      hitboxes: [{ x: 0.2, y: 1.2, r: 0.7 }],
      dmg: 5,
      base: 5,
      growth: 5,
      angle: 85,
      air: true,
      special: 'platform',
      riseV: 15,
      helpless: true,
    },
  },
  thief: {
    // マルウェア：当たった相手は約3秒間、少しずつダメージ
    nspecial: {
      startup: 10,
      active: 1,
      end: 18,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      shots: [{ at: 0, kind: 'malware', x: 0.9, y: 1.0, vx: 11, vy: 0, life: 50, r: 0.32, dmg: 2, base: 2.5, growth: 1.5, angle: 30, poison: 180 }],
    },
    // スクショ：フラッシュとともに高速で突き抜ける
    sspecial: {
      startup: 7,
      active: 10,
      end: 16,
      hitboxes: [{ x: 0.6, y: 0.9, r: 0.72 }],
      dmg: 9,
      base: 6.5,
      growth: 9,
      angle: 30,
      air: true,
      special: 'dash',
      dashSpeed: 18,
      landLag: 10,
    },
    // オフライン表示：一瞬だけ透明になり攻撃が当たらない
    dspecial: { startup: 2, active: 28, end: 18, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'invis' },
    // 炎上させる：炎をまとって上昇（連続ヒット）
    uspecial: {
      startup: 4,
      active: 22,
      end: 4,
      hitboxes: [{ x: 0.1, y: 1.0, r: 0.85 }],
      dmg: 2.5,
      base: 3.5,
      growth: 1.5,
      angle: 85,
      air: true,
      special: 'recovery',
      riseV: 15.5,
      rehit: 6,
      helpless: true,
    },
  },
  streamer: {
    // 投げ銭：コインを山なりに投げる
    nspecial: {
      startup: 10,
      active: 1,
      end: 16,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      shots: [{ at: 0, kind: 'coin', x: 0.7, y: 1.3, vx: 8, vy: 9, gravity: 28, life: 80, r: 0.3, dmg: 6, base: 5, growth: 5, angle: 45 }],
    },
    // 切り抜き：少し先へ瞬間移動して斬る
    sspecial: { startup: 10, active: 4, end: 18, hitboxes: [{ x: 0.6, y: 0.9, r: 0.85 }], dmg: 10, base: 6.5, growth: 9, angle: 40, air: true, special: 'teleport', landLag: 10 },
    // 強制アップデート：近くの相手をしばらく動けなくする
    dspecial: { startup: 10, active: 4, end: 24, hitboxes: [{ x: 0, y: 0.9, r: 1.6 }], dmg: 2, base: 0, growth: 0, angle: 0, air: true, special: 'sleep' },
    // スパチャ読み：上昇しながら周りにお礼の文字を飛ばす
    uspecial: {
      startup: 4,
      active: 20,
      end: 4,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'recovery',
      riseV: 15.5,
      helpless: true,
      shots: [
        [-6, 4],
        [6, 4],
        [-5, -3],
        [5, -3],
      ].map(([vx, vy]) => ({ at: 0, kind: 'thanks' as const, x: 0, y: 1.0, vx, vy, life: 28, r: 0.3, dmg: 3, base: 4, growth: 3, angle: 60 })),
    },
  },
};

/** そのキャラの技のデータ */
export function moveOf(charId: string, id: MoveId): MoveDef {
  if (id === 'nspecial' || id === 'sspecial' || id === 'dspecial' || id === 'uspecial') {
    return (SPECIALS[charId] ?? SPECIALS.guard)[id];
  }
  return NORMALS[id];
}

/** 罠（キャッシュ）の設定 */
export const TRAP = { life: 600, r: 0.6, armDelay: 30 };
/** 壁（物理ファイアウォール）の設定 */
export const WALL = { life: 80, w: 0.35, h: 2.4, offset: 1.1 };
/** 一時的な足場（ポップアップ広告）の設定 */
export const POPUP = { life: 200, w: 2.4 };
