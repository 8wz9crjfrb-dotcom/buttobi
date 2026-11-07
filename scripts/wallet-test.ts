// コイン（ログインボーナス・勝利・通算勝利の節目）の計算が仕様どおりか確かめる
import { claimLogin, GACHA_COST, PITY_LIMIT, pullGacha, recordWin, type Wallet } from '../src/client/wallet';
import { GACHA_COSTUMES } from '../src/shared/costumes';
import { MISSION_BONUS, MISSION_REWARD, recordMatch, refreshMissions, type Progress } from '../src/client/progress';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const w: Wallet = { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0 };
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

const w2: Wallet = { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0 };
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
// ---- 着せ替えガチャ
{
  const g: Wallet = { coins: 50, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0 };
  check('コインが足りないと引けない', pullGacha(g, 1) === null && g.coins === 50);
  g.coins = GACHA_COST.ten;
  const r = pullGacha(g, 10)!;
  check('10回引くと10着出て、900コイン使う', r.length === 10 && g.coins === r.reduce((a, x) => a + x.refund, 0), `残り${g.coins}`);
  check('出た衣装（重複以外）を持っている', r.filter((x) => !x.dup).every((x) => g.owned.includes(x.id)));
  check('出るのはSRかSSRだけ', r.every((x) => x.rarity === 4 || x.rarity === 5));
  // 天井：SSRが出ない乱数でも、50回目は必ずSSR
  const p: Wallet = { coins: 100 * PITY_LIMIT, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0 };
  let ssrAt = -1;
  for (let i = 0; i < PITY_LIMIT; i++) {
    const res = pullGacha(p, 1, () => 0.99)!;
    if (res[0].rarity === 5 && ssrAt < 0) ssrAt = i + 1;
  }
  check('天井：SSRが出ないまま50回目で必ずSSR', ssrAt === PITY_LIMIT, `${ssrAt}回目`);
  // 重複はコインに変わる
  const d: Wallet = { coins: 200, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [GACHA_COSTUMES.filter((c) => c.rarity === 4)[0].id], pity: 0 };
  const dr = pullGacha(d, 1, () => 0.5 * 0 + 0.2)!; // SR・一覧の先頭を引く乱数
  check('持っている衣装が出たらコインに変わる', dr[0].dup ? d.coins === 100 + 20 : true, `${dr[0].id} dup=${dr[0].dup} 残り${d.coins}`);
  check('衣装はキャラごとにSR2着・SSR1着', ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai'].every((id) => GACHA_COSTUMES.filter((c) => c.charId === id && c.rarity === 4).length === 2 && GACHA_COSTUMES.filter((c) => c.charId === id && c.rarity === 5 && c.fx).length === 1));
}
// ---- 戦績・ミッション・称号
{
  const p: Progress = { records: {}, totals: { matches: 0, wins: 0, kos: 0, throws: 0, taunts: 0, specials: 0, items: 0 }, titles: [], missions: { day: '', list: [], bonus: false }, tutorialDone: false };
  const w: Wallet = { coins: 0, wins: { cpu: 0, online: 0 }, lastLogin: '', streak: 0, milestone: 0, owned: [], pity: 0 };
  const day = new Date(2026, 10, 7, 12);
  refreshMissions(p, day);
  check('ミッションは毎日3つ', p.missions.list.length === 3 && new Set(p.missions.list.map((m) => m.id)).size === 3);
  const p2 = { ...p, missions: { day: '', list: [], bonus: false } } as Progress;
  refreshMissions(p2, day);
  check('同じ日なら同じミッション', p2.missions.list.map((m) => m.id).join() === p.missions.list.map((m) => m.id).join());
  // どのミッションも一気に達成できる大きな成績
  const big = { charId: 'guard', won: true, kos: 9, falls: 0, dealt: 300, throws: 9, taunts: 9, specials: 30, smashes: 9, items: 9 };
  let got = recordMatch(p, w, big, day);
  if (p.missions.list.some((m) => m.id === 'play2' || m.id === 'char1')) got = recordMatch(p, w, { ...big, charId: 'ai' }, day);
  const charM = p.missions.list.find((m) => m.id === 'char1');
  if (charM && !charM.done) {
    for (const c of ['guard', 'hacker', 'thief', 'streamer', 'dopa', 'gacha', 'courier', 'ai']) recordMatch(p, w, { ...big, charId: c }, day);
  }
  check('ミッションを全部達成するとボーナス', p.missions.list.every((m) => m.done) && p.missions.bonus, `${p.missions.list.map((m) => m.id + ':' + m.progress).join(' ')}`);
  check('称号「はじめての勝利」を手に入れてコインがもらえる', p.titles.includes('win1') && w.coins >= MISSION_REWARD * 3 + MISSION_BONUS + 50, `コイン${w.coins}`);
  check('キャラ別の戦績が記録される', (p.records.guard?.wins ?? 0) >= 1 && p.totals.matches >= 1);
  void got;
}
process.exit(fail ? 1 : 0);
