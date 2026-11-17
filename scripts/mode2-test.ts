// 王冠うばい・金庫まもり
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CROWN, VAULT } from '../src/shared/moves';
import { decodeState, encodeState } from '../src/shared/protocol';
import type { InputState, MatchRules } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function make(rules: Partial<MatchRules>, n = 3): Sim {
  const ids = ['guard', 'thief', 'hacker', 'streamer'];
  const sim = new Sim({ players: ids.slice(0, n).map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: false, cpuLevel: 1, team: i % 2 })), stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 120, ...rules } as MatchRules, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const step = (sim: Sim, k: number, inp?: Map<number, InputState>) => { for (let i = 0; i < k; i++) sim.step(inp ?? new Map()); };

// ---- 王冠うばい
{
  const sim = make({ mode: 'crown', crownGoal: 20 });
  const [a, b, c] = sim.fighters;
  a.x = -6; b.x = 6; c.x = 7;
  step(sim, 120);
  check('王冠：はじめは中央に落ちている', sim.crown.on && sim.crown.holder === -1 && Math.abs(sim.crown.x) < 0.5);
  a.x = sim.crown.x;
  step(sim, 2);
  check('王冠：触れると拾う', sim.crown.holder === 0);
  step(sim, 120);
  const pts = sim.crownPts.get(0) ?? 0;
  check('王冠：持っている間だけ時間がたまる', pts >= 115 && pts <= 125 && !(sim.crownPts.get(1) ?? 0), `${pts}`);
  check('王冠：撃墜されないので残機は減らない（何度でも復活）', a.stocks === 0);
  // 相手が弱攻撃を当てると奪える
  b.x = a.x + 0.8; b.facing = -1; b.y = a.y; b.grounded = true;
  sim.step(new Map([[1, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 12);
  check('王冠：攻撃を当てると奪える', sim.crown.holder === 1, `${sim.crown.holder}`);
  // 奪われた人はすぐには奪い返せない
  const s2 = sim as unknown as { crownSteal(v: unknown, from: number): void };
  s2.crownSteal(b, 0);
  check('王冠：奪われた直後は奪い返せない', sim.crown.holder === 1);
  step(sim, CROWN.stealCd + 2);
  s2.crownSteal(b, 0);
  check('王冠：少したてば奪い返せる', sim.crown.holder === 0);
  // 持っている人が撃墜されたら、中央に出直す
  a.x = 99;
  step(sim, 3);
  check('王冠：持っている人が撃墜されたら消えて', sim.crown.holder === -1 && !sim.crown.on);
  step(sim, CROWN.respawn + 2);
  check('王冠：中央に出直す', sim.crown.on && Math.abs(sim.crown.x) < 0.5);
  // 勝ちになる時間で終わる
  sim.crownPts.set(2, 20 * 60 - 1);
  c.x = sim.crown.x;
  step(sim, 200);
  check('王冠：決めた時間持ったら終わり、その人が1位', sim.ended && sim.results()[0].slot === 2 && sim.results()[0].crown === 20, JSON.stringify(sim.results().map((r) => [r.slot, r.rank, r.crown])));
  // 通信で送っても同じ
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('王冠：通信で状態が伝わる', !!v.crown && v.crown.goal === 1200 && v.crown.pts.length >= 2);
}

// ---- 金庫まもり
{
  const sim = make({ mode: 'vault', teams: true, vaultHp: 250 }, 4);
  check('金庫：2つの金庫、耐久は人数（2対2）で1.5倍', sim.vaults.length === 2 && sim.vaults[0].max === 375, `${sim.vaults[0].max}`);
  const [a, b] = sim.fighters; // a = 赤（0）、b = 青（1）
  check('金庫：チームは赤・青', a.team === 0 && b.team === 1);
  // 赤の a が青の金庫（右）を殴る
  for (const f of sim.fighters) f.x = 0;
  a.x = sim.vaults[1].x - 1.1; a.facing = 1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 15);
  const dmg1 = sim.vaults[1].max - sim.vaults[1].hp;
  check('金庫：相手の金庫に攻撃が当たる（1つの技で1回）', dmg1 > 0 && dmg1 < 10, `${dmg1.toFixed(1)}`);
  // 自分のチームの金庫には当たらない
  a.x = sim.vaults[0].x + 1.1; a.facing = -1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 15);
  check('金庫：自分のチームの金庫には当たらない', sim.vaults[0].hp === sim.vaults[0].max);
  check('金庫：与えたダメージを数える', Math.abs(a.vaultDmg - dmg1) < 0.01);
  // 壊したら終わり、壊したチームが勝ち
  sim.vaults[1].hp = 1;
  a.x = sim.vaults[1].x - 1.1; a.facing = 1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 20);
  const r = sim.results();
  check('金庫：壊したら終わり、赤チームの勝ち', sim.ended && sim.fighter(r[0].slot)!.team === 0 && r[0].vaultBroke === 100, JSON.stringify(r.map((x) => [x.slot, x.rank, x.vaultBroke])));
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('金庫：通信で状態が伝わる', !!v.vault && v.vault.hp[1] === 0 && v.vault.max === 375);
}
// 時間切れ：多く壊していたほうの勝ち
{
  const sim = make({ mode: 'vault', teams: true, timeLimit: 60 }, 2);
  sim.vaults[0].hp -= 50;
  sim.vaults[1].hp -= 80;
  for (const f of sim.fighters) f.x = 0;
  step(sim, 60 * 60 + 5);
  const r = sim.results();
  check('金庫：時間切れでは多く壊したチーム（赤）の勝ち', sim.ended && sim.fighter(r[0].slot)!.team === 0, JSON.stringify(r.map((x) => [x.slot, x.rank, x.vaultBroke])));
}
// 飛び道具も当たる
{
  const sim = make({ mode: 'vault', teams: true }, 2);
  const a = sim.fighters[0];
  sim.fighters[1].x = -5;
  a.x = sim.vaults[1].x - 3; a.facing = 1;
  const p = { x: a.x + 0.5, y: a.y + 1, vx: 16, vy: 0, gravity: 0, life: 40, owner: 0, kind: 'bullet', dmg: 2.8, base: 2.8, growth: 2.2, angle: 25, r: 0.25, hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [], pierce: false };
  (sim as unknown as { projectiles: unknown[] }).projectiles.push(p);
  step(sim, 20);
  check('金庫：飛び道具も当たって消える', Math.abs(sim.vaults[1].max - sim.vaults[1].hp - 2.8) < 0.01 && sim.projectiles.length === 0, `${(sim.vaults[1].max - sim.vaults[1].hp).toFixed(1)}`);
}
// CPUだけで最後まで遊べる（奇数人の王冠・3対3の金庫）
for (const [mode, n] of [['crown', 5], ['vault', 6]] as const) {
  const ids = ['guard', 'hacker', 'thief', 'streamer', 'gacha', 'courier'];
  const sim = new Sim({ players: ids.slice(0, n).map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: true, cpuLevel: 7, team: i % 2 })), stageId: 'plain', rules: { mode, stocks: 3, timeLimit: 180, teams: mode === 'vault' } as MatchRules, seed: 3 });
  const cpu = new CpuController(3);
  let f = 0;
  while (!sim.finished && f < 60 * 200) {
    sim.step(new Map(sim.fighters.map((x) => [x.slot, cpu.think(sim, x, 7)])));
    f++;
  }
  check(`CPUだけで${mode === 'crown' ? '王冠うばい（5人）' : '金庫まもり（3対3）'}が決着する`, sim.finished, `${Math.round(f / 60)}秒`);
}
check('金庫の設定', VAULT.hp === 400);

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
