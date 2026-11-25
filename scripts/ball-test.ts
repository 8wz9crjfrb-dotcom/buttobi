// 玉入れが意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES, BALL, ballBaskets } from '../src/shared/sim';
import { ballTeamOf, playerColor, TEAM_COLORS } from '../src/shared/characters';
import { decodeState, encodeState } from '../src/shared/protocol';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState, type MatchRules, type PlayerSetup } from '../src/shared/types';
import { ballRun } from './ball-balance';
import { THROW, speedToHit, lenForSpeed } from '../src/shared/ballThrow';

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
const run = (sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) => {
  const goals: number[] = [];
  for (let i = 0; i < frames; i++) {
    sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
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

// ---- 攻撃はできない（Aは「奪う」、Bは「投げる」）
{
  const sim = make(2);
  const a = sim.fighters[0];
  const v = sim.fighters[1];
  a.x = 3;
  a.facing = 1;
  v.x = 3.9;
  sim.ball.x = -6;
  run(sim, 25, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : i === 30 ? { mx: 0, my: 0, buttons: BTN_B } : N));
  check('攻撃できない：Aを押しても相手にダメージが入らない', v.damage === 0 && a.state !== 'attack');
}

// ---- ボールを拾う・投げる・奪う
{
  const sim = make();
  check('ボール：最初はステージの中央の上から落ちてくる', Math.abs(sim.ball.x) < 0.01);
  const [a, v] = sim.fighters;
  v.x = -8;
  a.x = sim.ball.x;
  run(sim, 30);
  check('拾う：ボールに触れると持つ', sim.ball.holder === 0);
  // 持っている間は少し遅い
  const sp = (s: Sim) => (s as unknown as { speedMul(f: unknown): number }).speedMul(a);
  check('持っている間は少し足が遅い', sp(sim) < 1, sp(sim).toFixed(2));
  // 「投げる」を押したまま右上へ狙い、離すと投げる（押している間は動かない）
  const x0 = a.x;
  run(sim, 15, () => ({ mx: 0.6, my: 0.6, buttons: BTN_B }));
  check('投げる：押している間は動かず、ボールも持ったまま', Math.abs(a.x - x0) < 0.05 && sim.ball.holder === 0 && a.ballAiming);
  run(sim, 2, () => N);
  check('投げる：離すと狙った向き（右上）へ飛ぶ', sim.ball.holder === -1 && sim.ball.vx > 3 && sim.ball.vy > 3, `${sim.ball.vx.toFixed(1)},${sim.ball.vy.toFixed(1)}`);
  check('投げる：投げた人を覚えている', sim.ball.last === 0);
  // 少しだけ引っ張って離したら投げない
  const s2 = make();
  s2.fighters[1].x = -8;
  s2.fighters[0].x = s2.ball.x;
  run(s2, 30);
  run(s2, 10, () => ({ mx: 0.1, my: 0.05, buttons: BTN_B }));
  run(s2, 2, () => N);
  check('投げる：ほとんど引っ張らずに離したら、投げずにやめる', s2.ball.holder === 0);
}
{
  // 奪う：近くの相手（青）が持っているボールを、相手の方を向いて「奪う」で取れる
  const sim = make();
  const [a, v] = sim.fighters;
  v.x = sim.ball.x;
  a.x = -8;
  run(sim, 30);
  check('奪う：相手がボールを持つ', sim.ball.holder === 1);
  run(sim, 70);
  a.x = v.x - 1;
  a.facing = 1;
  run(sim, 2, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('奪う：近くで「奪う」を押すと奪える', sim.ball.holder === 0);
  // 奪った直後は奪い返せない
  run(sim, 2, () => N, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('奪う：奪われた直後は、すぐには奪い返せない', sim.ball.holder === 0);
}
{
  // 構えている相手からは奪えない。空振りすると少しの間は奪えない
  const sim = make();
  const [a, v] = sim.fighters;
  v.x = sim.ball.x;
  a.x = -8;
  run(sim, 100);
  a.x = v.x - 1;
  a.facing = 1;
  run(sim, 4, () => N, () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
  run(sim, 2, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N), () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
  check('奪う：「構える」の間は奪えない', sim.ball.holder === 1 && a.stealCd > 0);
  // 後ろ向きでは奪えない
  const s2 = make();
  const [a2, v2] = s2.fighters;
  v2.x = s2.ball.x;
  a2.x = -8;
  run(s2, 100);
  a2.x = v2.x - 1;
  a2.facing = -1;
  run(s2, 2, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('奪う：相手に背中を向けていると奪えない', s2.ball.holder === 1);
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
{
  // 点を取ったチーム（赤）は、次に出てくるボールを約1秒は取れない。取られたチーム（青）は取れる
  const sim = make();
  const g = ballBaskets(sim.stage)[1];
  const [a, v] = sim.fighters;
  a.x = -8;
  v.x = 8;
  Object.assign(sim.ball, { x: g.cx, y: g.y2 + 0.5, vx: 0, vy: -2, holder: -1 });
  run(sim, 20);
  check('点を取った：赤の点', sim.ballScore.join() === '1,0');
  run(sim, BALL.respawn);
  // 出てきたボールの真下に赤を立たせる
  a.x = sim.ball.x;
  run(sim, 40);
  check('点を取ったチームは、出てきたボールを約1秒取れない', sim.ball.holder === -1);
  run(sim, 40);
  check('約1秒たてば取れる', sim.ball.holder === 0);
  // 取られた側は、すぐに取れる
  const s2 = make();
  const g2 = ballBaskets(s2.stage)[1];
  s2.fighters[0].x = -8;
  s2.fighters[1].x = 8;
  Object.assign(s2.ball, { x: g2.cx, y: g2.y2 + 0.5, vx: 0, vy: -2, holder: -1 });
  run(s2, 20);
  run(s2, BALL.respawn);
  s2.fighters[1].x = s2.ball.x;
  run(s2, 40);
  check('点を取られたチームは、出てきたボールをすぐ取れる', s2.ball.holder === 1);
}
{
  // 投げて外し、場外へ：投げたチーム（赤）は、次に出てくるボールを約1秒さわれない
  const sim = make();
  const [a, v] = sim.fighters;
  v.x = 8;
  a.x = sim.ball.x;
  run(sim, 30);
  check('外し：赤がボールを持つ', sim.ball.holder === 0);
  // 左（場外の方）へ強く投げる
  run(sim, 10, () => ({ mx: -0.9, my: 0.3, buttons: BTN_B }));
  run(sim, 1);
  check('外し：投げた', sim.ball.holder === -1);
  for (let i = 0; i < 300 && sim.ball.on; i++) run(sim, 1);
  check('外し：場外に出た', !sim.ball.on && sim.ballScore.join() === '0,0');
  check('外し：投げたチームは取れない印が付く', sim.ball.lockTeam === 0 && sim.ball.lockT > 0);
  for (let i = 0; i < 300 && !sim.ball.on; i++) run(sim, 1);
  a.x = sim.ball.x;
  run(sim, 50);
  const v1 = sim.toView().ball!;
  check('外し：出てきたボールを、投げたチームは約1秒さわれない（画面に「取れないチーム」が伝わる）', sim.ball.holder === -1 && v1.lock === 0);
  run(sim, 25);
  check('外し：約1秒たてば取れる', sim.ball.holder === 0 && sim.toView().ball!.lock === -1);
}
{
  // 横から入っても点にならない（はね返る）
  const sim = make();
  const g = ballBaskets(sim.stage)[1];
  sim.fighters.forEach((f) => (f.x = -8));
  sim.ball.x = g.x1 - 0.6;
  sim.ball.y = (g.y1 + g.y2) / 2;
  sim.ball.vx = 8;
  sim.ball.vy = 0;
  run(sim, 20);
  check('ゴール：横から入っても点にならない（真上からだけ）', sim.ballScore.join() === '0,0' && sim.ball.vx <= 0, `${sim.ballScore.join('-')} vx=${sim.ball.vx.toFixed(1)}`);
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
  // 復活まで約5秒待つ
  run(sim, 600);
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
  const secs: number[] = [];
  for (let s = 1; s <= 4; s++) {
    const r = ballRun(4, s);
    goals += r.score[0] + r.score[1];
    secs.push(Math.round(r.secs));
    // 2分の試合。同点で時間切れなら最長60秒の延長がある
    if (r.secs <= 121 + 61) ended++;
  }
  check('CPU：4人の試合で点が入る', goals >= 8, `4試合で${goals}点`);
  check('CPU：試合がきちんと終わる（延長も最長60秒）', ended === 4, `${secs.join('・')}秒`);
}
// ---- ジャンプ力：重たいキャラ（トレーナー・ジャンプ力1）は、軽いキャラ（メンヘラ・ジャンプ力4）より低い
{
  const peak = (charId: string, mode: 'ball' | 'stock') => {
    const sim = new Sim({ players: [P(0, charId), P(1, 'hacker')], stageId: 'plain', rules: { mode, stocks: 3, timeLimit: 120, goals: 5 }, seed: 1 });
    while (sim.frame <= COUNTDOWN_FRAMES + 60) sim.step(new Map());
    const f = sim.fighters[0];
    f.x = -3;
    sim.fighters[1].x = 6;
    sim.ball.x = 8;
    const y0 = f.y;
    let top = y0;
    for (let i = 0; i < 70; i++) {
      sim.step(new Map([[0, { mx: 0, my: 0, buttons: i < 12 ? BTN_JUMP : 0 }]]));
      top = Math.max(top, f.y);
    }
    return top - y0;
  };
  const heavy = peak('trainer', 'ball');
  const light = peak('menhera', 'ball');
  check('ジャンプ力：重たいキャラほど低く跳ぶ（玉入れ）', light > heavy * 1.3, `トレーナー ${heavy.toFixed(2)}m / メンヘラ ${light.toFixed(2)}m`);
  // ほかのルールでは、いつものジャンプの高さ（トレーナーとメンヘラの差は小さい）
  const h2 = peak('trainer', 'stock');
  const l2 = peak('menhera', 'stock');
  check('ジャンプ力：玉入れ以外のルールでは、いつもの高さのまま', l2 / h2 < 1.25 && Math.abs(h2 - heavy) > 0.3, `トレーナー ${h2.toFixed(2)}m / メンヘラ ${l2.toFixed(2)}m`);
}
// ---- パス：「投げる」を引っ張らずに離すと、後ろ（狙うかごから遠い側）にいる味方へパス
{
  const setup = (mateBehind: boolean, n = 4) => {
    const sim = make(n);
    const [a] = sim.fighters;
    const goal = ballBaskets(sim.stage)[1 - a.team];
    const back = -Math.sign(goal.cx) || -1; // かごと反対の向き
    a.x = 0;
    a.y = sim.stage.main.top;
    sim.ball.x = 0;
    sim.ball.y = sim.stage.main.top + 1;
    for (const o of sim.fighters.slice(1)) {
      o.x = o.team === a.team ? (mateBehind ? back * 5 : -back * 5) : -back * 9;
      o.y = sim.stage.main.top;
      o.vx = 0;
    }
    run(sim, 20);
    return { sim, a, mate: sim.fighters.find((o) => o !== a && o.team === a.team) };
  };
  const tap = (sim: Sim) => run(sim, 6, (i) => (i < 3 ? { mx: 0, my: 0, buttons: BTN_B } : N));
  {
    const { sim, a, mate } = setup(true);
    check('パス：赤がボールを持つ', sim.ball.holder === a.slot);
    tap(sim);
    const thrown = sim.ball.holder === -1 && Math.sign(sim.ball.vx) === Math.sign(mate!.x - a.x);
    for (let i = 0; i < 180 && sim.ball.holder === -1; i++) run(sim, 1);
    check('パス：単押しで、後ろの味方へ投げる', thrown);
    check('パス：後ろの味方が受け取る', sim.ball.holder === mate!.slot, `持っている人 ${sim.ball.holder}`);
  }
  {
    const { sim, a } = setup(false);
    tap(sim);
    run(sim, 10);
    check('パス：味方が前（かご側）にしかいないときは、何もしない', sim.ball.holder === a.slot);
  }
  {
    const { sim, a } = setup(true, 2);
    tap(sim);
    run(sim, 10);
    check('パス：味方がいない（1対1）ときは、何もしない', sim.ball.holder === a.slot);
  }
  {
    const { sim, a, mate } = setup(true);
    // 味方を場外へ出して撃墜する
    mate!.x = sim.stage.blast.right + 2;
    mate!.y = 3;
    run(sim, 2);
    const down = mate!.state === 'dead';
    tap(sim);
    run(sim, 10);
    check('パス：後ろの味方が撃墜されて復活待ちのときは、何もしない', down && sim.ball.holder === a.slot);
  }
}
// ---- ステージ：玉入れでは上の足場をなくす（広さは人数で変わるのは同じ）
{
  const ids = ['plain', 'gacha', 'cyber', 'studio', 'gym', 'room'];
  const mk = (id: string, n: number, mode: 'ball' | 'stock') => new Sim({ players: Array.from({ length: n }, (_, i) => P(i, 'hacker')), stageId: id, rules: { mode, stocks: 3, timeLimit: 120, goals: 3 }, seed: 1 }).stage;
  check('ステージ：玉入れでは、どのステージも上の足場がない', ids.every((id) => mk(id, 2, 'ball').platforms.length === 0 && mk(id, 4, 'ball').platforms.length === 0));
  check('ステージ：玉入れ以外では、足場はいつもどおり', ids.some((id) => mk(id, 2, 'stock').platforms.length > 0));
  const w = (id: string, n: number, mode: 'ball' | 'stock') => mk(id, n, mode).main.x2 - mk(id, n, mode).main.x1;
  check('ステージ：広さはストック制と同じ（4人以上で広くなる）', ids.every((id) => w(id, 2, 'ball') === w(id, 2, 'stock') && w(id, 4, 'ball') === w(id, 4, 'stock')) && w('plain', 4, 'ball') > w('plain', 2, 'ball'), `そらの台地 2人 ${w('plain', 2, 'ball')}m / 4人 ${w('plain', 4, 'ball')}m`);
}
// ---- かごのふち（輪）：当たるとはね返る。真下から投げても入らない
{
  const sim = make(2);
  const g = ballBaskets(sim.stage)[1];
  sim.fighters[0].x = -3;
  sim.fighters[1].x = -5;
  sim.ball.holder = -1;
  sim.ball.x = g.x1;
  sim.ball.y = g.y2 + 2;
  sim.ball.vx = 0;
  sim.ball.vy = 0;
  sim.ball.last = 0;
  run(sim, 40);
  check('ふち：ふちの真上から落ちると、はね返って入らない', sim.ballScore.join() === '0,0' && sim.ball.x < g.x1, `x=${(sim.ball.x - g.x1).toFixed(2)}`);
}
{
  const sim = make(2);
  const g = ballBaskets(sim.stage)[1];
  const a = sim.fighters[0];
  a.x = g.cx;
  sim.fighters[1].x = -5;
  sim.ball.x = a.x;
  run(sim, 20);
  // 真上へ強く投げる
  run(sim, 8, (i) => (i < 5 ? { mx: 0, my: 1, buttons: BTN_B } : N));
  for (let i = 0; i < 200 && sim.ball.holder === -1 && sim.ballScore.join() === '0,0'; i++) run(sim, 1);
  check('ふち：かごの真下から真上に投げても入らない', sim.ballScore.join() === '0,0');
}
{
  const sim = make(2);
  const g = ballBaskets(sim.stage)[1];
  sim.fighters[0].x = -3;
  sim.fighters[1].x = -5;
  sim.ball.holder = -1;
  sim.ball.x = g.cx;
  sim.ball.y = g.y2 + 2;
  sim.ball.vx = 0;
  sim.ball.vy = 0;
  sim.ball.last = 0;
  sim.ball.thrownTeam = 0;
  sim.ball.shotX = g.cx - 3;
  run(sim, 40);
  check('ふち：まん中に真上から落ちれば入る（1点）', sim.ballScore.join() === '1,0');
}

// ---- 2ポイントライン：遠くから投げて入れたら2点。投げる力がいちばん弱いキャラでも届く
{
  const shoot = (charId: string, dist: number) => {
    const sim = new Sim({ players: [P(0, charId), P(1, 'hacker')], stageId: 'gacha', rules: { mode: 'ball', stocks: 3, timeLimit: 120, goals: 9 }, seed: 1 });
    while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
    for (let i = 0; i < 120; i++) sim.step(new Map());
    const a = sim.fighters[0];
    const g = ballBaskets(sim.stage)[1 - a.team];
    const dir = Math.sign(g.cx) || 1;
    a.x = g.cx - dir * dist;
    a.facing = dir;
    sim.fighters[1].x = g.cx - dir * (dist + 4);
    sim.ball.x = a.x;
    sim.ball.y = sim.stage.main.top + 1;
    run(sim, 20);
    if (sim.ball.holder !== 0) return 'no-hold';
    // いちばん届く角度を探して、かごのまん中を狙う
    let best: { deg: number; sp: number } | null = null;
    for (let deg = 30; deg <= 70; deg++) {
      const sp = speedToHit(charId, sim.ball.x, sim.ball.y, deg, g.cx, g.y2 + 0.05);
      if (sp !== null && (!best || sp < best.sp)) best = { deg, sp };
    }
    if (!best) return 'unreachable';
    const len = lenForSpeed(charId, best.sp);
    const ang = (best.deg * Math.PI) / 180;
    run(sim, 6, (i) => (i < 4 ? { mx: Math.cos(ang) * len * dir, my: Math.sin(ang) * len, buttons: BTN_B } : N));
    for (let i = 0; i < 240 && sim.ball.on && (sim.ball.holder as number) === -1; i++) run(sim, 1);
    return sim.ballScore[a.team];
  };
  const weak = ['thief', 'dopa', 'menhera'];
  const far = weak.map((c) => shoot(c, THROW.twoPoint + 0.1));
  check('2点：投げる力がいちばん弱いキャラでも、2ポイントラインのすぐ外から入れられて2点', far.every((p) => p === 2), far.join(','));
  const near = shoot('thief', THROW.twoPoint - 1.5);
  check('2点：2ポイントラインの内側から入れたら1点', near === 1, String(near));
  const strong = shoot('trainer', THROW.twoPoint + 3);
  check('2点：投げる力が強いキャラは、もっと遠くからでも入る', strong === 2, String(strong));
}

// ---- 「奪う」の待ち時間：使ったら約1秒は使えない
{
  const sim = make(2);
  const [a, v] = sim.fighters;
  v.x = 2;
  sim.ball.x = 2;
  run(sim, 20);
  a.x = 1.2;
  a.facing = 1;
  v.ballSafe = 0;
  run(sim, 2, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  const stole = sim.ball.holder === 0;
  check('奪う：成功したら、約1秒は次の「奪う」が使えない', stole && a.stealCd >= THROW.stealMiss - 3 && THROW.stealMiss === 60, `残り ${a.stealCd}`);
}
process.exit(fail ? 1 : 0);
