// three.js による描画：ステージ、キャラクター、カメラ、エフェクト

import * as THREE from 'three';
import { getCharacter, SLOT_COLORS } from '../shared/characters';
import { platformAt, type StageDef } from '../shared/stages';
import { TETHER } from '../shared/moves';
import { FX_SPEED, type GameEvent, type MatchSetup, type ViewFighter, type ViewState } from '../shared/types';
import { getCostume } from '../shared/costumes';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FighterModel } from './fighterModel';
import { buildStageScene, makeSkyTexture, type BuiltStage } from './stageScene';
import { PropRenderer } from './props';

export type Quality = 'low' | 'high';

interface Particle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  life: number;
  max: number;
  grow: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private stageGroup = new THREE.Group();
  private platformMeshes: THREE.Object3D[] = [];
  private built: BuiltStage | null = null;
  /** 光のにじみ（画質「きれい」のときだけ） */
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private models = new Map<number, { model: FighterModel; charId: string }>();
  private setup: MatchSetup | null = null;
  private props: PropRenderer;
  /** 分身（ハルシネーション）の表示用モデル（持ち主の slot ごと） */
  private decoys = new Map<number, FighterModel>();
  /** API呼び出しのワイヤー（選手の slot ごと） */
  private wires = new Map<number, THREE.Line>();
  private particles: Particle[] = [];
  private sparkGeo = new THREE.SphereGeometry(1, 6, 5);
  private ringGeo = new THREE.RingGeometry(0.7, 1, 24);
  private stage: StageDef | null = null;
  private camPos = new THREE.Vector3(0, 4, 24);
  private camLook = new THREE.Vector3(0, 3, 0);
  private shake = 0;
  private sun: THREE.DirectionalLight;
  private quality: Quality = 'high';
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
    // 夜の街：空からの青い光と、正面上からの月明かり（ネオンの色の照明はステージ側で足す）
    this.scene.add(new THREE.HemisphereLight(0xd8dcff, 0x3a2a4a, 1.8));
    this.sun = new THREE.DirectionalLight(0xfff2e6, 2.3);
    this.sun.position.set(-8, 20, 14);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 20;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 60;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.stageGroup);
    this.props = new PropRenderer(this.scene);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    const changed = this.quality !== q;
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.sun.castShadow = q === 'high';
    if (q === 'high' && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      // 明るいところ（ネオン・光る物）だけをにじませる
      // キャラは明るさの上限（0.8）で抑えているので、しきい値をそれより上にしてにじませない
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.86);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else if (q !== 'high' && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
    }
    this.resize();
    // ステージの作り込み（雨・建物の数）も画質で変わるので作り直す
    if (changed && this.stage && this.setup) {
      const setup = this.setup;
      this.setMatch(setup, this.stage);
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxRatio = this.quality === 'high' ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      // にじみは半分の解像度で計算して軽くする
      this.bloom?.resolution.set(w / 2, h / 2);
    }
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setMatch(setup: MatchSetup, stage: StageDef): void {
    this.clear();
    this.stage = stage;
    this.setup = setup;
    this.focusSlot = null;
    this.buildStage(stage);
    this.buildModels();
    const m = stage.main;
    this.camLook.set((m.x1 + m.x2) / 2, 3, 0);
    this.camPos.set(this.camLook.x, 5, 26);
  }

  private buildModels(): void {
    for (const { model } of this.models.values()) {
      this.scene.remove(model.root);
      model.dispose();
    }
    this.models.clear();
    if (!this.setup) return;
    for (const p of this.setup.players) {
      const def = getCharacter(p.charId);
      const color = SLOT_COLORS[p.slot % SLOT_COLORS.length];
      const model = new FighterModel(def, getCostume(p.costume, p.charId), color);
      this.scene.add(model.root);
      this.models.set(p.slot, { model, charId: p.charId });
    }
  }

  /** 結果画面で勝った人を踊らせ、カメラを寄せる */
  celebrate(slot: number | null): void {
    for (const [s, { model }] of this.models) model.setVictory(s === slot);
    this.focusSlot = slot;
  }
  private focusSlot: number | null = null;

  clear(): void {
    for (const { model } of this.models.values()) {
      this.scene.remove(model.root);
      model.dispose();
    }
    this.models.clear();
    this.props.clear();
    for (const m of this.decoys.values()) {
      this.scene.remove(m.root);
      m.dispose();
    }
    this.decoys.clear();
    for (const w of this.wires.values()) this.scene.remove(w);
    this.wires.clear();
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    for (const b of this.beams) this.scene.remove(b.mesh);
    this.beams = [];
    this.built?.dispose();
    this.built = null;
    this.stageGroup.clear();
    this.platformMeshes = [];
  }

  private buildStage(stage: StageDef): void {
    const th = stage.theme;
    this.scene.background = makeSkyTexture(th.sky, th.skyBottom);
    this.scene.fog = new THREE.Fog(th.fog, 30, 120);
    this.built = buildStageScene(stage, this.quality);
    this.stageGroup.add(this.built.group);
    this.platformMeshes = this.built.platformMeshes;
  }

  render(view: ViewState | null, dt: number, newEvents: GameEvent[]): void {
    this.time += dt;
    if (view && this.stage) {
      // 動く足場
      this.stage.platforms.forEach((p, i) => {
        const at = platformAt(p, view.frame);
        this.platformMeshes[i].position.x = (at.x1 + at.x2) / 2;
      });
      for (const f of view.fighters) {
        const m = this.models.get(f.slot);
        if (!m) continue;
        m.model.update(f, getCharacter(m.charId), this.time, dt);
      }
      // 飛び道具・壁・罠・広告ウィンドウ・Zzz
      this.props.update(view, this.time, dt);
      this.updateDecoys(view, dt);
      this.updateWires(view);
      for (const e of newEvents) this.effect(e, view);
      this.trails(view);
      this.updateCamera(view, dt);
    }
    this.updateParticles(dt);
    this.built?.animate(this.time, dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** 分身：持ち主と同じ見た目のキャラを半透明で表示 */
  private updateDecoys(view: ViewState, dt: number): void {
    const alive = new Set<number>();
    for (const e of view.entities) {
      if (e.kind !== 'decoy') continue;
      alive.add(e.owner);
      let m = this.decoys.get(e.owner);
      const p = this.setup?.players.find((x) => x.slot === e.owner);
      if (!p) continue;
      const def = getCharacter(p.charId);
      if (!m) {
        m = new FighterModel(def, getCostume(p.costume, p.charId), SLOT_COLORS[e.owner % SLOT_COLORS.length]);
        this.scene.add(m.root);
        this.decoys.set(e.owner, m);
      }
      m.ghost = 0.55 + Math.sin(this.time * 9) * 0.12;
      const fake: ViewFighter = {
        slot: e.owner,
        x: e.x,
        y: e.y,
        facing: e.dir,
        state: 'idle',
        stateTime: view.frame,
        move: null,
        moveFrame: 0,
        damage: 0,
        stocks: 0,
        invuln: false,
        shield: 1,
        charge: 0,
        kos: 0,
        falls: 0,
        out: false,
        poison: false,
        fx: 0,
      };
      m.update(fake, def, this.time, dt);
    }
    for (const [owner, m] of this.decoys) {
      if (alive.has(owner)) continue;
      this.scene.remove(m.root);
      m.dispose();
      this.decoys.delete(owner);
    }
  }

  /** API呼び出し：届く崖があればそこへ、なければ斜め上へワイヤーを伸ばす */
  private updateWires(view: ViewState): void {
    const st = this.stage!;
    for (const f of view.fighters) {
      const p = this.setup?.players.find((x) => x.slot === f.slot);
      const using = p?.charId === 'ai' && f.state === 'attack' && f.move === 'uspecial' && f.moveFrame >= 6;
      let line = this.wires.get(f.slot);
      if (!using) {
        if (line) line.visible = false;
        continue;
      }
      if (!line) {
        line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x4fd8ff }));
        this.scene.add(line);
        this.wires.set(f.slot, line);
      }
      const hx = f.x + f.facing * 0.3;
      const hy = f.y + 1.6;
      let tx = hx + f.facing * 2.5;
      let ty = hy + 2.5;
      let best = TETHER.range;
      for (const ex of [st.main.x1, st.main.x2]) {
        const d = Math.hypot(ex - f.x, st.main.top - (f.y + 1));
        if (d < best) {
          best = d;
          tx = ex;
          ty = st.main.top;
        }
      }
      const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, hx, hy, 0.3);
      pos.setXYZ(1, tx, ty, 0.3);
      pos.needsUpdate = true;
      line.visible = true;
    }
  }

  /** 大きくふっとんでいる間、通り道に煙を残す。倍速中は残像 */
  private trails(view: ViewState): void {
    for (const f of view.fighters) {
      if (f.fx & FX_SPEED && (f.state === 'run' || f.state === 'air' || f.state === 'attack') && Math.floor(this.time * 30) % 2 === 0) {
        this.spawn(this.sparkGeo, 0x8ef0ff, f.x, f.y + 0.8, 0, 0, 0.3, 12, -0.01);
      }
      if (f.state !== 'hitstun' || f.damage < 40 || f.stateTime % 3 !== 0 || f.stateTime === this.lastTrail.get(f.slot)) continue;
      this.lastTrail.set(f.slot, f.stateTime);
      const big = f.damage > 100;
      this.spawn(this.sparkGeo, big ? 0xffb070 : 0xdddddd, f.x, f.y + 0.9, 0, 0, big ? 0.35 : 0.25, 26, 0.012);
    }
  }
  private lastTrail = new Map<number, number>();

  private dust(x: number, y: number, n: number, spread: number): void {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      this.spawn(this.sparkGeo, 0xf2eee6, x + dir * 0.2, y + 0.1, dir * (1.5 + Math.random() * spread), 0.6 + Math.random() * 1.2, 0.16 + Math.random() * 0.1, 18 + Math.random() * 8, 0.012);
    }
  }

  private effect(e: GameEvent, view: ViewState): void {
    if (e.k === 'jump') {
      const f = view.fighters.find((x) => x.slot === e.s);
      if (f) this.dust(f.x, f.y, 4, 1.5);
      return;
    }
    if (e.k === 'land') {
      this.dust(e.x, e.y, 4 + Math.round(e.p * 6), 2 + e.p * 4);
      return;
    }
    if (e.k === 'gacha') {
      const labels = [
        ['爆死…', '#9a9aaa'],
        ['回復', '#4fd18b'],
        ['N', '#d0d0d8'],
        ['R', '#4f9dff'],
        ['SR!', '#ffd23f'],
        ['SSR!!', 'rainbow'],
      ];
      const [text, color] = labels[e.r] ?? labels[2];
      this.props.showText(text, color, e.x, e.y + 0.6, e.r === 5);
      if (e.r >= 4) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          this.spawn(this.sparkGeo, [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff][i % 5], e.x, e.y, Math.cos(a) * 6, Math.sin(a) * 6, 0.18, 26, -0.004);
        }
      }
      return;
    }
    if (e.k === 'heal') {
      for (let i = 0; i < 10; i++) {
        this.spawn(this.sparkGeo, 0x4fd18b, e.x + (Math.random() - 0.5) * 0.8, e.y - Math.random(), 0, 2 + Math.random() * 2, 0.12, 28, -0.003);
      }
      this.props.showText('+回復', '#4fd18b', e.x, e.y + 0.4);
      return;
    }
    if (e.k === 'poof') {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawn(this.sparkGeo, 0xe8e8f0, e.x, e.y, Math.cos(a) * 3, Math.sin(a) * 3, 0.25, 24, 0.01);
      }
      return;
    }
    if (e.k === 'buff') {
      const f = view.fighters.find((x) => x.slot === e.s);
      if (f) {
        this.spawn(this.ringGeo, 0xffd23f, f.x, f.y + 0.9, 0, 0, 0.5, 18, 0.04);
        this.spawn(this.ringGeo, 0xffffff, f.x, f.y + 0.9, 0, 0, 0.3, 14, 0.035);
      }
      return;
    }
    if (e.k === 'absorb') {
      this.spawn(this.ringGeo, 0x4fd8ff, e.x, e.y, 0, 0, 0.8, 14, -0.05);
      return;
    }
    if (e.k === 'counter') {
      // クレーム対応：金色の輪
      this.spawn(this.ringGeo, 0xffd23f, e.x, e.y, 0, 0, 0.4, 18, 0.08);
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.2, 12, 0.07);
      this.shake = Math.max(this.shake, 0.5);
      return;
    }
    if (e.k === 'boom') {
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 3 + Math.random() * 7;
        this.spawn(this.sparkGeo, i % 2 ? 0xff7a1a : 0x39ff88, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25, 22, -0.005);
      }
      this.spawn(this.ringGeo, 0xff7a1a, e.x, e.y, 0, 0, 0.5, 18, 0.12);
      this.shake = Math.max(this.shake, 0.6);
      return;
    }
    if (e.k === 'flash') {
      // スクショ：白いフラッシュ
      this.spawn(this.sparkGeo, 0xffffff, e.x, e.y, 0, 0, 0.6, 8, 0.25);
      return;
    }
    if (e.k === 'teleport') {
      for (let i = 0; i < 10; i++) {
        this.spawn(this.sparkGeo, 0xff9ec8, e.x + (Math.random() - 0.5) * 0.8, e.y + Math.random() * 1.8, (Math.random() - 0.5) * 3, Math.random() * 2, 0.12, 20, -0.004);
      }
      return;
    }
    if (e.k === 'sleep') {
      this.spawn(this.ringGeo, 0x7ef0d0, e.x, e.y, 0, 0, 0.3, 16, 0.05);
      return;
    }
    if (e.k === 'hit') {
      const power = Math.min(1, e.p / 16);
      const color = power > 0.6 ? 0xff7a2a : 0xffe066;
      const n = 6 + Math.round(power * 10);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 8 * (0.5 + power);
        this.spawn(this.sparkGeo, color, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.18 + Math.random() * 0.12, 14 + Math.random() * 8, -0.01);
      }
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.3, 10, 0.05 + power * 0.07);
      this.shake = Math.max(this.shake, 0.15 + power * 0.45);
    } else if (e.k === 'shield') {
      this.spawn(this.ringGeo, 0x9fd0ff, e.x, e.y, 0, 0, 0.3, 8, 0.05);
    } else if (e.k === 'ko') {
      const color = SLOT_COLORS[e.s % SLOT_COLORS.length];
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 16;
        this.spawn(this.sparkGeo, i % 3 ? color : 0xffffff, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, 30 + Math.random() * 20, -0.005);
      }
      this.spawn(this.ringGeo, color, e.x, e.y, 0, 0, 1, 26, 0.3, true);
      this.koBeam(e.x, e.y, color);
      this.shake = 1.1;
    }
  }

  /** 撃墜した場所から、ステージの中心に向かう光の柱 */
  private koBeam(x: number, y: number, color: number): void {
    const st = this.stage;
    if (!st) return;
    const cx = (st.main.x1 + st.main.x2) / 2;
    const cy = st.main.top + 3;
    const dx = cx - x;
    const dy = cy - y;
    const len = 14;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(len, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    const a = Math.atan2(dy, dx);
    mesh.position.set(x + (Math.cos(a) * len) / 2, y + (Math.sin(a) * len) / 2, 0.3);
    mesh.rotation.z = a;
    this.scene.add(mesh);
    this.beams.push({ mesh, life: 40, max: 40 });
  }
  private beams: { mesh: THREE.Mesh; life: number; max: number }[] = [];

  /**
   * 演出（火花・輪など）を出す。glow = false のものは明るさを抑えて光のにじみをかけない
   * （キャラが見えにくくならないように。撃墜の演出だけ glow = true）
   */
  private spawn(geo: THREE.BufferGeometry, color: number, x: number, y: number, vx: number, vy: number, size: number, life: number, grow: number, glow = false): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    if (!glow) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(0.8));');
      };
      mat.customProgramCacheKey = () => 'fx-cap';
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0.5);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.particles.push({ mesh, vx, vy, life, max: life, grow });
  }

  private updateParticles(dt: number): void {
    const keep: Particle[] = [];
    const steps = dt * 60;
    this.beams = this.beams.filter((b) => {
      b.life -= steps;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        return false;
      }
      const t = b.life / b.max;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.9;
      b.mesh.scale.y = 0.3 + (1 - t) * 1.6;
      return true;
    });
    for (const p of this.particles) {
      p.life -= steps;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      const s = Math.max(0.01, p.mesh.scale.x + p.grow * steps);
      p.mesh.scale.setScalar(s);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life / p.max;
      p.mesh.lookAt(this.camera.position);
      keep.push(p);
    }
    this.particles = keep;
  }

  /** 確認用：カメラの位置を固定する（自動テストで使う） */
  debugCamera: { x: number; y: number; dist: number } | null = null;

  private updateCamera(view: ViewState, dt: number): void {
    if (this.debugCamera) {
      const c = this.debugCamera;
      this.camera.position.set(c.x, c.y + 0.3, c.dist);
      this.camera.lookAt(c.x, c.y, 0);
      return;
    }
    const st = this.stage!;
    const m = st.main;
    const focus = this.focusSlot !== null ? view.fighters.find((f) => f.slot === this.focusSlot && f.state !== 'dead') : undefined;
    if (focus) {
      // 勝った人を画面の左寄りに大きく映す（右側に順位表が出る）
      const k = Math.min(1, dt * 2.5);
      const tx = focus.x + 1.6;
      const ty = focus.y + 1.1;
      this.camLook.x += (tx - this.camLook.x) * k;
      this.camLook.y += (ty - this.camLook.y) * k;
      this.camPos.x += (tx - this.camPos.x) * k;
      this.camPos.y += (ty + 0.6 - this.camPos.y) * k;
      this.camPos.z += (6.5 - this.camPos.z) * k;
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook.x, this.camLook.y, 0);
      return;
    }
    let minX = m.x1 * 0.6;
    let maxX = m.x2 * 0.6;
    // 画面下のダメージ表示と重ならないよう、足元側に余白を多めに取る
    let minY = m.top - 3;
    let maxY = m.top + 3;
    for (const f of view.fighters) {
      if (f.state === 'dead') continue;
      minX = Math.min(minX, f.x - 2);
      maxX = Math.max(maxX, f.x + 2);
      minY = Math.min(minY, f.y - 2.5);
      maxY = Math.max(maxY, f.y + 3);
    }
    const b = st.blast;
    minX = Math.max(minX, b.left + 2);
    maxX = Math.min(maxX, b.right - 2);
    minY = Math.max(minY, b.bottom + 2);
    maxY = Math.min(maxY, b.top - 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const distY = spanY / 2 / Math.tan(vfov / 2);
    const distX = spanX / 2 / (Math.tan(vfov / 2) * this.camera.aspect);
    const dist = Math.max(14, Math.min(48, Math.max(distX, distY) * 1.12));
    const k = Math.min(1, dt * 3);
    this.camLook.x += (cx - this.camLook.x) * k;
    this.camLook.y += (cy - this.camLook.y) * k;
    this.camPos.x += (cx - this.camPos.x) * k;
    this.camPos.y += (cy + dist * 0.12 - this.camPos.y) * k;
    this.camPos.z += (dist - this.camPos.z) * k;
    this.shake *= Math.pow(0.02, dt);
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
    this.camera.lookAt(this.camLook.x + sx, this.camLook.y + sy, 0);
    this.sun.target.position.set(this.camLook.x, 0, 0);
    this.sun.position.set(this.camLook.x - 8, 20, 14);
  }
}
