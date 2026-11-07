// コイン（今後の着せ替えガチャで使う）。ログインボーナスと、勝利・通算勝利数の節目で増える。
// アカウントがないので、この端末のブラウザに保存する（端末ごと・ブラウザごとに別になる）。

const KEY = 'buttobi-wallet-v1';

export interface Wallet {
  coins: number;
  /** 通算勝利数（CPU戦・オンライン） */
  wins: { cpu: number; online: number };
  /** 最後にログインボーナスを受け取った日（端末の日付、YYYY-MM-DD） */
  lastLogin: string;
  /** 連続ログイン日数（1〜7 をくり返す） */
  streak: number;
  /** 受け取り済みの通算勝利ボーナスの勝利数 */
  milestone: number;
}

/** ログインボーナス：連続1〜7日目のコイン（7日目は多め。8日目からまた1日目） */
export const LOGIN_REWARDS = [50, 50, 50, 50, 50, 50, 200];

/** 1勝ごとのコイン。CPU戦は強さで変わる（弱いCPUだけで集めにくくする） */
export function winReward(online: boolean, cpuLevel: number): number {
  if (online) return 30;
  return cpuLevel >= 7 ? 15 : cpuLevel >= 3 ? 10 : 5;
}

/** 通算勝利数の節目と、もらえるコイン（100勝からは100勝ごとに500） */
export function milestoneReward(wins: number): number {
  if (wins === 10) return 100;
  if (wins === 30) return 200;
  if (wins === 50) return 300;
  if (wins >= 100 && wins % 100 === 0) return 500;
  return 0;
}

function fresh(): Wallet {
  return { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0 };
}

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const w = JSON.parse(raw) as Partial<Wallet>;
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
    return {
      coins: num(w.coins),
      wins: { cpu: num(w.wins?.cpu), online: num(w.wins?.online) },
      lastLogin: typeof w.lastLogin === 'string' ? w.lastLogin : '',
      streak: Math.min(7, num(w.streak)),
      milestone: num(w.milestone),
    };
  } catch {
    return fresh();
  }
}

export function saveWallet(w: Wallet): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    // 保存できない環境（プライベートブラウズなど）では、その回だけ有効
  }
}

/** 端末の日付（YYYY-MM-DD） */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 今日のログインボーナスを受け取る。今日すでに受け取っていれば null */
export function claimLogin(w: Wallet, now = new Date()): { day: number; amount: number } | null {
  const today = dayKey(now);
  if (w.lastLogin === today) return null;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const continued = w.lastLogin === dayKey(y);
  w.streak = continued ? (w.streak % 7) + 1 : 1;
  w.lastLogin = today;
  const amount = LOGIN_REWARDS[w.streak - 1];
  w.coins += amount;
  return { day: w.streak, amount };
}

/** 勝ったときに記録して、もらえるコインを返す */
export function recordWin(w: Wallet, online: boolean, cpuLevel: number): { base: number; bonus: { wins: number; amount: number } | null; total: number } {
  if (online) w.wins.online++;
  else w.wins.cpu++;
  const base = winReward(online, cpuLevel);
  w.coins += base;
  const total = w.wins.cpu + w.wins.online;
  let bonus: { wins: number; amount: number } | null = null;
  const amt = milestoneReward(total);
  if (amt > 0 && total > w.milestone) {
    w.milestone = total;
    w.coins += amt;
    bonus = { wins: total, amount: amt };
  }
  return { base, bonus, total };
}
