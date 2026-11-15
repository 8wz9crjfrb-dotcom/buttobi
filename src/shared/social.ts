// フレンド機能：端末とサーバーの間でやり取りするメッセージ（JSON）。
// - 端末は、人に見せない長い番号（id。32文字の16進数）を自分で作って持つ。人に教えるのはフレンドコード（例 ABCD-EFGH）
// - フレンドは、申請して相手が承認すると成立する（お互いの同意）
// - オンラインかどうかは、アプリを開いている間（この接続がある間）。「隠す」にすると相手からはオフラインに見える
// - フレンドに公開したルームは、フレンドの一覧に出て、ルームコードを教えなくても参加できる

export const SOCIAL_VERSION = 1;
/** フレンドの上限と、届いている申請の上限 */
export const MAX_FRIENDS = 100;
export const MAX_INBOX = 50;

/** フレンドに公開しているルーム */
export interface SharedRoom {
  /** ルームコード（4桁） */
  code: string;
  /** 今の人数と上限 */
  n: number;
  max: number;
  /** 対戦中 */
  match: boolean;
}

export interface FriendInfo {
  code: string;
  name: string;
  online: boolean;
  room?: SharedRoom;
}

/** 端末 → サーバー */
export type SocialClientMsg =
  | { t: 'hi'; v: number; id: string; name: string; hidden: boolean }
  /** フレンドコードで申請する（相手からもう申請が来ていれば、すぐフレンドになる） */
  | { t: 'add'; code: string }
  | { t: 'accept'; code: string }
  | { t: 'decline'; code: string }
  /** 送った申請を取り消す */
  | { t: 'cancel'; code: string }
  | { t: 'remove'; code: string }
  | { t: 'hidden'; on: boolean }
  | { t: 'name'; name: string }
  /** 自分のルームをフレンドに公開する（null で取り消す） */
  | { t: 'room'; room: SharedRoom | null };

/** サーバー → 端末 */
export type SocialServerMsg =
  | { t: 'me'; code: string }
  | { t: 'state'; friends: FriendInfo[]; inbox: { code: string; name: string }[]; sent: { code: string; name: string }[] }
  | { t: 'err'; msg: string }
  | { t: 'ok'; msg: string };

/** 人に見せない番号の形 */
export function isSocialId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}

/** フレンドコードに使う文字（見間違えやすい 0/O・1/I/L は使わない） */
export const FRIEND_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 入力されたフレンドコードをそろえる（小文字・空白・ハイフンの有無を気にしない）。形がおかしければ null */
export function normalizeFriendCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8 || [...s].some((ch) => !FRIEND_ALPHABET.includes(ch))) return null;
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
