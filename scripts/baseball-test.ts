// 野球（CPUと1対1）の計算が意図どおりに動くかを確かめる
import { Baseball, BBCpu, BB, type BBSetup } from '../src/shared/baseball';
import { BTN_A, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
const setup = (innings = 1, seed = 1): BBSetup => ({
  players: [
    { slot: 0, name: 'あ', charId: 'guard', cpu: false, level: 5, team: 0 },
    { slot: 1, name: 'い', charId: 'hacker', cpu: false, level: 5, team: 1 },
  ],
  innings,
  seed,
});
/** フェーズが変わるまで進める（入力は f で決める） */
const until = (g: Baseball, cond: () => boolean, f: (g: Baseball) => Map<number, InputState> = () => new Map(), max = 3000) => {
  for (let i = 0; i < max && !cond(); i++) g.step(f(g));
};
const pitchAt = (x: number, y: number) => (g: Baseball) => {
  const m = new Map<number, InputState>();
  if (g.phase === 'aim') {
    g.aim.x = x;
    g.aim.y = y;
    m.set(g.pitcher.slot, { mx: 0, my: 0, buttons: g.frame % 2 ? BTN_A : 0 });
  }
  return m;
};

// ---- 見送り：ゾーンの真ん中はストライク、大きく外れるとボール
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'call', pitchAt(0, 0.8));
  check('見送り：真ん中はストライク', g.lastCall === 'strike', `${g.lastCall}`);
  until(g, () => g.phase === 'ready');
  check('ストライクが1つ増える', g.strikes === 1 && g.balls === 0);
  until(g, () => g.phase === 'call', pitchAt(0.6, 1.5));
  check('見送り：大きく外れるとボール', g.lastCall === 'ball', `${g.lastCall}`);
}
// ---- 3ストライクで三振、4ボールでフォアボール（押し出しで点）
{
  const g = new Baseball(setup());
  for (let i = 0; i < 3; i++) {
    until(g, () => g.phase === 'call', pitchAt(0, 0.8));
    until(g, () => g.phase !== 'call');
  }
  check('3ストライクで三振（アウトが1つ）', g.lastResult === 'strikeout' && g.outs === 1, `${g.lastResult}`);
  until(g, () => g.phase === 'ready' && g.pa === 1);
  check('三振のあと、次の打席（2打席目）へ', g.pa === 1 && g.strikes === 0 && g.balls === 0);
  for (let i = 0; i < 4; i++) {
    until(g, () => g.phase === 'call', pitchAt(0.6, 1.5));
    until(g, () => g.phase !== 'call');
  }
  check('4ボールでフォアボール（1塁へ）', g.lastResult === 'walk' && g.bases[0]);
}
// ---- 1イニング3打席で攻守交代（アウトの数では交代しない）
{
  const g = new Baseball(setup(2));
  const firstBatTeam = g.half;
  for (let pa = 0; pa < 3; pa++) {
    for (let i = 0; i < 3; i++) {
      until(g, () => g.phase === 'call', pitchAt(0, 0.8));
      until(g, () => g.phase !== 'call');
    }
    until(g, () => g.phase === 'ready' || g.phase === 'change');
  }
  check('3打席で攻守交代（表 → 裏）', g.phase === 'change' && g.half === 1 - firstBatTeam && g.pa === 0 && g.outs === 0, `${g.phase} half=${g.half}`);
  check('交代すると塁は空になる', !g.bases.some(Boolean));
}
// ---- 打つ：ミートの丸を球に合わせて、ちょうどのタイミングで振ると前に飛ぶ
{
  let hits = 0;
  let tries = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Baseball(setup(1, seed));
    until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
    const info = g.pitchInfo();
    g.cursor.x = info.x;
    g.cursor.y = info.y;
    until(g, () => g.phase !== 'pitch', (gg) => {
      const left = gg.pitchInfo().left;
      return new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: left === BB.swingDelay ? BTN_A : 0 }]]);
    });
    tries++;
    if (g.phase === 'hit') hits++;
  }
  check('ちょうど合わせて振れば、ほぼ必ず前に飛ぶ', hits >= tries - 1, `${hits}/${tries}`);
}
// ---- 空振り：タイミングが大きくずれる
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
  const info = g.pitchInfo();
  g.cursor.x = info.x;
  g.cursor.y = info.y;
  until(g, () => g.phase !== 'pitch', (gg) => new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: gg.pitchT === 2 ? BTN_A : 0 }]]));
  check('早すぎる振りは空振り', g.lastCall === 'whiff', `${g.lastCall}`);
}
// ---- 点：ホームランで塁の人もかえる。ヒットで2塁の人がかえる
{
  const g = new Baseball(setup());
  g.bases = [true, true, false];
  (g as unknown as { finishAtBat(r: string): void }).finishAtBat('homer');
  check('2人が塁にいてホームランなら3点', g.score[g.half] === 3 && !g.bases.some(Boolean), `${g.score}`);
  const h = new Baseball(setup());
  h.bases = [false, true, false];
  (h as unknown as { finishAtBat(r: string): void }).finishAtBat('single');
  check('ヒットで2塁の人がかえる（1点、打った人は1塁）', h.score[h.half] === 1 && h.bases.join() === 'true,false,false');
}
// ---- CPUどうしで最後まで遊べる・同じ種なら同じ結果
{
  const run = (seed: number) => {
    const s = setup(2, seed);
    s.players.forEach((p) => (p.cpu = true));
    const g = new Baseball(s);
    const cpu = new BBCpu(seed);
    until(g, () => g.finished, (gg) => new Map(gg.setup.players.map((p) => [p.slot, cpu.think(gg, p.slot)])), 60 * 60 * 10);
    return g;
  };
  const a = run(7);
  const b = run(7);
  check('CPUどうしで試合が終わる（2イニング）', a.finished && a.lines[0].length === 2, `${a.score.join('-')} ${Math.round(a.frame / 60)}秒`);
  check('同じ種なら同じ結果（オンラインに使える）', a.score.join() === b.score.join() && a.frame === b.frame && a.log.length === b.log.length);
}
// ---- サヨナラ：最終回の裏、後攻が勝ち越したら終わり
{
  const g = new Baseball(setup(1));
  g.half = 1;
  g.score = [2, 2];
  g.bases = [false, false, false];
  (g as unknown as { finishAtBat(r: string): void }).finishAtBat('homer');
  until(g, () => g.phase !== 'result');
  check('最終回の裏に勝ち越したら、サヨナラで終わる', g.finished && g.winner === 1);
}
void N;

process.exit(fail ? 1 : 0);
