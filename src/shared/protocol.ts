// 端末とサーバーの間でやり取りするメッセージ（JSON）

import { COUNTDOWN_FRAMES, type FighterSnapshot } from './sim';
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
import type { TourMatch } from './tournament';

export const PROTOCOL_VERSION = 58;

/** 勝敗予想：試合が始まってから予想できる時間（フレーム。カウントダウンを含む） */
export const PREDICT_FRAMES = COUNTDOWN_FRAMES + 300;
/** 勝敗予想が当たったときのコイン（オッズ1倍のとき） */
export const PREDICT_REWARD = 15;
/** オッズの上限 */
export const PREDICT_MAX_ODDS = 5;

/**
 * 勝敗予想のオッズ（当たったときの倍率）。票が少ない選手ほど高い。
 * みんなの票を分け合う形（合計の票 ÷ その選手の票）に、選手ごとに1票ずつ足して、
 * 予想した人が少なくても極端にならないようにする。0.1 刻み・1〜5倍
 */
export function predictOdds(votes: number[], pick: number, candidates: number[]): number {
  const total = votes.length + candidates.length;
  const mine = votes.filter((v) => v === pick).length + 1;
  return Math.max(1, Math.min(PREDICT_MAX_ODDS, Math.floor((total / mine) * 10) / 10));
}

/** オッズを掛けたコイン */
export function predictCoins(odds: number): number {
  return Math.round(PREDICT_REWARD * odds);
}

/** 定型文のスタンプ（文字を打たずに気持ちを伝える。自由な文は送れない） */
// 新しいスタンプは最後に足す（番号で送るので、並びを変えない）
export const STAMPS = ['よろしく！', 'もう1戦！', 'GG', 'ナイス！', 'ありがとう', 'ちょっと待って', 'おめでとう！', '次こそ！', '予想当たった！', '乱入ありがとう！', 'いくぞ！', 'うまい！', 'ドンマイ！', 'くやしい〜', 'ルール変えない？', 'チーム分けしよう', 'キャラ変えるね', 'おつかれさま！', 'またね！'];
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
  /** 観戦している人の名前（対戦中に「見られている」ことを出すため） */
  watchers?: string[];
  /** 結果画面で「もう1戦したい」を押している人（slot） */
  again?: number[];
  /** 対戦の形式がトーナメント（ホストが選ぶ） */
  tourOn?: boolean;
  /** トーナメントの3位決定戦（決勝の前に行う） */
  tourThird?: boolean;
  /** 乱入アイテム（試合に出ていない人がアイテムを落とせる） */
  dropOn?: boolean;
  /** 進行中・終わったトーナメント */
  tour?: TourInfo;
}

/** トーナメントに出ている人（始めたときの名前とキャラ） */
export interface TourEntrant {
  slot: number;
  name: string;
  charId: string;
  cpu: boolean;
  cpuLevel: number;
}

export interface TourInfo {
  /** トーナメントごとの番号（優勝のごほうびを二重にもらわないため） */
  id: number;
  entrants: TourEntrant[];
  rounds: TourMatch[][];
  /** 3位決定戦（準決勝で負けた2人。なしのときは無い） */
  third?: TourMatch;
  /** 今戦っている試合 [回戦, 番号]（3位決定戦は [-1, 0]。試合と試合の間は null） */
  cur: [number, number] | null;
  /** 優勝した人の slot（まだなら -1） */
  champion: number;
  /** 次の試合が自動で始まるまで（ms。0 = 予定なし） */
  nextIn: number;
  /** 次の試合を予想できる人数と、そのうち予想した人数（試合と試合の間だけ） */
  need?: number;
  voted?: number;
}

/** 端末 → サーバー */
export type ClientMsg =
  /** rejoin：通信が切れた後に、同じ枠に戻る（welcome で受け取った合言葉を使う） */
  | { t: 'hello'; v: number; name: string; charId: string; create: boolean; costume?: string; costumes?: Record<string, string>; rejoin?: { slot: number; token: string }; spectate?: boolean; fh?: string }
  | { t: 'char'; charId: string; costume?: string; costumes?: Record<string, string> }
  /** チーム戦のチームを変える（自分の枠。ホストは slot でCPUの枠も変えられる） */
  | { t: 'team'; team: number; slot?: number }
  | { t: 'config'; rules: MatchRules; stageId: string; cpuCount: number; cpuLevel: number; tour?: boolean; tourThird?: boolean; dropOn?: boolean; cpuChars?: string[] }
  | { t: 'start' }
  /** 結果画面の「もう1戦したい」（on = 押した / 取り消した）。人が全員押すと再戦が始まる */
  | { t: 'again'; on: boolean }
  /** ロビーの「準備OK」 */
  | { t: 'ready'; on: boolean }
  /** 定型文のスタンプ（STAMPS の番号） */
  | { t: 'stamp'; id: number; pic?: 1; tier?: number }
  /** ホストが、ホストの役目をほかの人（slot）に譲る */
  | { t: 'host'; slot: number }
  /** ホストが、チームをおまかせで分ける（赤・青に同じ人数ずつ） */
  | { t: 'autoteam' }
  /** ホストが、ほかの人をルームから外す */
  | { t: 'kick'; slot: number }
  /** 乱入アイテム（アイテムの種類）。試合に出ていない人が、1試合に1回だけ落とせる */
  | { t: 'drop'; kind: number }
  /** 勝敗予想（勝つと思う選手の slot）。試合に出ていない人だけ */
  | { t: 'predict'; slot: number }
  /** 入力。s = 最初の入力の通し番号、i = 1フレームごとの [mx, my, ボタン] */
  | { t: 'in'; s: number; i: [number, number, number][] }
  | { t: 'ping'; c: number; r?: number }
  | { t: 'leave' };

/** サーバー → 端末 */
export type ServerMsg =
  /** token：通信が切れたときに同じ枠へ戻るための合言葉 */
  | { t: 'welcome'; slot: number; token: string }
  | { t: 'lobby'; lobby: LobbyInfo }
  | { t: 'start'; setup: MatchSetup }
  /** ステージおまかせのルーレット（stageId で止まる。少しあとに start が届く） */
  | { t: 'roulette'; stageId: string }
  /**
   * me = 受け取った人の選手について、処理済みの入力番号(a)と状態(st)。
   * d = 1 なら st は「前に送ってから変わった項目」だけ（通信を減らすため）。u = なくなった（undefined になった）項目
   */
  | { t: 'snap'; s: EncodedState; me?: { a: number; st: FighterSnapshot; d?: 1; u?: string[] } }
  | { t: 'end'; results: ResultEntry[] }
  /** ほかの人のお知らせ（抜けた・通信が切れた・戻ってきた） */
  | { t: 'notice'; msg: string }
  /** だれかが送ったスタンプ */
  | { t: 'stamp'; slot: number; name: string; id: number; pic?: 1; tier?: number }
  /** 乱入アイテムが落とされた（n = 落とした人、kind = 種類）。used = この試合でもう落とした人（端末のボタンを消すため） */
  | { t: 'dropped'; n: string; kind: number; used: string[] }
  /** 勝敗予想の一覧（n = 予想した人の名前、p = 勝つと思う選手の slot） */
  | { t: 'predicts'; list: { n: string; p: number }[] }
  | { t: 'pong'; c: number }
  | { t: 'error'; code: 'full' | 'taken' | 'notfound' | 'inmatch' | 'version' | 'bad' | 'kicked'; msg: string };

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
  /** サドンデス中 */
  sd?: 1;
  /** 延長中（エリア・王冠） */
  ot?: 1;
  /** 王冠うばい：[x, y, 持っている人, 出ている(1/0), 勝ちの時間, 番号, 時間, 番号, 時間...] */
  c?: number[];
  /** 金庫まもり：[赤の耐久, 青の耐久, 最大] */
  v?: number[];
  /** 賞金首：[賞金首, ...[slot, 点]] */
  bo?: number[];
  /** コイン集め：[落ちている数, ...[x*100, y*100, 枚数], ...[slot, 持っている枚数]] */
  co?: number[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const SHOT_KINDS = ['text', 'bullet', 'mail', 'malware', 'coin', 'thanks', 'badge', 'stone', 'bag', 'orb', 'gold', 'spark', 'packet', 'laser', 'comment', 'notif', 'capsule', 'scooter', 'beam', 'thread', 'phone', 'sound'];
const ENTITY_KINDS: ViewEntity['kind'][] = ['wall', 'trap', 'popup', 'food', 'decoy', 'drone', 'item', 'leash', 'call', 'heart'];

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
    ...(v.sudden ? { sd: 1 as const } : {}),
    ...(v.overtime ? { ot: 1 as const } : {}),
    ...(v.crown ? { c: [Math.round(v.crown.x * 100), Math.round(v.crown.y * 100), v.crown.holder, v.crown.on ? 1 : 0, v.crown.goal, v.crown.armor ?? 0, v.crown.armorMax ?? 0, ...v.crown.pts.flat()] } : {}),
    ...(v.bounty ? { bo: [v.bounty.holder, ...v.bounty.pts.flat()] } : {}),
    ...(v.coins ? { co: [v.coins.list.length, ...v.coins.list.flatMap((c) => [Math.round(c.x * 100), Math.round(c.y * 100), c.v]), ...v.coins.held.flat()] } : {}),
    ...(v.vault ? { v: [Math.round(v.vault.hp[0] * 10) / 10, Math.round(v.vault.hp[1] * 10) / 10, v.vault.max] } : {}),
    ...(v.ball ? { b: [Math.round(v.ball.x * 100), Math.round(v.ball.y * 100), Math.round(v.ball.vx * 10), v.ball.on ? 1 : 0, v.ball.score[0], v.ball.score[1], v.ball.target, v.ball.holder ?? -1, v.ball.lock ?? -1] } : {}),
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
    sudden: s.sd === 1 || undefined,
    overtime: s.ot === 1 || undefined,
    crown: s.c
      ? {
          x: s.c[0] / 100,
          y: s.c[1] / 100,
          holder: s.c[2],
          on: s.c[3] === 1,
          goal: s.c[4],
          armor: s.c[5],
          armorMax: s.c[6],
          pts: Array.from({ length: Math.floor((s.c.length - 7) / 2) }, (_, k) => [s.c![7 + k * 2], s.c![8 + k * 2]] as [number, number]),
        }
      : undefined,
    vault: s.v ? { hp: [s.v[0], s.v[1]], max: s.v[2] } : undefined,
    bounty: s.bo ? { holder: s.bo[0], pts: pairs(s.bo, 1) } : undefined,
    coins: s.co
      ? {
          list: Array.from({ length: s.co[0] }, (_, k) => ({ x: s.co![1 + k * 3] / 100, y: s.co![2 + k * 3] / 100, v: s.co![3 + k * 3] })),
          held: pairs(s.co, 1 + s.co[0] * 3),
        }
      : undefined,
    ball: s.b ? { x: s.b[0] / 100, y: s.b[1] / 100, vx: s.b[2] / 10, on: s.b[3] === 1, score: [s.b[4], s.b[5]], target: s.b[6], holder: s.b[7] ?? -1, lock: s.b[8] ?? -1 } : undefined,
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

/** a[from] から先を [番号, 値] の組に分ける */
function pairs(a: number[], from: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = from; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]);
  return out;
}
