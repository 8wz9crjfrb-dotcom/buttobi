// 中央付近でスマッシュ攻撃を当てたとき、何%で撃墜できるかを調べる
import { Sim } from '../src/shared/sim';
import { BTN_A, type InputState } from '../src/shared/types';
for (const victimChar of ['thief', 'streamer', 'guard']) {
  let koAt = -1;
  for (let pct = 0; pct <= 300; pct += 5) {
    const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'streamer', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: victimChar, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
    const [a, b] = sim.fighters;
    a.x = 2; a.facing = 1; b.x = 3.2; b.facing = -1; b.damage = pct;
    const none = new Map<number, InputState>();
    while (sim.frame < 151) sim.step(none);
    a.x = 2; b.x = 3.2;
    sim.step(new Map([[0, { mx: 0, my: 0, buttons: 0 }]]));
    sim.step(new Map([[0, { mx: 1, my: 0, buttons: BTN_A }]]));
    let ko = false;
    for (let i = 0; i < 400; i++) { sim.step(new Map([[0, { mx: 0, my: 0, buttons: 0 }]])); const k = sim.events.find(e => e.k === 'ko'); if (k) { ko = k.k === 'ko' && k.y > -10.5; break; } }
    if (ko) { koAt = pct; break; }
  }
  console.log(`スマッシュ（右の崖まで約6m・横か上に飛ばして）で ${victimChar} を撃墜できる最小ダメージ: ${koAt}%`);
}
