// オンラインの「もう1戦したい」とステージおまかせを確かめる（手元の対戦サーバーに対して実行）
// 使い方：cd server && npx wrangler dev --port 8787 --local を動かした状態で node scripts/again-check.mjs
const base = process.argv[2] ?? 'ws://localhost:8787';
const code = String(1000 + Math.floor(Math.random() * 9000));
const V = 16;
const log = [];
function client(name, create) {
  const ws = new WebSocket(`${base}/room/${code}`);
  const c = { ws, name, slot: -1, lobby: null, starts: [], ends: 0, seq: 0, mx: 0 };
  c.send = (m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  ws.onopen = () => c.send({ t: 'hello', v: V, name, charId: 'guard', create });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') c.slot = m.slot;
    if (m.t === 'lobby') c.lobby = m.lobby;
    if (m.t === 'start') { c.starts.push(m.setup.stageId); c.seq = 0; }
    if (m.t === 'end') c.ends++;
    if (m.t === 'error') log.push(`${name} error ${m.code} ${m.msg}`);
  };
  setInterval(() => { if (c.starts.length) { c.send({ t: 'in', s: c.seq, i: [[c.mx, 0, 0], [c.mx, 0, 0], [c.mx, 0, 0]] }); c.seq += 3; } }, 50);
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await wait(50); } return true; };
const host = client('host', true);
await until(() => host.slot >= 0);
const guest = client('guest', false);
await until(() => guest.slot >= 0 && host.lobby?.players.length === 2);
// ステージおまかせ、ストック1（場外に歩けばすぐ終わる）
host.send({ t: 'config', rules: { mode: 'stock', stocks: 1, timeLimit: 60 }, stageId: 'random', cpuCount: 0, cpuLevel: 1 });
await until(() => host.lobby?.stageId === 'random');
console.log('おまかせが設定された:', host.lobby?.stageId === 'random');
host.send({ t: 'start' });
await until(() => host.starts.length === 1 && guest.starts.length === 1);
host.mx = 1; // ホストが場外へ歩いて試合を終わらせる
console.log('1試合目のステージ:', host.starts[0], host.starts[0] !== 'random' ? 'OK（実際のステージ）' : 'NG');
await until(() => host.ends === 1 && guest.ends === 1, 60000);
host.mx = 0;
guest.send({ t: 'again', on: true });
await until(() => (host.lobby?.again ?? []).includes(guest.slot));
console.log('ゲストの「もう1戦したい」がホストに見える:', (host.lobby?.again ?? []).includes(guest.slot), `（${host.lobby?.again?.length}/2人）`);
await wait(500);
console.log('1人だけではまだ始まらない:', host.starts.length === 1);
host.send({ t: 'again', on: true });
const started = await until(() => host.starts.length === 2 && guest.starts.length === 2, 5000);
console.log('全員が押すと再戦が始まる:', started, '2試合目のステージ:', host.starts[1]);
await until(() => (host.lobby?.again ?? []).length === 0, 3000);
console.log('始まったら投票は消える:', (host.lobby?.again ?? []).length === 0);
// 取り消し
host.mx = 1;
await until(() => host.ends === 2, 60000);
host.mx = 0;
guest.send({ t: 'again', on: true });
await until(() => (host.lobby?.again ?? []).includes(guest.slot));
guest.send({ t: 'again', on: false });
await until(() => !(host.lobby?.again ?? []).includes(guest.slot));
console.log('取り消せる:', !(host.lobby?.again ?? []).includes(guest.slot));
// おまかせで何回か始めて、ステージが変わるか
const seen = new Set(host.starts);
for (let k = 0; k < 4; k++) {
  host.send({ t: 'start' });
  await until(() => host.starts.length === 3 + k);
  seen.add(host.starts[host.starts.length - 1]);
  host.mx = 1;
  await until(() => host.ends === 3 + k, 60000);
  host.mx = 0;
}
console.log('おまかせで試合ごとにステージが変わる:', seen.size >= 2, [...seen].join(', '));
console.log(log.join('\n'));
process.exit(0);
