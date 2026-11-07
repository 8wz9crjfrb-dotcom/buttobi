// 追加4体の必殺技と、8体の特性が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { platformAt } from '../src/shared/stages';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(a: string, b: string, seed = 1, stageId = 'plain'): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId, rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
const B = (mx = 0, my = 0): InputState => ({ mx, my, buttons: BTN_B });
function run(sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) {
  for (let i = 0; i < frames; i++) sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
}
const at = (k: number, inp: InputState) => (i: number) => (i === k ? inp : N);

// ---- ドパガキ
{
  const sim = make('dopa', 'guard');
  sim.fighters[1].x = 8;
  run(sim, 10, at(0, B()));
  const f = sim.fighters[0];
  check('倍速再生で倍速になる', f.speedBuff > 0);
  const t0 = f.x;
  run(sim, 30, () => ({ mx: 1, my: 0, buttons: 0 }));
  const fast = f.x - t0;
  const sim2 = make('dopa', 'guard');
  sim2.fighters[1].x = 8;
  const u0 = sim2.fighters[0].x;
  run(sim2, 10);
  run(sim2, 30, () => ({ mx: 1, my: 0, buttons: 0 }));
  check('倍速中は移動が速い', fast > (sim2.fighters[0].x - u0) * 1.15, `${fast.toFixed(2)}m / 通常${(sim2.fighters[0].x - u0).toFixed(2)}m`);
  run(sim, 400);
  run(sim, 10, at(0, B()));
  check('倍速再生は続けて使えない（待ち時間）', f.speedBuff === 0, `残り待ち${f.speedCd}`);
}
{
  const sim = make('dopa', 'guard');
  sim.fighters[0].x = -6; sim.fighters[0].facing = 1; sim.fighters[1].x = 8;
  let starts = 0;
  for (let i = 0; i < 60; i++) {
    const inp = i === 0 || i === 10 || i === 20 || i === 30 ? B(1, 0) : N;
    const prevFrame = sim.fighters[0].moveFrame;
    sim.step(new Map([[0, inp]]));
    if (sim.fighters[0].move === 'sspecial' && sim.fighters[0].moveFrame < prevFrame) starts++;
  }
  check('無限スクロールは最大3回まで続く', sim.fighters[0].chain === 2 && sim.fighters[0].x > -6 + 4, `続けた回数${sim.fighters[0].chain} x=${sim.fighters[0].x.toFixed(1)}`);
}
{
  const sim = make('dopa', 'guard');
  sim.fighters[0].x = 0; sim.fighters[1].x = 3.5;
  run(sim, 30, at(0, B(0, -1)));
  check('通知爆撃で離れた相手を引き寄せる', sim.fighters[1].x < 2.5 && sim.fighters[1].damage > 0, `相手x 3.5 → ${sim.fighters[1].x.toFixed(2)}、${sim.fighters[1].damage.toFixed(1)}%`);
  const sim2 = make('dopa', 'guard');
  sim2.fighters[0].x = 0; sim2.fighters[1].x = 3.5;
  run(sim2, 30, at(0, B(0, -1)), () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
  check('ガードしていれば引き寄せられない', Math.abs(sim2.fighters[1].x - 3.5) < 0.3, `x=${sim2.fighters[1].x.toFixed(2)}`);
}
{
  const sim = make('dopa', 'guard');
  sim.fighters[0].x = 0; sim.fighters[1].x = -8;
  run(sim, 12, at(0, B(0, 1)));
  run(sim, 20, at(0, B(1, 0)));
  const f = sim.fighters[0];
  check('次の動画へは途中で横に方向転換できる', f.redirected && f.x > 2, `x=${f.x.toFixed(2)} y=${f.y.toFixed(2)}`);
}
{
  // 飽き性：同じ技を続けると威力が下がる
  const dmgs: number[] = [];
  const sim = make('dopa', 'guard');
  for (let k = 0; k < 3; k++) {
    sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[0].state = 'idle'; sim.fighters[0].move = null;
    const v = sim.fighters[1];
    v.x = 1.0; v.y = 0; v.vx = 0; v.vy = 0; v.state = 'idle'; v.grounded = true; v.damage = 0; v.invuln = 0;
    run(sim, 30, at(0, { mx: 0, my: 0, buttons: BTN_A }));
    dmgs.push(v.damage);
  }
  check('飽き性：同じ技を続けると威力が下がる', dmgs[0] > dmgs[1] && dmgs[1] > dmgs[2], dmgs.map((d) => d.toFixed(2)).join(' → '));
}
// ---- ガチャ廃人
{
  const seen = new Set<number>();
  let maxDry = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const sim = make('gacha', 'guard', seed);
    sim.fighters[1].x = 8;
    let dry = 0;
    for (let k = 0; k < 8; k++) {
      sim.fighters[0].state = 'idle'; sim.fighters[0].move = null; sim.fighters[0].stun = 0;
      for (let i = 0; i < 40; i++) {
        sim.step(new Map([[0, i === 0 ? B() : N]]));
        for (const e of sim.events) if (e.k === 'gacha') {
          seen.add(e.r);
          dry = e.r === 5 ? 0 : dry + 1;
          maxDry = Math.max(maxDry, dry);
        }
      }
    }
  }
  check('10連ガチャで6種類すべての結果が出る', seen.size === 6, [...seen].sort().join(','));
  check('天井：外れは最大5回まで（6回目は必ず大当たり）', maxDry <= 5, `最大連続外れ${maxDry}`);
}
{
  let crits = 0;
  let total = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const sim = make('gacha', 'guard', seed);
    sim.fighters[1].x = 8;
    run(sim, 30, at(0, B(1, 0)));
    total++;
    if (sim.fighters[0].crit) crits++;
  }
  check('単発ガチャの大当たりはおよそ5回に1回', crits >= total * 0.13 && crits <= total * 0.28, `${crits}/${total}`);
}
{
  const sim = make('gacha', 'guard');
  sim.fighters[1].x = 8;
  run(sim, 30, at(0, B(0, -1)));
  check('課金で自分のダメージ%が増え、攻撃力アップ', sim.fighters[0].damage >= 8 && sim.fighters[0].powerBuff > 0, `${sim.fighters[0].damage}%`);
}
{
  const sim = make('gacha', 'guard');
  sim.fighters[0].x = 0; sim.fighters[1].x = 8;
  let stones = 0;
  for (let i = 0; i < 30; i++) {
    sim.step(new Map([[0, i === 0 ? B(0, 1) : N]]));
    stones = Math.max(stones, sim.projectiles.filter((p) => p.kind === 'stone' && p.vy < 0).length);
  }
  check('無償石を配るで上から石が降る', stones >= 2, `${stones}個`);
}
// ---- 配達員
{
  const sim = make('courier', 'guard');
  sim.fighters[0].x = -6; sim.fighters[0].facing = 1; sim.fighters[1].x = 0; sim.fighters[1].facing = -1;
  run(sim, 12, at(0, B(1, 0)));
  check('自転車に乗れる', sim.fighters[0].bike > 0);
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) { sim.step(new Map()); hit = sim.fighters[1].damage > 0; }
  check('走る自転車にぶつかると相手がダメージ', hit, `${sim.fighters[1].damage.toFixed(1)}%`);
  run(sim, 12, () => ({ mx: 0, my: 0, buttons: BTN_JUMP }));
  check('ジャンプで自転車から降りる（ぶつかった直後に押しっぱなしでも）', sim.fighters[0].bike === 0 && !sim.fighters[0].grounded);
}
{
  const sim = make('courier', 'guard');
  sim.fighters[0].x = -4; sim.fighters[0].facing = 1; sim.fighters[1].x = 6;
  run(sim, 12, at(0, B()));
  let maxX = -99;
  let returned = false;
  for (let i = 0; i < 100; i++) {
    sim.step(new Map());
    const bag = sim.projectiles.find((p) => p.kind === 'bag');
    if (bag) maxX = Math.max(maxX, bag.x);
    if (!bag && maxX > -3) { returned = true; break; }
  }
  check('配達バッグが戻ってくる', returned && maxX > -1, `最も遠くでx=${maxX.toFixed(1)}`);
}
{
  const sim = make('courier', 'guard');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 5; sim.fighters[1].damage = 30;
  run(sim, 20, at(0, B(0, -1)));
  check('置き配で料理が置かれる', sim.entities.some((e) => e.kind === 'food'));
  const food = sim.entities.find((e) => e.kind === 'food')!;
  sim.fighters[1].x = food.x; sim.fighters[1].y = food.y;
  run(sim, 3);
  check('料理を拾うと回復（相手も拾える）', sim.fighters[1].damage <= 18.01, `${sim.fighters[1].damage}%`);
}
{
  const sim = make('courier', 'guard');
  sim.fighters[0].x = -8.5; sim.fighters[1].x = 8.5;
  const x0 = sim.fighters[0].x;
  run(sim, 60, () => ({ mx: 1, my: 0, buttons: 0 }));
  const v1 = sim.fighters[0].vx;
  check('時間指定：走り続けると速くなる', v1 > 10.4 * 1.1, `速さ${v1.toFixed(2)}（通常10.4）`);
}
// ---- AIエンジニア
{
  const sim = make('ai', 'guard');
  sim.fighters[0].x = -5; sim.fighters[0].facing = 1; sim.fighters[1].x = 2; sim.fighters[1].y = 4; sim.fighters[1].grounded = false; sim.fighters[1].state = 'air';
  run(sim, 16, at(0, B()));
  const orb = sim.projectiles.find((p) => p.kind === 'orb');
  run(sim, 90);
  check('推論の弾が相手を追いかけて当たる', !!orb && sim.fighters[1].damage > 0, `vy=${orb?.vy.toFixed(2)} 相手${sim.fighters[1].damage.toFixed(1)}%`);
}
{
  const sim = make('ai', 'hacker');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 4; sim.fighters[1].facing = -1;
  run(sim, 30, at(0, B(1, 0)), at(0, B()));
  check('学習で飛び道具を吸収してダメージを受けない', sim.fighters[0].damage === 0 && sim.fighters[0].absorbCharge, `${sim.fighters[0].damage}%`);
}
{
  const sim = make('ai', 'streamer');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 4;
  run(sim, 14, at(0, B(0, -1)));
  check('エージェント起動でドローンが出る', sim.entities.some((e) => e.kind === 'drone'));
  run(sim, 120);
  check('ドローンが近くの相手を自動で撃つ', sim.fighters[1].damage > 0, `相手${sim.fighters[1].damage.toFixed(1)}%`);
  const drone = sim.entities.find((e) => e.kind === 'drone')!;
  const v = sim.fighters[1];
  v.x = drone.x - 0.9; v.y = drone.y - 1.0; v.facing = 1; v.state = 'air'; v.grounded = false; v.hitstun = 0; v.invuln = 0;
  run(sim, 15, () => N, at(0, { mx: 0, my: 0, buttons: BTN_A }));
  check('ドローンは攻撃を当てると壊れる', !sim.entities.some((e) => e.kind === 'drone'));
}
{
  const sim = make('ai', 'guard');
  const f = sim.fighters[0];
  f.x = 13; f.y = -3; f.grounded = false; f.state = 'air'; f.facing = -1; f.jumpsLeft = 0; sim.fighters[1].x = -6;
  let grabbed = false;
  for (let i = 0; i < 40 && !grabbed; i++) { sim.step(new Map([[0, i === 0 ? B(-0.4, 1) : N]])); grabbed = (f.state as string) === 'ledge'; }
  check('API呼び出しで遠くの崖をつかむ', grabbed, `x=${f.x.toFixed(2)} y=${f.y.toFixed(2)} 状態=${f.state}`);
}
{
  // 学習データ：同じ相手から受けるダメージが減っていく
  const sim = make('ai', 'guard');
  const dm: number[] = [];
  for (let k = 0; k < 4; k++) {
    const v = sim.fighters[0];
    v.x = 1; v.y = 0; v.vx = 0; v.vy = 0; v.state = 'idle'; v.grounded = true; v.invuln = 0; v.move = null;
    const a = sim.fighters[1];
    a.x = 0; a.facing = 1; a.state = 'idle'; a.move = null;
    const before = v.damage;
    run(sim, 30, () => N, at(0, { mx: 0, my: 0, buttons: BTN_A }));
    dm.push(v.damage - before);
  }
  check('学習データ：同じ相手からのダメージが減る', dm[3] < dm[0], dm.map((d) => d.toFixed(2)).join(' → '));
}
// ---- 既存4体の特性
{
  const sim = make('guard', 'hacker');
  check('巡回中：警備員のガードは1.5倍', sim.fighters[0].shield === 75 && sim.fighters[1].shield === 50, `${sim.fighters[0].shield} / ${sim.fighters[1].shield}`);
}
{
  const shieldDrop = (attacker: string) => {
    const sim = make(attacker, 'streamer');
    sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 1.0;
    const v = sim.fighters[1];
    run(sim, 20, at(0, { mx: 0, my: 0, buttons: BTN_A }), () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
    return 50 - v.shield;
  };
  const h = shieldDrop('hacker');
  const g = shieldDrop('streamer');
  check('ゼロデイ：ハッカーはガードを大きく削る', h > g * 1.6, `ハッカー${h.toFixed(1)} / 配信者${g.toFixed(1)}`);
}
{
  const sim = make('thief', 'guard');
  sim.fighters[0].damage = 50; sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 1.0;
  run(sim, 25, at(0, { mx: 0, my: 0, buttons: BTN_A }));
  check('抜き取り：当てると自分のダメージ%が回復', sim.fighters[0].damage < 50, `50% → ${sim.fighters[0].damage.toFixed(2)}%`);
}
{
  const sim = make('streamer', 'guard');
  const v = sim.fighters[1];
  v.lastHitBy = 0; v.lastHitFrame = sim.frame; v.x = 25;
  run(sim, 2);
  check('バズり：撃墜すると配信者の段階が上がる', sim.fighters[0].buzz === 1, `段階${sim.fighters[0].buzz}`);
}
// ---- 上下に動く足場（ガチャ会場のリフト）
{
  const sim = make('guard', 'hacker', 1, 'gacha');
  const f = sim.fighters[0];
  sim.fighters[1].x = 12;
  // 左のエレベーターの真上から落とす
  f.x = -9.5; f.y = 9; f.vy = 0; f.grounded = false; f.groundRef = -1; f.state = 'air';
  let landed = false;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 400; i++) {
    run(sim, 1);
    if (f.grounded && f.groundRef === 0) {
      landed = true;
      minY = Math.min(minY, f.y);
      maxY = Math.max(maxY, f.y);
    }
  }
  check('上下に動く足場に乗ると、いっしょに上下する', landed && f.grounded && f.groundRef === 0 && maxY - minY > 4, `高さ ${minY.toFixed(2)}〜${maxY.toFixed(2)}`);
}
{
  // 上がってくる足場に、落ちてきた人が着地できる（すり抜けて落ちない）
  const sim = make('guard', 'hacker', 1, 'gacha');
  const f = sim.fighters[0];
  sim.fighters[1].x = 12;
  let ok = 0;
  let tries = 0;
  for (let start = 0; start < 300; start += 37) {
    const s2 = make('guard', 'hacker', 1, 'gacha');
    s2.fighters[1].x = 12;
    run(s2, start);
    const g = s2.fighters[0];
    g.x = -9.5; g.y = 7.5; g.vy = -2; g.grounded = false; g.groundRef = -1; g.state = 'air';
    for (let i = 0; i < 120 && !g.grounded; i++) run(s2, 1);
    tries++;
    if (g.grounded && g.groundRef === 0) ok++;
  }
  check('上下に動く足場には、どのタイミングで落ちても着地できる', ok === tries, `${ok}/${tries}`);
  void f;
}
{
  // 浮島の床：台の外まで出ていく床に乗ったままでも落ちない
  const sim = make('guard', 'hacker', 1, 'timeline');
  const f = sim.fighters[0];
  sim.fighters[1].x = 5;
  const pl = platformAt(sim.stage.platforms[0], sim.frame);
  f.x = (pl.x1 + pl.x2) / 2; f.y = pl.y + 0.5; f.vy = 0; f.grounded = false; f.groundRef = -1; f.state = 'air';
  let maxX = -Infinity;
  let fell = false;
  for (let i = 0; i < 600; i++) {
    run(sim, 1);
    if (f.groundRef === 0) maxX = Math.max(maxX, Math.abs(f.x));
    if (i > 60 && !f.grounded) fell = true;
  }
  check('横に大きく動く床は台の外まで運んでくれる', !fell && maxX > 7, `いちばん外 |x|=${maxX.toFixed(1)}（台の端は6.5）`);
}
// ---- 溜め攻撃（全キャラ共通：Aを押し続ける）
{
  const A: InputState = { mx: 0, my: 0, buttons: BTN_A };
  const tryHold = (frames: number) => {
    const sim = make('streamer', 'guard');
    sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 1.3;
    let charged = false;
    for (let i = 0; i < frames + 80; i++) {
      sim.step(new Map([[0, i < frames ? A : N]]));
      if (sim.fighters[0].move === 'charge') charged = true;
    }
    return { charged, dmg: sim.fighters[1].damage };
  };
  const tap = tryHold(1);
  check('Aを押してすぐ離すと、弱攻撃だけで溜め攻撃にはならない', !tap.charged, `${tap.dmg.toFixed(1)}%`);
  const short = tryHold(30);
  const long = tryHold(140);
  check('Aを押し続けると溜め攻撃が出る', short.charged && long.charged);
  check('長く溜めるほど威力が上がる', long.dmg > short.dmg * 1.3, `少し溜め${short.dmg.toFixed(1)}% / 最大溜め${long.dmg.toFixed(1)}%`);
}
// ---- つかみ・つかみ攻撃・投げ（全キャラ共通）
{
  const GRAB_IN: InputState = { mx: 0, my: 0, buttons: BTN_SHIELD | BTN_A };
  const setupGrab = () => {
    const sim = make('guard', 'hacker');
    sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 1.0; sim.fighters[1].damage = 30;
    run(sim, 1, () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
    run(sim, 14, at(0, GRAB_IN));
    return sim;
  };
  const sim = setupGrab();
  check('ガード＋Aで相手をつかむ', sim.fighters[0].state === 'grab' && sim.fighters[1].state === 'grabbed', `${sim.fighters[0].state} / ${sim.fighters[1].state}`);
  const d0 = sim.fighters[1].damage;
  run(sim, 30, at(8, { mx: 0, my: 0, buttons: BTN_A }));
  check('つかんでいる間にAでつかみ攻撃（まだつかんだまま）', sim.fighters[1].damage > d0 && sim.fighters[1].state === 'grabbed', `${d0}% → ${sim.fighters[1].damage.toFixed(1)}%`);
  run(sim, 3, () => ({ mx: -1, my: 0, buttons: 0 }));
  run(sim, 20);
  check('スティックを後ろに倒すと後ろへ投げる', sim.fighters[1].state === 'hitstun' && sim.fighters[1].x < -1 && sim.fighters[0].facing === -1, `相手x=${sim.fighters[1].x.toFixed(2)}`);

  const up = setupGrab();
  run(up, 8, () => ({ mx: 0, my: 1, buttons: 0 }));
  let vx = 0, vy = 0;
  for (let i = 0; i < 30; i++) {
    run(up, 1);
    if (up.fighters[1].vy > vy) { vy = up.fighters[1].vy; vx = up.fighters[1].vx; }
  }
  check('スティックを上に倒すと上へ投げる', vy > 5 && Math.abs(vx) < vy * 0.3, `vx=${vx.toFixed(1)} vy=${vy.toFixed(1)}`);

  const idle = setupGrab();
  let frames = 0;
  while (idle.fighters[1].state === 'grabbed' && frames < 400) { run(idle, 1); frames++; }
  const mash = setupGrab();
  let frames2 = 0;
  while (mash.fighters[1].state === 'grabbed' && frames2 < 400) { run(mash, 1, () => N, (i) => (frames2 % 2 === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N)); frames2++; }
  check('何もしなければ時間で抜け出せる', idle.fighters[1].state !== 'grabbed' && frames < 200, `${frames}フレーム`);
  check('ボタンを連打してもがくと早く抜けられる', frames2 < frames * 0.75, `連打${frames2}フレーム / 何もしない${frames}フレーム`);
}
{
  // つかまれている人が別の人に攻撃されると、つかみは解ける
  const sim = new Sim({ players: [0, 1, 2].map((i) => ({ slot: i, name: 'x', charId: ['guard', 'hacker', 'streamer'][i], cpu: false, cpuLevel: 1 })), stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  const [g, h, s3] = sim.fighters;
  g.x = 0; g.facing = 1; h.x = 1.0; s3.x = 2.4; s3.facing = -1;
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: BTN_SHIELD }]]));
  for (let i = 0; i < 14; i++) sim.step(new Map([[0, i === 0 ? { mx: 0, my: 0, buttons: BTN_SHIELD | BTN_A } : N]]));
  const grabbed = h.state === 'grabbed';
  for (let i = 0; i < 20; i++) sim.step(new Map([[2, i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N]]));
  check('つかまれている人が攻撃されると、つかみが解ける', grabbed && h.state !== 'grabbed' && g.grabbing === -1 && h.grabbedBy === -1, `${h.state}`);
}
process.exit(fail ? 1 : 0);
