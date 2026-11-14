// アプリ全体の流れ：画面の切り替え、CPU戦、オンライン戦

import './styles.css';
import { CpuController } from '../shared/ai';
import { CHARACTERS, getCharacter, playerColor, SLOT_COLORS, SPECIAL_DESCS, TEAM_COLORS, TEAM_NAMES } from '../shared/characters';
import { MAX_PLAYERS, isRoomCode, type LobbyInfo } from '../shared/protocol';
import { COUNTDOWN_FRAMES, HORDE, Sim } from '../shared/sim';
import { moveOf } from '../shared/moves';
import { STAGES, getStage } from '../shared/stages';
import { BTN_JUMP, BTN_SHIELD, DEFAULT_HP, TEAM_COUNT, type GameEvent, type InputState, type MatchRules, type MatchSetup, type ResultEntry, type ViewState } from '../shared/types';
import { Music, Sfx, type TrackId } from './audio';
import { Hud } from './hud';
import { ICONS, iconTile } from './icons';
import logoUrl from './assets/logo.png';
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
import { checkTitles, gachaBadge, markGachaSeen, markRecordsSeen, recordsBadge, HORDE_CPU_LEVEL, HORDE_LEVEL_STEP, hordeReward, loadProgress, MISSION_BONUS, MISSION_REWARD, missionGoal, missionText, recordMatch, refreshMissions, saveProgress, TITLES, type MatchStats } from './progress';
import { claimLogin, DUP_REFUND, GACHA_COST, LOGIN_REWARDS, loadWallet, PITY_LIMIT, pullGacha, recordWin, saveWallet, SSR_RATE, type PullResult } from './wallet';
import { COSTUMES, getCostume, rarityName } from '../shared/costumes';

registerServiceWorker();
preventZoomGestures();

const settings: Settings = loadSettings();
const wallet = loadWallet();
const progress = loadProgress();

/** 対戦中の自分の行動を数える（ミッション・戦績用） */
const tally = { specials: 0, throws: 0, smashes: 0, taunts: 0, items: 0, prevMove: '' as string | null };
function resetTally(): void {
  Object.assign(tally, { specials: 0, throws: 0, smashes: 0, taunts: 0, items: 0, prevMove: '' });
}
function countTally(view: ViewState, events: GameEvent[], mySlot: number | null): void {
  if (mySlot === null || mySlot < 0) return;
  const f = view.fighters.find((x) => x.slot === mySlot);
  if (!f) return;
  const mv = f.state === 'attack' ? f.move : null;
  if (mv && mv !== tally.prevMove) {
    if (mv.endsWith('special')) tally.specials++;
    else if (mv.endsWith('throw')) tally.throws++;
    else if (mv === 'smash' || mv === 'charge') tally.smashes++;
    else if (mv === 'taunt') tally.taunts++;
  }
  tally.prevMove = mv;
  for (const e of events) if (e.k === 'item' && e.s === mySlot) tally.items++;
}
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

  /** CPUの強さ。100人組手の敵は、倒した数が増えるほど強くなる */
  private cpuLevel(base: number): number {
    if (!this.setup.rules.horde) return base;
    return Math.min(9, base + Math.floor(this.sim.hordeDefeated / HORDE_LEVEL_STEP) * 2);
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
          else if (p.cpu) inputs.set(f.slot, this.ai.think(this.sim, f, tr ? tr.cpuLevel : this.cpuLevel(p.cpuLevel)));
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

/** 画質の自動調整：「きれい」で動きが重い（平均45fps未満が続く）ときは「軽さ優先」に切り替える */
const autoQ = {
  elapsed: 0,
  frames: 0,
  time: 0,
  done: false,
  reset() {
    this.elapsed = this.frames = this.time = 0;
    this.done = false;
  },
  tick(dt: number) {
    if (this.done || !settings.autoQuality || settings.quality !== 'high') return;
    this.elapsed += dt;
    if (this.elapsed < 5) return; // 始まってすぐ（読み込み直後）は数えない
    this.frames++;
    this.time += dt;
    if (this.time < 6) return;
    const fps = this.frames / this.time;
    this.frames = this.time = 0;
    if (fps < 45) {
      this.done = true;
      settings.quality = 'low';
      saveSettings(settings);
      renderer.setQuality('low');
      toast(`動作が重いため、画質を「軽さ優先」にしました（${Math.round(fps)}fps）。設定で戻せます。`, 5000);
    }
  },
};

function startSession(s: Session): void {
  renderer.hidePreview();
  if (!(s instanceof LocalSession && s.training && tutorialStarting)) stopTutorial();
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
  // HUDの顔アイコン（キャラと衣装ごとに作って使い回す）
  const faces: Record<number, string> = {};
  for (const p of s.setup.players) faces[p.slot] = renderer.portrait(p.charId, p.costume);
  hud.setup(s.setup, s.mySlot, isTraining, faces);
  autoQ.reset();
  resetTally();
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
  // 観戦中（自分の選手がいない）はボタンを出さない
  const inGame = session && session.kind !== 'demo' && !(session.kind === 'net' && (session.mySlot ?? -1) < 0);
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
      countTally(lastView, events, session.mySlot);
      // ピンチ（残り30秒・自分が最後の1機）でBGMを盛り上げる。練習モードは除く
      if (!(session instanceof LocalSession && session.training)) {
        const me = session.mySlot !== null ? lastView.fighters.find((f) => f.slot === session!.mySlot) : undefined;
        const timePinch = lastView.timeLeft > 0 && lastView.timeLeft < 30 * 60 && lastView.countdown <= 0;
        const rules = session.setup.rules;
        // 100人組手はいつも残り1機なので、ダメージが溜まったらピンチ
        const stockPinch = rules.horde ? !!me && me.damage >= 100 && !me.out : rules.mode !== 'time' && !!me && me.stocks === 1 && !me.out;
        music.setPinch(!lastView.ended && (timePinch || stockPinch));
      }
      autoQ.tick(dt);
      if (session instanceof LocalSession && session.training) combo.update(lastView, events, dt);
      if (tutorial && session instanceof LocalSession) updateTutorial(session, lastView, events, dt);
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
  // キャラ選択の3D表示は、キャラ選択画面（showCharSelect）でだけ出す。メニューのキャラも消す（メニューを出すときに出し直す）
  renderer.hidePreview();
  renderer.setMenuChar(null);
  screensEl.innerHTML = '';
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  // 下のボタン列（.footer）がある画面は、中身とボタンを別の段に分ける（ボタンが文字の上に重ならないように）。
  // 中身だけがスクロールし、ボタンはいつも一番下に見える
  const footer = [...el.children].find((c) => c.classList.contains('footer'));
  if (footer) {
    const body = document.createElement('div');
    body.className = 'screen-body';
    for (const c of [...el.children]) if (c !== footer) body.appendChild(c);
    el.insertBefore(body, footer);
    el.classList.add('has-footer');
  }
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
          sfx.jingle(picked);
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

/** ルールの短い説明（ロビーの表示用） */
function ruleText(r: MatchRules): string {
  const base = r.mode === 'stock' ? `ストック ${r.stocks}` : r.mode === 'stamina' ? `体力制 HP${r.hp ?? DEFAULT_HP}・残機${r.stocks}` : `タイム ${r.timeLimit / 60}分`;
  return r.teams ? `${base}・チーム戦（味方への攻撃${r.friendlyFire ? 'あり' : 'なし'}）` : base;
}

function ruleControls(rules: MatchRules): string {
  return `
    <div class="opt">ルール ${seg('mode', [['stock', 'ストック'], ['time', 'タイム'], ['stamina', '体力制']], rules.mode)}</div>
    <div class="opt" data-show="stock stamina">残機 ${seg('stocks', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], rules.stocks)}</div>
    <div class="opt" data-show="stamina">HP ${seg('hp', [[100, '100'], [150, '150'], [200, '200'], [300, '300']], rules.hp ?? DEFAULT_HP)}</div>
    <div class="opt" data-show="time">時間 ${seg('time', [[120, '2分'], [180, '3分'], [300, '5分']], rules.timeLimit)}</div>
    <div class="opt">チーム戦 ${seg('teams', [['on', 'あり'], ['off', 'なし']], rules.teams ? 'on' : 'off')}</div>
    <div class="opt" data-team>味方への攻撃 ${seg('ff', [['off', '当たらない'], ['on', '当たる']], rules.friendlyFire ? 'on' : 'off')}</div>
    <div class="opt">アイテム ${seg('items', [['on', 'あり'], ['off', 'なし']], rules.items ? 'on' : 'off')}</div>
    <div class="opt">ステージギミック ${seg('gim', [['on', 'あり'], ['off', 'なし']], rules.gimmicks ? 'on' : 'off')}</div>`;
}

function bindRules(root: HTMLElement, rules: MatchRules, onChange: () => void): void {
  const sync = () => {
    root.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => el.classList.toggle('hidden', !el.dataset.show!.split(' ').includes(rules.mode)));
    root.querySelectorAll<HTMLElement>('[data-team]').forEach((el) => el.classList.toggle('hidden', !rules.teams));
  };
  sync();
  bindSeg(root, 'mode', (v) => {
    rules.mode = v as MatchRules['mode'];
    rules.timeLimit = rules.mode === 'time' ? 180 : 420;
    sync();
    onChange();
  });
  bindSeg(root, 'hp', (v) => {
    rules.hp = Number(v);
    onChange();
  });
  bindSeg(root, 'teams', (v) => {
    rules.teams = v === 'on';
    sync();
    onChange();
  });
  bindSeg(root, 'ff', (v) => {
    rules.friendlyFire = v === 'on';
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
  bindSeg(root, 'items', (v) => {
    rules.items = v === 'on';
    onChange();
  });
  bindSeg(root, 'gim', (v) => {
    rules.gimmicks = v === 'on';
    onChange();
  });
}

function showTitle(): void {
  const tip = isIOS && !isStandalone() ? `<p class="install-tip">Safari の共有ボタン →「ホーム画面に追加」で、全画面で遊べます。</p>` : '';
  showScreen(
    `<img class="logo-img" src="${logoUrl}" alt="トバセ！" draggable="false"/>
     <div class="row" style="justify-content:center">
       <label class="field">なまえ<input type="text" id="name" maxlength="10" placeholder="プレイヤー" value="${esc(settings.name)}"/></label>
     </div>
     <button class="btn primary" id="go">${new URLSearchParams(location.search).get('room') ? `はじめる（ルーム ${esc(new URLSearchParams(location.search).get('room') ?? '')} に参加）` : 'はじめる'}</button>
     ${tip}`,
    'overlay title-screen',
    (root) => {
      root.querySelector('#go')!.addEventListener('click', () => {
        unlockAudio();
        settings.name = (root.querySelector('#name') as HTMLInputElement).value.trim().slice(0, 10);
        saveSettings(settings);
        // 招待リンクから開いたときは、そのルームへの参加に進む
        const room = new URLSearchParams(location.search).get('room');
        if (room && isRoomCode(room) && settings.serverUrl) {
          history.replaceState(null, '', location.pathname);
          joinRoom(room, () => showMenu());
          return;
        }
        if (!progress.tutorialDone && !progress.tutorialAsked) {
          progress.tutorialAsked = true;
          saveProgress(progress);
          showScreen(
            `<h2>はじめての人へ</h2>
             <p class="help">操作を順番に体験できるチュートリアルがあります（2〜3分）。<br/>最後までやると <span class="coin-icon"></span>100 コインもらえます。あとからメニューの「遊び方」からも始められます。</p>
             <div class="footer"><button class="btn" id="later">あとで</button><button class="btn primary" id="tut">チュートリアルをやる</button></div>`,
            'overlay',
            (r) => {
              r.querySelector('#later')!.addEventListener('click', () => showMenu());
              r.querySelector('#tut')!.addEventListener('click', startTutorial);
            },
          );
          return;
        }
        showMenu();
      });
    },
  );
}

/**
 * メニュー（レイアウトA）：左に選んでいるキャラ（3D・タップで変更）、右に大きなボタン4つ。
 * 「ひとりで」「みんなで」は、右の列がそのまま小さなメニューに切り替わる。
 */
function showMenu(sub: 'solo' | 'multi' | null = null): void {
  const online = !!settings.serverUrl;
  refreshMissions(progress);
  const done = progress.missions.list.filter((m) => m.done).length;
  const dot = (on: boolean) => (on ? '<span class="m-dot"></span>' : '');
  // アイコンの台の色（ボタンごと）
  const tile: Record<string, string> = {
    solo: '#ff8a3d', multi: '#3d8bff', gacha: '#ff4fa3', records: '#e0a800',
    cpu: '#ff8a3d', horde: '#e5484d', training: '#2fbf71', create: '#3d8bff', join: '#8a5cff',
  };
  const big = (id: string, _icon: string, title: string, desc: string, extra = '', cls = '') =>
    `<button class="m-btn ${cls}" id="${id}">${iconTile(id, tile[id] ?? '#555')}<span class="m-tx"><b>${title}</b><small>${desc}</small></span>${extra}</button>`;
  const col =
    sub === 'solo'
      ? `<div class="m-subhead"><button class="btn small" id="m-back">‹ もどる</button><b>ひとりで</b></div>
         ${big('cpu', '🤖', 'CPUと対戦', 'ステージとルールを選んで対戦', '', 'primary')}
         ${big('horde', '🔥', '100人組手', progress.hordeBest ? `自己ベスト ${progress.hordeBest.kos}人` : '次々に来る敵を倒す')}
         ${big('training', '🥊', '練習モード', '技やコンボを試す')}`
      : sub === 'multi'
        ? `<div class="m-subhead"><button class="btn small" id="m-back">‹ もどる</button><b>みんなで</b></div>
           ${big('create', '🏠', 'ルームを作る', online ? '友達とオンライン対戦' : 'サーバーが設定されていません', '', online ? 'primary' : 'off')}
           ${big('join', '🔢', 'コードで参加', online ? '4桁の合言葉を入力' : 'サーバーが設定されていません', '', online ? '' : 'off')}`
        : `${big('solo', '🎮', 'ひとりで', 'CPU対戦・100人組手・練習', '', 'primary')}
           ${big('multi', '🌐', 'みんなで', 'ルームを作る・コードで参加')}
           ${big('gacha', '🎁', 'ガチャ・衣装', '衣装を引く・着替える', dot(gachaBadge(progress, wallet, GACHA_COST.one)))}
           ${big('records', '🏆', '戦績・ミッション', '今日のミッション', `<span class="m-prog">${done}/3</span>${dot(recordsBadge(progress))}`)}`;
  const c = getCharacter(settings.charId);
  const cos = getCostume(myCostume(settings.charId), settings.charId);
  showScreen(
    `<div class="m-char" id="m-char"></div>
     <div class="m-top">
       <img class="m-logo" src="${logoUrl}" alt="トバセ！" draggable="false"/>
       <div class="grow"></div>
       ${coinBadge()}
       ${canInstall() ? `<button class="m-icon" id="install" title="ホーム画面に追加">${ICONS.install}</button>` : ''}
       <button class="m-icon" id="howto" title="遊び方">${ICONS.help}</button>
       <button class="m-icon" id="settings" title="設定">${ICONS.settings}</button>
     </div>
     <div class="m-plate"><div class="r">${c.name}</div><div class="n">${cos.name}</div><div class="t">タップでキャラ・衣装を変更</div></div>
     <div class="m-col">${col}</div>`,
    'menu-screen',
    (root) => {
      const on = (id: string, f: () => void) => root.querySelector('#' + id)?.addEventListener('click', f);
      on('solo', () => showMenu('solo'));
      on('multi', () => showMenu('multi'));
      on('m-back', () => showMenu());
      on('cpu', showLocalSetup);
      on('horde', () => showCharSelect({ title: '100人組手：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'はじめる', onBack: () => showMenu('solo'), onNext: () => startHorde() }));
      on('training', () => showCharSelect({ title: '練習モード：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'つぎへ', onBack: () => showMenu('solo'), onNext: () => showTrainingSetup() }));
      if (online) {
        on('create', () => showCharSelect({ title: 'ルームを作る：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: 'ルームを作る', onBack: () => showMenu('multi'), onNext: () => createRoom(0) }));
        on('join', showJoin);
      } else {
        on('create', () => toast('オンライン対戦のサーバーが設定されていません（設定画面で指定できます）'));
        on('join', () => toast('オンライン対戦のサーバーが設定されていません（設定画面で指定できます）'));
      }
      on('gacha', showGacha);
      on('records', () => showRecords('missions'));
      on('howto', showHowTo);
      on('settings', showSettings);
      on('install', () => void promptInstall().then(() => showMenu()));
      // 左のキャラ：なぞると回り、タップするとキャラ・衣装の変更へ
      const hit = root.querySelector<HTMLElement>('#m-char')!;
      let lastX: number | null = null;
      let startX = 0;
      let startY = 0;
      hit.addEventListener('pointerdown', (e) => {
        lastX = startX = e.clientX;
        startY = e.clientY;
        hit.setPointerCapture(e.pointerId);
      });
      hit.addEventListener('pointermove', (e) => {
        if (lastX === null) return;
        renderer.spinMenuChar((e.clientX - lastX) * 0.02);
        lastX = e.clientX;
      });
      hit.addEventListener('pointerup', (e) => {
        if (lastX === null) return;
        lastX = null;
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) {
          sfx.click();
          showCharSelect({ title: 'キャラ・衣装を変える', slot: 0, current: settings.charId, nextLabel: '決定', onBack: () => showMenu(), onNext: () => showMenu() });
        }
      });
      if (sub) return;
      // ログインボーナス（その日はじめてメニューを開いたとき）
      const bonus = claimLogin(wallet);
      const newTitles = checkTitles(progress, wallet);
      if (newTitles.length) {
        saveProgress(progress);
        saveWallet(wallet);
        root.querySelector('.coin-badge')!.outerHTML = coinBadge();
        toast(newTitles.map((t) => `称号「${t.name}」を手に入れた！ +${t.coins}`).join(' / '), 4000);
      }
      if (bonus) {
        saveWallet(wallet);
        root.querySelector('.coin-badge')!.outerHTML = coinBadge();
        showLoginBonus(root, bonus.day, bonus.amount);
      }
    },
  );
  renderer.setMenuChar(settings.charId, myCostume(settings.charId));
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
  if (screensEl.querySelector('.menu-screen')) showMenu();
});

function showLocalSetup(): void {
  showCharSelect({
    title: 'CPUと対戦：キャラを選ぶ',
    slot: 0,
    current: settings.charId,
    nextLabel: 'つぎへ',
    onBack: () => showMenu('solo'),
    onNext: () => showLocalRules(),
  });
}

/** CPU戦のチーム分け（あなた・CPU1〜5）。はじめは あなた=赤、CPUは青・赤…と交互 */
const localTeams = [0, 1, 0, 1, 0, 1];

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
     <div class="team-pick" data-team></div>
     <div class="footer"><button class="btn" id="back">キャラ選択へ</button><button class="btn primary" id="start">対戦開始！</button></div>`,
    'overlay',
    (root) => {
      // チーム分け（タップでチームが変わる）
      const teamBox = root.querySelector<HTMLElement>('.team-pick')!;
      const drawTeams = () => {
        const names = ['あなた', ...Array.from({ length: settings.cpuCount }, (_, i) => `CPU${i + 1}`)];
        teamBox.innerHTML =
          `<div class="opt-label">チーム分け（タップで変える）</div>` +
          names.map((n, i) => `<button type="button" class="team-chip" data-i="${i}" style="--tc:${hex(TEAM_COLORS[localTeams[i]])}">${n}<b>${TEAM_NAMES[localTeams[i]]}</b></button>`).join('');
      };
      drawTeams();
      teamBox.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.team-chip');
        if (!b) return;
        const i = Number(b.dataset.i);
        localTeams[i] = (localTeams[i] + 1) % TEAM_COUNT;
        sfx.click();
        drawTeams();
      });
      bindStages(root, (v) => (settings.stageId = v));
      bindSeg(root, 'cpu', (v) => {
        settings.cpuCount = Number(v);
        drawTeams();
      });
      bindSeg(root, 'lv', (v) => (settings.cpuLevel = Number(v)));
      bindRules(root, rules, () => (settings.rules = { ...rules }));
      root.querySelector('#back')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        showLocalSetup();
      });
      root.querySelector('#start')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        const teamsUsed = new Set(localTeams.slice(0, settings.cpuCount + 1));
        if (rules.teams && teamsUsed.size < 2) return toast('チーム戦は2チーム以上に分けてください');
        saveSettings(settings);
        const players: MatchSetup['players'] = [{ slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId), team: localTeams[0] }];
        // CPUは自分以外のキャラから順に選ぶ
        const others = CHARACTERS.filter((c) => c.id !== settings.charId);
        const offset = (Math.random() * others.length) | 0;
        for (let i = 1; i <= settings.cpuCount; i++) {
          players.push({ slot: i, name: `CPU ${settings.cpuLevel}`, charId: others[(offset + i - 1) % others.length].id, cpu: true, cpuLevel: settings.cpuLevel, team: localTeams[i] });
        }
        lastSetup = { players, stageId: settings.stageId, rules: settings.rules, seed: (Math.random() * 1e9) | 0 };
        startSession(new LocalSession(lastSetup));
      });
    },
  );
}

/** 100人組手を始める（自分＋敵3人。敵は倒されると次の敵が出てくる） */
function startHorde(): void {
  const others = CHARACTERS.filter((c) => c.id !== settings.charId);
  const offset = (Math.random() * others.length) | 0;
  const players: MatchSetup['players'] = [{ slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId) }];
  for (let i = 1; i <= 3; i++) players.push({ slot: i, name: '組手の相手', charId: others[(offset + i - 1) % others.length].id, cpu: true, cpuLevel: HORDE_CPU_LEVEL });
  lastSetup = { players, stageId: 'plain', rules: { mode: 'stock', stocks: 1, timeLimit: 0, horde: HORDE.size, items: false, gimmicks: false }, seed: (Math.random() * 1e9) | 0 };
  startSession(new LocalSession(lastSetup));
}

const fmtTime = (frames: number) => {
  const s = Math.max(0, Math.floor(frames / 60));
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
};

/** 100人組手の結果：倒した数・時間・自己ベスト */
function showHordeResults(setup: MatchSetup, view: ViewState | null): void {
  void keepAwake(false);
  touchEl.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  hud.show(false);
  const total = setup.rules.horde ?? HORDE.size;
  const kos = view?.horde ?? 0;
  const frames = Math.max(0, (view?.frame ?? 0) - COUNTDOWN_FRAMES);
  const clear = kos >= total;
  const me = view?.fighters.find((f) => f.slot === setup.players[0].slot);
  const prev = progress.hordeBest;
  const best = !prev || kos > prev.kos || (kos === prev.kos && clear && frames < prev.frames);
  if (best) progress.hordeBest = { kos, frames, charId: setup.players[0].charId };
  const coins = hordeReward(kos, total);
  wallet.coins += coins;
  const got = recordMatch(progress, wallet, {
    charId: setup.players[0].charId,
    won: clear,
    kos: me?.kos ?? 0,
    falls: me?.falls ?? 0,
    dealt: 0,
    throws: tally.throws,
    taunts: tally.taunts,
    specials: tally.specials,
    smashes: tally.smashes,
    items: tally.items,
  });
  saveProgress(progress);
  saveWallet(wallet);
  const lines = [
    ...got.missions.map((m) => `ミッション達成：${esc(m)} +${MISSION_REWARD}`),
    ...(got.bonus ? [`今日のミッションをすべて達成！ +${MISSION_BONUS}`] : []),
    ...got.titles.map((t) => `称号「${esc(t.name)}」を手に入れた！ +${t.coins}`),
  ];
  renderer.celebrate(clear ? setup.players[0].slot : null);
  if (clear) setTimeout(() => sfx.jingle(setup.players[0].charId), 300);
  music.play('menu');
  const pb = progress.hordeBest!;
  showScreen(
    `<h2 style="text-align:center">${clear ? '100人組手 クリア！' : '100人組手 終了'}</h2>
     <div class="horde-res">
       <div class="big">${kos}<small> / ${total}人</small></div>
       <div>時間 ${fmtTime(frames)}</div>
       ${best ? '<div class="new-best">自己ベスト更新！</div>' : `<div class="muted">自己ベスト：${pb.kos}人${pb.kos >= total ? `（${fmtTime(pb.frames)}）` : ''}</div>`}
     </div>
     ${coins ? `<div class="reward"><span class="coin-icon"></span>+${coins} コイン<small>（所持 ${wallet.coins.toLocaleString()}）</small></div>` : ''}
     ${lines.length ? `<div class="reward-sub">${lines.map((l) => `<div>🎉 ${l}</div>`).join('')}</div>` : ''}
     <div class="footer">
       <button class="btn" id="menu">メニューへ</button>
       <button class="btn primary" id="again">もう一度</button>
     </div>`,
    'overlay results-screen',
    (root) => {
      root.querySelector('#menu')!.addEventListener('click', endToMenu);
      root.querySelector('#again')!.addEventListener('click', startHorde);
    },
  );
}

function showResults(results: ResultEntry[], setup: MatchSetup, online: boolean): void {
  if (setup.rules.horde) return showHordeResults(setup, lastView);
  void keepAwake(false);
  touchEl.classList.add('hidden');
  pauseBtn.classList.add('hidden');
  hud.show(false);
  // 表彰：いちばん多い人（同じ数なら全員）に
  const awards = new Map<number, string[]>();
  const award = (label: string, val: (r: ResultEntry) => number, min = 1, lowest = false) => {
    const vals = results.map(val);
    const best = lowest ? Math.min(...vals) : Math.max(...vals);
    if (!lowest && best < min) return;
    if (lowest && results.every((r) => val(r) === best)) return; // 全員同じなら出さない
    for (const r of results) if (val(r) === best) awards.set(r.slot, [...(awards.get(r.slot) ?? []), label]);
  };
  if (results.length >= 2) {
    award('最多撃墜', (r) => r.kos);
    award('最大ダメージ', (r) => r.dealt ?? 0, 30);
    award('投げ名人', (r) => r.throws ?? 0, 2);
    award('鉄壁', (r) => r.falls, 0, true);
  }
  const rows = results
    .map((r) => {
      const p = setup.players.find((x) => x.slot === r.slot)!;
      const c = getCharacter(p.charId);
      const badges = (awards.get(r.slot) ?? []).map((a) => `<span class="award">${a}</span>`).join('');
      return `<div class="res-row ${r.rank === 1 ? 'first' : ''}">
        <div class="rank">${r.rank}</div>
        <div><span style="color:${hex(playerColor(setup, p.slot))}">●</span> ${setup.rules.teams ? `<small>${TEAM_NAMES[(p.team ?? 0) % TEAM_NAMES.length]}</small> ` : ''}${esc(p.name)} <small style="color:var(--muted)">${c.name}</small>${badges ? `<div class="awards">${badges}</div>` : ''}</div>
        <div style="font-size:12px;color:var(--muted);text-align:right">撃墜 ${r.kos} / 落下 ${r.falls}<br/>与ダメ ${r.dealt ?? 0}%${r.throws ? `・投げ ${r.throws}` : ''}</div></div>`;
    })
    .join('');
  const win = results.find((r) => r.rank === 1);
  const winner = win ? setup.players.find((p) => p.slot === win.slot) : null;
  if (winner) setTimeout(() => sfx.jingle(winner.charId), 300);
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
    }<small>（所持 __COINS__・通算 ${r.total} 勝）</small></div>`;
  }
  // 戦績・ミッション・称号（自分が戦った試合だけ）
  if (myResult) {
    const me = setup.players.find((p) => p.slot === mine)!;
    const stats: MatchStats = {
      charId: me.charId,
      won: myResult.rank === 1 && setup.players.length >= 2,
      kos: myResult.kos,
      falls: myResult.falls,
      dealt: myResult.dealt ?? 0,
      throws: tally.throws,
      taunts: tally.taunts,
      specials: tally.specials,
      smashes: tally.smashes,
      items: tally.items,
    };
    const got = recordMatch(progress, wallet, stats);
    saveProgress(progress);
    saveWallet(wallet);
    const lines = [
      ...got.missions.map((m) => `ミッション達成：${esc(m)} +${MISSION_REWARD}`),
      ...(got.bonus ? [`今日のミッションをすべて達成！ +${MISSION_BONUS}`] : []),
      ...got.titles.map((t) => `称号「${esc(t.name)}」を手に入れた！ +${t.coins}`),
    ];
    if (lines.length) reward += `<div class="reward-sub">${lines.map((l) => `<div>🎉 ${l}</div>`).join('')}</div>`;
  }
  // 所持コインは、勝利・ミッション・称号をすべて足したあとの数を出す
  reward = reward.replace('__COINS__', wallet.coins.toLocaleString());
  renderer.celebrate(win ? win.slot : null);
  music.play('menu');
  showScreen(
    `<h2 style="text-align:center">${winner ? (setup.rules.teams ? `${TEAM_NAMES[(winner.team ?? 0) % TEAM_NAMES.length]}チームの勝ち！` : esc(winner.name) + ' の勝ち！') : '結果'}</h2>
     ${reward}
     <div class="results">${rows}</div>
     <div class="footer">
       <button class="btn" id="menu">メニューへ</button>
       <div class="row" style="gap:8px">
         ${online ? '<button class="btn" id="lobby">ルームへ戻る</button>' : ''}
         ${online && lobby && lobby.hostSlot === net.slot ? '<button class="btn primary" id="rematch">同じメンバーで再戦</button>' : ''}
         ${online && !(lobby && lobby.hostSlot === net.slot) ? '<span class="muted">ホストが再戦を始めると、そのまま始まります</span>' : ''}
         ${!online ? '<button class="btn primary" id="again">もう一度</button>' : ''}
       </div>
     </div>`,
    'overlay results-screen',
    (root) => {
      root.querySelector('#menu')!.addEventListener('click', endToMenu);
      root.querySelector('#lobby')?.addEventListener('click', () => {
        startDemo();
        showLobby();
      });
      root.querySelector('#rematch')?.addEventListener('click', () => {
        // ロビーの設定（ステージ・ルール・CPU）のまま、すぐに始める
        net.start();
        toast('再戦を始めます');
      });
      root.querySelector('#again')?.addEventListener('click', () => {
        if (lastSetup) {
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
       <p><b>アピール：</b>ガード中にスティックを上にはじくと、キャラごとの一言（SSR衣装なら特別なセリフ）。</p>
       <p><b>体力制：</b>%のかわりにHPで戦います。HPが0になるとその場で撃墜。ふっとびは小さめなので、HPを削り切るのが基本です。</p>
       <p><b>チーム戦：</b>CPU戦はルール画面、オンラインはルームの枠をタップしてチームを分けます。「味方への攻撃：当たらない」なら、味方には攻撃も飛び道具も当たりません。</p>
       <p><b>100人組手：</b>1機だけで、次々に出てくる敵を100人倒すとクリア。10人倒すごとに少し回復し、30人倒すと敵が3人に増えます。</p>
       <p><b>アイテム・ステージギミック：</b>ルールで「あり」にすると、アイテム（回復・倍速・相手を止める・無敵）が落ちてきて、触れると使えます。ギミックはキャラ別ステージごとに違う仕掛け（強風・レーザー・スクーターなど）で、来る前に予告が出ます。</p>
       <p><b>崖：</b>ステージの端に近づくと自動でつかまります。スティック上かジャンプで上がります。</p>
       <p><b>クレジット：</b>キャラクター・BGM・効果音はすべてこのゲームのプログラムで作っています。</p>
       <p><b>キーボード：</b>矢印/WASD＝移動、J＝A、K＝B、スペース＝ジャンプ、L＝ガード、Esc＝メニュー。<b>ゲームパッド：</b>左＝A、右＝B、下・上＝ジャンプ、肩＝ガード。</p>
     </div>
     <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="tut">チュートリアルを始める${progress.tutorialDone ? '' : '（100コイン）'}</button></div>`,
    'overlay',
    (root) => {
      root.querySelector('#back')!.addEventListener('click', () => showMenu());
      root.querySelector('#tut')!.addEventListener('click', startTutorial);
    },
  );
}

function showSettings(): void {
  showScreen(
    `<h2>設定</h2>
     <div class="setup-grid">
       <div class="opt">ボタン（配置・大きさ・濃さ） <button type="button" class="btn small" id="layout">${settings.leftHanded ? '左利き・' : ''}${Object.keys(settings.btnPos).length ? '自分で配置' : '標準の配置'}・大きさ${{ S: '小', M: '中', L: '大' }[settings.btnSize]}（変える）</button></div>
       <div class="opt">画質 ${seg('q', [['low', '軽さ優先'], ['high', 'きれい']], settings.quality)}</div>
       <div class="opt">画質の自動調整（重いとき軽さ優先に） ${seg('aq', [['on', 'する'], ['off', 'しない']], settings.autoQuality ? 'on' : 'off')}</div>
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
      bindSeg(root, 'aq', (v) => (settings.autoQuality = v === 'on'));
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
// 戦績・ミッション・称号
function showRecords(tab: 'missions' | 'records' | 'titles'): void {
  refreshMissions(progress);
  // 赤い点：戦績・ミッション画面を開いたので消す
  markRecordsSeen(progress);
  saveProgress(progress);
  const day = progress.missions.day;
  let body = '';
  if (tab === 'missions') {
    body = `<div class="missions">${progress.missions.list
      .map((m) => {
        const goal = missionGoal(m.id);
        return `<div class="mission ${m.done ? 'done' : ''}"><div class="mt">${esc(missionText(m.id, day))}</div>
          <div class="bar"><div style="width:${Math.round((m.progress / goal) * 100)}%"></div></div>
          <div class="mp">${m.progress} / ${goal}　${m.done ? '達成！' : `<span class="coin-icon"></span>${MISSION_REWARD}`}</div></div>`;
      })
      .join('')}</div>
      <p class="muted">3つすべて達成すると、さらに <span class="coin-icon"></span>${MISSION_BONUS}（${progress.missions.bonus ? '受け取り済み' : '未達成'}）。ミッションは毎日入れ替わります。CPU戦・オンライン対戦で進みます（練習モードは対象外）。</p>`;
  } else if (tab === 'records') {
    const t = progress.totals;
    const hb = progress.hordeBest;
    body = `<div class="muted">通算：${t.matches}試合・${t.wins}勝・${t.kos}撃墜・投げ${t.throws}回・必殺技${t.specials}回</div>
      <div class="muted">100人組手のベスト：${hb ? `${hb.kos}人（${esc(getCharacter(hb.charId).name)}）${hb.kos >= HORDE.size ? `・${fmtTime(hb.frames)}` : ''}` : 'まだ遊んでいません'}</div>
      <table class="rec"><tr><th>キャラ</th><th>試合</th><th>勝利</th><th>勝率</th><th>撃墜</th><th>落下</th><th>与ダメ</th></tr>${CHARACTERS.map((c) => {
        const r = progress.records[c.id] ?? { matches: 0, wins: 0, kos: 0, falls: 0, dealt: 0 };
        return `<tr><td>${c.name}</td><td>${r.matches}</td><td>${r.wins}</td><td>${r.matches ? Math.round((r.wins / r.matches) * 100) + '%' : '-'}</td><td>${r.kos}</td><td>${r.falls}</td><td>${r.dealt}%</td></tr>`;
      }).join('')}</table>`;
  } else {
    body = `<div class="muted">手に入れた称号 ${progress.titles.length} / ${TITLES.length}（手に入れるとコインがもらえます）</div>
      <div class="titles">${TITLES.map((t) => {
        const have = progress.titles.includes(t.id);
        return `<div class="title-card ${have ? 'have' : ''}"><b>${have ? esc(t.name) : '？？？'}</b><div>${esc(t.cond)}</div><div class="muted"><span class="coin-icon"></span>${t.coins}</div></div>`;
      }).join('')}</div>`;
  }
  showScreen(
    `<div class="row" style="justify-content:space-between"><h2>戦績・ミッション</h2>${coinBadge()}</div>
     ${seg('tab', [['missions', '今日のミッション'], ['records', '戦績'], ['titles', '称号']], tab)}
     <div class="rec-body">${body}</div>
     <div class="footer"><button class="btn primary" id="back">もどる</button></div>`,
    'overlay',
    (root) => {
      bindSeg(root, 'tab', (v) => showRecords(v as 'missions' | 'records' | 'titles'));
      root.querySelector('#back')!.addEventListener('click', () => showMenu());
    },
  );
}

// ---------------------------------------------------------------------------
// 着せ替えガチャ
function showGacha(): void {
  // 赤い点：ガチャ画面を開いたので消す
  markGachaSeen(progress, wallet);
  saveProgress(progress);
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
      root.querySelector('#back')!.addEventListener('click', () => showMenu());
      root.querySelector('#list')!.addEventListener('click', () => showCollection(settings.charId));
      root.querySelector('#lineup')!.addEventListener('click', showLineup);
      const pull = (n: 1 | 10) => {
        const res = pullGacha(wallet, n);
        if (!res) return toast('コインが足りません');
        const titles = checkTitles(progress, wallet);
        if (titles.length) {
          saveProgress(progress);
          setTimeout(() => toast(titles.map((t) => `称号「${t.name}」を手に入れた！ +${t.coins}`).join(' / '), 4000), 2500);
        }
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
       <button class="btn" id="back">もどる</button>
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
       <button class="btn" id="back">もどる</button>
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
     <div class="lu-head">
       <h2>ガチャで出る衣装 <small class="h2-sub">持っている ${have} / ${pool.length}</small></h2>
       <button class="btn small" id="back">もどる</button>
     </div>
     <div class="lineup">${cards}</div>`,
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
// チュートリアル：練習モードの上で、操作を1つずつ体験する
interface TutorialStep {
  title: string;
  text: string;
  /** その段階を始めるときの準備 */
  setup?(s: LocalSession): void;
  /** 達成したか */
  done(s: LocalSession, view: ViewState, events: GameEvent[]): boolean;
}
let tutorial: { step: number; startX: number; count: number; wait: number } | null = null;
let tutorialStarting = false;
const tutorialEl = document.createElement('div');
tutorialEl.id = 'tutorial';
tutorialEl.className = 'hidden';
document.getElementById('app')!.appendChild(tutorialEl);

const TUTORIAL: TutorialStep[] = [
  { title: '移動', text: '画面の左半分をなぞるとスティックが出ます。左右に動いてみよう', done: (s, v) => Math.abs((v.fighters[0]?.x ?? 0) - tutorial!.startX) > 3 },
  { title: 'ジャンプ', text: 'ジャンプボタン（またはスティックを上にはじく）で跳ぼう。空中でもう一度押すと2段ジャンプ', done: (_s, _v, e) => e.some((x) => x.k === 'jump' && x.s === 0) },
  { title: '攻撃', text: 'Aボタンで攻撃。相手に近づいて当てよう', setup: (s) => placeNear(s), done: (_s, _v, e) => e.some((x) => x.k === 'hit' && x.a === 0) },
  { title: '必殺技', text: 'Bボタンで必殺技。スティックの向き（なし・横・下・上）で4種類あります', done: (_s, v) => (v.fighters[0]?.move ?? '').endsWith('special') },
  { title: 'スマッシュ攻撃', text: 'スティックを横にはじきながらAで強力なスマッシュ。Aを押し続けると溜められます', setup: (s) => placeNear(s), done: (_s, v) => v.fighters[0]?.move === 'smash' },
  { title: 'ガード', text: 'ガードボタンを押し続けると、攻撃を防げます（1秒ほど続けよう）', done: (_s, v) => {
    if (v.fighters[0]?.state === 'shield') tutorial!.count = Math.max(tutorial!.count, v.fighters[0].stateTime);
    return tutorial!.count > 60;
  } },
  { title: 'つかみ・投げ', text: 'ガード中にAで相手をつかみ、スティックを倒した方向へ投げよう', setup: (s) => placeNear(s), done: (_s, v) => (v.fighters[0]?.move ?? '').endsWith('throw') },
  { title: 'アピール', text: 'ガード中にスティックを上にはじくと、アピール！', done: (_s, _v, e) => e.some((x) => x.k === 'taunt' && x.s === 0) },
  {
    title: 'ふっとばそう',
    text: '相手のダメージ%が高いほど遠くへ飛びます。画面の外までふっとばしたら撃墜！（相手を150%にしました）',
    setup: (s) => {
      const d = s.sim.fighters.find((f) => f.slot === 1);
      if (d) d.damage = 150;
      placeNear(s);
    },
    done: (_s, _v, e) => e.some((x) => x.k === 'ko' && x.s === 1),
  },
];

function placeNear(s: LocalSession): void {
  const me = s.sim.fighters.find((f) => f.slot === 0);
  const d = s.sim.fighters.find((f) => f.slot === 1);
  if (!me || !d || !d.alive) return;
  d.x = me.x + (me.x < 4 ? 2 : -2);
  d.y = 0.05;
  d.vx = d.vy = 0;
  d.grounded = false;
  d.state = 'air';
}

function startTutorial(): void {
  tutorialStarting = true;
  const opts: TrainingOpts = { dummyChar: 'guard', mode: 'stand', cpuLevel: 1, speed: 1, showInfo: false };
  const setup: MatchSetup = {
    players: [
      { slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId) },
      { slot: 1, name: '練習相手', charId: 'guard', cpu: true, cpuLevel: 1 },
    ],
    stageId: 'plain',
    rules: { mode: 'stock', stocks: 99, timeLimit: 99 * 60 },
    seed: 1,
  };
  const s = new LocalSession(setup, false, opts);
  startSession(s);
  tutorialStarting = false;
  tutorial = { step: -1, startX: 0, count: 0, wait: 0 };
  nextTutorialStep(s);
}

function nextTutorialStep(s: LocalSession): void {
  if (!tutorial) return;
  tutorial.step++;
  tutorial.count = 0;
  tutorial.wait = 0;
  tutorial.startX = s.sim.fighters[0]?.x ?? 0;
  const st = TUTORIAL[tutorial.step];
  if (!st) return finishTutorial();
  st.setup?.(s);
  tutorialEl.classList.remove('hidden', 'ok');
  tutorialEl.innerHTML = `<div class="tu-step">チュートリアル ${tutorial.step + 1} / ${TUTORIAL.length}</div><div class="tu-title">${st.title}</div><div class="tu-text">${st.text}</div>`;
}

function updateTutorial(s: LocalSession, view: ViewState, events: GameEvent[], dt: number): void {
  const t = tutorial;
  if (!t) return;
  const st = TUTORIAL[t.step];
  if (!st) return;
  if (t.wait > 0) {
    // 「できた！」を少し見せてから次へ（秒）
    t.wait -= dt;
    if (t.wait <= 0) nextTutorialStep(s);
    return;
  }
  if (st.done(s, view, events)) {
    sfx.buff();
    tutorialEl.classList.add('ok');
    tutorialEl.querySelector('.tu-title')!.textContent = `${st.title}：できた！`;
    t.wait = 1.2;
  }
}

function finishTutorial(): void {
  const first = !progress.tutorialDone;
  progress.tutorialDone = true;
  saveProgress(progress);
  if (first) {
    wallet.coins += 100;
    saveWallet(wallet);
  }
  stopTutorial();
  if (session instanceof LocalSession) session.paused = true;
  showScreen(
    `<h2>チュートリアル完了！</h2>
     <p class="help">これで基本の操作はばっちりです。${first ? '<br/><span class="coin-icon"></span>100 コインをもらいました。' : ''}<br/>キャラごとの必殺技は、キャラ選択で技を長押しすると説明が見られます。</p>
     <div class="footer"><button class="btn" id="train">練習を続ける</button><button class="btn primary" id="menu">メニューへ</button></div>`,
    'overlay',
    (root) => {
      root.querySelector('#menu')!.addEventListener('click', endToMenu);
      root.querySelector('#train')!.addEventListener('click', () => {
        if (session instanceof LocalSession) session.paused = false;
        clearScreen();
      });
    },
  );
}

function stopTutorial(): void {
  tutorial = null;
  tutorialEl.classList.add('hidden');
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
/** 最後に参加しようとしたルームのコード（観戦に切り替えるため） */
let lastJoinCode = '';
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
    // 満員・対戦中なら、観戦を勧める
    if ((code === 'full' || code === 'inmatch') && !net.spectating && lastJoinCode) {
      const joinCode = lastJoinCode;
      showScreen(
        `<h2>${esc(msg)}</h2>
         <p class="help">観戦なら、満員でも対戦中でも入れます（見るだけ）。</p>
         <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="watch">観戦する</button></div>`,
        'overlay',
        (root) => {
          root.querySelector('#back')!.addEventListener('click', () => showMenu());
          root.querySelector('#watch')!.addEventListener('click', () => {
            showScreen(`<h2>接続中…</h2>`, 'overlay');
            net.connect(settings.serverUrl, joinCode, false, settings.name || 'プレイヤー', settings.charId, undefined, true);
          });
        },
      );
      return;
    }
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

/** ルームに参加する（キャラを選んでからつなぐ） */
function joinRoom(code: string, back: () => void): void {
  lastJoinCode = code;
  showCharSelect({
    title: `ルーム ${code} に参加：キャラを選ぶ`,
    slot: 0,
    current: settings.charId,
    nextLabel: '参加する',
    onBack: back,
    onNext: () => {
      creating = false;
      showScreen(`<h2>接続中…</h2>`, 'overlay');
      net.connect(settings.serverUrl, code, false, settings.name || 'プレイヤー', settings.charId, myCostume(settings.charId));
    },
  });
}

/** 招待リンク（開くとそのルームに参加する画面になる） */
function inviteUrl(code: string): string {
  return `${location.origin}${location.pathname}?room=${code}`;
}

async function shareInvite(code: string): Promise<void> {
  const url = inviteUrl(code);
  const text = `「トバセ！」で対戦しよう！ルームコード ${code}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'トバセ！', text, url });
      return;
    }
  } catch {
    // 共有をやめたときなど
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('招待リンクをコピーしました');
  } catch {
    toast(`招待リンク：${url}`, 6000);
  }
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
        joinRoom(code, showJoin);
      });
      root.querySelector('#back')!.addEventListener('click', () => showMenu('multi'));
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
    // チーム戦：自分の枠（ホストは全員の枠）をタップするとチームが変わる
    const team = p.team ?? 0;
    const canTap = !!l.rules.teams && !l.inMatch && (p.slot === net.slot || isHost);
    const dot = l.rules.teams ? TEAM_COLORS[team % TEAM_COLORS.length] : SLOT_COLORS[i];
    const teamTag = l.rules.teams ? `<span class="team-tag" style="--tc:${hex(dot)}">${TEAM_NAMES[team % TEAM_NAMES.length]}${canTap ? ' ⇄' : ''}</span>` : '';
    return `<div class="pslot ${canTap ? 'team-tap' : ''}" data-slot="${p.slot}" data-tm="${team}"><span class="dot" style="background:${hex(dot)}"></span>
      <div><div>${esc(p.name)}${tags} ${teamTag}</div><div style="font-size:11px;color:var(--muted)">${c.name}</div></div></div>`;
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
    : `<p class="help">ステージ：${getStage(l.stageId).name} ／ ルール：${ruleText(l.rules)} ／ アイテム${l.rules.items ? 'あり' : 'なし'} ／ ギミック${l.rules.gimmicks ? 'あり' : 'なし'}<br/>★のホストが開始するのを待っています…${l.rules.teams ? '<br/>自分の枠をタップするとチームを変えられます。' : ''}</p>`;
  const teamCount = new Set(l.players.map((p) => p.team ?? 0)).size;
  const canStart = l.players.length >= 2 && !l.inMatch && (!l.rules.teams || teamCount >= 2);
  showScreen(
    `<div data-lobby class="row" style="justify-content:space-between">
       <div><div style="font-size:12px;color:var(--muted)">ルームコード（友達に教えてください）</div><div class="code-big">${l.code}</div></div>
       <div class="players grow" style="max-width:560px">${slots}</div>
     </div>
     <div class="row my-char">
       ${
         net.spectating
           ? '<div><b>観戦中</b>（見るだけ。対戦が始まると見られます）</div>'
           : `<span class="dot" style="background:${hex(SLOT_COLORS[net.slot % SLOT_COLORS.length])}"></span>
       <div>あなたのキャラ：<b>${getCharacter(me?.charId ?? settings.charId).name}</b></div>
       <button class="btn small" id="change-char">キャラを変える</button>`
       }
       <button class="btn small" id="invite">招待リンクを送る</button>
       ${l.spectators ? `<span class="muted">観戦 ${l.spectators}人</span>` : ''}
     </div>
     ${hostControls}
     <div class="footer">
       <button class="btn" id="leave">抜ける</button>
       ${isHost && l.rules.teams && teamCount < 2 ? '<span class="muted">2チーム以上に分けてください</span>' : ''}
       ${isHost ? `<button class="btn primary" id="start" ${canStart ? '' : 'disabled'}>対戦開始！</button>` : ''}
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#invite')!.addEventListener('click', () => void shareInvite(l.code));
      root.querySelectorAll<HTMLElement>('.pslot.team-tap').forEach((el) =>
        el.addEventListener('click', () => {
          const slot = Number(el.dataset.slot);
          sfx.click();
          net.setTeam((Number(el.dataset.tm) + 1) % TEAM_COUNT, slot === net.slot ? undefined : slot);
        }),
      );
      root.querySelector('#change-char')?.addEventListener('click', () =>
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
