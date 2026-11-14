// 端末（クライアント）とサーバーで共用する型定義

export const BTN_A = 1;
export const BTN_B = 2;
export const BTN_JUMP = 4;
export const BTN_SHIELD = 8;

/** 1フレーム分の入力。mx/my はスティック（-1〜1、上が +）。buttons はビットの組み合わせ */
export interface InputState {
  mx: number;
  my: number;
  buttons: number;
}

export const EMPTY_INPUT: InputState = { mx: 0, my: 0, buttons: 0 };

export type FighterStateName =
  | 'idle'
  | 'run'
  | 'air'
  | 'land'
  | 'attack'
  | 'hitstun'
  | 'shield'
  | 'shieldbreak'
  | 'dodge'
  | 'airdodge'
  | 'ledge'
  | 'helpless'
  | 'dead'
  | 'respawn'
  | 'sleep'
  | 'grab'
  | 'grabbed';

export const STATE_NAMES: FighterStateName[] = [
  'idle',
  'run',
  'air',
  'land',
  'attack',
  'hitstun',
  'shield',
  'shieldbreak',
  'dodge',
  'airdodge',
  'ledge',
  'helpless',
  'dead',
  'respawn',
  'sleep',
  'grab',
  'grabbed',
];

export type MoveId =
  | 'jab'
  | 'side'
  | 'smash'
  | 'up'
  | 'down'
  | 'nair'
  | 'fair'
  | 'bair'
  | 'uair'
  | 'dair'
  | 'nspecial'
  | 'sspecial'
  | 'uspecial'
  | 'dspecial'
  | 'grab'
  | 'charge'
  | 'pummel'
  | 'fthrow'
  | 'bthrow'
  | 'uthrow'
  | 'dthrow'
  | 'taunt';

export const MOVE_IDS: MoveId[] = [
  'jab',
  'side',
  'smash',
  'up',
  'down',
  'nair',
  'fair',
  'bair',
  'uair',
  'dair',
  'nspecial',
  'sspecial',
  'uspecial',
  'dspecial',
  'grab',
  'charge',
  'pummel',
  'fthrow',
  'bthrow',
  'uthrow',
  'dthrow',
  'taunt',
];

/** stock = 残機制、time = タイム制、stamina = 体力制（HPが0になるか場外で撃墜） */
export type RuleMode = 'stock' | 'time' | 'stamina';

export interface MatchRules {
  mode: RuleMode;
  stocks: number;
  /** 制限時間（秒） */
  timeLimit: number;
  /** アイテムが出る */
  items?: boolean;
  /** ステージギミックが動く */
  gimmicks?: boolean;
  /** 体力制のHP */
  hp?: number;
  /** チーム戦 */
  teams?: boolean;
  /** チーム戦で味方にも攻撃が当たる */
  friendlyFire?: boolean;
  /** 100人組手：倒す敵の人数（端末だけで遊ぶモード。players の先頭が自分、ほかは全員敵） */
  horde?: number;
}

/** 体力制のHP（未指定のとき） */
export const DEFAULT_HP = 150;
/** チームの数（赤・青・緑・黄） */
export const TEAM_COUNT = 4;

export const DEFAULT_RULES: MatchRules = { mode: 'stock', stocks: 3, timeLimit: 180, items: false, gimmicks: false };

export interface PlayerSetup {
  slot: number;
  name: string;
  charId: string;
  cpu: boolean;
  cpuLevel: number;
  /** 衣装の id（未指定ならいつもの服） */
  costume?: string;
  /** チーム（0〜3。チーム戦のときだけ使う） */
  team?: number;
}

export interface MatchSetup {
  players: PlayerSetup[];
  stageId: string;
  rules: MatchRules;
  seed: number;
}

/** 演出用のイベント（ヒット・撃墜など） */
export type GameEvent =
  /** 当たった（s = 当たった人、a = 当てた人） */
  | { k: 'hit'; x: number; y: number; p: number; s: number; a?: number }
  | { k: 'shield'; x: number; y: number }
  /** 撃墜（s = 撃墜された人、a = 撃墜した人。自滅などは無し） */
  | { k: 'ko'; x: number; y: number; s: number; a?: number }
  | { k: 'jump'; s: number }
  | { k: 'land'; x: number; y: number; s: number; p: number }
  | { k: 'counter'; x: number; y: number; s: number }
  | { k: 'flash'; x: number; y: number; s: number }
  | { k: 'boom'; x: number; y: number }
  | { k: 'teleport'; x: number; y: number; s: number }
  | { k: 'sleep'; x: number; y: number; s: number }
  | { k: 'gacha'; x: number; y: number; s: number; r: number }
  | { k: 'absorb'; x: number; y: number; s: number }
  | { k: 'heal'; x: number; y: number; s: number }
  | { k: 'buff'; s: number }
  | { k: 'poof'; x: number; y: number }
  | { k: 'swap'; x: number; y: number; x2: number; y2: number; s: number }
  | { k: 'pull'; x: number; y: number; tx: number; ty: number }
  | { k: 'shot'; s: number }
  /** アピール（i = セリフの番号） */
  | { k: 'taunt'; s: number; i: number }
  /** アイテムを拾った（t = 種類） */
  | { k: 'item'; s: number; t: number; x: number; y: number }
  /** ステージギミックの予告（h = 種類、x/y = 位置、d = 向き） */
  | { k: 'warn'; h: string; x: number; y: number; d: number }
  /** 撃墜が確定するほどの一撃（演出：スロー＆ズーム） */
  | { k: 'finish'; x: number; y: number; s: number };

/** 描画用の選手の状態（ローカル対戦でもオンライン対戦でも同じ形） */
export interface ViewFighter {
  slot: number;
  x: number;
  y: number;
  facing: number;
  state: FighterStateName;
  stateTime: number;
  move: MoveId | null;
  moveFrame: number;
  damage: number;
  stocks: number;
  invuln: boolean;
  shield: number;
  charge: number;
  kos: number;
  falls: number;
  out: boolean;
  /** 毒（マルウェア）でじわじわダメージを受けている */
  poison: boolean;
  /** 状態のビット：1=倍速 2=課金 4=自転車 8=操作反転 16=吸収済み、32〜64=バズり段階（0〜3）、128=ひるまない（プロテイン）、256〜512=3Bの仕事 */
  fx: number;
}

export const FX_SPEED = 1;
export const FX_POWER = 2;
export const FX_BIKE = 4;
export const FX_CONFUSED = 8;
export const FX_CHARGED = 16;
/** プロテイン（トレーナー）でひるまない */
export const FX_ARMOR = 128;
/** 3B の仕事（0〜2）を入れるビットの位置（256〜512） */
export const FX_JOB_SHIFT = 8;
export const fxJob = (fx: number) => (fx >> FX_JOB_SHIFT) & 3;
export const fxBuzz = (fx: number) => (fx >> 5) & 3;

export interface ViewProjectile {
  x: number;
  y: number;
  owner: number;
  kind: string;
}

/** ステージに置かれる物（壁・罠・一時的な足場） */
export interface ViewEntity {
  kind: 'wall' | 'trap' | 'popup' | 'food' | 'decoy' | 'drone' | 'item';
  x: number;
  y: number;
  owner: number;
  life: number;
  /** 分身の向き */
  dir: number;
}

export interface ViewState {
  frame: number;
  timeLeft: number;
  countdown: number;
  fighters: ViewFighter[];
  projectiles: ViewProjectile[];
  entities: ViewEntity[];
  events: GameEvent[];
  ended: boolean;
  /** 100人組手：倒した敵の数 */
  horde?: number;
}

export interface ResultEntry {
  slot: number;
  rank: number;
  kos: number;
  falls: number;
  score: number;
  /** 与えたダメージ（%） */
  dealt?: number;
  /** 投げた回数 */
  throws?: number;
}
