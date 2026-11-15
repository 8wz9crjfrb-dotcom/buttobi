// 技の最適化（2026年11月）で変えた動きが、意図どおりかを確かめる
import { Sim, COUNTDOWN_FRAMES, GYM_SLIP, ROULETTE, SIZE_REQ, VAULT_LASER, WARP } from '../src/shared/sim';
import { BIKE, CLOSE, DEFLECT, DRONE, GIMMICK, WALL } from '../src/shared/moves';
import { BTN_A, BTN_B, type GameEvent, type InputState } from '../src/shared/types';
import { CpuController } from '../src/shared/ai';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(a: string, b: string): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function run(sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) {
  for (let i = 0; i < frames; i++) sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
}

// ---- 配達員の自転車：弱い攻撃では降りない。耐久が尽きるか、強い攻撃で降りる
{
  const sim = make('courier', 'hacker');
  const c = sim.fighters[0];
  const h = sim.fighters[1];
  c.x = -6;
  h.x = 6;
  run(sim, 12, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : { mx: 1, my: 0, buttons: 0 }));
  check('横Bで自転車に乗る', c.bike > 0 && c.bikeHp === BIKE.hp, `耐久${c.bikeHp}`);
  // ハッカーの弾（1発2%ほど）を受けても降りない
  h.x = c.x + 5;
  h.facing = -1;
  let gotHit = false;
  for (let i = 0; i < 40 && c.bike > 0; i++) {
    const before = c.damage;
    run(sim, 1, () => ({ mx: -1, my: 0, buttons: 0 }), (k) => (i === 0 && k === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N));
    if (c.damage > before) gotHit = true;
    if (gotHit) break;
  }
  check('弱い攻撃を受けても自転車から降りない', gotHit && c.bike > 0 && c.state !== 'hitstun', `bike=${c.bike} 耐久${c.bikeHp.toFixed(1)} 状態=${c.state}`);
  // 耐久が尽きるまで弱い攻撃を受けると降りる
  const sim2 = make('courier', 'guard');
  const c2 = sim2.fighters[0];
  c2.x = -6;
  sim2.fighters[1].x = 6;
  run(sim2, 12, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : { mx: 1, my: 0, buttons: 0 }));
  c2.bikeHp = 1;
  // 弱攻撃を当てる
  const g = sim2.fighters[1];
  g.x = c2.x + 0.9;
  g.facing = -1;
  run(sim2, 12, () => N, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('自転車の耐久が尽きると降ろされる', c2.bike === 0, `bike=${c2.bike}`);
}

// ---- 警備員の壁：触れた相手をはじく（同じ壁からは1回だけ）
{
  const sim = make('guard', 'thief');
  const g = sim.fighters[0];
  const t = sim.fighters[1];
  g.x = 0;
  g.facing = 1;
  t.x = 3;
  run(sim, 10, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N));
  const d0 = t.damage;
  // 相手が壁に向かって歩いてくる
  let hits = 0;
  let last = t.damage;
  run(sim, 60, () => N, () => {
    if (t.damage > last + 0.01) hits++;
    last = t.damage;
    return { mx: -1, my: 0, buttons: 0 };
  });
  check('壁に触れた相手がダメージを受けてはじかれる', t.damage - d0 >= WALL.hit.dmg * 0.9, `+${(t.damage - d0).toFixed(1)}%`);
  check('同じ壁からは1回だけ', hits === 1, `${hits}回`);
}

// ---- AIエンジニアの学習：構え中に殴られたら、はじき返す
{
  const sim = make('ai', 'guard');
  const a = sim.fighters[0];
  const g = sim.fighters[1];
  a.x = 0;
  g.x = 1.0;
  g.facing = -1;
  run(sim, 6, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_B } : N));
  const dA = a.damage;
  const dG = g.damage;
  run(sim, 20, () => N, (i) => (i === 0 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('学習の構え中に殴られてもダメージを受けない', a.damage === dA, `${a.damage}`);
  check('殴ってきた相手をはじき返す', g.damage - dG >= DEFLECT.dmg * 0.9 && g.x > 1.0, `+${(g.damage - dG).toFixed(1)}% x=${g.x.toFixed(2)}`);
}

// ---- 配信者：眠っている相手は大きくふっとぶ
{
  const dist = (sleep: boolean) => {
    const sim = make('streamer', 'guard');
    const s = sim.fighters[0];
    const g = sim.fighters[1];
    s.x = 0;
    s.facing = 1;
    g.x = 1.0;
    g.damage = 80;
    if (sleep) {
      g.stun = 200;
      (sim as unknown as { setState(f: unknown, st: string): void }).setState(g, 'sleep');
    }
    run(sim, 14, (i) => (i === 0 ? { mx: 1, my: 0, buttons: BTN_A } : N));
    run(sim, 40);
    return g.x;
  };
  const awake = dist(false);
  const asleep = dist(true);
  check('眠っている相手は大きくふっとぶ', asleep > awake + 0.3, `起きている${awake.toFixed(2)}m / 眠り${asleep.toFixed(2)}m`);
}

// ---- ドパガキ：無限スクロールの3回目は大きくふっとばす
{
  const flight = (chain: number) => {
    const sim = make('dopa', 'guard');
    const d = sim.fighters[0];
    const g = sim.fighters[1];
    d.x = 0;
    d.facing = 1;
    g.x = 1.2;
    g.damage = 60;
    run(sim, 1, () => ({ mx: 1, my: 0, buttons: BTN_B }));
    d.chain = chain;
    run(sim, 50);
    return Math.hypot(g.x - 1.2, g.y);
  };
  const first = flight(0);
  const last = flight(2);
  check('無限スクロールの3回目は1回目より大きくふっとばす', last > first * 1.3, `1回目${first.toFixed(2)}m / 3回目${last.toFixed(2)}m`);
}
// ---- ギリギリ耐える：わずかに届くだけの一撃は、場外の線の手前で止まる。強い一撃はそのまま撃墜
{
  type Knock = (v: unknown, dir: number, dmg: number, base: number, growth: number, angle: number, kbMul: number, from: number) => void;
  /** 台の右はしに立つ相手を、横スマッシュ相当で右へ飛ばす（damage = 相手の%）。撃墜されたか・出た合図を返す */
  const launch = (damage: number) => {
    const sim = make('guard', 'thief');
    const v = sim.fighters[1];
    v.x = sim.stage.main.x2 - 0.5;
    v.damage = damage;
    (sim as unknown as { knock: Knock }).knock.call(sim, v, 1, 15, 7, 17, 40, 1, 0);
    const kinds: string[] = [];
    for (const e of sim.events) kinds.push(e.k);
    let ko = false;
    // 相手は強いCPUのように崖へ戻ろうとする（何もしないと下へ落ちてしまうため）
    const ai = new CpuController(1);
    for (let i = 0; i < 240 && !ko; i++) {
      sim.step(new Map([[1, ai.think(sim, v, 9)]]));
      for (const e of sim.events) {
        kinds.push(e.k);
        // ふっとびのまま右・上の場外の線を越えた撃墜だけを数える（戻りそこねて下へ落ちたのは別）
        if (e.k === 'ko' && (e.x >= sim.stage.blast.right - 1 || e.y >= sim.stage.blast.top - 1)) ko = true;
      }
    }
    return { ko, kinds };
  };
  // ギリギリ耐える仕組みを止めて、撃墜されはじめる%を探す
  const saved = CLOSE.minScale;
  (CLOSE as { minScale: number }).minScale = 1.01;
  let edge = -1;
  for (let d = 40; d <= 300 && edge < 0; d += 2) if (launch(d).ko) edge = d;
  (CLOSE as { minScale: number }).minScale = saved;
  const r = launch(edge);
  check('わずかに場外まで届く一撃では、ギリギリ耐える', edge > 0 && !r.ko && r.kinds.includes('close'), `仕組みなしなら${edge}%で撃墜 → ${r.ko ? '撃墜' : '耐えた'}`);
  check('耐えたら「セーフ」の合図が出る', r.kinds.includes('safe'));
  let strongKo = -1;
  for (let d = edge; d <= 400 && strongKo < 0; d += 5) if (launch(d).ko) strongKo = d;
  check('もっと強い一撃（高い%）なら撃墜される', strongKo > edge && strongKo - edge < 60, `${strongKo}%で撃墜（耐える幅 ${strongKo - edge}%）`);
}
// ---- 24時間ジム：清掃タイムは床がすべる（止まるまでに長くすべる）
{
  const slide = (cleaning: boolean) => {
    const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'guard', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: 'thief', cpu: false, cpuLevel: 1 }], stageId: 'gym', rules: { mode: 'stock', stocks: 3, timeLimit: 300, gimmicks: true }, seed: 1 });
    // 清掃タイムの最中（または清掃タイムの前）まで進める
    const target = COUNTDOWN_FRAMES + 300 + (cleaning ? GIMMICK.warn + 20 : -60);
    while (sim.frame < target) sim.step(new Map());
    const f = sim.fighters[0];
    f.x = -4;
    sim.fighters[1].x = 8;
    run(sim, 40, () => ({ mx: 1, my: 0, buttons: 0 }));
    const x0 = f.x;
    run(sim, 60);
    return { d: f.x - x0, slip: sim.slippery() };
  };
  const normal = slide(false);
  const wet = slide(true);
  check('清掃タイムの最中だけ床がすべる', wet.slip && !normal.slip);
  check('清掃タイムは止まるまでに長くすべる', wet.d > normal.d * 3 && wet.d > 1.5, `ふだん${normal.d.toFixed(2)}m / 清掃タイム${wet.d.toFixed(2)}m（${GYM_SLIP / 60}秒間）`);
}

// ---- AIエンジニアのエージェント起動：ドローンがいる間と、消えてから2秒は呼べない
{
  const sim = make('ai', 'guard');
  sim.fighters[1].x = 30;
  const down = { mx: 0, my: -1, buttons: BTN_B };
  run(sim, 30, (i) => (i === 0 ? down : N));
  const drones = () => sim.entities.filter((e) => e.kind === 'drone').length;
  check('下Bでドローンが出る', drones() === 1);
  const id0 = sim.entities.find((e) => e.kind === 'drone')!.id;
  run(sim, 60, (i) => (i % 10 === 0 ? down : N));
  check('ドローンがいる間は、呼び直せない', sim.entities.find((e) => e.kind === 'drone')?.id === id0);
  // ドローンが消えるまで待つ
  let gone = -1;
  for (let i = 0; i < DRONE.life + 60 && gone < 0; i++) {
    run(sim, 1);
    if (drones() === 0) gone = sim.frame;
  }
  run(sim, 60, (i) => (i % 10 === 0 ? down : N));
  check('消えてから1秒では、まだ呼べない', drones() === 0, `待ち時間の残り${sim.fighters[0].cdD}フレーム`);
  run(sim, 90, (i) => (i === 65 ? down : N));
  check('消えてから2秒たつと呼べる', drones() === 1);
}

// ---- 3Bのジョブチェンジ：続けて着替えられない（少し待ち時間）
{
  const sim = make('threeb', 'guard');
  sim.fighters[1].x = 30;
  const down = { mx: 0, my: -1, buttons: BTN_B };
  let changes = 0;
  let last = sim.fighters[0].job;
  for (let i = 0; i < 300; i++) {
    run(sim, 1, () => (i % 4 === 0 ? down : N));
    if (sim.fighters[0].job !== last) {
      changes++;
      last = sim.fighters[0].job;
    }
  }
  check('ジョブチェンジを連打しても、5秒で4回まで（待ち時間なしなら5回）', changes >= 3 && changes <= 4, `${changes}回`);
}

// ---- 配達員の配達バッグ投げ：前より遠くまで届く（約5m）
{
  const sim = make('courier', 'guard');
  const c = sim.fighters[0];
  c.x = -8;
  c.facing = 1;
  sim.fighters[1].x = 100;
  const x0 = c.x;
  let reach = 0;
  for (let i = 0; i < 120; i++) {
    run(sim, 1, () => (i === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N));
    for (const p of sim.projectiles) reach = Math.max(reach, p.x - x0);
  }
  check('配達バッグが約5m先まで届く', reach > 4.6, `${reach.toFixed(2)}m`);
}
// ---- ステージギミック（作り直したもの）
/** ギミックありの試合を、ギミックの予告の始まりの直前まで進める */
function gimmickSim(stageId: string, a = 'guard', b = 'thief'): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId, rules: { mode: 'stock', stocks: 3, timeLimit: 300, gimmicks: true }, seed: 3 });
  // 予告が出るステップ（経過フレームが COUNTDOWN_FRAMES + 300 になるステップ）の直前で止める
  while (sim.frame < COUNTDOWN_FRAMES + 299) sim.step(new Map());
  return sim;
}
// 電脳空間：ワープホール
{
  const sim = gimmickSim('cyber');
  const m = sim.stage.main;
  run(sim, GIMMICK.warn + 5);
  const f = sim.fighters[0];
  sim.fighters[1].x = 0;
  f.x = m.x2 - WARP.inset - 2.5;
  let warped = false;
  for (let i = 0; i < 90 && !warped; i++) {
    run(sim, 1, () => ({ mx: 1, my: 0, buttons: 0 }));
    if (f.x < 0) warped = true;
  }
  check('電脳空間：右のワープホールに入ると、左から出てくる', warped, `x=${f.x.toFixed(2)}`);
  run(sim, WARP.time);
  const x0 = f.x;
  f.x = m.x2 - WARP.inset;
  run(sim, 3);
  check('電脳空間：ワープホールが消えたあとは、くぐれない', f.x > 0, `x=${f.x.toFixed(2)}（前 ${x0.toFixed(2)}）`);
}
// ガチャ会場：当たり床ルーレット
{
  const sim = gimmickSim('gacha');
  const m = sim.stage.main;
  const tw = (m.x2 - m.x1) / ROULETTE.tiles;
  run(sim, ROULETTE.stopAt + 1);
  const tiles = sim.rouletteShown();
  check('ガチャ会場：ルーレットが止まると、当たりとハズレのマスが決まる', !!tiles && tiles.filter((x) => x > 0).length === ROULETTE.win && tiles.filter((x) => x < 0).length === ROULETTE.lose);
  const win = tiles!.indexOf(1);
  const lose = tiles!.indexOf(-1);
  const [a, b] = sim.fighters;
  a.x = m.x1 + tw * (win + 0.5);
  b.x = m.x1 + tw * (lose + 0.5);
  a.damage = 30;
  b.damage = 30;
  run(sim, GIMMICK.warn - ROULETTE.stopAt + 2);
  check('当たりのマスにいると回復する', a.damage < 30, `${a.damage}%`);
  check('ハズレのマスにいると小爆発で飛ばされる', b.damage > 30 && !b.grounded, `${b.damage.toFixed(1)}%`);
}
// 配信スタジオ：視聴者リクエスト（大きさが変わり、時間がたつと戻る）
{
  const sim = gimmickSim('studio');
  const f = sim.fighters[0];
  const h0 = f.h;
  run(sim, GIMMICK.warn + 2);
  const big = f.size === 1;
  check('配信スタジオ：全員の大きさが変わる', f.size !== 0 && sim.fighters[1].size === f.size && (big ? f.h > h0 * 1.3 : f.h < h0 * 0.7), `${big ? 'でっかく' : 'ちっちゃく'}：高さ ${h0.toFixed(2)} → ${f.h.toFixed(2)}`);
  const snap = f.serialize();
  const g = new Sim({ players: [{ slot: 0, name: 'a', charId: 'guard', cpu: false, cpuLevel: 1 }], stageId: 'studio', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 }).fighters[0];
  g.restore(snap);
  check('大きさは状態の書き出し・読み込みでも戻る（通信の照合）', g.h === f.h);
  run(sim, SIZE_REQ.time + 2);
  check('時間がたつと元の大きさに戻る', f.size === 0 && Math.abs(f.h - h0) < 1e-9);
}
// 深夜の金庫室：ばらばらの高さ・角度のレーザー
{
  const sim = gimmickSim('vault');
  const aims: GameEvent[] = [];
  for (let i = 0; i < 5; i++) {
    sim.step(new Map());
    aims.push(...sim.events.filter((e) => e.k === 'aim'));
  }
  run(sim, GIMMICK.warn + VAULT_LASER.gap * VAULT_LASER.count);
  const ys = new Set(aims.map((e) => (e.k === 'aim' ? e.y.toFixed(1) : '')));
  const angled = aims.some((e) => e.k === 'aim' && Math.abs(e.vy) > 1);
  check('金庫室：レーザーの通り道を先に見せる（3本）', aims.length === VAULT_LASER.count);
  check('金庫室：レーザーは高さと角度がばらばら', ys.size >= 2 && angled);
}
process.exit(fail ? 1 : 0);
