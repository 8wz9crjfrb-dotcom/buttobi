// 連打のハメ技がないか：必殺技の待ち時間・ハメ防止・全キャラの連打チェック
import { Sim, COUNTDOWN_FRAMES, ANTILOCK } from '../src/shared/sim';
import { BTN_B, type InputState } from '../src/shared/types';
import { moveOf } from '../src/shared/moves';
import { cpuScan, MOVES as ALL_MOVES, scan } from './lock-scan';

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

// ---- 突撃する技・引き寄せる技には待ち時間がある
{
  const rush: [string, 'sspecial' | 'uspecial' | 'dspecial', number, number][] = [
    ['thief', 'sspecial', 0, 60], ['streamer', 'sspecial', 0, 60], ['dopa', 'sspecial', 0, 60], ['gacha', 'sspecial', 0, 60],
    ['courier', 'sspecial', 0, 60], ['trainer', 'sspecial', 0, 60], ['threeb', 'sspecial', 0, 60], ['threeb', 'sspecial', 1, 60],
    ['threeb', 'sspecial', 2, 60], ['guard', 'uspecial', 0, 40], ['dopa', 'dspecial', 0, 180], ['thief', 'dspecial', 0, 240],
  ];
  const short = rush.filter(([c, id, job, min]) => (moveOf(c, id, job).cd ?? 0) < min).map(([c, id, job]) => `${c}${job || ''} ${id}`);
  check('突撃する技・引き寄せる技・入れ替える技に待ち時間がある', short.length === 0, short.join(' / '));
  // 実際に連打しても続けて出ない（トレーナーのタックル）
  const sim = make('trainer');
  sim.fighters[1].x = 9;
  let starts = 0;
  let prev = '';
  for (let i = 0; i < 300; i++) {
    sim.step(new Map([[0, i % 3 === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N]]));
    const f = sim.fighters[0];
    const now = f.state === 'attack' ? String(f.move) : '';
    if (now === 'sspecial' && prev !== 'sspecial') starts++;
    prev = now;
    if (f.x > 6) f.x = -6;
  }
  check('トレーナーのタックル：連打しても続けて突撃できない', starts <= 3, `5秒で${starts}回`);
  // 自転車は、降りてから待ち時間を数える
  const bk = make('courier');
  bk.fighters[1].x = 9;
  const c = bk.fighters[0];
  for (let i = 0; i < 20; i++) bk.step(new Map([[0, i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N]]));
  const riding = c.bike > 0;
  for (let i = 0; i < 400 && c.bike > 0; i++) bk.step(new Map([[0, { mx: i % 60 < 30 ? 1 : -1, my: 0, buttons: 0 }]]));
  check('配達員の自転車：降りた直後は乗れない', riding && c.cdS > 30, `残り${c.cdS}フレーム`);
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
  check('ハメ防止：すき間なく動けないままでも、約2.5秒までに抜け出せる', frames <= ANTILOCK.cut + 2, `${frames}フレーム`);
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

// ---- 全キャラ：同じ技の連打・2〜3つの技の交互連打で、相手が2秒以上抜け出せないことがない
{
  // 弱だけの連打は対象外（弱は3段で止まり、相手は抜けられる。lock-scan で別に確認）
  const MOVES = ALL_MOVES;
  const bad: string[] = [];
  let worst = 0;
  for (const c of ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'])
    for (const job of c === 'threeb' ? [0, 1, 2] : [0])
      for (const mv of MOVES)
        for (const every of [2, 6, 13])
          for (const dist of [1, 2.5, 5]) {
            // 相手が逃げ・ガード・反撃のどれをとっても抜け出せること（いちばん長く動けなかった動きで数える）
            let best = -1;
            for (const victim of ['escape', 'shield', 'fight'] as const) {
              const r = scan(c, job, mv, every, victim, dist, 480);
              if (r) best = Math.max(best, r.worst);
            }
            if (best < 0) continue;
            worst = Math.max(worst, best);
            if (best >= 120) bad.push(`${c}${job ? job : ''} ${mv.name} ${every}f ${dist}m ${(best / 60).toFixed(1)}秒`);
          }
  check('全キャラ：必殺技の連打・交互連打で、相手が2秒以上抜け出せない組み合わせがない', bad.length === 0, bad.length ? bad.slice(0, 5).join(' / ') : `いちばん長くて${(worst / 60).toFixed(1)}秒`);
}
// ---- 全キャラ：本物のCPUを相手に、必殺技の連打・交互連打（例：ハッカーのB＋横B）で2秒以上動けなくならない
{
  const K: Record<string, [number, number]> = { B: [0, 0], 横B: [1, 0], 下B: [0, -1], 上B: [0, 1] };
  const combos = [['B'], ['横B'], ['下B'], ['B', '横B'], ['B', '下B'], ['横B', '下B'], ['横B', '上B'], ['B', '横B', '下B']];
  const bad: string[] = [];
  let worst = 0;
  for (const c of ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'])
    for (const combo of combos) {
      // 警備員の下B（クレーム対応）は構えるだけの技。CPUが自分から殴りかかって返されるのはハメではないので除く
      if (c === 'guard' && combo.includes('下B')) continue;
      for (const lv of [3, 9])
        for (const every of [6, 12, 20])
          for (const vid of ['guard', 'thief']) {
            const w = cpuScan(c, combo.map((k) => K[k]), every, lv, vid, 1);
            worst = Math.max(worst, w);
            if (w >= 120) bad.push(`${c} ${combo.join('＋')} ${every}f CPU${lv} ${vid} ${(w / 60).toFixed(1)}秒`);
          }
    }
  check('全キャラ：CPUを相手に必殺技を連打・交互連打しても、2秒以上動けなくならない', bad.length === 0, bad.length ? bad.slice(0, 5).join(' / ') : `いちばん長くて${(worst / 60).toFixed(1)}秒`);
}
process.exit(fail ? 1 : 0);
