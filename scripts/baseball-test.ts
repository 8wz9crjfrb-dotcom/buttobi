// 野球（CPUと1対1）の計算が意図どおりに動くかを確かめる
import { Baseball, BBCpu, BB, zoneOut, bbRep, pitchShift, bbStats, type BBSetup, type PitchKind } from '../src/shared/baseball';
import { BTN_A, type InputState } from '../src/shared/types';

let fail = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
}
const N: InputState = { mx: 0, my: 0, buttons: 0 };
const setup = (innings = 1, seed = 1): BBSetup => ({
  players: [
    { slot: 0, name: 'あ', charId: 'guard', cpu: false, level: 5, team: 0 },
    { slot: 1, name: 'い', charId: 'hacker', cpu: false, level: 5, team: 1 },
  ],
  innings,
  seed,
});
/** フェーズが変わるまで進める（入力は f で決める） */
const until = (g: Baseball, cond: () => boolean, f: (g: Baseball) => Map<number, InputState> = () => new Map(), max = 3000) => {
  for (let i = 0; i < max && !cond(); i++) g.step(f(g));
};
const pitchAt = (x: number, y: number) => (g: Baseball) => {
  const m = new Map<number, InputState>();
  if (g.phase === 'aim') {
    g.aim.x = x;
    g.aim.y = y;
    m.set(g.pitcher.slot, { mx: 0, my: 0, buttons: g.frame % 2 ? BTN_A : 0 });
  }
  return m;
};

// ---- 見送り：ゾーンの真ん中はストライク、大きく外れるとボール
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'call', pitchAt(0, 0.8));
  check('見送り：真ん中はストライク', g.lastCall === 'strike', `${g.lastCall}`);
  until(g, () => g.phase === 'ready');
  check('ストライクが1つ増える', g.strikes === 1 && g.balls === 0);
  until(g, () => g.phase === 'call', pitchAt(-0.6, 1.5));
  check('見送り：大きく外れるとボール', g.lastCall === 'ball', `${g.lastCall}`);
}
// ---- 3ストライクで三振、4ボールでフォアボール（押し出しで点）
{
  const g = new Baseball(setup());
  for (let i = 0; i < 3; i++) {
    until(g, () => g.phase === 'call', pitchAt(0, 0.8));
    until(g, () => g.phase !== 'call');
  }
  check('3ストライクで三振（アウトが1つ）', g.lastResult === 'strikeout' && g.outs === 1, `${g.lastResult}`);
  until(g, () => g.phase === 'ready' && g.pa === 1);
  check('三振のあと、次の打席（2打席目）へ', g.pa === 1 && g.strikes === 0 && g.balls === 0);
  for (let i = 0; i < 4; i++) {
    until(g, () => g.phase === 'call', pitchAt(-0.6, 1.5));
    until(g, () => g.phase !== 'call');
  }
  check('4ボールでフォアボール（1塁へ）', g.lastResult === 'walk' && g.bases[0]);
}
// ---- 1イニング3打席で攻守交代（アウトの数では交代しない）
{
  const g = new Baseball(setup(2));
  const firstBatTeam = g.half;
  for (let pa = 0; pa < 3; pa++) {
    for (let i = 0; i < 3; i++) {
      until(g, () => g.phase === 'call', pitchAt(0, 0.8));
      until(g, () => g.phase !== 'call');
    }
    until(g, () => g.phase === 'ready' || g.phase === 'change');
  }
  check('3打席で攻守交代（表 → 裏）', g.phase === 'change' && g.half === 1 - firstBatTeam && g.pa === 0 && g.outs === 0, `${g.phase} half=${g.half}`);
  check('交代すると塁は空になる', !g.bases.some(Boolean));
}
// ---- 打つ：ミートの丸を球に合わせて、ちょうどのタイミングで振ると前に飛ぶ
{
  let hits = 0;
  let tries = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Baseball(setup(1, seed));
    until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
    const info = g.pitchInfo();
    g.cursor.x = info.x;
    g.cursor.y = info.y;
    until(g, () => g.phase !== 'pitch', (gg) => {
      const left = gg.pitchInfo().left;
      return new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: left === BB.swingDelay ? BTN_A : 0 }]]);
    });
    tries++;
    if (g.phase === 'hit') hits++;
  }
  check('ちょうど合わせて振れば、ほぼ必ず前に飛ぶ', hits >= tries - 1, `${hits}/${tries}`);
}
// ---- 空振り：タイミングが大きくずれる
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
  const info = g.pitchInfo();
  g.cursor.x = info.x;
  g.cursor.y = info.y;
  until(g, () => g.phase !== 'pitch', (gg) => new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: gg.pitchT === 2 ? BTN_A : 0 }]]));
  check('早すぎる振りは空振り', g.lastCall === 'whiff', `${g.lastCall}`);
}
// ---- 点：ホームランで塁の人もかえる。ヒットで2塁の人がかえる
{
  const g = new Baseball(setup());
  g.bases = [true, true, false];
  (g as unknown as { finishAtBat(r: string): void }).finishAtBat('homer');
  check('2人が塁にいてホームランなら3点', g.score[g.half] === 3 && !g.bases.some(Boolean), `${g.score}`);
  const h = new Baseball(setup());
  h.bases = [false, true, false];
  (h as unknown as { finishAtBat(r: string): void }).finishAtBat('single');
  check('ヒットで2塁の人がかえる（1点、打った人は1塁）', h.score[h.half] === 1 && h.bases.join() === 'true,false,false');
}
// ---- CPUどうしで最後まで遊べる・同じ種なら同じ結果
{
  const run = (seed: number) => {
    const s = setup(2, seed);
    s.players.forEach((p) => (p.cpu = true));
    const g = new Baseball(s);
    const cpu = new BBCpu(seed);
    until(g, () => g.finished, (gg) => new Map(gg.setup.players.map((p) => [p.slot, cpu.think(gg, p.slot)])), 60 * 60 * 10);
    return g;
  };
  const a = run(7);
  const b = run(7);
  check('CPUどうしで試合が終わる（2イニング）', a.finished && a.lines[0].length === 2, `${a.score.join('-')} ${Math.round(a.frame / 60)}秒`);
  check('同じ種なら同じ結果（オンラインに使える）', a.score.join() === b.score.join() && a.frame === b.frame && a.log.length === b.log.length);
}
// ---- サヨナラ：最終回の裏、後攻が勝ち越したら終わり
{
  const g = new Baseball(setup(1));
  g.half = 1;
  g.score = [2, 2];
  g.bases = [false, false, false];
  (g as unknown as { finishAtBat(r: string): void }).finishAtBat('homer');
  until(g, () => g.phase !== 'result');
  check('最終回の裏に勝ち越したら、サヨナラで終わる', g.finished && g.winner === 1);
}
// ---- ゴロは地面ではねて転がる（落ちてからしばらくして結果が出る）
{
  const g = new Baseball(setup());
  g.phase = 'hit';
  g.hitBall = { x: 0, y: 0.6, z: 3, vx: 0, vy: -4, vz: 22, landed: false, spray: 0, launch: -5, speed: 25 };
  let bounced = false;
  let maxAfter = 0;
  let landedAt = -1;
  for (let i = 0; i < 200 && g.phase === 'hit'; i++) {
    g.step(new Map());
    if (g.hitBall.landed && landedAt < 0) landedAt = i;
    if (landedAt >= 0 && g.hitBall.y > 0.05) bounced = true;
    if (landedAt >= 0) maxAfter = Math.max(maxAfter, g.hitBall.y);
  }
  const rolled = Math.hypot(g.hitBall.x, g.hitBall.z);
  check('ゴロ：地面に落ちたあと、はねる', bounced, `はねた高さ ${maxAfter.toFixed(2)}m`);
  check('ゴロ：はねて転がってから結果が出る', (g.phase as string) === 'result' && rolled > 10, `転がった距離 ${rolled.toFixed(1)}m`);
}
// ---- ミートの丸：小さく倒すとゆっくり、大きく倒すと速く、なめらかに動く
{
  const g = new Baseball(setup());
  const move = (mx: number, n: number) => {
    const x0 = g.cursor.x;
    for (let i = 0; i < n; i++) g.step(new Map([[g.batter.slot, { mx, my: 0, buttons: 0 }]]));
    return Math.abs(g.cursor.x - x0);
  };
  const slow = move(0.3, 10);
  g.cursor.x = 0;
  move(0, 20);
  g.cursor.x = 0;
  const fast = move(1, 10);
  g.cursor.x = 0;
  move(0, 20);
  g.cursor.x = 0;
  const first = move(1, 1);
  check('ミートの丸：小さく倒すとゆっくり、大きく倒すと速い', fast > slow * 3, `小 ${slow.toFixed(3)} / 大 ${fast.toFixed(3)}`);
  check('ミートの丸：急には最高速にならない（なめらかに加速）', first < BB.cursorMax * 0.5, `${first.toFixed(4)}`);
}

// ---- 球種：選んだ球種で曲がる向きが変わる（狙いは曲がったあとの場所。途中の位置で曲がり方を見る）
{
  const mid = (kind: PitchKind) => {
    // 全部の球種を持つキャラ（ガチャ廃人・得意球なし）で比べる
    const su = setup(1, 3);
    for (const p of su.players) p.charId = 'gacha';
    const g = new Baseball(su);
    until(g, () => g.phase === 'aim');
    g.choosePitch(g.pitcher.slot, kind);
    g.aim.x = 0;
    g.aim.y = 0.8;
    // コントロールのぶれをなくして比べる
    (g as unknown as { rng: { next(): number } }).rng.next = () => 0;
    g.step(new Map([[g.pitcher.slot, { mx: 0, my: 0, buttons: BTN_A }]]));
    const F = g.pitchF;
    const end = g.pitchPos(F);
    // 曲がり始める前（前半）は、狙いに向かってまっすぐ
    const early = g.pitchPos(Math.round(F * 0.3));
    const lineX = (0.8 - 0) * 0;
    void lineX;
    return { x: end.x, y: end.y, ex: early.x, type: g.pitchType, kmh: g.pitchSpeed };
  };
  const st = mid('straight');
  const sl = mid('slider');
  const cu = mid('curve');
  const fo = mid('fork');
  const sh = mid('shoot');
  check('球種：選んだ球種で投げる', st.type === 'straight' && sl.type === 'slider' && cu.type === 'curve' && fo.type === 'fork' && sh.type === 'shoot');
  // 狙い（投げ出す向き）は同じ。ホームベースでは球種の向きへ大きくずれる。前半はまっすぐ（曲がらない）
  check('球種：前半はどれも同じ道筋（手元で曲がる）', Math.abs(sl.ex - st.ex) < 0.01 && Math.abs(sh.ex - st.ex) < 0.01, `前半 x ${st.ex.toFixed(3)} / ${sl.ex.toFixed(3)}`);
  check('球種：スライダーは外へ（x がマイナスへ）大きく曲がる', sl.x < st.x - 0.3, `ホームで x ${sl.x.toFixed(2)}`);
  check('球種：シュートは内へ（x がプラスへ）曲がる', sh.x > st.x + 0.25, `ホームで x ${sh.x.toFixed(2)}`);
  check('球種：フォーク・カーブは大きく落ちる', fo.y < st.y - 0.35 && cu.y < st.y - 0.35, `ホームで y ストレート${st.y.toFixed(2)} フォーク${fo.y.toFixed(2)} カーブ${cu.y.toFixed(2)}`);
  check('球種：ストレートがいちばん速く、カーブがいちばん遅い', st.kmh > sl.kmh && sl.kmh > cu.kmh && fo.kmh > cu.kmh);
  const g = new Baseball(setup());
  until(g, () => g.phase === 'aim');
  g.choosePitch(g.batter.slot, 'curve');
  check('球種：バッターは球種を選べない', g.choice === 'straight');
  g.step(new Map([[g.pitcher.slot, { mx: 0, my: 0, buttons: 2 }]]));
  check('球種：B で球種が切りかわる', g.choice === 'slider');
}

// ---- デッドボール：振らずに体（内側）に当たると1塁へ
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'pitch', pitchAt(BB.aimX, 0.9));
  const px = g.pitchInfo().x;
  until(g, () => g.phase !== 'pitch');
  if (px >= BB.hbpX) check('内側に大きく外れて体に当たるとデッドボール（1塁へ）', g.lastResult === 'hbp' && g.bases[0] && g.balls === 0, `x ${px.toFixed(2)} ${g.lastResult}`);
  else check('内側に大きく外れて体に当たるとデッドボール（1塁へ）', false, `x ${px.toFixed(2)} が体まで届いていない`);
  const h = new Baseball(setup());
  until(h, () => h.phase === 'call', pitchAt(-0.6, 1.5));
  check('外側に外れた球はデッドボールにならない', h.lastCall === 'ball');
}
// ---- 振ったあとも、次の球を待っている間（ピッチャーが投げる前）にバットを動かせる
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
  until(g, () => g.phase !== 'pitch', (gg) => new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: gg.pitchT === 2 ? BTN_A : 0 }]]));
  until(g, () => g.phase === 'ready');
  g.setCursor(g.batter.slot, 0.3, 0.5);
  const okReady = Math.abs(g.cursor.x - 0.3) < 1e-9;
  until(g, () => g.phase === 'aim');
  g.setCursor(g.batter.slot, -0.2, 1.0);
  const okAim = Math.abs(g.cursor.x + 0.2) < 1e-9;
  check('振ったあとでも、次の球の前（待ち・ピッチャーが選んでいる間）にバットを動かせる', okReady && okAim);
}
// ---- ボール球は芯でとらえても強く飛ばない
{
  const avg = (x: number, y: number) => {
    let sum = 0;
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = new Baseball(setup(1, seed));
      until(g, () => g.phase === 'pitch', pitchAt(x, y));
      const info = g.pitchInfo();
      g.cursor.x = Math.max(-BB.aimX, Math.min(BB.aimX, info.x));
      g.cursor.y = info.y;
      until(g, () => g.phase !== 'pitch', (gg) => new Map([[gg.batter.slot, { mx: 0, my: 0, buttons: gg.pitchInfo().left === BB.swingDelay ? BTN_A : 0 }]]));
      if (g.phase === 'hit') {
        sum += g.hitBall.speed;
        n++;
      }
    }
    return n ? sum / n : 0;
  };
  const mid = avg(0, 0.8);
  const low = avg(-0.1, 0.18);
  check('ボール球（低め）を芯で打っても、真ん中より弱い当たり', low > 0 && low < mid * 0.8, `打球の速さ 真ん中 ${mid.toFixed(1)} / 低いボール ${low.toFixed(1)}`);
}
// ---- CPU：明らかなボール球はほとんど振らない
{
  let swings = 0;
  let tries = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const s = setup(1, seed);
    s.players[0].cpu = true;
    s.players[1].cpu = true;
    const g = new Baseball(s);
    const cpu = new BBCpu(seed);
    until(g, () => g.phase === 'pitch', pitchAt(-0.6, 1.5));
    if (zoneOut(g.pitchInfo()) < 0.2) continue;
    tries++;
    until(g, () => g.phase !== 'pitch', (gg) => new Map([[gg.batter.slot, cpu.think(gg, gg.batter.slot)]]));
    if (g.swingAt >= 0) swings++;
  }
  check('CPU：明らかなボール球はほとんど振らない', tries > 20 && swings <= Math.ceil(tries * 0.05), `${swings}/${tries}回 振った`);
}

// ---- 投球モーション：A を押してからしばらくは球が手の中（その間は振れない）
{
  const g = new Baseball(setup());
  until(g, () => g.phase === 'pitch', pitchAt(0, 0.8));
  const z0 = g.ballPos.z;
  for (let i = 0; i < BB.windup - 1; i++) {
    g.requestSwing(g.batter.slot);
    g.step(new Map());
  }
  const held = g.ballPos.z === z0 && g.swingAt < 0;
  for (let i = 0; i < 3; i++) g.step(new Map());
  check('投球モーション中は球が手の中で、振れない。終わると球が飛ぶ', held && g.ballPos.z < z0, `モーション ${BB.windup}フレーム`);
}

// ---- 持ち球・得意球・固有技
const withChars = (pitcherChar: string, batterChar: string) => {
  const su = setup(1, 5);
  // 1回表：チーム1が投げ、チーム0が打つ
  su.players[0].charId = batterChar;
  su.players[1].charId = pitcherChar;
  return new Baseball(su);
};
const throwNow = (g: Baseball, kind: string, x = 0, y = 0.8) => {
  until(g, () => g.phase === 'aim');
  g.choosePitch(g.pitcher.slot, kind as never);
  g.aim.x = x;
  g.aim.y = y;
  g.step(new Map([[g.pitcher.slot, { mx: 0, my: 0, buttons: BTN_A }]]));
};
{
  const g = withChars('guard', 'thief');
  until(g, () => g.phase === 'aim');
  g.choosePitch(g.pitcher.slot, 'slider');
  check('持ち球：持っていない球種は選べない（警備員はスライダーなし）', g.choice === 'straight' && !bbRep('guard').pitches.includes('slider'));
  const fav = g.shiftOf('hacker', 'slider').x / pitchShift('slider', bbStats('hacker').brk).x;
  check('得意球：変化球はよく曲がる（ハッカーのスライダー）', Math.abs(fav - BB.favBreak) < 1e-9, `${fav}倍`);
  check('得意球：ストレートが得意なら速い（トレーナー）', g.speedOf('trainer', 'straight') > g.speedOf('guard', 'straight'));
}
{
  // ロックオン：ゾーンの隅へ
  const g = withChars('guard', 'thief');
  until(g, () => g.phase === 'aim');
  g.toggleSkill(g.pitcher.slot);
  throwNow(g, 'straight', 0.1, 0.9);
  const e = g.pitchInfo();
  check('固有球ロックオン：ゾーンの隅に来る', Math.abs(Math.abs(e.x) - (BB.zone.x - 0.03)) < 0.02 && Math.abs(e.y - (BB.zone.y2 - 0.04)) < 0.02, `x ${e.x.toFixed(2)} y ${e.y.toFixed(2)}`);
  check('固有球を使うと残りが1つ減る', g.skillsLeft(g.pitcher.slot) === BB.skillUses - 1 && g.pitchSkill === 'lockon');
}
{
  // ハッキング：曲がらない・固有球も消える
  const g = withChars('hacker', 'hacker');
  until(g, () => g.phase === 'aim');
  g.useBatSkill(g.batter.slot);
  g.toggleSkill(g.pitcher.slot);
  throwNow(g, 'slider', 0, 0.8);
  const e = g.pitchInfo();
  check('打者の固有ハッキング：変化球が曲がらず、相手の固有球も消える', Math.abs(e.x) < 0.12 && g.pitchSkill === null && g.batSkill === 'hack', `x ${e.x.toFixed(2)}`);
}
{
  // 回数：投打合わせて2回まで
  const g = withChars('guard', 'guard');
  until(g, () => g.phase === 'aim');
  const me = g.batter.slot;
  g.useBatSkill(me);
  until(g, () => g.phase === 'call', pitchAt(-0.6, 1.5));
  until(g, () => g.phase === 'ready');
  check('打者の固有技は1球ごとに消える', g.batSkill === null);
  g.useBatSkill(me);
  until(g, () => g.phase === 'call', pitchAt(-0.6, 1.5));
  until(g, () => g.phase === 'ready');
  g.useBatSkill(me);
  check('固有技は1試合2回まで', g.skillsLeft(me) === 0 && g.batSkill === null);
}
{
  // 盗塁：走者がいないと使えない、いると1つ進む
  const g = withChars('guard', 'thief');
  until(g, () => g.phase === 'aim');
  const me = g.batter.slot;
  check('盗塁：走者がいないと使えない', !g.canBatSkill(me));
  g.bases = [true, false, true];
  const before = g.score[g.half];
  g.useBatSkill(me);
  check('盗塁：走者が1つずつ進み、3塁の人はかえる', g.bases.join() === 'false,true,false' && g.score[g.half] === before + 1);
}
{
  // CPUどうしでも固有技を使う
  let used = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const su = setup(2, seed);
    su.players[0].cpu = true;
    su.players[1].cpu = true;
    const g = new Baseball(su);
    const cpu = new BBCpu(seed);
    until(g, () => g.finished, (gg) => new Map([[0, cpu.think(gg, 0)], [1, cpu.think(gg, 1)]]), 60 * 60 * 30);
    used += 4 - g.skillsLeft(0) - g.skillsLeft(1);
  }
  check('CPU：固有技を使う（2回まで）', used > 5, `10試合で ${used} 回`);
}

void N;

process.exit(fail ? 1 : 0);
