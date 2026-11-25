// 延長戦（エリア・王冠）、復活までの待ち時間、コイン集めの撃墜時のコイン
import { Sim, COUNTDOWN_FRAMES, OVERTIME_MAX, BALL } from '../src/shared/sim';
import type { InputState, MatchRules } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(rules: Partial<MatchRules>, n = 3): Sim {
  const ids = ['guard', 'thief', 'hacker', 'streamer'];
  const sim = new Sim({ players: ids.slice(0, n).map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: false, cpuLevel: 1 })), stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 120, ...rules } as MatchRules, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const step = (sim: Sim, k: number, inp?: Map<number, InputState>) => {
  for (let i = 0; i < k && !sim.ended; i++) sim.step(inp ?? new Map());
};
/** 時間切れの直前まで進める */
const toTimeUp = (sim: Sim, each?: () => void) => {
  while (sim.timeLeftFrames > 1 && !sim.ended) {
    each?.();
    sim.step(new Map());
  }
};

// ---- 王冠うばい：1位でない人が王冠を持ったまま時間切れ → 延長。奪われたら終わり
{
  const sim = make({ mode: 'crown', timeLimit: 10, crownGoal: 999 });
  const hold = (slot: number) => {
    sim.crown.holder = slot;
    sim.crown.on = true;
  };
  toTimeUp(sim);
  sim.crownPts.set(0, 500);
  sim.crownPts.set(1, 100);
  hold(1);
  step(sim, 30);
  check('王冠：1位でない人が持っていると、時間切れでも続く（延長中）', !sim.ended && sim.overtime && !!sim.toView().overtime);
  // 1位の人が奪った
  hold(0);
  step(sim, 2);
  check('王冠：延長中に奪われたら終わる', sim.ended);
}
{
  const sim = make({ mode: 'crown', timeLimit: 10, crownGoal: 999 });
  toTimeUp(sim);
  sim.crownPts.set(0, 500);
  sim.crownPts.set(1, 100);
  sim.crown.holder = 0;
  sim.crown.on = true;
  step(sim, 3);
  check('王冠：1位の人が持っていれば、時間切れでそのまま終わる', sim.ended && !sim.overtime);
}
{
  // 延長中に持ち続けて単独1位になったら、その人の勝ちで終わる
  const sim = make({ mode: 'crown', timeLimit: 10, crownGoal: 999 });
  toTimeUp(sim);
  sim.crownPts.set(0, 500);
  sim.crownPts.set(1, 470);
  sim.crown.holder = 1;
  sim.crown.on = true;
  step(sim, 3);
  const during = !sim.ended && sim.overtime;
  step(sim, 120, new Map());
  check('王冠：延長中に逆転（単独1位）したら、その人の勝ちで終わる', during && sim.ended && sim.results().find((r) => r.rank === 1)?.slot === 1, `${sim.crownPts.get(1)} vs ${sim.crownPts.get(0)}`);
}
{
  // 奪われないままでも、最長 OVERTIME_MAX で終わる
  const sim = make({ mode: 'crown', timeLimit: 10, crownGoal: 999999 });
  toTimeUp(sim);
  sim.crownPts.set(0, 99999);
  sim.crownPts.set(1, 0);
  sim.crown.holder = 1;
  sim.crown.on = true;
  step(sim, OVERTIME_MAX - 60);
  const mid = !sim.ended && sim.overtime;
  step(sim, 200);
  check('王冠：延長は最長60秒で終わる', mid && sim.ended);
}

// ---- エリア：1位でない人がエリアにいる間は延長。いなくなったら終わり
{
  const sim = make({ mode: 'area', timeLimit: 10, area: 'move' }, 2);
  const [a, b] = sim.fighters;
  const z = sim.areaZones()[0];
  const stand = (f: (typeof sim.fighters)[number], x: number) => {
    f.x = x;
    f.y = sim.stage.main.top;
    f.vx = 0;
    f.vy = 0;
  };
  const inside = (z.x1 + z.x2) / 2;
  const outside = z.x1 - 3 > sim.stage.main.x1 + 0.5 ? z.x1 - 3 : z.x2 + 3;
  toTimeUp(sim, () => {
    stand(a, outside);
    stand(b, outside);
  });
  sim.areaGauge.set(0, 300);
  sim.areaGauge.set(1, 50);
  for (let i = 0; i < 20 && !sim.ended; i++) {
    stand(b, inside);
    stand(a, outside);
    sim.step(new Map());
  }
  check('エリア：1位でない人がエリアにいると、時間切れでも続く（延長中）', !sim.ended && sim.overtime, `ゲージ 0:${sim.areaGauge.get(0)} 1:${Math.floor(sim.areaGauge.get(1) ?? 0)}`);
  // 1位の人がエリアに入って、追い出した
  for (let i = 0; i < 3 && !sim.ended; i++) {
    stand(a, inside);
    stand(b, outside);
    sim.step(new Map());
  }
  check('エリア：延長中に奪われたら終わる', sim.ended);
}

// ---- 復活までの待ち時間：ストック制は今までどおり、ほかのルール（王冠など）は約5秒
for (const [mode, wait] of [['stock', 100], ['crown', 300], ['coins', 300]] as const) {
  const sim = make({ mode, timeLimit: 120 }, 2);
  const f = sim.fighters[1];
  f.x = sim.stage.blast.right + 2;
  f.y = 3;
  step(sim, 2);
  const deadAt = sim.frame;
  let back = -1;
  for (let i = 0; i < 400 && back < 0; i++) {
    sim.step(new Map());
    if (f.state !== 'dead') back = sim.frame - deadAt;
  }
  check(`復活までの待ち時間（${mode}）：約${(wait / 60).toFixed(1)}秒`, Math.abs(back - wait) <= 3, `${back}フレーム`);
}

// ---- コイン集め：撃墜で手放すコインは、半分を撃墜した人がもらい、残りはステージのあちこちに降る
{
  const sim = make({ mode: 'coins', timeLimit: 120 }, 2);
  sim.coins = [];
  const [a, b] = sim.fighters;
  sim.coinsHeld.set(0, 0);
  sim.coinsHeld.set(1, 20);
  b.lastHitBy = a.slot;
  b.lastHitFrame = sim.frame;
  b.x = sim.stage.blast.right + 2;
  b.y = 3;
  step(sim, 2);
  const xs = sim.coins.map((c) => c.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  const m = sim.stage.main;
  const total = sim.coins.reduce((n, c) => n + c.v, 0);
  check('コイン集め：撃墜した人が、手放したコインの半分をもらう', sim.coinsHeld.get(0) === 5 && sim.coinsHeld.get(1) === 10, `撃墜した人 ${sim.coinsHeld.get(0)}・された人 ${sim.coinsHeld.get(1)}`);
  check('コイン集め：残りはステージのあちこちに降る（中央に固まらない）', total === 5 && spread > (m.x2 - m.x1) * 0.4, `${xs.map((x) => x.toFixed(1)).join(', ')}`);
}

// ---- 玉入れ：同点で時間切れなら、1点入るまで延長（最長60秒で引き分け）
{
  const sim = make({ mode: 'ball', timeLimit: 10, goals: 5 }, 2);
  toTimeUp(sim);
  sim.ballScore[0] = 1;
  sim.ballScore[1] = 1;
  step(sim, 30);
  check('玉入れ：同点で時間切れなら、続く（延長中）', !sim.ended && sim.overtime && !!sim.toView().overtime);
  // 延長中に赤が1点（ゴールのあとと同じく、ボールは少しのあいだ消える）
  sim.ballScore[0] = 2;
  sim.ball.on = false;
  sim.ball.holder = -1;
  sim.ball.timer = BALL.respawn;
  step(sim, 2);
  check('玉入れ：延長中に点が入っても、すぐには終わらない（ゴールの間をおく）', !sim.ended);
  step(sim, 200);
  const r = sim.results();
  check('玉入れ：延長中に点が入ったら、そのチームの勝ちで終わる', sim.ended && r.find((e) => e.slot === 0)?.rank === 1 && r.find((e) => e.slot === 1)?.rank === 2);
}
{
  const sim = make({ mode: 'ball', timeLimit: 10, goals: 5 }, 2);
  toTimeUp(sim);
  sim.ballScore[0] = 2;
  sim.ballScore[1] = 1;
  step(sim, 3);
  check('玉入れ：同点でなければ、時間切れでそのまま終わる', sim.ended && !sim.overtime);
}
{
  const sim = make({ mode: 'ball', timeLimit: 10, goals: 5 }, 2);
  toTimeUp(sim);
  const keep = () => {
    sim.ballScore[0] = 0;
    sim.ballScore[1] = 0;
  };
  keep();
  step(sim, 3);
  const during = !sim.ended && sim.overtime;
  for (let i = 0; i < OVERTIME_MAX - 120 && !sim.ended; i++) {
    keep();
    sim.step(new Map());
  }
  const mid = !sim.ended;
  for (let i = 0; i < 300 && !sim.ended; i++) {
    keep();
    sim.step(new Map());
  }
  const r = sim.results();
  check('玉入れ：延長して60秒入らなければ、引き分けで終わる', during && mid && sim.ended && r.every((e) => e.rank === 1), r.map((e) => e.rank).join(','));
}

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
