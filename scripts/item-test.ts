// アイテム：カイロ（攻撃力アップ）・傘（ひるまない）・メガホン（衝撃波）と、乱入アイテム
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { ITEMS } from '../src/shared/moves';
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

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
