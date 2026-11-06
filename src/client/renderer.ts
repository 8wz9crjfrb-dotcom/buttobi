// three.js による描画：ステージ、キャラクター、カメラ、エフェクト

import * as THREE from 'three';
import { getCharacter, SLOT_COLORS } from '../shared/characters';
import { platformAt, type StageDef } from '../shared/stages';
import type { GameEvent, MatchSetup, ViewState } from '../shared/types';
import { FighterModel } from './fighterModel';

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
  private platformMeshes: THREE.Mesh[] = [];
  private models = new Map<number, { model: FighterModel; charId: string }>();
  private shots: THREE.Mesh[] = [];
  private shotGeo = new THREE.SphereGeometry(1, 12, 10);
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
  private decor: THREE.Object3D[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 200);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
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
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'high';
    this.sun.castShadow = q === 'high';
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const maxRatio = this.quality === 'high' ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setMatch(setup: MatchSetup, stage: StageDef): void {
    this.clear();
    this.stage = stage;
    this.buildStage(stage);
    for (const p of setup.players) {
      const def = getCharacter(p.charId);
      const model = new FighterModel(def, SLOT_COLORS[p.slot % SLOT_COLORS.length]);
      this.scene.add(model.root);
      this.models.set(p.slot, { model, charId: p.charId });
    }
    const m = stage.main;
    this.camLook.set((m.x1 + m.x2) / 2, 3, 0);
    this.camPos.set(this.camLook.x, 5, 26);
  }

  clear(): void {
    for (const { model } of this.models.values()) {
      this.scene.remove(model.root);
      model.dispose();
    }
    this.models.clear();
    for (const s of this.shots) this.scene.remove(s);
    this.shots = [];
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
    this.stageGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.stageGroup.clear();
    this.platformMeshes = [];
    for (const d of this.decor) this.scene.remove(d);
    this.decor = [];
  }

  private buildStage(stage: StageDef): void {
    const th = stage.theme;
    this.scene.background = makeSkyTexture(th.sky, th.skyBottom);
    this.scene.fog = new THREE.Fog(th.skyBottom, 40, 90);
    const m = stage.main;
    const w = m.x2 - m.x1;
    const depth = 5;
    // 本体の台：上面（草など）と側面
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, depth), new THREE.MeshStandardMaterial({ color: th.ground, roughness: 0.8 }));
    top.position.set((m.x1 + m.x2) / 2, m.top - 0.25, 0);
    top.receiveShadow = true;
    this.stageGroup.add(top);
    const bodyH = m.top - 0.5 - m.bottom;
    const side = new THREE.Mesh(
      new THREE.CylinderGeometry(w / 2, w / 2.8, bodyH, 6, 1, false),
      new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.9, flatShading: true }),
    );
    side.scale.z = depth / w;
    side.position.set((m.x1 + m.x2) / 2, m.top - 0.5 - bodyH / 2, 0);
    side.receiveShadow = true;
    this.stageGroup.add(side);
    // 台の下に伸びる岩
    const rock = new THREE.Mesh(new THREE.ConeGeometry(w / 2.8, 6, 6), new THREE.MeshStandardMaterial({ color: th.side, roughness: 1, flatShading: true }));
    rock.rotation.x = Math.PI;
    rock.scale.z = depth / w;
    rock.position.set((m.x1 + m.x2) / 2, m.bottom - 3, 0);
    this.stageGroup.add(rock);
    // 端の目印
    for (const x of [m.x1, m.x2]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.52, depth + 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      edge.position.set(x, m.top - 0.25, 0);
      this.stageGroup.add(edge);
    }
    // すり抜け足場
    for (const p of stage.platforms) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(p.x2 - p.x1, 0.22, 2.4),
        new THREE.MeshStandardMaterial({ color: th.plat, roughness: 0.5, transparent: true, opacity: 0.92 }),
      );
      mesh.position.set((p.x1 + p.x2) / 2, p.y - 0.11, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.stageGroup.add(mesh);
      this.platformMeshes.push(mesh);
    }
    // 背景の飾り（遠くの島と雲）
    const rnd = mulberry(stage.id.length * 97 + 13);
    for (let i = 0; i < 14; i++) {
      const isCloud = i % 2 === 0;
      const geo = isCloud ? new THREE.SphereGeometry(1, 10, 8) : new THREE.ConeGeometry(1, 2.2, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: isCloud ? 0xffffff : th.side,
        roughness: 1,
        flatShading: !isCloud,
        transparent: isCloud,
        opacity: isCloud ? 0.85 : 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const s = isCloud ? 1.5 + rnd() * 2.5 : 1.5 + rnd() * 3;
      mesh.scale.set(s * (isCloud ? 2.2 : 1), s * (isCloud ? 0.8 : 1), s);
      if (!isCloud) mesh.rotation.x = Math.PI;
      mesh.position.set(-45 + rnd() * 90, -6 + rnd() * 24, -25 - rnd() * 30);
      this.scene.add(mesh);
      this.decor.push(mesh);
    }
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
      // 飛び道具
      while (this.shots.length < view.projectiles.length) {
        const mesh = new THREE.Mesh(this.shotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
        this.scene.add(mesh);
        this.shots.push(mesh);
      }
      this.shots.forEach((mesh, i) => {
        const p = view.projectiles[i];
        mesh.visible = !!p;
        if (!p) return;
        mesh.position.set(p.x, p.y, 0);
        const r = 0.32 + Math.sin(this.time * 30) * 0.04;
        mesh.scale.setScalar(r);
        (mesh.material as THREE.MeshBasicMaterial).color.setHex(SLOT_COLORS[p.owner % SLOT_COLORS.length]).lerp(new THREE.Color(0xffffff), 0.4);
      });
      for (const e of newEvents) this.effect(e);
      this.updateCamera(view, dt);
    }
    this.updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private effect(e: GameEvent): void {
    if (e.k === 'hit') {
      const power = Math.min(1, e.p / 16);
      const color = power > 0.6 ? 0xff7a2a : 0xffe066;
      const n = 6 + Math.round(power * 10);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 4 + Math.random() * 8 * (0.5 + power);
        this.spawn(this.sparkGeo, color, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.18 + Math.random() * 0.12, 14 + Math.random() * 8, -0.01);
      }
      this.spawn(this.ringGeo, 0xffffff, e.x, e.y, 0, 0, 0.3, 10, 0.25 + power * 0.25);
      this.shake = Math.max(this.shake, 0.15 + power * 0.45);
    } else if (e.k === 'shield') {
      this.spawn(this.ringGeo, 0x9fd0ff, e.x, e.y, 0, 0, 0.3, 8, 0.15);
    } else if (e.k === 'ko') {
      const color = SLOT_COLORS[e.s % SLOT_COLORS.length];
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 16;
        this.spawn(this.sparkGeo, i % 3 ? color : 0xffffff, e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + Math.random() * 0.3, 30 + Math.random() * 20, -0.005);
      }
      this.spawn(this.ringGeo, color, e.x, e.y, 0, 0, 1, 26, 0.9);
      this.shake = 1.1;
    }
  }

  private spawn(geo: THREE.BufferGeometry, color: number, x: number, y: number, vx: number, vy: number, size: number, life: number, grow: number): void {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.position.set(x, y, 0.5);
    mesh.scale.setScalar(size);
    this.scene.add(mesh);
    this.particles.push({ mesh, vx, vy, life, max: life, grow });
  }

  private updateParticles(dt: number): void {
    const keep: Particle[] = [];
    const steps = dt * 60;
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

  private updateCamera(view: ViewState, dt: number): void {
    const st = this.stage!;
    const m = st.main;
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

function makeSkyTexture(top: number, bottom: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
