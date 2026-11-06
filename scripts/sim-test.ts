import { Sim } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CHARACTERS } from '../src/shared/characters';
import { STAGES } from '../src/shared/stages';
import type { InputState } from '../src/shared/types';

let failures = 0;
for (const stage of STAGES) {
  for (const n of [2, 4, 6]) {
    const players = Array.from({ length: n }, (_, i) => ({ slot: i, name: 'CPU' + i, charId: CHARACTERS[i % CHARACTERS.length].id, cpu: true, cpuLevel: 3 + (i % 7) }));
    const sim = new Sim({ players, stageId: stage.id, rules: { mode: 'stock', stocks: 3, timeLimit: 420 }, seed: 1234 + n });
    const ai = new CpuController(99 + n);
    let hits = 0, kos = 0, ledges = 0, shots = 0, maxDmg = 0;
    const koDamages: number[] = [];
    const t0 = Date.now();
    while (!sim.finished && sim.frame < 420 * 60 + 400) {
      const inputs = new Map<number, InputState>();
      for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, players[f.slot].cpuLevel));
      const pre = sim.fighters.map(f => f.damage);
      sim.step(inputs);
      for (const e of sim.events) {
        if (e.k === 'hit') hits++;
        if (e.k === 'ko') { kos++; koDamages.push(Math.round(pre[e.s])); }
        if (e.k === 'shot') shots++;
      }
      for (const f of sim.fighters) {
        if (f.state === 'ledge' && f.stateTime === 1) ledges++;
        maxDmg = Math.max(maxDmg, f.damage);
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) { console.log('NaN!', stage.id, f.slot); failures++; }
      }
    }
    const ms = Date.now() - t0;
    const avgKo = koDamages.length ? Math.round(koDamages.reduce((a, b) => a + b, 0) / koDamages.length) : 0;
    console.log(`${stage.id} ${n}人: ${sim.finished ? '終了' : '未終了'} ${(sim.frame / 60).toFixed(0)}秒 hits=${hits} KO=${kos} 撃墜時平均%=${avgKo} 崖=${ledges} 弾=${shots} 計算${ms}ms 結果=${JSON.stringify(sim.results().map(r => [r.slot, r.rank]))}`);
    if (!sim.finished) failures++;
    // 当たり続ける不具合の検出：1秒あたりのヒット数が多すぎたら失敗
    if (hits / (sim.frame / 60) > 8) {
      console.log('NG ヒット数が異常に多い', stage.id, n);
      failures++;
    }
  }
}
process.exit(failures ? 1 : 0);
