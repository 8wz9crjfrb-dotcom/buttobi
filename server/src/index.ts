// 対戦サーバー（Cloudflare Workers + Durable Objects）
// URL: wss://<worker>/room/<4桁コード>  → そのコードのルーム（Durable Object）につながる

import { DurableObject } from 'cloudflare:workers';
import { CpuController } from '../../src/shared/ai';
import { CHARACTERS } from '../../src/shared/characters';
import { COSTUMES } from '../../src/shared/costumes';
import {
  MAX_INPUTS_PER_MSG,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  encodeState,
  isRoomCode,
  sanitizeName,
  type ClientMsg,
  type LobbyInfo,
  type LobbyPlayer,
  type ServerMsg,
} from '../../src/shared/protocol';
import { Sim } from '../../src/shared/sim';
import { STAGES } from '../../src/shared/stages';
import { DEFAULT_HP, DEFAULT_RULES, TEAM_COUNT, type GameEvent, type InputState, type MatchRules, type MatchSetup } from '../../src/shared/types';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
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
}

interface StoredHuman {
  slot: number;
  name: string;
  charId: string;
  costume?: string;
  /** チーム戦のチーム */
  team?: number;
  /** 通信が切れたときに同じ枠へ戻るための合言葉 */
  token: string;
  /** 通信が切れた時刻（つながっている間は 0）。猶予の間は枠を残す */
  goneAt: number;
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
}

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
/** 待ち行列がこれより長い間は、1フレームにつき入力を1つだけ間引いて少しずつ追いつく */
const QUEUE_SOFT = 6;
/** これより長くなったら（通信が長く止まった等）、一気に QUEUE_SOFT まで捨てる */
const QUEUE_HARD = 40;
const SNAP_EVERY = 2; // 60fps のうち 2 フレームに 1 回送る = 30回/秒
/** 通信が切れてから、同じ枠に戻れる時間（ms） */
const REJOIN_GRACE = 60_000;
/** 観戦できる人数 */
const MAX_SPECTATORS = 8;
/** 観戦している人の印（slot の代わり） */
const SPECTATOR = -2;

/** そのキャラの衣装として正しければ id を、そうでなければ undefined を返す */
function validCostume(charId: string, id: unknown): string | undefined {
  return typeof id === 'string' && COSTUMES.some((c) => c.id === id && c.charId === charId) ? id : undefined;
}

function makeToken(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Room extends DurableObject<Env> {
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

  private connectedSlots(): Set<number> {
    const s = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && a.slot >= 0) s.add(a.slot);
    }
    return s;
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
    const players: LobbyPlayer[] = l.humans.map((h) => ({ slot: h.slot, name: h.name, charId: h.charId, costume: h.costume, cpu: false, cpuLevel: 0, connected: connected.has(h.slot), team: h.team ?? h.slot % 2 }));
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
        players.push({ slot: s, name: `CPU ${l.cpuLevel}`, charId: CHARACTERS[s % CHARACTERS.length].id, cpu: true, cpuLevel: l.cpuLevel, connected: true, team: l.cpuTeams?.[s] ?? s % 2 });
        added++;
      }
    }
    players.sort((a, b) => a.slot - b.slot);
    return { code: l.code, hostSlot: l.hostSlot, players, rules: l.rules, stageId: l.stageId, inMatch: !!this.sim, spectators: this.spectatorCount() };
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

    if (msg.t === 'ping') return this.send(ws, { t: 'pong', c: msg.c });

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
        if (h && !connected.has(h.slot) && (h.goneAt === 0 || Date.now() - h.goneAt < REJOIN_GRACE)) {
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
          return;
        }
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
        ws.serializeAttachment({ slot: SPECTATOR, code: this.lobby.code });
        this.send(ws, { t: 'welcome', slot: -1, token: '' });
        this.send(ws, { t: 'lobby', lobby: this.lobbyInfo() });
        if (this.sim && this.setup) this.send(ws, { t: 'start', setup: this.setup });
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
      if (!active) {
        this.lobby = {
          code: att?.code ?? '0000',
          hostSlot: 0,
          humans: [],
          rules: { ...DEFAULT_RULES },
          stageId: STAGES[0].id,
          cpuCount: 0,
          cpuLevel: 3,
        };
        this.stopMatch();
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
      const charId = CHARACTERS.some((c) => c.id === msg.charId) ? msg.charId : CHARACTERS[0].id;
      const token = makeToken();
      l.humans.push({ slot: s, name: sanitizeName(msg.name), charId, costume: validCostume(charId, msg.costume), token, goneAt: 0 });
      if (l.humans.length === 1 || !l.humans.some((h) => h.slot === l.hostSlot)) l.hostSlot = s;
      l.cpuCount = Math.min(l.cpuCount, MAX_PLAYERS - l.humans.length);
      ws.serializeAttachment({ slot: s, code: l.code });
      await this.save();
      this.send(ws, { t: 'welcome', slot: s, token });
      this.pushLobby();
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
        if (h && CHARACTERS.some((c) => c.id === msg.charId)) {
          h.charId = msg.charId;
          h.costume = validCostume(h.charId, msg.costume);
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
          mode: r?.mode === 'time' ? 'time' : r?.mode === 'stamina' ? 'stamina' : 'stock',
          stocks: Math.max(1, Math.min(5, r?.stocks | 0 || 3)),
          timeLimit: Math.max(60, Math.min(600, r?.timeLimit | 0 || 180)),
          items: r?.items === true,
          gimmicks: r?.gimmicks === true,
          hp: Math.max(50, Math.min(300, (r?.hp ?? 0) | 0 || DEFAULT_HP)),
          teams: r?.teams === true,
          friendlyFire: r?.friendlyFire === true,
        };
        if (STAGES.some((s) => s.id === msg.stageId)) l.stageId = msg.stageId;
        l.cpuCount = Math.max(0, Math.min(MAX_PLAYERS - l.humans.length, msg.cpuCount | 0));
        l.cpuLevel = Math.max(1, Math.min(9, msg.cpuLevel | 0 || 3));
        await this.save();
        return this.pushLobby();
      }
      case 'start': {
        if (this.sim || slot !== l.hostSlot) return;
        const info = this.lobbyInfo();
        const players = info.players.filter((p) => p.cpu || p.connected);
        if (players.length < 2) return;
        // チーム戦は2チーム以上いないと始められない
        if (l.rules.teams && new Set(players.map((p) => p.team ?? 0)).size < 2) return;
        const setup: MatchSetup = {
          players: players.map((p) => ({ slot: p.slot, name: p.name, charId: p.charId, cpu: p.cpu, cpuLevel: p.cpuLevel, costume: p.costume, team: p.team ?? 0 })),
          stageId: l.stageId,
          rules: l.rules,
          seed: (Math.random() * 2 ** 31) | 0,
        };
        this.startMatch(setup);
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
      else if (h) h.token = makeToken(); // 抜けた人は戻れない
    } else {
      h.goneAt = Date.now();
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
      this.lobby = null;
      await this.save();
      return;
    }
    if (!connected.has(l.hostSlot)) l.hostSlot = remaining[0].slot;
    if (!this.sim) l.cpuCount = Math.min(l.cpuCount, MAX_PLAYERS - l.humans.length);
    await this.save();
    this.pushLobby();
  }

  // ---------------------------------------------------------------
  private startMatch(setup: MatchSetup): void {
    this.setup = setup;
    this.sim = new Sim(setup);
    this.cpu = new CpuController(setup.seed);
    this.cpuSlots.clear();
    for (const p of setup.players) if (p.cpu) this.cpuSlots.set(p.slot, p.cpuLevel);
    this.queues.clear();
    this.eventBuf = [];
    this.broadcast({ t: 'start', setup });
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), TICK_MS);
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

  /** 状態を全員に送る。受け取る人ごとに、本人の選手の完全な状態と処理済みの入力番号を付ける */
  private sendSnapshots(sim: Sim): void {
    const base = JSON.stringify(encodeState(sim.toView(), this.eventBuf));
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a || (a.slot < 0 && a.slot !== SPECTATOR)) continue;
      const f = this.cpuSlots.has(a.slot) ? undefined : sim.fighter(a.slot);
      const q = this.queues.get(a.slot);
      const me = f && q ? `,"me":${JSON.stringify({ a: q.ack, st: f.serialize() })}` : '';
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
        this.broadcast({ t: 'end', results });
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
