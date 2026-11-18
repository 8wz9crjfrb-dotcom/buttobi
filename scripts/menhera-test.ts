// メンヘラ（まだ公開していないキャラ）の必殺技と特性が意図どおりに動くかを確かめる
import { Sim, COUNTDOWN_FRAMES } from '../src/shared/sim';
import { CpuController } from '../src/shared/ai';
import { CHARACTERS, getCharacter } from '../src/shared/characters';
import { STAGES, getStage } from '../src/shared/stages';
import { MENHERA } from '../src/shared/moves';
import { BTN_B, BTN_SHIELD, type InputState } from '../src/shared/types';

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
const at = (k: number, inp: InputState) => (i: number) => (i === k ? inp : N);
const place = (sim: Sim, dx: number) => {
  sim.fighters[0].x = 0;
  sim.fighters[0].facing = 1;
  sim.fighters[1].x = dx;
  sim.fighters[1].facing = -1;
};
type Priv = { powerMul(a: unknown): { dmg: number; kb: number }; speedMul(a: unknown): number };

// ---- まだ公開しない
check('ふだんは選べない（キャラ・ステージ）', !CHARACTERS.some((c) => c.id === 'menhera') && !STAGES.some((s) => s.id === 'room'));
check('隠していても、キャラとステージの中身はある', getCharacter('menhera').id === 'menhera' && getStage('room').id === 'room');

// ---- 赤い糸：当たった相手は3.5mより遠くへ行けない
{
  const sim = make('menhera', 'guard');
  place(sim, 2.5);
  run(sim, 30, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  const v = sim.fighters[1];
  check('赤い糸：当たるとつながる', v.leashT > 0 && v.leashBy === 0, `残り${v.leashT}`);
  check('赤い糸：使ったあと約2.5秒は使えない', sim.fighters[0].cdN > 100, `残り${sim.fighters[0].cdN}`);
  // 相手が右へ走って逃げようとする
  let far = 0;
  run(sim, 90, () => N, () => ({ mx: 1, my: 0, buttons: 0 }));
  for (let i = 0; i < 30; i++) {
    run(sim, 1, () => N, () => ({ mx: 1, my: 0, buttons: 0 }));
    far = Math.max(far, Math.hypot(v.x - sim.fighters[0].x, v.y - sim.fighters[0].y));
  }
  check('赤い糸：つながっている間は、離れられない', far <= MENHERA.leashLen + 0.05, `最大${far.toFixed(2)}m`);
  run(sim, 200, () => N, () => ({ mx: 1, my: 0, buttons: 0 }));
  check('赤い糸：約4秒で切れて、離れられる', v.leashT === 0 && v.x - sim.fighters[0].x > MENHERA.leashLen + 0.5, `${(v.x - sim.fighters[0].x).toFixed(1)}m`);
}
{
  // 強くふっとばされたら糸は切れる（撃墜できなくならない）
  const sim = make('menhera', 'guard');
  place(sim, 2.5);
  run(sim, 30, at(0, { mx: 0, my: 0, buttons: BTN_B }));
  const v = sim.fighters[1];
  v.damage = 150;
  (sim as unknown as { knock(v: unknown, dir: number, dmg: number, base: number, growth: number, angle: number, kb: number, from: number): void }).knock(v, 1, 10, 10, 10, 40, 1, 0);
  run(sim, 2);
  check('赤い糸：強くふっとばされると切れる', v.leashT === 0 && v.tumble);
}

// ---- 鬼電：当てた相手に印。約2.5秒後に爆発
{
  const sim = make('menhera', 'guard');
  place(sim, 3.5);
  run(sim, 40, at(0, { mx: 1, my: 0, buttons: BTN_B }));
  const v = sim.fighters[1];
  check('鬼電：当たると「着信中」の印が付く', v.callT > 0 && v.callBy === 0, `残り${v.callT}`);
  const before = v.damage;
  run(sim, v.callT + 2);
  check('鬼電：時間がたつと爆発してダメージ', v.damage - before >= 8, `+${(v.damage - before).toFixed(1)}%`);
}
{
  const sim = make('menhera', 'guard');
  place(sim, 3.5);
  run(sim, 40, at(0, { mx: 1, my: 0, buttons: BTN_B }));
  const v = sim.fighters[1];
  const before = v.damage;
  run(sim, v.callT + 2, () => N, () => ({ mx: 0, my: 0, buttons: BTN_SHIELD }));
  check('鬼電：爆発はガードで防げる', v.damage === before, `+${(v.damage - before).toFixed(1)}%`);
}

// ---- 泣き落とし：近くの相手の攻撃力が下がる
{
  const sim = make('menhera', 'guard');
  place(sim, 1.5);
  const p = sim as unknown as Priv;
  const normal = p.powerMul(sim.fighters[1]).dmg;
  run(sim, 20, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  const v = sim.fighters[1];
  check('泣き落とし：近くの相手が気まずくなり、攻撃力0.8倍', v.awkward > 0 && Math.abs(p.powerMul(v).dmg / normal - MENHERA.cry.mul) < 1e-9, `${(p.powerMul(v).dmg / normal).toFixed(2)}倍`);
  run(sim, MENHERA.cry.time + 5);
  check('泣き落とし：約4秒で元に戻る', v.awkward === 0 && p.powerMul(v).dmg === normal);
}
{
  const sim = make('menhera', 'guard');
  place(sim, 4.5);
  run(sim, 20, at(0, { mx: 0, my: -1, buttons: BTN_B }));
  check('泣き落とし：遠い相手には効かない', sim.fighters[1].awkward === 0);
}

// ---- ハート風船：上昇して、そのあとゆっくり落ちる
{
  const sim = make('menhera', 'guard');
  place(sim, 8);
  const f = sim.fighters[0];
  const y0 = f.y;
  let top = y0;
  let minVy = 0;
  run(sim, 1, at(0, { mx: 0, my: 1, buttons: BTN_B }));
  for (let i = 0; i < 70; i++) {
    run(sim, 1);
    top = Math.max(top, f.y);
    if (i > 40) minVy = Math.min(minVy, f.vy);
  }
  check('ハート風船：上昇する', top - y0 > 2.5, `${(top - y0).toFixed(1)}m`);
  check('ハート風船：上昇のあとはゆっくり落ちる', minVy >= -MENHERA.floatFall - 1e-9, `落ちる速さ ${(-minVy).toFixed(1)}`);
}

// ---- かまってちゃん：放っておかれると病みモード、当てるとデレモード
{
  const sim = make('menhera', 'guard');
  place(sim, 6);
  const f = sim.fighters[0];
  const p = sim as unknown as Priv;
  f.lonely = 0;
  const calm = p.powerMul(f).dmg;
  run(sim, MENHERA.lonely + 2);
  const yami = p.powerMul(f);
  check('かまってちゃん：約3秒当てないと病みモード（攻撃力1.25倍・ふっとばし力1.1倍）', Math.abs(yami.dmg / calm - MENHERA.yamiDmg) < 1e-9 && Math.abs(yami.kb - MENHERA.yamiKb) < 1e-9);
  // 攻撃を当てる
  place(sim, 1.0);
  run(sim, 20, at(0, { mx: 0, my: 0, buttons: 1 }));
  check('かまってちゃん：攻撃を当てるとデレモード（少し速い）に戻る', f.lonely < MENHERA.lonely && f.dere > 0 && Math.abs(p.speedMul(f) - MENHERA.dereSpeed) < 1e-9, `lonely=${f.lonely} dere=${f.dere}`);
}

// ---- 深夜のワンルームのギミック：運命の赤い糸（2人がしばらくつながる）
{
  const players = ['guard', 'thief', 'hacker'].map((c, i) => ({ slot: i, name: 'p' + i, charId: c, cpu: false, cpuLevel: 1 }));
  const sim = new Sim({ players, stageId: 'room', rules: { mode: 'stock', stocks: 3, timeLimit: 300, gimmicks: true }, seed: 4 });
  let tied: number[] = [];
  for (let i = 0; i < 60 * 30 && !tied.length; i++) {
    sim.step(new Map());
    if (sim.events.some((e) => e.k === 'fate')) tied = sim.fighters.filter((f) => f.leashT > 0).map((f) => f.slot);
  }
  check('運命の赤い糸：ランダムな2人がつながる', tied.length === 2, `${tied.join('と')}`);
  const [a, b] = tied.map((s2) => sim.fighter(s2)!);
  check('運命の赤い糸：おたがいにつながっている', a.leashBy === b.slot && b.leashBy === a.slot);
  let far = 0;
  for (let i = 0; i < 120; i++) {
    sim.step(new Map([[a.slot, { mx: -1, my: 0, buttons: 0 }], [b.slot, { mx: 1, my: 0, buttons: 0 }]]));
    far = Math.max(far, Math.hypot(a.x - b.x, a.y - b.y));
  }
  check('運命の赤い糸：反対へ走っても離れられない', far <= MENHERA.leashLen + 0.05, `最大${far.toFixed(2)}m`);
  for (let i = 0; i < MENHERA.fate; i++) sim.step(new Map());
  check('運命の赤い糸：約5秒で切れる', a.leashT === 0 && b.leashT === 0);
}

// ---- CPUだけで最後まで遊べる・勝率の目安
{
  const others = ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'];
  const GAMES = Number(process.env.GAMES ?? 20);
  let wins = 0;
  let games = 0;
  let used = { n: 0, s: 0, d: 0, u: 0 };
  for (let g = 0; g < GAMES; g++) {
    const o = others[g % others.length];
    const sim = new Sim({ players: [{ slot: 0, name: 'a', charId: 'menhera', cpu: true, cpuLevel: 6 }, { slot: 1, name: 'b', charId: o, cpu: true, cpuLevel: 6 }].map((p, i) => (g % 2 ? { ...p, slot: 1 - i } : p)).sort((a, b) => a.slot - b.slot), stageId: 'plain', rules: { mode: 'stock', stocks: 3, timeLimit: 300 }, seed: 100 + g });
    const cpu = new CpuController(100 + g);
    let fr = 0;
    while (!sim.finished && fr < 60 * 320) {
      sim.step(new Map(sim.fighters.map((x) => [x.slot, cpu.think(sim, x, 6)])));
      const m = sim.fighters.find((x) => x.def.id === 'menhera')!;
      if (m.moveFrame === 1 && m.move) {
        if (m.move === 'nspecial') used.n++;
        if (m.move === 'sspecial') used.s++;
        if (m.move === 'dspecial') used.d++;
        if (m.move === 'uspecial') used.u++;
      }
      fr++;
    }
    games++;
    const r = sim.results();
    const mine = sim.fighters.find((x) => x.def.id === 'menhera')!.slot;
    if (r.find((x) => x.slot === mine)?.rank === 1) wins++;
  }
  check('CPU同士の対戦が最後まで進む', games === GAMES, `勝率 ${Math.round((wins / games) * 100)}%・必殺技 B${used.n} 横B${used.s} 下B${used.d} 上B${used.u}（${GAMES}試合）`);
  check('CPUが4つの必殺技を使う', used.n > 0 && used.s > 0 && used.d > 0 && used.u > 0);
}

console.log(fail ? `\n${fail} 件 NG` : '\nすべて OK');
process.exit(fail ? 1 : 0);
