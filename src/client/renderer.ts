// three.js による描画：ステージ、キャラクター、カメラ、エフェクト

import * as THREE from 'three';
import { areaColor, ballTeamOf, getCharacter, ITEM_COLORS, ITEM_INFO, ITEM_NAMES, playerColor, SLOT_COLORS, TAUNT_LINES, TEAM_COLORS } from '../shared/characters';
import { platformAt, type StageDef } from '../shared/stages';
import { TETHER } from '../shared/moves';
import { BALL, ballBaskets, COUNTDOWN_FRAMES, gimmickAt, gimmickPhase, isSlippery, ROULETTE, SIZE_REQ, WARP, warpSpots } from '../shared/sim';
import { THROW } from '../shared/ballThrow';
import { GIMMICK, VAULT } from '../shared/moves';
import { FX_BIG, FX_SMALL, FX_SPEED, FX_WARPCD, type GameEvent, type MatchSetup, type ViewFighter, type ViewState } from '../shared/types';
import { getCostume } from '../shared/costumes';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FighterModel, fxTexture, type FaceKind, type FaceMouth } from './fighterModel';
import { buildStageScene, makeSkyTexture, type BuiltStage } from './stageScene';
import { PropRenderer } from './props';

export type Quality = 'low' | 'high';

/** 撃墜確定の演出：ふっとび始めてからのスローの長さと、元の速さへ戻すまでの長さ（秒） */
/** カメラを角度を変えずに上へ平行移動する量（m）。決めていないステージは 0 */
const CAM_RAISE: Record<string, number> = { rooftop: 1.0 };
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

/** 衣装の文字（「三刀流！」など）を同じ人が続けて出せる間隔 */
const HIT_TEXT_GAP_MS = 5000;

/** 投げる道筋の点の数の上限 */
const GUIDE_MAX = 160;

/** 小さな正方形のキャンバスに描いたテクスチャ */
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
    // iPhone では、向きを変えた直後などに古い大きさのまま resize が来ることがあるので、少しあとにも測り直す
    const later = () => [100, 400, 1000].forEach((ms) => setTimeout(() => this.resize(), ms));
    window.addEventListener('orientationchange', later);
    window.visualViewport?.addEventListener('resize', later);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) later();
    });
  }

  /** 画面に出ているキャンバスの大きさ（CSS の大きさ）。取れなければ window の大きさ */
  private viewSize(): { w: number; h: number } {
    const c = this.renderer.domElement;
    return { w: Math.max(1, c.clientWidth || window.innerWidth), h: Math.max(1, c.clientHeight || window.innerHeight) };
  }
  private sizeW = 0;
  private sizeH = 0;
  /** 定期的に：実際に画面に出ている大きさが変わっていたら合わせる（縦横比がずれてキャラが潰れて見えるのを防ぐ） */
  private sizeTick = 0;
  private checkSize(): void {
    // 大きさを読むと画面の配置の計算が走るので、毎フレームではなく約0.25秒ごとに見る
    if (++this.sizeTick % 15 !== 0) return;
    const { w, h } = this.viewSize();
    if (w !== this.sizeW || h !== this.sizeH) this.resize();
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
    const { w, h } = this.viewSize();
    this.sizeW = w;
    this.sizeH = h;
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
    this.clearEntrances();
    this.entranceChecked = false;
    this.clear();
    this.stage = stage;
    this.setup = setup;
    this.focusSlot = null;
    this.buildStage(stage);
    this.buildModels();
    if (setup.rules.mode === 'ball') this.buildBall(stage);
    if (setup.rules.mode === 'crown') this.buildCrown();
    if (setup.rules.mode === 'vault') this.buildVaults(stage);
    if (setup.rules.mode === 'bounty') this.buildBounty();
    if (setup.rules.mode === 'coins') this.buildCoins();
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
  /** ワープホールから出てきた人と、出てきた時刻（ゆっくり大きくなる演出） */
  private warpGrow = new Map<number, number>();
  /** この端末で操作している人（ワープの待ち時間の表示に使う） */
  localSlot: number | null = null;

  clear(): void {
    if (this.ballObj) {
      this.disposeBeam(this.ballObj.root);
      this.ballObj = null;
    }
    if (this.crownObj) {
      this.disposeBeam(this.crownObj.root);
      this.crownObj = null;
    }
    if (this.vaultObj) {
      this.disposeBeam(this.vaultObj.root);
      this.vaultObj = null;
    }
    if (this.bountyObj) {
      this.disposeBeam(this.bountyObj.root);
      this.bountyObj = null;
    }
    if (this.coinObj) {
      this.disposeBeam(this.coinObj.root);
      this.coinObj = null;
    }
    for (const z of this.areaMeshes) this.disposeBeam(z.g);
    this.areaMeshes = [];
    for (const en of this.entrances) this.disposeBeam(en.beam);
    this.entrances = [];
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
    // 前の試合の空の画像を片付けてから作り直す（残すと試合のたびに1枚ずつたまる）
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
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
    // 24時間ジムの清掃タイム：床がぬれて光る（ふだんは見えない）
    this.wetFloor = null;
    if (th.kind === 'gym') {
      const m = stage.main;
      const wet = new THREE.Mesh(
        new THREE.PlaneGeometry(m.x2 - m.x1 - 0.2, 3.4),
        new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0, depthWrite: false }),
      );
      wet.rotation.x = -Math.PI / 2;
      wet.position.set((m.x1 + m.x2) / 2, m.top + 0.03, 0);
      wet.renderOrder = 2;
      this.stageGroup.add(wet);
      this.wetFloor = wet;
    }
    const m = stage.main;
    // 電脳空間：台の左右の端にワープホール（ふだんは見えない）
    this.portals = [];
    if (th.kind === 'cyber') {
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(WARP.r, 0.09, 10, 36), new THREE.MeshBasicMaterial({ color: side < 0 ? 0x39ff88 : 0xc77dff, transparent: true }));
        const core = new THREE.Mesh(new THREE.CircleGeometry(WARP.r * 0.92, 32), new THREE.MeshBasicMaterial({ color: side < 0 ? 0x0f5a34 : 0x3a1a5a, transparent: true, opacity: 0.6 }));
        g.add(core, ring);
        g.position.set(side < 0 ? m.x1 + WARP.inset : m.x2 - WARP.inset, m.top + WARP.y, 0.1);
        g.visible = false;
        this.stageGroup.add(g);
        this.portals.push(g);
      }
    }
    // ガチャ会場：台の床を当たり床ルーレットのマスに分ける（ふだんは見えない）
    this.rouletteTiles = [];
    this.rouletteResult = null;
    if (th.kind === 'gacha') {
      const tw = (m.x2 - m.x1) / ROULETTE.tiles;
      for (let i = 0; i < ROULETTE.tiles; i++) {
        const tile = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.12, 3.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(m.x1 + tw * (i + 0.5), m.top + 0.035, 0);
        tile.renderOrder = 2;
        this.stageGroup.add(tile);
        this.rouletteTiles.push(tile);
      }
    }
  }
  /** ワープホール・ルーレットのマス・レーザーの予告線（試合の経過フレームに合わせる） */
  private updateGimmickVisuals(view: ViewState, dt: number): void {
    const st = this.stage!;
    const on = !!this.setup!.rules.gimmicks;
    const kind = st.theme.kind;
    // ワープホール：出ている間だけ、回りながら光る
    if (this.portals.length) {
      const at = gimmickAt(view.frame, on, kind, 'cyber');
      const show = at >= 0 && at < WARP.time;
      // 場所は毎回ランダム（サーバーと同じ計算）
      const spots = show ? warpSpots(st, this.setup!.seed, view.frame) : [];
      // 自分がくぐったばかり（待ち時間中）なら、ワープホールを暗くして回転も止める
      const me = this.localSlot === null ? undefined : view.fighters.find((f) => f.slot === this.localSlot);
      const cooling = !!me && (me.fx & FX_WARPCD) !== 0;
      for (const [i, g] of this.portals.entries()) {
        for (const c of g.children) {
          const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = cooling ? 0.18 : c === g.children[0] ? 0.6 : 1;
        }
        g.visible = show;
        if (!show) continue;
        g.position.set(spots[i].x, spots[i].y, 0.1);
        const grow = Math.min(1, at / 15, (WARP.time - at) / 15);
        g.scale.setScalar(Math.max(0.01, grow));
        if (!cooling) g.rotation.z = this.time * (i ? -2 : 2);
      }
    }
    // ルーレット：予告の前半は光が回り、止まったら当たり（緑）・ハズレ（赤）を見せる。本番のあと1秒で消える
    if (this.rouletteTiles.length) {
      const ph = gimmickPhase(view.frame, on, kind, 'gacha');
      const n = this.rouletteTiles.length;
      const spinning = ph >= 0 && ph < ROULETTE.stopAt;
      const showing = ph >= ROULETTE.stopAt && ph < GIMMICK.warn + 60 && !!this.rouletteResult;
      const lit = Math.floor(this.time * 14) % n;
      this.rouletteTiles.forEach((t, i) => {
        const mat = t.material as THREE.MeshBasicMaterial;
        let target = 0;
        if (spinning) {
          mat.color.setHex(i === lit ? 0xffd23f : 0xffffff);
          target = i === lit ? 0.6 : 0.12;
        } else if (showing) {
          const r = this.rouletteResult![i] ?? 0;
          mat.color.setHex(r > 0 ? 0x3cff8a : r < 0 ? 0xff3b3b : 0x888899);
          target = r !== 0 ? 0.5 + Math.sin(this.time * 10) * 0.15 : 0.08;
        }
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 12);
      });
      // 止まった瞬間：マスの上に「当たり」「ハズレ」（1回だけ）
      if (showing && this.rouletteShownAt !== view.frame - ph) {
        this.rouletteShownAt = view.frame - ph;
        const m = st.main;
        const tw = (m.x2 - m.x1) / n;
        this.rouletteResult!.forEach((r, i) => {
          if (r) this.props.showText(r > 0 ? '当たり' : 'ハズレ', r > 0 ? '#3cff8a' : '#ff5a5a', m.x1 + tw * (i + 0.5), m.top + 1.2, false, 100);
        });
      }
    }
    // レーザーの予告線：点滅させて、時間がたったら消す
    this.aimLines = this.aimLines.filter((l) => {
      if (this.time > l.until || this.preview) {
        this.scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        (l.mesh.material as THREE.Material).dispose();
        return false;
      }
      (l.mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.abs(Math.sin((this.time - l.from) * 9)) * 0.45;
      return true;
    });
  }
  /** ルーレットの「当たり・ハズレ」の文字を出した回（予告の始まりのフレーム） */
  private rouletteShownAt = -1;

  /** 清掃タイムの、ぬれた床（24時間ジムだけ） */
  private wetFloor: THREE.Mesh | null = null;
  /** 電脳空間のワープホール（左右の2つ） */
  private portals: THREE.Group[] = [];
  /** ガチャ会場の当たり床ルーレットのマスと、止まった結果 */
  private rouletteTiles: THREE.Mesh[] = [];
  private rouletteResult: number[] | null = null;
  /** 深夜の金庫室：レーザーの通り道の予告線（消える時刻つき） */
  private aimLines: { mesh: THREE.Mesh; until: number; from: number }[] = [];

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
    const { w, h } = this.viewSize();
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
  portrait(charId: string, costumeId?: string, face?: [FaceKind, FaceMouth], job?: number): string {
    const key = `${charId}/${costumeId ?? ''}${face ? `/${face.join('-')}` : ''}${job !== undefined ? `/j${job}` : ''}`;
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
    if (face) model.forceFace = face;
    // 3B：職業（美容師・バンドマン・バーテンダー）を決めて描く
    if (job !== undefined) model.previewJob = job;
    scene.add(model.root);
    const fake: ViewFighter = {
      slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: 0, move: null, moveFrame: 0,
      damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
    };
    model.update(fake, def, 0.5, 1);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    let hy = 1.62 * def.scale;
    if (face) {
      // スタンプ：キャラごとに頭の高さが違うので、頭の位置を測って顔を真ん中に写す
      model.root.updateMatrixWorld(true);
      hy = model.head.getWorldPosition(new THREE.Vector3()).y + 0.34 * def.scale;
    }
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

  private bodies = new Map<string, string>();
  /** プロフィールの名刺カード用：キャラの全身を描いた画像（衣装ごとに使い回す） */
  fullBody(charId: string, costumeId?: string): string {
    const key = `${charId}/${costumeId ?? ''}`;
    const hit = this.bodies.get(key);
    if (hit) return hit;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.8));
    const key2 = new THREE.DirectionalLight(0xffffff, 2);
    key2.position.set(1, 3, 5);
    scene.add(key2);
    const def = getCharacter(charId);
    const model = new FighterModel(def, getCostume(costumeId, charId), 0xffffff);
    model.previewTurn = 0.45;
    model.showMarker = false;
    scene.add(model.root);
    const fake: ViewFighter = {
      slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: 0, move: null, moveFrame: 0,
      damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
    };
    model.update(fake, def, 0.5, 1);
    const cam = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50);
    const hy = 1.05 * def.scale;
    cam.position.set(0.3, hy + 0.15, 5.4 * def.scale);
    cam.lookAt(0, hy, 0);
    const W = 192;
    const H = 240;
    const pr = this.renderer.getPixelRatio();
    const size = this.renderer.getSize(new THREE.Vector2());
    const prevClear = this.renderer.getClearAlpha();
    this.renderer.setClearAlpha(0);
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
    this.renderer.setClearAlpha(prevClear);
    model.dispose();
    const url = c.toDataURL('image/png');
    this.bodies.set(key, url);
    return url;
  }

  /** ステージ選択用の小さな画像（実際のステージを描いて作る。一度作ったら使い回す） */
  /** 作り済みのステージの画像（まだなら null） */
  cachedThumbnail(id: string): string | null {
    return this.thumbs.get(id) ?? null;
  }

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

  /** 試合の中の位置（x, y）が、画面のどこに映るか（画面の左上が 0,0 のピクセル） */
  project(x: number, y: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, 0).project(this.camera);
    const { w, h } = this.viewSize();
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  render(view: ViewState | null, dt: number, newEvents: GameEvent[]): void {
    this.time += dt;
    this.checkSize();
    // 暗転：予告から1.5秒後に暗くなり、約3秒続いてから明るく戻る
    const bt = this.blackoutAt < 0 || this.preview || !view ? -1 : this.time - this.blackoutAt;
    const dark = bt < 0 ? 0 : bt < 0.3 ? bt / 0.3 : bt < 3.3 ? 1 : bt < 3.8 ? (3.8 - bt) / 0.5 : 0;
    this.blackout.style.opacity = dark.toFixed(2);
    if (this.preview) {
      this.updateParticles(dt);
      this.renderPreview(dt);
      return;
    }
    if (view && this.stage && this.setup) this.updateGimmickVisuals(view, dt);
    if (view && this.stage && this.wetFloor && this.setup) {
      // 清掃タイム中は床がぬれて光り、きらきらする
      const on = isSlippery(view.frame, !!this.setup.rules.gimmicks, this.stage.theme.kind);
      const mat = this.wetFloor.material as THREE.MeshBasicMaterial;
      mat.opacity += ((on ? 0.45 + Math.sin(this.time * 6) * 0.08 : 0) - mat.opacity) * Math.min(1, dt * 6);
      if (on && Math.random() < dt * 14) {
        const m = this.stage.main;
        this.spawn(this.sparkGeo, 0xffffff, m.x1 + Math.random() * (m.x2 - m.x1), m.top + 0.1, 0, 0.6, 0.12, 24, 0.004);
      }
    }
    if (view && this.stage) {
      // 動く足場
      this.stage.platforms.forEach((p, i) => {
        const at = platformAt(p, view.frame);
        this.platformMeshes[i].position.x = (at.x1 + at.x2) / 2;
        this.platformMeshes[i].position.y = at.y - 0.11;
      });
      this.updateEntrances(view);
      this.updateAreaZones(view);
      this.updateBall(view, dt);
      this.updateCrown(view);
      this.updateVaults(view);
      this.updateBounty(view);
      for (const [slot, t0] of this.warpGrow) {
        const m = this.models.get(slot)?.model;
        const u = (this.time - t0) / 0.5;
        if (!m || u >= 1) {
          if (m) m.appear = 1;
          this.warpGrow.delete(slot);
          continue;
        }
        m.appear = 0.15 + 0.85 * (1 - (1 - u) * (1 - u));
      }
      this.updateCoins(view);
      for (const f of view.fighters) {
        const m = this.models.get(f.slot);
        if (!m) continue;
        m.model.buddyAway = view.entities.some((e) => e.kind === 'drone' && e.owner === f.slot);
        // 登場映像では、頭の上の目印（試合の表示）を出さない
        m.model.showMarker = !this.cinema;
        m.model.update(f, getCharacter(m.charId), this.time, dt);
      }
      // 飛び道具・壁・罠・広告ウィンドウ・Zzz（頭の上のマークは、キャラが見えているときだけ）
      const shownSlots = new Set<number>();
      for (const [slot, m] of this.models) if (!m.model.hiddenNow) shownSlots.add(slot);
      this.props.update(view, this.time, dt, shownSlots);
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
    this.renderMenuChar(dt);
  }

  // ---------------------------------------------------------------- メニュー画面：裏の戦闘の上に、選んでいるキャラを重ねて描く
  private menuChar: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; model: FighterModel; key: string; charId: string; spin: number; pop: number } | null = null;

  /** メニュー画面に出すキャラ（null で消す） */
  setMenuChar(charId: string | null, costumeId?: string): void {
    const key = charId ? `${charId}/${costumeId ?? ''}` : '';
    if (this.menuChar && this.menuChar.key === key) return;
    if (this.menuChar) {
      this.menuChar.model.dispose();
      this.menuChar = null;
    }
    if (!charId) return;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.7));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-3, 6, 8);
    scene.add(keyLight);
    const model = new FighterModel(getCharacter(charId), getCostume(costumeId, charId), 0xffffff);
    model.showMarker = false;
    model.previewTurn = 0.35;
    // 3B は仕事（美容師・バンドマン・バーテンダー）を順に切り替えて見せる
    model.cycleJobs = true;
    scene.add(model.root);
    this.menuChar = { scene, camera: new THREE.PerspectiveCamera(30, 1, 0.1, 100), model, key, charId, spin: 0, pop: 0 };
  }

  /** メニューのキャラをタップしたとき：くるっと回ってアクション */
  menuCharAction(): void {
    if (!this.menuChar) return;
    this.menuChar.model.playAction();
  }

  /** メニューのキャラを指でなぞって回す */
  spinMenuChar(dx: number): void {
    if (this.menuChar) this.menuChar.spin += dx;
  }

  private renderMenuChar(dt: number): void {
    const mc = this.menuChar;
    if (!mc) return;
    const cam = mc.camera;
    const { w, h } = this.viewSize();
    cam.aspect = w / h;
    // キャラを画面の左寄り（約 18%）に置く。縦長に近い画面（タブレット）では、少し遠くから写して大きくなりすぎないようにする
    const dist = 8.6 * Math.max(1, 1.9 / cam.aspect);
    const halfW = Math.tan(((cam.fov / 2) * Math.PI) / 180) * dist * cam.aspect;
    const offset = halfW * 0.64;
    cam.position.set(offset, 1.7, dist);
    cam.lookAt(offset, 1.45, 0);
    cam.updateProjectionMatrix();
    mc.pop = Math.min(1, mc.pop + dt * 5);
    mc.model.root.scale.setScalar(1.3 * (1 + Math.sin(mc.pop * Math.PI) * 0.1));
    mc.spin *= Math.pow(0.15, dt);
    mc.model.previewTurn = 0.35 + mc.spin;
    const fake: ViewFighter = {
      slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: Math.floor(this.time * 60), move: null, moveFrame: 0,
      damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
    };
    mc.model.update(fake, getCharacter(mc.charId), this.time, dt);
    mc.model.root.position.y = 0;
    // 戦闘の絵の上に、奥行きだけ消して重ねる
    const auto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(mc.scene, cam);
    this.renderer.autoClear = auto;
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

  /** アイテムを拾った文字を出した時刻（続けて拾ったときにずらす） */
  private itemTexts: number[] = [];

  private effect(e: GameEvent, view: ViewState): void {
    if (e.k === 'kick') {
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.3, 12, 0.05);
      // 投げた人の頭の上に小さく「シュート！」「パス！」
      const f = e.s !== undefined ? view.fighters.find((o) => o.slot === e.s) : undefined;
      if (f) this.props.showText(e.pass ? 'パス！' : 'シュート！', e.pass ? '#7dffb0' : '#ffd84a', f.x, f.y + 2.7, false, 60);
      return;
    }
    if (e.k === 'goal') {
      // ゴール：点を取ったチームの色の紙ふぶきと輪、大きな文字
      const col = TEAM_COLORS[e.t % TEAM_COLORS.length];
      for (let i = 0; i < 4; i++) this.spawn(this.ringGeo, i % 2 ? 0xffffff : col, e.x, e.y, 0, 0, 0.4 + i * 0.3, 30 + i * 4, 0.12 + i * 0.03, true);
      const tex = fxTexture('star');
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 9;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: i % 3 ? col : 0xffffff, transparent: true, depthWrite: false }));
        sprite.position.set(e.x, e.y, 0.8);
        sprite.scale.setScalar(0.6);
        this.scene.add(sprite);
        this.particles.push({ mesh: sprite as unknown as THREE.Mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 4, life: 50, max: 50, grow: -0.005 });
      }
      this.props.showText(`${e.t === 0 ? '赤' : '青'}チーム ${e.p === 2 ? '2ポイント！' : 'ゴール！'}`, '#' + col.toString(16).padStart(6, '0'), e.x < 0 ? e.x + 3 : e.x - 3, e.y + 1.8, true, 90);
      this.shake = Math.max(this.shake, 0.8);
      return;
    }
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
    if (e.k === 'crown') {
      // 王冠を手に入れた・奪った
      this.spawn(this.ringGeo, 0xffd84a, e.x, e.y, 0, 0, 0.3, 14, 0.1);
      this.props.showText('王冠ゲット！', '#ffd84a', e.x, e.y + 1.2, false, 50);
      return;
    }
    if (e.k === 'bpt') {
      // 賞金首：撃墜で点が入った（賞金首を倒したら大きく）
      if (e.b) {
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI;
          const sp = 3 + Math.random() * 5;
          this.spawn(this.sparkGeo, i % 2 ? 0xffd23f : 0xff4a5a, e.x, Math.max(e.y, 0), Math.cos(a) * sp, Math.sin(a) * sp, 0.18, 26, -0.004);
        }
      }
      const f = view.fighters.find((o) => o.slot === e.s);
      if (f) this.props.showText(e.b ? `賞金首撃破！ +${e.p}` : `+${e.p}`, e.b ? '#ff4a5a' : '#ffd84a', f.x, f.y + 2.2, e.b, e.b ? 70 : 45);
      return;
    }
    if (e.k === 'leashDmg') {
      // 赤い糸が切れて、ためていたダメージが一気に加わった
      this.spawn(this.ringGeo, 0xff3b6c, e.x, e.y - 0.6, 0, 0, 0.35, 16, 0.1);
      this.props.showText(`+${e.p}%`, '#ff3b6c', e.x, e.y, true, 60);
      this.shake = Math.max(this.shake, 0.35);
      return;
    }
    if (e.k === 'alarm') {
      // 緊急警報（警備員）：赤い輪が2重に広がり、「緊急警報！」
      this.spawn(this.ringGeo, 0xff3030, e.x, e.y - 0.6, 0, 0, 0.45, 20, 0.12);
      this.spawn(this.ringGeo, 0xffd23f, e.x, e.y - 0.6, 0, 0, 0.3, 14, 0.09);
      this.props.showText('緊急警報！', '#ff4a4a', e.x, e.y + 0.8, true, 80, true);
      this.shake = Math.max(this.shake, 0.2);
      return;
    }
    if (e.k === 'heavy') {
      // 重い愛のハートを拾った：ピンクの輪と「重い…！」
      this.spawn(this.ringGeo, 0xff4f9a, e.x, e.y, 0, 0, 0.4, 18, 0.1);
      this.props.showText('愛が重い…！', '#ff7ab8', e.x, e.y + 1.6, false, 60);
      return;
    }
    if (e.k === 'ring') {
      // 鬼電の着信音：ピンクの輪が広がる
      this.spawn(this.ringGeo, 0xff3b6c, e.x, e.y, 0, 0, 0.3, 16, 0.12);
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.2, 12, 0.09);
      this.props.showText('プルルル！', '#ff6fae', e.x, e.y + 0.6, false, 45);
      this.shake = Math.max(this.shake, 0.3);
      return;
    }
    if (e.k === 'cry') {
      // 泣き落とし：涙のしずくが周りに飛び散る
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        this.spawn(this.sparkGeo, 0x8fd8ff, e.x, e.y, Math.cos(a) * 6, Math.sin(a) * 4 + 2, 0.1, 22, -0.002);
      }
      this.props.showText('うぅ…', '#8fd8ff', e.x, e.y + 1.1, false, 45);
      return;
    }
    if (e.k === 'bnew') {
      const f = view.fighters.find((o) => o.slot === e.s);
      if (f) {
        this.spawn(this.ringGeo, 0xff4a5a, f.x, f.y + 1, 0, 0, 0.3, 16, 0.1);
        this.props.showText('賞金首！', '#ff4a5a', f.x, f.y + 2.4, false, 55);
      }
      return;
    }
    if (e.k === 'coin') {
      // コインを拾った：小さな金色の粒
      for (let i = 0; i < (e.v > 1 ? 8 : 3); i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawn(this.sparkGeo, 0xffd23f, e.x, e.y + 0.3, Math.cos(a) * 2.5, Math.sin(a) * 2.5 + 1.5, 0.08, 12, -0.003);
      }
      if (e.v > 1) this.props.showText(`+${e.v}`, '#ffd84a', e.x, e.y + 1.2, false, 40);
      return;
    }
    if (e.k === 'cdrop') {
      this.props.showText(`-${e.p}`, '#ff8a3a', e.x, e.y + 0.6, false, 40);
      return;
    }
    if (e.k === 'vhit') {
      // 金庫に当たった：火花
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        this.spawn(this.sparkGeo, i % 2 ? 0xffd84a : 0xffffff, e.x, e.y, Math.cos(a) * 4, Math.sin(a) * 4 + 2, 0.12, 12, -0.004);
      }
      return;
    }
    if (e.k === 'vopen') {
      // 扉が開いた：金色の輪と火花、大きな文字
      this.spawn(this.ringGeo, 0xffd23f, e.x, e.y, 0, 0, 0.4, 20, 0.12);
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI;
        const sp = 3 + Math.random() * 5;
        this.spawn(this.sparkGeo, i % 3 ? 0xffd23f : 0xffffff, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2, 24, -0.004);
      }
      this.props.showText(`${e.t === 0 ? '赤' : '青'}の金庫が開いた！`, '#ffd23f', e.x, e.y + 1.8, true, 80);
      this.shake = Math.max(this.shake, 0.4);
      return;
    }
    if (e.k === 'vclose') {
      this.props.showText('ガチャン', '#c8cede', e.x, e.y + 1.4, false, 40);
      return;
    }
    if (e.k === 'vgrab') {
      this.props.showText('金塊ゲット！', '#ffd23f', e.x, e.y + 0.6, false, 50);
      return;
    }
    if (e.k === 'vdrop') {
      this.spawn(this.ringGeo, 0xffd23f, e.x, e.y, 0, 0, 0.2, 12, 0.06);
      this.props.showText('落とした！', '#ffb347', e.x, e.y + 0.6, false, 45);
      return;
    }
    if (e.k === 'vreturn') {
      this.spawn(this.ringGeo, TEAM_COLORS[e.t], e.x, e.y, 0, 0, 0.3, 16, 0.08);
      if (e.s !== undefined) this.props.showText('取り返した！', '#' + TEAM_COLORS[e.t].toString(16).padStart(6, '0'), e.x, e.y + 1, false, 55);
      return;
    }
    if (e.k === 'vscore') {
      // 運び込んだ：チームの色の紙ふぶきと、大きな文字
      const col = TEAM_COLORS[e.t];
      for (let i = 0; i < 3; i++) this.spawn(this.ringGeo, i % 2 ? 0xffd23f : col, e.x, e.y, 0, 0, 0.4 + i * 0.3, 28 + i * 4, 0.12 + i * 0.03, true);
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * Math.PI;
        const sp = 4 + Math.random() * 6;
        this.spawn(this.sparkGeo, i % 3 ? 0xffd23f : col, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.22, 30, -0.004);
      }
      this.props.showText(`${e.t === 0 ? '赤' : '青'}チーム 金塊ゲット！`, '#' + col.toString(16).padStart(6, '0'), e.x < 0 ? e.x + 3 : e.x - 3, e.y + 1.2, true, 90);
      this.shake = Math.max(this.shake, 0.5);
      return;
    }
    if (e.k === 'rewind') {
      // Ctrl+Z：元いた場所と戻った先に緑の輪、戻った先に「Ctrl+Z」の文字
      this.spawn(this.ringGeo, 0x39ff88, e.x, e.y, 0, 0, 0.3, 14, 0.1);
      this.spawn(this.ringGeo, 0x39ff88, e.tx, e.ty, 0, 0, 0.5, 18, 0.12);
      for (let i = 0; i < 10; i++) {
        const t = i / 9;
        this.spawn(this.sparkGeo, 0x39ff88, e.x + (e.tx - e.x) * t, e.y + (e.ty - e.y) * t, 0, 1.5, 0.15, 16 + i, -0.004);
      }
      this.props.showText('Ctrl+Z', '#39ff88', e.tx, e.ty + 1.1, false, 60);
      return;
    }
    if (e.k === 'sudden') {
      // サドンデスの始まり：画面の上に大きく出す
      const m = this.stage?.main;
      const x = m ? (m.x1 + m.x2) / 2 : 0;
      this.props.showText('サドンデス！', '#ff5a5a', x, Math.max((m?.top ?? 0) + 2, this.screenY(0.4, x)), true, 150);
      this.shake = Math.max(this.shake, 0.5);
      return;
    }
    if (e.k === 'shout') {
      // メガホンの衝撃波：黄色と白の輪が、少しずつずれて広がる
      [0xffd84a, 0xffffff, 0xffd84a].forEach((col, i) => this.spawn(this.ringGeo, col, e.x, e.y, 0, 0, 0.3 + i * 0.12, 16 + i * 3, 0.14 + i * 0.02));
      this.props.showText('ワーッ！', '#ffd84a', e.x, e.y + 1.4, true, 50);
      this.shake = Math.max(this.shake, 0.45);
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
      // ワープホールから出てきた：小さい姿から、ゆっくり元の大きさに戻る
      if (e.w) this.warpGrow.set(e.s, this.time);
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
      // 拾ったとき：効果を大きく、アイテムの名前を小さく。続けて拾ったときは、前の文字と重ならないよう上にずらす
      this.itemTexts = this.itemTexts.filter((t) => this.time - t < 1.4);
      const up = this.itemTexts.length * 1.9;
      this.itemTexts.push(this.time);
      this.props.showText(ITEM_INFO[e.t]?.effect ?? 'アイテム', ITEM_COLORS[e.t] ?? '#fff', e.x, e.y + 2.0 + up, true, 90);
      this.props.showText(ITEM_NAMES[e.t] ?? '', '#ffffff', e.x, e.y + 1.15 + up, false, 90);
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
    // ギリギリ耐えたふっとび（close / safe）は演出なし
    if (e.k === 'aim') {
      // 金庫室のレーザー：飛んでくる通り道に、赤い線を点滅させて見せる
      const len = 60;
      const ang = Math.atan2(e.vy, e.vx);
      // 背景の赤いレーザー模様と見分けがつくよう、黄色の太い線にする
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.28), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.5, depthWrite: false }));
      mesh.position.set(e.x + Math.cos(ang) * (len / 2), e.y + Math.sin(ang) * (len / 2), 0.15);
      mesh.rotation.z = ang;
      mesh.renderOrder = 8;
      this.scene.add(mesh);
      // 飛んでくる側の、台の端あたりに「！」
      const st = this.stage;
      if (st) {
        const ex = e.vx > 0 ? st.main.x1 - 0.6 : st.main.x2 + 0.6;
        const ey = e.y + (e.vy / e.vx) * (ex - e.x);
        this.props.showText('！', '#ffd23f', ex, ey + 0.3, true, Math.round(GIMMICK.warn + e.i * 22));
      }
      // 予告（GIMMICK.warn）が終わって、その線のレーザーが通り過ぎるまで
      this.aimLines.push({ mesh, from: this.time, until: this.time + (GIMMICK.warn + e.i * 22) / 60 + 0.6 });
      return;
    }
    if (e.k === 'roulette') {
      this.rouletteResult = e.t;
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
      // UR 衣装の人が撃墜したとき：虹色の大爆発と、虹色の光の柱
      const killer = e.a !== undefined ? this.setup?.players.find((x) => x.slot === e.a) : undefined;
      if (killer && getCostume(killer.costume, killer.charId).rarity >= 6) this.urKo(e.x, e.y);
    }
  }

  /** ステージギミックの予告：何が来るかの文字と、来る場所の印 */
  /** 今のカメラで、画面の縦の位置 ndcY（-1 = 下の端、1 = 上の端）に見える高さ（奥行き z = 1 の面、横の位置 x のあたり） */
  private screenY(ndcY: number, x: number): number {
    const ray = new THREE.Raycaster();
    const xs = new THREE.Vector3(x, 0, 1).project(this.camera).x;
    ray.setFromCamera(new THREE.Vector2(xs, ndcY), this.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    if (Math.abs(d.z) < 1e-6) return o.y;
    const t = (1 - o.z) / d.z;
    return o.y + d.y * t;
  }

  private gimmickWarn(e: Extract<GameEvent, { k: 'warn' }>): void {
    const st = this.stage;
    if (!st) return;
    const m = st.main;
    const labels: Record<string, string> = {
      rooftop: e.d > 0 ? '強風注意 →→' : '←← 強風注意',
      vault: 'レーザー警報！（黄色い線からにげろ）',
      arcade: 'スクーターが来る！（ジャンプでよけろ）',
      studio: e.d > 0 ? '視聴者リクエスト：全員でっかくなれ！' : '視聴者リクエスト：全員ちっちゃくなれ！',
      cyber: 'ワープホール出現！（2つの穴がつながる）',
      timeline: '通知の嵐！',
      gacha: '当たり床ルーレット！',
      lab: 'AIの光線が来る！',
      gym: '清掃タイム！床がすべる',
      livebar: '照明が落ちる！',
      room: '重い愛のハートが降ってくる！（さわると重くなる）',
    };
    if (e.h === 'livebar') this.blackoutAt = this.time + 1.5;
    // 画面の上の端で切れないよう、今のカメラで「画面の上から約1/4」の高さに出す（ステージより低くはしない）
    this.props.showText(labels[e.h] ?? '注意！', '#ffd23f', (m.x1 + m.x2) / 2, Math.max(m.top + 2, this.screenY(0.5, (m.x1 + m.x2) / 2)), true, 110, true);
    if (e.h === 'lab') {
      // 光線が落ちる場所に赤い印
      for (let i = 0; i < 3; i++) this.spawn(this.ringGeo, 0xff3b3b, e.x, m.top + 0.1, 0, 0, 0.9, 40 + i * 25, -0.004);
    } else if (e.h === 'arcade') {
      // 来る側の端に「！」
      const x = e.d > 0 ? m.x1 - 0.5 : m.x2 + 0.5;
      this.props.showText('！', '#ff5a5a', x, e.y + 0.6, true, 110);
    }
  }

  /** SSR衣装の人が攻撃を当てたとき：衣装の粒（星・ハート・コインなど）がはじける */
  /** 衣装の文字を最後に出した時刻（slot ごと） */
  private hitTextAt = new Map<number, number>();

  private costumeHit(e: Extract<GameEvent, { k: 'hit' }>): void {
    if (e.a === undefined || e.a === e.s) return;
    const p = this.setup?.players.find((x) => x.slot === e.a);
    if (!p) return;
    const cos = getCostume(p.costume, p.charId);
    const fx = cos.fx;
    if (!fx) return;
    const tex = fxTexture(fx.particle);
    const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
    const ur = cos.rarity >= 6;
    if (ur) {
      // UR：虹色の衝撃波（色の違う輪が少しずつずれて広がる）
      const power = Math.min(1, e.p / 15);
      rainbow.forEach((col, i) => this.spawn(this.ringGeo, col, e.x, e.y, 0, 0, 0.25 + i * 0.05, 18 + i * 3, 0.07 + power * 0.08 + i * 0.012, true));
    }
    // 強い攻撃が当たると、衣装ごとの文字が光る（ゲーセン荒らしの「777」など）。出すぎないよう、1人5秒に1回まで
    const now = performance.now();
    if (fx.hitText && e.p >= 10 && now - (this.hitTextAt.get(e.a) ?? -1e9) >= HIT_TEXT_GAP_MS) {
      this.hitTextAt.set(e.a, now);
      this.props.showText(fx.hitText, '#' + fx.hit.toString(16).padStart(6, '0'), e.x, e.y + 0.9, true, 60);
    }
    const n = (ur ? 12 : 7) + Math.min(6, Math.round(e.p / 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 3 + Math.random() * 4;
      // 3つに1つは白くして、どんな背景でも見えるようにする
      const color = i % 3 === 0 ? 0xffffff : fx.hit < 0 || ur ? rainbow[i % rainbow.length] : fx.hit;
      const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(e.x, e.y, 0.6);
      sprite.scale.setScalar(0.7);
      this.scene.add(sprite);
      this.particles.push({ mesh: sprite as unknown as THREE.Mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1, life: 36, max: 36, grow: -0.006 });
    }
  }

  /** UR 衣装の人の撃墜：虹色の輪が何重にも広がり、星が飛び散り、虹色の光の柱が立つ */
  private urKo(x: number, y: number): void {
    const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
    rainbow.forEach((col, i) => {
      this.spawn(this.ringGeo, col, x, y, 0, 0, 0.6 + i * 0.25, 34 + i * 4, 0.35 + i * 0.04, true);
      this.koBeam(x, y, col);
    });
    const tex = fxTexture('star');
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 8 + Math.random() * 18;
      const mat = new THREE.SpriteMaterial({ map: tex, color: rainbow[i % rainbow.length], transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, 0.8);
      sprite.scale.setScalar(1.1);
      this.scene.add(sprite);
      this.particles.push({ mesh: sprite as unknown as THREE.Mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 50, max: 50, grow: -0.01 });
    }
    this.shake = 1.6;
  }

  // ---------------------------------------------------------------- 玉入れ：ボールとかご
  private ballObj: { root: THREE.Group; ball: THREE.Group; shadow: THREE.Mesh; spin: number; guide: THREE.Points; faded: boolean } | null = null;

  private buildBall(stage: StageDef): void {
    const root = new THREE.Group();
    this.scene.add(root);
    const toon = (c: number) => new THREE.MeshToonMaterial({ color: c });
    // ボール：白地に赤と青の帯（玉入れの玉らしく）
    const ball = new THREE.Group();
    const r = BALL.r;
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), toon(0xf6f4ee)));
    for (const [c, rot] of [
      [TEAM_COLORS[0], 0],
      [TEAM_COLORS[1], Math.PI / 2],
    ] as const) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.995, r * 0.16, 8, 32), toon(c));
      band.rotation.y = rot;
      ball.add(band);
    }
    const ol = new THREE.Mesh(new THREE.SphereGeometry(r * 1.06, 20, 14), new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide }));
    ball.add(ol);
    root.add(ball);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.9, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    root.add(shadow);
    // かご：ポールの上に、チームの色のふちの網かご（赤＝左、青＝右）
    ballBaskets(stage).forEach((g, k) => {
      const col = TEAM_COLORS[k];
      const w = (g.x2 - g.x1) / 2;
      const h = g.y2 - g.y1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, g.y1 - stage.main.top, 10), toon(0xd8dde6));
      pole.position.set(g.cx, (g.y1 + stage.main.top) / 2, -0.6);
      root.add(pole);
      const net = new THREE.Mesh(
        new THREE.CylinderGeometry(w, w * 0.75, h, 20, 4, true),
        new THREE.MeshBasicMaterial({ color: col, wireframe: true, transparent: true, opacity: 0.75 }),
      );
      net.position.set(g.cx, g.y1 + h / 2, -0.1);
      root.add(net);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.98, w * 0.73, h * 0.98, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
      back.position.copy(net.position);
      root.add(back);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(w, 0.08, 8, 28), toon(col));
      rim.rotation.x = Math.PI / 2;
      rim.position.set(g.cx, g.y2, -0.1);
      root.add(rim);
      // 底
      const bottom = new THREE.Mesh(new THREE.CircleGeometry(w * 0.75, 20), toon(col));
      bottom.rotation.x = -Math.PI / 2;
      bottom.position.set(g.cx, g.y1 + 0.01, -0.1);
      root.add(bottom);
    });
    // 2ポイントライン：かごの中心から THROW.twoPoint の所の床に、そのかごの色の線と「2点」の札（矢印はかごの向き。ここより遠くから入れると2点）
    ballBaskets(stage).forEach((g, k) => {
      const toward = k === 0 ? -1 : 1;
      const lx = g.cx - toward * THROW.twoPoint;
      if (lx < stage.main.x1 + 0.2 || lx > stage.main.x2 - 0.2) return;
      const col = TEAM_COLORS[k];
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 2.8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(lx, stage.main.top + 0.02, 0);
      root.add(line);
      const hex = '#' + col.toString(16).padStart(6, '0');
      const tex = canvasTex(128, (c) => {
        c.fillStyle = hex;
        c.strokeStyle = '#ffffff';
        c.lineWidth = 6;
        c.beginPath();
        c.roundRect(10, 28, 108, 72, 18);
        c.fill();
        c.stroke();
        c.fillStyle = '#ffffff';
        c.font = '900 38px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        // 矢印はかごのある向き
        c.fillText(toward < 0 ? '◀2点' : '2点▶', 64, 66);
      });
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      tag.scale.set(1.0, 1.0, 1);
      tag.position.set(lx, stage.main.top + 0.45, -1.3);
      root.add(tag);
    });
    // 投げる道筋（「投げる」を押して狙っている間だけ、自分の画面に薄い点線で出す）
    const guideGeo = new THREE.BufferGeometry();
    guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GUIDE_MAX * 3), 3));
    // 丸い点を並べる（線は細くて見えにくいため）
    const dotTex = canvasTex(32, (g) => {
      // 明るい空の上でも見えるよう、黒いふちの付いた白い点
      g.fillStyle = 'rgba(20, 22, 40, 0.85)';
      g.beginPath();
      g.arc(16, 16, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(16, 16, 9.5, 0, Math.PI * 2);
      g.fill();
    });
    const guide = new THREE.Points(guideGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, map: dotTex, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false, fog: false }));
    guide.visible = false;
    guide.frustumCulled = false;
    guide.renderOrder = 5;
    root.add(guide);
    this.ballObj = { root, ball, shadow, spin: 0, guide, faded: false };
  }

  /** 投げる道筋を出す（null で消す） */
  setThrowGuide(points: { x: number; y: number }[] | null): void {
    const g = this.ballObj?.guide;
    if (!g) return;
    if (!points || points.length < 2) {
      g.visible = false;
      return;
    }
    const pos = g.geometry.getAttribute('position') as THREE.BufferAttribute;
    // 4フレームごとに1つの点（点と点のあいだを空けて、点線に見せる）
    let n = 0;
    for (let i = 0; i < points.length && n < GUIDE_MAX; i += 4) pos.setXYZ(n++, points[i].x, points[i].y, 0.3);
    pos.needsUpdate = true;
    g.geometry.setDrawRange(0, n);
    g.visible = true;
  }

  private updateBall(view: ViewState, dt: number): void {
    const o = this.ballObj;
    const b = view.ball;
    if (!o || !b) return;
    o.ball.visible = b.on;
    // 自分のチームが今ボールを取れない間（点を取った直後・投げて場外に出した直後）は、ボールを半透明にする
    const myTeam = this.localSlot !== null && this.setup ? ballTeamOf(this.setup, this.localSlot) : -1;
    const faded = b.on && (b.lock ?? -1) >= 0 && myTeam === b.lock;
    if (faded !== o.faded) {
      o.faded = faded;
      o.ball.traverse((m) => {
        const mat = (m as THREE.Mesh).material as THREE.Material | undefined;
        if (!mat) return;
        mat.transparent = faded;
        mat.opacity = faded ? 0.35 : 1;
        mat.depthWrite = !faded;
        mat.needsUpdate = true;
      });
    }
    o.shadow.visible = b.on && !!this.stage && b.x >= this.stage.main.x1 && b.x <= this.stage.main.x2 && b.y >= this.stage.main.top;
    o.ball.position.set(b.x, b.y, 0);
    // 転がり・飛んでいく向きに回す
    o.spin -= (b.vx / BALL.r) * dt;
    o.ball.rotation.z = o.spin;
    if (this.stage) {
      o.shadow.position.set(b.x, this.stage.main.top + 0.02, 0);
      const hgt = Math.max(0, b.y - this.stage.main.top);
      o.shadow.scale.setScalar(Math.max(0.3, 1 - hgt * 0.12));
    }
  }

  // ---------------------------------------------------------------- 王冠うばいの王冠
  private crownObj: { root: THREE.Group; crown: THREE.Group; ring: THREE.Mesh; bar: THREE.Group; fill: THREE.Mesh } | null = null;

  private buildCrown(): void {
    const root = new THREE.Group();
    this.scene.add(root);
    const gold = new THREE.MeshToonMaterial({ color: 0xffd23f, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const crown = new THREE.Group();
    // 輪っか（帯）と、5本のとがり。とがりの先に赤い玉
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.2, 20, 1, true), gold);
    (band.material as THREE.Material).side = THREE.DoubleSide;
    crown.add(band);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 6), gold);
      spike.position.set(Math.cos(a) * 0.31, 0.22, Math.sin(a) * 0.31);
      crown.add(spike);
      const gem = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: k % 2 ? 0x4f9dff : 0xff4a5a }));
      gem.position.set(Math.cos(a) * 0.31, 0.37, Math.sin(a) * 0.31);
      crown.add(gem);
    }
    const ol = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.33, 0.24, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide }));
    crown.add(ol);
    root.add(crown);
    // 落ちているときの、足元の光る輪（拾える場所の目印）
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 28), new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    root.add(ring);
    // 王冠の耐久のバー（持っている人の頭の上。減るほど赤くなる）
    const bar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.13), new THREE.MeshBasicMaterial({ color: 0x1b1b28, transparent: true, opacity: 0.85, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.08), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
    fill.position.z = 0.001;
    bg.renderOrder = 9;
    fill.renderOrder = 10;
    bar.add(bg, fill);
    root.add(bar);
    this.crownObj = { root, crown, ring, bar, fill };
  }

  private updateCrown(view: ViewState): void {
    const o = this.crownObj;
    const c = view.crown;
    if (!o || !c) return;
    o.crown.visible = c.on;
    const held = c.holder >= 0;
    o.ring.visible = c.on && !held;
    const t = this.time;
    // 耐久のバー：持っているときだけ。残りの割合で縮み、少なくなると赤くなる
    const ratio = c.armorMax ? Math.max(0, Math.min(1, (c.armor ?? 0) / c.armorMax)) : 1;
    o.bar.visible = c.on && held && !!c.armorMax;
    o.bar.position.set(c.x, c.y + 0.62, 0.35);
    o.fill.scale.x = Math.max(0.001, ratio);
    o.fill.position.x = -0.42 * (1 - ratio);
    (o.fill.material as THREE.MeshBasicMaterial).color.setHex(ratio > 0.5 ? 0xffd23f : ratio > 0.25 ? 0xff9a3a : 0xff4a4a);
    if (held) {
      // 持っている人の頭の上で、少しゆれる
      o.crown.position.set(c.x, c.y + 0.1 + Math.sin(t * 6) * 0.04, 0.2);
      o.crown.rotation.set(0, t * 2, 0.15);
      o.crown.scale.setScalar(1);
    } else {
      // 落ちているときは大きめで、くるくる回って光る
      o.crown.position.set(c.x, c.y + 0.45 + Math.sin(t * 3) * 0.08, 0.3);
      o.crown.rotation.set(0, t * 1.5, 0);
      o.crown.scale.setScalar(1.3);
      o.ring.position.set(c.x, c.y + 0.03, 0.3);
      (o.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(t * 5);
    }
  }

  // ---------------------------------------------------------------- 賞金首の目印（頭の上の賞金袋と、赤い輪）
  private bountyObj: { root: THREE.Group; bag: THREE.Group; ring: THREE.Mesh } | null = null;

  private buildBounty(): void {
    const root = new THREE.Group();
    this.scene.add(root);
    const bag = new THREE.Group();
    // ふくらんだ袋・しばった口・ひも・袋に描いた金色の丸
    const cloth = new THREE.MeshToonMaterial({ color: 0xc98a3a, emissive: 0x3a2000, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), cloth);
    body.scale.set(1, 0.9, 0.85);
    bag.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.14, 12), cloth);
    neck.position.y = 0.3;
    bag.add(neck);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 12), cloth);
    top.position.y = 0.42;
    top.rotation.x = Math.PI;
    bag.add(top);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 16), new THREE.MeshBasicMaterial({ color: 0xff4a5a }));
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.32;
    bag.add(tie);
    const mark = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), new THREE.MeshToonMaterial({ color: 0xffd23f, emissive: 0x7a5a00 }));
    mark.position.set(0, 0, 0.26);
    bag.add(mark);
    const ol = new THREE.Mesh(new THREE.SphereGeometry(0.33, 16, 12), new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide }));
    ol.scale.set(1, 0.9, 0.85);
    bag.add(ol);
    root.add(bag);
    // 賞金首の体のうしろで光る赤い輪
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 40), new THREE.MeshBasicMaterial({ color: 0xff4a5a, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    root.add(ring);
    root.visible = false;
    this.bountyObj = { root, bag, ring };
  }

  private updateBounty(view: ViewState): void {
    const o = this.bountyObj;
    if (!o) return;
    const h = view.bounty && view.bounty.holder >= 0 ? view.fighters.find((f) => f.slot === view.bounty!.holder) : undefined;
    const show = !!h && h.state !== 'dead' && !view.ended;
    o.root.visible = show;
    if (!h || !show) return;
    const t = this.time;
    // 体の高さ（大きさのアイテムで変わる）
    const id = this.models.get(h.slot)?.charId ?? 'guard';
    const height = 1.8 * getCharacter(id).scale * (h.fx & FX_BIG ? SIZE_REQ.big : h.fx & FX_SMALL ? SIZE_REQ.small : 1);
    o.bag.position.set(h.x, h.y + height + 0.75 + Math.sin(t * 4) * 0.06, 0.2);
    o.bag.rotation.set(0, Math.sin(t * 2) * 0.5, Math.sin(t * 3) * 0.08);
    o.ring.position.set(h.x, h.y + height * 0.5, -0.4);
    o.ring.scale.setScalar(Math.max(1, height / 1.9));
    (o.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.25 * Math.sin(t * 6);
  }

  // ---------------------------------------------------------------- コイン集めのコイン
  private coinObj: { root: THREE.Group; pool: THREE.Group[]; geo: THREE.BufferGeometry; mat: THREE.Material; ol: THREE.Material } | null = null;

  private buildCoins(): void {
    const root = new THREE.Group();
    this.scene.add(root);
    const geo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20);
    const mat = new THREE.MeshToonMaterial({ color: 0xffd23f, emissive: 0x7a5a00, emissiveIntensity: 0.7 });
    const ol = new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide });
    this.coinObj = { root, pool: [], geo, mat, ol };
  }

  private updateCoins(view: ViewState): void {
    const o = this.coinObj;
    if (!o) return;
    const list = view.coins?.list ?? [];
    while (o.pool.length < list.length) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(o.geo, o.mat);
      m.rotation.x = Math.PI / 2;
      g.add(m);
      const line = new THREE.Mesh(o.geo, o.ol);
      line.rotation.x = Math.PI / 2;
      line.scale.set(1.15, 1.6, 1.15);
      g.add(line);
      o.root.add(g);
      o.pool.push(g);
    }
    const t = this.time;
    o.pool.forEach((g, i) => {
      const c = list[i];
      g.visible = !!c;
      if (!c) return;
      const big = c.v > 1;
      g.position.set(c.x, c.y + (big ? 0.42 : 0.3) + Math.sin(t * 3 + i) * 0.04, 0.25);
      g.rotation.y = t * 3 + i;
      g.scale.setScalar(big ? 1.7 : 1);
    });
  }

  // ---------------------------------------------------------------- 金塊どろぼうの金庫と金塊
  private vaultObj: {
    root: THREE.Group;
    boxes: THREE.Group[];
    bars: THREE.Mesh[];
    barMats: THREE.MeshBasicMaterial[];
    dials: THREE.Mesh[];
    doors: THREE.Group[];
    door: number[];
    golds: THREE.Group[];
    /** 削れ具合の見た目：扉の色・ひび（2段階）・てっぺんの警告ランプ */
    doorMats: THREE.MeshToonMaterial[];
    cracks: THREE.Group[][];
    lamps: THREE.MeshBasicMaterial[];
    goldGeo: THREE.BoxGeometry;
    goldMat: THREE.MeshToonMaterial;
    goldEdge: THREE.MeshBasicMaterial;
  } | null = null;

  /** 金塊（金色の延べ棒と黒いふち） */
  private makeGold(): THREE.Group {
    const o = this.vaultObj!;
    const g = new THREE.Group();
    const body = new THREE.Mesh(o.goldGeo, o.goldMat);
    g.add(body);
    const edge = new THREE.Mesh(o.goldGeo, o.goldEdge);
    edge.scale.setScalar(1.12);
    g.add(edge);
    o.root.add(g);
    return g;
  }

  private buildVaults(stage: StageDef): void {
    const root = new THREE.Group();
    this.scene.add(root);
    const m = stage.main;
    const boxes: THREE.Group[] = [];
    const bars: THREE.Mesh[] = [];
    const barMats: THREE.MeshBasicMaterial[] = [];
    const dials: THREE.Mesh[] = [];
    const doors: THREE.Group[] = [];
    const doorMats: THREE.MeshToonMaterial[] = [];
    const cracks: THREE.Group[][] = [];
    const lamps: THREE.MeshBasicMaterial[] = [];
    const crackMat = new THREE.MeshBasicMaterial({ color: 0x15161f });
    const goldGeo = new THREE.BoxGeometry(0.5, 0.2, 0.26);
    const goldMat = new THREE.MeshToonMaterial({ color: 0xffc928, emissive: 0x5a3c00 });
    const goldEdge = new THREE.MeshBasicMaterial({ color: 0x3a2600, side: THREE.BackSide });
    [m.x1 + VAULT.inset, m.x2 - VAULT.inset].forEach((x, t) => {
      const col = TEAM_COLORS[t];
      const g = new THREE.Group();
      g.position.set(x, m.top, -0.3);
      // 鉄の箱（チームの色の帯）、正面の扉（ダイヤル・取っ手付き。開くと横に回る）、中に積まれた金塊
      const body = new THREE.Mesh(new THREE.BoxGeometry(VAULT.w, VAULT.h, 1.1), new THREE.MeshToonMaterial({ color: 0x5a6070 }));
      body.position.y = VAULT.h / 2;
      g.add(body);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(VAULT.w * 1.04, VAULT.h * 1.03, 1.12), new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide }));
      edge.position.y = VAULT.h / 2;
      g.add(edge);
      for (const y of [0.18, VAULT.h - 0.18]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(VAULT.w + 0.02, 0.16, 1.14), new THREE.MeshToonMaterial({ color: col }));
        stripe.position.y = y;
        g.add(stripe);
      }
      // 扉の奥：暗い中に金塊の山（扉が開くと見える）
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(VAULT.w * 0.74, VAULT.h * 0.66), new THREE.MeshBasicMaterial({ color: 0x15161f }));
      hole.position.set(0, VAULT.h / 2, 0.555);
      g.add(hole);
      for (let k = 0; k < 6; k++) {
        const bar = new THREE.Mesh(goldGeo, goldMat);
        const row = k < 3 ? 0 : k < 5 ? 1 : 2;
        const col2 = row === 0 ? k - 1 : row === 1 ? k - 3.5 : 0;
        bar.position.set(col2 * 0.3, VAULT.h / 2 - 0.42 + row * 0.2, 0.42);
        bar.scale.setScalar(0.55);
        g.add(bar);
      }
      // 扉：ちょうつがい（外側の端）を軸に回る
      const hinge = new THREE.Group();
      const side = t === 0 ? -1 : 1;
      hinge.position.set((side * VAULT.w * 0.78) / 2, VAULT.h / 2, 0.57);
      const doorMat = new THREE.MeshToonMaterial({ color: 0x737a8c });
      doorMats.push(doorMat);
      const door = new THREE.Mesh(new THREE.BoxGeometry(VAULT.w * 0.78, VAULT.h * 0.7, 0.06), doorMat);
      door.position.set((-side * VAULT.w * 0.78) / 2, 0, 0);
      hinge.add(door);
      // ひび：折れ線を細い板で描く。1段目（半分くらい削れた）と2段目（もうすぐ開く）
      const crackSet = (pts: [number, number][][]) => {
        const cg = new THREE.Group();
        for (const line of pts) {
          for (let k = 0; k < line.length - 1; k++) {
            const [x1, y1] = line[k];
            const [x2, y2] = line[k + 1];
            const len = Math.hypot(x2 - x1, y2 - y1);
            const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.035, 0.01), crackMat);
            seg.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
            seg.rotation.z = Math.atan2(y2 - y1, x2 - x1);
            cg.add(seg);
          }
        }
        cg.position.set((-side * VAULT.w * 0.78) / 2, 0, 0.035);
        cg.visible = false;
        hinge.add(cg);
        return cg;
      };
      const c1 = crackSet([
        [[-0.42, 0.48], [-0.26, 0.36], [-0.3, 0.2], [-0.14, 0.12]],
        [[0.44, -0.5], [0.3, -0.36], [0.34, -0.22]],
      ]);
      const c2 = crackSet([
        [[0.1, 0.6], [0.2, 0.4], [0.08, 0.28], [0.26, 0.05], [0.16, -0.1]],
        [[-0.44, -0.2], [-0.28, -0.26], [-0.18, -0.12], [0.0, -0.18], [0.12, -0.4], [0.06, -0.6]],
        [[0.44, 0.2], [0.3, 0.28], [0.24, 0.42]],
      ]);
      cracks.push([c1, c2]);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 20), new THREE.MeshToonMaterial({ color: 0xd9b44a }));
      dial.rotation.x = Math.PI / 2;
      dial.position.set((-side * VAULT.w * 0.78) / 2, 0.1, 0.05);
      hinge.add(dial);
      dials.push(dial);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), new THREE.MeshToonMaterial({ color: 0xd9b44a }));
      knob.position.set(-side * VAULT.w * 0.78 + side * 0.12, -0.3, 0.05);
      hinge.add(knob);
      g.add(hinge);
      doors.push(hinge);
      // 上にバー：閉まっている間は扉の残り（チームの色）、開いている間は閉まるまでの残り時間（金色）
      // 背景は不透明にする（半透明だと、あとから描かれて色のバーを隠してしまう）
      const back = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.16), new THREE.MeshBasicMaterial({ color: 0x1b1b28 }));
      back.position.set(0, VAULT.h + 0.4, 0.6);
      g.add(back);
      // てっぺんの警告ランプ（ふだんは消えていて、もうすぐ開くと赤く点滅）
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x3a3f4f });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), lampMat);
      lamp.position.set(0, VAULT.h + 0.1, 0.2);
      g.add(lamp);
      lamps.push(lampMat);
      const mat = new THREE.MeshBasicMaterial({ color: col });
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.11), mat);
      bar.position.set(0, VAULT.h + 0.4, 0.63);
      g.add(bar);
      bars.push(bar);
      barMats.push(mat);
      root.add(g);
      boxes.push(g);
    });
    this.vaultObj = { root, boxes, bars, barMats, dials, doors, door: [1, 1], golds: [], doorMats, cracks, lamps, goldGeo, goldMat, goldEdge };
  }

  private updateVaults(view: ViewState): void {
    const o = this.vaultObj;
    const v = view.vault;
    if (!o || !v) return;
    v.door.forEach((r, t) => {
      const open = v.open[t];
      // バー：閉まっている間は扉の残り、開いている間は閉まるまでの残り時間（金色で点滅）
      const k = open > 0 ? open / VAULT.openT : Math.max(0, r);
      o.bars[t].scale.x = Math.max(0.001, k);
      o.bars[t].position.x = -0.72 * (1 - k);
      o.barMats[t].color.setHex(open > 0 ? (open < 60 && Math.floor(this.time * 8) % 2 ? 0xffffff : 0xffd23f) : TEAM_COLORS[t]);
      // 当たったら少しゆれる
      const hit = r < o.door[t] - 0.001;
      o.door[t] = r;
      const g = o.boxes[t];
      if (hit) g.userData.shake = 0.25;
      const sh = (g.userData.shake as number | undefined) ?? 0;
      g.userData.shake = Math.max(0, sh - 0.016);
      const base = this.stage ? (t === 0 ? this.stage.main.x1 + VAULT.inset : this.stage.main.x2 - VAULT.inset) : g.position.x;
      g.position.x = base + (sh > 0 ? Math.sin(this.time * 60) * 0.06 * (sh / 0.25) : 0);
      // 削れ具合の見た目（開いている間は閉まったときに元に戻る）：
      // 2/3 より削れるとひびが入って扉がくすみ、1/3 より削れるとひびが増えて扉がゆがみ、ランプが赤く点滅して煙が出る
      const dmg = open > 0 ? 0 : 1 - Math.max(0, r);
      const stage = dmg >= 2 / 3 ? 2 : dmg >= 1 / 3 ? 1 : 0;
      o.cracks[t][0].visible = stage >= 1;
      o.cracks[t][1].visible = stage >= 2;
      o.doorMats[t].color.setHex(0x737a8c).lerp(new THREE.Color(0x3e424f), dmg * 0.9);
      const blink = stage >= 2 && Math.floor(this.time * (4 + dmg * 6)) % 2 === 0;
      o.lamps[t].color.setHex(blink ? 0xff3b3b : stage >= 1 ? 0x8a2a2a : 0x3a3f4f);
      if (stage >= 2 && Math.random() < 0.08) {
        this.spawn(this.sparkGeo, Math.random() < 0.7 ? 0x8a8f9c : 0xffd84a, g.position.x + (Math.random() - 0.5) * VAULT.w * 0.6, g.position.y + VAULT.h * (0.3 + Math.random() * 0.5), (Math.random() - 0.5) * 0.6, 1 + Math.random(), 0.16, 30, -0.002);
      }
      // 扉：開いている間は外へ大きく開く（なめらかに）。大きく削れると少し傾いてガタガタ
      const side = t === 0 ? -1 : 1;
      const want = open > 0 ? side * 1.9 : stage >= 2 ? side * 0.12 : stage >= 1 ? side * 0.04 : 0;
      const d = o.doors[t];
      d.rotation.y += (want - d.rotation.y) * 0.2;
      d.rotation.z = open > 0 ? 0 : stage >= 2 ? side * -0.06 : 0;
      // ダイヤル：扉が削れるほど速く回る
      o.dials[t].rotation.y = this.time * (1 - r) * 4;
    });
    // 金塊：持っている人の頭の上・床に落ちているもの
    while (o.golds.length < v.golds.length) o.golds.push(this.makeGold());
    o.golds.forEach((m, i) => {
      const gd = v.golds[i];
      m.visible = !!gd;
      if (!gd) return;
      const loose = gd.holder < 0;
      m.position.set(gd.x, gd.y + (loose ? 0.12 + Math.sin(this.time * 4 + i) * 0.05 : 0), 0);
      m.rotation.set(0, loose ? this.time * 1.5 : 0, loose ? 0 : 0.15 * Math.sin(this.time * 6 + i));
      // 持っている金塊は大きめに（だれが持っているか遠くからでも分かるように）
      m.scale.setScalar(loose ? 1.1 : 1.5);
    });
  }

  // ---------------------------------------------------------------- エリアバトルのエリア
  // 床の光る帯・下から上へうすくなる光の柱・左右のふち。色はエリアを取っている人（チーム）の色。
  // 取り合い中は白と灰色で点滅（チームの色と見まちがえない）、だれもいなければ淡い金色。次のエリア（予告）は金色で点滅
  private areaMeshes: { g: THREE.Group; floor: THREE.Mesh; col: THREE.Mesh; edges: THREE.Mesh[]; key: string }[] = [];
  private areaGrad: THREE.CanvasTexture | null = null;

  private areaGradient(): THREE.CanvasTexture {
    if (this.areaGrad) return this.areaGrad;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    this.areaGrad = new THREE.CanvasTexture(c);
    return this.areaGrad;
  }

  private makeAreaMesh(): (typeof this.areaMeshes)[number] {
    const g = new THREE.Group();
    const mat = (o: number, map?: THREE.Texture) => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide, map: map ?? null });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1, 0.08, 2.6), mat(0.6));
    const col = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat(0.28, this.areaGradient()));
    col.position.z = -1.2;
    const edges = [0, 1].map(() => {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 1), mat(0.55, this.areaGradient()));
      e.position.z = 0.9;
      return e;
    });
    g.add(floor, col, ...edges);
    this.scene.add(g);
    return { g, floor, col, edges, key: '' };
  }

  private updateAreaZones(view: ViewState): void {
    const a = view.area;
    const list = a ? [...a.zones.map((z) => ({ ...z, next: false })), ...a.next.map((z) => ({ ...z, holder: -1, next: true }))] : [];
    while (this.areaMeshes.length < list.length) this.areaMeshes.push(this.makeAreaMesh());
    this.areaMeshes.forEach((m, i) => {
      const z = list[i];
      m.g.visible = !!z;
      if (!z) return;
      const w = z.x2 - z.x1;
      const h = z.y2 - z.y1;
      m.g.position.set((z.x1 + z.x2) / 2, z.y1, 0);
      m.floor.scale.set(w, 1, 1);
      m.floor.position.y = 0.04;
      m.col.scale.set(w, h, 1);
      m.col.position.y = h / 2;
      m.edges.forEach((e, k) => {
        e.scale.set(1, h, 1);
        e.position.set((k ? 1 : -1) * (w / 2), h / 2, 0.9);
      });
      const blink = Math.floor(this.time * 6) % 2 === 0;
      // 白い床でも見えるように、だれもいないエリアは淡い金色、予告は金色にする
      let color = z.next ? 0xffd23f : 0xfff0a0;
      // 取り合い中：どのチーム・プレイヤーの色とも違う、白と灰色の点滅（赤チームと見まちがえないように）
      if (z.holder === -2) color = blink ? 0xffffff : 0x5a5f78;
      else if (z.holder >= 0) color = areaColor(this.setup, z.holder);
      const mats = [m.floor, m.col, ...m.edges].map((x) => x.material as THREE.MeshBasicMaterial);
      mats.forEach((mt) => mt.color.setHex(color));
      // 予告：全体を白く点滅させる（ゆっくり、はっきり）
      const slow = Math.floor(this.time * 3) % 2 === 0;
      const op = z.next ? (slow ? 1 : 0.3) : 1;
      (m.floor.material as THREE.MeshBasicMaterial).opacity = (z.holder === -1 ? 0.8 : 0.75) * op;
      (m.col.material as THREE.MeshBasicMaterial).opacity = (z.next ? 0.18 : z.holder === -1 ? 0.24 : 0.34) * op;
      for (const e of m.edges) (e.material as THREE.MeshBasicMaterial).opacity = 0.85 * op;
    });
  }

  // ---------------------------------------------------------------- UR の登場演出
  // 試合の最初（カウントダウン中）に、UR 衣装の人のところへ空から虹色の光の柱が落ち、
  // 着地の衝撃（虹色の輪・星）とともにキャラがはずんで現れ、衣装の名前が出る。
  // 途中から見始めた（観戦・再接続）ときは出さない
  private entranceChecked = false;
  private entrances: { slot: number; delay: number; hit: boolean; beam: THREE.Group; name: string }[] = [];
  private static readonly ENTRANCE_DROP = 0.4;

  private clearEntrances(): void {
    for (const en of this.entrances) this.disposeBeam(en.beam);
    this.entrances = [];
    for (const { model } of this.models.values()) model.appear = 1;
  }

  private disposeBeam(g: THREE.Group): void {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  private updateEntrances(view: ViewState): void {
    if (!this.entranceChecked && this.setup) {
      this.entranceChecked = true;
      if (view.frame < 40) {
        let k = 0;
        const urCount = this.setup.players.filter((p) => getCostume(p.costume, p.charId).rarity >= 6).length;
        // カウントダウン（2.5秒）の間に全員が出終わるように、間かくを人数で決める
        const gap = urCount > 1 ? Math.min(0.55, 1.5 / (urCount - 1)) : 0;
        for (const p of this.setup.players) {
          const cos = getCostume(p.costume, p.charId);
          if (cos.rarity < 6) continue;
          const beam = new THREE.Group();
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
          rainbow.forEach((col, i) => {
            const geo = new THREE.PlaneGeometry(0.16, 1);
            geo.translate(0, 0.5, 0);
            const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
            const m = new THREE.Mesh(geo, mat);
            m.position.x = (i - 2) * 0.15;
            beam.add(m);
          });
          // 中心の白い芯
          const core = new THREE.PlaneGeometry(0.16, 1);
          core.translate(0, 0.5, 0);
          const cm = new THREE.Mesh(core, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
          cm.position.z = 0.01;
          beam.add(cm);
          beam.visible = false;
          beam.position.z = 0.4;
          this.scene.add(beam);
          // 2人目からは少しずつ遅らせる（カウントダウン中に全員出終わるように）
          this.entrances.push({ slot: p.slot, delay: 0.3 + k * gap, hit: false, beam, name: cos.name });
          k++;
        }
      }
    }
    if (!this.entrances.length) return;
    const DROP = GameRenderer.ENTRANCE_DROP;
    const keep: typeof this.entrances = [];
    for (const en of this.entrances) {
      // 時間はゲームのコマ数で数える（端末の重さに関係なく、カウントダウンと合う）
      const now = view.frame / 60 - en.delay;
      const f = view.fighters.find((x) => x.slot === en.slot);
      const m = this.models.get(en.slot)?.model;
      if (!f || !m) {
        this.disposeBeam(en.beam);
        continue;
      }
      // 試合が始まったら（端末が重くて演出が遅れていても）必ず見える状態にして終える
      if (view.frame >= COUNTDOWN_FRAMES) {
        this.disposeBeam(en.beam);
        m.appear = 1;
        continue;
      }
      const t = now;
      // キャラの大きさ：着地まで見えない → はずんで 1 に
      if (t < DROP) m.appear = 0;
      else {
        const u = Math.min(1, (t - DROP) / 0.35);
        m.appear = u >= 1 ? 1 : Math.max(0.001, 1 + Math.sin(u * Math.PI) * 0.25 - (1 - u) * (1 - u));
      }
      // 光の柱：上から落ちて、着地のあと太くなりながら消える
      const H = 30;
      if (t >= 0) {
        en.beam.visible = true;
        en.beam.position.x = f.x;
        if (t < DROP) {
          en.beam.position.y = f.y + H * (1 - t / DROP);
          en.beam.scale.set(1, H, 1);
        } else {
          const u = (t - DROP) / 0.9;
          en.beam.position.y = f.y;
          en.beam.scale.set(1 + u * 0.5, H, 1);
          en.beam.children.forEach((c) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 * (1 - u)));
        }
      }
      if (!en.hit && t >= DROP) {
        en.hit = true;
        const y = f.y + 0.9;
        const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
        rainbow.forEach((col, i) => this.spawn(this.ringGeo, col, f.x, y, 0, 0, 0.4 + i * 0.12, 24 + i * 3, 0.12 + i * 0.015, true));
        const tex = fxTexture('star');
        for (let i = 0; i < 22; i++) {
          const a = (i / 22) * Math.PI * 2;
          const sp = 6 + (i % 3) * 3;
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: rainbow[i % 5], transparent: true, depthWrite: false }));
          sprite.position.set(f.x, y, 0.8);
          sprite.scale.setScalar(0.8);
          this.scene.add(sprite);
          this.particles.push({ mesh: sprite as unknown as THREE.Mesh, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2, life: 40, max: 40, grow: -0.008 });
        }
        this.props.showText(`UR ${en.name}`, '#ffd23f', f.x, f.y + 2.3, false, 75);
        this.shake = Math.max(this.shake, 0.7);
      }
      if (t > DROP + 0.9) {
        this.disposeBeam(en.beam);
        m.appear = 1;
        continue;
      }
      keep.push(en);
    }
    this.entrances = keep;
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
  /** 登場映像：カメラの位置（x, y, z）と見る点（lx, ly）を決め打ちにする */
  cinema: { x: number; y: number; z: number; lx: number; ly: number } | null = null;

  /** 画面の中に文字を出す（登場映像の説明） */
  say(text: string, color: string, x: number, y: number, big = false, life = 70): void {
    this.props.showText(text, color, x, y, big, life);
  }

  /** 1人だけ衣装を着替える（登場映像の早着替え） */
  setCostume(slot: number, costume: string): void {
    const p = this.setup?.players.find((x) => x.slot === slot);
    const cur = this.models.get(slot);
    if (!p || !cur) return;
    p.costume = costume;
    this.scene.remove(cur.model.root);
    cur.model.dispose();
    const model = new FighterModel(getCharacter(p.charId), getCostume(costume, p.charId), playerColor(this.setup!, slot));
    this.scene.add(model.root);
    this.models.set(slot, { model, charId: p.charId });
  }

  private updateCamera(view: ViewState, dt: number): void {
    if (this.cinema) {
      const c = this.cinema;
      this.shake *= Math.pow(0.02, dt);
      const sx = (Math.random() - 0.5) * this.shake * 0.3;
      const sy = (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.set(c.x + sx, c.y + sy, c.z);
      this.camera.lookAt(c.lx + sx, c.ly + sy, 0);
      this.sun.target.position.set(c.lx, 0, 0);
      this.sun.position.set(c.lx - 8, 20, 14);
      return;
    }
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
    // 玉入れ：両方のかごとボールもいつも画面に入れる
    if (view.ball) {
      for (const g of ballBaskets(st)) {
        minX = Math.min(minX, g.x1 - 1);
        maxX = Math.max(maxX, g.x2 + 1);
        maxY = Math.max(maxY, g.y2 + 1.2);
      }
      if (view.ball.on) {
        minX = Math.min(minX, view.ball.x - 1.5);
        maxX = Math.max(maxX, view.ball.x + 1.5);
        maxY = Math.max(maxY, view.ball.y + 1.5);
        minY = Math.min(minY, view.ball.y - 2);
      }
    }
    const b = st.blast;
    minX = Math.max(minX, b.left + 2);
    maxX = Math.min(maxX, b.right - 2);
    minY = Math.max(minY, b.bottom + 2);
    maxY = Math.min(maxY, b.top - 1);
    const cx = (minX + maxX) / 2;
    // ステージによっては、角度を変えずにカメラを少し上へずらす
    const cy = (minY + maxY) / 2 + (CAM_RAISE[st.id] ?? 0);
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
