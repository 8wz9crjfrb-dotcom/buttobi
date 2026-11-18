// 新キャラの登場映像（約20秒）。ゲームの中でキャラを決まった入力で動かし、映画のような帯・ロゴ・字幕・カット割りで見せる。
// 試合の画面（％表示・タイマー・操作ボタン）は出さない。最後に名前とキャッチコピー、「さっそくCPU戦で使ってみる」「閉じる」

import { Sim, COUNTDOWN_FRAMES, type Fighter } from '../shared/sim';
import { BTN_B, type GameEvent, type InputState, type MatchSetup, type ViewState } from '../shared/types';
import type { GameRenderer } from './renderer';
import type { Sfx } from './audio';
import { threebDef } from '../shared/characters';

/** 登場映像の中身（キャラごと） */
export interface DebutDef {
  charId: string;
  /** お知らせの id のように、見たかどうかを覚えるための名前 */
  id: string;
  name: string;
  copy: string;
  stageId: string;
  /** 技の場面の字幕（B・横B・下B・上B の順） */
  moves: [string, string, string, string];
  /** 早着替えで見せる衣装（最後が UR） */
  costumes: { id: string; label: string }[];
  /** 最初の暗い画面の吹き出し */
  intro: string;
  /** 相手のキャラ（3B は仕事の番号も） */
  foe: { charId: string; job?: number };
}

export const DEBUTS: DebutDef[] = [
  {
    charId: 'menhera',
    id: 'debut-menhera',
    name: 'メンヘラ',
    copy: '既読がつくまで、離さない。',
    stageId: 'room',
    moves: ['B　赤い糸', '横B　鬼電', '下B　泣き落とし', '上B　ハート風船'],
    costumes: [
      { id: 'menhera-ryosan', label: 'SR　量産型' },
      { id: 'menhera-oshi', label: 'SR　推し活' },
      { id: 'menhera-tenshi', label: 'SSR　天使界隈' },
      { id: 'menhera-ur', label: 'UR　永遠の愛' },
    ],
    intro: '既読、まだ？',
    // 相手は 3B のバンドマン
    foe: { charId: 'threeb', job: 1 },
  },
];

const N: InputState = { mx: 0, my: 0, buttons: 0 };
const press = (mx: number, my: number): InputState => ({ mx, my, buttons: BTN_B });

/** 場面（開始と終わりの時刻は秒） */
interface Shot {
  t0: number;
  t1: number;
  /** 新しく試合を作り直すか（技の場面ごと） */
  fresh?: boolean;
  /** 位置を決める */
  init?: (me: Fighter, foe: Fighter) => void;
  /** f = 場面が始まってからのフレーム数 */
  input?: (f: number, me: Fighter, foe: Fighter) => [InputState, InputState];
  /** カメラ（u = 場面の中の進み 0〜1） */
  cam: (me: Fighter, foe: Fighter, u: number) => { x: number; y: number; z: number; lx: number; ly: number };
  caption?: string;
}

/** 映像の長さ（名前のカードが出きって、ボタンが出るまで） */
/** 時刻（秒）：技の場面（赤い糸は連撃まで見せるので長め）。そのあと衣装の早着替え、UR、名前のカード */
const MOVE0 = 4;
const MOVES = [3.8, 2.4, 2.8, 2.4];
const M = MOVES.map((_, i) => MOVE0 + MOVES.slice(0, i).reduce((a, b) => a + b, 0));
const T_COS = MOVE0 + MOVES.reduce((a, b) => a + b, 0);
const COS = 1.35;
const T_UR = T_COS + COS * 3;
const T_CARD = T_UR + 3;
const END = T_CARD + 2;

export class DebutSession {
  kind = 'demo' as const;
  mySlot = null;
  paused = false;
  private cryText = false;
  setup: MatchSetup;
  private sim: Sim;
  private t = 0;
  private acc = 0;
  private shotIndex = -1;
  private shotFrame = 0;
  private slowUntil = 0;
  private costumeStep = -1;
  private done = false;
  private shots: Shot[];
  private el: HTMLElement;
  private caption: HTMLElement;
  private black: HTMLElement;
  private flash: HTMLElement;
  private dip: HTMLElement;
  private vignette: HTMLElement;
  private card: HTMLElement;
  private sounds: number[] = [];

  constructor(
    private def: DebutDef,
    private renderer: GameRenderer,
    private sfx: Sfx,
    logoUrl: string,
    private onEnd: (action: 'cpu' | 'close') => void,
  ) {
    this.setup = {
      players: [
        { slot: 0, name: def.name, charId: def.charId, cpu: false, cpuLevel: 1 },
        { slot: 1, name: '相手', charId: def.foe.charId, cpu: false, cpuLevel: 1 },
      ],
      stageId: def.stageId,
      rules: { mode: 'stock', stocks: 99, timeLimit: 0 },
      seed: 7,
    };
    this.sim = this.newSim();
    this.shots = this.makeShots();
    // 画面の上に重ねる：映画の帯・ロゴ・字幕・暗転・フラッシュ・名前のカード・スキップ
    const el = document.createElement('div');
    el.id = 'debut';
    el.innerHTML = `
      <div class="db-bar top"></div><div class="db-bar bottom"></div>
      <div class="db-vignette"></div>
      <div class="db-black"><div class="db-phone"><i></i><span>${def.intro}</span></div></div>
      <div class="db-flash"></div>
      <div class="db-dip"></div>
      <div class="db-caption"></div>
      <img class="db-logo" src="${logoUrl}" alt="トバセ！" draggable="false"/>
      <button class="db-skip" type="button">スキップ ▶▶</button>
      <div class="db-card">
        <div class="db-new">新キャラクター登場！</div>
        <div class="db-name">${def.name}</div>
        <div class="db-copy">${def.copy}</div>
        <div class="db-btns"><button class="btn primary" data-act="cpu" type="button">さっそくCPU戦で使ってみる</button><button class="btn" data-act="close" type="button">閉じる</button></div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.caption = el.querySelector('.db-caption')!;
    this.black = el.querySelector('.db-black')!;
    this.flash = el.querySelector('.db-flash')!;
    this.dip = el.querySelector('.db-dip')!;
    this.vignette = el.querySelector('.db-vignette')!;
    this.card = el.querySelector('.db-card')!;
    el.querySelector('.db-skip')!.addEventListener('click', () => this.skip());
    el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => b.addEventListener('click', () => this.finish(b.dataset.act as 'cpu' | 'close')));
    // 最初の暗い画面で、通知音を何度か鳴らす
    for (const ms of [250, 800, 1300]) this.sounds.push(window.setTimeout(() => this.sfx.notify(), ms));
  }

  myFighter(): Fighter | null {
    return null;
  }

  private newSim(): Sim {
    const sim = new Sim(this.setup);
    while (sim.frame <= COUNTDOWN_FRAMES) sim.step(new Map());
    // 相手：3B なら仕事を切り替える。技が当たったときに大きめにふっとぶよう、ダメージを溜めておく
    const foe = sim.fighters[1];
    if (foe.def.id === 'threeb' && this.def.foe.job) {
      foe.job = this.def.foe.job;
      foe.def = threebDef(foe.job);
    }
    foe.damage = 85;
    return sim;
  }

  /** 場面の一覧（約20秒） */
  private makeShots(): Shot[] {
    const close = (me: Fighter, z: number, dy = 1.2) => ({ x: me.x, y: me.y + dy + 0.15, z, lx: me.x, ly: me.y + dy });
    const pair = (me: Fighter, foe: Fighter, z: number) => {
      // 相手が大きく吹っ飛んでも、カメラが追いかけすぎないようにする（吹っ飛んでいく様子を見せる）
      const fx = Math.max(me.x - 5, Math.min(me.x + 5, foe.x));
      const fy = Math.min(me.y + 2.5, Math.max(me.y - 1, foe.y));
      const cx = (me.x + fx) / 2;
      const cy = Math.max(me.y, fy) * 0.6 + Math.min(me.y, fy) * 0.4 + 1.1;
      return { x: cx, y: cy + 0.6, z, lx: cx, ly: cy };
    };
    const moves = this.def.moves;
    return [
      // 0〜2秒：暗い画面（スマホの光と吹き出し）。後ろでは本人が背を向けて立っている
      { t0: 0, t1: 2, fresh: true, init: (me, foe) => ((me.x = 0), (me.facing = -1), (foe.x = 8.6)), cam: (me) => close(me, 3.6, 1.25) },
      // 2〜4秒：明かりがつき、振り向いて顔のアップ
      {
        t0: 2,
        t1: 4,
        input: (f) => [f === 30 ? { mx: 1, my: 0, buttons: 0 } : N, N],
        cam: (me, _f, u) => close(me, 3.6 - u * 0.6, 1.3),
      },
      // 技を1つずつ
      {
        t0: M[0],
        t1: M[1],
        fresh: true,
        caption: moves[0],
        init: (me, foe) => ((me.x = -2.6), (me.facing = 1), (foe.x = 0.6), (foe.facing = -1)),
        // 糸でつなぐ → 逃げようとする相手を引き戻し、追いかけて連撃 → 糸が切れて、ためたダメージと反動で吹っ飛ぶ
        input: (f, me, foe) => {
          if (f === 8) return [press(0, 0), N];
          const run = f > 34 && f < 70 ? { mx: 1, my: 0, buttons: 0 } : N;
          // 連撃中は当たるたびにスローになるので、糸を切るのはフレーム数ではなく映像の時刻で決める
          const release = this.t >= M[1] - 1.1;
          if (f >= 46 && !release) {
            const dx = foe.x - me.x;
            if (Math.abs(dx) > 1.0) return [{ mx: Math.sign(dx), my: 0, buttons: 0 }, run];
            // 弱攻撃をくり返す（押しては離す）
            return [{ mx: 0, my: 0, buttons: f % 9 === 0 ? 1 : 0 }, run];
          }
          // 連撃のあと、糸を切って一気にダメージ（映像の長さに合わせる）
          if (release && foe.leashT > 1) foe.leashT = 1;
          return [N, run];
        },
        // 糸が切れたあとは、少し引いて上も映す（「+◯%」の文字が切れないように）
        cam: (me, foe, u) => {
          const c = pair(me, foe, 8.4 - u * 1.4);
          // 糸が切れる少し前から引き始めて、切れた瞬間にはもう引ききっておく
          if (this.t < M[1] - 1.4) return c;
          const k = Math.min(1, (this.t - (M[1] - 1.4)) / 0.3);
          return { ...c, y: c.y + k * 0.8, ly: c.ly + k * 0.9, z: c.z + k * 3.2 };
        },
      },
      {
        t0: M[1],
        t1: M[2],
        fresh: true,
        caption: moves[1],
        init: (me, foe) => ((me.x = -2.8), (me.facing = 1), (foe.x = 1.2), (foe.facing = -1)),
        input: (f, _me, foe) => {
          // 印が付いたら、映像の長さに合わせてすぐに爆発させる
          if (foe.callT > 40) foe.callT = 40;
          return [f === 6 ? press(1, 0) : N, N];
        },
        // 爆発で吹っ飛んでいく相手を、カメラは追わずに見送る
        cam: (me, _foe, u) => pair(me, { x: me.x + 4, y: me.y } as Fighter, 8.5 - u * 1.2),
      },
      {
        t0: M[2],
        t1: M[3],
        fresh: true,
        caption: moves[2],
        init: (me, foe) => ((me.x = -0.6), (me.facing = 1), (foe.x = 1.1), (foe.facing = -1)),
        // 泣いたあと、相手の頭の上の「攻撃力ダウン」の目印に寄って見せる
        input: (f, _me, foe) => {
          // 寄り始めたところで文字を出す（スローで止まっても映像の時刻に合わせる）
          if (!this.cryText && this.t >= M[2] + (M[3] - M[2]) * 0.4) {
            this.cryText = true;
            this.renderer.say('攻撃力ダウン！', '#8fd0ff', foe.x + 2.0, foe.y + 1.3, false, 120);
          }
          return [f === 8 ? press(0, -1) : N, N];
        },
        cam: (me, foe, u) => (u < 0.4 ? pair(me, foe, 6.5 - u * 0.8) : { x: foe.x + 0.6, y: foe.y + 2.0, z: 6.4, lx: foe.x + 0.6, ly: foe.y + 1.9 }),
      },
      {
        t0: M[3],
        t1: T_COS,
        fresh: true,
        caption: moves[3],
        init: (me, foe) => ((me.x = -2.5), (me.facing = 1), (foe.x = 8.6)),
        // 上昇したら、ふわふわ降りながら横へ流れる（ゆっくり落ちるのが分かるように）
        input: (f) => [f === 6 ? press(0, 1) : f > 30 ? { mx: 1, my: 0, buttons: 0 } : N, N],
        cam: (me, _f, u) => ({ x: me.x + 0.3, y: me.y + 1.2, z: 8 + u * 0.5, lx: me.x + 0.3, ly: me.y + 1.0 }),
      },
      // 衣装の早着替え（SR・SR・SSR）
      { t0: T_COS, t1: T_UR, fresh: true, init: (me, foe) => ((me.x = 0), (me.facing = 1), (foe.x = 8.6)), cam: (me, _f, u) => ({ ...close(me, 5.2 - u * 0.6, 1.0), x: me.x + Math.sin(u * 3) * 0.8 }) },
      // トリの UR。暗くして、ゆっくり寄る
      { t0: T_UR, t1: END + 60, cam: (me, _f, u) => ({ ...close(me, 5 - Math.min(1, u * 0.2) * 0.8, 1.05), x: me.x + Math.sin(u * 0.6) * 0.6 }) },
    ];
  }

  frame(dt: number): { view: ViewState | null; events: GameEvent[] } {
    if (this.paused) return { view: this.sim.toView(), events: [] };
    this.t += dt;
    const t = this.t;
    // 場面を切り替える
    const idx = this.shots.findIndex((s) => t >= s.t0 && t < s.t1);
    const events: GameEvent[] = [];
    if (idx >= 0 && idx !== this.shotIndex) {
      const s = this.shots[idx];
      this.shotIndex = idx;
      this.shotFrame = 0;
      if (s.fresh) {
        this.sim = this.newSim();
        const [me, foe] = this.sim.fighters;
        s.init?.(me, foe);
        if (idx > 1) this.cut();
      }
      this.setCaption(s.caption ?? '');
    }
    this.updateCostumes(t);
    this.updateOverlay(t);
    // 試合を進める（技が当たった瞬間は少しスロー）
    const shot = this.shots[Math.max(0, this.shotIndex)];
    const slow = t < this.slowUntil ? 0.35 : 1;
    this.acc += dt * 60 * slow;
    const [me, foe] = this.sim.fighters;
    while (this.acc >= 1) {
      this.acc -= 1;
      // 映像の中では病みモードにしない（紫の光と輪が出て、衣装の見せ場の邪魔になるため）
      me.lonely = 0;
      const [a, b] = shot.input?.(this.shotFrame, me, foe) ?? [N, N];
      this.sim.step(new Map([[0, a], [1, b]]));
      this.shotFrame++;
      for (const e of this.sim.events) {
        events.push(e);
        if (e.k === 'hit' || e.k === 'ring' || e.k === 'cry' || e.k === 'leashDmg') this.slowUntil = t + (e.k === 'leashDmg' ? 0.45 : 0.3);
        // 当たった音・着信音（映像なので、試合の効果音の代わりにここで鳴らす）
        if (e.k === 'hit') this.sfx.hit(Math.min(20, e.p));
        if (e.k === 'ring') this.sfx.notify();
      }
    }
    const u = Math.min(1, (t - shot.t0) / Math.max(0.1, shot.t1 - shot.t0));
    this.renderer.cinema = shot.cam(me, foe, Math.max(0, u));
    return { view: this.sim.toView(), events: events.filter((e) => e.k !== 'finish' && e.k !== 'ko') };
  }

  /** 早着替え：SR・SR・SSR のあと UR（白いフラッシュでつなぐ） */
  private updateCostumes(t: number): void {
    const times = [T_COS, T_COS + COS, T_COS + COS * 2, T_UR];
    let step = -1;
    times.forEach((tt, i) => {
      if (t >= tt) step = i;
    });
    if (step !== this.costumeStep && step >= 0) {
      this.costumeStep = step;
      const c = this.def.costumes[step];
      if (!c) return;
      this.renderer.setCostume(0, c.id);
      this.whiteFlash(step === 3 ? 0.5 : 0.25);
      // 着替えの音：きらっとした音（UR はガチャの当たりの音）
      if (step === 3) this.sfx.gachaOpen(5);
      else this.sfx.heal();
      this.setCaption(c.label, step === 3);
      if (step === 3) {
        // UR：勝ちポーズ（ハート）で、まわりを暗くする
        this.renderer.celebrate(0);
      }
    }
  }

  /** 暗転・暗いふち・名前のカード */
  private updateOverlay(t: number): void {
    // 最初の2秒は暗い画面。2〜2.5秒で明るくなる
    this.black.style.opacity = t < 2 ? '1' : t < 2.5 ? String(1 - (t - 2) / 0.5) : '0';
    // UR の場面はまわりを暗く
    this.vignette.style.opacity = t >= T_UR ? String(Math.min(0.75, (t - T_UR) * 1.5)) : '0';
    if (t >= T_CARD && !this.card.classList.contains('on')) {
      this.card.classList.add('on');
      this.setCaption('');
      this.sfx.jingle(this.def.charId);
    }
    if (t >= END && !this.card.classList.contains('btns')) {
      this.card.classList.add('btns');
      // ボタンが出たら、スキップは消す
      this.el.querySelector<HTMLElement>('.db-skip')!.style.display = 'none';
    }
  }

  private cut(): void {
    // 技の場面のつなぎ目：一瞬だけ暗くして、なめらかに切り替える（音は鳴らさない）
    this.dip.style.transition = 'none';
    this.dip.style.opacity = '0.85';
    void this.dip.offsetWidth;
    this.dip.style.transition = 'opacity 0.35s ease-out';
    this.dip.style.opacity = '0';
  }

  private whiteFlash(sec: number): void {
    this.flash.style.transition = 'none';
    this.flash.style.opacity = '0.9';
    void this.flash.offsetWidth;
    this.flash.style.transition = `opacity ${sec}s ease-out`;
    this.flash.style.opacity = '0';
  }

  private setCaption(text: string, gold = false): void {
    if (this.caption.textContent === text) return;
    this.caption.classList.remove('on');
    void this.caption.offsetWidth;
    this.caption.textContent = text;
    this.caption.classList.toggle('gold', gold);
    if (text) this.caption.classList.add('on');
  }

  /** スキップ：名前のカードまで飛ばす */
  private skip(): void {
    if (this.t < T_CARD) {
      this.t = T_CARD;
      this.shotIndex = -1;
      // 本人だけが立っている場面にする
      this.sim = this.newSim();
      const [me, foe] = this.sim.fighters;
      me.x = 0;
      me.facing = 1;
      foe.x = 8.6;
      if (this.costumeStep < 3) {
        this.costumeStep = 2;
        this.updateCostumes(T_UR);
      }
      this.black.style.opacity = '0';
    }
    this.t = Math.max(this.t, END);
  }

  private finish(action: 'cpu' | 'close'): void {
    if (this.done) return;
    this.done = true;
    for (const id of this.sounds) clearTimeout(id);
    this.renderer.cinema = null;
    this.el.remove();
    this.onEnd(action);
  }
}
