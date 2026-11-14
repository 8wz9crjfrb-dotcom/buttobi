// データ引き継ぎ：この端末のデータ（コイン・衣装・戦績・称号・ミッション・設定）を対戦サーバーに一時的に預け、
// 引き継ぎコードを別の端末で入力して受け取る。コードは1回だけ使え、使わなければ30日で消える（server/src/transfer.ts）。

const KEYS = {
  wallet: 'buttobi-wallet-v1',
  progress: 'buttobi-progress-v1',
  settings: 'buttobi-settings-v1',
} as const;

interface Packed {
  v: 1;
  /** 預けた時刻 */
  at: number;
  wallet: string | null;
  progress: string | null;
  settings: string | null;
}

/** 対戦サーバーの URL（wss://〜）から、ふつうの通信の URL（https://〜）を作る */
export function httpBase(serverUrl: string): string {
  return serverUrl.trim().replace(/^ws(s?):\/\//i, 'http$1://').replace(/\/+$/, '');
}

/** この端末のデータをまとめる */
export function packData(): string {
  const get = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const data: Packed = { v: 1, at: Date.now(), wallet: get(KEYS.wallet), progress: get(KEYS.progress), settings: get(KEYS.settings) };
  return JSON.stringify(data);
}

/** 預けて、引き継ぎコードと期限を受け取る */
export async function issueTransfer(serverUrl: string): Promise<{ code: string; expires: number }> {
  const res = await fetch(`${httpBase(serverUrl)}/transfer`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: packData() });
  if (!res.ok) throw new Error(`発行できませんでした（${res.status}）`);
  return (await res.json()) as { code: string; expires: number };
}

/** 引き継ぎコードでデータを受け取る（受け取ったコードはもう使えない） */
export async function takeTransfer(serverUrl: string, code: string): Promise<string> {
  const res = await fetch(`${httpBase(serverUrl)}/transfer/${encodeURIComponent(code.trim())}`, { method: 'POST' });
  if (res.status === 404) throw new Error('コードが見つかりません（入力まちがい・使用済み・期限切れのどれかです）');
  if (res.status === 400) throw new Error('コードの形が正しくありません（例：ABCD-EFGH-JKMN）');
  if (!res.ok) throw new Error(`受け取れませんでした（${res.status}）`);
  return ((await res.json()) as { data: string }).data;
}

/**
 * 受け取ったデータでこの端末を上書きする。対戦サーバーの URL はこの端末のものを残す。
 * 中身の細かい確認は、読み込むとき（loadWallet・loadProgress・loadSettings）に行われる。
 */
export function applyData(raw: string, keepServerUrl: string): void {
  const d = JSON.parse(raw) as Partial<Packed>;
  if (d.v !== 1) throw new Error('この版のデータは読み込めません');
  const okJson = (s: unknown): s is string => {
    if (typeof s !== 'string') return false;
    try {
      return typeof JSON.parse(s) === 'object';
    } catch {
      return false;
    }
  };
  if (okJson(d.wallet)) localStorage.setItem(KEYS.wallet, d.wallet);
  if (okJson(d.progress)) localStorage.setItem(KEYS.progress, d.progress);
  if (okJson(d.settings)) {
    const s = JSON.parse(d.settings) as Record<string, unknown>;
    s.serverUrl = keepServerUrl;
    localStorage.setItem(KEYS.settings, JSON.stringify(s));
  }
}
