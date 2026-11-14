// データ引き継ぎ：端末のデータ（コイン・衣装・戦績・設定）を一時的に預かり、引き継ぎコードで別の端末へ渡す。
// - POST /transfer           本文：データ（JSON の文字列）→ { code, expires }
// - POST /transfer/<コード>   → { data }（受け取ったら消える。1回だけ使える）
// コードは推測されにくい12文字（約60ビット）。使わなければ TTL_MS で消える。

import { DurableObject } from 'cloudflare:workers';

/** 預かる期間 */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 預かるデータの大きさの上限 */
export const MAX_BYTES = 64 * 1024;
/** 引き継ぎコードに使う文字（見間違えやすい 0/O・1/I/L は使わない） */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeTransferCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** 入力されたコードをそろえる（小文字・空白・ハイフンの有無を気にしない）。形がおかしければ null */
export function normalizeTransferCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 12 || [...s].some((ch) => !ALPHABET.includes(ch))) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** 引き継ぎコード1つぶんの預かり箱 */
export class TransferBox extends DurableObject {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/put') {
      const data = await req.text();
      if (await this.ctx.storage.get('data')) return new Response('taken', { status: 409 });
      const expires = Date.now() + TTL_MS;
      await this.ctx.storage.put({ data, expires });
      await this.ctx.storage.setAlarm(expires);
      return Response.json({ expires });
    }
    if (url.pathname === '/take') {
      const data = await this.ctx.storage.get<string>('data');
      const expires = (await this.ctx.storage.get<number>('expires')) ?? 0;
      if (!data || expires < Date.now()) {
        await this.ctx.storage.deleteAll();
        return new Response('notfound', { status: 404 });
      }
      // 1回だけ使える：渡したら消す
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return Response.json({ data });
    }
    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
