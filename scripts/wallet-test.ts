// コイン（ログインボーナス・勝利・通算勝利の節目）の計算が仕様どおりか確かめる
import { claimLogin, recordWin, type Wallet } from '../src/client/wallet';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const w: Wallet = { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0 };
const day = (d: number) => new Date(2026, 10, d, 12, 0, 0);

const a = claimLogin(w, day(1));
check('はじめてのログインで1日目のボーナス', a?.day === 1 && a.amount === 50 && w.coins === 50);
check('同じ日の2回目はもらえない', claimLogin(w, new Date(2026, 10, 1, 23, 0, 0)) === null && w.coins === 50);
for (let d = 2; d <= 7; d++) claimLogin(w, day(d));
check('7日連続で7日目は200コイン', w.streak === 7 && w.coins === 50 * 6 + 200, `${w.coins}`);
const b = claimLogin(w, day(8));
check('8日目はまた1日目から', b?.day === 1 && b.amount === 50);
const c = claimLogin(w, day(10));
check('1日あけると連続が途切れて1日目に戻る', c?.day === 1);

const w2: Wallet = { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0 };
check('CPU（強さ1）に勝つと5コイン', recordWin(w2, false, 1).base === 5);
check('CPU（強さ5）に勝つと10コイン', recordWin(w2, false, 5).base === 10);
check('CPU（強さ9）に勝つと15コイン', recordWin(w2, false, 9).base === 15);
check('オンラインで勝つと30コイン', recordWin(w2, true, 0).base === 30);
let bonus = null;
for (let i = 0; i < 6; i++) bonus = recordWin(w2, false, 5).bonus ?? bonus;
check('通算10勝で100コインのボーナス', bonus?.wins === 10 && bonus.amount === 100, `通算${w2.wins.cpu + w2.wins.online}勝`);
check('合計のコインが合っている', w2.coins === 5 + 10 + 15 + 30 + 6 * 10 + 100, `${w2.coins}`);
for (let i = 0; i < 90; i++) recordWin(w2, false, 5);
check('通算100勝でも節目のボーナス（30・50・100勝）を受け取っている', w2.milestone === 100);
process.exit(fail ? 1 : 0);
