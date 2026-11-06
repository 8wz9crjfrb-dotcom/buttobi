// はじき入力（スティック上でジャンプ・横はじきでスマッシュ）が、指で数フレームかけて倒しても効くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { BTN_A, type InputState } from '../src/shared/types';

function run(seq: InputState[]): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'mira', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: 'mira', cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  const idle = new Map<number, InputState>();
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(idle);
  for (const inp of seq) sim.step(new Map([[0, inp]]));
  return sim;
}
const up = (vals: number[]) => vals.map((my) => ({ mx: 0, my, buttons: 0 }));
let fail = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}`);
  if (!ok) fail++;
}
// 4フレームかけて上へ倒す（指の操作を想定）→ ジャンプする
let s = run(up([0, 0.2, 0.45, 0.65, 0.85, 1, 1, 1]));
check('4フレームかけて上に倒すとジャンプ', !s.fighters[0].grounded);
// 1フレームで上へ（キーボード）→ ジャンプする
s = run(up([0, 1, 1, 1]));
check('1フレームで上に倒すとジャンプ', !s.fighters[0].grounded);
// ゆっくり上へ（20フレーム）→ ジャンプしない（上攻撃のために上を入れておける）
s = run(up([0, ...Array.from({ length: 20 }, (_, i) => (i + 1) / 20), 1, 1]));
check('ゆっくり上に倒すとジャンプしない', s.fighters[0].grounded);
// 3フレームかけて横へはじいて A → スマッシュ攻撃
s = run([{ mx: 0, my: 0, buttons: 0 }, { mx: 0.3, my: 0, buttons: 0 }, { mx: 0.6, my: 0, buttons: 0 }, { mx: 0.9, my: 0, buttons: BTN_A }, { mx: 0.9, my: 0, buttons: BTN_A }]);
check('3フレームで横にはじいてAでスマッシュ', s.fighters[0].move === 'smash');
// ゆっくり横へ倒してから A → 横攻撃（スマッシュにならない）
s = run([...Array.from({ length: 15 }, (_, i) => ({ mx: (i + 1) / 15, my: 0, buttons: 0 })), { mx: 1, my: 0, buttons: BTN_A }]);
check('ゆっくり横に倒してAは横攻撃', s.fighters[0].move === 'side');
process.exit(fail ? 1 : 0);
