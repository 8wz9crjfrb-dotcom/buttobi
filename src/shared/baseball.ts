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
  aimY1: 0.12,
  aimY2: 1.55,
  /** 球の速さ（1フレームに進む距離。速さ3のとき）と、1段階ごとの差。変化球は少し遅い */
  pitchSpeed: 0.3,
  perSpeed: 0.025,
  breakSlow: 0.84,
  /** 変化球の曲がる量（ホームベースでのずれ。曲がり3のとき）と、1段階ごとの差 */
  brk: 0.32,
  perBrk: 0.06,
  /** コントロールのぶれ（コントロール3のとき）と、1段階ごとの差 */
  wild: 0.07,
  perControl: 0.016,
  /** 狙い・ミートの丸を動かす速さ（1フレーム） */
  cursorSpeed: 0.024,
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
  fenceLine: 72,
  fenceCenter: 86,
  /** ファウルになる角度（度） */
  foulDeg: 45,
  /** 1イニングの打席の数（チームごと） */
  paPerHalf: 3,
  /** 間の時間（フレーム） */
  readyT: 50,
  aimMax: 6 * 60,
  callT: 55,
  resultT: 110,
  changeT: 110,
};

export type BBPhase = 'ready' | 'aim' | 'pitch' | 'call' | 'hit' | 'result' | 'change' | 'end';
export type BBResult = 'single' | 'double' | 'triple' | 'homer' | 'walk' | 'strikeout' | 'groundout' | 'flyout' | 'lineout';
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
  | { k: 'pitch'; type: 'straight' | 'breaking' }
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
  /** 投げた球：最初の位置・速さ・曲がり（1フレームあたり）と、ホームベースに着くまでのフレーム数 */
  private p0: Vec = { x: 0, y: BB.releaseY, z: BB.releaseZ };
  private v0: Vec = { x: 0, y: 0, z: 0 };
  private acc: Vec = { x: 0, y: 0, z: 0 };
  pitchT = 0;
  pitchF = 60;
  pitchType: 'straight' | 'breaking' = 'straight';
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
    return {
      x: this.p0.x + this.v0.x * t + 0.5 * this.acc.x * t * t,
      y: this.p0.y + this.v0.y * t + 0.5 * this.acc.y * t * t,
      z: this.p0.z + this.v0.z * t + 0.5 * this.acc.z * t * t,
    };
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
    if (this.phase === 'ready' || this.phase === 'aim' || (this.phase === 'pitch' && this.swingAt < 0)) {
      this.cursor.x = clamp(this.cursor.x + bi.mx * BB.cursorSpeed, -BB.aimX, BB.aimX);
      this.cursor.y = clamp(this.cursor.y + bi.my * BB.cursorSpeed, BB.aimY1, BB.aimY2);
    }
    switch (this.phase) {
      case 'ready':
        if (--this.timer <= 0) {
          this.phase = 'aim';
          this.timer = BB.aimMax;
          this.aim = { x: 0, y: 0.8 };
        }
        break;
      case 'aim': {
        // ピッチャー：狙いを動かし、A でストレート、B で変化球（押したときのスティックの向きで曲がる向き。真ん中なら落ちる球）
        this.aim.x = clamp(this.aim.x + pi.mx * BB.cursorSpeed, -BB.aimX, BB.aimX);
        this.aim.y = clamp(this.aim.y + pi.my * BB.cursorSpeed, BB.aimY1, BB.aimY2);
        const a = this.pressed(pit.slot, pi, BTN_A);
        const b = this.pressed(pit.slot, pi, BTN_B);
        if (a || b || --this.timer <= 0) this.throwPitch(b ? 'breaking' : 'straight', b ? Math.sign(Math.abs(pi.mx) > 0.4 ? pi.mx : 0) : 0, sp);
        break;
      }
      case 'pitch': {
        this.pitchT++;
        if (this.swingAt < 0 && this.pressed(bat.slot, bi, BTN_A)) {
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

  private throwPitch(type: 'straight' | 'breaking', side: number, s: BBStats): void {
    this.pitchType = type;
    const speed = (BB.pitchSpeed + (s.speed - 3) * BB.perSpeed) * (type === 'breaking' ? BB.breakSlow : 1);
    const F = Math.round(BB.releaseZ / speed);
    // 狙いから、コントロールのぶんだけぶれる
    const wild = Math.max(0.02, BB.wild - (s.control - 3) * BB.perControl);
    const ang = this.rng.next() * Math.PI * 2;
    const r = wild * Math.sqrt(this.rng.next());
    const tx = this.aim.x + Math.cos(ang) * r;
    const ty = this.aim.y + Math.sin(ang) * r;
    // 変化球：ホームベースで、横（スライダー）か下（落ちる球）へ brk だけずれる（狙いは曲がったあとの場所）
    const b = type === 'breaking' ? BB.brk + (s.brk - 3) * BB.perBrk : 0;
    const shift = { x: side * b, y: side === 0 ? -b : -b * 0.25 };
    this.acc = { x: (2 * shift.x) / (F * F), y: (2 * shift.y) / (F * F), z: 0 };
    this.p0 = { x: 0, y: BB.releaseY, z: BB.releaseZ };
    this.v0 = {
      x: (tx - this.p0.x - 0.5 * this.acc.x * F * F) / F,
      y: (ty - this.p0.y - 0.5 * this.acc.y * F * F) / F,
      z: -BB.releaseZ / F,
    };
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
    if (this.swingAt < 0) {
      this.setCall(inZone ? 'strike' : 'ball');
      return;
    }
    const diff = this.swingAt + BB.swingDelay - this.pitchF; // マイナス = 早い
    const r = BB.meetR + (s.meet - 3) * BB.perMeet;
    const d = Math.hypot(this.cursor.x - p.x, this.cursor.y - p.y);
    if (Math.abs(diff) > BB.timingWin || d > r) {
      this.setCall('whiff');
      return;
    }
    // 当たった：当たりの良さ（丸の真ん中に近く、タイミングが合うほど良い）
    const q = Math.pow(1 - d / r, 0.6) * (1 - Math.pow(Math.abs(diff) / BB.timingWin, 2));
    const speed = (BB.exitBase + BB.exitRange * q) * (1 + (s.power - 3) * BB.perPower);
    // 丸が球より上 = 球の上をたたく（ゴロ）、下 = 下をすくう（フライ）
    const dy = (this.cursor.y - p.y) / r;
    const launch = clamp(16 - dy * 38 + (this.rng.next() - 0.5) * 8, -12, 62);
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
    if (!foul && dist >= fence && b.y > 2.5) {
      this.finishAtBat('homer');
      return;
    }
    if (b.y <= 0 || this.timer > 400) {
      b.y = 0;
      b.landed = true;
      if (foul) {
        this.setCall('foul');
        return;
      }
      this.finishAtBat(this.outcome(dist, b.launch, b.speed));
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
    else if (r === 'walk') {
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
  private plan = new Map<number, { wait: number; x: number; y: number; type: 'straight' | 'breaking'; side: number; swing: boolean; at: number; ex: number; ey: number }>();
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
        const x = inside ? this.rng.range(-BB.zone.x, BB.zone.x) * edge * 1.4 : this.rng.range(-0.5, 0.5);
        const y = inside ? this.rng.range(BB.zone.y1 + 0.05, BB.zone.y2 - 0.05) : this.rng.chance(0.5) ? BB.zone.y1 - 0.18 : BB.zone.y2 + 0.15;
        const type = this.rng.chance(0.4) ? 'breaking' : 'straight';
        const side = type === 'breaking' ? [-1, 0, 1][Math.floor(this.rng.next() * 3)] : 0;
        pl = { wait: 30 + Math.floor(this.rng.range(0, 70)), x, y, type, side, swing: false, at: g.pa * 100 + g.balls * 10 + g.strikes + g.inning * 1000 + g.half * 500, ex: 0, ey: 0 };
        this.plan.set(slot, pl);
      }
      const dx = pl.x - g.aim.x;
      const dy = pl.y - g.aim.y;
      const mx = Math.abs(dx) > 0.02 ? Math.sign(dx) : 0;
      const my = Math.abs(dy) > 0.02 ? Math.sign(dy) : 0;
      if (--pl.wait <= 0 && !mx && !my) {
        // 変化球は、曲がる向きにスティックを倒して B
        return pl.type === 'breaking' ? { mx: pl.side, my: 0, buttons: BTN_B } : { mx: 0, my: 0, buttons: BTN_A };
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
        const swing = inZone ? this.rng.chance(0.72 + lv * 0.02) : this.rng.chance(0.3 - lv * 0.02);
        pl = { wait: 0, x: 0, y: 0, type: 'straight', side: 0, swing, at: -g.frame + g.pitchT, ex: this.rng.range(-err, err), ey: this.rng.range(-err, err) };
        pl.wait = Math.round(BB.swingDelay + this.rng.range(-1, 1) * (1 + (10 - lv) * 0.5));
        this.plan.set(slot, pl);
      }
      const tx = info.x + pl.ex;
      const ty = info.y + pl.ey + 0.02;
      const dx = tx - g.cursor.x;
      const dy = ty - g.cursor.y;
      const mx = clamp(dx / BB.cursorSpeed, -1, 1);
      const my = clamp(dy / BB.cursorSpeed, -1, 1);
      const swing = pl.swing && g.swingAt < 0 && info.left <= pl.wait;
      return { mx, my, buttons: swing ? BTN_A : 0 };
    }
    return { mx: 0, my: 0, buttons: 0 };
  }
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
  strikeout: '三振',
  groundout: 'ゴロアウト',
  flyout: 'フライアウト',
  lineout: 'ライナー',
};
