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

/** プロフィールの「ひとこと」（定型文から選ぶ） */
export const PROFILE_COMMENTS = ['よろしく！', 'いっしょに遊ぼう', 'ガチ勢です', 'まったり勢です', 'フレンド募集中', 'UR集めてます', 'CPU戦で修行中', 'チーム戦が好き'];
/** 名刺カードの色（左上 → 右下のグラデーション） */
export const PROFILE_COLORS: [string, string][] = [
  ['#ff7eb6', '#b05cff'],
  ['#4f9dff', '#2fc6b8'],
  ['#ffb347', '#ff5a5a'],
  ['#4fd18b', '#2a8a5a'],
  ['#5a6bff', '#2a2f7a'],
  ['#ffd23f', '#ff8a3d'],
  ['#3a3f52', '#14161f'],
];

/** プロフィール（フレンドに見せる名刺カード） */
export interface Profile {
  /** お気に入りのキャラと衣装 */
  charId: string;
  costume: string;
  /** 見せる称号（なしなら空） */
  title: string;
  /** ひとこと（PROFILE_COMMENTS の番号） */
  comment: number;
  /** カードの色（PROFILE_COLORS の番号） */
  color: number;
  /** 通算勝利・100人組手の自己ベスト・持っている衣装の数 */
  wins: number;
  horde: number;
  costumes: number;
}

const int = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v)) || 0));
/** 受け取ったプロフィールを安全な形にそろえる（キャラが分からなければ null） */
export function sanitizeProfile(raw: unknown, charIds: string[]): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.charId !== 'string' || !charIds.includes(r.charId)) return null;
  const clean = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').slice(0, n) : '');
  return {
    charId: r.charId,
    costume: clean(r.costume, 40),
    title: clean(r.title, 20),
    comment: int(r.comment, PROFILE_COMMENTS.length - 1),
    color: int(r.color, PROFILE_COLORS.length - 1),
    wins: int(r.wins, 999999),
    horde: int(r.horde, 100),
    costumes: int(r.costumes, 9999),
  };
}

export interface FriendInfo {
  code: string;
  name: string;
  online: boolean;
  room?: SharedRoom;
  /** プロフィール（まだ設定していない人はなし） */
  prof?: Profile;
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
  | { t: 'room'; room: SharedRoom | null }
  /** 自分のプロフィールを送る（つないだときと、変えたとき） */
  | { t: 'profile'; p: Profile };

/** サーバー → 端末 */
export type SocialServerMsg =
  | { t: 'me'; code: string }
  | { t: 'state'; friends: FriendInfo[]; inbox: { code: string; name: string }[]; sent: { code: string; name: string }[] }
  | { t: 'err'; msg: string }
  | { t: 'ok'; msg: string };

/**
 * フレンドコードから作る、元に戻せない短い印（8文字の16進数）。ルームの中ではコードそのものではなくこれを見せ合い、
 * 「フレンドと一緒に戦った回数」を数えるのに使う（フレンドでない人にはコードが分からない）
 */
export function friendHash(code: string): string {
  let h = 0x811c9dc5;
  for (const ch of `tobase:${code}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
export const isFriendHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);

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
