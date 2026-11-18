// アイテム：カイロ（攻撃力アップ）・傘（ひるまない）・メガホン（衝撃波）と、乱入アイテム
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { ITEMS, FOOD } from '../src/shared/moves';
import { ITEM_INFO, ITEM_NAMES, ITEM_COLORS } from '../src/shared/characters';
import type { InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
function make(): Sim {
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'guard', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: 'thief', cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 0 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  return sim;
}
const use = (sim: Sim, f: number, kind: number) => (sim as unknown as { useItem(f: unknown, k: number): void }).useItem(sim.fighters[f], kind);

check('アイテムの種類は7つ（名前・説明・色がそろっている）', ITEMS.kinds === 7 && ITEM_NAMES.length === 7 && ITEM_INFO.length === 7 && ITEM_COLORS.length === 7);

// カイロ：攻撃力アップ（同じ攻撃のダメージが増える）
{
  const hitWith = (buff: boolean) => {
    const sim = make();
    const [a, b] = sim.fighters;
    a.x = 0; b.x = 0.9; a.facing = 1;
    if (buff) use(sim, 0, 4);
    sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
    for (let i = 0; i < 30; i++) sim.step(new Map([[0, N]]));
    return b.damage;
  };
  const plain = hitWith(false);
  const kairo = hitWith(true);
  check('カイロ：弱攻撃のダメージが上がる', kairo > plain && plain > 0, `${plain.toFixed(1)} → ${kairo.toFixed(1)}`);
  const sim = make();
  use(sim, 0, 4);
  check(`カイロ：効果は約${ITEMS.power / 60}秒`, sim.fighters[0].powerBuff === ITEMS.power);
}

// 傘：弱い攻撃ではひるまない
{
  const sim = make();
  const [a, b] = sim.fighters;
  a.x = 0; b.x = 0.9; a.facing = 1;
  use(sim, 1, 5);
  sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
  let stunned = false;
  for (let i = 0; i < 30; i++) {
    sim.step(new Map([[0, N]]));
    if (b.hitstun > 0 || b.tumble) stunned = true;
  }
  check('傘：弱攻撃を受けてもひるまない', !stunned && b.damage > 0, `ダメージ ${b.damage.toFixed(1)}`);
}

// メガホン：近くの相手だけ押し飛ばす
{
  const sim = make();
  const [a, b] = sim.fighters;
  a.x = 0; b.x = 2;
  use(sim, 0, 6);
  check('メガホン：近くの相手にダメージとふっとび', b.damage >= ITEMS.shoutDmg - 0.01 && b.vx > 0, `ダメージ ${b.damage.toFixed(1)} vx ${b.vx.toFixed(1)}`);
  check('メガホン：衝撃波の演出', sim.events.some((e) => e.k === 'shout'));
  const sim2 = make();
  sim2.fighters[0].x = -5; sim2.fighters[1].x = 5;
  use(sim2, 0, 6);
  check('メガホン：遠くの相手には届かない', sim2.fighters[1].damage === 0);
  check('メガホン：自分は無傷', sim.fighters[0].damage === 0);
}

// 乱入アイテム：決まった種類が落ちてきて、拾うと効く
{
  const sim = make();
  check('乱入アイテム：落とせる', sim.dropItem(6, 0));
  const it = sim.entities.find((e) => e.kind === 'item');
  check('乱入アイテム：選んだ種類', it?.dir === 6);
}

// アイテムの細かい設定：出る種類と頻度
{
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'guard', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: 'thief', cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'time', stocks: 3, timeLimit: 120, items: true, itemKinds: [4], itemRate: 'high' }, seed: 3 });
  const seen = new Set<number>();
  let first = -1;
  for (let i = 0; i < COUNTDOWN_FRAMES + 2000; i++) {
    sim.step(new Map());
    for (const e of sim.entities) if (e.kind === 'item') {
      seen.add(e.dir);
      if (first < 0) first = sim.frame - COUNTDOWN_FRAMES;
    }
  }
  check('出る種類：選んだもの（カイロ）だけ', seen.size === 1 && seen.has(4), [...seen].join(','));
  check(`頻度「多い」：${ITEMS.intervals.high}フレームで最初のアイテム`, first === ITEMS.intervals.high, `${first}`);
  check('選んでいないアイテムは乱入でも落とせない', !sim.dropItem(6, 0) && sim.dropItem(4, 0));
}

// サドンデス：時間切れで1位が同点なら延長戦。1人残ったら終わり、勝者は1人
for (const mode of ['time', 'stamina'] as const) {
  const sim = new Sim({ players: [0, 1, 2].map((i) => ({ slot: i, name: 'p' + i, charId: ['guard', 'thief', 'hacker'][i], cpu: false, cpuLevel: 1 })), stageId: 'plain', rules: { mode, stocks: 1, timeLimit: 60, hp: 100 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  // 3人目は先に1回落ちている（time：撃墜数で負け／stamina：ダメージが多い）
  const c = sim.fighters[2];
  if (mode === 'time') c.falls = 1;
  else c.damage = 50;
  let started = false;
  for (let i = 0; i < 60 * 60 + 10 && !sim.ended; i++) {
    sim.step(new Map());
    if (sim.events.some((e) => e.k === 'sudden')) started = true;
  }
  check(`${mode}：同点でサドンデスが始まる`, started && sim.sudden && !sim.ended);
  check(`${mode}：同点でない人は観戦`, c.out && !sim.fighters[0].out && !sim.fighters[1].out);
  check(`${mode}：ダメージ高めから`, mode === 'time' ? sim.fighters[0].damage === 100 : sim.fighters[0].damage === 70, `${sim.fighters[0].damage}`);
  // 1人を場外へ
  for (let i = 0; i < 200 && !sim.fighters[1].out; i++) {
    sim.fighters[1].x = 99;
    sim.step(new Map());
  }
  for (let i = 0; i < 400 && !sim.finished; i++) sim.step(new Map());
  const r = sim.results();
  check(`${mode}：1人残って終わり、1位は1人`, sim.finished && r.filter((e) => e.rank === 1).length === 1 && r[0].slot === 0, JSON.stringify(r.map((e) => [e.slot, e.rank])));
  check(`${mode}：観戦にまわった人は最下位`, r[r.length - 1].slot === 2);
}
// タイム制：点（撃墜−落下）が同じなら、ダメージが違ってもサドンデス
{
  const sim = new Sim({ players: [0, 1].map((i) => ({ slot: i, name: 'p' + i, charId: 'guard', cpu: false, cpuLevel: 1 })), stageId: 'plain', rules: { mode: 'time', stocks: 1, timeLimit: 60 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  sim.fighters[0].damage = 40;
  sim.fighters[1].damage = 75;
  for (let i = 0; i < 60 * 60 + 10; i++) sim.step(new Map());
  check('タイム制：点が同じならダメージが違ってもサドンデス', sim.sudden && !sim.ended);
}
// 同点でなければサドンデスにならない
{
  const sim = new Sim({ players: [0, 1].map((i) => ({ slot: i, name: 'p' + i, charId: 'guard', cpu: false, cpuLevel: 1 })), stageId: 'plain', rules: { mode: 'time', stocks: 1, timeLimit: 60 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  sim.fighters[1].falls = 1;
  for (let i = 0; i < 60 * 60 + 10; i++) sim.step(new Map());
  check('同点でなければそのまま終わる', sim.ended && !sim.sudden);
}

// ひるみ時間：飛び道具は半分、ジャンプ攻撃（空中攻撃）はそのまま
{
  const measure = (shot: boolean) => {
    const sim = make();
    const [a, b] = sim.fighters;
    b.damage = 60;
    const s2 = sim as unknown as { knock: (...x: unknown[]) => void };
    let before = 0;
    const k = s2.knock.bind(sim);
    s2.knock = (...x: unknown[]) => { k(...x); before = (x[0] as { hitstun: number }).hitstun; };
    let after = 0;
    if (shot) {
      // ハッカーの代わりに警備員の前に弾を置いて当てる：DDoS の弾と同じ値
      a.x = -3; b.x = 0; a.facing = 1;
      (sim as unknown as { projectiles: unknown[] }).projectiles.push({ x: -0.3, y: b.y + 0.8, vx: 16, vy: 0, gravity: 0, life: 10, owner: 0, kind: 'bullet', dmg: 2.8, base: 2.8, growth: 2.2, angle: 25, r: 0.25, hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [], pierce: false });
      for (let i = 0; i < 6 && !after; i++) { sim.step(new Map()); if ((b.state as string) === 'hitstun') after = b.hitstun + (b.hitlag > 0 ? 0 : 1); }
    } else {
      a.x = 0; b.x = 0.8; a.facing = 1;
      a.y = 3; a.grounded = false; a.groundRef = -1; a.state = 'air';
      b.y = 3; b.grounded = false; b.groundRef = -1; b.state = 'air';
      sim.step(new Map([[0, { mx: 0, my: 0, buttons: 1 }]]));
      for (let i = 0; i < 10 && !after; i++) { sim.step(new Map()); if ((b.state as string) === 'hitstun') after = b.hitstun + (b.hitlag > 0 ? 0 : 1); }
    }
    return { before, after };
  };
  const s = measure(true), a = measure(false);
  check('飛び道具のひるみは半分', s.before > 0 && s.after === Math.max(1, Math.round(s.before / 2)), `${s.before} → ${s.after}`);
  check('ジャンプ攻撃のひるみはそのまま', a.before > 0 && a.after === a.before, `${a.before} → ${a.after}`);
}

// 配達員：自転車に乗ったままジャンプ、ダメージ合計10%をこえると降りる、置き配は7%回復
{
  const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'courier', cpu: false, cpuLevel: 1 }, { slot: 1, name: 'b', charId: 'guard', cpu: false, cpuLevel: 1 }], stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 0 }, seed: 1 });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  const c = sim.fighters[0];
  sim.fighters[1].x = 8;
  c.x = -6;
  sim.step(new Map([[0, { mx: 1, my: 0, buttons: 2 }]]));
  for (let i = 0; i < 20; i++) sim.step(new Map([[0, { mx: 1, my: 0, buttons: 0 }]]));
  const onBike = c.bike > 0;
  sim.step(new Map([[0, { mx: 1, my: 0, buttons: 4 }]]));
  let stillAir = false;
  for (let i = 0; i < 10; i++) { sim.step(new Map([[0, { mx: 1, my: 0, buttons: 0 }]])); if (!c.grounded && c.bike > 0) stillAir = true; }
  check('自転車：乗ったままジャンプできる', onBike && stillAir);
  for (let i = 0; i < 60 && !c.grounded; i++) sim.step(new Map([[0, { mx: 1, my: 0, buttons: 0 }]]));
  check('自転車：着地しても乗ったまま', c.bike > 0);
  // 弱い攻撃を少しずつ受ける：合計10%まではそのまま、こえたら降りる
  const k = (sim as unknown as { knock(v: unknown, d: number, dmg: number, b: number, g: number, a: number, m: number, f: number): void }).knock.bind(sim);
  k(c, 1, 4, 1, 1, 30, 1, 1); k(c, 1, 4, 1, 1, 30, 1, 1);
  const after8 = c.bike > 0;
  k(c, 1, 4, 1, 1, 30, 1, 1);
  check('自転車：ダメージ合計10%をこえると降りる', after8 && c.bike === 0);
}
check('置き配の回復は7%', FOOD.heal === 7);

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
