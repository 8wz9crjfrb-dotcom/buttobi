// 王冠うばい・金塊どろぼう
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
  // 撃墜された b が復活するまで待つ（約5秒）
  step(sim, 400);
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
  // 撃墜された a が復活するまで待つ（約5秒）
  step(sim, 250, new Map([[0, { mx: 1, my: 0, buttons: 0 }]]));
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

// ---- 金塊どろぼう（ルール名は vault）
const hitOnce = (sim: Sim, slot: number) => {
  sim.step(new Map([[slot, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 15);
};
{
  const sim = make({ mode: 'vault', teams: true }, 4);
  check('金塊：2つの金庫、扉の固さは人数（2対2）で1.5倍', sim.vaults.length === 2 && sim.vaults[0].max === VAULT.door * 1.5, `${sim.vaults[0].max}`);
  const [a, b] = sim.fighters; // a = 赤（0）、b = 青（1）
  check('金塊：チームは赤・青', a.team === 0 && b.team === 1);
  for (const f of sim.fighters) f.x = 0;
  // 赤の a が青の金庫（右）の扉を殴る
  a.x = sim.vaults[1].x - 1.1; a.facing = 1;
  hitOnce(sim, 0);
  const dmg1 = sim.vaults[1].max - sim.vaults[1].door;
  check('金塊：相手の金庫の扉に攻撃が当たる（1つの技で1回）', dmg1 > 0 && dmg1 < 10, `${dmg1.toFixed(1)}`);
  // 自分のチームの金庫には当たらない
  a.x = sim.vaults[0].x + 1.1; a.facing = -1;
  hitOnce(sim, 0);
  check('金塊：自分のチームの金庫には当たらない', sim.vaults[0].door === sim.vaults[0].max);
  // 扉を開ける
  sim.vaults[1].door = 0.5;
  a.x = sim.vaults[1].x - 1.1; a.facing = 1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  let opened = false;
  for (let k = 0; k < 15; k++) {
    sim.step(new Map());
    if (sim.vaults[1].openT > 0) opened = true;
  }
  check('金塊：扉の残りが 0 になると開く', opened && sim.vaults[1].openT > 0);
  // 開いた金庫に触れると金塊を持つ
  a.x = sim.vaults[1].x - 0.6;
  step(sim, 2);
  check('金塊：開いた相手の金庫に触れると、金塊を持つ', a.gold === 1 && sim.golds.length === 1 && sim.golds[0].holder === 0 && sim.golds[0].team === 1);
  // 持っている間は攻撃できない（A を押しても攻撃にならない）・遅い
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  check('金塊：持っている間は攻撃できない', a.state !== 'attack');
  const x0 = a.x;
  for (let k = 0; k < 40; k++) sim.step(new Map([[0, { mx: -1, my: 0, buttons: 0 }]]));
  const carried = x0 - a.x;
  // 同じ距離を持たずに走った場合と比べる
  const sim2 = make({ mode: 'vault', teams: true }, 4);
  const a2 = sim2.fighters[0];
  for (const f of sim2.fighters) f.x = 0;
  a2.x = 5;
  const y0 = a2.x;
  for (let k = 0; k < 40; k++) sim2.step(new Map([[0, { mx: -1, my: 0, buttons: 0 }]]));
  const free = y0 - a2.x;
  check('金塊：持っている間は足が遅い', carried < free * 0.85 && carried > free * 0.5, `持って ${carried.toFixed(2)}m / なし ${free.toFixed(2)}m`);
  // 攻撃を受けると落とす
  b.x = a.x + 0.9; b.facing = -1;
  sim.step(new Map([[1, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 12);
  check('金塊：攻撃を受けると落とす', a.gold === 0 && sim.golds.length === 1 && sim.golds[0].holder === -1);
  // 持ち主（青）が触ると金庫に戻る
  step(sim, 40);
  const g = sim.golds[0];
  b.x = g.x; b.y = g.y;
  step(sim, 2);
  check('金塊：持ち主のチームが触ると、金庫に戻る（消える）', sim.golds.length === 0);
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('金塊：通信で状態が伝わる', !!v.vault && v.vault.target === 3 && v.vault.score.join() === '0,0' && v.vault.golds.length === 0);
}
// 運び込むと1点、決めた本数で勝ち
{
  const sim = make({ mode: 'vault', teams: true, vaultGoal: 3 }, 2);
  const [a, b] = sim.fighters;
  b.x = 0; // じゃまにならない所へ
  const deliver = () => {
    sim.vaults[1].door = 0;
    sim.vaults[1].openT = 200;
    a.x = sim.vaults[1].x - 0.6; a.y = sim.stage.main.top; a.vx = 0;
    step(sim, 2);
    const had = a.gold === 1;
    a.x = sim.vaults[0].x + 0.6;
    step(sim, 2);
    return had;
  };
  const had = deliver();
  check('金塊：自分の金庫に運び込むと1点', had && sim.vaultScore.join() === '1,0' && a.gold === 0 && a.goals === 1, sim.vaultScore.join());
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('金塊：点も通信で伝わる', v.vault!.score.join() === '1,0');
  deliver();
  deliver();
  check('金塊：決めた本数（3本）を運んでも、すぐには終わらない（少し間をおく）', !sim.ended && sim.vaultScore[0] === 3);
  step(sim, VAULT.endDelay + 5);
  const r = sim.results();
  check('金塊：3本運び込んだ赤チームの勝ち', sim.ended && sim.fighter(r[0].slot)!.team === 0 && r[0].teamGold === 3 && r[0].gold === 3, JSON.stringify(r.map((x) => [x.slot, x.rank, x.teamGold])));
}
// 時間切れ：多く運んだほうの勝ち。同点なら延長
{
  const sim = make({ mode: 'vault', teams: true, timeLimit: 60 }, 2);
  sim.vaultScore = [1, 0];
  for (const f of sim.fighters) f.x = 0;
  step(sim, 60 * 60 + 5);
  const r = sim.results();
  check('金塊：時間切れでは多く運んだチーム（赤）の勝ち', sim.ended && sim.fighter(r[0].slot)!.team === 0 && r[1].rank === 2);
}
{
  const sim = make({ mode: 'vault', teams: true, timeLimit: 60 }, 2);
  sim.vaultScore = [1, 1];
  for (const f of sim.fighters) f.x = 0;
  step(sim, 60 * 60 + 30);
  check('金塊：同点で時間切れなら延長（延長中）', !sim.ended && sim.overtime);
}
// 飛び道具も扉に当たる。開いている間は素通り
{
  const sim = make({ mode: 'vault', teams: true }, 2);
  const a = sim.fighters[0];
  sim.fighters[1].x = -5;
  a.x = sim.vaults[1].x - 3; a.facing = 1;
  const shoot = () => {
    const p = { x: a.x + 0.5, y: a.y + 1, vx: 16, vy: 0, gravity: 0, life: 40, owner: 0, kind: 'bullet', dmg: 2.8, base: 2.8, growth: 2.2, angle: 25, r: 0.25, hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [], pierce: false };
    (sim as unknown as { projectiles: unknown[] }).projectiles.push(p);
    step(sim, 20);
  };
  shoot();
  check('金塊：飛び道具も扉に当たって消える', Math.abs(sim.vaults[1].max - sim.vaults[1].door - 2.8) < 0.3 && sim.projectiles.length === 0, `${(sim.vaults[1].max - sim.vaults[1].door).toFixed(2)}`);
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
  check(`CPUだけで${mode === 'crown' ? '王冠うばい（5人）' : '金塊どろぼう（3対3）'}が決着する`, sim.finished, `${Math.round(f / 60)}秒`);
}
check('金塊の設定（3本先取）', VAULT.goal === 3);

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
