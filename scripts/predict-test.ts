// 先行表示（予測）の精度テスト。
// 対戦サーバー（npm run server:dev）につなぎ、通信に人工的な遅延を入れて、
// 決まった操作をしながら「予測した自分の位置」と「サーバーの結果」のずれを測る。
//   使い方: npx tsx scripts/predict-test.ts [片道の遅延ms] [サーバーURL]
import { Predictor } from '../src/client/predictor';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState, type MatchSetup } from '../src/shared/types';

const DELAY = Number(process.argv[2] ?? 60);
/** 遅延の揺れ（ms）。TCPなので順番は入れ替わらないようにする */
const JITTER = Number(process.argv[5] ?? 0);
let lastOut = 0;
let lastIn = 0;
function later(kind: 'in' | 'out', fn: () => void): void {
  const now = performance.now();
  let at = now + DELAY + Math.random() * JITTER;
  if (kind === 'out') at = lastOut = Math.max(lastOut, at);
  else at = lastIn = Math.max(lastIn, at);
  setTimeout(fn, at - now);
}
const BASE = process.argv[3] ?? 'ws://127.0.0.1:8787';
const code = String(1000 + Math.floor(Math.random() * 9000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(create: boolean, name: string): Promise<{ ws: WebSocket; slot: number; inbox: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/room/${code}`);
    const c = { ws, slot: -1, inbox: [] as any[] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 10, name, charId: 'streamer', create }));
    ws.onmessage = (ev) => {
      // 受信側の遅延
      later('in', () => {
        const m = JSON.parse(String(ev.data));
        if (m.t === 'welcome') {
          c.slot = m.slot;
          resolve(c);
        }
        c.inbox.push(m);
      });
    };
  });
}

// 決まった操作（フレーム番号 → 入力）。相手（右側）には近づかない範囲で動く
function script(i: number): InputState {
  const t = i % 600;
  if (t < 50) return { mx: 1, my: 0, buttons: 0 }; // 右へ走る
  if (t < 60) return { mx: 0, my: 0, buttons: 0 };
  if (t < 64) return { mx: 0, my: 0, buttons: BTN_JUMP }; // ジャンプ
  if (t < 80) return { mx: -0.5, my: 0, buttons: 0 };
  if (t < 83) return { mx: 0, my: 0, buttons: BTN_JUMP }; // 空中ジャンプ
  if (t < 120) return { mx: -1, my: 0, buttons: 0 };
  if (t < 122) return { mx: 0, my: 0, buttons: BTN_A }; // 空中攻撃 / 弱
  if (t < 160) return { mx: 0, my: 0, buttons: 0 };
  if (t < 162) return { mx: 1, my: 0, buttons: BTN_A }; // 横攻撃
  if (t < 200) return { mx: 0, my: 0, buttons: 0 };
  if (t < 240) return { mx: 0, my: 0, buttons: BTN_SHIELD }; // ガード
  if (t < 241) return { mx: 0, my: 0, buttons: BTN_SHIELD };
  if (t < 244) return { mx: -1, my: 0, buttons: BTN_SHIELD }; // 回避（はじき）
  if (t < 280) return { mx: 0, my: 0, buttons: 0 };
  if (t < 282) return { mx: 0, my: 0, buttons: BTN_B }; // 飛び道具
  if (t < 330) return { mx: 0, my: 0, buttons: 0 };
  if (t < 333) return { mx: 0, my: 1, buttons: BTN_A }; // 上攻撃
  if (t < 380) return { mx: 0, my: 0, buttons: 0 };
  if (t < 383) return { mx: 0, my: 0, buttons: BTN_JUMP };
  if (t < 395) return { mx: 0, my: 0, buttons: 0 };
  if (t < 397) return { mx: 0, my: -1, buttons: BTN_A }; // 下空中攻撃
  if (t < 460) return { mx: -0.4, my: 0, buttons: 0 }; // ゆっくり歩く
  if (t < 462) return { mx: 0, my: -1, buttons: BTN_B }; // 叩きつけ
  if (t < 520) return { mx: 0, my: 0, buttons: 0 };
  return { mx: t < 560 ? 1 : -1, my: 0, buttons: 0 };
}

const host = await open(true, 'テスト');
const other = await open(false, '相手');
await sleep(200);
host.ws.send(JSON.stringify({ t: 'config', rules: { mode: 'stock', stocks: 3, timeLimit: 120 }, stageId: 'plain', cpuCount: 0, cpuLevel: 1 }));
await sleep(200);
host.ws.send(JSON.stringify({ t: 'start' }));
let setup: MatchSetup | null = null;
while (!setup) {
  const m = host.inbox.find((x) => x.t === 'start');
  if (m) setup = m.setup;
  await sleep(10);
}
const pred = new Predictor(setup, host.slot);
let seq = 0;
let unsent: [number, number, number][] = [];
let first = 0;
let lastSend = 0;
const corrections: number[] = [];
let leadSum = 0;
let leadN = 0;
let prevB = 0;
const t0 = performance.now();
const FRAMES = 60 * 14;
for (let i = 0; i < FRAMES; i++) {
  // 届いた状態で合わせ直す
  let au: any = null;
  while (host.inbox.length) {
    const m = host.inbox.shift();
    if (m.t === 'snap' && m.me) au = { frame: m.s.f, ack: m.me.a, state: m.me.st };
  }
  if (au) {
    const { dx, dy } = pred.reconcile(au);
    if (au.frame > 150) corrections.push(Math.hypot(dx, dy));
  }
  const inp = script(Math.max(0, i - 160));
  const s = seq++;
  if (!unsent.length) first = s;
  // 検証用：fault を付けると、サーバーには時々違う入力を送る（ずれを検出できるか確かめる）
  const fault = process.argv[4] === 'fault' && i % 90 < 10;
  unsent.push([fault ? -inp.mx : inp.mx, inp.my, inp.buttons]);
  const now = performance.now();
  const newPress = (inp.buttons & ~prevB) !== 0;
  prevB = inp.buttons;
  if (now - lastSend >= 50 || (newPress && now - lastSend >= 33)) {
    const msg = JSON.stringify({ t: 'in', s: first, i: unsent });
    later('out', () => host.ws.send(msg)); // 送信側の遅延
    unsent = [];
    lastSend = now;
  }
  pred.step(s, inp);
  leadSum += pred.lead;
  leadN++;
  // 60fps を保つ
  const target = t0 + ((i + 1) * 1000) / 60;
  const wait = target - performance.now();
  if (wait > 0) await sleep(wait);
}
corrections.sort((a, b) => a - b);
const pct = (p: number) => corrections[Math.min(corrections.length - 1, Math.floor(corrections.length * p))] ?? 0;
const big = corrections.filter((c) => c > 0.3).length;
console.log(`片道遅延 ${DELAY}ms（揺れ 0〜${JITTER}ms）：照合 ${corrections.length}回`);
console.log(`  予測が先行していたフレーム数の平均 ${(leadSum / leadN).toFixed(1)}（約${((leadSum / leadN) * 16.7).toFixed(0)}ms 先を表示）`);
console.log(`  ずれ：中央値 ${pct(0.5).toFixed(3)}m / 95% ${pct(0.95).toFixed(3)}m / 最大 ${pct(1).toFixed(3)}m / 0.3m超 ${big}回`);
const me = pred.view();
console.log(`  最終状態：x=${me.x.toFixed(2)} y=${me.y.toFixed(2)} 状態=${me.state} ダメージ=${me.damage}`);
host.ws.close();
other.ws.close();
process.exit(0);
