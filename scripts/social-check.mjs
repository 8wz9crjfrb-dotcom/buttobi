// フレンド機能を確かめる（手元の対戦サーバーに対して実行）
// 使い方：cd server && npx wrangler dev --port 8787 --local を動かした状態で node scripts/social-check.mjs
const base = process.argv[2] ?? 'ws://localhost:8787';
const rid = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
let fail = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info ? '  (' + info + ')' : ''}`);
  if (!ok) fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 5000) => {
  const t = Date.now();
  while (!f()) {
    if (Date.now() - t > ms) return false;
    await wait(30);
  }
  return true;
};
function client(name, id = rid(), hidden = false) {
  const c = { name, id, code: '', state: null, msgs: [] };
  c.open = () =>
    new Promise((res) => {
      c.ws = new WebSocket(`${base}/social`);
      c.ws.onopen = () => {
        c.ws.send(JSON.stringify({ t: 'hi', v: 1, id: c.id, name, hidden }));
        res();
      };
      c.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'me') c.code = m.code;
        if (m.t === 'state') c.state = m;
        if (m.t === 'err' || m.t === 'ok') c.msgs.push(m);
      };
    });
  c.send = (m) => c.ws.send(JSON.stringify(m));
  c.friend = (code) => c.state?.friends.find((f) => f.code === code);
  return c;
}
const A = client('あい');
const B = client('びー');
const C = client('しー');
await A.open();
await B.open();
await C.open();
await until(() => A.code && B.code && C.code);
check('つなぐとフレンドコードがもらえる（ABCD-EFGH の形）', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(A.code) && A.code !== B.code, A.code);

A.send({ t: 'add', code: 'zzzz-zzzz' });
await until(() => A.msgs.length > 0);
check('存在しないコードは見つからないと言われる', A.msgs.at(-1)?.t === 'err', A.msgs.at(-1)?.msg);
A.send({ t: 'add', code: A.code });
await until(() => A.msgs.length > 1);
check('自分のコードは追加できない', A.msgs.at(-1)?.t === 'err', A.msgs.at(-1)?.msg);

A.send({ t: 'add', code: B.code.toLowerCase().replace('-', '') });
await until(() => B.state?.inbox.some((x) => x.code === A.code));
check('申請すると相手に届く（小文字・ハイフンなしでも可）', B.state.inbox.some((x) => x.code === A.code && x.name === 'あい'));
check('申請しただけではフレンドではない', !A.friend(B.code) && A.state.sent.some((x) => x.code === B.code));
B.send({ t: 'accept', code: A.code });
await until(() => A.friend(B.code) && B.friend(A.code));
check('承認するとお互いのフレンドになる', !!A.friend(B.code) && !!B.friend(A.code) && B.state.inbox.length === 0 && A.state.sent.length === 0);
check('フレンドがオンラインに見える', A.friend(B.code)?.online === true && B.friend(A.code)?.online === true);
check('フレンドでない人のことは見えない', !C.state?.friends.length);

// 隠す
A.send({ t: 'hidden', on: true });
await until(() => B.friend(A.code)?.online === false);
check('「隠す」にすると、相手からはオフラインに見える', B.friend(A.code)?.online === false);
// ルームを公開
A.send({ t: 'room', room: { code: '4321', n: 2, max: 6, match: false } });
await until(() => B.friend(A.code)?.room?.code === '4321');
check('フレンドに公開したルームが見える（隠していても、公開したルームは見せる）', B.friend(A.code)?.room?.code === '4321' && B.friend(A.code)?.room?.n === 2);
check('フレンドでない人には、公開ルームは見えない', !C.state?.friends.some((f) => f.room));
A.send({ t: 'room', room: null });
await until(() => !B.friend(A.code)?.room);
check('公開をやめると消える', !B.friend(A.code)?.room);
A.send({ t: 'hidden', on: false });
await until(() => B.friend(A.code)?.online === true);
A.send({ t: 'room', room: { code: '4321', n: 2, max: 6, match: false } });
await until(() => !!B.friend(A.code)?.room);
// アプリを閉じる
A.ws.close();
await until(() => B.friend(A.code)?.online === false && !B.friend(A.code)?.room);
check('アプリを閉じると、オフラインになり公開ルームも消える', B.friend(A.code)?.online === false && !B.friend(A.code)?.room);

// 開き直すと同じコード・同じフレンド
const A2 = client('あい', A.id);
await A2.open();
await until(() => A2.code && A2.state);
check('同じ番号でつなぎ直すと、同じコードとフレンドのまま', A2.code === A.code && !!A2.friend(B.code));
await until(() => B.friend(A.code)?.online === true);
check('つなぎ直すとオンラインに戻る', B.friend(A.code)?.online === true);

// お互いに申請するとすぐフレンド
C.send({ t: 'add', code: A2.code });
await until(() => A2.state?.inbox.some((x) => x.code === C.code));
A2.send({ t: 'add', code: C.code });
await until(() => !!A2.friend(C.code));
check('相手からの申請があるときに申請すると、すぐフレンドになる', !!A2.friend(C.code) && !!C.friend(A2.code));
// 外す・断る
A2.send({ t: 'remove', code: B.code });
await until(() => !A2.friend(B.code) && !B.friend(A2.code));
check('フレンドを外すと、お互いの一覧から消える', !A2.friend(B.code) && !B.friend(A2.code));
B.send({ t: 'add', code: C.code });
await until(() => C.state?.inbox.some((x) => x.code === B.code));
C.send({ t: 'decline', code: B.code });
await until(() => !C.state?.inbox.length && !B.state?.sent.length);
check('申請を断ると、お互いの申請中から消える', !C.state.inbox.length && !B.state.sent.length);
// 名前の変更
B.send({ t: 'add', code: A2.code });
await until(() => A2.state?.inbox.some((x) => x.code === B.code));
A2.send({ t: 'accept', code: B.code });
await until(() => !!B.friend(A2.code));
A2.send({ t: 'name', name: 'あいちゃん' });
await until(() => B.friend(A2.code)?.name === 'あいちゃん');
check('名前を変えるとフレンドの一覧にも反映される', B.friend(A2.code)?.name === 'あいちゃん');
console.log(fail ? `${fail}件 NG` : 'すべて OK');
process.exit(fail ? 1 : 0);
