// コインと着せ替えガチャ。コインはログインボーナスと、勝利・通算勝利数の節目で増え、ガチャで衣装を引くのに使う。
// アカウントがないので、この端末のブラウザに保存する（端末ごと・ブラウザごとに別になる）。

import { GACHA_COSTUMES } from '../shared/costumes';

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
  /** 持っている衣装の id */
  owned: string[];
  /** SSR も UR も出ないまま引いた回数（SSR の天井用。SSR か UR が出たら 0 に戻る） */
  pity: number;
  /** UR が出ないまま引いた回数（UR の天井用。UR が出たら 0 に戻る） */
  urPity: number;
}

// ---------------------------------------------------------------- 着せ替えガチャ
/** 1回・10回の値段 */
export const GACHA_COST = { one: 100, ten: 900 };
/** UR・SSR が出る確率（残りは SR）。UR の衣装がまだ1着もないうちは UR は出ない */
export const UR_RATE = 0.03;
export const SSR_RATE = 0.1;
/** 天井：UR が出ないまま60回目は必ず UR、SSR 以上が出ないまま30回目は必ず SSR */
export const UR_PITY_LIMIT = 60;
export const PITY_LIMIT = 30;
/** すでに持っている衣装が出たら、代わりにもらえるコイン */
export const DUP_REFUND: Record<number, number> = { 4: 20, 5: 200, 6: 500 };

/** UR の衣装があるか（なければ UR は出ない・天井も数えない） */
export const urAvailable = () => GACHA_COSTUMES.some((c) => c.rarity === 6);

export interface PullResult {
  id: string;
  rarity: number;
  /** すでに持っていた（コインに変わった） */
  dup: boolean;
  refund: number;
}

/** ガチャを引く。コインが足りなければ null */
export function pullGacha(w: Wallet, count: 1 | 10, rng: () => number = Math.random): PullResult[] | null {
  const cost = count === 10 ? GACHA_COST.ten : GACHA_COST.one;
  if (w.coins < cost) return null;
  w.coins -= cost;
  const out: PullResult[] = [];
  for (let i = 0; i < count; i++) {
    const ur = urAvailable();
    const roll = rng();
    // UR の天井 → UR、そうでなければ確率で UR。次に SSR の天井 → SSR、そうでなければ確率で SSR
    const rarity = ur && (w.urPity >= UR_PITY_LIMIT - 1 || roll < UR_RATE) ? 6 : w.pity >= PITY_LIMIT - 1 || roll < (ur ? UR_RATE : 0) + SSR_RATE ? 5 : 4;
    if (ur) w.urPity = rarity === 6 ? 0 : w.urPity + 1;
    // SSR の天井は、SSR か UR が出たら 0 に戻る
    w.pity = rarity >= 5 ? 0 : w.pity + 1;
    const pool = GACHA_COSTUMES.filter((c) => c.rarity === rarity);
    const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    const dup = w.owned.includes(pick.id) || out.some((o) => o.id === pick.id && !o.dup);
    const refund = dup ? DUP_REFUND[pick.rarity] ?? 0 : 0;
    if (dup) w.coins += refund;
    else w.owned.push(pick.id);
    out.push({ id: pick.id, rarity: pick.rarity, dup, refund });
  }
  return out;
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
  return { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0, urPity: 0 };
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
      owned: Array.isArray(w.owned) ? w.owned.filter((id): id is string => typeof id === 'string' && GACHA_COSTUMES.some((c) => c.id === id)) : [],
      // 天井が50回から30回に変わったので、それより多く数えていた分は30回目の手前でそろえる
      pity: Math.min(PITY_LIMIT - 1, num(w.pity)),
      urPity: Math.min(UR_PITY_LIMIT - 1, num(w.urPity)),
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
