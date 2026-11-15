// 技の使われ方を調べる（調整の前後比較用）。CPU（強さ7）同士の1対1総当たりで、キャラごと・技ごとに
// 使った回数・当たった回数・与えたダメージ・撃墜を数える。
//   npx tsx scripts/move-stats.ts [1組あたりの試合数=20] [--json]
// 数え方：
//   ・当たった … 「命中」の合図のほか、合図を出さない技（引き寄せ・眠らせなど）はダメージが増えたことで、
//                つかむ技（つかみ・タックル・マッスルジャンプ）はつかんだことで数える
//   ・飛び道具 … 出したときの技（Bなど）の命中として数える
//   ・置く技（罠・ドローン・自転車・壁など）… 本人が別の行動中でも、その技の命中として数えられるよう、
//                本人が技を出していないときの命中は「設置物など」にまとめる
//   ・撃墜 … 最後に当てた技の撃墜として数える
import { Sim } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CHARACTERS } from '../src/shared/characters';
import { JOBS } from '../src/shared/moves';
import type { InputState } from '../src/shared/types';

const ids = CHARACTERS.map((c) => c.id);
const N = Number(process.argv[2] ?? 20);
const asJson = process.argv.includes('--json');
type S = { use: number; hit: number; dmg: number; ko: number };
const st: Record<string, Record<string, S>> = {};
const wins: Record<string, number> = {};
const games: Record<string, number> = {};
const koPct: Record<string, number[]> = {};
const get = (c: string, m: string) => ((st[c] ??= {})[m] ??= { use: 0, hit: 0, dmg: 0, ko: 0 });
const OTHER = '設置物など';

for (let a = 0; a < ids.length; a++)
  for (let b = a + 1; b < ids.length; b++)
    for (let g = 0; g < N; g++) {
      const players = [ids[a], ids[b]].map((charId, i) => ({ slot: i, name: charId, charId, cpu: true, cpuLevel: 7 }));
      if (g % 2) players.reverse().forEach((p, i) => (p.slot = i));
      const sim = new Sim({ players, stageId: ['plain', 'gacha', 'timeline', 'neon'][g % 4], rules: { mode: 'stock', stocks: 2, timeLimit: 300 }, seed: 5000 + a * 100 + b * 10 + g });
      const ai = new CpuController(91 + g);
      const tag = new Map<object, string>();
      const lastMove = new Map<number, string>();
      while (!sim.finished && sim.frame < 300 * 60 + 400) {
        const inputs = new Map<number, InputState>();
        for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, 7));
        const before = new Map(sim.fighters.map((f) => [f.slot, { move: f.move as string | null, dmg: f.damage, grabbedBy: f.grabbedBy, lhf: f.lastHitFrame, job: f.job }]));
        const projBefore = sim.projectiles.map((p) => ({ p, x: p.x, y: p.y, owner: p.owner }));
        const entBefore = sim.entities.map((e) => ({ kind: e.kind, owner: e.owner, x: e.x, y: e.y }));
        const bikeBefore = new Map(sim.fighters.map((f) => [f.slot, f.bike > 0]));
        /** 本人が技を出していないときの命中：自転車・置いた物（罠・壁・ドローン・足場）なら、その技 */
        const placed = (atSlot: number, v: (typeof sim.fighters)[number]): string => {
          if (bikeBefore.get(atSlot)) return 'sspecial';
          const ENT: Record<string, string> = { trap: 'dspecial', drone: 'dspecial', wall: 'sspecial', popup: 'uspecial' };
          const e = entBefore.filter((x) => x.owner === atSlot && ENT[x.kind]).sort((p, q) => Math.hypot(p.x - v.x, p.y - v.y) - Math.hypot(q.x - v.x, q.y - v.y))[0];
          return e && Math.hypot(e.x - v.x, e.y - v.y) < 3 ? ENT[e.kind] : OTHER;
        };
        sim.step(inputs);
        // ドローンの弾は下B（エージェント起動）
        for (const p of sim.projectiles) if (!tag.has(p)) tag.set(p, p.kind === 'spark' ? 'dspecial' : (sim.fighters.find((f) => f.slot === p.owner)?.move ?? OTHER));
        for (const f of sim.fighters) if (f.move && f.move !== before.get(f.slot)!.move) get(f.def.id, f.move).use++;
        const counted = new Set<number>();
        const credit = (atSlot: number, v: (typeof sim.fighters)[number], m: string) => {
          const at = sim.fighters.find((f) => f.slot === atSlot)!;
          // 3B の必殺技は仕事ごとに分けて数える（例：nspecial（バーテンダー））
          if (at.def.id === 'threeb' && m.includes('special') && m !== 'dspecial') m = `${m}（${JOBS[before.get(atSlot)!.job]}）`;
          const s = get(at.def.id, m);
          s.hit++;
          s.dmg += Math.max(0, v.damage - before.get(v.slot)!.dmg);
          lastMove.set(v.slot, m);
          counted.add(v.slot);
        };
        // 合図のある命中
        for (const e of sim.events as { k: string; a?: number; s?: number }[]) {
          if (e.k !== 'hit' || e.a === undefined || e.a === e.s || counted.has(e.s!)) continue;
          const v = sim.fighters.find((f) => f.slot === e.s)!;
          const atMove = before.get(e.a)!.move ?? sim.fighters.find((f) => f.slot === e.a)!.move;
          const cy = v.y + v.h / 2;
          const near = projBefore.filter((q) => q.owner === e.a).sort((p1, p2) => Math.hypot(p1.x - v.x, p1.y - cy) - Math.hypot(p2.x - v.x, p2.y - cy))[0];
          let m = atMove ?? placed(e.a, v);
          if (near && Math.hypot(near.x - v.x, near.y - cy) < 2.2 && (!atMove || tag.get(near.p) === atMove || !atMove.includes('special'))) m = tag.get(near.p) ?? m;
          credit(e.a, v, m);
        }
        // つかんだ・合図なしでダメージを受けた
        for (const v of sim.fighters) {
          if (counted.has(v.slot)) continue;
          const bf = before.get(v.slot)!;
          if (v.grabbedBy >= 0 && bf.grabbedBy < 0) credit(v.grabbedBy, v, before.get(v.grabbedBy)!.move ?? 'grab');
          else if (v.damage > bf.dmg + 0.01 && v.lastHitFrame !== bf.lhf && v.lastHitBy >= 0 && v.lastHitBy !== v.slot) credit(v.lastHitBy, v, before.get(v.lastHitBy)!.move ?? placed(v.lastHitBy, v));
        }
        for (const e of sim.events as { k: string; a?: number; s?: number }[]) {
          if (e.k !== 'ko' || e.a === undefined) continue;
          const at = sim.fighters.find((f) => f.slot === e.a)!;
          get(at.def.id, lastMove.get(e.s!) ?? OTHER).ko++;
          (koPct[at.def.id] ??= []).push(before.get(e.s!)!.dmg);
        }
      }
      const r = sim.results();
      const w = players.find((p) => p.slot === r.find((x) => x.rank === 1)!.slot)!.charId;
      wins[w] = (wins[w] ?? 0) + 1;
      for (const c of [ids[a], ids[b]]) games[c] = (games[c] ?? 0) + 1;
    }

const out = Object.fromEntries(
  ids.map((c) => [
    c,
    {
      win: Math.round(((wins[c] ?? 0) / games[c]) * 100),
      games: games[c],
      koAvgPct: Math.round((koPct[c] ?? []).reduce((x, y) => x + y, 0) / Math.max(1, (koPct[c] ?? []).length)),
      moves: st[c] ?? {},
    },
  ]),
);
if (asJson) {
  console.log(JSON.stringify(out));
} else {
  const NAMES: Record<string, string> = { nspecial: 'B', sspecial: '横B', dspecial: '下B', uspecial: '上B' };
  for (const c of ids) {
    const v = out[c];
    const g = v.games;
    const tk = Object.values(v.moves).reduce((n, x) => n + x.ko, 0);
    const td = Object.values(v.moves).reduce((n, x) => n + x.dmg, 0);
    console.log(`\n${CHARACTERS.find((x) => x.id === c)!.name}：勝率${v.win}%・撃墜したときの相手の% 平均${v.koAvgPct}`);
    for (const k of ['nspecial', 'sspecial', 'dspecial', 'uspecial']) {
      const x = v.moves[k] ?? { use: 0, hit: 0, dmg: 0, ko: 0 };
      console.log(`  ${NAMES[k].padEnd(3)} 使用${(x.use / g).toFixed(1).padStart(5)} 命中${(x.hit / g).toFixed(1).padStart(5)} ダメージ${((100 * x.dmg) / Math.max(1, td)).toFixed(0).padStart(3)}% 撃墜${((100 * x.ko) / Math.max(1, tk)).toFixed(0).padStart(3)}%`);
    }
    const top = Object.entries(v.moves).sort((p, q) => q[1].ko - p[1].ko).slice(0, 4);
    console.log('  撃墜の多い技：' + top.map(([k, x]) => `${k} ${((100 * x.ko) / Math.max(1, tk)).toFixed(0)}%`).join('、'));
  }
}
