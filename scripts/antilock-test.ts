// 連打のハメ技がないか：必殺技の待ち時間・ハメ防止・全キャラの連打チェック
import { Sim, COUNTDOWN_FRAMES, ANTILOCK } from '../src/shared/sim';
import { BTN_B, type InputState } from '../src/shared/types';
import { moveOf } from '../src/shared/moves';
import { scan } from './lock-scan';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function make(a: string, b = 'guard'): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const mash = (sim: Sim, frames: number, inp: InputState, every = 2) => {
  let starts = 0;
  for (let i = 0; i < frames; i++) {
    const before = sim.fighters[0].state === 'attack' ? sim.fighters[0].moveFrame : -1;
    sim.step(new Map([[0, i % every === 0 ? inp : N]]));
    const f = sim.fighters[0];
    if (f.state === 'attack' && (before < 0 || f.moveFrame < before)) starts++;
  }
  return starts;
};

// ---- 待ち時間
/** 待ち時間がなかったときに、5秒（300フレーム）で出せる回数 */
const noCd = (c: string) => {
  const m = moveOf(c, 'nspecial');
  return Math.floor(300 / (m.startup + m.active + m.end + 1));
};
for (const [c, name] of [['hacker', 'ハッカー'], ['ai', 'AIエンジニア']]) {
  const sim = make(c);
  sim.fighters[1].x = 9;
  const n = mash(sim, 300, { mx: 0, my: 0, buttons: BTN_B });
  const max = Math.ceil(300 / (moveOf(c, 'nspecial').startup + moveOf(c, 'nspecial').active + moveOf(c, 'nspecial').end + (moveOf(c, 'nspecial').cd ?? 0)));
  check(`${name}のB：連打しても、撃ったあとしばらくは撃てない`, n <= max && n < noCd(c), `5秒で${n}回（待ち時間なしなら${noCd(c)}回）`);
}
{
  const sim = make('thief');
  const f = sim.fighters[0];
  const v = sim.fighters[1];
  f.x = -2;
  v.x = 2;
  let swaps = 0;
  for (let i = 0; i < 600; i++) {
    const x0 = f.x;
    sim.step(new Map([[0, i % 4 === 0 ? { mx: 0, my: -1, buttons: BTN_B } : N]]));
    if (Math.abs(f.x - x0) > 1.5) swaps++;
  }
  check('データ泥棒の下B（入れ替え）：連打しても約4秒に1回しか入れ替わらない', swaps >= 2 && swaps <= 3, `10秒で${swaps}回`);
}

// ---- ハメ防止
{
  const sim = make('guard');
  const v = sim.fighters[1];
  // ひるみが短いすき間で何度も続く状況を作る
  let got = false;
  for (let i = 0; i < 400 && !got; i++) {
    if (v.state !== 'hitstun' && v.invuln === 0 && i % 14 === 0) {
      v.state = 'hitstun' as typeof v.state;
      v.hitstun = 10;
    }
    sim.step(new Map());
    if (v.invuln > 0 && v.state !== 'hitstun') got = true;
  }
  check('ハメ防止：短いすき間でひるみ続けると、抜け出すときに無敵になる', got && v.invuln > 0 && v.invuln <= ANTILOCK.invuln);
  const s2 = make('guard');
  const w = s2.fighters[1];
  w.state = 'hitstun' as typeof w.state;
  w.hitstun = 9999;
  let frames = 0;
  while (w.state === 'hitstun' && frames < 400) {
    s2.step(new Map());
    frames++;
  }
  check('ハメ防止：すき間なく動けないままでも、約3秒で抜け出せる', frames <= ANTILOCK.cut + 2, `${frames}フレーム`);
  const s3 = make('guard');
  const u = s3.fighters[1];
  // ふつうの攻防（ひるみのあと、十分動ける時間がある）では発動しない
  let fired = false;
  for (let i = 0; i < 600; i++) {
    if (i % 60 === 0) {
      u.state = 'hitstun' as typeof u.state;
      u.hitstun = 25;
    }
    s3.step(new Map());
    if (u.invuln > 0) fired = true;
  }
  check('ハメ防止：ふつうの攻防（ひるんだあと十分動ける）では発動しない', !fired);
}

// ---- 全キャラ：同じ技の連打で、相手が2秒以上抜け出せないことがない
{
  const MOVES = [
    { name: 'B', btn: BTN_B, dir: () => [0, 0] as [number, number] },
    { name: '横B', btn: BTN_B, dir: (a: { x: number }, v: { x: number }) => [Math.sign(v.x - a.x) || 1, 0] as [number, number] },
    { name: '下B', btn: BTN_B, dir: () => [0, -1] as [number, number] },
    { name: 'ドローン+B', btn: BTN_B, dir: () => [0, 0] as [number, number], setup: 'drone' as const },
  ];
  const bad: string[] = [];
  let worst = 0;
  for (const c of ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'])
    for (const job of c === 'threeb' ? [0, 1, 2] : [0])
      for (const mv of MOVES)
        for (const every of [2, 6, 13])
          for (const dist of [1, 2.5, 5]) {
            let best = Infinity;
            for (const victim of ['escape', 'shield', 'fight'] as const) {
              const r = scan(c, job, mv, every, victim, dist, 480);
              if (r) best = Math.min(best, r.worst);
            }
            if (best === Infinity) continue;
            worst = Math.max(worst, best);
            if (best >= 120) bad.push(`${c}${job ? job : ''} ${mv.name} ${every}f ${dist}m ${(best / 60).toFixed(1)}秒`);
          }
  check('全キャラ：同じ必殺技の連打で、相手が2秒以上抜け出せない組み合わせがない', bad.length === 0, bad.length ? bad.slice(0, 5).join(' / ') : `いちばん長くて${(worst / 60).toFixed(1)}秒`);
}
process.exit(fail ? 1 : 0);
