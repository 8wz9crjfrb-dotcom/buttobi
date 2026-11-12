// オンライン対戦の通信（WebSocket）と、受け取った状態の補間表示

import type { FighterSnapshot } from '../shared/sim';
import {
  MAX_INPUTS_PER_MSG,
  PROTOCOL_VERSION,
  decodeState,
  type ClientMsg,
  type LobbyInfo,
  type ServerMsg,
} from '../shared/protocol';
import type { GameEvent, InputState, MatchRules, MatchSetup, ResultEntry, ViewState } from '../shared/types';

export interface NetHandlers {
  onWelcome(slot: number): void;
  onLobby(lobby: LobbyInfo): void;
  onStart(setup: MatchSetup): void;
  onEnd(results: ResultEntry[]): void;
  onError(code: string, msg: string): void;
  onClose(): void;
  /** 通信が切れて、つなぎ直している（attempt 回目） */
  onReconnecting(attempt: number): void;
  /** つなぎ直せた */
  onReconnected(): void;
}

/** つなぎ直す間隔（ms）。これを全部試してだめならあきらめる（合計 約45秒） */
const RECONNECT_DELAYS = [500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 8000, 8000];

/** サーバーが本人の選手について返した、照合用の情報 */
export interface Authority {
  frame: number;
  ack: number;
  state: FighterSnapshot;
}

interface Snap {
  at: number; // 受信時刻（ms）
  view: ViewState;
}

/** 表示を何ms遅らせて補間するか（届く間隔のゆらぎを吸収する） */
const INTERP_DELAY = 80;

export class NetClient {
  private ws: WebSocket | null = null;
  private snaps: Snap[] = [];
  private pendingEvents: GameEvent[] = [];
  private lastSendAt = 0;
  private seq = 0;
  /** まだ送っていない入力 */
  private unsent: [number, number, number][] = [];
  private unsentFirst = 0;
  private lastButtons = 0;
  /** 最新の照合情報（まだ使っていなければ authorityFresh が true） */
  authority: Authority | null = null;
  authorityFresh = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  rtt = 0;
  slot = -1;
  private closedByUser = false;
  /** つなぎ直しに使う情報 */
  private params: { baseUrl: string; code: string; name: string; charId: string; costume?: string; spectate?: boolean } | null = null;
  private token = '';
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** つなぎ直している最中 */
  reconnecting = false;
  private errored = false;

  constructor(private handlers: NetHandlers) {}

  connect(baseUrl: string, code: string, create: boolean, name: string, charId: string, costume?: string, spectate = false): void {
    this.close();
    this.closedByUser = false;
    this.errored = false;
    this.params = { baseUrl, code, name, charId, costume, spectate };
    this.token = '';
    this.open(create);
  }

  private open(create: boolean): void {
    const p = this.params!;
    const url = `${p.baseUrl.replace(/\/$/, '')}/room/${p.code}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    const rejoin = this.reconnecting && this.token ? { slot: this.slot, token: this.token } : undefined;
    ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: p.name, charId: p.charId, costume: p.costume, create: rejoin ? false : create, rejoin, spectate: p.spectate || undefined });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) return;
      // エラーを受け取ったあとの切断は、onError で処理済み
      if (this.errored) {
        this.errored = false;
        return;
      }
      // ルームに入っていたなら、同じ枠へのつなぎ直しを試す
      if (this.token && this.slot >= 0 && this.attempt < RECONNECT_DELAYS.length) {
        this.reconnecting = true;
        const delay = RECONNECT_DELAYS[this.attempt++];
        this.handlers.onReconnecting(this.attempt);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.closedByUser) this.open(false);
        }, delay);
        return;
      }
      this.reconnecting = false;
      this.handlers.onClose();
    };
    ws.onerror = () => {
      /* onclose で処理する */
    };
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': {
        const wasReconnecting = this.reconnecting;
        this.slot = m.slot;
        this.token = m.token;
        this.attempt = 0;
        this.reconnecting = false;
        if (wasReconnecting) this.handlers.onReconnected();
        else this.handlers.onWelcome(m.slot);
        break;
      }
      case 'lobby':
        this.handlers.onLobby(m.lobby);
        break;
      case 'start':
        this.snaps = [];
        this.pendingEvents = [];
        this.authority = null;
        this.authorityFresh = false;
        this.unsent = [];
        this.seq = 0;
        this.lastButtons = 0;
        this.handlers.onStart(m.setup);
        break;
      case 'snap': {
        const view = decodeState(m.s);
        this.snaps.push({ at: performance.now(), view });
        if (m.me) {
          this.authority = { frame: m.s.f, ack: m.me.a, state: m.me.st };
          this.authorityFresh = true;
        }
        if (this.snaps.length > 30) this.snaps.shift();
        if (view.events.length) this.pendingEvents.push(...view.events);
        break;
      }
      case 'end':
        this.handlers.onEnd(m.results);
        break;
      case 'pong':
        this.rtt = performance.now() - m.c;
        break;
      case 'error':
        // つなぎ直しに失敗した（猶予が過ぎた等）：これ以上は試さない
        this.errored = true;
        this.token = '';
        this.reconnecting = false;
        this.handlers.onError(m.code, m.msg);
        break;
    }
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /**
   * 1フレーム分の入力を登録し、その通し番号を返す。
   * 送信は約50msごとにまとめて行う（20回/秒）。ボタンを新しく押したときは33ms以上空いていればすぐ送る。
   */
  queueInput(inp: InputState): number {
    const seq = this.seq++;
    const mx = Math.round(inp.mx * 100) / 100;
    const my = Math.round(inp.my * 100) / 100;
    if (this.unsent.length === 0) this.unsentFirst = seq;
    this.unsent.push([mx, my, inp.buttons]);
    const newPress = (inp.buttons & ~this.lastButtons) !== 0;
    this.lastButtons = inp.buttons;
    const now = performance.now();
    const since = now - this.lastSendAt;
    if (since >= 50 || (newPress && since >= 33) || this.unsent.length >= MAX_INPUTS_PER_MSG) this.flush(now);
    return seq;
  }

  /** 画面が裏に回ったときなど：手を離した入力をすぐ送る */
  sendNeutral(): void {
    if (this.unsent.length === 0) this.unsentFirst = this.seq;
    this.seq++;
    this.unsent.push([0, 0, 0]);
    this.lastButtons = 0;
    this.flush(performance.now());
  }

  private flush(now: number): void {
    if (this.unsent.length === 0) return;
    this.send({ t: 'in', s: this.unsentFirst, i: this.unsent });
    this.unsent = [];
    this.lastSendAt = now;
  }

  /** 補間した表示用の状態を返す */
  view(): ViewState | null {
    if (this.snaps.length === 0) return null;
    const target = performance.now() - INTERP_DELAY;
    let i = this.snaps.length - 1;
    while (i > 0 && this.snaps[i - 1].at > target) i--;
    const b = this.snaps[i];
    const a = this.snaps[i - 1];
    if (!a || b.at <= a.at) return b.view;
    const t = Math.max(0, Math.min(1, (target - a.at) / (b.at - a.at)));
    return {
      ...b.view,
      fighters: b.view.fighters.map((fb) => {
        const fa = a.view.fighters.find((x) => x.slot === fb.slot);
        // 撃墜や復活で瞬間移動したときは補間しない
        if (!fa || Math.abs(fa.x - fb.x) > 4 || Math.abs(fa.y - fb.y) > 4) return fb;
        return { ...fb, x: fa.x + (fb.x - fa.x) * t, y: fa.y + (fb.y - fa.y) * t };
      }),
      projectiles: b.view.projectiles,
    };
  }

  takeEvents(): GameEvent[] {
    const e = this.pendingEvents;
    this.pendingEvents = [];
    return e;
  }

  setChar(charId: string, costume?: string): void {
    if (this.params) {
      this.params.charId = charId;
      this.params.costume = costume;
    }
    this.send({ t: 'char', charId, costume });
  }

  /** チーム戦のチームを変える（slot を指定するとその枠。ホストだけ） */
  setTeam(team: number, slot?: number): void {
    this.send({ t: 'team', team, slot });
  }

  config(rules: MatchRules, stageId: string, cpuCount: number, cpuLevel: number): void {
    this.send({ t: 'config', rules, stageId, cpuCount, cpuLevel });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  close(): void {
    this.closedByUser = true;
    this.reconnecting = false;
    this.token = '';
    this.attempt = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.ws) {
      try {
        this.send({ t: 'leave' });
        this.ws.close();
      } catch {
        /* 無視 */
      }
    }
    this.ws = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.slot = -1;
  }

  /** 観戦している */
  get spectating(): boolean {
    return !!this.params?.spectate;
  }

  /** 入っているルームのコード */
  get code(): string {
    return this.params?.code ?? '';
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
