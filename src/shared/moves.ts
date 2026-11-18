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
  | 'sound'
  | 'bag'
  | 'orb'
  | 'gold'
  | 'spark'
  // メンヘラ
  | 'thread'
  | 'phone'
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
  /** 当たっても相手はのけぞらない（ダメージだけ） */
  noFlinch?: boolean;
  /** 毒：当たった相手がこのフレーム数の間、少しずつダメージを受ける */
  poison?: number;
  /** 当たった相手の左右の操作を、このフレーム数の間だけ逆にする */
  confuse?: number;
  /** いちばん近い相手を追いかける（曲がる速さ） */
  homing?: number;
  /** 一定フレーム後に持ち主のところへ戻ってくる（ブーメラン） */
  boomerang?: number;
  /** 赤い糸（メンヘラ）：当たった相手と、このフレーム数の間つながる */
  leash?: number;
  /** 鬼電（メンヘラ）：当たった相手に、このフレーム数のあとに爆発する印を付ける */
  call?: number;
}

export type SpecialKind =
  | 'shot'
  | 'rewind'
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
  | 'recommend'
  | 'charge'
  | 'pummel'
  | 'throw'
  | 'taunt'
  // パーソナルトレーナー
  | 'curl'
  | 'tackle'
  | 'slam'
  | 'armor'
  // 3B
  | 'jobchange'
  | 'rush'
  | 'dive'
  | 'bottle'
  | 'slide'
  // メンヘラ
  | 'cry'
  | 'balloon';

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
  /** 当たった相手の左右の操作を、このフレーム数の間だけ逆にする（酔い） */
  confuse?: number;
  /** ひるみ時間の倍率 */
  hitstunMul?: number;
  /** 再使用までの待ち時間（フレーム。技が終わってから数える）。連打でハメられないようにする */
  cd?: number;
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
      special: 'shot', cd: 40,
      shots: [{ at: 0, kind: 'text', x: 0.9, y: 1.0, vx: 4.5, vy: 0, life: 120, r: 0.55, dmg: 7, base: 4, growth: 4, angle: 20, hitstunMul: 1.9 }],
    },
    // 物理ファイアウォール：前に壁を出す（飛び道具を消し、相手を押し返す）
    sspecial: { startup: 8, active: 4, end: 18, hitboxes: [{ x: 1.0, y: 0.9, r: 0.7 }], dmg: 4, base: 7, growth: 4, angle: 30, air: true, special: 'wall', landLag: 10, cd: 90 },
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
      special: 'recovery', cd: 40,
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
      special: 'shot', cd: 90,
      shots: [0, 5, 10].map((at) => ({ at, kind: 'bullet' as const, x: 0.9, y: 1.0, vx: 16, vy: 0, life: 40, r: 0.25, dmg: 2.8, base: 2.8, growth: 2.2, angle: 25 })),
    },
    // Ctrl+Z：約2秒前の場所に戻り、その間に受けたダメージの半分を消す（空中でも使える）
    sspecial: { startup: 6, active: 1, end: 12, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'rewind', cd: 360 },
    // キャッシュ：足元に罠を置く（1個まで）。触れると爆発
    // 置くのに少し時間がかかる。爆発したあと約2.5秒は置き直せない（cd は爆発したときから数える）
    dspecial: { startup: 26, active: 1, end: 20, hitboxes: [], dmg: 10, base: 8, growth: 13, angle: 80, air: true, special: 'trap', cd: 150 },
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
      special: 'dash', cd: 60,
      dashSpeed: 18,
      landLag: 10,
    },
    // なりすまし：近くの相手と位置を入れ替える（相手は一瞬固まる）
    dspecial: { startup: 12, active: 1, end: 22, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'swap', cd: 240 },
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
      special: 'shot', cd: 60,
      shots: [{ at: 0, kind: 'coin', x: 0.7, y: 1.3, vx: 10, vy: 9, gravity: 28, life: 80, r: 0.3, dmg: 6, base: 5, growth: 5, angle: 45 }],
    },
    // 切り抜き：少し先へ瞬間移動して斬る
    sspecial: { startup: 10, active: 4, end: 12, hitboxes: [{ x: 0.6, y: 0.9, r: 0.85 }], dmg: 10, base: 6.5, growth: 9, angle: 40, air: true, special: 'teleport', landLag: 7, cd: 60 },
    // 強制アップデート：近くの相手をしばらく動けなくする
    dspecial: { startup: 10, active: 4, end: 24, hitboxes: [{ x: 0, y: 0.9, r: 1.8 }], dmg: 2, base: 0, growth: 0, angle: 0, air: true, special: 'sleep', cd: 150 },
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
      special: 'scroll', cd: 60,
      dashSpeed: 12,
      landLag: 8,
    },
    // 通知爆撃：通知に気を取られた周りの相手を、自分のほうへ引き寄せる
    // あなたへのおすすめ：いちばん近い相手の目の前へ瞬間移動して、軽く浮かせる一撃（そのまま追撃できる）
    dspecial: { startup: 10, active: 3, end: 4, hitboxes: [{ x: 0.7, y: 0.9, r: 0.75 }], dmg: 5, base: 4.5, growth: 2.5, angle: 75, air: true, special: 'recommend', hitstunMul: 2.5, landLag: 8, cd: 180 },
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
    nspecial: { startup: 14, active: 1, end: 20, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'gacha10', cd: 60 },
    // 単発ガチャ：4回に1回ほど、超強力な一撃（確率は GACHA1_CRIT）
    sspecial: {
      startup: 9,
      active: 4,
      end: 18,
      hitboxes: [{ x: 0.9, y: 0.9, r: 0.7 }],
      dmg: 7,
      base: 5.5,
      growth: 6,
      angle: 38,
      air: true,
      special: 'gacha1', cd: 60,
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
      special: 'recovery', cd: 25,
      riseV: 15.5,
      helpless: true,
      shots: [
        [0, -1.6],
        [6, 1.6],
        [12, -0.6],
        [18, 0.8],
      ].map(([at, x]) => ({ at, kind: 'stone' as const, x, y: 3.2, vx: 0, vy: -4, gravity: 22, life: 70, r: 0.32, dmg: 4, base: 4, growth: 4, angle: -60, noFlinch: true })),
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
      special: 'shot', cd: 45,
      shots: [{ at: 0, kind: 'bag', x: 0.8, y: 1.0, vx: 15, vy: 0, life: 150, r: 0.4, dmg: 6, base: 5, growth: 5, angle: 40, boomerang: 30 }],
    },
    // 自転車：乗ったまま走り回れる（ぶつかるとダメージ。攻撃・必殺技・ガードで降りる）
    // 乗り始めに約0.5秒（配達員の動きの速さ 0.95倍をかけて30フレーム）。降りてから約3秒は乗れない
    sspecial: { startup: 32, active: 1, end: 6, hitboxes: [], dmg: 6, base: 6, growth: 6.5, angle: 35, air: false, special: 'bike', cd: 180 },
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
      special: 'shot', cd: 62,
      shots: [{ at: 0, kind: 'orb', x: 0.8, y: 1.2, vx: 6.5, vy: 1, life: 130, r: 0.35, dmg: 7, base: 4.8, growth: 5, angle: 40, homing: 0.06 }],
    },
    // 学習：構えている間に飛んできた飛び道具を吸収し、次の攻撃を強化
    sspecial: { startup: 4, active: 40, end: 16, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'absorb' },
    // エージェント起動：AIドローンを呼び出す（そばを飛び、近くの相手を自動で撃つ）
    dspecial: { startup: 10, active: 1, end: 18, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'drone', cd: 120 },
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
  trainer: {
    // ダンベルカール：Bを押し続けると溜めて、離すと殴る（最大1秒、威力最大1.8倍）
    nspecial: {
      startup: 16,
      active: 4,
      end: 22,
      hitboxes: [
        { x: 1.1, y: 1.0, r: 0.7 },
        { x: 0.5, y: 1.0, r: 0.55 },
      ],
      dmg: 12,
      base: 8,
      growth: 13,
      angle: 38,
      air: true,
      special: 'curl',
      landLag: 12,
    },
    // タックル：前へ突進して、当たった相手をつかむ（ガード中でもつかめる。空中ではつかまずに当たるだけ）
    sspecial: {
      startup: 9,
      active: 12,
      end: 22,
      hitboxes: [{ x: 0.75, y: 0.9, r: 0.62 }],
      dmg: 7,
      base: 6,
      growth: 6,
      angle: 35,
      air: true,
      special: 'tackle', cd: 60,
      dashSpeed: 12.5,
      landLag: 12,
    },
    // プロテイン：しばらくの間、攻撃を受けてもひるまない（強いふっとばしは受ける）
    dspecial: { startup: 14, active: 1, end: 16, hitboxes: [], dmg: 0, base: 0, growth: 0, angle: 0, air: true, special: 'armor' },
    // マッスルジャンプ：飛び上がりながら相手をつかみ、そのまま地面に叩きつける
    uspecial: {
      startup: 6,
      active: 16,
      end: 10,
      hitboxes: [{ x: 0.45, y: 1.5, r: 0.8 }],
      dmg: 13,
      base: 8,
      growth: 10,
      angle: 75,
      air: true,
      special: 'slam',
      riseV: 16.5,
      riseVx: 1.5,
      helpless: true,
    },
  },
  menhera: {
    // 赤い糸：前に糸を投げる。当たった相手とつながり、離れられなくする
    nspecial: {
      startup: 9,
      active: 1,
      end: 16,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot', cd: 150,
      shots: [{ at: 0, kind: 'thread', x: 0.6, y: 1.0, vx: 14, vy: 0, life: 22, r: 0.35, dmg: 2, base: 2.5, growth: 1, angle: 30, leash: 240 }],
    },
    // 鬼電：スマホを投げる。当たった相手に「着信中」の印を付け、しばらくしてから爆発
    sspecial: {
      startup: 10,
      active: 1,
      end: 16,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'shot', cd: 120,
      shots: [{ at: 0, kind: 'phone', x: 0.6, y: 1.2, vx: 10, vy: 4, gravity: 16, life: 50, r: 0.32, dmg: 3, base: 3, growth: 2, angle: 40, call: 150 }],
    },
    // 泣き落とし：周りに涙を飛ばし、当たった相手の攻撃力を下げる
    dspecial: { startup: 12, active: 1, end: 22, hitboxes: [], dmg: 2, base: 3, growth: 0, angle: 60, air: true, special: 'cry', cd: 360 },
    // ハート風船：ふわっと上昇（真上の相手に当たる）。上昇のあとはゆっくり落ちる
    uspecial: {
      startup: 4,
      active: 22,
      end: 6,
      hitboxes: [{ x: 0, y: 1.9, r: 0.8 }],
      dmg: 4,
      base: 5,
      growth: 5,
      angle: 80,
      air: true,
      special: 'balloon',
      riseV: 15.5,
      helpless: true,
    },
  },
};

/**
 * メンヘラ：かまってちゃん（攻撃を当てずにいると病みモード、当てるとデレモード）、赤い糸、鬼電、泣き落とし、ハート風船
 * lonely = 病みモードになるまで（フレーム）、yami = 病みモードの攻撃力・ふっとばし力、dere = デレモードの時間と移動の速さ、
 * leashLen = 赤い糸の長さ、call = 鬼電の爆発、cry = 泣き落とし（範囲・時間・相手の攻撃力の倍率）、float = ハート風船のあとゆっくり落ちる時間と落ちる速さ
 */
export const MENHERA = {
  lonely: 180,
  yamiDmg: 1.25,
  yamiKb: 1.1,
  dere: 180,
  dereSpeed: 1.1,
  leashLen: 3.5,
  call: { dmg: 11, base: 7, growth: 8, angle: 70 },
  cry: { range: 3, time: 240, mul: 0.8 },
  float: 60,
  floatFall: 3,
  /** デレモードの移動アップが、一度出てから次に出るまで（7秒） */
  dereCd: 420,
  /** 赤い糸で相手とつながっている間の、自分の攻撃力 */
  threadMul: 1.2,
  /** 赤い糸の長さ（時間）：メンヘラ自身の%が高いほど短い（0%で約4秒、%1あたりの減り＝100%で約3秒、いちばん短くて約1.4秒） */
  leashTime: { base: 240, perPct: 0.0025, min: 0.35 },
  /** 赤い糸が切れたときの反動：ためたダメージ1%あたりのふっとばしの強さ（基本・伸び）、それぞれの上限と角度。上限は+30%で届く（+30%以上ためると、ふつうの重さの相手を100%前後から撃墜） */
  recoil: { base: 0.25, growth: 0.22, maxBase: 7.5, maxGrowth: 6.6, angle: 45 },
  /** 鬼電：爆発してから次に投げられるまで（2秒） */
  callCd: 120,
  /** 深夜のワンルームのギミック「重い愛のハート」：拾った人が重くなる時間、ジャンプの高さ、重さ、ハートが残っている時間 */
  heavy: { time: 300, jump: 0.78, weight: 1.35, life: 900, r: 1.0, fall: 1.4 },
};

// 3B：下Bのジョブチェンジで、美容師（0）・バンドマン（1）・バーテンダー（2）の必殺技に切り替わる
/** ジョブチェンジ（3つの仕事で共通）：くるっと回って着替える。回る瞬間に近くの相手へ軽い一撃 */
const JOBCHANGE: MoveDef = { cd: 57, startup: 7, active: 6, end: 8, hitboxes: [{ x: 0, y: 0.95, r: 0.95 }], dmg: 3, base: 6, growth: 3, angle: 60, air: true, special: 'jobchange' };
const THREEB: Specials[] = [
  {
    // 美容師：シザーラッシュ（Bを連打すると続き、最後の一撃でふっとばす）
    nspecial: { startup: 5, active: 15, end: 14, hitboxes: [{ x: 0.85, y: 1.0, r: 0.62 }], dmg: 1.6, base: 1.2, growth: 0, angle: 0, air: true, special: 'rush', rehit: 4, hitstunMul: 1.35, landLag: 8, cd: 60 },
    // ブローアップ：熱風を当てながら踏み込む連続ヒット
    sspecial: { startup: 7, active: 16, end: 16, hitboxes: [{ x: 0.9, y: 0.95, r: 0.7 }], dmg: 1.8, base: 3, growth: 1, angle: 10, air: true, special: 'dash', dashSpeed: 7, rehit: 4, landLag: 10, cd: 60 },
    dspecial: JOBCHANGE,
    // スプレーターン：回りながら上昇して周りに連続ヒット
    uspecial: { startup: 4, active: 20, end: 8, hitboxes: [{ x: 0, y: 1.0, r: 0.95 }], dmg: 1.6, base: 4, growth: 2, angle: 80, air: true, special: 'recovery', riseV: 15.5, rehit: 5, helpless: true },
  },
  {
    // バンドマン：爆音ソロ（ギターをかき鳴らし、音の衝撃を前へ飛ばす。Bを押し続けると溜まり、溜めるほど遠くまで飛ぶ）
    nspecial: {
      startup: 18,
      active: 1,
      end: 20,
      hitboxes: [],
      dmg: 0,
      base: 0,
      growth: 0,
      angle: 0,
      air: true,
      special: 'curl',
      landLag: 12,
      // 音の衝撃が消えてから約2.5秒は使えない（消えるまでは待ち時間のまま）
      cd: 150,
      shots: [{ at: 0, kind: 'sound', x: 0.9, y: 1.0, vx: 12, vy: 0, life: 22, r: 0.6, dmg: 7, base: 6, growth: 10, angle: 45 }],
    },
    // ステージダイブ：前へ飛び込んで体当たり。当たると相手を踏み台に跳ねる
    sspecial: { startup: 8, active: 22, end: 14, hitboxes: [{ x: 0.5, y: 0.8, r: 0.75 }], dmg: 9, base: 6.5, growth: 9, angle: 40, air: true, special: 'dive', landLag: 14, cd: 60 },
    dspecial: JOBCHANGE,
    // アンコール：ギターを振り上げながら高く跳ぶ
    uspecial: { startup: 5, active: 14, end: 10, hitboxes: [{ x: 0.3, y: 1.9, r: 0.8 }], dmg: 8, base: 7, growth: 8, angle: 85, air: true, special: 'recovery', riseV: 17.5, helpless: true },
  },
  {
    // バーテンダー：フレアボトル（当たった相手は酔って左右の操作が逆になる）
    nspecial: { startup: 9, active: 5, end: 16, hitboxes: [{ x: 1.0, y: 1.05, r: 0.65 }], dmg: 7.5, base: 6, growth: 9, angle: 40, air: true, special: 'bottle', confuse: 150, landLag: 8 },
    // スライド：低く滑り込む足払い（地上の相手を長くひるませる）
    sspecial: { startup: 8, active: 12, end: 18, hitboxes: [{ x: 0.75, y: 0.25, r: 0.6 }], dmg: 6, base: 6, growth: 4, angle: 15, air: false, special: 'slide', dashSpeed: 11, hitstunMul: 3.5, cd: 60 },
    dspecial: JOBCHANGE,
    // シェイカーターン：シェイカーを振りながら回転して上昇
    uspecial: { startup: 5, active: 18, end: 8, hitboxes: [{ x: 0, y: 1.1, r: 0.85 }], dmg: 2.2, base: 5, growth: 3, angle: 80, air: true, special: 'recovery', riseV: 16, rehit: 6, helpless: true },
  },
];

/** 3B の仕事の数と名前 */
export const JOBS = ['美容師', 'バンドマン', 'バーテンダー'];
export const THREEB_RULES = {
  /** シザーラッシュの最後の一撃（ダメージ・基礎ふっとばし・伸び） */
  rushFinish: { dmg: 5, base: 7.5, growth: 11 },
  /** シザーラッシュを続けられる回数 */
  rushChain: 2,
  /** 早着替え：ジョブチェンジ後の攻撃力アップの時間と倍率 */
  buff: 240,
  buffMul: 1.25,
  /** ジョブチェンジの待ち時間 */
  cooldown: 60,
  /** 爆音ソロ：いちばん溜めたときの飛ぶ距離の倍率（溜めなしで約4.4m、最大で約10.6m） */
  soundRange: 2.4,
  /** ステージダイブで当てたあとに跳ね上がる速さ */
  bounce: 12,
};

/** そのキャラの技のデータ（job は 3B の仕事） */
export function moveOf(charId: string, id: MoveId, job = 0): MoveDef {
  if (id === 'nspecial' || id === 'sspecial' || id === 'dspecial' || id === 'uspecial') {
    if (charId === 'threeb') return THREEB[((job % 3) + 3) % 3][id];
    return (SPECIALS[charId] ?? SPECIALS.guard)[id];
  }
  return NORMALS[id];
}

/** 罠（キャッシュ）の設定 */
export const TRAP = { life: 600, r: 0.6, armDelay: 30 };
/** 壁（物理ファイアウォール）の設定 */
/** 壁（物理ファイアウォール）の設定。hit は壁に触れた相手への一撃（1枚の壁につき1人1回） */
export const WALL = { life: 80, w: 0.35, h: 2.4, offset: 1.1, hit: { dmg: 4, base: 8.5, growth: 4, angle: 28, hitstun: 1.1 } };
/** 一時的な足場（ポップアップ広告）の設定 */
export const POPUP = { life: 200, w: 2.4 };
/** 倍速再生の効果時間（6秒）と、効果が切れてから次に使えるまでの時間（7秒）（フレーム） */
export const SPEEDUP = { duration: 420, cooldown: 330, speed: 1.35, frame: 0.75 };
/** 課金：増えるダメージ%、効果時間、攻撃力・ふっとばし力の倍率 */
export const PAY = { cost: 8, duration: 360, dmg: 1.3, kb: 1.15 };
/** 緊急警報（警備員の特性）：ダメージがこの%以上になると、1ストックに1回、しばらく攻撃力アップ */
export const ALARM = { at: 100, time: 720, dmg: 1.3 };
/** 自転車：乗っていられる時間、速さ、ぶつかったときに同じ相手へ再び当たるまで */
export const BIKE = {
  duration: 240,
  speed: 12.5,
  hitCooldown: 40,
  /** ぶつかる判定の大きさ */
  hitR: 0.85,
  /** 自転車の耐久（%）：受けたダメージの合計がこれ（8%）をこえると降りる（弱い攻撃なら、こえるまでは降りない） */
  hp: 8,
  /** これより強いふっとばしを受けたら、耐久が残っていても降ろされる */
  armorLimit: 12,
  /** 弱い攻撃を受けたときの減速 */
  slow: 0.6,
  /** 走り続けたときの体当たりのふっとばしの伸び（最大） */
  speedKb: 0.15,
};
/** 置き配：回復量、置いていられる時間、置いた本人が拾えるまでの時間 */
export const FOOD = { heal: 7, life: 600, selfDelay: 60, r: 0.6 };
/** ハルシネーション：分身の時間、攻撃した相手が目を回す時間 */
export const DECOY = { life: 240, dizzy: 50 };
/** API呼び出し：ワイヤーの届く距離と、引き寄せる速さ */
export const TETHER = { range: 6, speed: 18 };
/** なりすまし：位置を入れ替えられる距離と、入れ替えられた相手が固まる時間 */
export const SWAP = { range: 7, freeze: 20 };
/** エージェント起動：ドローンがいる時間、撃つ間隔、狙える距離 */
export const DRONE = { life: 300, interval: 40, range: 8, cd: 120 };
/** 通知爆撃（いまは使っていない）：引き寄せる範囲と速さ */
/** あなたへのおすすめ（ドパガキ）：瞬間移動できるいちばん遠い相手（m） */
export const RECOMMEND = { range: 10 };
/** 通知爆撃：引き寄せる範囲と速さ */
export const PULL = { range: 4.5, speed: 11 };
/** ガチャの天井（外れがこの回数続くと次は必ず大当たり） */
export const PITY = 6;
/** 10連ガチャの出る確率（SSR・SR・R・N・回復。残りが爆死） */
export const GACHA_RATES = { ssr: 0.06, sr: 0.14, r: 0.24, n: 0.33, heal: 0.05 };
/** 単発ガチャの大当たりの確率 */
export const GACHA1_CRIT = 0.25;
/** 無限スクロールの3回目（最後）の一撃：威力の倍率と、ふっとばし */
export const SCROLL_FINISH = { dmg: 1.3, base: 8, growth: 12.5, angle: 40 };
/** 眠っている相手（強制アップデートなど）が受けるふっとばしの倍率 */
export const SLEEP_KB = 1.2;
/** 強制アップデートで眠らせる最長の時間（フレーム） */
export const SLEEP_MAX = 100;
/**
 * ギリギリ耐える：ふっとびの速さが strong 未満の一撃で、わずかに場外まで届くだけなら、
 * ふっとびを最大 (1 - minScale) まで弱めて、場外の線の keep m 手前で止まるようにする。
 * near m 以内まで近づくふっとびも「ギリギリ」として演出する（minSpeed 未満の弱いふっとびは対象外）。
 * extra = ひるみが終わったあと何フレーム先まで見るか。brakeVx/brakeVy = 耐えたあと踏んばって止まるときの、外向き・上向きの最大の速さ
 */
export const CLOSE = { strong: 42, minScale: 0.85, keep: 0.5, near: 2.2, minSpeed: 12, extra: 30, brakeVx: 2, brakeVy: 4 };
/** 学習（AIエンジニア）の構え中に直接殴られたら、相手をはじき返す */
export const DEFLECT = { dmg: 3, base: 8.5, growth: 3, angle: 30, invuln: 12 };

/** 溜め攻撃：溜められる最大フレームと、最大まで溜めたときの威力の倍率 */
export const CHARGE = { max: 90, mul: 1.75 };

/** つかみ：つかんでいられる時間（基本＋相手の%に比例、上限）、もがいたときに減る時間、つかみ攻撃の間隔 */
export const GRAB = { base: 50, perDamage: 0.5, max: 150, mash: 3, pummelGap: 6 };

/** アイテム：出る間隔、同時に出る最大数、置いてある時間、種類（0=おにぎり 1=スニーカー 2=砂時計 3=お守り） */
export const ITEMS = {
  interval: 600,
  max: 2,
  life: 900,
  kinds: 7,
  heal: 20,
  freeze: 60,
  invuln: 240,
  /** 出る頻度ごとの間隔（フレーム）：少ない・普通・多い */
  intervals: { low: 900, mid: 600, high: 360 },
  /** カイロ：攻撃力アップの時間（威力は課金と同じ PAY.dmg 倍） */
  power: 600,
  /** 傘：ひるまない時間（とても強いふっとばしは防げない） */
  armor: 480,
  /** メガホン：衝撃波の届く距離・威力 */
  shoutR: 3.2,
  shoutDmg: 8,
  shoutBase: 9,
  shoutGrowth: 9,
};
/**
 * サドンデス（1位が同点のときの延長戦）：同点の人だけで、1ストック・ダメージ高めで戦う。
 * damage = はじめのダメージ%、hp = 体力制で残るHP、max = これを過ぎたらダメージの少ない人の勝ち
 */
export const SUDDEN = { damage: 100, hp: 30, max: 60 * 60 };
/** Ctrl+Z（ハッカー）：戻る時間（フレーム）、消すダメージの割合、戻ったあとの無敵 */
export const REWIND = { frames: 120, heal: 0.5, invuln: 20 };
/** 飛び道具が当たったときのひるみ時間の倍率 */
export const SHOT_HITSTUN = 0.5;
/** 王冠うばい：勝ちになる時間（秒・初期値）、奪われた直後に奪い返せない時間、自分で落ちたあと中央に出るまで、王冠の大きさ */
export const CROWN = { goal: 30, stealCd: 45, respawn: 90, r: 0.6 };
/** 賞金首：撃墜で入る点、賞金首を倒したときに足される点、賞金首になるのに要る点、自分で落ちたときに減る点 */
export const BOUNTY = { ko: 1, bonus: 2, min: 2, self: 1 };
/**
 * コイン集め：コインが降ってくる間隔（フレーム）、ステージに出ていられる数、大きいコインの出る確率と枚数、拾える大きさ、
 * 攻撃を受けたときに落とす枚数（ダメージ何%で1枚・1回の最大）、撃墜されたときに落とす割合、落とした本人が拾えない時間
 */
export const COINS = { every: 40, max: 12, bigChance: 0.12, big: 5, r: 0.45, perDmg: 5, hitMax: 5, ko: 0.5, noPick: 45 };
/**
 * 金庫まもり：耐久（1対1のときの初期値。ルールの値）、大きさ、ステージの端からの距離、1チームの人数が1人増えるごとに増える耐久の割合、
 * 細かさ（耐久とダメージを何倍の数で数えるか。引き分けになりにくいように細かく数える）
 */
export const VAULT = { hp: 400, w: 1.4, h: 1.8, inset: 1.7, perPlayer: 0.5, scale: 10 };
/** ステージギミックの間隔（フレーム）と、予告から本番までの時間 */
export const GIMMICK = { interval: 780, warn: 90 };

/** パーソナルトレーナー */
export const TRAINER = {
  /** ダンベルカールの最大の溜め（フレーム）と、そのときの威力の倍率 */
  curlMax: 60,
  curlMul: 1.8,
  /** プロテインの効く時間と、次に飲めるまでの時間 */
  armor: 300,
  armorCooldown: 720,
  /** プロテイン中でも、この速さより強いふっとばしは受ける */
  armorLimit: 17,
  /** プロテイン中に受けるダメージの倍率 */
  armorDamage: 0.85,
  /** マッスルジャンプでつかんだまま落ちる速さと、つかんでいられる最長フレーム */
  slamFall: 20,
  slamMax: 45,
  /** 筋肉は裏切らない：投げの威力の倍率 */
  throwMul: 1.3,
};
