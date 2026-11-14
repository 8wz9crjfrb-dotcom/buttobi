// 玉入れが意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES, BALL, ballBaskets } from '../src/shared/sim';
import { ballTeamOf, playerColor, TEAM_COLORS } from '../src/shared/characters';
import { decodeState, encodeState } from '../src/shared/protocol';
import { BTN_A, type InputState, type MatchRules, type PlayerSetup } from '../src/shared/types';
import { ballRun } from './ball-balance';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
const P = (slot: number, charId: string): PlayerSetup => ({ slot, name: 'p' + slot, charId, cpu: false, cpuLevel: 1 });
function make(n = 2, rules: Partial<MatchRules> = {}): Sim {
  const ids = ['guard', 'hacker', 'thief', 'trainer'];
  const sim = new Sim({ players: Array.from({ length: n }, (_, i) => P(i, ids[i % 4])), stageId: 'plain', rules: { mode: 'ball', stocks: 3, timeLimit: 120, goals: 3, ...rules }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  for (let i = 0; i < 120; i++) sim.step(new Map());
  return sim;
}
const run = (sim: Sim, frames: number, p0: (i: number) => InputState = () => N) => {
  const goals: number[] = [];
  for (let i = 0; i < frames; i++) {
    sim.step(new Map([[0, p0(i)]]));
    for (const e of sim.events) if (e.k === 'goal') goals.push(e.t);
  }
  return goals;
};

// ---- チーム
{
  const sim = make(4);
  check('チーム：参加した順に赤・青・赤・青', sim.fighters.map((f) => f.team).join() === '0,1,0,1');
  check('チーム：色も赤・青（画面と同じ決め方）', sim.fighters.every((f) => playerColor(sim.setup, f.slot) === TEAM_COLORS[f.team] && ballTeamOf(sim.setup, f.slot) === f.team));
  const ff = make(4);
  ff.fighters[0].x = 0;
  ff.fighters[0].facing = 1;
  ff.fighters[2].x = 0.9;
  ff.fighters[1].x = -6;
  ff.fighters[3].x = -7;
  run(ff, 25, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('チーム：味方には攻撃が当たらない', ff.fighters[2].damage === 0);
}

// ---- ボールを打つ
{
  const sim = make();
  check('ボール：最初はステージの中央の床の上', Math.abs(sim.ball.x) < 0.01 && Math.abs(sim.ball.y - (sim.stage.main.top + BALL.r)) < 0.1);
  const a = sim.fighters[0];
  a.x = sim.ball.x - 0.7;
  a.facing = 1;
  sim.fighters[1].x = -8;
  run(sim, 6, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('ボール：攻撃が当たると、向いている方へ飛ぶ', sim.ball.vx > 3 && sim.ball.y > sim.stage.main.top + BALL.r, `速さ${sim.ball.vx.toFixed(1)}`);
  check('ボール：打った人を覚えている', sim.ball.last === 0);
}

// ---- ゴール：上から入ったときだけ点。点を取るのは、かごを守っていない側のチーム
{
  const sim = make();
  const g = ballBaskets(sim.stage)[1];
  // 下から上へ通り抜けても点にならない
  sim.ball.x = g.cx;
  sim.ball.y = g.y1 - 0.3;
  sim.ball.vx = 0;
  sim.ball.vy = 9;
  const up = run(sim, 8);
  check('ゴール：下から通り抜けても点にならない', up.length === 0 && sim.ballScore.join() === '0,0');
  // 上から落ちてくると点（右のかご＝青の守るかごなので、赤の点）
  sim.ball.x = g.cx;
  sim.ball.y = g.y2 + 0.5;
  sim.ball.vx = 0;
  sim.ball.vy = -2;
  const down = run(sim, 20);
  check('ゴール：上から入ると、相手チーム（赤）の点', down.join() === '0' && sim.ballScore.join() === '1,0', sim.ballScore.join('-'));
  check('ゴール：入ったボールはしばらく消えて、中央から出し直す', !sim.ball.on);
  run(sim, BALL.respawn + 5);
  check('ゴール：出し直したボールは中央', sim.ball.on && Math.abs(sim.ball.x) < 1);
}

// ---- 勝ち負け
{
  const sim = make(2, { goals: 3 });
  sim.ballScore = [2, 0];
  const g = ballBaskets(sim.stage)[1];
  sim.ball.x = g.cx;
  sim.ball.y = g.y2 + 0.4;
  sim.ball.vy = -2;
  sim.ball.last = 0;
  run(sim, 200);
  const r = sim.results();
  check('先取点に届いたら終わり、そのチームが1位', sim.ended && r.find((x) => x.slot === 0)!.rank === 1 && r.find((x) => x.slot === 1)!.rank === 2, JSON.stringify(r.map((x) => [x.slot, x.rank, x.teamGoals])));
  check('結果：ゴールを入れた人と、チームの点が残る', r.find((x) => x.slot === 0)!.goals === 1 && r.find((x) => x.slot === 0)!.teamGoals === 3);
}
{
  const sim = make(2, { timeLimit: 60 });
  sim.ballScore = [0, 2];
  run(sim, 60 * 60 + 10);
  const r = sim.results();
  check('時間切れなら、点の多いチームが勝ち', sim.ended && r.find((x) => x.slot === 1)!.rank === 1);
}
{
  const sim = make();
  sim.ball.x = sim.stage.blast.right + 1;
  run(sim, 2);
  check('場外に出たボールは、中央から出し直す', !sim.ball.on);
  run(sim, BALL.respawn);
  check('場外のあと、中央にボールが戻る', sim.ball.on && Math.abs(sim.ball.x) < 1);
  const f = sim.fighters[1];
  f.x = sim.stage.blast.right + 2;
  run(sim, 400);
  check('ふっとばされても負けにならず、復活する', !sim.ended && f.alive && f.falls === 1);
}

// ---- 通信
{
  const sim = make();
  sim.ballScore = [2, 1];
  const v = sim.toView();
  const back = decodeState(JSON.parse(JSON.stringify(encodeState(v, v.events))));
  check('通信：ボールの位置・点・先取点が送り先で同じになる', !!back.ball && Math.abs(back.ball.x - v.ball!.x) < 0.01 && back.ball.score.join() === '2,1' && back.ball.target === 3 && back.ball.on === v.ball!.on);
}

// ---- CPU：ボールを打って点を入れる
{
  let goals = 0;
  let ended = 0;
  for (let s = 1; s <= 4; s++) {
    const r = ballRun(4, s);
    goals += r.score[0] + r.score[1];
    if (r.secs <= 121) ended++;
  }
  check('CPU：4人の試合で点が入る', goals >= 8, `4試合で${goals}点`);
  check('CPU：試合がきちんと終わる', ended === 4);
}
process.exit(fail ? 1 : 0);
