// ゲーム進行の本体。端末（CPU戦）とサーバー（オンライン戦）で同じコードを使う。
// 座標は x が右、y が上。単位はおおよそメートル、速度は m/秒。1ステップ = 1/60 秒。

import { CHARACTERS, getCharacter, type CharacterDef } from './characters';
import { BIKE, CHARGE, DECOY, GIMMICK, GRAB, ITEMS, DRONE, FOOD, moveOf, PAY, PITY, POPUP, PULL, SPEEDUP, SWAP, TETHER, TRAP, WALL, type MoveDef, type ShotKind, type ShotSpec } from './moves';
import { Rng } from './rng';
import { getStage, platformAt, type StageDef } from './stages';
import {
  BTN_A,
  BTN_B,
  BTN_JUMP,
  BTN_SHIELD,
  EMPTY_INPUT,
  FX_BIKE,
  FX_CHARGED,
  FX_CONFUSED,
  FX_POWER,
  FX_SPEED,
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
  confuse: number;
  homing: number;
  boomerang: number;
  age: number;
  returning: boolean;
  /** 貫通する飛び道具（ブーメラン）が当てた相手 */
  hits: number[];
  /** 当たっても消えずに進む（ステージギミック） */
  pierce?: boolean;
}

/** ステージに置かれる物（壁・罠・一時的な足場） */
export interface Entity {
  id: number;
  kind: 'wall' | 'trap' | 'popup' | 'food' | 'decoy' | 'drone' | 'item';
  owner: number;
  x: number;
  y: number;
  vy: number;
  life: number;
  age: number;
  /** 向き（分身） */
  dir: number;
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
  'speedBuff', 'speedCd', 'powerBuff', 'bike', 'bikeHitCd', 'confused', 'chain', 'redirected', 'pity', 'crit',
  'absorbCharge', 'chargedMove', 'stale', 'runTime', 'buzz', 'recentMoves', 'learnHits', 'holdA', 'grabbing', 'grabbedBy', 'grabTimer', 'dealt', 'throws', 'tetherOn', 'tetherX', 'tetherY',
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
  // ---- キャラごとの必殺技・特性の状態
  /** 倍速再生の残り時間と、次に使えるまでの時間 */
  speedBuff = 0;
  speedCd = 0;
  /** 課金の残り時間 */
  powerBuff = 0;
  /** 自転車に乗っている残り時間 */
  bike = 0;
  /** 自転車で同じ相手に再びぶつかるまでの時間（相手の slot ごと） */
  bikeHitCd: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** 左右の操作が逆になっている残り時間 */
  confused = 0;
  /** 無限スクロールを続けた回数 */
  chain = 0;
  /** 次の動画へで方向転換したか */
  redirected = false;
  /** ガチャの外れが続いた回数（天井） */
  pity = 0;
  /** 単発ガチャが大当たりか */
  crit = false;
  /** 学習で吸収した（次の攻撃が強くなる） */
  absorbCharge = false;
  /** 今出している技が、吸収で強くなっているか */
  chargedMove = false;
  /** 弱攻撃を出してからAを押し続けている（溜め攻撃に移る） */
  holdA = false;
  /** つかんでいる相手の slot（-1 = つかんでいない） */
  grabbing = -1;
  /** つかまれている相手の slot（-1 = つかまれていない） */
  grabbedBy = -1;
  /** つかんでいられる残り時間 */
  grabTimer = 0;
  /** 成績：与えたダメージ・投げた回数 */
  dealt = 0;
  throws = 0;
  /** 飽き性：今の技の威力の倍率 */
  stale = 1;
  /** 走り続けている時間（時間指定） */
  runTime = 0;
  /** バズり段階 */
  buzz = 0;
  /** 最近出した技（飽き性） */
  recentMoves: string[] = [];
  /** 相手ごとに攻撃を受けた回数（学習データ） */
  learnHits: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
  /** API呼び出しで崖に向かっているか、その崖の位置 */
  tetherOn = false;
  tetherX = 0;
  tetherY = 0;

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
    for (const k of SNAPSHOT_KEYS) {
      if (!(k in s)) continue;
      const v = (s as unknown as Record<string, unknown>)[k];
      self[k] = Array.isArray(v) ? [...v] : v;
    }
    this.moveHit = new Set(s.moveHit ?? []);
  }

  /** ガードの最大値（警備員の特性「巡回中」は1.5倍） */
  get shieldMax(): number {
    return this.def.id === 'guard' ? SHIELD_MAX * 1.5 : SHIELD_MAX;
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
  const mul = f.def.frameMul * (f.speedBuff > 0 ? SPEEDUP.frame : 1);
  return { s: frames(md.startup, mul), a: md.active, e: frames(md.end, mul) };
}

export class Sim {
  readonly setup: MatchSetup;
  readonly stage: StageDef;
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  entities: Entity[] = [];
  private nextEntityId = 1;
  /** ガチャなどの乱数（対戦ごとに決まった値から始める） */
  private rng: Rng;
  frame = 0;
  events: GameEvent[] = [];
  ended = false;
  endFrame = 0;
  finished = false;

  /**
   * onlySlot を指定すると、その選手だけを動かす（オンライン対戦の先行表示用）。
   * 出現位置・復活位置は全員がいる場合と同じになるよう、setup の並び順で決める。
   */
  /** 先行表示用に自分だけを動かしている（ほかの選手はいない） */
  private solo = false;

  constructor(setup: MatchSetup, onlySlot?: number) {
    this.solo = onlySlot !== undefined;
    this.setup = setup;
    this.stage = getStage(setup.stageId);
    this.rng = new Rng(setup.seed ^ 0x5bd1e995);
    setup.players.forEach((p, i) => {
      if (onlySlot !== undefined && p.slot !== onlySlot) return;
      const f = new Fighter(p.slot, p.charId);
      const sp = this.stage.spawns[i % this.stage.spawns.length];
      f.x = sp.x;
      f.y = sp.y;
      f.groundRef = sp.y > this.stage.main.top ? this.findPlatformAt(sp.x, sp.y) : -1;
      f.facing = sp.x > 0 ? -1 : 1;
      f.stocks = setup.rules.mode === 'stock' ? setup.rules.stocks : 0;
      f.shield = f.shieldMax;
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
    this.fixGrabs();
    const frozen = new Set<Fighter>();
    for (const f of this.fighters) {
      if (f.hitlag > 0) {
        f.hitlag--;
        frozen.add(f);
        continue;
      }
      this.updateFighter(f);
    }
    if (playing && !this.solo) {
      this.updateItems();
      this.updateGimmick();
    }
    this.updateEntities();
    this.updateProjectiles();
    this.detectHits();
    for (const f of this.fighters) this.checkBlast(f);
    this.checkEnd();
    for (const f of this.fighters) {
      // ヒットストップで止まっていた選手は前回の入力を更新しない（押しっぱなしなら、止まりが解けた時に押したことになる）
      if (f.hitlag > 0 || frozen.has(f)) continue;
      f.prevButtons = f.input.buttons;
      f.prevMx = f.input.mx;
      f.prevMy = f.input.my;
    }
  }

  private readInput(f: Fighter, inp: InputState): void {
    // 通知爆撃：左右の操作が逆になる
    if (f.confused > 0) inp = { ...inp, mx: -inp.mx };
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
    if (f.state !== 'shield' && f.shield < f.shieldMax) f.shield = Math.min(f.shieldMax, f.shield + (f.def.id === 'guard' ? 0.12 : 0.08));
    if (f.speedBuff > 0) f.speedBuff--;
    if (f.speedCd > 0) f.speedCd--;
    if (f.powerBuff > 0) f.powerBuff--;
    if (f.confused > 0) f.confused--;
    for (let i = 0; i < f.bikeHitCd.length; i++) if (f.bikeHitCd[i] > 0) f.bikeHitCd[i]--;
    if (f.bike > 0) {
      f.bike--;
      if (!f.grounded || f.state === 'hitstun' || f.state === 'shieldbreak' || f.state === 'sleep') f.bike = 0;
    }
    // 時間指定：走り続けるほど速くなる
    if (f.state === 'run' || f.bike > 0) f.runTime++;
    else f.runTime = 0;
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
    if (f.state === 'grabbed') {
      this.updateGrabbed(f);
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
      case 'grab':
        this.updateGrab(f);
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

  /** 移動の速さの倍率（倍速再生・時間指定） */
  private speedMul(f: Fighter): number {
    let m = f.speedBuff > 0 ? SPEEDUP.speed : 1;
    if (f.def.id === 'courier') m *= 1 + Math.min(0.25, f.runTime / 240);
    return m;
  }

  /** 自転車に乗っている間の操作 */
  private bikeActions(f: Fighter): boolean {
    const inp = f.input;
    if (this.pressed(f, BTN_JUMP) || (f.flickY === 0 && inp.my > 0.7)) {
      f.bike = 0;
      this.jump(f);
      f.vy *= 1.15;
      return true;
    }
    if (this.pressed(f, BTN_A) || this.pressed(f, BTN_B) || this.held(f, BTN_SHIELD)) {
      f.bike = 0; // 降りて、そのまま普通の行動へ
      return false;
    }
    if (inp.mx * f.facing < -0.5 && f.stateTime > 10) {
      f.facing = -f.facing;
      f.vx *= 0.3;
      this.setState(f, 'run');
    }
    const target = f.facing * BIKE.speed * this.speedMul(f);
    f.vx += (target - f.vx) * 0.1;
    if (f.state !== 'run') this.setState(f, 'run');
    return true;
  }

  private groundActions(f: Fighter): void {
    const inp = f.input;
    const d = f.def;
    if (f.bike > 0 && this.bikeActions(f)) return;
    if (this.held(f, BTN_SHIELD)) {
      if (this.pressed(f, BTN_A)) return this.startMove(f, 'grab');
      if (this.tryTaunt(f)) return;
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
    const sm = this.speedMul(f);
    const target = ax > 0.65 ? inp.mx * d.runSpeed * sm : ax > 0.15 ? inp.mx * d.walkSpeed * sm : 0;
    f.vx += (target - f.vx) * (target === 0 ? 0.35 : 0.25);
    if (ax > 0.2) f.facing = inp.mx > 0 ? 1 : -1;
    const moving = Math.abs(f.vx) > 0.6 && ax > 0.15;
    if (moving && f.state !== 'run') this.setState(f, 'run');
    else if (!moving && f.state !== 'idle') this.setState(f, 'idle');
  }

  /** アピール：ガード中にスティックを上にはじく */
  private tryTaunt(f: Fighter): boolean {
    if (f.flickY <= 2 && f.input.my > 0.7 && Math.abs(f.input.mx) < 0.5) {
      this.startMove(f, 'taunt');
      return true;
    }
    return false;
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
    if (this.tryTaunt(f)) return;
    if (this.tryDodge(f)) return;
    f.shield -= 0.14;
    if (f.shield <= 0) this.breakShield(f);
  }

  private breakShield(f: Fighter): void {
    f.shield = 0;
    f.bike = 0;
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
    const maxV = d.airSpeed * (helpless ? 0.6 : 1) * (f.speedBuff > 0 ? SPEEDUP.speed : 1);
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
    // 飽き性（ドパガキ）：最近出した技ほど威力が下がる
    if (f.def.id === 'dopa') {
      const same = f.recentMoves.filter((m) => m === id).length;
      f.stale = Math.max(0.7, 1 - 0.08 * same);
      f.recentMoves.push(id);
      if (f.recentMoves.length > 5) f.recentMoves.shift();
    } else f.stale = 1;
    if (id !== 'sspecial') f.chain = 0;
    f.redirected = false;
    f.crit = false;
    f.tetherOn = false;
    // 学習で吸収していたら、この技が強くなる（吸収の構えそのものは除く）
    const md = moveOf(f.def.id, id);
    f.chargedMove = false;
    if (f.absorbCharge && md.special !== 'absorb' && (md.hitboxes.length > 0 || md.shots)) {
      f.chargedMove = true;
      f.absorbCharge = false;
    }
    f.move = id;
    f.moveFrame = 0;
    f.moveHit = new Set();
    f.charge = 0;
    f.holdA = id === 'jab';
    this.setState(f, 'attack');
  }

  /** 攻撃側の威力の倍率（課金・バズり・飽き性・吸収・単発ガチャの大当たり） */
  private powerMul(a: Fighter): { dmg: number; kb: number } {
    let dmg = a.def.dmgMul * a.stale * (1 + 0.08 * a.buzz);
    let kb = a.def.kbMul * (1 - (1 - a.stale) * 0.5);
    if (a.powerBuff > 0) {
      dmg *= PAY.dmg;
      kb *= PAY.kb;
    }
    if (a.chargedMove) {
      dmg *= 1.6;
      kb *= 1.2;
    }
    if (a.crit) {
      dmg *= 2.5;
      kb *= 1.8;
    }
    return { dmg, kb };
  }

  /** ガチャを引く：レア度 0=大外れ 1=回復 2=N 3=R 4=SR 5=SSR（天井つき） */
  private rollGacha(f: Fighter): number {
    if (f.pity >= PITY - 1) {
      f.pity = 0;
      return 5;
    }
    const r = this.rng.next();
    const rarity = r < 0.08 ? 5 : r < 0.22 ? 4 : r < 0.47 ? 3 : r < 0.72 ? 2 : r < 0.77 ? 1 : 0;
    if (rarity === 5) f.pity = 0;
    else f.pity++;
    return rarity;
  }

  private gacha10(f: Fighter): void {
    const rarity = this.rollGacha(f);
    const sc = f.def.scale;
    this.events.push({ k: 'gacha', x: f.x, y: f.y + 2 * sc, s: f.slot, r: rarity });
    const shot = (kind: ShotKind, vy: number, dmg: number, base: number, growth: number) =>
      this.spawnShot(f, { at: 0, kind, x: 0.8, y: 1.0, vx: 13, vy, life: 45, r: 0.35, dmg, base, growth, angle: 38 });
    switch (rarity) {
      case 5: {
        // SSR：周りを大爆発
        this.events.push({ k: 'boom', x: f.x, y: f.y + 0.9 * sc });
        for (const v of this.fighters) {
          if (v === f || !v.alive || v.invuln > 0) continue;
          if (Math.hypot(v.x - f.x, v.y + v.h / 2 - (f.y + 0.9 * sc)) > 2.6) continue;
          const pm = this.powerMul(f);
          this.knock(v, v.x >= f.x ? 1 : -1, 18 * pm.dmg, 8, 14, 50, pm.kb, f.slot);
          v.hitlag = 8;
          this.events.push({ k: 'hit', x: v.x, y: v.y + v.h / 2, p: 18, s: v.slot, a: f.slot });
        }
        break;
      }
      case 4:
        for (const vy of [-2.5, 0, 2.5]) shot('gold', vy, 7, 5, 7);
        break;
      case 3:
        shot('gold', 0, 7, 5, 6);
        break;
      case 2:
        shot('stone', 0, 3, 3, 3);
        break;
      case 1:
        f.damage = Math.max(0, f.damage - 15);
        this.events.push({ k: 'heal', x: f.x, y: f.y + 1.2, s: f.slot });
        break;
      default:
        // 大外れ（爆死）：自分にダメージ、少し目を回す
        f.damage = Math.min(999, f.damage + 4);
        this.events.push({ k: 'poof', x: f.x, y: f.y + 1.2 * sc });
        f.move = null;
        f.stun = 24;
        this.setState(f, 'sleep');
        break;
    }
  }

  // ------------------------------------------------------------------ アイテム（ルールでオン・オフ）
  private updateItems(): void {
    if (!this.setup.rules.items) return;
    const t = this.frame - COUNTDOWN_FRAMES;
    if (t <= 0 || t % ITEMS.interval !== 0) return;
    if (this.entities.filter((e) => e.kind === 'item').length >= ITEMS.max) return;
    const m = this.stage.main;
    const x = m.x1 + 1 + this.rng.next() * (m.x2 - m.x1 - 2);
    const kind = Math.floor(this.rng.next() * ITEMS.kinds);
    this.addEntity('item', -1, x, m.top + 9, ITEMS.life, kind);
  }

  /** アイテムの効果（0=バグ修正パッチ：回復 1=エナドリ：倍速 2=サーバーダウン：ほかの人が止まる 3=ファイアウォール：無敵） */
  private useItem(f: Fighter, kind: number): void {
    switch (kind) {
      case 0:
        f.damage = Math.max(0, f.damage - ITEMS.heal);
        break;
      case 1:
        f.speedBuff = SPEEDUP.duration;
        break;
      case 2:
        for (const v of this.fighters) if (v !== f && v.alive) v.hitlag = Math.max(v.hitlag, ITEMS.freeze);
        break;
      case 3:
        f.invuln = Math.max(f.invuln, ITEMS.invuln);
        break;
    }
  }

  // ------------------------------------------------------------------ ステージギミック（ルールでオン・オフ）
  private gimmickDir = 1;
  private gimmickX = 0;
  private updateGimmick(): void {
    if (!this.setup.rules.gimmicks) return;
    const kind = this.stage.theme.kind;
    if (kind === 'sky') return;
    const t = this.frame - COUNTDOWN_FRAMES - 300; // 始まって5秒後から
    if (t < 0) return;
    const ph = t % GIMMICK.interval;
    const m = this.stage.main;
    const cx = (m.x1 + m.x2) / 2;
    const w = m.x2 - m.x1;
    if (ph === 0) {
      // 予告
      this.gimmickDir = this.rng.next() < 0.5 ? 1 : -1;
      const alive = this.fighters.filter((f) => f.alive);
      const target = alive[Math.floor(this.rng.next() * alive.length)];
      this.gimmickX = kind === 'lab' && target ? target.x : cx;
      const y = kind === 'vault' || kind === 'arcade' ? m.top + 0.6 : kind === 'studio' ? m.top + 2.2 : m.top + 8;
      this.events.push({ k: 'warn', h: kind, x: this.gimmickX, y, d: this.gimmickDir });
      return;
    }
    if (ph < GIMMICK.warn) return;
    const shot = (kind2: ShotKind, x: number, y: number, vx: number, vy: number, gravity: number, life: number, r: number, dmg: number, base: number, growth: number, angle: number, pierce: boolean) => {
      this.projectiles.push({
        owner: -1, kind: kind2, x, y, vx, vy, gravity, life, dmg, base, growth, angle, r,
        hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [], pierce,
      });
    };
    const d = this.gimmickDir;
    const at = ph - GIMMICK.warn;
    switch (kind) {
      case 'rooftop':
        // 強風：3秒間、全員が横へ流される
        if (at < 180) {
          for (const f of this.fighters) {
            if (!f.alive || f.state === 'ledge' || f.state === 'grabbed') continue;
            f.x += d * (f.grounded ? 0.045 : 0.06);
          }
        }
        break;
      case 'vault':
        // 床の近くを横切るレーザー（ジャンプでよける）
        if (at === 0) shot('laser', d > 0 ? m.x1 - 6 : m.x2 + 6, m.top + 0.55, d * 15, 0, 0, 160, 0.35, 8, 6, 6, 70, true);
        break;
      case 'arcade':
        // 床を走り抜けるスクーター
        if (at === 0) shot('scooter', d > 0 ? m.x1 - 6 : m.x2 + 6, m.top + 0.55, d * 17, 0, 0, 160, 0.6, 10, 7, 8, 45, true);
        break;
      case 'studio':
        // 横切るコメントの弾幕（2本）
        if (at === 0) {
          shot('comment', d > 0 ? m.x1 - 6 : m.x2 + 6, m.top + 2.2, d * 11, 0, 0, 220, 0.45, 5, 5, 4, 40, true);
          shot('comment', d > 0 ? m.x1 - 12 : m.x2 + 12, m.top + 0.7, d * 11, 0, 0, 260, 0.45, 5, 5, 4, 40, true);
        }
        break;
      case 'cyber':
      case 'timeline':
      case 'gacha':
        // 上から降ってくる（データ・通知・カプセル）
        if (at % 12 === 0 && at < 72) {
          const x = m.x1 + this.rng.next() * w;
          const k: ShotKind = kind === 'cyber' ? 'packet' : kind === 'timeline' ? 'notif' : 'capsule';
          shot(k, x, m.top + 14, 0, -6, kind === 'gacha' ? 14 : 0, 200, 0.4, 5, 4, 4, 80, false);
        }
        break;
      case 'lab':
        // 予告した場所に、上から光線
        if (at === 0) for (const y of [0.6, 1.6, 2.6, 3.6]) shot('beam', this.gimmickX, m.top + y, 0, 0, 0, 22, 0.75, 8, 6, 7, 80, true);
        break;
    }
  }

  // ------------------------------------------------------------------ つかみ
  /** つかみの関係が崩れていたら（撃墜・被弾・眠りなど）両方を自由にする */
  private fixGrabs(): void {
    for (const a of this.fighters) {
      if (a.grabbing < 0) continue;
      const v = this.fighter(a.grabbing);
      const holding = a.alive && (a.state === 'grab' || (a.state === 'attack' && (a.move === 'pummel' || this.isThrow(a.move))));
      if (!v) {
        // 先行表示では相手がいないので、つかんでいるつもりのまま進める
        if (this.solo && holding) continue;
        a.grabbing = -1;
        if (a.state === 'grab') this.setState(a, 'idle');
        continue;
      }
      if (holding && v.alive && v.grabbedBy === a.slot && v.state === 'grabbed') continue;
      this.endGrab(a, v);
    }
    for (const v of this.fighters) {
      if (v.grabbedBy < 0) continue;
      const a = this.fighter(v.grabbedBy);
      if (!a) {
        if (this.solo && v.state === 'grabbed') continue;
        v.grabbedBy = -1;
        if (v.state === 'grabbed') this.setState(v, v.grounded ? 'idle' : 'air');
        continue;
      }
      if (a.grabbing !== v.slot) {
        v.grabbedBy = -1;
        if (v.state === 'grabbed') this.setState(v, v.grounded ? 'idle' : 'air');
      }
    }
  }

  private isThrow(m: MoveId | null): boolean {
    return m === 'fthrow' || m === 'bthrow' || m === 'uthrow' || m === 'dthrow';
  }

  /** つかみを終える（相手を少し押し離す） */
  private endGrab(a: Fighter, v: Fighter | undefined, push = false): void {
    a.grabbing = -1;
    if (a.state === 'grab') this.setState(a, 'idle');
    if (!v) return;
    if (v.grabbedBy === a.slot) v.grabbedBy = -1;
    if (v.state === 'grabbed') {
      this.setState(v, v.grounded ? 'idle' : 'air');
      if (push) {
        v.vx = a.facing * 6;
        a.vx = -a.facing * 3;
        v.invuln = Math.max(v.invuln, 10);
      }
    }
  }

  /** つかみが当たった：相手をつかむ */
  private startGrab(a: Fighter, v: Fighter): void {
    if (v.grabbing >= 0) this.endGrab(v, this.fighter(v.grabbing));
    a.move = null;
    a.grabbing = v.slot;
    a.grabTimer = Math.min(GRAB.max, Math.round(GRAB.base + v.damage * GRAB.perDamage));
    a.vx = 0;
    this.setState(a, 'grab');
    v.grabbedBy = a.slot;
    v.move = null;
    v.bike = 0;
    v.charge = 0;
    v.hitstun = 0;
    v.vx = 0;
    v.vy = 0;
    v.facing = -a.facing;
    v.lastHitBy = a.slot;
    v.lastHitFrame = this.frame;
    this.setState(v, 'grabbed');
    this.placeGrabbed(a, v);
    a.hitlag = v.hitlag = 4;
    this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: 1, s: v.slot, a: a.slot });
  }

  /** つかまれている人を、つかんでいる人の前に置く */
  private placeGrabbed(a: Fighter, v: Fighter): void {
    v.x = a.x + a.facing * 0.85 * a.def.scale;
    v.y = a.y;
    v.vx = 0;
    v.vy = 0;
    v.grounded = a.grounded;
    v.groundRef = a.groundRef;
  }

  /** つかんでいる間：Aでつかみ攻撃、スティックの方向へ投げる */
  private updateGrab(a: Fighter): void {
    const v = a.grabbing >= 0 ? this.fighter(a.grabbing) : undefined;
    a.vx *= 0.7;
    if (!a.grounded) return this.endGrab(a, v);
    a.grabTimer--;
    if (a.grabTimer <= 0) return this.endGrab(a, v, true);
    const inp = a.input;
    const ax = Math.abs(inp.mx);
    const ay = Math.abs(inp.my);
    // つかんだ瞬間にスティックが倒れていても、少しだけ待ってから投げる（つかみ攻撃をする余裕を作る）
    if (a.stateTime >= 6 && (ax > 0.6 || ay > 0.6)) {
      const id: MoveId = ay > ax ? (inp.my > 0 ? 'uthrow' : 'dthrow') : inp.mx * a.facing > 0 ? 'fthrow' : 'bthrow';
      return this.startMove(a, id);
    }
    if (this.pressed(a, BTN_A) && a.stateTime >= GRAB.pummelGap) return this.startMove(a, 'pummel');
  }

  /** つかまれている間：ボタンやスティックでもがくと早く抜けられる */
  private updateGrabbed(v: Fighter): void {
    const a = v.grabbedBy >= 0 ? this.fighter(v.grabbedBy) : undefined;
    if (!a) return; // 先行表示（相手がいない）
    this.placeGrabbed(a, v);
    if (v.input.buttons & ~v.prevButtons || v.flickX === 0 || v.flickY === 0) a.grabTimer -= GRAB.mash;
  }

  /** つかみ攻撃・投げの、技が出る瞬間の処理 */
  private grabMoveHit(a: Fighter, md: MoveDef): void {
    const v = a.grabbing >= 0 ? this.fighter(a.grabbing) : undefined;
    const pm = this.powerMul(a);
    if (md.special === 'pummel') {
      if (!v) return;
      const before = v.damage;
      let dmg = md.dmg * pm.dmg;
      if (v.def.id === 'ai' && a.slot < v.learnHits.length) dmg *= 1 - 0.05 * Math.min(5, v.learnHits[a.slot]);
      v.damage = Math.min(999, v.damage + dmg);
      this.lifesteal(a, v.damage - before);
      v.lastHitBy = a.slot;
      v.lastHitFrame = this.frame;
      a.hitlag = v.hitlag = 4;
      this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: 3, s: v.slot, a: a.slot });
      return;
    }
    // 投げ：後ろ投げは振り向いてから投げる
    if (a.move === 'bthrow') a.facing = -a.facing;
    a.grabbing = -1;
    if (!v) return;
    a.throws++;
    v.grabbedBy = -1;
    this.placeGrabbed(a, v);
    const before = v.damage;
    this.knock(v, a.facing, md.dmg * pm.dmg, md.base, md.growth, md.angle, pm.kb, a.slot);
    this.lifesteal(a, v.damage - before);
    a.hitlag = v.hitlag = 5;
    this.events.push({ k: 'hit', x: v.x, y: v.y + v.h * 0.6, p: md.dmg, s: v.slot, a: a.slot });
  }

  /** 崖をつかむ（API呼び出しでも使う） */
  private grabLedge(f: Fighter, side: number): void {
    const m = this.stage.main;
    const ex = side < 0 ? m.x1 : m.x2;
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
    f.tetherOn = false;
  }

  /** その選手が今出している技のデータ */
  private moveDef(f: Fighter): MoveDef {
    return moveOf(f.def.id, f.move!);
  }

  private updateMove(f: Fighter): void {
    const md = this.moveDef(f);
    const t = moveTiming(md, f);
    const inp = f.input;

    if (!this.held(f, BTN_A)) f.holdA = false;
    // スマッシュ攻撃・溜め攻撃の溜め（Aを押し続けている間）
    const maxCharge = md.special === 'smash' ? 60 : md.special === 'charge' ? CHARGE.max : 0;
    if (maxCharge && f.moveFrame === t.s - 3 && this.held(f, BTN_A) && f.charge < maxCharge) {
      f.charge++;
      // 溜め攻撃は、溜めている間に振り向ける
      if (md.special === 'charge' && Math.abs(inp.mx) > 0.5) f.facing = inp.mx > 0 ? 1 : -1;
    } else {
      f.moveFrame++;
    }
    const mf = f.moveFrame;
    const sc = f.def.scale;
    // 連続ヒットする技：技が進んだときだけ、一定フレームごとに同じ相手へもう一度当たれるようにする
    // （ヒットストップ中に同じフレームのまま何度も当たり続けないように）
    if (md.rehit && mf > t.s && (mf - t.s) % md.rehit === 0) f.moveHit.clear();

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
        case 'scroll':
          if (!f.grounded) f.vy = Math.max(f.vy, 1);
          break;
        case 'speedup':
          if (f.speedCd <= 0) {
            f.speedBuff = SPEEDUP.duration;
            f.speedCd = SPEEDUP.duration + SPEEDUP.cooldown;
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'redirect':
          f.vy = md.riseV ?? 15;
          f.vx = 0;
          f.grounded = false;
          f.groundRef = -1;
          f.fastFall = false;
          break;
        case 'gacha10':
          this.gacha10(f);
          if (f.state === 'sleep') return;
          break;
        case 'gacha1': {
          // 単発ガチャ：5回に1回、大当たり（天井つき）
          if (f.pity >= PITY - 1 || this.rng.next() < 0.2) {
            f.crit = true;
            f.pity = 0;
          } else f.pity++;
          this.events.push({ k: 'gacha', x: f.x, y: f.y + 2 * sc, s: f.slot, r: f.crit ? 5 : 2 });
          break;
        }
        case 'pay':
          // 効果中にもう一度使っても何も起きない（%も増えない）
          if (f.powerBuff <= 0) {
            f.damage = Math.min(999, f.damage + PAY.cost);
            f.powerBuff = PAY.duration;
            this.events.push({ k: 'buff', s: f.slot });
          }
          break;
        case 'bike':
          if (f.grounded) {
            f.bike = BIKE.duration;
            f.bikeHitCd.fill(0);
          }
          break;
        case 'food':
          if (!this.entities.some((e) => e.owner === f.slot && e.kind === 'food')) {
            this.addEntity('food', f.slot, f.x + f.facing * 0.6 * sc, f.y, FOOD.life);
          }
          break;
        case 'swap': {
          // なりすまし：いちばん近い相手と位置を入れ替える
          let target: Fighter | null = null;
          let best: number = SWAP.range;
          for (const v of this.fighters) {
            if (v === f || !v.alive || v.state === 'ledge') continue;
            const d = Math.hypot(v.x - f.x, v.y - f.y);
            if (d < best) {
              best = d;
              target = v;
            }
          }
          if (target) {
            const keys = ['x', 'y', 'vx', 'vy', 'grounded', 'groundRef'] as const;
            const mine = keys.map((k) => f[k]);
            this.events.push({ k: 'swap', x: f.x, y: f.y, x2: target.x, y2: target.y, s: f.slot });
            keys.forEach((k, i) => ((f as unknown as Record<string, unknown>)[k] = target![k]));
            keys.forEach((k, i) => ((target as unknown as Record<string, unknown>)[k] = mine[i]));
            target.hitlag = Math.max(target.hitlag, SWAP.freeze);
            if (!target.grounded && target.state === 'idle') this.setState(target, 'air');
          }
          break;
        }
        case 'drone':
          // エージェント起動：AIドローンを呼び出す（1機まで）
          this.removeEntities(f.slot, 'drone');
          this.addEntity('drone', f.slot, f.x - f.facing * 0.8, f.y + 2.2 * sc, DRONE.life, f.facing);
          break;
        case 'pull': {
          // 通知爆撃：周りの相手を自分のほうへ引き寄せる
          const pm = this.powerMul(f);
          for (const v of this.fighters) {
            if (v === f || !v.alive || v.invuln > 0) continue;
            const dx = f.x - v.x;
            const dy = f.y - v.y;
            const d = Math.hypot(dx, dy);
            if (d > PULL.range || d < 0.01) continue;
            if (v.state === 'shield') continue; // ガードしていれば引き寄せられない
            if (this.tryCounter(v, f, md.dmg * pm.dmg)) continue;
            const before = v.damage;
            v.damage = Math.min(999, v.damage + md.dmg * pm.dmg);
            this.lifesteal(f, v.damage - before);
            const sp = Math.min(PULL.speed, d * 4);
            v.vx = (dx / d) * sp;
            v.vy = Math.max((dy / d) * sp, 3);
            v.grounded = false;
            v.groundRef = -1;
            v.move = null;
            v.bike = 0;
            v.hitstun = 18;
            v.tumble = false;
            v.lastHitBy = f.slot;
            v.lastHitFrame = this.frame;
            this.setState(v, 'hitstun');
            this.events.push({ k: 'pull', x: v.x, y: v.y + v.h / 2, tx: f.x, ty: f.y + f.h / 2 });
          }
          break;
        }
        case 'decoy':
          this.removeEntities(f.slot, 'decoy');
          this.addEntity('decoy', f.slot, f.x, f.y, DECOY.life, f.facing);
          f.x -= f.facing * 0.8; // 本人は少し下がる
          break;
        case 'tether': {
          // いちばん近い崖に、届けばワイヤーを伸ばす
          const m = this.stage.main;
          let best = 0; // 0 = 届く崖がない、-1 = 左の崖、1 = 右の崖
          let bestD = TETHER.range;
          for (const side of [-1, 1]) {
            const ex = side < 0 ? m.x1 : m.x2;
            const outside = (f.x - ex) * side > -0.3;
            const d = Math.hypot(ex - f.x, m.top - (f.y + 1));
            if (outside && d < bestD && !this.fighters.some((o) => o !== f && o.state === 'ledge' && o.ledgeSide === side)) {
              best = side;
              bestD = d;
            }
          }
          if (best !== 0) {
            f.tetherOn = true;
            f.tetherX = best < 0 ? m.x1 : m.x2;
            f.tetherY = m.top;
          } else {
            f.vy = Math.max(f.vy, md.riseV ?? 7);
          }
          f.grounded = false;
          f.groundRef = -1;
          break;
        }
      }
    }
    // 無限スクロール：途中でBを押し直すと、最大3回まで続けて滑る
    if (md.special === 'scroll' && f.chain < 2 && mf >= t.s + 3 && this.pressed(f, BTN_B)) {
      f.chain++;
      if (Math.abs(inp.mx) > 0.5) f.facing = inp.mx > 0 ? 1 : -1;
      f.moveFrame = t.s - 1;
      f.moveHit.clear();
      return;
    }
    // 次の動画へ：途中でもう一度Bを押すと、スティックの方向へ向きを変える
    if (md.special === 'redirect' && !f.redirected && mf > t.s + 3 && mf < t.s + t.a && this.pressed(f, BTN_B)) {
      const len = Math.hypot(inp.mx, inp.my);
      const dx = len > 0.3 ? inp.mx / len : 0;
      const dy = len > 0.3 ? inp.my / len : 1;
      f.vx = dx * 16;
      f.vy = dy * 16;
      if (Math.abs(dx) > 0.2) f.facing = dx > 0 ? 1 : -1;
      f.redirected = true;
      this.events.push({ k: 'flash', x: f.x, y: f.y + 0.9 * sc, s: f.slot });
    }
    // API呼び出し：ワイヤーで崖へ引き寄せる
    if (md.special === 'tether' && f.tetherOn && mf >= t.s) {
      const tx = f.tetherX + (f.tetherX < 0 ? -0.45 : 0.45);
      const ty = f.tetherY - 1.75 * sc;
      const dx = tx - f.x;
      const dy = ty - f.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.9) {
        this.grabLedge(f, f.tetherX < 0 ? -1 : 1);
        return;
      }
      f.vx = (dx / d) * TETHER.speed;
      f.vy = (dy / d) * TETHER.speed;
    }
    const active = mf >= t.s && mf < t.s + t.a;
    if ((md.special === 'dash' || md.special === 'scroll') && active) {
      f.vx = f.facing * ((md.dashSpeed ?? 13) - (mf - t.s) * 0.4);
      if (!f.grounded) f.vy = Math.max(f.vy, -1);
    } else if ((md.special === 'redirect' && active) || (md.special === 'tether' && f.tetherOn)) {
      // 速さは技の処理で決めている
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

    if (md.special === 'taunt' && mf === t.s) this.events.push({ k: 'taunt', s: f.slot, i: this.frame % 3 });
    // つかみ攻撃・投げ
    if (md.special === 'pummel' || md.special === 'throw') {
      if (md.special === 'pummel') f.grabTimer--;
      if (mf === t.s) this.grabMoveHit(f, md);
      if (f.grabbing >= 0) {
        const v = this.fighter(f.grabbing);
        if (v) this.placeGrabbed(f, v);
      }
    }
    if (mf >= t.s + t.a + t.e) {
      // つかみ攻撃のあとは、まだつかんでいる
      if (md.special === 'pummel' && f.grabbing >= 0) {
        f.move = null;
        this.setState(f, 'grab');
        f.stateTime = GRAB.pummelGap;
        if (f.grabTimer <= 0) this.endGrab(f, this.fighter(f.grabbing), true);
        return;
      }
      // 弱攻撃のあともAを押し続けていたら、溜め攻撃に移る
      if (f.move === 'jab' && f.holdA && f.grounded && f.state === 'attack') {
        this.startMove(f, 'charge');
        return;
      }
      f.move = null;
      if (md.helpless && !f.grounded) this.setState(f, 'helpless');
      else this.setState(f, f.grounded ? 'idle' : 'air');
    }
    if (!f.grounded && f.state === 'helpless') this.tryLedgeGrab(f);
  }

  private spawnShot(f: Fighter, spec: ShotSpec): void {
    const s = f.def.scale;
    // 配達バッグは1つまで（戻ってくるまで投げられない）
    if (spec.boomerang && this.projectiles.some((p) => p.owner === f.slot && p.boomerang)) return;
    const pm = this.powerMul(f);
    this.projectiles.push({
      owner: f.slot,
      kind: spec.kind,
      x: f.x + f.facing * spec.x * s,
      y: f.y + spec.y * s,
      vx: f.facing * spec.vx,
      vy: spec.vy,
      gravity: spec.gravity ?? 0,
      life: spec.life,
      dmg: spec.dmg * pm.dmg,
      base: spec.base,
      growth: spec.growth,
      angle: spec.angle,
      r: spec.r,
      hitstunMul: spec.hitstunMul ?? 1,
      poison: spec.poison ?? 0,
      confuse: spec.confuse ?? 0,
      homing: spec.homing ?? 0,
      boomerang: spec.boomerang ?? 0,
      age: 0,
      returning: false,
      hits: [],
    });
    this.events.push({ k: 'shot', s: f.slot });
  }

  private addEntity(kind: Entity['kind'], owner: number, x: number, y: number, life: number, dir = 1): void {
    this.entities.push({ id: this.nextEntityId++, kind, owner, x, y, vy: 0, life, age: 0, dir });
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
      if (e.kind === 'item') {
        // アイテム：落ちてきて床に止まり、触れた人が拾う
        const prevY = e.y;
        e.vy = Math.max(-12, e.vy - 25 * DT);
        e.y += e.vy * DT;
        if (e.x >= m.x1 && e.x <= m.x2 && prevY >= m.top && e.y <= m.top) {
          e.y = m.top;
          e.vy = 0;
        }
        for (const sp of this.stage.platforms) {
          const p = platformAt(sp, this.frame);
          if (e.x >= p.x1 && e.x <= p.x2 && prevY >= p.prevY - 0.001 && e.y <= p.y) {
            e.y = p.y;
            e.vy = 0;
          }
        }
        if (e.y < this.stage.blast.bottom) continue;
        const taker = this.fighters.find((v) => v.alive && v.state !== 'grabbed' && circleHitsBox(e.x, e.y + 0.35, 0.55, v));
        if (taker) {
          this.useItem(taker, e.dir);
          this.events.push({ k: 'item', s: taker.slot, t: e.dir, x: e.x, y: e.y + 0.4 });
          continue;
        }
        keep.push(e);
        continue;
      }
      if (e.kind === 'trap' || e.kind === 'food' || e.kind === 'decoy') {
        // 罠・料理・分身：地面まで落ちる
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
            if (e.x >= p.x1 && e.x <= p.x2 && prevY >= p.prevY - 0.001 && e.y <= p.y) {
              e.y = p.y;
              e.vy = 0;
            }
          }
          if (e.y < this.stage.blast.bottom) continue;
        }
        if (e.kind === 'food') {
          // 置き配：誰でも拾える（置いた本人は少し時間がたってから）
          const eater = this.fighters.find(
            (v) => v.alive && (v.slot !== e.owner || e.age >= FOOD.selfDelay) && circleHitsBox(e.x, e.y + 0.3, FOOD.r, v),
          );
          if (eater) {
            eater.damage = Math.max(0, eater.damage - FOOD.heal);
            this.events.push({ k: 'heal', x: eater.x, y: eater.y + eater.h, s: eater.slot });
            continue;
          }
        } else if (e.kind === 'trap' && e.age >= TRAP.armDelay) {
          const hit = this.fighters.find((v) => v.slot !== e.owner && v.alive && v.invuln <= 0 && circleHitsBox(e.x, e.y + 0.3, TRAP.r, v));
          if (hit) {
            const owner = this.fighter(e.owner);
            const md = moveOf('hacker', 'dspecial');
            const dir = hit.x >= e.x ? 1 : -1;
            this.knock(hit, dir, md.dmg * (owner?.def.dmgMul ?? 1), md.base, md.growth, md.angle, owner?.def.kbMul ?? 1, e.owner);
            hit.hitlag = 5;
            this.events.push({ k: 'boom', x: e.x, y: e.y + 0.3 });
            this.events.push({ k: 'hit', x: e.x, y: e.y + 0.3, p: md.dmg, s: hit.slot, a: e.owner });
            continue;
          }
        }
      } else if (e.kind === 'drone') {
        // エージェント起動：持ち主のそばを飛び、近くの相手を自動で撃つ
        const o = this.fighter(e.owner);
        if (!o || !o.alive) continue;
        const tx = o.x - o.facing * 0.9;
        const ty = o.y + 2.2 * o.def.scale;
        e.x += (tx - e.x) * 0.12;
        e.y += (ty - e.y) * 0.12;
        e.dir = o.facing;
        if (e.age % DRONE.interval === 0) {
          let target: Fighter | null = null;
          let best: number = DRONE.range;
          for (const v of this.fighters) {
            if (v.slot === e.owner || !v.alive) continue;
            const d = Math.hypot(v.x - e.x, v.y + v.h / 2 - e.y);
            if (d < best) {
              best = d;
              target = v;
            }
          }
          if (target) {
            const dx = target.x - e.x;
            const dy = target.y + target.h / 2 - e.y;
            const d = Math.hypot(dx, dy) || 1;
            const pm = this.powerMul(o);
            this.projectiles.push({
              owner: e.owner, kind: 'spark', x: e.x, y: e.y, vx: (dx / d) * 13, vy: (dy / d) * 13, gravity: 0, life: 40,
              dmg: 3 * pm.dmg, base: 3, growth: 3, angle: 45, r: 0.22, hitstunMul: 1, poison: 0, confuse: 0, homing: 0, boomerang: 0, age: 0, returning: false, hits: [],
            });
            this.events.push({ k: 'shot', s: e.owner });
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
    f.shield = f.shieldMax;
    f.ledgeSide = 0;
    f.lastHitBy = -1;
    f.poison = 0;
    f.speedBuff = 0;
    f.powerBuff = 0;
    f.bike = 0;
    f.confused = 0;
    f.absorbCharge = false;
    f.recentMoves = [];
    f.learnHits = f.learnHits.map(() => 0);
    f.runTime = 0;
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
      this.grabLedge(f, side);
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
        // 上下に動く足場もあるので、前のフレームの足場の高さと比べる
        if (prevY >= p.prevY - 0.001 && f.y <= p.y && f.x >= p.x1 && f.x <= p.x2) {
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
    // 自転車：走っている自転車にぶつかった相手にダメージ
    for (const a of this.fighters) {
      if (a.bike <= 0 || Math.abs(a.vx) < 6 || a.hitlag > 0) continue;
      const md = moveOf(a.def.id, 'sspecial');
      const cx = a.x + a.facing * 0.6 * a.def.scale;
      const cy = a.y + 0.6 * a.def.scale;
      for (const v of this.fighters) {
        if (v === a || !v.alive || v.invuln > 0 || a.bikeHitCd[v.slot] > 0) continue;
        if (!circleHitsBox(cx, cy, 0.7, v)) continue;
        a.bikeHitCd[v.slot] = BIKE.hitCooldown;
        this.applyHit(a, v, md, cx, cy);
      }
    }
    for (const a of this.fighters) {
      if (a.state !== 'attack' || !a.move || a.hitlag > 0) continue;
      const md = this.moveDef(a);
      if (md.hitboxes.length === 0) continue;
      const t = moveTiming(md, a);
      if (a.moveFrame < t.s || a.moveFrame >= t.s + t.a) continue;

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
          if (a.state !== 'attack') break; // つかんだら、ほかの人には当たらない
        }
        // ハルシネーション：分身を攻撃した相手は目を回す
        for (const e of this.entities) {
          // エージェント起動のドローン：攻撃を当てると壊れる
          if (e.kind === 'drone' && e.owner !== a.slot && e.life > 0 && Math.hypot(cx - e.x, cy - e.y) < r + 0.35) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y });
            continue;
          }
          if (e.kind !== 'decoy' || e.owner === a.slot || e.life <= 0) continue;
          const nx = Math.max(e.x - 0.42, Math.min(cx, e.x + 0.42));
          const ny = Math.max(e.y, Math.min(cy, e.y + 1.8));
          if ((cx - nx) ** 2 + (cy - ny) ** 2 > r * r) continue;
          e.life = 0;
          this.events.push({ k: 'poof', x: e.x, y: e.y + 0.9 });
          a.move = null;
          a.vx = 0;
          a.stun = DECOY.dizzy;
          this.setState(a, 'sleep');
          this.events.push({ k: 'sleep', x: a.x, y: a.y + a.h, s: a.slot });
          break;
        }
        if (a.state !== 'attack') break;
      }
    }
    this.entities = this.entities.filter((e) => e.life > 0);
  }

  private applyHit(a: Fighter, v: Fighter, md: MoveDef, hx: number, hy: number): void {
    if (md.special === 'grab') {
      // つかみ：ガードしていてもつかめる。すでに誰かにつかまれている人はつかめない
      if (v.grabbedBy >= 0) return;
      this.startGrab(a, v);
      return;
    }
    const chargeMul = md.special === 'charge' ? 1 + (a.charge / CHARGE.max) * (CHARGE.mul - 1) : 1 + (a.charge / 60) * 0.4;
    const pm = this.powerMul(a);
    const dmg = md.dmg * pm.dmg * chargeMul;
    if (this.tryCounter(v, a, dmg)) return;
    if (v.state === 'shield') {
      // ゼロデイ（ハッカー）：ガードを削る力が2倍
      v.shield -= dmg * 1.3 * (a.def.id === 'hacker' ? 2 : 1);
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
    const before = v.damage;
    this.knock(v, a.facing, dmg, md.base, md.growth, md.angle, pm.kb * chargeMul, a.slot);
    this.lifesteal(a, v.damage - before);
    if (a.crit) this.events.push({ k: 'flash', x: hx, y: hy, s: a.slot });
    const lag = Math.floor(3 + dmg / 3);
    a.hitlag = lag;
    v.hitlag = lag;
    this.events.push({ k: 'hit', x: hx, y: hy, p: dmg, s: v.slot, a: a.slot });
  }

  /** 抜き取り（データ泥棒）：与えたダメージの1/4だけ回復 */
  private lifesteal(a: Fighter | undefined, dealt: number): void {
    if (!a || a.def.id !== 'thief' || dealt <= 0) return;
    a.damage = Math.max(0, a.damage - dealt * 0.25);
  }

  /** 学習（AIエンジニア）の構え中なら、飛び道具を吸収する */
  private tryAbsorb(v: Fighter, p: Projectile): boolean {
    if (v.state !== 'attack' || !v.move) return false;
    const md = this.moveDef(v);
    if (md.special !== 'absorb') return false;
    const t = moveTiming(md, v);
    if (v.moveFrame < t.s || v.moveFrame >= t.s + t.a) return false;
    v.absorbCharge = true;
    this.events.push({ k: 'absorb', x: p.x, y: p.y, s: v.slot });
    return true;
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
      this.events.push({ k: 'hit', x: a.x, y: a.y + a.h * 0.5, p: back, s: a.slot, a: v.slot });
    }
    return true;
  }

  private knock(v: Fighter, dir: number, dmg: number, base: number, growth: number, angle: number, kbMul: number, from: number): void {
    // 学習データ（AIエンジニア）：同じ相手からの攻撃ほどダメージが減る
    if (v.def.id === 'ai' && from >= 0 && from < v.learnHits.length) {
      dmg *= 1 - 0.05 * Math.min(5, v.learnHits[from]);
      v.learnHits[from]++;
    }
    v.bike = 0;
    // つかんでいる人・つかまれている人が攻撃されたら、つかみは解ける
    if (v.grabbing >= 0) this.endGrab(v, this.fighter(v.grabbing));
    if (v.grabbedBy >= 0) {
      const g = this.fighter(v.grabbedBy);
      if (g && g.grabbing === v.slot) g.grabbing = -1;
      if (g && g.state === 'grab') this.setState(g, 'idle');
      v.grabbedBy = -1;
    }
    v.damage = Math.min(999, v.damage + dmg);
    if (from >= 0 && from !== v.slot) {
      const att = this.fighter(from);
      if (att) att.dealt += dmg;
    }
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
    if (speed > 14 && this.willBeKO(v)) this.events.push({ k: 'finish', x: v.x, y: v.y + v.h / 2, s: v.slot });
  }

  /**
   * このふっとびで場外まで飛ぶか（演出用の予測）。ひるみ中の動き（空気抵抗・重力）をそのまま先まで計算し、
   * 自分で動けるようになる直後（5フレーム）までに場外の線を越えれば撃墜とみなす。台にぶつかる場合は撃墜にならない。
   */
  private willBeKO(v: Fighter): boolean {
    const b = this.stage.blast;
    const m = this.stage.main;
    const d = v.def;
    let x = v.x;
    let y = v.y;
    let vx = v.vx;
    let vy = v.vy;
    const frames = v.hitstun + 5;
    for (let i = 0; i < frames; i++) {
      vx *= HITSTUN_DRAG;
      vy -= d.gravity * DT;
      if (vy < -d.fallMax * 2) vy = -d.fallMax * 2;
      const px = x;
      const py = y;
      x += vx * DT;
      y += vy * DT;
      if (x < b.left || x > b.right || y < b.bottom || y > b.top) return true;
      // 台の上に落ちる・台の横や下にぶつかる
      if (x >= m.x1 && x <= m.x2 && ((py >= m.top && y <= m.top) || (y < m.top && y + v.h > m.bottom))) return false;
      if (px < m.x1 !== x < m.x1 && y < m.top && y > m.bottom - v.h) return false;
      if (px > m.x2 !== x > m.x2 && y < m.top && y > m.bottom - v.h) return false;
    }
    return false;
  }

  private updateProjectiles(): void {
    const m = this.stage.main;
    const bl = this.stage.blast;
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      p.age++;
      if (p.homing > 0) {
        // 推論：いちばん近い相手（分身も含む）へ曲がる
        let tx = 0;
        let ty = 0;
        let best = Infinity;
        for (const v of this.fighters) {
          if (v.slot === p.owner || !v.alive) continue;
          const d = Math.hypot(v.x - p.x, v.y + v.h / 2 - p.y);
          if (d < best) {
            best = d;
            tx = v.x;
            ty = v.y + v.h / 2;
          }
        }
        if (best < Infinity) {
          const sp = Math.hypot(p.vx, p.vy) || 6.5;
          const d = Math.hypot(tx - p.x, ty - p.y) || 1;
          p.vx += ((tx - p.x) / d) * sp * p.homing;
          p.vy += ((ty - p.y) / d) * sp * p.homing;
          const n = Math.hypot(p.vx, p.vy) || 1;
          p.vx = (p.vx / n) * sp;
          p.vy = (p.vy / n) * sp;
        }
      }
      if (p.boomerang > 0) {
        // 配達バッグ：一定時間で持ち主のところへ戻ってくる
        if (!p.returning && p.age >= p.boomerang) {
          p.returning = true;
          p.hits = [];
        }
        if (p.returning) {
          const o = this.fighter(p.owner);
          if (!o || !o.alive) p.life = 0;
          else {
            const tx = o.x;
            const ty = o.y + o.h / 2;
            const d = Math.hypot(tx - p.x, ty - p.y);
            if (d < 0.7) p.life = 0;
            else {
              p.vx = ((tx - p.x) / d) * 14;
              p.vy = ((ty - p.y) / d) * 14;
            }
          }
        } else p.vx *= 0.96;
      }
      p.vy -= p.gravity * DT;
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      p.life--;
      let gone = p.life <= 0 || p.x < bl.left || p.x > bl.right || p.y < bl.bottom || p.y > bl.top;
      if (p.x > m.x1 && p.x < m.x2 && p.y < m.top && p.y > m.bottom && !p.returning) gone = true;
      // 分身・ドローンに当たると、一緒に消える
      if (!gone) {
        for (const e of this.entities) {
          if (e.kind === 'drone' && e.owner !== p.owner && Math.hypot(p.x - e.x, p.y - e.y) < p.r + 0.35) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y });
            gone = true;
            break;
          }
          if (e.kind !== 'decoy' || e.owner === p.owner) continue;
          if (Math.abs(p.x - e.x) < 0.42 + p.r && p.y > e.y && p.y < e.y + 1.8) {
            e.life = 0;
            this.events.push({ k: 'poof', x: e.x, y: e.y + 0.9 });
            gone = true;
            break;
          }
        }
      }
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
          if (v.slot === p.owner || !v.alive || v.invuln > 0 || p.hits.includes(v.slot)) continue;
          if (!circleHitsBox(p.x, p.y, p.r, v)) continue;
          const dir = Math.sign(p.vx) || 1;
          if (this.tryAbsorb(v, p)) {
            // 学習で吸収した
          } else if (this.tryCounter(v, null, p.dmg)) {
            // カウンターで飛び道具を打ち消した
          } else if (v.state === 'shield') {
            const owner = this.fighter(p.owner);
            v.shield -= p.dmg * 1.3 * (owner?.def.id === 'hacker' ? 2 : 1);
            this.events.push({ k: 'shield', x: p.x, y: p.y });
            if (v.shield <= 0) this.breakShield(v);
          } else {
            const owner = this.fighter(p.owner);
            const before = v.damage;
            this.knock(v, dir, p.dmg, p.base, p.growth, p.angle, owner ? this.powerMul(owner).kb : 1, p.owner);
            this.lifesteal(owner, v.damage - before);
            v.hitstun = Math.round(v.hitstun * p.hitstunMul);
            if (p.confuse > 0) v.confused = Math.max(v.confused, p.confuse);
            if (p.poison > 0) {
              v.poison = Math.max(v.poison, p.poison);
              v.poisonFrom = p.owner;
            }
            v.hitlag = 3;
            this.events.push({ k: 'hit', x: p.x, y: p.y, p: p.dmg, s: v.slot, a: p.owner });
          }
          // ブーメランとステージギミックは当たっても消えずに進む
          if (p.boomerang > 0 || p.pierce) {
            p.hits.push(v.slot);
            continue;
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
      if (k) {
        k.kos++;
        // バズり（配信者）：撃墜するたびに攻撃力アップ
        if (k.def.id === 'streamer') k.buzz = Math.min(3, k.buzz + 1);
      }
    }
    f.buzz = 0;
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
      return { slot: e.f.slot, rank, kos: e.f.kos, falls: e.f.falls, score: e.f.kos - e.f.falls, dealt: Math.round(e.f.dealt), throws: e.f.throws };
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
        shield: f.shield / f.shieldMax,
        charge: f.charge,
        kos: f.kos,
        falls: f.falls,
        out: f.out,
        poison: f.poison > 0,
        fx:
          (f.speedBuff > 0 ? FX_SPEED : 0) |
          (f.powerBuff > 0 ? FX_POWER : 0) |
          (f.bike > 0 ? FX_BIKE : 0) |
          (f.confused > 0 ? FX_CONFUSED : 0) |
          (f.absorbCharge ? FX_CHARGED : 0) |
          (f.buzz << 5),
      })),
      projectiles: this.projectiles.map((p) => ({ x: p.x, y: p.y, owner: p.owner, kind: p.kind })),
      entities: this.entities.map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, life: e.life, dir: e.dir })),
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
