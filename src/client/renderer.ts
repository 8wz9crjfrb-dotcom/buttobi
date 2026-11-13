// three.js による描画：ステージ、キャラクター、カメラ、エフェクト

import * as THREE from 'three';
import { getCharacter, ITEM_NAMES, playerColor, SLOT_COLORS, TAUNT_LINES } from '../shared/characters';
import { platformAt, type StageDef } from '../shared/stages';
import { TETHER } from '../shared/moves';
import { FX_SPEED, type GameEvent, type MatchSetup, type ViewFighter, type ViewState } from '../shared/types';
import { getCostume } from '../shared/costumes';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FighterModel, fxTexture } from './fighterModel';
import { buildStageScene, makeSkyTexture, type BuiltStage } from './stageScene';
import { PropRenderer } from './props';

export type Quality = 'low' | 'high';

/** 撃墜確定の演出：ふっとび始めてからのスローの長さと、元の速さへ戻すまでの長さ（秒） */
const FINISH_SLOW = 0.5;
const FINISH_BACK = 0.3;

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
  private hemi: THREE.HemisphereLight;
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
  /** キャラ選択画面の3D表示（null なら通常の対戦画面） */
  private preview: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    model: FighterModel | null;
    charId: string;
    spin: number;
    pop: number;
    ring: THREE.Mesh;
    disposables: { dispose(): void }[];
  } | null = null;
  private thumbs = new Map<string, string>();

  /** 夜のライブバーのギミック：照明が落ちて暗くなる（画面の上にかぶせる黒い幕） */
  private blackout: HTMLDivElement;
  private blackoutAt = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.blackout = document.createElement('div');
    this.blackout.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 55%, rgba(10,4,20,0.7) 0%, rgba(4,2,10,0.94) 70%)';
    canvas.insertAdjacentElement('afterend', this.blackout);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
    // 夜の街：空からの青い光と、正面上からの月明かり（ネオンの色の照明はステージ側で足す）
    this.hemi = new THREE.HemisphereLight(0xd8dcff, 0x3a2a4a, 1.8);
    this.scene.add(this.hemi);
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
      if (this.stage) this.bloom.enabled = !this.stage.theme.bright;
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
    this.blackoutAt = -1;
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
      const color = playerColor(this.setup, p.slot);
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
    for (const st of this.streaks) this.scene.remove(st.mesh);
    this.streaks = [];
    for (const f of this.flight.values()) {
      for (const g of f.ghosts) {
        this.scene.remove(g.root);
        g.dispose();
      }
    }
    this.flight.clear();
    this.finish.on = false;
    this.built?.dispose();
    this.built = null;
    this.stageGroup.clear();
    this.platformMeshes = [];
  }

  private buildStage(stage: StageDef): void {
    const th = stage.theme;
    this.scene.background = makeSkyTexture(th.sky, th.skyBottom);
    if (th.bright) {
      // 昼・明るい室内：明るい照明。光のにじみはかけない
      this.scene.fog = new THREE.Fog(th.fog, 45, 130);
      this.hemi.color.setHex(0xffffff);
      this.hemi.groundColor.setHex(0x445566);
      this.hemi.intensity = 1.6;
      this.sun.color.setHex(0xffffff);
      this.sun.intensity = 2.2;
    } else {
      // 夜の街：空からの青い光と、正面上からの月明かり
      this.scene.fog = new THREE.Fog(th.fog, 30, 120);
      this.hemi.color.setHex(0xd8dcff);
      this.hemi.groundColor.setHex(0x3a2a4a);
      this.hemi.intensity = 1.8;
      this.sun.color.setHex(0xfff2e6);
      this.sun.intensity = 2.3;
    }
    if (this.bloom) this.bloom.enabled = !th.bright;
    this.built = buildStageScene(stage, this.quality);
    this.stageGroup.add(this.built.group);
    this.platformMeshes = this.built.platformMeshes;
  }

  // ---------------------------------------------------------------- キャラ選択の3D表示
  /** キャラ選択画面で、選んでいるキャラを左側に大きく表示する */
  showPreview(charId: string, slot = 0, costumeId?: string, fancy = false): void {
    if (!this.preview) {
      const scene = new THREE.Scene();
      const disposables: { dispose(): void }[] = [];
      const sky = makeSkyTexture(0x3a2f7a, 0x10122a);
      disposables.push(sky);
      scene.background = sky;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
      const key = new THREE.DirectionalLight(0xffffff, 2.2);
      key.position.set(-3, 6, 8);
      scene.add(key);
      // 台座：丸い台と、足元の光る輪
      const baseGeo = new THREE.CylinderGeometry(1.5, 1.7, 0.4, 40);
      const baseMat = new THREE.MeshToonMaterial({ color: 0x2a2f5a });
      disposables.push(baseGeo, baseMat);
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = -0.2;
      scene.add(base);
      const topGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.02, 40);
      const topMat = new THREE.MeshToonMaterial({ color: 0x3d4580 });
      disposables.push(topGeo, topMat);
      const top = new THREE.Mesh(topGeo, topMat);
      top.position.y = 0.005;
      scene.add(top);
      const ringGeo = new THREE.RingGeometry(1.25, 1.42, 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: SLOT_COLORS[slot % SLOT_COLORS.length], transparent: true, opacity: 0.8, side: THREE.DoubleSide });
      disposables.push(ringGeo, ringMat);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      scene.add(ring);
      // 後ろでゆっくり回る光の粒
      const dotGeo = new THREE.SphereGeometry(0.05, 6, 5);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xbfc8ff, transparent: true, opacity: 0.6 });
      disposables.push(dotGeo, dotMat);
      const dots = new THREE.Group();
      dots.name = 'dots';
      for (let i = 0; i < 40; i++) {
        const d = new THREE.Mesh(dotGeo, dotMat);
        const a = (i / 40) * Math.PI * 2;
        const r = 3 + (i % 5) * 0.7;
        d.position.set(Math.cos(a) * r, 0.5 + ((i * 37) % 30) / 8, Math.sin(a) * r - 2);
        dots.add(d);
      }
      scene.add(dots);
      const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
      this.preview = { scene, camera, model: null, charId: '', spin: 0, pop: 1, ring, disposables };
    }
    const pv = this.preview;
    (pv.ring.material as THREE.MeshBasicMaterial).color.setHex(SLOT_COLORS[slot % SLOT_COLORS.length]);
    const key = `${charId}/${costumeId ?? ''}`;
    if (pv.charId === key && pv.model) {
      pv.model.fancyIdle = fancy && getCostume(costumeId, charId).rarity >= 5;
      pv.model.cycleJobs = fancy;
      return;
    }
    if (pv.model) {
      pv.scene.remove(pv.model.root);
      pv.model.dispose();
    }
    const def = getCharacter(charId);
    pv.model = new FighterModel(def, getCostume(costumeId, charId), SLOT_COLORS[slot % SLOT_COLORS.length]);
    pv.model.previewTurn = 0.35;
    pv.model.fancyIdle = fancy && getCostume(costumeId, charId).rarity >= 5;
    // ガチャ・衣装一覧では、3B は仕事を順番に切り替えて見せる（レア度に関係なく。特別な動きは SSR だけ）
    pv.model.cycleJobs = fancy;
    pv.scene.add(pv.model.root);
    pv.charId = key;
    pv.spin = 0;
    pv.pop = 0;
  }

  /** 表示しているキャラにアクションをさせる（タップしたとき） */
  previewAction(): void {
    this.preview?.model?.playAction();
  }

  /** キャラ選択画面：指でなぞってキャラを回す */
  spinPreview(delta: number): void {
    if (this.preview) this.preview.spin += delta;
  }

  hidePreview(): void {
    const pv = this.preview;
    if (!pv) return;
    if (pv.model) pv.model.dispose();
    pv.disposables.forEach((d) => d.dispose());
    this.preview = null;
  }

  private renderPreview(dt: number): void {
    const pv = this.preview!;
    const cam = pv.camera;
    const w = window.innerWidth;
    const h = Math.max(1, window.innerHeight);
    cam.aspect = w / h;
    // キャラを画面の左寄り（約 22%）に置く。縦はキャラの全身が入る距離
    const dist = 8.2;
    const halfW = Math.tan(((cam.fov / 2) * Math.PI) / 180) * dist * cam.aspect;
    const offset = halfW * 0.56;
    cam.position.set(offset, 1.9, dist);
    cam.lookAt(offset, 1.25, 0);
    cam.updateProjectionMatrix();
    if (pv.model) {
      const def = getCharacter(pv.charId.split('/')[0]);
      pv.pop = Math.min(1, pv.pop + dt * 5);
      // 選び直したときに、ぽんっと弾む
      const s = 1 + Math.sin(pv.pop * Math.PI) * 0.12;
      pv.model.root.scale.setScalar(1.25 * s);
      pv.spin *= Math.pow(0.15, dt);
      pv.model.previewTurn = 0.35 + pv.spin;
      const fake: ViewFighter = {
        slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: Math.floor(this.time * 60), move: null, moveFrame: 0,
        damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
      };
      pv.model.update(fake, def, this.time, dt);
      pv.model.root.position.y = 0;
    }
    const dots = pv.scene.getObjectByName('dots');
    if (dots) dots.rotation.y = this.time * 0.15;
    this.renderer.render(pv.scene, cam);
  }

  private portraits = new Map<string, string>();
  /** HUD用の顔アイコン（キャラの顔を正面から描いた小さな画像。衣装ごとに使い回す） */
  portrait(charId: string, costumeId?: string): string {
    const key = `${charId}/${costumeId ?? ''}`;
    const hit = this.portraits.get(key);
    if (hit) return hit;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.8));
    const key2 = new THREE.DirectionalLight(0xffffff, 2);
    key2.position.set(1, 3, 5);
    scene.add(key2);
    const def = getCharacter(charId);
    const model = new FighterModel(def, getCostume(costumeId, charId), 0xffffff);
    model.previewTurn = 0.25;
    model.showMarker = false;
    scene.add(model.root);
    const fake: ViewFighter = {
      slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: 0, move: null, moveFrame: 0,
      damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
    };
    model.update(fake, def, 0.5, 1);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    const hy = 1.62 * def.scale;
    cam.position.set(0.25, hy + 0.05, 2.1 * def.scale);
    cam.lookAt(0, hy, 0);
    const S = 96;
    const pr = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE.Vector2());
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setClearAlpha(0);
    this.renderer.setViewport(0, 0, S, S);
    this.renderer.setScissor(0, 0, S, S);
    this.renderer.setScissorTest(true);
    this.renderer.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const gl = this.renderer.domElement;
    c.getContext('2d')!.drawImage(gl, 0, gl.height - S * pr, S * pr, S * pr, 0, 0, S, S);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    this.renderer.setClearAlpha(prevClear);
    model.dispose();
    const url = c.toDataURL('image/png');
    this.portraits.set(key, url);
    return url;
  }

  /** ステージ選択用の小さな画像（実際のステージを描いて作る。一度作ったら使い回す） */
  stageThumbnail(stage: StageDef): string {
    const cached = this.thumbs.get(stage.id);
    if (cached) return cached;
    const scene = new THREE.Scene();
    const th = stage.theme;
    const sky = makeSkyTexture(th.sky, th.skyBottom);
    scene.background = sky;
    const day = th.bright;
    scene.fog = new THREE.Fog(th.fog, day ? 45 : 30, day ? 130 : 120);
    scene.add(day ? new THREE.HemisphereLight(0xffffff, 0x445566, 1.6) : new THREE.HemisphereLight(0xd8dcff, 0x3a2a4a, 1.8));
    const sun = new THREE.DirectionalLight(day ? 0xffffff : 0xfff2e6, day ? 2.2 : 2.3);
    sun.position.set(-8, 20, 14);
    scene.add(sun);
    const built = buildStageScene(stage, 'low');
    scene.add(built.group);
    built.animate(1, 0);
    const m = stage.main;
    const cx = (m.x1 + m.x2) / 2;
    const cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
    cam.position.set(cx, m.top + 6, 34);
    cam.lookAt(cx, m.top + 2.5, 0);
    // 画面の左下に小さく描いて、すぐに 2D の画像へ写す（描いた直後なら読み取れる）
    const W = 256;
    const H = 144;
    const pr = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setViewport(0, 0, W, H);
    this.renderer.setScissor(0, 0, W, H);
    this.renderer.setScissorTest(true);
    this.renderer.render(scene, cam);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const gl = this.renderer.domElement;
    c.getContext('2d')!.drawImage(gl, 0, gl.height - H * pr, W * pr, H * pr, 0, 0, W, H);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    built.dispose();
    sky.dispose();
    const url = c.toDataURL('image/jpeg', 0.85);
    this.thumbs.set(stage.id, url);
    return url;
  }

  render(view: ViewState | null, dt: number, newEvents: GameEvent[]): void {
    this.time += dt;
    // 暗転：予告から1.5秒後に暗くなり、約3秒続いてから明るく戻る
    const bt = this.blackoutAt < 0 || this.preview || !view ? -1 : this.time - this.blackoutAt;
    const dark = bt < 0 ? 0 : bt < 0.3 ? bt / 0.3 : bt < 3.3 ? 1 : bt < 3.8 ? (3.8 - bt) / 0.5 : 0;
    this.blackout.style.opacity = dark.toFixed(2);
    if (this.preview) {
      this.updateParticles(dt);
      this.renderPreview(dt);
      return;
    }
    if (view && this.stage) {
      // 動く足場
      this.stage.platforms.forEach((p, i) => {
        const at = platformAt(p, view.frame);
        this.platformMeshes[i].position.x = (at.x1 + at.x2) / 2;
        this.platformMeshes[i].position.y = at.y - 0.11;
      });
      for (const f of view.fighters) {
        const m = this.models.get(f.slot);
        if (!m) continue;
        m.model.buddyAway = view.entities.some((e) => e.kind === 'drone' && e.owner === f.slot);
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
        m = new FighterModel(def, getCostume(p.costume, p.charId), playerColor(this.setup, e.owner));
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
    this.flightFx(view);
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

  // ---------------------------------------------------------------- ふっとびの残像・スピード線
  private flight = new Map<number, { px: number; py: number; vx: number; vy: number; hist: ViewFighter[]; ghosts: FighterModel[] }>();
  private streaks: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  private streakGeo = new THREE.PlaneGeometry(1, 1);

  /** 速くふっとんでいる人に、残像（半透明のキャラ）と、後ろへ流れる線を出す */
  private flightFx(view: ViewState): void {
    for (const f of view.fighters) {
      let st = this.flight.get(f.slot);
      if (!st) {
        st = { px: f.x, py: f.y, vx: 0, vy: 0, hist: [], ghosts: [] };
        this.flight.set(f.slot, st);
      }
      // 速さは表示位置の変化から求める（瞬間移動は無視）
      const dx = f.x - st.px;
      const dy = f.y - st.py;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && view.frame !== this.lastFlightFrame) {
        st.vx = st.vx * 0.5 + dx * 60 * 0.5;
        st.vy = st.vy * 0.5 + dy * 60 * 0.5;
      }
      st.px = f.x;
      st.py = f.y;
      const speed = Math.hypot(st.vx, st.vy);
      const flying = f.state === 'hitstun' && speed > 13;
      if (view.frame !== this.lastFlightFrame) {
        st.hist.unshift({ ...f });
        if (st.hist.length > 12) st.hist.length = 12;
      }
      // 残像：画質「きれい」のときだけ（3体ぶんのキャラを描くので）
      const useGhosts = flying && this.quality === 'high' && st.hist.length >= 10;
      if (useGhosts && st.ghosts.length === 0) {
        const p = this.setup?.players.find((x) => x.slot === f.slot);
        if (p) {
          const def = getCharacter(p.charId);
          for (let i = 0; i < 3; i++) {
            const g = new FighterModel(def, getCostume(p.costume, p.charId), playerColor(this.setup, f.slot));
            g.showMarker = false;
            g.ghost = [0.4, 0.26, 0.14][i];
            this.scene.add(g.root);
            st.ghosts.push(g);
          }
        }
      }
      st.ghosts.forEach((g, i) => {
        g.root.visible = useGhosts;
        if (!useGhosts) return;
        const past = st!.hist[(i + 1) * 3];
        if (!past) return;
        const p = this.setup!.players.find((x) => x.slot === f.slot)!;
        g.update(past, getCharacter(p.charId), this.time, 1 / 60);
      });
      // スピード線：進む向きの反対側へ流れる白い線
      if (flying && Math.random() < 0.8) {
        const a = Math.atan2(st.vy, st.vx);
        const len = 1.2 + Math.min(3, speed / 12);
        const side = (Math.random() - 0.5) * 1.4;
        const cx = f.x - Math.cos(a) * (len * 0.6 + 0.4) - Math.sin(a) * side;
        const cy = f.y + 0.9 - Math.sin(a) * (len * 0.6 + 0.4) + Math.cos(a) * side;
        const mesh = new THREE.Mesh(this.streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
        mesh.position.set(cx, cy, 0.6);
        mesh.rotation.z = a;
        mesh.scale.set(len, 0.05, 1);
        this.scene.add(mesh);
        this.streaks.push({ mesh, life: 10, max: 10 });
      }
    }
    this.lastFlightFrame = view.frame;
  }
  private lastFlightFrame = -1;

  // ---------------------------------------------------------------- 撃墜確定の一撃：スロー＆ズーム
  /** 演出中か・始まってからの時間・ズームする相手・ふっとび始めた時間（-1 = まだヒットストップ中） */
  private finish = { on: false, t: 0, slot: -1, x: 0, y: 0, sx: 0, sy: 0, flyAt: -1 };
  /** スローの倍率（1 = 通常）。main.ts がCPU戦の進み方に使う */
  get timeScale(): number {
    const fi = this.finish;
    if (!fi.on) return 1;
    // 当たった瞬間の止まり（ヒットストップ）は半分の速さ → ふっとび始めたらゆっくり → 元の速さへ
    if (fi.flyAt < 0) return 0.5;
    const e = fi.t - fi.flyAt;
    if (e < FINISH_SLOW) return 0.15;
    return Math.min(1, 0.15 + ((e - FINISH_SLOW) / FINISH_BACK) * 0.85);
  }

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
    if (e.k === 'taunt') {
      const f = view.fighters.find((x) => x.slot === e.s);
      const p = this.setup?.players.find((x) => x.slot === e.s);
      if (f && p) {
        const t = TAUNT_LINES[p.charId];
        const line = t ? (getCostume(p.costume, p.charId).rarity >= 5 ? t.ssr : t.lines[e.i % t.lines.length]) : '！';
        this.props.showBubble(line, f.x, f.y + 2.9 * getCharacter(p.charId).scale);
      }
      return;
    }
    if (e.k === 'item') {
      this.props.showText(ITEM_NAMES[e.t] ?? 'アイテム', ['#4fd18b', '#b6ff3a', '#ff5a5a', '#6ab8ff'][e.t] ?? '#fff', e.x, e.y + 1.4);
      this.spawn(this.ringGeo, [0x4fd18b, 0xb6ff3a, 0xff3b3b, 0x4f9dff][e.t] ?? 0xffffff, e.x, e.y, 0, 0, 0.4, 20, 0.06);
      if (e.t === 2) this.shake = Math.max(this.shake, 0.6);
      return;
    }
    if (e.k === 'warn') {
      this.gimmickWarn(e);
      return;
    }
    if (e.k === 'finish') {
      // 撃墜確定：スローにして寄る。白い閃光と、光る輪
      const v = view.fighters.find((f) => f.slot === e.s);
      this.finish = { on: true, t: 0, slot: e.s, x: e.x, y: e.y, sx: v?.x ?? e.x, sy: v?.y ?? e.y, flyAt: -1 };
      this.spawn(this.sparkGeo, 0xffffff, e.x, e.y, 0, 0, 1.2, 10, 0.3, true);
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.6, 22, 0.16, true);
      this.spawn(this.ringGeo, 0xffd23f, e.x, e.y, 0, 0, 0.4, 26, 0.1, true);
      this.shake = Math.max(this.shake, 0.9);
      return;
    }
    if (e.k === 'swap') {
      // なりすまし：入れ替わった2か所に紫の煙
      for (const [x, y] of [[e.x, e.y], [e.x2, e.y2]]) {
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          this.spawn(this.sparkGeo, i % 2 ? 0xb06bff : 0xe8e8f0, x, y + 0.9, Math.cos(a) * 3, Math.sin(a) * 3, 0.2, 22, 0.008);
        }
        this.spawn(this.ringGeo, 0xb06bff, x, y + 0.9, 0, 0, 0.3, 14, 0.04);
      }
      this.props.showText('入れ替わり！', '#c77dff', (e.x + e.x2) / 2, Math.max(e.y, e.y2) + 2.2);
      return;
    }
    if (e.k === 'pull') {
      // 通知爆撃：相手からドパガキへ通知バッジの列が流れる
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const x = e.x + (e.tx - e.x) * t;
        const y = e.y + (e.ty - e.y) * t;
        this.spawn(this.sparkGeo, 0xff3b3b, x, y, (e.tx - e.x) * 1.5, (e.ty - e.y) * 1.5, 0.16, 16 + i * 2, -0.004);
      }
      this.spawn(this.ringGeo, 0xff3b3b, e.x, e.y, 0, 0, 0.3, 12, 0.04);
      this.props.showText('通知！', '#ff5a5a', e.x, e.y + 1.2);
      return;
    }
    if (e.k === 'sleep') {
      this.spawn(this.ringGeo, 0x7ef0d0, e.x, e.y, 0, 0, 0.3, 16, 0.05);
      return;
    }
    if (e.k === 'hit') {
      this.costumeHit(e);
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
      const color = playerColor(this.setup, e.s);
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

  /** ステージギミックの予告：何が来るかの文字と、来る場所の印 */
  private gimmickWarn(e: Extract<GameEvent, { k: 'warn' }>): void {
    const st = this.stage;
    if (!st) return;
    const m = st.main;
    const labels: Record<string, string> = {
      rooftop: e.d > 0 ? '強風注意 →→' : '←← 強風注意',
      vault: '警報！レーザー（ジャンプでよけろ）',
      arcade: 'スクーターが来る！（ジャンプでよけろ）',
      studio: 'コメントの弾幕！',
      cyber: 'データが降ってくる！',
      timeline: '通知の嵐！',
      gacha: 'カプセルの雨！',
      lab: 'AIの光線が来る！',
      gym: e.d > 0 ? 'ランニングマシン始動 →→' : '←← ランニングマシン始動',
      livebar: '照明が落ちる！',
    };
    if (e.h === 'livebar') this.blackoutAt = this.time + 1.5;
    this.props.showText(`⚠ ${labels[e.h] ?? '注意！'}`, '#ffd23f', (m.x1 + m.x2) / 2, m.top + 6.5, true, 110);
    if (e.h === 'lab') {
      // 光線が落ちる場所に赤い印
      for (let i = 0; i < 3; i++) this.spawn(this.ringGeo, 0xff3b3b, e.x, m.top + 0.1, 0, 0, 0.9, 40 + i * 25, -0.004);
    } else if (e.h === 'vault' || e.h === 'arcade' || e.h === 'studio') {
      // 来る側の端に「！」
      const x = e.d > 0 ? m.x1 - 0.5 : m.x2 + 0.5;
      this.props.showText('！', '#ff5a5a', x, e.y + 0.6, true, 110);
    }
  }

  /** SSR衣装の人が攻撃を当てたとき：衣装の粒（星・ハート・コインなど）がはじける */
  private costumeHit(e: Extract<GameEvent, { k: 'hit' }>): void {
    if (e.a === undefined || e.a === e.s) return;
    const p = this.setup?.players.find((x) => x.slot === e.a);
    if (!p) return;
    const fx = getCostume(p.costume, p.charId).fx;
    if (!fx) return;
    const tex = fxTexture(fx.particle);
    const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
    const n = 7 + Math.min(6, Math.round(e.p / 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 3 + Math.random() * 4;
      // 3つに1つは白くして、どんな背景でも見えるようにする
      const color = i % 3 === 0 ? 0xffffff : fx.hit < 0 ? rainbow[i % rainbow.length] : fx.hit;
      const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(e.x, e.y, 0.6);
      sprite.scale.setScalar(0.7);
      this.scene.add(sprite);
      this.particles.push({ mesh: sprite as unknown as THREE.Mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, life: 36, max: 36, grow: -0.006 });
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
    this.streaks = this.streaks.filter((st) => {
      st.life -= steps;
      if (st.life <= 0) {
        this.scene.remove(st.mesh);
        (st.mesh.material as THREE.Material).dispose();
        return false;
      }
      (st.mesh.material as THREE.MeshBasicMaterial).opacity = (st.life / st.max) * 0.7;
      return true;
    });
    if (this.finish.on) {
      const fi = this.finish;
      fi.t += dt;
      // 1秒たっても動かなければ（ヒットストップが長いなど）、ふっとび始めたことにする
      if (fi.flyAt < 0 && fi.t > 1) fi.flyAt = fi.t;
      if (fi.flyAt >= 0 && fi.t - fi.flyAt > FINISH_SLOW + FINISH_BACK) fi.on = false;
    }
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
    if (this.finish.on && this.focusSlot === null) {
      // 撃墜確定：ふっとぶ相手にぐっと寄る（演出の前半で寄り、後半で戻る）
      const v = view.fighters.find((f) => f.slot === this.finish.slot);
      if (v && v.state !== 'dead') {
        this.finish.x = v.x;
        this.finish.y = v.y + 0.9;
        if (this.finish.flyAt < 0 && Math.hypot(v.x - this.finish.sx, v.y - this.finish.sy) > 0.05) this.finish.flyAt = this.finish.t;
      }
      // 元の速さへ戻す間に、いつものカメラへ戻す
      const back = this.finish.flyAt < 0 ? 0 : this.finish.t - this.finish.flyAt - FINISH_SLOW;
      const w = back <= 0 ? 1 : Math.max(0, 1 - back / FINISH_BACK);
      const tx = this.finish.x;
      const ty = this.finish.y;
      const kk = Math.min(1, dt * 14 * w + 0.02);
      this.camLook.x += (tx - this.camLook.x) * kk * w;
      this.camLook.y += (ty - this.camLook.y) * kk * w;
      this.camPos.x += (tx - this.camPos.x) * kk * w;
      this.camPos.y += (ty + 0.8 - this.camPos.y) * kk * w;
      this.camPos.z += (10 - this.camPos.z) * kk * w;
      if (w >= 1) {
        this.shake *= Math.pow(0.02, dt);
        const sx = (Math.random() - 0.5) * this.shake * 0.5;
        const sy = (Math.random() - 0.5) * this.shake * 0.5;
        this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
        this.camera.lookAt(this.camLook.x + sx, this.camLook.y + sy, 0);
        return;
      }
    }
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
    // すり抜け床（動く床・浮島）も画面に入れる
    for (const sp of st.platforms) {
      const at = platformAt(sp, view.frame);
      minX = Math.min(minX, at.x1 - 0.5);
      maxX = Math.max(maxX, at.x2 + 0.5);
      maxY = Math.max(maxY, at.y + 1.5);
    }
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
