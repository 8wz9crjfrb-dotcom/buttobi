// 対戦サーバー（Cloudflare Workers + Durable Objects）
// URL: wss://<worker>/room/<4桁コード>  → そのコードのルーム（Durable Object）につながる

import { DurableObject } from 'cloudflare:workers';
import { CpuController } from '../../src/shared/ai';
import { CHARACTERS, RANDOM_CHAR, nameCpus } from '../../src/shared/characters';
import { ITEMS } from '../../src/shared/moves';
import { COSTUMES } from '../../src/shared/costumes';
import {
  MAX_INPUTS_PER_MSG,
  MAX_PLAYERS,
  STAMPS,
  PREDICT_FRAMES,
  PROTOCOL_VERSION,
  encodeState,
  isRoomCode,
  sanitizeName,
  type ClientMsg,
  type LobbyInfo,
  type LobbyPlayer,
  type TourInfo,
  type ServerMsg,
} from '../../src/shared/protocol';
import { LAG_COMP_MAX, Sim } from '../../src/shared/sim';
import { isFriendHash, PIC_STAMP_COUNT } from '../../src/shared/social';
import { MAX_BYTES, makeTransferCode, normalizeTransferCode, TransferBox } from './transfer';
import { RANDOM_STAGE, resolveStage, STAGES } from '../../src/shared/stages';
import { DEFAULT_HP, DEFAULT_RULES, isTwoTeam, TEAM_COUNT, type GameEvent, type InputState, type MatchRules, type MatchSetup } from '../../src/shared/types';

export { TransferBox } from './transfer';
export { Social } from './social';
import type { Social } from './social';
import { canHaveThird, champion, makeBracket, matchAt, nextMatch, setWinner } from '../../src/shared/tournament';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  TRANSFERS: DurableObjectNamespace<TransferBox>;
  SOCIAL: DurableObjectNamespace<Social>;
}

/** ブラウザ（別のドメインのページ）から呼べるようにするヘッダー */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const cors = (res: Response) => {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
  return r;
};

/** データ引き継ぎ（transfer.ts） */
async function handleTransfer(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return cors(new Response('POST only', { status: 405 }));
  if (path === '/transfer') {
    const body = await req.text();
    if (body.length > MAX_BYTES) return cors(new Response('too large', { status: 413 }));
    try {
      JSON.parse(body);
    } catch {
      return cors(new Response('bad', { status: 400 }));
    }
    // まれにコードがかぶったら作り直す
    for (let i = 0; i < 3; i++) {
      const code = makeTransferCode();
      const res = await env.TRANSFERS.get(env.TRANSFERS.idFromName(code)).fetch('https://box/put', { method: 'POST', body });
      if (res.status === 409) continue;
      const { expires } = (await res.json()) as { expires: number };
      return cors(Response.json({ code, expires }));
    }
    return cors(new Response('busy', { status: 503 }));
  }
  const code = normalizeTransferCode(decodeURIComponent(path.slice('/transfer/'.length)));
  if (!code) return cors(new Response('bad code', { status: 400 }));
  const res = await env.TRANSFERS.get(env.TRANSFERS.idFromName(code)).fetch('https://box/take', { method: 'POST' });
  return cors(res);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/transfer' || url.pathname.startsWith('/transfer/')) return handleTransfer(req, env, url.pathname);
    // フレンド機能（全員ぶんを1つで管理する）
    if (url.pathname === '/social') return env.SOCIAL.get(env.SOCIAL.idFromName('global')).fetch(req);
    const m = url.pathname.match(/^\/room\/(\d{4})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only', { status: 426 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
      return stub.fetch(req);
    }
    if (url.pathname === '/') {
      return new Response('buttobi server ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    return new Response('not found', { status: 404 });
  },
};

interface Attachment {
  slot: number;
  /** 観戦している人の名前と番号（勝敗予想に使う） */
  name?: string;
  sid?: number;
}

interface StoredHuman {
  slot: number;
  name: string;
  charId: string;
  costume?: string;
  /** キャラごとに着ている衣装（キャラ「おまかせ」で決まったキャラに着せる） */
  costumes?: Record<string, string>;
  /** チーム戦のチーム */
  team?: number;
  /** 通信が切れたときに同じ枠へ戻るための合言葉 */
  token: string;
  /** 通信が切れた時刻（つながっている間は 0）。猶予の間は枠を残す */
  goneAt: number;
  /** ロビーで「準備OK」を押している */
  ready?: boolean;
  /** フレンドコードの印（コードそのものではない） */
  fh?: string;
}

interface StoredLobby {
  code: string;
  hostSlot: number;
  humans: StoredHuman[];
  rules: MatchRules;
  stageId: string;
  cpuCount: number;
  cpuLevel: number;
  /** ホストが決めたCPUのチーム（slot → チーム） */
  cpuTeams?: Record<number, number>;
  /** ホストが決めたCPUのキャラ（CPUの順番ごと。'random' = おまかせ） */
  cpuChars?: string[];
  /** ホストに外された人（フレンド用の番号）。同じルームには入り直せない */
  kickedFh?: string[];
  /** 結果画面で「もう1戦したい」を押している人（slot） */
  again?: number[];
  /** 対戦の形式がトーナメント */
  tourOn?: boolean;
  /** トーナメントの3位決定戦（なし = false） */
  tourThird?: boolean;
  /** 乱入アイテム（なし = false） */
  dropOn?: boolean;
  /** 進行中・終わったトーナメント（nextIn は送るときに計算する） */
  tour?: Omit<TourInfo, 'nextIn'>;
}

/** トーナメント：次の試合が自動で始まるまで（ms）。予想する人がいないとき */
const TOUR_NEXT_MS = 15_000;
/** ステージおまかせのルーレットを見せる時間（端末の ROULETTE_MS より少し長く） */
const ROULETTE_WAIT_MS = 2600;
/** 予想する人がいるとき：全員が予想し終えるのを待つ最長の時間（だれかが放置しても進むように） */
const TOUR_VOTE_MS = 30_000;
/** 全員が予想し終えてから試合が始まるまで（最後の票とオッズを見る時間） */
const TOUR_VOTED_MS = 3_000;

/** チームの番号を 0〜3 に収める */
function validTeam(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < TEAM_COUNT ? n : undefined;
}

interface InputQueue {
  items: { seq: number; inp: InputState }[];
  lastQueued: number;
  last: InputState;
  /** 最後に使った入力の番号（端末に「ここまで処理した」と伝える） */
  ack: number;
}

const TICK_MS = 1000 / 60;
/** 入力の通し番号がこれ以上戻ったら、端末が数え直した（新しい試合）とみなす */
const RESTART_GAP = 120;
/** 待ち行列がこれより長い間は、1フレームにつき入力を1つだけ間引いて少しずつ追いつく */
const QUEUE_SOFT = 6;
/** これより長くなったら（通信が長く止まった等）、一気に QUEUE_SOFT まで捨てる */
const QUEUE_HARD = 40;
const SNAP_EVERY = 2; // 60fps のうち 2 フレームに 1 回送る = 30回/秒
/** 端末が相手の表示をなめらかにするために遅らせている時間（ms。src/client/net.ts の INTERP_DELAY と同じ） */
const CLIENT_INTERP_MS = 80;
/** 通信が切れてから、同じ枠に戻れる時間（ms） */
const REJOIN_GRACE = 60_000;
/** 観戦できる人数 */
const MAX_SPECTATORS = 8;
/** 観戦している人の印（slot の代わり） */
const SPECTATOR = -2;

/** そのキャラの衣装として正しければ id を、そうでなければ undefined を返す */
/** 選べるキャラか（オンラインでは「おまかせ」も選べる） */
function validChar(id: unknown): id is string {
  return id === RANDOM_CHAR || CHARACTERS.some((c) => c.id === id);
}
/** 試合で使うキャラ：「おまかせ」なら、ここでランダムに決める（衣装はいつもの服） */
function pickChar(charId: string, costume: string | undefined, costumes?: Record<string, string>): { charId: string; costume: string | undefined } {
  if (charId !== RANDOM_CHAR) return { charId, costume };
  const id = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id;
  return { charId: id, costume: costumes?.[id] };
}
/** キャラごとの衣装の一覧を確かめる（そのキャラの衣装だけ残す） */
function validCostumes(m: unknown): Record<string, string> | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const c of CHARACTERS) {
    const v = validCostume(c.id, (m as Record<string, unknown>)[c.id]);
    if (v) out[c.id] = v;
  }
  return out;
}

function validCostume(charId: string, id: unknown): string | undefined {
  return typeof id === 'string' && COSTUMES.some((c) => c.id === id && c.charId === charId) ? id : undefined;
}

function makeToken(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room extends DurableObject<Env> {
  /** スタンプを最後に送った時刻（slot ごと） */
  private lastStamp = new Map<number, number>();
  private lobby: StoredLobby | null = null;
  private sim: Sim | null = null;
  private cpu: CpuController | null = null;
  private cpuSlots = new Map<number, number>(); // slot -> level
  /** 選手ごとの入力の待ち行列（1フレームに1つずつ使う） */
  private queues = new Map<number, InputQueue>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private eventBuf: GameEvent[] = [];
  /** 対戦中の設定（途中で戻ってきた人に送る） */
  private setup: MatchSetup | null = null;
  /** トーナメント：次の試合が自動で始まる時刻（0 = 予定なし） */
  private tourNextAt = 0;
  private tourTimer: ReturnType<typeof setTimeout> | null = null;
  /** 勝敗予想（予想した人 → 名前と勝つと思う選手）。人は "h<slot>"、観戦は "s<番号>" */
  private predicts = new Map<string, { n: string; p: number }>();
  private nextSid = 1;
  /** この試合で乱入アイテムを落とした人（"h<slot>" / "s<番号>"） */
  private dropUsed = new Set<string>();

  /** 今予想できる試合の選手（予想できないときは null） */
  private predictTargets(): number[] | null {
    const l = this.lobby;
    if (!l) return null;
    if (this.sim && this.setup) {
      const r = this.setup.rules;
      // チームで勝ち負けが決まるルールと100人組手は予想しない
      // トーナメントの試合は、試合と試合の間にだけ予想する（試合が始まったら締め切り）
      if (r.teams || isTwoTeam(r.mode) || r.horde || l.tourOn || this.sim.frame >= PREDICT_FRAMES) return null;
      return this.setup.players.map((p) => p.slot);
    }
    // トーナメントの合間：次の試合
    const t = l.tourOn ? l.tour : undefined;
    if (!t || t.champion >= 0) return null;
    const nm = nextMatch(t.rounds, t.third);
    if (!nm) return null;
    const m = matchAt(t.rounds, t.third, nm[0], nm[1])!;
    return [m.a, m.b];
  }

  private pushPredicts(): void {
    this.broadcast({ t: 'predicts', list: [...this.predicts.values()] });
  }

  /** トーナメントの合間：予想できる人（次の試合に出ない、つながっている人）と、そのうち予想した人数 */
  private tourVotes(): { need: number; voted: number } {
    const l = this.lobby;
    const targets = !this.sim ? this.predictTargets() : null;
    if (!l || !targets) return { need: 0, voted: 0 };
    const connected = this.connectedSlots();
    const voters = l.humans.filter((h) => connected.has(h.slot) && !targets.includes(h.slot));
    return { need: voters.length, voted: voters.filter((h) => this.predicts.has(`h${h.slot}`)).length };
  }

  /** トーナメントの次の試合を ms 後に始める（すでに早い予定があればそのまま） */
  private scheduleTour(ms: number, keepEarlier = false): void {
    const at = Date.now() + ms;
    if (keepEarlier && this.tourNextAt && this.tourNextAt <= at) return;
    if (this.tourTimer) clearTimeout(this.tourTimer);
    const t = this.lobby?.tour;
    this.tourNextAt = at;
    this.tourTimer = setTimeout(() => {
      this.tourTimer = null;
      this.tourNextAt = 0;
      if (!this.sim && this.lobby?.tour === t && this.connectedSlots().size > 0) this.startTour();
    }, ms);
  }

  /** トーナメントの合間の待ち時間を決める：予想する人がいれば、全員が予想し終えたら少しして始める */
  private planTourNext(first = false): void {
    const { need, voted } = this.tourVotes();
    if (need > 0 && voted >= need) this.scheduleTour(TOUR_VOTED_MS, true);
    else if (first) this.scheduleTour(need > 0 ? TOUR_VOTE_MS : TOUR_NEXT_MS);
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.lobby = (await ctx.storage.get<StoredLobby>('lobby')) ?? null;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.pathname.split('/').pop() ?? '';
    if (!isRoomCode(code)) return new Response('bad code', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ slot: -1, code } as Attachment & { code: string });
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------
  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 切断済み */
    }
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || (a.slot < 0 && a.slot !== SPECTATOR)) continue;
      try {
        ws.send(data);
      } catch {
        /* 切断済み */
      }
    }
  }

  /** 1つの接続を除いて全員に送る（戻ってきた本人には送らない） */
  private broadcastExcept(except: WebSocket, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || (a.slot < 0 && a.slot !== SPECTATOR)) continue;
      try {
        ws.send(data);
      } catch {
        /* 切断済み */
      }
    }
  }

  private connectedSlots(): Set<number> {
    const s = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.slot >= 0) s.add(a.slot);
    }
    return s;
  }

  private watcherNames(): string[] {
    const names: string[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.slot === SPECTATOR) names.push(a.name || '観戦者');
    }
    return names;
  }

  private spectatorCount(): number {
    let n = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.slot === SPECTATOR) n++;
    }
    return n;
  }

  private async save(): Promise<void> {
    if (this.lobby) await this.ctx.storage.put('lobby', this.lobby);
    else await this.ctx.storage.delete('lobby');
  }

  private lobbyInfo(): LobbyInfo {
    const l = this.lobby!;
    const connected = this.connectedSlots();
    const players: LobbyPlayer[] = l.humans.map((h) => ({ slot: h.slot, name: h.name, charId: h.charId, costume: h.costume, cpu: false, cpuLevel: 0, connected: connected.has(h.slot), team: h.team ?? h.slot % 2, ready: h.slot === l.hostSlot || !!h.ready, ...(h.fh ? { fh: h.fh } : {}) }));
    if (this.sim) {
      for (const [slot, level] of this.cpuSlots) {
        if (players.some((p) => p.slot === slot)) continue;
        const f = this.sim.fighter(slot);
        players.push({ slot, name: `CPU ${level}`, charId: f?.def.id ?? 'mira', cpu: true, cpuLevel: level, connected: true, team: this.sim.setup.players.find((p) => p.slot === slot)?.team ?? 0 });
      }
    } else {
      const used = new Set(players.map((p) => p.slot));
      let added = 0;
      for (let s = 0; s < MAX_PLAYERS && added < l.cpuCount; s++) {
        if (used.has(s)) continue;
        players.push({ slot: s, name: `CPU ${l.cpuLevel}`, charId: l.cpuChars?.[added] ?? RANDOM_CHAR, cpu: true, cpuLevel: l.cpuLevel, connected: true, team: l.cpuTeams?.[s] ?? s % 2 });
        added++;
      }
    }
    players.sort((a, b) => a.slot - b.slot);
    // CPU はキャラで見分けられる名前に（「CPU 配信者」など）
    nameCpus(players);
    const tour: TourInfo | undefined = l.tour ? { ...l.tour, nextIn: !this.sim && this.tourNextAt ? Math.max(0, this.tourNextAt - Date.now()) : 0, ...this.tourVotes() } : undefined;
    return { code: l.code, hostSlot: l.hostSlot, players, rules: l.rules, stageId: l.stageId, inMatch: !!this.sim || !!this.rouletteSetup, spectators: this.spectatorCount(), watchers: this.watcherNames(), again: l.again ?? [], tourOn: !!l.tourOn, tourThird: l.tourThird !== false, dropOn: l.dropOn !== false, ...(tour ? { tour } : {}) };
  }

  private pushLobby(): void {
    if (this.lobby) this.broadcast({ t: 'lobby', lobby: this.lobbyInfo() });
  }

  // ---------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as (Attachment & { code?: string }) | null;
    const slot = att?.slot ?? -1;

    if (msg.t === 'ping') {
      // 往復の時間を覚えておく（当たり判定の巻き戻しに使う）
      if (slot >= 0 && typeof msg.r === 'number' && msg.r > 0 && msg.r < 2000) this.rtt.set(slot, msg.r);
      return this.send(ws, { t: 'pong', c: msg.c });
    }

    if (msg.t === 'hello') {
      if (slot >= 0) return;
      if (msg.v !== PROTOCOL_VERSION) {
        this.send(ws, { t: 'error', code: 'version', msg: 'バージョンが違います。ページを再読み込みしてください。' });
        return ws.close(1000, 'version');
      }
      const connected = this.connectedSlots();
      // 通信が切れた人が、同じ枠に戻ってきた
      if (msg.rejoin && this.lobby) {
        const r = msg.rejoin;
        const h = this.lobby.humans.find((x) => x.slot === r.slot && x.token === r.token);
        // 前の接続がまだ残っている（電波が急に切れて、サーバーが切断に気づいていない）：合言葉が合っているので、新しい接続に置き換える
        if (h && connected.has(h.slot)) {
          for (const old of this.ctx.getWebSockets()) {
            if (old === ws) continue;
            const oa = old.deserializeAttachment() as Attachment | null;
            if (oa && oa.slot === h.slot) {
              old.serializeAttachment({ slot: -1 });
              try {
                old.close(1000, 'replaced');
              } catch {
                /* 切れている */
              }
            }
          }
          connected.delete(h.slot);
          if (this.sim) this.queues.delete(h.slot);
        }
        // 対戦中は、試合が終わるまでいつでも戻れる（アプリを閉じた・自分で抜けた人も）
        if (h && !connected.has(h.slot) && (h.goneAt === 0 || !!this.sim || Date.now() - h.goneAt < REJOIN_GRACE)) {
          h.goneAt = 0;
          ws.serializeAttachment({ slot: h.slot, code: this.lobby.code });
          if (this.sim) {
            // CPU が代わりに動かしていたのをやめ、入力の番号を最初から数え直す
            if (this.setup?.players.some((p) => p.slot === h.slot && !p.cpu)) this.cpuSlots.delete(h.slot);
            this.queues.delete(h.slot);
          }
          await this.save();
          this.send(ws, { t: 'welcome', slot: h.slot, token: h.token });
          this.send(ws, { t: 'lobby', lobby: this.lobbyInfo() });
          if (this.sim && this.setup) this.send(ws, { t: 'start', setup: this.setup });
          this.pushLobby();
          this.broadcastExcept(ws, { t: 'notice', msg: `${h.name} さんが戻ってきました` });
          return;
        }
        // 戻れなかった（試合が終わってルームから外れた、時間が過ぎた など）
        this.send(ws, { t: 'error', code: 'notfound', msg: '前の対戦には戻れませんでした（対戦が終わったか、時間が過ぎました）。' });
        return ws.close(1000, 'notfound');
      }
      const active = this.lobby && this.lobby.humans.some((h) => connected.has(h.slot));
      // 観戦：満員でも対戦中でも、見るだけなら入れる
      if (msg.spectate) {
        if (!active || !this.lobby) {
          this.send(ws, { t: 'error', code: 'notfound', msg: 'ルームが見つかりません。コードを確認してください。' });
          return ws.close(1000, 'notfound');
        }
        if (this.spectatorCount() >= MAX_SPECTATORS) {
          this.send(ws, { t: 'error', code: 'full', msg: '観戦の人数がいっぱいです。' });
          return ws.close(1000, 'full');
        }
        ws.serializeAttachment({ slot: SPECTATOR, code: this.lobby.code, name: sanitizeName(msg.name), sid: this.nextSid++ });
        this.send(ws, { t: 'welcome', slot: -1, token: '' });
        this.send(ws, { t: 'lobby', lobby: this.lobbyInfo() });
        if (this.sim && this.setup) this.send(ws, { t: 'start', setup: this.setup });
        if (this.predicts.size) this.send(ws, { t: 'predicts', list: [...this.predicts.values()] });
        this.pushLobby();
        return;
      }
      if (msg.create && active) {
        this.send(ws, { t: 'error', code: 'taken', msg: 'このコードは使用中です。' });
        return ws.close(1000, 'taken');
      }
      if (!msg.create && !active) {
        this.send(ws, { t: 'error', code: 'notfound', msg: 'ルームが見つかりません。コードを確認してください。' });
        return ws.close(1000, 'notfound');
      }
      // ホストに外された人は、同じルームに入り直せない
      if (active && isFriendHash(msg.fh) && this.lobby?.kickedFh?.includes(msg.fh)) {
        this.send(ws, { t: 'error', code: 'kicked', msg: 'このルームには入れません（ホストに外されました）。' });
        return ws.close(1000, 'kicked');
      }
      if (!active) {
        this.lobby = {
          code: att?.code ?? '0000',
          hostSlot: 0,
          humans: [],
          rules: { ...DEFAULT_RULES },
          // ステージは「おまかせ」から
          stageId: RANDOM_STAGE,
          cpuCount: 0,
          cpuLevel: 3,
        };
        this.stopMatch();
        this.clearTourTimer();
      }
      const l = this.lobby!;
      if (this.sim) {
        this.send(ws, { t: 'error', code: 'inmatch', msg: '対戦中です。終わるまで待ってください。' });
        return ws.close(1000, 'inmatch');
      }
      l.humans = l.humans.filter((h) => connected.has(h.slot) || (h.goneAt > 0 && Date.now() - h.goneAt < REJOIN_GRACE));
      if (l.humans.length >= MAX_PLAYERS) {
        this.send(ws, { t: 'error', code: 'full', msg: 'ルームが満員です（最大6人）。' });
        return ws.close(1000, 'full');
      }
      let s = 0;
      while (l.humans.some((h) => h.slot === s)) s++;
      const charId = validChar(msg.charId) ? msg.charId : CHARACTERS[0].id;
      const token = makeToken();
      l.humans.push({ slot: s, name: sanitizeName(msg.name), charId, costume: validCostume(charId, msg.costume), costumes: validCostumes(msg.costumes), token, goneAt: 0, ...(isFriendHash(msg.fh) ? { fh: msg.fh } : {}) });
      if (l.humans.length === 1 || !l.humans.some((h) => h.slot === l.hostSlot)) l.hostSlot = s;
      l.cpuCount = Math.min(l.cpuCount, MAX_PLAYERS - l.humans.length);
      ws.serializeAttachment({ slot: s, code: l.code });
      await this.save();
      this.send(ws, { t: 'welcome', slot: s, token });
      this.pushLobby();
      return;
    }

    // 乱入アイテムはトーナメントのときだけ
    if (msg.t === 'drop' && this.lobby && this.lobby.tourOn && this.lobby.dropOn !== false && this.sim && this.setup && (slot >= 0 || slot === SPECTATOR)) {
      // 乱入アイテム：試合に出ていない人だけ、1試合に1回
      if (slot >= 0 && this.setup.players.some((p) => p.slot === slot)) return;
      const key = slot >= 0 ? `h${slot}` : `s${att?.sid ?? 0}`;
      if (this.dropUsed.has(key)) return;
      const m = this.sim.stage.main;
      // 落とす場所は、ステージの上のどこか（ランダム）
      if (!this.sim.dropItem(Number(msg.kind) | 0, m.x1 + 1 + Math.random() * (m.x2 - m.x1 - 2))) return;
      this.dropUsed.add(key);
      const name = slot >= 0 ? this.lobby.humans.find((h) => h.slot === slot)?.name ?? '？' : (att as Attachment | null)?.name ?? '観戦';
      this.broadcast({ t: 'dropped', n: name, kind: Number(msg.kind) | 0, used: [...this.dropUsed] });
      return;
    }

    if (msg.t === 'stamp' && this.lobby && slot >= 0) {
      // 定型文・スタンプ（観戦している人は送れない）。送りすぎないよう、1人1秒に1回まで
      const pic = msg.pic ? 1 : 0;
      const id = Number(msg.id) | 0;
      if (id < 0 || id >= (pic ? PIC_STAMP_COUNT : STAMPS.length)) return;
      // 戦っている最中の人からは受け付けない
      if (slot >= 0 && this.sim && this.setup?.players.some((p) => p.slot === slot)) return;
      const now = Date.now();
      if (now - (this.lastStamp.get(slot) ?? 0) < 850) return;
      this.lastStamp.set(slot, now);
      const name = this.lobby.humans.find((h) => h.slot === slot)?.name;
      const tier = pic && (msg.tier === 5 || msg.tier === 6) ? msg.tier : undefined;
      if (name) this.broadcast({ t: 'stamp', slot, name, id, ...(pic ? { pic: 1 as const } : {}), ...(tier ? { tier } : {}) });
      return;
    }

    if (msg.t === 'predict' && this.lobby && (slot >= 0 || slot === SPECTATOR)) {
      // 勝敗予想：試合に出ていない人だけ。決め直しはできる
      const targets = this.predictTargets();
      const pick = Number(msg.slot) | 0;
      if (!targets || !targets.includes(pick) || (slot >= 0 && targets.includes(slot))) return;
      const key = slot >= 0 ? `h${slot}` : `s${att?.sid ?? 0}`;
      const name = slot >= 0 ? this.lobby.humans.find((h) => h.slot === slot)?.name ?? '？' : `${(att as Attachment | null)?.name ?? '観戦'}（観戦）`;
      this.predicts.set(key, { n: name, p: pick });
      this.pushPredicts();
      // トーナメントの合間：全員が予想し終えたら、少しして次の試合を始める
      if (!this.sim && this.lobby.tourOn && this.lobby.tour) {
        this.planTourNext();
        this.pushLobby();
      }
      return;
    }

    if (slot < 0 || !this.lobby) {
      // 観戦している人が抜けた
      if (slot === SPECTATOR && msg.t === 'leave') {
        ws.serializeAttachment({ slot: -1 });
        ws.close(1000, 'leave');
        this.pushLobby();
      }
      return;
    }
    const l = this.lobby;

    switch (msg.t) {
      case 'in': {
        if (!this.sim || !Array.isArray(msg.i)) return;
        const q = this.queue(slot);
        const first = Number(msg.s) | 0;
        // 端末は試合が始まるたびに通し番号を0から数え直す。前の試合の大きな番号の入力が、再戦の開始後に
        // 遅れて届くと、新しい番号の入力をすべて「処理済み」として捨ててしまい、動けなくなる。
        // 番号が大きく戻ったら、数え直したとみなして受け付け直す（1つの接続の中では順番は入れ替わらない）
        if (first < q.lastQueued - RESTART_GAP) {
          q.items = [];
          q.lastQueued = -1;
          q.ack = -1;
          q.last = { mx: 0, my: 0, buttons: 0 };
        }
        msg.i.slice(0, MAX_INPUTS_PER_MSG).forEach((a, j) => {
          const seq = first + j;
          if (seq <= q.lastQueued || !Array.isArray(a)) return;
          q.items.push({ seq, inp: { mx: clamp(Number(a[0]) || 0), my: clamp(Number(a[1]) || 0), buttons: (a[2] | 0) & 15 } });
          q.lastQueued = seq;
        });
        if (q.items.length > 60) q.items.splice(0, q.items.length - 60);
        return;
      }
      case 'char': {
        if (this.sim) return;
        const h = l.humans.find((x) => x.slot === slot);
        if (h && validChar(msg.charId)) {
          h.charId = msg.charId;
          h.costume = validCostume(h.charId, msg.costume);
          h.costumes = validCostumes(msg.costumes);
        }
        await this.save();
        return this.pushLobby();
      }
      case 'team': {
        if (this.sim) return;
        const team = validTeam(msg.team);
        if (team === undefined) return;
        const target = typeof msg.slot === 'number' ? msg.slot : slot;
        const h = l.humans.find((x) => x.slot === target);
        if (h && (target === slot || slot === l.hostSlot)) h.team = team;
        else if (!h && slot === l.hostSlot && target >= 0 && target < MAX_PLAYERS) (l.cpuTeams ??= {})[target] = team;
        else return;
        await this.save();
        return this.pushLobby();
      }
      case 'config': {
        if (this.sim || slot !== l.hostSlot) return;
        const r = msg.rules;
        l.rules = {
          mode: (['time', 'stamina', 'area', 'ball', 'crown', 'vault', 'bounty', 'coins'] as const).find((m) => m === r?.mode) ?? 'stock',
          crownGoal: [20, 30, 45].includes(Number(r?.crownGoal)) ? Number(r.crownGoal) : 30,
          vaultHp: [250, 400, 600].includes(Number(r?.vaultHp)) ? Number(r.vaultHp) : 400,
          stocks: Math.max(1, Math.min(5, r?.stocks | 0 || 3)),
          area: r?.area === 'fix2' ? 'fix2' : r?.area === 'random' ? 'random' : 'move',
          goals: Math.max(1, Math.min(9, (Number(r?.goals) | 0) || 5)),
          pvp: r?.pvp !== false,
          // ストック制は時間制限なし
          timeLimit: r?.mode === 'stock' || !r?.mode ? 0 : Math.max(60, Math.min(600, r?.timeLimit | 0 || 180)),
          items: r?.items === true,
          // 出るアイテムの種類（番号の重複・範囲外は除く）と出る頻度
          ...(Array.isArray(r?.itemKinds) ? { itemKinds: [...new Set(r.itemKinds.map((x: unknown) => Number(x) | 0))].filter((x) => x >= 0 && x < ITEMS.kinds) } : {}),
          itemRate: r?.itemRate === 'low' || r?.itemRate === 'high' ? r.itemRate : 'mid',
          gimmicks: r?.gimmicks === true,
          hp: Math.max(50, Math.min(300, (r?.hp ?? 0) | 0 || DEFAULT_HP)),
          // 玉入れ・金庫まもりはいつも赤・青の2チーム（チームは選べる）
          teams: isTwoTeam(r?.mode) ? true : r?.teams === true,
          friendlyFire: r?.friendlyFire === true,
        };
        if (msg.stageId === RANDOM_STAGE || STAGES.some((s) => s.id === msg.stageId)) l.stageId = msg.stageId;
        l.cpuCount = Math.max(0, Math.min(MAX_PLAYERS - l.humans.length, msg.cpuCount | 0));
        l.cpuLevel = Math.max(1, Math.min(9, msg.cpuLevel | 0 || 3));
        // CPUのキャラ（おまかせ＝試合ごとにランダム）
        if (Array.isArray(msg.cpuChars)) l.cpuChars = msg.cpuChars.slice(0, MAX_PLAYERS).map((c) => (validChar(c) ? c : RANDOM_CHAR));
        // トーナメントをやめたら、進行中のものも終わりにする
        l.tourOn = msg.tour === true;
        // 3位決定戦（初期は「あり」）。次に始めるトーナメントから
        l.tourThird = msg.tourThird !== false;
        // 乱入アイテム（初期は「あり」）
        l.dropOn = msg.dropOn !== false;
        if (!l.tourOn && l.tour) {
          l.tour = undefined;
          this.clearTourTimer();
        }
        await this.save();
        return this.pushLobby();
      }
      case 'start': {
        if (this.sim || slot !== l.hostSlot) return;
        // つながっている人（ホスト以外）が全員「準備OK」を押していないと始められない
        const conn = this.connectedSlots();
        if (l.humans.some((h) => h.slot !== l.hostSlot && conn.has(h.slot) && !h.ready)) return;
        // トーナメントの途中は、ホストだけでは始められない（全員の「OK！」か、予想がそろうか、時間で始まる）
        if (l.tourOn && l.tour && l.tour.champion < 0) return;
        this.startFromLobby();
        return;
      }
      case 'ready': {
        // ロビーの「準備OK」（対戦中は変えない）
        if (this.sim) return;
        const h = l.humans.find((x) => x.slot === slot);
        if (!h) return;
        h.ready = !!msg.on;
        await this.save();
        this.pushLobby();
        return;
      }
      case 'autoteam': {
        // チームをおまかせで分ける：ホストだけ。人もCPUも混ぜてシャッフルし、赤・青に同じ人数ずつ（奇数なら1人差）
        if (this.sim || this.rouletteSetup || slot !== l.hostSlot || !l.rules.teams) return;
        const all = this.lobbyInfo().players.map((p) => p.slot);
        for (let i = all.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [all[i], all[j]] = [all[j], all[i]];
        }
        all.forEach((s, i) => {
          const team = i % 2;
          const h = l.humans.find((x) => x.slot === s);
          if (h) h.team = team;
          else (l.cpuTeams ??= {})[s] = team;
        });
        await this.save();
        this.broadcast({ t: 'notice', msg: 'チームをおまかせで分けました' });
        return this.pushLobby();
      }
      case 'kick': {
        // ホストが、ほかの人をルームから外す（対戦していないときだけ）
        if (this.sim || this.rouletteSetup || slot !== l.hostSlot) return;
        const target = Number(msg.slot) | 0;
        const h = l.humans.find((x) => x.slot === target);
        if (!h || target === slot) return;
        if (h.fh) (l.kickedFh ??= []).push(h.fh);
        for (const w of this.ctx.getWebSockets()) {
          const a = w.deserializeAttachment() as Attachment | null;
          if (a?.slot !== target) continue;
          this.send(w, { t: 'error', code: 'kicked', msg: 'ホストにルームから外されました。' });
          w.serializeAttachment({ slot: -1 });
          w.close(1000, 'kicked');
        }
        this.broadcast({ t: 'notice', msg: `${h.name} さんがルームから外されました` });
        await this.handleLeave(target, true);
        return;
      }
      case 'host': {
        // ホストを譲る：ホストだけが、対戦していないときに、つながっているほかの人へ
        if (this.sim || this.rouletteSetup || slot !== l.hostSlot) return;
        const target = Number(msg.slot) | 0;
        const to = l.humans.find((x) => x.slot === target);
        if (!to || target === slot || !this.connectedSlots().has(target)) return;
        l.hostSlot = target;
        await this.save();
        this.broadcast({ t: 'notice', msg: `${to.name} さんがホストになりました` });
        this.pushLobby();
        return;
      }
      case 'again': {
        // 結果画面の「もう1戦したい」。つながっている人が全員押したら、ホストを待たずに再戦する
        if (this.sim) return;
        const set = new Set(l.again ?? []);
        if (msg.on) set.add(slot);
        else set.delete(slot);
        l.again = [...set];
        const connected = this.connectedSlots();
        const humans = l.humans.filter((h) => connected.has(h.slot));
        if (humans.length >= 1 && humans.every((h) => set.has(h.slot)) && this.startFromLobby()) return;
        await this.save();
        this.pushLobby();
        return;
      }
      case 'leave':
        // 自分で抜けた：枠は残さない
        ws.serializeAttachment({ slot: -1 });
        ws.close(1000, 'leave');
        await this.handleLeave(slot, true);
        return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (a && a.slot === SPECTATOR) {
      ws.serializeAttachment({ slot: -1 });
      this.pushLobby();
      return;
    }
    if (a && a.slot >= 0) {
      ws.serializeAttachment({ slot: -1 });
      await this.handleLeave(a.slot);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** 全員の通信が切れたまま猶予が過ぎたら、ルームを閉じる */
  async alarm(): Promise<void> {
    if (!this.lobby) return;
    if (this.connectedSlots().size > 0) return;
    this.stopMatch();
    this.clearTourTimer();
    this.lobby = null;
    await this.save();
  }

  /** 抜けた・通信が切れた。voluntary = 自分で抜けた（枠を残さない） */
  private async handleLeave(slot: number, voluntary = false): Promise<void> {
    const l = this.lobby;
    if (!l) return;
    const connected = this.connectedSlots();
    connected.delete(slot);
    if (this.sim) {
      // 対戦中に抜けた人は CPU が代わりに操作する（戻ってきたら本人に戻す）
      const lv = Math.max(3, l.cpuLevel);
      this.cpuSlots.set(slot, lv);
      this.queues.delete(slot);
    }
    const h = l.humans.find((x) => x.slot === slot);
    if (voluntary || !h) {
      if (!this.sim) l.humans = l.humans.filter((x) => x.slot !== slot);
      // 対戦中に自分で抜けた人も、試合が終わるまでは戻れる（CPU が代わりに操作する）
      else if (h) h.goneAt = Date.now();
    } else {
      h.goneAt = Date.now();
    }
    // ほかの人に知らせる
    if (h) {
      const what = voluntary ? '抜けました' : '通信が切れました';
      this.broadcast({ t: 'notice', msg: `${h.name} さんが${what}${this.sim ? '（戻るまで CPU が代わりに操作します）' : ''}` });
    }
    const remaining = l.humans.filter((x) => connected.has(x.slot));
    if (remaining.length === 0) {
      const waiting = l.humans.some((x) => x.goneAt > 0 && Date.now() - x.goneAt < REJOIN_GRACE);
      if (waiting && !voluntary) {
        // 全員の通信が切れた：しばらく待って、誰も戻らなければルームを閉じる
        await this.save();
        await this.ctx.storage.setAlarm(Date.now() + REJOIN_GRACE + 1000);
        return;
      }
      this.stopMatch();
      this.clearTourTimer();
      this.lobby = null;
      await this.save();
      return;
    }
    if (!connected.has(l.hostSlot)) l.hostSlot = remaining[0].slot;
    if (!this.sim) l.cpuCount = Math.min(l.cpuCount, MAX_PLAYERS - l.humans.length);
    // トーナメントの合間：抜けた人を除いて全員が予想し終えていれば、少しして始める
    if (!this.sim && l.tourOn && l.tour && l.tour.champion < 0) this.planTourNext();
    await this.save();
    this.pushLobby();
  }

  private clearTourTimer(): void {
    if (this.tourTimer) clearTimeout(this.tourTimer);
    this.tourTimer = null;
    this.tourNextAt = 0;
  }

  /** トーナメント：次の試合を始める。新しく始めるときは、いるメンバー（CPUも）で組み合わせを作る */
  private startTour(): boolean {
    const l = this.lobby!;
    if (this.rouletteSetup) return false;
    this.clearTourTimer();
    if (!l.tour || l.tour.champion >= 0) {
      const players = this.lobbyInfo().players.filter((p) => p.cpu || p.connected);
      if (players.length < 3) return false;
      const order = players.map((p) => p.slot);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const rounds = makeBracket(order);
      l.tour = {
        id: (Math.random() * 2 ** 31) | 0,
        entrants: players.map((p) => ({ slot: p.slot, name: p.name, charId: p.charId, cpu: p.cpu, cpuLevel: p.cpuLevel })),
        rounds,
        // 3位決定戦（ルールで「あり」、準決勝で負ける人が2人いるとき）
        ...(l.tourThird !== false && canHaveThird(rounds) ? { third: { a: -1, b: -1, w: -1 } } : {}),
        cur: null,
        champion: -1,
      };
      // 最初の試合の前に、組み合わせ表を見せて予想を受け付ける（「OK！」は数え直す）
      l.again = [];
      this.predicts.clear();
      this.pushPredicts();
      this.planTourNext(true);
      this.pushLobby();
      this.ctx.waitUntil(this.save());
      return true;
    }
    const t = l.tour;
    const nm = nextMatch(t.rounds, t.third);
    if (!nm) return false;
    const m = matchAt(t.rounds, t.third, nm[0], nm[1])!;
    const connected = this.connectedSlots();
    const players = [m.a, m.b].map((slot, i) => {
      const e = t.entrants.find((x) => x.slot === slot)!;
      const h = l.humans.find((x) => x.slot === slot);
      // 人：今のキャラで出る。抜けた・通信が切れた人は CPU が代わりに戦う（戻ってきたら本人に戻る）
      if (!e.cpu && h) return { slot, name: h.name, ...pickChar(h.charId, h.costume, h.costumes), cpu: !connected.has(slot), cpuLevel: Math.max(3, l.cpuLevel), team: i };
      return { slot, name: e.name, charId: pickChar(e.charId, undefined).charId, cpu: true, cpuLevel: e.cpu ? e.cpuLevel : Math.max(3, l.cpuLevel), team: i };
    });
    t.cur = nm;
    const seed = (Math.random() * 2 ** 31) | 0;
    this.startWithRoulette({ players, stageId: resolveStage(l.stageId, seed), rules: { ...l.rules, teams: false }, seed });
    this.pushLobby();
    this.ctx.waitUntil(this.save());
    return true;
  }

  /** トーナメントの試合が終わった：勝った人を進め、次の試合を予約する */
  private endTourMatch(results: { slot: number; rank: number }[]): void {
    const t = this.lobby?.tour;
    if (!t || !t.cur) return;
    const win = results[0]?.slot ?? -1;
    setWinner(t.rounds, t.cur[0], t.cur[1], win, t.third);
    t.cur = null;
    t.champion = champion(t.rounds);
    this.clearTourTimer();
  }

  /** ロビーの設定（ステージ・ルール・CPU）で試合を始める。始められたら true */
  private startFromLobby(): boolean {
    const l = this.lobby;
    if (!l || this.sim || this.rouletteSetup) return false;
    if (l.tourOn) return this.startTour();
    const info = this.lobbyInfo();
    const players = info.players.filter((p) => p.cpu || p.connected);
    if (players.length < 2) return false;
    // チーム戦は2チーム以上いないと始められない
    // 玉入れは赤・青の2チーム（チームの番号を2で割った余り）
    if (l.rules.teams && new Set(players.map((p) => (isTwoTeam(l.rules.mode) ? (p.team ?? 0) % 2 : p.team ?? 0))).size < 2) return false;
    const seed = (Math.random() * 2 ** 31) | 0;
    const setup: MatchSetup = {
      // おまかせのキャラはここで決める。CPU の名前は決まったキャラで付け直す
      players: nameCpus(players.map((p) => ({ slot: p.slot, name: p.name, ...pickChar(p.charId, p.costume, l.humans.find((h) => h.slot === p.slot && !p.cpu)?.costumes), cpu: p.cpu, cpuLevel: p.cpuLevel, team: p.team ?? 0 }))),
      // おまかせなら、試合ごとにランダムなステージ
      stageId: resolveStage(l.stageId, seed),
      rules: l.rules,
      seed,
    };
    this.startWithRoulette(setup);
    // 「もう1戦したい」が消えたことを全員に伝える
    this.pushLobby();
    this.ctx.waitUntil(this.save());
    return true;
  }

  // ---------------------------------------------------------------
  /** ステージおまかせのルーレット中（このあと始める試合） */
  private rouletteSetup: MatchSetup | null = null;

  /** ステージおまかせなら、先にルーレットを見せてから試合を始める */
  private startWithRoulette(setup: MatchSetup): void {
    if (this.lobby?.stageId !== RANDOM_STAGE) return this.startMatch(setup);
    this.rouletteSetup = setup;
    if (this.lobby) {
      this.lobby.again = [];
      for (const h of this.lobby.humans) h.ready = false;
    }
    this.broadcast({ t: 'roulette', stageId: setup.stageId });
    setTimeout(() => {
      if (this.rouletteSetup !== setup) return;
      this.rouletteSetup = null;
      if (!this.sim && this.lobby && this.connectedSlots().size > 0) this.startMatch(setup);
    }, ROULETTE_WAIT_MS);
  }

  private startMatch(setup: MatchSetup): void {
    this.rouletteSetup = null;
    if (this.lobby) {
      this.lobby.again = [];
      // 次の試合に向けて「準備OK」は外す
      for (const h of this.lobby.humans) h.ready = false;
    }
    this.setup = setup;
    // 新しい試合：本人の状態は最初にすべて送り直す（端末は start で覚えていた状態を捨てる）
    this.meSent = new WeakMap();
    this.dropUsed.clear();
    // トーナメントの合間にした予想は、この試合の選手を選んでいれば引き継ぐ
    const inMatch = new Set(setup.players.map((p) => p.slot));
    for (const [k, v] of this.predicts) if (!inMatch.has(v.p) || (k.startsWith('h') && inMatch.has(Number(k.slice(1))))) this.predicts.delete(k);
    this.sim = new Sim(setup);
    this.cpu = new CpuController(setup.seed);
    this.cpuSlots.clear();
    for (const p of setup.players) if (p.cpu) this.cpuSlots.set(p.slot, p.cpuLevel);
    this.queues.clear();
    this.eventBuf = [];
    this.broadcast({ t: 'start', setup });
    this.pushPredicts();
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  /** 人ごとの往復の時間（ms） */
  private rtt = new Map<number, number>();

  /**
   * 当たり判定の巻き戻し：その人の画面に映る相手は「片道の遅れ＋表示のなめらかさ（80ms）」だけ前のもの。
   * さらに入力がサーバーで待っている分も遅れるので、その分だけ前の相手の位置にも当たるようにする（上限は LAG_COMP_MAX）
   */
  private updateLagComp(sim: Sim): void {
    for (const f of sim.fighters) {
      if (this.cpuSlots.has(f.slot)) continue;
      const rtt = this.rtt.get(f.slot) ?? 60;
      const wait = this.queues.get(f.slot)?.items.length ?? 0;
      sim.lagComp.set(f.slot, Math.max(0, Math.min(LAG_COMP_MAX, Math.round((rtt / 2 + CLIENT_INTERP_MS) / TICK_MS) + wait)));
    }
  }

  private queue(slot: number): InputQueue {
    let q = this.queues.get(slot);
    if (!q) {
      q = { items: [], lastQueued: -1, last: { mx: 0, my: 0, buttons: 0 }, ack: -1 };
      this.queues.set(slot, q);
    }
    return q;
  }

  /** その選手の次のフレームの入力。届いていなければ直前の入力を続ける */
  private nextInput(slot: number): InputState {
    const q = this.queue(slot);
    const skip = (keep: number) => {
      // 間引いた入力で押されたボタンは、次の入力に引き継ぐ（押したのに出ない、を防ぐ）
      let carried = 0;
      while (q.items.length > keep) {
        const old = q.items.shift()!;
        carried |= old.inp.buttons & ~q.last.buttons;
        q.last = old.inp;
        q.ack = old.seq;
      }
      if (carried && q.items[0]) q.items[0].inp = { ...q.items[0].inp, buttons: q.items[0].inp.buttons | carried };
    };
    if (q.items.length > QUEUE_HARD) skip(QUEUE_SOFT);
    else if (q.items.length > QUEUE_SOFT) skip(q.items.length - 1);
    const next = q.items.shift();
    if (next) {
      q.last = next.inp;
      q.ack = next.seq;
    }
    return q.last;
  }

  /** 本人の選手の状態を、前に送ったもの（項目ごとの JSON）。変わった項目だけを送るのに使う（接続ごと） */
  private meSent = new WeakMap<WebSocket, Map<string, string>>();

  /** 本人の選手の状態のうち、前に送ってから変わった項目（初めての接続はすべて） */
  private meDelta(ws: WebSocket, st: Record<string, unknown>): { st: Record<string, unknown>; d?: 1; u?: string[] } {
    const prev = this.meSent.get(ws);
    const now = new Map<string, string>();
    for (const [k, v] of Object.entries(st)) if (v !== undefined) now.set(k, JSON.stringify(v));
    this.meSent.set(ws, now);
    if (!prev) return { st };
    const out: Record<string, unknown> = {};
    for (const [k, j] of now) if (prev.get(k) !== j) out[k] = st[k];
    const gone = [...prev.keys()].filter((k) => !now.has(k));
    return { st: out, d: 1, ...(gone.length ? { u: gone } : {}) };
  }

  /** 状態を全員に送る。受け取る人ごとに、本人の選手の状態（変わった項目だけ）と処理済みの入力番号を付ける */
  private sendSnapshots(sim: Sim): void {
    const base = JSON.stringify(encodeState(sim.toView(), this.eventBuf));
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || (a.slot < 0 && a.slot !== SPECTATOR)) continue;
      const f = this.cpuSlots.has(a.slot) ? undefined : sim.fighter(a.slot);
      const q = this.queues.get(a.slot);
      const me = f && q ? `,"me":${JSON.stringify({ a: q.ack, ...this.meDelta(ws, f.serialize() as unknown as Record<string, unknown>) })}` : '';
      try {
        ws.send(`{"t":"snap","s":${base}${me}}`);
      } catch {
        /* 切断済み */
      }
    }
  }

  private stopMatch(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.sim = null;
    this.setup = null;
    this.cpu = null;
    this.cpuSlots.clear();
  }

  private tick(): void {
    const sim = this.sim;
    if (!sim) return;
    const now = Date.now();
    let steps = Math.floor((now - this.lastTick) / TICK_MS);
    if (steps <= 0) return;
    if (steps > 6) {
      // 大きく遅れたら追いつくのをあきらめる
      steps = 6;
      this.lastTick = now;
    } else {
      this.lastTick += steps * TICK_MS;
    }
    this.updateLagComp(sim);
    for (let i = 0; i < steps; i++) {
      const inputs = new Map<number, InputState>();
      for (const f of sim.fighters) {
        const lv = this.cpuSlots.get(f.slot);
        if (lv !== undefined) {
          inputs.set(f.slot, this.cpu!.think(sim, f, lv));
          continue;
        }
        inputs.set(f.slot, this.nextInput(f.slot));
      }
      sim.step(inputs);
      if (sim.events.length) this.eventBuf.push(...sim.events);
      if (sim.frame % SNAP_EVERY === 0) {
        this.sendSnapshots(sim);
        this.eventBuf = [];
      }
      if (sim.finished) {
        const results = sim.results();
        this.stopMatch();
        this.endTourMatch(results);
        this.broadcast({ t: 'end', results });
        // 予想は試合ごと（結果は端末が end の時点の一覧で判定する）
        this.predicts.clear();
        this.pushPredicts();
        // トーナメント：次の試合までの待ち時間（予想する人がいれば長め）
        if (this.lobby?.tourOn && this.lobby.tour && this.lobby.tour.champion < 0) this.planTourNext(true);
        if (this.lobby) {
          const connected = this.connectedSlots();
          this.lobby.humans = this.lobby.humans.filter((h) => connected.has(h.slot) || (h.goneAt > 0 && Date.now() - h.goneAt < REJOIN_GRACE));
          this.ctx.waitUntil(this.save());
        }
        this.pushLobby();
        return;
      }
    }
  }
}

function clamp(n: number): number {
  return Math.max(-1, Math.min(1, n));
}
