// 技の最適化（2026年11月）で変えた動きが、意図どおりかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { BIKE, DEFLECT, WALL } from '../src/shared/moves';
import { BTN_A, BTN_B, type InputState } from '../src/shared/types';

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

// ---- 配達員の自転車：弱い攻撃では降りない。耐久が尽きるか、強い攻撃で降りる
{
  const sim = make('courier', 'hacker');
  const c = sim.fighters[0];
  const h = sim.fighters[1];
  c.x = -6;
  h.x = 6;
  run(sim, 12, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : { mx: 1, my: 0, buttons: 0 }));
  check('横Bで自転車に乗る', c.bike > 0 && c.bikeHp === BIKE.hp, `耐久${c.bikeHp}`);
  // ハッカーの弾（1発2%ほど）を受けても降りない
  h.x = c.x + 5;
  h.facing = -1;
  let gotHit = false;
  for (let i = 0; i < 40 && c.bike > 0; i++) {
    const before = c.damage;
    run(sim, 1, () => ({ mx: -1, my: 0, buttons: 0 }), (k) => (i === 0 && k === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N));
    if (c.damage > before) gotHit = true;
    if (gotHit) break;
  }
  check('弱い攻撃を受けても自転車から降りない', gotHit && c.bike > 0 && c.state !== 'hitstun', `bike=${c.bike} 耐久${c.bikeHp.toFixed(1)} 状態=${c.state}`);
  // 耐久が尽きるまで弱い攻撃を受けると降りる
  const sim2 = make('courier', 'guard');
  const c2 = sim2.fighters[0];
  c2.x = -6;
  sim2.fighters[1].x = 6;
  run(sim2, 12, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : { mx: 1, my: 0, buttons: 0 }));
  c2.bikeHp = 1;
  // 弱攻撃を当てる
  const g = sim2.fighters[1];
  g.x = c2.x + 0.9;
  g.facing = -1;
  run(sim2, 12, () => N, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('自転車の耐久が尽きると降ろされる', c2.bike === 0, `bike=${c2.bike}`);
}

// ---- 警備員の壁：触れた相手をはじく（同じ壁からは1回だけ）
{
  const sim = make('guard', 'thief');
  const g = sim.fighters[0];
  const t = sim.fighters[1];
  g.x = 0;
  g.facing = 1;
  t.x = 3;
  run(sim, 10, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N));
  const d0 = t.damage;
  // 相手が壁に向かって歩いてくる
  let hits = 0;
  let last = t.damage;
  run(sim, 60, () => N, () => {
    if (t.damage > last + 0.01) hits++;
    last = t.damage;
    return { mx: -1, my: 0, buttons: 0 };
  });
  check('壁に触れた相手がダメージを受けてはじかれる', t.damage - d0 >= WALL.hit.dmg * 0.9, `+${(t.damage - d0).toFixed(1)}%`);
  check('同じ壁からは1回だけ', hits === 1, `${hits}回`);
}

// ---- AIエンジニアの学習：構え中に殴られたら、はじき返す
{
  const sim = make('ai', 'guard');
  const a = sim.fighters[0];
  const g = sim.fighters[1];
  a.x = 0;
  g.x = 1.0;
  g.facing = -1;
  run(sim, 6, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N));
  const dA = a.damage;
  const dG = g.damage;
  run(sim, 20, () => N, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('学習の構え中に殴られてもダメージを受けない', a.damage === dA, `${a.damage}`);
  check('殴ってきた相手をはじき返す', g.damage - dG >= DEFLECT.dmg * 0.9 && g.x > 1.0, `+${(g.damage - dG).toFixed(1)}% x=${g.x.toFixed(2)}`);
}

// ---- 配信者：眠っている相手は大きくふっとぶ
{
  const dist = (sleep: boolean) => {
    const sim = make('streamer', 'guard');
    const s = sim.fighters[0];
    const g = sim.fighters[1];
    s.x = 0;
    s.facing = 1;
    g.x = 1.0;
    g.damage = 80;
    if (sleep) {
      g.stun = 200;
      (sim as unknown as { setState(f: unknown, st: string): void }).setState(g, 'sleep');
    }
    run(sim, 14, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_A } : N));
    run(sim, 40);
    return g.x;
  };
  const awake = dist(false);
  const asleep = dist(true);
  check('眠っている相手は大きくふっとぶ', asleep > awake + 0.3, `起きている${awake.toFixed(2)}m / 眠り${asleep.toFixed(2)}m`);
}

// ---- ドパガキ：無限スクロールの3回目は大きくふっとばす
{
  const flight = (chain: number) => {
    const sim = make('dopa', 'guard');
    const d = sim.fighters[0];
    const g = sim.fighters[1];
    d.x = 0;
    d.facing = 1;
    g.x = 1.2;
    g.damage = 60;
    run(sim, 1, () => ({ mx: 1, my: 0, buttons: BTN_B }));
    d.chain = chain;
    run(sim, 50);
    return Math.hypot(g.x - 1.2, g.y);
  };
  const first = flight(0);
  const last = flight(2);
  check('無限スクロールの3回目は1回目より大きくふっとばす', last > first * 1.3, `1回目${first.toFixed(2)}m / 3回目${last.toFixed(2)}m`);
}
process.exit(fail ? 1 : 0);
