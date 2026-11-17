// トーナメントの組み合わせ表：シード・勝ち上がり・優勝
import { canHaveThird, champion, makeBracket, matchAt, nextMatch, roundName, setWinner, THIRD, type TourMatch } from '../src/shared/tournament';
import { predictCoins, predictOdds, PREDICT_MAX_ODDS } from '../src/shared/protocol';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}

for (let n = 2; n <= 8; n++) {
  const slots = Array.from({ length: n }, (_, i) => i);
  const rounds = makeBracket(slots);
  // 全員がちょうど1回ずつ1回戦に出る
  const firstPlayers = rounds[0].flatMap((m) => [m.a, m.b]).filter((s) => s >= 0);
  check(`${n}人：全員が1回ずつ入っている`, firstPlayers.length === n && new Set(firstPlayers).size === n);
  // シードどうしの試合（だれもいない試合）はない
  check(`${n}人：空の試合がない`, rounds[0].every((m) => m.a >= 0));
  // 小さい番号が勝つとして最後まで進める
  let games = 0;
  let nm = nextMatch(rounds);
  while (nm) {
    const m = rounds[nm[0]][nm[1]];
    setWinner(rounds, nm[0], nm[1], Math.min(m.a, m.b));
    games++;
    nm = nextMatch(rounds);
    if (games > 20) break;
  }
  // 勝ち抜き戦の試合数は 人数-1
  check(`${n}人：試合数 ${n - 1}`, games === n - 1, `${games}`);
  check(`${n}人：優勝が決まる`, champion(rounds) === 0, `${champion(rounds)}`);
}

// 出ていない人を勝ちにはできない
{
  const r = makeBracket([5, 3, 1]);
  const nm = nextMatch(r)!;
  setWinner(r, nm[0], nm[1], 99);
  check('出ていない人は勝ちにならない', r[nm[0]][nm[1]].w === -1);
  // 3人：1試合目の勝者がシードの人と決勝
  const m = r[nm[0]][nm[1]];
  setWinner(r, nm[0], nm[1], m.a);
  const f = nextMatch(r)!;
  check('3人：2試合目が決勝', f[0] === r.length - 1 && roundName(f[0], r.length) === '決勝');
  check('3人：決勝はシードの人と勝った人', new Set([r[f[0]][f[1]].a, r[f[0]][f[1]].b]).size === 2 && [r[f[0]][f[1]].a, r[f[0]][f[1]].b].includes(m.a));
}
check('回戦の名前', roundName(0, 3) === '1回戦' && roundName(1, 3) === '準決勝' && roundName(2, 3) === '決勝');

// 3位決定戦（決勝の前）
for (let n = 3; n <= 8; n++) {
  const rounds = makeBracket(Array.from({ length: n }, (_, i) => i));
  const ok = canHaveThird(rounds);
  check(`${n}人：3位決定戦を${n >= 4 ? '作れる' : '作れない'}`, ok === n >= 4);
  if (!ok) continue;
  const third: TourMatch = { a: -1, b: -1, w: -1 };
  const order: string[] = [];
  let nm = nextMatch(rounds, third);
  let guard = 0;
  while (nm && guard++ < 20) {
    const m = matchAt(rounds, third, nm[0], nm[1])!;
    order.push(roundName(nm[0], rounds.length));
    setWinner(rounds, nm[0], nm[1], Math.min(m.a, m.b), third);
    nm = nextMatch(rounds, third);
  }
  const ti = order.indexOf('3位決定戦');
  check(`${n}人：3位決定戦は決勝の直前`, ti >= 0 && order[ti + 1] === '決勝' && ti === order.length - 2, order.join('→'));
  check(`${n}人：試合数 ${n}（勝ち抜き${n - 1}＋3位決定戦1）`, order.length === n, `${order.length}`);
  check(`${n}人：3位決定戦は準決勝で負けた2人`, third.a >= 0 && third.b >= 0 && third.a !== third.b && third.w >= 0 && champion(rounds) === 0);
}
check('3位決定戦の名前', roundName(THIRD, 3) === '3位決定戦');

// 勝敗予想のオッズ
{
  const c = [0, 1];
  check('オッズ：票が少ない方が高い', predictOdds([0, 0, 0, 1], 1, c) > predictOdds([0, 0, 0, 1], 0, c), `${predictOdds([0, 0, 0, 1], 1, c)} / ${predictOdds([0, 0, 0, 1], 0, c)}`);
  check('オッズ：同じ票なら同じ', predictOdds([0, 1], 0, c) === predictOdds([0, 1], 1, c));
  check('オッズ：全員が同じ人でも1倍以上', predictOdds([0, 0, 0, 0, 0, 0, 0, 0], 0, c) >= 1);
  check('オッズ：上限', predictOdds([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 1, c) === PREDICT_MAX_ODDS);
  check('オッズ：自分だけAに入れたら1.5倍', predictOdds([0], 0, c) === 1.5 && predictCoins(1.5) === 23);
  check('オッズ：3人がA・自分だけBなら3倍', predictOdds([0, 0, 0, 1], 1, c) === 3 && predictCoins(3) === 45);
}

if (fail) {
  console.log(`\n${fail} 件 NG`);
  process.exit(1);
}
console.log('\nすべて OK');
