// 端末とサーバーの間でやり取りするメッセージ（JSON）

import type { FighterSnapshot } from './sim';
import {
  MOVE_IDS,
  STATE_NAMES,
  type GameEvent,
  type MatchRules,
  type MatchSetup,
  type ResultEntry,
  type ViewEntity,
  type ViewState,
} from './types';

export const PROTOCOL_VERSION = 6;
export const MAX_PLAYERS = 6;

export interface LobbyPlayer {
  slot: number;
  name: string;
  charId: string;
  cpu: boolean;
  cpuLevel: number;
  connected: boolean;
}

export interface LobbyInfo {
  code: string;
  hostSlot: number;
  players: LobbyPlayer[];
  rules: MatchRules;
  stageId: string;
  inMatch: boolean;
}

/** 端末 → サーバー */
export type ClientMsg =
  | { t: 'hello'; v: number; name: string; charId: string; create: boolean }
  | { t: 'char'; charId: string }
  | { t: 'config'; rules: MatchRules; stageId: string; cpuCount: number; cpuLevel: number }
  | { t: 'start' }
  /** 入力。s = 最初の入力の通し番号、i = 1フレームごとの [mx, my, ボタン] */
  | { t: 'in'; s: number; i: [number, number, number][] }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

/** サーバー → 端末 */
export type ServerMsg =
  | { t: 'welcome'; slot: number }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'start'; setup: MatchSetup }
  /** me = 受け取った人の選手について、処理済みの入力番号(a)と完全な状態(st) */
  | { t: 'snap'; s: EncodedState; me?: { a: number; st: FighterSnapshot } }
  | { t: 'end'; results: ResultEntry[] }
  | { t: 'pong'; c: number }
  | { t: 'error'; code: 'full' | 'taken' | 'notfound' | 'inmatch' | 'version' | 'bad'; msg: string };

export interface EncodedState {
  f: number; // frame
  tl: number; // timeLeft
  cd: number; // countdown
  e: 0 | 1; // ended
  p: number[][]; // fighters
  q: number[][]; // projectiles
  n: number[][]; // entities
  ev: GameEvent[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const SHOT_KINDS = ['text', 'bullet', 'mail', 'malware', 'coin', 'thanks', 'badge', 'stone', 'bag', 'orb', 'gold', 'spark'];
const ENTITY_KINDS: ViewEntity['kind'][] = ['wall', 'trap', 'popup', 'food', 'decoy', 'drone'];

export function encodeState(v: ViewState, events: GameEvent[]): EncodedState {
  return {
    f: v.frame,
    tl: v.timeLeft,
    cd: v.countdown,
    e: v.ended ? 1 : 0,
    p: v.fighters.map((f) => [
      f.slot,
      Math.round(f.x * 100),
      Math.round(f.y * 100),
      f.facing,
      STATE_NAMES.indexOf(f.state),
      f.stateTime,
      f.move ? MOVE_IDS.indexOf(f.move) : -1,
      f.moveFrame,
      Math.round(f.damage * 10),
      f.stocks,
      (f.invuln ? 1 : 0) | (f.out ? 2 : 0) | (f.poison ? 4 : 0),
      Math.round(f.shield * 100),
      f.charge,
      f.kos,
      f.falls,
      f.fx,
    ]),
    q: v.projectiles.map((p) => [Math.round(p.x * 100), Math.round(p.y * 100), p.owner, Math.max(0, SHOT_KINDS.indexOf(p.kind))]),
    n: v.entities.map((e) => [ENTITY_KINDS.indexOf(e.kind), Math.round(e.x * 100), Math.round(e.y * 100), e.owner, e.life, e.dir]),
    ev: events.map((e) => ('x' in e ? { ...e, x: r2(e.x), y: r2(e.y) } : e)),
  };
}

export function decodeState(s: EncodedState): ViewState {
  return {
    frame: s.f,
    timeLeft: s.tl,
    countdown: s.cd,
    ended: s.e === 1,
    fighters: s.p.map((a) => ({
      slot: a[0],
      x: a[1] / 100,
      y: a[2] / 100,
      facing: a[3],
      state: STATE_NAMES[a[4]] ?? 'idle',
      stateTime: a[5],
      move: a[6] >= 0 ? MOVE_IDS[a[6]] : null,
      moveFrame: a[7],
      damage: a[8] / 10,
      stocks: a[9],
      invuln: (a[10] & 1) !== 0,
      out: (a[10] & 2) !== 0,
      poison: (a[10] & 4) !== 0,
      fx: a[15] ?? 0,
      shield: a[11] / 100,
      charge: a[12],
      kos: a[13],
      falls: a[14],
    })),
    projectiles: s.q.map((a) => ({ x: a[0] / 100, y: a[1] / 100, owner: a[2], kind: SHOT_KINDS[a[3]] ?? 'bullet' })),
    entities: (s.n ?? []).map((a) => ({ kind: ENTITY_KINDS[a[0]] ?? 'wall', x: a[1] / 100, y: a[2] / 100, owner: a[3], life: a[4], dir: a[5] ?? 1 })),
    events: s.ev,
  };
}

/** 1通のメッセージに入れる入力の最大数 */
export const MAX_INPUTS_PER_MSG = 12;

export function sanitizeName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  const cleaned = s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10);
  return cleaned || 'プレイヤー';
}

export function isRoomCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}
