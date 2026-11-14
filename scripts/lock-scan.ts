// 連打でハメられる技を探す：攻撃側が同じ技を連打し、相手（逃げようとする／ガードする）が
// 何秒続けて動けないか（ひるみ・つかまれ・眠り・ガード割れ）を、全キャラ・全必殺技・連打の速さごとに測る。
// 使い方：npx tsx scripts/lock-scan.ts [しきい値の秒数（既定 2.5）] [キャラid...]
import { Sim, COUNTDOWN_FRAMES, type Fighter } from '../src/shared/sim';
import { threebDef } from '../src/shared/characters';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState } from '../src/shared/types';

const LIMIT = Number(process.argv[2] ?? 2.5) * 60;
const only = process.argv.slice(3);
const CHARS = ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai', 'trainer', 'threeb'];
const N: InputState = { mx: 0, my: 0, buttons: 0 };

/** 動けない状態か */
export function stuck(f: Fighter): boolean {
  // ガード割れは、ガードを押し続けた本人のせいなので数えない
  return f.hitlag > 0 || f.state === 'hitstun' || f.state === 'grabbed' || f.state === 'sleep' || (f.state === 'land' && f.stun > 12);
}

type Move = { name: string; btn: number; dir: (a: Fighter, v: Fighter) => [number, number]; setup?: 'drone' | 'buff' | 'protein' | 'speed' };
const toward = (a: Fighter, v: Fighter) => Math.sign(v.x - a.x) || 1;
const MOVES: Move[] = [
  { name: '弱(A)', btn: BTN_A, dir: () => [0, 0] },
  { name: 'B', btn: BTN_B, dir: () => [0, 0] },
  { name: '横B', btn: BTN_B, dir: (a, v) => [toward(a, v), 0] },
  { name: '下B', btn: BTN_B, dir: () => [0, -1] },
  { name: '上B', btn: BTN_B, dir: () => [0, 1] },
  { name: 'ドローン+B', btn: BTN_B, dir: () => [0, 0], setup: 'drone' },
  { name: 'ドローン+弱', btn: BTN_A, dir: () => [0, 0], setup: 'drone' },
];

/** 相手の動き：逃げる（動けるようになったらジャンプして離れる）／ガードし続ける／その場で反撃 */
type Victim = 'escape' | 'shield' | 'fight';

export function scan(charId: string, job: number, mv: Move, every: number, victim: Victim, dist: number, frames = 600) {
  const sim = new Sim({
    players: [
      { slot: 0, name: 'a', charId, cpu: false, cpuLevel: 1 },
      { slot: 1, name: 'b', charId: 'guard', cpu: false, cpuLevel: 1 },
    ],
    stageId: 'plain',
    rules: { mode: 'stock', stocks: 3, timeLimit: 300 },
    seed: 3,
  });
  while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
  const a = sim.fighters[0];
  const v = sim.fighters[1];
  if (charId === 'threeb' && job) {
    a.job = job;
    a.def = threebDef(job);
  }
  a.x = -dist / 2;
  v.x = dist / 2;
  a.facing = 1;
  v.facing = -1;
  v.damage = 40;
  let pre = 0;
  if (mv.setup === 'drone') {
    if (charId !== 'ai') return null;
    // ドローンを出してから始める
    for (let i = 0; i < 40; i++) sim.step(new Map([[0, i === 0 ? { mx: 0, my: -1, buttons: BTN_B } : N]]));
    pre = 40;
  }
  // 「ハメ」：動けない時間の間に、動ける時間が GAP フレーム未満しかない状態が続く長さ
  // 人は動けるようになってから反応するまで約0.2秒（REACT）かかる。それより短いすき間は、抜け出せないとみなす
  const REACT = 12;
  const GAP = REACT + 10;
  let run = 0;
  let free = GAP;
  let worst = 0;
  let stuckTotal = 0;
  const d0 = v.damage;
  const stocks0 = v.stocks;
  for (let i = 0; i < frames; i++) {
    // 攻撃側：every フレームごとに技のボタン。間は相手に近づく（離れすぎないように）
    const [dx, dy] = mv.dir(a, v);
    const far = Math.abs(v.x - a.x) > 2.2;
    const pa: InputState = i % every === 0 ? { mx: dx, my: dy, buttons: mv.btn } : { mx: far ? toward(a, v) : 0, my: 0, buttons: 0 };
    // 相手側
    let pv: InputState = N;
    const away = -toward(a, v) || 1;
    // スティックは逃げる向きに倒しっぱなし。ボタンは動けるようになって REACT フレームたってから
    if (victim === 'escape') pv = { mx: away, my: 0, buttons: 0 };
    if (!stuck(v) && free >= REACT) {
      if (victim === 'escape') pv = i % 2 === 0 ? { mx: away, my: 0, buttons: BTN_JUMP } : { mx: away, my: 0, buttons: 0 };
      else if (victim === 'shield') pv = { mx: 0, my: 0, buttons: BTN_SHIELD };
      else pv = i % 3 === 0 ? { mx: -away, my: 0, buttons: BTN_A } : N;
    }
    sim.step(new Map([[0, pa], [1, pv]]));
    if (v.stocks < stocks0 || !v.alive) break;
    if (stuck(v)) {
      // 少しだけ動けた直後にまた動けなくなったら、続いているとみなす
      run = free < GAP ? run + free + 1 : 1;
      free = 0;
      stuckTotal++;
      worst = Math.max(worst, run);
    } else free++;
  }
  return { worst, ratio: stuckTotal / frames, dmg: v.damage - d0, pre };
}

if (process.argv[1]?.endsWith('lock-scan.ts')) {
  const rows: string[] = [];
  for (const c of only.length ? only : CHARS) {
    const jobs = c === 'threeb' ? [0, 1, 2] : [0];
    for (const job of jobs) {
      for (const mv of MOVES) {
        let worst = { worst: 0, every: 0, victim: '', dist: 0, dmg: 0, ratio: 0 };
        for (const every of [2, 4, 6, 9, 13, 18])
          for (const dist of [1.0, 2.5, 5]) {
            // 相手は逃げ・ガード・反撃のうち、いちばん抜け出しやすい動きをとったとして数える
            let best: (ReturnType<typeof scan> & { victim: string }) | null = null;
            for (const victim of ['escape', 'shield', 'fight'] as Victim[]) {
              const r = scan(c, job, mv, every, victim, dist);
              if (r && (!best || r.worst < best.worst)) best = { ...r, victim };
            }
            if (best && best.worst > worst.worst) worst = { worst: best.worst, every, victim: best.victim, dist, dmg: best.dmg, ratio: best.ratio };
          }
        if (!worst.every) continue;
        const name = `${c}${c === 'threeb' ? `[${['美容師', 'バンド', 'バーテン'][job]}]` : ''} ${mv.name}`;
        const flag = worst.worst >= LIMIT ? 'ハメ' : '';
        rows.push(`${flag.padEnd(3)} ${name.padEnd(22)} 最長${(worst.worst / 60).toFixed(1)}秒 動けない割合${Math.round(worst.ratio * 100)}% 与ダメ${worst.dmg.toFixed(0)}%  (${worst.every}fごと・相手=${worst.victim}・距離${worst.dist})`);
      }
    }
  }
  console.log(rows.join('\n'));
}
