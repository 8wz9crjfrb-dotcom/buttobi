// 2台の端末を模して接続し、ルーム作成→参加→対戦→終了まで通るかを確かめる
const URL_BASE = process.argv[2] || 'ws://127.0.0.1:8787';
const code = String(1000 + Math.floor(Math.random() * 9000));
function client(name, create) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${URL_BASE}/room/${code}`);
    const c = { ws, name, msgs: [], snaps: 0, lastSnap: null, results: null, slot: -1, lobby: null, errors: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, name, charId: create ? 'gran' : 'bolt', create }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { c.slot = m.slot; resolve(c); }
      if (m.t === 'lobby') c.lobby = m.lobby;
      if (m.t === 'snap') { c.snaps++; c.lastSnap = m.s; }
      if (m.t === 'end') c.results = m.results;
      if (m.t === 'error') { c.errors.push(m.code); resolve(c); }
    };
    ws.onerror = (e) => reject(e);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const host = await client('ホスト', true);
const dup = await client('重複', true);
console.log('同じコードでもう一度作成 →', dup.errors);
const guest = await client('ゲスト', false);
await sleep(300);
console.log('ホスト slot', host.slot, 'ゲスト slot', guest.slot, 'ロビー人数', host.lobby.players.length, 'ホスト', host.lobby.hostSlot);
guest.ws.send(JSON.stringify({ t: 'config', rules: { mode: 'stock', stocks: 1, timeLimit: 60 }, stageId: 'tiers', cpuCount: 3, cpuLevel: 9 }));
await sleep(200);
console.log('ゲストが設定変更（無視されるはず）→ CPU数', host.lobby.players.filter(p => p.cpu).length);
host.ws.send(JSON.stringify({ t: 'config', rules: { mode: 'stock', stocks: 1, timeLimit: 60 }, stageId: 'tiers', cpuCount: 3, cpuLevel: 9 }));
await sleep(200);
console.log('ホストが設定変更 → 参加者', host.lobby.players.map(p => `${p.slot}:${p.name}`).join(', '), 'ステージ', host.lobby.stageId);
const t0 = Date.now();
host.ws.send(JSON.stringify({ t: 'start' }));
// ゲストは右へ歩きながらAを連打、ホストは途中で切断（CPUが代わりに操作するはず）
let n = 0;
const timer = setInterval(() => { n++; guest.ws.send(JSON.stringify({ t: 'in', mx: n % 40 < 20 ? 1 : -1, my: 0, b: n % 6 === 0 ? 1 : 0 })); }, 33);
await sleep(4000);
const snapsAt4s = guest.snaps;
host.ws.close();
await sleep(1500);
console.log('4秒で受け取った状態の数', snapsAt4s, '（目安 約120）');
const s = guest.lastSnap;
console.log('フレーム', s.f, '選手数', s.p.length, '残り時間(フレーム)', s.tl);
while (!guest.results && Date.now() - t0 < 75000) await sleep(500);
clearInterval(timer);
console.log('試合時間', ((Date.now() - t0) / 1000).toFixed(1), '秒 結果', JSON.stringify(guest.results));
const lobbyAfter = guest.lobby;
console.log('試合後のロビー: ホスト=', lobbyAfter.hostSlot, '人間', lobbyAfter.players.filter(p => !p.cpu).map(p => p.name));
guest.ws.close();
const nf = await (async () => { const c2 = await new Promise((res) => { const ws = new WebSocket(`${URL_BASE}/room/0001`); ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'x', charId: 'mira', create: false })); ws.onmessage = (e) => res(JSON.parse(e.data)); }); return c2; })();
console.log('存在しないルームに参加 →', nf.code);
process.exit(0);
