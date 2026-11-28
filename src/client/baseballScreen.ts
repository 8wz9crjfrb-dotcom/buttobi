// 野球の画面：球場・ピッチャー視点とバッター視点・打球を追う視点・スコアボード・操作の案内。
// 計算は shared/baseball.ts。ここは見た目と、操作を計算に渡すだけ。

import * as THREE from 'three';
import { getCharacter, TEAM_COLORS } from '../shared/characters';
import { getCostume } from '../shared/costumes';
import { Baseball, BAT_SKILLS, BB, BBCpu, BB_RESULT_NAMES, bbRep, bbStats, pitchKmh, pitchShift, PITCH_KINDS, PITCH_NAMES, PITCH_SKILLS, type BBPlayer, type BBSetup, type PitchKind } from '../shared/baseball';
import { BTN_B } from '../shared/types';
import type { InputState, ViewFighter } from '../shared/types';
import { FighterModel } from './fighterModel';

/** 画面に出すときに呼ぶもの（音・終わったとき） */
export interface BBHooks {
  sound: (kind: 'pitch' | 'swing' | 'hit' | 'strike' | 'ball' | 'homer' | 'cheer' | 'out' | 'end') => void;
  onEnd: (g: Baseball, mySlot: number) => void;
  /** ボタンの名前を、投げる・打つに合わせて変える */
  setPad: (role: 'bat' | 'pitch' | 'none') => void;
}

const FIELD_GREEN = 0x4caf50;
const DIRT = 0xc6925c;

function flatMat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

export class BaseballScreen {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
  game: Baseball;
  private cpu: BBCpu;
  readonly mySlot: number;
  private hooks: BBHooks;
  private ui: HTMLElement;
  private models = new Map<number, { model: FighterModel; charId: string }>();
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh;
  private cursorRing: THREE.Mesh;
  private batShape!: THREE.Group;
  private batSweet!: THREE.Mesh;
  /** 変化の道筋（狙いの印から、曲がって来る所まで）の点と、来る所のボール */
  private breakDots: THREE.Mesh[] = [];
  private breakEnd!: THREE.Mesh;
  /** 打つとき：球がホームベースに来る所の予告（来る直前に出る） */
  private arrive!: THREE.Group;
  /** 球種を選んでいるところ（投げる番の最初と、「球種選択」を押したとき） */
  private selecting = false;
  private lastAimPa = '';
  private prevB = false;
  private aimMark: THREE.Group;
  private zoneFrame: THREE.LineSegments;
  private time = 0;
  private acc = 0;
  /** 打球を追うカメラの位置（なめらかに動かす） */
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private msgT = 0;
  private swingT = -1;
  private pitchAnimT = -1;
  private disposables: { dispose(): void }[] = [];
  /** 球の通り道の残像 */
  private trail: THREE.Mesh[] = [];
  private trailPos: THREE.Vector3[] = [];
  private ended = false;

  constructor(setup: BBSetup, mySlot: number, hooks: BBHooks, uiRoot: HTMLElement) {
    this.game = new Baseball(setup);
    this.cpu = new BBCpu(setup.seed);
    this.mySlot = mySlot;
    this.hooks = hooks;
    // ---- 球場
    const s = this.scene;
    s.background = new THREE.Color(0x7cc4ff);
    s.fog = new THREE.Fog(0x9fd4ff, 120, 260);
    s.add(new THREE.HemisphereLight(0xffffff, 0x4a6040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-30, 60, -20);
    s.add(sun);
    const add = <T extends THREE.Object3D>(o: T): T => {
      s.add(o);
      if (o instanceof THREE.Mesh) this.disposables.push(o.geometry, o.material as THREE.Material);
      return o;
    };
    // 芝生（扇形の外野まで）
    const grass = add(new THREE.Mesh(new THREE.CircleGeometry(160, 64), flatMat(FIELD_GREEN)));
    grass.rotation.x = -Math.PI / 2;
    // 芝生のしま模様
    for (let i = 0; i < 8; i++) {
      const stripe = add(new THREE.Mesh(new THREE.PlaneGeometry(200, 6), flatMat(0x45a349)));
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(0, 0.005, 14 + i * 12);
    }
    // 内野の土（ダイヤモンド）
    const infield = add(new THREE.Mesh(new THREE.PlaneGeometry(30, 30), flatMat(DIRT)));
    infield.rotation.x = -Math.PI / 2;
    infield.rotation.z = Math.PI / 4;
    infield.position.set(0, 0.01, 19);
    const innerGrass = add(new THREE.Mesh(new THREE.PlaneGeometry(19, 19), flatMat(FIELD_GREEN)));
    innerGrass.rotation.x = -Math.PI / 2;
    innerGrass.rotation.z = Math.PI / 4;
    innerGrass.position.set(0, 0.015, 19);
    // マウンドとバッターボックスのまわりの土
    const mound = add(new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 0.25, 32), flatMat(DIRT)));
    mound.position.set(0, 0.1, BB.releaseZ + 0.6);
    const homeDirt = add(new THREE.Mesh(new THREE.CircleGeometry(4, 32), flatMat(DIRT)));
    homeDirt.rotation.x = -Math.PI / 2;
    homeDirt.position.set(0, 0.02, 0.2);
    // ホームベース（五角形）とベース
    const plateShape = new THREE.Shape();
    plateShape.moveTo(-0.22, 0);
    plateShape.lineTo(0.22, 0);
    plateShape.lineTo(0.22, 0.22);
    plateShape.lineTo(0, 0.43);
    plateShape.lineTo(-0.22, 0.22);
    plateShape.closePath();
    const plate = add(new THREE.Mesh(new THREE.ShapeGeometry(plateShape), flatMat(0xffffff)));
    plate.rotation.x = -Math.PI / 2;
    plate.rotation.z = Math.PI;
    plate.position.set(0, 0.03, 0.43);
    for (const [x, z] of [[19.4, 19.4], [0, 38.8], [-19.4, 19.4]] as const) {
      const bag = add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.45), flatMat(0xffffff)));
      bag.position.set(x * 0.73, 0.06, z * 0.73);
      bag.rotation.y = Math.PI / 4;
    }
    // ファウルライン
    for (const side of [-1, 1]) {
      const line = add(new THREE.Mesh(new THREE.PlaneGeometry(0.12, 110), flatMat(0xffffff)));
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = (side * Math.PI) / 4;
      line.position.set(side * 38.9, 0.03, 38.9);
    }
    // バッターボックスの白線
    for (const side of [-1, 1]) {
      const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.9, 1.8));
      const box = add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff })));
      this.disposables.push(g);
      box.rotation.x = -Math.PI / 2;
      box.position.set(side * 0.85, 0.04, 0.2);
    }
    // 外野のフェンス（打球の向きで距離が変わる）と、その上の観客席
    const fenceMat = flatMat(0x1f5d3a);
    const standMat = flatMat(0x5a6d96);
    this.disposables.push(fenceMat, standMat);
    for (let deg = -BB.foulDeg; deg < BB.foulDeg; deg += 3) {
      const a0 = (deg * Math.PI) / 180;
      const a1 = ((deg + 3) * Math.PI) / 180;
      const r0 = this.game.fenceAt(deg);
      const r1 = this.game.fenceAt(deg + 3);
      const x0 = Math.sin(a0) * r0;
      const z0 = Math.cos(a0) * r0;
      const x1 = Math.sin(a1) * r1;
      const z1 = Math.cos(a1) * r1;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const geo = new THREE.BoxGeometry(len + 0.05, 3, 0.4);
      this.disposables.push(geo);
      const seg = new THREE.Mesh(geo, fenceMat);
      seg.position.set((x0 + x1) / 2, 1.5, (z0 + z1) / 2);
      seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      s.add(seg);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 7, 8), standMat);
      this.disposables.push(stand.geometry);
      stand.position.set(((x0 + x1) / 2) * 1.08, 4.5, ((z0 + z1) / 2) * 1.08);
      stand.rotation.y = seg.rotation.y;
      s.add(stand);
    }
    // 観客（色の点）
    const crowdGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    this.disposables.push(crowdGeo);
    const crowdCols = [0xff7eb6, 0xffd23f, 0x4f9dff, 0xffffff, 0x4fd18b, 0xff5a5a];
    const crowdMats = crowdCols.map((c) => flatMat(c));
    this.disposables.push(...crowdMats);
    for (let i = 0; i < 220; i++) {
      const deg = -BB.foulDeg + Math.random() * BB.foulDeg * 2;
      const a = (deg * Math.PI) / 180;
      const r = this.game.fenceAt(deg) * 1.08 + 3.5 + Math.random() * 3;
      const m = new THREE.Mesh(crowdGeo, crowdMats[i % crowdMats.length]);
      m.position.set(Math.sin(a) * r, 8.3 + Math.random() * 0.8, Math.cos(a) * r);
      s.add(m);
    }
    // ボール（赤い縫い目つき。回転が見えるように）と影
    const seam = document.createElement('canvas');
    seam.width = 256;
    seam.height = 128;
    const sc = seam.getContext('2d')!;
    sc.fillStyle = '#ffffff';
    sc.fillRect(0, 0, 256, 128);
    sc.strokeStyle = '#d42b2b';
    sc.lineWidth = 9;
    for (const off of [0, 128]) {
      sc.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = (i / 64) * 128 + off;
        const v = 64 + Math.sin((i / 64) * Math.PI * 2) * 34 * (off ? -1 : 1);
        if (i === 0) sc.moveTo(u, v);
        else sc.lineTo(u, v);
      }
      sc.stroke();
    }
    const seamTex = new THREE.CanvasTexture(seam);
    seamTex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(seamTex);
    this.ball = add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshBasicMaterial({ map: seamTex })));
    // 球の通り道（うすい残像）：曲がり方が分かるように
    const trailGeo = new THREE.SphereGeometry(0.07, 10, 8);
    this.disposables.push(trailGeo);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 * (1 - i / 14), depthWrite: false });
      this.disposables.push(mat);
      const m = new THREE.Mesh(trailGeo, mat);
      m.visible = false;
      s.add(m);
      this.trail.push(m);
    }
    this.ballShadow = add(new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })));
    this.ballShadow.rotation.x = -Math.PI / 2;
    // ストライクゾーンの枠
    const z = BB.zone;
    const pts = [
      [-z.x, z.y1], [z.x, z.y1], [z.x, z.y1], [z.x, z.y2], [z.x, z.y2], [-z.x, z.y2], [-z.x, z.y2], [-z.x, z.y1],
      [-z.x / 3, z.y1], [-z.x / 3, z.y2], [z.x / 3, z.y1], [z.x / 3, z.y2],
      [-z.x, z.y1 + (z.y2 - z.y1) / 3], [z.x, z.y1 + (z.y2 - z.y1) / 3], [-z.x, z.y1 + ((z.y2 - z.y1) * 2) / 3], [z.x, z.y1 + ((z.y2 - z.y1) * 2) / 3],
    ];
    const zg = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)));
    this.zoneFrame = add(new THREE.LineSegments(zg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false })));
    this.zoneFrame.renderOrder = 5;
    this.disposables.push(zg, this.zoneFrame.material as THREE.Material);
    // バットのカーソル（バッター）：横長のだ円（当たる範囲）と、まん中の芯の丸
    this.cursorRing = new THREE.Mesh();
    const batGroup = new THREE.Group();
    const batFill = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0xa47bff, transparent: true, opacity: 0.45, depthTest: false, side: THREE.DoubleSide }));
    const batEdge = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), new THREE.MeshBasicMaterial({ color: 0xd7c4ff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    const sweet = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 32), new THREE.MeshBasicMaterial({ color: 0x5dff8a, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide }));
    for (const m of [batFill, batEdge, sweet]) {
      m.renderOrder = 6;
      this.disposables.push(m.geometry, m.material as THREE.Material);
    }
    batGroup.add(batFill, batEdge);
    this.batShape = batGroup;
    this.batSweet = sweet;
    s.add(batGroup, sweet);
    // 狙いの印（ピッチャー）：十字と丸
    this.aimMark = new THREE.Group();
    const aimMat = new THREE.MeshBasicMaterial({ color: 0xff5a5a, depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    this.disposables.push(aimMat);
    const r1 = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.08, 24), aimMat);
    const h = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.015), aimMat);
    const v = new THREE.Mesh(new THREE.PlaneGeometry(0.015, 0.22), aimMat);
    for (const m of [r1, h, v]) {
      m.renderOrder = 6;
      this.aimMark.add(m);
      this.disposables.push(m.geometry);
    }
    s.add(this.aimMark);
    const dotGeo = new THREE.CircleGeometry(0.022, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    this.disposables.push(dotGeo, dotMat);
    for (let i = 0; i < 9; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.renderOrder = 6;
      d.visible = false;
      s.add(d);
      this.breakDots.push(d);
    }
    this.breakEnd = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), new THREE.MeshBasicMaterial({ map: seamTex, depthTest: false, side: THREE.DoubleSide }));
    this.breakEnd.renderOrder = 7;
    this.disposables.push(this.breakEnd.geometry, this.breakEnd.material as THREE.Material);
    s.add(this.breakEnd);
    this.arrive = new THREE.Group();
    const arMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    const arRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.125, 32), arMat);
    const arDot = new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), arMat);
    for (const m of [arRing, arDot]) {
      m.renderOrder = 8;
      this.arrive.add(m);
      this.disposables.push(m.geometry);
    }
    this.disposables.push(arMat);
    this.arrive.visible = false;
    s.add(this.arrive);
    // 選手
    for (const p of setup.players) {
      const def = getCharacter(p.charId);
      const model = new FighterModel(def, getCostume(p.costume, p.charId), TEAM_COLORS[p.team % 2]);
      model.showMarker = false;
      s.add(model.root);
      this.models.set(p.slot, { model, charId: p.charId });
    }
    // ---- 画面の上の表示（スコアボード・カウント・メッセージ・操作の案内）
    this.ui = document.createElement('div');
    this.ui.className = 'bb-ui';
    this.ui.innerHTML = `
      <div class="bb-board"><div class="bb-inn"></div><div class="bb-teams"></div></div>
      <div class="bb-count"><div class="bb-bso"></div><div class="bb-bases"><i class="b2"></i><i class="b3"></i><i class="b1"></i></div><div class="bb-pa"></div></div>
      <div class="bb-matchup"></div>
      <div class="bb-speed"></div>
      <div class="bb-pick"><div class="bb-pick-ball"></div>${PITCH_KINDS.map((k) => `<i class="bb-ray" data-ray="${k}"></i><button type="button" data-pk="${k}"><b>${PITCH_NAMES[k]}</b><small></small></button>`).join('')}</div>
      <div class="bb-pname"></div>
      <button type="button" class="bb-repick">球種選択</button>
      <button type="button" class="bb-pskill"></button>
      <div class="bb-drag"></div>
      <button type="button" class="bb-bskill"></button>
      <div class="bb-rep"></div>
      <div class="bb-msg"></div>
      <div class="bb-help"></div>`;
    uiRoot.appendChild(this.ui);
    // 球種のボタン（投げる番のときだけ出す）
    this.ui.querySelectorAll<HTMLButtonElement>('[data-pk]').forEach((b) =>
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.game.choosePitch(this.mySlot, b.dataset.pk as PitchKind);
        this.selecting = false;
        this.updateUi(true);
      }),
    );
    this.ui.querySelector('.bb-repick')!.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.selecting = true;
      this.updateUi(true);
    });
    // 固有技のボタン（ピッチャー：次の球を固有球にする／バッター：この球で使う）
    this.ui.querySelector('.bb-pskill')!.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.game.toggleSkill(this.mySlot);
      this.updateUi(true);
    });
    this.ui.querySelector('.bb-bskill')!.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.game.useBatSkill(this.mySlot);
      for (const e of this.game.events) if (e.k === 'skill') this.onEvent(e);
      this.game.events = [];
      this.updateUi(true);
    });
    // 打つ：画面を指でなぞるとバットが同じだけ動き、指を離すと振る
    const drag = this.ui.querySelector<HTMLElement>('.bb-drag')!;
    let pid = -1;
    let sx = 0;
    let sy = 0;
    let cx0 = 0;
    let cy0 = 0;
    drag.addEventListener('pointerdown', (ev) => {
      if (pid >= 0) return;
      pid = ev.pointerId;
      drag.setPointerCapture(ev.pointerId);
      sx = ev.clientX;
      sy = ev.clientY;
      cx0 = this.game.cursor.x;
      cy0 = this.game.cursor.y;
      ev.preventDefault();
    });
    drag.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== pid) return;
      const k = this.worldPerPx();
      // バッター視点では、画面の右が x のマイナス側
      this.game.setCursor(this.mySlot, cx0 - (ev.clientX - sx) * k, cy0 - (ev.clientY - sy) * k);
    });
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pid) return;
      pid = -1;
      this.game.requestSwing(this.mySlot);
    };
    drag.addEventListener('pointerup', up);
    drag.addEventListener('pointercancel', (ev) => {
      if (ev.pointerId === pid) pid = -1;
    });
    this.updateUi(true);
  }

  /** 打つ視点で、ホームベースの所の1ピクセルが何メートルか（指で動かした分だけバットが動くように） */
  private worldPerPx(): number {
    const d = Math.abs(this.camera.position.z);
    const h = 2 * d * Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    return h / Math.max(1, this.ui.clientHeight || window.innerHeight);
  }

  private player(slot: number): BBPlayer | undefined {
    return this.game.setup.players.find((p) => p.slot === slot);
  }

  /** 自分の役（打つ・投げる・見ている） */
  get role(): 'bat' | 'pitch' | 'none' {
    const g = this.game;
    if (g.finished) return 'none';
    if (g.batter.slot === this.mySlot) return 'bat';
    if (g.pitcher.slot === this.mySlot) return 'pitch';
    return 'none';
  }

  /** 1コマ進めて描く準備をする。my = 自分の操作 */
  frame(dt: number, my: InputState): void {
    this.time += dt;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= 1 / 60 && steps < 4) {
      this.acc -= 1 / 60;
      steps++;
      const g = this.game;
      const inputs = new Map<number, InputState>();
      for (const p of g.setup.players) {
        if (p.slot === this.mySlot) {
          // バッター視点（ホーム側から外野を見る）では、画面の右が x のマイナス側なので、左右を逆にする
          let mine = this.role === 'bat' ? { ...my, mx: -my.mx } : my;
          if (this.role === 'pitch') {
            // B は「球種選択」を開く。選んでいる間は投げない・狙いも動かない
            const b = (my.buttons & BTN_B) !== 0;
            if (b && !this.prevB) this.selecting = !this.selecting;
            this.prevB = b;
            mine = this.selecting ? { mx: 0, my: 0, buttons: 0 } : { ...mine, buttons: mine.buttons & ~BTN_B };
          }
          inputs.set(p.slot, mine);
        } else if (p.cpu) inputs.set(p.slot, this.cpu.think(g, p.slot));
      }
      g.step(inputs);
      for (const e of g.events) this.onEvent(e);
    }
    if (this.acc > 0.2) this.acc = 0;
    this.updateScene(dt);
    this.updateUi(false);
    if (this.game.finished && !this.ended) {
      this.ended = true;
      window.setTimeout(() => this.hooks.onEnd(this.game, this.mySlot), 1400);
    }
  }

  private onEvent(e: Baseball['events'][number]): void {
    const say = (text: string, cls = '') => this.message(text, cls);
    switch (e.k) {
      case 'pitch':
        this.pitchAnimT = 0;
        this.hooks.sound('pitch');
        break;
      case 'swing':
        this.swingT = 0;
        this.hooks.sound('swing');
        break;
      case 'contact':
        this.hooks.sound('hit');
        this.showSpeed();
        break;
      case 'call':
        if (e.c !== 'foul') this.showSpeed();
        if (e.c === 'strike') say('ストライク！', 'strike');
        else if (e.c === 'ball') say('ボール', 'ball');
        else if (e.c === 'foul') say('ファウル', 'ball');
        else say('空振り！', 'strike');
        this.hooks.sound(e.c === 'ball' || e.c === 'foul' ? 'ball' : 'strike');
        break;
      case 'result': {
        const name = BB_RESULT_NAMES[e.r];
        const hit = e.r === 'single' || e.r === 'double' || e.r === 'triple' || e.r === 'homer' || e.r === 'walk' || e.r === 'hbp';
        say(`${name}${e.r === 'homer' ? '！！' : hit ? '！' : ''}${e.runs > 0 ? `<small>${e.runs}点！</small>` : ''}`, e.r === 'homer' ? 'homer' : hit ? 'hit' : 'out');
        this.hooks.sound(e.r === 'homer' ? 'homer' : hit ? 'cheer' : 'out');
        break;
      }
      case 'skill': {
        const who = e.slot === this.mySlot ? '' : '相手：';
        say(`${who}${e.bat ? '固有' : '固有球'}「${e.name}」<small>${e.desc}</small>`, 'skill');
        this.msgT = 2.2;
        this.hooks.sound('cheer');
        break;
      }
      case 'change': {
        const g = this.game;
        say(`${g.inning}回${g.half === 0 ? '表' : '裏'}`, 'change');
        break;
      }
      case 'end': {
        const w = this.game.winner;
        say(w < 0 ? '引き分け' : 'ゲームセット', 'change');
        this.hooks.sound('end');
        break;
      }
    }
  }

  /** 球速と球種（投げた球がホームベースに来たあとに出す） */
  private showSpeed(): void {
    const g = this.game;
    const name = g.pitchSkill === 'gacha' ? `ガチャ球（${g.gachaWin ? `当たり！${PITCH_NAMES[g.pitchType]}` : 'はずれ'}）` : g.pitchSkill ? `${PITCH_SKILLS[g.pitchSkill].name}` : PITCH_NAMES[g.pitchType];
    const el = this.ui.querySelector<HTMLElement>('.bb-speed')!;
    el.innerHTML = `<b>${pitchKmh(g.pitchSpeed)}</b><small>km/h</small><span>${name}</span>`;
    el.classList.add('show');
    this.speedT = 2.2;
  }
  private speedT = 0;

  private message(html: string, cls: string): void {
    const el = this.ui.querySelector<HTMLElement>('.bb-msg')!;
    el.innerHTML = html;
    el.className = `bb-msg show ${cls}`;
    this.msgT = 1.4;
  }

  private updateScene(dt: number): void {
    const g = this.game;
    // 選手の位置と動き
    const pose = (slot: number, x: number, z: number, turn: number, move: ViewFighter['move'], frame: number) => {
      const m = this.models.get(slot);
      if (!m) return;
      const def = getCharacter(m.charId);
      m.model.previewTurn = turn;
      const v: ViewFighter = {
        slot, x: 0, y: 0, facing: 1, state: move ? 'attack' : 'idle', stateTime: Math.floor(this.time * 60), move, moveFrame: frame,
        damage: 0, stocks: 1, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
      };
      m.model.update(v, def, this.time, dt);
      // 位置は動きを計算したあとに置く（update が横スクロール用の位置に置き直すため）
      m.model.root.visible = true;
      m.model.root.position.set(x, 0, z);
    };
    for (const p of g.setup.players) {
      const m = this.models.get(p.slot);
      if (m) m.model.root.visible = false;
    }
    if (this.swingT >= 0) this.swingT += dt * 60;
    if (this.pitchAnimT >= 0) this.pitchAnimT += dt * 60;
    if (!g.finished || g.phase === 'end') {
      // バッター（右打ち：バッター視点で画面の左のボックス = x のプラス側）。ホームベースの方を向いて構え、振ったら横の大技
      const sw = this.swingT >= 0 && this.swingT < 26 ? Math.floor(this.swingT) : -1;
      pose(g.batter.slot, 0.95, 0.15, -Math.PI / 2, sw >= 0 ? 'side' : null, sw);
      // ピッチャー（キャッチャーの方を向く）。投げたら前へ突く動き
      const pt = this.pitchAnimT >= 0 && this.pitchAnimT < 20 ? Math.floor(this.pitchAnimT) : -1;
      // 投球モーション：大きく振りかぶる → 手を離すと前へ突く
      const winding = g.phase === 'pitch' && g.windup > 0;
      pose(g.pitcher.slot, 0.15, BB.releaseZ + 0.6, Math.PI, winding ? 'charge' : pt >= 0 ? 'jab' : null, winding ? 0 : pt);
    }
    if (this.swingT > 30) this.swingT = -1;
    if (this.pitchAnimT > 24) this.pitchAnimT = -1;
    // ボール
    const bp = g.ballPos;
    const showBall = g.phase === 'pitch' || g.phase === 'call' || g.phase === 'hit' || (g.phase === 'result' && !!g.hitBall.speed && g.lastResult !== 'walk' && g.lastResult !== 'hbp' && g.lastResult !== 'strikeout');
    this.ball.visible = showBall && !g.ballHidden;
    this.ballShadow.visible = showBall && !g.ballHidden;
    this.ball.position.set(bp.x, Math.max(0.07, bp.y), bp.z);
    this.ballShadow.position.set(bp.x, 0.02, bp.z);
    // 回転：ストレートは縦の強い逆回転、横に曲がる球は横回転、落ちる球はほとんど回らない（ゆらゆら）
    if (g.phase === 'pitch' && g.windup <= 0) {
      const step = dt * 60;
      const k = g.pitchType;
      if (k === 'straight') this.ball.rotateX(-0.55 * step);
      else if (k === 'fork') {
        // ほとんど回らない（ゆらゆら）
        this.ball.rotateX(0.04 * step);
        this.ball.rotateZ(Math.sin(this.time * 9) * 0.03);
      } else if (k === 'curve') {
        // 縦の順回転（前に転がるように）＋少し横
        this.ball.rotateX(0.45 * step);
        this.ball.rotateY(-0.15 * step);
      } else this.ball.rotateY(0.5 * (k === 'shoot' ? 1 : -1) * step);
    } else if (g.phase === 'hit') this.ball.rotateX(0.4 * dt * 60);
    // 残像：投げた球の通り道
    if (g.phase === 'pitch' && g.windup <= 0) {
      this.trailPos.unshift(this.ball.position.clone());
      if (this.trailPos.length > this.trail.length * 2) this.trailPos.length = this.trail.length * 2;
    } else if (g.phase !== 'call') this.trailPos = [];
    this.trail.forEach((m, i) => {
      const p = this.trailPos[(i + 1) * 2];
      m.visible = !!p && (g.phase === 'pitch' || g.phase === 'call') && !g.ballHidden;
      if (p) m.position.copy(p);
    });
    if (this.speedT > 0) {
      this.speedT -= dt;
      if (this.speedT <= 0) this.ui.querySelector('.bb-speed')!.classList.remove('show');
    }
    // ミートの丸・狙いの印・ゾーンの枠
    const role = this.role;
    const meetR = BB.meetR + (bbStats(g.batter.charId).meet - 3) * BB.perMeet;
    const atBat = g.phase === 'ready' || g.phase === 'aim' || g.phase === 'pitch';
    // バット（横長のだ円）と芯
    const showBat = role === 'bat' && (atBat || g.phase === 'call');
    this.batShape.visible = showBat;
    this.batSweet.visible = showBat;
    this.batShape.scale.set(meetR * BB.batW, meetR * BB.batH, 1);
    this.batShape.position.set(g.cursor.x, g.cursor.y, 0);
    this.batShape.rotation.y = Math.PI;
    const sw = meetR * BB.batH * 0.42;
    this.batSweet.scale.set(sw, sw, 1);
    this.batSweet.position.set(g.cursor.x, g.cursor.y, -0.001);
    this.batSweet.rotation.y = Math.PI;
    // 狙いの印（投げ出す向き）と、曲がって来る所までの点線
    const aiming = role === 'pitch' && g.phase === 'aim' && !this.selecting;
    this.aimMark.visible = aiming;
    this.aimMark.position.set(g.aim.x, g.aim.y, 0);
    this.aimMark.scale.setScalar(1.5);
    this.aimMark.rotation.y = 0;
    const ps = g.choiceSkill ? bbRep(g.pitcher.charId).ps : null;
    const sh = ps === 'swap' ? { x: 0, y: pitchShift('fork', bbStats(g.pitcher.charId).brk).y * 1.4 } : g.shiftOf(g.pitcher.charId, ps === 'full' || ps === 'express' ? 'straight' : g.choice);
    // ロックオン・学習球・ガチャ球は、狙いと関係なく決まるので点線は出さない
    const bend = aiming && (sh.x !== 0 || sh.y !== 0) && ps !== 'lockon' && ps !== 'learn' && ps !== 'gacha';
    this.breakDots.forEach((d, i) => {
      const t = (i + 1) / (this.breakDots.length + 1);
      d.visible = bend;
      d.position.set(g.aim.x + sh.x * t * t, g.aim.y + sh.y * t * t, 0);
    });
    this.breakEnd.visible = bend;
    this.breakEnd.position.set(g.aim.x + sh.x, g.aim.y + sh.y, 0);
    // 球が来る所の予告（打つとき。半分くらい来たところで出て、来るにつれて小さくなる）
    // 速達便はぎりぎりまで出ない。打者の「予測」なら投球モーション中から出る
    const predict = g.batSkill === 'predict';
    const showAt = g.pitchSkill === 'express' && !predict ? g.pitchF - 15 : Math.max(0, Math.round(g.pitchF * BB.arriveShow) - BB.arriveEarly);
    const showArrive = role === 'bat' && g.phase === 'pitch' && (predict ? g.pitchT <= g.pitchF : g.windup <= 0 && g.pitchT >= showAt && g.pitchT <= g.pitchF);
    this.arrive.visible = showArrive;
    if (showArrive) {
      const info = g.pitchInfo();
      const t = g.windup > 0 ? 0 : Math.min(1, Math.max(0, g.pitchT - (predict ? 0 : showAt)) / Math.max(1, g.pitchF - (predict ? 0 : showAt)));
      // バグ球：予告もずれる
      const off = g.pitchSkill === 'bug' ? g.fakeOff : { x: 0, y: 0 };
      this.arrive.position.set(info.x + off.x, info.y + off.y, 0);
      this.arrive.scale.setScalar(2.2 - 1.2 * t);
      (this.arrive.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.55 + 0.4 * t;
    }
    this.zoneFrame.visible = atBat || g.phase === 'call';
    // カメラ：打つときはバッターの後ろ、投げるときはピッチャーの後ろ、打球は追いかける
    const cp = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 45;
    if (g.phase === 'hit' || (g.phase === 'result' && g.hitBall.speed > 0 && g.lastResult !== 'walk' && g.lastResult !== 'hbp' && g.lastResult !== 'strikeout')) {
      const b = g.hitBall;
      cp.set(b.x * 0.4, 7 + b.y * 0.3, -9 + b.z * 0.35);
      look.set(b.x, Math.max(1, b.y * 0.8), b.z);
      fov = 50;
    } else if (role === 'pitch' || (role === 'none' && g.half === 1)) {
      // ピッチャーの右肩の後ろ・少し上から、ホームベースを大きく見る
      cp.set(0.75, 2.35, BB.releaseZ + 2.6);
      look.set(0, 0.85, 0);
      fov = 12;
    } else {
      // キャッチャーの少し後ろ・バッターの肩ごしに、ピッチャーを見る
      cp.set(-0.25, 1.45, -3.2);
      look.set(0, 1.0, 8);
      fov = 42;
    }
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const snap = this.camPos.lengthSq() === 0 || g.phase === 'ready' || g.phase === 'change';
    const k = snap ? 1 : Math.min(1, dt * 5);
    this.camPos.lerp(cp, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(cp);
      this.camLook.copy(look);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // ピッチャーの頭の上：持ち球と曲がる量（打つときだけ）
    const rep = this.ui.querySelector<HTMLElement>('.bb-rep')!;
    const showRep = role === 'bat' && (g.phase === 'ready' || g.phase === 'aim' || (g.phase === 'pitch' && g.windup > 0));
    rep.classList.toggle('show', showRep);
    // 頭の上の表と重なるので、そのあいだ上の対戦表示は隠す（固有の残りは表とボタンで見える）
    this.ui.querySelector<HTMLElement>('.bb-matchup')!.style.visibility = showRep ? 'hidden' : '';
    if (showRep) {
      this.camera.updateMatrixWorld();
      const v = new THREE.Vector3(0.15, 2.45, BB.releaseZ + 0.6).project(this.camera);
      const w = this.ui.clientWidth || window.innerWidth;
      const h = this.ui.clientHeight || window.innerHeight;
      rep.style.left = `${((v.x + 1) / 2) * w}px`;
      rep.style.top = `${((1 - v.y) / 2) * h}px`;
    }
  }

  /** ピッチャーの頭の上に出す表：持ち球を曲がる向きの矢印で（長いほどよく曲がる）、ストレートの球速、固有球と残り回数 */
  private repHtml(): string {
    const g = this.game;
    const id = g.pitcher.charId;
    const r = bbRep(id);
    const short: Record<PitchKind, string> = { straight: '直', slider: 'スラ', curve: 'カーブ', fork: 'フォーク', shoot: 'シュート' };
    const cx = 55;
    const cy = 22;
    const k = 36;
    let arrows = '';
    for (const kind of r.pitches) {
      if (kind === 'straight') continue;
      const sh = g.shiftOf(id, kind);
      // バッター視点では、画面の右が x のマイナス側
      let dx = -sh.x * k;
      let dy = -sh.y * k;
      const len = Math.hypot(dx, dy);
      if (len > 30) {
        dx *= 30 / len;
        dy *= 30 / len;
      }
      const ex = cx + dx;
      const ey = cy + dy;
      const fav = r.fav === kind;
      const col = fav ? '#ffd23f' : '#ffffff';
      const ux = dx / (Math.hypot(dx, dy) || 1);
      const uy = dy / (Math.hypot(dx, dy) || 1);
      // 真下・真上の矢印の名前は左に寄せる（斜めの矢印の名前と重ならないように）
      const side = ux > 0.35 ? 1 : ux < -0.35 ? -1 : 0;
      const lx = side ? ex + ux * 6 : ex - 5;
      const ly = side ? ey + uy * 6 + 3 : ey + 4;
      const anchor = side > 0 ? 'start' : 'end';
      arrows += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${col}" stroke-width="2.4" marker-end="url(#bbah${fav ? 'f' : ''})"/>`;
      arrows += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${col}">${fav ? '★' : ''}${short[kind]}</text>`;
    }
    const st = pitchKmh(g.speedOf(id, 'straight'));
    const left = g.skillsLeft(g.pitcher.slot);
    const dots = Array.from({ length: BB.skillUses }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
    return `<div class="bb-rep-st">${r.fav === 'straight' ? '★' : ''}ストレート ${st}km/h</div>
      <svg viewBox="0 0 110 62" width="110" height="62"><defs>
        <marker id="bbah" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#fff"/></marker>
        <marker id="bbahf" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#ffd23f"/></marker>
      </defs><circle cx="${cx}" cy="${cy}" r="5" fill="#fff" stroke="#c33" stroke-width="1"/>${arrows}</svg>
      <div class="bb-rep-sk">固有球「${PITCH_SKILLS[r.ps].name}」<span class="bb-dots">${dots}</span></div>`;
  }

  private lastKey = '';
  private updateUi(force: boolean): void {
    const g = this.game;
    if (this.msgT > 0) {
      this.msgT -= 1 / 60;
      if (this.msgT <= 0) this.ui.querySelector('.bb-msg')!.classList.remove('show');
    }
    const role = this.role;
    // 投げる番が来たら、まず球種選択を開く
    const paKey = `${g.inning}-${g.half}-${g.pa}-${g.balls}-${g.strikes}-${g.frame > 0 ? 1 : 0}`;
    if (role === 'pitch' && g.phase === 'ready' && paKey !== this.lastAimPa) {
      this.lastAimPa = paKey;
      this.selecting = true;
    }
    const picking = role === 'pitch' && (g.phase === 'ready' || g.phase === 'aim') && this.selecting;
    const key = [g.inning, g.half, g.pa, g.balls, g.strikes, g.outs, g.bases.join(), g.score.join(), role, g.phase, g.finished, picking, g.choice, g.choiceSkill, g.batSkill, g.setup.players.map((p) => g.skillsLeft(p.slot)).join()].join('|');
    if (key === this.lastKey && !force) return;
    this.lastKey = key;
    const names = [0, 1].map((t) => g.teamPlayers(t)[0]?.name ?? (t === 0 ? '先攻' : '後攻'));
    const inn = this.ui.querySelector<HTMLElement>('.bb-inn')!;
    inn.textContent = `${g.inning}回${g.half === 0 ? '表' : '裏'}`;
    const col = (t: number) => '#' + TEAM_COLORS[t].toString(16).padStart(6, '0');
    this.ui.querySelector<HTMLElement>('.bb-teams')!.innerHTML = [0, 1]
      .map((t) => `<div class="${g.half === t ? 'atbat' : ''}" style="--tc:${col(t)}"><span>${esc(names[t])}</span><b>${g.score[t]}</b></div>`)
      .join('');
    const dots = (n: number, max: number, cls: string) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
    this.ui.querySelector<HTMLElement>('.bb-bso')!.innerHTML = `<div><span>B</span>${dots(g.balls, 3, 'b')}</div><div><span>S</span>${dots(g.strikes, 2, 's')}</div><div><span>O</span>${dots(g.outs, 3, 'o')}</div>`;
    const bases = this.ui.querySelectorAll<HTMLElement>('.bb-bases i');
    bases.forEach((el) => {
      const i = el.classList.contains('b1') ? 0 : el.classList.contains('b2') ? 1 : 2;
      el.classList.toggle('on', g.bases[i]);
    });
    this.ui.querySelector<HTMLElement>('.bb-pa')!.textContent = `打席 ${Math.min(g.pa + 1, BB.paPerHalf)}/${BB.paPerHalf}`;
    // 固有技の残り回数（お互いに見える）
    const sk = (slot: number) => `<span class="bb-dots">${Array.from({ length: BB.skillUses }, (_, i) => `<i class="${i < g.skillsLeft(slot) ? 'on' : ''}"></i>`).join('')}</span>`;
    this.ui.querySelector<HTMLElement>('.bb-matchup')!.innerHTML = g.finished
      ? ''
      : `<span>投 ${esc(g.pitcher.name)}（${esc(getCharacter(g.pitcher.charId).name)}）固有${sk(g.pitcher.slot)}</span><span>打 ${esc(g.batter.name)}（${esc(getCharacter(g.batter.charId).name)}）固有${sk(g.batter.slot)}</span>`;
    this.ui.querySelector<HTMLElement>('.bb-rep')!.innerHTML = g.finished ? '' : this.repHtml();
    const help = this.ui.querySelector<HTMLElement>('.bb-help')!;
    help.innerHTML =
      role === 'bat'
        ? 'あなたが打つ番：画面を<b>指でなぞってバット</b>を球に合わせ、<b>指を離すと振る</b>（紫が当たる所・緑の丸が芯・黄色の丸が球の来る所）'
        : role === 'pitch'
          ? this.selecting
            ? '<b>球種</b>を選ぶ（曲がる向きに並んでいます）'
            : 'スティックで<b>狙い</b>（投げ出す向き）を決めて <b>A</b> で投げる。点線の先に曲がって来る'
          : '';
    const pick = this.ui.querySelector<HTMLElement>('.bb-pick')!;
    pick.classList.toggle('show', picking);
    // 持ち球だけ出す。得意球には★
    const own = bbRep(g.pitcher.charId);
    pick.querySelectorAll<HTMLElement>('[data-pk]').forEach((b) => {
      const kind = b.dataset.pk as PitchKind;
      const has = own.pitches.includes(kind);
      b.style.display = has ? '' : 'none';
      b.classList.toggle('on', kind === g.choice);
      b.classList.toggle('fav', own.fav === kind);
      b.querySelector('b')!.textContent = `${own.fav === kind ? '★' : ''}${PITCH_NAMES[kind]}`;
      const sm = b.querySelector('small')!;
      const kmh = `${pitchKmh(g.speedOf(g.pitcher.charId, kind))} km/h`;
      if (sm.textContent !== kmh) sm.textContent = kmh;
    });
    pick.querySelectorAll<HTMLElement>('[data-ray]').forEach((r) => {
      r.style.display = own.pitches.includes(r.dataset.ray as PitchKind) ? '' : 'none';
    });
    const aimingNow = role === 'pitch' && g.phase === 'aim' && !this.selecting;
    const pn = this.ui.querySelector<HTMLElement>('.bb-pname')!;
    pn.textContent = aimingNow ? `${PITCH_NAMES[g.choice]}${g.choiceSkill ? ` ＋ 固有球「${PITCH_SKILLS[own.ps].name}」` : ''}` : '';
    pn.classList.toggle('show', aimingNow);
    this.ui.querySelector<HTMLElement>('.bb-repick')!.classList.toggle('show', role === 'pitch' && (g.phase === 'aim' || g.phase === 'ready') && !this.selecting);
    // 固有技のボタン
    const before = g.phase === 'ready' || g.phase === 'aim';
    const pBtn = this.ui.querySelector<HTMLElement>('.bb-pskill')!;
    const pLeft = g.skillsLeft(this.mySlot);
    pBtn.classList.toggle('show', role === 'pitch' && before);
    pBtn.classList.toggle('on', g.choiceSkill);
    pBtn.classList.toggle('off', !g.choiceSkill && pLeft <= 0);
    pBtn.innerHTML = `固有球「${PITCH_SKILLS[own.ps].name}」<em>${PITCH_SKILLS[own.ps].desc}</em><small>${g.choiceSkill ? '次の球で使う ✓' : pLeft > 0 ? `残り${pLeft}回・タップで使う` : '残り0回'}</small>`;
    pBtn.title = PITCH_SKILLS[own.ps].desc;
    const bBtn = this.ui.querySelector<HTMLElement>('.bb-bskill')!;
    const bsk = bbRep(g.batter.charId).bs;
    bBtn.classList.toggle('show', role === 'bat' && (before || (g.phase === 'pitch' && g.batSkill !== null)));
    bBtn.classList.toggle('on', g.batSkill !== null);
    bBtn.classList.toggle('off', g.batSkill === null && !g.canBatSkill(this.mySlot));
    bBtn.innerHTML = `固有「${BAT_SKILLS[bsk].name}」<em>${BAT_SKILLS[bsk].desc}</em><small>${g.batSkill ? '発動中 ✓' : g.skillsLeft(this.mySlot) <= 0 ? '残り0回' : bsk === 'steal' && !g.bases.some(Boolean) ? '走者がいると使える' : `残り${g.skillsLeft(this.mySlot)}回・タップで使う`}</small>`;
    // 打つ番：画面をなぞってバットを動かす（スティックとボタンは隠す）
    this.ui.querySelector<HTMLElement>('.bb-drag')!.classList.toggle('on', role === 'bat');
    this.hooks.setPad(role);
  }

  dispose(): void {
    for (const m of this.models.values()) {
      this.scene.remove(m.model.root);
      m.model.dispose();
    }
    this.models.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.ui.remove();
  }
}


function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
