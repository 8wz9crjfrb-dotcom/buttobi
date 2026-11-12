// チーム戦・体力制・100人組手が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES, HORDE } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CHARACTERS } from '../src/shared/characters';
import { BTN_A, type InputState, type MatchRules, type PlayerSetup } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function make(players: PlayerSetup[], rules: Partial<MatchRules>, seed = 1): Sim {
  const sim = new Sim({ players, stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300, ...rules }, seed });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const P = (slot: number, charId: string, team = 0, cpu = false): PlayerSetup => ({ slot, name: 'p' + slot, charId, cpu, cpuLevel: 5, team });
function jabAt(sim: Sim) {
  for (let i = 0; i < 25; i++) sim.step(new Map([[0, i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N]]));
}

// ---- チーム戦：味方には当たらない／味方にも当たる設定
{
  const sim = make([P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 1)], { teams: true });
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 0.9; sim.fighters[2].x = -6;
  jabAt(sim);
  check('チーム戦：味方には攻撃が当たらない', sim.fighters[1].damage === 0, `${sim.fighters[1].damage}%`);
  const ff = make([P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 1)], { teams: true, friendlyFire: true });
  ff.fighters[0].x = 0; ff.fighters[0].facing = 1; ff.fighters[1].x = 0.9; ff.fighters[2].x = -6;
  jabAt(ff);
  check('チーム戦：「味方にも当たる」なら当たる', ff.fighters[1].damage > 0, `${ff.fighters[1].damage.toFixed(1)}%`);
  const foe = make([P(0, 'guard', 0), P(1, 'hacker', 1), P(2, 'thief', 1)], { teams: true });
  foe.fighters[0].x = 0; foe.fighters[0].facing = 1; foe.fighters[1].x = 0.9; foe.fighters[2].x = -6;
  jabAt(foe);
  check('チーム戦：敵には当たる', foe.fighters[1].damage > 0);
}
{
  // 飛び道具も味方をすり抜ける
  const sim = make([P(0, 'hacker', 0), P(1, 'guard', 0), P(2, 'thief', 1)], { teams: true });
  sim.fighters[0].x = -3; sim.fighters[0].facing = 1; sim.fighters[1].x = 0; sim.fighters[2].x = 3;
  for (let i = 0; i < 60; i++) sim.step(new Map([[0, i === 0 ? { mx: 0, my: 0, buttons: 2 } : N]]));
  check('チーム戦：飛び道具は味方をすり抜けて敵に当たる', sim.fighters[1].damage === 0 && sim.fighters[2].damage > 0, `味方${sim.fighters[1].damage}% 敵${sim.fighters[2].damage.toFixed(1)}%`);
}
{
  // 片方のチームが全員いなくなったら終わり。同じチームは同じ順位
  const sim = make([P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 1), P(3, 'ai', 1)], { teams: true, stocks: 1 });
  for (const s of [2, 3]) {
    sim.fighters[s].x = 100;
    sim.step(new Map());
  }
  for (let i = 0; i < 5; i++) sim.step(new Map());
  const r = sim.results();
  const rank = (s: number) => r.find((x) => x.slot === s)!.rank;
  check('チーム戦：相手チームが全滅したら終わる', sim.ended);
  check('チーム戦：同じチームは同じ順位', rank(0) === 1 && rank(1) === 1 && rank(2) === 3 && rank(3) === 3, r.map((x) => `${x.slot}:${x.rank}`).join(' '));
  const alive = make([P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 1), P(3, 'ai', 1)], { teams: true, stocks: 1 });
  alive.fighters[1].x = 100;
  for (let i = 0; i < 5; i++) alive.step(new Map());
  check('チーム戦：味方が1人残っていれば続く', !alive.ended);
}
{
  // CPU は味方を狙わない：味方どうしのCPUだけなら、ほとんどダメージが入らない
  const players = [P(0, 'guard', 0, true), P(1, 'hacker', 0, true), P(2, 'thief', 1, true), P(3, 'gacha', 1, true)];
  const count = (ff: boolean) => {
    const sim = make(players, { teams: true, friendlyFire: ff, stocks: 3, timeLimit: 120 }, 7);
    const ai = new CpuController(5);
    let ally = 0;
    let foe = 0;
    while (!sim.finished && sim.frame < 130 * 60) {
      const inp = new Map<number, InputState>();
      for (const f of sim.fighters) inp.set(f.slot, ai.think(sim, f, 7));
      sim.step(inp);
      for (const e of sim.events) {
        if (e.k !== 'hit' || e.a === undefined || e.a < 0 || e.a === e.s) continue;
        if (sim.fighter(e.a)!.team === sim.fighter(e.s)!.team) ally++;
        else foe++;
      }
    }
    return { ally, foe, ended: sim.ended };
  };
  const off = count(false);
  check('チーム戦：CPU同士でも味方には1回も当たらない', off.foe > 30 && off.ally === 0 && off.ended, `敵へ${off.foe} 味方へ${off.ally}`);
  const on = count(true);
  check('チーム戦（味方にも当たる）：CPUは敵を狙う（巻き込みは少なめ）', on.foe > 30 && on.ally < on.foe * 0.3, `敵へ${on.foe} 味方へ${on.ally}`);
}

// ---- 体力制
{
  const sim = make([P(0, 'guard'), P(1, 'hacker')], { mode: 'stamina', hp: 100, stocks: 2 });
  check('体力制：残機が設定どおり', sim.fighters[1].stocks === 2);
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 0.9;
  sim.fighters[1].damage = 98;
  jabAt(sim);
  const v = sim.fighters[1];
  check('体力制：HPが0になったらその場で撃墜', v.state === 'dead' || v.state === 'respawn', `状態=${v.state} 残機${v.stocks}`);
  check('体力制：撃墜で残機が減り、撃墜数が入る', v.stocks === 1 && sim.fighters[0].kos === 1);
  for (let i = 0; i < 200; i++) sim.step(new Map());
  check('体力制：復活したらHP満タン', v.damage === 0 && v.state !== 'dead', `状態=${v.state}`);
  // ふっとびはダメージで大きくなりすぎない
  const a = make([P(0, 'guard'), P(1, 'hacker')], { mode: 'stamina', hp: 300 });
  const b = make([P(0, 'guard'), P(1, 'hacker')], { mode: 'stock' });
  for (const s of [a, b]) {
    s.fighters[0].x = 0; s.fighters[0].facing = 1; s.fighters[1].x = 0.9; s.fighters[1].damage = 150;
    jabAt(s);
  }
  check('体力制：ダメージが多くてもふっとびは控えめ', Math.abs(a.fighters[1].x) < Math.abs(b.fighters[1].x), `体力制x=${a.fighters[1].x.toFixed(1)} ストックx=${b.fighters[1].x.toFixed(1)}`);
  // CPU だけで最後まで
  const players = [P(0, 'guard', 0, true), P(1, 'courier', 0, true), P(2, 'dopa', 0, true)];
  const full = make(players, { mode: 'stamina', hp: 150, stocks: 1, timeLimit: 300 }, 3);
  const ai = new CpuController(3);
  while (!full.finished && full.frame < 310 * 60) {
    const inp = new Map<number, InputState>();
    for (const f of full.fighters) inp.set(f.slot, ai.think(full, f, 7));
    full.step(inp);
  }
  const r = full.results();
  check('体力制：CPU戦が最後まで進んで1人が残る', full.ended && full.fighters.filter((f) => !f.out).length === 1, `${Math.round(full.frame / 60)}秒 順位=${r.map((x) => `${x.slot}:${x.rank}`).join(' ')}`);
}

// ---- 100人組手
{
  const enemies = [1, 2, 3].map((s) => P(s, CHARACTERS[s].id, 1, true));
  const sim = make([P(0, 'guard'), ...enemies], { mode: 'stock', stocks: 1, timeLimit: 0, horde: 10 });
  check('100人組手：時間切れにならない', !sim.ended);
  // 敵を場外に飛ばし続ける
  let guard = 0;
  while (!sim.ended && guard++ < 20000) {
    for (const f of sim.fighters) if (f.team === 1 && f.alive && f.state !== 'respawn') f.x = 100;
    sim.step(new Map());
  }
  check('100人組手：決めた人数を倒すと終わる', sim.ended && sim.hordeDefeated === 10, `倒した数${sim.hordeDefeated}`);
  check('100人組手：自分が勝ち（1位）', sim.results().find((x) => x.slot === 0)!.rank === 1);
  check('100人組手：表示に倒した数が入る', sim.toView().horde === 10);
}
{
  // 3人目の敵はしばらく出てこない。10人倒すたびに回復
  const enemies = [1, 2, 3].map((s) => P(s, CHARACTERS[s].id, 1, true));
  const sim = make([P(0, 'guard'), ...enemies], { mode: 'stock', stocks: 1, timeLimit: 0, horde: HORDE.size });
  sim.fighters[0].damage = 50;
  check('100人組手：はじめは敵2人', sim.fighters.filter((f) => f.team === 1 && f.state !== 'dead').length === 2);
  let guard = 0;
  while (sim.hordeDefeated < HORDE.thirdAt + 1 && guard++ < 40000) {
    for (const f of sim.fighters) if (f.team === 1 && f.alive && f.state !== 'respawn') f.x = 100;
    sim.step(new Map());
    if (sim.hordeDefeated === HORDE.healEvery && sim.fighters[0].damage === 50 - HORDE.heal) {
      /* 回復を確認 */
    }
  }
  check('100人組手：10人倒すたびに回復', sim.fighters[0].damage === 0, `${sim.fighters[0].damage}%`);
  for (let i = 0; i < 200; i++) sim.step(new Map());
  check('100人組手：30人倒すと敵が3人になる', sim.fighters.filter((f) => f.team === 1 && f.state !== 'dead').length === 3);
}
{
  const enemies = [1, 2, 3].map((s) => P(s, CHARACTERS[s].id, 1, true));
  const sim = make([P(0, 'guard'), ...enemies], { mode: 'stock', stocks: 1, timeLimit: 0, horde: HORDE.size });
  sim.fighters[0].x = 100;
  for (let i = 0; i < 5; i++) sim.step(new Map());
  check('100人組手：自分がやられたら終わる', sim.ended && sim.results().find((x) => x.slot === 0)!.rank > 1);
  // CPU だけで遊ばせてみて、敵が弱めで何人か倒せることを確かめる
  const play = make([P(0, 'guard', 0, true), ...enemies], { mode: 'stock', stocks: 1, timeLimit: 0, horde: HORDE.size }, 11);
  const ai = new CpuController(11);
  while (!play.finished && play.frame < 60 * 60 * 15) {
    const inp = new Map<number, InputState>();
    for (const f of play.fighters) inp.set(f.slot, ai.think(play, f, f.team === 0 ? 7 : 2));
    play.step(inp);
  }
  check('100人組手：CPU(強さ7)が敵(強さ2)を何人か倒せる', play.hordeDefeated >= 3, `倒した数${play.hordeDefeated} ${Math.round(play.frame / 60)}秒 ${play.ended ? '終了' : '続行中'}`);
}
process.exit(fail ? 1 : 0);
