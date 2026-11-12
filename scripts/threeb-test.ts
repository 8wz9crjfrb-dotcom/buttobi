// 3B（美容師・バンドマン・バーテンダー）のジョブチェンジと必殺技が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { THREEB_RULES } from '../src/shared/moves';
import { BTN_B, fxJob, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(job = 0, b = 'guard'): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'threeb', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  // 指定の仕事まで着替えておく
  for (let j = 0; j < job; j++) {
    sim.fighters[1].x = 8;
    run(sim, 1, () => ({ mx: 0, my: -1, buttons: BTN_B }));
    run(sim, 80);
  }
  sim.fighters[0].jobBuff = 0;
  return sim;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function run(sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) {
  for (let i = 0; i < frames; i++) sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
}
const at = (k: number, inp: InputState) => (i: number) => (i === k ? inp : N);
const place = (sim: Sim, dx: number) => {
  sim.fighters[0].x = 0;
  sim.fighters[0].facing = 1;
  sim.fighters[1].x = dx;
  sim.fighters[1].facing = -1;
  sim.fighters[1].damage = 0;
};

// ---- ジョブチェンジ
{
  const sim = make(0);
  const f = sim.fighters[0];
  sim.fighters[1].x = 8;
  const run0 = f.def.runSpeed;
  run(sim, 30, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  check('下Bで美容師→バンドマンに着替える', f.job === 1 && fxJob(sim.toView().fighters[0].fx) === 1);
  check('バンドマンは足が遅く、攻撃力が高い', f.def.runSpeed < run0 && f.def.dmgMul > 1, `走る速さ ${run0} → ${f.def.runSpeed}`);
  check('早着替え：着替えた直後は攻撃力アップ', f.jobBuff > 0);
  run(sim, 5, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  run(sim, 30);
  check('続けてはすぐ着替えられない（待ち時間）', f.job === 1);
  run(sim, 60);
  run(sim, 30, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  run(sim, 60);
  run(sim, 30, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  check('バーテンダーの次は美容師に戻る', f.job === 0, `job=${f.job}`);
  // 状態の書き出し・読み込みで仕事と性能が戻る
  const snap = f.serialize();
  const g = new Sim(sim.setup).fighters[0];
  g.restore({ ...snap, job: 1 });
  check('通信の状態から読み込むと、仕事の性能に戻る', g.def.runSpeed < run0);
  // 着替えの一撃
  const hit = make(0);
  place(hit, 0.7);
  run(hit, 30, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  check('着替える瞬間に近くの相手へ軽い一撃', hit.fighters[1].damage > 0, `${hit.fighters[1].damage.toFixed(1)}%`);
  // 早着替えで威力が上がる
  const strong = make(2);
  place(strong, 1.0);
  strong.fighters[0].jobBuff = THREEB_RULES.buff;
  run(strong, 40, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  const weak = make(2);
  place(weak, 1.0);
  run(weak, 40, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  check('早着替え中は攻撃力1.2倍', Math.abs(strong.fighters[1].damage / weak.fighters[1].damage - THREEB_RULES.buffMul) < 0.02, `${strong.fighters[1].damage.toFixed(2)}% / ${weak.fighters[1].damage.toFixed(2)}%`);
}

// ---- 美容師
{
  const once = make(0);
  place(once, 0.9);
  let finish = false;
  for (let i = 0; i < 60; i++) {
    once.step(new Map([[0, i === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N]]));
    if (once.fighters[1].state === 'hitstun' && Math.abs(once.fighters[1].vx) > 4) finish = true;
  }
  const mash = make(0);
  place(mash, 0.9);
  run(mash, 130, (i) => (i < 80 && i % 6 === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N));
  check('シザーラッシュ：連続で当たり、最後にふっとばす', once.fighters[1].damage > 5 && finish, `${once.fighters[1].damage.toFixed(1)}%`);
  check('シザーラッシュ：Bを連打すると長く続いてダメージが増える', mash.fighters[1].damage > once.fighters[1].damage * 1.4, `連打 ${mash.fighters[1].damage.toFixed(1)}% / 1回 ${once.fighters[1].damage.toFixed(1)}%`);
  const blow = make(0);
  place(blow, 1.6);
  run(blow, 50, at(0, { mx: 1, my: 0, buttons: BTN_B }));
  check('ブローアップ：踏み込みながら連続ヒット', blow.fighters[1].damage > 4 && blow.fighters[0].x > 0.5, `${blow.fighters[1].damage.toFixed(1)}%`);
  const up = make(0);
  up.fighters[1].x = 8;
  const y0 = up.fighters[0].y;
  let top = y0;
  for (let i = 0; i < 40; i++) {
    up.step(new Map([[0, i === 0 ? { mx: 0, my: 1, buttons: BTN_B } : N]]));
    top = Math.max(top, up.fighters[0].y);
  }
  check('スプレーターン：上昇する（復帰に使える）', top - y0 > 3, `${(top - y0).toFixed(1)}m`);
}

// ---- バンドマン
{
  const tap = make(1);
  place(tap, 1.0);
  run(tap, 60, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  const hold = make(1);
  hold.fighters[0].x = 0;
  hold.fighters[0].facing = 1;
  hold.fighters[1].x = 6;
  run(hold, 70, () => ({ mx: 0, my: 0, buttons: BTN_B }));
  hold.fighters[1].x = 1.0;
  hold.fighters[1].damage = 0;
  run(hold, 40);
  check('爆音ソロ：押し続けると溜まって強くなる', hold.fighters[1].damage > tap.fighters[1].damage * 1.5, `溜め ${hold.fighters[1].damage.toFixed(1)}% / すぐ ${tap.fighters[1].damage.toFixed(1)}%`);
  const back = make(1);
  place(back, -1.0);
  run(back, 50, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  check('爆音ソロ：後ろの相手にも当たる（全方向）', back.fighters[1].damage > 0);
  const dive = make(1);
  place(dive, 3.0);
  let bounced = false;
  for (let i = 0; i < 50; i++) {
    dive.step(new Map([[0, i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N]]));
    if (dive.fighters[1].damage > 0 && dive.fighters[0].vy > 8) bounced = true;
  }
  check('ステージダイブ：飛び込んで当て、跳ね上がる', dive.fighters[1].damage > 5 && bounced, `${dive.fighters[1].damage.toFixed(1)}%`);
}

// ---- バーテンダー
{
  const sim = make(2);
  place(sim, 1.0);
  run(sim, 30, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  check('フレアボトル：当たった相手が酔う（左右の操作が逆）', sim.fighters[1].damage > 0 && sim.fighters[1].confused > 60, `残り${sim.fighters[1].confused}`);
  const sl = make(2);
  place(sl, 2.2);
  let stun = 0;
  for (let i = 0; i < 30; i++) {
    sl.step(new Map([[0, i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N]]));
    stun = Math.max(stun, sl.fighters[1].hitstun);
  }
  check('スライド：滑り込んで当て、長くひるませる', sl.fighters[1].damage > 0 && stun > 20, `ひるみ最大${stun}フレーム`);
}
process.exit(fail ? 1 : 0);
