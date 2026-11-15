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

export const PROTOCOL_VERSION = 23;

/** 定型文のスタンプ（文字を打たずに気持ちを伝える。自由な文は送れない） */
export const STAMPS = ['よろしく！', 'もう1戦！', 'GG', 'ナイス！', 'ありがとう', 'ちょっと待って'];
export const MAX_PLAYERS = 6;

export interface LobbyPlayer {
  slot: number;
  name: string;
  charId: string;
  cpu: boolean;
  cpuLevel: number;
  connected: boolean;
  /** 着ている衣装 */
  costume?: string;
  /** チーム（0〜3） */
  team?: number;
  /** ロビーで「準備OK」を押している（ホストはいつも準備OK） */
  ready?: boolean;
  /** フレンドコードの印（friendHash）。フレンドと一緒に戦った回数を数えるのに使う */
  fh?: string;
}

export interface LobbyInfo {
  code: string;
  hostSlot: number;
  players: LobbyPlayer[];
  rules: MatchRules;
  stageId: string;
  inMatch: boolean;
  /** 観戦している人数 */
  spectators?: number;
  /** 結果画面で「もう1戦したい」を押している人（slot） */
  again?: number[];
}

/** 端末 → サーバー */
export type ClientMsg =
  /** rejoin：通信が切れた後に、同じ枠に戻る（welcome で受け取った合言葉を使う） */
  | { t: 'hello'; v: number; name: string; charId: string; create: boolean; costume?: string; rejoin?: { slot: number; token: string }; spectate?: boolean; fh?: string }
  | { t: 'char'; charId: string; costume?: string }
  /** チーム戦のチームを変える（自分の枠。ホストは slot でCPUの枠も変えられる） */
  | { t: 'team'; team: number; slot?: number }
  | { t: 'config'; rules: MatchRules; stageId: string; cpuCount: number; cpuLevel: number }
  | { t: 'start' }
  /** 結果画面の「もう1戦したい」（on = 押した / 取り消した）。人が全員押すと再戦が始まる */
  | { t: 'again'; on: boolean }
  /** ロビーの「準備OK」 */
  | { t: 'ready'; on: boolean }
  /** 定型文のスタンプ（STAMPS の番号） */
  | { t: 'stamp'; id: number }
  /** 入力。s = 最初の入力の通し番号、i = 1フレームごとの [mx, my, ボタン] */
  | { t: 'in'; s: number; i: [number, number, number][] }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

/** サーバー → 端末 */
export type ServerMsg =
  /** token：通信が切れたときに同じ枠へ戻るための合言葉 */
  | { t: 'welcome'; slot: number; token: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'start'; setup: MatchSetup }
  /** me = 受け取った人の選手について、処理済みの入力番号(a)と完全な状態(st) */
  | { t: 'snap'; s: EncodedState; me?: { a: number; st: FighterSnapshot } }
  | { t: 'end'; results: ResultEntry[] }
  /** ほかの人のお知らせ（抜けた・通信が切れた・戻ってきた） */
  | { t: 'notice'; msg: string }
  /** だれかが送ったスタンプ */
  | { t: 'stamp'; slot: number; name: string; id: number }
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
  /** エリアバトル：[x1,x2,y1,y2,holder] のエリア、次のエリア、移るまで、ゲージ [番号,値...]、満タン */
  a?: { z: number[][]; x: number[][]; i: number; g: number[]; o: number };
  /** 玉入れ：[x, y, vx, 出ている(1/0), 赤の点, 青の点, 先取点] */
  b?: number[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const SHOT_KINDS = ['text', 'bullet', 'mail', 'malware', 'coin', 'thanks', 'badge', 'stone', 'bag', 'orb', 'gold', 'spark', 'packet', 'laser', 'comment', 'notif', 'capsule', 'scooter', 'beam'];
const ENTITY_KINDS: ViewEntity['kind'][] = ['wall', 'trap', 'popup', 'food', 'decoy', 'drone', 'item'];

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
    ...(v.ball ? { b: [Math.round(v.ball.x * 100), Math.round(v.ball.y * 100), Math.round(v.ball.vx * 10), v.ball.on ? 1 : 0, v.ball.score[0], v.ball.score[1], v.ball.target] } : {}),
    ...(v.area
      ? {
          a: {
            z: v.area.zones.map((z) => [Math.round(z.x1 * 100), Math.round(z.x2 * 100), Math.round(z.y1 * 100), Math.round(z.y2 * 100), z.holder]),
            x: v.area.next.map((z) => [Math.round(z.x1 * 100), Math.round(z.x2 * 100), Math.round(z.y1 * 100), Math.round(z.y2 * 100)]),
            i: v.area.nextIn,
            g: v.area.gauges.flat(),
            o: v.area.goal,
          },
        }
      : {}),
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
    ball: s.b ? { x: s.b[0] / 100, y: s.b[1] / 100, vx: s.b[2] / 10, on: s.b[3] === 1, score: [s.b[4], s.b[5]], target: s.b[6] } : undefined,
    area: s.a
      ? {
          zones: s.a.z.map((a) => ({ x1: a[0] / 100, x2: a[1] / 100, y1: a[2] / 100, y2: a[3] / 100, holder: a[4] })),
          next: s.a.x.map((a) => ({ x1: a[0] / 100, x2: a[1] / 100, y1: a[2] / 100, y2: a[3] / 100 })),
          nextIn: s.a.i,
          gauges: Array.from({ length: Math.floor(s.a.g.length / 2) }, (_, k) => [s.a!.g[k * 2], s.a!.g[k * 2 + 1]] as [number, number]),
          goal: s.a.o,
        }
      : undefined,
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
