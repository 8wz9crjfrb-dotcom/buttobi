// フレンド機能の端末側：アプリを開いている間、対戦サーバーの /social につなぎっぱなしにする（つながっている＝オンライン）。
// 人に見せない番号（id）はこの端末に保存する（データ引き継ぎで別の端末へ移せる）。

import { httpBase } from './transfer';
import { friendHash, SOCIAL_VERSION, type FriendInfo, type Profile, type SharedRoom, type SocialClientMsg, type SocialServerMsg } from '../shared/social';

export const SOCIAL_KEY = 'buttobi-social-v1';

interface Stored {
  id?: string;
  /** フレンドコード → 一緒に戦った回数（オンライン対戦が最後まで終わったとき数える） */
  together?: Record<string, number>;
}
function readStored(): Stored {
  try {
    const raw = localStorage.getItem(SOCIAL_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}
function writeStored(v: Stored): void {
  try {
    localStorage.setItem(SOCIAL_KEY, JSON.stringify(v));
  } catch {
    // 保存できない（プライベートブラウズなど）
  }
}

/** この端末の id（なければ作って保存する） */
function loadId(): string {
  const v = readStored();
  if (v.id && /^[0-9a-f]{32}$/.test(v.id)) return v.id;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  writeStored({ ...v, id });
  return id;
}

export interface SocialState {
  friends: FriendInfo[];
  inbox: { code: string; name: string }[];
  sent: { code: string; name: string }[];
}

export class SocialClient {
  private ws: WebSocket | null = null;
  private url = '';
  private name = '';
  private hidden = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** 公開中のルーム（つなぎ直したときに送り直す） */
  private room: SharedRoom | null = null;
  /** 自分のプロフィール（つなぎ直したときに送り直す） */
  private profile: Profile | null = null;
  id = loadId();
  /** 自分のフレンドコード（つながるまでは空） */
  code = '';
  connected = false;
  state: SocialState = { friends: [], inbox: [], sent: [] };
  /** 状態が変わったとき（画面を描き直す） */
  onChange: () => void = () => {};
  /** サーバーからのお知らせ（申請しました・エラーなど） */
  onNotice: (msg: string, ok: boolean) => void = () => {};

  /** つなぐ（サーバーの URL が空なら何もしない） */
  start(serverUrl: string, name: string, hidden: boolean): void {
    this.name = name;
    this.hidden = hidden;
    const url = serverUrl ? `${httpBase(serverUrl).replace(/^http/, 'ws')}/social` : '';
    if (url === this.url && this.ws) return;
    this.stop();
    this.url = url;
    if (url) this.open();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    ws?.close();
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.later();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.send({ t: 'hi', v: SOCIAL_VERSION, id: this.id, name: this.name, hidden: this.hidden });
      if (this.room) this.send({ t: 'room', room: this.room });
      if (this.profile) this.send({ t: 'profile', p: this.profile });
    };
    ws.onmessage = (e) => {
      let m: SocialServerMsg;
      try {
        m = JSON.parse(String(e.data)) as SocialServerMsg;
      } catch {
        return;
      }
      if (m.t === 'me') this.code = m.code;
      else if (m.t === 'state') this.state = { friends: m.friends, inbox: m.inbox, sent: m.sent };
      else if (m.t === 'err' || m.t === 'ok') this.onNotice(m.msg, m.t === 'ok');
      this.onChange();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.onChange();
      this.later();
    };
  }

  /** 切れたら、少しずつ間をあけてつなぎ直す（最大30秒） */
  private later(): void {
    if (!this.url || this.timer) return;
    const wait = Math.min(30000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.ws) this.open();
    }, wait);
  }

  private send(m: SocialClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  add(code: string): void {
    this.send({ t: 'add', code });
  }
  accept(code: string): void {
    this.send({ t: 'accept', code });
  }
  decline(code: string): void {
    this.send({ t: 'decline', code });
  }
  cancel(code: string): void {
    this.send({ t: 'cancel', code });
  }
  remove(code: string): void {
    this.send({ t: 'remove', code });
  }
  setHidden(on: boolean): void {
    this.hidden = on;
    this.send({ t: 'hidden', on });
  }
  setName(name: string): void {
    if (name === this.name) return;
    this.name = name;
    this.send({ t: 'name', name });
  }
  /** 自分のルームをフレンドに公開する（null で取り消す）。同じ内容なら送らない */
  shareRoom(room: SharedRoom | null): void {
    if (JSON.stringify(room) === JSON.stringify(this.room)) return;
    this.room = room;
    this.send({ t: 'room', room });
  }

  /** 自分のプロフィールをフレンドに見せる（同じ内容なら送らない） */
  setProfile(p: Profile): void {
    if (JSON.stringify(p) === JSON.stringify(this.profile)) return;
    this.profile = p;
    this.send({ t: 'profile', p });
  }

  /** そのフレンドと一緒に戦った回数 */
  together(code: string): number {
    return readStored().together?.[code] ?? 0;
  }
  /** オンライン対戦が終わった：一緒にいたフレンド（印 fh で見分ける）の回数を1つ増やす */
  countTogether(hashes: string[]): void {
    const set = new Set(hashes);
    const hit = this.state.friends.filter((f) => set.has(friendHash(f.code)));
    if (!hit.length) return;
    const v = readStored();
    const t = { ...(v.together ?? {}) };
    for (const f of hit) t[f.code] = (t[f.code] ?? 0) + 1;
    writeStored({ ...v, together: t });
  }
  /** 自分のフレンドコードの印 */
  get hash(): string {
    return this.code ? friendHash(this.code) : '';
  }

  /** オンラインのフレンドの数 */
  get onlineCount(): number {
    return this.state.friends.filter((f) => f.online || f.room).length;
  }
}
