// CPU同士の総当たりで、キャラごとの勝率をざっくり見る（調整の目安）
import { Sim } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CHARACTERS } from '../src/shared/characters';
import type { InputState } from '../src/shared/types';
const ids = CHARACTERS.map((c) => c.id);
const wins: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
const games: Record<string, number> = Object.fromEntries(ids.map((i) => [i, 0]));
const N = Number(process.argv[2] ?? 10);
for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
  for (let g = 0; g < N; g++) {
    const players = [ids[a], ids[b]].map((charId, i) => ({ slot: i, name: charId, charId, cpu: true, cpuLevel: 7 }));
    if (g % 2) players.reverse().forEach((p, i) => (p.slot = i));
    const sim = new Sim({ players, stageId: ['plain', 'gacha', 'timeline'][g % 3], rules: { mode: 'stock', stocks: 2, timeLimit: 300 }, seed: 1000 + a * 100 + b * 10 + g });
    const ai = new CpuController(77 + g);
    while (!sim.finished && sim.frame < 300 * 60 + 400) {
      const inputs = new Map<number, InputState>();
      for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, 7));
      sim.step(inputs);
    }
    const r = sim.results();
    const winner = players.find((p) => p.slot === r.find((x) => x.rank === 1)!.slot)!.charId;
    wins[winner]++;
    games[ids[a]]++;
    games[ids[b]]++;
  }
}
for (const id of ids) console.log(`${CHARACTERS.find((c) => c.id === id)!.name}: ${wins[id]}勝 / ${games[id]}試合（勝率 ${Math.round((wins[id] / games[id]) * 100)}%）`);
