// 対戦中の表示（ダメージ%・残機・タイマー・カウントダウン）

import { getCharacter, playerColor, TEAM_NAMES } from '../shared/characters';
import { COUNTDOWN_FRAMES } from '../shared/sim';
import { DEFAULT_HP, type GameEvent, type MatchSetup, type ViewState } from '../shared/types';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  private el: HTMLElement;
  private panels = new Map<number, { root: HTMLElement; dmg: HTMLElement; stk: HTMLElement; last: number; job: HTMLElement; fitted: boolean }>();
  private timer: HTMLElement;
  private center: HTMLElement;
  private net: HTMLElement;
  private lastCenter = '';
  private stockMode = true;
  /** 体力制：残りHPを出す */
  private hp = 0;
  /** 100人組手：倒す人数 */
  private horde = 0;

  /** 練習モード：残機とタイマーを出さない */
  private training = false;

  constructor() {
    this.el = document.getElementById('hud')!;
    this.timer = document.createElement('div');
    this.center = document.createElement('div');
    this.net = document.createElement('div');
  }

  setup(setup: MatchSetup, myslot: number | null, training = false, portraits: Record<number, string> = {}): void {
    this.training = training;
    this.el.innerHTML = '';
    this.panels.clear();
    this.stockMode = setup.rules.mode !== 'time';
    this.hp = setup.rules.mode === 'stamina' ? setup.rules.hp ?? DEFAULT_HP : 0;
    this.horde = setup.rules.horde ?? 0;
    const wrap = document.createElement('div');
    wrap.className = 'hud-players';
    // 100人組手は自分の表示だけ
    const shown = this.horde ? setup.players.slice(0, 1) : setup.players;
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
      job.textContent = getCharacter(p.charId).name;
      const dmg = document.createElement('div');
      dmg.className = 'dmg';
      const stk = document.createElement('div');
      stk.className = 'stk';
      const nm = document.createElement('div');
      nm.className = 'pnm';
      const team = setup.rules.teams ? `${TEAM_NAMES[(p.team ?? 0) % TEAM_NAMES.length]}・` : '';
      nm.textContent = `${team}${p.name}`;
      if (portraits[p.slot]) {
        const face = document.createElement('img');
        face.className = 'face';
        face.src = portraits[p.slot];
        face.alt = '';
        root.appendChild(face);
      }
      root.append(job, dmg, stk, nm);
      wrap.appendChild(root);
      this.panels.set(p.slot, { root, dmg, stk, last: -1, job, fitted: false });
    }
    this.timer.className = 'hud-timer';
    this.center.className = 'hud-center';
    this.net.className = 'hud-net';
    this.el.append(wrap, this.timer, this.center, this.net);
    this.lastCenter = '';
  }

  update(v: ViewState, events: GameEvent[]): void {
    for (const f of v.fighters) {
      const p = this.panels.get(f.slot);
      if (!p) continue;
      // 長い職業名は、枠に収まるよう横に縮める（省略しない）。表示されてから一度だけ測る
      if (!p.fitted && p.job.clientWidth > 0) {
        p.fitted = true;
        let size = 9;
        while (size > 6 && p.job.scrollWidth > p.job.clientWidth) {
          size -= 0.25;
          p.job.style.fontSize = `${size}px`;
        }
      }
      const d = this.hp ? Math.max(0, Math.ceil(this.hp - f.damage)) : Math.floor(f.damage);
      if (d !== p.last) {
        // 体力制は残りHP（減るほど赤く）、ふつうはダメージ%（増えるほど赤く）
        p.dmg.innerHTML = this.hp ? `${d}<small>HP</small>` : `${d}<small>%</small>`;
        const heat = this.hp ? 1 - d / this.hp : Math.min(1, d / 150);
        p.dmg.style.color = `rgb(255, ${Math.round(255 - heat * 170)}, ${Math.round(255 - heat * 230)})`;
        p.last = d;
      }
      p.stk.textContent = this.training ? '' : this.stockMode ? '●'.repeat(Math.max(0, f.stocks)) : `${f.kos - f.falls >= 0 ? '+' : ''}${f.kos - f.falls}`;
      p.root.classList.toggle('out', f.out);
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
    const secs = Math.ceil(v.timeLeft / 60);
    if (this.horde) {
      // 100人組手：倒した数と経過時間
      const el = Math.max(0, Math.floor((v.frame - COUNTDOWN_FRAMES) / 60));
      this.timer.innerHTML = `撃破 <b>${v.horde ?? 0}</b> / ${this.horde}<small> ${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}</small>`;
    } else this.timer.textContent = this.training ? '練習モード' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    let c = '';
    if (v.countdown > 0) c = v.countdown > 100 ? '3' : v.countdown > 50 ? '2' : '1';
    else if (v.frame < 210) c = 'GO!';
    if (v.ended) c = this.horde ? ((v.horde ?? 0) >= this.horde ? 'CLEAR!' : 'GAME!') : v.timeLeft <= 0 ? 'TIME UP!' : 'GAME!';
    if (c !== this.lastCenter) {
      this.center.textContent = c;
      this.center.classList.remove('pop');
      void this.center.offsetWidth;
      if (c) this.center.classList.add('pop');
      this.lastCenter = c;
    }
  }

  setNetInfo(text: string): void {
    this.net.textContent = text;
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }
}
