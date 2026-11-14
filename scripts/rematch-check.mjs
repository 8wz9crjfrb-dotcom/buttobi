// オンラインの再戦で、新しい試合の入力が受け付けられるかを確かめる（手元の対戦サーバーに対して実行）
// 使い方：cd server && npx wrangler dev --port 8787 --local   を動かした状態で
//         node scripts/rematch-check.mjs [ws://localhost:8787] [ルームコード] [通信の遅れms]
const base = process.argv[2] ?? 'ws://localhost:8787';
const code = process.argv[3] ?? String(1000 + Math.floor(Math.random() * 9000));
const LAG = Number(process.argv[4] ?? 150);
const ws = new WebSocket(`${base}/room/${code}`);
const send = (m) => ws.send(JSON.stringify(m));

let slot = -1;
let seq = 0;
let match = 0;
let ended = false;
let mx = 1;
let myX = null;
const xs = [];

ws.onopen = () => send({ t: 'hello', v: 14, name: 'test', charId: 'guard', create: true });
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.t === 'welcome') {
    slot = m.slot;
    // CPU 1人、ストック1（場外に歩いて落ちればすぐ終わる）
    send({ t: 'config', rules: { mode: 'stock', stocks: 1, timeLimit: 60 }, stageId: 'plain', cpuCount: 1, cpuLevel: 1 });
    setTimeout(() => send({ t: 'start' }), 300);
  }
  if (m.t === 'start') {
    match++;
    ended = false;
    // 端末と同じく、新しい試合では通し番号を0に戻す。
    // ただし実際の通信には遅れがあるので、前の試合の番号の入力が、再戦の開始後にサーバーへ届くことがある。
    // その状況を作るため、LAG ミリ秒のあいだは前の試合の番号のまま送り続けてから0に戻す
    const reset = () => {
      seq = 0;
      xs.length = 0;
      mx = match === 1 ? 1 : -1;
    };
    if (match === 1) reset();
    else setTimeout(reset, LAG);
    console.log(`試合${match} 開始`);
  }
  if (m.t === 'snap') {
    const f = m.s.p.find((a) => a[0] === slot);
    if (f) {
      myX = f[1] / 100;
      if (m.s.f > 160) xs.push(myX);
    }
  }
  if (m.t === 'end') {
    ended = true;
    console.log(`試合${match} 終了`);
    if (match === 1) {
      // 結果画面の間も入力は送り続ける（実際の端末と同じ）。少し待ってから再戦
      setTimeout(() => send({ t: 'start' }), 1500);
    } else finish();
  }
};
// 実際の端末と同じく、50msごとに3フレーム分の入力をまとめて送る
setInterval(() => {
  if (ws.readyState !== 1 || match === 0) return;
  send({ t: 'in', s: seq, i: [[mx, 0, 0], [mx, 0, 0], [mx, 0, 0]] });
  seq += 3;
}, 50);

// 2試合目：4秒歩かせて、動けたかを見る
let checkTimer = setInterval(() => {
  if (match === 2 && xs.length > 200) finish();
}, 200);
function finish() {
  clearInterval(checkTimer);
  // 2試合目は左（mx = -1）に歩かせているので、左へ動いていれば操作できている
  const moved = xs.length ? xs[xs.length - 1] - xs[0] : 0;
  const ok = moved < -1;
  console.log(`2試合目に動いた距離：${moved.toFixed(2)}（左へ歩かせている）  ${ok ? 'OK（操作どおりに動く）' : 'NG（操作が効かない）'}`);
  process.exit(ok ? 0 : 1);
}
setTimeout(() => {
  console.log('時間切れ', { match, ended, myX, n: xs.length });
  finish();
}, 60000);
