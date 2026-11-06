// ゲーム進行の本体。端末（CPU戦）とサーバー（オンライン戦）で同じコードを使う。
// 座標は x が右、y が上。単位はおおよそメートル、速度は m/秒。1ステップ = 1/60 秒。

import { CHARACTERS, getCharacter, type CharacterDef } from './characters';
import { moveOf, POPUP, TRAP, WALL, type MoveDef, type ShotKind, type ShotSpec } from './moves';
import { getStage, platformAt, type StageDef } from './stages';
import {
  BTN_A,
  BTN_B,
  BTN_JUMP,
  BTN_SHIELD,
  EMPTY_INPUT,
  type FighterStateName,
  type GameEvent,
  type InputState,
  type MatchSetup,
  type MoveId,
  type ResultEntry,
  type ViewState,
} from './types';

export const DT = 1 / 60;
export const COUNTDOWN_FRAMES = 150;
const END_DELAY = 120;
const SHIELD_MAX = 50;
const KO_CREDIT_FRAMES = 600;
/** はじき入力とみなす、中央から倒し切るまでの最大フレーム数（5フレーム ≒ 0.08秒） */
export const FLICK_WINDOW = 5;
/** ふっとばしの伸び（ダメージ%による増え方）の全体倍率。調整用 */
export const KB_GROWTH_SCALE = 1.7;
/** ふっとび中の空気抵抗（1フレームごとに速度へ掛ける） */
export const HITSTUN_DRAG = 0.98;

export interface Projectile {
  owner: number;
  kind: ShotKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  dmg: number;
  base: number;
  growth: number;
  angle: number;
  r: number;
  hitstunMul: number;
  poison: number;
}

/** ステージに置かれる物（壁・罠・一時的な足場） */
export interface Entity {
  id: number;
  kind: 'wall' | 'trap' | 'popup';
  owner: number;
  x: number;
  y: number;
  vy: number;
  life: number;
  age: number;
}

/** 毒のダメージ間隔（フレーム） */
const POISON_TICK = 30;
/** 一時的な足場の上に立っているときの groundRef（1000 + 足場の id） */
const ENTITY_GROUND = 1000;

const SNAPSHOT_KEYS = [
  'x', 'y', 'vx', 'vy', 'facing', 'grounded', 'groundRef', 'state', 'stateTime', 'jumpsLeft', 'sideBUsed',
  'airDodgeUsed', 'fastFall', 'shortHopArmed', 'damage', 'stocks', 'kos', 'falls', 'out', 'outFrame', 'move',
  'moveFrame', 'charge', 'hitstun', 'tumble', 'invuln', 'hitlag', 'shield', 'stun', 'lastHitBy', 'lastHitFrame',
  'ledgeSide', 'ledgeCooldown', 'dropThrough', 'respawnTimer', 'dodgeDir', 'prevButtons', 'prevMx', 'prevMy',
  'flickX', 'flickY', 'neutralXAge', 'neutralYAge', 'poison', 'poisonFrom',
] as const;

export type FighterSnapshot = { [K in (typeof SNAPSHOT_KEYS)[number]]: Fighter[K] } & { moveHit: number[] };

export class Fighter {
  slot: number;
  def: CharacterDef;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing = 1;
  grounded = true;
  /** 立っている場所: -1 = 本体の台、0以上 = 足場番号 */
  groundRef = -1;
  state: FighterStateName = 'idle';
  stateTime = 0;
  jumpsLeft = 1;
  sideBUsed = false;
  airDodgeUsed = false;
  fastFall = false;
  shortHopArmed = false;
  damage = 0;
  stocks = 3;
  kos = 0;
  falls = 0;
  out = false;
  outFrame = 0;
  move: MoveId | null = null;
  moveFrame = 0;
  moveHit = new Set<number>();
  charge = 0;
  hitstun = 0;
  tumble = false;
  invuln = 0;
  hitlag = 0;
  shield = SHIELD_MAX;
  stun = 0;
  lastHitBy = -1;
  lastHitFrame = -9999;
  ledgeSide = 0;
  ledgeCooldown = 0;
  dropThrough = 0;
  respawnTimer = 0;
  dodgeDir = 0;
  input: InputState = { ...EMPTY_INPUT };
  prevButtons = 0;
  prevMx = 0;
  prevMy = 0;
  /** スティックを素早く倒してからのフレーム数（はじき入力の判定） */
  flickX = 99;
  flickY = 99;
  /** スティックが中央付近（0.3未満）にあってからのフレーム数 */
  neutralXAge = 0;
  neutralYAge = 0;
  /** 毒の残りフレーム数と、毒を与えた人 */
  poison = 0;
  poisonFrom = -1;

  constructor(slot: number, charId: string) {
    this.slot = slot;
    this.def = getCharacter(charId);
    this.jumpsLeft = this.def.airJumps;
  }

  /** 状態をまるごと書き出す（サーバー → 端末の照合用） */
  serialize(): FighterSnapshot {
    const o: Record<string, unknown> = {};
    for (const k of SNAPSHOT_KEYS) o[k] = (this as unknown as Record<string, unknown>)[k];
    o.moveHit = [...this.moveHit];
    return o as unknown as FighterSnapshot;
  }

  /** serialize() で書き出した状態に戻す */
  restore(s: FighterSnapshot): void {
    const self = this as unknown as Record<string, unknown>;
    for (const k of SNAPSHOT_KEYS) if (k in s) self[k] = (s as unknown as Record<string, unknown>)[k];
    this.moveHit = new Set(s.moveHit ?? []);
  }

  get hw(): number {
    return 0.42 * this.def.scale;
  }
  get h(): number {
    return 1.8 * this.def.scale;
  }
  get alive(): boolean {
    return this.state !== 'dead' && this.state !== 'respawn';
  }
}

function frames(n: number, mul: number): number {
  return Math.max(1, Math.round(n * mul));
}

export function moveTiming(md: MoveDef, f: Fighter): { s: number; a: number; e: number } {
  const mul = f.def.frameMul;
  return { s: frames(md.startup, mul), a: md.active, e: frames(md.end, mul) };
}

export class Sim {
  readonly setup: MatchSetup;
  readonly stage: StageDef;
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  entities: Entity[] = [];
  private nextEntityId = 1;
  frame = 0;
  events: GameEvent[] = [];
  ended = false;
  endFrame = 0;
  finished = false;

  /**
   * onlySlot を指定すると、その選手だけを動かす（オンライン対戦の先行表示用）。
   * 出現位置・復活位置は全員がいる場合と同じになるよう、setup の並び順で決める。
   */
  constructor(setup: MatchSetup, onlySlot?: number) {
    this.setup = setup;
    this.stage = getStage(setup.stageId);
    setup.players.forEach((p, i) => {
      if (onlySlot !== undefined && p.slot !== onlySlot) return;
      const f = new Fighter(p.slot, p.charId);
      const sp = this.stage.spawns[i % this.stage.spawns.length];
      f.x = sp.x;
      f.y = sp.y;
      f.groundRef = sp.y > this.stage.main.top ? this.findPlatformAt(sp.x, sp.y) : -1;
      f.facing = sp.x > 0 ? -1 : 1;
      f.stocks = setup.rules.mode === 'stock' ? setup.rules.stocks : 0;
      this.fighters.push(f);
    });
  }

  private findPlatformAt(x: number, y: number): number {
    for (let i = 0; i < this.stage.platforms.length; i++) {
      const p = platformAt(this.stage.platforms[i], 0);
      if (Math.abs(p.y - y) < 0.01 && x >= p.x1 && x <= p.x2) return i;
    }
    return -1;
  }

  fighter(slot: number): Fighter | undefined {
    return this.fighters.find((f) => f.slot === slot);
  }

  get timeLimitFrames(): number {
    return this.setup.rules.timeLimit * 60;
  }

  get timeLeftFrames(): number {
    return Math.max(0, this.timeLimitFrames - Math.max(0, this.frame - COUNTDOWN_FRAMES));
  }

  /** 1フレーム進める。inputs は slot をキーにした入力 */
  step(inputs: Map<number, InputState>): void {
    this.frame++;
    this.events = [];
    if (this.finished) return;
    if (this.ended && this.frame - this.endFrame > END_DELAY) {
      this.finished = true;
      return;
    }
    const playing = this.frame > COUNTDOWN_FRAMES && !this.ended;
    for (const f of this.fighters) {
      const inp = playing ? inputs.get(f.slot) ?? EMPTY_INPUT : EMPTY_INPUT;
      this.readInput(f, inp);
    }
    for (const f of this.fighters) {
      if (f.hitlag > 0) {
        f.hitlag--;
        continue;
      }
      this.updateFighter(f);
    }
    this.updateEntities();
    this.updateProjectiles();
    this.detectHits();
    for (const f of this.fighters) this.checkBlast(f);
    this.checkEnd();
    for (const f of this.fighters) {
      f.prevButtons = f.input.buttons;
      f.prevMx = f.input.mx;
      f.prevMy = f.input.my;
    }
  }

  private readInput(f: Fighter, inp: InputState): void {
    f.input = inp;
    // 「はじき」の判定：中央付近から FLICK_WINDOW フレーム以内に大きく倒したら、はじいたとみなす。
    // 指で操作する仮想スティックは倒し切るまで数フレームかかるため、1フレームでの判定にはしない。
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ax > 0.75 && Math.abs(f.prevMx) <= 0.75 && f.neutralXAge <= FLICK_WINDOW) f.flickX = 0;
    else f.flickX++;
    if (ay > 0.7 && Math.abs(f.prevMy) <= 0.7 && f.neutralYAge <= FLICK_WINDOW) f.flickY = 0;
    else f.flickY++;
    f.neutralXAge = ax < 0.3 ? 0 : f.neutralXAge + 1;
    f.neutralYAge = ay < 0.3 ? 0 : f.neutralYAge + 1;
  }

  private pressed(f: Fighter, btn: number): boolean {
    return (f.input.buttons & btn) !== 0 && (f.prevButtons & btn) === 0;
  }

  private held(f: Fighter, btn: number): boolean {
    return (f.input.buttons & btn) !== 0;
  }

  private setState(f: Fighter, s: FighterStateName): void {
    f.state = s;
    f.stateTime = 0;
  }

  // ------------------------------------------------------------------
  private updateFighter(f: Fighter): void {
    f.stateTime++;
    if (f.invuln > 0) f.invuln--;
    if (f.ledgeCooldown > 0) f.ledgeCooldown--;
    if (f.dropThrough > 0) f.dropThrough--;
    if (f.state !== 'shield' && f.shield < SHIELD_MAX) f.shield = Math.min(SHIELD_MAX, f.shield + 0.08);
    if (f.poison > 0) {
      f.poison--;
      if (f.alive && f.poison % POISON_TICK === 0) f.damage = Math.min(999, f.damage + 1);
    }

    if (f.state === 'dead') {
      if (f.out) return;
      f.respawnTimer--;
      if (f.respawnTimer <= 0) this.respawn(f);
      return;
    }
    if (f.state === 'respawn') {
      const inp = f.input;
      if (f.stateTime > 150 || Math.abs(inp.mx) > 0.3 || Math.abs(inp.my) > 0.3 || inp.buttons) {
        this.setState(f, 'air');
        f.invuln = 120;
        f.grounded = false;
        f.vy = 0;
      }
      return;
    }
    if (f.state === 'ledge') {
      this.updateLedge(f);
      return;
    }

    const inp = f.input;
    const d = f.def;

    switch (f.state) {
      case 'idle':
      case 'run':
        this.groundActions(f);
        break;
      case 'shield':
        this.shieldActions(f);
        break;
      case 'land':
        f.vx *= 0.8;
        if (f.stateTime >= f.stun) this.setState(f, 'idle');
        break;
      case 'air':
      case 'helpless':
        this.airActions(f);
        break;
      case 'attack':
        this.updateMove(f);
        break;
      case 'hitstun':
        f.hitstun--;
        if (!f.grounded) {
          f.vx *= HITSTUN_DRAG;
        } else {
          f.vx *= 0.85;
        }
        if (f.hitstun <= 0) {
          f.tumble = false;
          this.setState(f, f.grounded ? 'idle' : 'air');
        }
        break;
      case 'shieldbreak':
        f.vx *= 0.85;
        f.stun--;
        if (f.stun <= 0 && f.grounded) this.setState(f, 'idle');
        break;
      case 'sleep':
        // 強制アップデート中：動けない
        f.vx *= 0.8;
        f.stun--;
        if (f.stun <= 0) this.setState(f, f.grounded ? 'idle' : 'air');
        break;
      case 'dodge': {
        const total = 22;
        if (f.dodgeDir !== 0 && f.stateTime < 16) f.vx = f.dodgeDir * 8;
        else f.vx *= 0.7;
        if (f.stateTime === 3) f.invuln = Math.max(f.invuln, 13);
        if (f.stateTime >= total) this.setState(f, 'idle');
        break;
      }
      case 'airdodge':
        if (f.stateTime === 2) f.invuln = Math.max(f.invuln, 18);
        f.vx *= 0.92;
        f.vy *= 0.92;
        if (f.stateTime >= 28) this.setState(f, 'air');
        break;
    }

    // 重力と移動
    if (!f.grounded) {
      const g = f.state === 'airdodge' && f.stateTime < 20 ? d.gravity * 0.25 : d.gravity;
      f.vy -= g * DT;
      const maxFall = f.state === 'hitstun' ? d.fallMax * 2 : f.fastFall ? d.fallMax * 1.5 : d.fallMax;
      if (f.vy < -maxFall) f.vy = -maxFall;
      if (f.shortHopArmed && !this.held(f, BTN_JUMP) && f.vy > 0 && f.stateTime < 10) {
        f.vy *= 0.55;
        f.shortHopArmed = false;
      }
      if (f.vy <= 0) f.shortHopArmed = false;
    }
    if (f.grounded && f.groundRef >= 0 && f.groundRef < ENTITY_GROUND) {
      const p = platformAt(this.stage.platforms[f.groundRef], this.frame);
      f.x += p.dx;
    }
    const prevX = f.x;
    const prevY = f.y;
    f.x += f.vx * DT;
    f.y += f.vy * DT;
    this.collide(f, prevX, prevY, inp);
  }

  private groundActions(f: Fighter): void {
    const inp = f.input;
    const d = f.def;
    if (this.held(f, BTN_SHIELD)) {
      if (this.pressed(f, BTN_A)) return this.startMove(f, 'grab');
      if (this.tryDodge(f)) return;
      this.setState(f, 'shield');
      return;
    }
    // ボタンを先に判定する（スティックを上にはじきながらBを押したときは、ジャンプではなく上必殺技）
    if (this.pressed(f, BTN_A)) return this.groundAttack(f);
    if (this.pressed(f, BTN_B)) return this.special(f);
    if (this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7)) {
      this.jump(f);
      return;
    }
    if (f.groundRef >= 0 && f.flickY <= 2 && inp.my < -0.7) {
      f.dropThrough = 14;
      f.grounded = false;
      f.groundRef = -1;
      f.y -= 0.05;
      this.setState(f, 'air');
      return;
    }
    const ax = Math.abs(inp.mx);
    const target = ax > 0.65 ? inp.mx * d.runSpeed : ax > 0.15 ? inp.mx * d.walkSpeed : 0;
    f.vx += (target - f.vx) * (target === 0 ? 0.35 : 0.25);
    if (ax > 0.2) f.facing = inp.mx > 0 ? 1 : -1;
    const moving = Math.abs(f.vx) > 0.6 && ax > 0.15;
    if (moving && f.state !== 'run') this.setState(f, 'run');
    else if (!moving && f.state !== 'idle') this.setState(f, 'idle');
  }

  private tryDodge(f: Fighter): boolean {
    const inp = f.input;
    if (f.flickX <= 3 && Math.abs(inp.mx) > 0.7) {
      f.dodgeDir = inp.mx > 0 ? 1 : -1;
      this.setState(f, 'dodge');
      return true;
    }
    if (f.flickY <= 3 && inp.my < -0.7) {
      f.dodgeDir = 0;
      this.setState(f, 'dodge');
      return true;
    }
    return false;
  }

  private shieldActions(f: Fighter): void {
    f.vx *= 0.8;
    if (!this.held(f, BTN_SHIELD)) {
      this.setState(f, 'idle');
      return;
    }
    if (this.pressed(f, BTN_A)) return this.startMove(f, 'grab');
    if (this.pressed(f, BTN_JUMP)) {
      this.jump(f);
      return;
    }
    if (this.tryDodge(f)) return;
    f.shield -= 0.14;
    if (f.shield <= 0) this.breakShield(f);
  }

  private breakShield(f: Fighter): void {
    f.shield = 0;
    this.setState(f, 'shieldbreak');
    f.stun = 150;
    f.vy = 11;
    f.grounded = false;
    f.groundRef = -1;
  }

  private jump(f: Fighter): void {
    f.vy = f.def.jumpV;
    f.grounded = false;
    f.groundRef = -1;
    f.shortHopArmed = this.held(f, BTN_JUMP);
    f.fastFall = false;
    this.setState(f, 'air');
    this.events.push({ k: 'jump', s: f.slot });
  }

  private airActions(f: Fighter): void {
    const inp = f.input;
    const d = f.def;
    const helpless = f.state === 'helpless';
    if (!helpless) {
      // ボタンを先に判定する（上にはじきながらB → 上必殺技、上にはじきながらA → 上空中攻撃）
      if (this.pressed(f, BTN_A)) return this.airAttack(f);
      if (this.pressed(f, BTN_B)) return this.special(f);
      const wantJump = this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7);
      if (wantJump && f.jumpsLeft > 0) {
        f.jumpsLeft--;
        f.vy = d.airJumpV;
        f.fastFall = false;
        if (Math.abs(inp.mx) > 0.3) f.vx = inp.mx * d.airSpeed;
        this.setState(f, 'air');
        this.events.push({ k: 'jump', s: f.slot });
        return;
      }
      if (this.pressed(f, BTN_SHIELD) && !f.airDodgeUsed) {
        f.airDodgeUsed = true;
        const len = Math.hypot(inp.mx, inp.my);
        if (len > 0.4) {
          f.vx = (inp.mx / len) * 9;
          f.vy = (inp.my / len) * 9;
        } else {
          f.vx *= 0.3;
          f.vy = Math.max(f.vy, 0) * 0.3;
        }
        this.setState(f, 'airdodge');
        return;
      }
    }
    const accel = d.airAccel * (helpless ? 0.5 : 1);
    const maxV = d.airSpeed * (helpless ? 0.6 : 1);
    if (Math.abs(inp.mx) > 0.15) {
      f.vx += inp.mx * accel * DT;
      if (Math.abs(f.vx) > maxV) f.vx = Math.sign(f.vx) * Math.max(maxV, Math.abs(f.vx) * 0.96);
    } else {
      f.vx *= 0.97;
    }
    if (!helpless && f.flickY <= 2 && inp.my < -0.7 && f.vy < 3) f.fastFall = true;
    this.tryLedgeGrab(f);
  }

  private groundAttack(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay > ax) return this.startMove(f, inp.my > 0 ? 'up' : 'down');
    if (ax > 0.5) {
      f.facing = inp.mx > 0 ? 1 : -1;
      return this.startMove(f, f.flickX <= 4 ? 'smash' : 'side');
    }
    this.startMove(f, 'jab');
  }

  private airAttack(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay >= ax) return this.startMove(f, inp.my > 0 ? 'uair' : 'dair');
    if (ax > 0.5) return this.startMove(f, Math.sign(inp.mx) === f.facing ? 'fair' : 'bair');
    this.startMove(f, 'nair');
  }

  private special(f: Fighter): void {
    const inp = f.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    if (ay > 0.5 && ay >= ax) {
      // 上必殺技は、スティックを傾けた方向へ向き直る（斜めに飛ぶ技のため）
      if (inp.my > 0 && Math.abs(inp.mx) > 0.3) f.facing = inp.mx > 0 ? 1 : -1;
      return this.startMove(f, inp.my > 0 ? 'uspecial' : 'dspecial');
    }
    if (ax > 0.5) {
      if (!f.grounded && f.sideBUsed) return;
      f.facing = inp.mx > 0 ? 1 : -1;
      if (!f.grounded) f.sideBUsed = true;
      return this.startMove(f, 'sspecial');
    }
    this.startMove(f, 'nspecial');
  }

  private startMove(f: Fighter, id: MoveId): void {
    f.move = id;
    f.moveFrame = 0;
    f.moveHit = new Set();
    f.charge = 0;
    this.setState(f, 'attack');
  }

  /** その選手が今出している技のデータ */
  private moveDef(f: Fighter): MoveDef {
    return moveOf(f.def.id, f.move!);
  }

  private updateMove(f: Fighter): void {
    const md = this.moveDef(f);
    const t = moveTiming(md, f);
    const inp = f.input;

    // スマッシュ攻撃の溜め（Aを押し続けている間）
    if (md.special === 'smash' && f.moveFrame === t.s - 3 && this.held(f, BTN_A) && f.charge < 60) {
      f.charge++;
    } else {
      f.moveFrame++;
    }
    const mf = f.moveFrame;
    const sc = f.def.scale;

    // 飛び道具（技ごとに決まったフレームで出す）
    if (md.shots) for (const spec of md.shots) if (mf === t.s + spec.at) this.spawnShot(f, spec);

    if (mf === t.s) {
      switch (md.special) {
        case 'recovery':
          f.vy = md.riseV ?? 15;
          f.vx = md.riseVx ? f.facing * md.riseVx + inp.mx * 1.5 : inp.mx * 3;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'platform':
          // ポップアップ広告：足元に窓（一時的な足場）を出して上昇
          this.removeEntities(f.slot, 'popup');
          this.addEntity('popup', f.slot, f.x, f.y - 0.05, POPUP.life);
          f.vy = md.riseV ?? 15;
          f.vx = inp.mx * 3;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'wall':
          this.removeEntities(f.slot, 'wall');
          this.addEntity('wall', f.slot, f.x + f.facing * WALL.offset * sc, f.y, WALL.life);
          break;
        case 'trap':
          this.removeEntities(f.slot, 'trap');
          this.addEntity('trap', f.slot, f.x + f.facing * 0.5 * sc, f.y, TRAP.life);
          break;
        case 'teleport': {
          this.events.push({ k: 'teleport', x: f.x, y: f.y, s: f.slot });
          f.x += f.facing * 3;
          if (!f.grounded) f.vy = 0;
          break;
        }
        case 'invis':
          f.invuln = Math.max(f.invuln, md.active);
          break;
        case 'dash':
          if (!f.grounded) f.vy = Math.max(f.vy, 1.5);
          this.events.push({ k: 'flash', x: f.x, y: f.y + 0.9 * sc, s: f.slot });
          break;
      }
    }
    const active = mf >= t.s && mf < t.s + t.a;
    if (md.special === 'dash' && active) {
      f.vx = f.facing * ((md.dashSpeed ?? 13) - (mf - t.s) * 0.4);
      if (!f.grounded) f.vy = Math.max(f.vy, -1);
    } else if ((md.special === 'recovery' || md.special === 'platform') && active) {
      if (!md.riseVx) {
        f.vx += inp.mx * 0.4;
        f.vx = Math.max(-4, Math.min(4, f.vx));
      }
    } else if (f.grounded) {
      f.vx *= 0.8;
    } else if (Math.abs(inp.mx) > 0.15) {
      f.vx += inp.mx * f.def.airAccel * 0.6 * DT;
      if (Math.abs(f.vx) > f.def.airSpeed) f.vx = Math.sign(f.vx) * f.def.airSpeed;
    }
    if (!f.grounded && f.flickY <= 2 && inp.my < -0.7 && f.vy < 3 && md.air && !md.helpless) f.fastFall = true;

    if (mf >= t.s + t.a + t.e) {
      f.move = null;
      if (md.helpless && !f.grounded) this.setState(f, 'helpless');
      else this.setState(f, f.grounded ? 'idle' : 'air');
    }
    if (!f.grounded && f.state === 'helpless') this.tryLedgeGrab(f);
  }

  private spawnShot(f: Fighter, spec: ShotSpec): void {
    const s = f.def.scale;
    this.projectiles.push({
      owner: f.slot,
      kind: spec.kind,
      x: f.x + f.facing * spec.x * s,
      y: f.y + spec.y * s,
      vx: f.facing * spec.vx,
      vy: spec.vy,
      gravity: spec.gravity ?? 0,
      life: spec.life,
      dmg: spec.dmg * f.def.dmgMul,
      base: spec.base,
      growth: spec.growth,
      angle: spec.angle,
      r: spec.r,
      hitstunMul: spec.hitstunMul ?? 1,
      poison: spec.poison ?? 0,
    });
    this.events.push({ k: 'shot', s: f.slot });
  }

  private addEntity(kind: Entity['kind'], owner: number, x: number, y: number, life: number): void {
    this.entities.push({ id: this.nextEntityId++, kind, owner, x, y, vy: 0, life, age: 0 });
  }

  private removeEntities(owner: number, kind: Entity['kind']): void {
    this.entities = this.entities.filter((e) => !(e.owner === owner && e.kind === kind));
  }

  /** 壁・罠・一時的な足場を進める */
  private updateEntities(): void {
    const m = this.stage.main;
    const keep: Entity[] = [];
    for (const e of this.entities) {
      e.life--;
      e.age++;
      if (e.life <= 0) continue;
      if (e.kind === 'trap') {
        // 罠：地面まで落ちる
        const onMain = e.x >= m.x1 && e.x <= m.x2 && Math.abs(e.y - m.top) < 0.01;
        if (!onMain) {
          const prevY = e.y;
          e.vy -= 30 * DT;
          e.y += e.vy * DT;
          if (e.x >= m.x1 && e.x <= m.x2 && prevY >= m.top && e.y <= m.top) {
            e.y = m.top;
            e.vy = 0;
          }
          for (const sp of this.stage.platforms) {
            const p = platformAt(sp, this.frame);
            if (e.x >= p.x1 && e.x <= p.x2 && prevY >= p.y && e.y <= p.y) {
              e.y = p.y;
              e.vy = 0;
            }
          }
          if (e.y < this.stage.blast.bottom) continue;
        }
        if (e.age >= TRAP.armDelay) {
          const hit = this.fighters.find((v) => v.slot !== e.owner && v.alive && v.invuln <= 0 && circleHitsBox(e.x, e.y + 0.3, TRAP.r, v));
          if (hit) {
            const owner = this.fighter(e.owner);
            const md = moveOf('hacker', 'dspecial');
            const dir = hit.x >= e.x ? 1 : -1;
            this.knock(hit, dir, md.dmg * (owner?.def.dmgMul ?? 1), md.base, md.growth, md.angle, owner?.def.kbMul ?? 1, e.owner);
            hit.hitlag = 5;
            this.events.push({ k: 'boom', x: e.x, y: e.y + 0.3 });
            this.events.push({ k: 'hit', x: e.x, y: e.y + 0.3, p: md.dmg, s: hit.slot });
            continue;
          }
        }
      } else if (e.kind === 'wall') {
        // 壁：持ち主以外の選手を押し返す
        for (const v of this.fighters) {
          if (v.slot === e.owner || !v.alive) continue;
          const half = WALL.w / 2 + v.hw;
          if (Math.abs(v.x - e.x) < half && v.y < e.y + WALL.h && v.y + v.h > e.y) {
            const side = v.x >= e.x ? 1 : -1;
            v.x = e.x + side * half;
            if (v.vx * side < 0) v.vx = 0;
          }
        }
      }
      keep.push(e);
    }
    this.entities = keep;
  }

  private respawn(f: Fighter): void {
    const idx = Math.max(0, this.setup.players.findIndex((p) => p.slot === f.slot));
    const n = this.setup.players.length;
    const span = (this.stage.main.x2 - this.stage.main.x1) * 0.6;
    f.x = n > 1 ? -span / 2 + (span * idx) / (n - 1) : 0;
    f.y = this.stage.respawnY;
    f.vx = 0;
    f.vy = 0;
    f.damage = 0;
    f.grounded = false;
    f.groundRef = -1;
    f.move = null;
    f.jumpsLeft = f.def.airJumps;
    f.sideBUsed = false;
    f.airDodgeUsed = false;
    f.shield = SHIELD_MAX;
    f.ledgeSide = 0;
    f.lastHitBy = -1;
    f.poison = 0;
    this.setState(f, 'respawn');
  }

  // ------------------------------------------------------------------
  private tryLedgeGrab(f: Fighter): void {
    if (f.vy > 0 || f.ledgeCooldown > 0 || f.grounded) return;
    const m = this.stage.main;
    for (const side of [-1, 1]) {
      const ex = side < 0 ? m.x1 : m.x2;
      const dx = (f.x - ex) * side; // 台の外側方向への距離
      if (dx < -0.15 || dx > 1.4) continue;
      if (f.y < m.top - 2.6 || f.y > m.top - 0.2) continue;
      if (this.fighters.some((o) => o !== f && o.state === 'ledge' && o.ledgeSide === side)) continue;
      f.move = null;
      this.setState(f, 'ledge');
      f.ledgeSide = side;
      f.facing = -side;
      f.x = ex + side * 0.45;
      f.y = m.top - 1.75 * f.def.scale;
      f.vx = 0;
      f.vy = 0;
      f.invuln = Math.max(f.invuln, 50);
      f.jumpsLeft = f.def.airJumps;
      f.sideBUsed = false;
      f.airDodgeUsed = false;
      f.fastFall = false;
      return;
    }
  }

  private updateLedge(f: Fighter): void {
    const m = this.stage.main;
    const side = f.ledgeSide;
    const ex = side < 0 ? m.x1 : m.x2;
    const inp = f.input;
    const drop = () => {
      f.ledgeSide = 0;
      f.ledgeCooldown = 40;
      f.grounded = false;
      this.setState(f, 'air');
    };
    if (f.stateTime > 300) return drop();
    if (f.stateTime < 8) return;
    if (this.pressed(f, BTN_JUMP)) {
      f.x = ex - side * 0.3;
      f.y = m.top + 0.05;
      f.vy = f.def.jumpV;
      f.ledgeSide = 0;
      f.ledgeCooldown = 30;
      f.grounded = false;
      this.setState(f, 'air');
      return;
    }
    if (inp.my > 0.6 || inp.mx * -side > 0.6 || this.pressed(f, BTN_A)) {
      f.x = ex - side * 0.7;
      f.y = m.top;
      f.grounded = true;
      f.groundRef = -1;
      f.ledgeSide = 0;
      f.vx = 0;
      f.vy = 0;
      f.stun = 12;
      f.invuln = Math.max(f.invuln, 12);
      this.setState(f, 'land');
      return;
    }
    if (inp.my < -0.6 || inp.mx * side > 0.6) return drop();
  }

  private collide(f: Fighter, prevX: number, prevY: number, inp: InputState): void {
    const m = this.stage.main;
    const hw = f.hw;
    const h = f.h;
    if (f.grounded) {
      if (f.groundRef < 0) {
        const keepOnEdge = f.state === 'attack' || f.state === 'shield' || f.state === 'land' || f.state === 'dodge';
        if (keepOnEdge) f.x = Math.max(m.x1, Math.min(m.x2, f.x));
        if (f.x < m.x1 || f.x > m.x2) {
          f.grounded = false;
        } else {
          f.y = m.top;
          f.vy = 0;
        }
      } else if (f.groundRef >= ENTITY_GROUND) {
        const e = this.entities.find((x) => x.id === f.groundRef - ENTITY_GROUND);
        if (!e || Math.abs(f.x - e.x) > POPUP.w / 2) {
          f.grounded = false;
          f.groundRef = -1;
        } else {
          f.y = e.y;
          f.vy = 0;
        }
      } else {
        const p = platformAt(this.stage.platforms[f.groundRef], this.frame);
        if (f.x < p.x1 || f.x > p.x2) {
          f.grounded = false;
          f.groundRef = -1;
        } else {
          f.y = p.y;
          f.vy = 0;
        }
      }
      if (!f.grounded) {
        f.groundRef = -1;
        f.jumpsLeft = f.def.airJumps;
        if (f.state === 'idle' || f.state === 'run' || f.state === 'land') this.setState(f, 'air');
        else if (f.state === 'shield' || f.state === 'dodge') this.setState(f, 'air');
      }
      return;
    }

    // 本体の台の上面に着地
    if (f.vy <= 0 && prevY >= m.top - 0.001 && f.y <= m.top && f.x >= m.x1 - 0.1 && f.x <= m.x2 + 0.1) {
      f.x = Math.max(m.x1, Math.min(m.x2, f.x));
      this.land(f, -1, m.top);
      return;
    }
    // 本体の台の側面・下面
    if (f.x + hw > m.x1 && f.x - hw < m.x2 && f.y < m.top && f.y + h > m.bottom) {
      if (prevY + h <= m.bottom + 0.001) {
        f.y = m.bottom - h;
        if (f.vy > 0) f.vy = f.state === 'hitstun' ? -f.vy * 0.5 : 0;
      } else {
        const leftSide = prevX < (m.x1 + m.x2) / 2;
        f.x = leftSide ? m.x1 - hw : m.x2 + hw;
        f.vx = f.state === 'hitstun' ? -f.vx * 0.5 : 0;
      }
    }
    // すり抜け足場
    const holdingDown = inp.my < -0.85;
    if (f.vy <= 0 && f.dropThrough <= 0 && !holdingDown) {
      for (let i = 0; i < this.stage.platforms.length; i++) {
        const p = platformAt(this.stage.platforms[i], this.frame);
        if (prevY >= p.y - 0.001 && f.y <= p.y && f.x >= p.x1 && f.x <= p.x2) {
          this.land(f, i, p.y);
          return;
        }
      }
      for (const e of this.entities) {
        if (e.kind !== 'popup') continue;
        if (prevY >= e.y - 0.001 && f.y <= e.y && Math.abs(f.x - e.x) <= POPUP.w / 2) {
          this.land(f, ENTITY_GROUND + e.id, e.y);
          return;
        }
      }
    }
  }

  private land(f: Fighter, ref: number, y: number): void {
    if (f.state === 'hitstun' && f.tumble && f.vy < -9) {
      f.y = y;
      f.vy = -f.vy * 0.4;
      return;
    }
    if (f.vy < -6) this.events.push({ k: 'land', x: f.x, y, s: f.slot, p: Math.min(1, -f.vy / 20) });
    f.y = y;
    f.vy = 0;
    f.grounded = true;
    f.groundRef = ref;
    f.fastFall = false;
    f.jumpsLeft = f.def.airJumps;
    f.sideBUsed = false;
    f.airDodgeUsed = false;
    f.ledgeSide = 0;
    switch (f.state) {
      case 'attack': {
        const md = this.moveDef(f);
        if (md.air && md.special !== 'shot' && md.special !== 'counter' && md.special !== 'invis') {
          f.move = null;
          f.stun = md.landLag ?? 4;
          this.setState(f, 'land');
        }
        break;
      }
      case 'helpless':
        f.stun = 12;
        this.setState(f, 'land');
        break;
      case 'hitstun':
        if (f.tumble) {
          f.tumble = false;
          f.hitstun = 0;
          f.stun = 20;
          this.setState(f, 'land');
        }
        break;
      case 'airdodge':
        f.stun = 10;
        this.setState(f, 'land');
        break;
      case 'air':
        f.stun = 3;
        this.setState(f, 'land');
        break;
    }
  }

  // ------------------------------------------------------------------
  private detectHits(): void {
    for (const a of this.fighters) {
      if (a.state !== 'attack' || !a.move || a.hitlag > 0) continue;
      const md = this.moveDef(a);
      if (md.hitboxes.length === 0) continue;
      const t = moveTiming(md, a);
      if (a.moveFrame < t.s || a.moveFrame >= t.s + t.a) continue;
      // 連続ヒットする技：一定フレームごとに、同じ相手にもう一度当たる
      if (md.rehit && (a.moveFrame - t.s) % md.rehit === 0) a.moveHit.clear();
      const s = a.def.scale;
      for (const hb of md.hitboxes) {
        const cx = a.x + hb.x * a.facing * s;
        const cy = a.y + hb.y * s;
        const r = hb.r * s;
        for (const v of this.fighters) {
          if (v === a || !v.alive || v.invuln > 0 || a.moveHit.has(v.slot)) continue;
          if (!circleHitsBox(cx, cy, r, v)) continue;
          if (md.special === 'grab' && !v.grounded) continue;
          a.moveHit.add(v.slot);
          this.applyHit(a, v, md, cx, cy);
        }
      }
    }
  }

  private applyHit(a: Fighter, v: Fighter, md: MoveDef, hx: number, hy: number): void {
    if (md.special === 'grab') {
      const inp = a.input;
      let angle = 40;
      let dir = a.facing;
      if (inp.mx * a.facing < -0.5) {
        angle = 40;
        dir = -a.facing;
        a.facing = dir;
      } else if (inp.my > 0.5) angle = 88;
      else if (inp.my < -0.5) angle = 75;
      this.knock(v, dir, md.dmg * a.def.dmgMul, md.base, md.growth, angle, a.def.kbMul, a.slot);
      a.hitlag = v.hitlag = 6;
      this.events.push({ k: 'hit', x: hx, y: hy, p: md.dmg, s: v.slot });
      return;
    }
    const chargeMul = 1 + (a.charge / 60) * 0.4;
    const dmg = md.dmg * a.def.dmgMul * chargeMul;
    if (this.tryCounter(v, a, dmg)) return;
    if (v.state === 'shield') {
      v.shield -= dmg * 1.3;
      v.vx = a.facing * 3;
      if (a.grounded) a.vx = -a.facing * 2;
      a.hitlag = v.hitlag = 4;
      this.events.push({ k: 'shield', x: hx, y: hy });
      if (v.shield <= 0) this.breakShield(v);
      return;
    }
    if (md.special === 'sleep') {
      // 強制アップデート：地上の相手をしばらく動けなくする（ダメージ%が高いほど長い）
      v.damage = Math.min(999, v.damage + dmg);
      v.lastHitBy = a.slot;
      v.lastHitFrame = this.frame;
      if (v.grounded) {
        v.move = null;
        v.vx = 0;
        v.stun = Math.min(150, Math.round(40 + v.damage * 0.6));
        this.setState(v, 'sleep');
        this.events.push({ k: 'sleep', x: v.x, y: v.y + v.h, s: v.slot });
      } else {
        this.knock(v, v.x >= a.x ? 1 : -1, 0, 4, 2, 60, 1, a.slot);
      }
      a.hitlag = v.hitlag = 3;
      return;
    }
    this.knock(v, a.facing, dmg, md.base, md.growth, md.angle, a.def.kbMul * chargeMul, a.slot);
    const lag = Math.floor(3 + dmg / 3);
    a.hitlag = lag;
    v.hitlag = lag;
    this.events.push({ k: 'hit', x: hx, y: hy, p: dmg, s: v.slot });
  }

  /** クレーム対応（カウンター）の構え中なら、受けた攻撃を返す */
  private tryCounter(v: Fighter, a: Fighter | null, dmg: number): boolean {
    if (v.state !== 'attack' || !v.move) return false;
    const md = this.moveDef(v);
    if (md.special !== 'counter') return false;
    const t = moveTiming(md, v);
    if (v.moveFrame < t.s || v.moveFrame >= t.s + t.a) return false;
    this.events.push({ k: 'counter', x: v.x, y: v.y + v.h * 0.6, s: v.slot });
    v.moveFrame = t.s + t.a; // 構えを終えて後隙へ
    v.invuln = Math.max(v.invuln, 12);
    if (a) {
      v.facing = a.x >= v.x ? 1 : -1;
      const back = Math.max(8, dmg * 1.3) * v.def.dmgMul;
      this.knock(a, v.facing, back, md.base, md.growth, md.angle, v.def.kbMul, v.slot);
      a.hitlag = v.hitlag = 8;
      this.events.push({ k: 'hit', x: a.x, y: a.y + a.h * 0.5, p: back, s: a.slot });
    }
    return true;
  }

  private knock(v: Fighter, dir: number, dmg: number, base: number, growth: number, angle: number, kbMul: number, from: number): void {
    v.damage = Math.min(999, v.damage + dmg);
    const speed = ((base + (growth * KB_GROWTH_SCALE * v.damage) / 100) * kbMul) / v.def.weight;
    const rad = (angle * Math.PI) / 180;
    const ax = Math.cos(rad) * dir;
    let ay = Math.sin(rad);
    if (v.grounded && ay < 0) ay = -ay * 0.6;
    v.vx = ax * speed;
    v.vy = ay * speed;
    if (v.grounded && v.vy < 3) {
      v.vy = 0;
    } else {
      v.grounded = false;
      v.groundRef = -1;
    }
    v.move = null;
    v.hitstun = Math.floor(speed * 1.4);
    v.tumble = speed > 15;
    v.fastFall = false;
    v.ledgeSide = 0;
    v.lastHitBy = from;
    v.lastHitFrame = this.frame;
    v.facing = -dir;
    this.setState(v, 'hitstun');
  }

  private updateProjectiles(): void {
    const m = this.stage.main;
    const bl = this.stage.blast;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.vy -= p.gravity * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.life--;
      let gone = p.life <= 0 || p.x < bl.left || p.x > bl.right || p.y < bl.bottom || p.y > bl.top;
      if (p.x > m.x1 && p.x < m.x2 && p.y < m.top && p.y > m.bottom) gone = true;
      // 物理ファイアウォール（持ち主以外の飛び道具を消す）
      if (!gone) {
        for (const e of this.entities) {
          if (e.kind !== 'wall' || e.owner === p.owner) continue;
          if (Math.abs(p.x - e.x) < WALL.w / 2 + p.r && p.y > e.y && p.y < e.y + WALL.h) {
            this.events.push({ k: 'shield', x: p.x, y: p.y });
            gone = true;
            break;
          }
        }
      }
      if (!gone) {
        for (const v of this.fighters) {
          if (v.slot === p.owner || !v.alive || v.invuln > 0) continue;
          if (!circleHitsBox(p.x, p.y, p.r, v)) continue;
          const dir = Math.sign(p.vx) || 1;
          if (this.tryCounter(v, null, p.dmg)) {
            // カウンターで飛び道具を打ち消した
          } else if (v.state === 'shield') {
            v.shield -= p.dmg * 1.3;
            this.events.push({ k: 'shield', x: p.x, y: p.y });
            if (v.shield <= 0) this.breakShield(v);
          } else {
            const owner = this.fighter(p.owner);
            this.knock(v, dir, p.dmg, p.base, p.growth, p.angle, owner?.def.kbMul ?? 1, p.owner);
            v.hitstun = Math.round(v.hitstun * p.hitstunMul);
            if (p.poison > 0) {
              v.poison = Math.max(v.poison, p.poison);
              v.poisonFrom = p.owner;
            }
            v.hitlag = 3;
            this.events.push({ k: 'hit', x: p.x, y: p.y, p: p.dmg, s: v.slot });
          }
          gone = true;
          break;
        }
      }
      if (!gone) keep.push(p);
    }
    this.projectiles = keep;
  }

  private checkBlast(f: Fighter): void {
    if (!f.alive) return;
    const b = this.stage.blast;
    if (f.x >= b.left && f.x <= b.right && f.y >= b.bottom && f.y <= b.top) return;
    this.events.push({
      k: 'ko',
      x: Math.max(b.left, Math.min(b.right, f.x)),
      y: Math.max(b.bottom, Math.min(b.top, f.y)),
      s: f.slot,
    });
    f.falls++;
    if (f.lastHitBy >= 0 && this.frame - f.lastHitFrame < KO_CREDIT_FRAMES) {
      const k = this.fighter(f.lastHitBy);
      if (k) k.kos++;
    }
    f.move = null;
    f.ledgeSide = 0;
    this.setState(f, 'dead');
    f.respawnTimer = 100;
    if (this.setup.rules.mode === 'stock') {
      f.stocks--;
      if (f.stocks <= 0) {
        f.out = true;
        f.outFrame = this.frame;
      }
    }
  }

  private checkEnd(): void {
    if (this.ended) return;
    const timeUp = this.frame > COUNTDOWN_FRAMES && this.timeLeftFrames <= 0;
    let over = timeUp;
    if (this.setup.rules.mode === 'stock' && this.fighters.length > 1) {
      const remaining = this.fighters.filter((f) => !f.out).length;
      if (remaining <= 1) over = true;
    }
    if (over) {
      this.ended = true;
      this.endFrame = this.frame;
    }
  }

  results(): ResultEntry[] {
    const stock = this.setup.rules.mode === 'stock';
    const entries = this.fighters.map((f) => ({
      f,
      score: stock ? f.stocks * 10000 + (f.out ? f.outFrame : 999999) - Math.floor(f.damage) / 1000 : (f.kos - f.falls) * 10000 - f.damage,
    }));
    entries.sort((a, b) => b.score - a.score);
    let rank = 0;
    let prevScore = Number.NaN;
    return entries.map((e, i) => {
      if (e.score !== prevScore) rank = i + 1;
      prevScore = e.score;
      return { slot: e.f.slot, rank, kos: e.f.kos, falls: e.f.falls, score: e.f.kos - e.f.falls };
    });
  }

  toView(): ViewState {
    return {
      frame: this.frame,
      timeLeft: this.timeLeftFrames,
      countdown: Math.max(0, COUNTDOWN_FRAMES - this.frame),
      fighters: this.fighters.map((f) => ({
        slot: f.slot,
        x: f.x,
        y: f.y,
        facing: f.facing,
        state: f.state,
        stateTime: f.stateTime,
        move: f.move,
        moveFrame: f.moveFrame,
        damage: f.damage,
        stocks: f.stocks,
        invuln: f.invuln > 0,
        shield: f.shield / SHIELD_MAX,
        charge: f.charge,
        kos: f.kos,
        falls: f.falls,
        out: f.out,
        poison: f.poison > 0,
      })),
      projectiles: this.projectiles.map((p) => ({ x: p.x, y: p.y, owner: p.owner, kind: p.kind })),
      entities: this.entities.map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, life: e.life })),
      events: this.events,
      ended: this.ended,
    };
  }
}

function circleHitsBox(cx: number, cy: number, r: number, f: Fighter): boolean {
  const nx = Math.max(f.x - f.hw, Math.min(cx, f.x + f.hw));
  const ny = Math.max(f.y, Math.min(cy, f.y + f.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export { CHARACTERS };
