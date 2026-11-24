// スタンプ＆背景ガチャ（衣装ガチャとは別。天井も別に数える）。
// 確率と天井は衣装ガチャと同じ：UR 3%・SSR 7%・残りは SR。SSR 以上が出ないまま30回目は SSR、UR が出ないまま60回目は UR。
// 出るもの：
//   スタンプ … 言葉ごとに SR → SSR → UR とアップグレードする（持っているより上のレア度が出たら格上げ、同じか下ならコインに）
//   背景     … SR（動かない絵）・SSR（動く）・UR（いくつも動いて縁が光る）
// 同じレア度の中では、スタンプと背景が半々で出る。

import { CARD_BGS } from './cardBgs';
import { FREE_STAMPS, PIC_STAMPS } from './stamps';
import { PITY_LIMIT, SSR_RATE, UR_PITY_LIMIT, UR_RATE, type Wallet } from './wallet';

/** 1回・10回の値段 */
export const ITEM_COST = { one: 80, ten: 720 };
/** 持っているもの（同じか下のレア度のスタンプ）が出たら、代わりにもらえるコイン */
export const ITEM_DUP_REFUND: Record<number, number> = { 4: 15, 5: 150, 6: 400 };

export interface ItemPull {
  kind: 's' | 'b';
  /** スタンプの番号（0〜）／背景の番号（1〜） */
  id: number;
  rarity: number;
  dup: boolean;
  refund: number;
  /** スタンプが前より上のレア度になった */
  up?: boolean;
}

/** そのスタンプを持っているレア度（4 SR・5 SSR・6 UR。持っていなければ 0） */
export function stampTier(w: Wallet, i: number): number {
  const t = w.stamps?.[i] ?? 0;
  return Math.max(t, FREE_STAMPS.includes(i) ? 4 : 0);
}

/** 背景を持っているか */
export function ownsBg(w: Wallet, bg: number): boolean {
  return bg === 0 || !!w.bgs?.includes(bg);
}

/** 持っている数（スタンプは言葉の数、背景は種類の数） */
export function itemCounts(w: Wallet): { stamps: number; bgs: number } {
  return { stamps: PIC_STAMPS.filter((_, i) => stampTier(w, i) > 0).length, bgs: CARD_BGS.filter((_, i) => ownsBg(w, i + 1)).length };
}

/** ガチャを引く。コインが足りなければ null */
export function pullItems(w: Wallet, count: 1 | 10, rng: () => number = Math.random): ItemPull[] | null {
  const cost = count === 10 ? ITEM_COST.ten : ITEM_COST.one;
  if (w.coins < cost) return null;
  w.coins -= cost;
  w.ipity ??= 0;
  w.iurPity ??= 0;
  w.stamps ??= {};
  w.bgs ??= [];
  const out: ItemPull[] = [];
  for (let n = 0; n < count; n++) {
    const roll = rng();
    // UR の天井 → UR、そうでなければ確率で UR。次に SSR の天井 → SSR、そうでなければ確率で SSR（衣装ガチャと同じ）
    const rarity: 4 | 5 | 6 = w.iurPity >= UR_PITY_LIMIT - 1 || roll < UR_RATE ? 6 : w.ipity >= PITY_LIMIT - 1 || roll < UR_RATE + SSR_RATE ? 5 : 4;
    w.iurPity = rarity === 6 ? 0 : w.iurPity + 1;
    w.ipity = rarity >= 5 ? 0 : w.ipity + 1;
    const bgPool = CARD_BGS.map((d, i) => ({ d, id: i + 1 })).filter((x) => x.d.rarity === rarity);
    // スタンプと背景は半々（そのレア度の背景がなければスタンプ）
    if (bgPool.length && rng() < 0.5) {
      const pick = bgPool[Math.min(bgPool.length - 1, Math.floor(rng() * bgPool.length))].id;
      const dup = w.bgs.includes(pick);
      const refund = dup ? ITEM_DUP_REFUND[rarity] : 0;
      if (dup) w.coins += refund;
      else w.bgs.push(pick);
      out.push({ kind: 'b', id: pick, rarity, dup, refund });
    } else {
      const i = Math.min(PIC_STAMPS.length - 1, Math.floor(rng() * PIC_STAMPS.length));
      const had = stampTier(w, i);
      const dup = had >= rarity;
      const refund = dup ? ITEM_DUP_REFUND[rarity] : 0;
      if (dup) w.coins += refund;
      else w.stamps[i] = rarity;
      out.push({ kind: 's', id: i, rarity, dup, refund, ...(!dup && had > 0 ? { up: true } : {}) });
    }
  }
  return out;
}
