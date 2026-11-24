// アプリ全体の流れ：画面の切り替え、CPU戦、オンライン戦

import { IS_TEST } from './testEnv';
import './styles.css';
import { CpuController } from '../shared/ai';
import { ballTeamOf, CHARACTERS, RANDOM_CHAR, getCharacter, HIDDEN_CHARS, PREVIEW, PREVIEW_KEY, nameCpus, ITEM_INFO, ITEM_NAMES, playerColor, SLOT_COLORS, SPECIAL_DESCS, TEAM_COLORS, TEAM_NAMES } from '../shared/characters';
import { FREE_STAMPS, picStamp, PIC_STAMPS, setStampPortrait, tierName } from './stamps';
import { cardBgAttrs, CARD_BG_GROUPS, CARD_BGS } from './cardBgs';
import { ITEM_COST, ITEM_DUP_REFUND, itemCounts, ownsBg, pullItems, stampTier, type ItemPull } from './items';
import { MAX_PLAYERS, PREDICT_FRAMES, PREDICT_REWARD, predictCoins, predictOdds, STAMPS, isRoomCode, type LobbyInfo, type TourInfo } from '../shared/protocol';
import { matchAt, nextMatch, roundName, THIRD } from '../shared/tournament';
import { COUNTDOWN_FRAMES, HORDE, Sim, type Fighter } from '../shared/sim';
import { moveOf } from '../shared/moves';
import { RANDOM_STAGE, resolveStage, STAGES, getStage, stageFor } from '../shared/stages';
import { BTN_JUMP, BTN_SHIELD, DEFAULT_HP, isTwoTeam, TEAM_COUNT, type GameEvent, type InputState, type MatchRules, type MatchSetup, type PlayerSetup, type ResultEntry, type ViewState } from '../shared/types';
import { Music, Sfx, type TrackId } from './audio';
import { Hud } from './hud';
import { championMark, chatMark, diceMark, eyeMark, ICONS, iconTile, predictMark, rewardMark } from './icons';
import { markNewsSeen, NEWS, NEWS_LABEL, newsSeen, unreadNews } from './changelog';
import { applyData, issueTransfer, takeTransfer } from './transfer';
import logoUrl from './assets/logo.png';
import { DEBUTS, DebutSession, type DebutDef } from './debut';
import { InputManager } from './input';
import { SocialClient } from './social';
import { CardViewer } from './cardViewer';
import { DM_COOLDOWN_MS, DM_GROUPS, DM_PHRASES, DM_ROOM_PHRASE, PROFILE_COLORS, PROFILE_COMMENTS, type FriendInfo, type Profile } from '../shared/social';
import { clearRejoin, loadRejoin, NetClient } from './net';
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
import { checkTitles, MOVED_TITLES, RENAMED_TITLES, gachaBadge, markGachaSeen, markRecordsSeen, recordsBadge, HORDE_CPU_LEVEL, HORDE_LEVEL_STEP, hordeReward, loadProgress, MISSION_BONUS, MISSION_REWARD, missionGoal, missionText, recordMatch, refreshMissions, saveProgress, TITLES, TITLE_GROUPS, type MatchStats } from './progress';
import { claimLogin, DUP_REFUND, GACHA_COST, LOGIN_REWARDS, loadWallet, PITY_LIMIT, pullGacha, recordWin, saveWallet, SSR_RATE, UR_PITY_LIMIT, UR_RATE, urAvailable, WIN_DAILY_CAP, testGrantAll, type PullResult } from './wallet';

/** UR のカード・衣装ボタンの上に舞うキラキラの粒（中身は styles.css の .ur-sp） */
const URSP = '<i class="ur-sp" aria-hidden="true"></i>';
import { COSTUMES, GACHA_COSTUMES, getCostume, rarityName } from '../shared/costumes';

registerServiceWorker();
preventZoomGestures();

const settings: Settings = loadSettings();
const wallet = loadWallet();
// はじめて遊ぶ人には、これまでのアップデートのお知らせは出さない（遊んだことがある人だけに出す）
let firstLaunch = false;
try {
  firstLaunch = !localStorage.getItem('buttobi-progress-v1');
} catch {
  /* 読めない環境 */
}
if (firstLaunch && !newsSeen()) markNewsSeen();
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
setStampPortrait((charId, face, job) => renderer.portrait(charId, undefined, face, job));
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
  /** 自分の選手（必殺技の待ち時間の表示に使う。オンラインは先行表示の選手） */
  myFighter(): Fighter | null;
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

  myFighter(): Fighter | null {
    return this.mySlot === null ? null : this.sim.fighter(this.mySlot) ?? null;
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

  myFighter(): Fighter | null {
    return this.pred?.sim.fighter(this.mySlot) ?? null;
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
  // メニューのキャラは、本番の試合が始まったら消す（裏の戦闘＝デモの入れ替わりでは消さない）
  if (s.kind !== 'demo') renderer.setMenuChar(null);
  if (!(s instanceof LocalSession && s.training && tutorialStarting)) stopTutorial();
  session = s;
  resultsShown = false;
  // 戦い始めたら、DM の小窓は閉じる（戦っている最中は送れない）
  if (fightingNow()) closeDm();
  if (s.kind !== 'net') {
    hidePredict();
    hideDrop();
  }
  renderWatch();
  lastView = null;
  renderer.setMatch(s.setup, stageFor(s.setup.stageId, s.setup.players.length, !!s.setup.rules.horde));
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
  // 対戦の途中で抜けたときは、あとで戻れるように覚えておく（試合が終わってから抜けたときは忘れる）
  const midMatch = session?.kind === 'net' && !!lobby?.inMatch && !resultsShown;
  net.close();
  if (!midMatch) clearRejoin();
  else toast('試合が終わるまでは、「みんなで」から戻れます', 4000);
  social.shareRoom(null);
  startDemo();
  showMenu();
}

// ---------------------------------------------------------------------------
// 必殺技の待ち時間の表示：Bボタンに、今のスティックの向きで出る必殺技の残り時間（暗い扇形と秒数）と、
// 4つの必殺技（B・横B・下B・上B）それぞれの状態（点）。タッチボタンを使わないときは自分のHUDに出す
const SPECIAL_IDS = ['nspecial', 'sspecial', 'dspecial', 'uspecial'] as const;
const CD_KEY = { nspecial: 'cdN', sspecial: 'cdS', dspecial: 'cdD', uspecial: 'cdU' } as const;
const bBtn = document.getElementById('btn-b')!;
const cdSweep = bBtn.querySelector<HTMLElement>('.cd-sweep')!;
const cdSec = bBtn.querySelector<HTMLElement>('.cd-sec')!;
const cdDots = new Map(SPECIAL_IDS.map((id) => [id, bBtn.querySelector<HTMLElement>(`[data-cd="${id}"]`)!]));
let lastCdKey = '';
function updateCooldownUI(f: Fighter | null): void {
  const left: Record<string, number> = {};
  const frac: Record<string, number> = {};
  for (const id of SPECIAL_IDS) {
    const max = f ? moveOf(f.def.id, id, f.job).cd ?? 0 : 0;
    const l = f ? f[CD_KEY[id]] : 0;
    left[id] = l;
    frac[id] = max > 0 ? Math.min(1, l / max) : 0;
  }
  // 今のスティックの向きで出る必殺技
  const inp = readInput();
  const ax = Math.abs(inp.mx);
  const ay = Math.abs(inp.my);
  const cur = ay > 0.5 && ay >= ax ? (inp.my > 0 ? 'uspecial' : 'dspecial') : ax > 0.5 ? 'sspecial' : 'nspecial';
  const key = SPECIAL_IDS.map((id) => Math.ceil(frac[id] * 40)).join() + cur;
  if (key === lastCdKey) return;
  lastCdKey = key;
  bBtn.style.setProperty('--cd', frac[cur].toFixed(3));
  bBtn.classList.toggle('cooling', left[cur] > 0);
  cdSweep.style.opacity = left[cur] > 0 ? '1' : '0';
  cdSec.textContent = left[cur] > 0 ? (left[cur] / 60).toFixed(1) : '';
  const any = SPECIAL_IDS.some((id) => left[id] > 0);
  bBtn.classList.toggle('has-cd', any);
  for (const id of SPECIAL_IDS) {
    const d = cdDots.get(id)!;
    d.classList.toggle('wait', left[id] > 0);
    d.classList.toggle('cur', id === cur);
  }
  hud.setCooldowns(touchEl.classList.contains('hidden') && f ? SPECIAL_IDS.map((id) => frac[id]) : null);
}

// ---------------------------------------------------------------------------
// メインループ
let prevT = performance.now();
/** 残り10秒の音を最後に鳴らした秒 */
let lastTickSec = -1;
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
      updateCooldownUI(session.myFighter());
      if (session.kind === 'net') hud.setNetInfo(net.connected ? `通信 ${Math.round(net.rtt)}ms` : '再接続中…');
      playEvents(events, session.mySlot, lastView);
      // 残り10秒：1秒ごとに音（最後の3秒は高い音）
      {
        const secs = Math.ceil(lastView.timeLeft / 60);
        const timed = session.setup.rules.timeLimit > 0 && !session.setup.rules.horde && !(session instanceof LocalSession && session.training);
        if (timed && !lastView.sudden && !lastView.ended && lastView.countdown <= 0 && lastView.timeLeft > 0 && secs <= 10 && secs !== lastTickSec) {
          lastTickSec = secs;
          sfx.beep(secs <= 3);
        }
      }
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
        renderWatch();
        showResults(session.sim.results(), session.setup, false);
      }
    }
  }
  // 待ち受け画面のCPU同士の試合では、撃墜確定のスロー演出はしない
  if (session?.kind === 'demo') events = events.filter((e) => e.k !== 'finish');
  renderer.localSlot = session?.mySlot ?? null;
  renderer.render(lastView, dt, events);
  // 画面の外にいるキャラを、画面の端に顔と矢印で出す
  if (session && session.kind !== 'demo' && lastView) hud.updateOffscreen(lastView, (x, y) => renderer.project(x, y));
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
    else if (e.k === 'boom' || e.k === 'shout') sfx.boom();
    else if (e.k === 'sudden') sfx.finish();
    else if (e.k === 'rewind') sfx.warp();
    else if (e.k === 'crown') sfx.buff();
    else if (e.k === 'vhit') sfx.hit(Math.min(20, e.p));
    else if (e.k === 'vbreak') sfx.boom();
    else if (e.k === 'bpt') (e.b ? sfx.goal() : sfx.buff());
    else if (e.k === 'bnew') sfx.notify();
    else if (e.k === 'ring') sfx.notify();
    else if (e.k === 'heavy') sfx.buff();
    else if (e.k === 'alarm') sfx.alarm();
    else if (e.k === 'leashDmg') sfx.hit(Math.min(20, e.p));
    else if (e.k === 'cry') sfx.poof();
    else if (e.k === 'coin' && (e.s === mySlot || e.v > 1)) sfx.beep(true);
    else if (e.k === 'cdrop') sfx.poof();
    else if (e.k === 'kick') sfx.kick(e.p);
    else if (e.k === 'goal') sfx.goal();
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
  renderer.setMenuChar(null);
  screensEl.innerHTML = '';
}

// 画面の切り替え：進むときは右から、もどるときは左から、すっと入る。
// 同じ画面の描き直し（ロビーの更新など）では動かさない
let navBack = false;
let lastScreenKey = '';
screensEl.addEventListener(
  'click',
  (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (['back', 'm-back', 'to-menu', 'no'].includes(b.id) || /^(‹ )?もどる/.test(b.textContent?.trim() ?? '')) {
      navBack = true;
      setTimeout(() => (navBack = false), 500);
    }
  },
  true,
);

function showScreen(html: string, cls = '', bind?: (root: HTMLElement) => void): HTMLElement {
  // キャラ選択の3D表示は、キャラ選択画面（showCharSelect）でだけ出す。メニューのキャラも消す（メニューを出すときに出し直す）
  renderer.hidePreview();
  renderer.setMenuChar(null);
  screensEl.innerHTML = '';
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  // 画面の種類（見出しと種類）。変わったときだけ切り替えの動きを付ける
  const key = `${cls}|${(el.querySelector('h2')?.textContent ?? '').replace(/[0-9０-９]/g, '')}|${el.querySelector('.m-subhead')?.textContent ?? ''}`;
  if (key !== lastScreenKey && lastScreenKey) el.classList.add(navBack ? 'enter-back' : 'enter-fwd');
  lastScreenKey = key;
  navBack = false;
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

// ---------------------------------------------------------------------------
// フレンド：自分のフレンドコード・追加・届いた申請・フレンド一覧（オンライン・公開ルームへ参加）
/** フレンド画面で右に出している人（'me' = 自分、それ以外はフレンドコード） */
let friendPick = 'me';
/** フレンド画面の「フレンドを追加」の小窓を開いている */
let friendAddOpen = false;

/** その衣装を持っているか（確認用の ?preview では、まだ公開していないキャラの衣装は持っていることにする） */
function ownsCostume(id: string, charId: string): boolean {
  return wallet.owned.includes(id) || (PREVIEW && HIDDEN_CHARS.includes(charId));
}

/** 持っているガチャの衣装の数 */
const ownedCostumeCount = () => new Set(wallet.owned).size;

/** 自分のプロフィール（設定から組み立てる。数字は今の記録） */
function myProfile(): Profile {
  const p = settings.profile;
  const charId = p && CHARACTERS.some((c) => c.id === p.charId) ? p.charId : settings.charId;
  let costume = p ? p.costume : (myCostume(charId) ?? '');
  const c = COSTUMES.find((x) => x.id === costume && x.charId === charId);
  // 持っていない衣装（引き継ぎ前など）は、ふつうの衣装にする
  if (!c || (c.rarity >= 4 && !ownsCostume(c.id, c.charId))) costume = getCostume(undefined, charId).id;
  const titleNames = progress.titles.map((id) => TITLES.find((t) => t.id === id)?.name ?? '').filter(Boolean);
  let setTitle = p?.title ? RENAMED_TITLES[p.title] ?? p.title : '';
  const moved = MOVED_TITLES.find((m) => m.name === setTitle && !progress.titles.includes(m.to) && progress.titles.includes(m.from));
  if (moved) setTitle = TITLES.find((t) => t.id === moved.from)?.name ?? '';
  const title = setTitle && titleNames.includes(setTitle) ? setTitle : '';
  return {
    charId,
    costume,
    title,
    comment: p?.comment ?? 0,
    color: p?.color ?? 0,
    // 持っていない背景（引き継ぎ前など）は付けない
    bg: p?.bg && ownsBg(wallet, p.bg) ? p.bg : 0,
    wins: progress.totals.wins,
    horde: progress.hordeBest?.kos ?? 0,
    costumes: ownedCostumeCount(),
    pn: progress.pred?.n ?? 0,
    ph: progress.pred?.hit ?? 0,
    pc: progress.pred?.coins ?? 0,
    tw: progress.tour?.wins ?? 0,
    t3: progress.tour?.third ?? 0,
    t2: progress.tour?.second ?? 0,
    tc: progress.titles.length,
  };
}

/** 「3時間前」のような、いまからどれだけ前か */
function agoText(t: number): string {
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  const dt = new Date(t);
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
}

/** 名刺カード（案A）。p がなければ「未設定」のカード。together はフレンドのときだけ。myCode は自分のカードの名前の横に出すコード（タップでコピー） */
function profileCard(name: string, code: string, p: Profile | undefined, together?: number, myCode?: string): string {
  const nm = `<div class="pc-nmrow"><div class="pc-nm">${esc(name)}</div>${myCode !== undefined ? `<button type="button" class="pc-mycode" id="fr-copy" ${myCode ? '' : 'disabled'}><small>フレンドコード</small><b>${esc(myCode || '…')}</b><span>コピー</span></button>` : ''}</div>`;
  const [c1, c2] = PROFILE_COLORS[p?.color ?? 6] ?? PROFILE_COLORS[0];
  // フレンドコード（自分のカードでは出さない：フレンド画面の左に出ている）と、一緒に戦った回数（フレンドのとき）
  const meta = [code ? `フレンドコード ${esc(code)}` : '', together !== undefined ? `一緒に戦った ${together}回` : ''].filter(Boolean).join('　・　');
  if (!p) {
    return `<div class="pcard" style="--c1:${c1};--c2:${c2}">
      <div class="pc-pic empty">？</div>
      <div class="pc-r">${nm}
        <div class="pc-cos">まだプロフィールを設定していません</div>
        ${meta ? `<div class="pc-code">${meta}</div>` : ''}
      </div></div>`;
  }
  const cos = getCostume(p.costume, p.charId);
  const rar = rarityName(cos.rarity);
  // 成績：4つのグループ（対戦・トーナメント・予想・コレクション）に2つずつ。同じ幅の格子にそろえる
  // 狭い画面では短い言葉に切り替える（長い言葉 / 短い言葉）
  const lbl = (long: string, short = long) => (short === long ? long : `<span class="l">${long}</span><span class="s">${short}</span>`);
  const v = (val: string, label: string, sub = '') => `<div class="pc-v"><b>${val}</b><small>${label}</small>${sub ? `<small class="pc-sub">${sub}</small>` : ''}</div>`;
  const group = (head: string, a: string, b: string) => `<div class="pc-g"><div class="pc-gh">${head}</div>${a}${b}</div>`;
  const rate = p.pn ? `${Math.round(((p.ph ?? 0) / p.pn) * 100)}%` : '—';
  const stats = [
    group('対戦', v(String(p.wins), lbl('通算勝利', '勝利')), v(`${p.horde}人`, lbl('100人組手', '組手'))),
    group(lbl('トーナメント', '大会'), v(`${p.tw ?? 0}回`, '優勝'), v(`${p.t2 ?? 0}回`, '準優勝')),
    group(lbl('勝敗予想', '予想'), v(rate, '的中率', p.pn ? `${p.ph ?? 0}/${p.pn}` : ''), v((p.pc ?? 0).toLocaleString(), lbl('獲得コイン', 'コイン'))),
    // 衣装（ガチャで集める衣装）と称号は、持っている数 / 全部の数
    group(lbl('コレクション', '収集'), v(`${p.costumes}<span class="pc-of">/${GACHA_COSTUMES.length}</span>`, '衣装'), v(`${p.tc ?? 0}<span class="pc-of">/${TITLES.length}</span>`, '称号')),
  ].join('');
  const bg = cardBgAttrs(p.bg);
  return `<div class="pcard ${cos.rarity >= 6 ? 'ur' : ''} ${bg.cls}" style="--c1:${c1};--c2:${c2};${bg.style}">
    <div class="pc-pic" data-char="${p.charId}" data-cos="${esc(p.costume)}"><img alt="" src="${renderer.fullBody(p.charId, p.costume)}"/></div>
    <div class="pc-r">
      ${nm}
      ${p.title ? `<div><span class="pc-title">${rewardMark()}${esc(p.title)}</span></div>` : ''}
      <div class="pc-cos">お気に入り：${getCharacter(p.charId).name}「${esc(cos.name)}」${rar ? `（${rar}）` : ''}</div>
      <div class="pc-bub">${chatMark()}${esc(PROFILE_COMMENTS[p.comment] ?? '')}</div>
      ${meta ? `<div class="pc-code">${meta}</div>` : ''}
      <div class="pc-grid">${stats}</div>
    </div></div>`;
}

/** 名刺カードのキャラを3Dで動かす（入れ物は1つを使い回す）。タップするとアクション */
const cardViewer = new CardViewer();
function mountCardViewer(root: HTMLElement): void {
  const pic = root.querySelector<HTMLElement>('.pc-pic[data-char]');
  if (pic) cardViewer.mount(pic, pic.dataset.char!, pic.dataset.cos ?? '');
}

/** フレンド一覧の顔（プロフィールのキャラ。未設定なら名前の頭文字） */
function friendFace(name: string, p: Profile | undefined): string {
  return p ? `<img class="fr-face" alt="" src="${renderer.portrait(p.charId, p.costume)}"/>` : `<span class="fr-face none">${esc([...name][0] ?? '？')}</span>`;
}

function showFriends(): void {
  const st = social.state;
  const left = screensEl.querySelector<HTMLElement>('.fr-left');
  const y = left?.scrollTop ?? 0;
  const typed = screensEl.querySelector<HTMLInputElement>('#fr-code')?.value ?? '';
  // 小窓で入力中に画面が書き直されても、入力を続けられるようにする
  const typing = document.activeElement?.id === 'fr-code';
  const me = myProfile();
  social.setProfile(me);
  // 並び順：オンライン（ルーム公開中を含む）の人が先、その中で一緒に戦った回数が多い順。同じなら名前順
  const on = (f: (typeof st.friends)[number]) => Number(f.online || !!f.room);
  const sorted = [...st.friends].sort((a, b) => on(b) - on(a) || social.together(b.code) - social.together(a.code) || a.name.localeCompare(b.name));
  if (friendPick !== 'me' && !sorted.some((f) => f.code === friendPick)) friendPick = 'me';
  const rows = sorted
    .map((f) => {
      const status = f.room ? `<span class="fr-room">${f.room.match ? '対戦中' : 'ルーム公開中'} ${f.room.n}/${f.room.max}</span>` : f.online ? '<span class="fr-on">オンライン</span>' : '<span class="muted">オフライン</span>';
      // オフラインの人だけ、最後にアプリを開いていた時刻を添える
      const sub = f.online || f.room ? '' : `・最終ログイン ${f.seen ? agoText(f.seen) : '記録なし'}`;
      return `<button type="button" class="fr-item ${friendPick === f.code ? 'on' : ''}" data-pick="${f.code}">
        <span class="fr-dot ${f.online || f.room ? 'on' : ''}"></span>${friendFace(f.name, f.prof)}
        <span class="fr-txt"><b>${esc(f.name)}</b><small>${status}${sub}</small></span>${f.un ? `<span class="dm-count">${f.un}</span>` : ''}</button>`;
    })
    .join('');
  const inbox = st.inbox.length
    ? `<div class="opt-label">届いた申請（${st.inbox.length}件）</div>${st.inbox
        .map((r) => `<div class="fr-row"><div class="grow"><b>${esc(r.name)}</b> <small class="muted">${r.code}</small></div><button class="btn small primary" data-accept="${r.code}">承認</button><button class="btn small" data-decline="${r.code}">断る</button></div>`)
        .join('')}`
    : '';
  const sent = st.sent.length
    ? `<div class="opt-label">送った申請（相手の承認待ち）</div><div class="fr-sent">${st.sent
        .map((r) => `<div class="fr-row"><div class="grow">${esc(r.name)} <small class="muted">${r.code}</small></div><button class="btn small" data-cancel="${r.code}">取り消す</button></div>`)
        .join('')}</div>`
    : '';
  // 右：選んでいる人の名刺カード
  const pick = st.friends.find((f) => f.code === friendPick);
  const card = pick
    ? `${profileCard(pick.name, pick.code, pick.prof, social.together(pick.code))}
       <div class="fr-acts">${
         pick.room
           ? pick.room.match
             ? `<button class="btn small primary" data-watch="${pick.room.code}">${eyeMark()}対戦を見る</button>`
             : `<button class="btn small primary" data-join="${pick.room.code}">ルームに参加</button>`
           : ''
       }<button class="btn small dm-open-btn" data-dm="${pick.code}">${chatMark()}メッセージ${pick.un ? `<span class="dm-count">${pick.un}</span>` : ''}</button></div>
       <div class="fr-danger"><button class="btn small danger-outline" data-remove="${pick.code}" data-name="${esc(pick.name)}">フレンドから外す</button></div>`
    : `${profileCard(settings.name || 'あなた', '', me, undefined, social.code)}
       <div class="fr-acts"><button class="btn small primary" id="pf-edit">プロフィールを編集</button></div>`;
  showScreen(
    `<div class="fr-head"><button class="btn small" id="back">もどる</button><h2>フレンド <small class="h2-sub">${social.connected ? `オンライン ${social.onlineCount}人` : 'サーバーにつないでいます…'}</small></h2>
       <button class="btn small primary fr-addbtn" id="fr-open">＋フレンド追加${st.sent.length ? `<span class="fr-badge">${st.sent.length}</span>` : ''}</button></div>
     <div class="fr-wrap">
       <div class="fr-left">
         <button type="button" class="fr-item me ${friendPick === 'me' ? 'on' : ''}" data-pick="me">${friendFace(settings.name || 'あなた', me)}<span class="fr-txt"><b>自分のプロフィール</b><small>見る・編集する</small></span></button>
         ${inbox}
         <div class="opt-label">フレンド（${st.friends.length}人）</div>
         ${rows || '<p class="muted">まだフレンドがいません。右上の「＋フレンド追加」から、相手のフレンドコードで申請しましょう。</p>'}
         <p class="muted small-note">フレンドがルームを「フレンドに公開」にすると「ルームに参加」が出ます（対戦中なら「対戦を見る」）。${settings.hideOnline ? 'あなたのオンライン状態は隠しています。' : 'オンライン状態は設定画面で隠せます。'}</p>
       </div>
       <div class="fr-right">${card}</div>
     </div>`,
    'overlay friends-screen',
    (root) => {
      const l = root.querySelector<HTMLElement>('.fr-left');
      if (l) l.scrollTop = y;
      mountCardViewer(root);
      root.querySelector('#back')!.addEventListener('click', () => {
        friendAddOpen = false;
        showMenu('multi');
      });
      root.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) =>
        b.addEventListener('click', () => {
          friendPick = b.dataset.pick!;
          sfx.click();
          showFriends();
        }),
      );
      root.querySelector('#pf-edit')?.addEventListener('click', () => showProfileEdit());
      // フレンドを追加する小窓（相手のコードで申請・送った申請の取り消し）
      root.querySelector('#fr-open')!.addEventListener('click', () => {
        friendAddOpen = true;
        showFriends();
        screensEl.querySelector<HTMLInputElement>('#fr-code')?.focus();
      });
      if (friendAddOpen) {
        const m = document.createElement('div');
        m.className = 'modal';
        m.innerHTML = `<div class="modal-box fr-addbox">
            <h3>フレンドを追加</h3>
            <div class="modal-body">
              <p class="muted small-note">相手のフレンドコードを入れて申請します。相手が承認するとフレンドになります。</p>
              <div class="row fr-add"><input type="text" id="fr-code" maxlength="9" placeholder="相手のコード（例 ABCD-EFGH）" value="${esc(typed)}" autocomplete="off" autocapitalize="characters"/>
                <button class="btn primary" id="fr-send">申請</button></div>
              ${sent}
            </div>
            <div class="footer"><button class="btn" data-close>閉じる</button></div>
          </div>`;
        m.addEventListener('click', (e) => {
          const t = e.target as HTMLElement;
          if (t === m || t.closest('[data-close]')) {
            friendAddOpen = false;
            m.remove();
          }
        });
        screensEl.appendChild(m);
        if (typing) m.querySelector<HTMLInputElement>('#fr-code')?.focus();
      }
      root.querySelector('#fr-copy')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(social.code);
          toast('フレンドコードをコピーしました');
        } catch {
          toast(`フレンドコード：${social.code}`, 5000);
        }
      });
      const send = () => {
        const box = screensEl.querySelector<HTMLInputElement>('#fr-code')!;
        if (!box.value.trim()) return;
        social.add(box.value);
        box.value = '';
      };
      screensEl.querySelector('#fr-send')?.addEventListener('click', send);
      screensEl.querySelector<HTMLInputElement>('#fr-code')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') send();
      });
      root.querySelectorAll<HTMLElement>('[data-accept]').forEach((b) => b.addEventListener('click', () => social.accept(b.dataset.accept!)));
      root.querySelectorAll<HTMLElement>('[data-decline]').forEach((b) => b.addEventListener('click', () => social.decline(b.dataset.decline!)));
      screensEl.querySelectorAll<HTMLElement>('[data-cancel]').forEach((b) => b.addEventListener('click', () => social.cancel(b.dataset.cancel!)));
      root.querySelectorAll<HTMLElement>('[data-remove]').forEach((b) =>
        b.addEventListener('click', () => {
          confirmDialog(`${b.dataset.name} さんをフレンドから外しますか？`, 'もう一度申請し合うまで、フレンドに戻りません。', '外す', () => social.remove(b.dataset.remove!));
        }),
      );
      root.querySelectorAll<HTMLElement>('[data-join]').forEach((b) => b.addEventListener('click', () => joinRoom(b.dataset.join!, showFriends)));
      root.querySelectorAll<HTMLElement>('[data-dm]').forEach((b) => b.addEventListener('click', () => openDm(b.dataset.dm!)));
      // フレンドが対戦中なら、参加ではなく観戦（見るだけ）
      root.querySelectorAll<HTMLElement>('[data-watch]').forEach((b) =>
        b.addEventListener('click', () => {
          lastJoinCode = b.dataset.watch!;
          showScreen(`<h2>接続中…</h2>`, 'overlay');
          net.connect(settings.serverUrl, b.dataset.watch!, false, settings.name || 'プレイヤー', settings.charId, undefined, true);
        }),
      );
    },
  );
}

// ---------------------------------------------------------------------------
// DM：フレンドに定型文・絵スタンプを送る（自由な文は送れない）。戦っている最中は開けない
let dmCode = '';
let dmTab: 'p' | 's' = 'p';
let dmLastSend = 0;

/** いま自分が戦っている最中か（CPU戦・オンライン対戦。観戦・結果画面は含めない） */
function fightingNow(): boolean {
  if (!session || session.kind === 'demo' || resultsShown) return false;
  if (session.kind === 'net') return net.slot >= 0 && session.setup.players.some((p) => p.slot === net.slot);
  return true;
}

/** まだ読んでいない DM があれば赤い点 */
function dmDot(): string {
  return social.unread > 0 ? '<span class="m-dot"></span>' : '';
}

function closeDm(): void {
  document.getElementById('dm')?.remove();
  document.getElementById('dm-pick')?.remove();
  dmCode = '';
}

/** 待機画面から：メッセージを送るフレンドを選ぶ */
function openDmPicker(): void {
  if (fightingNow()) return;
  document.getElementById('dm-pick')?.remove();
  const el = document.createElement('div');
  el.className = 'modal';
  el.id = 'dm-pick';
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-dmto]');
    if (b) {
      el.remove();
      openDm(b.dataset.dmto!);
    } else if (t === el || t.closest('[data-close]')) el.remove();
  });
  // 画面の描き直し（フレンド一覧・待機画面）で消えないよう、画面の外側に置く
  document.getElementById('app')!.appendChild(el);
  renderDmPicker();
}

function renderDmPicker(): void {
  const el = document.getElementById('dm-pick');
  if (!el) return;
  const on = (f: FriendInfo) => Number(f.online || !!f.room);
  const list = [...social.state.friends].sort((a, b) => (b.un ?? 0) - (a.un ?? 0) || on(b) - on(a) || a.name.localeCompare(b.name));
  el.innerHTML = `<div class="modal-box dm-pick-box">
      <h3>メッセージを送るフレンド</h3>
      <div class="modal-body dm-pick-list">${
        list.length
          ? list
              .map(
                (f) => `<button type="button" class="fr-item" data-dmto="${f.code}"><span class="fr-dot ${f.online || f.room ? 'on' : ''}"></span>${friendFace(f.name, f.prof)}
                  <span class="fr-txt"><b>${esc(f.name)}</b><small>${f.room ? (f.room.match ? '対戦中' : 'ルーム公開中') : f.online ? 'オンライン' : 'オフライン'}</small></span>${f.un ? `<span class="dm-count">${f.un}</span>` : ''}</button>`,
              )
              .join('')
          : '<p class="muted">まだフレンドがいません。</p>'
      }</div>
      <div class="footer"><button class="btn" data-close>閉じる</button></div>
    </div>`;
}

/** フレンドとのやり取りを開く */
function openDm(code: string): void {
  if (fightingNow()) return;
  closeDm();
  dmCode = code;
  social.openDm(code);
  const el = document.createElement('div');
  el.className = 'modal';
  el.id = 'dm';
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const send = t.closest<HTMLButtonElement>('[data-dmsend]');
    const tab = t.closest<HTMLElement>('[data-dmtab]');
    const join = t.closest<HTMLElement>('[data-dmjoin]');
    if (send && !send.disabled) {
      const [k, i] = send.dataset.dmsend!.split(':');
      sendDm(k === 's' ? 's' : 'p', Number(i));
    } else if (tab) {
      dmTab = tab.dataset.dmtab === 's' ? 's' : 'p';
      renderDm();
    } else if (join) {
      closeDm();
      joinRoom(join.dataset.dmjoin!, showMenu);
    } else if (t === el || t.closest('[data-close]')) closeDm();
  });
  document.getElementById('app')!.appendChild(el);
  renderDm();
}

function sendDm(k: 'p' | 's', i: number): void {
  if (fightingNow() || !dmCode) return;
  // 持っていないスタンプは送れない
  if (k === 's' && !stampTier(wallet, i)) return;
  const now = Date.now();
  if (now - dmLastSend < DM_COOLDOWN_MS) return;
  dmLastSend = now;
  // 「ルーム作ったよ！」は、いま入っているルームの「参加する」ボタンを付ける
  const room = k === 'p' && i === DM_ROOM_PHRASE && lobby && net.slot >= 0 ? lobby.code : undefined;
  social.sendDm(dmCode, k, i, room, k === 's' ? stampTier(wallet, i) : undefined);
  sfx.click();
  // 1秒は押せない（押せるようになるまで薄くする）
  const el = document.getElementById('dm');
  el?.querySelectorAll<HTMLButtonElement>('[data-dmsend]').forEach((b) => (b.disabled = true));
  setTimeout(() => document.getElementById('dm')?.querySelectorAll<HTMLButtonElement>('[data-dmsend]').forEach((b) => (b.disabled = false)), DM_COOLDOWN_MS);
}

function renderDm(): void {
  const el = document.getElementById('dm');
  if (!el) return;
  const f = social.state.friends.find((x) => x.code === dmCode);
  if (!f) return closeDm();
  const list = social.dms.get(dmCode);
  const hm = (at: number) => {
    const d = new Date(at);
    const today = new Date().toDateString() === d.toDateString();
    return `${today ? '' : `${d.getMonth() + 1}/${d.getDate()} `}${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const inRoom = !!lobby && net.slot >= 0;
  const log = !list
    ? '<p class="muted dm-empty">読み込み中…</p>'
    : list.length
      ? list
          .map(
            (m) => `<div class="dm-row ${m.me ? 'me' : ''}"><div class="dm-bubble ${m.k === 's' ? 'pic' : ''}">${m.k === 'p' ? esc(DM_PHRASES[m.i] ?? '') : picStamp(m.i, m.t ?? 4)}${
              m.r && !m.me && !inRoom ? `<button type="button" class="btn small primary dm-join" data-dmjoin="${m.r}">ルーム ${m.r} に参加する</button>` : m.r ? `<small class="dm-room">ルーム ${m.r}</small>` : ''
            }</div><small class="dm-time">${hm(m.at)}</small></div>`,
          )
          .join('')
      : '<p class="muted dm-empty">まだメッセージはありません。下から送ってみよう！</p>';
  const cool = Date.now() - dmLastSend < DM_COOLDOWN_MS ? 'disabled' : '';
  const phrases = DM_GROUPS.map(
    (g) => `<div class="dm-group"><span>${g.name}</span><div class="dm-chips">${g.ids.map((i) => `<button type="button" class="stamp-btn" data-dmsend="p:${i}" ${cool}>${esc(DM_PHRASES[i])}</button>`).join('')}</div></div>`,
  ).join('');
  const stamps = `<div class="pic-grid">${ownedStampButtons('dmsend', cool)}</div>${stampMoreNote()}`;
  const keepY = el.querySelector<HTMLElement>('.dm-pad')?.scrollTop ?? 0;
  el.innerHTML = `<div class="modal-box dm-box">
      <div class="dm-head">${friendFace(f.name, f.prof)}<div class="grow"><b>${esc(f.name)}</b><small>${f.room ? (f.room.match ? '対戦中' : 'ルーム公開中') : f.online ? 'オンライン' : 'オフライン'}</small></div><button class="btn small" data-close>閉じる</button></div>
      <div class="dm-log">${log}</div>
      <div class="dm-tabs"><button type="button" class="${dmTab === 'p' ? 'on' : ''}" data-dmtab="p">定型文</button><button type="button" class="${dmTab === 's' ? 'on' : ''}" data-dmtab="s">スタンプ</button></div>
      <div class="dm-pad">${dmTab === 'p' ? phrases : stamps}</div>
    </div>`;
  const logEl = el.querySelector<HTMLElement>('.dm-log')!;
  logEl.scrollTop = logEl.scrollHeight;
  el.querySelector<HTMLElement>('.dm-pad')!.scrollTop = keepY;
}

/** プロフィールの編集（左に名刺カードの見本、右で選ぶ） */
/** 見せる称号を選ぶ（持っている称号だけを、戦績の称号の画面と同じ種類ごとに並べる） */
function openTitlePicker(current: string, onPick: (title: string) => void): void {
  const owned = TITLES.filter((t) => progress.titles.includes(t.id));
  const chip = (name: string, label: string) => `<button type="button" class="pe-chip ${name === current ? 'on' : ''}" data-pt="${esc(name)}">${label}</button>`;
  const groups = TITLE_GROUPS.map((g) => {
    const list = owned.filter((t) => g.match(t.id));
    return list.length ? `<div class="title-group"><span>${g.name}</span><small>${list.length}</small></div><div class="pe-chips">${list.map((t) => chip(t.name, esc(t.name))).join('')}</div>` : '';
  }).join('');
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box">
      <h3>見せる称号を選ぶ</h3>
      <div class="modal-body">
        <div class="pe-chips">${chip('', 'なし')}</div>
        ${groups || '<p class="muted">まだ称号を持っていません。戦績・ミッションの「称号」で、手に入れる条件を見られます。</p>'}
      </div>
      <div class="footer"><button class="btn" data-close>閉じる</button></div>
    </div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) return el.remove();
    const b = t.closest<HTMLElement>('[data-pt]');
    if (!b) return;
    sfx.click();
    el.remove();
    onPick(b.dataset.pt ?? '');
  });
  screensEl.appendChild(el);
}

function showProfileEdit(): void {
  const cur = myProfile();
  const draft = { charId: cur.charId, costume: cur.costume, title: cur.title, comment: cur.comment, color: cur.color, bg: cur.bg ?? 0 };
  const titleNames = progress.titles.map((id) => TITLES.find((t) => t.id === id)?.name ?? '').filter(Boolean);
  let scroll = 0;
  const draw = () => {
    const p: Profile = { ...cur, ...draft };
    const owned = COSTUMES.filter((c) => c.charId === draft.charId && (c.rarity < 4 || ownsCostume(c.id, c.charId)));
    const chip = (attr: string, val: string | number, label: string, on: boolean, cls = '') => `<button type="button" class="pe-chip ${cls} ${on ? 'on' : ''}" data-${attr}="${val}">${label}</button>`;
    showScreen(
      `<h2>プロフィールの編集 <small class="h2-sub">フレンドに見えます</small></h2>
       <div class="pe-wrap">
         <div class="pe-card">${profileCard(settings.name || 'あなた', '', p)}</div>
         <div class="pe-opts">
           <div class="opt-label">お気に入りのキャラ</div>
           <div class="pe-chips">${CHARACTERS.map((c) => chip('char', c.id, esc(c.name), c.id === draft.charId)).join('')}</div>
           <div class="opt-label">衣装（持っている衣装から）</div>
           <div class="pe-chips">${owned.map((c) => chip('cos', c.id, `${rarityName(c.rarity) ? `<b>${rarityName(c.rarity)}</b> ` : ''}${esc(c.name)}`, c.id === draft.costume, `r${c.rarity}`)).join('')}</div>
           <div class="opt-label">見せる称号</div>
           <div class="pe-title-row"><span class="pe-cur-title">${draft.title ? `${rewardMark()}${esc(draft.title)}` : 'なし'}</span><button type="button" class="btn small" id="pick-title">称号を選ぶ <small>（${titleNames.length}個から）</small></button></div>
           <div class="opt-label">ひとこと</div>
           <div class="pe-chips">${PROFILE_COMMENTS.map((t, i) => chip('cm', i, esc(t), i === draft.comment)).join('')}</div>
           <div class="opt-label">カードの色</div>
           <div class="pe-chips">${PROFILE_COLORS.map(([a, b], i) => `<button type="button" class="pe-color ${i === draft.color && !draft.bg ? 'on' : ''}" data-color="${i}" style="background:linear-gradient(135deg,${a},${b})" aria-label="色${i + 1}"></button>`).join('')}</div>
           <div class="opt-label">カードの背景 <small class="muted">（スタンプ＆背景ガチャで集めた背景から）</small></div>
           <div class="pe-chips"><button type="button" class="pe-bg none ${draft.bg === 0 ? 'on' : ''}" data-bg="0"><span>なし（色だけ）</span></button></div>
           ${CARD_BG_GROUPS.filter((g) => CARD_BGS.some((d, i) => d.group === g.id && ownsBg(wallet, i + 1))).map(
             (g) =>
               `<div class="pe-bg-group">${g.name}</div><div class="pe-chips">${CARD_BGS.map((d, i) => (d.group === g.id && ownsBg(wallet, i + 1) ? `<button type="button" class="pe-bg ${draft.bg === i + 1 ? 'on' : ''} ${cardBgAttrs(i + 1).cls}" data-bg="${i + 1}" style="${cardBgAttrs(i + 1).style}"><span>${esc(d.name)}</span></button>` : '')).join('')}</div>`,
           ).join('')}
         </div>
       </div>
       <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="save">保存する</button></div>`,
      'overlay profile-screen',
      (root) => {
        const opts = root.querySelector<HTMLElement>('.pe-opts')!;
        opts.scrollTop = scroll;
        mountCardViewer(root);
        const on = (sel: string, f: (el: HTMLElement) => void) =>
          root.querySelectorAll<HTMLElement>(sel).forEach((b) =>
            b.addEventListener('click', () => {
              scroll = opts.scrollTop;
              f(b);
              sfx.click();
              draw();
            }),
          );
        on('[data-char]', (b) => {
          draft.charId = b.dataset.char!;
          // キャラを変えたら、そのキャラで今着ている衣装（なければふつうの衣装）
          draft.costume = myCostume(draft.charId) ?? getCostume(undefined, draft.charId).id;
        });
        on('[data-cos]', (b) => (draft.costume = b.dataset.cos!));
        root.querySelector('#pick-title')!.addEventListener('click', () => {
          scroll = opts.scrollTop;
          sfx.click();
          openTitlePicker(draft.title, (t) => {
            draft.title = t;
            draw();
          });
        });
        on('[data-cm]', (b) => (draft.comment = Number(b.dataset.cm)));
        // 色を選んだら背景は外す（背景を選んでいる間は、色の選択は外れて見える）
        on('[data-color]', (b) => {
          draft.color = Number(b.dataset.color);
          draft.bg = 0;
        });
        on('[data-bg]', (b) => (draft.bg = Number(b.dataset.bg)));
        root.querySelector('#back')!.addEventListener('click', () => showFriends());
        root.querySelector('#save')!.addEventListener('click', () => {
          settings.profile = { ...draft };
          saveSettings(settings);
          social.setProfile(myProfile());
          toast('プロフィールを保存しました');
          friendPick = 'me';
          showFriends();
        });
      },
    );
  };
  draw();
}

/** 前のルームの対戦に戻る */
function rejoinRoom(): void {
  const r = loadRejoin();
  if (!r) return showMenu('multi');
  showScreen(`<h2>ルーム ${esc(r.code)} に戻っています…</h2>`, 'overlay');
  net.rejoin(r);
}

/** はじめるを押したとき：前に対戦の途中で抜けたルームに戻るか */
function showRejoinPrompt(): void {
  const r = loadRejoin()!;
  showScreen(
    `<h2>対戦の途中で抜けたルームがあります</h2>
     <p class="help">ルーム ${esc(r.code)} の対戦がまだ続いていれば、続きから戻れます（抜けている間は CPU が代わりに操作しています）。</p>
     <div class="footer"><button class="btn" id="no">メニューへ</button><button class="btn primary" id="yes">戻る</button></div>`,
    'overlay',
    (root) => {
      root.querySelector('#yes')!.addEventListener('click', rejoinRoom);
      root.querySelector('#no')!.addEventListener('click', () => showMenu());
    },
  );
}

/** このゲームのURL（ルームコードなどは付けない。友達に教える用） */
function gameUrl(): string {
  return `${location.origin}${location.pathname}`;
}

/** 友達にゲームを教える：URLを表示して、コピー・共有できるようにする */
function showGameUrl(): void {
  const url = gameUrl();
  showScreen(
    `<h2>友達にゲームを教える</h2>
     <p class="muted">このURLを送ると、友達もブラウザで遊べます（インストールは不要です）。</p>
     <div class="url-box"><input type="text" id="game-url" readonly value="${esc(url)}"/></div>
     <div class="row url-btns">
       <button class="btn primary" id="copy-url">コピー</button>
       ${typeof navigator.share === 'function' ? '<button class="btn" id="share-url">共有</button>' : ''}
     </div>
     <p class="muted small-note">いっしょに対戦するときは、ルームを作ったあとの画面の「招待リンクを送る」を使うと、そのルームに直接入れるリンクを送れます。</p>
     <div class="footer"><button class="btn" id="back">もどる</button></div>`,
    'overlay',
    (root) => {
      const box = root.querySelector<HTMLInputElement>('#game-url')!;
      // タップすると全部選ばれる（長押しでコピーしやすい）
      box.addEventListener('focus', () => box.select());
      box.addEventListener('click', () => box.setSelectionRange(0, url.length));
      root.querySelector('#copy-url')!.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast('URLをコピーしました');
        } catch {
          // コピーできない環境：選んだ状態にして、手でコピーしてもらう
          box.focus();
          box.setSelectionRange(0, url.length);
          toast('URLを選びました。長押しでコピーしてください', 3500);
        }
      });
      root.querySelector('#share-url')?.addEventListener('click', async () => {
        try {
          await navigator.share({ title: 'トバセ！', text: '「トバセ！」で遊ぼう！', url });
        } catch {
          // 共有をやめたときなど
        }
      });
      root.querySelector('#back')!.addEventListener('click', () => showMenu('multi'));
    },
  );
}

// お知らせ（トースト）：続けて出したときは上書きせず、順番に出す。種類（成功・注意・ふつう）で色を分ける
type ToastKind = 'ok' | 'warn' | 'info';
const toastQueue: { msg: string; ms: number; kind: ToastKind }[] = [];
let toastNow: { msg: string; timer: number } | null = null;
/** 文面から種類を決める（はっきり指定したいときは kind を渡す） */
function toastKind(msg: string): ToastKind {
  if (/できません|できなかった|切れ|ません|エラー|失敗|いっぱい|違います|見つかりません|足りません/.test(msg)) return 'warn';
  if (/しました|ました！|もらいました|手に入れた|コピー|そろいました|戻ってきました/.test(msg)) return 'ok';
  return 'info';
}
function toast(msg: string, ms = 2500, kind: ToastKind = toastKind(msg)): void {
  // 同じお知らせが続いたら、出ている時間を延ばすだけにする
  if (toastNow?.msg === msg) {
    clearTimeout(toastNow.timer);
    toastNow.timer = window.setTimeout(nextToast, ms);
    return;
  }
  if (toastQueue.some((t) => t.msg === msg)) return;
  toastQueue.push({ msg, ms, kind });
  // たまりすぎたら古いものを捨てる
  while (toastQueue.length > 4) toastQueue.shift();
  if (!toastNow) nextToast();
}
function nextToast(): void {
  const t = toastQueue.shift();
  if (!t) {
    toastNow = null;
    toastEl.classList.add('hidden');
    return;
  }
  toastEl.textContent = t.msg;
  toastEl.className = `toast-${t.kind}`;
  // 次が待っているときは短めに
  const ms = toastQueue.length ? Math.min(t.ms, 1800) : t.ms;
  toastNow = { msg: t.msg, timer: window.setTimeout(nextToast, ms) };
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

function charCards(selected: string, random = false): string {
  return `<div class="chars">${CHARACTERS.map(
    (c) => `<div class="char-card ${c.id === selected ? 'on' : ''}" data-char="${c.id}">
      <div class="swatch" style="background:${hex(c.color)}"></div>
      <div class="nm">${c.name}</div><div class="rl">${c.role}</div></div>`,
  ).join('')}${
    random
      ? `<div class="char-card random ${selected === RANDOM_CHAR ? 'on' : ''}" data-char="${RANDOM_CHAR}">
      <div class="swatch">？</div>
      <div class="nm">おまかせ</div><div class="rl">試合ごとにランダム</div></div>`
      : ''
  }</div>`;
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
    <div class="cd-hint">技を長押ししても説明が出ます</div>`;
}

/** 技の一覧（4つの必殺技・特性・共通の技の説明）を、今の画面の上に重ねて出す。閉じると元の画面に戻る */
function openMoveList(charId: string): void {
  const c = getCharacter(charId);
  const n = c.specialNames;
  const d = SPECIAL_DESCS[charId];
  const row = (label: string, name: string, desc: string) => `<div class="ml-row"><span class="key">${label}</span><div><b>${name}</b><div class="ml-d">${desc}</div></div></div>`;
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box">
      <h3>${c.name}の技</h3>
      <div class="modal-body">
        <div class="cd-trait"><span class="tag">特性</span><b>${c.trait.name}</b>：${c.trait.desc}</div>
        ${row('B', n.n, d?.n ?? '')}${row('横B', n.s, d?.s ?? '')}${row('下B', n.d, d?.d ?? '')}${row('上B', n.u, d?.u ?? '')}
        ${row('共通', '溜め攻撃（A長押し）', CHARGE_DESC)}${row('共通', 'つかみ（ガード＋A）', GRAB_DESC)}
      </div>
      <div class="footer"><button class="btn primary" data-close>閉じる</button></div>
    </div>`;
  const close = () => el.remove();
  el.addEventListener('click', (e) => {
    if (e.target === el || (e.target as HTMLElement).closest('[data-close]')) close();
  });
  screensEl.appendChild(el);
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
    // 背の低い画面で説明が長いときは、横に広げて文字を少し小さくし、縦に収める
    if (pop.offsetHeight > rr.height * 0.55) pop.classList.add('wide');
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(rr.width - pw - 8, r.left - rr.left));
    // 技の上 → 入らなければ技の下 → どちらも入らなければ、画面の中に収まる位置（技に少し重なってもよい）
    let top = r.top - rr.top - ph - 6;
    if (top < 8) top = r.bottom - rr.top + 6;
    if (top + ph > rr.height - 8) top = Math.max(8, rr.height - ph - 8);
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
  // 説明が出ているときは、画面のどこをタップしても消す（キャラの3D部分など、この画面の外側でも）
  const onDoc = (e: PointerEvent) => {
    if (!root.isConnected) return document.removeEventListener('pointerdown', onDoc, true);
    if (pop && !pop.contains(e.target as Node)) hide();
  };
  document.addEventListener('pointerdown', onDoc, true);
}

interface CharSelectOptions {
  title: string;
  /** 自分の色（プレイヤー番号） */
  slot: number;
  current: string;
  nextLabel: string;
  onBack(): void;
  onNext(charId: string): void;
  /** オンライン対戦：「おまかせ（試合ごとにランダム）」も選べる */
  allowRandom?: boolean;
}

/** オンライン対戦で使うキャラ（おまかせなら RANDOM_CHAR） */
/** キャラごとに今着ている衣装（持っているものだけ。キャラ「おまかせ」で決まったキャラに着せる） */
function myCostumeMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of CHARACTERS) {
    const id = myCostume(c.id);
    if (id) m[c.id] = id;
  }
  return m;
}

function onlineChar(): string {
  return settings.onlineRandom ? RANDOM_CHAR : settings.charId;
}
function onlineCostume(): string | undefined {
  return settings.onlineRandom ? undefined : myCostume(settings.charId);
}
/** ロビーなどに出すキャラの名前（おまかせは「おまかせ」） */
function charLabel(id: string): string {
  return id === RANDOM_CHAR ? 'おまかせ' : getCharacter(id).name;
}

/** キャラ選択：左に選んでいるキャラ（3D・待機ポーズ）、右に一覧と説明 */
function showCharSelect(o: CharSelectOptions): void {
  let picked = CHARACTERS.some((c) => c.id === o.current) || (o.allowRandom && o.current === RANDOM_CHAR) ? o.current : CHARACTERS[0].id;
  const nameHtml = (id: string) => {
    if (id === RANDOM_CHAR) return `<div class="cs-role">試合ごとにランダム</div><div class="cs-name">おまかせ</div>`;
    const c = getCharacter(id);
    return `<div class="cs-role">${c.role}</div><div class="cs-name">${c.name}</div>`;
  };
  const detail = (id: string) => (id === RANDOM_CHAR ? '<p class="help">試合が始まるときに、キャラがランダムで決まります（衣装はいつもの服）。何が出るかはお楽しみ！</p>' : charDetail(id));
  const cos = (id: string) => (id === RANDOM_CHAR ? '' : costumeChips(id));
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate">${nameHtml(picked)}</div>
     <h2>${o.title}</h2>
     ${charCards(picked, !!o.allowRandom)}
     <div class="costume-row">${cos(picked)}</div>
     <div class="char-detail">${detail(picked)}</div>
     <div class="footer"><button class="btn" id="back">もどる</button><button class="btn primary" id="next">${o.nextLabel}</button></div>`,
    'overlay charsel-screen',
    (root) => {
      root.querySelectorAll<HTMLElement>('.char-card').forEach((el) =>
        el.addEventListener('click', () => {
          picked = el.dataset.char!;
          root.querySelectorAll('.char-card').forEach((x) => x.classList.toggle('on', x === el));
          root.querySelector('.char-detail')!.innerHTML = detail(picked);
          root.querySelector('.cs-nameplate')!.innerHTML = nameHtml(picked);
          root.querySelector('.costume-row')!.innerHTML = cos(picked);
          // おまかせのときは、左のキャラはそのまま（何が出るかは試合まで分からない）
          if (picked === RANDOM_CHAR) {
            sfx.click();
            return;
          }
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
        // おまかせは「オンラインで使う」印だけ付けて、ふだんのキャラ（CPU戦など）はそのまま
        if (o.allowRandom) settings.onlineRandom = picked === RANDOM_CHAR;
        if (picked !== RANDOM_CHAR) settings.charId = picked;
        saveSettings(settings);
        o.onNext(picked);
      });
    },
  );
  renderer.showPreview(picked === RANDOM_CHAR ? settings.charId : picked, o.slot, myCostume(picked === RANDOM_CHAR ? settings.charId : picked));
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
  const list = COSTUMES.filter((c) => c.charId === charId && (c.rarity < 4 || ownsCostume(c.id, c.charId)));
  const total = COSTUMES.filter((c) => c.charId === charId && c.rarity >= 4).length;
  const have = list.filter((c) => c.rarity >= 4).length;
  return `<span class="cr-label">衣装 ${have}/${total}</span>${list
    .map((c) => `<button type="button" class="cchip r${c.rarity} ${c.id === cur ? 'on' : ''}" data-costume="${c.id}">${rarityName(c.rarity) ? `<b>${rarityName(c.rarity)}</b>` : ''}${c.name}${c.rarity === 6 ? URSP : ''}</button>`)
    .join('')}`;
}

/** ステージの一覧（実際のステージの小さな画像つき） */
/** ルーレットが回っている時間（ms）。サーバーはこれより少し長く待ってから試合を始める */
const ROULETTE_MS = 2300;
let rouletteEl: HTMLElement | null = null;

/** ステージおまかせのルーレット：ステージのカードを回して、stageId で止める。終わったら done */
function stageRoulette(stageId: string, done?: () => void): void {
  rouletteEl?.remove();
  const el = document.createElement('div');
  el.className = 'roulette';
  const card = (id: string) => {
    const st = getStage(id);
    const th = st.theme;
    const img = renderer.cachedThumbnail(st.id);
    return `<div class="rl-card" style="background:linear-gradient(${hex(th.sky)}, ${hex(th.skyBottom)})">${img ? `<img alt="" src="${img}"/>` : ''}<div class="rl-nm">${st.name}</div></div>`;
  };
  el.innerHTML = `<div class="rl-title">ステージおまかせ</div><div class="rl-slot"></div><div class="rl-sub">ルーレット中…</div>`;
  document.getElementById('app')!.appendChild(el);
  rouletteEl = el;
  const slot = el.querySelector<HTMLElement>('.rl-slot')!;
  const ids = STAGES.map((s) => s.id);
  // だんだん遅くして、最後に決まったステージで止める
  const steps: number[] = [];
  let t = 0;
  let gap = 60;
  while (t < ROULETTE_MS - 600) {
    steps.push(t);
    t += gap;
    gap = Math.min(260, gap * 1.13);
  }
  let k = Math.floor(Math.random() * ids.length);
  steps.forEach((at, i) =>
    setTimeout(() => {
      if (rouletteEl !== el) return;
      const last = i === steps.length - 1;
      k = (k + 1 + (ids[(k + 1) % ids.length] === stageId && !last ? 1 : 0)) % ids.length;
      slot.innerHTML = card(last ? stageId : ids[k]);
      sfx.click();
      if (last) {
        el.classList.add('hit');
        el.querySelector('.rl-sub')!.textContent = 'ステージ決定！';
        sfx.beep(true);
      }
    }, at),
  );
  setTimeout(() => {
    if (rouletteEl !== el) return;
    el.classList.add('out');
    setTimeout(() => {
      el.remove();
      if (rouletteEl === el) rouletteEl = null;
    }, 250);
    done?.();
  }, ROULETTE_MS);
}

function stageCards(selected: string): string {
  const random = `<div class="stage-card random ${selected === RANDOM_STAGE ? 'on' : ''}" data-stage="${RANDOM_STAGE}">
      <div class="thumb"><span class="rnd">?</span></div>
      <div class="nm">おまかせ</div><div class="who">毎試合ランダム</div></div>`;
  return `<div class="stages">${random}${STAGES.map((st) => {
    const th = st.theme;
    const bg = `linear-gradient(${hex(th.sky)}, ${hex(th.skyBottom)})`;
    return `<div class="stage-card ${st.id === selected ? 'on' : ''}" data-stage="${st.id}">
      <div class="thumb" style="background:${bg}">${(() => {
        // 作り済みの画像はすぐ表示する（画面を作り直したときにちらつかないように）
        const done = renderer.cachedThumbnail(st.id);
        return done ? `<img alt="" src="${done}"/>` : `<img alt="" data-thumb="${st.id}"/>`;
      })()}</div>
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
  const shape = r.area === 'fix2' ? '動かない2つ' : r.area === 'random' ? 'おまかせ' : '移動する1つ';
  const base =
    r.mode === 'stock'
      ? `ストック ${r.stocks}`
      : r.mode === 'stamina'
        ? `体力制 HP${r.hp ?? DEFAULT_HP}・残機${r.stocks}`
        : r.mode === 'area'
          ? `エリアバトル（${shape}）${r.timeLimit / 60}分`
          : r.mode === 'ball'
            ? `玉入れ（${r.goals ?? 5}点先取・相手への攻撃${r.pvp === false ? 'なし' : 'あり'}）${r.timeLimit / 60}分`
            : r.mode === 'crown'
              ? `王冠うばい（${r.crownGoal ?? 30}秒持ったら勝ち）${r.timeLimit / 60}分`
              : r.mode === 'vault'
                ? `金庫まもり（耐久${({ 250: '少ない', 600: '多い' } as Record<number, string>)[r.vaultHp ?? 400] ?? '普通'}）${r.timeLimit / 60}分`
                : r.mode === 'bounty'
                  ? `賞金首 ${r.timeLimit / 60}分`
                  : r.mode === 'coins'
                    ? `コイン集め ${r.timeLimit / 60}分`
                    : `タイム ${r.timeLimit / 60}分`;
  return r.teams && !isTwoTeam(r.mode) ? `${base}・チーム戦（味方への攻撃${r.friendlyFire ? 'あり' : 'なし'}）` : base;
}

/** モードの説明（どんな遊びか）と、おすすめの人数。ルール画面でモードの下に出す */
const MODE_INFO: Record<MatchRules['mode'], { name: string; desc: string; players: string }> = {
  stock: { name: 'ストック', desc: '残機がなくなるまで戦い、最後まで残った人（チーム）の勝ち。いちばん基本のルール', players: '2〜4人' },
  time: { name: 'タイム', desc: '時間内に何度でも復活。撃墜した数から落ちた数を引いた点が多い人の勝ち（同点なら%が低いほう）', players: '2〜4人' },
  stamina: { name: '体力制', desc: '%のかわりにHPで戦う。HPが0になるとその場で撃墜。ふっとびは小さめで、削り合いになる', players: '2〜4人' },
  area: { name: 'エリアバトル', desc: 'エリアに自分（チーム）だけが立っている間ゲージがたまる。先に満タンにするか、時間切れで多い人の勝ち', players: '3〜4人' },
  ball: { name: '玉入れ', desc: '赤・青の2チームで、ボールを攻撃でふっとばして相手のかごに入れる。斜め上＋攻撃で山なり、斜め下＋攻撃で低く速く打てる。チームはタップで選ぶ', players: '2人・4人' },
  crown: { name: '王冠うばい', desc: '最初に相手を倒した人が王冠を手に入れ、持っている間だけ時間がたまる。持っている人に攻撃を当て続け、合計20%のダメージで奪える（王冠の上に残りの耐久が出る）。決めた時間だけ持つか、時間切れで一番長く持っていた人の勝ち', players: '3〜4人' },
  vault: { name: '金庫まもり', desc: '赤・青の2チームで自分の金庫を守り、相手の金庫を攻撃で壊す（飛び道具も当たる）。先に壊すか、時間切れで多く壊したチームの勝ち。チームはタップで選ぶ', players: '2人・4人' },
  bounty: { name: '賞金首', desc: '撃墜で1点、自分で落ちると1点減る。点が一番多い人（2点以上）は賞金首になり、倒すと3点。時間切れで点が一番多い人の勝ち', players: '3人以上（3人でも楽しめる）' },
  coins: { name: 'コイン集め', desc: '降ってくるコインを拾う。攻撃を受けるとコインを落とし、撃墜されると半分ばらまく。時間切れで一番多く持っている人の勝ち', players: '3人以上（3人でも楽しめる）' },
};
function modeInfoHtml(mode: MatchRules['mode']): string {
  const m = MODE_INFO[mode];
  return `<b>${m.name}</b><span class="mi-players">おすすめ ${m.players}</span><span class="mi-desc">${m.desc}</span>`;
}

function ruleControls(rules: MatchRules): string {
  return `
    <div class="opt opt-wide">モード ${seg('mode', [['stock', 'ストック'], ['time', 'タイム'], ['stamina', '体力制'], ['area', 'エリア'], ['ball', '玉入れ'], ['crown', '王冠'], ['vault', '金庫'], ['bounty', '賞金首'], ['coins', 'コイン']], rules.mode)}</div>
    <div class="opt opt-wide mode-info" data-mode-info>${modeInfoHtml(rules.mode)}</div>
    <div class="opt" data-show="crown">勝ちになる時間 ${seg('cgoal', [[20, '20秒'], [30, '30秒'], [45, '45秒']], rules.crownGoal ?? 30)}</div>
    <div class="opt" data-show="crown">時間 ${seg('ctime', [[120, '2分'], [180, '3分']], rules.timeLimit)}</div>
    <div class="opt" data-show="bounty coins">時間 ${seg('stime', [[120, '2分'], [180, '3分']], rules.timeLimit)}</div>
    <div class="opt" data-show="vault">金庫の耐久 ${seg('vhp', [[250, '少ない'], [400, '普通'], [600, '多い']], rules.vaultHp ?? 400)}</div>
    <div class="opt" data-show="vault">時間 ${seg('vtime', [[120, '2分'], [180, '3分']], rules.timeLimit)}</div>
    <div class="opt" data-show="ball">先取点 ${seg('goals', [[3, '3点'], [5, '5点'], [7, '7点']], rules.goals ?? 5)}</div>
    <div class="opt" data-show="ball">時間 ${seg('btime', [[120, '2分'], [180, '3分']], rules.timeLimit)}</div>
    <div class="opt" data-show="ball">相手への攻撃 ${seg('pvp', [['on', '当たる'], ['off', '当たらない']], rules.pvp === false ? 'off' : 'on')}</div>
    <div class="opt" data-show="area">エリア ${seg('area', [['move', '移動1つ'], ['fix2', '固定2つ'], ['random', 'おまかせ']], rules.area ?? 'move')}</div>
    <div class="opt" data-show="area">時間 ${seg('atime', [[120, '2分'], [180, '3分']], rules.timeLimit)}</div>
    <div class="opt" data-show="stock stamina">残機 ${seg('stocks', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], rules.stocks)}</div>
    <div class="opt" data-show="stamina">HP ${seg('hp', [[100, '100'], [150, '150'], [200, '200'], [300, '300']], rules.hp ?? DEFAULT_HP)}</div>
    <div class="opt" data-show="time">時間 ${seg('time', [[120, '2分'], [180, '3分'], [300, '5分']], rules.timeLimit)}</div>
    <div class="opt" data-hide="ball">チーム戦 ${seg('teams', [['on', 'あり'], ['off', 'なし']], rules.teams ? 'on' : 'off')}</div>
    <div class="opt" data-team data-ff>味方への攻撃 ${seg('ff', [['off', '当たらない'], ['on', '当たる']], rules.friendlyFire ? 'on' : 'off')}</div>
    <div class="opt">アイテム ${seg('items', [['on', 'あり'], ['off', 'なし']], rules.items ? 'on' : 'off')}</div>
    <div class="opt" data-items>アイテムの頻度 ${seg('irate', [['low', '少ない'], ['mid', '普通'], ['high', '多い']], rules.itemRate ?? 'mid')}</div>
    <div class="opt opt-wide" data-items>出るアイテム（乱入アイテムも同じ）<div class="item-chips">${ITEM_NAMES.map((n, i) => `<button type="button" class="ichip ${(rules.itemKinds ?? ITEM_NAMES.map((_, k) => k)).includes(i) ? 'on' : ''}" data-ikind="${i}"><b>${n}</b><small>${ITEM_INFO[i].short}</small></button>`).join('')}</div></div>
    <div class="opt">ステージギミック ${seg('gim', [['on', 'あり'], ['off', 'なし']], rules.gimmicks ? 'on' : 'off')}</div>`;
}

function bindRules(root: HTMLElement, rules: MatchRules, onChange: () => void): void {
  // 玉入れはいつもチームを選ぶ（前の版で保存したルールも）
  if (isTwoTeam(rules.mode)) rules.teams = true;
  let prevMode = rules.mode;
  const sync = () => {
    root.querySelectorAll<HTMLElement>('[data-mode-info]').forEach((el) => (el.innerHTML = modeInfoHtml(rules.mode)));
    root.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => el.classList.toggle('hidden', !el.dataset.show!.split(' ').includes(rules.mode)));
    root.querySelectorAll<HTMLElement>('[data-hide]').forEach((el) => el.classList.toggle('hidden', el.dataset.hide!.split(' ').includes(rules.mode)));
    root.querySelectorAll<HTMLElement>('[data-team]').forEach((el) => el.classList.toggle('hidden', !rules.teams));
    root.querySelectorAll<HTMLElement>('[data-items]').forEach((el) => el.classList.toggle('hidden', !rules.items));
    // 玉入れは「味方への攻撃」の設定を使わない（相手への攻撃の設定がある）
    root.querySelectorAll<HTMLElement>('[data-ff]').forEach((el) => el.classList.toggle('hidden', !rules.teams || rules.mode === 'ball'));
    // 金庫まもりは「チーム戦 あり／なし」を選ばない（いつも2チーム）
    root.querySelectorAll<HTMLElement>('[data-seg="teams"]').forEach((el) => el.closest('.opt')?.classList.toggle('hidden', isTwoTeam(rules.mode)));
  };
  sync();
  bindSeg(root, 'mode', (v) => {
    rules.mode = v as MatchRules['mode'];
    // ストック制は時間制限なし（0）。体力制は7分
    rules.timeLimit = rules.mode === 'time' ? 180 : rules.mode === 'area' || rules.mode === 'ball' || rules.mode === 'crown' || rules.mode === 'vault' || rules.mode === 'bounty' || rules.mode === 'coins' ? 120 : rules.mode === 'stock' ? 0 : 420;
    if (rules.mode === 'crown') rules.crownGoal ??= 30;
    if (rules.mode === 'vault') rules.vaultHp ??= 400;
    if (rules.mode === 'area') rules.area ??= 'move';
    // 玉入れはいつも赤・青の2チーム（チームはタップで選ぶ）。玉入れから別のルールに変えたら、チーム戦は「なし」に戻す
    const wasBall = isTwoTeam(prevMode);
    if (isTwoTeam(rules.mode)) {
      if (rules.mode === 'ball') rules.goals ??= 5;
      rules.teams = true;
    } else if (wasBall) rules.teams = false;
    prevMode = rules.mode;
    root.querySelectorAll<HTMLElement>('[data-seg="teams"] button').forEach((b) => b.classList.toggle('on', b.dataset.v === (rules.teams ? 'on' : 'off')));
    // 時間の選択肢の表示を、選び直した時間に合わせる
    root.querySelectorAll<HTMLElement>('[data-seg="time"] button, [data-seg="atime"] button, [data-seg="btime"] button, [data-seg="ctime"] button, [data-seg="vtime"] button, [data-seg="stime"] button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === rules.timeLimit));
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
  bindSeg(root, 'atime', (v) => {
    rules.timeLimit = Number(v);
    onChange();
  });
  bindSeg(root, 'btime', (v) => {
    rules.timeLimit = Number(v);
    onChange();
  });
  bindSeg(root, 'cgoal', (v) => {
    rules.crownGoal = Number(v);
    onChange();
  });
  bindSeg(root, 'vhp', (v) => {
    rules.vaultHp = Number(v);
    onChange();
  });
  for (const k of ['ctime', 'vtime', 'stime']) {
    bindSeg(root, k, (v) => {
      rules.timeLimit = Number(v);
      onChange();
    });
  }
  bindSeg(root, 'goals', (v) => {
    rules.goals = Number(v);
    onChange();
  });
  bindSeg(root, 'pvp', (v) => {
    rules.pvp = v === 'on';
    onChange();
  });
  bindSeg(root, 'area', (v) => {
    rules.area = v as MatchRules['area'];
    onChange();
  });
  bindSeg(root, 'items', (v) => {
    rules.items = v === 'on';
    sync();
    onChange();
  });
  bindSeg(root, 'irate', (v) => {
    rules.itemRate = v as MatchRules['itemRate'];
    onChange();
  });
  // 出るアイテム：タップで出す・出さないを切り替える（最低1つは残す）
  root.querySelectorAll<HTMLElement>('[data-ikind]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = Number(b.dataset.ikind);
      const cur = new Set(rules.itemKinds ?? ITEM_NAMES.map((_, i) => i));
      if (cur.has(k)) {
        if (cur.size <= 1) return toast('アイテムは1種類以上選んでください');
        cur.delete(k);
      } else cur.add(k);
      rules.itemKinds = [...cur].sort((x, y) => x - y);
      b.classList.toggle('on', cur.has(k));
      sfx.click();
      onChange();
    }),
  );
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
        startSocial();
        social.setName(settings.name || 'プレイヤー');
        // 招待リンクから開いたときは、そのルームへの参加に進む
        const room = new URLSearchParams(location.search).get('room');
        if (room && isRoomCode(room) && settings.serverUrl) {
          history.replaceState(null, '', location.pathname);
          joinRoom(room, () => showMenu());
          return;
        }
        // 前に対戦の途中で抜けたルームがあれば、戻るかたずねる
        if (loadRejoin() && settings.serverUrl) return showRejoinPrompt();
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
/** アップデートのお知らせ（新しい順。まだ読んでいないものに「NEW」） */
function showNews(): void {
  const seen = newsSeen();
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box news-box">
      <h3>${ICONS.news}アップデートのお知らせ</h3>
      <div class="modal-body news-list">${NEWS.map(
        (n) => `<section class="news-item">
          <div class="news-head"><b>${esc(n.title)}</b><small>${n.date}</small>${n.id > seen ? '<span class="news-new">NEW</span>' : ''}</div>
          <ul>${n.items.map((it) => `<li class="${it.kind}"><span class="news-tag ${it.kind}">${NEWS_LABEL[it.kind]}</span>${esc(it.text)}</li>`).join('')}</ul>
        </section>`,
      ).join('')}</div>
      <div class="footer">${newsDebuts().map((d) => `<button class="btn" data-debut="${d.id}">${HIDDEN_CHARS.includes(d.charId) ? '（確認用）' : ''}${esc(d.name)}の登場映像</button>`).join('')}<button class="btn primary" data-close>閉じる</button></div>
    </div>`;
  el.querySelectorAll<HTMLElement>('[data-debut]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = DEBUTS.find((x) => x.id === b.dataset.debut);
      el.remove();
      if (d) playDebut(d);
    }),
  );
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) {
      el.remove();
      // メニューのベルの赤い点を消す
      screensEl.querySelector('#news .m-dot')?.remove();
    }
  });
  markNewsSeen();
  screensEl.appendChild(el);
}
// ---------------------------------------------------------------------------
// 新キャラの登場映像
const DEBUT_KEY = 'buttobi-debut-seen-v1';
let debutShownOnce = false;
function debutsSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DEBUT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function markDebutSeen(id: string): void {
  try {
    localStorage.setItem(DEBUT_KEY, JSON.stringify([...new Set([...debutsSeen(), id])]));
  } catch {
    /* 保存できなくても続ける */
  }
}
/** お知らせの下に出す登場映像のボタン：いちばん新しく公開したキャラの映像だけ（次の新キャラを公開すると入れ替わる）。
 *  テスト表示中は、まだ公開していないキャラの映像も（確認用）として出す */
function newsDebuts(): DebutDef[] {
  const released = DEBUTS.filter((d) => !HIDDEN_CHARS.includes(d.charId));
  const latest = released.length ? [released[released.length - 1]] : [];
  return PREVIEW ? [...latest, ...DEBUTS.filter((d) => HIDDEN_CHARS.includes(d.charId))] : latest;
}
/** まだ見ていない登場映像（公開しているキャラだけ）。はじめての人には出さない（全部見たことにする） */
function pendingDebut(): DebutDef | undefined {
  const list = DEBUTS.filter((d) => !HIDDEN_CHARS.includes(d.charId));
  if (!progress.tutorialAsked) {
    for (const d of list) markDebutSeen(d.id);
    return undefined;
  }
  const seen = debutsSeen();
  return list.find((d) => !seen.includes(d.id));
}
/** 登場映像を流す。終わったら、CPU戦（そのキャラを選んだ状態）かメニューへ */
function playDebut(def: DebutDef): void {
  markDebutSeen(def.id);
  screensEl.innerHTML = '';
  renderer.setMenuChar(null);
  const s = new DebutSession(def, renderer, sfx, logoUrl, (act) => {
    renderer.celebrate(null);
    startDemo();
    if (act === 'cpu') {
      settings.charId = def.charId;
      saveSettings(settings);
      showLocalSetup();
    } else showMenu();
  });
  startSession(s);
  music.play('debut');
}

/** 起動してから、まだ読んでいないお知らせを自動で出したか */
let newsShownOnce = false;

function showMenu(sub: 'solo' | 'multi' | null = null): void {
  const online = !!settings.serverUrl;
  refreshMissions(progress);
  const done = progress.missions.list.filter((m) => m.done).length;
  const dot = (on: boolean) => (on ? '<span class="m-dot"></span>' : '');
  // アイコンの台の色（ボタンごと）
  const tile: Record<string, string> = {
    solo: '#ff8a3d', multi: '#3d8bff', gacha: '#ff4fa3', records: '#e0a800',
    cpu: '#ff8a3d', horde: '#e5484d', training: '#2fbf71', create: '#3d8bff', join: '#8a5cff', invite: '#2fbf71', friends: '#ff8a3d', rejoin: '#e5484d',
  };
  const big = (id: string, _icon: string, title: string, desc: string, extra = '', cls = '') =>
    `<button class="m-btn ${cls}" id="${id}">${iconTile(id, tile[id] ?? '#555')}<span class="m-tx"><b>${title}</b><small>${desc}</small></span>${extra}</button>`;
  const col =
    sub === 'solo'
      ? `<div class="m-subhead"><b>ひとりで</b></div>
         ${big('cpu', '🤖', 'CPUと対戦', 'ステージとルールを選んで対戦', '', 'primary')}
         ${big('horde', '🔥', '100人組手', progress.hordeBest ? `自己ベスト ${progress.hordeBest.kos}人` : '次々に来る敵を倒す')}
         ${big('training', '🥊', '練習モード', '技やコンボを試す')}
         <div class="m-foot"><button class="btn" id="m-back">もどる</button></div>`
      : sub === 'multi'
        ? `<div class="m-subhead"><b>みんなで</b></div>
           ${online && loadRejoin() ? big('rejoin', '↩', `ルーム ${loadRejoin()!.code} の対戦に戻る`, '途中で抜けた対戦の続きに入る', '', 'primary') : ''}
           ${big('create', '🏠', 'ルームを作る', online ? '友達とオンライン対戦' : 'サーバーが設定されていません', '', online ? 'primary' : 'off')}
           ${big('join', '🔢', 'コードで参加', online ? '4桁の合言葉を入力' : 'サーバーが設定されていません', '', online ? '' : 'off')}
           ${big('friends', '👥', 'フレンド', online ? (social.connected ? `オンライン ${social.onlineCount}人・公開ルームに参加` : 'フレンドの追加・オンラインの確認') : 'サーバーが設定されていません', dot(social.state.inbox.length > 0 || social.unread > 0), online ? '' : 'off')}
           ${big('invite', '🔗', '友達にゲームを教える', 'このゲームのURLをコピー')}
           <div class="m-foot"><button class="btn" id="m-back">もどる</button></div>`
        : `${big('solo', '🎮', 'ひとりで', 'CPU対戦・100人組手・練習', '', 'primary')}
           ${big('multi', '🌐', 'みんなで', 'ルーム・フレンド', dot(social.state.inbox.length > 0 || social.unread > 0))}
           ${big('gacha', '🎁', 'ガチャ・衣装', '衣装を引く・着替える', dot(gachaBadge(progress, wallet, GACHA_COST.one)))}
           ${big('records', '🏆', '戦績・ミッション', '今日のミッション', `<span class="m-prog">${done}/3</span>${dot(recordsBadge(progress))}`)}`;
  const c = getCharacter(settings.charId);
  const cos = getCostume(myCostume(settings.charId), settings.charId);
  showScreen(
    `<div class="m-char" id="m-char"></div>
     <div class="m-top">
       <img class="m-logo" src="${logoUrl}" alt="トバセ！" draggable="false"/>${PREVIEW ? '<span class="preview-badge">テスト表示中</span>' : ''}
       <div class="grow"></div>
       ${coinBadge()}
       ${canInstall() ? `<button class="m-icon" id="install" title="ホーム画面に追加">${ICONS.install}</button>` : ''}
       <button class="m-icon m-news" id="news" title="お知らせ">${ICONS.news}${unreadNews().length ? '<span class="m-dot"></span>' : ''}</button>
       <button class="m-icon" id="howto" title="遊び方">${ICONS.help}</button>
       <button class="m-icon" id="settings" title="設定">${ICONS.settings}</button>
     </div>
     <button type="button" class="m-plate" id="m-plate"><div class="r">${c.name}</div><div class="n">${cos.name}</div><div class="t">タップでキャラ・衣装を変更 ›</div></button>
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
        on('create', () => showCharSelect({ title: 'ルームを作る：キャラを選ぶ', slot: 0, current: onlineChar(), nextLabel: 'ルームを作る', allowRandom: true, onBack: () => showMenu('multi'), onNext: () => createRoom(0) }));
        on('join', showJoin);
      } else {
        on('create', () => toast('オンライン対戦のサーバーが設定されていません（設定画面で指定できます）'));
        on('join', () => toast('オンライン対戦のサーバーが設定されていません（設定画面で指定できます）'));
      }
      on('invite', showGameUrl);
      on('rejoin', rejoinRoom);
      on('friends', () => (online ? showFriends() : toast('オンライン対戦のサーバーが設定されていません（設定画面で指定できます）')));
      on('gacha', showGacha);
      on('records', () => showRecords('missions'));
      on('howto', showHowTo);
      on('news', () => showNews());
      on('settings', showSettings);
      on('install', () => void promptInstall().then(() => showMenu()));
      // 下の衣装名の札：タップするとキャラ・衣装の変更へ
      fitPlateName(root);
      root.querySelector('#m-plate')!.addEventListener('click', () => {
        sfx.click();
        showCharSelect({ title: 'キャラ・衣装を変える', slot: 0, current: settings.charId, nextLabel: '決定', onBack: () => showMenu(), onNext: () => showMenu() });
      });
      // 左のキャラ：なぞると回り、タップするとアクション（排出衣装の画面と同じ）
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
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) renderer.menuCharAction();
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
  // 新キャラの登場映像：その版で最初にメニューを開いたときに1回だけ（ログインボーナスのあと・お知らせの前）
  const debut = !sub && !debutShownOnce ? pendingDebut() : undefined;
  if (debut && !screensEl.querySelector('.lb-pop')) {
    debutShownOnce = true;
    setTimeout(() => {
      if (screensEl.querySelector('.menu-screen') && !screensEl.querySelector('.modal')) playDebut(debut);
    }, 400);
    return;
  }
  // 新しいアップデートがあれば、起動して最初のメニューで1回だけお知らせを出す（ログインボーナスが出ているときは次の機会に）
  if (!newsShownOnce && !sub && unreadNews().length && !screensEl.querySelector('.lb-pop')) {
    newsShownOnce = true;
    setTimeout(() => {
      if (screensEl.querySelector('.menu-screen') && !screensEl.querySelector('.modal')) showNews();
    }, 400);
  }
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
  pop.querySelector('#lb-ok')!.addEventListener('click', () => {
    pop.remove();
    // 受け取ったら、新キャラの登場映像（あれば）、なければ読んでいないお知らせをすぐ出す
    const debut = !debutShownOnce ? pendingDebut() : undefined;
    if (debut) {
      debutShownOnce = true;
      playDebut(debut);
      return;
    }
    if (!newsShownOnce && unreadNews().length && !screensEl.querySelector('.modal')) {
      newsShownOnce = true;
      showNews();
    }
  });
}
document.addEventListener('installable', () => {
  if (screensEl.querySelector('.menu-screen')) showMenu();
});

/** CPU戦のキャラ選択。fromRules = ルール画面の「キャラを変える」から来た（もどるでルール画面に戻る） */
function showLocalSetup(fromRules = false): void {
  showCharSelect({
    title: 'CPUと対戦：キャラを選ぶ',
    slot: 0,
    current: settings.charId,
    nextLabel: fromRules ? '決定' : 'つぎへ',
    onBack: fromRules ? () => showLocalRules() : () => showMenu('solo'),
    onNext: () => showLocalRules(),
  });
}

/** CPU戦のチーム分け（あなた・CPU1〜5）。はじめは あなた=赤、CPUは青・赤…と交互 */
const localTeams = [0, 1, 0, 1, 0, 1];

/** ルール画面のタブ（ステージ・ルール・CPU）。key は今のタブ */
const RULE_TABS: [string, string][] = [
  ['stage', 'ステージ'],
  ['rule', 'ルール'],
  ['cpu', 'CPU'],
];
/** オンラインのルームのタブ：対戦形式（全員で・トーナメント）を、ルールとは別のタブにする */
const LOBBY_TABS: [string, string][] = [
  ['stage', 'ステージ'],
  ['fmt', '対戦形式'],
  ['rule', 'ルール'],
  ['cpu', 'CPU'],
];
function ruleTabs(current: string, tabs = RULE_TABS): string {
  return `<div class="tabs" data-tabs>${tabs.map(([k, l]) => `<button type="button" data-tab="${k}" class="${k === current ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
/** タブを押すと、そのタブの中身（data-pane）だけを出す */
function bindTabs(root: HTMLElement, onPick: (k: string) => void): void {
  const show = (k: string) => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    root.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== k));
  };
  root.querySelector('[data-tabs]')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    show(b.dataset.tab!);
    onPick(b.dataset.tab!);
  });
  show(root.querySelector<HTMLElement>('[data-tab].on')?.dataset.tab ?? 'stage');
}
/** 選んだ内容のまとめ（対戦開始ボタンの横に出す） */
function ruleSummary(rules: MatchRules, stageId: string, cpu: number | null, cpuLevel: number): string {
  const st = stageId === RANDOM_STAGE ? 'ステージおまかせ' : getStage(stageId).name;
  return [st, ruleText(rules), cpu === null ? '' : `CPU${cpu}人（強さ${cpuLevel}）`, `アイテム${rules.items ? 'あり' : 'なし'}`].filter(Boolean).join('・');
}
let localRulesTab = 'stage';
let lobbyTab = 'stage';

function showLocalRules(): void {
  const rules = { ...settings.rules };
  if (settings.stageId !== RANDOM_STAGE && !STAGES.some((s) => s.id === settings.stageId)) settings.stageId = STAGES[0].id;
  showScreen(
    `<h2>CPUと対戦：ステージとルール <small class="h2-sub">使うキャラ：${getCharacter(settings.charId).name}</small></h2>
     ${ruleTabs(localRulesTab)}
     <div data-pane="stage">${stageCards(settings.stageId)}</div>
     <div data-pane="rule"><div class="setup-grid">${ruleControls(rules)}</div></div>
     <div data-pane="cpu">
       <div class="setup-grid">
         <div class="opt">CPUの人数 ${seg('cpu', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], settings.cpuCount)}</div>
         <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], settings.cpuLevel)}</div>
       </div>
       <div class="cpu-pick" data-cpupick></div>
       <div class="team-pick" data-team></div>
     </div>
     <div class="footer"><button class="btn" id="to-menu">もどる</button><span class="rule-sum" data-sum></span><button class="btn" id="back">キャラを変える</button><button class="btn primary" id="start">対戦開始！</button></div>`,
    'overlay',
    (root) => {
      bindTabs(root, (k) => (localRulesTab = k));
      // 選んだ内容のまとめ（何かを押すたびに更新）
      const sum = root.querySelector<HTMLElement>('[data-sum]')!;
      const drawSum = () => (sum.textContent = ruleSummary(rules, settings.stageId, settings.cpuCount, settings.cpuLevel));
      root.addEventListener('click', () => setTimeout(drawSum));
      drawSum();
      // チーム分け（タップでチームが変わる）
      const teamBox = root.querySelector<HTMLElement>('.team-pick')!;
      const drawTeams = () => {
        const names = ['あなた', ...Array.from({ length: settings.cpuCount }, (_, i) => `CPU${i + 1}`)];
        teamBox.innerHTML =
          `<div class="opt-label">チーム分け（タップで変える）</div>` +
          names.map((n, i) => {
            const t = isTwoTeam(rules.mode) ? localTeams[i] % 2 : localTeams[i];
            return `<button type="button" class="team-chip" data-i="${i}" style="--tc:${hex(TEAM_COLORS[t])}">${n}<b>${TEAM_NAMES[t]}</b></button>`;
          }).join('');
      };
      drawTeams();
      teamBox.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('.team-chip');
        if (!b) return;
        const i = Number(b.dataset.i);
        // 玉入れは赤・青の2チームだけ
        localTeams[i] = isTwoTeam(rules.mode) ? ((localTeams[i] % 2) + 1) % 2 : (localTeams[i] + 1) % TEAM_COUNT;
        sfx.click();
        drawTeams();
      });
      // CPUの相手のキャラ（タップでえらぶ。ランダムは毎試合えらび直す）
      const cpuBox = root.querySelector<HTMLElement>('[data-cpupick]')!;
      const drawCpus = () => {
        cpuBox.innerHTML =
          `<div class="opt-label">相手のキャラ（タップで変える）</div>` +
          Array.from({ length: settings.cpuCount }, (_, i) => {
            const id = settings.cpuChars[i] ?? 'random';
            const name = id === 'random' ? `${diceMark()}ランダム` : esc(getCharacter(id).name);
            return `<button type="button" class="cpu-chip ${id === 'random' ? 'rnd' : ''}" data-cpu="${i}"><small>CPU${i + 1}</small>${name}</button>`;
          }).join('');
      };
      drawCpus();
      cpuBox.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cpu]');
        if (!b) return;
        const i = Number(b.dataset.cpu);
        pickCpuChar(i, (id) => {
          settings.cpuChars[i] = id;
          saveSettings(settings);
          drawCpus();
          drawSum();
        });
      });
      bindStages(root, (v) => (settings.stageId = v));
      bindSeg(root, 'cpu', (v) => {
        settings.cpuCount = Number(v);
        drawTeams();
        drawCpus();
      });
      bindSeg(root, 'lv', (v) => (settings.cpuLevel = Number(v)));
      bindRules(root, rules, () => (settings.rules = { ...rules }));
      root.querySelector('#back')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        showLocalSetup(true);
      });
      // もどる：設定を覚えたまま「ひとりで」のメニューへ
      root.querySelector('#to-menu')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        saveSettings(settings);
        showMenu('solo');
      });
      root.querySelector('#start')!.addEventListener('click', () => {
        settings.rules = { ...rules };
        if (isTwoTeam(rules.mode)) rules.teams = true;
        const teamsUsed = new Set(localTeams.slice(0, settings.cpuCount + 1).map((t) => (isTwoTeam(rules.mode) ? t % 2 : t)));
        if (rules.teams && teamsUsed.size < 2) return toast('チーム戦は2チーム以上に分けてください');
        saveSettings(settings);
        const players: MatchSetup['players'] = [{ slot: 0, name: settings.name || 'あなた', charId: settings.charId, cpu: false, cpuLevel: 0, costume: myCostume(settings.charId), team: localTeams[0] }];
        for (let i = 1; i <= settings.cpuCount; i++) {
          players.push({ slot: i, name: `CPU ${settings.cpuLevel}`, charId: settings.cpuChars[i - 1] ?? 'random', cpu: true, cpuLevel: settings.cpuLevel, team: localTeams[i] });
        }
        cpuSpec = players.map((p) => p.charId);
        rollCpuChars(players);
        const seed = (Math.random() * 1e9) | 0;
        lastSetup = { players, stageId: resolveStage(settings.stageId, seed), rules: settings.rules, seed };
        const setup = lastSetup;
        // おまかせ：ルーレットで決めてから始める
        if (settings.stageId === RANDOM_STAGE) stageRoulette(setup.stageId, () => startSession(new LocalSession(setup)));
        else startSession(new LocalSession(setup));
      });
    },
  );
}

/** CPU戦で選んだ相手のキャラ（'random' を含む）。「もう一度」のたびにランダムをえらび直すために覚えておく */
let cpuSpec: string[] | null = null;

/** 'random' のCPUのキャラを決める（なるべく、自分やほかのCPUと同じキャラにならないように） */
function rollCpuChars(players: MatchSetup['players']): void {
  const used = new Set(players.filter((p) => p.charId !== 'random').map((p) => p.charId));
  for (const p of players) {
    if (p.charId !== 'random') continue;
    const pool = CHARACTERS.filter((c) => !used.has(c.id));
    const list = pool.length ? pool : CHARACTERS;
    p.charId = list[(Math.random() * list.length) | 0].id;
    used.add(p.charId);
  }
  // キャラが決まったら、CPU に見分けられる名前を付ける（「CPU 配信者」など）
  nameCpus(players);
}

/** 相手のCPUのキャラをえらぶ（ランダム＋全キャラ） */
/** ホームの名札：衣装名を1行に収める（入りきらなければ文字を小さくする） */
function fitPlateName(root: ParentNode = document): void {
  const n = root.querySelector<HTMLElement>('.m-plate .n');
  if (!n) return;
  let size = 17;
  n.style.fontSize = `${size}px`;
  while (size > 9 && n.scrollWidth > n.clientWidth + 0.5) {
    size -= 0.5;
    n.style.fontSize = `${size}px`;
  }
}
window.addEventListener('resize', () => fitPlateName());

/** 確かめる画面（ゲームの中の画面で出す。ホーム画面に追加したアプリでも確実に出るように） */
function confirmDialog(title: string, note: string, okLabel: string, onOk: () => void): void {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box confirm-box">
      <h3>${esc(title)}</h3>
      ${note ? `<p class="muted">${esc(note)}</p>` : ''}
      <div class="footer"><button class="btn primary" data-close>やめる</button><button class="btn danger" data-ok>${esc(okLabel)}</button></div>
    </div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-ok]')) {
      el.remove();
      onOk();
    } else if (t === el || t.closest('[data-close]')) el.remove();
  });
  screensEl.appendChild(el);
}

function pickCpuChar(i: number, onPick: (id: string) => void, current?: string): void {
  const cur = current ?? settings.cpuChars[i] ?? 'random';
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box">
      <h3>CPU${i + 1}のキャラ</h3>
      <div class="modal-body cpu-grid">
        <button type="button" class="cpu-opt rnd ${cur === 'random' ? 'on' : ''}" data-id="random">${diceMark()}ランダム<small>毎試合かわる</small></button>
        ${CHARACTERS.map((c) => `<button type="button" class="cpu-opt ${cur === c.id ? 'on' : ''}" data-id="${c.id}">${esc(c.name)}<small>${esc(c.role)}</small></button>`).join('')}
      </div>
      <div class="footer"><button class="btn" data-close>閉じる</button></div>
    </div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const b = t.closest<HTMLElement>('[data-id]');
    if (b) {
      onPick(b.dataset.id!);
      sfx.click();
      el.remove();
    } else if (t === el || t.closest('[data-close]')) el.remove();
  });
  screensEl.appendChild(el);
}

/** 100人組手を始める（自分＋敵3人。敵は倒されると次の敵が出てくる） */
function startHorde(): void {
  cpuSpec = null;
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
     ${lines.length ? `<div class="reward-sub">${lines.map((l) => `<div>${rewardMark()}${l}</div>`).join('')}</div>` : ''}
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

/** 結果画面の見出し（玉入れは点数つき。同点なら引き分け） */
function resultTitle(results: ResultEntry[], setup: MatchSetup, winner: PlayerSetup | null | undefined): string {
  if (setup.rules.mode === 'ball') {
    const red = results.find((r) => ballTeamOf(setup, r.slot) === 0)?.teamGoals ?? 0;
    const blue = results.find((r) => ballTeamOf(setup, r.slot) === 1)?.teamGoals ?? 0;
    if (red === blue) return `引き分け！ <small>${red} - ${blue}</small>`;
    return `${TEAM_NAMES[red > blue ? 0 : 1]}チームの勝ち！ <small>${red} - ${blue}</small>`;
  }
  if (setup.rules.mode === 'vault') {
    // 金庫まもり：どちらのチームの金庫が多く壊れたか（壊した%）
    // 勝ち負けは順位で決める（表示は小数第1位までなので、表示が同じでも差があることがある）
    const red = results.find((r) => ballTeamOf(setup, r.slot) === 0);
    const blue = results.find((r) => ballTeamOf(setup, r.slot) === 1);
    const pct = (r: ResultEntry | undefined) => (r?.vaultBroke ?? 0).toFixed(1);
    const top = [red, blue].filter((r) => r?.rank === 1);
    if (top.length !== 1) return `引き分け！ <small>${pct(red)}% - ${pct(blue)}%</small>`;
    return `${TEAM_NAMES[top[0] === red ? 0 : 1]}チームの勝ち！ <small>壊した ${pct(red)}% - ${pct(blue)}%</small>`;
  }
  if (!winner) return '結果';
  return setup.rules.teams ? `${TEAM_NAMES[(winner.team ?? 0) % TEAM_NAMES.length]}チームの勝ち！` : esc(winner.name) + ' の勝ち！';
}

// 定型文のスタンプ：ロビーと結果画面の下にボタンを並べ、届いたら画面の下に吹き出しで出す
const stampLayer = document.createElement('div');
stampLayer.id = 'stamps';
document.getElementById('app')!.appendChild(stampLayer);
/** ホストを譲る相手を選ぶ（選んだら確認してから送る） */
function openGiveHost(list: { slot: number; name: string; charId: string }[]): void {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="modal-box">
      <h3>ホストを譲る</h3>
      <div class="modal-body">
        <p class="muted">ホストはルールやステージを決めて、対戦を始められます。譲る相手を選んでください。</p>
        <div class="host-list">${list.map((p) => `<button type="button" class="btn" data-to="${p.slot}"><b>${esc(p.name)}</b><small>${charLabel(p.charId)}</small></button>`).join('')}</div>
      </div>
      <div class="footer"><button class="btn" data-close>やめる</button></div>
    </div>`;
  const close = () => el.remove();
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === el || t.closest('[data-close]')) return close();
    const b = t.closest<HTMLElement>('[data-to]');
    if (!b) return;
    const p = list.find((x) => x.slot === Number(b.dataset.to));
    if (!p) return;
    if (!confirm(`${p.name} さんにホストを譲りますか？`)) return;
    net.giveHost(p.slot);
    sfx.click();
    close();
  });
  screensEl.appendChild(el);
}

function stampBar(): string {
  return `<div class="stamp-bar"><button type="button" class="stamp-btn pic-open" data-picopen>${chatMark()}絵スタンプ</button>${STAMPS.map((t, i) => `<button type="button" class="stamp-btn" data-stamp="${i}">${t}</button>`).join('')}</div>`;
}
/** 定型文・絵スタンプを送れる間隔（サーバーも1秒に1回まで） */
const ROOM_STAMP_MS = 1000;
let roomStampAt = 0;
function sendRoomStamp(id: number, pic: boolean): void {
  // 戦っている最中・観戦中は送れない
  if (fightingNow() || net.spectating || net.slot < 0) return;
  const now = Date.now();
  if (now - roomStampAt < ROOM_STAMP_MS) return;
  if (pic && !stampTier(wallet, id)) return;
  roomStampAt = now;
  net.stamp(id, pic, pic ? stampTier(wallet, id) : 4);
  sfx.click();
  // 連打しすぎないよう、少しの間押せなくする
  const all = () => document.querySelectorAll<HTMLButtonElement>('[data-stamp], [data-pstamp]');
  all().forEach((x) => (x.disabled = true));
  setTimeout(() => all().forEach((x) => (x.disabled = false)), ROOM_STAMP_MS);
}
function bindStampBar(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-stamp]').forEach((b) => b.addEventListener('click', () => sendRoomStamp(Number(b.dataset.stamp), false)));
  root.querySelector('[data-picopen]')?.addEventListener('click', () => openPicPalette());
}
/** 持っている絵スタンプのボタン（持っているレア度で表示） */
function ownedStampButtons(attr: 'dmsend' | 'pstamp', extra = ''): string {
  return PIC_STAMPS.map((_, i) => {
    const t = stampTier(wallet, i);
    return t ? `<button type="button" class="pic-btn" data-${attr}="${attr === 'dmsend' ? `s:${i}` : i}" ${extra}>${picStamp(i, t)}</button>` : '';
  }).join('');
}
/** まだ持っていないスタンプがあるときの案内 */
function stampMoreNote(): string {
  const n = PIC_STAMPS.filter((_, i) => !stampTier(wallet, i)).length;
  return n ? `<p class="muted small-note">ほかに ${n} 種類のスタンプがあります（ガチャの「スタンプ＆背景ガチャ」で出ます）。</p>` : '';
}

/** ルームで送る絵スタンプを選ぶ */
function openPicPalette(withText = false): void {
  document.getElementById('pic-pal')?.remove();
  const el = document.createElement('div');
  el.className = 'modal';
  el.id = 'pic-pal';
  el.innerHTML = `<div class="modal-box pic-pal-box">
      <h3>スタンプを送る</h3>
      <div class="modal-body">
        <div class="pic-grid">${ownedStampButtons('pstamp')}</div>${stampMoreNote()}
        ${withText ? `<div class="dm-chips pal-text">${STAMPS.map((t, i) => `<button type="button" class="stamp-btn" data-ptext="${i}">${t}</button>`).join('')}</div>` : ''}
      </div>
      <div class="footer"><button class="btn" data-close>閉じる</button></div>
    </div>`;
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const p = t.closest<HTMLButtonElement>('[data-pstamp]');
    const q = t.closest<HTMLButtonElement>('[data-ptext]');
    if (p && !p.disabled) {
      sendRoomStamp(Number(p.dataset.pstamp), true);
      el.remove();
    } else if (q) {
      sendRoomStamp(Number(q.dataset.ptext), false);
      el.remove();
    } else if (t === el || t.closest('[data-close]')) el.remove();
  });
  screensEl.appendChild(el);
}
function showStamp(slot: number, name: string, text: string, html = ''): void {
  if (!text && !html) return;
  const el = document.createElement('div');
  el.className = `stamp-pop ${html ? 'pic' : ''}`;
  el.style.setProperty('--pc', slot >= 0 ? hex(SLOT_COLORS[slot % SLOT_COLORS.length]) : '#c8ccd8');
  el.innerHTML = `<small>${esc(name)}</small>${html || esc(text)}`;
  stampLayer.appendChild(el);
  // 多いときは古いものから消す
  while (stampLayer.children.length > 4) stampLayer.firstElementChild?.remove();
  setTimeout(() => el.remove(), 2800);
}

/** ルームをフレンドに公開しているか（ルームを作るたびに「しない」から始め、ボタンで公開する） */
let roomShared = false;
/** ホストのとき、ルームをフレンドに公開する（「しない」なら取り消す） */
function updateRoomShare(): void {
  const l = lobby;
  if (!l || net.spectating || l.hostSlot !== net.slot || !roomShared) return social.shareRoom(null);
  social.shareRoom({ code: l.code, n: l.players.length, max: MAX_PLAYERS, match: l.inMatch });
}

// ---------------------------------------------------------------------------
// 乱入アイテム：試合に出ていない人（トーナメントの待ち・観戦）が、1試合に1回だけアイテムを落とせる
const dropEl = document.createElement('div');
dropEl.id = 'dropbar';
dropEl.className = 'hidden';
document.getElementById('app')!.appendChild(dropEl);
let dropUsed = false;
let dropTimer = 0;

function hideDrop(): void {
  dropEl.classList.add('hidden');
  clearTimeout(dropTimer);
}

function renderDrop(): void {
  // 乱入アイテムはトーナメントのときだけ
  if (session?.kind !== 'net' || session.mySlot !== -1 || session.setup.rules.horde || resultsShown || lobby?.dropOn === false || !lobby?.tourOn) return hideDrop();
  dropEl.classList.remove('hidden');
  dropEl.innerHTML = dropUsed
    ? `<div class="drop-title">乱入アイテム</div><div class="drop-done">投入済み</div>`
    : `<div class="drop-title">乱入アイテム<small>1試合に1回</small></div>${ITEM_NAMES.map((n, i) => ((session?.setup.rules.itemKinds ?? [i]).includes(i) ? `<button type="button" class="drop-btn" data-drop="${i}"><b>${n}</b><small>${ITEM_INFO[i].short}</small></button>` : '')).join('')}`;
  dropEl.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((b) =>
    b.addEventListener('click', () => {
      if (dropUsed) return;
      dropUsed = true;
      net.drop(Number(b.dataset.drop));
      sfx.click();
      renderDrop();
    }),
  );
}

/** 試合が始まった：試合に出ていなければ、カウントダウンのあとに乱入アイテムのボタンを出す */
function onDropStart(setup: MatchSetup): void {
  dropUsed = false;
  hideDrop();
  if (setup.players.some((p) => p.slot === net.slot && net.slot >= 0) || setup.rules.horde || lobby?.dropOn === false || !lobby?.tourOn) return;
  dropTimer = window.setTimeout(renderDrop, (COUNTDOWN_FRAMES / 60) * 1000);
}

// ---------------------------------------------------------------------------
// 勝敗予想：試合に出ていない人（トーナメントの待ち・観戦）が勝つ人を予想する
/** みんなの予想（n = 予想した人、p = 勝つと思う選手の slot） */
let predicts: { n: string; p: number }[] = [];
/** 自分の予想（-1 = していない） */
let myPick = -1;
/** 終わった試合の予想の結果（結果画面に出す） */
let predictResult: { pick: number; hit: boolean; odds: number; coins: number; list: { n: string; p: number }[] } | null = null;
const predictEl = document.createElement('div');
predictEl.id = 'predict';
predictEl.className = 'hidden';
document.getElementById('app')!.appendChild(predictEl);
let predictClose = 0;
let predictSetup: MatchSetup | null = null;
/** トーナメントの試合（予想は試合の前に締め切り） */
let predictTour = false;
/** 「みんなの予想」を試合の始めに見せる時間（カウントダウンの間＋少し） */
const PREDICT_SHOW_MS = 4500;
let predictShowUntil = 0;

// ---------------------------------------------------------------------------
// 観戦されている表示：対戦中、左上に「目」と観戦の人数。押すと、だれが見ていて、だれがだれに予想したかを出す
const watchEl = document.createElement('button');
watchEl.type = 'button';
watchEl.id = 'watching';
watchEl.className = 'hidden';
document.getElementById('app')!.appendChild(watchEl);
let watchOpen = false;
let watchAutoClose = 0;
let watchSeen = '';
watchEl.addEventListener('click', () => {
  watchOpen = !watchOpen;
  clearTimeout(watchAutoClose);
  renderWatch();
});

function renderWatch(): void {
  const setup = session?.kind === 'net' && !resultsShown && lobby?.inMatch ? session.setup : null;
  const watchers = lobby?.watchers ?? [];
  const votes = setup ? predicts.filter((x) => setup.players.some((p) => p.slot === x.p)) : [];
  if (!setup || (!watchers.length && !votes.length)) {
    watchEl.className = 'hidden';
    watchOpen = false;
    watchSeen = '';
    return;
  }
  // 新しく見に来た人・予想した人がいたら、少しの間だけ中身を開いて知らせる
  const key = `${watchers.join('|')}#${votes.map((v) => `${v.n}>${v.p}`).join('|')}`;
  if (watchSeen && key !== watchSeen && !watchOpen) {
    watchOpen = true;
    clearTimeout(watchAutoClose);
    watchAutoClose = window.setTimeout(() => {
      watchOpen = false;
      renderWatch();
    }, 4000);
  }
  watchSeen = key;
  const nameOf = (slot: number) => esc(setup.players.find((p) => p.slot === slot)?.name ?? '？');
  const detail = watchOpen
    ? `<span class="w-detail">${watchers.length ? `<span class="w-row"><b>観戦</b>${watchers.map(esc).join('、')}</span>` : ''}${
        votes.length ? `<span class="w-row"><b>予想</b>${votes.map((v) => `${esc(v.n)}→${nameOf(v.p)}`).join('、')}</span>` : ''
      }</span>`
    : '';
  watchEl.className = watchOpen ? 'open' : '';
  watchEl.innerHTML = `<span class="w-head">${eyeMark()}観戦 ${watchers.length}人${votes.length ? `・予想 ${votes.length}` : ''}</span>${detail}`;
}

/** この試合で予想できるか（個人戦で、自分が出ていない） */
function canPredictMatch(setup: MatchSetup): boolean {
  const r = setup.rules;
  return !r.teams && !isTwoTeam(r.mode) && !r.horde && !setup.players.some((p) => p.slot === net.slot && net.slot >= 0);
}

function hidePredict(): void {
  predictEl.classList.add('hidden');
  predictSetup = null;
  clearTimeout(predictClose);
}

/** 予想の票の数（slot → 人数） */
function predictCount(slot: number): number {
  return predicts.filter((x) => x.p === slot).length;
}

/** 選手を選ぶボタン（試合中のパネル・トーナメントの合間で使う） */
function pickButtons(players: { slot: number; name: string; charId: string }[], open: boolean, showWho = false): string {
  const cands = players.map((p) => p.slot);
  const votes = predicts.map((x) => x.p);
  return players
    .map((p) => {
      const n = predictCount(p.slot);
      // 今のオッズ（票が少ないほど高い。締め切りまで変わる）
      const odds = predictOdds(votes, p.slot, cands);
      return `<button type="button" class="pick-btn ${myPick === p.slot ? 'on' : ''}" data-pick="${p.slot}" ${open ? '' : 'disabled'} style="--pc:${hex(SLOT_COLORS[p.slot % SLOT_COLORS.length])}"><b>${esc(p.name)}</b><small>${charLabel(p.charId)}</small><span class="pick-odds">×${odds.toFixed(1)}</span>${n ? `<span class="pick-n">${n}票</span>` : ''}${showWho ? `<span class="pick-who">${n ? predicts.filter((x) => x.p === p.slot).map((x) => esc(x.n)).join('、') : '予想なし'}</span>` : ''}</button>`;
    })
    .join('');
}
/** 予想の説明（オッズのしくみ） */
const PREDICT_NOTE = `当たると ${PREDICT_REWARD}コイン×オッズ（票が少ない人ほど高い）`;

function bindPickButtons(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      myPick = Number(b.dataset.pick);
      net.predict(myPick);
      sfx.click();
      renderPredict();
      updateTourInfo();
    }),
  );
}

/** 試合中のパネル（予想できる時間は選べる。過ぎたら自分の予想だけ小さく出す） */
function renderPredict(): void {
  const setup = predictSetup;
  if (!setup || session?.kind !== 'net') return hidePredict();
  if (predictTour) {
    // トーナメント：予想は試合の前に締め切り。始まってすぐ、だれがだれに予想したかを全員に見せる
    if (performance.now() < predictShowUntil && predicts.length) {
      predictEl.classList.remove('hidden', 'mini');
      predictEl.classList.add('show');
      predictEl.innerHTML = `<div class="pr-title">${predictMark(true)}みんなの予想</div><div class="pr-btns">${pickButtons(setup.players, false, true)}</div>`;
      return;
    }
    predictEl.classList.remove('show');
    if (myPick < 0) return void predictEl.classList.add('hidden');
    predictEl.classList.remove('hidden');
    predictEl.classList.add('mini');
    const p = setup.players.find((x) => x.slot === myPick);
    predictEl.innerHTML = `<div class="pr-mini">あなたの予想：<b>${esc(p?.name ?? '？')}</b>${p ? `（${charLabel(p.charId)}）` : ''}</div>`;
    return;
  }
  predictEl.classList.remove('show');
  const open = (lastView?.frame ?? 0) < PREDICT_FRAMES - 20;
  if (!open && myPick < 0) {
    predictEl.classList.add('hidden');
    return;
  }
  predictEl.classList.remove('hidden');
  predictEl.classList.toggle('mini', !open);
  if (!open) {
    const p = setup.players.find((x) => x.slot === myPick);
    predictEl.innerHTML = `<div class="pr-mini">あなたの予想：<b>${esc(p?.name ?? '？')}</b>${p ? `（${charLabel(p.charId)}）` : ''}</div>`;
    return;
  }
  predictEl.innerHTML = `<div class="pr-title">${predictMark(true)}勝つのはだれ？ 予想しよう<small>${PREDICT_NOTE}</small></div><div class="pr-btns">${pickButtons(setup.players, true)}</div>`;
  bindPickButtons(predictEl);
}

/** 試合が始まった：予想のパネルを出す（トーナメントの合間に選んだ予想は引き継ぐ） */
function onPredictStart(setup: MatchSetup): void {
  if (!setup.players.some((p) => p.slot === myPick)) myPick = -1;
  predictTour = !!lobby?.tourOn;
  if (predictTour) {
    // トーナメント：試合に出る人も含めて全員に、始まってすぐ「みんなの予想」を見せる
    predictSetup = setup;
    predictShowUntil = performance.now() + PREDICT_SHOW_MS;
    renderPredict();
    clearTimeout(predictClose);
    predictClose = window.setTimeout(renderPredict, PREDICT_SHOW_MS + 100);
    return;
  }
  if (!canPredictMatch(setup)) {
    myPick = -1;
    return hidePredict();
  }
  predictSetup = setup;
  renderPredict();
  clearTimeout(predictClose);
  // 予想できる時間が過ぎたら小さくする
  predictClose = window.setTimeout(renderPredict, ((PREDICT_FRAMES - 20) / 60) * 1000 + 300);
}

/** 試合が終わった：予想が当たったか */
function onPredictEnd(results: ResultEntry[]): void {
  const list = predicts.slice();
  predictResult = null;
  // オッズは締め切った時点（＝試合が終わったとき）の票で決める
  const cands = predictSetup?.players.map((p) => p.slot) ?? results.map((r) => r.slot);
  const votes = list.map((x) => x.p);
  if (myPick >= 0) {
    const hit = results.find((r) => r.slot === myPick)?.rank === 1;
    const odds = predictOdds(votes, myPick, cands);
    const coins = hit ? predictCoins(odds) : 0;
    if (hit) {
      wallet.coins += coins;
      saveWallet(wallet);
    }
    predictResult = { pick: myPick, hit, odds, coins, list };
    // 予想の成績を記録して、フレンドの予想ランキングに出す。称号も調べる
    const pr = (progress.pred ??= { n: 0, hit: 0, coins: 0 });
    pr.n++;
    if (hit) {
      pr.hit++;
      pr.coins += coins;
    }
    for (const t of checkTitles(progress, wallet)) toast(`称号「${t.name}」を手に入れた！ +${t.coins}`, 3500);
    saveProgress(progress);
    saveWallet(wallet);
    social.setProfile(myProfile());
  } else if (list.length) {
    predictResult = { pick: -1, hit: false, odds: 0, coins: 0, list };
  }
  myPick = -1;
  hidePredict();
}

/** 結果画面の予想の行 */
function predictLines(results: ResultEntry[], setup: MatchSetup): string {
  const pr = predictResult;
  if (!pr) return '';
  const winners = new Set(results.filter((r) => r.rank === 1).map((r) => r.slot));
  const nameOf = (slot: number) => {
    const p = setup.players.find((x) => x.slot === slot);
    return p ? `${esc(p.name)}・${charLabel(p.charId)}` : '？';
  };
  const hits = pr.list.filter((x) => winners.has(x.p)).map((x) => esc(x.n));
  const lines: string[] = [];
  if (pr.pick >= 0)
    lines.push(
      pr.hit
        ? `${predictMark(true)}<b>予想的中！</b>（${nameOf(pr.pick)}） オッズ×${pr.odds.toFixed(1)} → <b>+${pr.coins} コイン</b>`
        : `${predictMark(false)}予想はハズレ…（${nameOf(pr.pick)}・オッズ×${pr.odds.toFixed(1)}）`,
    );
  if (pr.list.length) lines.push(hits.length ? `予想が当たった人：${hits.join('、')}` : `予想が当たった人：なし（${pr.list.length}人が予想）`);
  return `<div class="reward-sub predict-res">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// トーナメント
/** 優勝したときのごほうび（コイン） */
const TOUR_PRIZE = 100;
/** 次の試合が自動で始まる時刻（端末の時計。0 = 予定なし） */
let tourDeadline = 0;
/** 「あと◯秒で〜」の言葉（予想を待っている間は「締め切り」） */
let tourLeftLabel = '開始';
let tourTick = 0;
/** 優勝のごほうびをもらったトーナメント */
let tourPaid = -1;

/** 組み合わせ表（回戦ごとの列） */
function tourBracket(t: TourInfo): string {
  const name = (slot: number) => t.entrants.find((e) => e.slot === slot);
  const cell = (slot: number, m: { w: number }, r: number, bye: boolean) => {
    if (slot < 0) return `<div class="tb-p tbd">${bye ? 'シード' : '？'}</div>`;
    const e = name(slot);
    // シード（相手なし）は勝ちの色にしない
    const cls = m.w < 0 || bye ? '' : m.w === slot ? 'win' : 'lose';
    return `<div class="tb-p ${cls} ${slot === net.slot ? 'me' : ''}"><span class="dot" style="background:${hex(SLOT_COLORS[slot % SLOT_COLORS.length])}"></span>${esc(e?.name ?? '？')}<small>${e ? charLabel(e.charId) : ''}</small>${r === t.rounds.length - 1 && m.w === slot ? championMark() : ''}</div>`;
  };
  return `<div class="tour-bracket">${t.rounds
    .map(
      (ms, r) => `<div class="tb-col"><div class="tb-round">${roundName(r, t.rounds.length)}</div><div class="tb-ms">${ms
        .map((m, i) => {
          const now = t.cur && t.cur[0] === r && t.cur[1] === i;
          const bye = r === 0 && m.b < 0;
          return `<div class="tb-match ${now ? 'now' : ''}">${cell(m.a, m, r, bye)}${cell(m.b, m, r, bye)}</div>`;
        })
        .join('')}</div></div>`,
    )
    .join('')}${
    // 3位決定戦（決勝の前に行う）：いちばん右の列に、決勝の下に並べる
    t.third
      ? `<div class="tb-col tb-third"><div class="tb-round">${roundName(THIRD, t.rounds.length)}</div><div class="tb-ms"><div class="tb-match ${t.cur && t.cur[0] === THIRD ? 'now' : ''}">${cell(t.third.a, t.third, THIRD, false)}${cell(t.third.b, t.third, THIRD, false)}</div>${t.third.w >= 0 ? '<div class="tb-third-note">3位</div>' : ''}</div></div>`
      : ''
  }</div>`;
}

/** 次の試合の説明（だれとだれ・あと何秒） */
function tourStatus(t: TourInfo): string {
  if (t.champion >= 0) {
    const e = t.entrants.find((x) => x.slot === t.champion);
    return `<div class="tour-status champ">${championMark()}優勝：${esc(e?.name ?? '？')}${t.champion === net.slot ? '（あなた）' : ''}</div>`;
  }
  if (t.cur) return `<div class="tour-status">試合中…</div>`;
  const next = nextMatch(t.rounds, t.third);
  const m = next ? matchAt(t.rounds, t.third, next[0], next[1]) : undefined;
  const r = next ? next[0] : 0;
  if (!m) return '';
  const nm = (slot: number) => esc(t.entrants.find((x) => x.slot === slot)?.name ?? '？');
  const left = tourDeadline ? Math.max(0, Math.ceil((tourDeadline - Date.now()) / 1000)) : 0;
  const mine = m.a === net.slot || m.b === net.slot;
  // 自分が出ない試合は、勝敗を予想できる
  const ents = [m.a, m.b].map((slot) => t.entrants.find((x) => x.slot === slot)!).filter(Boolean);
  // 試合に出る人には、だれがどちらに予想したかを見せる（押せない）
  const need = t.need ?? 0;
  const voted = t.voted ?? 0;
  const head = mine ? `みんなの予想（${voted}/${need}人）` : `勝つのはだれ？（${PREDICT_NOTE}）`;
  const pick = need > 0 || !mine ? `<div class="pr-btns tour-pick"><span class="muted">${predictMark(true)}${head}</span>${pickButtons(ents, !mine, true)}</div>` : '';
  const vote = need > 0 ? (voted >= need ? '全員が予想しました。まもなく開始！' : `予想 ${voted}/${need}人（全員そろうと始まります）`) : '';
  tourLeftLabel = need > 0 && voted < need ? '締め切り' : '開始';
  return `<div class="tour-status ${mine ? 'mine' : ''}">次の試合（${roundName(r, t.rounds.length)}）：${nm(m.a)} vs ${nm(m.b)}${mine ? '　← あなたの出番！' : ''}${vote ? `<span class="tour-vote">${vote}</span>` : ''}<span class="tour-left" data-tour-left>${left ? `あと${left}秒で${tourLeftLabel}` : ''}</span></div>${pick}`;
}

/** ロビーの情報が届いたとき：自動開始の時刻と、優勝のごほうび */
function onTourLobby(l: LobbyInfo): void {
  const t = l.tour;
  tourDeadline = t && t.nextIn > 0 ? Date.now() + t.nextIn : 0;
  if (t && t.champion >= 0 && t.champion === net.slot && tourPaid !== t.id) {
    tourPaid = t.id;
    wallet.coins += TOUR_PRIZE;
    // 優勝の回数を記録して、プロフィールに出す（称号も調べる）
    (progress.tour ??= { wins: 0, third: 0 }).wins++;
    for (const tt of checkTitles(progress, wallet)) toast(`称号「${tt.name}」を手に入れた！ +${tt.coins}`, 3500);
    saveProgress(progress);
    saveWallet(wallet);
    social.setProfile(myProfile());
    toast(`トーナメント優勝！ +${TOUR_PRIZE} コイン`, 4000);
  }
  // 決勝で負けたら、準優勝の回数を記録する（トーナメントごとに1回）
  const fin = t && t.champion >= 0 ? t.rounds[t.rounds.length - 1]?.[0] : undefined;
  const runnerUp = fin ? (fin.a === t!.champion ? fin.b : fin.a) : -1;
  if (t && runnerUp >= 0 && runnerUp === net.slot && tourSecondPaid !== t.id) {
    tourSecondPaid = t.id;
    (progress.tour ??= { wins: 0, third: 0 }).second = (progress.tour.second ?? 0) + 1;
    saveProgress(progress);
    social.setProfile(myProfile());
    toast('トーナメント準優勝！', 3000);
  }
  // 3位決定戦に勝ったら、3位の回数を記録する（トーナメントごとに1回）
  if (t && t.third && t.third.w >= 0 && t.third.w === net.slot && tourThirdPaid !== t.id) {
    tourThirdPaid = t.id;
    (progress.tour ??= { wins: 0, third: 0 }).third++;
    saveProgress(progress);
    social.setProfile(myProfile());
    toast('トーナメント3位！', 3000);
  }
  updateTourInfo();
}

/** 3位を記録したトーナメント */
let tourThirdPaid = -1;
let tourSecondPaid = -1;

/** 結果画面・ロビーのトーナメント表示を最新にする */
function updateTourInfo(): void {
  const el = screensEl.querySelector<HTMLElement>('[data-tour]');
  const t = lobby?.tour;
  if (!el) return;
  el.innerHTML = t && lobby?.tourOn ? `${tourStatus(t)}${tourBracket(t)}` : '';
  bindPickButtons(el);
  // 結果画面のホストのボタン（トーナメントの途中は出さず、全員の「OK！」で始める）
  const btn = screensEl.querySelector<HTMLElement>('#rematch');
  if (btn && t && lobby?.tourOn) btn.textContent = 'もう一度トーナメント';
  updateAgainInfo();
  if (!tourTick) {
    tourTick = window.setInterval(() => {
      const left = screensEl.querySelector<HTMLElement>('[data-tour-left]');
      if (!left) return;
      const n = tourDeadline ? Math.max(0, Math.ceil((tourDeadline - Date.now()) / 1000)) : 0;
      left.textContent = n ? `あと${n}秒で${tourLeftLabel}` : '';
    }, 500);
  }
}

/** 結果画面：「もう1戦したい」の人数と、自分が押しているか */
function updateAgainInfo(): void {
  const el = screensEl.querySelector<HTMLElement>('[data-again]');
  if (!el || !lobby) return;
  const humans = lobby.players.filter((p) => !p.cpu && p.connected);
  const want = (lobby.again ?? []).filter((s) => humans.some((h) => h.slot === s));
  const isHost = lobby.hostSlot === net.slot;
  const tour = lobby.tourOn && lobby.tour ? (lobby.tour.champion >= 0 ? 'again' : 'next') : null;
  // トーナメントの途中：ホストも含めた全員の「OK！」で、待たずに次の試合へ
  if (tour === 'next') {
    el.textContent = `OK ${want.length}/${humans.length}人（全員が押すと、待たずに次の試合が始まります）`;
  } else {
    const label = tour === 'again' ? 'もう一度トーナメント' : 'もう1戦したい';
    el.textContent = want.length ? `${label}：${want.length}/${humans.length}人${isHost ? '' : '（全員そろうと始まります）'}` : isHost ? '' : '全員が押すか、ホストが始めると再戦します';
  }
  const rematch = screensEl.querySelector<HTMLElement>('#rematch');
  if (rematch) rematch.classList.toggle('hidden', tour === 'next');
  const btn = screensEl.querySelector<HTMLElement>('#want-again');
  if (btn) {
    const mine = want.includes(net.slot);
    // ホストは、トーナメントの途中だけ「OK！」を出す（それ以外は「同じメンバーで再戦」などのボタン）
    btn.classList.toggle('hidden', isHost && tour !== 'next');
    const label = tour === 'next' ? 'OK' : tour === 'again' ? 'もう一度トーナメント' : 'もう1戦したい';
    btn.textContent = mine ? `${label}（取り消す）` : `${label}！`;
    btn.classList.toggle('primary', !mine);
  }
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
    if (setup.rules.mode === 'ball') award('ゴールゲッター', (r) => r.goals ?? 0);
    if (setup.rules.mode === 'vault') award('金庫破り', (r) => r.vaultDmg ?? 0, 1);
    if (setup.rules.mode === 'coins') award('コイン長者', (r) => r.coins ?? 0, 1);
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
        <div><span style="color:${hex(playerColor(setup, p.slot))}">●</span> ${isTwoTeam(setup.rules.mode) ? `<small>${TEAM_NAMES[ballTeamOf(setup, p.slot)]}</small> ` : setup.rules.teams ? `<small>${TEAM_NAMES[(p.team ?? 0) % TEAM_NAMES.length]}</small> ` : ''}${esc(p.name)} <small style="color:var(--muted)">${c.name}</small>${badges ? `<div class="awards">${badges}</div>` : ''}</div>
        <div style="font-size:12px;color:var(--muted);text-align:right">${r.area !== undefined ? `<b class="res-area">エリア ${r.area}%</b><br/>` : ''}${r.goals !== undefined ? `<b class="res-area">ゴール ${r.goals}</b><br/>` : ''}${r.crown !== undefined ? `<b class="res-area">王冠 ${r.crown}秒</b><br/>` : ''}${r.vaultDmg !== undefined ? `<b class="res-area">金庫に ${r.vaultDmg}</b><br/>` : ''}${r.bounty !== undefined ? `<b class="res-area">${r.bounty}点</b><br/>` : ''}${r.coins !== undefined ? `<b class="res-area">コイン ${r.coins}枚</b><br/>` : ''}撃墜 ${r.kos} / 落下 ${r.falls}<br/>与ダメ ${r.dealt ?? 0}%${r.throws ? `・投げ ${r.throws}` : ''}</div></div>`;
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
    // 勝利のコインは1日 WIN_DAILY_CAP 枚まで。今日の分と上限を出す
    const cap = r.capped ? (r.base > 0 ? `<span class="cap">本日の上限に達しました</span>` : `<span class="cap">本日の上限に達しているため、勝利のコインはもらえません</span>`) : '';
    reward = `<div class="reward"><span class="coin-icon"></span>勝利 +${r.base} コイン${cap}${
      r.bonus ? `<span class="bonus">通算${r.bonus.wins}勝ボーナス +${r.bonus.amount}</span>` : ''
    }<small>（本日の勝利コイン ${r.today}/${WIN_DAILY_CAP}・所持 __COINS__・通算 ${r.total} 勝）</small></div>`;
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
      mode: setup.rules.horde ? undefined : setup.rules.mode,
    };
    const got = recordMatch(progress, wallet, stats);
    saveProgress(progress);
    saveWallet(wallet);
    const lines = [
      ...got.missions.map((m) => `ミッション達成：${esc(m)} +${MISSION_REWARD}`),
      ...(got.bonus ? [`今日のミッションをすべて達成！ +${MISSION_BONUS}`] : []),
      ...got.titles.map((t) => `称号「${esc(t.name)}」を手に入れた！ +${t.coins}`),
    ];
    if (lines.length) reward += `<div class="reward-sub">${lines.map((l) => `<div>${rewardMark()}${l}</div>`).join('')}</div>`;
  }
  if (online) reward += predictLines(results, setup);
  // 所持コインは、勝利・ミッション・称号をすべて足したあとの数を出す
  reward = reward.replace('__COINS__', wallet.coins.toLocaleString());
  renderer.celebrate(win ? win.slot : null);
  music.play('menu');
  showScreen(
    `<h2 style="text-align:center">${resultTitle(results, setup, winner)}</h2>
     ${reward}
     ${online && lobby?.tourOn ? '<div data-tour></div>' : ''}
     <div class="results">${rows}</div>
     ${online && net.slot >= 0 ? stampBar() : ''}
     ${online ? '<div class="again-count muted" data-again></div>' : ''}
     <div class="footer">
       <button class="btn" id="menu">メニューへ</button>
       <div class="row" style="gap:8px">
         ${online ? '<button class="btn" id="lobby">ルームへ戻る</button>' : ''}
         ${online && lobby && lobby.hostSlot === net.slot ? '<button class="btn primary" id="rematch">同じメンバーで再戦</button>' : ''}
         ${online && net.slot >= 0 ? '<button class="btn primary" id="want-again">もう1戦したい！</button>' : ''}
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
      // もう1戦したい：押すとホストに伝わり、全員が押すと自動で始まる（もう一度押すと取り消し）
      root.querySelector('#want-again')?.addEventListener('click', () => {
        const on = !(lobby?.again ?? []).includes(net.slot);
        net.again(on);
        sfx.click();
      });
      updateAgainInfo();
      updateTourInfo();
      bindStampBar(root);
      root.querySelector('#again')?.addEventListener('click', () => {
        if (lastSetup) {
          const seed = (Math.random() * 1e9) | 0;
          // ステージ「おまかせ」なら、もう一度のたびに選び直す
          lastSetup = { ...lastSetup, seed, stageId: settings.stageId === RANDOM_STAGE && !lastSetup.rules.horde ? resolveStage(RANDOM_STAGE, seed) : lastSetup.stageId };
          // 相手のキャラが「ランダム」なら、もう一度のたびにえらび直す
          if (cpuSpec && !lastSetup.rules.horde && cpuSpec.length === lastSetup.players.length) {
            const spec = cpuSpec;
            const players = lastSetup.players.map((p, i) => ({ ...p, charId: spec[i] }));
            rollCpuChars(players);
            lastSetup = { ...lastSetup, players };
          }
          const setup = lastSetup;
          if (settings.stageId === RANDOM_STAGE && !setup.rules.horde) stageRoulette(setup.stageId, () => startSession(new LocalSession(setup)));
          else startSession(new LocalSession(setup));
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
       <button class="btn" id="moves">技の一覧</button>
       <button class="btn" id="quit">${online ? 'ルームから抜ける' : '対戦をやめる'}</button>
     </div>
     <div class="setup-grid pause-opts">
       <div class="opt">効果音 ${seg('vol', [[0, 'なし'], [0.4, '小'], [0.7, '中'], [1, '大']], settings.volume)}</div>
       <div class="opt">BGM ${seg('bgm', [[0, 'なし'], [0.3, '小'], [0.5, '中'], [0.8, '大']], settings.bgmVolume)}</div>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#resume')!.addEventListener('click', () => {
        if (session) session.paused = false;
        clearScreen();
      });
      // 自分のキャラの技の一覧
      root.querySelector('#moves')!.addEventListener('click', () => {
        const me = session?.setup.players.find((p) => p.slot === session?.mySlot);
        openMoveList(me?.charId ?? settings.charId);
      });
      bindSeg(root, 'vol', (v) => {
        settings.volume = Number(v);
        sfx.volume = settings.volume;
        sfx.beep();
        saveSettings(settings);
      });
      bindSeg(root, 'bgm', (v) => {
        settings.bgmVolume = Number(v);
        music.volume = settings.bgmVolume;
        saveSettings(settings);
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
       <p><b>ガード：</b>押している間ガード。ガード中にスティックをはじくと回避。空中で押すと空中回避。</p>
       <p><b>つかみ：</b>ガード中にAで目の前の相手をつかみます（ガードを崩せます）。つかんでいる間はAでつかみ攻撃、スティックを倒した方向（前・後ろ・上・下）へ投げます。つかまれたらボタン連打で早く抜けられます。</p>
       <p><b>アピール：</b>ガード中にスティックを上にはじくと、キャラごとの一言（SSR衣装なら特別なセリフ）。</p>
       <p><b>ギリギリで耐える：</b>そこまで強くない攻撃なら、場外の線の手前でギリギリ踏んばって止まることがあります。止まったあとは自分で台へ戻りましょう。強い攻撃や、%がとても高いときはそのまま飛ばされます。</p>
       <p><b>ハメ防止：</b>攻撃を受け続けて、ほとんど動けない状態（少しだけ動けてもすぐまた当てられる状態を含む）が約1.5秒続くと、すぐに動けるようになり、少しの間（約0.75秒）無敵になって抜け出せます。また、突撃する技・引き寄せる技・入れ替える技・連射しやすい技には、使ったあと少しの待ち時間があります（キャラ選択で技を長押しすると確認できます）。</p>
       <p><b>エリアバトル：</b>エリアに自分（チーム）だけが立っている間ゲージが溜まり、先に満タンにするか、時間切れでゲージの多い人の勝ち。敵が1人でもエリアにいると止まります。味方が多いほど少し速く溜まります。ふっとばされても復活します。</p>
       <p><b>王冠うばい：</b>はじめは王冠はだれも持っていません。最初に相手を撃墜した人が王冠を手に入れ、持っている間だけ時間がたまります。持っている人に攻撃を当て続け、王冠を手に入れてから受けたダメージの合計が20%をこえると、最後に当てた人が王冠を奪えます（王冠の上に残りの耐久が出ます。奪われた直後は少しの間取り返せません）。持っている人を撃墜した人も王冠を手に入れます。持っている人が自分で落ちたときは、少しあとにステージの中央に王冠が出てくるので、触れた人が拾えます。決めた時間（20・30・45秒）だけ持つか、時間切れで一番長く持っていた人の勝ち。何人でも遊べます。チーム戦でも王冠は1つだけなので、持っていない仲間は持っている仲間を守りましょう。</p>
       <p><b>金庫まもり：</b>赤と青の2チームに分かれ、ステージの端にある自分のチームの金庫を守りながら、相手の金庫を攻撃で壊します（飛び道具も当たります）。先に相手の金庫を壊すか、時間切れのときに多く壊していたチームの勝ち。金庫の耐久は人数が多いほど増えます。ふっとばされても復活します。</p>
       <p><b>賞金首：</b>相手を撃墜すると1点、自分で落ちると1点減ります。点が一番多い人（2点以上）は頭の上に賞金袋が出る「賞金首」になり、倒すと3点もらえます。時間切れのときに点が一番多い人の勝ち。何人でも遊べ、チーム戦にもできます。</p>
       <p><b>コイン集め：</b>ステージにコインが降ってくるので、触れて拾います（大きいコインは5枚分）。攻撃を受けるとダメージに合わせてコインを落とし（1回に最大5枚）、撃墜されると持っているコインの半分がステージの中央にばらまかれます。時間切れのときに一番多く持っている人の勝ち。何人でも遊べ、チーム戦にもできます。</p>
       <p><b>玉入れ：</b>赤と青の2チームに分かれ（タップで選べます）、ボールを攻撃でふっとばして、相手チームのかご（赤は右、青は左）に上から入れると1点。先取点（3・5・7点）か、時間切れで点の多いチームの勝ち。ルールで「相手への攻撃：当たらない」にすると、攻撃はボールにだけ当たります。弱攻撃はかごまで4〜6mくらい、横攻撃は8〜12mくらいから入りやすいです。<b>ねらい方：</b>スティックを斜め上に入れながら攻撃すると山なりに高く（かごに入れやすい）、斜め下に入れながら攻撃すると低く速く飛びます。</p>
       <p><b>体力制：</b>%のかわりにHPで戦います。HPが0になるとその場で撃墜。ふっとびは小さめなので、HPを削り切るのが基本です。</p>
       <p><b>チーム戦：</b>CPU戦はルール画面、オンラインはルームの枠をタップしてチームを分けます。「味方への攻撃：当たらない」なら、味方には攻撃も飛び道具も当たりません。</p>
       <p><b>100人組手：</b>1機だけで、次々に出てくる敵を100人倒すとクリア。10人倒すごとに少し回復し、30人倒すと敵が3人に増えます。</p>
       <p><b>アイテム・ステージギミック：</b>ルールで「あり」にすると、アイテムが落ちてきて、触れると使えます。落ちているアイテムの上に効果が書いてあり、効果中は自分の枠の上にしるしが出ます。${ITEM_NAMES.map((n, i) => `<br/>・${n}：${ITEM_INFO[i].effect.replace('！', '')}`).join('')}<br/>ギミックはキャラ別ステージごとに違う仕掛け（強風・レーザー・スクーターなど）で、来る前に予告が出ます。</p>
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
    `<h2 style="pointer-events:auto">設定</h2>
     <div class="setup-grid">
       <div class="opt">ボタン（配置・大きさ・濃さ） <button type="button" class="btn small" id="layout">${settings.leftHanded ? '左利き・' : ''}${Object.keys(settings.btnPos).length ? '自分で配置' : '標準の配置'}・大きさ${{ S: '小', M: '中', L: '大' }[settings.btnSize]}（変える）</button></div>
       <div class="opt">画質 ${seg('q', [['low', '軽さ優先'], ['high', 'きれい']], settings.quality)}</div>
       <div class="opt">画質の自動調整（重いとき軽さ優先に） ${seg('aq', [['on', 'する'], ['off', 'しない']], settings.autoQuality ? 'on' : 'off')}</div>
       <div class="opt">スティック上でジャンプ ${seg('tj', [['on', 'する'], ['off', 'しない']], settings.tapJump ? 'on' : 'off')}</div>
       <div class="opt">振動（Androidのみ） ${seg('vib', [['on', 'する'], ['off', 'しない']], settings.vibration ? 'on' : 'off')}</div>
       <div class="opt">フレームレート表示（対戦中） ${seg('fps', [['on', 'する'], ['off', 'しない']], settings.showFps ? 'on' : 'off')}</div>
       <div class="opt">オンライン状態（フレンドに） ${seg('hide', [['off', '見せる'], ['on', '隠す']], settings.hideOnline ? 'on' : 'off')}</div>
       <div class="opt">効果音 ${seg('vol', [[0, 'なし'], [0.4, '小'], [0.7, '中'], [1, '大']], settings.volume)}</div>
       <div class="opt">BGM ${seg('bgm', [[0, 'なし'], [0.3, '小'], [0.5, '中'], [0.8, '大']], settings.bgmVolume)}</div>
       <div class="opt" style="grid-column:1/-1">データ引き継ぎ（機種変更など） <span class="row" style="gap:8px">
         <button type="button" class="btn small" id="xfer-out">引き継ぎコードを発行</button>
         <button type="button" class="btn small" id="xfer-in">コードを入力して引き継ぐ</button></span></div>
       <label class="field" style="grid-column:1/-1">対戦サーバーのURL（wss://〜）<input type="url" id="server" value="${esc(settings.serverUrl)}" placeholder="wss://buttobi-server.あなたのアカウント.workers.dev"/></label>
     </div>
     <div class="footer"><button class="btn primary" id="back">保存してもどる</button></div>`,
    'overlay',
    (root) => {
      // 隠し操作：見出し「設定」を7回たたくと、テスト表示（まだ公開していないキャラなど）を切り替える
      let taps = 0;
      let tapAt = 0;
      root.querySelector('h2')?.addEventListener('click', () => {
        const now = Date.now();
        taps = now - tapAt < 1500 ? taps + 1 : 1;
        tapAt = now;
        if (taps < 7) return;
        try {
          if (PREVIEW) localStorage.removeItem(PREVIEW_KEY);
          else localStorage.setItem(PREVIEW_KEY, '1');
        } catch {
          /* 保存できなければ切り替えない */
        }
        toast(PREVIEW ? 'テスト表示をオフにします' : 'テスト表示をオンにします', 1500);
        setTimeout(() => location.replace(location.pathname), 900);
      });
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
      bindSeg(root, 'hide', (v) => {
        settings.hideOnline = v === 'on';
        social.setHidden(settings.hideOnline);
      });
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
        startSocial();
        showMenu();
      });
      root.querySelector('#xfer-out')!.addEventListener('click', () => {
        settings.serverUrl = (root.querySelector('#server') as HTMLInputElement).value.trim();
        saveSettings(settings);
        showTransferOut(root);
      });
      root.querySelector('#xfer-in')!.addEventListener('click', () => {
        settings.serverUrl = (root.querySelector('#server') as HTMLInputElement).value.trim();
        saveSettings(settings);
        showTransferIn(root);
      });
    },
  );
}

/** 画面の上に小さな窓を出す（閉じる関数を返す） */
function popup(root: HTMLElement, html: string): { el: HTMLElement; close: () => void } {
  const el = document.createElement('div');
  el.className = 'lb-pop';
  el.innerHTML = `<div class="lb-card xfer-card">${html}</div>`;
  root.appendChild(el);
  return { el, close: () => el.remove() };
}

/** 引き継ぎコードを発行する */
function showTransferOut(root: HTMLElement): void {
  if (!settings.serverUrl) return void toast('対戦サーバーのURLが設定されていないため、引き継ぎができません');
  const p = popup(
    root,
    `<div class="lb-title">引き継ぎコードを発行</div>
     <div class="xfer-note">今のデータ（コイン・衣装・戦績・称号・ミッション・設定・フレンド）をサーバーに預けて、引き継ぎコードを作ります。<br/>
     新しい端末の「設定 → コードを入力して引き継ぐ」で入力してください。</div>
     <ul class="xfer-list"><li>コードは<b>1回だけ</b>使えます（使うとサーバーから消えます）</li><li>使わなければ<b>30日</b>で消えます</li><li>この端末のデータはそのまま残ります</li></ul>
     <div class="row" style="justify-content:center;gap:10px"><button class="btn" id="x-cancel">やめる</button><button class="btn primary" id="x-go">発行する</button></div>`,
  );
  p.el.querySelector('#x-cancel')!.addEventListener('click', p.close);
  p.el.querySelector('#x-go')!.addEventListener('click', async () => {
    const card = p.el.querySelector('.lb-card')!;
    card.innerHTML = '<div class="lb-title">発行しています…</div>';
    try {
      const r = await issueTransfer(settings.serverUrl);
      const d = new Date(r.expires);
      card.innerHTML = `<div class="lb-title">引き継ぎコード</div>
        <div class="xfer-code" id="x-code">${r.code}</div>
        <div class="xfer-note">新しい端末で入力してください。期限：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日まで・1回だけ使えます。<br/>
        <b>このコードは他の人に教えないでください</b>（入力した人にデータが渡ります）。</div>
        <div class="row" style="justify-content:center;gap:10px"><button class="btn" id="x-copy">コピー</button><button class="btn primary" id="x-ok">閉じる</button></div>`;
      card.querySelector('#x-ok')!.addEventListener('click', p.close);
      card.querySelector('#x-copy')!.addEventListener('click', () => {
        navigator.clipboard?.writeText(r.code).then(
          () => toast('コピーしました'),
          () => toast('コピーできませんでした。メモしてください'),
        );
      });
    } catch (e) {
      card.innerHTML = `<div class="lb-title">発行できませんでした</div><div class="xfer-note">${esc((e as Error).message)}<br/>通信できる場所でもう一度お試しください。</div>
        <div class="row" style="justify-content:center"><button class="btn primary" id="x-ok">閉じる</button></div>`;
      card.querySelector('#x-ok')!.addEventListener('click', p.close);
    }
  });
}

/** 引き継ぎコードを入力して、この端末にデータを移す */
function showTransferIn(root: HTMLElement): void {
  if (!settings.serverUrl) return void toast('対戦サーバーのURLが設定されていないため、引き継ぎができません');
  const p = popup(
    root,
    `<div class="lb-title">コードを入力して引き継ぐ</div>
     <input class="xfer-input" id="x-code" maxlength="20" placeholder="ABCD-EFGH-JKMN" autocomplete="off" autocapitalize="characters" spellcheck="false"/>
     <div class="xfer-note warn">この端末の今のデータ（コイン・衣装・戦績など）は、<b>引き継いだデータで上書きされます</b>。元に戻せません。</div>
     <div class="row" style="justify-content:center;gap:10px"><button class="btn" id="x-cancel">やめる</button><button class="btn primary" id="x-go">引き継ぐ</button></div>`,
  );
  const input = p.el.querySelector<HTMLInputElement>('#x-code')!;
  input.focus();
  p.el.querySelector('#x-cancel')!.addEventListener('click', p.close);
  p.el.querySelector('#x-go')!.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return toast('コードを入力してください');
    const card = p.el.querySelector('.lb-card')!;
    card.innerHTML = '<div class="lb-title">受け取っています…</div>';
    try {
      const data = await takeTransfer(settings.serverUrl, code);
      applyData(data, settings.serverUrl);
      card.innerHTML = '<div class="lb-title">引き継ぎました！</div><div class="xfer-note">読み込み直します…</div>';
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      card.innerHTML = `<div class="lb-title">引き継げませんでした</div><div class="xfer-note">${esc((e as Error).message)}</div>
        <div class="row" style="justify-content:center"><button class="btn primary" id="x-ok">閉じる</button></div>`;
      card.querySelector('#x-ok')!.addEventListener('click', p.close);
    }
  });
}

// ---------------------------------------------------------------------------
// 戦績・ミッション・称号
/** 称号のカード（まだ手に入れていない称号は名前を隠す） */
function titleCard(t: (typeof TITLES)[number]): string {
  const have = progress.titles.includes(t.id);
  return `<div class="title-card ${have ? 'have' : ''}"><b>${have ? esc(t.name) : '？？？'}</b><div>${esc(t.cond)}</div><div class="muted"><span class="coin-icon"></span>${t.coins}</div></div>`;
}

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
      ${TITLE_GROUPS.map((g) => {
        // 種類ごとにまとめる（どの種類にも当てはまらない称号は、最後の種類の後ろに出す）
        // 同じ種類の中は、条件の種類（勝利・撃墜など）ごとに、やさしい順（もらえるコインが少ない順）に並べる
        const kind = (id: string) => id.replace(/\d+$|All$/, '');
        const all = TITLES.filter((t) => g.match(t.id));
        const kinds = [...new Set(all.map((t) => kind(t.id)))];
        const list = g.name === 'ルール別' || g.name === 'キャラマスター' ? all : [...all].sort((a, b) => kinds.indexOf(kind(a.id)) - kinds.indexOf(kind(b.id)) || a.coins - b.coins);
        if (!list.length) return '';
        const got = list.filter((t) => progress.titles.includes(t.id)).length;
        return `<div class="title-group"><span>${g.name}</span><small>${got} / ${list.length}</small></div>
      <div class="titles">${list.map(titleCard).join('')}</div>`;
      }).join('')}
      ${(() => {
        const rest = TITLES.filter((t) => !TITLE_GROUPS.some((g) => g.match(t.id)));
        return rest.length ? `<div class="title-group"><span>そのほか</span></div><div class="titles">${rest.map(titleCard).join('')}</div>` : '';
      })()}`;
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
// ---------------------------------------------------------------------------
// スタンプ＆背景ガチャ（衣装ガチャとは別。天井も別）
function gachaTabs(on: 'cos' | 'item'): string {
  return `<div class="seg gacha-tabs" data-seg="gtab"><button type="button" data-v="cos" class="${on === 'cos' ? 'on' : ''}">着せ替えガチャ</button><button type="button" data-v="item" class="${on === 'item' ? 'on' : ''}">スタンプ＆背景ガチャ</button></div>`;
}
function bindGachaTabs(root: HTMLElement): void {
  bindSeg(root, 'gtab', (v) => (v === 'item' ? showItemGacha() : showGacha()));
}

/** 着せ替えガチャの見本：SSR と UR の衣装を着たキャラを1体ずつ、3Dで動かして見せる（SSR → UR → SSR … と交互、衣装はランダム） */
function startCostumeShowcase(root: HTMLElement): void {
  const slot = root.querySelector<HTMLElement>('.gs-slot');
  const stage = slot?.querySelector<HTMLElement>('.gs-stage');
  const label = slot?.querySelector<HTMLElement>('.gs-label');
  if (!slot || !stage || !label) return;
  let rarity = Math.random() < 0.5 ? 5 : 6;
  let lastId = '';
  const show = () => {
    let list = GACHA_COSTUMES.filter((c) => c.rarity === rarity && c.id !== lastId);
    if (!list.length) list = GACHA_COSTUMES.filter((c) => c.rarity >= 5);
    if (!list.length) return;
    const c = list[Math.floor(Math.random() * list.length)];
    lastId = c.id;
    slot.dataset.r = String(c.rarity);
    label.innerHTML = `<b class="rr${c.rarity}">${rarityName(c.rarity)}</b><span>${esc(c.name)}</span><small>${esc(getCharacter(c.charId).name)}</small>`;
    slot.classList.remove('in');
    void slot.offsetWidth;
    slot.classList.add('in');
    // 名刺カードと同じ 3D の入れ物を使い回して、キャラを動かす（タップでアクション）
    cardViewer.mount(stage, c.charId, c.id);
    cardViewer.action();
    rarity = rarity === 5 ? 6 : 5;
  };
  show();
  const timer = window.setInterval(() => {
    // 画面を離れたら止める
    if (!root.isConnected) return clearInterval(timer);
    show();
  }, 4500);
}

/** 背景の小さな見本 */
function bgSwatch(bg: number): string {
  const a = cardBgAttrs(bg);
  return `<span class="bg-swatch ${a.cls}" style="${a.style}"></span>`;
}

/** 引いたものの名前と種類 */
function itemLabel(r: { kind: 's' | 'b'; id: number }): { name: string; kind: string } {
  return r.kind === 's' ? { name: `「${PIC_STAMPS[r.id]?.text ?? ''}」`, kind: 'スタンプ' } : { name: CARD_BGS[r.id - 1]?.name ?? '', kind: 'カード背景' };
}

function showItemGacha(): void {
  const c = itemCounts(wallet);
  const left = PITY_LIMIT - (wallet.ipity ?? 0);
  const urLeft = UR_PITY_LIMIT - (wallet.iurPity ?? 0);
  // 見本：スタンプ（いろいろなレア度）と背景が、2段で横に流れていく
  const st = PIC_STAMPS.map((_, i) => picStamp(i, [4, 5, 6][(i * 7) % 3])).join('');
  const bgs = CARD_BGS.map((_, i) => bgSwatch(i + 1)).join('');
  const sample = `<div class="ig-marquee"><div class="ig-track st">${st}${st}</div><div class="ig-track bg">${bgs}${bgs}</div></div>`;
  showScreen(
    `<div class="row" style="justify-content:space-between">${gachaTabs('item')}${coinBadge()}</div>
     <div class="gacha-hero item">
       ${sample}
       <div class="gacha-info">
         <div>絵スタンプ${PIC_STAMPS.length}種と、名刺カードの背景${CARD_BGS.length}種が出ます。</div>
         <div>スタンプは同じ言葉でも <b class="rr5">SSR</b>（金の縁）→ <b class="rr6">UR</b>（虹色に光って動く）にアップグレード！</div>
         <div>出る確率：<b class="rr6">UR ${Math.round(UR_RATE * 100)}%</b>／<b class="rr5">SSR ${Math.round(SSR_RATE * 100)}%</b>／<b class="rr4">SR ${Math.round((1 - SSR_RATE - UR_RATE) * 100)}%</b>（スタンプと背景は半々）</div>
         <div>天井：<b class="rr6">UR</b> 確定まで あと <b>${urLeft}</b> 回・<b class="rr5">SSR</b> 確定まで あと <b>${left}</b> 回（着せ替えガチャとは別に数えます）</div>
         <div class="muted">持っているもの（スタンプは同じか下のレア度）が出たら、コインに変わります（SR ${ITEM_DUP_REFUND[4]}・SSR ${ITEM_DUP_REFUND[5]}・UR ${ITEM_DUP_REFUND[6]}）。</div>
         <div class="muted">集めたもの：スタンプ ${c.stamps} / ${PIC_STAMPS.length}・背景 ${c.bgs} / ${CARD_BGS.length}（「了解！」「ありがとう！」「ごめん！」「GG！」は最初から持っています）</div>
       </div>
     </div>
     <div class="footer">
       <button class="btn" id="back">もどる</button>
       <div class="row" style="gap:8px">
         ${IS_TEST ? '<button class="btn small" id="t-all">テスト：全部持つ</button><button class="btn small" id="t-none">テスト：スタンプと背景を空に</button>' : ''}
         <button class="btn" id="ilist">一覧</button>
         <button class="btn primary" id="ione" ${wallet.coins < ITEM_COST.one ? 'disabled' : ''}>1回 <small>${ITEM_COST.one}</small></button>
         <button class="btn primary" id="iten" ${wallet.coins < ITEM_COST.ten ? 'disabled' : ''}>10回 <small>${ITEM_COST.ten}</small></button>
       </div>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#back')!.addEventListener('click', () => showMenu());
      bindGachaTabs(root);
      root.querySelector('#ilist')!.addEventListener('click', () => showItemList('s'));
      // テスト版だけ：持ち物を切り替えて、NEW・アップグレードの演出を確かめられるようにする
      root.querySelector('#t-all')?.addEventListener('click', () => {
        testGrantAll(wallet);
        saveWallet(wallet);
        toast('テスト：全部持っている状態にしました');
        showItemGacha();
      });
      root.querySelector('#t-none')?.addEventListener('click', () => {
        wallet.stamps = {};
        wallet.bgs = [];
        saveWallet(wallet);
        toast('テスト：スタンプ（最初の4つ以外）と背景を空にしました');
        showItemGacha();
      });
      root.querySelector('#ione')!.addEventListener('click', () => pullItemsAndOpen(1));
      root.querySelector('#iten')!.addEventListener('click', () => pullItemsAndOpen(10));
    },
  );
}

function pullItemsAndOpen(n: 1 | 10): void {
  const res = pullItems(wallet, n);
  if (!res) return void toast('コインが足りません');
  saveWallet(wallet);
  playGachaOpening(
    res,
    (i) => {
      const r = res[i];
      const l = itemLabel(r);
      return `<b>${rarityName(r.rarity)}</b><div class="gx-item">${r.kind === 's' ? picStamp(r.id, r.rarity) : bgSwatch(r.id)}</div><div class="n">${esc(l.name)}</div><div class="c">${l.kind}</div>${r.dup ? '' : r.up ? '<i class="new up">UP</i>' : '<i class="new">NEW</i>'}${r.rarity === 6 ? URSP : ''}`;
    },
    () => showItemResult(res),
  );
}

function showItemResult(res: ItemPull[]): void {
  const again: 1 | 10 = res.length > 1 ? 10 : 1;
  const againCost = again === 10 ? ITEM_COST.ten : ITEM_COST.one;
  const cards = res
    .map((r) => {
      const l = itemLabel(r);
      const tag = r.dup ? `<div class="gd">+${r.refund}コイン</div>` : r.up ? `<div class="gnew up">${tierName(r.rarity)}にアップ！</div>` : '<div class="gnew">NEW</div>';
      return `<div class="gcard ic r${r.rarity}"><b>${rarityName(r.rarity)}</b><div class="ic-art">${r.kind === 's' ? picStamp(r.id, r.rarity) : bgSwatch(r.id)}</div><div class="gn">${esc(l.name)}</div><div class="gc">${l.kind}</div>${tag}${r.rarity === 6 ? URSP : ''}</div>`;
    })
    .join('');
  showScreen(
    `<div class="row" style="justify-content:space-between"><h2>ガチャの結果</h2>${coinBadge()}</div>
     <div class="gcards ic-cards ${res.length > 1 ? 'ten' : ''}">${cards}</div>
     <p class="muted small-note">スタンプは DM・オンラインの待機画面と結果画面で、背景はプロフィールの編集で使えます。</p>
     <div class="footer">
       <button class="btn" id="back">もどる</button>
       <button class="btn primary" id="again" ${wallet.coins < againCost ? 'disabled' : ''}>もう一度${again === 10 ? '10回' : '1回'} <small>${againCost}</small></button>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#back')!.addEventListener('click', showItemGacha);
      root.querySelector('#again')!.addEventListener('click', () => pullItemsAndOpen(again));
    },
  );
}

/** 一覧：スタンプ（持っているレア度で表示）と背景（持っていないものは ？） */
function showItemList(tab: 's' | 'b'): void {
  const c = itemCounts(wallet);
  const body =
    tab === 's'
      ? `<div class="il-tiers"><div class="il-th"></div><div class="il-th"><b class="rr4">SR</b><small>ふつう</small></div><div class="il-th"><b class="rr5">SSR</b><small>金の縁・きらめき</small></div><div class="il-th"><b class="rr6">UR</b><small>虹色に光って動く</small></div>${PIC_STAMPS.map((s, i) => {
          const t = stampTier(wallet, i);
          const cell = (r: number) => `<div class="il-cell ${t >= r ? 'have' : 'no'} ${t === r ? 'cur' : ''}">${picStamp(i, r)}<small>${t === r ? '使っている' : t > r ? '' : 'まだ'}</small></div>`;
          return `<div class="il-name">${esc(s.text)}${FREE_STAMPS.includes(i) ? '<small>最初から</small>' : ''}</div>${cell(4)}${cell(5)}${cell(6)}`;
        }).join('')}</div>`
      : CARD_BG_GROUPS.map(
          (g) =>
            `<div class="pe-bg-group">${g.name}</div><div class="pe-chips">${CARD_BGS.map((d, i) =>
              d.group !== g.id ? '' : ownsBg(wallet, i + 1) ? `<span class="pe-bg ${cardBgAttrs(i + 1).cls}" style="${cardBgAttrs(i + 1).style}"><span>${esc(d.name)}</span></span>` : `<span class="pe-bg locked"><span>？？？</span></span>`,
            ).join('')}</div>`,
        ).join('');
  showScreen(
    `<div class="row" style="justify-content:space-between"><h2>スタンプ・背景の一覧</h2>${coinBadge()}</div>
     <div class="seg" data-seg="itab"><button type="button" data-v="s" class="${tab === 's' ? 'on' : ''}">スタンプ ${c.stamps}/${PIC_STAMPS.length}</button><button type="button" data-v="b" class="${tab === 'b' ? 'on' : ''}">背景 ${c.bgs}/${CARD_BGS.length}</button></div>
     <div class="il-body">${body}</div>
     <div class="footer"><button class="btn" id="back">もどる</button></div>`,
    'overlay',
    (root) => {
      bindSeg(root, 'itab', (v) => showItemList(v === 'b' ? 'b' : 's'));
      root.querySelector('#back')!.addEventListener('click', showItemGacha);
    },
  );
}

function showGacha(): void {
  // 赤い点：ガチャ画面を開いたので消す
  markGachaSeen(progress, wallet);
  saveProgress(progress);
  const left = PITY_LIMIT - wallet.pity;
  const ur = urAvailable();
  const urLeft = UR_PITY_LIMIT - wallet.urPity;
  showScreen(
    `<div class="row" style="justify-content:space-between">${gachaTabs('cos')}${coinBadge()}</div>
     <div class="gacha-hero cos">
       <div class="gs-show"><div class="gs-slot" data-r="5"><div class="gs-stage"></div><div class="gs-label"></div></div></div>
       <div class="gacha-info">
         <div>全${COSTUMES.filter((c) => c.rarity >= 4).length}着。SSR・UR はエフェクト付き！</div>
         <div>出る確率：${ur ? `<b class="rr6">UR ${Math.round(UR_RATE * 100)}%</b>／` : ''}<b class="rr5">SSR ${Math.round(SSR_RATE * 100)}%</b>／<b class="rr4">SR ${Math.round((1 - SSR_RATE - (ur ? UR_RATE : 0)) * 100)}%</b></div>
         <div>天井：${ur ? `<b class="rr6">UR</b> 確定まで あと <b>${urLeft}</b> 回・` : ''}<b class="rr5">SSR</b> 確定まで あと <b>${left}</b> 回</div>
         <div class="muted">持っている衣装が出たら、コインに変わります（SR ${DUP_REFUND[4]}・SSR ${DUP_REFUND[5]}${ur ? `・UR ${DUP_REFUND[6]}` : ''}）。</div>
         <div class="muted">集めた衣装：${wallet.owned.length} / ${COSTUMES.filter((c) => c.rarity >= 4).length}</div>
       </div>
     </div>
     <div class="footer">
       <button class="btn" id="back">もどる</button>
       <div class="row" style="gap:8px">
         <button class="btn" id="lineup">排出衣装</button>
         <button class="btn" id="list">衣装一覧</button>
         <button class="btn primary" id="one" ${wallet.coins < GACHA_COST.one ? 'disabled' : ''}>1回 <small>${GACHA_COST.one}</small></button>
         <button class="btn primary" id="ten" ${wallet.coins < GACHA_COST.ten ? 'disabled' : ''}>10回 <small>${GACHA_COST.ten}</small></button>
       </div>
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#back')!.addEventListener('click', () => showMenu());
      bindGachaTabs(root);
      startCostumeShowcase(root);
      root.querySelector('#list')!.addEventListener('click', () => showCollection(settings.charId));
      root.querySelector('#lineup')!.addEventListener('click', showLineup);
      root.querySelector('#one')!.addEventListener('click', () => pullAndOpen(1));
      root.querySelector('#ten')!.addEventListener('click', () => pullAndOpen(10));
    },
  );
}

/** カプセルが揺れて開く演出（SSR があれば虹色に光る） */
/**
 * ガチャを引く演出：カプセルが落ちて弾む → だんだん激しく揺れる（SSR は途中で金色に光る）→
 * 開く瞬間に光って星と紙吹雪が飛び散る → 出た衣装のカード（10連は1枚ずつめくれる）→ 結果画面。
 * どこでもタップすると結果まで飛ばせる。
 */
function playGachaOpening(res: { rarity: number }[], cardFront: (i: number) => string, done: () => void): void {
  const best = Math.max(...res.map((r) => r.rarity));
  const ssr = best >= 5;
  const ur = best >= 6;
  const ten = res.length > 1;
  const el = showScreen(
    `<div class="gx r${best}">
       <div class="gx-rays"></div>
       <div class="gx-cap"><div class="capsule big"><div class="cap-top"></div><div class="cap-bottom"></div></div></div>
       <div class="gx-text">${ten ? '10連ガチャ！' : 'ガチャ！'}</div>
       <div class="gx-cards"></div>
       <div class="gx-flash"></div>
       <div class="go-skip">タップで先へ進む</div>
     </div>`,
    'overlay gacha-stage',
  );
  const stage = el.querySelector<HTMLElement>('.gx')!;
  const cap = el.querySelector<HTMLElement>('.capsule')!;
  const box = el.querySelector<HTMLElement>('.gx-cards')!;
  let timers: number[] = [];
  const at = (ms: number, f: () => void) => timers.push(window.setTimeout(f, ms));
  const cancel = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  // 今どこまで進んだか（タップすると、とばさずに次の段階へ進む）
  let phase: 'shake' | 'open' | 'flip' | 'shown' | 'done' = 'shake';
  let flipped = 0;
  const finish = () => {
    if (phase === 'done') return;
    phase = 'done';
    cancel();
    done();
  };
  const flipOne = () => {
    const i = flipped++;
    box.children[i]?.classList.add('flip');
    sfx.gachaFlip(res[i].rarity);
    if (flipped >= res.length) {
      phase = 'shown';
      at((ssr ? 600 : 300) + 400, () => sfx.gacha(ssr ? 5 : best >= 4 ? 4 : 3));
      // めくり終わって（0.75秒）から、出た衣装をしばらく見せて結果へ（SSR は長めに）
      at(750 + (ten ? 1800 : 1700) + (ur ? 1500 : ssr ? 900 : 0), finish);
    }
  };
  /** カードを並べて、gap ごとに1枚ずつめくる */
  const flipRest = (gap: number, first: number) => {
    phase = 'flip';
    for (let k = flipped; k < res.length; k++) at(first + (k - flipped) * gap, flipOne);
  };
  const reveal = () => {
    stage.classList.add('reveal');
    box.innerHTML = res.map((r, i) => `<div class="gx-card r${r.rarity}"><div class="in"><div class="back"></div><div class="front">${cardFront(i)}</div></div></div>`).join('');
    // まず裏のまま並べて見せてから、1枚ずつゆっくりめくる
    flipRest(ten ? 260 : 0, ten ? 600 : 700);
  };
  const open = () => {
    phase = 'open';
    if (best >= 4) stage.classList.add('tint');
    if (ssr) stage.classList.add('gold');
    if (ur) stage.classList.add('rainbow');
    cap.classList.add('open');
    stage.classList.add('opened');
    sfx.gachaOpen(best);
    burstParticles(stage, ur ? 80 : ssr ? 46 : best >= 4 ? 30 : 18, ssr);
    at(450, reveal);
  };
  // 1. 落ちてきて弾む
  stage.classList.add('drop');
  at(380, () => sfx.gachaDrop());
  // 2. だんだん激しく揺れる
  const shakeStart = 650;
  const shakeEnd = ur ? 2900 : ssr ? 2100 : 1500;
  for (let t = shakeStart, k = 0; t < shakeEnd; t += 160 - Math.min(90, k * 8), k++) {
    const power = (t - shakeStart) / (shakeEnd - shakeStart);
    at(t, () => {
      cap.style.setProperty('--shake', `${8 + power * 18}deg`);
      cap.classList.remove('wobble');
      void cap.offsetWidth;
      cap.classList.add('wobble');
      sfx.gachaShake(power);
    });
  }
  // SR 以上はカプセルの色が変わり、SSR は途中で金色に光る（確定演出）
  if (best >= 4) at(shakeStart + 350, () => stage.classList.add('tint'));
  if (ssr) {
    at(shakeStart + 800, () => {
      stage.classList.add('gold');
      sfx.gachaGold();
    });
  }
  // UR は金色のあと、さらに虹色に変わる（2段階の確定演出）
  if (ur) {
    at(shakeStart + 1600, () => {
      stage.classList.add('rainbow');
      sfx.gachaGold();
      setTimeout(() => sfx.gachaGold(), 220);
    });
  }
  // 3. 開く → 4. カードを出して、1枚ずつめくる
  at(shakeEnd, open);
  // タップ：揺れている間はすぐ開く、めくっている間は残りを少し速めに順番にめくる、全部出たら結果へ
  el.addEventListener('click', () => {
    if (phase === 'shake') {
      cancel();
      open();
    } else if (phase === 'flip') {
      cancel();
      flipRest(ten ? 70 : 0, 0);
    } else if (phase === 'shown') finish();
  });
}

/** ガチャが開いたときに飛び散る星と紙吹雪 */
function burstParticles(stage: HTMLElement, n: number, gold: boolean): void {
  const colors = gold ? ['#ffd23f', '#fff6c9', '#ff5ea8', '#7dd8ff', '#ffffff'] : ['#ffd23f', '#ffffff', '#7dd8ff', '#ff8a3d'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = i % 3 === 0 ? 'gx-p star' : 'gx-p';
    const ang = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 220;
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist - 40}px`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    p.style.setProperty('--col', colors[i % colors.length]);
    p.style.animationDelay = `${Math.random() * 0.08}s`;
    stage.appendChild(p);
  }
}

/** ガチャの結果：左に衣装を着たキャラ（3D）、右に結果の一覧 */
/** ガチャを引いて、開ける演出へ（コインが足りなければ知らせるだけ） */
function pullAndOpen(n: 1 | 10): void {
  const res = pullGacha(wallet, n);
  if (!res) return void toast('コインが足りません');
  const titles = checkTitles(progress, wallet);
  if (titles.length) {
    saveProgress(progress);
    setTimeout(() => toast(titles.map((t) => `称号「${t.name}」を手に入れた！ +${t.coins}`).join(' / '), 4000), 2500);
  }
  saveWallet(wallet);
  playGachaOpening(
    res,
    (i) => {
      const r = res[i];
      const c = COSTUMES.find((x) => x.id === r.id)!;
      return `<b>${rarityName(r.rarity)}</b><div class="n">${c.name}</div><div class="c">${getCharacter(c.charId).name}</div>${r.dup ? '' : '<i class="new">NEW</i>'}${r.rarity === 6 ? URSP : ''}`;
    },
    () => showGachaResult(res, 0),
  );
}

function showGachaResult(res: PullResult[], index: number): void {
  // 「もう一度」は、同じガチャ（1回／10回）をそのまま引く
  const again: 1 | 10 = res.length > 1 ? 10 : 1;
  const againCost = again === 10 ? GACHA_COST.ten : GACHA_COST.one;
  const r = res[index];
  const c = COSTUMES.find((x) => x.id === r.id)!;
  const ch = getCharacter(c.charId);
  const cards = res
    .map((x, i) => {
      const cc = COSTUMES.find((y) => y.id === x.id)!;
      return `<div class="gcard r${x.rarity} ${i === index ? 'on' : ''}" data-i="${i}"><b>${rarityName(x.rarity)}</b><div class="gn">${cc.name}</div><div class="gc">${getCharacter(cc.charId).name}</div>${x.dup ? `<div class="gd">+${x.refund}コイン</div>` : '<div class="gnew">NEW</div>'}${x.rarity === 6 ? URSP : ''}</div>`;
    })
    .join('');
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate"><div class="cs-role rr${r.rarity}">${rarityName(r.rarity)}${r.dup ? '（持っていたのでコインに）' : ' NEW!'}</div><div class="cs-name">${c.name}</div><div class="cs-role" style="color:#fff">${ch.name}</div></div>
     <div class="row" style="justify-content:space-between"><h2>ガチャの結果</h2>${coinBadge()}</div>
     <div class="gcards ${res.length > 1 ? 'ten' : ''}">${cards}</div>
     <div class="g-detail">${c.rarity >= 6 ? 'UR衣装：虹色のオーラをまとい、攻撃を当てると虹色の衝撃波、撃墜すると虹色の大爆発が起きます。' : c.fx ? 'SSR衣装：まわりにエフェクトが舞い、攻撃を当てると特別なエフェクトが出ます。' : ''}${!r.dup ? 'キャラ選択の「衣装」から着られます。' : ''}</div>
     <div class="footer">
       <button class="btn" id="back">もどる</button>
       <div class="row" style="gap:8px">
         ${!r.dup ? '<button class="btn" id="wear">すぐ着る</button>' : ''}
         <button class="btn primary" id="again" ${wallet.coins < againCost ? 'disabled' : ''}>もう一度${again === 10 ? '10回' : '1回'} <small>${againCost}</small></button>
       </div>
     </div>`,
    'overlay charsel-screen',
    (root) => {
      root.querySelectorAll<HTMLElement>('.gcard').forEach((el) => el.addEventListener('click', () => showGachaResult(res, Number(el.dataset.i))));
      root.querySelector('#back')!.addEventListener('click', showGacha);
      root.querySelector('#again')!.addEventListener('click', () => pullAndOpen(again));
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
  // レア度の低い順（ふつう → SR → SSR → UR）
  const list = COSTUMES.filter((c) => c.charId === charId).sort((a, b) => a.rarity - b.rarity);
  const cur = getCostume(myCostume(charId), charId).id;
  let shown = cur;
  const items = list
    .map((c) => {
      const have = c.rarity < 4 || ownsCostume(c.id, c.charId);
      return `<div class="gcard r${c.rarity} ${have ? '' : 'locked'} ${c.id === cur ? 'on' : ''}" data-id="${c.id}"><b>${rarityName(c.rarity) || 'ふつう'}</b><div class="gn">${have ? c.name : '？？？'}</div>${c.id === cur ? '<div class="gnew">着ている</div>' : ''}${c.rarity === 6 ? URSP : ''}</div>`;
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
          const have = c.rarity < 4 || ownsCostume(c.id, c.charId);
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
    const list = pool.filter((c) => c.charId === ch.id).sort((a, b) => a.rarity - b.rarity);
    return `<div class="lu-char">${ch.name}</div>${list
      .map((c) => {
        const have = wallet.owned.includes(c.id);
        return `<div class="gcard r${c.rarity} ${c === shown ? 'on' : ''}" data-id="${c.id}"><b>${rarityName(c.rarity)}</b><div class="gn">${c.name}</div>${have ? '<div class="have">✓ 持っている</div>' : ''}${c.rarity === 6 ? URSP : ''}</div>`;
      })
      .join('')}`;
  }).join('');
  const have = pool.filter((c) => wallet.owned.includes(c.id)).length;
  const label = (c: typeof shown) => `<div class="cs-role rr${c.rarity}">${rarityName(c.rarity)}${wallet.owned.includes(c.id) ? '（持っている）' : ''}</div><div class="cs-name">${c.name}</div><div class="cs-role" style="color:#fff">${getCharacter(c.charId).name}</div>`;
  showScreen(
    `<div class="cs-drag" data-charsel></div>
     <div class="cs-nameplate">${label(shown)}</div>
     <div class="lu-head">
       <h2>ガチャの排出衣装 <small class="h2-sub">持っている ${have} / ${pool.length}</small></h2>
     </div>
     <div class="lineup">${cards}</div>
     <div class="footer"><button class="btn" id="back">もどる</button></div>`,
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
  /** 説明（キャラによって変わるものは、選手から作る） */
  text: string | ((s: LocalSession) => string);
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
  {
    title: '必殺技の待ち時間',
    text: (s) => {
      const w = tutorialCdMove(s);
      return `突撃する技などは、使ったあと少しの間使えません。${w.label}を出してみよう。Bボタンに暗い扇形と秒数が出ている間は待ち時間です（キーボードのときは自分の枠の下に出ます）`;
    },
    done: (s) => {
      const me = s.sim.fighters.find((f) => f.slot === 0);
      return !!me && me.state !== 'attack' && me[tutorialCdMove(s).key] > 0;
    },
  },
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

/** チュートリアルで試す、待ち時間のある必殺技（横B → 上B → 下B → B の順で、そのキャラが持っているもの） */
function tutorialCdMove(s: LocalSession): { label: string; key: 'cdN' | 'cdS' | 'cdD' | 'cdU' } {
  const me = s.sim.fighters.find((f) => f.slot === 0);
  const list = [
    ['sspecial', '横B（スティックを横に倒してB）', 'cdS'],
    ['uspecial', '上B（スティックを上に倒してB）', 'cdU'],
    ['dspecial', '下B（スティックを下に倒してB）', 'cdD'],
    ['nspecial', 'B', 'cdN'],
  ] as const;
  for (const [id, label, key] of list) if (me && (moveOf(me.def.id, id, me.job).cd ?? 0) > 0) return { label, key };
  return { label: '横B', key: 'cdS' };
}

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
  const text = typeof st.text === 'function' ? (session instanceof LocalSession ? st.text(session) : '') : st.text;
  tutorialEl.innerHTML = `<div class="tu-step">チュートリアル ${tutorial.step + 1} / ${TUTORIAL.length}</div><div class="tu-title">${st.title}</div><div class="tu-text">${text}</div>`;
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
     <p class="help"><b>ハメ防止：</b>攻撃を受け続けてほとんど動けない状態が約1.5秒続くと、すぐ動けるようになり、少し無敵になって抜け出せます。<br/><b>いろいろなルール：</b>CPU戦やルームでは、ストック・タイム・体力制のほかに「エリアバトル」（エリアに立ってゲージを溜める）や「玉入れ」（ボールを相手のかごに入れる）も選べます。詳しくはメニューの「？」（遊び方）へ。</p>
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
  if (settings.stageId !== RANDOM_STAGE && !STAGES.some((s) => s.id === settings.stageId)) settings.stageId = STAGES[0].id;
  const chips = CHARACTERS.map((c) => `<button type="button" data-v="${c.id}" class="${c.id === training.dummyChar ? 'on' : ''}">${c.name}</button>`).join('');
  showScreen(
    `<h2>練習モード：ステージと相手 <small class="h2-sub">使うキャラ：${getCharacter(settings.charId).name}</small></h2>
     ${stageCards(settings.stageId)}
     <div class="opt-label">練習相手のキャラ</div>
     <div class="seg wrap" data-seg="dummy">${chips}</div>
     <div class="opt-label">練習相手の動き（対戦中も II ボタンで変えられます）</div>
     ${seg('mode', DUMMY_MODES, training.mode)}
     <div class="footer"><button class="btn" id="to-menu">もどる</button><button class="btn" id="back">キャラを変える</button><button class="btn primary" id="start">練習開始！</button></div>`,
    'overlay',
    (root) => {
      bindStages(root, (v) => (settings.stageId = v));
      bindSeg(root, 'dummy', (v) => (training.dummyChar = v));
      bindSeg(root, 'mode', (v) => (training.mode = v as DummyMode));
      root.querySelector('#to-menu')!.addEventListener('click', () => {
        saveSettings(settings);
        showMenu('solo');
      });
      // キャラ選択から「もどる」で、この画面に戻る
      root.querySelector('#back')!.addEventListener('click', () =>
        showCharSelect({ title: '練習モード：キャラを選ぶ', slot: 0, current: settings.charId, nextLabel: '決定', onBack: () => showTrainingSetup(), onNext: () => showTrainingSetup() }),
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
    stageId: resolveStage(settings.stageId, Math.random() * 1e9),
    // 時間は実質無制限（99分）、残機は毎フレーム99に戻す
    rules: { mode: 'stock', stocks: 99, timeLimit: 99 * 60 },
    seed: (Math.random() * 1e9) | 0,
  };
  startSession(new LocalSession(setup, false, training));
}

/** 2人を最初の位置に戻す（ダメージ%はそのまま） */
function resetTrainingPositions(s: LocalSession): void {
  const st = s.sim.stage;
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

// フレンド機能（アプリを開いている間つなぎっぱなし）
const social = new SocialClient();
social.onNotice = (msg) => toast(msg, 3000);
social.onChange = () => {
  // フレンド画面を開いていれば描き直す。メニューの印も更新する
  if (screensEl.querySelector('.friends-screen')) showFriends();
  // 申請・まだ読んでいない DM があれば赤い点（なかった点も足す）
  const want = social.state.inbox.length > 0 || social.unread > 0;
  screensEl.querySelectorAll<HTMLElement>('#friends, #multi').forEach((b) => {
    let d = b.querySelector<HTMLElement>('.m-dot');
    if (!d && want) {
      d = document.createElement('span');
      d.className = 'm-dot';
      b.appendChild(d);
    }
    d?.classList.toggle('hidden', !want);
  });
  // 待機画面の「フレンドにメッセージ」の赤い点・DM の相手選びの数
  const lb = screensEl.querySelector<HTMLElement>('#lobby-dm');
  if (lb) lb.innerHTML = `${chatMark()}フレンドにメッセージ${dmDot()}`;
  if (document.getElementById('dm-pick')) renderDmPicker();
  if (document.getElementById('dm')) renderDm();
};
social.onDm = (code) => {
  if (code === dmCode && document.getElementById('dm')) renderDm();
};
social.onDmNew = (code, name, m) => {
  // 開いているやり取りに届いた：そのまま既読にする
  if (code === dmCode && document.getElementById('dm')) {
    social.openDm(code);
    return;
  }
  // 戦っている最中はお知らせを出さない（赤い点だけ）
  if (fightingNow()) return;
  toast(`${name} さんからメッセージ：${m.k === 'p' ? `「${DM_PHRASES[m.i] ?? ''}」` : `スタンプ「${PIC_STAMPS[m.i]?.text ?? ''}」`}`, 3000);
};
function startSocial(): void {
  social.start(settings.serverUrl, settings.name || 'プレイヤー', settings.hideOnline);
  social.setProfile(myProfile());
}

const net = new NetClient({
  onWelcome() {
    creating = false;
  },
  onLobby(l) {
    lobby = l;
    updateAgainInfo();
    onTourLobby(l);
    updateRoomShare();
    renderWatch();
    // 対戦中：通信が切れた・抜けた人の枠に「CPUが操作中」を出す
    if (session?.kind === 'net') hud.setAway(new Set(l.players.filter((p) => !p.cpu && !p.connected).map((p) => p.slot)));
    // ロビーからキャラ選択を開いている間は画面を切り替えない（戻ったときに最新の内容を出す）
    if (screensEl.querySelector('[data-charsel]')) return;
    if (screensEl.querySelector('[data-lobby]')) showLobby();
    else if (!session || session.kind === 'demo') showLobby();
  },
  onStart(setup) {
    startSession(new NetSession(setup, setup.players.find((p) => p.slot === net.slot) ? net.slot : -1, net));
    onPredictStart(setup);
    onDropStart(setup);
    renderWatch();
  },
  onEnd(results) {
    onPredictEnd(results);
    hideDrop();
    // 一緒に戦ったフレンドの回数を数える（観戦は数えない）
    if (session?.kind === 'net' && net.slot >= 0 && lobby) {
      const inMatch = new Set(session.setup.players.map((p) => p.slot));
      social.countTogether(lobby.players.filter((p) => p.slot !== net.slot && !p.cpu && inMatch.has(p.slot) && p.fh).map((p) => p.fh!));
    }
    if (session?.kind === 'net') {
      resultsShown = true;
      renderWatch();
      showResults(results, session.setup, true);
    }
  },
  onError(code, msg) {
    social.shareRoom(null);
    if (code === 'notfound' || code === 'kicked') clearRejoin();
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
    // 待っている「つなぎ直しています…」のお知らせは、もう出さない
    for (let i = toastQueue.length - 1; i >= 0; i--) if (toastQueue[i].msg.startsWith('通信が切れました。つなぎ直して')) toastQueue.splice(i, 1);
    toast('つなぎ直しました', 2000);
    // 離れている間に対戦が終わっていたら、ロビーへ戻る（対戦中なら start が届いて続きから）
    setTimeout(() => {
      if (session?.kind === 'net' && lobby && !lobby.inMatch) {
        startDemo();
        showLobby();
      }
    }, 600);
  },
  onNotice(msg) {
    toast(msg, 4000);
  },
  onStamp(slot, name, id, pic, tier) {
    if (pic) showStamp(slot, name, '', picStamp(id, tier));
    else showStamp(slot, name, STAMPS[id] ?? '');
  },
  onRoulette(stageId) {
    stageRoulette(stageId);
  },
  onDropped(name, kind, used) {
    // だれが何を落としたかを全員に知らせる
    toast(`${name} さんが乱入アイテム「${ITEM_NAMES[kind] ?? '？'}」を投入！`, 2500);
    if (net.slot >= 0 && used.includes(`h${net.slot}`) && !dropUsed) {
      dropUsed = true;
      renderDrop();
    }
  },
  onPredicts(list) {
    predicts = list;
    if (predictSetup) renderPredict();
    updateTourInfo();
    renderWatch();
  },
  onClose() {
    toast('サーバーとの接続が切れました', 3500);
    lobby = null;
    hidePredict();
    hideDrop();
    renderWatch();
    if (session?.kind === 'net') endToMenu();
    else showMenu();
  },
});// ルームでは、自分のフレンドコードの印を見せる（フレンドと一緒に戦った回数を数えるため）
net.friendHash = () => social.hash;


function createRoom(attempt: number): void {
  if (!settings.serverUrl) return toast('対戦サーバーが設定されていません');
  unlockAudio();
  creating = true;
  createAttempts = attempt;
  roomShared = false;
  const code = String(1000 + Math.floor(Math.random() * 9000));
  showScreen(`<h2>ルームを作成中…</h2>`, 'overlay');
  net.costumeMap = myCostumeMap();
  net.connect(settings.serverUrl, code, true, settings.name || 'プレイヤー', onlineChar(), onlineCostume());
}

/** ルームに参加する（キャラを選んでからつなぐ） */
function joinRoom(code: string, back: () => void): void {
  lastJoinCode = code;
  showCharSelect({
    title: `ルーム ${code} に参加：キャラを選ぶ`,
    slot: 0,
    current: onlineChar(),
    nextLabel: '参加する',
    allowRandom: true,
    onBack: back,
    onNext: () => {
      creating = false;
      showScreen(`<h2>接続中…</h2>`, 'overlay');
      net.costumeMap = myCostumeMap();
      net.connect(settings.serverUrl, code, false, settings.name || 'プレイヤー', onlineChar(), onlineCostume());
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
  // ルームの設定が変わるたびに画面を作り直すので、スクロールの位置を引き継ぐ
  const prevBody = screensEl.querySelector('[data-lobby]')?.closest('.screen')?.querySelector<HTMLElement>('.screen-body');
  const prevScroll = prevBody?.scrollTop ?? 0;
  const isHost = l.hostSlot === net.slot;
  const tourOn = !!l.tourOn;
  const tourLive = tourOn && !!l.tour && l.tour.champion < 0;
  const me = l.players.find((p) => p.slot === net.slot);
  const humans = l.players.filter((p) => !p.cpu).length;
  const cpus = l.players.filter((p) => p.cpu);
  const slots = Array.from({ length: MAX_PLAYERS }, (_, i) => {
    const p = l.players.find((x) => x.slot === i);
    if (!p) return `<div class="pslot empty"><span class="dot" style="background:#555"></span>空き</div>`;
    const c = getCharacter(p.charId);
    const tags = [p.slot === l.hostSlot ? '★' : '', p.slot === net.slot ? '（あなた）' : '', !p.cpu && !p.connected ? '（通信が切れています）' : ''].join('');
    // チーム戦：自分の枠（ホストは全員の枠）をタップするとチームが変わる
    // 玉入れは赤・青の2チーム
    const team = isTwoTeam(l.rules.mode) ? (p.team ?? 0) % 2 : p.team ?? 0;
    const canTap = !!l.rules.teams && !l.inMatch && (p.slot === net.slot || isHost);
    const dot = l.rules.teams ? TEAM_COLORS[team % TEAM_COLORS.length] : SLOT_COLORS[i];
    const teamTag = l.rules.teams ? `<span class="team-tag" style="--tc:${hex(dot)}">${TEAM_NAMES[team % TEAM_NAMES.length]}${canTap ? ' ⇄' : ''}</span>` : '';
    return `<div class="pslot ${canTap ? 'team-tap' : ''}" data-slot="${p.slot}" data-tm="${team}"><span class="dot" style="background:${hex(dot)}"></span>
      <div><div>${esc(p.name)}${tags} ${teamTag}${!p.cpu && p.ready ? '<span class="ready-tag">準備OK</span>' : ''}</div><div style="font-size:11px;color:var(--muted)">${charLabel(p.charId)}</div></div>${isHost && !p.cpu && p.slot !== net.slot && !l.inMatch ? `<button type="button" class="btn small kick-btn" data-kick="${p.slot}" data-kname="${esc(p.name)}">外す</button>` : ''}</div>`;
  }).join('');
  const rules = { ...l.rules };
  const maxCpu = MAX_PLAYERS - humans;
  const cpuLevel = cpus[0]?.cpuLevel ?? 3;
  const cpuOpts = Array.from({ length: maxCpu + 1 }, (_, i) => [i, String(i)] as [number, string]);
  const hostControls = isHost
    ? `${ruleTabs(lobbyTab, LOBBY_TABS)}
      <div data-pane="stage">${stageCards(l.stageId)}</div>
      <div data-pane="fmt"><div class="setup-grid wide">
        <div class="opt opt-wide">試合の進め方 ${seg('fmt', [['all', '全員で'], ['tour', 'トーナメント']], tourOn ? 'tour' : 'all')}</div>
        <div class="opt" data-fmt-help ${tourOn ? '' : 'hidden'}>3位決定戦 ${seg('third', [['on', 'あり'], ['off', 'なし']], l.tourThird !== false ? 'on' : 'off')}</div>
        <div class="opt" data-fmt-help ${tourOn ? '' : 'hidden'}>乱入アイテム ${seg('dropon', [['on', 'あり'], ['off', 'なし']], l.dropOn !== false ? 'on' : 'off')}</div>
        <div class="opt opt-wide" data-fmt-help ${tourOn ? '' : 'hidden'}><span class="muted">乱入アイテム：試合に出ていない人（トーナメントの待ち・観戦）が、1試合に1回アイテムを落とせます</span></div>
        <div class="opt opt-wide" ${tourOn ? 'hidden' : ''}><span class="muted">ルームの全員で同時に戦います。トーナメントにすると、3位決定戦と乱入アイテムも選べます</span></div>
        <div class="opt opt-wide" data-fmt-help ${tourOn ? '' : 'hidden'}><span class="muted">ルームの全員（CPUも）で1対1の勝ち抜き戦。3人から。人数が半端ならシード（1回戦なし）ができます。始める前に組み合わせ表が出ます。試合に出ない人は勝敗を予想して観戦し、全員が予想すると次の試合が始まります（予想する人がいなければ15秒後、予想を待つのは最長30秒）。全員が「OK！」を押すと、待たずにすぐ始まります。3位決定戦（4人以上のとき）は、決勝の前に準決勝で負けた2人で戦います（次に始めるトーナメントから）。チーム戦の設定は使いません</span></div>
      </div></div>
      <div data-pane="rule"><div class="setup-grid wide">
        ${ruleControls(rules)}</div></div>
      <div data-pane="cpu"><div class="setup-grid wide">
        <div class="opt">CPUの人数 ${seg('cpu', cpuOpts, cpus.length)}</div>
        <div class="opt">CPUの強さ ${seg('lv', [[1, '1'], [3, '3'], [5, '5'], [7, '7'], [9, '9']], cpuLevel)}</div>
        ${cpus.length ? `<div class="opt opt-wide"><div class="opt-label">CPUのキャラ（タップで変える）</div>${cpus.map((p, i) => `<button type="button" class="cpu-chip ${p.charId === RANDOM_CHAR ? 'rnd' : ''}" data-lcpu="${i}"><small>CPU${i + 1}</small>${p.charId === RANDOM_CHAR ? `${diceMark()}おまかせ` : esc(getCharacter(p.charId).name)}</button>`).join('')}</div>` : ''}
      </div></div>`
    : `<p class="help">${tourOn ? `<b>トーナメント</b>（1対1の勝ち抜き戦・3位決定戦${l.tourThird !== false ? 'あり' : 'なし'}） ／ ` : ''}ステージ：${l.stageId === RANDOM_STAGE ? 'おまかせ（毎試合ランダム）' : getStage(l.stageId).name} ／ ルール：${ruleText(l.rules)} ／ アイテム${l.rules.items ? 'あり' : 'なし'} ／ ギミック${l.rules.gimmicks ? 'あり' : 'なし'}${tourOn ? ` ／ 乱入アイテム${l.dropOn !== false ? 'あり' : 'なし'}` : ''}<br/>★のホストが開始するのを待っています…${l.rules.teams ? '<br/>自分の枠をタップするとチームを変えられます。' : ''}</p>`;
  const teamCount = new Set(l.players.map((p) => (isTwoTeam(l.rules.mode) ? (p.team ?? 0) % 2 : p.team ?? 0))).size;
  // 準備OK：人（CPU以外）のうち押している数。全員そろうとホストの開始ボタンが光る
  const humanList = l.players.filter((p) => !p.cpu && p.connected);
  const readyN = humanList.filter((p) => p.ready).length;
  const humanN = humanList.length;
  const allReady = humanN >= 2 && readyN === humanN;
  const meReady = !!l.players.find((p) => p.slot === net.slot)?.ready;
  // ホスト以外の人が全員「準備OK」を押すまでは始められない
  const notReady = humanList.filter((p) => p.slot !== l.hostSlot && !p.ready).length;
  const canStart = !l.inMatch && notReady === 0 && (tourLive || (tourOn ? l.players.length >= 3 : l.players.length >= 2 && (!l.rules.teams || teamCount >= 2)));
  const startLabel = tourOn ? 'トーナメント開始！' : '対戦開始！';
  // トーナメントの途中：ホストの開始ボタンの代わりに、全員の「OK！」で次の試合へ
  const okHumans = l.players.filter((p) => !p.cpu && p.connected);
  const okN = (l.again ?? []).filter((s) => okHumans.some((h) => h.slot === s)).length;
  const myOk = (l.again ?? []).includes(net.slot);
  // ホストを譲れる相手：つながっている、自分以外の人（CPUは除く）
  const hostCandidates = l.players.filter((p) => !p.cpu && p.connected && p.slot !== net.slot);
  const lobbyEl = showScreen(
    `<div data-lobby class="row" style="justify-content:space-between">
       <div><div style="font-size:12px;color:var(--muted)">ルームコード（友達に教えてください）</div><div class="code-big">${l.code}</div><div class="lobby-coins">${coinBadge()}</div></div>
       <div class="players grow" style="max-width:560px">${slots}</div>
     </div>
     ${tourOn && l.tour ? '<div data-tour class="lobby-tour"></div>' : ''}
     <div class="row my-char">
       ${
         net.spectating
           ? '<div><b>観戦中</b>（見るだけ。対戦が始まると見られます）</div>'
           : `<span class="dot" style="background:${hex(SLOT_COLORS[net.slot % SLOT_COLORS.length])}"></span>
       <div>あなたのキャラ：<b>${charLabel(me?.charId ?? onlineChar())}</b></div>
       <button class="btn small" id="change-char">キャラを変える</button>`
       }
       ${!net.spectating && !isHost && !tourLive ? `<button class="btn small ${meReady ? 'on-toggle' : 'primary'}" id="ready">${meReady ? '準備OK（取り消す）' : '準備OK'}</button>` : ''}
       <button class="btn small" id="invite">招待リンクを送る</button>
       ${social.connected && social.state.friends.length ? `<button class="btn small dm-open-btn" id="lobby-dm">${chatMark()}フレンドにメッセージ${dmDot()}</button>` : ''}
       ${isHost ? `<button class="btn small ${roomShared ? 'on-toggle' : ''}" id="share-friends">フレンドに公開：${roomShared ? 'する' : 'しない'}</button>` : ''}
       ${isHost && !l.inMatch && hostCandidates.length ? '<button class="btn small" id="give-host">ホストを譲る</button>' : ''}
       ${isHost && !l.inMatch && !tourOn && l.rules.teams && l.players.length >= 2 ? '<button class="btn small" id="auto-team">チームをおまかせで分ける</button>' : ''}
       ${l.spectators ? `<span class="muted">観戦 ${l.spectators}人</span>` : ''}
     </div>
     ${net.spectating ? '' : stampBar()}
     ${hostControls}
     <div class="footer">
       <button class="btn" id="leave">抜ける</button>
       ${isHost && !tourOn && l.rules.teams && teamCount < 2 ? '<span class="muted">2チーム以上に分けてください</span>' : ''}
       ${isHost && tourOn && !tourLive && l.players.length < 3 ? '<span class="muted">トーナメントは3人から（CPUを足せます）</span>' : ''}
       ${isHost ? `<span class="rule-sum">${tourOn ? `トーナメント（3位決定戦${l.tourThird !== false ? 'あり' : 'なし'}）・` : ''}${esc(ruleSummary(l.rules, l.stageId, cpus.length, cpuLevel))}</span>` : ''}
       ${isHost && !tourLive ? `<span class="ready-count ${allReady ? 'all' : ''}">準備OK ${readyN}/${humanN}${notReady ? '（全員そろうと始められます）' : ''}</span>` : ''}
       ${isHost && !tourLive ? `<button class="btn primary ${allReady && canStart ? 'glow' : ''}" id="start" ${canStart ? '' : 'disabled'}>${startLabel}</button>` : ''}
       ${tourLive && !net.spectating ? `<span class="ready-count ${okN === okHumans.length ? 'all' : ''}">OK ${okN}/${okHumans.length}人</span><button class="btn ${myOk ? 'on-toggle' : 'primary'}" id="tour-ok">${myOk ? 'OK（取り消す）' : 'OK！'}</button>` : ''}
     </div>`,
    'overlay',
    (root) => {
      root.querySelector('#invite')!.addEventListener('click', () => void shareInvite(l.code));
      root.querySelector('#lobby-dm')?.addEventListener('click', () => openDmPicker());
      root.querySelector('#give-host')?.addEventListener('click', () => openGiveHost(hostCandidates));
      root.querySelectorAll<HTMLElement>('[data-kick]').forEach((b) =>
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          confirmDialog(`${b.dataset.kname} さんをルームから外しますか？`, '外された人は、このルームに入り直せません。', '外す', () => net.kick(Number(b.dataset.kick)));
        }),
      );
      root.querySelector('#auto-team')?.addEventListener('click', () => {
        net.autoTeam();
        sfx.click();
      });
      root.querySelector('#ready')?.addEventListener('click', () => net.setReady(!meReady));
      root.querySelector('#tour-ok')?.addEventListener('click', () => {
        net.again(!myOk);
        sfx.click();
      });
      bindStampBar(root);
      root.querySelector('#share-friends')?.addEventListener('click', () => {
        roomShared = !roomShared;
        updateRoomShare();
        toast(roomShared ? 'フレンドの一覧にこのルームが出ます' : 'フレンドへの公開をやめました');
        showLobby();
      });
      root.querySelectorAll<HTMLElement>('.pslot.team-tap').forEach((el) =>
        el.addEventListener('click', () => {
          const slot = Number(el.dataset.slot);
          sfx.click();
          net.setTeam((Number(el.dataset.tm) + 1) % (isTwoTeam(l.rules.mode) ? 2 : TEAM_COUNT), slot === net.slot ? undefined : slot);
        }),
      );
      root.querySelector('#change-char')?.addEventListener('click', () =>
        showCharSelect({
          title: 'キャラを変える',
          slot: net.slot,
          current: me?.charId ?? onlineChar(),
          nextLabel: 'これにする',
          allowRandom: true,
          onBack: showLobby,
          onNext: (id) => {
            net.costumeMap = myCostumeMap();
            net.setChar(id, id === RANDOM_CHAR ? undefined : myCostume(id));
            showLobby();
          },
        }),
      );
      root.querySelector('#leave')!.addEventListener('click', () => {
        net.close();
        clearRejoin();
        social.shareRoom(null);
        lobby = null;
        showMenu();
      });
      if (isHost) {
        bindTabs(root, (k) => (lobbyTab = k));
        let cpuCount = cpus.length;
        let lv = cpuLevel;
        let stageId = l.stageId;
        let fmtTour = tourOn;
        let third = l.tourThird !== false;
        let dropOn = l.dropOn !== false;
        const cpuChars = cpus.map((p) => p.charId);
        const push = () => net.config(rules, stageId, cpuCount, lv, fmtTour, third, dropOn, cpuChars);
        root.querySelectorAll<HTMLElement>('[data-lcpu]').forEach((b) =>
          b.addEventListener('click', () => {
            const i = Number(b.dataset.lcpu);
            pickCpuChar(
              i,
              (id) => {
                cpuChars[i] = id;
                push();
              },
              cpuChars[i],
            );
          }),
        );
        bindSeg(root, 'dropon', (v) => {
          dropOn = v === 'on';
          push();
        });
        bindSeg(root, 'third', (v) => {
          third = v === 'on';
          push();
        });
        bindSeg(root, 'fmt', (v) => {
          // 進行中のトーナメントがあれば終わりになるので、確かめる
          if (v !== 'tour' && tourLive) {
            showLobby();
            confirmDialog('進行中のトーナメントを終わりにしますか？', '', '終わりにする', () => {
              fmtTour = false;
              push();
            });
            return;
          }
          fmtTour = v === 'tour';
          push();
        });
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
  updateTourInfo();
  const body = lobbyEl.querySelector<HTMLElement>('.screen-body');
  if (body && prevScroll) body.scrollTop = prevScroll;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.kind === 'net') {
    input.reset();
    net.sendNeutral();
  }
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 新しいバージョンのお知らせ：公開中の version.json をときどき読み、この版と違えば「更新する」ボタンを出す
const updateBar = document.createElement('div');
updateBar.id = 'update-bar';
updateBar.className = 'hidden';
updateBar.innerHTML = `<span>新しいバージョンがあります</span><button type="button" class="btn small primary">更新する</button>`;
document.getElementById('app')!.appendChild(updateBar);
updateBar.querySelector('button')!.addEventListener('click', () => location.reload());
let newVersion = false;
async function checkVersion(): Promise<void> {
  if (newVersion || !import.meta.env.PROD) return;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const v = (await res.json()) as { id?: string };
    if (v.id && v.id !== __BUILD_ID__) newVersion = true;
  } catch {
    /* つながらないときは何もしない */
  }
}
// 試合中は出さない（メニュー・ルーム・結果画面のときだけ）
setInterval(() => {
  const playing = !!session && session.kind !== 'demo' && !resultsShown;
  updateBar.classList.toggle('hidden', !newVersion || playing);
}, 1000);
setInterval(() => void checkVersion(), 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void checkVersion();
});
setTimeout(() => void checkVersion(), 5000);

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
  /** 確認用：オンライン対戦の通信 */
  get net() {
    return net;
  },
  /** 確認用：指定した組み合わせでCPU戦を始める */
  startLocal(setup: MatchSetup) {
    lastSetup = setup;
    startSession(new LocalSession(setup));
  },
};
