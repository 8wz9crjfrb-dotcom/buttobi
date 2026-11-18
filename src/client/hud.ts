// 対戦中の表示（ダメージ%・残機・タイマー・カウントダウン）

import { BOUNTY } from '../shared/moves';
import { areaColor, ballTeamOf, getCharacter, playerColor, TEAM_COLORS, TEAM_NAMES } from '../shared/characters';
import { COUNTDOWN_FRAMES } from '../shared/sim';
import { clashMark } from './icons';
import { buffSvg } from './buffIcons';
import { DEFAULT_HP, isTwoTeam, FX_ARMOR, FX_ATK_DOWN, FX_ATK_UP, FX_SPD_DOWN, FX_SPD_UP, type GameEvent, type MatchSetup, type ViewState } from '../shared/types';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  private el: HTMLElement;
  private panels = new Map<number, { root: HTMLElement; dmg: HTMLElement; stk: HTMLElement; last: number; job: HTMLElement; fitted: boolean; buffs: HTMLElement; lastBuffs: string; shown: number; t: number }>();
  private timer: HTMLElement;
  private center: HTMLElement;
  private net: HTMLElement;
  private lastCenter = '';
  private stockMode = true;
  /** 体力制：残りHPを出す */
  private hp = 0;
  /** 100人組手：倒す人数 */
  private horde = 0;
  /** エリアバトル：タイマーの下のゲージ（番号ごと）と、エリアが移る予告 */
  private area: { setup: MatchSetup; teams: boolean; bars: Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>; box: HTMLElement; notice: HTMLElement; last: string } | null = null;

  /** 練習モード：残機とタイマーを出さない */
  private training = false;
  /** 時間制限なし（タイマーは経過時間を数える） */
  private noLimit = false;
  /** 玉入れ：タイマーの下の点数 */
  private ball: { root: HTMLElement; red: HTMLElement; blue: HTMLElement; last: string } | null = null;
  /** 王冠うばい：人（チーム）ごとの持っていた時間のゲージ */
  private crownHud: { bars: Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>; notice: HTMLElement; names: Map<number, string>; teams: boolean; teamOf: Map<number, number>; last: string } | null = null;
  /** 賞金首・コイン集め：人（チーム）ごとの点・枚数 */
  private scoreHud: { mode: 'bounty' | 'coins'; bars: Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>; notice: HTMLElement; names: Map<number, string>; teams: boolean; teamOf: Map<number, number>; last: string; lastNotice: string } | null = null;
  /** 金庫まもり：赤・青の金庫の耐久 */
  private vaultHud: { fills: HTMLElement[]; nums: HTMLElement[] } | null = null;
  /** 自分の枠に出す、必殺技の待ち時間（B・横B・下B・上B） */
  private cdRow: { root: HTMLElement; bars: HTMLElement[] } | null = null;
  private lastCd = '';

  constructor() {
    this.el = document.getElementById('hud')!;
    this.timer = document.createElement('div');
    this.center = document.createElement('div');
    this.net = document.createElement('div');
  }

  setup(setup: MatchSetup, myslot: number | null, training = false, portraits: Record<number, string> = {}): void {
    this.training = training;
    this.noLimit = setup.rules.timeLimit <= 0;
    this.el.innerHTML = '';
    this.panels.clear();
    this.offscreen.clear();
    this.portraits = portraits;
    this.colors = Object.fromEntries(setup.players.map((p) => [p.slot, hex(playerColor(setup, p.slot))]));
    this.cdRow = null;
    this.lastCd = '';
    this.stockMode = setup.rules.mode !== 'time' && setup.rules.mode !== 'area';
    this.hp = setup.rules.mode === 'stamina' ? setup.rules.hp ?? DEFAULT_HP : 0;
    this.horde = setup.rules.horde ?? 0;
    const wrap = document.createElement('div');
    wrap.className = 'hud-players';
    // 100人組手は自分の表示だけ
    const shown = this.horde ? setup.players.slice(0, 1) : setup.players;
    // 6人（5人以上）のときは枠を少し小さくして、右下のボタンと重ならないようにする
    wrap.classList.toggle('many', shown.length >= 5);
    for (const p of shown) {
      // 上から：職業名（キャラ名）・ダメージ%・残機・プレイヤー名の帯（プレイヤーの色。チーム戦はチームの色）
      const root = document.createElement('div');
      root.className = 'hud-p';
      if (myslot === p.slot) root.classList.add('me');
      const color = hex(playerColor(setup, p.slot));
      root.style.color = color;
      root.style.setProperty('--pc', color);
      const job = document.createElement('div');
      job.className = 'job';
      const jobText = document.createElement('span');
      jobText.textContent = getCharacter(p.charId).name;
      job.appendChild(jobText);
      const dmg = document.createElement('div');
      dmg.className = 'dmg';
      const stk = document.createElement('div');
      stk.className = 'stk';
      const nm = document.createElement('div');
      nm.className = 'pnm';
      const team = isTwoTeam(setup.rules.mode) ? `${TEAM_NAMES[ballTeamOf(setup, p.slot)]}・` : setup.rules.teams ? `${TEAM_NAMES[(p.team ?? 0) % TEAM_NAMES.length]}・` : '';
      nm.textContent = `${team}${p.name}`;
      if (portraits[p.slot]) {
        const face = document.createElement('img');
        face.className = 'face';
        face.src = portraits[p.slot];
        face.alt = '';
        root.appendChild(face);
      }
      // アイテムなどの効果中のしるし（スピードアップ・無敵）
      const buffs = document.createElement('div');
      buffs.className = 'buffs';
      root.append(job, dmg, stk, nm, buffs);
      if (myslot === p.slot) {
        // 必殺技の待ち時間（タッチのボタンを使わないとき）
        const row = document.createElement('div');
        row.className = 'cdrow';
        const bars = ['B', '横', '下', '上'].map((t) => {
          const c = document.createElement('span');
          c.innerHTML = `<i></i><b>${t}</b>`;
          row.appendChild(c);
          return c;
        });
        root.appendChild(row);
        this.cdRow = { root: row, bars };
      }
      wrap.appendChild(root);
      this.panels.set(p.slot, { root, dmg, stk, last: -1, job, fitted: false, buffs, lastBuffs: '', shown: -1, t: performance.now() });
    }
    this.timer.className = 'hud-timer';
    this.center.className = 'hud-center';
    this.net.className = 'hud-net';
    this.el.append(wrap, this.timer, this.center, this.net);
    this.lastCenter = '';
    this.area = null;
    this.ball = null;
    this.crownHud = null;
    this.scoreHud = null;
    this.vaultHud = null;
    if (setup.rules.mode === 'bounty' || setup.rules.mode === 'coins') {
      // タイマーの下に、点（枚数）を横に並べる（チーム戦はチームごと、個人戦は人ごと）
      const box = document.createElement('div');
      box.className = 'hud-area';
      const keys = setup.rules.teams ? [...new Set(setup.players.map((p) => p.team ?? 0))].sort((a, b) => a - b) : setup.players.map((p) => p.slot);
      const bars = new Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>();
      for (const k of keys) {
        const root = document.createElement('div');
        root.className = 'ab';
        root.style.setProperty('--ac', hex(areaColor(setup, k)));
        const fill = document.createElement('i');
        const num = document.createElement('b');
        num.textContent = '0';
        root.append(fill, num);
        box.appendChild(root);
        bars.set(k, { root, fill, num });
      }
      box.classList.toggle('many', keys.length >= 5);
      const notice = document.createElement('div');
      notice.className = 'hud-area-notice crown';
      this.el.append(box, notice);
      const names = new Map(setup.players.map((p) => [p.slot, p.name] as [number, string]));
      const teamOf = new Map(setup.players.map((p) => [p.slot, p.team ?? 0] as [number, number]));
      this.scoreHud = { mode: setup.rules.mode, bars, notice, names, teams: !!setup.rules.teams, teamOf, last: '', lastNotice: '' };
    }
    if (setup.rules.mode === 'crown') {
      // タイマーの下に、持っていた時間のゲージを横に並べる（チーム戦はチームごと、個人戦は人ごと）
      const box = document.createElement('div');
      box.className = 'hud-area';
      const keys = setup.rules.teams ? [...new Set(setup.players.map((p) => p.team ?? 0))].sort((a, b) => a - b) : setup.players.map((p) => p.slot);
      const bars = new Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>();
      for (const k of keys) {
        const root = document.createElement('div');
        root.className = 'ab';
        root.style.setProperty('--ac', hex(areaColor(setup, k)));
        const fill = document.createElement('i');
        const num = document.createElement('b');
        num.textContent = '0';
        root.append(fill, num);
        box.appendChild(root);
        bars.set(k, { root, fill, num });
      }
      box.classList.toggle('many', keys.length >= 5);
      const notice = document.createElement('div');
      notice.className = 'hud-area-notice crown';
      this.el.append(box, notice);
      const names = new Map(setup.players.map((p) => [p.slot, p.name] as [number, string]));
      const teamOf = new Map(setup.players.map((p) => [p.slot, p.team ?? 0] as [number, number]));
      this.crownHud = { bars, notice, names, teams: !!setup.rules.teams, teamOf, last: '' };
    }
    if (setup.rules.mode === 'vault') {
      // タイマーの下に、赤と青の金庫の耐久
      const box = document.createElement('div');
      box.className = 'hud-vault';
      box.innerHTML = [0, 1]
        .map((t) => `<div class="vb" style="--ac:${hex(TEAM_COLORS[t])}"><small>${TEAM_NAMES[t]}の金庫</small><div class="bar"><i></i><b>100.0%</b></div></div>`)
        .join('');
      this.el.appendChild(box);
      this.vaultHud = { fills: [...box.querySelectorAll<HTMLElement>('.bar i')], nums: [...box.querySelectorAll<HTMLElement>('.bar b')] };
    }
    if (setup.rules.mode === 'ball') {
      // タイマーの下に「赤 0 - 0 青」と先取点
      const root = document.createElement('div');
      root.className = 'hud-ball';
      root.innerHTML = `<b class="r" style="--tc:${hex(TEAM_COLORS[0])}">0</b><span>-</span><b class="b" style="--tc:${hex(TEAM_COLORS[1])}">0</b><small>${setup.rules.goals ?? 5}点先取</small>`;
      this.el.appendChild(root);
      this.ball = { root, red: root.querySelector('.r')!, blue: root.querySelector('.b')!, last: '' };
    }
    if (setup.rules.mode === 'area') {
      // タイマーの下に、ゲージを横に並べる（チーム戦はチームごと、個人戦は人ごと）
      const box = document.createElement('div');
      box.className = 'hud-area';
      const keys = setup.rules.teams ? [...new Set(setup.players.map((p) => p.team ?? 0))].sort((a, b) => a - b) : setup.players.map((p) => p.slot);
      const bars = new Map<number, { root: HTMLElement; fill: HTMLElement; num: HTMLElement }>();
      for (const k of keys) {
        const root = document.createElement('div');
        root.className = 'ab';
        root.style.setProperty('--ac', hex(areaColor(setup, k)));
        const fill = document.createElement('i');
        const num = document.createElement('b');
        num.textContent = '0';
        root.append(fill, num);
        box.appendChild(root);
        bars.set(k, { root, fill, num });
      }
      box.classList.toggle('many', keys.length >= 5);
      const notice = document.createElement('div');
      notice.className = 'hud-area-notice';
      this.el.append(box, notice);
      this.area = { setup, teams: !!setup.rules.teams, bars, box, notice, last: '' };
    }
  }

  /** 王冠うばい：持っていた時間（秒）と、だれが持っているか */
  private updateCrown(v: ViewState): void {
    const c = this.crownHud;
    if (!c || !v.crown) return;
    const holderKey = v.crown.holder < 0 ? null : c.teams ? c.teamOf.get(v.crown.holder) ?? null : v.crown.holder;
    const pts = new Map(v.crown.pts);
    for (const [k, bar] of c.bars) {
      const val = pts.get(k) ?? 0;
      bar.fill.style.width = `${Math.min(100, (val / v.crown.goal) * 100)}%`;
      bar.num.textContent = `${Math.floor(val / 60)}`;
      bar.root.classList.toggle('on', k === holderKey);
    }
    const name = v.crown.holder >= 0 ? c.names.get(v.crown.holder) ?? '' : '';
    // はじめは最初に相手を倒した人のもの。持っている人が自分で落ちたら、中央に出てくる
    const msg = v.ended ? '' : name ? `王冠：${name}` : v.crown.on ? '王冠を拾え！' : pts.size === 0 ? '最初に相手を倒した人が王冠ゲット！' : 'まもなく中央に王冠が出現！';
    if (msg !== c.last) {
      c.notice.textContent = msg;
      c.last = msg;
    }
  }

  /** 賞金首・コイン集め：点（枚数）のゲージと、賞金首の名前 */
  private updateScore(v: ViewState): void {
    const s = this.scoreHud;
    if (!s) return;
    const list = s.mode === 'bounty' ? v.bounty?.pts : v.coins?.held;
    if (!list) return;
    const sum = new Map<number, number>();
    for (const [slot, n] of list) {
      const k = s.teams ? s.teamOf.get(slot) ?? 0 : slot;
      sum.set(k, (sum.get(k) ?? 0) + n);
    }
    const holder = s.mode === 'bounty' ? v.bounty!.holder : -1;
    const holderKey = holder < 0 ? null : s.teams ? s.teamOf.get(holder) ?? null : holder;
    const key = [...sum].join(',') + '|' + holder;
    if (key !== s.last) {
      s.last = key;
      // ゲージは一番多い人（チーム）を満タンにした割合
      const top = Math.max(1, ...sum.values());
      for (const [k, bar] of s.bars) {
        const val = sum.get(k) ?? 0;
        bar.fill.style.width = `${(val / top) * 100}%`;
        bar.num.textContent = `${val}`;
        bar.root.classList.toggle('on', k === holderKey);
      }
    }
    const name = holder >= 0 ? s.names.get(holder) ?? '' : '';
    const msg = v.ended || s.mode !== 'bounty' ? '' : name ? `賞金首：${name}（倒すと+${BOUNTY.ko + BOUNTY.bonus}点）` : '撃墜で1点。1位は賞金首に！';
    if (msg !== s.lastNotice) {
      s.notice.textContent = msg;
      s.lastNotice = msg;
    }
  }

  /** 金庫まもり：赤と青の金庫の耐久 */
  private updateVault(v: ViewState): void {
    const h = this.vaultHud;
    if (!h || !v.vault) return;
    v.vault.hp.forEach((hp, t) => {
      // 引き分けになりにくいよう、小数第1位まで出す（0 になるまでは 0.0% と出さない）
      const pct = hp <= 0 ? 0 : Math.max(0.1, Math.ceil((hp / v.vault!.max) * 1000) / 10);
      h.fills[t].style.width = `${pct}%`;
      h.nums[t].textContent = `${pct.toFixed(1)}%`;
    });
  }

  /** エリアバトル：ゲージとエリアの予告 */
  private updateArea(v: ViewState): void {
    const a = this.area;
    if (!a || !v.area) return;
    const holders = new Set(v.area.zones.map((z) => z.holder));
    for (const [k, val] of v.area.gauges) {
      const bar = a.bars.get(k);
      if (!bar) continue;
      const pct = Math.min(100, Math.floor((val / v.area.goal) * 100));
      bar.fill.style.width = `${pct}%`;
      bar.num.textContent = `${pct}`;
      // エリアを取っている人（チーム）のゲージは光らせる
      bar.root.classList.toggle('on', holders.has(k));
    }
    // 取り合い中・エリアの移動の予告
    const contested = holders.has(-2);
    const sec = Math.ceil(v.area.nextIn / 60);
    const msg = v.ended ? '' : v.area.next.length ? `エリア移動まで ${sec}` : contested ? '取り合い中（カウント停止）' : '';
    if (msg !== a.last) {
      // 取り合い中は、オリジナルの「ぶつかる矢印」の印を付ける
      if (contested && !v.area.next.length && msg) a.notice.innerHTML = `${clashMark()}${msg}`;
      else a.notice.textContent = msg;
      a.notice.className = `hud-area-notice ${v.area.next.length ? 'move' : contested ? 'fight' : ''}`;
      a.last = msg;
    }
  }

  update(v: ViewState, events: GameEvent[]): void {
    for (const f of v.fighters) {
      const p = this.panels.get(f.slot);
      if (!p) continue;
      // 長い職業名は、枠に収まるよう横に縮める（省略しない）。表示されてから一度だけ測る
      if (!p.fitted && p.job.clientWidth > 0) {
        p.fitted = true;
        let size = 9;
        while (size > 6.5 && p.job.scrollWidth > p.job.clientWidth) {
          size -= 0.25;
          p.job.style.fontSize = `${size}px`;
        }
        // それでも収まらなければ、文字の横幅を詰める
        const span = p.job.firstElementChild as HTMLElement | null;
        if (span && span.offsetWidth > 0) {
          const room = p.job.clientWidth - parseFloat(getComputedStyle(p.job).paddingLeft);
          if (span.offsetWidth > room) span.style.transform = `scaleX(${(room / span.offsetWidth).toFixed(3)})`;
        }
      }
      const target = this.hp ? Math.max(0, Math.ceil(this.hp - f.damage)) : Math.floor(f.damage);
      // 数字は一気に変えず、数えるように近づける（大きく増えたときは枠を弾ませる）
      const now = performance.now();
      // 重い端末で1コマが長くても、一気に変わらないよう上限をつける
      const dt = Math.min(0.04, (now - p.t) / 1000);
      p.t = now;
      if (p.shown < 0 || target < p.shown - 30 || (this.hp && target > p.shown)) p.shown = target;
      else if (target !== p.shown) {
        const jump = Math.abs(target - p.shown);
        if (jump >= 8 && p.last === Math.round(p.shown)) {
          p.dmg.classList.remove('bump');
          void p.dmg.offsetWidth;
          p.dmg.classList.add('bump');
        }
        const step = Math.max(1, jump * Math.min(1, dt * 12));
        p.shown = target > p.shown ? Math.min(target, p.shown + step) : Math.max(target, p.shown - step);
      }
      const d = Math.round(p.shown);
      if (d !== p.last) {
        // 体力制は残りHP（減るほど赤く）、ふつうはダメージ%（増えるほど赤く）
        p.dmg.innerHTML = this.hp ? `${d}<small>HP</small>` : `${d}<small>%</small>`;
        const heat = this.hp ? 1 - d / this.hp : Math.min(1, d / 150);
        p.dmg.style.color = `rgb(255, ${Math.round(255 - heat * 170)}, ${Math.round(255 - heat * 230)})`;
        p.last = d;
      }
      p.stk.textContent = this.training || this.area ? '' : this.stockMode ? '●'.repeat(Math.max(0, f.stocks)) : `${f.kos - f.falls >= 0 ? '+' : ''}${f.kos - f.falls}`;
      p.root.classList.toggle('out', f.out);
      // 効果中のしるし（復活直後の無敵は出さない）
      // 攻撃力・スピードの上がり下がりは、剣・ブーツの目印に↑↓
      const b = `${f.fx & FX_ATK_UP ? buffSvg('atk', true) : ''}${f.fx & FX_ATK_DOWN ? buffSvg('atk', false) : ''}${f.fx & FX_SPD_UP ? buffSvg('spd', true) : ''}${f.fx & FX_SPD_DOWN ? buffSvg('spd', false) : ''}${f.fx & FX_ARMOR ? '<span class="bf arm">ひるまない</span>' : ''}${f.invuln && f.state !== 'respawn' && f.state !== 'dead' ? '<span class="bf inv">無敵</span>' : ''}`;
      if (b !== p.lastBuffs) {
        p.buffs.innerHTML = b;
        p.lastBuffs = b;
      }
    }
    for (const e of events) {
      if (e.k === 'ko') {
        // 撃墜された人の表示が割れる
        const p = this.panels.get(e.s);
        if (p) {
          p.root.classList.remove('broken');
          void p.root.offsetWidth;
          p.root.classList.add('broken');
        }
      }
      if (e.k === 'hit') {
        const p = this.panels.get(e.s);
        if (p) {
          p.root.classList.remove('shake');
          void p.root.offsetWidth;
          p.root.classList.add('shake');
        }
      }
    }
    this.updateArea(v);
    this.updateCrown(v);
    this.updateScore(v);
    this.updateVault(v);
    if (this.ball && v.ball) {
      const key = v.ball.score.join('-');
      if (key !== this.ball.last) {
        // 点が入った側を弾ませる
        const [r0, b0] = this.ball.last ? this.ball.last.split('-').map(Number) : [0, 0];
        this.ball.red.textContent = String(v.ball.score[0]);
        this.ball.blue.textContent = String(v.ball.score[1]);
        for (const [el, up] of [[this.ball.red, v.ball.score[0] > r0], [this.ball.blue, v.ball.score[1] > b0]] as const) {
          if (!up) continue;
          el.classList.remove('pop');
          void el.offsetWidth;
          el.classList.add('pop');
        }
        this.ball.last = key;
      }
    }
    const secs = Math.ceil(v.timeLeft / 60);
    if (this.horde) {
      // 100人組手：倒した数と経過時間
      const el = Math.max(0, Math.floor((v.frame - COUNTDOWN_FRAMES) / 60));
      this.timer.innerHTML = `撃破 <b>${v.horde ?? 0}</b> / ${this.horde}<small> ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}</small>`;
    } else if (this.training) this.timer.textContent = '練習モード';
    else if (this.noLimit) {
      // 時間制限なし（ストック制）：経過時間を数える
      const el = Math.max(0, Math.floor((v.frame - COUNTDOWN_FRAMES) / 60));
      this.timer.textContent = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`;
    } else if (v.sudden) this.timer.textContent = 'サドンデス';
    else this.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    // 残り10秒：タイマーを大きく赤くする（サドンデス・時間制限なしは除く）
    const final = !this.horde && !this.training && !this.noLimit && !v.sudden && !v.ended && v.countdown <= 0 && v.timeLeft > 0 && secs <= 10;
    this.timer.classList.toggle('final', final);
    this.timer.classList.toggle('sudden', !!v.sudden && !v.ended);
    let c = '';
    if (v.countdown > 0) c = v.countdown > 100 ? '3' : v.countdown > 50 ? '2' : '1';
    else if (v.frame < 210) c = 'GO!';
    if (v.ended) c = this.horde ? ((v.horde ?? 0) >= this.horde ? 'CLEAR!' : 'GAME!') : v.timeLeft <= 0 && !this.noLimit && !v.sudden ? 'TIME UP!' : 'GAME!';
    if (c !== this.lastCenter) {
      this.center.textContent = c;
      this.center.classList.remove('pop');
      void this.center.offsetWidth;
      if (c) this.center.classList.add('pop');
      this.lastCenter = c;
    }
  }

  /** 画面の外にいるキャラの目印（slot ごと） */
  private offscreen = new Map<number, { el: HTMLElement; arrow: HTMLElement }>();
  private portraits: Record<number, string> = {};
  private colors: Record<number, string> = {};

  /**
   * 画面の外にいるキャラを、画面の端に顔と矢印で出す。遠いほど小さくする。
   * project は試合の中の位置を画面のピクセルに変える関数
   */
  updateOffscreen(v: ViewState, project: (x: number, y: number) => { x: number; y: number }): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const M = 34; // 端からの余白
    const seen = new Set<number>();
    for (const f of v.fighters) {
      if (f.state === 'dead' || f.out || this.horde) continue;
      const p = project(f.x, f.y + 0.9);
      const inside = p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H;
      if (inside) continue;
      seen.add(f.slot);
      let o = this.offscreen.get(f.slot);
      if (!o) {
        const el = document.createElement('div');
        el.className = 'offscreen';
        el.style.setProperty('--pc', this.colors[f.slot] ?? '#fff');
        el.innerHTML = `${this.portraits[f.slot] ? `<img alt="" src="${this.portraits[f.slot]}"/>` : ''}<i class="arr"></i>`;
        this.el.appendChild(el);
        o = { el, arrow: el.querySelector('.arr')! };
        this.offscreen.set(f.slot, o);
      }
      // 画面の中心から、その位置へ向かう線が画面の端と交わる所に置く
      const cx = W / 2;
      const cy = H / 2;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const k = Math.min((W / 2 - M) / Math.max(1e-6, Math.abs(dx)), (H / 2 - M) / Math.max(1e-6, Math.abs(dy)));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      // 画面からの離れぐあい（画面の大きさ1つぶん離れると半分の大きさ）
      const far = Math.max(0, Math.hypot(Math.max(0, -p.x, p.x - W), Math.max(0, -p.y, p.y - H)) / Math.max(W, H));
      const sc = Math.max(0.55, 1 - far * 0.5);
      o.el.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
      o.arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      o.el.style.display = '';
    }
    for (const [slot, o] of this.offscreen) if (!seen.has(slot)) o.el.style.display = 'none';
  }

  /** オンライン：通信が切れた・抜けた人（CPU が代わりに操作中） */
  setAway(slots: Set<number>): void {
    for (const [slot, p] of this.panels) p.root.classList.toggle('away', slots.has(slot));
  }

  /** 必殺技の待ち時間（0〜1、B・横B・下B・上B の順）。null なら出さない */
  setCooldowns(frac: number[] | null): void {
    const r = this.cdRow;
    if (!r) return;
    const key = frac ? frac.map((f) => Math.ceil(f * 30)).join() : '';
    if (key === this.lastCd) return;
    this.lastCd = key;
    const show = !!frac && frac.some((f) => f > 0);
    r.root.classList.toggle('on', show);
    if (!frac) return;
    r.bars.forEach((b, i) => {
      b.classList.toggle('wait', frac[i] > 0);
      (b.firstElementChild as HTMLElement).style.width = `${Math.round((1 - frac[i]) * 100)}%`;
    });
  }

  setNetInfo(text: string): void {
    this.net.textContent = text;
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}
