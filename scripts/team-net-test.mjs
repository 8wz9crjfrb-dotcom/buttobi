// オンラインのチーム戦・体力制の設定がサーバーで通るか（wrangler dev を 8787 で動かしてから実行）
const URL_BASE = process.env.SERVER ?? 'ws://localhost:8787';
let fail = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
};
function client(code, create, name) {
  return new Promise((res) => {
    const ws = new WebSocket(`${URL_BASE}/room/${code}`);
    const c = { ws, msgs: [], lobby: null, start: null, slot: -1, end: null };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 13, name, charId: 'guard', create }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'welcome') { c.slot = m.slot; res(c); }
      if (m.t === 'lobby') c.lobby = m.lobby;
      if (m.t === 'start') c.start = m.setup;
      if (m.t === 'end') c.end = m.results;
      if (m.t === 'error') { c.error = m; res(c); }
    };
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const code = String(Math.floor(1000 + Math.random() * 8999));
const host = await client(code, true, 'ホスト');
const guest = await client(code, false, 'ゲスト');
await wait(300);
check('はじめは自分の枠ごとにチームが分かれる', host.lobby.players.find((p) => p.slot === 0).team !== host.lobby.players.find((p) => p.slot === 1).team);
host.ws.send(JSON.stringify({ t: 'config', rules: { mode: 'stamina', stocks: 2, timeLimit: 180, hp: 120, teams: true, friendlyFire: false, horde: 100 }, stageId: 'plain', cpuCount: 2, cpuLevel: 3 }));
await wait(300);
const r = host.lobby.rules;
check('体力制・HP・チーム戦の設定が通る', r.mode === 'stamina' && r.hp === 120 && r.teams === true && r.friendlyFire === false, JSON.stringify(r));
check('100人組手はオンラインでは使えない（設定から外れる）', r.horde === undefined);
// 全員を同じチームにすると始められない
guest.ws.send(JSON.stringify({ t: 'team', team: 0 }));
for (const p of host.lobby.players.filter((p) => p.cpu)) host.ws.send(JSON.stringify({ t: 'team', team: 0, slot: p.slot }));
await wait(400);
check('チームを変えられる（自分の枠・ホストはCPUの枠も）', host.lobby.players.every((p) => p.team === 0), host.lobby.players.map((p) => `${p.slot}:${p.team}`).join(' '));
host.ws.send(JSON.stringify({ t: 'start' }));
await wait(400);
check('全員同じチームだと始まらない', !host.start);
// ゲストはホストの枠を変えられない
guest.ws.send(JSON.stringify({ t: 'team', team: 2, slot: 0 }));
await wait(300);
check('ほかの人の枠は変えられない（ホスト以外）', host.lobby.players.find((p) => p.slot === 0).team === 0);
guest.ws.send(JSON.stringify({ t: 'team', team: 1 }));
await wait(300);
host.ws.send(JSON.stringify({ t: 'start' }));
await wait(600);
check('2チームに分ければ始まり、チームが試合の設定に入る', !!host.start && host.start.players.find((p) => p.slot === 1)?.team === 1, host.start ? host.start.players.map((p) => `${p.slot}:${p.team}`).join(' ') : '');
host.ws.close();
guest.ws.close();
process.exit(fail ? 1 : 0);
