// 野球（トバセ・ベースボール）：投げる・打つ・打球・判定・カウント・塁・イニングを計算する。
// 画面に依存しない決まった計算（同じ入力なら同じ結果）なので、あとでオンライン対戦にも使える。
//
// 座標（メートル）：ホームベースが原点。z = ピッチャーの方（外野）、x = 横（キャッチャーから見て右が +）、y = 高さ。
// 1イニングは表（チーム0が打つ）と裏（チーム1が打つ）で、どちらも3打席で攻守交代（アウトの数では交代しない）。

import { Rng } from './rng';
import type { InputState } from './types';
import { BTN_A, BTN_B } from './types';

/** キャラごとの野球の性能（1〜5。3がふつう） */
export interface BBStats {
  /** 球の速さ */
  speed: number;
  /** 変化球の曲がり */
  brk: number;
  /** コントロール（大きいほど狙ったところへ） */
  control: number;
  /** ミート（ミートの丸の大きさ） */
  meet: number;
  /** パワー（打球の速さ） */
  power: number;
}

export const BB_STATS: Record<string, BBStats> = {
  guard: { speed: 3, brk: 2, control: 4, meet: 3, power: 4 },
  hacker: { speed: 2, brk: 5, control: 4, meet: 4, power: 2 },
  thief: { speed: 3, brk: 3, control: 3, meet: 5, power: 2 },
  streamer: { speed: 4, brk: 3, control: 2, meet: 3, power: 4 },
  dopa: { speed: 4, brk: 4, control: 1, meet: 3, power: 3 },
  gacha: { speed: 3, brk: 4, control: 2, meet: 2, power: 5 },
  courier: { speed: 5, brk: 2, control: 3, meet: 4, power: 2 },
  ai: { speed: 3, brk: 4, control: 5, meet: 3, power: 3 },
  trainer: { speed: 5, brk: 1, control: 2, meet: 2, power: 5 },
  threeb: { speed: 3, brk: 3, control: 3, meet: 4, power: 3 },
  menhera: { speed: 2, brk: 5, control: 3, meet: 3, power: 3 },
};
export function bbStats(charId: string): BBStats {
  return BB_STATS[charId] ?? { speed: 3, brk: 3, control: 3, meet: 3, power: 3 };
}

/** 野球の決まりと数値 */
export const BB = {
  /** ピッチャーが投げる位置と、ホームベースまでの距離 */
  releaseZ: 17.5,
  releaseY: 1.75,
  /** ストライクゾーン（ホームベースの上） */
  zone: { x: 0.27, y1: 0.48, y2: 1.12 },
  /** 狙い・ミートの丸を動かせる範囲 */
  aimX: 0.62,
  /** ここより内側（バッター側）に来た球はバッターに当たる（デッドボール） */
  hbpX: 0.6,
  /** ボール球を打ったときの弱まり方（ゾーンから1メートル外れるごと） */
  ballWeak: 3.2,
  aimY1: 0.12,
  aimY2: 1.55,
  /** 球の速さ（1フレームに進む距離。速さ3のとき）と、1段階ごとの差。変化球は少し遅い */
  pitchSpeed: 0.3,
  perSpeed: 0.025,
  breakSlow: 0.84,
  /** 変化球の曲がる量（ホームベースでのずれ。曲がり3のとき）と、1段階ごとの差 */
  brk: 0.44,
  perBrk: 0.07,
  /** 変化球が曲がり始める所（投げてからホームベースまでの割合）。手元で曲がるほど打ちにくい */
  breakStart: 0.42,
  /** 打つとき、球が来る所の予告を出し始める所（投げてからホームベースまでの割合） */
  arriveShow: 0.5,
  /** バットの当たる範囲（横長のだ円）：ミートの丸の半径に対する横・縦の大きさと、芯（いちばん強く飛ぶ所）の大きさ */
  batW: 2.1,
  batH: 0.72,
  sweet: 0.35,
  /** コントロールのぶれ（コントロール3のとき）と、1段階ごとの差 */
  wild: 0.07,
  perControl: 0.016,
  /** 狙い・ミートの丸を動かすいちばん速い速さ（1フレーム）と、速さが追いつく割合（なめらかに加速・減速する） */
  cursorMax: 0.042,
  cursorEase: 0.3,
  /** スティックの遊び（これより小さい傾きは動かない） */
  cursorDead: 0.1,
  /** 打球が地面ではねるときの、はね返り・転がるときの減り方と、落ちてから結果を出すまで（フレーム） */
  bounce: 0.42,
  roll: 0.78,
  rollT: 55,
  /** ミートの丸の半径（ミート3のとき）と、1段階ごとの差 */
  meetR: 0.15,
  perMeet: 0.02,
  /** バットを振り始めてから当たるまで（フレーム）と、当たるタイミングの幅（これより外れると空振り） */
  swingDelay: 4,
  timingWin: 8,
  /** 打球の速さ（メートル/秒）：基本 + 当たりの良さ × 幅 × パワー */
  exitBase: 17,
  exitRange: 27,
  perPower: 0.07,
  /** 重力と空気抵抗（1秒あたり） */
  gravity: 9.8,
  drag: 0.035,
  /** フェンスまでの距離（両翼・センター） */
  fenceLine: 76,
  fenceCenter: 90,
  /** ファウルになる角度（度） */
  foulDeg: 45,
  /** 1イニングの打席の数（チームごと） */
  paPerHalf: 3,
  /** 間の時間（フレーム） */
  readyT: 50,
  aimMax: 12 * 60,
  callT: 55,
  resultT: 110,
  changeT: 110,
};

/** 球種 */
export type PitchKind = 'straight' | 'slider' | 'curve' | 'fork' | 'shoot';
export const PITCH_KINDS: PitchKind[] = ['straight', 'slider', 'curve', 'fork', 'shoot'];
export const PITCH_NAMES: Record<PitchKind, string> = { straight: 'ストレート', slider: 'スライダー', curve: 'カーブ', fork: 'フォーク', shoot: 'シュート' };
/**
 * 球種ごとの速さ（ストレートを1）と、ホームベースでの曲がり（曲がりの強さ1あたり。x = 横、y = 縦。右打ちのバッターから見て、
 * スライダー・カーブは外へ逃げる（x がマイナス）、シュートは内へ食い込む（x がプラス）、フォーク・カーブは落ちる）
 */
export const PITCH_SPECS: Record<PitchKind, { speed: number; x: number; y: number }> = {
  straight: { speed: 1, x: 0, y: 0 },
  slider: { speed: 0.88, x: -1, y: -0.25 },
  curve: { speed: 0.76, x: -0.55, y: -1.15 },
  fork: { speed: 0.86, x: 0, y: -1.1 },
  shoot: { speed: 0.92, x: 0.85, y: -0.3 },
};

export type BBPhase = 'ready' | 'aim' | 'pitch' | 'call' | 'hit' | 'result' | 'change' | 'end';
export type BBResult = 'single' | 'double' | 'triple' | 'homer' | 'walk' | 'hbp' | 'strikeout' | 'groundout' | 'flyout' | 'lineout';
export type BBCall = 'strike' | 'ball' | 'foul' | 'whiff';

export interface BBPlayer {
  slot: number;
  name: string;
  charId: string;
  costume?: string;
  cpu: boolean;
  /** CPU の強さ（1〜9） */
  level: number;
  team: number;
}

export interface BBSetup {
  players: BBPlayer[];
  /** イニング数 */
  innings: number;
  seed: number;
}

export type BBEvent =
  | { k: 'pitch'; type: PitchKind }
  | { k: 'swing' }
  | { k: 'contact'; q: number }
  | { k: 'call'; c: BBCall }
  | { k: 'result'; r: BBResult; runs: number }
  | { k: 'change' }
  | { k: 'end' };

interface Vec {
  x: number;
  y: number;
  z: number;
}

export class Baseball {
  readonly setup: BBSetup;
  private rng: Rng;
  frame = 0;
  /** イニング（1〜）と表（0）・裏（1） */
  inning = 1;
  half = 0;
  /** この半イニングで何打席目か（0〜2） */
  pa = 0;
  balls = 0;
  strikes = 0;
  /** この半イニングのアウトの数（表示用。アウトでは交代しない） */
  outs = 0;
  bases: [boolean, boolean, boolean] = [false, false, false];
  score: [number, number] = [0, 0];
  /** イニングごとの点（スコアボード用）：[チーム][イニング-1] */
  lines: [number[], number[]] = [[], []];
  phase: BBPhase = 'ready';
  timer = BB.readyT;
  /** 打順：チームごとに、次に打つ人の番号 */
  private order: [number, number] = [0, 0];
  /** ピッチャーの狙い、バッターのミートの丸 */
  aim = { x: 0, y: 0.8 };
  cursor = { x: 0, y: 0.8 };
  /** 狙い・ミートの丸が動いている速さ（なめらかに動かすため） */
  private aimV = { x: 0, y: 0 };
  private cursorV = { x: 0, y: 0 };
  /** 投げた球の曲がる向き（-1・1 = 横、0 = 落ちる）と、速さ（1フレームに進む距離） */
  pitchSide = 0;
  pitchSpeed = 0;
  /** 打球が落ちてから結果を出すまで（はねて転がる間）。落ちたときに結果は決めておく */
  private landing: { left: number; result: BBResult | 'foul' } | null = null;
  /** 投げた球：最初の位置・速さ・曲がり（1フレームあたり）と、ホームベースに着くまでのフレーム数 */
  private p0: Vec = { x: 0, y: BB.releaseY, z: BB.releaseZ };
  private v0: Vec = { x: 0, y: 0, z: 0 };
  private acc: Vec = { x: 0, y: 0, z: 0 };
  pitchT = 0;
  pitchF = 60;
  pitchType: PitchKind = 'straight';
  /** ピッチャーが選んでいる球種（投げる前に選ぶ） */
  choice: PitchKind = 'straight';
  /** バットを振ったフレーム（振っていなければ -1） */
  swingAt = -1;
  /** 打球 */
  hitBall: Vec & { vx: number; vy: number; vz: number; landed: boolean; spray: number; launch: number; speed: number } = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, landed: false, spray: 0, launch: 0, speed: 0,
  };
  /** 直前の結果（表示用） */
  lastCall: BBCall | null = null;
  lastResult: BBResult | null = null;
  lastRuns = 0;
  /** 打席の結果の記録（自分の成績用）：[slot, 結果] */
  log: [number, BBResult][] = [];
  events: BBEvent[] = [];
  private prevButtons = new Map<number, number>();
  /** 当たりを計算するための、ホームベースでの球の位置 */
  private plate = { x: 0, y: 0 };
  private resolved: BBResult | null = null;
  finished = false;

  constructor(setup: BBSetup) {
    this.setup = setup;
    this.rng = new Rng(setup.seed);
    for (let t = 0; t < 2; t++) this.lines[t] = [];
  }

  teamPlayers(team: number): BBPlayer[] {
    return this.setup.players.filter((p) => p.team % 2 === team);
  }
  /** 今打っている人・投げている人 */
  get batter(): BBPlayer {
    const t = this.teamPlayers(this.half);
    return t[this.order[this.half] % t.length];
  }
  get pitcher(): BBPlayer {
    const t = this.teamPlayers(1 - this.half);
    return t[(this.inning - 1) % t.length];
  }

  /** 投げた球の、t フレーム後の位置 */
  pitchPos(t: number): Vec {
    // 曲がり始めるまではまっすぐ、そこから曲がる
    const u = Math.max(0, t - this.breakT);
    return {
      x: this.p0.x + this.v0.x * t + 0.5 * this.acc.x * u * u,
      y: this.p0.y + this.v0.y * t + 0.5 * this.acc.y * u * u,
      z: this.p0.z + this.v0.z * t,
    };
  }
  /** 変化球が曲がり始めるフレーム */
  private breakT = 0;

  /** 画面から：ピッチャーの狙い・バッターのバットの位置を直接決める（指で動かすとき）。振るのは requestSwing */
  setAim(slot: number, x: number, y: number): void {
    if (this.pitcher.slot !== slot || this.phase !== 'aim') return;
    this.aim.x = clamp(x, -BB.aimX, BB.aimX);
    this.aim.y = clamp(y, BB.aimY1, BB.aimY2);
    this.aimV = { x: 0, y: 0 };
  }
  setCursor(slot: number, x: number, y: number): void {
    if (this.batter.slot !== slot || !this.cursorFree) return;
    this.cursor.x = clamp(x, -BB.aimX, BB.aimX);
    this.cursor.y = clamp(y, BB.aimY1, BB.aimY2);
    this.cursorV = { x: 0, y: 0 };
  }
  /** バットを動かせるとき：次の球を待っている間（ピッチャーが球種を選んでいる・投げる前）と、球が来ていてまだ振っていない間 */
  get cursorFree(): boolean {
    const ph = this.phase;
    return ph === 'ready' || ph === 'aim' || ph === 'call' || (ph === 'pitch' && this.swingAt < 0);
  }
  /** 変化球が曲がり始めるフレーム（画面の予告に使う） */
  get breakFrame(): number {
    return this.breakT;
  }
  private swingReq = -1;
  requestSwing(slot: number): void {
    if (this.batter.slot === slot && this.phase === 'pitch' && this.swingAt < 0) this.swingReq = slot;
  }
  /** 今の球の位置（投げていなければピッチャーの手元） */
  get ballPos(): Vec {
    if (this.phase === 'pitch' || this.phase === 'call') return this.pitchPos(Math.min(this.pitchT, this.pitchF + 12));
    if (this.phase === 'hit' || this.phase === 'result') return { x: this.hitBall.x, y: this.hitBall.y, z: this.hitBall.z };
    return { ...this.p0 };
  }

  private pressed(slot: number, inp: InputState, btn: number): boolean {
    return (inp.buttons & btn) !== 0 && ((this.prevButtons.get(slot) ?? 0) & btn) === 0;
  }

  step(inputs: Map<number, InputState>): void {
    this.events = [];
    if (this.finished) return;
    this.frame++;
    const none: InputState = { mx: 0, my: 0, buttons: 0 };
    const bat = this.batter;
    const pit = this.pitcher;
    const bi = inputs.get(bat.slot) ?? none;
    const pi = inputs.get(pit.slot) ?? none;
    const sb = bbStats(bat.charId);
    const sp = bbStats(pit.charId);
    // バッター：投げる前と、球が来ている間はミートの丸を動かせる
    if (this.cursorFree) {
      moveCursor(this.cursor, this.cursorV, bi);
    }
    switch (this.phase) {
      case 'ready':
        if (--this.timer <= 0) {
          this.phase = 'aim';
          this.timer = BB.aimMax;
          this.aim = { x: 0, y: 0.8 };
          this.aimV = { x: 0, y: 0 };
        }
        break;
      case 'aim': {
        moveCursor(this.aim, this.aimV, pi);
        const a = this.pressed(pit.slot, pi, BTN_A);
        const b = this.pressed(pit.slot, pi, BTN_B);
        // ピッチャー：狙いを動かし、A で選んだ球種を投げる（B で球種を順に切りかえ。画面のボタンでも選べる）
        if (b) this.choice = PITCH_KINDS[(PITCH_KINDS.indexOf(this.choice) + 1) % PITCH_KINDS.length];
        if (a || --this.timer <= 0) this.throwPitch(this.choice, sp);
        break;
      }
      case 'pitch': {
        this.pitchT++;
        if (this.swingAt < 0 && (this.pressed(bat.slot, bi, BTN_A) || this.swingReq === bat.slot)) {
          this.swingReq = -1;
          this.swingAt = this.pitchT;
          this.events.push({ k: 'swing' });
        }
        // ホームベースを通るときの球の位置を覚えておく
        if (this.pitchT === this.pitchF) {
          const p = this.pitchPos(this.pitchF);
          this.plate = { x: p.x, y: p.y };
        }
        // 振った：バットが当たる瞬間（球が来る前なら、球が来たとき）に判定。振らなかった：遅れて振れる時間が過ぎたら見送り
        if (this.swingAt >= 0) {
          if (this.pitchT >= Math.max(this.swingAt + BB.swingDelay, this.pitchF)) this.judge(sb);
        } else if (this.pitchT >= this.pitchF + BB.timingWin - BB.swingDelay) this.judge(sb);
        break;
      }
      case 'call':
        if (--this.timer <= 0) this.afterCall();
        break;
      case 'hit':
        this.flyBall();
        break;
      case 'result':
        if (--this.timer <= 0) this.nextBatter();
        break;
      case 'change':
        if (--this.timer <= 0) {
          this.phase = 'ready';
          this.timer = BB.readyT;
        }
        break;
      case 'end':
        break;
    }
    for (const p of this.setup.players) this.prevButtons.set(p.slot, (inputs.get(p.slot) ?? none).buttons);
  }

  /** 球種を選ぶ（投げる番のピッチャーだけ。投げる前なら何度でも選び直せる） */
  choosePitch(slot: number, kind: PitchKind): void {
    if (this.pitcher.slot !== slot || (this.phase !== 'ready' && this.phase !== 'aim')) return;
    if (PITCH_KINDS.includes(kind)) this.choice = kind;
  }

  private throwPitch(type: PitchKind, s: BBStats): void {
    this.pitchType = type;
    const spec = PITCH_SPECS[type];
    this.pitchSide = Math.sign(spec.x);
    const speed = pitchSpeedOf(type, s.speed);
    const F = Math.round(BB.releaseZ / speed);
    this.pitchSpeed = speed;
    // 狙いから、コントロールのぶんだけぶれる
    const wild = Math.max(0.02, BB.wild - (s.control - 3) * BB.perControl);
    const ang = this.rng.next() * Math.PI * 2;
    const r = wild * Math.sqrt(this.rng.next());
    const tx = this.aim.x + Math.cos(ang) * r;
    const ty = this.aim.y + Math.sin(ang) * r;
    // 変化球：狙い（投げ出す向き）に向かってまっすぐ飛び、途中から球種ごとの向きへ曲がる（ホームベースで shift だけずれる）
    const shift = pitchShift(type, s.brk);
    const tb = Math.round(F * BB.breakStart);
    const n = F - tb;
    this.breakT = tb;
    this.acc = { x: (2 * shift.x) / (n * n), y: (2 * shift.y) / (n * n), z: 0 };
    this.p0 = { x: 0, y: BB.releaseY, z: BB.releaseZ };
    this.v0 = { x: (tx - this.p0.x) / F, y: (ty - this.p0.y) / F, z: -BB.releaseZ / F };
    this.pitchF = F;
    this.pitchT = 0;
    this.swingAt = -1;
    this.phase = 'pitch';
    this.events.push({ k: 'pitch', type });
  }

  /** 球がホームベースに来た：見送り（ストライク・ボール）・空振り・当たり */
  private judge(s: BBStats): void {
    const p = this.plate;
    const inZone = Math.abs(p.x) <= BB.zone.x && p.y >= BB.zone.y1 && p.y <= BB.zone.y2;
    // 振らずにバッターの体に当たった：デッドボール（1塁へ）
    if (this.swingAt < 0 && hitsBatter(p)) {
      this.finishAtBat('hbp');
      return;
    }
    if (this.swingAt < 0) {
      this.setCall(inZone ? 'strike' : 'ball');
      return;
    }
    const diff = this.swingAt + BB.swingDelay - this.pitchF; // マイナス = 早い
    // バット：横長のだ円。真ん中（芯）に近いほど強い当たり
    const r = BB.meetR + (s.meet - 3) * BB.perMeet;
    const rw = r * BB.batW;
    const rh = r * BB.batH;
    const ex = (this.cursor.x - p.x) / rw;
    const ey = (this.cursor.y - p.y) / rh;
    const e = Math.hypot(ex, ey);
    if (Math.abs(diff) > BB.timingWin || e > 1) {
      this.setCall('whiff');
      return;
    }
    // 当たった：当たりの良さ（芯に近く、タイミングが合うほど良い。芯の中なら満点）
    const core = Math.max(0, (e - BB.sweet * 0.5) / (1 - BB.sweet * 0.5));
    // ボール球は芯でとらえても強く飛ばない（ゾーンから外れるほど弱い当たり）
    const out = zoneOut(p);
    const q = Math.pow(1 - core, 0.6) * (1 - Math.pow(Math.abs(diff) / BB.timingWin, 2)) * clamp(1 - out * BB.ballWeak, 0.2, 1);
    const speed = (BB.exitBase + BB.exitRange * q) * (1 + (s.power - 3) * BB.perPower);
    // バットが球より上 = 球の上をたたく（ゴロ）、下 = 下をすくう（フライ）
    const dy = ey * 0.75;
    // 低いボール球はゴロ、高いボール球はポップフライになりやすい
    const lowHigh = p.y < BB.zone.y1 ? -(BB.zone.y1 - p.y) * 45 : p.y > BB.zone.y2 ? (p.y - BB.zone.y2) * 60 : 0;
    const launch = clamp(16 - dy * 38 + lowHigh + (this.rng.next() - 0.5) * 8, -12, 62);
    // タイミングが早いと引っ張り（左）、遅いと流し（右）
    const spray = diff * 7 + (this.rng.next() - 0.5) * 10;
    this.events.push({ k: 'contact', q });
    const la = (launch * Math.PI) / 180;
    const sa = (spray * Math.PI) / 180;
    this.hitBall = {
      x: p.x,
      y: p.y,
      z: 0.3,
      vx: Math.cos(la) * Math.sin(sa) * speed,
      vy: Math.sin(la) * speed,
      vz: Math.cos(la) * Math.cos(sa) * speed,
      landed: false,
      spray,
      launch,
      speed,
    };
    this.phase = 'hit';
    this.timer = 0;
    this.landing = null;
  }

  /** 打球を飛ばす。落ちたら（またはフェンスを越えたら）結果を決める */
  private flyBall(): void {
    const b = this.hitBall;
    const dt = 1 / 60;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const k = Math.max(0, 1 - BB.drag * sp * dt * 0.1);
    b.vx *= k;
    b.vz *= k;
    b.vy = b.vy * k - BB.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    this.timer++;
    const dist = Math.hypot(b.x, b.z);
    const fence = this.fenceAt(b.spray);
    const foul = Math.abs(b.spray) > BB.foulDeg || b.z < 0;
    if (!this.landing && !foul && dist >= fence && b.y > 2.5) {
      this.finishAtBat('homer');
      return;
    }
    // 地面ではねる・転がる（ゴロらしく）
    if (b.y <= 0 && b.vy < 0) {
      b.y = 0;
      if (!this.landing) {
        // 最初に落ちたときに結果を決めておき、はねて転がるのを見せてから出す
        b.landed = true;
        this.landing = { left: BB.rollT, result: foul ? 'foul' : this.outcome(dist, b.launch, b.speed) };
      }
      b.vy = Math.abs(b.vy) * BB.bounce;
      b.vx *= BB.roll;
      b.vz *= BB.roll;
      if (b.vy < 1.2) b.vy = 0;
    }
    if (b.y <= 0 && b.vy === 0) {
      // 転がる：だんだん止まる
      b.vx *= 0.97;
      b.vz *= 0.97;
    }
    if (this.landing && --this.landing.left <= 0) {
      const r = this.landing.result;
      this.landing = null;
      if (r === 'foul') this.setCall('foul');
      else this.finishAtBat(r);
      return;
    }
    if (this.timer > 420) {
      this.landing = null;
      this.finishAtBat(foul ? 'flyout' : this.outcome(dist, b.launch, b.speed));
    }
  }

  /** フェンスまでの距離（打球の向きで変わる） */
  fenceAt(spray: number): number {
    const t = Math.min(1, Math.abs(spray) / BB.foulDeg);
    return BB.fenceCenter + (BB.fenceLine - BB.fenceCenter) * t;
  }

  /** 落ちた場所・角度・速さから、ヒットかアウトか（守備は自動） */
  private outcome(dist: number, launch: number, speed: number): BBResult {
    const r = this.rng.next();
    if (launch < 8) {
      // ゴロ：速い当たりほど抜ける
      const p = clamp((speed - 22) / 22, 0.08, 0.55);
      return r < p ? 'single' : 'groundout';
    }
    const liner = launch < 24;
    if (dist < 32) return liner ? 'lineout' : 'flyout';
    if (dist < 58) return r < (liner ? 0.62 : 0.3) ? 'single' : liner ? 'lineout' : 'flyout';
    if (dist < 75) return r < (liner ? 0.6 : 0.42) ? (this.rng.next() < 0.35 ? 'double' : 'single') : 'flyout';
    return r < 0.62 ? (this.rng.next() < 0.25 ? 'triple' : 'double') : 'flyout';
  }

  private setCall(c: BBCall): void {
    this.lastCall = c;
    this.events.push({ k: 'call', c });
    this.phase = 'call';
    this.timer = BB.callT;
  }

  private afterCall(): void {
    const c = this.lastCall;
    if (c === 'ball') {
      this.balls++;
      if (this.balls >= 4) return this.finishAtBat('walk');
    } else if (c === 'foul') {
      if (this.strikes < 2) this.strikes++;
    } else {
      this.strikes++;
      if (this.strikes >= 3) return this.finishAtBat('strikeout');
    }
    this.phase = 'ready';
    this.timer = BB.readyT;
  }

  /** 打席の結果：塁を進めて点を入れる */
  private finishAtBat(r: BBResult): void {
    const team = this.half;
    let runs = 0;
    const b = this.bases;
    const adv = (n: number) => {
      // 走っている人を n 塁ずつ進め、打った人も n 塁へ。ヒットでは2塁の人がかえり、ツーベースでは1塁の人もかえる（ふつうの野球と同じくらい）
      for (let i = 2; i >= 0; i--) {
        if (!b[i]) continue;
        b[i] = false;
        const go = n === 1 && i === 1 ? 2 : n === 2 && i === 0 ? 3 : n;
        if (i + go >= 3) runs++;
        else b[i + go] = true;
      }
      if (n >= 4) runs++;
      else b[n - 1] = true;
    };
    if (r === 'single') adv(1);
    else if (r === 'double') adv(2);
    else if (r === 'triple') adv(3);
    else if (r === 'homer') adv(4);
    else if (r === 'walk' || r === 'hbp') {
      // 押し出し：詰まっているところだけ進む
      if (b[0]) {
        if (b[1]) {
          if (b[2]) runs++;
          b[2] = true;
        }
        b[1] = true;
      }
      b[0] = true;
    } else this.outs++;
    this.score[team] += runs;
    const ln = this.lines[team];
    while (ln.length < this.inning) ln.push(0);
    ln[this.inning - 1] += runs;
    this.lastResult = r;
    this.lastRuns = runs;
    this.log.push([this.batter.slot, r]);
    this.events.push({ k: 'result', r, runs });
    this.resolved = r;
    this.phase = 'result';
    this.timer = BB.resultT + (r === 'homer' ? 40 : 0);
  }

  private nextBatter(): void {
    this.order[this.half]++;
    this.pa++;
    this.balls = 0;
    this.strikes = 0;
    this.resolved = null;
    const last = this.inning >= this.setup.innings;
    // サヨナラ：最終回の裏に、後攻のチームが勝ち越したら終わり
    if (last && this.half === 1 && this.score[1] > this.score[0]) return this.endGame();
    if (this.pa < BB.paPerHalf) {
      this.phase = 'ready';
      this.timer = BB.readyT;
      return;
    }
    // 攻守交代
    this.pa = 0;
    this.outs = 0;
    this.bases = [false, false, false];
    if (this.half === 0) {
      // 最終回の表が終わって、後攻のチームが勝っていれば裏はしない
      if (last && this.score[1] > this.score[0]) return this.endGame();
      this.half = 1;
    } else {
      if (last) return this.endGame();
      this.half = 0;
      this.inning++;
    }
    for (let t = 0; t < 2; t++) while (this.lines[t].length < this.inning - (t === 1 && this.half === 0 ? 1 : 0)) this.lines[t].push(0);
    this.phase = 'change';
    this.timer = BB.changeT;
    this.events.push({ k: 'change' });
  }

  private endGame(): void {
    for (let t = 0; t < 2; t++) while (this.lines[t].length < this.inning - (t === 1 && this.half === 0 ? 1 : 0)) this.lines[t].push(0);
    this.phase = 'end';
    this.finished = true;
    this.events.push({ k: 'end' });
  }

  /** 勝ったチーム（-1 = 引き分け） */
  get winner(): number {
    return this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1;
  }

  /** 今、球がホームベースに来るまでのフレーム数と、来る場所（CPU と画面の予告に使う） */
  pitchInfo(): { left: number; x: number; y: number } {
    const p = this.pitchPos(this.pitchF);
    return { left: this.pitchF - this.pitchT, x: p.x, y: p.y };
  }
}

/** CPU の操作（ピッチャー・バッター） */
export class BBCpu {
  private rng: Rng;
  private plan = new Map<number, { wait: number; x: number; y: number; type: PitchKind; side: number; swing: boolean; at: number; ex: number; ey: number }>();
  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5bd1e995);
  }

  think(g: Baseball, slot: number): InputState {
    const p = g.setup.players.find((q) => q.slot === slot);
    if (!p) return { mx: 0, my: 0, buttons: 0 };
    const lv = Math.max(1, Math.min(9, p.level));
    // ピッチャー
    if (g.pitcher.slot === slot && g.phase === 'aim') {
      let pl = this.plan.get(slot);
      if (!pl || pl.at !== g.pa * 100 + g.balls * 10 + g.strikes + g.inning * 1000 + g.half * 500) {
        // コースを決める：ゾーンの中が多め。強いほど隅を狙う
        const inside = this.rng.chance(0.72);
        const edge = 0.4 + lv * 0.05;
        const x = inside ? this.rng.range(-BB.zone.x, BB.zone.x) * edge * 1.4 : this.rng.range(-0.5, 0.42);
        const y = inside ? this.rng.range(BB.zone.y1 + 0.05, BB.zone.y2 - 0.05) : this.rng.chance(0.5) ? BB.zone.y1 - 0.18 : BB.zone.y2 + 0.15;
        const type: PitchKind = this.rng.chance(0.45) ? 'straight' : PITCH_KINDS[1 + Math.floor(this.rng.next() * 4)];
        const side = 0;
        pl = { wait: 30 + Math.floor(this.rng.range(0, 70)), x, y, type, side, swing: false, at: g.pa * 100 + g.balls * 10 + g.strikes + g.inning * 1000 + g.half * 500, ex: 0, ey: 0 };
        this.plan.set(slot, pl);
      }
      // 狙いは「投げ出す向き」なので、球が来てほしい所から曲がるぶんを引く
      const sh = pitchShift(pl.type, bbStats(g.pitcher.charId).brk);
      // 狙える範囲の外なら、範囲の端で投げる（いつまでも投げないことがないように）
      const dx = clamp(pl.x - sh.x, -BB.aimX, BB.aimX) - g.aim.x;
      const dy = clamp(pl.y - sh.y, BB.aimY1, BB.aimY2) - g.aim.y;
      const mx = Math.abs(dx) > 0.02 ? Math.sign(dx) : 0;
      const my = Math.abs(dy) > 0.02 ? Math.sign(dy) : 0;
      if (--pl.wait <= 0 && !mx && !my) {
        // 球種を選んでから A で投げる
        g.choosePitch(slot, pl.type);
        return { mx: 0, my: 0, buttons: BTN_A };
      }
      return { mx, my, buttons: 0 };
    }
    // バッター
    if (g.batter.slot === slot && g.phase === 'pitch') {
      const info = g.pitchInfo();
      let pl = this.plan.get(slot);
      if (!pl || pl.at !== -g.frame + g.pitchT) {
        // 来るコースを読む（弱いほどずれる）。ゾーンの外はたまに振る
        const err = 0.04 + (10 - lv) * 0.025;
        const inZone = Math.abs(info.x) <= BB.zone.x + 0.04 && info.y >= BB.zone.y1 - 0.04 && info.y <= BB.zone.y2 + 0.04;
        // ゾーンの外は、外れるほど振らない（明らかなボール球はほとんど見送る）。振ってもねらいが甘い
        const out = zoneOut(info);
        const swing = inZone ? this.rng.chance(0.72 + lv * 0.02) : this.rng.chance(Math.max(0.01, (0.3 - lv * 0.02) * (1 - out / 0.16)));
        pl = { wait: 0, x: 0, y: 0, type: 'straight', side: 0, swing, at: -g.frame + g.pitchT, ex: this.rng.range(-err, err) * (inZone ? 1 : 2), ey: this.rng.range(-err, err) * (inZone ? 1 : 2) };
        pl.wait = Math.round(BB.swingDelay + this.rng.range(-1, 1) * (1 + (10 - lv) * 0.5));
        this.plan.set(slot, pl);
      }
      const tx = info.x + pl.ex;
      const ty = info.y + pl.ey + 0.02;
      const dx = tx - g.cursor.x;
      const dy = ty - g.cursor.y;
      const mx = clamp(dx / (BB.cursorMax * 1.5), -1, 1);
      const my = clamp(dy / (BB.cursorMax * 1.5), -1, 1);
      const swing = pl.swing && g.swingAt < 0 && info.left <= pl.wait;
      void pl.side;
      return { mx, my, buttons: swing ? BTN_A : 0 };
    }
    return { mx: 0, my: 0, buttons: 0 };
  }
}

/**
 * スティックで丸を動かす。小さく倒すとゆっくり（細かく合わせられる）、大きく倒すと速く。
 * 速さはすぐには変わらず、なめらかに加速・減速する
 */
function moveCursor(c: { x: number; y: number }, v: { x: number; y: number }, inp: InputState): void {
  const mag = Math.min(1, Math.hypot(inp.mx, inp.my));
  const k = mag <= BB.cursorDead ? 0 : (mag - BB.cursorDead) / (1 - BB.cursorDead);
  const sp = (k * k * 0.65 + k * 0.35) * BB.cursorMax;
  const tx = mag > 0 ? (inp.mx / mag) * sp : 0;
  const ty = mag > 0 ? (inp.my / mag) * sp : 0;
  v.x += (tx - v.x) * BB.cursorEase;
  v.y += (ty - v.y) * BB.cursorEase;
  const nx = clamp(c.x + v.x, -BB.aimX, BB.aimX);
  const ny = clamp(c.y + v.y, BB.aimY1, BB.aimY2);
  // 端に当たったら、その向きの速さは消す
  if (nx !== c.x + v.x) v.x = 0;
  if (ny !== c.y + v.y) v.y = 0;
  c.x = nx;
  c.y = ny;
}

/** 球種ごとの、ホームベースでの曲がる量（x, y）。brk = キャラの「変化」 */
export function pitchShift(kind: PitchKind, brk: number): { x: number; y: number } {
  const spec = PITCH_SPECS[kind];
  const b = BB.brk + (brk - 3) * BB.perBrk;
  return { x: spec.x * b, y: spec.y * b };
}
/** 球種ごとの速さ（1フレームに進む距離）。speed = キャラの「球の速さ」 */
export function pitchSpeedOf(kind: PitchKind, speed: number): number {
  return (BB.pitchSpeed + (speed - 3) * BB.perSpeed) * PITCH_SPECS[kind].speed;
}

/** 球速の表示（km/h）。実際の速さは遊びやすく遅めにしているので、見た目の数字に直す */
export function pitchKmh(speedPerFrame: number): number {
  return Math.round(60 + speedPerFrame * 300);
}

/** ストライクゾーンからどれだけ外れているか（メートル。中なら 0） */
export function zoneOut(p: { x: number; y: number }): number {
  const ox = Math.max(0, Math.abs(p.x) - BB.zone.x);
  const oy = Math.max(0, BB.zone.y1 - p.y, p.y - BB.zone.y2);
  return Math.hypot(ox, oy);
}
/** 球がバッター（右打ち。x のプラス側に立つ）の体に当たるか */
export function hitsBatter(p: { x: number; y: number }): boolean {
  return p.x >= BB.hbpX && p.y >= 0.15 && p.y <= 1.7;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

/** 結果の名前 */
export const BB_RESULT_NAMES: Record<BBResult, string> = {
  single: 'ヒット',
  double: 'ツーベース',
  triple: 'スリーベース',
  homer: 'ホームラン',
  walk: 'フォアボール',
  hbp: 'デッドボール',
  strikeout: '三振',
  groundout: 'ゴロアウト',
  flyout: 'フライアウト',
  lineout: 'ライナー',
};
