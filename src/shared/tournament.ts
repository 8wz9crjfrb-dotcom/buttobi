// トーナメント（1対1の勝ち抜き戦）の組み合わせ表。サーバーが持ち、端末は表示に使う

/** 1つの試合。a・b は選手の slot（-1 = まだ決まっていない／1回戦ならシード）。w は勝った人の slot（-1 = まだ） */
export interface TourMatch {
  a: number;
  b: number;
  w: number;
}

/**
 * 組み合わせ表を作る（slots は並べたい順。呼ぶ側でシャッフルしておく）。
 * 人数が2の累乗でないときは、1回戦の後ろの試合を「シード」（相手なし＝そのまま勝ち上がり）にする。
 * シードどうしは当たらない（シードの数は試合の数より少ない）
 */
export function makeBracket(slots: number[]): TourMatch[][] {
  const n = slots.length;
  let size = 2;
  while (size < n) size *= 2;
  const first = size / 2;
  const byes = size - n;
  const rounds: TourMatch[][] = [];
  const r0: TourMatch[] = [];
  let k = 0;
  for (let i = 0; i < first; i++) {
    const bye = i >= first - byes;
    r0.push({ a: slots[k++] ?? -1, b: bye ? -1 : slots[k++] ?? -1, w: -1 });
  }
  rounds.push(r0);
  for (let m = first / 2; m >= 1; m /= 2) rounds.push(Array.from({ length: m }, () => ({ a: -1, b: -1, w: -1 })));
  advance(rounds);
  return rounds;
}

/** シードの勝ち上がりと、勝った人を次の試合へ入れる */
export function advance(rounds: TourMatch[][]): void {
  for (const m of rounds[0]) if (m.w < 0 && m.a >= 0 && m.b < 0) m.w = m.a;
  for (let r = 1; r < rounds.length; r++) {
    rounds[r].forEach((m, i) => {
      m.a = rounds[r - 1][i * 2].w;
      m.b = rounds[r - 1][i * 2 + 1].w;
    });
  }
}

/** 3位決定戦を表す「回戦」の番号 */
export const THIRD = -1;

/** 3位決定戦を作れるか（準決勝が2試合とも、相手のいる試合になりうる＝4人以上） */
export function canHaveThird(rounds: TourMatch[][]): boolean {
  if (rounds.length < 2) return false;
  const semis = rounds[rounds.length - 2];
  // 1回戦が準決勝のとき（3〜4人）は、シードのある試合だと負ける人がいない
  if (rounds.length === 2) return semis.every((m) => m.a >= 0 && m.b >= 0);
  return true;
}

/** 3位決定戦の組み合わせ：準決勝で負けた2人（決まっていなければ -1） */
export function syncThird(rounds: TourMatch[][], third: TourMatch | null | undefined): void {
  if (!third || rounds.length < 2) return;
  const semis = rounds[rounds.length - 2];
  const loser = (m: TourMatch) => (m.w >= 0 && m.a >= 0 && m.b >= 0 ? (m.w === m.a ? m.b : m.a) : -1);
  third.a = loser(semis[0]);
  third.b = loser(semis[1]);
}

/** [回戦, 番号] の試合（THIRD なら3位決定戦） */
export function matchAt(rounds: TourMatch[][], third: TourMatch | null | undefined, r: number, i: number): TourMatch | undefined {
  return r === THIRD ? third ?? undefined : rounds[r]?.[i];
}

/**
 * 次に戦う試合 [回戦, 番号]（3位決定戦は [THIRD, 0]）。もう無ければ null。
 * 3位決定戦があれば、決勝の前に行う
 */
export function nextMatch(rounds: TourMatch[][], third?: TourMatch | null): [number, number] | null {
  const last = rounds.length - 1;
  for (let r = 0; r < rounds.length; r++) {
    if (r === last && third && third.w < 0 && third.a >= 0 && third.b >= 0) return [THIRD, 0];
    for (let i = 0; i < rounds[r].length; i++) {
      const m = rounds[r][i];
      if (m.w < 0 && m.a >= 0 && m.b >= 0) return [r, i];
    }
  }
  return null;
}

/** 試合の勝ちを決めて、勝ち上がりを反映する */
export function setWinner(rounds: TourMatch[][], r: number, i: number, slot: number, third?: TourMatch | null): void {
  const m = matchAt(rounds, third, r, i);
  if (!m || (slot !== m.a && slot !== m.b)) return;
  m.w = slot;
  advance(rounds);
  syncThird(rounds, third);
}

/** 優勝した人の slot（まだなら -1） */
export function champion(rounds: TourMatch[][]): number {
  return rounds[rounds.length - 1]?.[0]?.w ?? -1;
}

/** 回戦の名前（後ろから 決勝・準決勝・…） */
export function roundName(r: number, total: number): string {
  if (r === THIRD) return '3位決定戦';
  const fromEnd = total - 1 - r;
  return fromEnd === 0 ? '決勝' : fromEnd === 1 ? '準決勝' : `${r + 1}回戦`;
}
