// ゲーム進行の本体。端末（CPU戦）とサーバー（オンライン戦）で同じコードを使う。
// 座標は x が右、y が上。単位はおおよそメートル、速度は m/秒。1ステップ = 1/60 秒。

import { CHARACTERS, getCharacter, threebDef, type CharacterDef } from './characters';
import { ALARM, RECOMMEND, CLOSE, MENHERA, CROWN, BOUNTY, COINS, VAULT, SLEEP_MAX, SUDDEN, REWIND, SHOT_HITSTUN, BIKE, CHARGE, DECOY, DEFLECT, GACHA1_CRIT, GACHA_RATES, GIMMICK, GRAB, ITEMS, DRONE, FOOD, moveOf, PAY, PITY, POPUP, PULL, SCROLL_FINISH, SLEEP_KB, SPEEDUP, SWAP, TETHER, THREEB_RULES, TRAINER, TRAP, WALL, type MoveDef, type ShotKind, type ShotSpec } from './moves';
import { Rng } from './rng';
import { getStage, platformAt, type StageDef } from './stages';
import {
  BTN_A,
  BTN_B,
  BTN_JUMP,
  BTN_SHIELD,
  DEFAULT_HP,
  EMPTY_INPUT,
  FX_BIKE,
  FX_ARMOR,
  FX_BIG,
  FX_SMALL,
  FX_WARPCD,
  FX_YAMI,
  FX_AWK,
  FX_HEAVY,
  FX_ATK_UP,
  FX_ATK_DOWN,
  FX_SPD_UP,
  FX_SPD_DOWN,
  FX_CHARGED,
  FX_JOB_SHIFT,
  FX_CONFUSED,
  FX_POWER,
  FX_SPEED,
  type FighterStateName,
  type GameEvent,
  type InputState,
  type MatchSetup,
  type AreaView,
  type BallView,
  type CrownView,
  type BountyView,
  type CoinsView,
  type VaultView,
  isNoStock,
  isTwoTeam,
  type AreaZone,
  type MoveId,
  type ResultEntry,
  type ViewState,
} from './types';

export const DT = 1 / 60;
export const COUNTDOWN_FRAMES = 150;
const END_DELAY = 120;
const SHIELD_MAX = 50;
const KO_CREDIT_FRAMES = 600;
/** はじき入力とみなす、中央から倒し切るまでの最大フレーム数（5フレーム ≒ 0.08秒） */
export const FLICK_WINDOW = 5;
/** ふっとばしの伸び（ダメージ%による増え方）の全体倍率。調整用 */
export const KB_GROWTH_SCALE = 1.7;
/** ふっとび中の空気抵抗（1フレームごとに速度へ掛ける） */
export const HITSTUN_DRAG = 0.98;

export interface Projectile {
  owner: number;
  /** 玉入れ：もうボールを押した */
  ballHit?: boolean;
  kind: ShotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  dmg: number;
  base: number;
  growth: number;
  angle: number;
  r: number;
  hitstunMul: number;
  /** 当たっても相手はのけぞらない（ダメージだけ） */
  noFlinch?: boolean;
  /** 飛んでからこのフレーム数を過ぎると、当たっても相手はのけぞらない（爆音ソロの遠くの音） */
  flinchAge?: number;
  poison: number;
  confuse: number;
  homing: number;
  boomerang: number;
  age: number;
  returning: boolean;
  /** 貫通する飛び道具（ブーメラン）が当てた相手 */
  hits: number[];
  /** 赤い糸・鬼電（メンヘラ） */
  leash?: number;
  call?: number;
  /** 当たっても消えずに進む（ステージギミック） */
  pierce?: boolean;
}

/** ステージに置かれる物（壁・罠・一時的な足場） */
export interface Entity {
  id: number;
  kind: 'wall' | 'trap' | 'popup' | 'food' | 'decoy' | 'drone' | 'item';
  owner: number;
  x: number;
  y: number;
  vy: number;
  life: number;
  age: number;
  /** 向き（分身） */
  dir: number;
}

/** 毒のダメージ間隔（フレーム） */
const POISON_TICK = 30;
/** 一時的な足場の上に立っているときの groundRef（1000 + 足場の id） */
const ENTITY_GROUND = 1000;

const SNAPSHOT_KEYS = [
  'x', 'y', 'vx', 'vy', 'facing', 'grounded', 'groundRef', 'state', 'stateTime', 'jumpsLeft', 'sideBUsed',
  'airDodgeUsed', 'fastFall', 'shortHopArmed', 'damage', 'stocks', 'kos', 'falls', 'out', 'outFrame', 'move',
  'moveFrame', 'charge', 'hitstun', 'tumble', 'invuln', 'hitlag', 'shield', 'stun', 'lastHitBy', 'lastHitFrame',
  'ledgeSide', 'ledgeCooldown', 'dropThrough', 'respawnTimer', 'dodgeDir', 'prevButtons', 'prevMx', 'prevMy',
  'flickX', 'flickY', 'neutralXAge', 'neutralYAge', 'poison', 'poisonFrom',
  'speedBuff', 'speedCd', 'powerBuff', 'bike', 'bikeAir', 'bikeHp', 'bikeHitCd', 'wallHit', 'confused', 'chain', 'redirected', 'pity', 'crit',
  'absorbCharge', 'chargedMove', 'stale', 'runTime', 'buzz', 'recentMoves', 'learnHits', 'holdA', 'grabbing', 'grabbedBy', 'grabTimer', 'dealt', 'throws', 'tetherOn', 'tetherX', 'tetherY',
  'armor', 'armorCd', 'slamming', 'job', 'jobBuff', 'jobCd', 'rushQueued',
  'cdN', 'cdS', 'cdD', 'cdU', 'lockMeter', 'lockFree', 'ballHit', 'vaultHit', 'goals', 'closeCall', 'size', 'warpCd', 'warpSlow', 'moveAim',
  'leashT', 'leashBy', 'leashDmg', 'callT', 'callBy', 'awkward', 'lonely', 'dere', 'dereCd', 'floatT', 'heavyT',
  'alarmT', 'alarmUsed', 'jobCdN',
] as const;

export type FighterSnapshot = { [K in (typeof SNAPSHOT_KEYS)[number]]: Fighter[K] } & { moveHit: number[] };

export class Fighter {
  slot: number;
  def: CharacterDef;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing = 1;
  grounded = true;
  /** 立っている場所: -1 = 本体の台、0以上 = 足場番号 */
  groundRef = -1;
  state: FighterStateName = 'idle';
  stateTime = 0;
  jumpsLeft = 1;
  sideBUsed = false;
  airDodgeUsed = false;
  fastFall = false;
  shortHopArmed = false;
  damage = 0;
  stocks = 3;
  kos = 0;
  falls = 0;
  out = false;
  outFrame = 0;
  move: MoveId | null = null;
  moveFrame = 0;
  moveHit = new Set<number>();
  charge = 0;
  hitstun = 0;
  tumble = false;
  invuln = 0;
  hitlag = 0;
  shield = SHIELD_MAX;
  stun = 0;
  lastHitBy = -1;
  lastHitFrame = -9999;
  ledgeSide = 0;
  ledgeCooldown = 0;
  dropThrough = 0;
  respawnTimer = 0;
  dodgeDir = 0;
  input: InputState = { ...EMPTY_INPUT };
  prevButtons = 0;
  prevMx = 0;
  prevMy = 0;
  /** スティックを素早く倒してからのフレーム数（はじき入力の判定） */
  flickX = 99;
  flickY = 99;
  /** スティックが中央付近（0.3未満）にあってからのフレーム数 */
  neutralXAge = 0;
  neutralYAge = 0;
  /** 毒の残りフレーム数と、毒を与えた人 */
  poison = 0;
  poisonFrom = -1;
  // ---- キャラごとの必殺技・特性の状態
  /** 倍速再生の残り時間と、次に使えるまでの時間 */
  speedBuff = 0;
  speedCd = 0;
  /** プロテイン（トレーナー）：ひるまない残り時間と、次に飲めるまでの時間 */
  armor = 0;
  armorCd = 0;
  /** マッスルジャンプでつかんで落ちている途中（残りフレーム。0 ならしていない） */
  slamming = 0;
  /** 3B：今の仕事（0=美容師 1=バンドマン 2=バーテンダー）、早着替えの残り時間、次に着替えられるまでの時間 */
  job = 0;
  jobBuff = 0;
  jobCd = 0;
  /** シザーラッシュの途中でBが押された（切り終わったら、もう一度切り続ける） */
  rushQueued = false;
  /** 必殺技（B・横B・下B・上B）を次に使えるまでの残りフレーム（連打でハメられないように） */
  cdN = 0;
  cdS = 0;
  cdD = 0;
  cdU = 0;
  /** ハメ防止：動けない時間が詰まって続くと溜まる。溜まりきったら、動けるようになった瞬間に少し無敵になる */
  lockMeter = 0;
  /** ハメ防止：動けるようになってからのフレーム数 */
  lockFree = 0;
  /** 玉入れ：今出している技が、もうボールに当たった */
  ballHit = false;
  /** 金庫まもり：今の技がもう金庫に当たった（1つの技で1回だけ） */
  vaultHit = false;
  /** 金庫まもり：相手の金庫に与えたダメージ */
  vaultDmg = 0;
  /** 玉入れ：入れたゴールの数 */
  goals = 0;
  /** 課金の残り時間 */
  powerBuff = 0;
  /** 自転車に乗っている残り時間 */
  bike = 0;
  /** ギリギリ耐えたふっとび中（1 = ひるみが終わったら「セーフ」を出す） */
  closeCall = 0;
  /** 体の大きさ（配信スタジオの視聴者リクエスト）：0 = ふつう、1 = でっかい、2 = ちっちゃい */
  size = 0;
  /** ワープホール（電脳空間）を続けてくぐれないようにする待ち時間 */
  warpCd = 0;
  /** ワープホールから出てきたところ（ゆっくり出てくる残りフレーム） */
  warpSlow = 0;
  /** 技を出したときのスティックの上下（玉入れのねらい。上で山なり、下で低く） */
  moveAim = 0;
  /** 自転車の残りの耐久（%）。弱い攻撃はこの分まで受けても降りない */
  bikeHp = 0;
  /** 自転車に乗ったままジャンプした（着地するまで自転車のまま） */
  bikeAir = false;
  /** Ctrl+Z（ハッカー）：直近の [x, y, ダメージ] の記録（古い順。サーバーと端末でそれぞれ記録する） */
  rewindHist: number[] = [];
  /** 最後に一撃を受けた壁（物理ファイアウォール）の番号。同じ壁からは1回だけ */
  wallHit = -1;
  /** 自転車で同じ相手に再びぶつかるまでの時間（相手の slot ごと） */
  bikeHitCd: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** 左右の操作が逆になっている残り時間 */
  confused = 0;
  /** 赤い糸（メンヘラ）でつながれている残り時間と、つないだ人 */
  leashT = 0;
  leashBy = -1;
  /** 赤い糸でつながれている間に受けたダメージ（糸が切れたときに一気に加わる） */
  leashDmg = 0;
  /** 鬼電（メンヘラ）の印：爆発までの残り時間と、印を付けた人 */
  callT = 0;
  callBy = -1;
  /** 泣き落とし（メンヘラ）で「気まずい」（攻撃力が下がる）残り時間 */
  awkward = 0;
  /** かまってちゃん（メンヘラ）：最後に攻撃を当ててからのフレーム数と、デレモードの残り時間 */
  lonely = 0;
  dere = 0;
  /** デレモードの移動アップが、次に出るまでの残り時間 */
  dereCd = 0;
  /** 重い愛のハート（深夜のワンルーム）を拾って重くなっている残り時間 */
  heavyT = 0;
  /** 緊急警報（警備員）：攻撃力アップの残り時間と、このストックで使ったか */
  alarmT = 0;
  alarmUsed = false;
  /** ハート風船（メンヘラ）のあと、ゆっくり落ちる残り時間 */
  floatT = 0;
  /** 無限スクロールを続けた回数 */
  chain = 0;
  /** 次の動画へで方向転換したか */
  redirected = false;
  /** ガチャの外れが続いた回数（天井） */
  pity = 0;
  /** 単発ガチャが大当たりか */
  crit = false;
  /** 学習で吸収した（次の攻撃が強くなる） */
  absorbCharge = false;
  /** 今出している技が、吸収で強くなっているか */
  chargedMove = false;
  /** 弱攻撃を出してからAを押し続けている（溜め攻撃に移る） */
  holdA = false;
  /** つかんでいる相手の slot（-1 = つかんでいない） */
  grabbing = -1;
  /** つかまれている相手の slot（-1 = つかまれていない） */
  grabbedBy = -1;
  /** つかんでいられる残り時間 */
  grabTimer = 0;
  /** 成績：与えたダメージ・投げた回数 */
  dealt = 0;
  throws = 0;
  /** 飽き性：今の技の威力の倍率 */
  stale = 1;
  /** 走り続けている時間（時間指定） */
  runTime = 0;
  /** バズり段階 */
  buzz = 0;
  /** 最近出した技（飽き性） */
  recentMoves: string[] = [];
  /** 相手ごとに攻撃を受けた回数（学習データ） */
  learnHits: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** 3B：着替えている間の、ほかの仕事のBの待ち時間（仕事ごとに別々に数える） */
  jobCdN: number[] = [0, 0, 0];
  /** API呼び出しで崖に向かっているか、その崖の位置 */
  tetherOn = false;
  tetherX = 0;
  tetherY = 0;

  /** チーム（チーム戦でないときは選手ごとに別の番号） */
  team = 0;

  constructor(slot: number, charId: string) {
    this.slot = slot;
    this.team = 100 + slot;
    this.def = getCharacter(charId);
    this.jumpsLeft = this.def.airJumps;
  }

  /** 状態をまるごと書き出す（サーバー → 端末の照合用） */
  serialize(): FighterSnapshot {
    const o: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) o[k] = (this as unknown as Record<string, unknown>)[k];
    o.moveHit = [...this.moveHit];
    return o as unknown as FighterSnapshot;
  }

  /** serialize() で書き出した状態に戻す */
  restore(s: FighterSnapshot): void {
    const self = this as unknown as Record<string, unknown>;
    for (const k of SNAPSHOT_KEYS) {
      if (!(k in s)) continue;
      const v = (s as unknown as Record<string, unknown>)[k];
      self[k] = Array.isArray(v) ? [...v] : v;
    }
    this.moveHit = new Set(s.moveHit ?? []);
    // 3B は仕事によって、配信スタジオでは大きさによって体の性能が変わる
    applySize(this);
  }

  /** ガードの最大値 */
  get shieldMax(): number {
    return SHIELD_MAX;
  }

  get hw(): number {
    return 0.42 * this.def.scale;
  }
  get h(): number {
    return 1.8 * this.def.scale;
  }
  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'respawn';
  }
}

function frames(n: number, mul: number): number {
  return Math.max(1, Math.round(n * mul));
}

export function moveTiming(md: MoveDef, f: Fighter): { s: number; a: number; e: number } {
  const mul = f.def.frameMul * (f.speedBuff > 0 ? SPEEDUP.frame : 1);
  return { s: frames(md.startup, mul), a: md.active, e: frames(md.end, mul) };
}

/** 100人組手：敵の攻撃力（倒した数で少しずつ上がる）・敵のふっとびやすさ・敵が受けるダメージの倍率・次の敵が出るまでのフレーム */
export const HORDE = {
  dmg: 0.25,
  dmgGrow: 0.004,
  kb: 2.2,
  taken: 2,
  respawn: 45,
  size: 100,
  /** この人数を倒すたびに自分のダメージが回復する */
  healEvery: 10,
  heal: 30,
  /** 3人目の敵は、この人数を倒してから出てくる */
  thirdAt: 30,
};
/** 体力制で、ふっとびの計算に使うダメージの上限 */
const STAMINA_KB_CAP = 50;

/**
 * ハメ防止：ひるみ・眠り・固まり（ヒットストップ）で動けない間は1フレームに1溜まる。
 * 動けるようになっても grace フレーム（人が反応して逃げるには短すぎる時間）のうちは、すき間も「ハメの途中」として溜まり続ける
 * （ひるむ→少しだけ動ける→またひるむ、を繰り返す交互連打も数える）。それより長く動ければ、1フレームに decay ずつ減る。
 * limit まで溜まったら（約1.5秒、短いすき間しかなく動けない状態が続いた）、動けるようになった瞬間に invuln フレーム無敵になる。
 * limit を超えてもまだひるんでいたら、残りのひるみを rest フレームまでに縮める。cut まで溜まったら打ち切る（すき間なしのハメも抜けられる）
 */
export const ANTILOCK = { limit: 90, cut: 150, invuln: 45, grace: 24, decay: 4, rest: 15 };
/** 必殺技の再使用の待ち時間を入れる場所 */
const SPECIAL_CD = { nspecial: 'cdN', sspecial: 'cdS', dspecial: 'cdD', uspecial: 'cdU' } as const;

/** エリアバトルの数値 */
export const AREA = {
  /** ゲージの満タン（1人で邪魔されずに立ち続けて約50秒） */
  goal: 50 * 60,
  /** 味方が1人増えるごとに増える速さ（2人で1.2倍、3人で1.4倍） */
  perAlly: 0.2,
  /**
   * 満タンの量の倍率（添え字＝ゲージの数：個人戦は人数、チーム戦はチーム数）。
   * 移動する1つのエリアは、人数が多いほど取り合いばかりになって溜まりにくいので、大きく減らす
   */
  goalScale: { move: [1, 1, 0.9, 0.5, 0.32, 0.25, 0.2], fix2: [1, 1, 1, 1, 1, 0.9, 0.8] } as Record<'move' | 'fix2', number[]>,
  /** 移動するエリア：移る間かくと、予告を出す時間（フレーム） */
  moveEvery: 20 * 60,
  warn: 3 * 60,
  /** 移動するエリアの幅（大きめ）と、動かない2つのエリアの幅 */
  bigWidth: 5.6,
  fixWidth: 3.8,
  /** エリアの高さ（床から。上の足場に乗ると外れる） */
  height: 2.3,
};

/** 玉入れの数値 */
export const BALL = {
  r: 0.45,
  gravity: 15,
  bounce: 0.55,
  /** 打ったときの速さ：基本 + 技のダメージ・ふっとばしに比例。上限あり */
  kickBase: 7,
  kickDmg: 0.8,
  kickKb: 0.5,
  maxSpeed: 22,
  /** 弱い技でも、これくらいは飛ぶ */
  kickMin: 10.5,
  /** 技がボールに当たる判定のおまけ（当てやすく） */
  hitPad: 0.3,
  /** スティックを斜め上に入れて打つと山なり（この角度以上）、斜め下に入れると低く速く（この角度以下） */
  lobAngle: 58,
  lowAngle: 14,
  /** ゴールや場外のあと、ボールが出てくるまで（フレーム） */
  respawn: 100,
  /** 何点先取で勝ちか（未指定のとき） */
  target: 5,
};

/** 玉入れのかご（0 = 赤チームが守る左、1 = 青チームが守る右）。床の端の上に、ポールで少し高く付ける */
export function ballBaskets(stage: StageDef): { x1: number; x2: number; y1: number; y2: number; cx: number }[] {
  const m = stage.main;
  const w = Math.min(2.2, (m.x2 - m.x1) * 0.13);
  return [m.x1 + 1.4, m.x2 - 1.4].map((cx) => ({ cx, x1: cx - w / 2, x2: cx + w / 2, y1: m.top + 1.8, y2: m.top + 3.4 }));
}

/** 決まった値から作る、ばらつきのある整数（エリアの場所選びに使う。試合ごとに同じ結果になる） */
function hash32(a: number, b: number): number {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** 飽き性（ドパガキ）：違う技を1つ続けるごとの威力アップと、その回数の上限（最大 1 + 0.1×3 = 1.3倍） */
const DOPA_STEP = 0.1;
const DOPA_STREAK_MAX = 3;
/** 24時間ジムの清掃タイム（床がすべる）のフレーム数と、すべるときのブレーキの効き（1 = ふつう） */
export const GYM_SLIP = 300;
export const GYM_GRIP = 0.12;
/** 当たり判定の巻き戻しの上限（フレーム。約0.13秒） */
export const LAG_COMP_MAX = 8;
/** 24時間ジムの清掃タイム中（床がすべる）か。試合の経過フレームだけで決まる（先行表示・画面の演出でも同じ） */
export function isSlippery(frame: number, gimmicks: boolean, kind: string): boolean {
  const at = gimmickAt(frame, gimmicks, kind, 'gym');
  return at >= 0 && at < GYM_SLIP;
}
/**
 * ステージギミックが本番になってから何フレームたったか（予告中・ギミックなし・別のステージなら -1）。
 * 試合の経過フレームだけで決まるので、先行表示や画面の演出でも同じ値になる
 */
export function gimmickAt(frame: number, gimmicks: boolean, kind: string, want: string): number {
  const ph = gimmickPhase(frame, gimmicks, kind, want);
  return ph >= GIMMICK.warn ? ph - GIMMICK.warn : -1;
}
/** ステージギミックの1周の中の位置（0 = 予告の始まり。予告は GIMMICK.warn フレーム）。ギミックなしなら -1 */
export function gimmickPhase(frame: number, gimmicks: boolean, kind: string, want: string): number {
  if (!gimmicks || kind !== want) return -1;
  const t = frame - COUNTDOWN_FRAMES - 300;
  return t < 0 ? -1 : t % GIMMICK.interval;
}
/** ワープホール：出ている時間、端からの距離、高さ、入口の大きさ、くぐった人が次にくぐれるまで（2秒）、2つの入口の最低の間隔 */
export const WARP = { time: 300, inset: 1.1, y: 0.95, r: 0.85, cd: 120, minGap: 5, slow: 30, slowSpeed: 2.5 };

/**
 * ワープホールの2つの場所（毎回ランダム）。床の上か、少し高い空中のどこか。試合の種と何回目かだけで決まるので、
 * サーバーと端末（画面の表示）で同じ場所になる
 */
export function warpSpots(stage: StageDef, seed: number, frame: number): { x: number; y: number }[] {
  const t = Math.max(0, frame - COUNTDOWN_FRAMES - 300);
  const round = Math.floor(t / GIMMICK.interval);
  const m = stage.main;
  const x1 = m.x1 + WARP.inset;
  const x2 = m.x2 - WARP.inset;
  const pick = (k: number) => {
    const h = hash32(seed + round * 7919, k);
    const x = x1 + ((h % 10000) / 10000) * (x2 - x1);
    // 3回に1回は空中（ジャンプで入る高さ）
    const y = m.top + ((h >>> 14) % 3 === 0 ? 2.6 + ((h >>> 20) % 100) / 100 : WARP.y);
    return { x, y };
  };
  const a = pick(1);
  // 2つめは、1つめから十分はなれた場所になるまで選び直す
  let b = pick(2);
  for (let k = 3; k < 12 && Math.abs(b.x - a.x) < WARP.minGap; k++) b = pick(k);
  if (Math.abs(b.x - a.x) < WARP.minGap) b = { x: a.x < (x1 + x2) / 2 ? x2 : x1, y: b.y };
  return [a, b];
}
/** ガチャ会場の当たり床ルーレット：マスの数、当たり・ハズレの数、当たりの回復量、ルーレットが止まるタイミング（予告の何フレーム目か） */
export const ROULETTE = { tiles: 6, win: 2, lose: 2, heal: 10, stopAt: 45 };
/** 配信スタジオの視聴者リクエスト：大きさが変わる時間、でっかい・ちっちゃいの倍率 */
export const SIZE_REQ = { time: 300, big: 1.45, small: 0.62 };
/** 深夜の金庫室：レーザーの本数、撃つ間隔、速さ、角度の幅（度） */
export const VAULT_LASER = { count: 3, gap: 22, speed: 15, angle: 28 };

/** 大きさを変えた体の性能（でっかい：重くて強いが遅い／ちっちゃい：軽くて弱いが速い） */
const sizedDefs = new Map<string, CharacterDef>();
function sizedDef(base: CharacterDef, size: number): CharacterDef {
  if (!size) return base;
  const key = `${base.id}:${base.walkSpeed}:${base.weight}:${size}`;
  let d = sizedDefs.get(key);
  if (!d) {
    const big = size === 1;
    const k = big ? SIZE_REQ.big : SIZE_REQ.small;
    d = {
      ...base,
      scale: base.scale * k,
      weight: base.weight * (big ? 1.3 : 0.78),
      dmgMul: base.dmgMul * (big ? 1.15 : 0.85),
      kbMul: base.kbMul * (big ? 1.1 : 0.9),
      walkSpeed: base.walkSpeed * (big ? 0.9 : 1.12),
      runSpeed: base.runSpeed * (big ? 0.9 : 1.12),
    };
    sizedDefs.set(key, d);
  }
  return d;
}
/** 仕事（3B）と大きさ（視聴者リクエスト）に合わせて、体の性能を入れ直す */
function applySize(f: Fighter): void {
  const base = f.def.id === 'threeb' ? threebDef(f.job) : getCharacter(f.def.id);
  f.def = sizedDef(base, f.size);
}

export class Sim {
  readonly setup: MatchSetup;
  readonly stage: StageDef;
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  entities: Entity[] = [];
  private nextEntityId = 1;
  /** ガチャなどの乱数（対戦ごとに決まった値から始める） */
  private rng: Rng;
  frame = 0;
  events: GameEvent[] = [];
  ended = false;
  endFrame = 0;
  finished = false;

  /**
   * onlySlot を指定すると、その選手だけを動かす（オンライン対戦の先行表示用）。
   * 出現位置・復活位置は全員がいる場合と同じになるよう、setup の並び順で決める。
   */
  /** 先行表示用に自分だけを動かしている（ほかの選手はいない） */
  private solo = false;
  /**
   * オンライン対戦の当たり判定の巻き戻し（サーバーだけが使う）：攻撃した人（slot）ごとに、何フレーム前の相手の位置にも当たるか。
   * 相手の画面には、通信の遅れと表示のなめらかさの分だけ少し前の相手が映っているので、そこに当てた攻撃も当たりにする
   */
  readonly lagComp = new Map<number, number>();
  /** 選手の位置の記録（巻き戻し用。新しいものが最後） */
  private posHist: Map<number, { x: number; y: number }>[] = [];

  constructor(setup: MatchSetup, onlySlot?: number) {
    this.solo = onlySlot !== undefined;
    this.setup = setup;
    this.stage = getStage(setup.stageId);
    this.rng = new Rng(setup.seed ^ 0x5bd1e995);
    setup.players.forEach((p, i) => {
      if (onlySlot !== undefined && p.slot !== onlySlot) return;
      const f = new Fighter(p.slot, p.charId);
      const sp = this.stage.spawns[i % this.stage.spawns.length];
      f.x = sp.x;
      f.y = sp.y;
      f.groundRef = sp.y > this.stage.main.top ? this.findPlatformAt(sp.x, sp.y) : -1;
      f.facing = sp.x > 0 ? -1 : 1;
      f.stocks = isNoStock(setup.rules.mode) ? 0 : setup.rules.stocks;
      if (setup.rules.teams || setup.rules.horde) f.team = setup.rules.horde ? (i === 0 ? 0 : 1) : Math.max(0, Math.min(3, p.team ?? 0));
      // 玉入れはいつも赤と青の2チーム（チーム戦でなければ順番に赤・青）
      if (isTwoTeam(setup.rules.mode)) f.team = (setup.rules.teams ? p.team ?? i : i) % 2;
      // 100人組手の敵は倒されても次々に出てくる（残りの人数は hordeLeft で数える）
      if (setup.rules.horde && f.team !== 0) {
        f.stocks = 1;
        // 3人目からの敵は、しばらく倒してから出てくる
        if (i >= 3) {
          f.state = 'dead';
          f.respawnTimer = 1;
        }
      }
      f.shield = f.shieldMax;
      this.fighters.push(f);
    });
    if (setup.rules.mode === 'area') this.setupArea();
    if (setup.rules.mode === 'ball') this.resetBall();
    if (setup.rules.mode === 'crown') this.resetCrown();
    if (setup.rules.mode === 'vault') this.setupVaults();
    if (setup.rules.mode === 'coins') this.coinTimer = 30;
  }

  // ---------------------------------------------------------------- 王冠うばい
  crown = { x: 0, y: 0, vy: 0, holder: -1, on: false, timer: 0, cd: 0, last: -1 };
  /** 王冠を持っていた時間（フレーム）。番号はチーム戦ならチーム、個人戦なら slot */
  crownPts = new Map<number, number>();

  get crownGoalFrames(): number {
    return (this.setup.rules.crownGoal ?? CROWN.goal) * 60;
  }

  crownKey(f: Fighter): number {
    return this.setup.rules.teams ? f.team : f.slot;
  }

  /**
   * 王冠の状態。はじめ（timer = -1）はだれも持たず、最初に相手を撃墜した人が手に入れる。
   * 持っている人が自分で落ちたら、少しあとにステージの中央の上に出て（timer フレーム後）、触れた人が拾う
   */
  private resetCrown(timer = -1): void {
    const m = this.stage.main;
    this.crown = { x: (m.x1 + m.x2) / 2, y: m.top + 5, vy: 0, holder: -1, on: false, timer, cd: 0, last: -1 };
  }

  private updateCrown(): void {
    const c = this.crown;
    if (c.cd > 0) c.cd--;
    if (c.holder < 0 && !c.on) {
      // 中央に出るのを待っている
      if (c.timer > 0 && --c.timer <= 0) {
        c.on = true;
        this.events.push({ k: 'poof', x: c.x, y: c.y });
      }
      return;
    }
    const h = c.holder >= 0 ? this.fighter(c.holder) : undefined;
    if (h) {
      // 持っている人が（だれにも倒されずに）自分で落ちた：中央に出直す
      if (!h.alive || h.out) return this.resetCrown(CROWN.respawn);
      c.x = h.x;
      c.y = h.y + h.h + 0.3;
      if (h.state !== 'respawn') {
        const k = this.crownKey(h);
        this.crownPts.set(k, (this.crownPts.get(k) ?? 0) + 1);
      }
      return;
    }
    // 中央に出た王冠：落ちてきて床や足場に乗り、触れた人が拾う
    const py = c.y;
    c.vy = Math.max(-12, c.vy - 25 * DT);
    c.y += c.vy * DT;
    const m = this.stage.main;
    if (c.x >= m.x1 && c.x <= m.x2 && py >= m.top && c.y <= m.top) {
      c.y = m.top;
      c.vy = 0;
    }
    for (const sp of this.stage.platforms) {
      const p = platformAt(sp, this.frame);
      if (c.x >= p.x1 && c.x <= p.x2 && py >= p.prevY - 0.001 && c.y <= p.y) {
        c.y = p.y;
        c.vy = 0;
      }
    }
    if (c.y < this.stage.blast.bottom) return this.resetCrown(CROWN.respawn);
    const taker = this.fighters.find(
      (v) => v.alive && !v.out && v.state !== 'grabbed' && circleHitsBox(c.x, c.y + 0.3, CROWN.r, v),
    );
    if (taker) {
      c.holder = taker.slot;
      this.events.push({ k: 'crown', s: taker.slot, x: c.x, y: c.y });
    }
  }

  /**
   * 王冠うばい：だれかが撃墜された。王冠をだれも持っていないか、持っていた人が倒されたなら、
   * 倒した人が王冠を手に入れる（最初に拾う形式だと、近くに出た人が有利になるため）
   */
  private crownOnKo(f: Fighter, by: number | undefined): void {
    const c = this.crown;
    // 中央に出ている・出るのを待っている王冠は、拾った人のもの
    if ((c.holder >= 0 && c.holder !== f.slot) || (c.holder < 0 && c.timer >= 0)) return;
    const k = by === undefined ? undefined : this.fighter(by);
    if (k && k.alive && !k.out && k.team !== f.team) {
      c.holder = k.slot;
      c.on = true;
      c.cd = CROWN.stealCd;
      c.last = f.slot;
      c.x = k.x;
      c.y = k.y + k.h + 0.3;
      this.events.push({ k: 'crown', s: k.slot, x: c.x, y: c.y });
    } else if (c.holder === f.slot) {
      // 自分で落ちた（または倒した人もいなくなった）：中央に出直す
      this.resetCrown(CROWN.respawn);
    }
  }

  /** 王冠を持っている人が相手の攻撃を受けた：王冠は攻撃した人に移る */
  private crownSteal(v: Fighter, from: number): void {
    const c = this.crown;
    if (c.holder !== v.slot || c.cd > 0 || from < 0 || from === v.slot) return;
    const a = this.fighter(from);
    if (!a || !a.alive || a.out || this.friendly(from, v)) return;
    c.holder = a.slot;
    c.cd = CROWN.stealCd;
    c.last = v.slot;
    this.events.push({ k: 'crown', s: a.slot, x: v.x, y: v.y + v.h });
  }

  private crownView(): CrownView {
    return { x: this.crown.x, y: this.crown.y, holder: this.crown.holder, on: this.crown.on, pts: [...this.crownPts.entries()], goal: this.crownGoalFrames };
  }

  // ---------------------------------------------------------------- 賞金首
  /** 点（slot ごと） */
  bountyPts = new Map<number, number>();
  /** 賞金首の slot（-1 = いない） */
  bountyHolder = -1;

  /** 撃墜されたとき：倒した人に点（賞金首なら上乗せ）。自分で落ちたら点が減る */
  private bountyOnKo(f: Fighter, by: number | undefined): void {
    const k = by === undefined ? undefined : this.fighter(by);
    const pts = this.bountyPts;
    if (k && k !== f && k.team !== f.team) {
      const wasBounty = f.slot === this.bountyHolder;
      const p = BOUNTY.ko + (wasBounty ? BOUNTY.bonus : 0);
      pts.set(k.slot, (pts.get(k.slot) ?? 0) + p);
      this.events.push({ k: 'bpt', s: k.slot, x: f.x, y: f.y, p, b: wasBounty });
    } else if (!k) {
      pts.set(f.slot, Math.max(0, (pts.get(f.slot) ?? 0) - BOUNTY.self));
    }
    this.updateBountyHolder();
  }

  /** 賞金首は、点が一番多い人（同点の1位が何人もいるとき・点が足りないときはいない。今の賞金首は同点なら続ける） */
  private updateBountyHolder(): void {
    let top = -1;
    let best = -1;
    let tie = false;
    for (const f of this.fighters) {
      const p = this.bountyPts.get(f.slot) ?? 0;
      if (p > best) {
        best = p;
        top = f.slot;
        tie = false;
      } else if (p === best) tie = true;
    }
    const cur = this.bountyHolder;
    let next = -1;
    if (best >= BOUNTY.min) {
      if (!tie) next = top;
      else if (cur >= 0 && (this.bountyPts.get(cur) ?? 0) === best) next = cur;
    }
    if (next !== cur) {
      this.bountyHolder = next;
      if (next >= 0) this.events.push({ k: 'bnew', s: next });
    }
  }

  private bountyView(): BountyView {
    return { holder: this.bountyHolder, pts: [...this.bountyPts.entries()] };
  }

  // ---------------------------------------------------------------- コイン集め
  /** 落ちているコイン（no = 拾えない人の slot、noT = 拾えない残りフレーム） */
  coins: { x: number; y: number; vx: number; vy: number; v: number; no: number; noT: number }[] = [];
  /** 持っている枚数（slot ごと） */
  coinsHeld = new Map<number, number>();
  coinTimer = 0;

  /** コインを (x, y) から飛び散らせる（n 枚。多すぎるときはまとめて大きいコインにする） */
  private scatterCoins(x: number, y: number, n: number, no: number): void {
    const room = Math.max(1, 30 - this.coins.length);
    const pieces = Math.min(n, room);
    for (let i = 0; i < pieces; i++) {
      const v = Math.floor(n / pieces) + (i < n % pieces ? 1 : 0);
      const a = pieces === 1 ? 0 : (i / (pieces - 1) - 0.5) * 2;
      this.coins.push({ x, y, vx: a * 3.2 + (this.rng.next() - 0.5) * 0.8, vy: 7 + this.rng.next() * 2.5, v, no, noT: COINS.noPick });
    }
  }

  private updateCoins(): void {
    // 決まった間隔で、ステージの上からコインが降ってくる
    if (--this.coinTimer <= 0) {
      this.coinTimer = COINS.every;
      if (this.coins.length < COINS.max) {
        const m = this.stage.main;
        const x = m.x1 + 1 + this.rng.next() * (m.x2 - m.x1 - 2);
        const big = this.rng.chance(COINS.bigChance);
        this.coins.push({ x, y: m.top + 7, vx: 0, vy: 0, v: big ? COINS.big : 1, no: -1, noT: 0 });
      }
    }
    const m = this.stage.main;
    const keep: typeof this.coins = [];
    for (const c of this.coins) {
      if (c.noT > 0) c.noT--;
      const py = c.y;
      c.vy = Math.max(-14, c.vy - 25 * DT);
      c.x += c.vx * DT;
      c.y += c.vy * DT;
      let landed = false;
      if (c.x >= m.x1 && c.x <= m.x2 && py >= m.top && c.y <= m.top) {
        c.y = m.top;
        landed = true;
      }
      for (const sp of this.stage.platforms) {
        const p = platformAt(sp, this.frame);
        if (c.x >= p.x1 && c.x <= p.x2 && py >= p.prevY - 0.001 && c.y <= p.y) {
          c.y = p.y;
          landed = true;
        }
      }
      if (landed) {
        c.vy = 0;
        c.vx = 0;
      }
      // 場外に落ちたコインは消える
      if (c.y < this.stage.blast.bottom || c.x < this.stage.blast.left || c.x > this.stage.blast.right) continue;
      const taker = this.fighters.find(
        (v) => v.alive && !v.out && v.state !== 'grabbed' && !(c.noT > 0 && v.slot === c.no) && circleHitsBox(c.x, c.y + 0.3, COINS.r, v),
      );
      if (taker) {
        this.coinsHeld.set(taker.slot, (this.coinsHeld.get(taker.slot) ?? 0) + c.v);
        this.events.push({ k: 'coin', s: taker.slot, x: c.x, y: c.y, v: c.v });
        continue;
      }
      keep.push(c);
    }
    this.coins = keep;
  }

  /** 攻撃を受けた：ダメージに合わせてコインを落とす */
  private coinsOnHit(v: Fighter, dmg: number, from: number): void {
    if (from < 0 || from === v.slot || this.friendly(from, v)) return;
    const held = this.coinsHeld.get(v.slot) ?? 0;
    if (held <= 0) return;
    const n = Math.min(held, COINS.hitMax, Math.max(1, Math.floor(dmg / COINS.perDmg)));
    this.coinsHeld.set(v.slot, held - n);
    this.scatterCoins(v.x, v.y + v.h * 0.6, n, v.slot);
    this.events.push({ k: 'cdrop', s: v.slot, x: v.x, y: v.y + v.h, p: n });
  }

  /** 撃墜された：持っているコインの半分を、ステージの中央の上からばらまく */
  private coinsOnKo(f: Fighter): void {
    const held = this.coinsHeld.get(f.slot) ?? 0;
    const n = Math.ceil(held * COINS.ko);
    if (n <= 0) return;
    this.coinsHeld.set(f.slot, held - n);
    const m = this.stage.main;
    this.scatterCoins((m.x1 + m.x2) / 2, m.top + 6, n, -1);
    this.events.push({ k: 'cdrop', s: f.slot, x: (m.x1 + m.x2) / 2, y: m.top + 6, p: n });
  }

  private coinsView(): CoinsView {
    return { list: this.coins.map((c) => ({ x: c.x, y: c.y, v: c.v })), held: [...this.coinsHeld.entries()] };
  }

  // ---------------------------------------------------------------- 金庫まもり
  /** 0 = 赤チーム（左）の金庫、1 = 青チーム（右）の金庫 */
  vaults: { x: number; y: number; hp: number; max: number }[] = [];

  private setupVaults(): void {
    const m = this.stage.main;
    // 人数が多いほど早く壊れるので、多いほうのチームの人数に合わせて耐久を増やす
    const size = Math.max(1, ...[0, 1].map((t) => this.fighters.filter((f) => f.team % 2 === t).length));
    const hp = Math.round((this.setup.rules.vaultHp ?? VAULT.hp) * VAULT.scale * (1 + VAULT.perPlayer * (size - 1)));
    this.vaults = [
      { x: m.x1 + VAULT.inset, y: m.top, hp, max: hp },
      { x: m.x2 - VAULT.inset, y: m.top, hp, max: hp },
    ];
  }

  /** 円が金庫に触れているか */
  private circleHitsVault(i: number, cx: number, cy: number, r: number): boolean {
    const v = this.vaults[i];
    const nx = Math.max(v.x - VAULT.w / 2, Math.min(cx, v.x + VAULT.w / 2));
    const ny = Math.max(v.y, Math.min(cy, v.y + VAULT.h));
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
  }

  private hitVault(i: number, dmg: number, by: number, x: number, y: number): void {
    const v = this.vaults[i];
    if (v.hp <= 0 || dmg <= 0) return;
    // 細かい数で数える（引き分けになりにくくする。運にならないよう、ぶれは付けない）
    dmg = Math.max(1, Math.round(dmg * VAULT.scale));
    dmg = Math.min(dmg, v.hp);
    v.hp -= dmg;
    const f = this.fighter(by);
    if (f) f.vaultDmg += dmg;
    this.events.push({ k: 'vhit', x, y, t: i, p: dmg });
    if (v.hp <= 0) this.events.push({ k: 'vbreak', x: v.x, y: v.y + VAULT.h / 2, t: i });
  }

  private updateVaults(): void {
    // 攻撃が当たる：相手チームの金庫だけ（1つの技で1回）
    for (const a of this.fighters) {
      if (a.state !== 'attack' || !a.move || a.vaultHit || a.hitlag > 0 || !a.alive) continue;
      const md = this.moveDef(a);
      if (md.hitboxes.length === 0 || md.dmg <= 0) continue;
      const t = moveTiming(md, a);
      if (a.moveFrame < t.s || a.moveFrame >= t.s + t.a) continue;
      const i = 1 - (a.team % 2);
      const s = a.def.scale;
      for (const hb of md.hitboxes) {
        const cx = a.x + hb.x * a.facing * s;
        const cy = a.y + hb.y * s;
        if (!this.circleHitsVault(i, cx, cy, hb.r * s)) continue;
        a.vaultHit = true;
        this.hitVault(i, md.dmg * this.powerMul(a).dmg, a.slot, cx, cy);
        break;
      }
    }
    // 飛び道具が当たる：相手チームの金庫に当たったら消える
    for (const p of this.projectiles) {
      const o = this.fighter(p.owner);
      if (!o || p.life <= 0) continue;
      const i = 1 - (o.team % 2);
      if (!this.circleHitsVault(i, p.x, p.y, p.r)) continue;
      this.hitVault(i, p.dmg, p.owner, p.x, p.y);
      p.life = 0;
    }
  }

  private vaultView(): VaultView {
    return { hp: [this.vaults[0]?.hp ?? 0, this.vaults[1]?.hp ?? 0], max: this.vaults[0]?.max ?? VAULT.hp };
  }

  // ---------------------------------------------------------------- 玉入れ
  ball = { x: 0, y: 0, vx: 0, vy: 0, on: false, timer: 0, last: -1 };
  ballScore: [number, number] = [0, 0];

  get ballTarget(): number {
    return this.setup.rules.goals ?? BALL.target;
  }

  /** ボールをステージの中央の上に出す（timer フレーム後に出てくる） */
  private resetBall(timer = 0): void {
    const m = this.stage.main;
    this.ball = { x: (m.x1 + m.x2) / 2, y: m.top + 4.5, vx: 0, vy: 0, on: timer === 0, timer, last: -1 };
  }

  private kickBall(vx: number, vy: number, by: number): void {
    const sp = Math.hypot(vx, vy);
    const k = sp > BALL.maxSpeed ? BALL.maxSpeed / sp : 1;
    this.ball.vx = vx * k;
    this.ball.vy = vy * k;
    this.ball.last = by;
  }

  private updateBall(): void {
    const b = this.ball;
    if (!b.on) {
      if (--b.timer <= 0) {
        this.resetBall();
        this.events.push({ k: 'poof', x: b.x, y: b.y });
      }
      return;
    }
    const r = BALL.r;
    // 攻撃が当たると、技の向き・強さでふっとぶ
    for (const a of this.fighters) {
      if (a.state !== 'attack' || !a.move || a.ballHit || a.hitlag > 0) continue;
      const md = this.moveDef(a);
      if (md.hitboxes.length === 0) continue;
      const t = moveTiming(md, a);
      if (a.moveFrame < t.s || a.moveFrame >= t.s + t.a) continue;
      const s = a.def.scale;
      for (const hb of md.hitboxes) {
        const cx = a.x + hb.x * a.facing * s;
        const cy = a.y + hb.y * s;
        const reach = hb.r * s + r + BALL.hitPad;
        // オンライン：打った人の画面に映っていた（少し前の）ボールの位置に当たっていても当たり
        if (Math.hypot(cx - b.x, cy - b.y) > reach && !this.ballPastNear(a, cx, cy, reach)) continue;
        a.ballHit = true;
        // 真横・真下に近い技は、少し上向きに飛ばす（床を転がるだけにならないように）
        let deg = md.angle <= 10 && md.angle >= -10 ? 30 : md.angle < -10 ? 20 : md.angle;
        // ねらい：スティックを斜め上に入れて打つと山なり（かごに入れやすい）、斜め下で低く速く
        //（真上・真下に入れると上攻撃・下攻撃になるので、斜めでも効くようにする）
        // 技を出したときの向きで決める（当たる瞬間にスティックを離していても効く）
        const aim = Math.abs(a.input.my) > 0.3 ? a.input.my : a.moveAim;
        if (aim > 0.3) deg = Math.max(deg, BALL.lobAngle);
        else if (aim < -0.3) deg = Math.min(deg, BALL.lowAngle);
        const ang = (deg * Math.PI) / 180;
        const sp = Math.max(BALL.kickMin, (BALL.kickBase + md.dmg * BALL.kickDmg + md.base * BALL.kickKb) * a.def.dmgMul);
        this.kickBall(Math.cos(ang) * sp * a.facing, Math.sin(ang) * sp, a.slot);
        this.events.push({ k: 'kick', x: b.x, y: b.y, p: sp });
        break;
      }
    }
    // 飛び道具が当たると、進む向きに押される
    for (const p of this.projectiles) {
      if (Math.hypot(p.x - b.x, p.y - b.y) > r + 0.35) continue;
      if (p.ballHit) continue;
      p.ballHit = true;
      this.kickBall(Math.sign(p.vx || 1) * 9, 5, p.owner);
    }
    // 体で押す（ドリブル）
    for (const f of this.fighters) {
      if (!f.alive || f.state === 'hitstun') continue;
      const dx = b.x - f.x;
      if (Math.abs(dx) < f.hw + r && b.y - r < f.y + f.h && b.y + r > f.y && Math.abs(b.vx) < Math.abs(f.vx) + 1) {
        b.vx = f.vx * 1.15 + Math.sign(dx || f.facing) * 1.2;
        b.last = f.slot;
      }
    }
    // 動き：重力・空気抵抗
    const px = b.x;
    const py = b.y;
    b.vy -= BALL.gravity * DT;
    b.vx *= 0.997;
    b.x += b.vx * DT;
    b.y += b.vy * DT;
    const m = this.stage.main;
    // 床（上から落ちてきたとき）
    if (b.vy < 0 && b.x >= m.x1 - r * 0.5 && b.x <= m.x2 + r * 0.5 && py - r >= m.top - 0.05 && b.y - r < m.top) {
      b.y = m.top + r;
      b.vy = Math.abs(b.vy) < 2 ? 0 : -b.vy * BALL.bounce;
      b.vx *= 0.9;
    } else if (b.y - r < m.top && b.y + r > m.bottom && (px < m.x1 || px > m.x2) && b.x >= m.x1 && b.x <= m.x2) {
      // 台の横の壁ではね返る
      b.x = px;
      b.vx = -b.vx * 0.5;
    }
    // すり抜けられる足場（上から落ちてきたときだけ乗る）
    for (const pl of this.stage.platforms) {
      const at = platformAt(pl, this.frame);
      if (b.vy < 0 && b.x >= at.x1 && b.x <= at.x2 && py - r >= at.y - 0.05 && b.y - r < at.y) {
        b.y = at.y + r;
        b.vy = Math.abs(b.vy) < 2 ? 0 : -b.vy * BALL.bounce;
        b.vx = b.vx * 0.9 + at.dx * 60 * 0.1;
      }
    }
    // 転がる摩擦
    if (b.vy === 0) b.vx *= 0.985;
    // 天井
    if (b.y > this.stage.blast.top - 1.5 && b.vy > 0) b.vy = -b.vy * 0.5;
    // ゴール：相手チームのかごに（上から）入ったら点
    ballBaskets(this.stage).forEach((g, k) => {
      // 玉入れらしく、上から落ちてきて入ったときだけ数える
      if (!b.on || b.vy >= 0 || b.x < g.x1 || b.x > g.x2 || b.y < g.y1 || b.y > g.y2) return;
      const team = 1 - k;
      this.ballScore[team]++;
      const by = this.fighter(b.last);
      if (by && by.team === team) by.goals++;
      this.events.push({ k: 'goal', x: g.cx, y: (g.y1 + g.y2) / 2, t: team, s: b.last });
      b.on = false;
      b.timer = BALL.respawn;
    });
    // 場外：中央から出し直す
    const bl = this.stage.blast;
    if (b.on && (b.y < bl.bottom || b.x < bl.left || b.x > bl.right)) {
      b.on = false;
      b.timer = BALL.respawn / 2;
    }
  }

  /** 巻き戻し：打った人の画面に映っていた（少し前の）ボールの位置のどこかに届いていたか */
  private ballPastNear(a: Fighter, cx: number, cy: number, reach: number): boolean {
    const lag = Math.min(LAG_COMP_MAX, this.lagComp.get(a.slot) ?? 0);
    for (let k = 1; k <= lag; k++) {
      const p = this.ballHist[this.ballHist.length - k];
      if (!p) break;
      if (Math.hypot(cx - p.x, cy - p.y) <= reach) return true;
    }
    return false;
  }
  /** ボールの位置の記録（巻き戻し用） */
  private ballHist: { x: number; y: number }[] = [];

  private ballView(): BallView {
    return { x: this.ball.x, y: this.ball.y, vx: this.ball.vx, on: this.ball.on, score: [...this.ballScore] as [number, number], target: this.ballTarget };
  }

  // ---------------------------------------------------------------- エリアバトル
  /** エリアの形（おまかせは、試合の種から決める） */
  areaShape: 'move' | 'fix2' = 'move';
  /** 移動するエリアの候補（床の左・中央・右と、動かない足場） */
  private areaSpots: AreaZone[] = [];
  /** ゲージ（番号 → 値）。番号はチーム戦ならチーム、個人戦なら slot */
  areaGauge = new Map<number, number>();

  private setupArea(): void {
    const r = this.setup.rules;
    this.areaShape = r.area === 'fix2' ? 'fix2' : r.area === 'random' ? (hash32(this.setup.seed, 7) & 1 ? 'fix2' : 'move') : 'move';
    const m = this.stage.main;
    const cx = (m.x1 + m.x2) / 2;
    const half = (m.x2 - m.x1) / 2;
    const floor = (c: number, w: number): AreaZone => {
      const ww = Math.min(w, half * 0.9);
      const x1 = Math.max(m.x1, c - ww / 2);
      const x2 = Math.min(m.x2, x1 + ww);
      return { x1: x2 - ww, x2, y1: m.top, y2: m.top + AREA.height };
    };
    if (this.areaShape === 'fix2') {
      this.areaSpots = [floor(cx - half * 0.55, AREA.fixWidth), floor(cx + half * 0.55, AREA.fixWidth)];
    } else {
      // 最初は床の中央。そのあとは床の左右と、動かない広めの足場から選ぶ
      this.areaSpots = [floor(cx, AREA.bigWidth), floor(cx - half * 0.55, AREA.bigWidth), floor(cx + half * 0.55, AREA.bigWidth)];
      for (const p of this.stage.platforms) {
        if (p.movePeriod || p.x2 - p.x1 < 3) continue;
        this.areaSpots.push({ x1: p.x1, x2: p.x2, y1: p.y, y2: p.y + AREA.height });
      }
    }
    for (const f of this.fighters) this.areaGauge.set(this.areaKey(f), 0);
  }

  /** ゲージの満タンの量。ゲージの数（個人戦は人数、チーム戦はチーム数）が多いほど取り合いが増えるので少なくする */
  get areaGoal(): number {
    const k = Math.max(2, this.areaGauge.size);
    const t = AREA.goalScale[this.areaShape];
    return Math.round(AREA.goal * (t[Math.min(k, t.length - 1)] ?? 1));
  }

  /** その人のゲージの番号 */
  areaKey(f: Fighter): number {
    return this.setup.rules.teams ? f.team : f.slot;
  }

  /** 移動するエリアの、何回目の場所か（0 = 最初） */
  private areaPhase(frame: number): number {
    return Math.max(0, Math.floor((frame - COUNTDOWN_FRAMES) / AREA.moveEvery));
  }

  /** phase 回目のエリアの場所（候補の番号）。同じ場所が続かないようにする */
  private areaSpotIndex(phase: number): number {
    if (phase <= 0) return 0;
    const n = this.areaSpots.length;
    const prev = this.areaSpotIndex(phase - 1);
    let i = hash32(this.setup.seed, phase) % (n - 1);
    if (i >= prev) i++;
    return i;
  }

  /** 今のエリア */
  areaZones(frame = this.frame): AreaZone[] {
    if (this.setup.rules.mode !== 'area') return [];
    if (this.areaShape === 'fix2') return this.areaSpots;
    return [this.areaSpots[this.areaSpotIndex(this.areaPhase(frame))]];
  }

  /** 次のエリア（移る前の予告の間だけ）と、移るまでのフレーム数 */
  areaNext(): { zones: AreaZone[]; nextIn: number } {
    if (this.setup.rules.mode !== 'area' || this.areaShape === 'fix2' || this.frame <= COUNTDOWN_FRAMES) return { zones: [], nextIn: 0 };
    const into = (this.frame - COUNTDOWN_FRAMES) % AREA.moveEvery;
    const nextIn = AREA.moveEvery - into;
    if (nextIn > AREA.warn) return { zones: [], nextIn };
    return { zones: [this.areaSpots[this.areaSpotIndex(this.areaPhase(this.frame) + 1)]], nextIn };
  }

  /** f がエリア z の中にいるか（復活中・やられ中は数えない） */
  inZone(f: Fighter, z: AreaZone): boolean {
    return f.alive && !f.out && f.x >= z.x1 && f.x <= z.x2 && f.y >= z.y1 - 0.3 && f.y <= z.y2;
  }

  /** それぞれのエリアにいる人の番号（-1 = だれもいない、-2 = 取り合い中） */
  areaHolders(): number[] {
    return this.areaZones().map((z) => {
      const keys = new Set(this.fighters.filter((f) => this.inZone(f, z)).map((f) => this.areaKey(f)));
      return keys.size === 0 ? -1 : keys.size > 1 ? -2 : [...keys][0];
    });
  }

  /** ゲージを進める：敵のいないエリアに立っている味方の数で速さが決まる（1人 1倍、1人増えるごとに +0.2倍） */
  private updateArea(): void {
    const zones = this.areaZones();
    const holders = this.areaHolders();
    const count = new Map<number, number>();
    zones.forEach((z, i) => {
      const k = holders[i];
      if (k < 0) return;
      const n = this.fighters.filter((f) => this.inZone(f, z)).length;
      count.set(k, (count.get(k) ?? 0) + n);
    });
    for (const [k, n] of count) {
      const v = Math.min(this.areaGoal, (this.areaGauge.get(k) ?? 0) + 1 + AREA.perAlly * (n - 1));
      this.areaGauge.set(k, v);
    }
  }

  private areaView(): AreaView {
    const holders = this.areaHolders();
    const nx = this.areaNext();
    return {
      zones: this.areaZones().map((z, i) => ({ ...z, holder: holders[i] })),
      next: nx.zones,
      nextIn: nx.nextIn,
      gauges: [...this.areaGauge.entries()].map(([k, v]) => [k, Math.floor(v)] as [number, number]),
      goal: this.areaGoal,
    };
  }

  private findPlatformAt(x: number, y: number): number {
    for (let i = 0; i < this.stage.platforms.length; i++) {
      const p = platformAt(this.stage.platforms[i], 0);
      if (Math.abs(p.y - y) < 0.01 && x >= p.x1 && x <= p.x2) return i;
    }
    return -1;
  }

  fighter(slot: number): Fighter | undefined {
    return this.fighters.find((f) => f.slot === slot);
  }

  get timeLimitFrames(): number {
    return this.setup.rules.timeLimit * 60;
  }

  get timeLeftFrames(): number {
    return Math.max(0, this.timeLimitFrames - Math.max(0, this.frame - COUNTDOWN_FRAMES));
  }

  /** 100人組手で倒した敵の数 */
  hordeDefeated = 0;

  /** 100人組手で、出番を待っている3人目の敵 */
  private hordeWaiting(f: Fighter): boolean {
    return !!this.setup.rules.horde && f.team !== 0 && f.state === 'dead' && this.hordeDefeated < HORDE.thirdAt && this.fighters.indexOf(f) >= 3;
  }

  /** 体力制のHP */
  get maxHp(): number {
    return this.setup.rules.hp ?? DEFAULT_HP;
  }

  /** 同じチーム（チーム戦のとき。自分自身も含む） */
  sameTeam(a: Fighter, b: Fighter): boolean {
    return a.team === b.team;
  }

  /**
   * from（攻撃した人の slot）の攻撃が v に当たらないか。
   * チーム戦で「味方にも当たる」がオフのとき、味方の攻撃は当たらない（-1 はステージギミックなど）。
   */
  private friendly(from: number, v: Fighter): boolean {
    if (from < 0 || from === v.slot) return false;
    // 玉入れで「相手への攻撃：当たらない」なら、だれの攻撃もほかの人に当たらない（ボールにだけ当たる）
    if (this.setup.rules.mode === 'ball' && this.setup.rules.pvp === false) return true;
    if (this.setup.rules.friendlyFire) return false;
    const a = this.fighter(from);
    return !!a && a.team === v.team;
  }

  /** 1フレーム進める。inputs は slot をキーにした入力 */
  step(inputs: Map<number, InputState>): void {
    this.frame++;
    this.events = [];
    if (this.finished) return;
    if (this.ended && this.frame - this.endFrame > END_DELAY) {
      this.finished = true;
      return;
    }
    const playing = this.frame > COUNTDOWN_FRAMES && !this.ended;
    for (const f of this.fighters) {
      const inp = playing ? inputs.get(f.slot) ?? EMPTY_INPUT : EMPTY_INPUT;
      this.readInput(f, inp);
      // 試合が決まったあとは操作が止まるので、自転車からも降ろす（乗ったまま走り続けて台から落ちないように）
      if (this.ended) f.bike = 0;
    }
    this.fixGrabs();
    const frozen = new Set<Fighter>();
    for (const f of this.fighters) {
      if (f.hitlag > 0) {
        f.hitlag--;
        frozen.add(f);
        continue;
      }
      this.updateFighter(f);
    }
    if (playing && !this.solo) {
      this.updateItems();
      this.updateGimmick();
    }
    this.updateEntities();
    this.updateProjectiles();
    this.detectHits();
    for (const f of this.fighters) this.checkBlast(f);
    if (this.setup.rules.mode === 'stamina') for (const f of this.fighters) this.checkHp(f);
    if (playing && !this.solo && this.setup.rules.mode === 'area') this.updateArea();
    if (playing && !this.solo && this.setup.rules.mode === 'ball') this.updateBall();
    if (playing && !this.solo && this.setup.rules.mode === 'crown') this.updateCrown();
    if (playing && !this.solo && this.setup.rules.mode === 'vault') this.updateVaults();
    if (playing && !this.solo && this.setup.rules.mode === 'coins') this.updateCoins();
    for (const f of this.fighters) this.updateAntiLock(f);
    if (this.lagComp.size) {
      this.posHist.push(new Map(this.fighters.map((f) => [f.slot, { x: f.x, y: f.y }])));
      if (this.posHist.length > LAG_COMP_MAX + 1) this.posHist.shift();
      if (this.setup.rules.mode === 'ball') {
        this.ballHist.push({ x: this.ball.x, y: this.ball.y });
        if (this.ballHist.length > LAG_COMP_MAX + 1) this.ballHist.shift();
      }
    }
    this.checkEnd();
    for (const f of this.fighters) {
      // ヒットストップで止まっていた選手は前回の入力を更新しない（押しっぱなしなら、止まりが解けた時に押したことになる）
      if (f.hitlag > 0 || frozen.has(f)) continue;
      f.prevButtons = f.input.buttons;
      f.prevMx = f.input.mx;
      f.prevMy = f.input.my;
    }
  }

  /** ハメ防止（ANTILOCK を参照） */
  private updateAntiLock(f: Fighter): void {
    if (!f.alive) {
      f.lockMeter = 0;
      f.lockFree = 0;
      return;
    }
    // 動けない：ひるみ・眠り・固まり・つかまれ・着地の硬直（自分の攻撃が当たったときの固まりは除く）
    const stuck = (f.hitlag > 0 && f.state !== 'attack') || f.state === 'hitstun' || f.state === 'sleep' || f.state === 'grabbed' || (f.state === 'land' && f.stun > 12);
    if (stuck) {
      f.lockFree = 0;
      f.lockMeter++;
      // 溜まりきったら、残りのひるみ・眠りを短くする（すぐ抜け出せるように）。さらに続いたら打ち切る
      if (f.lockMeter >= ANTILOCK.limit) {
        const rest = f.lockMeter >= ANTILOCK.cut ? 1 : ANTILOCK.rest;
        if (f.state === 'hitstun') f.hitstun = Math.min(f.hitstun, rest);
        if (f.state === 'sleep') f.stun = Math.min(f.stun, rest);
      }
      return;
    }
    if (f.lockMeter >= ANTILOCK.limit) {
      // 抜け出す：少しの間、無敵になる
      f.invuln = Math.max(f.invuln, ANTILOCK.invuln);
      f.lockMeter = 0;
      this.events.push({ k: 'poof', x: f.x, y: f.y + f.h * 0.5 });
      return;
    }
    f.lockFree++;
    // 短いすき間はハメの途中として数える。長く動ければ減っていく
    if (f.lockFree <= ANTILOCK.grace) {
      if (f.lockMeter > 0) f.lockMeter++;
    } else f.lockMeter = Math.max(0, f.lockMeter - ANTILOCK.decay);
  }

  private readInput(f: Fighter, inp: InputState): void {
    // 通知爆撃：左右の操作が逆になる
    if (f.confused > 0) inp = { ...inp, mx: -inp.mx };
    f.input = inp;
    // 「はじき」の判定：中央付近から FLICK_WINDOW フレーム以内に大きく倒したら、はじいたとみなす。
    // 指で操作する仮想スティックは倒し切るまで数フレームかかるため、1フレームでの判定にはしない。
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ax > 0.75 && Math.abs(f.prevMx) <= 0.75 && f.neutralXAge <= FLICK_WINDOW) f.flickX = 0;
    else f.flickX++;
    if (ay > 0.7 && Math.abs(f.prevMy) <= 0.7 && f.neutralYAge <= FLICK_WINDOW) f.flickY = 0;
    else f.flickY++;
    f.neutralXAge = ax < 0.3 ? 0 : f.neutralXAge + 1;
    f.neutralYAge = ay < 0.3 ? 0 : f.neutralYAge + 1;
  }

  private pressed(f: Fighter, btn: number): boolean {
    return (f.input.buttons & btn) !== 0 && (f.prevButtons & btn) === 0;
  }

  private held(f: Fighter, btn: number): boolean {
    return (f.input.buttons & btn) !== 0;
  }

  private setState(f: Fighter, s: FighterStateName): void {
    f.state = s;
    f.stateTime = 0;
  }

  // ------------------------------------------------------------------
  private updateFighter(f: Fighter): void {
    f.stateTime++;
    if (f.invuln > 0) f.invuln--;
    if (f.ledgeCooldown > 0) f.ledgeCooldown--;
    if (f.dropThrough > 0) f.dropThrough--;
    if (f.state !== 'shield' && f.shield < f.shieldMax) f.shield = Math.min(f.shieldMax, f.shield + 0.08);
    if (f.speedBuff > 0) f.speedBuff--;
    if (f.speedCd > 0) f.speedCd--;
    if (f.armor > 0) f.armor--;
    if (f.jobBuff > 0) f.jobBuff--;
    if (f.jobCd > 0) f.jobCd--;
    if (f.warpCd > 0) f.warpCd--;
    if (f.warpSlow > 0) f.warpSlow--;
    this.menheraTimers(f);
    // 3B：いま着ていない仕事のBの待ち時間も、裏で数える（バンドマンの爆音ソロは、音が消えるまでは減らない）
    // （書き出した状態と配列を共有しないよう、書き換えるときは新しい配列にする）
    if (f.def.id === 'threeb' && f.jobCdN.some((c, j) => j !== f.job && (c > 0 || j === 1))) {
      const hold = this.soundAlive(f) ? moveOf('threeb', 'nspecial', 1).cd ?? 0 : 0;
      f.jobCdN = f.jobCdN.map((c, j) => (j === f.job ? c : j === 1 && hold ? Math.max(c, hold) : Math.max(0, c - 1)));
    }
    // 必殺技の待ち時間は、その技を出し終わってから減り始める
    for (const id of ['nspecial', 'sspecial', 'dspecial', 'uspecial'] as const) {
      const k = SPECIAL_CD[id];
      // 自転車は、降りてから数える
      if (id === 'sspecial' && f.bike > 0) continue;
      // 爆音ソロ（3B・バンドマン）は、飛ばした音の衝撃が消えてから数える
      if (id === 'nspecial' && f.def.id === 'threeb' && f.job === 1 && this.soundAlive(f)) {
        f[k] = Math.max(f[k], moveOf('threeb', 'nspecial', 1).cd ?? 0);
        continue;
      }
      // エージェント起動は、ドローンがいる間は待ち時間のまま（消えてから数える）
      if (id === 'dspecial' && f.def.id === 'ai' && this.entities.some((e) => e.kind === 'drone' && e.owner === f.slot && e.life > 0)) {
        f[k] = Math.max(f[k], DRONE.cd);
        continue;
      }
      if (f[k] > 0 && !(f.state === 'attack' && f.move === id)) f[k]--;
    }
    if (f.armorCd > 0) f.armorCd--;
    if (f.powerBuff > 0) f.powerBuff--;
    if (f.confused > 0) f.confused--;
    for (let i = 0; i < f.bikeHitCd.length; i++) if (f.bikeHitCd[i] > 0) f.bikeHitCd[i]--;
    if (f.bike > 0) {
      f.bike--;
      // 自転車ごとジャンプしたときは、着地するまで乗ったまま
      if (f.grounded) f.bikeAir = false;
      if ((!f.grounded && !f.bikeAir) || f.state === 'hitstun' || f.state === 'shieldbreak' || f.state === 'sleep') f.bike = 0;
    }
    if (f.bike <= 0) f.bikeAir = false;
    // Ctrl+Z（ハッカー）：約2秒分の場所とダメージを記録する（やられている間・復活中は記録し直す）
    if (f.def.id === 'hacker') {
      if (!f.alive || f.state === 'respawn') f.rewindHist.length = 0;
      else {
        f.rewindHist.push(f.x, f.y, f.damage);
        if (f.rewindHist.length > REWIND.frames * 3) f.rewindHist.splice(0, f.rewindHist.length - REWIND.frames * 3);
      }
    }
    // 時間指定：走り続けるほど速くなる
    if (f.state === 'run' || f.bike > 0) f.runTime++;
    else f.runTime = 0;
    if (f.poison > 0) {
      f.poison--;
      if (f.alive && f.poison % POISON_TICK === 0) f.damage = Math.min(999, f.damage + 1);
    }

    if (f.state === 'dead') {
      if (f.out) return;
      if (this.hordeWaiting(f)) return;
      f.respawnTimer--;
      if (f.respawnTimer <= 0) this.respawn(f);
      return;
    }
    if (f.state === 'respawn') {
      const inp = f.input;
      if (f.stateTime > 150 || Math.abs(inp.mx) > 0.3 || Math.abs(inp.my) > 0.3 || inp.buttons) {
        this.setState(f, 'air');
        f.invuln = 120;
        f.grounded = false;
        f.vy = 0;
      }
      return;
    }
    if (f.state === 'ledge') {
      this.updateLedge(f);
      return;
    }
    if (f.state === 'grabbed') {
      this.updateGrabbed(f);
      return;
    }

    const inp = f.input;
    const d = f.def;
    const vxBefore = f.vx;

    this.updateState(f, inp, d);
    // 清掃タイム（24時間ジム）：台の床の上では、止まる・向きを変える力が弱くなる（走り出しや技の勢いはそのまま）
    if (f.grounded && f.groundRef === -1 && this.slippery()) {
      const dv = f.vx - vxBefore;
      if (vxBefore !== 0 && Math.sign(dv) !== Math.sign(vxBefore)) f.vx = vxBefore + dv * GYM_GRIP;
    }
  }

  /** ガチャ会場のルーレットが止まってから本番までの間だけ、当たり・ハズレのマスを返す（CPUがよけるため） */
  rouletteShown(): number[] | null {
    const ph = gimmickPhase(this.frame, !!this.setup.rules.gimmicks, this.stage.theme.kind, 'gacha');
    return ph >= ROULETTE.stopAt && ph < GIMMICK.warn ? this.gimmickTiles : null;
  }

  /** 24時間ジムの清掃タイム中（床がすべる）か */
  slippery(): boolean {
    return isSlippery(this.frame, !!this.setup.rules.gimmicks, this.stage.theme.kind);
  }

  private updateState(f: Fighter, inp: InputState, d: CharacterDef): void {
    switch (f.state) {
      case 'idle':
      case 'run':
        this.groundActions(f);
        break;
      case 'shield':
        this.shieldActions(f);
        break;
      case 'land':
        f.vx *= 0.8;
        if (f.stateTime >= f.stun) this.setState(f, 'idle');
        break;
      case 'air':
      case 'helpless':
        this.airActions(f);
        break;
      case 'attack':
        this.updateMove(f);
        break;
      case 'grab':
        this.updateGrab(f);
        break;
      case 'hitstun':
        f.hitstun--;
        if (!f.grounded) {
          f.vx *= HITSTUN_DRAG;
        } else {
          f.vx *= 0.85;
        }
        if (f.hitstun <= 0) {
          f.tumble = false;
          this.setState(f, f.grounded ? 'idle' : 'air');
          // ギリギリ耐えた：ふっとびが終わったところで踏んばって止まり、「セーフ」
          if (f.closeCall) {
            f.closeCall = 0;
            this.closeBrake(f);
            this.events.push({ k: 'safe', x: f.x, y: f.y + f.h / 2, s: f.slot });
          }
        }
        break;
      case 'shieldbreak':
        f.vx *= 0.85;
        f.stun--;
        if (f.stun <= 0 && f.grounded) this.setState(f, 'idle');
        break;
      case 'sleep':
        // 強制アップデート中：動けない
        f.vx *= 0.8;
        f.stun--;
        if (f.stun <= 0) this.setState(f, f.grounded ? 'idle' : 'air');
        break;
      case 'dodge': {
        const total = 22;
        if (f.dodgeDir !== 0 && f.stateTime < 16) f.vx = f.dodgeDir * 8;
        else f.vx *= 0.7;
        if (f.stateTime === 3) f.invuln = Math.max(f.invuln, 13);
        if (f.stateTime >= total) this.setState(f, 'idle');
        break;
      }
      case 'airdodge':
        if (f.stateTime === 2) f.invuln = Math.max(f.invuln, 18);
        f.vx *= 0.92;
        f.vy *= 0.92;
        if (f.stateTime >= 28) this.setState(f, 'air');
        break;
    }

    // 重力と移動
    if (!f.grounded) {
      const g = f.state === 'airdodge' && f.stateTime < 20 ? d.gravity * 0.25 : d.gravity;
      f.vy -= g * DT;
      const maxFall = f.state === 'hitstun' ? d.fallMax * 2 : f.fastFall ? d.fallMax * 1.5 : d.fallMax;
      if (f.vy < -maxFall) f.vy = -maxFall;
      // ハート風船（メンヘラ）のあとは、ゆっくり落ちる
      if (f.floatT > 0 && f.state !== 'hitstun' && f.vy < -MENHERA.floatFall) f.vy = -MENHERA.floatFall;
      if (f.shortHopArmed && !this.held(f, BTN_JUMP) && f.vy > 0 && f.stateTime < 10) {
        f.vy *= 0.55;
        f.shortHopArmed = false;
      }
      if (f.vy <= 0) f.shortHopArmed = false;
    }
    if (f.grounded && f.groundRef >= 0 && f.groundRef < ENTITY_GROUND) {
      const p = platformAt(this.stage.platforms[f.groundRef], this.frame);
      f.x += p.dx;
    }
    // ワープホールから出てきたところ：しばらくは左右にゆっくり動き、ゆっくり落ちる（攻撃でふっとんだら終わり）
    if (f.warpSlow > 0) {
      if (f.state === 'hitstun' || f.tumble) f.warpSlow = 0;
      else {
        f.vx = Math.max(-WARP.slowSpeed, Math.min(WARP.slowSpeed, f.vx));
        if (f.vy < -WARP.slowSpeed) f.vy = -WARP.slowSpeed;
      }
    }
    const prevX = f.x;
    const prevY = f.y;
    f.x += f.vx * DT;
    f.y += f.vy * DT;
    this.applyLeash(f);
    this.collide(f, prevX, prevY, inp);
  }

  /** Ctrl+Z（ハッカー）：記録のいちばん古い場所（約2秒前）へ戻り、その間に増えたダメージの半分を消す */
  private rewind(f: Fighter): void {
    const h = f.rewindHist;
    if (h.length < 3) return;
    const [x, y, dmg] = [h[0], h[1], h[2]];
    this.events.push({ k: 'rewind', x: f.x, y: f.y + f.h / 2, tx: x, ty: y + f.h / 2, s: f.slot });
    f.x = x;
    f.y = y;
    f.vx = 0;
    f.vy = 0;
    f.grounded = false;
    f.groundRef = -1;
    f.ledgeSide = 0;
    if (f.damage > dmg) f.damage = Math.max(0, f.damage - (f.damage - dmg) * REWIND.heal);
    f.invuln = Math.max(f.invuln, REWIND.invuln);
    h.length = 0;
  }

  /** 移動の速さの倍率（倍速再生・時間指定） */
  private speedMul(f: Fighter): number {
    let m = f.speedBuff > 0 ? SPEEDUP.speed : 1;
    if (f.def.id === 'courier') m *= 1 + Math.min(0.25, f.runTime / 240);
    // デレモード（メンヘラ）：少し速い
    if (f.dere > 0) m *= MENHERA.dereSpeed;
    return m;
  }

  /** 自転車に乗っている間の操作 */
  private bikeActions(f: Fighter): boolean {
    const inp = f.input;
    if (this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7)) {
      // 自転車ごとジャンプ（降りない。攻撃・必殺技・ガードで降りる）
      const vx = f.vx;
      this.jump(f);
      f.vx = vx;
      f.bikeAir = true;
      return true;
    }
    if (this.pressed(f, BTN_A) || this.pressed(f, BTN_B) || this.held(f, BTN_SHIELD)) {
      f.bike = 0; // 降りて、そのまま普通の行動へ
      return false;
    }
    if (inp.mx * f.facing < -0.5 && f.stateTime > 10) {
      f.facing = -f.facing;
      f.vx *= 0.3;
      this.setState(f, 'run');
    }
    const target = f.facing * BIKE.speed * this.speedMul(f);
    f.vx += (target - f.vx) * 0.1;
    if (f.state !== 'run') this.setState(f, 'run');
    return true;
  }

  private groundActions(f: Fighter): void {
    const inp = f.input;
    const d = f.def;
    if (f.bike > 0 && this.bikeActions(f)) return;
    if (this.held(f, BTN_SHIELD)) {
      if (this.pressed(f, BTN_A)) return this.startMove(f, 'grab');
      if (this.tryTaunt(f)) return;
      if (this.tryDodge(f)) return;
      this.setState(f, 'shield');
      return;
    }
    // ボタンを先に判定する（スティックを上にはじきながらBを押したときは、ジャンプではなく上必殺技）
    if (this.pressed(f, BTN_A)) return this.groundAttack(f);
    if (this.pressed(f, BTN_B)) return this.special(f);
    if (this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7)) {
      this.jump(f);
      return;
    }
    if (f.groundRef >= 0 && f.flickY <= 2 && inp.my < -0.7) {
      f.dropThrough = 14;
      f.grounded = false;
      f.groundRef = -1;
      f.y -= 0.05;
      this.setState(f, 'air');
      return;
    }
    const ax = Math.abs(inp.mx);
    const sm = this.speedMul(f);
    const target = ax > 0.65 ? inp.mx * d.runSpeed * sm : ax > 0.15 ? inp.mx * d.walkSpeed * sm : 0;
    f.vx += (target - f.vx) * (target === 0 ? 0.35 : 0.25);
    if (ax > 0.2) f.facing = inp.mx > 0 ? 1 : -1;
    const moving = Math.abs(f.vx) > 0.6 && ax > 0.15;
    if (moving && f.state !== 'run') this.setState(f, 'run');
    else if (!moving && f.state !== 'idle') this.setState(f, 'idle');
  }

  /** アピール：ガード中にスティックを上にはじく */
  private tryTaunt(f: Fighter): boolean {
    if (f.flickY <= 2 && f.input.my > 0.7 && Math.abs(f.input.mx) < 0.5) {
      this.startMove(f, 'taunt');
      return true;
    }
    return false;
  }

  private tryDodge(f: Fighter): boolean {
    const inp = f.input;
    if (f.flickX <= 3 && Math.abs(inp.mx) > 0.7) {
      f.dodgeDir = inp.mx > 0 ? 1 : -1;
      this.setState(f, 'dodge');
      return true;
    }
    if (f.flickY <= 3 && inp.my < -0.7) {
      f.dodgeDir = 0;
      this.setState(f, 'dodge');
      return true;
    }
    return false;
  }

  private shieldActions(f: Fighter): void {
    f.vx *= 0.8;
    if (!this.held(f, BTN_SHIELD)) {
      this.setState(f, 'idle');
      return;
    }
    if (this.pressed(f, BTN_A)) return this.startMove(f, 'grab');
    if (this.pressed(f, BTN_JUMP)) {
      this.jump(f);
      return;
    }
    if (this.tryTaunt(f)) return;
    if (this.tryDodge(f)) return;
    f.shield -= 0.14;
    if (f.shield <= 0) this.breakShield(f);
  }

  private breakShield(f: Fighter): void {
    f.shield = 0;
    f.bike = 0;
    this.setState(f, 'shieldbreak');
    f.stun = 150;
    f.vy = 11;
    f.grounded = false;
    f.groundRef = -1;
  }

  private jump(f: Fighter): void {
    f.vy = f.def.jumpV * this.jumpMul(f);
    f.grounded = false;
    f.groundRef = -1;
    f.shortHopArmed = this.held(f, BTN_JUMP);
    f.fastFall = false;
    this.setState(f, 'air');
    this.events.push({ k: 'jump', s: f.slot });
  }

  private airActions(f: Fighter): void {
    const inp = f.input;
    const d = f.def;
    const helpless = f.state === 'helpless';
    // 自転車ごとジャンプ中：攻撃・必殺技・ガードを押したら降りて、そのままその行動へ
    if (f.bike > 0 && (this.pressed(f, BTN_A) || this.pressed(f, BTN_B) || this.held(f, BTN_SHIELD))) f.bike = 0;
    if (!helpless) {
      // ボタンを先に判定する（上にはじきながらB → 上必殺技、上にはじきながらA → 上空中攻撃）
      if (this.pressed(f, BTN_A)) return this.airAttack(f);
      if (this.pressed(f, BTN_B)) return this.special(f);
      const wantJump = this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7);
      if (wantJump && f.jumpsLeft > 0) {
        f.jumpsLeft--;
        f.vy = d.airJumpV * this.jumpMul(f);
        f.fastFall = false;
        if (Math.abs(inp.mx) > 0.3) f.vx = inp.mx * d.airSpeed;
        this.setState(f, 'air');
        this.events.push({ k: 'jump', s: f.slot });
        return;
      }
      if (this.pressed(f, BTN_SHIELD) && !f.airDodgeUsed) {
        f.airDodgeUsed = true;
        const len = Math.hypot(inp.mx, inp.my);
        if (len > 0.4) {
          f.vx = (inp.mx / len) * 9;
          f.vy = (inp.my / len) * 9;
        } else {
          f.vx *= 0.3;
          f.vy = Math.max(f.vy, 0) * 0.3;
        }
        this.setState(f, 'airdodge');
        return;
      }
    }
    const accel = d.airAccel * (helpless ? 0.5 : 1);
    const maxV = d.airSpeed * (helpless ? 0.6 : 1) * (f.speedBuff > 0 ? SPEEDUP.speed : 1);
    if (Math.abs(inp.mx) > 0.15) {
      f.vx += inp.mx * accel * DT;
      if (Math.abs(f.vx) > maxV) f.vx = Math.sign(f.vx) * Math.max(maxV, Math.abs(f.vx) * 0.96);
    } else {
      f.vx *= 0.97;
    }
    if (!helpless && f.flickY <= 2 && inp.my < -0.7 && f.vy < 3) f.fastFall = true;
    this.tryLedgeGrab(f);
  }

  private groundAttack(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay > ax) return this.startMove(f, inp.my > 0 ? 'up' : 'down');
    if (ax > 0.5) {
      f.facing = inp.mx > 0 ? 1 : -1;
      return this.startMove(f, f.flickX <= 4 ? 'smash' : 'side');
    }
    this.startMove(f, 'jab');
  }

  private airAttack(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay >= ax) return this.startMove(f, inp.my > 0 ? 'uair' : 'dair');
    if (ax > 0.5) return this.startMove(f, Math.sign(inp.mx) === f.facing ? 'fair' : 'bair');
    this.startMove(f, 'nair');
  }

  private special(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay >= ax) {
      const id = inp.my > 0 ? 'uspecial' : 'dspecial';
      if (f[SPECIAL_CD[id]] > 0) return;
      // 上必殺技は、スティックを傾けた方向へ向き直る（斜めに飛ぶ技のため）
      if (inp.my > 0 && Math.abs(inp.mx) > 0.3) f.facing = inp.mx > 0 ? 1 : -1;
      return this.startMove(f, id);
    }
    if (ax > 0.5) {
      if (f.cdS > 0) return;
      if (!f.grounded && f.sideBUsed) return;
      f.facing = inp.mx > 0 ? 1 : -1;
      if (!f.grounded) f.sideBUsed = true;
      return this.startMove(f, 'sspecial');
    }
    if (f.cdN > 0) return;
    this.startMove(f, 'nspecial');
  }

  private startMove(f: Fighter, id: MoveId): void {
    // 飽き性（ドパガキ）：直前と違う技を続けて出すほど威力が上がる（同じ技を出すと元に戻る）。
    // つかみ攻撃・投げ・アピールは数えない
    if (f.def.id === 'dopa') {
      if (id !== 'pummel' && id !== 'taunt' && !this.isThrow(id)) {
        const last = f.recentMoves[f.recentMoves.length - 1];
        const streak = last === undefined || id === last ? 0 : Math.min(DOPA_STREAK_MAX, Math.round((f.stale - 1) / DOPA_STEP) + 1);
        f.stale = 1 + DOPA_STEP * streak;
        f.recentMoves.push(id);
        if (f.recentMoves.length > 5) f.recentMoves.shift();
      }
    } else f.stale = 1;
    if (id !== 'sspecial') f.chain = 0;
    f.redirected = false;
    f.ballHit = false;
    f.vaultHit = false;
    f.rushQueued = false;
    f.crit = false;
    f.tetherOn = false;
    // 学習で吸収していたら、この技が強くなる（吸収の構えそのものは除く）
    const md = moveOf(f.def.id, id, f.job);
    f.chargedMove = false;
    if (f.absorbCharge && md.special !== 'absorb' && (md.hitboxes.length > 0 || md.shots)) {
      f.chargedMove = true;
      f.absorbCharge = false;
    }
    // 必殺技の再使用の待ち時間（連打でハメられないように）
    // （キャッシュの罠は、置いたときではなく爆発したときから数える）
    if (id in SPECIAL_CD && md.cd && md.special !== 'trap') f[SPECIAL_CD[id as keyof typeof SPECIAL_CD]] = md.cd;
    f.move = id;
    f.moveFrame = 0;
    f.moveAim = f.input.my;
    f.moveHit = new Set();
    f.charge = 0;
    f.holdA = id === 'jab';
    this.setState(f, 'attack');
  }

  /** 攻撃側の威力の倍率（課金・バズり・飽き性・吸収・単発ガチャの大当たり） */
  private powerMul(a: Fighter): { dmg: number; kb: number } {
    let dmg = a.def.dmgMul * a.stale * (1 + 0.08 * a.buzz);
    // 飽き性の威力アップはダメージだけ（ふっとばしは上げない）
    let kb = a.def.kbMul;
    if (a.powerBuff > 0) {
      dmg *= PAY.dmg;
      kb *= PAY.kb;
    }
    // 早着替え（3B）：ジョブチェンジのあとしばらく強い
    if (a.jobBuff > 0) dmg *= THREEB_RULES.buffMul;
    // 緊急警報（警備員）
    if (a.alarmT > 0) dmg *= ALARM.dmg;
    if (a.chargedMove) {
      dmg *= 1.6;
      kb *= 1.2;
    }
    if (a.crit) {
      dmg *= 2.5;
      kb *= 1.8;
    }
    // かまってちゃん（メンヘラ）：病みモード中は強い
    if (a.def.id === 'menhera' && a.lonely >= MENHERA.lonely) {
      dmg *= MENHERA.yamiDmg;
      kb *= MENHERA.yamiKb;
    }
    // 赤い糸（メンヘラ）で相手とつながっている間は、攻撃力アップ
    if (a.def.id === 'menhera' && this.fighters.some((v) => v !== a && v.leashT > 0 && v.leashBy === a.slot)) dmg *= MENHERA.threadMul;
    // 泣き落とし（メンヘラ）で気まずいと、攻撃力が下がる
    if (a.awkward > 0) dmg *= MENHERA.cry.mul;
    return { dmg, kb };
  }

  /** メンヘラの技と特性の時間を進める（かまってちゃん・赤い糸・鬼電の爆発・気まずい・ハート風船） */
  private menheraTimers(f: Fighter): void {
    // 緊急警報（警備員）：ダメージが100%をこえたら警報が鳴り、しばらく攻撃力アップ（1ストックに1回）
    if (f.alarmT > 0) f.alarmT--;
    if (f.def.id === 'guard' && f.alive && !f.alarmUsed && f.damage >= ALARM.at && this.setup.rules.mode !== 'stamina') {
      f.alarmUsed = true;
      f.alarmT = ALARM.time;
      this.events.push({ k: 'alarm', s: f.slot, x: f.x, y: f.y + f.h + 0.4 });
    }
    if (f.def.id === 'menhera' && f.alive) {
      const wasYami = f.lonely >= MENHERA.lonely;
      if (f.lonely < MENHERA.lonely) f.lonely++;
      // 病みモードになった瞬間
      if (!wasYami && f.lonely >= MENHERA.lonely) this.events.push({ k: 'buff', s: f.slot });
    }
    if (f.dere > 0) f.dere--;
    if (f.dereCd > 0) f.dereCd--;
    if (f.heavyT > 0) f.heavyT--;
    if (f.awkward > 0) f.awkward--;
    if (f.floatT > 0 && (f.grounded || f.state === 'hitstun' || f.state === 'ledge')) f.floatT = 0;
    else if (f.floatT > 0) f.floatT--;
    if (f.leashT > 0) {
      const o = this.fighter(f.leashBy);
      // つないだ人がいなくなった・自分が撃墜された・強くふっとばされたら、糸は切れる
      if (!o || !o.alive || o.out || !f.alive || f.tumble) f.leashT = 0;
      else f.leashT--;
      // 糸が切れた：つながれている間に受けたダメージが一気に加わる
      if (f.leashT === 0) this.releaseLeashDamage(f);
    }
    if (f.callT > 0) {
      if (!f.alive) {
        f.callT = 0;
        return;
      }
      if (--f.callT === 0) this.callBoom(f);
    }
  }

  /** 重い愛のハート（深夜のワンルームのギミック）。ゆっくり落ちてきて、床を通りぬけて消える */
  heart: { x: number; y: number; vy: number; life: number } | null = null;

  /** ジャンプの高さの倍率（重い愛のハートで重いと低い） */
  private jumpMul(f: Fighter): number {
    return f.heavyT > 0 ? MENHERA.heavy.jump : 1;
  }

  private updateHeart(at: number): void {
    const H = MENHERA.heavy;
    const m = this.stage.main;
    if (at === 0) this.heart = { x: m.x1 + 1.5 + this.rng.next() * (m.x2 - m.x1 - 3), y: m.top + 9, vy: 0, life: H.life };
    const h = this.heart;
    if (!h) return;
    if (--h.life <= 0) {
      this.events.push({ k: 'poof', x: h.x, y: h.y + 0.5 });
      this.heart = null;
      return;
    }
    // ゆっくり落ちてくる。床や足場では止まらず、そのまま通りぬけて消えていく
    h.vy = -H.fall;
    h.y += h.vy * DT;
    if (h.y < m.top - 3) {
      this.heart = null;
      return;
    }
    const taker = this.fighters.find((v) => v.alive && !v.out && v.state !== 'grabbed' && circleHitsBox(h.x, h.y + 0.5, H.r, v));
    if (taker) {
      taker.heavyT = H.time;
      this.events.push({ k: 'heavy', s: taker.slot, x: h.x, y: h.y + 0.6 });
      this.heart = null;
    }
  }

  /** 自分が飛ばした爆音ソロ（3B・バンドマン）の音が、まだ残っているか */
  private soundAlive(f: Fighter): boolean {
    return this.projectiles.some((p) => p.owner === f.slot && p.kind === 'sound');
  }

  /** 攻撃力・スピードの上がり下がり（画面の目印用。どのキャラでも共通） */
  private buffBits(f: Fighter): number {
    const atkUp =
      f.powerBuff > 0 ||
      f.jobBuff > 0 ||
      f.alarmT > 0 ||
      f.absorbCharge ||
      f.buzz > 0 ||
      (f.def.id === 'menhera' && (f.lonely >= MENHERA.lonely || this.fighters.some((v) => v !== f && v.leashT > 0 && v.leashBy === f.slot)));
    return (atkUp ? FX_ATK_UP : 0) | (f.awkward > 0 ? FX_ATK_DOWN : 0) | (f.speedBuff > 0 || f.dere > 0 ? FX_SPD_UP : 0) | (f.heavyT > 0 ? FX_SPD_DOWN : 0);
  }

  /**
   * 赤い糸の時間：糸を投げたメンヘラ自身の%が高いほど短い。
   * （追い込まれたメンヘラが「どうせ落ちるから」と元気な相手を道連れにしにくくする。元気なうちの道連れは1機どうしの交換になる）
   */
  private leashFrames(owner: Fighter, base: number): number {
    const L = MENHERA.leashTime;
    return Math.round(base * Math.max(L.min, 1 - owner.damage * L.perPct));
  }

  /** 赤い糸が切れた：ためていたダメージを一気に加える */
  private releaseLeashDamage(f: Fighter): void {
    if (f.leashDmg <= 0) return;
    const d = f.leashDmg;
    f.leashDmg = 0;
    if (!f.alive) return;
    f.damage = Math.min(999, f.damage + d);
    this.events.push({ k: 'leashDmg', s: f.slot, x: f.x, y: f.y + f.h + 0.4, p: Math.round(d) });
    // 反動：ためたダメージの量に応じて、つないでいた人から離れる向きにふっとぶ（%はもう加えたので、ダメージは0）
    const o = this.fighter(f.leashBy);
    const r = MENHERA.recoil;
    const dir = o ? (f.x >= o.x ? 1 : -1) : -f.facing;
    if (f.state !== 'grabbed') this.knock(f, dir, 0, Math.min(r.maxBase, d * r.base), Math.min(r.maxGrowth, d * r.growth), r.angle, 1, o?.slot ?? -1);
  }

  /** 鬼電の爆発：着信音でダメージとふっとばし（ガード中なら盾が減るだけ） */
  private callBoom(v: Fighter): void {
    const o = this.fighter(v.callBy);
    const c = MENHERA.call;
    this.events.push({ k: 'ring', x: v.x, y: v.y + v.h + 0.3, s: v.slot });
    if (!o || v.invuln > 0 || v.state === 'grabbed') return;
    if (v.state === 'shield') {
      v.shield -= c.dmg * 1.3;
      this.events.push({ k: 'shield', x: v.x, y: v.y + v.h / 2 });
      if (v.shield <= 0) this.breakShield(v);
      return;
    }
    const pm = this.powerMul(o);
    const dir = v.x >= o.x ? 1 : -1;
    this.knock(v, dir, c.dmg * pm.dmg, c.base, c.growth, c.angle, pm.kb, o.slot);
    v.hitlag = 6;
    this.events.push({ k: 'hit', x: v.x, y: v.y + v.h, p: c.dmg, s: v.slot, a: o.slot });
  }

  /** 赤い糸：つないだ人から一定の距離より遠くへは行けない（離れる向きの勢いは消える） */
  private applyLeash(f: Fighter): void {
    if (f.leashT <= 0 || f.state === 'grabbed' || f.state === 'ledge') return;
    const o = this.fighter(f.leashBy);
    if (!o) return;
    // メンヘラがステージの外（台の真上ではない所）にいる間は、糸はゆるむ（相手を場外へ引きずり込めない）
    if (o.x < this.stage.main.x1 || o.x > this.stage.main.x2) return;
    const dx = f.x - o.x;
    const dy = f.y - o.y;
    const d = Math.hypot(dx, dy);
    const len = MENHERA.leashLen;
    if (d <= len || d < 0.001) return;
    const nx = dx / d;
    const ny = dy / d;
    f.x = o.x + nx * len;
    f.y = o.y + ny * len;
    const out = f.vx * nx + f.vy * ny;
    if (out > 0) {
      f.vx -= out * nx;
      f.vy -= out * ny;
    }
  }

  /** 泣き落とし：周りの相手を「気まずい」状態にする（攻撃力ダウン）。ガードで防げる */
  private cry(f: Fighter, md: MoveDef): void {
    this.events.push({ k: 'cry', x: f.x, y: f.y + f.h * 0.7, s: f.slot });
    const pm = this.powerMul(f);
    for (const v of this.fighters) {
      if (v === f || !v.alive || v.invuln > 0 || this.friendly(f.slot, v)) continue;
      if (Math.hypot(v.x - f.x, v.y + v.h / 2 - (f.y + f.h / 2)) > MENHERA.cry.range) continue;
      if (v.state === 'shield') {
        this.events.push({ k: 'shield', x: v.x, y: v.y + v.h / 2 });
        continue;
      }
      if (this.tryCounter(v, f, md.dmg * pm.dmg)) continue;
      const dir = v.x >= f.x ? 1 : -1;
      this.knock(v, dir, md.dmg * pm.dmg, md.base, md.growth, md.angle, pm.kb, f.slot);
      v.awkward = MENHERA.cry.time;
      this.events.push({ k: 'hit', x: v.x, y: v.y + v.h / 2, p: md.dmg, s: v.slot, a: f.slot });
    }
  }

  /** ガチャを引く：レア度 0=大外れ 1=回復 2=N 3=R 4=SR 5=SSR（天井つき） */
  private rollGacha(f: Fighter): number {
    if (f.pity >= PITY - 1) {
      f.pity = 0;
      return 5;
    }
    const r = this.rng.next();
    const g = GACHA_RATES;
    const rarity = r < g.ssr ? 5 : r < g.ssr + g.sr ? 4 : r < g.ssr + g.sr + g.r ? 3 : r < g.ssr + g.sr + g.r + g.n ? 2 : r < g.ssr + g.sr + g.r + g.n + g.heal ? 1 : 0;
    if (rarity === 5) f.pity = 0;
    else f.pity++;
    return rarity;
  }

  private gacha10(f: Fighter): void {
    const rarity = this.rollGacha(f);
    const sc = f.def.scale;
    this.events.push({ k: 'gacha', x: f.x, y: f.y + 2 * sc, s: f.slot, r: rarity });
    const shot = (kind: ShotKind, vy: number, dmg: number, base: number, growth: number, noFlinch = false) =>
      this.spawnShot(f, { at: 0, kind, x: 0.8, y: 1.0, vx: 13, vy, life: 45, r: 0.35, dmg, base, growth, angle: 38, noFlinch });
    switch (rarity) {
      case 5: {
        // SSR：周りを大爆発
        this.events.push({ k: 'boom', x: f.x, y: f.y + 0.9 * sc });
        for (const v of this.fighters) {
          if (v === f || !v.alive || v.invuln > 0 || this.friendly(f.slot, v)) continue;
          if (Math.hypot(v.x - f.x, v.y + v.h / 2 - (f.y + 0.9 * sc)) > 2.6) continue;
          const pm = this.powerMul(f);
          this.knock(v, v.x >= f.x ? 1 : -1, 18 * pm.dmg, 8, 14, 50, pm.kb, f.slot);
          v.hitlag = 8;
          this.events.push({ k: 'hit', x: v.x, y: v.y + v.h / 2, p: 18, s: v.slot, a: f.slot });
        }
        break;
      }
      case 4:
        for (const vy of [-2.5, 0, 2.5]) shot('gold', vy, 7, 5, 7);
        break;
      case 3:
        shot('gold', 0, 7, 5, 6);
        break;
      case 2:
        // N：石が1つ（当たっても相手はのけぞらない）
        shot('stone', 0, 3, 3, 3, true);
        break;
      case 1:
        f.damage = Math.max(0, f.damage - 15);
        this.events.push({ k: 'heal', x: f.x, y: f.y + 1.2, s: f.slot });
        break;
      default:
        // 大外れ（爆死）：自分にダメージ、少し目を回す
        f.damage = Math.min(999, f.damage + 4);
        this.events.push({ k: 'poof', x: f.x, y: f.y + 1.2 * sc });
        f.move = null;
        f.stun = 24;
        this.setState(f, 'sleep');
        break;
    }
  }

  // ------------------------------------------------------------------ アイテム（ルールでオン・オフ）
  /** 出していいアイテムの種類（ルールで選んだもの。なければ全部） */
  itemKinds(): number[] {
    const k = this.setup.rules.itemKinds;
    return Array.isArray(k) ? k.filter((x) => Number.isInteger(x) && x >= 0 && x < ITEMS.kinds) : Array.from({ length: ITEMS.kinds }, (_, i) => i);
  }

  private updateItems(): void {
    if (!this.setup.rules.items) return;
    const kinds = this.itemKinds();
    if (!kinds.length) return;
    const t = this.frame - COUNTDOWN_FRAMES;
    const interval = ITEMS.intervals[this.setup.rules.itemRate ?? 'mid'] ?? ITEMS.interval;
    if (t <= 0 || t % interval !== 0) return;
    if (this.entities.filter((e) => e.kind === 'item').length >= ITEMS.max) return;
    const m = this.stage.main;
    const x = m.x1 + 1 + this.rng.next() * (m.x2 - m.x1 - 2);
    const kind = kinds[Math.floor(this.rng.next() * kinds.length)];
    this.addEntity('item', -1, x, m.top + 9, ITEMS.life, kind);
  }

  /**
   * 乱入アイテム：試合に出ていない人が落とす（kind = アイテムの種類、x = 落とす横の位置）。
   * アイテムの「あり・なし」のルールに関係なく落とせる。落とせたら true
   */
  dropItem(kind: number, x: number): boolean {
    if (this.finished || this.frame <= COUNTDOWN_FRAMES) return false;
    // ルールで出さないことにしたアイテムは落とせない
    if (!this.itemKinds().includes(kind)) return false;
    const m = this.stage.main;
    const cx = Math.max(m.x1 + 1, Math.min(m.x2 - 1, x));
    this.addEntity('item', -1, cx, m.top + 9, ITEMS.life, ((kind % ITEMS.kinds) + ITEMS.kinds) % ITEMS.kinds);
    return true;
  }

  /**
   * アイテムの効果（0=おにぎり：回復 1=スニーカー：倍速 2=砂時計：ほかの人が止まる 3=お守り：無敵
   * 4=カイロ：攻撃力アップ 5=傘：ひるまない 6=メガホン：まわりを衝撃波で押し飛ばす）
   */
  private useItem(f: Fighter, kind: number): void {
    switch (kind) {
      case 0:
        f.damage = Math.max(0, f.damage - ITEMS.heal);
        break;
      case 1:
        f.speedBuff = SPEEDUP.duration;
        break;
      case 2:
        for (const v of this.fighters) if (v !== f && v.alive && !this.friendly(f.slot, v)) v.hitlag = Math.max(v.hitlag, ITEMS.freeze);
        break;
      case 3:
        f.invuln = Math.max(f.invuln, ITEMS.invuln);
        break;
      case 4:
        f.powerBuff = Math.max(f.powerBuff, ITEMS.power);
        break;
      case 5:
        f.armor = Math.max(f.armor, ITEMS.armor);
        break;
      case 6: {
        const cy = f.y + f.h / 2;
        this.events.push({ k: 'shout', x: f.x, y: cy });
        for (const v of this.fighters) {
          if (v === f || !v.alive || v.invuln > 0 || this.friendly(f.slot, v)) continue;
          if (Math.hypot(v.x - f.x, v.y + v.h / 2 - cy) > ITEMS.shoutR) continue;
          this.knock(v, v.x >= f.x ? 1 : -1, ITEMS.shoutDmg, ITEMS.shoutBase, ITEMS.shoutGrowth, 35, 1, f.slot);
          v.hitlag = 6;
          this.events.push({ k: 'hit', x: v.x, y: v.y + v.h / 2, p: ITEMS.shoutDmg, s: v.slot, a: f.slot });
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------------ ステージギミック（ルールでオン・オフ）
  private gimmickDir = 1;
  private gimmickX = 0;
  /** ガチャ会場のルーレットの結果（マスごとに 1 = 当たり、-1 = ハズレ、0 = なし） */
  private gimmickTiles: number[] = [];
  /** 深夜の金庫室：これから撃つレーザー（出る位置と向き） */
  private gimmickLasers: { x: number; y: number; vx: number; vy: number }[] = [];
  private updateGimmick(): void {
    if (!this.setup.rules.gimmicks) return;
    const kind = this.stage.theme.kind;
    if (kind === 'sky') return;
    const t = this.frame - COUNTDOWN_FRAMES - 300; // 始まって5秒後から
    if (t < 0) return;
    const ph = t % GIMMICK.interval;
    const m = this.stage.main;
    const cx = (m.x1 + m.x2) / 2;
    const w = m.x2 - m.x1;
    if (ph === 0) {
      // 予告
      this.gimmickDir = this.rng.next() < 0.5 ? 1 : -1;
      const alive = this.fighters.filter((f) => f.alive);
      const target = alive[Math.floor(this.rng.next() * alive.length)];
      this.gimmickX = kind === 'lab' && target ? target.x : cx;
      const y = kind === 'arcade' || kind === 'gym' ? m.top + 0.6 : m.top + 8;
      this.events.push({ k: 'warn', h: kind, x: this.gimmickX, y, d: this.gimmickDir });
      if (kind === 'gacha') {
        // 当たり床ルーレット：当たり・ハズレのマスを決めておく（ルーレットが止まったら見せる）
        const order = Array.from({ length: ROULETTE.tiles }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(this.rng.next() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        this.gimmickTiles = Array(ROULETTE.tiles).fill(0);
        order.slice(0, ROULETTE.win).forEach((i) => (this.gimmickTiles[i] = 1));
        order.slice(ROULETTE.win, ROULETTE.win + ROULETTE.lose).forEach((i) => (this.gimmickTiles[i] = -1));
      }
      if (kind === 'vault') {
        // レーザー：左右どちらかの外から、ばらばらの高さと角度で飛んでくる。通り道を先に見せる
        this.gimmickLasers = [];
        for (let i = 0; i < VAULT_LASER.count; i++) {
          const side = this.rng.next() < 0.5 ? -1 : 1;
          const x = side < 0 ? m.x1 - 5 : m.x2 + 5;
          // 上から下へ・下から上へ斜めに。台の真ん中の上（高さ0.5〜4m）を必ず通るように、出る高さを決める
          const ang = ((this.rng.next() * 2 - 1) * VAULT_LASER.angle * Math.PI) / 180;
          const dir = -side;
          const vx = Math.cos(ang) * VAULT_LASER.speed * dir;
          const vy = Math.sin(ang) * VAULT_LASER.speed;
          const yc = m.top + 0.5 + this.rng.next() * 3.5;
          const y0 = yc - (vy / vx) * (cx - x);
          this.gimmickLasers.push({ x, y: y0, vx, vy });
          this.events.push({ k: 'aim', x, y: y0, vx, vy, i });
        }
      }
      return;
    }
    // ルーレットが止まった：当たり・ハズレのマスを見せる（本番まで少し動ける時間がある）
    if (kind === 'gacha' && ph === ROULETTE.stopAt) this.events.push({ k: 'roulette', t: [...this.gimmickTiles] });
    if (ph < GIMMICK.warn) return;
    const shot = (kind2: ShotKind, x: number, y: number, vx: number, vy: number, gravity: number, life: number, r: number, dmg: number, base: number, growth: number, angle: number, pierce: boolean) => {
      this.projectiles.push({
        owner: -1, kind: kind2, x, y, vx, vy, gravity, life, dmg, base, growth, angle, r,
        hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [], pierce,
      });
    };
    const d = this.gimmickDir;
    const at = ph - GIMMICK.warn;
    switch (kind) {
      case 'rooftop':
        // 強風：3秒間、全員が横へ流される
        if (at < 180) {
          for (const f of this.fighters) {
            if (!f.alive || f.state === 'ledge' || f.state === 'grabbed') continue;
            f.x += d * (f.grounded ? 0.045 : 0.06);
          }
        }
        break;
      case 'vault':
        // レーザー：予告した通り道を、少しずつ間をあけて飛んでくる
        if (at % VAULT_LASER.gap === 0 && at / VAULT_LASER.gap < this.gimmickLasers.length) {
          const l = this.gimmickLasers[at / VAULT_LASER.gap];
          shot('laser', l.x, l.y, l.vx, l.vy, 0, 200, 0.42, 8, 6, 6, 70, true);
        }
        break;
      case 'room':
        // 重い愛のハート：大きなハートが1つ、ランダムな場所に降ってくる。触れた人はしばらく重くなる
        if (!this.solo) this.updateHeart(at);
        break;
      case 'arcade':
        // 床を走り抜けるスクーター
        if (at === 0) shot('scooter', d > 0 ? m.x1 - 6 : m.x2 + 6, m.top + 0.55, d * 17, 0, 0, 160, 0.6, 10, 7, 8, 45, true);
        break;
      case 'studio':
        // 視聴者リクエスト：5秒間、全員の大きさが変わる（予告の向き d：1 = でっかく、-1 = ちっちゃく）
        if (at === 0 || at === SIZE_REQ.time) {
          for (const f of this.fighters) {
            f.size = at === 0 ? (d > 0 ? 1 : 2) : 0;
            applySize(f);
          }
          this.events.push({ k: 'poof', x: cx, y: m.top + 1 });
        }
        break;
      case 'cyber':
        // ワープホール：毎回ランダムな2か所に出入口。くぐると、もう一方から出てくる（勢いはそのまま）
        if (at < WARP.time) {
          const spots = warpSpots(this.stage, this.setup.seed, this.frame);
          for (const f of this.fighters) {
            if (!f.alive || f.warpCd > 0 || f.state === 'grabbed' || f.state === 'ledge' || f.grabbing >= 0) continue;
            for (const [i, p] of spots.entries()) {
              if (Math.hypot(f.x - p.x, f.y + f.h / 2 - p.y) > WARP.r) continue;
              const o = spots[1 - i];
              this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot });
              f.x = o.x + (f.x - p.x);
              f.y = o.y + (f.y - p.y);
              // 空中の出入口から出たら落ちはじめる
              if (o.y > this.stage.main.top + 1.5) {
                f.grounded = false;
                f.groundRef = -1;
                if (f.state === 'idle' || f.state === 'run') this.setState(f, 'air');
              }
              f.warpCd = WARP.cd;
              // ゆっくり出てくる：勢いを落とし、しばらく速く動けない
              f.vx *= 0.2;
              f.vy = 0;
              f.warpSlow = WARP.slow;
              this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot, w: 1 });
              break;
            }
          }
        }
        break;
      case 'gacha':
        // 当たり床ルーレット：止まったときに台の床に立っている人は、当たりなら回復、ハズレなら小爆発
        if (at === 0) {
          const tw = w / ROULETTE.tiles;
          for (const f of this.fighters) {
            if (!f.alive || !f.grounded || f.groundRef !== -1) continue;
            const i = Math.max(0, Math.min(ROULETTE.tiles - 1, Math.floor((f.x - m.x1) / tw)));
            const r = this.gimmickTiles[i] ?? 0;
            if (r > 0) {
              f.damage = Math.max(0, f.damage - ROULETTE.heal);
              this.events.push({ k: 'heal', x: f.x, y: f.y + f.h, s: f.slot });
            } else if (r < 0 && f.invuln <= 0) {
              this.knock(f, 0, 9, 8, 7, 90, 1, -1);
              f.hitlag = 6;
              this.events.push({ k: 'boom', x: f.x, y: f.y + 0.3 });
              this.events.push({ k: 'hit', x: f.x, y: f.y + 0.3, p: 9, s: f.slot });
            }
          }
        }
        break;
      case 'timeline':
        // 上から降ってくる通知
        if (at % 12 === 0 && at < 72) {
          const x = m.x1 + this.rng.next() * w;
          shot('notif', x, m.top + 14, 0, -6, 0, 200, 0.4, 5, 4, 4, 80, false);
        }
        break;
      case 'livebar':
        // 照明が落ちる：見た目だけ（画面を暗くするのは renderer）
        break;
      case 'gym':
        // 清掃タイム：5秒間、台の床がすべる（slippery() で判定して、動きの計算で使う）
        break;
      case 'lab':
        // 予告した場所に、上から光線
        if (at === 0) for (const y of [0.6, 1.6, 2.6, 3.6]) shot('beam', this.gimmickX, m.top + y, 0, 0, 0, 22, 0.75, 8, 6, 7, 80, true);
        break;
    }
  }

  // ------------------------------------------------------------------ つかみ
  /** つかみの関係が崩れていたら（撃墜・被弾・眠りなど）両方を自由にする */
  private fixGrabs(): void {
    for (const a of this.fighters) {
      if (a.grabbing < 0) continue;
      const v = this.fighter(a.grabbing);
      const holding = a.alive && (a.state === 'grab' || (a.state === 'attack' && (a.move === 'pummel' || this.isThrow(a.move) || a.slamming > 0)));
      if (!v) {
        // 先行表示では相手がいないので、つかんでいるつもりのまま進める
        if (this.solo && holding) continue;
        a.grabbing = -1;
        if (a.state === 'grab') this.setState(a, 'idle');
        continue;
      }
      if (holding && v.alive && v.grabbedBy === a.slot && v.state === 'grabbed') continue;
      this.endGrab(a, v);
    }
    for (const v of this.fighters) {
      if (v.grabbedBy < 0) continue;
      const a = this.fighter(v.grabbedBy);
      if (!a) {
        if (this.solo && v.state === 'grabbed') continue;
        v.grabbedBy = -1;
        if (v.state === 'grabbed') this.setState(v, v.grounded ? 'idle' : 'air');
        continue;
      }
      if (a.grabbing !== v.slot) {
        v.grabbedBy = -1;
        if (v.state === 'grabbed') this.setState(v, v.grounded ? 'idle' : 'air');
      }
    }
  }

  private isThrow(m: MoveId | null): boolean {
    return m === 'fthrow' || m === 'bthrow' || m === 'uthrow' || m === 'dthrow';
  }

  /** つかみを終える（相手を少し押し離す） */
  private endGrab(a: Fighter, v: Fighter | undefined, push = false): void {
    a.grabbing = -1;
    a.slamming = 0;
    if (a.state === 'grab') this.setState(a, 'idle');
    if (!v) return;
    if (v.grabbedBy === a.slot) v.grabbedBy = -1;
    if (v.state === 'grabbed') {
      this.setState(v, v.grounded ? 'idle' : 'air');
      if (push) {
        v.vx = a.facing * 6;
        a.vx = -a.facing * 3;
        v.invuln = Math.max(v.invuln, 10);
      }
    }
  }

  /** つかみが当たった：相手をつかむ */
  private startGrab(a: Fighter, v: Fighter): void {
    if (v.grabbing >= 0) this.endGrab(v, this.fighter(v.grabbing));
    a.move = null;
    a.grabbing = v.slot;
    a.grabTimer = Math.min(GRAB.max, Math.round(GRAB.base + v.damage * GRAB.perDamage));
    a.vx = 0;
    this.setState(a, 'grab');
    v.grabbedBy = a.slot;
    v.move = null;
    v.bike = 0;
    v.charge = 0;
    v.hitstun = 0;
    v.vx = 0;
    v.vy = 0;
    v.facing = -a.facing;
    v.lastHitBy = a.slot;
    v.lastHitFrame = this.frame;
    this.setState(v, 'grabbed');
    this.placeGrabbed(a, v);
    a.hitlag = v.hitlag = 4;
    this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: 1, s: v.slot, a: a.slot });
  }

  /** つかまれている人を、つかんでいる人の前に置く */
  private placeGrabbed(a: Fighter, v: Fighter): void {
    // マッスルジャンプ中は、頭の上にかかえる
    v.x = a.slamming > 0 ? a.x + a.facing * 0.2 : a.x + a.facing * 0.85 * a.def.scale;
    v.y = a.slamming > 0 ? a.y + a.h * 0.75 : a.y;
    v.vx = 0;
    v.vy = 0;
    v.grounded = a.grounded;
    v.groundRef = a.groundRef;
  }

  /** つかんでいる間：Aでつかみ攻撃、スティックの方向へ投げる */
  private updateGrab(a: Fighter): void {
    const v = a.grabbing >= 0 ? this.fighter(a.grabbing) : undefined;
    a.vx *= 0.7;
    if (!a.grounded) return this.endGrab(a, v);
    a.grabTimer--;
    if (a.grabTimer <= 0) return this.endGrab(a, v, true);
    const inp = a.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    // つかんだ瞬間にスティックが倒れていても、少しだけ待ってから投げる（つかみ攻撃をする余裕を作る）
    if (a.stateTime >= 6 && (ax > 0.6 || ay > 0.6)) {
      const id: MoveId = ay > ax ? (inp.my > 0 ? 'uthrow' : 'dthrow') : inp.mx * a.facing > 0 ? 'fthrow' : 'bthrow';
      return this.startMove(a, id);
    }
    if (this.pressed(a, BTN_A) && a.stateTime >= GRAB.pummelGap) return this.startMove(a, 'pummel');
  }

  /** つかまれている間：ボタンやスティックでもがくと早く抜けられる */
  private updateGrabbed(v: Fighter): void {
    const a = v.grabbedBy >= 0 ? this.fighter(v.grabbedBy) : undefined;
    if (!a) return; // 先行表示（相手がいない）
    this.placeGrabbed(a, v);
    if (v.input.buttons & ~v.prevButtons || v.flickX === 0 || v.flickY === 0) a.grabTimer -= GRAB.mash;
  }

  /** つかみ攻撃・投げの、技が出る瞬間の処理 */
  private grabMoveHit(a: Fighter, md: MoveDef): void {
    const v = a.grabbing >= 0 ? this.fighter(a.grabbing) : undefined;
    const pm = this.powerMul(a);
    if (md.special === 'pummel') {
      if (!v) return;
      const before = v.damage;
      let dmg = md.dmg * pm.dmg;
      if (v.def.id === 'ai' && a.slot < v.learnHits.length) dmg *= 1 - 0.05 * Math.min(5, v.learnHits[a.slot]);
      v.damage = Math.min(999, v.damage + dmg);
      this.lifesteal(a, v.damage - before);
      v.lastHitBy = a.slot;
      v.lastHitFrame = this.frame;
      a.hitlag = v.hitlag = 4;
      this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: 3, s: v.slot, a: a.slot });
      return;
    }
    // 投げ：後ろ投げは振り向いてから投げる
    if (a.move === 'bthrow') a.facing = -a.facing;
    a.grabbing = -1;
    if (!v) return;
    a.throws++;
    v.grabbedBy = -1;
    this.placeGrabbed(a, v);
    const before = v.damage;
    // 筋肉は裏切らない（トレーナー）：投げが強い
    const tm = a.def.id === 'trainer' ? TRAINER.throwMul : 1;
    this.knock(v, a.facing, md.dmg * pm.dmg * tm, md.base, md.growth, md.angle, pm.kb * (1 + (tm - 1) * 0.5), a.slot);
    this.lifesteal(a, v.damage - before);
    a.hitlag = v.hitlag = 5;
    this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: md.dmg, s: v.slot, a: a.slot });
  }

  /** 崖をつかむ（API呼び出しでも使う） */
  private grabLedge(f: Fighter, side: number): void {
    const m = this.stage.main;
    const ex = side < 0 ? m.x1 : m.x2;
    f.move = null;
    this.setState(f, 'ledge');
    f.ledgeSide = side;
    f.facing = -side;
    f.x = ex + side * 0.45;
    f.y = m.top - 1.75 * f.def.scale;
    f.vx = 0;
    f.vy = 0;
    f.invuln = Math.max(f.invuln, 50);
    f.jumpsLeft = f.def.airJumps;
    f.sideBUsed = false;
    f.airDodgeUsed = false;
    f.fastFall = false;
    f.tetherOn = false;
  }

  /** その選手が今出している技のデータ */
  private moveDef(f: Fighter): MoveDef {
    return moveOf(f.def.id, f.move!, f.job);
  }

  private updateMove(f: Fighter): void {
    const md = this.moveDef(f);
    const t = moveTiming(md, f);
    const inp = f.input;

    if (!this.held(f, BTN_A)) f.holdA = false;
    // スマッシュ攻撃・溜め攻撃の溜め（Aを押し続けている間）
    const maxCharge = md.special === 'smash' ? 60 : md.special === 'charge' ? CHARGE.max : md.special === 'curl' ? TRAINER.curlMax : 0;
    const chargeBtn = md.special === 'curl' ? BTN_B : BTN_A;
    if (maxCharge && f.moveFrame === t.s - 3 && this.held(f, chargeBtn) && f.charge < maxCharge) {
      f.charge++;
      // 溜め攻撃は、溜めている間に振り向ける
      if (md.special === 'charge' && Math.abs(inp.mx) > 0.5) f.facing = inp.mx > 0 ? 1 : -1;
    } else {
      f.moveFrame++;
    }
    const mf = f.moveFrame;
    const sc = f.def.scale;
    // 連続ヒットする技：技が進んだときだけ、一定フレームごとに同じ相手へもう一度当たれるようにする
    // （ヒットストップ中に同じフレームのまま何度も当たり続けないように）
    if (md.rehit && mf > t.s && (mf - t.s) % md.rehit === 0) f.moveHit.clear();

    // 飛び道具（技ごとに決まったフレームで出す）
    if (md.shots) for (const spec of md.shots) if (mf === t.s + spec.at) this.spawnShot(f, spec);

    if (mf === t.s) {
      switch (md.special) {
        case 'slam':
        case 'recovery':
          f.vy = md.riseV ?? 15;
          f.vx = md.riseVx ? f.facing * md.riseVx + inp.mx * 1.5 : inp.mx * 3;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'platform':
          // ポップアップ広告：足元に窓（一時的な足場）を出して上昇
          this.removeEntities(f.slot, 'popup');
          this.addEntity('popup', f.slot, f.x, f.y - 0.05, POPUP.life);
          f.vy = md.riseV ?? 15;
          f.vx = inp.mx * 3;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'wall':
          this.removeEntities(f.slot, 'wall');
          this.addEntity('wall', f.slot, f.x + f.facing * WALL.offset * sc, f.y, WALL.life);
          break;
        case 'trap':
          this.removeEntities(f.slot, 'trap');
          this.addEntity('trap', f.slot, f.x + f.facing * 0.5 * sc, f.y, TRAP.life);
          break;
        case 'recommend': {
          // あなたへのおすすめ（ドパガキ）：いちばん近い相手の目の前へ瞬間移動（届かなければ、その場で一撃）
          let best: Fighter | null = null;
          let bestD = RECOMMEND.range;
          for (const v of this.fighters) {
            if (v === f || !v.alive || v.out || this.friendly(f.slot, v) || v.state === 'respawn') continue;
            const d = Math.hypot(v.x - f.x, v.y - f.y);
            if (d <= bestD) {
              bestD = d;
              best = v;
            }
          }
          if (best) {
            this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot });
            const side = f.x <= best.x ? -1 : 1;
            f.x = best.x + side * 0.9 * sc;
            f.y = best.y;
            f.facing = -side;
            f.vx = 0;
            f.vy = 0;
            f.grounded = best.grounded;
            f.groundRef = best.groundRef;
            this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot, w: 1 });
          }
          break;
        }
        case 'teleport': {
          this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot });
          f.x += f.facing * 3;
          if (!f.grounded) f.vy = 0;
          break;
        }
        case 'invis':
          f.invuln = Math.max(f.invuln, md.active);
          break;
        case 'dash':
          if (!f.grounded) f.vy = Math.max(f.vy, 1.5);
          this.events.push({ k: 'flash', x: f.x, y: f.y + 0.9 * sc, s: f.slot });
          break;
        case 'scroll':
          if (!f.grounded) f.vy = Math.max(f.vy, 1);
          break;
        case 'armor':
          // プロテイン：待ち時間が終わっていれば飲める
          if (f.armorCd <= 0) {
            f.armor = TRAINER.armor;
            f.armorCd = TRAINER.armor + TRAINER.armorCooldown;
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'tackle':
          if (!f.grounded) f.vy = Math.max(f.vy, 1.5);
          break;
        case 'jobchange':
          // ジョブチェンジ：美容師 → バンドマン → バーテンダー の順に着替える
          if (f.jobCd <= 0) {
            // Bの待ち時間は仕事ごとに別々：今の仕事の分をしまって、次の仕事の分を出す
            f.jobCdN = f.jobCdN.map((c, j) => (j === f.job ? f.cdN : c));
            f.job = (f.job + 1) % 3;
            f.cdN = f.jobCdN[f.job];
            applySize(f);
            f.jobBuff = THREEB_RULES.buff;
            f.jobCd = THREEB_RULES.cooldown;
            this.events.push({ k: 'poof', x: f.x, y: f.y + 0.9 * sc });
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'dive':
          // ステージダイブ：前へ飛び込む
          f.vx = f.facing * 10;
          f.vy = Math.max(f.vy, 7);
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'speedup':
          if (f.speedCd <= 0) {
            f.speedBuff = SPEEDUP.duration;
            f.speedCd = SPEEDUP.duration + SPEEDUP.cooldown;
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'balloon':
          // ハート風船：ふわっと上昇。上昇のあとはしばらくゆっくり落ちる
          f.vy = md.riseV ?? 13;
          f.vx = inp.mx * 2.5;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          f.floatT = (md.startup + md.active + md.end) + MENHERA.float;
          break;
        case 'cry':
          this.cry(f, md);
          break;
        case 'redirect':
          f.vy = md.riseV ?? 15;
          f.vx = 0;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'gacha10':
          this.gacha10(f);
          if (f.state === 'sleep') return;
          break;
        case 'gacha1': {
          // 単発ガチャ：5回に1回、大当たり（天井つき）
          if (f.pity >= PITY - 1 || this.rng.next() < GACHA1_CRIT) {
            f.crit = true;
            f.pity = 0;
          } else f.pity++;
          this.events.push({ k: 'gacha', x: f.x, y: f.y + 2 * sc, s: f.slot, r: f.crit ? 5 : 2 });
          break;
        }
        case 'rewind':
          this.rewind(f);
          break;
        case 'pay':
          // 効果中にもう一度使っても何も起きない（%も増えない）
          if (f.powerBuff <= 0) {
            f.damage = Math.min(999, f.damage + PAY.cost);
            f.powerBuff = PAY.duration;
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'bike':
          if (f.grounded) {
            f.bike = BIKE.duration;
            f.bikeHp = BIKE.hp;
            f.bikeHitCd.fill(0);
          }
          break;
        case 'food':
          if (!this.entities.some((e) => e.owner === f.slot && e.kind === 'food')) {
            this.addEntity('food', f.slot, f.x + f.facing * 0.6 * sc, f.y, FOOD.life);
          }
          break;
        case 'swap': {
          // なりすまし：いちばん近い相手と位置を入れ替える
          let target: Fighter | null = null;
          let best: number = SWAP.range;
          for (const v of this.fighters) {
            if (v === f || !v.alive || v.invuln > 0 || v.state === 'ledge' || this.friendly(f.slot, v)) continue;
            const d = Math.hypot(v.x - f.x, v.y - f.y);
            if (d < best) {
              best = d;
              target = v;
            }
          }
          if (target) {
            const keys = ['x', 'y', 'vx', 'vy', 'grounded', 'groundRef'] as const;
            const mine = keys.map((k) => f[k]);
            this.events.push({ k: 'swap', x: f.x, y: f.y, x2: target.x, y2: target.y, s: f.slot });
            keys.forEach((k, i) => ((f as unknown as Record<string, unknown>)[k] = target![k]));
            keys.forEach((k, i) => ((target as unknown as Record<string, unknown>)[k] = mine[i]));
            target.hitlag = Math.max(target.hitlag, SWAP.freeze);
            if (!target.grounded && target.state === 'idle') this.setState(target, 'air');
          }
          break;
        }
        case 'drone':
          // エージェント起動：AIドローンを呼び出す（1機まで。いる間と、消えてから DRONE.cd は呼べない）
          if (this.entities.some((e) => e.kind === 'drone' && e.owner === f.slot && e.life > 0)) break;
          this.addEntity('drone', f.slot, f.x - f.facing * 0.8, f.y + 2.2 * sc, DRONE.life, f.facing);
          break;
        case 'pull': {
          // 通知爆撃：周りの相手を自分のほうへ引き寄せる
          const pm = this.powerMul(f);
          for (const v of this.fighters) {
            if (v === f || !v.alive || v.invuln > 0 || this.friendly(f.slot, v)) continue;
            const dx = f.x - v.x;
            const dy = f.y - v.y;
            const d = Math.hypot(dx, dy);
            if (d > PULL.range || d < 0.01) continue;
            if (v.state === 'shield') continue; // ガードしていれば引き寄せられない
            if (this.tryCounter(v, f, md.dmg * pm.dmg)) continue;
            const before = v.damage;
            v.damage = Math.min(999, v.damage + md.dmg * pm.dmg);
            this.lifesteal(f, v.damage - before);
            const sp = Math.min(PULL.speed, d * 4);
            v.vx = (dx / d) * sp;
            v.vy = Math.max((dy / d) * sp, 3);
            v.grounded = false;
            v.groundRef = -1;
            v.move = null;
            v.bike = 0;
            v.hitstun = 18;
            v.tumble = false;
            v.lastHitBy = f.slot;
            v.lastHitFrame = this.frame;
            this.setState(v, 'hitstun');
            this.events.push({ k: 'pull', x: v.x, y: v.y + v.h / 2, tx: f.x, ty: f.y + f.h / 2 });
          }
          break;
        }
        case 'decoy':
          this.removeEntities(f.slot, 'decoy');
          this.addEntity('decoy', f.slot, f.x, f.y, DECOY.life, f.facing);
          f.x -= f.facing * 0.8; // 本人は少し下がる
          break;
        case 'tether': {
          // いちばん近い崖に、届けばワイヤーを伸ばす
          const m = this.stage.main;
          let best = 0; // 0 = 届く崖がない、-1 = 左の崖、1 = 右の崖
          let bestD = TETHER.range;
          for (const side of [-1, 1]) {
            const ex = side < 0 ? m.x1 : m.x2;
            const outside = (f.x - ex) * side > -0.3;
            const d = Math.hypot(ex - f.x, m.top - (f.y + 1));
            if (outside && d < bestD && !this.fighters.some((o) => o !== f && o.state === 'ledge' && o.ledgeSide === side)) {
              best = side;
              bestD = d;
            }
          }
          if (best !== 0) {
            f.tetherOn = true;
            f.tetherX = best < 0 ? m.x1 : m.x2;
            f.tetherY = m.top;
          } else {
            f.vy = Math.max(f.vy, md.riseV ?? 7);
          }
          f.grounded = false;
          f.groundRef = -1;
          break;
        }
      }
    }
    // 無限スクロール：途中でBを押し直すと、最大3回まで続けて滑る
    // シザーラッシュ：途中でBを押すと、もう一度切り続ける（最大2回）。終わりに決めの一撃
    if (md.special === 'rush' && mf >= t.s && mf < t.s + t.a) {
      if (f.chain < THREEB_RULES.rushChain && this.pressed(f, BTN_B)) f.rushQueued = true;
      if (mf === t.s + t.a - 1 && f.rushQueued) {
        f.rushQueued = false;
        f.chain++;
        f.moveFrame = t.s;
      }
    }
    if (md.special === 'rush' && mf === t.s + t.a) this.rushFinish(f, md);
    if (md.special === 'scroll' && f.chain < 2 && mf >= t.s + 3 && this.pressed(f, BTN_B)) {
      f.chain++;
      if (Math.abs(inp.mx) > 0.5) f.facing = inp.mx > 0 ? 1 : -1;
      f.moveFrame = t.s - 1;
      f.moveHit.clear();
      return;
    }
    // 次の動画へ：途中でもう一度Bを押すと、スティックの方向へ向きを変える
    if (md.special === 'redirect' && !f.redirected && mf > t.s + 3 && mf < t.s + t.a && this.pressed(f, BTN_B)) {
      const len = Math.hypot(inp.mx, inp.my);
      const dx = len > 0.3 ? inp.mx / len : 0;
      const dy = len > 0.3 ? inp.my / len : 1;
      f.vx = dx * 16;
      f.vy = dy * 16;
      if (Math.abs(dx) > 0.2) f.facing = dx > 0 ? 1 : -1;
      f.redirected = true;
      this.events.push({ k: 'flash', x: f.x, y: f.y + 0.9 * sc, s: f.slot });
    }
    // API呼び出し：ワイヤーで崖へ引き寄せる
    if (md.special === 'tether' && f.tetherOn && mf >= t.s) {
      const tx = f.tetherX + (f.tetherX < 0 ? -0.45 : 0.45);
      const ty = f.tetherY - 1.75 * sc;
      const dx = tx - f.x;
      const dy = ty - f.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.9) {
        this.grabLedge(f, f.tetherX < 0 ? -1 : 1);
        return;
      }
      f.vx = (dx / d) * TETHER.speed;
      f.vy = (dy / d) * TETHER.speed;
    }
    const active = mf >= t.s && mf < t.s + t.a;
    // マッスルジャンプ：つかんだまま真下へ落ちる。地面に着いたら叩きつける（land で処理）
    if (f.slamming > 0) {
      f.slamming--;
      f.vx = 0;
      f.vy = -TRAINER.slamFall;
      f.moveFrame = Math.min(f.moveFrame, t.s + t.a - 1);
      const v = f.grabbing >= 0 ? this.fighter(f.grabbing) : undefined;
      if (v) this.placeGrabbed(f, v);
      if (f.slamming === 0) {
        // 長く落ちすぎたら（場外など）、相手を放す
        this.endGrab(f, v);
        if (v) {
          v.vy = 8;
          v.invuln = Math.max(v.invuln, 10);
        }
      }
      return;
    }
    if (md.special === 'dive' && active) {
      f.vx = f.facing * 10;
    } else if (md.special === 'rush' && active) {
      // シザーラッシュ：切りながら少しずつ前へ（相手を逃がさない）
      f.vx = f.facing * 1.6;
      if (!f.grounded) f.vy = Math.max(f.vy, -1);
    } else if ((md.special === 'dash' || md.special === 'scroll' || md.special === 'tackle' || md.special === 'slide') && active) {
      f.vx = f.facing * ((md.dashSpeed ?? 13) - (mf - t.s) * 0.4);
      if (!f.grounded) f.vy = Math.max(f.vy, -1);
    } else if ((md.special === 'redirect' && active) || (md.special === 'tether' && f.tetherOn)) {
      // 速さは技の処理で決めている
    } else if ((md.special === 'recovery' || md.special === 'platform' || md.special === 'slam') && active) {
      if (!md.riseVx) {
        f.vx += inp.mx * 0.4;
        f.vx = Math.max(-4, Math.min(4, f.vx));
      }
    } else if (f.grounded) {
      f.vx *= 0.8;
    } else if (Math.abs(inp.mx) > 0.15) {
      f.vx += inp.mx * f.def.airAccel * 0.6 * DT;
      if (Math.abs(f.vx) > f.def.airSpeed) f.vx = Math.sign(f.vx) * f.def.airSpeed;
    }
    if (!f.grounded && f.flickY <= 2 && inp.my < -0.7 && f.vy < 3 && md.air && !md.helpless) f.fastFall = true;

    if (md.special === 'taunt' && mf === t.s) this.events.push({ k: 'taunt', s: f.slot, i: this.frame % 3 });
    // つかみ攻撃・投げ
    if (md.special === 'pummel' || md.special === 'throw') {
      if (md.special === 'pummel') f.grabTimer--;
      if (mf === t.s) this.grabMoveHit(f, md);
      if (f.grabbing >= 0) {
        const v = this.fighter(f.grabbing);
        if (v) this.placeGrabbed(f, v);
      }
    }
    if (mf >= t.s + t.a + t.e) {
      // つかみ攻撃のあとは、まだつかんでいる
      if (md.special === 'pummel' && f.grabbing >= 0) {
        f.move = null;
        this.setState(f, 'grab');
        f.stateTime = GRAB.pummelGap;
        if (f.grabTimer <= 0) this.endGrab(f, this.fighter(f.grabbing), true);
        return;
      }
      // 弱攻撃のあともAを押し続けていたら、溜め攻撃に移る
      if (f.move === 'jab' && f.holdA && f.grounded && f.state === 'attack') {
        this.startMove(f, 'charge');
        return;
      }
      f.move = null;
      if (md.helpless && !f.grounded) this.setState(f, 'helpless');
      else this.setState(f, f.grounded ? 'idle' : 'air');
    }
    if (!f.grounded && f.state === 'helpless') this.tryLedgeGrab(f);
  }

  private spawnShot(f: Fighter, spec: ShotSpec): void {
    const s = f.def.scale;
    // 配達バッグは1つまで（戻ってくるまで投げられない）
    if (spec.boomerang && this.projectiles.some((p) => p.owner === f.slot && p.boomerang)) return;
    const pm = { ...this.powerMul(f) };
    // 爆音ソロ（3B・バンドマン）：Bを押し続けて溜めた分だけ、音が遠くまで飛ぶ。そのかわり威力は下がり、
    // 一定の距離より遠くでは当たっても相手はのけぞらない
    let life = spec.life;
    let flinchAge = 0;
    if (f.move && this.moveDef(f).special === 'curl' && spec.kind === 'sound') {
      const c = f.charge / TRAINER.curlMax;
      life = Math.round(spec.life * (1 + c * (THREEB_RULES.soundRange - 1)));
      pm.dmg *= 1 - c * (1 - THREEB_RULES.soundFarDmg);
      flinchAge = Math.max(1, Math.round(((THREEB_RULES.soundFlinch - spec.x * s) / spec.vx) * 60));
    }
    this.projectiles.push({
      owner: f.slot,
      kind: spec.kind,
      x: f.x + f.facing * spec.x * s,
      y: f.y + spec.y * s,
      vx: f.facing * spec.vx,
      vy: spec.vy,
      gravity: spec.gravity ?? 0,
      life,
      dmg: spec.dmg * pm.dmg,
      base: spec.base,
      growth: spec.growth,
      angle: spec.angle,
      r: spec.r,
      hitstunMul: spec.hitstunMul ?? 1,
      noFlinch: spec.noFlinch,
      flinchAge,
      poison: spec.poison ?? 0,
      confuse: spec.confuse ?? 0,
      homing: spec.homing ?? 0,
      boomerang: spec.boomerang ?? 0,
      age: 0,
      returning: false,
      hits: [],
      leash: spec.leash,
      call: spec.call,
    });
    this.events.push({ k: 'shot', s: f.slot });
  }

  private addEntity(kind: Entity['kind'], owner: number, x: number, y: number, life: number, dir = 1): void {
    this.entities.push({ id: this.nextEntityId++, kind, owner, x, y, vy: 0, life, age: 0, dir });
  }

  private removeEntities(owner: number, kind: Entity['kind']): void {
    this.entities = this.entities.filter((e) => !(e.owner === owner && e.kind === kind));
  }

  /** 壁・罠・一時的な足場を進める */
  private updateEntities(): void {
    const m = this.stage.main;
    const keep: Entity[] = [];
    for (const e of this.entities) {
      e.life--;
      e.age++;
      if (e.life <= 0) continue;
      if (e.kind === 'item') {
        // アイテム：落ちてきて床に止まり、触れた人が拾う
        const prevY = e.y;
        e.vy = Math.max(-12, e.vy - 25 * DT);
        e.y += e.vy * DT;
        if (e.x >= m.x1 && e.x <= m.x2 && prevY >= m.top && e.y <= m.top) {
          e.y = m.top;
          e.vy = 0;
        }
        for (const sp of this.stage.platforms) {
          const p = platformAt(sp, this.frame);
          if (e.x >= p.x1 && e.x <= p.x2 && prevY >= p.prevY - 0.001 && e.y <= p.y) {
            e.y = p.y;
            e.vy = 0;
          }
        }
        if (e.y < this.stage.blast.bottom) continue;
        const taker = this.fighters.find((v) => v.alive && v.state !== 'grabbed' && circleHitsBox(e.x, e.y + 0.35, 0.55, v));
        if (taker) {
          this.useItem(taker, e.dir);
          this.events.push({ k: 'item', s: taker.slot, t: e.dir, x: e.x, y: e.y + 0.4 });
          continue;
        }
        keep.push(e);
        continue;
      }
      if (e.kind === 'trap' || e.kind === 'food' || e.kind === 'decoy') {
        // 罠・料理・分身：地面まで落ちる
        const onMain = e.x >= m.x1 && e.x <= m.x2 && Math.abs(e.y - m.top) < 0.01;
        if (!onMain) {
          const prevY = e.y;
          e.vy -= 30 * DT;
          e.y += e.vy * DT;
          if (e.x >= m.x1 && e.x <= m.x2 && prevY >= m.top && e.y <= m.top) {
            e.y = m.top;
            e.vy = 0;
          }
          for (const sp of this.stage.platforms) {
            const p = platformAt(sp, this.frame);
            if (e.x >= p.x1 && e.x <= p.x2 && prevY >= p.prevY - 0.001 && e.y <= p.y) {
              e.y = p.y;
              e.vy = 0;
            }
          }
          if (e.y < this.stage.blast.bottom) continue;
        }
        if (e.kind === 'food') {
          // 置き配：誰でも拾える（置いた本人は少し時間がたってから）
          const eater = this.fighters.find(
            (v) => v.alive && (v.slot !== e.owner || e.age >= FOOD.selfDelay) && circleHitsBox(e.x, e.y + 0.3, FOOD.r, v),
          );
          if (eater) {
            eater.damage = Math.max(0, eater.damage - FOOD.heal);
            this.events.push({ k: 'heal', x: eater.x, y: eater.y + eater.h, s: eater.slot });
            continue;
          }
        } else if (e.kind === 'trap' && e.age >= TRAP.armDelay) {
          const hit = this.fighters.find((v) => v.slot !== e.owner && v.alive && v.invuln <= 0 && !this.friendly(e.owner, v) && circleHitsBox(e.x, e.y + 0.3, TRAP.r, v));
          if (hit) {
            const owner = this.fighter(e.owner);
            const md = moveOf('hacker', 'dspecial');
            const dir = hit.x >= e.x ? 1 : -1;
            this.knock(hit, dir, md.dmg * (owner?.def.dmgMul ?? 1), md.base, md.growth, md.angle, owner?.def.kbMul ?? 1, e.owner);
            hit.hitlag = 5;
            this.events.push({ k: 'boom', x: e.x, y: e.y + 0.3 });
            this.events.push({ k: 'hit', x: e.x, y: e.y + 0.3, p: md.dmg, s: hit.slot, a: e.owner });
            // 爆発したら、しばらく置き直せない
            if (owner && md.cd) owner.cdD = Math.max(owner.cdD, md.cd);
            continue;
          }
        }
      } else if (e.kind === 'drone') {
        // エージェント起動：持ち主のそばを飛び、近くの相手を自動で撃つ
        const o = this.fighter(e.owner);
        if (!o || !o.alive) continue;
        const tx = o.x - o.facing * 0.9;
        const ty = o.y + 2.2 * o.def.scale;
        e.x += (tx - e.x) * 0.12;
        e.y += (ty - e.y) * 0.12;
        e.dir = o.facing;
        if (e.age % DRONE.interval === 0) {
          let target: Fighter | null = null;
          let best: number = DRONE.range;
          for (const v of this.fighters) {
            if (v.slot === e.owner || !v.alive || this.friendly(e.owner, v)) continue;
            const d = Math.hypot(v.x - e.x, v.y + v.h / 2 - e.y);
            if (d < best) {
              best = d;
              target = v;
            }
          }
          if (target) {
            const dx = target.x - e.x;
            const dy = target.y + target.h / 2 - e.y;
            const d = Math.hypot(dx, dy) || 1;
            const pm = this.powerMul(o);
            this.projectiles.push({
              owner: e.owner, kind: 'spark', x: e.x, y: e.y, vx: (dx / d) * 13, vy: (dy / d) * 13, gravity: 0, life: 40,
              dmg: 3 * pm.dmg, base: 3, growth: 3, angle: 45, r: 0.22, hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [],
            });
            this.events.push({ k: 'shot', s: e.owner });
          }
        }
      } else if (e.kind === 'wall') {
        // 壁：持ち主以外の選手を押し返す
        for (const v of this.fighters) {
          if (v.slot === e.owner || !v.alive || this.friendly(e.owner, v)) continue;
          const half = WALL.w / 2 + v.hw;
          if (Math.abs(v.x - e.x) < half && v.y < e.y + WALL.h && v.y + v.h > e.y) {
            const side = v.x >= e.x ? 1 : -1;
            v.x = e.x + side * half;
            if (v.vx * side < 0) v.vx = 0;
            // 触れた相手を、壁の外側へはじく（1枚の壁につき1人1回。ガード中は押されるだけ）
            const owner = this.fighter(e.owner);
            if (v.wallHit !== e.id && v.invuln <= 0 && v.state !== 'shield' && v.grabbedBy < 0 && owner && !this.tryCounter(v, owner, WALL.hit.dmg)) {
              v.wallHit = e.id;
              const h = WALL.hit;
              const pm = this.powerMul(owner);
              this.knock(v, side, h.dmg * pm.dmg, h.base, h.growth, h.angle, pm.kb, e.owner);
              if (v.state === 'hitstun') v.hitstun = Math.round(v.hitstun * h.hitstun);
              v.hitlag = 5;
              this.events.push({ k: 'hit', x: e.x, y: v.y + v.h * 0.6, p: h.dmg, s: v.slot, a: e.owner });
            }
          }
        }
      }
      keep.push(e);
    }
    this.entities = keep;
  }

  private respawn(f: Fighter): void {
    const idx = Math.max(0, this.setup.players.findIndex((p) => p.slot === f.slot));
    const n = this.setup.players.length;
    const span = (this.stage.main.x2 - this.stage.main.x1) * 0.6;
    f.x = n > 1 ? -span / 2 + (span * idx) / (n - 1) : 0;
    f.y = this.stage.respawnY;
    f.vx = 0;
    f.vy = 0;
    f.damage = 0;
    f.grounded = false;
    f.groundRef = -1;
    f.move = null;
    f.jumpsLeft = f.def.airJumps;
    f.sideBUsed = false;
    f.airDodgeUsed = false;
    f.shield = f.shieldMax;
    f.ledgeSide = 0;
    f.lastHitBy = -1;
    f.poison = 0;
    f.speedBuff = 0;
    f.powerBuff = 0;
    f.bike = 0;
    f.confused = 0;
    f.leashT = 0;
    f.leashDmg = 0;
    f.callT = 0;
    f.awkward = 0;
    f.lonely = 0;
    f.dere = 0;
    f.dereCd = 0;
    f.heavyT = 0;
    f.floatT = 0;
    f.alarmT = 0;
    f.alarmUsed = false;
    f.absorbCharge = false;
    f.recentMoves = [];
    f.learnHits = f.learnHits.map(() => 0);
    f.jobCdN = [0, 0, 0];
    f.runTime = 0;
    this.setState(f, 'respawn');
  }

  // ------------------------------------------------------------------
  private tryLedgeGrab(f: Fighter): void {
    if (f.vy > 0 || f.ledgeCooldown > 0 || f.grounded) return;
    const m = this.stage.main;
    for (const side of [-1, 1]) {
      const ex = side < 0 ? m.x1 : m.x2;
      const dx = (f.x - ex) * side; // 台の外側方向への距離
      if (dx < -0.15 || dx > 1.4) continue;
      if (f.y < m.top - 2.6 || f.y > m.top - 0.2) continue;
      if (this.fighters.some((o) => o !== f && o.state === 'ledge' && o.ledgeSide === side)) continue;
      this.grabLedge(f, side);
      return;
    }
  }

  private updateLedge(f: Fighter): void {
    const m = this.stage.main;
    const side = f.ledgeSide;
    const ex = side < 0 ? m.x1 : m.x2;
    const inp = f.input;
    const drop = () => {
      f.ledgeSide = 0;
      f.ledgeCooldown = 40;
      f.grounded = false;
      this.setState(f, 'air');
    };
    if (f.stateTime > 300) return drop();
    if (f.stateTime < 8) return;
    if (this.pressed(f, BTN_JUMP)) {
      f.x = ex - side * 0.3;
      f.y = m.top + 0.05;
      f.vy = f.def.jumpV * this.jumpMul(f);
      f.ledgeSide = 0;
      f.ledgeCooldown = 30;
      f.grounded = false;
      this.setState(f, 'air');
      return;
    }
    if (inp.my > 0.6 || inp.mx * -side > 0.6 || this.pressed(f, BTN_A)) {
      f.x = ex - side * 0.7;
      f.y = m.top;
      f.grounded = true;
      f.groundRef = -1;
      f.ledgeSide = 0;
      f.vx = 0;
      f.vy = 0;
      f.stun = 12;
      f.invuln = Math.max(f.invuln, 12);
      this.setState(f, 'land');
      return;
    }
    if (inp.my < -0.6 || inp.mx * side > 0.6) return drop();
  }

  private collide(f: Fighter, prevX: number, prevY: number, inp: InputState): void {
    const m = this.stage.main;
    const hw = f.hw;
    const h = f.h;
    if (f.grounded) {
      if (f.groundRef < 0) {
        const keepOnEdge = f.state === 'attack' || f.state === 'shield' || f.state === 'land' || f.state === 'dodge';
        if (keepOnEdge) f.x = Math.max(m.x1, Math.min(m.x2, f.x));
        if (f.x < m.x1 || f.x > m.x2) {
          f.grounded = false;
        } else {
          f.y = m.top;
          f.vy = 0;
        }
      } else if (f.groundRef >= ENTITY_GROUND) {
        const e = this.entities.find((x) => x.id === f.groundRef - ENTITY_GROUND);
        if (!e || Math.abs(f.x - e.x) > POPUP.w / 2) {
          f.grounded = false;
          f.groundRef = -1;
        } else {
          f.y = e.y;
          f.vy = 0;
        }
      } else {
        const p = platformAt(this.stage.platforms[f.groundRef], this.frame);
        if (f.x < p.x1 || f.x > p.x2) {
          f.grounded = false;
          f.groundRef = -1;
        } else {
          f.y = p.y;
          f.vy = 0;
        }
      }
      if (!f.grounded) {
        f.groundRef = -1;
        f.jumpsLeft = f.def.airJumps;
        if (f.state === 'idle' || f.state === 'run' || f.state === 'land') this.setState(f, 'air');
        else if (f.state === 'shield' || f.state === 'dodge') this.setState(f, 'air');
      }
      return;
    }

    // 本体の台の上面に着地
    if (f.vy <= 0 && prevY >= m.top - 0.001 && f.y <= m.top && f.x >= m.x1 - 0.1 && f.x <= m.x2 + 0.1) {
      f.x = Math.max(m.x1, Math.min(m.x2, f.x));
      this.land(f, -1, m.top);
      return;
    }
    // 本体の台の側面・下面
    if (f.x + hw > m.x1 && f.x - hw < m.x2 && f.y < m.top && f.y + h > m.bottom) {
      if (prevY + h <= m.bottom + 0.001) {
        f.y = m.bottom - h;
        if (f.vy > 0) f.vy = f.state === 'hitstun' ? -f.vy * 0.5 : 0;
      } else {
        const leftSide = prevX < (m.x1 + m.x2) / 2;
        f.x = leftSide ? m.x1 - hw : m.x2 + hw;
        f.vx = f.state === 'hitstun' ? -f.vx * 0.5 : 0;
      }
    }
    // すり抜け足場
    const holdingDown = inp.my < -0.85;
    if (f.vy <= 0 && f.dropThrough <= 0 && !holdingDown) {
      for (let i = 0; i < this.stage.platforms.length; i++) {
        const p = platformAt(this.stage.platforms[i], this.frame);
        // 上下に動く足場もあるので、前のフレームの足場の高さと比べる
        if (prevY >= p.prevY - 0.001 && f.y <= p.y && f.x >= p.x1 && f.x <= p.x2) {
          this.land(f, i, p.y);
          return;
        }
      }
      for (const e of this.entities) {
        if (e.kind !== 'popup') continue;
        if (prevY >= e.y - 0.001 && f.y <= e.y && Math.abs(f.x - e.x) <= POPUP.w / 2) {
          this.land(f, ENTITY_GROUND + e.id, e.y);
          return;
        }
      }
    }
  }

  private land(f: Fighter, ref: number, y: number): void {
    if (f.state === 'hitstun' && f.tumble && f.vy < -9) {
      f.y = y;
      f.vy = -f.vy * 0.4;
      return;
    }
    if (f.vy < -6) this.events.push({ k: 'land', x: f.x, y, s: f.slot, p: Math.min(1, -f.vy / 20) });
    f.y = y;
    f.vy = 0;
    f.grounded = true;
    f.groundRef = ref;
    f.fastFall = false;
    f.jumpsLeft = f.def.airJumps;
    f.sideBUsed = false;
    f.airDodgeUsed = false;
    f.ledgeSide = 0;
    if (f.slamming > 0 && f.state === 'attack') {
      this.slamLand(f);
      return;
    }
    switch (f.state) {
      case 'attack': {
        const md = this.moveDef(f);
        if (md.air && md.special !== 'shot' && md.special !== 'counter' && md.special !== 'invis') {
          f.move = null;
          f.stun = md.landLag ?? 4;
          this.setState(f, 'land');
        }
        break;
      }
      case 'helpless':
        f.stun = 12;
        this.setState(f, 'land');
        break;
      case 'hitstun':
        if (f.tumble) {
          f.tumble = false;
          f.hitstun = 0;
          f.stun = 20;
          this.setState(f, 'land');
        }
        break;
      case 'airdodge':
        f.stun = 10;
        this.setState(f, 'land');
        break;
      case 'air':
        f.stun = 3;
        this.setState(f, 'land');
        break;
    }
  }

  /** シザーラッシュの決めの一撃：切り終わった瞬間、目の前の相手をふっとばす */
  private rushFinish(f: Fighter, md: MoveDef): void {
    const s = f.def.scale;
    const hb = md.hitboxes[0];
    const cx = f.x + hb.x * f.facing * s;
    const cy = f.y + hb.y * s;
    const pm = this.powerMul(f);
    for (const v of this.fighters) {
      if (v === f || !v.alive || v.invuln > 0 || this.friendly(f.slot, v)) continue;
      if (!circleHitsBox(cx, cy, hb.r * s * 1.1, v)) continue;
      const fin = THREEB_RULES.rushFinish;
      const dmg = fin.dmg * pm.dmg;
      if (this.tryCounter(v, f, dmg)) continue;
      if (v.state === 'shield') {
        v.shield -= dmg * 1.3;
        this.events.push({ k: 'shield', x: cx, y: cy });
        if (v.shield <= 0) this.breakShield(v);
        continue;
      }
      this.knock(v, f.facing, dmg, fin.base, fin.growth, 40, pm.kb, f.slot);
      f.hitlag = v.hitlag = 6;
      this.events.push({ k: 'hit', x: cx, y: cy, p: 8, s: v.slot, a: f.slot });
    }
  }

  /** マッスルジャンプ：かかえた相手を地面に叩きつける */
  private slamLand(f: Fighter): void {
    const v = f.grabbing >= 0 ? this.fighter(f.grabbing) : undefined;
    const md = this.moveDef(f);
    f.slamming = 0;
    f.grabbing = -1;
    f.move = null;
    f.stun = 14;
    this.setState(f, 'land');
    this.events.push({ k: 'boom', x: f.x + f.facing * 0.5, y: f.y + 0.2 });
    if (!v) return;
    v.grabbedBy = -1;
    v.x = f.x + f.facing * 0.7 * f.def.scale;
    v.y = f.y;
    v.grounded = true;
    v.groundRef = f.groundRef;
    const pm = this.powerMul(f);
    const before = v.damage;
    this.knock(v, f.facing, md.dmg * pm.dmg, md.base, md.growth, md.angle, pm.kb, f.slot);
    this.lifesteal(f, v.damage - before);
    f.throws++;
    f.hitlag = v.hitlag = 8;
    this.events.push({ k: 'hit', x: v.x, y: v.y + 0.4, p: md.dmg * 1.5, s: v.slot, a: f.slot });
  }

  // ------------------------------------------------------------------
  private detectHits(): void {
    // 自転車：走っている自転車にぶつかった相手にダメージ
    for (const a of this.fighters) {
      if (a.bike <= 0 || Math.abs(a.vx) < 6 || a.hitlag > 0) continue;
      const base = moveOf(a.def.id, 'sspecial');
      // 走り続けるほど（時間指定）ふっとばしが伸びる
      const md = { ...base, growth: base.growth * (1 + Math.min(BIKE.speedKb, (a.runTime / 240) * BIKE.speedKb)) };
      const cx = a.x + a.facing * 0.6 * a.def.scale;
      const cy = a.y + 0.6 * a.def.scale;
      for (const v of this.fighters) {
        if (v === a || !v.alive || v.invuln > 0 || a.bikeHitCd[v.slot] > 0 || this.friendly(a.slot, v)) continue;
        if (!circleHitsBox(cx, cy, BIKE.hitR * a.def.scale, v)) continue;
        a.bikeHitCd[v.slot] = BIKE.hitCooldown;
        this.applyHit(a, v, md, cx, cy);
      }
    }
    for (const a of this.fighters) {
      if (a.state !== 'attack' || !a.move || a.hitlag > 0 || a.slamming > 0) continue;
      const md = this.moveDef(a);
      if (md.hitboxes.length === 0) continue;
      const t = moveTiming(md, a);
      if (a.moveFrame < t.s || a.moveFrame >= t.s + t.a) continue;

      const s = a.def.scale;
      for (const hb of md.hitboxes) {
        const cx = a.x + hb.x * a.facing * s;
        const cy = a.y + hb.y * s;
        const r = hb.r * s;
        for (const v of this.fighters) {
          if (v === a || !v.alive || v.invuln > 0 || a.moveHit.has(v.slot) || this.friendly(a.slot, v)) continue;
          if (!circleHitsBox(cx, cy, r, v) && !this.hitsPast(a, v, cx, cy, r)) continue;
          if (md.special === 'grab' && !v.grounded) continue;
          a.moveHit.add(v.slot);
          this.applyHit(a, v, md, cx, cy);
          if (a.state !== 'attack') break; // つかんだら、ほかの人には当たらない
        }
        // ハルシネーション：分身を攻撃した相手は目を回す
        for (const e of this.entities) {
          // エージェント起動のドローン：攻撃を当てると壊れる
          if (e.kind === 'drone' && e.owner !== a.slot && e.life > 0 && Math.hypot(cx - e.x, cy - e.y) < r + 0.35) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y });
            continue;
          }
          if (e.kind !== 'decoy' || e.owner === a.slot || e.life <= 0) continue;
          const nx = Math.max(e.x - 0.42, Math.min(cx, e.x + 0.42));
          const ny = Math.max(e.y, Math.min(cy, e.y + 1.8));
          if ((cx - nx) ** 2 + (cy - ny) ** 2 > r * r) continue;
          e.life = 0;
          this.events.push({ k: 'poof', x: e.x, y: e.y + 0.9 });
          a.move = null;
          a.vx = 0;
          a.stun = DECOY.dizzy;
          this.setState(a, 'sleep');
          this.events.push({ k: 'sleep', x: a.x, y: a.y + a.h, s: a.slot });
          break;
        }
        if (a.state !== 'attack') break;
      }
    }
    this.entities = this.entities.filter((e) => e.life > 0);
  }

  private applyHit(a: Fighter, v: Fighter, md: MoveDef, hx: number, hy: number): void {
    // 無限スクロール（ドパガキ）：3回目（最後）の滑りは、ふっとばす一撃
    if (md.special === 'scroll' && a.chain >= 2) md = { ...md, dmg: md.dmg * SCROLL_FINISH.dmg, base: SCROLL_FINISH.base, growth: SCROLL_FINISH.growth, angle: SCROLL_FINISH.angle };
    // 学習（AIエンジニア）の構え中に直接殴られたら、ダメージを受けずに相手をはじき返す（つかみは防げない）
    if (md.special !== 'grab' && this.tryDeflect(v, a)) return;
    if (md.special === 'grab' || (md.special === 'tackle' && a.grounded && v.grounded)) {
      // つかみ・タックル：ガードしていてもつかめる。すでに誰かにつかまれている人はつかめない
      if (v.grabbedBy >= 0) return;
      if (md.special === 'tackle' && this.tryCounter(v, a, md.dmg)) return;
      this.startGrab(a, v);
      if (md.special === 'tackle') {
        // タックルは、つかんだ瞬間に少しダメージ
        v.damage = Math.min(999, v.damage + md.dmg * this.powerMul(a).dmg * 0.5);
        a.dealt += md.dmg * 0.5;
      }
      return;
    }
    if (md.special === 'slam' && a.slamming === 0 && a.grabbing < 0 && v.grabbedBy < 0 && v.state !== 'ledge' && !this.tryCounter(v, a, md.dmg)) {
      // マッスルジャンプ：つかんで、そのまま真下へ
      if (v.grabbing >= 0) this.endGrab(v, this.fighter(v.grabbing));
      a.grabbing = v.slot;
      a.slamming = TRAINER.slamMax;
      v.grabbedBy = a.slot;
      v.move = null;
      v.bike = 0;
      v.hitstun = 0;
      v.lastHitBy = a.slot;
      v.lastHitFrame = this.frame;
      this.setState(v, 'grabbed');
      this.placeGrabbed(a, v);
      a.hitlag = v.hitlag = 6;
      this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: 4, s: v.slot, a: a.slot });
      return;
    }
    const chargeMul =
      md.special === 'charge'
        ? 1 + (a.charge / CHARGE.max) * (CHARGE.mul - 1)
        : md.special === 'curl'
          ? 1 + (a.charge / TRAINER.curlMax) * (TRAINER.curlMul - 1)
          : 1 + (a.charge / 60) * 0.4;
    const pm = this.powerMul(a);
    const dmg = md.dmg * pm.dmg * chargeMul;
    if (this.tryCounter(v, a, dmg)) return;
    if (v.state === 'shield') {
      // ゼロデイ（ハッカー）：ガードを削る力が2倍
      v.shield -= dmg * 1.3 * (a.def.id === 'hacker' ? 2 : 1);
      v.vx = a.facing * 3;
      if (a.grounded) a.vx = -a.facing * 2;
      a.hitlag = v.hitlag = 4;
      this.events.push({ k: 'shield', x: hx, y: hy });
      if (v.shield <= 0) this.breakShield(v);
      return;
    }
    if (md.special === 'sleep') {
      // 強制アップデート：地上の相手をしばらく動けなくする（ダメージ%が高いほど長い）
      v.damage = Math.min(999, v.damage + dmg);
      v.lastHitBy = a.slot;
      v.lastHitFrame = this.frame;
      if (v.grounded) {
        v.move = null;
        v.vx = 0;
        v.stun = Math.min(SLEEP_MAX, Math.round(40 + v.damage * 0.5));
        this.setState(v, 'sleep');
        this.events.push({ k: 'sleep', x: v.x, y: v.y + v.h, s: v.slot });
      } else {
        this.knock(v, v.x >= a.x ? 1 : -1, 0, 4, 2, 60, 1, a.slot);
      }
      a.hitlag = v.hitlag = 3;
      return;
    }
    const before = v.damage;
    this.knock(v, a.facing, dmg, md.base, md.growth, md.angle, pm.kb * chargeMul, a.slot);
    this.lifesteal(a, v.damage - before);
    // 酔い（フレアボトル）・長いひるみ（スライド・シザーラッシュ）
    if (md.confuse) v.confused = Math.max(v.confused, md.confuse);
    if (md.hitstunMul && v.state === 'hitstun') v.hitstun = Math.round(v.hitstun * md.hitstunMul);
    if (md.special === 'dive') {
      // ステージダイブ：相手を踏み台にして跳ね上がる
      a.vy = THREEB_RULES.bounce;
      a.vx *= 0.3;
      a.move = null;
      this.setState(a, 'air');
    }
    if (a.crit) this.events.push({ k: 'flash', x: hx, y: hy, s: a.slot });
    const lag = Math.floor(3 + dmg / 3);
    a.hitlag = lag;
    v.hitlag = lag;
    this.events.push({ k: 'hit', x: hx, y: hy, p: dmg, s: v.slot, a: a.slot });
  }

  /** 巻き戻し：攻撃した人の画面に映っていた（少し前の）相手の位置に当たっているか */
  private hitsPast(a: Fighter, v: Fighter, cx: number, cy: number, r: number): boolean {
    const lag = Math.min(LAG_COMP_MAX, this.lagComp.get(a.slot) ?? 0);
    if (lag <= 0) return false;
    // 見えていた範囲（今〜lag フレーム前）のどこかに当たっていれば当たり
    for (let k = 1; k <= lag; k++) {
      const p = this.posHist[this.posHist.length - k]?.get(v.slot);
      if (!p) break;
      const nx = Math.max(p.x - v.hw, Math.min(cx, p.x + v.hw));
      const ny = Math.max(p.y, Math.min(cy, p.y + v.h));
      if ((cx - nx) ** 2 + (cy - ny) ** 2 <= r * r) return true;
    }
    return false;
  }

  /** 抜き取り（データ泥棒）：与えたダメージの1/5だけ回復 */
  private lifesteal(a: Fighter | undefined, dealt: number): void {
    if (!a || a.def.id !== 'thief' || dealt <= 0) return;
    a.damage = Math.max(0, a.damage - dealt * 0.2);
  }

  /** 学習（AIエンジニア）の構え中に直接攻撃されたら、相手をはじき返す（構えはそこで終わる） */
  private tryDeflect(v: Fighter, a: Fighter): boolean {
    if (v.state !== 'attack' || !v.move) return false;
    const md = this.moveDef(v);
    if (md.special !== 'absorb') return false;
    const t = moveTiming(md, v);
    if (v.moveFrame < t.s || v.moveFrame >= t.s + t.a) return false;
    v.moveFrame = t.s + t.a;
    v.invuln = Math.max(v.invuln, DEFLECT.invuln);
    const dir = a.x >= v.x ? 1 : -1;
    v.facing = dir;
    this.knock(a, dir, DEFLECT.dmg * v.def.dmgMul, DEFLECT.base, DEFLECT.growth, DEFLECT.angle, v.def.kbMul, v.slot);
    a.hitlag = v.hitlag = 6;
    this.events.push({ k: 'absorb', x: (a.x + v.x) / 2, y: v.y + v.h * 0.6, s: v.slot });
    this.events.push({ k: 'hit', x: a.x, y: a.y + a.h * 0.5, p: DEFLECT.dmg, s: a.slot, a: v.slot });
    return true;
  }

  /** 学習（AIエンジニア）の構え中なら、飛び道具を吸収する */
  private tryAbsorb(v: Fighter, p: Projectile): boolean {
    if (v.state !== 'attack' || !v.move) return false;
    const md = this.moveDef(v);
    if (md.special !== 'absorb') return false;
    const t = moveTiming(md, v);
    if (v.moveFrame < t.s || v.moveFrame >= t.s + t.a) return false;
    v.absorbCharge = true;
    this.events.push({ k: 'absorb', x: p.x, y: p.y, s: v.slot });
    return true;
  }

  /** クレーム対応（カウンター）の構え中なら、受けた攻撃を返す */
  private tryCounter(v: Fighter, a: Fighter | null, dmg: number): boolean {
    if (v.state !== 'attack' || !v.move) return false;
    const md = this.moveDef(v);
    if (md.special !== 'counter') return false;
    const t = moveTiming(md, v);
    if (v.moveFrame < t.s || v.moveFrame >= t.s + t.a) return false;
    this.events.push({ k: 'counter', x: v.x, y: v.y + v.h * 0.6, s: v.slot });
    v.moveFrame = t.s + t.a; // 構えを終えて後隙へ
    v.invuln = Math.max(v.invuln, 12);
    if (a) {
      v.facing = a.x >= v.x ? 1 : -1;
      const back = Math.max(8, dmg * 1.3) * v.def.dmgMul;
      this.knock(a, v.facing, back, md.base, md.growth, md.angle, v.def.kbMul, v.slot);
      a.hitlag = v.hitlag = 8;
      this.events.push({ k: 'hit', x: a.x, y: a.y + a.h * 0.5, p: back, s: a.slot, a: v.slot });
    }
    return true;
  }

  private knock(v: Fighter, dir: number, dmg: number, base: number, growth: number, angle: number, kbMul: number, from: number, noFlinch = false): void {
    // 王冠うばい：王冠を持っている人に当てたら奪う
    if (this.setup.rules.mode === 'crown') this.crownSteal(v, from);
    // コイン集め：攻撃を受けた人はコインを落とす
    if (this.setup.rules.mode === 'coins' && !this.solo) this.coinsOnHit(v, dmg, from);
    // 学習データ（AIエンジニア）：同じ相手からの攻撃ほどダメージが減る
    if (v.def.id === 'ai' && from >= 0 && from < v.learnHits.length) {
      dmg *= 1 - 0.05 * Math.min(5, v.learnHits[from]);
      v.learnHits[from]++;
    }
    // 眠っている相手は少し大きくふっとぶ（強制アップデートからの撃墜）
    if (v.state === 'sleep' && from >= 0 && from !== v.slot) kbMul *= SLEEP_KB;
    // つかんでいる人・つかまれている人が攻撃されたら、つかみは解ける
    if (v.grabbing >= 0) this.endGrab(v, this.fighter(v.grabbing));
    if (v.grabbedBy >= 0) {
      const g = this.fighter(v.grabbedBy);
      if (g && g.grabbing === v.slot) g.grabbing = -1;
      if (g && g.state === 'grab') this.setState(g, 'idle');
      v.grabbedBy = -1;
    }
    const rules = this.setup.rules;
    if (rules.horde) {
      // 100人組手：敵は弱め（倒した数が増えるほど少しずつ強くなる）
      const att = from >= 0 ? this.fighter(from) : undefined;
      if (att && att.team !== 0) dmg *= HORDE.dmg + HORDE.dmgGrow * this.hordeDefeated;
      if (v.team !== 0) {
        kbMul *= HORDE.kb;
        dmg *= HORDE.taken;
      }
    }
    // 赤い糸でつながれている間は、つないだメンヘラから受けたダメージだけをためておく（糸が切れたときに一気に加わる）。
    // ほかの人からの攻撃は、ふだんどおりすぐに加わる
    if (v.leashT > 0 && from === v.leashBy) v.leashDmg += dmg;
    else v.damage = Math.min(999, v.damage + dmg);
    if (from >= 0 && from !== v.slot) {
      const att = this.fighter(from);
      if (att) {
        att.dealt += dmg;
        // かまってちゃん（メンヘラ）：攻撃を当てたらデレモード（移動アップは一度出たら約7秒は出ない）
        if (att.def.id === 'menhera') {
          att.lonely = 0;
          if (att.dereCd <= 0) {
            att.dere = MENHERA.dere;
            att.dereCd = MENHERA.dereCd;
          }
        }
      }
    }
    // のけぞらない攻撃（ガチャ廃人の石など）：ダメージだけ受けて、ふっとびもひるみもしない
    if (noFlinch) {
      // 自転車の耐久はふつうに減る（こえたら降りるだけで、ふっとばない）
      if (v.bike > 0) {
        v.bikeHp -= dmg;
        if (v.bikeHp < 0) v.bike = 0;
      }
      v.lastHitBy = from;
      v.lastHitFrame = this.frame;
      return;
    }
    // 体力制：ふっとびはダメージで大きくなりにくい（HPを削り切るのが主な撃墜方法）
    const kbDamage = rules.mode === 'stamina' ? Math.min(v.damage, STAMINA_KB_CAP) : v.damage;
    // 重い愛のハートで重いと、ふっとびにくい
    const weight = v.def.weight * (v.heavyT > 0 ? MENHERA.heavy.weight : 1);
    const speed = ((base + (growth * KB_GROWTH_SCALE * kbDamage) / 100) * kbMul) / weight;
    // 自転車（配達員）：耐久が残っていれば、弱い攻撃では降りずに少し減速するだけ（ダメージは受ける）
    if (v.bike > 0 && v.bikeHp > 0 && speed < BIKE.armorLimit && v.state !== 'grabbed') {
      v.bikeHp -= dmg;
      v.vx *= BIKE.slow;
      v.lastHitBy = from;
      v.lastHitFrame = this.frame;
      // 受けたダメージの合計が耐久（10%）をこえたら降りる
      if (v.bikeHp >= 0) return;
      // 耐久が尽きた：このまま降ろされて、ふつうにふっとぶ
    }
    v.bike = 0;
    v.closeCall = 0;
    // プロテイン（トレーナー）：強いふっとばし以外ではひるまない（ダメージは少し減る）
    if (v.armor > 0 && speed < TRAINER.armorLimit && v.state !== 'grabbed') {
      v.damage = Math.max(0, v.damage - dmg * (1 - TRAINER.armorDamage));
      v.lastHitBy = from;
      v.lastHitFrame = this.frame;
      return;
    }
    const rad = (angle * Math.PI) / 180;
    const ax = Math.cos(rad) * dir;
    let ay = Math.sin(rad);
    if (v.grounded && ay < 0) ay = -ay * 0.6;
    v.vx = ax * speed;
    v.vy = ay * speed;
    if (v.grounded && v.vy < 3) {
      v.vy = 0;
    } else {
      v.grounded = false;
      v.groundRef = -1;
    }
    v.move = null;
    v.hitstun = Math.floor(speed * 1.4);
    v.tumble = speed > 15;
    v.fastFall = false;
    v.ledgeSide = 0;
    v.lastHitBy = from;
    v.lastHitFrame = this.frame;
    v.facing = -dir;
    this.setState(v, 'hitstun');
    if (this.closeCallCheck(v, speed)) {
      v.closeCall = 1;
      this.events.push({ k: 'close', x: v.x, y: v.y + v.h / 2, s: v.slot });
    } else if (speed > 14 && this.willBeKO(v)) this.events.push({ k: 'finish', x: v.x, y: v.y + v.h / 2, s: v.slot });
  }

  /**
   * ギリギリ耐える：そこまで強くない一撃（ふっとびの速さが CLOSE.strong 未満）で、わずかに場外まで届くだけなら、
   * ふっとびを少しだけ弱めて（最大 1 - CLOSE.minScale）場外の線の手前で止まるようにする。
   * もともと場外の線の近く（CLOSE.near 以内）まで飛ぶ場合も「ギリギリ」とする。ギリギリなら true
   */
  private closeCallCheck(v: Fighter, speed: number): boolean {
    if (speed < CLOSE.minSpeed || this.setup.rules.horde) return false;
    const m = this.flightMargin(v);
    if (m >= CLOSE.near) return false;
    if (m >= CLOSE.keep) return true;
    if (speed >= CLOSE.strong) return false;
    const vx = v.vx;
    const vy = v.vy;
    for (let s = 0.97; s >= CLOSE.minScale - 1e-9; s -= 0.03) {
      v.vx = vx * s;
      v.vy = vy * s;
      if (this.flightMargin(v) >= CLOSE.keep) return true;
    }
    v.vx = vx;
    v.vy = vy;
    return false;
  }

  /** ギリギリ耐えたふっとびの終わり：場外へ向かう勢いを止める（何も操作しなくても場外へ流れていかない） */
  private closeBrake(f: { x: number; vx: number; vy: number }): void {
    if (f.vx * Math.sign(f.x) > 0) f.vx = Math.sign(f.vx) * Math.min(Math.abs(f.vx), CLOSE.brakeVx);
    f.vy = Math.min(f.vy, CLOSE.brakeVy);
  }

  /**
   * ふっとびの先読み：ひるみの間と、そのあと CLOSE.extra フレーム（ギリギリで踏んばったあと、何も操作しないとき）に、
   * 場外の線へいちばん近づいたときの距離（m）。線を越えるならマイナス。台に落ちる・ぶつかるところで止める
   */
  private flightMargin(v: Fighter): number {
    const b = this.stage.blast;
    const m = this.stage.main;
    const d = v.def;
    let x = v.x;
    let y = v.y;
    let vx = v.vx;
    let vy = v.vy;
    let best = Infinity;
    const frames = v.hitstun + CLOSE.extra;
    for (let i = 0; i < frames; i++) {
      if (i < v.hitstun) vx *= HITSTUN_DRAG;
      else {
        // ひるみが終わったら踏んばって止まり（closeBrake と同じ）、あとは何も操作しないときの空中の動き
        if (i === v.hitstun) {
          const p = { x, vx, vy };
          this.closeBrake(p);
          vx = p.vx;
          vy = p.vy;
        }
        vx *= 0.97;
      }
      vy -= d.gravity * DT;
      if (vy < -d.fallMax * (i < v.hitstun ? 2 : 1)) vy = -d.fallMax * (i < v.hitstun ? 2 : 1);
      const px = x;
      const py = y;
      x += vx * DT;
      y += vy * DT;
      best = Math.min(best, x - b.left, b.right - x, b.top - (y + v.h), y - b.bottom);
      if (best < 0) return best;
      if (x >= m.x1 && x <= m.x2 && ((py >= m.top && y <= m.top) || (y < m.top && y + v.h > m.bottom))) break;
      if (px < m.x1 !== x < m.x1 && y < m.top && y > m.bottom - v.h) break;
      if (px > m.x2 !== x > m.x2 && y < m.top && y > m.bottom - v.h) break;
    }
    return best;
  }

  /**
   * このふっとびで場外まで飛ぶか（演出用の予測）。ひるみ中の動き（空気抵抗・重力）をそのまま先まで計算し、
   * 自分で動けるようになる直後（5フレーム）までに場外の線を越えれば撃墜とみなす。台にぶつかる場合は撃墜にならない。
   */
  private willBeKO(v: Fighter): boolean {
    const b = this.stage.blast;
    const m = this.stage.main;
    const d = v.def;
    let x = v.x;
    let y = v.y;
    let vx = v.vx;
    let vy = v.vy;
    const frames = v.hitstun + 5;
    for (let i = 0; i < frames; i++) {
      vx *= HITSTUN_DRAG;
      vy -= d.gravity * DT;
      if (vy < -d.fallMax * 2) vy = -d.fallMax * 2;
      const px = x;
      const py = y;
      x += vx * DT;
      y += vy * DT;
      if (x < b.left || x > b.right || y < b.bottom || y > b.top) return true;
      // 台の上に落ちる・台の横や下にぶつかる
      if (x >= m.x1 && x <= m.x2 && ((py >= m.top && y <= m.top) || (y < m.top && y + v.h > m.bottom))) return false;
      if (px < m.x1 !== x < m.x1 && y < m.top && y > m.bottom - v.h) return false;
      if (px > m.x2 !== x > m.x2 && y < m.top && y > m.bottom - v.h) return false;
    }
    return false;
  }

  private updateProjectiles(): void {
    const m = this.stage.main;
    const bl = this.stage.blast;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.age++;
      if (p.homing > 0) {
        // 推論：いちばん近い相手（分身も含む）へ曲がる
        let tx = 0;
        let ty = 0;
        let best = Infinity;
        for (const v of this.fighters) {
          if (v.slot === p.owner || !v.alive || this.friendly(p.owner, v)) continue;
          const d = Math.hypot(v.x - p.x, v.y + v.h / 2 - p.y);
          if (d < best) {
            best = d;
            tx = v.x;
            ty = v.y + v.h / 2;
          }
        }
        if (best < Infinity) {
          const sp = Math.hypot(p.vx, p.vy) || 6.5;
          const d = Math.hypot(tx - p.x, ty - p.y) || 1;
          p.vx += ((tx - p.x) / d) * sp * p.homing;
          p.vy += ((ty - p.y) / d) * sp * p.homing;
          const n = Math.hypot(p.vx, p.vy) || 1;
          p.vx = (p.vx / n) * sp;
          p.vy = (p.vy / n) * sp;
        }
      }
      if (p.boomerang > 0) {
        // 配達バッグ：一定時間で持ち主のところへ戻ってくる
        if (!p.returning && p.age >= p.boomerang) {
          p.returning = true;
          p.hits = [];
        }
        if (p.returning) {
          const o = this.fighter(p.owner);
          if (!o || !o.alive) p.life = 0;
          else {
            const tx = o.x;
            const ty = o.y + o.h / 2;
            const d = Math.hypot(tx - p.x, ty - p.y);
            if (d < 0.7) p.life = 0;
            else {
              p.vx = ((tx - p.x) / d) * 14;
              p.vy = ((ty - p.y) / d) * 14;
            }
          }
        } else p.vx *= 0.96;
      }
      p.vy -= p.gravity * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.life--;
      let gone = p.life <= 0 || p.x < bl.left || p.x > bl.right || p.y < bl.bottom || p.y > bl.top;
      if (p.x > m.x1 && p.x < m.x2 && p.y < m.top && p.y > m.bottom && !p.returning) gone = true;
      // 分身・ドローンに当たると、一緒に消える
      if (!gone) {
        for (const e of this.entities) {
          if (e.kind === 'drone' && e.owner !== p.owner && Math.hypot(p.x - e.x, p.y - e.y) < p.r + 0.35) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y });
            gone = true;
            break;
          }
          if (e.kind !== 'decoy' || e.owner === p.owner) continue;
          if (Math.abs(p.x - e.x) < 0.42 + p.r && p.y > e.y && p.y < e.y + 1.8) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y + 0.9 });
            gone = true;
            break;
          }
        }
      }
      // 物理ファイアウォール（持ち主以外の飛び道具を消す）
      if (!gone) {
        for (const e of this.entities) {
          if (e.kind !== 'wall' || e.owner === p.owner) continue;
          if (Math.abs(p.x - e.x) < WALL.w / 2 + p.r && p.y > e.y && p.y < e.y + WALL.h) {
            this.events.push({ k: 'shield', x: p.x, y: p.y });
            gone = true;
            break;
          }
        }
      }
      if (!gone) {
        for (const v of this.fighters) {
          if (v.slot === p.owner || !v.alive || v.invuln > 0 || p.hits.includes(v.slot) || this.friendly(p.owner, v)) continue;
          if (!circleHitsBox(p.x, p.y, p.r, v)) continue;
          const dir = Math.sign(p.vx) || 1;
          if (this.tryAbsorb(v, p)) {
            // 学習で吸収した
          } else if (this.tryCounter(v, null, p.dmg)) {
            // カウンターで飛び道具を打ち消した
          } else if (v.state === 'shield') {
            const owner = this.fighter(p.owner);
            v.shield -= p.dmg * 1.3 * (owner?.def.id === 'hacker' ? 2 : 1);
            this.events.push({ k: 'shield', x: p.x, y: p.y });
            if (v.shield <= 0) this.breakShield(v);
          } else {
            const owner = this.fighter(p.owner);
            const before = v.damage;
            const noFlinch = !!p.noFlinch || (!!p.flinchAge && p.age >= p.flinchAge);
            this.knock(v, dir, p.dmg, p.base, p.growth, p.angle, owner ? this.powerMul(owner).kb : 1, p.owner, noFlinch);
            this.lifesteal(owner, v.damage - before);
            if (!noFlinch) v.hitstun = Math.round(v.hitstun * p.hitstunMul);
            // 飛び道具のひるみは半分（のけぞらない攻撃は、いまのひるみをそのままにする）
            if (v.state === 'hitstun' && !noFlinch) v.hitstun = Math.max(1, Math.round(v.hitstun * SHOT_HITSTUN));
            if (p.confuse > 0) v.confused = Math.max(v.confused, p.confuse);
            // 赤い糸：つながる。鬼電：着信中の印（すでに印があれば付け直さない）
            if (p.leash) {
              v.leashT = this.leashFrames(owner ?? v, p.leash);
              v.leashBy = p.owner;
            }
            if (p.call && v.callT <= 0) {
              v.callT = p.call;
              v.callBy = p.owner;
              // 鬼電：爆発してから2秒たつまで、次は投げられない
              if (owner) owner.cdS = Math.max(owner.cdS, p.call + MENHERA.callCd);
            }
            if (p.poison > 0) {
              v.poison = Math.max(v.poison, p.poison);
              v.poisonFrom = p.owner;
            }
            if (!noFlinch) v.hitlag = 3;
            this.events.push({ k: 'hit', x: p.x, y: p.y, p: p.dmg, s: v.slot, a: p.owner });
          }
          // ブーメランとステージギミックは当たっても消えずに進む
          if (p.boomerang > 0 || p.pierce) {
            p.hits.push(v.slot);
            continue;
          }
          gone = true;
          break;
        }
      }
      if (!gone) keep.push(p);
    }
    this.projectiles = keep;
  }

  private checkBlast(f: Fighter): void {
    if (!f.alive) return;
    const b = this.stage.blast;
    if (f.x >= b.left && f.x <= b.right && f.y >= b.bottom && f.y <= b.top) return;
    this.koFighter(f, Math.max(b.left, Math.min(b.right, f.x)), Math.max(b.bottom, Math.min(b.top, f.y)));
  }

  /** 体力制：HPが0になったら、その場で爆発して撃墜 */
  private checkHp(f: Fighter): void {
    if (!f.alive || f.damage < this.maxHp) return;
    f.damage = this.maxHp;
    this.events.push({ k: 'boom', x: f.x, y: f.y + f.h / 2 });
    this.events.push({ k: 'finish', x: f.x, y: f.y + f.h / 2, s: f.slot });
    this.koFighter(f, f.x, f.y + f.h / 2);
  }

  private koFighter(f: Fighter, x: number, y: number): void {
    const by = f.lastHitBy >= 0 && f.lastHitBy !== f.slot && this.frame - f.lastHitFrame < KO_CREDIT_FRAMES ? f.lastHitBy : undefined;
    this.events.push(by === undefined ? { k: 'ko', x, y, s: f.slot } : { k: 'ko', x, y, s: f.slot, a: by });
    f.closeCall = 0;
    f.falls++;
    if (f.lastHitBy >= 0 && this.frame - f.lastHitFrame < KO_CREDIT_FRAMES) {
      const k = this.fighter(f.lastHitBy);
      // 味方を落としても撃墜数には数えない
      if (k && k !== f && k.team !== f.team) {
        k.kos++;
        // バズり（配信者）：撃墜するたびに攻撃力アップ
        if (k.def.id === 'streamer') k.buzz = Math.min(3, k.buzz + 1);
      }
    }
    if (this.setup.rules.mode === 'crown' && !this.solo) this.crownOnKo(f, by);
    if (this.setup.rules.mode === 'bounty' && !this.solo) this.bountyOnKo(f, by);
    if (this.setup.rules.mode === 'coins' && !this.solo) this.coinsOnKo(f);
    if (f.grabbing >= 0) this.endGrab(f, this.fighter(f.grabbing));
    f.buzz = 0;
    f.move = null;
    f.ledgeSide = 0;
    this.setState(f, 'dead');
    f.respawnTimer = 100;
    const rules = this.setup.rules;
    if (rules.horde && f.team !== 0) {
      // 100人組手の敵：すぐ次の敵が出てくる。出す敵がもういなければ退場
      this.hordeDefeated++;
      f.respawnTimer = HORDE.respawn;
      if (this.hordeDefeated % HORDE.healEvery === 0) {
        // 区切りの人数を倒したら回復
        const me = this.fighters.find((o) => o.team === 0 && o.alive);
        if (me) {
          me.damage = Math.max(0, me.damage - HORDE.heal);
          this.events.push({ k: 'heal', x: me.x, y: me.y + me.h, s: me.slot });
        }
      }
      // 出ている敵（待っている敵は数えない）と倒した数で、もう出さなくていい敵を退場させる
      for (const o of [f, ...this.fighters.filter((x) => x !== f && x.team !== 0 && !x.out && this.hordeWaiting(x))]) {
        const onField = this.fighters.filter((x) => x !== o && x.team !== 0 && !x.out && !this.hordeWaiting(x)).length;
        if (this.hordeDefeated + onField >= rules.horde) {
          o.out = true;
          o.outFrame = this.frame;
        }
      }
      return;
    }
    // サドンデスはどのルールでも1ストック（落ちたら退場）
    if (this.sudden || !isNoStock(rules.mode)) {
      f.stocks--;
      if (f.stocks <= 0) {
        f.out = true;
        f.outFrame = this.frame;
      }
    }
  }

  /** サドンデス中（1位が同点のときの延長戦） */
  sudden = false;
  /** サドンデスに出ている人（同点だった人） */
  private suddenSlots: number[] = [];
  private suddenStart = 0;

  /**
   * 1位が同点なら、同点の人だけでサドンデスを始める（始めたら true）。
   * 個人戦だけ（チーム戦・玉入れ・100人組手はしない）。同点でない人は観戦にまわる
   */
  private tryStartSudden(): boolean {
    const r = this.setup.rules;
    if (r.teams || r.horde || r.mode === 'ball' || this.fighters.length < 2) return false;
    // タイム制は「撃墜−落下」の点が同じなら同点（ダメージの差では決めない）。ほかのルールは順位のとおり
    const res = this.results();
    const pts = (slot: number) => {
      const f = this.fighter(slot)!;
      return f.kos - f.falls;
    };
    const top =
      r.mode === 'time'
        ? this.fighters.filter((f) => pts(f.slot) === Math.max(...this.fighters.map((o) => pts(o.slot)))).map((f) => f.slot)
        : res.filter((e) => e.rank === 1).map((e) => e.slot);
    if (top.length < 2) return false;
    this.sudden = true;
    this.suddenSlots = top;
    this.suddenStart = this.frame;
    for (const f of this.fighters) {
      if (!top.includes(f.slot)) {
        f.out = true;
        f.outFrame = this.frame;
        this.setState(f, 'dead');
        continue;
      }
      this.respawn(f);
      f.out = false;
      f.stocks = 1;
      // ダメージ高めから（体力制は残りHPが少ない状態から）
      f.damage = r.mode === 'stamina' ? Math.max(0, this.maxHp - SUDDEN.hp) : SUDDEN.damage;
    }
    this.events.push({ k: 'sudden' });
    return true;
  }

  private checkEnd(): void {
    if (this.ended) return;
    const rules = this.setup.rules;
    if (this.sudden) {
      // サドンデス：残りが1人になったら終わり。長引いたらダメージの少ない人の勝ち
      const alive = this.fighters.filter((f) => this.suddenSlots.includes(f.slot) && !f.out);
      if (alive.length <= 1 || this.frame - this.suddenStart > SUDDEN.max) {
        this.ended = true;
        this.endFrame = this.frame;
      }
      return;
    }
    // 制限時間 0 は時間切れなし（100人組手）
    const timeUp = rules.timeLimit > 0 && this.frame > COUNTDOWN_FRAMES && this.timeLeftFrames <= 0;
    let over = timeUp;
    // エリアバトル：だれかのゲージが満タンになったら終わり
    if (rules.mode === 'area' && [...this.areaGauge.values()].some((v) => v >= this.areaGoal)) over = true;
    // 玉入れ：どちらかのチームが先取点に届いたら終わり（ゴールのあと少し間をおく）
    if (rules.mode === 'ball' && this.ballScore.some((v) => v >= this.ballTarget) && this.ball.timer < BALL.respawn - 45) over = true;
    // 王冠うばい：だれかが目標の時間まで持ったら終わり。金庫まもり：どちらかの金庫が壊れたら終わり
    if (rules.mode === 'crown' && [...this.crownPts.values()].some((v) => v >= this.crownGoalFrames)) over = true;
    if (rules.mode === 'vault' && this.vaults.some((v) => v.hp <= 0)) over = true;
    if (!isNoStock(rules.mode) && this.fighters.length > 1) {
      // 残っているチーム（チーム戦でなければ選手）が1つ以下になったら終わり
      const teams = new Set(this.fighters.filter((f) => !f.out).map((f) => f.team));
      if (teams.size <= 1) over = true;
    }
    if (over) {
      // 1位が同点なら、すぐには終わらずサドンデス
      if (this.tryStartSudden()) return;
      this.ended = true;
      this.endFrame = this.frame;
    }
  }

  results(): ResultEntry[] {
    const time = this.setup.rules.mode === 'time';
    const area = this.setup.rules.mode === 'area';
    const ball = this.setup.rules.mode === 'ball';
    const crown = this.setup.rules.mode === 'crown';
    const vault = this.setup.rules.mode === 'vault';
    const bounty = this.setup.rules.mode === 'bounty';
    const coins = this.setup.rules.mode === 'coins';
    const bp = (f: Fighter) => this.bountyPts.get(f.slot) ?? 0;
    const cn = (f: Fighter) => this.coinsHeld.get(f.slot) ?? 0;
    const gauge = (f: Fighter) => this.areaGauge.get(this.areaKey(f)) ?? 0;
    const held = (f: Fighter) => this.crownPts.get(this.crownKey(f)) ?? 0;
    /** そのチームが相手の金庫に与えたダメージ */
    const broke = (team: number) => {
      const v = this.vaults[1 - (team % 2)];
      return v ? v.max - v.hp : 0;
    };
    const score = (f: Fighter) =>
      bounty
        ? bp(f) * 1000 + (f.kos - f.falls)
        : coins
        ? cn(f) * 1000 + (f.kos - f.falls)
        : crown
        ? held(f) * 1000 + (f.kos - f.falls)
        : vault
        ? f.vaultDmg * 1000 + (f.kos - f.falls)
        : ball
        ? f.goals * 1000 + (f.kos - f.falls)
        : area
        ? Math.floor(gauge(f)) * 1000 + (f.kos - f.falls)
        : time
          ? (f.kos - f.falls) * 10000 - f.damage
          : f.stocks * 10000 + (f.out ? f.outFrame : 999999) - Math.floor(f.damage) / 1000;
    // チームの点：タイム制は合計、残機制・体力制は残機の合計と最後まで残った時間
    const teamScore = new Map<number, number>();
    for (const f of this.fighters) {
      const members = this.fighters.filter((o) => o.team === f.team);
      const v = bounty
        ? members.reduce((n, o) => n + bp(o), 0) * 1000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : coins
        ? members.reduce((n, o) => n + cn(o), 0) * 1000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : crown
        ? held(f) * 1000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : vault
        ? broke(f.team) * 100000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : ball
        ? this.ballScore[f.team] * 100000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : area
        ? Math.floor(gauge(f)) * 1000 + members.reduce((n, o) => n + (o.kos - o.falls), 0)
        : time
        ? members.reduce((n, o) => n + (o.kos - o.falls), 0) * 10000 - members.reduce((n, o) => n + o.damage, 0) / 1000
        : members.reduce((n, o) => n + o.stocks, 0) * 10000 + Math.max(...members.map((o) => (o.out ? o.outFrame : 999999)));
      teamScore.set(f.team, v);
    }
    // サドンデスをした人は、ほかの人より上。その中では最後まで残った人（同じなら先に落ちなかった人・ダメージの少ない人）が上
    const suddenBonus = (f: Fighter) => (this.sudden && this.suddenSlots.includes(f.slot) ? 1e13 + (f.out ? f.outFrame * 1e3 : 1e12) - f.damage : 0);
    const entries = this.fighters.map((f) => ({ f, team: teamScore.get(f.team)!, score: score(f) + suddenBonus(f) }));
    const teamMode = this.teamMode;
    if (teamMode) entries.sort((a, b) => b.team - a.team || a.f.team - b.f.team || b.score - a.score);
    else entries.sort((a, b) => b.score - a.score);
    let rank = 0;
    let prev: (typeof entries)[number] | null = null;
    return entries.map((e, i) => {
      // チーム戦は同じチームなら同じ順位。点が同じなら同じ順位
      const same = prev && (teamMode ? prev.f.team === e.f.team || prev.team === e.team : prev.score === e.score);
      if (!same) rank = i + 1;
      prev = e;
      return {
        slot: e.f.slot,
        rank,
        kos: e.f.kos,
        falls: e.f.falls,
        score: e.f.kos - e.f.falls,
        dealt: Math.round(e.f.dealt),
        throws: e.f.throws,
        ...(area ? { area: Math.floor((gauge(e.f) / this.areaGoal) * 100) } : {}),
        ...(ball ? { goals: e.f.goals, teamGoals: this.ballScore[e.f.team] } : {}),
        ...(crown ? { crown: Math.floor(held(e.f) / 60) } : {}),
        ...(bounty ? { bounty: bp(e.f) } : {}),
        ...(coins ? { coins: cn(e.f) } : {}),
        ...(vault ? { vaultDmg: Math.round(e.f.vaultDmg), vaultBroke: Math.floor((broke(e.f.team) / (this.vaults[0]?.max || 1)) * 1000) / 10 } : {}),
      };
    });
  }

  /** チームで順位を決める（チーム戦・100人組手） */
  get teamMode(): boolean {
    return !!(this.setup.rules.teams || this.setup.rules.horde || isTwoTeam(this.setup.rules.mode));
  }

  toView(): ViewState {
    return {
      frame: this.frame,
      timeLeft: this.timeLeftFrames,
      countdown: Math.max(0, COUNTDOWN_FRAMES - this.frame),
      fighters: this.fighters.map((f) => ({
        slot: f.slot,
        x: f.x,
        y: f.y,
        facing: f.facing,
        state: f.state,
        stateTime: f.stateTime,
        move: f.move,
        moveFrame: f.moveFrame,
        damage: f.damage,
        stocks: f.stocks,
        invuln: f.invuln > 0,
        shield: f.shield / f.shieldMax,
        charge: f.charge,
        kos: f.kos,
        falls: f.falls,
        out: f.out,
        poison: f.poison > 0,
        fx:
          (f.speedBuff > 0 ? FX_SPEED : 0) |
          (f.powerBuff > 0 ? FX_POWER : 0) |
          (f.bike > 0 ? FX_BIKE : 0) |
          (f.confused > 0 ? FX_CONFUSED : 0) |
          (f.absorbCharge ? FX_CHARGED : 0) |
          (f.armor > 0 ? FX_ARMOR : 0) |
          (f.size === 1 ? FX_BIG : f.size === 2 ? FX_SMALL : 0) |
          (f.warpCd > 0 ? FX_WARPCD : 0) |
          (f.def.id === 'menhera' && f.lonely >= MENHERA.lonely ? FX_YAMI : 0) |
          (f.awkward > 0 ? FX_AWK : 0) |
          (f.heavyT > 0 ? FX_HEAVY : 0) |
          this.buffBits(f) |
          (f.job << FX_JOB_SHIFT) |
          (f.buzz << 5),
      })),
      projectiles: this.projectiles.map((p) => ({ x: p.x, y: p.y, owner: p.owner, kind: p.kind })),
      entities: [
        ...this.entities.map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, life: e.life, dir: e.dir })),
        // 赤い糸・鬼電の印（メンヘラ）：画面に出すため、つながれた人・付けられた人ごとに足す
        ...this.fighters.flatMap((f) => [
          ...(f.leashT > 0 ? [{ kind: 'leash' as const, x: f.x, y: f.y, owner: f.leashBy, life: f.leashT, dir: f.slot }] : []),
          ...(f.callT > 0 ? [{ kind: 'call' as const, x: f.x, y: f.y, owner: f.callBy, life: f.callT, dir: f.slot }] : []),
        ]),
        ...(this.heart ? [{ kind: 'heart' as const, x: this.heart.x, y: this.heart.y, owner: -1, life: this.heart.life, dir: 0 }] : []),
      ],
      events: this.events,
      ended: this.ended,
      horde: this.setup.rules.horde ? this.hordeDefeated : undefined,
      area: this.setup.rules.mode === 'area' ? this.areaView() : undefined,
      crown: this.setup.rules.mode === 'crown' ? this.crownView() : undefined,
      vault: this.setup.rules.mode === 'vault' ? this.vaultView() : undefined,
      bounty: this.setup.rules.mode === 'bounty' ? this.bountyView() : undefined,
      coins: this.setup.rules.mode === 'coins' ? this.coinsView() : undefined,
      sudden: this.sudden || undefined,
      ball: this.setup.rules.mode === 'ball' ? this.ballView() : undefined,
    };
  }
}

function circleHitsBox(cx: number, cy: number, r: number, f: Fighter): boolean {
  const nx = Math.max(f.x - f.hw, Math.min(cx, f.x + f.hw));
  const ny = Math.max(f.y, Math.min(cy, f.y + f.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export { CHARACTERS };
