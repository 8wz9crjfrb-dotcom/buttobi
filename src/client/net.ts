// オンライン対戦の通信（WebSocket）と、受け取った状態の補間表示

import {
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
  private lastSent = { mx: 0, my: 0, b: 0 };
  private lastSendAt = 0;
  /** まだ送っていない「押された」ボタン（短い押しを取りこぼさないため） */
  private pressAcc = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  rtt = 0;
  slot = -1;
  private closedByUser = false;

  constructor(private handlers: NetHandlers) {}

  connect(baseUrl: string, code: string, create: boolean, name: string, charId: string): void {
    this.close();
    this.closedByUser = false;
    const url = `${baseUrl.replace(/\/$/, '')}/room/${code}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name, charId, create });
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
      if (!this.closedByUser) this.handlers.onClose();
    };
    ws.onerror = () => {
      /* onclose で処理する */
    };
  }

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.slot = m.slot;
        this.handlers.onWelcome(m.slot);
        break;
      case 'lobby':
        this.handlers.onLobby(m.lobby);
        break;
      case 'start':
        this.snaps = [];
        this.pendingEvents = [];
        this.handlers.onStart(m.setup);
        break;
      case 'snap': {
        const view = decodeState(m.s);
        this.snaps.push({ at: performance.now(), view });
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
        this.handlers.onError(m.code, m.msg);
        break;
    }
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** 入力を送る。変化したとき（最大30回/秒）と、変化がなくても200msごとに送る */
  sendInput(inp: InputState, pressed: number): void {
    const now = performance.now();
    const mx = Math.round(inp.mx * 20) / 20;
    const my = Math.round(inp.my * 20) / 20;
    this.pressAcc |= pressed;
    const b = inp.buttons | this.pressAcc;
    const changed = mx !== this.lastSent.mx || my !== this.lastSent.my || b !== this.lastSent.b;
    if ((changed && now - this.lastSendAt >= 33) || now - this.lastSendAt >= 200) {
      this.send({ t: 'in', mx, my, b });
      this.lastSent = { mx, my, b };
      this.lastSendAt = now;
      this.pressAcc = 0;
    }
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

  setChar(charId: string): void {
    this.send({ t: 'char', charId });
  }

  config(rules: MatchRules, stageId: string, cpuCount: number, cpuLevel: number): void {
    this.send({ t: 'config', rules, stageId, cpuCount, cpuLevel });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  close(): void {
    this.closedByUser = true;
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

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
