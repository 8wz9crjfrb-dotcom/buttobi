// 各キャラの必殺技が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { BTN_A, BTN_B, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(a: string, b: string, stage = 'plain'): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: stage, rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 1 });
  const idle = new Map<number, InputState>();
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(idle);
  return sim;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function run(sim: Sim, frames: number, p0: (i: number) => InputState = () => N, p1: (i: number) => InputState = () => N) {
  for (let i = 0; i < frames; i++) sim.step(new Map([[0, p0(i)], [1, p1(i)]]));
}
const tap = (inp: InputState) => (i: number) => (i === 0 ? inp : N);

// 全キャラ × 全必殺技を地上・空中で出しても異常値が出ない
for (const c of ['guard', 'hacker', 'thief', 'streamer']) {
  for (const [mx, my] of [[0, 0], [1, 0], [0, -1], [0, 1]]) {
    const sim = make(c, 'guard');
    sim.fighters[0].x = -3; sim.fighters[1].x = 4;
    run(sim, 90, tap({ mx, my, buttons: BTN_B }));
    const f = sim.fighters[0];
    if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) check(`${c} の必殺技 (${mx},${my}) で異常値`, false);
  }
}
check('全キャラ×全必殺技で異常値なし', true);

// ハッカー：DDoS で弾が3発出る
{
  const sim = make('hacker', 'guard');
  let shots = 0;
  for (let i = 0; i < 40; i++) { sim.step(new Map([[0, i === 0 ? { mx: 0, my: 0, buttons: BTN_B } : N]])); shots += sim.events.filter(e => e.k === 'shot').length; }
  check('DDoS で弾が3発', shots === 3, `${shots}発`);
}
// ハッカー：全体メール誤送信で3方向
{
  const sim = make('hacker', 'guard');
  run(sim, 20, tap({ mx: 1, my: 0, buttons: BTN_B }));
  const vys = sim.projectiles.map(p => p.vy.toFixed(1));
  check('メール誤送信で3方向に飛ぶ', sim.projectiles.length === 3 && new Set(vys).size === 3, vys.join(','));
}
// ハッカー：キャッシュ（罠）に相手が触れると爆発
{
  const sim = make('hacker', 'guard');
  sim.fighters[0].x = -4; sim.fighters[0].facing = 1; sim.fighters[1].x = 2;
  run(sim, 20, tap({ mx: 0, my: -1, buttons: BTN_B }));
  const trap = sim.entities.find(e => e.kind === 'trap');
  check('キャッシュで罠が置かれる', !!trap);
  sim.fighters[1].x = trap!.x + 0.3;
  let boom = false;
  for (let i = 0; i < 40 && !boom; i++) { sim.step(new Map()); boom = sim.events.some(e => e.k === 'boom'); }
  check('罠に触れると爆発してふっとぶ', boom && sim.fighters[1].damage > 5, `ダメージ${sim.fighters[1].damage.toFixed(1)}%`);
}
// ハッカー：ポップアップ広告の窓に着地できる
{
  const sim = make('hacker', 'guard');
  sim.fighters[0].x = 0; sim.fighters[0].y = 4; sim.fighters[0].grounded = false; sim.fighters[0].state = 'air';
  run(sim, 90, tap({ mx: 0, my: 1, buttons: BTN_B }));
  const f = sim.fighters[0];
  const popup = sim.entities.find(e => e.kind === 'popup');
  check('ポップアップ広告の窓に着地', !!popup && f.grounded && Math.abs(f.y - popup!.y) < 0.01, `y=${f.y.toFixed(2)} 窓y=${popup?.y.toFixed(2)}`);
}
// 警備員：物理ファイアウォールが相手の飛び道具を消す
{
  const sim = make('guard', 'hacker');
  sim.fighters[0].x = -2; sim.fighters[0].facing = 1; sim.fighters[1].x = 5; sim.fighters[1].facing = -1;
  run(sim, 12, tap({ mx: 1, my: 0, buttons: BTN_B }));
  check('物理ファイアウォールで壁が出る', sim.entities.some(e => e.kind === 'wall'));
  run(sim, 40, () => N, tap({ mx: 0, my: 0, buttons: BTN_B }));
  check('壁が飛び道具を消す（警備員はノーダメージ）', sim.fighters[0].damage === 0, `ダメージ${sim.fighters[0].damage}`);
}
// 警備員：クレーム対応で攻撃を返す
{
  const sim = make('guard', 'streamer');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 1.2; sim.fighters[1].facing = -1;
  let countered = false;
  for (let i = 0; i < 60; i++) {
    sim.step(new Map([[0, i === 0 ? { mx: 0, my: -1, buttons: BTN_B } : N], [1, i === 6 ? { mx: 0, my: 0, buttons: BTN_A } : N]]));
    countered ||= sim.events.some(e => e.k === 'counter');
  }
  check('クレーム対応でカウンター', countered && sim.fighters[0].damage === 0 && sim.fighters[1].damage >= 8, `警備員${sim.fighters[0].damage}% 配信者${sim.fighters[1].damage.toFixed(1)}%`);
}
// データ泥棒：マルウェアで毒
{
  const sim = make('thief', 'guard');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = 2.5;
  run(sim, 30, tap({ mx: 0, my: 0, buttons: BTN_B }));
  const d1 = sim.fighters[1].damage;
  const poisoned = sim.fighters[1].poison > 0;
  run(sim, 200);
  check('マルウェアで毒になり、じわじわ増える', poisoned && sim.fighters[1].damage >= d1 + 5, `${d1.toFixed(1)}% → ${sim.fighters[1].damage.toFixed(1)}%`);
}
// データ泥棒：オフライン表示中は攻撃が当たらない
{
  const sim = make('thief', 'guard');
  sim.fighters[0].x = 0; sim.fighters[1].x = 1.0; sim.fighters[1].facing = -1;
  run(sim, 30, tap({ mx: 0, my: -1, buttons: BTN_B }), (i) => (i === 6 ? { mx: 0, my: 0, buttons: BTN_A } : N));
  check('オフライン表示中は当たらない', sim.fighters[0].damage === 0, `${sim.fighters[0].damage}%`);
}
// 配信者：強制アップデートで相手が眠る
{
  const sim = make('streamer', 'guard');
  sim.fighters[0].x = 0; sim.fighters[1].x = 1.0;
  let slept = false;
  for (let i = 0; i < 30; i++) { sim.step(new Map([[0, i === 0 ? { mx: 0, my: -1, buttons: BTN_B } : N]])); slept ||= sim.fighters[1].state === 'sleep'; }
  check('強制アップデートで眠る', slept);
}
// 配信者：切り抜きで瞬間移動
{
  const sim = make('streamer', 'guard');
  sim.fighters[0].x = -4; sim.fighters[0].facing = 1; sim.fighters[1].x = 6;
  run(sim, 13, tap({ mx: 1, my: 0, buttons: BTN_B }));
  check('切り抜きで約3m瞬間移動', sim.fighters[0].x > -1.5, `x=${sim.fighters[0].x.toFixed(2)}`);
}
// 配信者：投げ銭が山なりに飛ぶ
{
  const sim = make('streamer', 'guard');
  sim.fighters[1].x = 8;
  run(sim, 11, tap({ mx: 0, my: 0, buttons: BTN_B }));
  const y0 = sim.projectiles[0]?.y ?? 0;
  run(sim, 15);
  const y1 = sim.projectiles[0]?.y ?? 0;
  run(sim, 25);
  const y2 = sim.projectiles[0]?.y ?? -99;
  check('投げ銭が上がってから落ちる', y1 > y0 && y2 < y1, `${y0.toFixed(2)} → ${y1.toFixed(2)} → ${y2.toFixed(2)}`);
}
// 警備員：非常口ダッシュは斜め上に進む
{
  const sim = make('guard', 'hacker');
  sim.fighters[0].x = 0; sim.fighters[0].facing = 1; sim.fighters[1].x = -6;
  run(sim, 25, tap({ mx: 0.5, my: 1, buttons: BTN_B }));
  check('非常口ダッシュで斜め上へ', sim.fighters[0].x > 1.5 && sim.fighters[0].y > 1.5, `x=${sim.fighters[0].x.toFixed(2)} y=${sim.fighters[0].y.toFixed(2)}`);
}
process.exit(fail ? 1 : 0);
