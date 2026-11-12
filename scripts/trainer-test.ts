// パーソナルトレーナーの必殺技と特性が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { TRAINER } from '../src/shared/moves';
import { BTN_A, BTN_B, BTN_SHIELD, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(a: string, b: string): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function run(sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) {
  for (let i = 0; i < frames; i++) sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
}
const at = (k: number, inp: InputState) => (i: number) => (i === k ? inp : N);
const place = (sim: Sim, dx: number) => {
  sim.fighters[0].x = 0;
  sim.fighters[0].facing = 1;
  sim.fighters[1].x = dx;
  sim.fighters[1].facing = -1;
};

// ---- ダンベルカール：溜めるほど強い
{
  const quick = make('trainer', 'guard');
  place(quick, 1.2);
  run(quick, 60, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  const held = make('trainer', 'guard');
  place(held, 1.2);
  // 相手が離れている間に溜めて、近づいてから離す
  held.fighters[1].x = 5;
  run(held, 75, () => ({ mx: 0, my: 0, buttons: BTN_B }));
  const charge = held.fighters[0].charge;
  held.fighters[1].x = 1.2;
  run(held, 40);
  check('ダンベルカール：Bを押し続けると溜まる', charge >= TRAINER.curlMax - 1, `溜め${charge}`);
  check('ダンベルカール：溜めたほうがダメージが大きい', held.fighters[1].damage > quick.fighters[1].damage * 1.5, `溜め${held.fighters[1].damage.toFixed(1)}% / すぐ${quick.fighters[1].damage.toFixed(1)}%`);
}

// ---- タックル：突進してつかむ（ガード中でも）
{
  const sim = make('trainer', 'guard');
  place(sim, 2.6);
  run(sim, 30, at(0, { mx: 1, my: 0, buttons: BTN_B }));
  check('タックル：離れた相手まで突進してつかむ', sim.fighters[0].state === 'grab' && sim.fighters[1].state === 'grabbed', `${sim.fighters[0].state}/${sim.fighters[1].state}`);
  check('タックル：つかんだ瞬間に少しダメージ', sim.fighters[1].damage > 0, `${sim.fighters[1].damage.toFixed(1)}%`);
  run(sim, 20, (i) => (i > 8 ? { mx: 1, my: 0, buttons: 0 } : N));
  check('タックルのあと投げられる（投げは1.3倍）', sim.fighters[1].state === 'hitstun' && sim.fighters[0].throws === 1, `${sim.fighters[1].damage.toFixed(1)}%`);
  const sh = make('trainer', 'guard');
  place(sh, 2.4);
  run(sh, 30, at(0, { mx: 1, my: 0, buttons: BTN_B }), () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
  check('タックル：ガード中の相手もつかめる', sh.fighters[1].state === 'grabbed');
}
{
  // 投げの威力：同じ前投げでも、トレーナーは警備員より強い
  const throwDmg = (id: string) => {
    const s = make(id, 'hacker');
    place(s, 0.9);
    run(s, 1, () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
    run(s, 14, at(0, { mx: 0, my: 0, buttons: BTN_SHIELD | BTN_A }));
    run(s, 10, () => ({ mx: 1, my: 0, buttons: 0 }));
    run(s, 20);
    return s.fighters[1].damage;
  };
  const t = throwDmg('trainer');
  const g = throwDmg('guard');
  check('筋肉は裏切らない：投げのダメージが大きい', t > g * 1.2, `トレーナー${t.toFixed(1)}% / 警備員${g.toFixed(1)}%`);
}

// ---- マッスルジャンプ：つかんで叩きつける
{
  const sim = make('trainer', 'guard');
  place(sim, 0.6);
  const f = sim.fighters[0];
  let slammed = false;
  let maxY = 0;
  for (let i = 0; i < 120; i++) {
    sim.step(new Map([[0, i === 0 ? { mx: 0, my: 1, buttons: BTN_B } : N]]));
    maxY = Math.max(maxY, f.y);
    if (sim.events.some((e) => e.k === 'boom')) slammed = true;
  }
  check('マッスルジャンプ：つかんで地面に叩きつける', slammed && sim.fighters[1].damage >= 10 && f.throws === 1, `${sim.fighters[1].damage.toFixed(1)}%`);
  check('マッスルジャンプ：つかんだあと相手は解放されている', sim.fighters[1].grabbedBy === -1 && f.grabbing === -1 && f.slamming === 0);
  const rec = make('trainer', 'guard');
  rec.fighters[1].x = 20;
  const r = rec.fighters[0];
  r.x = 0;
  const y0 = r.y;
  let top = y0;
  for (let i = 0; i < 40; i++) {
    rec.step(new Map([[0, i === 0 ? { mx: 0, my: 1, buttons: BTN_B } : N]]));
    top = Math.max(top, r.y);
  }
  check('マッスルジャンプ：空振りなら高く上がる（復帰に使える）', top - y0 > 3, `${(top - y0).toFixed(1)}m`);
}
{
  // 場外でつかんでも、ずっと落ち続けずに放す
  const sim = make('trainer', 'guard');
  const f = sim.fighters[0];
  const v = sim.fighters[1];
  const ex = sim.stage.main.x2 + 3;
  const ey = sim.stage.main.top + 1;
  f.x = ex; f.y = ey; f.grounded = false; f.groundRef = -1; f.state = 'air' as typeof f.state;
  v.x = ex + 0.4; v.y = ey + 1; v.grounded = false; v.groundRef = -1; v.state = 'air' as typeof v.state; v.vy = 0;
  let caught = false;
  for (let i = 0; i < 80; i++) {
    sim.step(new Map([[0, i === 0 ? { mx: 0, my: 1, buttons: BTN_B } : N]]));
    if (v.state === 'grabbed') caught = true;
  }
  check('マッスルジャンプ：場外では長くつかまず放す', caught && v.grabbedBy === -1 && f.slamming === 0, `つかんだ=${caught} 相手=${v.state}`);
}

// ---- プロテイン：ひるまない
{
  const sim = make('guard', 'trainer');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 0.9;
  run(sim, 20, () => N, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  const t = sim.fighters[1];
  check('プロテイン：効果が出る', t.armor > 0 && (sim.toView().fighters[1].fx & 128) !== 0, `残り${t.armor}`);
  run(sim, 12, at(0, { mx: 0, my: 0, buttons: BTN_A }));
  check('プロテイン：弱い攻撃ではひるまない（ダメージは受ける）', t.state !== 'hitstun' && t.damage > 0, `${t.state} ${t.damage.toFixed(1)}%`);
  t.damage = 0;
  run(sim, 300);
  check('プロテイン：時間がたつと切れる', t.armor === 0);
  run(sim, 20, () => N, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  check('プロテイン：すぐには飲み直せない', t.armor === 0, `待ち${t.armorCd}`);
  const big = make('guard', 'trainer');
  big.fighters[0].x = 0; big.fighters[0].facing = 1; big.fighters[1].x = 1.1;
  run(big, 20, () => N, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  big.fighters[1].damage = 150;
  // 横スマッシュ（はじき入力）
  run(big, 3, (i) => (i === 2 ? { mx: 1, my: 0, buttons: BTN_A } : N));
  run(big, 30);
  check('プロテイン：とても強いふっとばしは受ける', big.fighters[1].state === 'hitstun' || !big.fighters[1].grounded || big.fighters[1].state === 'dead');
}
process.exit(fail ? 1 : 0);
