// アプリ全体の流れ：画面の切り替え、CPU戦、オンライン戦

import './styles.css';
import { CpuController } from '../shared/ai';
import { CHARACTERS, getCharacter, SLOT_COLORS, SPECIAL_DESCS } from '../shared/characters';
import { MAX_PLAYERS, isRoomCode, type LobbyInfo } from '../shared/protocol';
import { COUNTDOWN_FRAMES, Sim } from '../shared/sim';
import { moveOf } from '../shared/moves';
import { STAGES, getStage } from '../shared/stages';
import { BTN_JUMP, BTN_SHIELD, type GameEvent, type InputState, type MatchRules, type MatchSetup, type ResultEntry, type ViewState } from '../shared/types';
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
import { applyTouchLayout, currentButtonPositions } from './touchLayout';
import { claimLogin, DUP_REFUND, GACHA_COST, LOGIN_REWARDS, loadWallet, PITY_LIMIT, pullGacha, recordWin, saveWallet, SSR_RATE, type PullResult } from './wallet';
import { COSTUMES, getCostume, rarityName } from '../shared/costumes';

registerServiceWorker();
preventZoomGestures();

const settings: Settings = loadSettings();
const wallet = loadWallet();
applyTouchLayout(settings);
const coinBadge = () => `<div class="coin-badge" title="着せ替えガチャ（準備中）で使えます"><span class="coin-icon"></span>${wallet.coins.toLocaleString()}</div>`;
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
  constructor(
    public setup: MatchSetup,
    demo = false,
    /** 練習モードの設定（練習モードのときだけ） */
    public training: TrainingOpts | null = null,
  ) {
    this.kind = demo ? 'demo' : 'local';
    this.sim = new Sim(setup);
    this.ai = new CpuController(setup.seed);
    this.mySlot = demo ? null : setup.players.find((p) => !p.cpu)?.slot ?? null;
    // 練習モードはカウントダウンなしで始める
    if (training) while (this.sim.frame <= COUNTDOWN_FRAMES) this.sim.step(new Map());
  }

  /** 練習相手の操作（立ち止まる・歩く・ジャンプ・ガード） */
  private dummyInput(mode: DummyMode): InputState {
    const fr = this.sim.frame;
    switch (mode) {
      case 'walk':
        return { mx: Math.floor(fr / 90) % 2 === 0 ? 0.5 : -0.5, my: 0, buttons: 0 };
      case 'jump':
        return { mx: 0, my: 0, buttons: fr % 70 === 0 ? BTN_JUMP : 0 };
      case 'shield':
        return { mx: 0, my: 0, buttons: BTN_SHIELD };
      default:
        return { mx: 0, my: 0, buttons: 0 };
    }
  }
  frame(dt: number) {
    const events: GameEvent[] = [];
    if (!this.paused) {
      // 撃墜確定の一撃のあとは、少しの間スローで進める（CPU戦だけ。オンラインはサーバーの時間に合わせるのでスローにしない）
      this.acc += Math.min(dt, 0.1) * (this.kind === 'local' ? renderer.timeScale : 1) * (this.training?.speed ?? 1);
      const human = this.mySlot !== null ? readInput() : null;
      if (human) human.buttons |= input.takePressed();
      while (this.acc >= 1 / 60) {
        this.acc -= 1 / 60;
        const inputs = new Map<number, InputState>();
        for (const f of this.sim.fighters) {
          const p = this.setup.players.find((x) => x.slot === f.slot)!;
          const tr = this.training;
          if (p.cpu && tr && tr.mode !== 'cpu') inputs.set(f.slot, this.dummyInput(tr.mode));
          else if (p.cpu) inputs.set(f.slot, this.ai.think(this.sim, f, tr ? tr.cpuLevel : p.cpuLevel));
          else if (human) inputs.set(f.slot, human);
        }
        this.sim.step(inputs);
        // 練習モード：何度落ちても終わらない
        if (this.training) for (const f of this.sim.fighters) f.stocks = 99;
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
  renderer.hidePreview();
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
    trainingBtn.classList.add('hidden');
    comboEl.classList.add('hidden');
    return;
  }
  const isTraining = s instanceof LocalSession && !!s.training;
  hud.setup(s.setup, s.mySlot, isTraining);
  trainingBtn.classList.toggle('hidden', !isTraining);
  combo.reset();
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
      if (session instanceof LocalSession && session.training) combo.update(lastView, events, dt);
    }
    if (session instanceof LocalSession) {
      if (session.kind === 'demo' && session.sim.finished) startDemo();
      else if (session.kind === 'local' && !session.training && session.sim.finished && !resultsShown) {
        resultsShown = true;
        showResults(session.sim.results(), session.setup, false);
      }
    }
  }
  // 待ち受け画面のCPU同士の試合では、撃墜確定のスロー演出はしない
  if (session?.kind === 'demo') events = events.filter((e) => e.k !== 'finish');
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
    else if (e.k === 'counter') sfx.counter();
    else if (e.k === 'boom') sfx.boom();
    else if (e.k === 'flash') sfx.shutter();
    else if (e.k === 'teleport') sfx.warp();
    else if (e.k === 'sleep') sfx.sleep();
    else if (e.k === 'gacha') sfx.gacha(e.r);
    else if (e.k === 'heal') sfx.heal();
    else if (e.k === 'poof') sfx.poof();
    else if (e.k === 'buff') sfx.buff();
    else if (e.k === 'absorb') sfx.absorb();
    else if (e.k === 'swap') sfx.swap();
    else if (e.k === 'pull') sfx.notify();
    else if (e.k === 'finish') sfx.finish();
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
  renderer.hidePreview();
  screensEl.innerHTML = '';
}

function showScreen(html: string, cls = '', bind?: (root: HTMLElement) => void): HTMLElement {
  // キャラ選択の3D表示は、キャラ選択画面（showCharSelect）でだけ出す
  renderer.hidePreview();
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

/** 全キャラ共通の溜め攻撃の説明（キャラ選択の長押しで出す） */
const GRAB_DESC = 'ガード中にAで目の前の相手をつかむ（ガードしている相手もつかめる）。つかんでいる間はAでつかみ攻撃、スティックを倒した方向（前・後ろ・上・下）へ投げる。後ろ投げがいちばん遠くへ飛ぶ。つかまれた側はボタンを連打すると早く抜けられる。';
const CHARGE_DESC = 'Aを押し続けると、弱攻撃のあと溜めに入り、離すと大きく殴る。最大1.5秒溜められ、威力は最大1.75倍。溜めている間はスティックで振り向ける。';

/** キャラ選択画面の説明欄。技は長押しで説明が出る */
function charDetail(id: string): string {
  const c = getCharacter(id);
  const n = c.specialNames;
  const row = (key: string, label: string, name: string) => `<div class="mv" data-mv="${key}"><span class="key">${label}</span>${name}</div>`;
  return `<div class="cd-desc">${c.desc}</div>
    <div class="cd-trait"><span class="tag">特性</span><b>${c.trait.name}</b>：${c.trait.desc}</div>
    <div class="cd-moves">
      ${row('n', 'B', n.n)}${row('s', '横B', n.s)}${row('d', '下B', n.d)}${row('u', '上B', n.u)}${row('charge', '共通', '溜め攻撃（A長押し）')}${row('grab', '共通', 'つかみ（ガード＋A）')}
    </div>
    <div class="cd-hint">技を長押しすると説明が出ます</div>`;
}

/** 技の説明のポップアップ：長押し（0.35秒）で出し、どこかを触ると消す */
function bindMovePopups(root: HTMLElement, charId: () => string): void {
  let timer = 0;
  let pop: HTMLElement | null = null;
  const hide = () => {
    pop?.remove();
    pop = null;
    root.querySelectorAll('.mv.on').forEach((x) => x.classList.remove('on'));
  };
  const show = (el: HTMLElement) => {
    hide();
    const key = el.dataset.mv!;
    const c = getCharacter(charId());
    const descs = SPECIAL_DESCS[c.id] ?? SPECIAL_DESCS.guard;
    const name = key === 'charge' ? '溜め攻撃' : key === 'grab' ? 'つかみ・投げ' : c.specialNames[key as 'n' | 's' | 'd' | 'u'];
    const text = key === 'charge' ? CHARGE_DESC : key === 'grab' ? GRAB_DESC : descs[key as 'n' | 's' | 'd' | 'u'];
    pop = document.createElement('div');
    pop.className = 'mv-pop';
    pop.innerHTML = `<b>${name}</b><div>${text}</div>`;
    root.appendChild(pop);
    el.classList.add('on');
    // 押した技のすぐ上に出す（画面からはみ出さないように）
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(rr.width - pw - 8, r.left - rr.left));
    let top = r.top - rr.top - ph - 6;
    if (top < 8) top = r.bottom - rr.top + 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${top + root.scrollTop}px`;
    sfx.click();
  };
  root.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.mv');
    if (!el) {
      hide();
      return;
    }
    clearTimeout(timer);
    timer = window.setTimeout(() => show(el), 350);
  });
  const cancel = () => clearTimeout(timer);
  root.addEventListener('pointerup', cancel);
  root.addEventListener('pointercancel', cancel);
  root.addEventListener('pointerleave', cancel);
  root.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest('.mv')) e.preventDefault();
  });
  root.addEventListener('scroll', hide);
}

interface CharSelectOptions {
  title: string;
  /** 自分の色（プレイヤー番号） */
  slot: number;
  current: string;
  nextLabel: string;
  onBack(): void;
  onNext(charId: string): void;
}

/** キャラ選択：左に選んでいるキャラ（3D・待機ポーズ）、右に一覧と説明 */
function showCharSelect(o: CharSelectOptions): void {
  let picked = CHARACTERS.some((c) => c.id === o.current) ? o.current : CHARACTERS[0].id;
  const nameHtml = (id: string) => {
    const c = getCharacter(id);
    return `<div class="cs-role">${c.role}</div><div class="cs-name">${c.name}</div>`;
  };
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate">${nameHtml(picked)}</div>
     <h2>${o.title}</h2>
     ${charCards(picked)}
     <div class="costume-row">${costumeChips(picked)}</div>
     <div class="char-detail">${charDetail(picked)}</div>
     <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="next">${o.nextLabel}</button></div>`,
    'overlay charsel-screen',
    (root) => {
      root.querySelectorAll<HTMLElement>('.char-card').forEach((el) =>
        el.addEventListener('click', () => {
          picked = el.dataset.char!;
          root.querySelectorAll('.char-card').forEach((x) => x.classList.toggle('on', x === el));
          root.querySelector('.char-detail')!.innerHTML = charDetail(picked);
          root.querySelector('.cs-nameplate')!.innerHTML = nameHtml(picked);
          root.querySelector('.costume-row')!.innerHTML = costumeChips(picked);
          renderer.showPreview(picked, o.slot, myCostume(picked));
          sfx.click();
        }),
      );
      // 衣装を選ぶ（持っている衣装だけ）
      root.querySelector('.costume-row')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-costume]');
        if (!b) return;
        settings.costumes[picked] = b.dataset.costume!;
        saveSettings(settings);
        root.querySelector('.costume-row')!.innerHTML = costumeChips(picked);
        renderer.showPreview(picked, o.slot, myCostume(picked));
        sfx.click();
      });
      bindMovePopups(root, () => picked);
      // 左側をなぞるとキャラが回る。タップするとアクション
      bindPreviewSpin(root);
      root.querySelector('#back')!.addEventListener('click', o.onBack);
      root.querySelector('#next')!.addEventListener('click', () => {
        settings.charId = picked;
        saveSettings(settings);
        o.onNext(picked);
      });
    },
  );
  renderer.showPreview(picked, o.slot, myCostume(picked));
}

/** そのキャラで着ている衣装（持っていない衣装は着られない） */
function myCostume(charId: string): string | undefined {
  const id = settings.costumes[charId];
  if (!id) return undefined;
  const c = COSTUMES.find((x) => x.id === id && x.charId === charId);
  if (!c || (c.rarity >= 4 && !wallet.owned.includes(id))) return undefined;
  return id;
}

/** キャラ選択の衣装の切り替え（いつもの服＋持っている衣装） */
function costumeChips(charId: string): string {
  const cur = getCostume(myCostume(charId), charId).id;
  const list = COSTUMES.filter((c) => c.charId === charId && (c.rarity < 4 || wallet.owned.includes(c.id)));
  const total = COSTUMES.filter((c) => c.charId === charId && c.rarity >= 4).length;
  const have = list.filter((c) => c.rarity >= 4).length;
  return `<span class="cr-label">衣装 ${have}/${total}</span>${list
    .map((c) => `<button type="button" class="cchip r${c.rarity} ${c.id === cur ? 'on' : ''}" data-costume="${c.id}">${rarityName(c.rarity) ? `<b>${rarityName(c.rarity)}</b>` : ''}${c.name}</button>`)
    .join('')}`;
}

/** ステージの一覧（実際のステージの小さな画像つき） */
function stageCards(selected: string): string {
  return `<div class="stages">${STAGES.map((st) => {
    const th = st.theme;
    const bg = `linear-gradient(${hex(th.sky)}, ${hex(th.skyBottom)})`;
    return `<div class="stage-card ${st.id === selected ? 'on' : ''}" data-stage="${st.id}">
      <div class="thumb" style="background:${bg}"><img alt="" data-thumb="${st.id}"/></div>
      <div class="nm">${st.name}</div><div class="who">${st.charId ? getCharacter(st.charId).name : 'デフォルト'}</div></div>`;
  }).join('')}</div>`;
}

function bindStages(root: HTMLElement, onPick: (id: string) => void): void {
  root.querySelectorAll<HTMLElement>('.stage-card').forEach((el) =>
    el.addEventListener('click', () => {
      root.querySelectorAll('.stage-card').forEach((x) => x.classList.toggle('on', x === el));
      sfx.click();
      onPick(el.dataset.stage!);
    }),
  );
  // 画像は1枚ずつ、画面が出たあとに作る（まとめて作ると一瞬止まるため）
  const imgs = [...root.querySelectorAll<HTMLImageElement>('img[data-thumb]')];
  const next = () => {
    const img = imgs.shift();
    if (!img || !img.isConnected) return;
    img.src = renderer.stageThumbnail(getStage(img.dataset.thumb!));
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
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
    `<div class="row" style="justify-content:space-between"><h2>メニュー</h2>${coinBadge()}</div>
     <div class="menu-grid">
       <button class="btn primary" id="cpu">CPUと対戦<small>ひとりで練習</small></button>
       <button class="btn" id="create" ${online ? '' : 'disabled'}>ルームを作る<small>友達とオンライン対戦</small></button>
       <button class="btn" id="join" ${online ? '' : 'disabled'}>コードで参加<small>4桁の合言葉を入力</small></button>
       <button class="btn" id="gacha">着せ替えガチャ<small>コインで衣装を引く</small></button>
       <button class="btn" id="training">練習モード<small>技やコンボを試す</small></button>
       <button class="btn" id="howto">遊び方<small>操作とルール</small></button>
       <button class="btn" id="settings">設定<small>ボタン・画質・音</small></button>
       ${install}
     </div>
     ${online ? '' : '<p class="install-tip" style="text-align:center">オンライン対戦のサーバーが設定されていません（設定画面で指定できます）。</p>'}`,
    'overlay',
    (root) => {
      root.querySelector('#cpu')!.addEventListener('click', showLocalSetup);
      root.querySelector('#create')!.addEventListener('click', () =>
        showCharSelect({ title: 'ルームを作る：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'ルームを作る', onBack: showMenu, onNext: () => createRoom(0) }),
      );
      root.querySelector('#join')!.addEventListener('click', showJoin);
      root.querySelector('#howto')!.addEventListener('click', showHowTo);
      root.querySelector('#gacha')!.addEventListener('click', showGacha);
      root.querySelector('#training')!.addEventListener('click', () =>
        showCharSelect({ title: '練習モード：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'つぎへ', onBack: showMenu, onNext: () => showTrainingSetup() }),
      );
      root.querySelector('#settings')!.addEventListener('click', showSettings);
      root.querySelector('#install')?.addEventListener('click', () => void promptInstall().then(showMenu));
      // ログインボーナス（その日はじめてメニューを開いたとき）
      const bonus = claimLogin(wallet);
      if (bonus) {
        saveWallet(wallet);
        root.querySelector('.coin-badge')!.outerHTML = coinBadge();
        showLoginBonus(root, bonus.day, bonus.amount);
      }
    },
  );
}

/** ログインボーナスの知らせ（7日分のうち、今日が何日目か） */
function showLoginBonus(root: HTMLElement, day: number, amount: number): void {
  const cells = LOGIN_REWARDS.map(
    (c, i) => `<div class="lb-day ${i + 1 < day ? 'got' : i + 1 === day ? 'today' : ''}"><div class="d">${i + 1}日目</div><span class="coin-icon"></span><div class="c">${c}</div></div>`,
  ).join('');
  const pop = document.createElement('div');
  pop.className = 'lb-pop';
  pop.innerHTML = `<div class="lb-card">
      <div class="lb-title">ログインボーナス</div>
      <div class="lb-sub">連続 ${day} 日目：<b>+${amount} コイン</b></div>
      <div class="lb-days">${cells}</div>
      <div class="lb-note">コインは今後の着せ替えガチャで使えます。勝利数でももらえます。</div>
      <button class="btn primary" id="lb-ok">受け取る</button>
    </div>`;
  root.appendChild(pop);
  sfx.gacha(4);
  pop.querySelector('#lb-ok')!.addEventListener('click', () => pop.remove());
}
document.addEventListener('installable', () => {
  if (screensEl.querySelector('.menu-grid')) showMenu();
});

function showLocalSetup(): void {
  showCharSelect({
    title: 'CPUと対戦：キャラを選ぶ',
    slot: 0,
    current: settings.charId,
    nextLabel: 'つぎへ',
    onBack: showMenu,
    onNext: () => showLocalRules(),
  });
}

function showLocalRules(): void {
  const rules = { ...settings.rules };
  if (!STAGES.some((s) => s.id === settings.stageId)) settings.stageId = STAGES[0].id;
  showScreen(
    `<h2>CPUと対戦：ステージとルール <small class="h2-sub">使うキャラ：${getCharacter(settings.charId).name}</small></h2>
     ${stageCards(settings.stageId)}
     <div class="setup-grid">
       <div class="opt">CPUの人数 ${seg('cpu', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], settings.cpuCount)}</div>
       <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], settings.cpuLevel)}</div>
       ${ruleControls(rules)}
     </div>
     <div class="footer"><button class="btn" id="back">キャラ選択へ</button><button class="btn primary" id="start">対戦開始！</button></div>`,
    'overlay',
    (root) => {
      bindStages(root, (v) => (settings.stageId = v));
      bindSeg(root, 'cpu', (v) => (settings.cpuCount = Number(v)));
      bindSeg(root, 'lv', (v) => (settings.cpuLevel = Number(v)));
      bindRules(root, rules, () => (settings.rules = { ...rules }));
      root.querySelector('#back')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        showLocalSetup();
      });
      root.querySelector('#start')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        const players: MatchSetup['players'] = [{ slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId) }];
        // CPUは自分以外のキャラから順に選ぶ
        const others = CHARACTERS.filter((c) => c.id !== settings.charId);
        const offset = (Math.random() * others.length) | 0;
        for (let i = 1; i <= settings.cpuCount; i++) {
          players.push({ slot: i, name: `CPU ${settings.cpuLevel}`, charId: others[(offset + i - 1) % others.length].id, cpu: true, cpuLevel: settings.cpuLevel });
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
  // 自分が勝っていたらコインを渡す（相手がいる試合だけ）
  const mine = online ? net.slot : setup.players.find((p) => !p.cpu)?.slot ?? -1;
  const myResult = results.find((r) => r.slot === mine);
  let reward = '';
  if (myResult && myResult.rank === 1 && setup.players.length >= 2) {
    const cpuLevel = Math.max(0, ...setup.players.filter((p) => p.cpu).map((p) => p.cpuLevel));
    const r = recordWin(wallet, online, cpuLevel);
    saveWallet(wallet);
    reward = `<div class="reward"><span class="coin-icon"></span>勝利 +${r.base} コイン${
      r.bonus ? `<span class="bonus">通算${r.bonus.wins}勝ボーナス +${r.bonus.amount}</span>` : ''
    }<small>（所持 ${wallet.coins.toLocaleString()}・通算 ${r.total} 勝）</small></div>`;
  }
  renderer.celebrate(win ? win.slot : null);
  music.play('menu');
  showScreen(
    `<h2 style="text-align:center">${winner ? esc(winner.name) + ' の勝ち！' : '結果'}</h2>
     ${reward}
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
  if (session instanceof LocalSession && session.training) return showTrainingMenu(session);
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
  if (e.code === 'KeyR' && session instanceof LocalSession && session.training && !screensEl.children.length) resetTrainingPositions(session);
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
       <p><b>溜め攻撃：</b>Aを押し続けると、弱攻撃のあと溜めに入り、離すと大きく殴ります（全キャラ共通。最大1.5秒、威力は最大1.75倍）。</p>
       <p><b>B（必殺技）：</b>キャラごとに4種類（そのまま・横・下・上）。上の必殺技は復帰に使え、使った後は着地まで無防備になります。</p>
       <p><b>キャラごとの特性：</b>各キャラには1つずつ特性があります（キャラ選択画面に表示されます）。</p>
       <p><b>データセンター警備員：</b>B 利用規約を読み上げる（ゆっくり進む文字で長くひるませる）／横B 物理ファイアウォール（壁で飛び道具を防ぎ、相手を押し返す）／下B クレーム対応（構え中に攻撃されると1.3倍で返す）／上B 非常口ダッシュ（斜め上へ突進）</p>
       <p><b>ハッカー：</b>B DDoS（3連射）／横B 全体メール誤送信（3方向に飛ぶ封筒）／下B キャッシュ（触れると爆発する罠、1個まで）／上B ポップアップ広告（窓を足場にして上昇）</p>
       <p><b>データ泥棒：</b>B マルウェア（約3秒間じわじわダメージ）／横B スクショ（高速で突き抜ける）／下B なりすまし（近くの相手と位置を入れ替え、相手は一瞬固まる）／上B 炎上させる（炎をまとって上昇）</p>
       <p><b>配信者：</b>B 投げ銭（山なりのコイン）／横B 切り抜き（瞬間移動して斬る）／下B 強制アップデート（近くの相手をしばらく動けなくする）／上B スパチャ読み（上昇しながらハートを飛ばす）</p>
       <p><b>ドパガキ：</b>B 倍速再生（しばらく動きと攻撃が速くなる）／横B 無限スクロール（横へ滑って攻撃、Bを押し直すと最大3回）／下B 通知爆撃（周りの相手を自分のほうへ引き寄せる。ガードで防げる）／上B 次の動画へ（上へ滑り上がる。途中でBを押すと方向転換）</p>
       <p><b>ガチャ廃人：</b>B 10連ガチャ（毎回ランダムで大当たり〜大外れ）／横B 単発ガチャ（ときどき超強力な一撃）／下B 課金（自分のダメージ%が増える代わりに、しばらく攻撃力アップ）／上B 無償石を配る（上昇しながら石を降らせる）</p>
       <p><b>フードデリバリー配達員：</b>B 配達バッグ投げ（投げると戻ってくる）／横B 自転車（乗ったまま走り回る。ジャンプで降りる）／下B 置き配（拾うと回復する料理を置く。相手も拾える）／上B 立ちこぎジャンプ（自転車ごと大ジャンプ）</p>
       <p><b>AIエンジニア：</b>B 推論（近くの相手を追いかける弾）／横B 学習（構え中に飛び道具を吸収し、次の攻撃を強化）／下B エージェント起動（AIドローンがそばを飛び、近くの相手を自動で撃つ。攻撃を当てると壊れる）／上B API呼び出し（ワイヤーで崖をつかんで復帰）</p>
       <p><b>ガード：</b>押している間ガード。ガード中にスティックをはじくと回避。空中で押すと空中回避。</p>
       <p><b>つかみ：</b>ガード中にAで目の前の相手をつかみます（ガードを崩せます）。つかんでいる間はAでつかみ攻撃、スティックを倒した方向（前・後ろ・上・下）へ投げます。つかまれたらボタン連打で早く抜けられます。</p>
       <p><b>崖：</b>ステージの端に近づくと自動でつかまります。スティック上かジャンプで上がります。</p>
       <p><b>クレジット：</b>キャラクター・BGM・効果音はすべてこのゲームのプログラムで作っています。</p>
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
       <div class="opt">ボタン（配置・大きさ・濃さ） <button type="button" class="btn small" id="layout">${settings.leftHanded ? '左利き・' : ''}${Object.keys(settings.btnPos).length ? '自分で配置' : '標準の配置'}・大きさ${{ S: '小', M: '中', L: '大' }[settings.btnSize]}（変える）</button></div>
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
      bindSeg(root, 'q', (v) => {
        settings.quality = v as Settings['quality'];
        renderer.setQuality(settings.quality);
      });
      root.querySelector('#layout')!.addEventListener('click', () => {
        settings.serverUrl = (root.querySelector('#server') as HTMLInputElement).value.trim();
        saveSettings(settings);
        showButtonEditor();
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
// 着せ替えガチャ
function showGacha(): void {
  const left = PITY_LIMIT - wallet.pity;
  showScreen(
    `<div class="row" style="justify-content:space-between"><h2>着せ替えガチャ</h2>${coinBadge()}</div>
     <div class="gacha-hero">
       <div class="capsule big"><div class="cap-top"></div><div class="cap-bottom"></div></div>
       <div class="gacha-info">
         <div>全${COSTUMES.filter((c) => c.rarity >= 4).length}着（各キャラ SR 2着・SSR 1着）。SSR はエフェクト付き！</div>
         <div>出る確率：<b class="rr5">SSR ${Math.round(SSR_RATE * 100)}%</b>／<b class="rr4">SR ${Math.round((1 - SSR_RATE) * 100)}%</b></div>
         <div>天井：SSR 確定まで あと <b>${left}</b> 回</div>
         <div class="muted">持っている衣装が出たら、コインに変わります（SR ${DUP_REFUND[4]}・SSR ${DUP_REFUND[5]}）。</div>
         <div class="muted">集めた衣装：${wallet.owned.length} / ${COSTUMES.filter((c) => c.rarity >= 4).length}</div>
       </div>
     </div>
     <div class="footer">
       <button class="btn" id="back">もどる</button>
       <div class="row" style="gap:8px">
         <button class="btn" id="lineup">出る衣装</button>
         <button class="btn" id="list">衣装一覧</button>
         <button class="btn primary" id="one" ${wallet.coins < GACHA_COST.one ? 'disabled' : ''}>1回 <small>${GACHA_COST.one}</small></button>
         <button class="btn primary" id="ten" ${wallet.coins < GACHA_COST.ten ? 'disabled' : ''}>10回 <small>${GACHA_COST.ten}</small></button>
       </div>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#back')!.addEventListener('click', showMenu);
      root.querySelector('#list')!.addEventListener('click', () => showCollection(settings.charId));
      root.querySelector('#lineup')!.addEventListener('click', showLineup);
      const pull = (n: 1 | 10) => {
        const res = pullGacha(wallet, n);
        if (!res) return toast('コインが足りません');
        saveWallet(wallet);
        playGachaOpening(res);
      };
      root.querySelector('#one')!.addEventListener('click', () => pull(1));
      root.querySelector('#ten')!.addEventListener('click', () => pull(10));
    },
  );
}

/** カプセルが揺れて開く演出（SSR があれば虹色に光る） */
function playGachaOpening(res: PullResult[]): void {
  const best = Math.max(...res.map((r) => r.rarity));
  const el = showScreen(
    `<div class="gacha-open r${best}">
       <div class="capsule big shake"><div class="cap-top"></div><div class="cap-bottom"></div></div>
       <div class="go-text">${res.length === 10 ? '10連ガチャ！' : 'ガチャ！'}</div>
       <div class="go-skip">タップでとばす</div>
     </div>`,
    'overlay gacha-stage',
  );
  sfx.gacha(2);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    sfx.gacha(best >= 5 ? 5 : 3);
    showGachaResult(res, 0);
  };
  setTimeout(() => el.querySelector('.capsule')?.classList.add('open'), 900);
  setTimeout(finish, best >= 5 ? 1900 : 1500);
  el.addEventListener('click', finish);
}

/** ガチャの結果：左に衣装を着たキャラ（3D）、右に結果の一覧 */
function showGachaResult(res: PullResult[], index: number): void {
  const r = res[index];
  const c = COSTUMES.find((x) => x.id === r.id)!;
  const ch = getCharacter(c.charId);
  const cards = res
    .map((x, i) => {
      const cc = COSTUMES.find((y) => y.id === x.id)!;
      return `<div class="gcard r${x.rarity} ${i === index ? 'on' : ''}" data-i="${i}"><b>${rarityName(x.rarity)}</b><div class="gn">${cc.name}</div><div class="gc">${getCharacter(cc.charId).name}</div>${x.dup ? `<div class="gd">+${x.refund}コイン</div>` : '<div class="gnew">NEW</div>'}</div>`;
    })
    .join('');
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate"><div class="cs-role rr${r.rarity}">${rarityName(r.rarity)}${r.dup ? '（持っていたのでコインに）' : ' NEW!'}</div><div class="cs-name">${c.name}</div><div class="cs-role" style="color:#fff">${ch.name}</div></div>
     <div class="row" style="justify-content:space-between"><h2>ガチャの結果</h2>${coinBadge()}</div>
     <div class="gcards ${res.length > 1 ? 'ten' : ''}">${cards}</div>
     <div class="g-detail">${c.fx ? 'SSR衣装：まわりにエフェクトが舞い、攻撃を当てると特別なエフェクトが出ます。' : ''}${!r.dup ? 'キャラ選択の「衣装」から着られます。' : ''}</div>
     <div class="footer">
       <button class="btn" id="back">ガチャへ</button>
       <div class="row" style="gap:8px">
         ${!r.dup ? '<button class="btn" id="wear">すぐ着る</button>' : ''}
         <button class="btn primary" id="again">もう一度</button>
       </div>
     </div>`,
    'overlay charsel-screen',
    (root) => {
      root.querySelectorAll<HTMLElement>('.gcard').forEach((el) => el.addEventListener('click', () => showGachaResult(res, Number(el.dataset.i))));
      root.querySelector('#back')!.addEventListener('click', showGacha);
      root.querySelector('#again')!.addEventListener('click', showGacha);
      root.querySelector('#wear')?.addEventListener('click', () => {
        settings.costumes[c.charId] = c.id;
        settings.charId = c.charId;
        saveSettings(settings);
        toast(`${ch.name}に「${c.name}」を着せました`);
      });
      bindPreviewSpin(root);
    },
  );
  renderer.showPreview(c.charId, 0, c.id, true);
}

/** 衣装一覧：キャラごとに、持っている衣装と持っていない衣装（？？？） */
function showCollection(charId: string): void {
  const tabs = CHARACTERS.map((c) => `<button type="button" data-v="${c.id}" class="${c.id === charId ? 'on' : ''}">${c.name}</button>`).join('');
  const list = COSTUMES.filter((c) => c.charId === charId);
  const cur = getCostume(myCostume(charId), charId).id;
  let shown = cur;
  const items = list
    .map((c) => {
      const have = c.rarity < 4 || wallet.owned.includes(c.id);
      return `<div class="gcard r${c.rarity} ${have ? '' : 'locked'} ${c.id === cur ? 'on' : ''}" data-id="${c.id}"><b>${rarityName(c.rarity) || 'ふつう'}</b><div class="gn">${have ? c.name : '？？？'}</div>${c.id === cur ? '<div class="gnew">着ている</div>' : ''}</div>`;
    })
    .join('');
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate"><div class="cs-role">${getCharacter(charId).name}</div><div class="cs-name" id="cname">${getCostume(cur, charId).name}</div></div>
     <h2>衣装一覧 <small class="h2-sub">キャラをタップするとアクション</small></h2>
     <div class="seg wrap" data-seg="ch">${tabs}</div>
     <div class="gcards">${items}</div>
     <div class="footer">
       <button class="btn" id="back">ガチャへ</button>
       <button class="btn primary" id="wear">この衣装を着る</button>
     </div>`,
    'overlay charsel-screen',
    (root) => {
      bindSeg(root, 'ch', (v) => showCollection(v));
      root.querySelectorAll<HTMLElement>('.gcard').forEach((el) =>
        el.addEventListener('click', () => {
          const c = COSTUMES.find((x) => x.id === el.dataset.id)!;
          const have = c.rarity < 4 || wallet.owned.includes(c.id);
          if (!have) return toast('まだ持っていません（ガチャで出ます）');
          shown = c.id;
          root.querySelectorAll('.gcard').forEach((x) => x.classList.toggle('on', x === el));
          root.querySelector('#cname')!.textContent = c.name;
          renderer.showPreview(charId, 0, c.id, true);
          sfx.click();
        }),
      );
      root.querySelector('#back')!.addEventListener('click', showGacha);
      root.querySelector('#wear')!.addEventListener('click', () => {
        settings.costumes[charId] = shown;
        saveSettings(settings);
        toast(`「${getCostume(shown, charId).name}」を着せました`);
        showCollection(charId);
      });
      bindPreviewSpin(root);
    },
  );
  renderer.showPreview(charId, 0, cur, true);
}

/** ガチャで出る衣装の一覧（持っている衣装には印）。タップすると左に着た姿を表示 */
function showLineup(): void {
  const pool = COSTUMES.filter((c) => c.rarity >= 4);
  let shown = pool[0];
  const cards = CHARACTERS.map((ch) => {
    const list = pool.filter((c) => c.charId === ch.id);
    return `<div class="lu-char">${ch.name}</div>${list
      .map((c) => {
        const have = wallet.owned.includes(c.id);
        return `<div class="gcard r${c.rarity} ${c === shown ? 'on' : ''}" data-id="${c.id}"><b>${rarityName(c.rarity)}</b><div class="gn">${c.name}</div>${have ? '<div class="have">✓ 持っている</div>' : ''}</div>`;
      })
      .join('')}`;
  }).join('');
  const have = pool.filter((c) => wallet.owned.includes(c.id)).length;
  const label = (c: typeof shown) => `<div class="cs-role rr${c.rarity}">${rarityName(c.rarity)}${wallet.owned.includes(c.id) ? '（持っている）' : ''}</div><div class="cs-name">${c.name}</div><div class="cs-role" style="color:#fff">${getCharacter(c.charId).name}</div>`;
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate">${label(shown)}</div>
     <h2>ガチャで出る衣装 <small class="h2-sub">持っている ${have} / ${pool.length}・SSR はエフェクト付き</small></h2>
     <div class="lineup">${cards}</div>
     <div class="footer"><button class="btn primary" id="back">ガチャへ</button></div>`,
    'overlay charsel-screen',
    (root) => {
      root.querySelectorAll<HTMLElement>('.gcard').forEach((el) =>
        el.addEventListener('click', () => {
          shown = pool.find((c) => c.id === el.dataset.id)!;
          root.querySelectorAll('.gcard').forEach((x) => x.classList.toggle('on', x === el));
          root.querySelector('.cs-nameplate')!.innerHTML = label(shown);
          renderer.showPreview(shown.charId, 0, shown.id, true);
          sfx.click();
        }),
      );
      root.querySelector('#back')!.addEventListener('click', showGacha);
      bindPreviewSpin(root);
    },
  );
  renderer.showPreview(shown.charId, 0, shown.id, true);
}

/** 左側をなぞってキャラを回す。指をほとんど動かさずに離したら（タップ）、キャラがアクションする */
function bindPreviewSpin(root: HTMLElement): void {
  const drag = root.querySelector<HTMLElement>('.cs-drag');
  if (!drag) return;
  let lastX: number | null = null;
  let startX = 0;
  let startY = 0;
  let startT = 0;
  drag.addEventListener('pointerdown', (e) => {
    lastX = startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    drag.setPointerCapture(e.pointerId);
  });
  drag.addEventListener('pointermove', (e) => {
    if (lastX === null) return;
    renderer.spinPreview((e.clientX - lastX) * 0.012);
    lastX = e.clientX;
  });
  drag.addEventListener('pointerup', (e) => {
    lastX = null;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < 10 && performance.now() - startT < 500) {
      renderer.previewAction();
      sfx.jump();
    }
  });
  drag.addEventListener('pointercancel', () => (lastX = null));
}

// ---------------------------------------------------------------------------
// 練習モード
type DummyMode = 'stand' | 'walk' | 'jump' | 'shield' | 'cpu';
interface TrainingOpts {
  dummyChar: string;
  mode: DummyMode;
  cpuLevel: number;
  /** ゲームの速さ（1 = 通常） */
  speed: number;
  /** コンボ・ダメージの表示 */
  showInfo: boolean;
}
const training: TrainingOpts = { dummyChar: 'guard', mode: 'stand', cpuLevel: 3, speed: 1, showInfo: true };
const DUMMY_MODES: [DummyMode, string][] = [
  ['stand', '立ち止まる'],
  ['walk', '歩く'],
  ['jump', 'ジャンプ'],
  ['shield', 'ガード'],
  ['cpu', 'CPU'],
];

// 画面上のリセットボタン（位置を初めに戻す）
const trainingBtn = document.createElement('button');
trainingBtn.id = 'training-btn';
trainingBtn.className = 'hidden';
trainingBtn.textContent = '位置リセット';
document.getElementById('app')!.appendChild(trainingBtn);
trainingBtn.addEventListener('click', () => {
  if (session instanceof LocalSession && session.training) resetTrainingPositions(session);
});

// コンボとダメージの表示
const comboEl = document.createElement('div');
comboEl.id = 'combo';
comboEl.className = 'hidden';
document.getElementById('app')!.appendChild(comboEl);

/** 練習相手が続けて受けた攻撃（ひるみが解ける前に次が当たればコンボ）を数える */
class ComboTracker {
  private hits = 0;
  private total = 0;
  private last = 0;
  private prevDamage = 0;
  private active = false;
  private shown = 0;
  reset(): void {
    this.hits = this.total = this.last = 0;
    this.active = false;
    this.shown = 0;
    comboEl.classList.add('hidden');
  }
  update(view: ViewState, events: GameEvent[], dt: number): void {
    const d = view.fighters.find((f) => f.slot === 1);
    if (!d) return;
    const delta = d.damage - this.prevDamage;
    this.prevDamage = d.damage;
    const hit = events.some((e) => e.k === 'hit' && e.s === 1);
    if (hit && delta > 0.01) {
      if (!this.active) {
        this.active = true;
        this.hits = 0;
        this.total = 0;
      }
      this.hits++;
      this.total += delta;
      this.last = delta;
      this.shown = 2.5;
      this.render(true);
    } else if (this.active && d.state !== 'hitstun' && d.state !== 'grabbed') {
      // ひるみが解けたらコンボ終わり（表示はしばらく残す）
      this.active = false;
      this.render(false);
    }
    if (!this.active && this.shown > 0) {
      this.shown -= dt;
      if (this.shown <= 0) comboEl.classList.add('hidden');
    }
  }
  private render(live: boolean): void {
    if (!training.showInfo) {
      comboEl.classList.add('hidden');
      return;
    }
    comboEl.classList.remove('hidden');
    comboEl.classList.toggle('done', !live);
    const head = this.hits >= 2 ? `<div class="cb-hits">${this.hits}<small>ヒット</small></div>` : '';
    comboEl.innerHTML = `${head}<div class="cb-dmg">${this.hits >= 2 ? `コンボ ${this.total.toFixed(1)}%　` : ''}最後の一撃 ${this.last.toFixed(1)}%</div>`;
  }
}
const combo = new ComboTracker();

/** 練習モードのステージと相手を選ぶ */
function showTrainingSetup(): void {
  if (!STAGES.some((s) => s.id === settings.stageId)) settings.stageId = STAGES[0].id;
  const chips = CHARACTERS.map((c) => `<button type="button" data-v="${c.id}" class="${c.id === training.dummyChar ? 'on' : ''}">${c.name}</button>`).join('');
  showScreen(
    `<h2>練習モード：ステージと相手 <small class="h2-sub">使うキャラ：${getCharacter(settings.charId).name}</small></h2>
     ${stageCards(settings.stageId)}
     <div class="opt-label">練習相手のキャラ</div>
     <div class="seg wrap" data-seg="dummy">${chips}</div>
     <div class="opt-label">練習相手の動き（対戦中も II ボタンで変えられます）</div>
     ${seg('mode', DUMMY_MODES, training.mode)}
     <div class="footer"><button class="btn" id="back">キャラ選択へ</button><button class="btn primary" id="start">練習開始！</button></div>`,
    'overlay',
    (root) => {
      bindStages(root, (v) => (settings.stageId = v));
      bindSeg(root, 'dummy', (v) => (training.dummyChar = v));
      bindSeg(root, 'mode', (v) => (training.mode = v as DummyMode));
      root.querySelector('#back')!.addEventListener('click', () =>
        showCharSelect({ title: '練習モード：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'つぎへ', onBack: showMenu, onNext: () => showTrainingSetup() }),
      );
      root.querySelector('#start')!.addEventListener('click', () => {
        saveSettings(settings);
        startTraining();
      });
    },
  );
}

function startTraining(): void {
  const setup: MatchSetup = {
    players: [
      { slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId) },
      { slot: 1, name: '練習相手', charId: training.dummyChar, cpu: true, cpuLevel: training.cpuLevel },
    ],
    stageId: settings.stageId,
    // 時間は実質無制限（99分）、残機は毎フレーム99に戻す
    rules: { mode: 'stock', stocks: 99, timeLimit: 99 * 60 },
    seed: (Math.random() * 1e9) | 0,
  };
  startSession(new LocalSession(setup, false, training));
}

/** 2人を最初の位置に戻す（ダメージ%はそのまま） */
function resetTrainingPositions(s: LocalSession): void {
  const st = getStage(s.setup.stageId);
  s.sim.fighters.forEach((f, i) => {
    const sp = st.spawns[i % st.spawns.length];
    f.x = sp.x;
    f.y = sp.y + 0.05;
    f.vx = 0;
    f.vy = 0;
    f.grounded = false;
    f.groundRef = -1;
    f.move = null;
    f.hitstun = 0;
    f.hitlag = 0;
    f.grabbing = -1;
    f.grabbedBy = -1;
    f.facing = i === 0 ? 1 : -1;
    if (f.alive) f.state = 'air';
  });
  combo.reset();
}

/** 練習モードのメニュー（II ボタン）：相手の動き・%・速さの変更、技表 */
function showTrainingMenu(s: LocalSession): void {
  s.paused = true;
  const tr = s.training!;
  const me = s.sim.fighters.find((f) => f.slot === 0);
  const dm = s.sim.fighters.find((f) => f.slot === 1);
  const pct: [number, string][] = [
    [0, '0%'],
    [30, '30%'],
    [60, '60%'],
    [100, '100%'],
    [150, '150%'],
  ];
  const near = (v: number) => pct.reduce((a, b) => (Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a))[0];
  showScreen(
    `<h2>練習モード</h2>
     <div class="setup-grid">
       <div class="opt" style="grid-column:1/-1">練習相手の動き ${seg('mode', DUMMY_MODES, tr.mode)}</div>
       <div class="opt" data-cpu>CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], tr.cpuLevel)}</div>
       <div class="opt">相手のダメージ% ${seg('dpct', pct, near(dm?.damage ?? 0))}</div>
       <div class="opt">自分のダメージ% ${seg('mpct', pct, near(me?.damage ?? 0))}</div>
       <div class="opt">ゲームの速さ ${seg('speed', [[1, '通常'], [0.5, '1/2'], [0.25, '1/4']], tr.speed)}</div>
       <div class="opt">コンボ・ダメージ表示 ${seg('info', [['on', 'する'], ['off', 'しない']], tr.showInfo ? 'on' : 'off')}</div>
     </div>
     <div class="footer">
       <button class="btn" id="quit">練習をやめる</button>
       <div class="row" style="gap:8px">
         <button class="btn" id="moves">技表</button>
         <button class="btn" id="reset">位置リセット</button>
         <button class="btn primary" id="resume">続ける</button>
       </div>
     </div>`,
    'overlay',
    (root) => {
      const syncCpu = () => root.querySelector<HTMLElement>('[data-cpu]')!.classList.toggle('hidden', tr.mode !== 'cpu');
      syncCpu();
      bindSeg(root, 'mode', (v) => {
        tr.mode = v as DummyMode;
        syncCpu();
      });
      bindSeg(root, 'lv', (v) => (tr.cpuLevel = Number(v)));
      bindSeg(root, 'dpct', (v) => dm && (dm.damage = Number(v)));
      bindSeg(root, 'mpct', (v) => me && (me.damage = Number(v)));
      bindSeg(root, 'speed', (v) => (tr.speed = Number(v)));
      bindSeg(root, 'info', (v) => {
        tr.showInfo = v === 'on';
        if (!tr.showInfo) comboEl.classList.add('hidden');
      });
      const resume = () => {
        s.paused = false;
        clearScreen();
      };
      root.querySelector('#resume')!.addEventListener('click', resume);
      root.querySelector('#reset')!.addEventListener('click', () => {
        resetTrainingPositions(s);
        resume();
      });
      root.querySelector('#moves')!.addEventListener('click', () => showMoveList(s.setup.players[0].charId, () => showTrainingMenu(s)));
      root.querySelector('#quit')!.addEventListener('click', endToMenu);
    },
  );
}

/** 技表：通常技（ダメージつき）・必殺技・つかみ・溜め攻撃と、操作 */
function showMoveList(charId: string, back: () => void): void {
  const c = getCharacter(charId);
  const d = (id: Parameters<typeof moveOf>[1]) => (moveOf(charId, id).dmg * c.dmgMul).toFixed(1);
  const normals: [string, string, string][] = [
    ['弱攻撃', 'A', d('jab')],
    ['横攻撃', '横＋A', d('side')],
    ['上攻撃', '上＋A', d('up')],
    ['下攻撃', '下＋A', d('down')],
    ['スマッシュ攻撃', '横にはじく＋A（押し続けると溜め）', d('smash')],
    ['溜め攻撃', 'Aを押し続ける', d('charge')],
    ['空中攻撃', '空中でA', d('nair')],
    ['空中前攻撃', '空中で前＋A', d('fair')],
    ['空中後ろ攻撃', '空中で後ろ＋A', d('bair')],
    ['空中上攻撃', '空中で上＋A', d('uair')],
    ['空中下攻撃', '空中で下＋A', d('dair')],
    ['つかみ攻撃', 'つかみ中にA', d('pummel')],
    ['前投げ／後ろ投げ', 'つかみ中にスティック', `${d('fthrow')}／${d('bthrow')}`],
    ['上投げ／下投げ', 'つかみ中にスティック', `${d('uthrow')}／${d('dthrow')}`],
  ];
  const descs = SPECIAL_DESCS[c.id] ?? SPECIAL_DESCS.guard;
  const sp: [string, string, string][] = [
    ['B', c.specialNames.n, descs.n],
    ['横＋B', c.specialNames.s, descs.s],
    ['下＋B', c.specialNames.d, descs.d],
    ['上＋B', c.specialNames.u, descs.u],
  ];
  showScreen(
    `<h2>技表：${c.name}</h2>
     <div class="movelist">
       <div class="ml-trait"><span class="tag">特性</span><b>${c.trait.name}</b>：${c.trait.desc}</div>
       <div class="ml-head">必殺技</div>
       ${sp.map(([k, n, t]) => `<div class="ml-sp"><span class="key">${k}</span><b>${n}</b><div>${t}</div></div>`).join('')}
       <div class="ml-head">通常技（ダメージは溜め・強化なしの値）</div>
       <div class="ml-grid">${normals.map(([n, k, v]) => `<div class="ml-n"><b>${n}</b><span>${k}</span><em>${v}%</em></div>`).join('')}</div>
       <div class="ml-note">つかみはガード中にA。投げの方向は、つかんでいる人の向きが基準です。</div>
     </div>
     <div class="footer"><button class="btn primary" id="back">もどる</button></div>`,
    'overlay',
    (root) => root.querySelector('#back')!.addEventListener('click', back),
  );
}

// ---------------------------------------------------------------------------
// ボタン配置の編集：ボタンを指でドラッグして動かす。左利き（スティックが右）にも切り替えられる
function showButtonEditor(): void {
  const draft = { leftHanded: settings.leftHanded, btnPos: { ...settings.btnPos }, btnSize: settings.btnSize, btnOpacity: settings.btnOpacity };
  const preview = () => {
    applyUiSettings({ ...settings, btnSize: draft.btnSize, btnOpacity: draft.btnOpacity });
    applyTouchLayout(draft);
  };
  touchEl.classList.remove('hidden');
  touchEl.classList.add('editing');
  input.editing = true;
  preview();
  const el = showScreen(
    `<div class="edit-bar">
       <div><b>ボタンの設定</b>：ボタンをドラッグして好きな位置に動かせます</div>
       <div class="row">
         <span>スティック</span>${seg('hand', [['right', '左側（右利き）'], ['left', '右側（左利き）']], draft.leftHanded ? 'left' : 'right')}
       </div>
       <div class="row">
         <span>大きさ</span>${seg('size', [['S', '小'], ['M', '中'], ['L', '大']], draft.btnSize)}
         <span>濃さ</span>${seg('op', [['low', 'うすい'], ['mid', 'ふつう'], ['high', 'こい']], draft.btnOpacity)}
       </div>
       <div class="row">
         <button class="btn small" id="reset">元に戻す</button>
         <button class="btn small" id="cancel">やめる</button>
         <button class="btn small primary" id="save">保存</button>
       </div>
     </div>`,
    'overlay edit-layout',
    (root) => {
      bindSeg(root, 'hand', (v) => {
        draft.leftHanded = v === 'left';
        // 左右を変えたら、動かした位置は一度リセットして標準の並びにする
        draft.btnPos = {};
        preview();
      });
      bindSeg(root, 'size', (v) => {
        draft.btnSize = v as Settings['btnSize'];
        preview();
      });
      bindSeg(root, 'op', (v) => {
        draft.btnOpacity = v as Settings['btnOpacity'];
        preview();
      });
      root.querySelector('#reset')!.addEventListener('click', () => {
        draft.btnPos = {};
        preview();
      });
      root.querySelector('#cancel')!.addEventListener('click', () => exit(false));
      root.querySelector('#save')!.addEventListener('click', () => exit(true));
    },
  );
  // ドラッグで動かす
  let dragging: { el: HTMLElement; id: number } | null = null;
  const down = (e: PointerEvent) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.pad-btn');
    if (!b || !touchEl.classList.contains('editing')) return;
    // 初めて動かすときは、今の見た目の位置を全部のボタンの出発点にする
    if (Object.keys(draft.btnPos).length === 0) {
      draft.btnPos = currentButtonPositions();
      applyTouchLayout(draft);
    }
    dragging = { el: b, id: e.pointerId };
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const x = Math.max(0.04, Math.min(0.96, e.clientX / window.innerWidth));
    const y = Math.max(0.08, Math.min(0.96, e.clientY / window.innerHeight));
    draft.btnPos[dragging.el.id] = { x, y };
    applyTouchLayout(draft);
  };
  const up = (e: PointerEvent) => {
    if (dragging && e.pointerId === dragging.id) dragging = null;
  };
  touchEl.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  const exit = (save: boolean) => {
    touchEl.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    touchEl.classList.remove('editing');
    input.editing = false;
    if (save) {
      settings.leftHanded = draft.leftHanded;
      settings.btnPos = draft.btnPos;
      settings.btnSize = draft.btnSize;
      settings.btnOpacity = draft.btnOpacity;
      saveSettings(settings);
      toast('ボタンの配置を保存しました');
    }
    applyUiSettings(settings);
    applyTouchLayout(settings);
    updateTouchVisibility();
    showSettings();
  };
  void el;
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
    // ロビーからキャラ選択を開いている間は画面を切り替えない（戻ったときに最新の内容を出す）
    if (screensEl.querySelector('[data-charsel]')) return;
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
  onReconnecting(attempt) {
    toast(`通信が切れました。つなぎ直しています…（${attempt}回目）`, 6000);
    if (session?.kind === 'net') hud.setNetInfo('再接続中…');
  },
  onReconnected() {
    toast('つなぎ直しました', 2000);
    // 離れている間に対戦が終わっていたら、ロビーへ戻る（対戦中なら start が届いて続きから）
    setTimeout(() => {
      if (session?.kind === 'net' && lobby && !lobby.inMatch) {
        startDemo();
        showLobby();
      }
    }, 600);
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
  net.connect(settings.serverUrl, code, true, settings.name || 'プレイヤー', settings.charId, myCostume(settings.charId));
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
        showCharSelect({
          title: `ルーム ${code} に参加：キャラを選ぶ`,
          slot: 0,
          current: settings.charId,
          nextLabel: '参加する',
          onBack: showJoin,
          onNext: () => {
            creating = false;
            showScreen(`<h2>接続中…</h2>`, 'overlay');
            net.connect(settings.serverUrl, code, false, settings.name || 'プレイヤー', settings.charId, myCostume(settings.charId));
          },
        });
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
    const tags = [p.slot === l.hostSlot ? '★' : '', p.slot === net.slot ? '（あなた）' : '', !p.cpu && !p.connected ? '（通信が切れています）' : ''].join('');
    return `<div class="pslot"><span class="dot" style="background:${hex(SLOT_COLORS[i])}"></span>
      <div><div>${esc(p.name)}${tags}</div><div style="font-size:11px;color:var(--muted)">${c.name}</div></div></div>`;
  }).join('');
  const rules = { ...l.rules };
  const maxCpu = MAX_PLAYERS - humans;
  const cpuLevel = cpus[0]?.cpuLevel ?? 3;
  const cpuOpts = Array.from({ length: maxCpu + 1 }, (_, i) => [i, String(i)] as [number, string]);
  const hostControls = isHost
    ? `<div class="opt-label">ステージ</div>
      ${stageCards(l.stageId)}
      <div class="setup-grid wide">
        <div class="opt">CPUの人数 ${seg('cpu', cpuOpts, cpus.length)}</div>
        <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], cpuLevel)}</div>
        ${ruleControls(rules)}
      </div>`
    : `<p class="help">ステージ：${getStage(l.stageId).name} ／ ルール：${l.rules.mode === 'stock' ? `ストック ${l.rules.stocks}` : `タイム ${l.rules.timeLimit / 60}分`}<br/>★のホストが開始するのを待っています…</p>`;
  const canStart = l.players.length >= 2 && !l.inMatch;
  showScreen(
    `<div data-lobby class="row" style="justify-content:space-between">
       <div><div style="font-size:12px;color:var(--muted)">ルームコード（友達に教えてください）</div><div class="code-big">${l.code}</div></div>
       <div class="players grow" style="max-width:560px">${slots}</div>
     </div>
     <div class="row my-char">
       <span class="dot" style="background:${hex(SLOT_COLORS[net.slot % SLOT_COLORS.length])}"></span>
       <div>あなたのキャラ：<b>${getCharacter(me?.charId ?? settings.charId).name}</b></div>
       <button class="btn small" id="change-char">キャラを変える</button>
     </div>
     ${hostControls}
     <div class="footer">
       <button class="btn" id="leave">抜ける</button>
       ${isHost ? `<button class="btn primary" id="start" ${canStart ? '' : 'disabled'}>対戦開始！</button>` : ''}
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#change-char')!.addEventListener('click', () =>
        showCharSelect({
          title: 'キャラを変える',
          slot: net.slot,
          current: me?.charId ?? settings.charId,
          nextLabel: 'これにする',
          onBack: showLobby,
          onNext: (id) => {
            net.setChar(id, myCostume(id));
            showLobby();
          },
        }),
      );
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
        bindStages(root, (v) => {
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
  /** 確認用：指定した組み合わせでCPU戦を始める */
  startLocal(setup: MatchSetup) {
    lastSetup = setup;
    startSession(new LocalSession(setup));
  },
};
