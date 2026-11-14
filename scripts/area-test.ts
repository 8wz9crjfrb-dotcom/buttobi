// エリアバトルが意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES, AREA } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { decodeState, encodeState } from '../src/shared/protocol';
import { type InputState, type MatchRules, type PlayerSetup } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(players: PlayerSetup[], rules: Partial<MatchRules> = {}, seed = 1, stageId = 'plain'): Sim {
  const sim = new Sim({ players, stageId, rules: { mode: 'area', stocks: 3, timeLimit: 120, area: 'move', ...rules }, seed });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const P = (slot: number, charId: string, team = 0, cpu = false): PlayerSetup => ({ slot, name: 'p' + slot, charId, cpu, cpuLevel: 5, team });
const run = (sim: Sim, frames: number) => {
  for (let i = 0; i < frames; i++) sim.step(new Map());
};
/** f をエリアのまん中（の床の上）に置く。dx でずらす */
const putIn = (sim: Sim, i: number, zone = 0, dx = 0) => {
  const z = sim.areaZones()[zone];
  const f = sim.fighters[i];
  f.x = (z.x1 + z.x2) / 2 + dx;
  f.y = z.y1;
  f.vx = 0;
  f.vy = 0;
};
const putOut = (sim: Sim, i: number) => {
  const f = sim.fighters[i];
  const z = sim.areaZones();
  // どのエリアからも離れた床の端
  const m = sim.stage.main;
  f.x = z.some((q) => q.x1 < m.x1 + 1) ? m.x2 - 0.5 : m.x1 + 0.5;
  if (z.some((q) => f.x >= q.x1 && f.x <= q.x2)) f.x = m.x2 - 0.3;
  f.y = m.top;
};
const gauge = (sim: Sim, key: number) => sim.areaGauge.get(key) ?? 0;

// ---- ゲージの進み方
{
  const sim = make([P(0, 'guard'), P(1, 'hacker')]);
  putIn(sim, 0);
  putOut(sim, 1);
  run(sim, 60);
  check('1人でエリアに立つと、1秒で60進む', Math.abs(gauge(sim, 0) - 60) < 1.5, `${gauge(sim, 0).toFixed(1)}`);
  check('エリアの外の人のゲージは進まない', gauge(sim, 1) === 0);
  putIn(sim, 1, 0, 0.5);
  const before = gauge(sim, 0);
  run(sim, 60);
  check('敵が1人でも入ると、どちらのゲージも止まる（取り合い中）', gauge(sim, 0) === before && gauge(sim, 1) === 0 && sim.areaHolders()[0] === -2);
}
{
  // 味方の人数で速さが上がる（チーム戦）
  const team = (n: number) => {
    const ps = [P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 0), P(3, 'ai', 1)];
    const sim = make(ps, { teams: true });
    for (let i = 0; i < 3; i++) (i < n ? putIn(sim, i, 0, (i - 1) * 0.6) : putOut(sim, i));
    putOut(sim, 3);
    run(sim, 60);
    return gauge(sim, 0);
  };
  const g1 = team(1);
  const g2 = team(2);
  const g3 = team(3);
  check('味方2人なら1.2倍、3人なら1.4倍', Math.abs(g2 / g1 - 1.2) < 0.02 && Math.abs(g3 / g1 - 1.4) < 0.02, `${g1.toFixed(0)} / ${g2.toFixed(0)} / ${g3.toFixed(0)}`);
}

// ---- 動かない2つのエリア
{
  const sim = make([P(0, 'guard', 0), P(1, 'hacker', 0), P(2, 'thief', 1)], { teams: true, area: 'fix2' });
  check('動かない2つ：エリアが2つある', sim.areaZones().length === 2);
  const z0 = { ...sim.areaZones()[0] };
  putIn(sim, 0, 0);
  putIn(sim, 1, 1);
  putOut(sim, 2);
  run(sim, 60);
  check('動かない2つ：2つのエリアに分かれて立っても、味方2人として1.2倍', Math.abs(gauge(sim, 0) - 72) < 2, `${gauge(sim, 0).toFixed(1)}`);
  putIn(sim, 2, 1, 0.4);
  const before = gauge(sim, 0);
  run(sim, 60);
  check('動かない2つ：片方に敵が入ると、もう片方の味方の分だけ進む', Math.abs(gauge(sim, 0) - before - 60) < 2, `+${(gauge(sim, 0) - before).toFixed(1)}`);
  run(sim, AREA.moveEvery + 60);
  check('動かない2つ：時間がたってもエリアは動かない', sim.areaZones()[0].x1 === z0.x1 && sim.areaZones()[0].x2 === z0.x2);
}

// ---- 移動するエリア
{
  const sim = make([P(0, 'guard'), P(1, 'hacker')], {}, 5, 'livebar');
  const first = { ...sim.areaZones()[0] };
  const m = sim.stage.main;
  check('移動する1つ：最初は床の中央', Math.abs((first.x1 + first.x2) / 2 - (m.x1 + m.x2) / 2) < 0.01 && first.y1 === m.top);
  run(sim, AREA.moveEvery - AREA.warn - 10);
  check('移動する1つ：予告の前は、次の場所は出ない', sim.areaNext().zones.length === 0);
  run(sim, 20);
  const nx = sim.areaNext();
  check('移動する1つ：移る3秒前から、次の場所を予告する', nx.zones.length === 1 && nx.nextIn <= AREA.warn);
  run(sim, nx.nextIn + 1);
  const second = sim.areaZones()[0];
  check('移動する1つ：20秒で別の場所へ移る（予告どおり）', (second.x1 !== first.x1 || second.y1 !== first.y1) && second.x1 === nx.zones[0].x1 && second.y1 === nx.zones[0].y1);
  // 何回移っても、同じ場所が続かない
  let same = 0;
  let prev = sim.areaZones()[0];
  for (let k = 0; k < 8; k++) {
    run(sim, AREA.moveEvery);
    const cur = sim.areaZones()[0];
    if (cur.x1 === prev.x1 && cur.y1 === prev.y1) same++;
    prev = cur;
  }
  check('移動する1つ：同じ場所が続かない', same === 0);
  // 同じ種なら同じ順番（オンラインで全員そろう）
  const a = make([P(0, 'guard'), P(1, 'hacker')], {}, 9, 'livebar');
  const b = make([P(0, 'guard'), P(1, 'hacker')], {}, 9, 'livebar');
  run(a, AREA.moveEvery * 3);
  run(b, AREA.moveEvery * 3);
  check('移動する1つ：同じ試合なら同じ場所に移る', JSON.stringify(a.areaZones()) === JSON.stringify(b.areaZones()));
}
{
  // おまかせ：種によって、移動する1つと動かない2つの両方が出る
  const shapes = new Set<string>();
  for (let seed = 1; seed < 20; seed++) shapes.add(make([P(0, 'guard'), P(1, 'hacker')], { area: 'random' }, seed).areaShape);
  check('おまかせ：試合によって、移動する1つと動かない2つのどちらにもなる', shapes.has('move') && shapes.has('fix2'));
}

// ---- 勝ち負け
{
  const sim = make([P(0, 'guard'), P(1, 'hacker')]);
  sim.areaGauge.set(0, AREA.goal - 30);
  putIn(sim, 0);
  putOut(sim, 1);
  run(sim, 40);
  const r = sim.results();
  check('ゲージが満タンになったら試合が終わり、その人が1位', sim.ended && r[0].slot === 0 && r[0].area === 100, JSON.stringify(r.map((x) => [x.slot, x.rank, x.area])));
}
{
  const sim = make([P(0, 'guard'), P(1, 'hacker'), P(2, 'thief')], { timeLimit: 60 });
  sim.areaGauge.set(1, 1000);
  sim.areaGauge.set(2, 400);
  putOut(sim, 0);
  putOut(sim, 1);
  putOut(sim, 2);
  run(sim, 60 * 60 + 5);
  const r = sim.results();
  check('時間切れなら、ゲージの多い順', sim.ended && r.map((x) => x.slot).join() === '1,2,0', r.map((x) => `${x.slot}:${x.area}%`).join(' '));
}
{
  // ふっとばされても残機は減らず、復活する
  const sim = make([P(0, 'guard'), P(1, 'hacker')]);
  const f = sim.fighters[1];
  f.x = sim.stage.blast.right + 2;
  f.y = 3;
  run(sim, 400);
  check('場外に出ても負けにならず、復活する', !sim.ended && !f.out && f.falls === 1 && f.alive);
}

// ---- 通信：エリアの状態が送れる
{
  const sim = make([P(0, 'guard', 0), P(1, 'hacker', 1)], { teams: true, area: 'fix2' });
  putIn(sim, 0, 0);
  run(sim, 30);
  const v = sim.toView();
  const back = decodeState(JSON.parse(JSON.stringify(encodeState(v, v.events))));
  check(
    '通信：エリア・持ち主・ゲージが送り先で同じになる',
    !!back.area && back.area.zones.length === 2 && back.area.zones[0].holder === 0 && back.area.gauges.find((g) => g[0] === 0)?.[1] === v.area!.gauges.find((g) => g[0] === 0)?.[1] && Math.abs(back.area.zones[1].x2 - v.area!.zones[1].x2) < 0.01,
  );
  const stock = new Sim({ players: [P(0, 'guard'), P(1, 'hacker')], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  check('通信：ほかのモードではエリアの情報を送らない', !('a' in encodeState(stock.toView(), [])));
}

// ---- CPU：エリアへ向かい、ゲージを溜める
{
  const ps = [P(0, 'guard', 0, true), P(1, 'trainer', 1, true)];
  let wins = 0;
  let total = 0;
  for (const stage of ['plain', 'livebar', 'vault']) {
    const sim = make(ps, { timeLimit: 120 }, 3, stage);
    const ai = new CpuController(11);
    let inside = 0;
    let frames = 0;
    while (!sim.finished && frames < 130 * 60) {
      const inputs = new Map<number, InputState>();
      for (const f of sim.fighters) inputs.set(f.slot, ai.think(sim, f, 5));
      sim.step(inputs);
      frames++;
      if (sim.fighters.some((f) => sim.areaZones().some((z) => sim.inZone(f, z)))) inside++;
    }
    const g = [...sim.areaGauge.values()];
    total += g.reduce((a, b) => a + b, 0);
    if (sim.ended) wins++;
    check(`CPU（${stage}）：試合の多くの時間、だれかがエリアにいる`, inside / frames > 0.5, `${Math.round((inside / frames) * 100)}%  ゲージ ${g.map((v) => Math.round((v / AREA.goal) * 100) + '%').join(' / ')}`);
  }
  check('CPU：試合がきちんと終わる', wins === 3);
}
process.exit(fail ? 1 : 0);
