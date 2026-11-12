// 通信が切れた人が、同じ枠に戻れるか（ロビー中・対戦中）と、衣装がほかの人に伝わるかを確かめる
const URL_BASE = process.argv[2] || 'ws://127.0.0.1:8787';
const code = String(1000 + Math.floor(Math.random() * 9000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
};
function client(name, hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${URL_BASE}/room/${code}`);
    const c = { ws, name, slot: -1, token: '', lobby: null, start: null, snaps: 0, me: 0, ack: -1, errors: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 13, name, ...hello }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') {
        c.slot = m.slot;
        c.token = m.token;
        resolve(c);
      }
      if (m.t === 'lobby') c.lobby = m.lobby;
      if (m.t === 'start') c.start = m.setup;
      if (m.t === 'snap') {
        c.snaps++;
        if (m.me) {
          c.me++;
          c.ack = m.me.a;
        }
      }
      if (m.t === 'error') {
        c.errors.push(m.code);
        resolve(c);
      }
    };
  });
}
const host = await client('ホスト', { charId: 'guard', create: true, costume: 'guard-ssr' });
const guest = await client('ゲスト', { charId: 'thief', create: false, costume: 'thief-rouge' });
await sleep(300);
check('合言葉（token）を受け取る', host.token.length > 10 && guest.token.length > 10);
const gp = host.lobby.players.find((p) => p.slot === guest.slot);
check('衣装がほかの人に伝わる（ロビー）', gp?.costume === 'thief-rouge', gp?.costume);
// ロビーでゲストの通信が切れる（自分で抜けたのではない）
guest.ws.close();
await sleep(400);
const gone = host.lobby.players.find((p) => p.slot === guest.slot);
check('ロビー中に切れても、しばらく枠が残る', gone && gone.connected === false);
const back = await client('ゲスト', { charId: 'thief', create: false, rejoin: { slot: guest.slot, token: guest.token } });
await sleep(300);
check('ロビー中に切れた人が、同じ枠に戻れる', back.slot === guest.slot && back.errors.length === 0, `slot ${back.slot}`);
// 違う合言葉では戻れない（新しい人として入る）
// 対戦を始めて、途中で切れて戻る
host.ws.send(JSON.stringify({ t: 'config', rules: { mode: 'stock', stocks: 3, timeLimit: 120 }, stageId: 'plain', cpuCount: 1, cpuLevel: 1 }));
await sleep(200);
host.ws.send(JSON.stringify({ t: 'start' }));
await sleep(1500);
check('対戦が始まり、衣装が設定に入る', host.start && host.start.players.find((p) => p.slot === host.slot)?.costume === 'guard-ssr');
back.ws.close();
await sleep(800);
const again = await client('ゲスト', { charId: 'thief', create: false, rejoin: { slot: back.slot, token: back.token } });
await sleep(1500);
check('対戦中に切れた人が、同じ枠に戻れる', again.slot === back.slot && again.errors.length === 0);
check('戻った人に対戦の設定（start）が届く', !!again.start);
check('戻った人に、自分の選手の状態が届く（操作を再開できる）', again.me > 10, `${again.me}回`);
// 入力を送ると処理される
again.ws.send(JSON.stringify({ t: 'in', s: 0, i: [[1, 0, 0], [1, 0, 0], [1, 0, 0]] }));
await sleep(500);
check('戻った後の入力が処理される（番号0から数え直し）', again.ack >= 2, `処理済みの番号 ${again.ack}`);
const bad = await client('他人', { charId: 'hacker', create: false, rejoin: { slot: host.slot, token: 'wrong' } });
check('違う合言葉では、他の人の枠に入れない', bad.slot !== host.slot, `slot ${bad.slot} / ${bad.errors.join(',')}`);
// 観戦：対戦中でも、見るだけなら入れて状態が届く
const watcher = await client('観戦', { charId: 'guard', create: false, spectate: true });
await sleep(800);
check('対戦中でも観戦で入れる（自分の選手はなし）', watcher.slot === -1 && watcher.errors.length === 0 && !!watcher.start && watcher.snaps > 5 && watcher.me === 0, `snaps ${watcher.snaps}`);
check('ロビー情報に観戦の人数が出る', (host.lobby?.spectators ?? 0) >= 1, `${host.lobby?.spectators}`);
for (const c of [host, again, bad, watcher]) c.ws.close();
await sleep(200);
process.exit(fail ? 1 : 0);
