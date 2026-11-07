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
  | 'sleep';

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
  | 'charge';

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
];

export type RuleMode = 'stock' | 'time';

export interface MatchRules {
  mode: RuleMode;
  stocks: number;
  /** 制限時間（秒） */
  timeLimit: number;
}

export const DEFAULT_RULES: MatchRules = { mode: 'stock', stocks: 3, timeLimit: 180 };

export interface PlayerSetup {
  slot: number;
  name: string;
  charId: string;
  cpu: boolean;
  cpuLevel: number;
  /** 衣装の id（未指定ならいつもの服） */
  costume?: string;
}

export interface MatchSetup {
  players: PlayerSetup[];
  stageId: string;
  rules: MatchRules;
  seed: number;
}

/** 演出用のイベント（ヒット・撃墜など） */
export type GameEvent =
  | { k: 'hit'; x: number; y: number; p: number; s: number }
  | { k: 'shield'; x: number; y: number }
  | { k: 'ko'; x: number; y: number; s: number }
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
  | { k: 'shot'; s: number };

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
  /** 状態のビット：1=倍速 2=課金 4=自転車 8=操作反転 16=吸収済み、32〜64=バズり段階（0〜3） */
  fx: number;
}

export const FX_SPEED = 1;
export const FX_POWER = 2;
export const FX_BIKE = 4;
export const FX_CONFUSED = 8;
export const FX_CHARGED = 16;
export const fxBuzz = (fx: number) => (fx >> 5) & 3;

export interface ViewProjectile {
  x: number;
  y: number;
  owner: number;
  kind: string;
}

/** ステージに置かれる物（壁・罠・一時的な足場） */
export interface ViewEntity {
  kind: 'wall' | 'trap' | 'popup' | 'food' | 'decoy' | 'drone';
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
}

export interface ResultEntry {
  slot: number;
  rank: number;
  kos: number;
  falls: number;
  score: number;
}
