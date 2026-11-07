// 追加4体の必殺技と、8体の特性が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
function make(a: string, b: string, seed = 1): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: a, cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: b, cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed });
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
process.exit(fail ? 1 : 0);
