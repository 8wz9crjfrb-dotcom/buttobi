// 対戦中の表示（ダメージ%・残機・タイマー・カウントダウン）

import { getCharacter, SLOT_COLORS } from '../shared/characters';
import type { GameEvent, MatchSetup, ViewState } from '../shared/types';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export class Hud {
  private el: HTMLElement;
  private panels = new Map<number, { root: HTMLElement; dmg: HTMLElement; stk: HTMLElement; last: number }>();
  private timer: HTMLElement;
  private center: HTMLElement;
  private net: HTMLElement;
  private lastCenter = '';
  private stockMode = true;

  constructor() {
    this.el = document.getElementById('hud')!;
    this.timer = document.createElement('div');
    this.center = document.createElement('div');
    this.net = document.createElement('div');
  }

  setup(setup: MatchSetup, myslot: number | null): void {
    this.el.innerHTML = '';
    this.panels.clear();
    this.stockMode = setup.rules.mode === 'stock';
    const wrap = document.createElement('div');
    wrap.className = 'hud-players';
    for (const p of setup.players) {
      const root = document.createElement('div');
      root.className = 'hud-p';
      root.style.color = hex(SLOT_COLORS[p.slot % SLOT_COLORS.length]);
      const nm = document.createElement('div');
      nm.className = 'nm';
      const you = myslot === p.slot ? '（あなた）' : '';
      nm.textContent = `P${p.slot + 1} ${p.name}${you}`;
      const dmg = document.createElement('div');
      dmg.className = 'dmg';
      const stk = document.createElement('div');
      stk.className = 'stk';
      const ch = document.createElement('div');
      ch.className = 'nm';
      ch.textContent = getCharacter(p.charId).name;
      root.append(nm, dmg, stk);
      wrap.appendChild(root);
      this.panels.set(p.slot, { root, dmg, stk, last: -1 });
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
      const d = Math.floor(f.damage);
      if (d !== p.last) {
        p.dmg.innerHTML = `${d}<small>%</small>`;
        const heat = Math.min(1, d / 150);
        p.dmg.style.color = `rgb(255, ${Math.round(255 - heat * 170)}, ${Math.round(255 - heat * 230)})`;
        p.last = d;
      }
      p.stk.textContent = this.stockMode ? '●'.repeat(Math.max(0, f.stocks)) : `${f.kos - f.falls >= 0 ? '+' : ''}${f.kos - f.falls}`;
      p.root.classList.toggle('out', f.out);
    }
    for (const e of events) {
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
    this.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    let c = '';
    if (v.countdown > 0) c = v.countdown > 100 ? '3' : v.countdown > 50 ? '2' : '1';
    else if (v.frame < 210) c = 'GO!';
    if (v.ended) c = v.timeLeft <= 0 ? 'TIME UP!' : 'GAME!';
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
