import type { MoveId } from './types';

export interface Hitbox {
  /** 選手の足元からの相対位置（x は向きで反転） */
  x: number;
  y: number;
  r: number;
}

/** 飛び道具の見た目の種類 */
export type ShotKind =
  | 'text'
  | 'bullet'
  | 'mail'
  | 'malware'
  | 'coin'
  | 'thanks'
  | 'badge'
  | 'stone'
  | 'bag'
  | 'orb'
  | 'gold'
  | 'spark'
  // ステージギミック
  | 'packet'
  | 'laser'
  | 'comment'
  | 'notif'
  | 'capsule'
  | 'scooter'
  | 'beam';

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
  /** 当たった相手の左右の操作を、このフレーム数の間だけ逆にする */
  confuse?: number;
  /** いちばん近い相手を追いかける（曲がる速さ） */
  homing?: number;
  /** 一定フレーム後に持ち主のところへ戻ってくる（ブーメラン） */
  boomerang?: number;
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
  | 'sleep'
  | 'speedup'
  | 'scroll'
  | 'redirect'
  | 'gacha10'
  | 'gacha1'
  | 'pay'
  | 'bike'
  | 'food'
  | 'absorb'
  | 'decoy'
  | 'tether'
  | 'swap'
  | 'drone'
  | 'pull'
  | 'charge'
  | 'pummel'
  | 'throw'
  | 'taunt';

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
  // 溜め攻撃：Aを押し続けると弱攻撃のあとに溜めに入り、離すと大きく殴る（最大1.5秒、威力最大1.75倍）
  charge: {
    startup: 20,
    active: 5,
    end: 26,
    hitboxes: [
      { x: 1.2, y: 0.95, r: 0.8 },
      { x: 0.55, y: 0.95, r: 0.6 },
    ],
    dmg: 12,
    base: 8,
    growth: 15,
    angle: 38,
    air: false,
    special: 'charge',
  },
  // つかんでいる間：Aでつかみ攻撃、スティックの方向へ投げる（当たり判定は使わず、投げる瞬間に飛ばす）
  // アピール：ガード中にスティックを上にはじく。キャラごとの一言（当たり判定なし）
  taunt: { startup: 2, active: 1, end: 64, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: false, special: 'taunt' },
  pummel: { startup: 4, active: 1, end: 10, hitboxes: [], dmg: 1.5, base: 0, growth: 0, angle: 0, air: false, special: 'pummel' },
  fthrow: { startup: 8, active: 1, end: 16, hitboxes: [], dmg: 8, base: 7, growth: 8.5, angle: 40, air: false, special: 'throw' },
  bthrow: { startup: 12, active: 1, end: 16, hitboxes: [], dmg: 10, base: 7.5, growth: 10, angle: 40, air: false, special: 'throw' },
  uthrow: { startup: 10, active: 1, end: 16, hitboxes: [], dmg: 7, base: 7, growth: 8.5, angle: 88, air: false, special: 'throw' },
  dthrow: { startup: 10, active: 1, end: 18, hitboxes: [], dmg: 6, base: 5.5, growth: 5, angle: 70, air: false, special: 'throw' },
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
    // なりすまし：近くの相手と位置を入れ替える（相手は一瞬固まる）
    dspecial: { startup: 12, active: 1, end: 22, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'swap' },
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
  dopa: {
    // 倍速再生：しばらく動きと攻撃が速くなる
    nspecial: { startup: 6, active: 1, end: 12, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'speedup' },
    // 無限スクロール：横へ滑って攻撃。Bを押し直すと最大3回まで続けられる
    sspecial: {
      startup: 5,
      active: 9,
      end: 14,
      hitboxes: [{ x: 0.5, y: 0.8, r: 0.7 }],
      dmg: 5.5,
      base: 4.5,
      growth: 5.5,
      angle: 30,
      air: true,
      special: 'scroll',
      dashSpeed: 12,
      landLag: 8,
    },
    // 通知爆撃：通知に気を取られた周りの相手を、自分のほうへ引き寄せる
    dspecial: { startup: 10, active: 1, end: 18, hitboxes: [], dmg: 3, base: 0, growth: 0, angle: 0, air: true, special: 'pull' },
    // 次の動画へ：上へ高速で滑り上がる。途中でもう一度Bを押すと方向転換
    uspecial: {
      startup: 3,
      active: 26,
      end: 6,
      hitboxes: [{ x: 0, y: 0.9, r: 0.7 }],
      dmg: 6,
      base: 5.5,
      growth: 6,
      angle: 80,
      air: true,
      special: 'redirect',
      riseV: 15,
      helpless: true,
    },
  },
  gacha: {
    // 10連ガチャ：毎回ランダム（大当たり〜大外れ）
    nspecial: { startup: 14, active: 1, end: 20, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'gacha10' },
    // 単発ガチャ：5回に1回、超強力な一撃
    sspecial: {
      startup: 9,
      active: 4,
      end: 18,
      hitboxes: [{ x: 0.9, y: 0.9, r: 0.7 }],
      dmg: 6,
      base: 5,
      growth: 6,
      angle: 38,
      air: true,
      special: 'gacha1',
      landLag: 10,
    },
    // 課金：自分のダメージ%が増える代わりに、しばらく攻撃力アップ
    dspecial: { startup: 8, active: 1, end: 16, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'pay' },
    // 無償石を配る：上昇しながら、上から石を降らせる
    uspecial: {
      startup: 4,
      active: 20,
      end: 4,
      hitboxes: [{ x: 0, y: 1.0, r: 0.75 }],
      dmg: 5,
      base: 5,
      growth: 4,
      angle: 80,
      air: true,
      special: 'recovery',
      riseV: 15.5,
      helpless: true,
      shots: [
        [0, -1.6],
        [6, 1.6],
        [12, -0.6],
        [18, 0.8],
      ].map(([at, x]) => ({ at, kind: 'stone' as const, x, y: 3.2, vx: 0, vy: -4, gravity: 22, life: 70, r: 0.32, dmg: 4, base: 4, growth: 4, angle: -60 })),
    },
  },
  courier: {
    // 配達バッグ投げ：投げると戻ってくる
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
      shots: [{ at: 0, kind: 'bag', x: 0.8, y: 1.0, vx: 12, vy: 0, life: 110, r: 0.4, dmg: 6, base: 5, growth: 5, angle: 40, boomerang: 22 }],
    },
    // 自転車：乗ったまま走り回れる（ぶつかるとダメージ、ジャンプで降りる）
    sspecial: { startup: 8, active: 1, end: 6, hitboxes: [], dmg: 7, base: 6, growth: 6, angle: 35, air: false, special: 'bike' },
    // 置き配：拾うと回復する料理を置く（相手も拾える）
    dspecial: { startup: 12, active: 1, end: 18, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: false, special: 'food' },
    // 立ちこぎジャンプ：自転車ごと大ジャンプ
    uspecial: {
      startup: 5,
      active: 18,
      end: 6,
      hitboxes: [{ x: 0, y: 0.2, r: 0.85 }],
      dmg: 6,
      base: 6,
      growth: 5,
      angle: 80,
      air: true,
      special: 'recovery',
      riseV: 17,
      riseVx: 3,
      helpless: true,
    },
  },
  ai: {
    // 推論：いちばん近い相手を追いかける弾
    nspecial: {
      startup: 14,
      active: 1,
      end: 18,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot',
      shots: [{ at: 0, kind: 'orb', x: 0.8, y: 1.2, vx: 6.5, vy: 1, life: 130, r: 0.35, dmg: 6, base: 4.5, growth: 5, angle: 40, homing: 0.06 }],
    },
    // 学習：構えている間に飛んできた飛び道具を吸収し、次の攻撃を強化
    sspecial: { startup: 4, active: 40, end: 16, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'absorb' },
    // エージェント起動：AIドローンを呼び出す（そばを飛び、近くの相手を自動で撃つ）
    dspecial: { startup: 10, active: 1, end: 18, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'drone' },
    // API呼び出し：ワイヤーで遠くの崖をつかんで復帰
    uspecial: {
      startup: 6,
      active: 22,
      end: 8,
      hitboxes: [],
      dmg: 5,
      base: 5,
      growth: 4,
      angle: 60,
      air: true,
      special: 'tether',
      riseV: 7,
      helpless: true,
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
/** 倍速再生の効果時間（6秒）と、効果が切れてから次に使えるまでの時間（7秒）（フレーム） */
export const SPEEDUP = { duration: 360, cooldown: 420, speed: 1.35, frame: 0.75 };
/** 課金：増えるダメージ%、効果時間、攻撃力・ふっとばし力の倍率 */
export const PAY = { cost: 8, duration: 360, dmg: 1.3, kb: 1.15 };
/** 自転車：乗っていられる時間、速さ、ぶつかったときに同じ相手へ再び当たるまで */
export const BIKE = { duration: 300, speed: 12.5, hitCooldown: 30 };
/** 置き配：回復量、置いていられる時間、置いた本人が拾えるまでの時間 */
export const FOOD = { heal: 12, life: 600, selfDelay: 60, r: 0.6 };
/** ハルシネーション：分身の時間、攻撃した相手が目を回す時間 */
export const DECOY = { life: 240, dizzy: 50 };
/** API呼び出し：ワイヤーの届く距離と、引き寄せる速さ */
export const TETHER = { range: 6, speed: 18 };
/** なりすまし：位置を入れ替えられる距離と、入れ替えられた相手が固まる時間 */
export const SWAP = { range: 7, freeze: 14 };
/** エージェント起動：ドローンがいる時間、撃つ間隔、狙える距離 */
export const DRONE = { life: 300, interval: 40, range: 8 };
/** 通知爆撃：引き寄せる範囲と速さ */
export const PULL = { range: 4.5, speed: 11 };
/** ガチャの天井（外れがこの回数続くと次は必ず大当たり） */
export const PITY = 6;

/** 溜め攻撃：溜められる最大フレームと、最大まで溜めたときの威力の倍率 */
export const CHARGE = { max: 90, mul: 1.75 };

/** つかみ：つかんでいられる時間（基本＋相手の%に比例、上限）、もがいたときに減る時間、つかみ攻撃の間隔 */
export const GRAB = { base: 50, perDamage: 0.5, max: 150, mash: 3, pummelGap: 6 };

/** アイテム：出る間隔、同時に出る最大数、置いてある時間、種類（0=バグ修正パッチ 1=エナドリ 2=サーバーダウン 3=ファイアウォール） */
export const ITEMS = { interval: 600, max: 2, life: 900, kinds: 4, heal: 20, freeze: 60, invuln: 240 };
/** ステージギミックの間隔（フレーム）と、予告から本番までの時間 */
export const GIMMICK = { interval: 780, warn: 90 };
