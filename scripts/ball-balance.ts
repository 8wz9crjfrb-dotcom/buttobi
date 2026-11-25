// 玉入れ：CPU同士で試合をして、点の入り方と決着のしかたを見る。使い方：npx tsx scripts/ball-balance.ts [試合数]
import { Sim } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import type { InputState, PlayerSetup } from '../src/shared/types';

const N = Number(process.argv[2] ?? 6);
const CH = ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'];
const STAGES = ['plain', 'livebar', 'vault', 'arcade', 'gym', 'cyber', 'lab'];
export function ballRun(n: number, seed: number, lv = 5, stageId?: string) {
  const players: PlayerSetup[] = Array.from({ length: n }, (_, i) => ({ slot: i, name: 'c' + i, charId: CH[(seed * 7 + i * 3) % CH.length], cpu: true, cpuLevel: lv, team: i % 2 }));
  const sim = new Sim({ players, stageId: stageId ?? STAGES[seed % STAGES.length], rules: { mode: 'ball', stocks: 3, timeLimit: 120, goals: 5, teams: true }, seed });
  const ai = new CpuController(seed);
  let guard = 0;
  while (!sim.finished && guard++ < 200 * 60) {
    const inputs = new Map<number, InputState>();
    for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, lv));
    sim.step(inputs);
  }
  return { score: sim.ballScore, target: sim.ballTarget, secs: sim.finished ? Math.round((sim.endFrame - 150) / 60) : 999, stage: sim.setup.stageId };
}
if (process.argv[1]?.endsWith('ball-balance.ts')) {
  for (const n of [2, 4, 6]) {
    const rows = Array.from({ length: N }, (_, s) => ballRun(n, s + 1));
    const goals = rows.reduce((a, r) => a + r.score[0] + r.score[1], 0) / N;
    const full = rows.filter((r) => Math.max(...r.score) >= r.target).length;
    console.log(`${n}人: 1試合の点 平均${goals.toFixed(1)}  先取で決着 ${Math.round((full / N) * 100)}%  ` + rows.map((r) => `${r.stage}:${r.score.join('-')}(${r.secs}秒)`).join(' '));
  }
}
