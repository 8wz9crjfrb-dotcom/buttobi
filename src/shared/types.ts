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
  | 'respawn';

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
  | 'grab';

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
}

export interface ViewProjectile {
  x: number;
  y: number;
  owner: number;
}

export interface ViewState {
  frame: number;
  timeLeft: number;
  countdown: number;
  fighters: ViewFighter[];
  projectiles: ViewProjectile[];
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
