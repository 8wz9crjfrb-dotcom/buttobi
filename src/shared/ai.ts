// CPUの思考。強さ(level 1〜9)で反応の速さと判断の正確さが変わる。

import { Rng } from './rng';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type InputState } from './types';
import type { Fighter, Sim } from './sim';

/** CPUが狙う相手（選手、または分身） */
interface Target {
  x: number;
  y: number;
  state: string;
  damage: number;
  grounded: boolean;
}

interface Brain {
  hold: InputState;
  holdFrames: number;
  cooldown: number;
  lastButtons: number;
}

export class CpuController {
  private brains = new Map<number, Brain>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
  }

  think(sim: Sim, f: Fighter, level: number): InputState {
    let b = this.brains.get(f.slot);
    if (!b) {
      b = { hold: { mx: 0, my: 0, buttons: 0 }, holdFrames: 0, cooldown: 0, lastButtons: 0 };
      this.brains.set(f.slot, b);
    }
    const out = this.decide(sim, f, level, b);
    // 同じボタンを連続で「押した」ことにするため、前フレームに押していたボタンは一度離す
    const fresh = out.buttons & ~b.lastButtons;
    const keepHeld = out.buttons & b.lastButtons & (BTN_SHIELD | BTN_A | BTN_JUMP);
    const buttons = fresh | (b.holdFrames > 0 ? keepHeld : 0);
    b.lastButtons = buttons;
    return { mx: out.mx, my: out.my, buttons };
  }

  private decide(sim: Sim, f: Fighter, level: number, b: Brain): InputState {
    const lv = Math.max(1, Math.min(9, level));
    const m = sim.stage.main;
    if (!f.alive) return { mx: 0, my: 0, buttons: 0 };

    // 崖につかまっている：少し待ってから上がる
    if (f.state === 'ledge') {
      if (f.stateTime < 10 + (9 - lv) * 4) return { mx: 0, my: 0, buttons: 0 };
      return this.rng.chance(0.5) ? { mx: 0, my: 0, buttons: BTN_JUMP } : { mx: 0, my: 1, buttons: 0 };
    }

    // 場外：ステージへ戻る
    const offStage = f.x < m.x1 - 0.1 || f.x > m.x2 + 0.1;
    if (offStage && !f.grounded) {
      const toward = f.x < 0 ? 1 : -1;
      if (f.state === 'helpless' || f.state === 'attack' || f.state === 'hitstun') return { mx: toward, my: 0, buttons: 0 };
      if (f.vy < 1 && f.y < m.top + 2 && f.jumpsLeft > 0) return { mx: toward, my: 0, buttons: BTN_JUMP };
      if (f.vy < 0 && f.jumpsLeft === 0 && f.y < m.top - 0.5) return { mx: toward * 0.4, my: 1, buttons: BTN_B };
      if (f.vy < -2 && f.jumpsLeft === 0 && Math.abs(f.x) - m.x2 > 4 && !f.sideBUsed) return { mx: toward, my: 0, buttons: BTN_B };
      return { mx: toward, my: 0, buttons: 0 };
    }

    // ボタンを押し続けている途中（溜めやガード）
    if (b.holdFrames > 0) {
      b.holdFrames--;
      return b.hold;
    }

    if (b.cooldown > 0) {
      b.cooldown--;
      // 待っている間は軽く追いかける
      const t = this.target(sim, f);
      if (!t) return { mx: 0, my: 0, buttons: 0 };
      const dx = t.x - f.x;
      return { mx: Math.abs(dx) > 2 ? Math.sign(dx) * 0.8 : 0, my: 0, buttons: 0 };
    }

    const reaction = 26 - lv * 2.5;
    b.cooldown = Math.max(1, Math.round(this.rng.range(reaction * 0.5, reaction * 1.2)));

    const t = this.target(sim, f);
    if (!t) return { mx: 0, my: 0, buttons: 0 };
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const adx = Math.abs(dx);
    const dir = Math.sign(dx) || 1;

    // 相手が攻撃中で近い → ガードや回避
    if (t.state === 'attack' && adx < 2.4 && Math.abs(dy) < 2 && f.grounded && this.rng.chance(0.06 * lv)) {
      if (this.rng.chance(0.3)) return { mx: -dir, my: 0, buttons: BTN_SHIELD };
      b.hold = { mx: 0, my: 0, buttons: BTN_SHIELD };
      b.holdFrames = 10 + Math.round(this.rng.range(0, 12));
      return b.hold;
    }

    // 近い：攻撃
    if (adx < 1.9 && Math.abs(dy) < 1.6) {
      if (!f.grounded) {
        const back = dir !== f.facing;
        if (dy > 0.8) return { mx: 0, my: 1, buttons: BTN_A };
        if (dy < -0.8) return { mx: 0, my: -1, buttons: BTN_A };
        return { mx: back ? dir : this.rng.chance(0.5) ? dir : 0, my: 0, buttons: BTN_A };
      }
      const r = this.rng.next();
      const highDamage = t.damage > 90;
      if (t.state === 'shield' && this.rng.chance(0.5)) return { mx: 0, my: 0, buttons: BTN_SHIELD | BTN_A };
      if (dy > 1.0) return { mx: 0, my: 1, buttons: BTN_A };
      if (highDamage && r < 0.35 + lv * 0.03) {
        // スマッシュ（はじき入力のため、直前のフレームはスティックを戻している必要がある）
        if (Math.abs(f.input.mx) < 0.3) {
          b.hold = { mx: dir, my: 0, buttons: BTN_A };
          b.holdFrames = Math.round(this.rng.range(0, 20));
          return b.hold;
        }
        return { mx: 0, my: 0, buttons: 0 };
      }
      if (r < 0.35) return { mx: 0, my: 0, buttons: BTN_A };
      if (r < 0.6) return { mx: dir * 0.6, my: 0, buttons: BTN_A };
      if (r < 0.75) return { mx: 0, my: -1, buttons: BTN_A };
      if (r < 0.85) return { mx: 0, my: -1, buttons: BTN_B };
      if (r < 0.92) return { mx: 0, my: 0, buttons: BTN_JUMP };
      return { mx: dir, my: 0, buttons: BTN_SHIELD | BTN_A };
    }

    // 中距離：飛び道具・突進・ジャンプで近づく
    if (adx < 7 && Math.abs(dy) < 1.2 && f.grounded) {
      const r = this.rng.next();
      if (r < 0.12) return { mx: 0, my: 0, buttons: BTN_B };
      if (r < 0.2 && adx > 3) return { mx: dir, my: 0, buttons: BTN_B };
    }
    if (dy > 2 && adx < 4 && (f.grounded || f.jumpsLeft > 0) && this.rng.chance(0.5)) {
      return { mx: dir * 0.5, my: 0, buttons: BTN_JUMP };
    }
    if (dy < -1.5 && f.grounded && f.groundRef >= 0 && this.rng.chance(0.4)) {
      return { mx: 0, my: -1, buttons: 0 };
    }

    // 台の端に近づきすぎない
    const nextX = f.x + dir * 1.5;
    if ((nextX < m.x1 + 0.5 || nextX > m.x2 - 0.5) && !t.grounded) {
      return { mx: 0, my: 0, buttons: 0 };
    }
    b.cooldown = Math.min(b.cooldown, 4);
    return { mx: dir, my: 0, buttons: 0 };
  }

  /** いちばん近い相手。分身（ハルシネーション）にもだまされる */
  private target(sim: Sim, f: Fighter): Target | null {
    let best: Target | null = null;
    let bestD = Infinity;
    for (const o of sim.fighters) {
      if (o === f || !o.alive || o.out) continue;
      const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    for (const e of sim.entities) {
      if (e.kind !== 'decoy' || e.owner === f.slot) continue;
      const d = Math.abs(e.x - f.x) + Math.abs(e.y - f.y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, y: e.y, state: 'idle', damage: 0, grounded: true };
      }
    }
    return best;
  }
}
