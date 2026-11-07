// ステージ作りの共通部品：質感の画像（プログラムで描く）、面取りした台、背景の層、舞う粒、動く飾り。
// 当たり判定は shared/stages.ts の数値で決まっていて、ここは見た目だけ。

import * as THREE from 'three';
import type { StageDef } from '../shared/stages';
import type { Quality } from './renderer';

export const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';
export const MONO = '"SFMono-Regular","Menlo","Consolas",monospace';
export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, c: HTMLCanvasElement) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 色を混ぜる（t=0 で a、1 で b） */
export function mix(a: number, b: number, t: number): number {
  const ca = new THREE.Color(a);
  return ca.lerp(new THREE.Color(b), t).getHex();
}

/** 背景の空：上から下へのグラデーションに、地平線近くのうっすら明るい帯を足す */
export function makeSkyTexture(top: number, bottom: number): THREE.CanvasTexture {
  return canvasTexture(4, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, hex(top));
    grad.addColorStop(0.62, hex(mix(top, bottom, 0.75)));
    grad.addColorStop(0.86, hex(bottom));
    grad.addColorStop(1, hex(mix(bottom, top, 0.25)));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 512);
  });
}

// ステージ用の陰影（キャラと同じアニメ調。キャラより1段なめらか）
let stageGradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!stageGradient) {
    const data = new Uint8Array([105, 105, 105, 255, 165, 165, 165, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
    stageGradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
    stageGradient.minFilter = THREE.NearestFilter;
    stageGradient.magFilter = THREE.NearestFilter;
    stageGradient.needsUpdate = true;
  }
  return stageGradient;
}

export interface BuiltStage {
  /** ステージ一式（背景も含む） */
  group: THREE.Group;
  /** すり抜け足場の見た目（動く足場の位置合わせに使う。上面が原点の +0.11） */
  platformMeshes: THREE.Object3D[];
  /** 毎フレームの動き */
  animate(time: number, dt: number): void;
  dispose(): void;
}

type Anim = (t: number, dt: number) => void;

/** ステージを組み立てる道具一式 */
export class Kit {
  readonly group = new THREE.Group();
  readonly platformMeshes: THREE.Object3D[] = [];
  private animators: Anim[] = [];
  private disposables: { dispose(): void }[] = [];
  readonly rnd: () => number;
  readonly high: boolean;
  readonly m: StageDef['main'];
  readonly cx: number;
  readonly w: number;
  private softTex: THREE.Texture | null = null;

  constructor(
    readonly stage: StageDef,
    quality: Quality,
  ) {
    this.high = quality === 'high';
    this.rnd = rand(stage.id.length * 7919 + stage.id.charCodeAt(0) * 31 + 17);
    this.m = stage.main;
    this.cx = (stage.main.x1 + stage.main.x2) / 2;
    this.w = stage.main.x2 - stage.main.x1;
  }

  track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  add<T extends THREE.Object3D>(o: T, parent: THREE.Object3D = this.group): T {
    parent.add(o);
    return o;
  }

  anim(f: Anim): void {
    this.animators.push(f);
  }

  // ---------------------------------------------------------------- 材質
  basic(color: number, extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
    return this.track(new THREE.MeshBasicMaterial({ color, ...extra }));
  }
  toon(color: number, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
    return this.track(new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra }));
  }
  std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return this.track(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
  }
  /** 光って見える色（夜のステージでは光のにじみがかかる） */
  glow(color: number, opacity = 1): THREE.MeshBasicMaterial {
    return this.basic(color, opacity < 1 ? { transparent: true, opacity, depthWrite: false } : {});
  }
  /** 加算合成（光の筋・レーザーなど） */
  additive(color: number, opacity: number): THREE.MeshBasicMaterial {
    return this.basic(color, { transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  }

  /** 画像を描く（world = true なら1単位あたり tile の大きさで繰り返す） */
  tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, tile?: [number, number]): THREE.CanvasTexture {
    const t = this.track(canvasTexture(w, h, draw));
    if (tile) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / tile[0], 1 / tile[1]);
    }
    return t;
  }

  /** ふんわりした丸（粒・光の玉に使う） */
  soft(): THREE.Texture {
    if (!this.softTex) {
      this.softTex = this.tex(64, 64, (g) => {
        const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        r.addColorStop(0, 'rgba(255,255,255,1)');
        r.addColorStop(0.4, 'rgba(255,255,255,0.55)');
        r.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, 64, 64);
      });
    }
    return this.softTex;
  }

  // ---------------------------------------------------------------- 形
  mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Mesh {
    const me = new THREE.Mesh(this.track(geo), mat);
    me.position.set(x, y, z);
    return this.add(me, parent);
  }
  box(sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    return this.mesh(new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z, parent);
  }
  plane(w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    return this.mesh(new THREE.PlaneGeometry(w, h), mat, x, y, z, parent);
  }

  /**
   * 角を丸く面取りした台。上面が y = 0。
   * mats[0] は正面と背面（カメラに見える面）、mats[1] は上面・下面・左右。
   */
  slab(w: number, h: number, d: number, mats: [THREE.Material, THREE.Material], opt: { radius?: number; bevel?: number } = {}): THREE.Mesh {
    const b = opt.bevel ?? 0.06;
    const r = Math.min(opt.radius ?? 0.12, h / 2 - 0.01);
    const x0 = -w / 2 + b;
    const x1 = w / 2 - b;
    const y0 = -h + b;
    const y1 = -b;
    const s = new THREE.Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r);
    s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1);
    s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r);
    s.quadraticCurveTo(x0, y0, x0 + r, y0);
    const depth = Math.max(0.01, d - b * 2);
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 4 });
    geo.translate(0, 0, -depth / 2);
    const me = new THREE.Mesh(this.track(geo), mats);
    me.castShadow = true;
    me.receiveShadow = true;
    return me;
  }

  /** すり抜け足場の入れ物を作って登録する（中身は上面 y = 0 で作る） */
  platform(build: (inner: THREE.Group, pw: number) => void): void {
    for (const p of this.stage.platforms) {
      const g = new THREE.Group();
      const inner = new THREE.Group();
      inner.position.y = 0.11;
      g.add(inner);
      build(inner, p.x2 - p.x1);
      g.position.set((p.x1 + p.x2) / 2, p.y - 0.11, 0);
      this.group.add(g);
      this.platformMeshes.push(g);
    }
  }

  /** 遠景の絵（シルエットなど）を板に描いて置く。霞がかかって奥ほど薄く見える */
  backdrop(w: number, h: number, x: number, y: number, z: number, draw: (g: CanvasRenderingContext2D, cw: number, ch: number) => void, res = 1024, extra: THREE.MeshBasicMaterialParameters = {}): THREE.Mesh {
    const ch = Math.max(64, Math.round((res * h) / w));
    const t = this.tex(res, ch, (g) => draw(g, res, ch));
    return this.plane(w, h, this.basic(0xffffff, { map: t, transparent: true, depthWrite: false, ...extra }), x, y, z);
  }

  /** 舞う粒（ほこり・花粉・データ・紙吹雪など）。範囲の外に出たら反対側から戻る */
  particles(opt: {
    count: number;
    x: [number, number];
    y: [number, number];
    z: [number, number];
    color: number | number[];
    size: number;
    vx?: number;
    vy?: number;
    wobble?: number;
    opacity?: number;
    map?: THREE.Texture;
    additive?: boolean;
  }): THREE.Points {
    const n = opt.count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const colors = Array.isArray(opt.color) ? opt.color : [opt.color];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = opt.x[0] + this.rnd() * (opt.x[1] - opt.x[0]);
      pos[i * 3 + 1] = opt.y[0] + this.rnd() * (opt.y[1] - opt.y[0]);
      pos[i * 3 + 2] = opt.z[0] + this.rnd() * (opt.z[1] - opt.z[0]);
      c.setHex(colors[Math.floor(this.rnd() * colors.length)]);
      col.set([c.r, c.g, c.b], i * 3);
      seed[i] = this.rnd() * 100;
    }
    const geo = this.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = this.track(
      new THREE.PointsMaterial({
        size: opt.size,
        map: opt.map ?? this.soft(),
        vertexColors: true,
        transparent: true,
        opacity: opt.opacity ?? 0.8,
        depthWrite: false,
        blending: opt.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    const pts = this.add(new THREE.Points(geo, mat));
    const vx = opt.vx ?? 0;
    const vy = opt.vy ?? 0;
    const wob = opt.wobble ?? 0;
    if (vx || vy || wob) {
      this.anim((t, dt) => {
        const a = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) {
          let x = a.getX(i) + (vx + Math.sin(t * 1.3 + seed[i]) * wob) * dt;
          let y = a.getY(i) + (vy + Math.cos(t * 1.1 + seed[i]) * wob * 0.6) * dt;
          if (x < opt.x[0]) x = opt.x[1];
          else if (x > opt.x[1]) x = opt.x[0];
          if (y < opt.y[0]) y = opt.y[1];
          else if (y > opt.y[1]) y = opt.y[0];
          a.setXY(i, x, y);
        }
        a.needsUpdate = true;
      });
    }
    return pts;
  }

  /** 画像をずらし続けて流れて見せる（コード・チャット・雲など） */
  scroll(t: THREE.Texture, sx: number, sy: number): void {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    this.anim((_t, dt) => {
      t.offset.x += sx * dt;
      t.offset.y += sy * dt;
    });
  }

  /** 光の筋（サーチライト・スポットライト）。先が広がる円すいを加算合成で描く */
  beam(color: number, len: number, radius: number, opacity: number): THREE.Mesh {
    const geo = new THREE.ConeGeometry(radius, len, 24, 1, true);
    geo.translate(0, -len / 2, 0); // 先端（光源）が原点
    const me = new THREE.Mesh(this.track(geo), this.additive(color, opacity));
    return this.add(me);
  }

  finish(): BuiltStage {
    const animators = this.animators;
    const disposables = this.disposables;
    return {
      group: this.group,
      platformMeshes: this.platformMeshes,
      animate: (t, dt) => {
        for (const a of animators) a(t, dt);
      },
      dispose: () => disposables.forEach((d) => d.dispose()),
    };
  }
}

// ---------------------------------------------------------------- よく使う質感の画像
/** ノイズの点々（汚れ・ざらつき） */
export function speckle(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, colors: string[], count: number, size = 2): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    const s = size * (0.5 + r());
    g.fillRect(r() * w, r() * h, s, s);
  }
  g.globalAlpha = 1;
}

/** 窓の明かり（夜のビル） */
export function windowsTexture(kit: Kit, seed: number, lit: string, density: number): THREE.CanvasTexture {
  return kit.tex(64, 128, (g) => {
    const r = rand(seed);
    g.fillStyle = '#0b0b16';
    g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 128; y += 8) {
      for (let x = 4; x < 64; x += 8) {
        if (r() < density) {
          g.fillStyle = r() < 0.15 ? '#ffffff' : lit;
          g.globalAlpha = 0.5 + r() * 0.5;
          g.fillRect(x, y, 4, 5);
        }
      }
    }
    g.globalAlpha = 1;
  });
}

/** ネオン看板（文字が光る板） */
export function neonSign(kit: Kit, text: string, color: number, width: number, vertical = false): THREE.Mesh {
  const chars = [...text];
  const cw = vertical ? 96 : Math.max(128, chars.length * 70);
  const ch = vertical ? Math.max(128, chars.length * 80) : 96;
  const t = kit.tex(cw, ch, (g) => {
    g.fillStyle = 'rgba(10,6,20,0.85)';
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = hex(color);
    g.lineWidth = 6;
    g.strokeRect(4, 4, cw - 8, ch - 8);
    g.font = `900 ${vertical ? 64 : 60}px ${FONT}`;
    g.textAlign = 'center';
    g.shadowColor = hex(color);
    g.shadowBlur = 18;
    g.fillStyle = '#ffffff';
    if (vertical) chars.forEach((c, i) => g.fillText(c, cw / 2, 70 + i * 80));
    else g.fillText(text, cw / 2, 68);
  });
  const height = (width * ch) / cw;
  return new THREE.Mesh(kit.track(new THREE.PlaneGeometry(width, height)), kit.basic(0xffffff, { map: t, transparent: true }));
}

/** 夜空の星 */
export function stars(kit: Kit, count: number): void {
  const n = kit.high ? count : Math.round(count * 0.45);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (kit.rnd() - 0.5) * 300;
    pos[i * 3 + 1] = 8 + kit.rnd() * 80;
    pos[i * 3 + 2] = -115 - kit.rnd() * 20;
  }
  const geo = kit.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = kit.add(new THREE.Points(geo, kit.track(new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, map: kit.soft(), transparent: true, depthWrite: false, fog: false }))));
  const mat = pts.material as THREE.PointsMaterial;
  kit.anim((t) => (mat.opacity = 0.75 + Math.sin(t * 1.7) * 0.15));
}

/** 遠くの街並みのシルエット（窓の明かりつき）を板に描く */
export function skylineBackdrop(kit: Kit, z: number, y: number, h: number, body: string, lit: string, seed: number, w = 260): void {
  kit.backdrop(w, h, kit.cx, y, z, (g, cw, ch) => {
    const r = rand(seed);
    let x = 0;
    g.fillStyle = body;
    while (x < cw) {
      const bw = 18 + r() * 46;
      const bh = ch * (0.35 + r() * 0.6);
      g.fillStyle = body;
      g.fillRect(x, ch - bh, bw - 2, bh);
      // 屋上のアンテナ
      if (r() < 0.25) g.fillRect(x + bw / 2, ch - bh - 14, 2, 14);
      // 窓
      g.fillStyle = lit;
      for (let wy = ch - bh + 6; wy < ch - 4; wy += 7) {
        for (let wx = x + 3; wx < x + bw - 6; wx += 6) {
          if (r() < 0.22) {
            g.globalAlpha = 0.4 + r() * 0.6;
            g.fillRect(wx, wy, 2, 3);
          }
        }
      }
      g.globalAlpha = 1;
      x += bw;
    }
  }, 1024);
}

/** ふんわりした雲の絵 */
export function cloudTexture(kit: Kit, seed: number, shade: string): THREE.CanvasTexture {
  return kit.tex(512, 192, (g) => {
    const r = rand(seed);
    for (let i = 0; i < 26; i++) {
      const x = 60 + r() * 392;
      const y = 80 + r() * 60 - Math.abs(x - 256) * 0.12;
      const rad = 30 + r() * 46;
      const grad = g.createRadialGradient(x, y - rad * 0.3, rad * 0.1, x, y, rad);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.75)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    // 下側に少し影
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, 70, 0, 192);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, shade);
    g.fillStyle = sh;
    g.fillRect(0, 0, 512, 192);
    g.globalCompositeOperation = 'source-over';
  });
}
