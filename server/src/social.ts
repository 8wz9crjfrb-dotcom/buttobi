// フレンド機能のサーバー（Durable Object 1つで全員ぶんを管理する）。
// URL: wss://<worker>/social  → アプリを開いている間つなぎっぱなしにする（つながっている＝オンライン）
// 保存するもの：
//   u:<id>   … その人の記録（フレンドコード・名前・フレンド・届いた申請・送った申請・隠す設定）
//   c:<コード> … フレンドコード → id
//   d:<id>|<id> … フレンド2人の DM（新しい DM_KEEP 通まで。id は小さい順）
// 公開ルームは保存しない。接続ごとに覚えておき（サーバーが休んでも接続とともに残る）、接続が切れたら消える

import { DurableObject } from 'cloudflare:workers';
import { sanitizeName } from '../../src/shared/protocol';
import {
  DM_COOLDOWN_MS,
  DM_KEEP,
  DM_PHRASES,
  DM_ROOM_PHRASE,
  PIC_STAMP_COUNT,
  FRIEND_ALPHABET,
  MAX_FRIENDS,
  MAX_INBOX,
  SOCIAL_VERSION,
  isSocialId,
  normalizeFriendCode,
  sanitizeProfile,
  type DmMsg,
  type FriendInfo,
  type Profile,
  type SharedRoom,
  type SocialClientMsg,
  type SocialServerMsg,
} from '../../src/shared/social';
import { isRoomCode, MAX_PLAYERS } from '../../src/shared/protocol';
import { CHARACTERS } from '../../src/shared/characters';

const CHAR_IDS = CHARACTERS.map((c) => c.id);

interface User {
  code: string;
  name: string;
  friends: string[];
  /** 届いた申請（申請してきた人の id） */
  inbox: string[];
  /** 送った申請（送った相手の id） */
  sent: string[];
  hidden: boolean;
  /** フレンドに見せるプロフィール */
  profile?: Profile;
  /** 最後にアプリを開いていた時刻（在席を隠している間は更新しない） */
  seen?: number;
  /** まだ読んでいない DM の数（送ってきたフレンドの id → 数） */
  un?: Record<string, number>;
}

/** 保存する DM（s = 送った人の id） */
interface StoredDm {
  s: string;
  k: 'p' | 's';
  i: number;
  t?: number;
  r?: string;
  at: number;
}
const dmKey = (a: string, b: string) => `d:${a < b ? `${a}|${b}` : `${b}|${a}`}`;

interface Attachment {
  id: string;
  /** この接続から、フレンドに公開しているルーム */
  room?: SharedRoom;
}

export class Social extends DurableObject {
  private users = new Map<string, User>();
  /** 最後に DM を送った時刻（送りすぎを防ぐ。サーバーが休むと消えるが、それで困ることはない） */
  private lastDm = new Map<string, number>();

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket only', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: '' } as Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------
  private send(ws: WebSocket, msg: SocialServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 切れている
    }
  }

  private async user(id: string): Promise<User | null> {
    const hit = this.users.get(id);
    if (hit) return hit;
    const u = (await this.ctx.storage.get<User>(`u:${id}`)) ?? null;
    if (u) this.users.set(id, u);
    return u;
  }

  private async save(id: string, u: User): Promise<void> {
    this.users.set(id, u);
    await this.ctx.storage.put(`u:${id}`, u);
  }

  private async idOf(code: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`c:${code}`)) ?? null;
  }

  private async newCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const b = crypto.getRandomValues(new Uint8Array(8));
      let s = '';
      for (const x of b) s += FRIEND_ALPHABET[x % FRIEND_ALPHABET.length];
      const code = `${s.slice(0, 4)}-${s.slice(4)}`;
      if (!(await this.idOf(code))) return code;
    }
    throw new Error('code');
  }

  /** つながっている人の id ごとの接続 */
  private sockets(): Map<string, WebSocket[]> {
    const m = new Map<string, WebSocket[]>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a?.id) continue;
      m.set(a.id, [...(m.get(a.id) ?? []), ws]);
    }
    return m;
  }

  /** その人がフレンドに公開しているルーム（どれかの接続から） */
  private roomOf(list: WebSocket[] | undefined): SharedRoom | undefined {
    for (const ws of list ?? []) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.room) return a.room;
    }
    return undefined;
  }

  /** その人に見せる状態（フレンドのオンライン・公開ルーム、申請） */
  private async stateFor(id: string, online: Map<string, WebSocket[]>): Promise<SocialServerMsg | null> {
    const u = await this.user(id);
    if (!u) return null;
    const friends: FriendInfo[] = [];
    for (const fid of u.friends) {
      const f = await this.user(fid);
      if (!f) continue;
      const on = online.has(fid);
      const room = this.roomOf(online.get(fid));
      // 隠していればオフラインに見える。ただし、自分から公開したルームは見せる
      const shownOnline = on && !f.hidden;
      const un = u.un?.[fid] ?? 0;
      friends.push({ code: f.code, name: f.name, online: shownOnline, ...(un ? { un } : {}), ...(room ? { room } : {}), ...(f.profile ? { prof: f.profile } : {}), ...(!shownOnline && !f.hidden && f.seen ? { seen: f.seen } : {}) });
    }
    const names = async (ids: string[]) => {
      const out: { code: string; name: string }[] = [];
      for (const x of ids) {
        const o = await this.user(x);
        if (o) out.push({ code: o.code, name: o.name });
      }
      return out;
    };
    return { t: 'state', friends, inbox: await names(u.inbox), sent: await names(u.sent) };
  }

  /** ids の人たち（つながっている人だけ）に最新の状態を送る */
  private async push(ids: Iterable<string>): Promise<void> {
    const online = this.sockets();
    for (const id of new Set(ids)) {
      const list = online.get(id);
      if (!list) continue;
      const st = await this.stateFor(id, online);
      if (st) for (const ws of list) this.send(ws, st);
    }
  }

  /** 本人と、そのフレンド全員に知らせる */
  private async pushAround(id: string): Promise<void> {
    const u = await this.user(id);
    await this.push([id, ...(u?.friends ?? [])]);
  }

  // ---------------------------------------------------------------
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let msg: SocialClientMsg;
    try {
      msg = JSON.parse(raw) as SocialClientMsg;
    } catch {
      return;
    }
    const a = ws.deserializeAttachment() as Attachment | null;
    if (msg.t === 'hi') {
      if (msg.v !== SOCIAL_VERSION || !isSocialId(msg.id)) return this.send(ws, { t: 'err', msg: 'アプリを開き直してください' });
      let u = await this.user(msg.id);
      if (!u) {
        u = { code: await this.newCode(), name: sanitizeName(msg.name), friends: [], inbox: [], sent: [], hidden: !!msg.hidden };
        await this.ctx.storage.put(`c:${u.code}`, msg.id);
      } else {
        u.name = sanitizeName(msg.name);
        u.hidden = !!msg.hidden;
      }
      if (!u.hidden) u.seen = Date.now();
      await this.save(msg.id, u);
      ws.serializeAttachment({ id: msg.id } as Attachment);
      this.send(ws, { t: 'me', code: u.code });
      await this.pushAround(msg.id);
      return;
    }
    const id = a?.id;
    if (!id) return;
    const me = await this.user(id);
    if (!me) return;
    const err = (m: string) => this.send(ws, { t: 'err', msg: m });

    switch (msg.t) {
      case 'add': {
        const code = normalizeFriendCode(msg.code);
        if (!code) return err('フレンドコードの形が正しくありません（例：ABCD-EFGH）');
        const oid = await this.idOf(code);
        const other = oid ? await this.user(oid) : null;
        if (!oid || !other) return err('そのフレンドコードは見つかりません');
        if (oid === id) return err('自分のフレンドコードです');
        if (me.friends.includes(oid)) return err(`${other.name} さんとは、もうフレンドです`);
        if (me.friends.length >= MAX_FRIENDS) return err(`フレンドは${MAX_FRIENDS}人までです`);
        if (me.inbox.includes(oid)) {
          // 相手からもう申請が来ている：すぐフレンドになる
          await this.befriend(id, me, oid, other);
          this.send(ws, { t: 'ok', msg: `${other.name} さんとフレンドになりました` });
          return;
        }
        if (me.sent.includes(oid)) return err(`${other.name} さんには、もう申請しています`);
        if (other.inbox.length >= MAX_INBOX) return err('相手に届いている申請がいっぱいです');
        me.sent.push(oid);
        other.inbox.push(id);
        await this.save(id, me);
        await this.save(oid, other);
        this.send(ws, { t: 'ok', msg: `${other.name} さんに申請しました` });
        await this.push([id, oid]);
        return;
      }
      case 'accept': {
        const oid = await this.idOf(normalizeFriendCode(msg.code) ?? '');
        const other = oid ? await this.user(oid) : null;
        if (!oid || !other || !me.inbox.includes(oid)) return err('申請が見つかりません');
        if (me.friends.length >= MAX_FRIENDS) return err(`フレンドは${MAX_FRIENDS}人までです`);
        await this.befriend(id, me, oid, other);
        this.send(ws, { t: 'ok', msg: `${other.name} さんとフレンドになりました` });
        return;
      }
      case 'decline':
      case 'cancel':
      case 'remove': {
        const oid = await this.idOf(normalizeFriendCode(msg.code) ?? '');
        const other = oid ? await this.user(oid) : null;
        if (!oid || !other) return;
        const drop = (list: string[], x: string) => list.filter((v) => v !== x);
        if (msg.t === 'decline') {
          me.inbox = drop(me.inbox, oid);
          other.sent = drop(other.sent, id);
        } else if (msg.t === 'cancel') {
          me.sent = drop(me.sent, oid);
          other.inbox = drop(other.inbox, id);
        } else {
          me.friends = drop(me.friends, oid);
          other.friends = drop(other.friends, id);
          // フレンドでなくなったら、DM も消す
          if (me.un) delete me.un[oid];
          if (other.un) delete other.un[id];
          await this.ctx.storage.delete(dmKey(id, oid));
        }
        await this.save(id, me);
        await this.save(oid, other);
        await this.push([id, oid]);
        return;
      }
      case 'hidden':
        me.hidden = !!msg.on;
        await this.save(id, me);
        await this.pushAround(id);
        return;
      case 'name':
        me.name = sanitizeName(msg.name);
        await this.save(id, me);
        await this.pushAround(id);
        return;
      case 'profile': {
        const p = sanitizeProfile(msg.p, CHAR_IDS);
        if (!p) return;
        me.profile = p;
        await this.save(id, me);
        await this.pushAround(id);
        return;
      }
      case 'dmOpen':
      case 'dmSend': {
        const oid = await this.idOf(normalizeFriendCode(msg.code) ?? '');
        const other = oid ? await this.user(oid) : null;
        if (!oid || !other || !me.friends.includes(oid)) return err('フレンドにだけ送れます');
        const key = dmKey(id, oid);
        let list = (await this.ctx.storage.get<StoredDm[]>(key)) ?? [];
        const view = (forId: string): DmMsg[] => list.map((m) => ({ me: m.s === forId, k: m.k, i: m.i, ...(m.t ? { t: m.t } : {}), ...(m.r ? { r: m.r } : {}), at: m.at }));
        if (msg.t === 'dmSend') {
          const k = msg.k === 's' ? 's' : 'p';
          const i = Number(msg.i) | 0;
          if (i < 0 || i >= (k === 'p' ? DM_PHRASES.length : PIC_STAMP_COUNT)) return;
          const now = Date.now();
          // 1秒に1回まで（端末の時計のずれを少し見込む）
          if (now - (this.lastDm.get(id) ?? 0) < DM_COOLDOWN_MS - 150) return;
          this.lastDm.set(id, now);
          const r = k === 'p' && i === DM_ROOM_PHRASE && isRoomCode(String(msg.r ?? '')) ? String(msg.r) : undefined;
          // スタンプのレア度（SSR・UR）。持っているかはサーバーでは分からないので、形だけそろえる
          const tier = k === 's' && (msg.tier === 5 || msg.tier === 6) ? msg.tier : undefined;
          const m: StoredDm = { s: id, k, i, ...(tier ? { t: tier } : {}), ...(r ? { r } : {}), at: now };
          list = [...list, m].slice(-DM_KEEP);
          await this.ctx.storage.put(key, list);
          other.un = { ...(other.un ?? {}), [id]: Math.min(99, (other.un?.[id] ?? 0) + 1) };
          await this.save(oid, other);
          // 相手のつながっている端末に届ける
          const online = this.sockets();
          for (const ows of online.get(oid) ?? []) this.send(ows, { t: 'dmNew', code: me.code, name: me.name, m: { me: false, k, i, ...(tier ? { t: tier } : {}), ...(r ? { r } : {}), at: now } });
          await this.push([oid]);
        } else if (me.un?.[oid]) {
          // 開いた：既読にする
          delete me.un[oid];
          await this.save(id, me);
          await this.push([id]);
        }
        this.send(ws, { t: 'dm', code: other.code, list: view(id) });
        return;
      }
      case 'room': {
        const r = msg.room;
        const room: SharedRoom | undefined =
          r && isRoomCode(String(r.code)) ? { code: String(r.code), n: Math.max(0, Math.min(MAX_PLAYERS, Number(r.n) | 0)), max: MAX_PLAYERS, match: !!r.match } : undefined;
        ws.serializeAttachment({ id, ...(room ? { room } : {}) } as Attachment);
        await this.pushAround(id);
        return;
      }
    }
  }

  private async befriend(id: string, me: User, oid: string, other: User): Promise<void> {
    const drop = (list: string[], x: string) => list.filter((v) => v !== x);
    me.inbox = drop(me.inbox, oid);
    me.sent = drop(me.sent, oid);
    other.inbox = drop(other.inbox, id);
    other.sent = drop(other.sent, id);
    if (!me.friends.includes(oid)) me.friends.push(oid);
    if (!other.friends.includes(id)) other.friends.push(id);
    await this.save(id, me);
    await this.save(oid, other);
    await this.push([id, oid]);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.left(ws);
  }

  /** 接続が切れた：その人の最後の接続なら、公開ルームを消してフレンドに知らせる */
  private async left(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a?.id) return;
    ws.serializeAttachment({ id: '' } as Attachment);
    const still = this.ctx.getWebSockets().some((x) => x !== ws && (x.deserializeAttachment() as Attachment | null)?.id === a.id);
    if (still) return;
    // 最後にアプリを開いていた時刻（在席を隠している人は記録しない）
    const u = await this.user(a.id);
    if (u && !u.hidden) {
      u.seen = Date.now();
      await this.save(a.id, u);
    }
    await this.pushAround(a.id);
  }
}
