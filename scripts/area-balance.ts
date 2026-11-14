// エリアバトルの溜まり方：人数・チーム・エリアの形ごとに、CPU同士で2分の試合をして、
// 満タンで決着した割合と、1位のゲージ（%）の平均を出す。使い方：npx tsx scripts/area-balance.ts [試合数]
import { Sim, AREA } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import type { InputState, PlayerSetup } from '../src/shared/types';

const N = Number(process.argv[2] ?? 6);
const CH = ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'];
const STAGES = ['plain', 'livebar', 'vault', 'arcade', 'gym'];
export function areaRun(n: number, teams: boolean, shape: 'move' | 'fix2', seed: number) {
  const players: PlayerSetup[] = Array.from({ length: n }, (_, i) => ({ slot: i, name: 'c' + i, charId: CH[(seed * 7 + i * 3) % CH.length], cpu: true, cpuLevel: 5, team: teams ? i % 2 : 0 }));
  const sim = new Sim({ players, stageId: STAGES[seed % STAGES.length], rules: { mode: 'area', stocks: 3, timeLimit: 120, area: shape, teams }, seed });
  const ai = new CpuController(seed);
  let guard = 0;
  while (!sim.finished && guard++ < 140 * 60) {
    const inputs = new Map<number, InputState>();
    for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, 5));
    sim.step(inputs);
  }
  const top = Math.max(...sim.areaGauge.values());
  return { full: top >= sim.areaGoal, top: top / sim.areaGoal };
}
if (process.argv[1]?.endsWith('area-balance.ts')) {
  for (const [n, teams] of [[2, false], [3, false], [4, false], [6, false], [4, true], [6, true]] as [number, boolean][])
    for (const shape of ['move', 'fix2'] as const) {
      let full = 0;
      let top = 0;
      for (let s = 1; s <= N; s++) {
        const r = areaRun(n, teams, shape, s);
        if (r.full) full++;
        top += r.top;
      }
      console.log(`${n}人${teams ? 'チーム' : '個人'} ${shape === 'move' ? '移動1つ' : '固定2つ'}: 満タン決着 ${Math.round((full / N) * 100)}%  1位の平均 ${Math.round((top / N) * 100)}%`);
    }
}
