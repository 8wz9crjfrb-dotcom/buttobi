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
  step(sim, 300);
  check('王冠：はじめはだれも持っていない（拾う王冠はない）', !sim.crown.on && sim.crown.holder === -1);
  // 自分で落ちても王冠はもらえない
  c.x = 99;
  step(sim, 3);
  check('王冠：自分で落ちただけでは、だれも王冠を持たない', sim.crown.holder === -1);
  step(sim, 200);
  // a が b を撃墜すると、a が王冠を手に入れる
  b.lastHitBy = 0; b.lastHitFrame = sim.frame; b.x = 99;
  step(sim, 2);
  check('王冠：最初に相手を撃墜した人が王冠を手に入れる', sim.crown.on && sim.crown.holder === 0, `${sim.crown.holder}`);
  step(sim, 120);
  const pts = sim.crownPts.get(0) ?? 0;
  check('王冠：持っている間だけ時間がたまる', pts >= 115 && pts <= 125 && !(sim.crownPts.get(1) ?? 0), `${pts}`);
  check('王冠：撃墜されないので残機は減らない（何度でも復活）', a.stocks === 0);
  step(sim, 200);
  // 相手が弱攻撃を当てると奪える
  a.x = 0; a.y = 0; b.x = a.x + 0.8; b.facing = -1; b.y = a.y; b.grounded = true; a.grounded = true;
  step(sim, 2);
  sim.step(new Map([[1, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 12);
  check('王冠：弱攻撃1回では奪えない（王冠の耐久）', sim.crown.holder === 0 && sim.crown.dmg > 0 && sim.crown.dmg < CROWN.hp, `持っている人${sim.crown.holder} たまったダメージ${sim.crown.dmg.toFixed(1)}`);
  const s2 = sim as unknown as { crownSteal(v: unknown, from: number, dmg: number): void };
  // 合計が耐久（20%）をこえたら、最後に当てた人が奪う
  s2.crownSteal(a, 1, CROWN.hp);
  check('王冠：受けたダメージの合計が20%をこえると、最後に当てた人が奪える', sim.crown.holder === 1 && sim.crown.dmg === 0, `${sim.crown.holder}`);
  // 奪われた人はすぐには奪い返せない
  s2.crownSteal(b, 0, 99);
  check('王冠：奪われた直後は奪い返せない', sim.crown.holder === 1);
  step(sim, CROWN.stealCd + 2);
  s2.crownSteal(b, 0, 10);
  check('王冠：奪い返すにも20%が要る（10%では奪えない）', sim.crown.holder === 1);
  s2.crownSteal(b, 0, 10);
  check('王冠：少したてば奪い返せる（合計20%）', sim.crown.holder === 0);
  // 持っている人を撃墜した人が王冠を手に入れる
  step(sim, 2);
  a.lastHitBy = 2; a.lastHitFrame = sim.frame; a.x = 99;
  step(sim, 2);
  check('王冠：持っている人を撃墜した人が王冠を手に入れる', sim.crown.holder === 2, `${sim.crown.holder}`);
  // 持っている人が自分で落ちたら、少しあとに中央に出て、触れた人が拾う
  c.lastHitBy = -1; c.x = 99;
  step(sim, 2);
  check('王冠：持っている人が自分で落ちたら、いったんだれも持たない', sim.crown.holder === -1 && !sim.crown.on);
  b.lastHitBy = 0; b.lastHitFrame = sim.frame; b.x = 99;
  step(sim, 2);
  check('王冠：中央に出るのを待つ間は、相手を倒してももらえない', sim.crown.holder === -1);
  step(sim, CROWN.respawn + 2);
  check('王冠：中央に出てくる', sim.crown.on && sim.crown.holder === -1 && Math.abs(sim.crown.x) < 0.5);
  for (const f of [b, c]) f.x = 6;
  step(sim, 100, new Map([[0, { mx: 1, my: 0, buttons: 0 }]]));
  a.x = sim.crown.x; a.y = 0;
  step(sim, 3);
  check('王冠：中央の王冠に触れると拾う', sim.crown.holder === 0, `${sim.crown.holder}`);
  // 勝ちになる時間で終わる
  sim.crownPts.set(0, 20 * 60 - 1);
  step(sim, 200);
  check('王冠：決めた時間持ったら終わり、その人が1位', sim.ended && sim.results()[0].slot === 0 && sim.results()[0].crown === 20, JSON.stringify(sim.results().map((r) => [r.slot, r.rank, r.crown])));
  // 通信で送っても同じ
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('王冠：通信で状態が伝わる', !!v.crown && v.crown.goal === 1200 && v.crown.pts.length >= 2);
}

// ---- 金庫まもり
{
  const sim = make({ mode: 'vault', teams: true, vaultHp: 250 }, 4);
  check('金庫：2つの金庫、耐久は人数（2対2）で1.5倍', sim.vaults.length === 2 && sim.vaults[0].max === 3750, `${sim.vaults[0].max}`);
  const [a, b] = sim.fighters; // a = 赤（0）、b = 青（1）
  check('金庫：チームは赤・青', a.team === 0 && b.team === 1);
  // 赤の a が青の金庫（右）を殴る
  for (const f of sim.fighters) f.x = 0;
  a.x = sim.vaults[1].x - 1.1; a.facing = 1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 15);
  const dmg1 = sim.vaults[1].max - sim.vaults[1].hp;
  check('金庫：相手の金庫に攻撃が当たる（1つの技で1回）', dmg1 > 0 && dmg1 < 100, `${dmg1.toFixed(1)}`);
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
  check('金庫：通信で状態が伝わる', !!v.vault && v.vault.hp[1] === 0 && v.vault.max === 3750);
}
// 時間切れ：多く壊していたほうの勝ち
{
  const sim = make({ mode: 'vault', teams: true, timeLimit: 60 }, 2);
  sim.vaults[0].hp -= 497;
  sim.vaults[1].hp -= 503;
  for (const f of sim.fighters) f.x = 0;
  step(sim, 60 * 60 + 5);
  const r = sim.results();
  check('金庫：時間切れでは多く壊したチーム（赤）の勝ち（わずかな差でも）', sim.ended && sim.fighter(r[0].slot)!.team === 0 && r[1].rank === 2, JSON.stringify(r.map((x) => [x.slot, x.rank, x.vaultBroke])));
  check('金庫：壊した割合は小数第1位まで', r[0].vaultBroke === 12.5 && r[1].vaultBroke === 12.4, JSON.stringify(r.map((x) => x.vaultBroke)));
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
  check('金庫：飛び道具も当たって消える', Math.abs(sim.vaults[1].max - sim.vaults[1].hp - 28) <= 3 && sim.projectiles.length === 0, `${(sim.vaults[1].max - sim.vaults[1].hp).toFixed(1)}`);
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
