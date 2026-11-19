// 賞金首・コイン集め
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { BOUNTY, COINS } from '../src/shared/moves';
import { decodeState, encodeState } from '../src/shared/protocol';
import type { MatchRules } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(rules: Partial<MatchRules>, n = 3): Sim {
  const ids = ['guard', 'thief', 'hacker', 'streamer', 'gacha'];
  const sim = new Sim({ players: ids.slice(0, n).map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: false, cpuLevel: 1, team: i % 2 })), stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 120, ...rules } as MatchRules, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const step = (sim: Sim, k: number) => { for (let i = 0; i < k; i++) sim.step(new Map()); };
/** slot を by が撃墜した（by = -1 なら自分で落ちた） */
function ko(sim: Sim, slot: number, by: number) {
  const f = sim.fighter(slot)!;
  f.lastHitBy = by;
  f.lastHitFrame = sim.frame;
  f.x = 99;
  step(sim, 2);
  step(sim, 260); // 復活を待つ
}

// ---- 賞金首
{
  const sim = make({ mode: 'bounty' });
  ko(sim, 1, 0);
  check('賞金首：撃墜すると1点', sim.bountyPts.get(0) === BOUNTY.ko && sim.bountyHolder === -1);
  ko(sim, 2, 0);
  check('賞金首：一番点が多い人（2点以上）が賞金首になる', sim.bountyPts.get(0) === 2 && sim.bountyHolder === 0);
  ko(sim, 0, 1);
  check('賞金首：賞金首を倒すと点が上乗せ（1+2）', sim.bountyPts.get(1) === BOUNTY.ko + BOUNTY.bonus, `${sim.bountyPts.get(1)}`);
  check('賞金首：倒した人が1位なら新しい賞金首', sim.bountyHolder === 1);
  ko(sim, 1, -1);
  check('賞金首：自分で落ちると1点減る', sim.bountyPts.get(1) === 2, `${sim.bountyPts.get(1)}`);
  check('賞金首：同点の1位は、今の賞金首が続ける', sim.bountyHolder === 1);
  ko(sim, 2, -1);
  check('賞金首：0点より下にはならない', (sim.bountyPts.get(2) ?? 0) === 0);
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('賞金首：通信で状態が伝わる', !!v.bounty && v.bounty.holder === 1 && v.bounty.pts.length >= 2);
  sim.bountyPts.set(1, 9);
  while (!sim.finished) sim.step(new Map());
  const r = sim.results();
  check('賞金首：時間切れで点が一番多い人の勝ち', r[0].slot === 1 && r[0].bounty === 9, JSON.stringify(r.map((x) => [x.slot, x.rank, x.bounty])));
}

// ---- コイン集め
{
  const sim = make({ mode: 'coins' });
  step(sim, 60);
  check('コイン：上から降ってくる', sim.coins.length >= 1);
  step(sim, COINS.every * 30);
  check('コイン：出ている数には上限がある', sim.coins.length <= COINS.max, `${sim.coins.length}`);
  const [a, b] = sim.fighters;
  // 拾う
  const c = sim.coins[0];
  a.x = c.x; a.y = c.y;
  step(sim, 2);
  const got = sim.coinsHeld.get(0) ?? 0;
  check('コイン：触れると拾える', got >= 1, `${got}`);
  sim.coinsHeld.set(0, 20);
  // 攻撃を受けると落とす
  sim.coins = [];
  b.x = a.x + 0.8; b.y = a.y; b.facing = -1; a.grounded = b.grounded = true;
  sim.step(new Map([[1, { mx: 0, my: 0, buttons: 1 }]]));
  step(sim, 12);
  const left = sim.coinsHeld.get(0) ?? 0;
  check('コイン：攻撃を受けるとコインを落とす', left < 20 && left >= 20 - COINS.hitMax, `${left}`);
  check('コイン：落としたコインが飛び散る', sim.coins.length >= 1);
  // 撃墜されると半分ばらまく
  sim.coinsHeld.set(0, 10);
  a.lastHitBy = 1; a.lastHitFrame = sim.frame; a.x = 99;
  step(sim, 2);
  check('コイン：撃墜されると半分を落とす', sim.coinsHeld.get(0) === 5, `${sim.coinsHeld.get(0)}`);
  const v = decodeState(JSON.parse(JSON.stringify(encodeState(sim.toView(), []))));
  check('コイン：通信で状態が伝わる', !!v.coins && v.coins.list.length === sim.coins.length && v.coins.held.some(([s, n]) => s === 0 && n === 5));
  sim.coinsHeld.set(2, 99);
  while (!sim.finished) sim.step(new Map());
  const r = sim.results();
  check('コイン：時間切れで一番多く持っている人の勝ち', r[0].slot === 2 && (r[0].coins ?? 0) >= 99, JSON.stringify(r.map((x) => [x.slot, x.rank, x.coins])));
}

// CPUだけで最後まで遊べる（奇数人）
for (const [mode, n] of [['bounty', 3], ['bounty', 5], ['coins', 3], ['coins', 5]] as const) {
  const ids = ['guard', 'hacker', 'thief', 'streamer', 'gacha'];
  const sim = new Sim({ players: ids.slice(0, n).map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: true, cpuLevel: 6 })), stageId: 'plain', rules: { mode, stocks: 3, timeLimit: 120 } as MatchRules, seed: 5 });
  const cpu = new CpuController(5);
  let f = 0;
  while (!sim.finished && f < 60 * 200) {
    sim.step(new Map(sim.fighters.map((x) => [x.slot, cpu.think(sim, x, 6)])));
    f++;
  }
  const r = sim.results();
  check(`CPUだけで${mode === 'bounty' ? '賞金首' : 'コイン集め'}（${n}人）が決着する`, sim.finished, mode === 'bounty' ? r.map((x) => x.bounty).join(',') : r.map((x) => x.coins).join(','));
}

// ---- 大人数のときは、狭いステージを広い形で戦う
{
  const widthOf = (stageId: string, n: number, horde = false) => {
    const players = Array.from({ length: n }, (_, i) => ({ slot: i, name: 'p' + i, charId: 'guard', cpu: true, cpuLevel: 3 }));
    const sim = new Sim({ players, stageId, rules: { mode: 'stock', stocks: 3, timeLimit: 0, ...(horde ? { horde: 100 } : {}) }, seed: 1 });
    return sim.stage.main.x2 - sim.stage.main.x1;
  };
  for (const [id, narrow] of [['timeline', 13], ['cyber', 16], ['plain', 18], ['rooftop', 18]] as const) {
    check(`${id}：3人まではふつうの広さ、4人以上は広い形`, widthOf(id, 2) === narrow && widthOf(id, 3) === narrow && widthOf(id, 4) > narrow + 4 && widthOf(id, 6) === widthOf(id, 4), `2人${widthOf(id, 2)}m 4人${widthOf(id, 4)}m`);
  }
  check('広いステージ（ガチャ会場）は人数で変わらない', widthOf('gacha', 2) === widthOf('gacha', 6));
  check('100人組手はいつもふつうの広さ', widthOf('plain', 6, true) === 18);
  // 広い形でもCPUだけで決着する（落ちて戻れない場所がない）
  for (const id of ['timeline', 'cyber', 'plain']) {
    const players = Array.from({ length: 4 }, (_, i) => ({ slot: i, name: 'p' + i, charId: ['guard', 'thief', 'courier', 'menhera'][i], cpu: true, cpuLevel: 6 }));
    const sim = new Sim({ players, stageId: id, rules: { mode: 'stock', stocks: 2, timeLimit: 300 }, seed: 7 });
    const ai = new CpuController(7);
    while (!sim.finished && sim.frame < 330 * 60) sim.step(new Map(sim.fighters.map((f) => [f.slot, ai.think(sim, f, 6)])));
    check(`${id}（広い形・4人）：CPUだけで最後まで進む`, sim.finished, `${Math.round(sim.frame / 60)}秒`);
  }
}

console.log(fail ? `\n${fail} 件 NG` : '\nすべて OK');
process.exit(fail ? 1 : 0);
