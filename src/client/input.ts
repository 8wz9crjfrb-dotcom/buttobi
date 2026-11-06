// タッチ（仮想スティック＋ボタン）・キーボード・ゲームパッドの入力をまとめる

import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState } from '../shared/types';

const STICK_RADIUS = 56;

export class InputManager {
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private touchButtons = new Map<number, number>(); // pointerId -> button bit
  private keys = new Set<string>();
  /** 前回 takePressed() してから押されたボタン（オンラインで短い押しを取りこぼさないため） */
  private latched = 0;
  private lastButtons = 0;
  gamepadConnected = false;

  private base: HTMLElement;
  private knob: HTMLElement;
  private zone: HTMLElement;

  constructor() {
    this.zone = document.getElementById('stick-zone')!;
    this.base = document.getElementById('stick-base')!;
    this.knob = document.getElementById('stick-knob')!;
    this.bindTouch();
    this.bindKeyboard();
    window.addEventListener('gamepadconnected', () => {
      this.gamepadConnected = true;
      document.dispatchEvent(new CustomEvent('gamepadchange'));
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.gamepadConnected = Array.from(navigator.getGamepads?.() ?? []).some((g) => !!g);
      document.dispatchEvent(new CustomEvent('gamepadchange'));
    });
  }

  private bindTouch(): void {
    const zone = this.zone;
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* 取得できなくても操作は続ける */
      }
      const r = zone.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = '';
      this.base.classList.remove('active');
      this.base.style.left = '';
      this.base.style.top = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    document.querySelectorAll<HTMLElement>('.pad-btn').forEach((el) => {
      const bit = Number(el.dataset.btn);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* 取得できなくても操作は続ける */
        }
        this.touchButtons.set(e.pointerId, bit);
        this.latched |= bit;
        el.classList.add('down');
      });
      const up = (e: PointerEvent) => {
        if (!this.touchButtons.has(e.pointerId)) return;
        this.touchButtons.delete(e.pointerId);
        if (![...this.touchButtons.values()].includes(bit)) el.classList.remove('down');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  private updateStick(cx: number, cy: number): void {
    let dx = cx - this.stickOrigin.x;
    let dy = cy - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      // スティックの中心を指に追従させる（大きく動かしても操作が途切れない）
      const over = len - STICK_RADIUS;
      this.stickOrigin.x += (dx / len) * over;
      this.stickOrigin.y += (dy / len) * over;
      const r = this.zone.getBoundingClientRect();
      this.base.style.left = `${this.stickOrigin.x - r.left}px`;
      this.base.style.top = `${this.stickOrigin.y - r.top}px`;
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    this.stick = { x: dx / STICK_RADIUS, y: -dy / STICK_RADIUS };
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.keys.has(e.code)) {
        const bit = keyBit(e.code);
        if (bit) this.latched |= bit;
      }
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.touchButtons.clear();
      document.querySelectorAll('.pad-btn.down').forEach((el) => el.classList.remove('down'));
    });
  }

  /** 現在の入力を読む */
  sample(): InputState {
    let mx = this.stick.x;
    let my = this.stick.y;
    let buttons = 0;
    for (const b of this.touchButtons.values()) buttons |= b;

    const k = this.keys;
    const kx = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    const ky = (k.has('ArrowUp') || k.has('KeyW') ? 1 : 0) - (k.has('ArrowDown') || k.has('KeyS') ? 1 : 0);
    if (kx || ky) {
      mx = kx;
      my = ky;
    }
    for (const code of k) buttons |= keyBit(code);

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const ay = -(gp.axes[1] ?? 0);
      const dx = (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      const dy = (gp.buttons[12]?.pressed ? 1 : 0) - (gp.buttons[13]?.pressed ? 1 : 0);
      if (Math.hypot(ax, ay) > 0.2 && Math.hypot(ax, ay) > Math.hypot(mx, my)) {
        mx = ax;
        my = ay;
      }
      if (dx || dy) {
        mx = dx;
        my = dy;
      }
      // 標準配置: 下=ジャンプ、左=攻撃、右=必殺、上=ジャンプ、肩=ガード
      if (gp.buttons[0]?.pressed || gp.buttons[3]?.pressed) buttons |= BTN_JUMP;
      if (gp.buttons[2]?.pressed) buttons |= BTN_A;
      if (gp.buttons[1]?.pressed) buttons |= BTN_B;
      if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed || gp.buttons[6]?.pressed || gp.buttons[7]?.pressed) buttons |= BTN_SHIELD;
    }
    const newly = buttons & ~this.lastButtons;
    this.latched |= newly;
    this.lastButtons = buttons;
    return { mx: clamp(mx), my: clamp(my), buttons };
  }

  /** 前回呼んでから押されたボタンを返してリセットする */
  takePressed(): number {
    const p = this.latched;
    this.latched = 0;
    return p;
  }

  reset(): void {
    this.stickId = null;
    this.stick = { x: 0, y: 0 };
    this.touchButtons.clear();
    this.latched = 0;
    this.knob.style.transform = '';
    document.querySelectorAll('.pad-btn.down').forEach((el) => el.classList.remove('down'));
  }
}

function keyBit(code: string): number {
  switch (code) {
    case 'KeyJ':
    case 'KeyZ':
      return BTN_A;
    case 'KeyK':
    case 'KeyX':
      return BTN_B;
    case 'Space':
    case 'KeyC':
      return BTN_JUMP;
    case 'KeyL':
    case 'ShiftLeft':
    case 'ShiftRight':
      return BTN_SHIELD;
  }
  return 0;
}

function clamp(n: number): number {
  return Math.max(-1, Math.min(1, n));
}
