// アプリ全体の流れ：画面の切り替え、CPU戦、オンライン戦

import './styles.css';
import { CpuController } from '../shared/ai';
import { CHARACTERS, getCharacter, SLOT_COLORS } from '../shared/characters';
import { MAX_PLAYERS, isRoomCode, type LobbyInfo } from '../shared/protocol';
import { Sim } from '../shared/sim';
import { STAGES, getStage } from '../shared/stages';
import type { GameEvent, InputState, MatchRules, MatchSetup, ResultEntry, ViewState } from '../shared/types';
import { loadRobot } from './assets';
import { Music, Sfx, type TrackId } from './audio';
import { Hud } from './hud';
import { InputManager } from './input';
import { NetClient } from './net';
import { Predictor } from './predictor';
import {
  canInstall,
  enterFullscreenLandscape,
  isIOS,
  isStandalone,
  keepAwake,
  preventZoomGestures,
  promptInstall,
  registerServiceWorker,
  vibrate,
} from './platform';
import { GameRenderer } from './renderer';
import { applyUiSettings, loadSettings, saveSettings, type Settings } from './settings';

registerServiceWorker();
preventZoomGestures();

const settings: Settings = loadSettings();
applyUiSettings(settings);

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const screensEl = document.getElementById('screens')!;
const touchEl = document.getElementById('touch')!;
const pauseBtn = document.getElementById('pause-btn')!;
const toastEl = document.getElementById('toast')!;

const renderer = new GameRenderer(canvas);
renderer.setQuality(settings.quality);
const hud = new Hud();
const input = new InputManager();
const sfx = new Sfx();
sfx.volume = settings.volume;
const music = new Music();
music.volume = settings.bgmVolume;
/** 最初のタップで音を出せるようにする（ブラウザの制限） */
function unlockAudio(): void {
  sfx.unlock();
  music.attach(sfx.ctx);
}
document.addEventListener('pointerdown', unlockAudio, { capture: true });

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------------------
// 対戦セッション
interface Session {
  kind: 'local' | 'net' | 'demo';
  setup: MatchSetup;
  mySlot: number | null;
  /** dt 秒ぶん進めて、表示する状態と新しく起きたイベントを返す */
  frame(dt: number): { view: ViewState | null; events: GameEvent[] };
  paused: boolean;
}

class LocalSession implements Session {
  kind: 'local' | 'demo';
  sim: Sim;
  ai: CpuController;
  acc = 0;
  paused = false;
  mySlot: number | null;
  constructor(public setup: MatchSetup, demo = false) {
    this.kind = demo ? 'demo' : 'local';
    this.sim = new Sim(setup);
    this.ai = new CpuController(setup.seed);
    this.mySlot = demo ? null : setup.players.find((p) => !p.cpu)?.slot ?? null;
  }
  frame(dt: number) {
    const events: GameEvent[] = [];
    if (!this.paused) {
      this.acc += Math.min(dt, 0.1);
      const human = this.mySlot !== null ? readInput() : null;
      if (human) human.buttons |= input.takePressed();
      while (this.acc >= 1 / 60) {
        this.acc -= 1 / 60;
        const inputs = new Map<number, InputState>();
        for (const f of this.sim.fighters) {
          const p = this.setup.players.find((x) => x.slot === f.slot)!;
          if (p.cpu) inputs.set(f.slot, this.ai.think(this.sim, f, p.cpuLevel));
          else if (human) inputs.set(f.slot, human);
        }
        this.sim.step(inputs);
        events.push(...this.sim.events);
        if (this.sim.finished) break;
      }
    }
    return { view: this.sim.toView(), events };
  }
}

/**
 * オンライン対戦。
 * - 他の人のキャラ：サーバーから届いた状態を少し遅らせて補間表示する
 * - 自分のキャラ：端末の中で同じシミュレーションを動かして、操作をすぐ反映する（先行表示）。
 *   サーバーの状態が届いたら、その時点に戻して「まだサーバーが処理していない入力」をやり直し、ずれを直す。
 */
class NetSession implements Session {
  kind = 'net' as const;
  paused = false;
  private pred: Predictor | null = null;
  private acc = 0;
  private offX = 0;
  private offY = 0;
  /** 直近の補正量 */
  correction = 0;
  constructor(public setup: MatchSetup, public mySlot: number, private net: NetClient) {
    if (setup.players.some((p) => p.slot === mySlot && !p.cpu)) this.pred = new Predictor(setup, mySlot);
  }

  frame(dt: number) {
    const pred = this.pred;
    const events: GameEvent[] = [];
    if (pred) {
      const au = this.net.authority;
      if (au && this.net.authorityFresh) {
        this.net.authorityFresh = false;
        const { dx, dy } = pred.reconcile(au);
        this.correction = Math.hypot(dx, dy);
        if (this.correction < 2.5) {
          // 小さなずれは、すぐ飛ばさずに少しずつ寄せる
          this.offX += dx;
          this.offY += dy;
        } else {
          this.offX = 0;
          this.offY = 0;
        }
      }
      this.acc += Math.min(dt, 0.1);
      while (this.acc >= 1 / 60) {
        this.acc -= 1 / 60;
        const inp = readInput();
        inp.buttons |= input.takePressed();
        const seq = this.net.queueInput(inp);
        // 自分のジャンプ・飛び道具の音は先行表示に合わせて鳴らす
        for (const e of pred.step(seq, inp)) if (e.k === 'jump' || e.k === 'shot') events.push(e);
      }
      const k = Math.exp(-dt * 12);
      this.offX *= k;
      this.offY *= k;
    }
    for (const e of this.net.takeEvents()) {
      if (pred && (e.k === 'jump' || e.k === 'shot') && e.s === this.mySlot) continue;
      events.push(e);
    }
    const view = this.net.view();
    if (!view || !pred) return { view, events };
    const me = pred.view();
    const merged: ViewState = {
      ...view,
      fighters: view.fighters.map((f) =>
        f.slot === this.mySlot ? { ...me, x: me.x + this.offX, y: me.y + this.offY, kos: f.kos, falls: f.falls, out: f.out } : f,
      ),
    };
    return { view: merged, events };
  }
}

function readInput(): InputState {
  const inp = input.sample();
  if (!settings.tapJump && inp.my > 0.69) inp.my = 0.69; // スティック上でジャンプしない設定
  return inp;
}

let session: Session | null = null;
let lastSetup: MatchSetup | null = null;
let lastView: ViewState | null = null;
let resultsShown = false;

function startSession(s: Session): void {
  session = s;
  resultsShown = false;
  lastView = null;
  renderer.setMatch(s.setup, getStage(s.setup.stageId));
  input.reset();
  input.takePressed();
  music.play(s.kind === 'demo' ? 'menu' : (s.setup.stageId as TrackId));
  if (s.kind === 'demo') {
    hud.show(false);
    touchEl.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    return;
  }
  hud.setup(s.setup, s.mySlot);
  hud.show(true);
  updateTouchVisibility();
  pauseBtn.classList.remove('hidden');
  clearScreen();
  void keepAwake(true);
  void enterFullscreenLandscape();
}

function updateTouchVisibility(): void {
  const inGame = session && session.kind !== 'demo';
  touchEl.classList.toggle('hidden', !inGame || input.gamepadConnected);
}
document.addEventListener('gamepadchange', updateTouchVisibility);

function startDemo(): void {
  const players = [0, 1, 2, 3].map((i) => ({ slot: i, name: 'CPU', charId: CHARACTERS[i].id, cpu: true, cpuLevel: 5 }));
  startSession(new LocalSession({ players, stageId: STAGES[(Math.random() * STAGES.length) | 0].id, rules: { mode: 'stock', stocks: 99, timeLimit: 600 }, seed: (Math.random() * 1e9) | 0 }, true));
}

function endToMenu(): void {
  void keepAwake(false);
  net.close();
  startDemo();
  showMenu();
}

// ---------------------------------------------------------------------------
// メインループ
let prevT = performance.now();
function loop(t: number): void {
  const dt = Math.min(0.1, (t - prevT) / 1000);
  prevT = t;
  let events: GameEvent[] = [];
  if (session) {
    const r = session.frame(dt);
    if (r.view) lastView = r.view;
    events = r.events;
    if (session.kind !== 'demo' && lastView) {
      hud.update(lastView, events);
      if (session.kind === 'net') hud.setNetInfo(net.connected ? `通信 ${Math.round(net.rtt)}ms` : '再接続中…');
      playEvents(events, session.mySlot, lastView);
    }
    if (session instanceof LocalSession) {
      if (session.kind === 'demo' && session.sim.finished) startDemo();
      else if (session.kind === 'local' && session.sim.finished && !resultsShown) {
        resultsShown = true;
        showResults(session.sim.results(), session.setup, false);
      }
    }
  }
  renderer.render(lastView, dt, events);
  updateFps(t);
  requestAnimationFrame(loop);
}

// フレームレート表示（設定でオンにしたとき、または URL に ?fps を付けたとき）
const fpsEl = document.createElement('div');
fpsEl.id = 'fps';
document.getElementById('app')!.appendChild(fpsEl);
const fpsFromUrl = new URLSearchParams(location.search).has('fps');
let fpsFrames = 0;
let fpsStart = performance.now();
let fpsWorst = 0;
let fpsPrev = performance.now();
function updateFps(t: number): void {
  const on = settings.showFps || fpsFromUrl;
  fpsEl.classList.toggle('hidden', !on);
  if (!on) return;
  fpsFrames++;
  fpsWorst = Math.max(fpsWorst, t - fpsPrev);
  fpsPrev = t;
  if (t - fpsStart >= 1000) {
    const fps = (fpsFrames * 1000) / (t - fpsStart);
    fpsEl.textContent = `${fps.toFixed(0)} fps（最も遅いコマ ${fpsWorst.toFixed(0)}ms）`;
    fpsEl.style.color = fps >= 55 ? '#7dff9a' : fps >= 40 ? '#ffd23f' : '#ff6b6b';
    fpsFrames = 0;
    fpsStart = t;
    fpsWorst = 0;
  }
}

let lastCountdownBeep = -1;
function playEvents(events: GameEvent[], mySlot: number | null, view: ViewState): void {
  for (const e of events) {
    if (e.k === 'hit') {
      sfx.hit(e.p);
      if (settings.vibration && e.s === mySlot) vibrate(Math.min(60, 15 + e.p * 2));
    } else if (e.k === 'ko') {
      sfx.ko();
      if (settings.vibration && e.s === mySlot) vibrate(120);
    } else if (e.k === 'jump' && e.s === mySlot) sfx.jump();
    else if (e.k === 'shield') sfx.shield();
    else if (e.k === 'shot') sfx.shot();
  }
  const c = view.countdown > 100 ? 3 : view.countdown > 50 ? 2 : view.countdown > 0 ? 1 : 0;
  if (c !== lastCountdownBeep) {
    if (c > 0) sfx.beep(false);
    else if (lastCountdownBeep > 0) sfx.beep(true);
    lastCountdownBeep = c;
  }
}

// ---------------------------------------------------------------------------
// 画面
function clearScreen(): void {
  screensEl.innerHTML = '';
}

function showScreen(html: string, cls = '', bind?: (root: HTMLElement) => void): HTMLElement {
  screensEl.innerHTML = '';
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  screensEl.appendChild(el);
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) sfx.click();
  });
  bind?.(el);
  return el;
}

function toast(msg: string, ms = 2500): void {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => toastEl.classList.add('hidden'), ms);
}

function seg<T extends string | number>(name: string, options: [T, string][], value: T): string {
  return `<div class="seg" data-seg="${name}">${options
    .map(([v, label]) => `<button type="button" data-v="${v}" class="${v === value ? 'on' : ''}">${label}</button>`)
    .join('')}</div>`;
}

function bindSeg(root: HTMLElement, name: string, onChange: (v: string) => void): void {
  const el = root.querySelector<HTMLElement>(`[data-seg="${name}"]`);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.v!);
  });
}

function charCards(selected: string): string {
  return `<div class="chars">${CHARACTERS.map(
    (c) => `<div class="char-card ${c.id === selected ? 'on' : ''}" data-char="${c.id}">
      <div class="swatch" style="background:${hex(c.color)}"></div>
      <div class="nm">${c.name}</div><div class="rl">${c.role}</div></div>`,
  ).join('')}</div>`;
}

function bindChars(root: HTMLElement, onPick: (id: string) => void): void {
  root.querySelectorAll<HTMLElement>('.char-card').forEach((el) =>
    el.addEventListener('click', () => {
      root.querySelectorAll('.char-card').forEach((x) => x.classList.toggle('on', x === el));
      sfx.click();
      onPick(el.dataset.char!);
    }),
  );
}

function ruleControls(rules: MatchRules): string {
  return `
    <div class="opt">ルール ${seg('mode', [['stock', 'ストック'], ['time', 'タイム']], rules.mode)}</div>
    <div class="opt" data-show="stock">残機 ${seg('stocks', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], rules.stocks)}</div>
    <div class="opt" data-show="time">時間 ${seg('time', [[120, '2分'], [180, '3分'], [300, '5分']], rules.timeLimit)}</div>`;
}

function bindRules(root: HTMLElement, rules: MatchRules, onChange: () => void): void {
  const sync = () => {
    root.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => el.classList.toggle('hidden', el.dataset.show !== rules.mode));
  };
  sync();
  bindSeg(root, 'mode', (v) => {
    rules.mode = v as MatchRules['mode'];
    rules.timeLimit = rules.mode === 'stock' ? 420 : 180;
    sync();
    onChange();
  });
  bindSeg(root, 'stocks', (v) => {
    rules.stocks = Number(v);
    onChange();
  });
  bindSeg(root, 'time', (v) => {
    rules.timeLimit = Number(v);
    onChange();
  });
}

function showTitle(): void {
  const tip = isIOS && !isStandalone() ? `<p class="install-tip">Safari の共有ボタン →「ホーム画面に追加」で、全画面で遊べます。</p>` : '';
  showScreen(
    `<div class="logo">ぶっとび<br/>アリーナ</div>
     <div class="logo-sub">BUTTOBI ARENA</div>
     <div class="row" style="justify-content:center">
       <label class="field">なまえ<input type="text" id="name" maxlength="10" placeholder="プレイヤー" value="${esc(settings.name)}"/></label>
     </div>
     <button class="btn primary" id="go">はじめる</button>
     ${tip}`,
    'overlay title-screen',
    (root) => {
      root.querySelector('#go')!.addEventListener('click', () => {
        unlockAudio();
        settings.name = (root.querySelector('#name') as HTMLInputElement).value.trim().slice(0, 10);
        saveSettings(settings);
        showMenu();
      });
    },
  );
}

function showMenu(): void {
  const online = !!settings.serverUrl;
  const install = canInstall() ? `<button class="btn" id="install">ホーム画面に追加<small>アプリとしてインストール</small></button>` : '';
  showScreen(
    `<h2>メニュー</h2>
     <div class="menu-grid">
       <button class="btn primary" id="cpu">CPUと対戦<small>ひとりで練習</small></button>
       <button class="btn" id="create" ${online ? '' : 'disabled'}>ルームを作る<small>友達とオンライン対戦</small></button>
       <button class="btn" id="join" ${online ? '' : 'disabled'}>コードで参加<small>4桁の合言葉を入力</small></button>
       <button class="btn" id="howto">遊び方<small>操作とルール</small></button>
       <button class="btn" id="settings">設定<small>ボタン・画質・音</small></button>
       ${install}
     </div>
     ${online ? '' : '<p class="install-tip" style="text-align:center">オンライン対戦のサーバーが設定されていません（設定画面で指定できます）。</p>'}`,
    'overlay',
    (root) => {
      root.querySelector('#cpu')!.addEventListener('click', showLocalSetup);
      root.querySelector('#create')!.addEventListener('click', () => createRoom(0));
      root.querySelector('#join')!.addEventListener('click', showJoin);
      root.querySelector('#howto')!.addEventListener('click', showHowTo);
      root.querySelector('#settings')!.addEventListener('click', showSettings);
      root.querySelector('#install')?.addEventListener('click', () => void promptInstall().then(showMenu));
    },
  );
}
document.addEventListener('installable', () => {
  if (screensEl.querySelector('.menu-grid')) showMenu();
});

function showLocalSetup(): void {
  const rules = { ...settings.rules };
  showScreen(
    `<h2>CPUと対戦</h2>
     ${charCards(settings.charId)}
     <div class="setup-grid">
       <div class="opt">CPUの人数 ${seg('cpu', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], settings.cpuCount)}</div>
       <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], settings.cpuLevel)}</div>
       <div class="opt">ステージ ${seg('stage', STAGES.map((s) => [s.id, s.name] as [string, string]), settings.stageId)}</div>
       ${ruleControls(rules)}
     </div>
     <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="start">対戦開始！</button></div>`,
    'overlay',
    (root) => {
      bindChars(root, (id) => (settings.charId = id));
      bindSeg(root, 'cpu', (v) => (settings.cpuCount = Number(v)));
      bindSeg(root, 'lv', (v) => (settings.cpuLevel = Number(v)));
      bindSeg(root, 'stage', (v) => (settings.stageId = v));
      bindRules(root, rules, () => (settings.rules = { ...rules }));
      root.querySelector('#back')!.addEventListener('click', showMenu);
      root.querySelector('#start')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        const players = [{ slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0 }];
        for (let i = 1; i <= settings.cpuCount; i++) {
          players.push({ slot: i, name: `CPU ${settings.cpuLevel}`, charId: CHARACTERS[(i + 1) % CHARACTERS.length].id, cpu: true, cpuLevel: settings.cpuLevel });
        }
        lastSetup = { players, stageId: settings.stageId, rules: settings.rules, seed: (Math.random() * 1e9) | 0 };
        startSession(new LocalSession(lastSetup));
      });
    },
  );
}

function showResults(results: ResultEntry[], setup: MatchSetup, online: boolean): void {
  void keepAwake(false);
  touchEl.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  hud.show(false);
  const rows = results
    .map((r) => {
      const p = setup.players.find((x) => x.slot === r.slot)!;
      const c = getCharacter(p.charId);
      return `<div class="res-row ${r.rank === 1 ? 'first' : ''}">
        <div class="rank">${r.rank}</div>
        <div><span style="color:${hex(SLOT_COLORS[p.slot % SLOT_COLORS.length])}">●</span> ${esc(p.name)} <small style="color:var(--muted)">${c.name}</small></div>
        <div style="font-size:13px;color:var(--muted)">撃墜 ${r.kos} / 落下 ${r.falls}</div></div>`;
    })
    .join('');
  const win = results.find((r) => r.rank === 1);
  const winner = win ? setup.players.find((p) => p.slot === win.slot) : null;
  renderer.celebrate(win ? win.slot : null);
  music.play('menu');
  showScreen(
    `<h2 style="text-align:center">${winner ? esc(winner.name) + ' の勝ち！' : '結果'}</h2>
     <div class="results">${rows}</div>
     <div class="footer">
       <button class="btn" id="menu">メニューへ</button>
       <button class="btn primary" id="again">${online ? 'ルームへ戻る' : 'もう一度'}</button>
     </div>`,
    'overlay results-screen',
    (root) => {
      root.querySelector('#menu')!.addEventListener('click', endToMenu);
      root.querySelector('#again')!.addEventListener('click', () => {
        if (online) {
          startDemo();
          showLobby();
        } else if (lastSetup) {
          lastSetup = { ...lastSetup, seed: (Math.random() * 1e9) | 0 };
          startSession(new LocalSession(lastSetup));
        }
      });
    },
  );
}

function showPause(): void {
  if (!session || session.kind === 'demo') return;
  const online = session.kind === 'net';
  session.paused = !online;
  showScreen(
    `<h2 style="text-align:center">${online ? 'メニュー（対戦は続いています）' : 'ポーズ'}</h2>
     <div class="menu-grid">
       <button class="btn primary" id="resume">${online ? 'もどる' : '続ける'}</button>
       <button class="btn" id="quit">${online ? 'ルームから抜ける' : '対戦をやめる'}</button>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#resume')!.addEventListener('click', () => {
        if (session) session.paused = false;
        clearScreen();
      });
      root.querySelector('#quit')!.addEventListener('click', endToMenu);
    },
  );
}
pauseBtn.addEventListener('click', showPause);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (screensEl.children.length && session?.paused) {
      session.paused = false;
      clearScreen();
    } else showPause();
  }
});

function showHowTo(): void {
  showScreen(
    `<h2>遊び方</h2>
     <div class="help">
       <p><b>ルール：</b>攻撃を当てると相手のダメージ%が増え、%が高いほど遠くへ飛びます。画面の外まで飛ばすと撃墜です。</p>
       <p><b>移動：</b>画面の左半分をなぞるとスティックが出ます。大きく倒すとダッシュ。上にはじくとジャンプ（設定で切替）、下にはじくと足場をすり抜けます。</p>
       <p><b>A（攻撃）：</b>スティックの向き＋Aで技が変わります。横に素早くはじきながらAで強力なスマッシュ攻撃（Aを押し続けると溜め）。空中では空中攻撃。</p>
       <p><b>B（必殺技）：</b>そのまま＝飛び道具、横＝突進、上＝復帰技（使った後は着地まで無防備）、下＝叩きつけ。</p>
       <p><b>ガード：</b>押している間ガード。ガード中にスティックをはじくと回避、ガード中にAでつかみ投げ（ガードを崩せます）。空中で押すと空中回避。</p>
       <p><b>崖：</b>ステージの端に近づくと自動でつかまります。スティック上かジャンプで上がります。</p>
       <p><b>クレジット：</b>3Dモデル「RobotExpressive」作者 Tomás Laulhé（Quaternius）、改変 Don McCurdy、ライセンス CC0 1.0（three.js のサンプルより）。BGM・効果音はこのゲームのプログラムで作っています。</p>
       <p><b>キーボード：</b>矢印/WASD＝移動、J＝A、K＝B、スペース＝ジャンプ、L＝ガード、Esc＝メニュー。<b>ゲームパッド：</b>左＝A、右＝B、下・上＝ジャンプ、肩＝ガード。</p>
     </div>
     <div class="footer"><button class="btn" id="back">もどる</button></div>`,
    'overlay',
    (root) => root.querySelector('#back')!.addEventListener('click', showMenu),
  );
}

function showSettings(): void {
  showScreen(
    `<h2>設定</h2>
     <div class="setup-grid">
       <div class="opt">ボタンの大きさ ${seg('size', [['S', '小'], ['M', '中'], ['L', '大']], settings.btnSize)}</div>
       <div class="opt">ボタンの濃さ ${seg('op', [['low', 'うすい'], ['mid', 'ふつう'], ['high', 'こい']], settings.btnOpacity)}</div>
       <div class="opt">画質 ${seg('q', [['low', '軽さ優先'], ['high', 'きれい']], settings.quality)}</div>
       <div class="opt">スティック上でジャンプ ${seg('tj', [['on', 'する'], ['off', 'しない']], settings.tapJump ? 'on' : 'off')}</div>
       <div class="opt">振動（Androidのみ） ${seg('vib', [['on', 'する'], ['off', 'しない']], settings.vibration ? 'on' : 'off')}</div>
       <div class="opt">フレームレート表示 ${seg('fps', [['on', 'する'], ['off', 'しない']], settings.showFps ? 'on' : 'off')}</div>
       <div class="opt">効果音 ${seg('vol', [[0, 'なし'], [0.4, '小'], [0.7, '中'], [1, '大']], settings.volume)}</div>
       <div class="opt">BGM ${seg('bgm', [[0, 'なし'], [0.3, '小'], [0.5, '中'], [0.8, '大']], settings.bgmVolume)}</div>
       <label class="field" style="grid-column:1/-1">対戦サーバーのURL（wss://〜）<input type="url" id="server" value="${esc(settings.serverUrl)}" placeholder="wss://buttobi-server.あなたのアカウント.workers.dev"/></label>
     </div>
     <div class="footer"><button class="btn primary" id="back">保存してもどる</button></div>`,
    'overlay',
    (root) => {
      bindSeg(root, 'size', (v) => {
        settings.btnSize = v as Settings['btnSize'];
        applyUiSettings(settings);
      });
      bindSeg(root, 'op', (v) => {
        settings.btnOpacity = v as Settings['btnOpacity'];
        applyUiSettings(settings);
      });
      bindSeg(root, 'q', (v) => {
        settings.quality = v as Settings['quality'];
        renderer.setQuality(settings.quality);
      });
      bindSeg(root, 'tj', (v) => (settings.tapJump = v === 'on'));
      bindSeg(root, 'vib', (v) => (settings.vibration = v === 'on'));
      bindSeg(root, 'fps', (v) => (settings.showFps = v === 'on'));
      bindSeg(root, 'bgm', (v) => {
        settings.bgmVolume = Number(v);
        music.volume = settings.bgmVolume;
      });
      bindSeg(root, 'vol', (v) => {
        settings.volume = Number(v);
        sfx.volume = settings.volume;
        sfx.beep();
      });
      root.querySelector('#back')!.addEventListener('click', () => {
        settings.serverUrl = (root.querySelector('#server') as HTMLInputElement).value.trim();
        saveSettings(settings);
        showMenu();
      });
    },
  );
}

// ---------------------------------------------------------------------------
// オンライン
let lobby: LobbyInfo | null = null;
let creating = false;
let createAttempts = 0;

const net = new NetClient({
  onWelcome() {
    creating = false;
  },
  onLobby(l) {
    lobby = l;
    if (screensEl.querySelector('[data-lobby]')) showLobby();
    else if (!session || session.kind === 'demo') showLobby();
  },
  onStart(setup) {
    startSession(new NetSession(setup, setup.players.find((p) => p.slot === net.slot) ? net.slot : -1, net));
  },
  onEnd(results) {
    if (session?.kind === 'net') {
      resultsShown = true;
      showResults(results, session.setup, true);
    }
  },
  onError(code, msg) {
    if (code === 'taken' && creating && createAttempts < 6) {
      createRoom(createAttempts + 1);
      return;
    }
    creating = false;
    toast(msg, 3500);
    if (code !== 'taken') showMenu();
  },
  onClose() {
    toast('サーバーとの接続が切れました', 3500);
    lobby = null;
    if (session?.kind === 'net') endToMenu();
    else showMenu();
  },
});

function createRoom(attempt: number): void {
  if (!settings.serverUrl) return toast('対戦サーバーが設定されていません');
  unlockAudio();
  creating = true;
  createAttempts = attempt;
  const code = String(1000 + Math.floor(Math.random() * 9000));
  showScreen(`<h2>ルームを作成中…</h2>`, 'overlay');
  net.connect(settings.serverUrl, code, true, settings.name || 'プレイヤー', settings.charId);
}

function showJoin(): void {
  showScreen(
    `<h2>コードで参加</h2>
     <p class="help">友達のルームに表示されている4桁のコードを入力してください。</p>
     <div class="row"><input inputmode="numeric" id="code" maxlength="4" pattern="[0-9]*" placeholder="1234" style="width:140px;font-size:28px;letter-spacing:0.2em"/>
     <button class="btn primary" id="go">参加する</button></div>
     <div class="footer"><button class="btn" id="back">もどる</button></div>`,
    'overlay',
    (root) => {
      const inp = root.querySelector('#code') as HTMLInputElement;
      inp.focus();
      root.querySelector('#go')!.addEventListener('click', () => {
        const code = inp.value.trim();
        if (!isRoomCode(code)) return toast('4桁の数字を入力してください');
        unlockAudio();
        creating = false;
        showScreen(`<h2>接続中…</h2>`, 'overlay');
        net.connect(settings.serverUrl, code, false, settings.name || 'プレイヤー', settings.charId);
      });
      root.querySelector('#back')!.addEventListener('click', showMenu);
    },
  );
}

function showLobby(): void {
  const l = lobby;
  if (!l) return;
  const isHost = l.hostSlot === net.slot;
  const me = l.players.find((p) => p.slot === net.slot);
  const humans = l.players.filter((p) => !p.cpu).length;
  const cpus = l.players.filter((p) => p.cpu);
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const p = l.players.find((x) => x.slot === i);
    if (!p) return `<div class="pslot empty"><span class="dot" style="background:#555"></span>空き</div>`;
    const c = getCharacter(p.charId);
    const tags = [p.slot === l.hostSlot ? '★' : '', p.slot === net.slot ? '（あなた）' : ''].join('');
    return `<div class="pslot"><span class="dot" style="background:${hex(SLOT_COLORS[i])}"></span>
      <div><div>${esc(p.name)}${tags}</div><div style="font-size:11px;color:var(--muted)">${c.name}</div></div></div>`;
  }).join('');
  const rules = { ...l.rules };
  const maxCpu = MAX_PLAYERS - humans;
  const cpuLevel = cpus[0]?.cpuLevel ?? 3;
  const cpuOpts = Array.from({ length: maxCpu + 1 }, (_, i) => [i, String(i)] as [number, string]);
  const hostControls = isHost
    ? `<div class="setup-grid">
        <div class="opt">CPUの人数 ${seg('cpu', cpuOpts, cpus.length)}</div>
        <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], cpuLevel)}</div>
        <div class="opt">ステージ ${seg('stage', STAGES.map((s) => [s.id, s.name] as [string, string]), l.stageId)}</div>
        ${ruleControls(rules)}
      </div>`
    : `<p class="help">ステージ：${getStage(l.stageId).name} ／ ルール：${l.rules.mode === 'stock' ? `ストック ${l.rules.stocks}` : `タイム ${l.rules.timeLimit / 60}分`}<br/>★のホストが開始するのを待っています…</p>`;
  const canStart = l.players.length >= 2 && !l.inMatch;
  showScreen(
    `<div data-lobby class="row" style="justify-content:space-between">
       <div><div style="font-size:12px;color:var(--muted)">ルームコード（友達に教えてください）</div><div class="code-big">${l.code}</div></div>
       <div class="players grow" style="max-width:560px">${slots}</div>
     </div>
     <div style="margin-top:8px">${charCards(me?.charId ?? settings.charId)}</div>
     ${hostControls}
     <div class="footer">
       <button class="btn" id="leave">抜ける</button>
       ${isHost ? `<button class="btn primary" id="start" ${canStart ? '' : 'disabled'}>対戦開始！</button>` : ''}
     </div>`,
    'overlay',
    (root) => {
      bindChars(root, (id) => {
        settings.charId = id;
        saveSettings(settings);
        net.setChar(id);
      });
      root.querySelector('#leave')!.addEventListener('click', () => {
        net.close();
        lobby = null;
        showMenu();
      });
      if (isHost) {
        let cpuCount = cpus.length;
        let lv = cpuLevel;
        let stageId = l.stageId;
        const push = () => net.config(rules, stageId, cpuCount, lv);
        bindSeg(root, 'cpu', (v) => {
          cpuCount = Number(v);
          push();
        });
        bindSeg(root, 'lv', (v) => {
          lv = Number(v);
          push();
        });
        bindSeg(root, 'stage', (v) => {
          stageId = v;
          push();
        });
        bindRules(root, rules, push);
        root.querySelector('#start')?.addEventListener('click', () => net.start());
      }
    },
  );
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.kind === 'net') {
    input.reset();
    net.sendNeutral();
  }
});

// ---------------------------------------------------------------------------
startDemo();
showTitle();
void loadRobot().then(() => renderer.upgradeModels());
requestAnimationFrame(loop);

// 開発・自動テスト用（ブラウザのコンソールから状態を確認できる）
(window as unknown as { __buttobi: unknown }).__buttobi = {
  get session() {
    return session;
  },
  get view() {
    return lastView;
  },
  renderer,
};
