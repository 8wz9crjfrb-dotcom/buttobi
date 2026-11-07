// 3頭身のキャラクター（基本図形の組み合わせ）と、状態に合わせた手続き的なアニメーション。
// アニメ調に見えるよう、陰影を段階的にする塗り（トゥーン）と輪郭線を付けている。
// 色は衣装（costumes.ts）から受け取るので、着せ替えにも対応できる。

import * as THREE from 'three';
import type { CharacterDef } from '../shared/characters';
import type { Costume } from '../shared/costumes';
import { moveOf } from '../shared/moves';
import { FX_BIKE, FX_CHARGED, FX_POWER, FX_SPEED, type ViewFighter } from '../shared/types';

const FWD = -Math.PI / 2; // 腕・脚を前に向ける回転（x軸まわり）
const UP = -Math.PI;

interface Pose {
  armL: number;
  armR: number;
  armLz: number;
  armRz: number;
  legL: number;
  legR: number;
  lean: number;
  spinY: number;
  spinZ: number;
  squash: number;
  bob: number;
  headTilt: number;
}

function basePose(): Pose {
  return { armL: 0.12, armR: -0.12, armLz: 0.12, armRz: -0.12, legL: 0, legR: 0, lean: 0, spinY: 0, spinZ: 0, squash: 1, bob: 0, headTilt: 0 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 陰影を3段階にするための小さなテクスチャ（全キャラで共有）
let gradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
    gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

/**
 * キャラの明るさの上限（光のにじみ＝ブルームがかかる明るさより下に抑える）。
 * 背景やステージは光らせても、キャラは光って見えないようにするため。
 */
const CHAR_MAX = '0.8';

/** 材質の色をキャラの明るさの上限で抑える */
function capBrightness(m: THREE.Material, key: string): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>\n gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${CHAR_MAX}));`,
    );
  };
  m.customProgramCacheKey = () => key;
}

/** 瞳の色（キャラごと） */
const EYE_COLORS: Record<string, number> = {
  guard: 0x3a5aa0,
  hacker: 0x2fd27a,
  thief: 0xd0306f,
  streamer: 0x8a5cff,
  dopa: 0xff8a1a,
  gacha: 0x7a6aa0,
  courier: 0x7a4a2a,
  ai: 0x2aa8d8,
};

/** 輪郭線用の材質：裏面だけを、法線方向に少し膨らませて黒く描く */
function makeOutlineMaterial(thickness: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: 0x1b1b28, side: THREE.BackSide });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n transformed += normalize(normal) * ${thickness.toFixed(4)};`,
    );
  };
  return m;
}

export class FighterModel {
  readonly root = new THREE.Group();
  private turnGroup = new THREE.Group();
  /** 画面の奥行き方向の軸まわりに回すための入れ物（ふっとび中の回転用） */
  private spin = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private eyes: THREE.Object3D[] = [];
  /** 表情用：閉じた目・笑った目・「><」の目、口の形、眉 */
  private eyeAlt: { closed: THREE.Object3D; happy: THREE.Object3D; hurt: THREE.Object3D; lid: THREE.Object3D }[] = [];
  private mouths: { line: THREE.Object3D; open: THREE.Object3D; smile: THREE.Object3D } | null = null;
  private browMeshes: { mesh: THREE.Object3D; base: number; side: number }[] = [];
  private shieldMesh: THREE.Mesh;
  private marker: THREE.Mesh;
  private halo: THREE.Mesh;
  private mats: THREE.MeshToonMaterial[] = [];
  private glowMats: THREE.MeshBasicMaterial[] = [];
  private outlineMat: THREE.MeshBasicMaterial;
  private turn = 0;
  /** 自転車（配達員） */
  private bikeGroup: THREE.Group | null = null;
  /** 肩に浮かぶAIアシスタント（AIエンジニア） */
  private buddy: THREE.Group | null = null;
  /** 分身として半透明で表示するとき（0 = 通常） */
  ghost = 0;
  private c: Costume['colors'];
  private blinkSeed: number;

  constructor(
    private def: CharacterDef,
    costume: Costume,
    slotColor: number,
  ) {
    const s = def.scale;
    this.c = costume.colors;
    this.blinkSeed = Math.random() * 10;
    this.outlineMat = makeOutlineMaterial(0.012);

    this.root.add(this.turnGroup);
    this.turnGroup.add(this.spin);
    this.spin.position.y = 0.9 * s;
    this.spin.add(this.body);
    this.body.rotation.order = 'YXZ';
    this.body.scale.setScalar(s);

    this.buildBase();
    this.buildCharacter(def.id);
    this.buildCharacter2(def.id);

    // ガード（シールド）
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshStandardMaterial({ color: slotColor, transparent: true, opacity: 0.35, emissive: slotColor, emissiveIntensity: 0.4, depthWrite: false }),
    );
    this.shieldMesh.position.y = 0.95 * s;
    this.root.add(this.shieldMesh);

    // 頭上の目印（プレイヤー番号の色）
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: slotColor }));
    this.marker.rotation.x = Math.PI;
    this.marker.position.y = 2.25 * s;
    this.root.add(this.marker);

    // 復活時の台
    this.halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.6, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: slotColor, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }),
    );
    this.halo.position.y = -0.06;
    this.root.add(this.halo);
  }

  // ---------------------------------------------------------------- 部品づくり
  private toon(color: number): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    capBrightness(m, 'toon-cap');
    this.mats.push(m);
    return m;
  }

  private glow(color: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ color });
    capBrightness(m, 'basic-cap');
    this.glowMats.push(m);
    return m;
  }

  /** 部品を作って親に付ける（輪郭線つき） */
  private part(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: [number, number, number],
    opt: { rot?: [number, number, number]; scale?: [number, number, number]; outline?: boolean } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    if (opt.rot) mesh.rotation.set(...opt.rot);
    if (opt.scale) mesh.scale.set(...opt.scale);
    mesh.castShadow = true;
    parent.add(mesh);
    if (opt.outline !== false) {
      const ol = new THREE.Mesh(geo, this.outlineMat);
      mesh.add(ol);
    }
    return mesh;
  }

  /** 4体共通の体（3頭身：頭が身長の約1/3） */
  private buildBase(): void {
    const c = this.c;
    const wide = this.def.id === 'guard' ? 1.22 : this.def.id === 'thief' ? 0.95 : 1;
    // 脚
    this.hips.position.y = 0.62;
    this.body.add(this.hips);
    for (const [g, x] of [
      [this.legL, 0.1 * wide],
      [this.legR, -0.1 * wide],
    ] as const) {
      g.position.set(x, 0, 0);
      this.part(g, new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), this.toon(c.pants), [0, -0.25, 0]);
      this.part(g, new THREE.SphereGeometry(0.1, 14, 10), this.toon(c.shoes), [0, -0.55, 0.04], { scale: [1, 0.68, 1.45] });
      // 靴底
      this.part(g, new THREE.BoxGeometry(0.17, 0.035, 0.27), this.toon(0xf2f2f5), [0, -0.6, 0.04], { outline: false });
      this.hips.add(g);
    }
    // 胴体
    this.part(this.body, new THREE.CapsuleGeometry(0.2, 0.26, 6, 16), this.toon(c.main), [0, 0.9, 0], { scale: [1.12 * wide, 1, 0.82] });
    // 腕
    for (const [g, x] of [
      [this.armL, 0.29 * wide],
      [this.armR, -0.29 * wide],
    ] as const) {
      g.position.set(x, 1.12, 0);
      this.part(g, new THREE.CapsuleGeometry(0.068, 0.26, 4, 10), this.toon(c.main), [0, -0.19, 0]);
      // 袖口
      this.part(g, new THREE.TorusGeometry(0.066, 0.022, 6, 14), this.toon(c.sub), [0, -0.33, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
      this.part(g, new THREE.SphereGeometry(0.086, 12, 10), this.toon(c.skin), [0, -0.41, 0]);
      this.body.add(g);
    }
    // 頭（首の付け根を中心に回す）
    this.head.position.y = 1.2;
    this.body.add(this.head);
    this.part(this.head, new THREE.SphereGeometry(0.31, 26, 20), this.toon(c.skin), [0, 0.29, 0], { scale: [1, 0.95, 0.95] });
    // 目：縁・色つきの瞳・瞳孔・ハイライト2つ・まぶた。表情に合わせて切り替える
    const dark = this.toon(0x1d1d2b);
    const iris = this.glow(EYE_COLORS[this.def.id] ?? 0x3a5aa0);
    const white = this.glow(0xffffff);
    const line = (len: number) => new THREE.CapsuleGeometry(0.011, len, 3, 6);
    for (const x of [0.11, -0.11]) {
      const holder = new THREE.Group();
      holder.position.set(x, 0.27, 0.27);
      this.head.add(holder);
      const eye = new THREE.Group();
      holder.add(eye);
      this.part(eye, new THREE.SphereGeometry(0.055, 14, 10), dark, [0, 0, 0], { scale: [0.85, 1.25, 0.32], outline: false });
      this.part(eye, new THREE.SphereGeometry(0.042, 14, 10), iris, [0, -0.008, 0.008], { scale: [0.82, 1.15, 0.3], outline: false });
      this.part(eye, new THREE.SphereGeometry(0.022, 10, 8), dark, [0, -0.01, 0.014], { scale: [0.9, 1.2, 0.3], outline: false });
      this.part(eye, new THREE.SphereGeometry(0.017, 8, 6), white, [0.016, 0.03, 0.02], { outline: false });
      this.part(eye, new THREE.SphereGeometry(0.008, 6, 5), white, [-0.012, -0.025, 0.02], { outline: false });
      this.eyes.push(eye);
      // まぶた（怒った顔では傾けて下げる）
      const lid = this.part(holder, line(0.08), dark, [0, 0.068, 0.012], { rot: [0, 0, Math.PI / 2], outline: false });
      // 閉じた目（‿）・笑った目（^）・「><」の目
      const closed = this.part(holder, new THREE.TorusGeometry(0.04, 0.011, 5, 12, Math.PI), dark, [0, 0.015, 0.012], { rot: [0, 0, Math.PI], outline: false });
      const happy = this.part(holder, new THREE.TorusGeometry(0.04, 0.011, 5, 12, Math.PI), dark, [0, -0.015, 0.012], { outline: false });
      const hurt = new THREE.Group();
      hurt.position.set(0, 0, 0.012);
      const dir = x > 0 ? 1 : -1;
      this.part(hurt, line(0.055), dark, [0, 0.018, 0], { rot: [0, 0, dir * 1.0], outline: false });
      this.part(hurt, line(0.055), dark, [0, -0.018, 0], { rot: [0, 0, -dir * 1.0], outline: false });
      holder.add(hurt);
      closed.visible = happy.visible = hurt.visible = false;
      this.eyeAlt.push({ closed, happy, hurt, lid });
    }
  }

  /** 口（ふつう・開いた口・笑った口を切り替える） */
  private mouth(): void {
    const mc = this.toon(0x7a3a3a);
    const line = this.part(this.head, new THREE.CapsuleGeometry(0.011, 0.045, 3, 6), mc, [0, 0.17, 0.285], { rot: [0, 0, Math.PI / 2], outline: false });
    const open = this.part(this.head, new THREE.SphereGeometry(0.035, 12, 8), this.toon(0x5a1f2a), [0, 0.16, 0.275], { scale: [1, 0.85, 0.35], outline: false });
    const smile = this.part(this.head, new THREE.TorusGeometry(0.035, 0.011, 5, 12, Math.PI), mc, [0, 0.18, 0.285], { rot: [0, 0, Math.PI], outline: false });
    open.visible = smile.visible = false;
    this.mouths = { line, open, smile };
  }

  private brows(angle: number, color: number): void {
    for (const x of [0.11, -0.11]) {
      const side = x > 0 ? -1 : 1;
      const mesh = this.part(this.head, new THREE.BoxGeometry(0.1, 0.022, 0.02), this.toon(color), [x, 0.37, 0.28], { rot: [0, 0, side * angle], outline: false });
      this.browMeshes.push({ mesh, base: side * angle, side });
    }
  }

  /** 表情を切り替える */
  private setExpression(kind: 'normal' | 'angry' | 'hurt' | 'closed' | 'happy', mouth: 'line' | 'open' | 'smile', tired: boolean): void {
    this.eyes.forEach((eye, i) => {
      const alt = this.eyeAlt[i];
      eye.visible = kind === 'normal' || kind === 'angry';
      alt.closed.visible = kind === 'closed';
      alt.happy.visible = kind === 'happy';
      alt.hurt.visible = kind === 'hurt';
      alt.lid.visible = eye.visible;
      const side = i === 0 ? -1 : 1;
      if (kind === 'angry') {
        alt.lid.position.y = 0.05;
        alt.lid.rotation.z = Math.PI / 2 + side * 0.35;
        eye.scale.y = 0.85;
      } else {
        alt.lid.position.y = tired ? 0.04 : 0.068;
        alt.lid.rotation.z = Math.PI / 2;
        eye.scale.y = tired ? 0.7 : 1;
      }
    });
    for (const b of this.browMeshes) b.mesh.rotation.z = b.base + (kind === 'angry' ? b.side * 0.3 : kind === 'hurt' ? -b.side * 0.25 : 0);
    if (this.mouths) {
      this.mouths.line.visible = mouth === 'line';
      this.mouths.open.visible = mouth === 'open';
      this.mouths.smile.visible = mouth === 'smile';
    }
  }

  /** 手に持たせる（腕の先に付ける） */
  private hand(arm: THREE.Group): THREE.Group {
    const g = new THREE.Group();
    g.position.set(0, -0.42, 0);
    arm.add(g);
    return g;
  }

  // ---------------------------------------------------------------- キャラ別
  private buildCharacter(id: string): void {
    const c = this.c;
    const h = this.head;
    if (id === 'guard') {
      // データセンター警備員：制帽・反射ベスト・無線機
      this.brows(0.15, c.hair);
      this.mouth();
      for (const x of [0.285, -0.285]) this.part(h, new THREE.BoxGeometry(0.03, 0.07, 0.06), this.toon(c.hair), [x, 0.33, 0.02], { outline: false });
      const cap = this.toon(c.main);
      this.part(h, new THREE.CylinderGeometry(0.31, 0.32, 0.16, 24), cap, [0, 0.5, 0]);
      this.part(h, new THREE.CylinderGeometry(0.35, 0.31, 0.07, 24), cap, [0, 0.6, 0]);
      this.part(h, new THREE.BoxGeometry(0.34, 0.03, 0.17), this.toon(0x15151c), [0, 0.43, 0.3], { rot: [0.25, 0, 0] });
      this.part(h, new THREE.BoxGeometry(0.07, 0.06, 0.02), this.glow(0xffd23f), [0, 0.53, 0.32], { outline: false });
      // ベスト（反射材のラインつき）
      this.part(this.body, new THREE.CapsuleGeometry(0.205, 0.2, 6, 16), this.toon(c.sub), [0, 0.92, 0], { scale: [1.12 * 1.22 + 0.04, 0.95, 0.88] });
      for (const y of [0.85, 0.98]) {
        this.part(this.body, new THREE.BoxGeometry(0.58, 0.035, 0.37), this.toon(c.accent), [0, y, 0], { outline: false });
      }
      this.part(this.body, new THREE.BoxGeometry(0.58, 0.06, 0.36), this.toon(0x15151c), [0, 0.66, 0], { outline: false });
      // 無線機
      this.part(this.body, new THREE.BoxGeometry(0.08, 0.12, 0.05), this.toon(0x15151c), [0.2, 1.1, 0.15]);
      this.part(this.body, new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), this.toon(0x15151c), [0.22, 1.21, 0.15], { outline: false });
    } else if (id === 'hacker') {
      // ハッカー：フード・光るメガネ・ノートPC
      this.mouth();
      const hood = this.toon(c.main);
      this.part(h, new THREE.SphereGeometry(0.37, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), hood, [0, 0.31, -0.03], { rot: [-0.45, 0, 0], scale: [1, 1, 1.05] });
      this.part(h, new THREE.TorusGeometry(0.28, 0.04, 8, 24), hood, [0, 0.29, 0.17]);
      for (const [x, r] of [
        [0.08, 0.3],
        [-0.02, -0.1],
        [-0.12, -0.4],
      ]) {
        this.part(h, new THREE.ConeGeometry(0.06, 0.16, 6), this.toon(c.hair), [x, 0.43, 0.24], { rot: [1.9, 0, r], outline: false });
      }
      const glass = this.glow(c.accent);
      for (const x of [0.11, -0.11]) this.part(h, new THREE.BoxGeometry(0.13, 0.08, 0.02), glass, [x, 0.27, 0.31], { outline: false });
      this.part(h, new THREE.BoxGeometry(0.06, 0.015, 0.015), glass, [0, 0.29, 0.31], { outline: false });
      // パーカーのひも・ポケット・ファスナー
      for (const x of [0.06, -0.06]) this.part(this.body, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), this.toon(0xeeeeee), [x, 1.05, 0.17], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.26, 0.1, 0.03), this.toon(c.sub), [0, 0.76, 0.16], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.015, 0.36, 0.01), glass, [0, 0.95, 0.17], { outline: false });
      // ノートPC（左手）
      const laptop = this.hand(this.armL);
      this.part(laptop, new THREE.BoxGeometry(0.3, 0.02, 0.21), this.toon(0x9aa0aa), [0, 0, 0.08], { rot: [0.3, 0, 0] });
      this.part(laptop, new THREE.BoxGeometry(0.28, 0.17, 0.012), glass, [0, 0.09, -0.03], { rot: [-0.9, 0, 0], outline: false });
    } else if (id === 'thief') {
      // データ泥棒：ニット帽・マスク・USBメモリ
      this.brows(-0.3, c.hair);
      const beanie = this.toon(c.sub);
      this.part(h, new THREE.SphereGeometry(0.33, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), beanie, [0, 0.33, 0], { scale: [1, 1.05, 1] });
      this.part(h, new THREE.TorusGeometry(0.31, 0.045, 8, 26), this.toon(c.main), [0, 0.35, 0], { rot: [Math.PI / 2, 0, 0] });
      for (const [x, z, r] of [
        [0.26, -0.1, -1.0],
        [-0.26, -0.1, 1.0],
        [0.1, -0.27, -0.4],
      ]) {
        this.part(h, new THREE.ConeGeometry(0.05, 0.18, 6), this.toon(c.hair), [x, 0.3, z], { rot: [-0.5, 0, r], outline: false });
      }
      // マスク（顔の下半分）
      this.part(h, new THREE.SphereGeometry(0.318, 22, 10, Math.PI / 2 - 1.0, 2.0, Math.PI * 0.55, Math.PI * 0.27), this.toon(0x3a3150), [0, 0.29, 0], { scale: [1.01, 0.96, 0.96], outline: false });
      // ジャケットの襟
      this.part(this.body, new THREE.TorusGeometry(0.15, 0.04, 8, 20), this.toon(c.accent), [0, 1.18, 0], { rot: [Math.PI / 2, 0, 0] });
      this.part(this.body, new THREE.BoxGeometry(0.02, 0.4, 0.01), this.toon(c.accent), [0, 0.92, 0.17], { outline: false });
      // USBメモリ（右手）
      const usb = this.hand(this.armR);
      this.part(usb, new THREE.BoxGeometry(0.05, 0.12, 0.03), this.glow(c.accent), [0, -0.06, 0.05], { outline: false });
      this.part(usb, new THREE.BoxGeometry(0.035, 0.05, 0.02), this.toon(0xcccccc), [0, -0.14, 0.05], { outline: false });
    } else if (id === 'streamer') {
      // 配信者：ボブヘア・ねこ耳ヘッドホン・自撮り棒
      this.mouth();
      const hair = this.toon(c.hair);
      // 髪は後ろに傾けてかぶせ、顔（目）にかからないようにする
      this.part(h, new THREE.SphereGeometry(0.34, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 0.31, -0.03], { rot: [-0.55, 0, 0] });
      for (const [x, col] of [
        [0.26, c.hair],
        [-0.26, c.accent],
      ] as const) {
        this.part(h, new THREE.CapsuleGeometry(0.075, 0.2, 4, 8), this.toon(col), [x, 0.17, 0.05]);
      }
      for (let i = 0; i < 4; i++) {
        this.part(h, new THREE.CapsuleGeometry(0.045, 0.07, 4, 6), hair, [-0.15 + i * 0.1, 0.5, 0.22], { rot: [0.9, 0, 0], outline: false });
      }
      // ほっぺ
      for (const x of [0.17, -0.17]) this.part(h, new THREE.SphereGeometry(0.04, 10, 8), this.glow(0xff9bb5), [x, 0.2, 0.25], { scale: [1, 0.6, 0.3], outline: false });
      // ねこ耳ヘッドホン
      const hp = this.toon(c.main);
      this.part(h, new THREE.TorusGeometry(0.35, 0.03, 8, 24, Math.PI), hp, [0, 0.3, 0]);
      for (const x of [0.35, -0.35]) {
        this.part(h, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18), hp, [x, 0.27, 0], { rot: [0, 0, Math.PI / 2] });
        this.part(h, new THREE.CylinderGeometry(0.065, 0.065, 0.085, 14), this.glow(c.accent), [x * 1.02, 0.27, 0], { rot: [0, 0, Math.PI / 2], outline: false });
        this.part(h, new THREE.ConeGeometry(0.07, 0.13, 4), hp, [x * 0.55, 0.6, 0], { rot: [0, Math.PI / 4, x > 0 ? -0.35 : 0.35] });
      }
      // パーカー（フードを下ろしている）
      this.part(this.body, new THREE.TorusGeometry(0.17, 0.06, 8, 20), this.toon(c.sub), [0, 1.17, -0.03], { rot: [Math.PI / 2 - 0.3, 0, 0] });
      for (const x of [0.05, -0.05]) this.part(this.body, new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), this.toon(c.accent), [x, 1.04, 0.17], { outline: false });
      // 自撮り棒とスマホ（右手）
      const stick = this.hand(this.armR);
      // 手から上へ伸ばし、先のスマホを自分に向ける
      this.part(stick, new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), this.toon(0x444455), [0, 0.27, 0.1], { rot: [-0.35, 0, 0], outline: false });
      this.part(stick, new THREE.BoxGeometry(0.11, 0.19, 0.02), this.toon(0x222233), [0, 0.58, 0.21], { rot: [-0.35, 0, 0] });
      this.part(stick, new THREE.BoxGeometry(0.095, 0.17, 0.005), this.glow(c.accent), [0, 0.58, 0.195], { rot: [-0.35, 0, 0], outline: false });
    }
  }

  /** 追加の4体 */
  private buildCharacter2(id: string): void {
    const c = this.c;
    const h = this.head;
    if (id === 'dopa') {
      // ドパガキ：ぶかぶかの蛍光パーカー・イヤホン・スマホ・エナジードリンク・キラキラの目
      this.mouth();
      const hair = this.toon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.33, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, [0, 0.31, -0.02], { rot: [-0.45, 0, 0] });
      for (const [x, z, rx, rz] of [
        [0.15, 0.2, 1.2, -0.4],
        [0, 0.24, 1.3, 0],
        [-0.15, 0.2, 1.2, 0.4],
        [0.2, -0.05, -0.2, -1.1],
        [-0.2, -0.05, -0.2, 1.1],
      ]) {
        this.part(h, new THREE.ConeGeometry(0.06, 0.2, 6), hair, [x, 0.52, z], { rot: [rx, 0, rz], outline: false });
      }
      this.part(h, new THREE.ConeGeometry(0.05, 0.12, 6), this.toon(c.accent), [0.05, 0.62, 0.05], { rot: [0.3, 0, -0.3], outline: false });
      // キラキラの目（ハイライトを1つ増やす）
      for (const e of this.eyes) this.part(e, new THREE.SphereGeometry(0.01, 6, 5), this.glow(0xfff6a0), [-0.015, -0.025, 0.02], { outline: false });
      // イヤホン
      for (const x of [0.3, -0.3]) this.part(h, new THREE.SphereGeometry(0.035, 8, 6), this.glow(0xffffff), [x, 0.26, 0.04], { outline: false });
      // ぶかぶかのパーカー（フードは下ろしている）
      this.part(this.body, new THREE.TorusGeometry(0.18, 0.07, 8, 20), this.toon(c.main), [0, 1.16, -0.04], { rot: [Math.PI / 2 - 0.35, 0, 0] });
      this.part(this.body, new THREE.BoxGeometry(0.3, 0.1, 0.03), this.toon(c.sub), [0, 0.76, 0.17], { outline: false });
      for (const x of [0.06, -0.06]) this.part(this.body, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), this.toon(c.accent), [x, 1.03, 0.17], { outline: false });
      // エナジードリンク（腰）
      this.part(this.body, new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), this.toon(c.accent), [-0.27, 0.72, 0.05]);
      this.part(this.body, new THREE.CylinderGeometry(0.046, 0.046, 0.03, 12), this.toon(0x222222), [-0.27, 0.74, 0.05], { outline: false });
      // スマホ（右手）
      const phone = this.hand(this.armR);
      this.part(phone, new THREE.BoxGeometry(0.1, 0.18, 0.02), this.toon(0x222233), [0, -0.05, 0.08]);
      this.part(phone, new THREE.BoxGeometry(0.085, 0.16, 0.005), this.glow(0x8ef0ff), [0, -0.05, 0.092], { outline: false });
    } else if (id === 'gacha') {
      // ガチャ廃人：目の下のクマ・ぼさぼさの長い髪・ジャージ・光るスマホ
      this.mouth();
      for (const x of [0.11, -0.11]) {
        this.part(h, new THREE.SphereGeometry(0.05, 10, 6), this.glow(0x6a4a8a), [x, 0.2, 0.27], { scale: [1, 0.35, 0.3], outline: false });
      }
      const hair = this.toon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.345, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, [0, 0.3, -0.03], { rot: [-0.5, 0, 0] });
      for (const [x, y] of [
        [0.25, 0.12],
        [-0.25, 0.12],
        [0.15, 0.02],
        [-0.15, 0.02],
      ]) {
        this.part(h, new THREE.CapsuleGeometry(0.06, 0.24, 4, 8), hair, [x, y, -0.08], { rot: [0.2, 0, x > 0 ? 0.15 : -0.15] });
      }
      for (let i = 0; i < 3; i++) this.part(h, new THREE.ConeGeometry(0.06, 0.18, 6), hair, [-0.1 + i * 0.1, 0.5, 0.22], { rot: [1.6, 0, (i - 1) * 0.3], outline: false });
      // ジャージ（腕と胴に線）
      for (const arm of [this.armL, this.armR]) this.part(arm, new THREE.BoxGeometry(0.02, 0.28, 0.14), this.toon(c.accent), [0, -0.19, 0], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.02, 0.38, 0.01), this.toon(c.accent), [0, 0.94, 0.168], { outline: false });
      this.part(this.body, new THREE.TorusGeometry(0.15, 0.04, 8, 20), this.toon(c.sub), [0, 1.18, 0], { rot: [Math.PI / 2, 0, 0] });
      // 光るスマホ（右手）
      const phone = this.hand(this.armR);
      this.part(phone, new THREE.BoxGeometry(0.1, 0.18, 0.02), this.toon(0x222233), [0, -0.05, 0.08]);
      this.part(phone, new THREE.BoxGeometry(0.085, 0.16, 0.005), this.glow(c.accent), [0, -0.05, 0.092], { outline: false });
    } else if (id === 'courier') {
      // 配達員：ヘルメット・四角い配達バッグ・自転車
      this.mouth();
      this.brows(0.05, c.hair);
      const helmet = this.toon(c.main);
      this.part(h, new THREE.SphereGeometry(0.335, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), helmet, [0, 0.33, 0], { scale: [1, 0.95, 1.08] });
      this.part(h, new THREE.BoxGeometry(0.06, 0.04, 0.5), this.toon(c.accent), [0, 0.62, 0], { outline: false });
      this.part(h, new THREE.BoxGeometry(0.3, 0.025, 0.12), this.toon(0x15151c), [0, 0.42, 0.32], { rot: [0.25, 0, 0] });
      // 配達バッグ（背中）
      this.part(this.body, new THREE.BoxGeometry(0.5, 0.48, 0.32), this.toon(c.main), [0, 1.0, -0.33]);
      this.part(this.body, new THREE.BoxGeometry(0.51, 0.08, 0.33), this.toon(c.accent), [0, 1.06, -0.33], { outline: false });
      for (const x of [0.14, -0.14]) this.part(this.body, new THREE.BoxGeometry(0.04, 0.4, 0.05), this.toon(c.sub), [x, 0.98, -0.13], { outline: false });
      // 自転車（乗っているときだけ表示）
      const bike = new THREE.Group();
      const frame = this.toon(c.main);
      const dark = this.toon(0x222228);
      for (const z of [0.45, -0.45]) {
        this.part(bike, new THREE.TorusGeometry(0.28, 0.035, 8, 22), dark, [0, 0.28, z], { rot: [0, Math.PI / 2, 0] });
      }
      this.part(bike, new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), frame, [0, 0.45, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
      this.part(bike, new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8), frame, [0, 0.5, 0.35], { rot: [0.4, 0, 0], outline: false });
      this.part(bike, new THREE.BoxGeometry(0.4, 0.03, 0.04), dark, [0, 0.74, 0.43], { outline: false });
      this.part(bike, new THREE.BoxGeometry(0.14, 0.04, 0.22), dark, [0, 0.66, -0.12], { outline: false });
      bike.visible = false;
      this.turnGroup.add(bike);
      this.bikeGroup = bike;
    } else if (id === 'ai') {
      // AIエンジニア：きちんとした髪・ヘッドセット・カーディガン・肩に浮かぶAIアシスタント
      this.mouth();
      this.brows(0, c.hair);
      const hair = this.toon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.335, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, 0.31, -0.02], { rot: [-0.35, 0, 0] });
      this.part(h, new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), hair, [0.06, 0.5, 0.2], { rot: [0, 0, Math.PI / 2 - 0.25], outline: false });
      // ヘッドセット
      const hs = this.toon(0x2a2f3a);
      this.part(h, new THREE.TorusGeometry(0.34, 0.022, 8, 24, Math.PI), hs, [0, 0.3, 0]);
      this.part(h, new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), hs, [0.34, 0.27, 0], { rot: [0, 0, Math.PI / 2] });
      this.part(h, new THREE.CylinderGeometry(0.01, 0.01, 0.22, 6), hs, [0.3, 0.17, 0.12], { rot: [1.2, 0, 0.3], outline: false });
      this.part(h, new THREE.SphereGeometry(0.025, 8, 6), this.glow(c.accent), [0.24, 0.13, 0.22], { outline: false });
      // カーディガン（前のライン）
      for (const x of [0.07, -0.07]) this.part(this.body, new THREE.BoxGeometry(0.02, 0.42, 0.01), this.toon(c.sub), [x, 0.92, 0.168], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.1, 0.38, 0.01), this.toon(c.accent), [0, 0.95, 0.165], { outline: false });
      // AIアシスタント（浮かぶ球）
      const buddy = new THREE.Group();
      this.part(buddy, new THREE.SphereGeometry(0.13, 16, 12), this.glow(c.accent), [0, 0, 0]);
      for (const x of [0.04, -0.04]) this.part(buddy, new THREE.SphereGeometry(0.018, 6, 5), this.glow(0x0b1a2a), [x, 0.02, 0.11], { outline: false });
      buddy.position.set(0.5, 1.85, 0);
      this.root.add(buddy);
      this.buddy = buddy;
    }
  }

  // ---------------------------------------------------------------- 毎フレームの更新
  update(v: ViewFighter, def: CharacterDef, time: number, dt: number): void {
    const visible = v.state !== 'dead';
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(v.x, v.y, 0);

    // 向き：少しカメラ側を向かせる
    const target = this.victory ? 0 : v.facing * (Math.PI / 2 - 0.45);
    this.turn += (target - this.turn) * Math.min(1, dt * 18);

    const p = this.victory ? this.victoryPose(time) : this.pose(v, def, time);
    // 自転車（配達員）：乗っている間と、立ちこぎジャンプ中に表示
    const onBike = (v.fx & FX_BIKE) !== 0 || (def.id === 'courier' && v.state === 'attack' && v.move === 'uspecial');
    if (this.bikeGroup) {
      this.bikeGroup.visible = onBike;
      if (onBike) {
        const c = Math.sin(time * 18);
        p.legL = -0.9 + c * 0.6;
        p.legR = -0.9 - c * 0.6;
        p.lean = 0.25;
        p.armL = FWD * 0.75;
        p.armR = FWD * 0.75;
        p.bob = 0.34;
        p.spinY = 0;
      }
    }
    // AIアシスタント：ふわふわ浮かぶ
    if (this.buddy) {
      this.buddy.position.set(-v.facing * 0.55, 1.95 * def.scale + Math.sin(time * 3) * 0.08, 0.1);
      this.buddy.rotation.y = Math.sin(time * 1.5) * 0.4;
    }
    this.turnGroup.rotation.y = this.turn + p.spinY;
    this.spin.rotation.z = p.spinZ;
    this.body.rotation.set(p.lean, 0, 0);
    this.body.position.y = -0.9 * def.scale + p.bob;
    const sq = p.squash;
    this.body.scale.set(def.scale * Math.sqrt(2 - sq), def.scale * sq, def.scale * Math.sqrt(2 - sq));
    this.armL.rotation.set(p.armL, 0, p.armLz);
    this.armR.rotation.set(p.armR, 0, p.armRz);
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
    this.head.rotation.set(p.headTilt, 0, 0);

    // 表情：攻撃中はキリッ、被弾中は「><」、眠り・まばたきは閉じ目、勝利は笑顔
    const blinking = (time + this.blinkSeed) % 3.7 < 0.12;
    const tired = def.id === 'gacha';
    if (this.victory) this.setExpression('happy', 'smile', false);
    else if (v.state === 'hitstun' || v.state === 'shieldbreak' || v.state === 'helpless') this.setExpression('hurt', 'open', false);
    else if (v.state === 'sleep' || blinking) this.setExpression('closed', 'line', false);
    else if (v.state === 'attack') this.setExpression('angry', v.move === 'smash' || (v.move ?? '').endsWith('special') ? 'open' : 'line', false);
    else this.setExpression('normal', 'line', tired);

    // ガード
    const shielding = v.state === 'shield';
    this.shieldMesh.visible = shielding;
    if (shielding) this.shieldMesh.scale.setScalar((0.55 + 0.6 * v.shield) * def.scale);

    // 無敵の点滅・溜めの発光・回避や透明化・毒
    const md = v.state === 'attack' && v.move ? moveOf(def.id, v.move) : null;
    const invisible = md?.special === 'invis' && v.moveFrame >= Math.round(md.startup * def.frameMul) && v.moveFrame < Math.round(md.startup * def.frameMul) + md.active;
    const flash = v.invuln && !invisible && Math.floor(time * 20) % 2 === 0;
    const charging = v.charge > 0;
    const ghost = v.state === 'dodge' || v.state === 'airdodge' || invisible;
    const helpless = v.state === 'helpless';
    const poisoned = v.poison && Math.floor(time * 6) % 2 === 0;
    const opacity = this.ghost > 0 ? this.ghost : invisible ? 0.12 : ghost ? 0.45 : 1;
    // 倍速（青）・課金（赤）・吸収済み（水色）は、体がほんのり光る
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    const fxGlow = v.fx & FX_POWER ? 0x5a1010 : v.fx & FX_CHARGED ? 0x0a4a5a : v.fx & FX_SPEED ? 0x10305a : 0;
    for (const m of this.mats) {
      m.emissive.setHex(flash ? 0x555555 : charging ? 0xffaa00 : poisoned ? 0x5a1a7a : helpless ? 0x220022 : fxGlow);
      m.emissiveIntensity = charging ? 0.3 + 0.3 * Math.sin(time * 30) : fxGlow && !flash && !poisoned ? 0.6 + 0.6 * pulse : 1;
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
    for (const m of this.glowMats) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
    this.outlineMat.transparent = opacity < 1;
    this.outlineMat.opacity = opacity;
    this.outlineMat.visible = opacity > 0.3;
    this.halo.visible = v.state === 'respawn';
    this.marker.visible = !invisible;
    this.marker.position.y = 2.25 * def.scale + Math.sin(time * 4) * 0.05;
  }

  private victory = false;
  /** 結果画面で勝ったときのポーズ */
  setVictory(on: boolean): void {
    this.victory = on;
  }

  private victoryPose(time: number): Pose {
    const p = basePose();
    const b = Math.sin(time * 8);
    p.bob = Math.abs(b) * 0.12;
    p.armR = UP * 0.9 + b * 0.2;
    p.armL = 0.3 - b * 0.3;
    p.armLz = 0.6;
    p.legL = b * 0.3;
    p.legR = -b * 0.3;
    p.headTilt = -0.1;
    return p;
  }

  private pose(v: ViewFighter, def: CharacterDef, time: number): Pose {
    const p = basePose();
    const t = v.stateTime;
    switch (v.state) {
      case 'idle':
      case 'respawn':
        this.idlePose(def.id, time + v.slot, p);
        break;
      case 'run': {
        const c = Math.sin(t * 0.42);
        p.legL = c * 1.0;
        p.legR = -c * 1.0;
        p.armL = -c * 0.9;
        p.armR = c * 0.9;
        p.lean = 0.28;
        p.bob = Math.abs(Math.cos(t * 0.42)) * 0.06;
        break;
      }
      case 'air':
        p.legL = -0.8;
        p.legR = 0.35;
        p.armL = -0.6;
        p.armR = -1.2;
        p.armLz = 0.5;
        p.armRz = -0.5;
        break;
      case 'land':
        p.squash = t < 4 ? 0.8 : 0.9 + Math.min(0.1, t * 0.01);
        p.legL = -0.4;
        p.legR = 0.4;
        break;
      case 'shield':
        p.squash = 0.92;
        p.armL = FWD * 0.6;
        p.armR = FWD * 0.6;
        break;
      case 'hitstun':
        p.armL = UP * 0.7 + Math.sin(time * 25) * 0.3;
        p.armR = UP * 0.6 - Math.sin(time * 25) * 0.3;
        p.legL = 0.6;
        p.legR = -0.3;
        p.lean = -0.5;
        p.headTilt = -0.3;
        if (t > 4 && v.damage > 40) p.spinZ = t * 0.35 * -v.facing;
        break;
      case 'shieldbreak':
      case 'sleep':
        p.lean = -0.15 + Math.sin(time * 2) * 0.05;
        p.headTilt = 0.35;
        p.armL = 0.15;
        p.armR = -0.15;
        p.squash = 0.95;
        if (v.state === 'shieldbreak') p.spinY = Math.sin(time * 4) * 0.4;
        break;
      case 'dodge':
        p.squash = 0.85;
        p.lean = 0.4;
        break;
      case 'airdodge':
        p.legL = -1;
        p.legR = -1;
        p.armL = -0.5;
        p.armR = -0.5;
        p.spinY = t * 0.5;
        break;
      case 'ledge':
        p.armL = UP;
        p.armR = UP;
        p.legL = Math.sin(time * 2) * 0.2;
        p.legR = -Math.sin(time * 2) * 0.2;
        break;
      case 'helpless':
        p.armL = UP * 0.5;
        p.armR = UP * 0.5;
        p.legL = 0.3;
        p.legR = -0.3;
        p.spinZ = Math.sin(time * 6) * 0.2;
        break;
      case 'attack':
        this.attackPose(v, def, p);
        break;
    }
    return p;
  }

  /** キャラごとの待機ポーズ */
  private idlePose(id: string, time: number, p: Pose): void {
    const b = Math.sin(time * 3);
    p.bob = b * 0.015;
    switch (id) {
      case 'guard':
        // 腕組み
        p.armL = FWD * 0.55;
        p.armLz = -0.8;
        p.armR = FWD * 0.6;
        p.armRz = 0.8;
        break;
      case 'hacker':
        // ノートPCを打つ
        p.armL = FWD * 0.55;
        p.armLz = -0.3;
        p.armR = FWD * 0.7 + Math.sin(time * 22) * 0.06;
        p.armRz = 0.35;
        p.headTilt = 0.2;
        break;
      case 'thief':
        // 身をかがめて、きょろきょろ
        p.squash = 0.93;
        p.lean = 0.2;
        p.armL = FWD * 0.3;
        p.armR = FWD * 0.4;
        p.spinY = Math.sin(time * 0.8) * 0.3;
        break;
      case 'streamer':
        // 手を振る
        p.armR = UP * 0.85;
        p.armRz = -0.3 + Math.sin(time * 8) * 0.35;
        p.armL = 0.15;
        p.bob = Math.abs(b) * 0.03;
        break;
      case 'dopa':
        // 顔の前でスマホ、足でリズム
        p.armR = FWD * 1.25;
        p.armRz = 0.45;
        p.armL = 0.1;
        p.headTilt = 0.3;
        p.legL = Math.max(0, Math.sin(time * 10)) * -0.2;
        break;
      case 'gacha':
        // スマホを連打。ふらふら
        p.armR = FWD * 1.1;
        p.armRz = 0.4 + Math.sin(time * 30) * 0.05;
        p.armL = FWD * 0.9;
        p.armLz = -0.4;
        p.headTilt = 0.3;
        p.lean = Math.sin(time * 1.1) * 0.06;
        break;
      case 'courier':
        // 腰に手、足踏み
        p.armL = 0.3;
        p.armLz = 0.55;
        p.armR = 0.3;
        p.armRz = -0.55;
        p.legL = Math.max(0, Math.sin(time * 6)) * -0.25;
        p.legR = Math.max(0, -Math.sin(time * 6)) * -0.25;
        break;
      case 'ai':
        // あごに手を当てて考える
        p.armR = FWD * 1.35;
        p.armRz = 0.6;
        p.armL = FWD * 0.45;
        p.armLz = -0.8;
        p.headTilt = -0.1;
        break;
      default:
        p.armL = 0.1 + b * 0.05;
        p.armR = -0.1 - b * 0.05;
    }
  }

  private attackPose(v: ViewFighter, def: CharacterDef, p: Pose): void {
    if (!v.move) return;
    const md = moveOf(def.id, v.move);
    const s = Math.max(1, Math.round(md.startup * def.frameMul));
    const a = md.active;
    const e = Math.max(1, Math.round(md.end * def.frameMul));
    const f = v.moveFrame;
    // 0→1: 振りかぶり、1: 攻撃の瞬間、1→0: 戻り
    const k = f < s ? f / s : f < s + a ? 1 : Math.max(0, 1 - (f - s - a) / e);
    const wind = f < s ? Math.sin((f / s) * Math.PI) : 0;
    // 必殺技は種類ごとのポーズ
    switch (md.special) {
      case 'shot':
        if (v.move === 'nspecial' && def.id === 'streamer') {
          p.armR = lerp(UP * 0.9, FWD * 0.8, k);
        } else if (v.move === 'nspecial' && def.id === 'guard') {
          p.armL = FWD * 0.7;
          p.armR = FWD * 0.7;
          p.headTilt = 0.15;
        } else {
          p.armR = lerp(0.3, FWD, k);
          p.armL = lerp(0.2, FWD * 0.6, k);
          p.lean = 0.1 * k;
        }
        return;
      case 'wall':
        p.armL = FWD * k;
        p.armR = FWD * k;
        p.lean = 0.2 * k;
        return;
      case 'counter':
        p.armL = FWD * 0.75;
        p.armR = FWD * 0.75;
        p.armLz = -0.7;
        p.armRz = 0.7;
        p.squash = 0.92;
        return;
      case 'trap':
        p.squash = 0.8;
        p.armR = FWD * 0.5 * k;
        p.lean = 0.25;
        return;
      case 'invis':
        p.squash = 0.85;
        p.lean = 0.3;
        p.armL = 0.6;
        p.armR = -0.6;
        return;
      case 'teleport':
        p.armR = lerp(UP * 0.8, FWD * 1.1, k);
        p.lean = 0.3 * k;
        return;
      case 'sleep':
        p.armR = UP;
        p.armL = 0.3;
        p.headTilt = -0.2;
        return;
      case 'dash':
        p.armR = FWD;
        p.lean = 0.7 * k;
        p.legL = 0.6 * k;
        p.legR = -0.6 * k;
        return;
      case 'recovery':
      case 'platform':
        p.armR = UP;
        p.armL = UP * 0.4;
        if (def.id === 'thief') p.spinY = f * 0.6;
        if (md.riseVx) p.lean = 0.5;
        return;
      case 'speedup':
        // スマホを掲げて倍速に
        p.armR = UP * 0.7 * k;
        p.headTilt = -0.15;
        return;
      case 'scroll':
        p.armR = lerp(UP * 0.3, FWD * 1.1, k);
        p.lean = 0.5 * k;
        p.legL = 0.5 * k;
        p.legR = -0.5 * k;
        return;
      case 'redirect':
        p.armR = UP;
        p.armL = UP * 0.8;
        p.lean = 0.2;
        return;
      case 'gacha10':
      case 'pay':
        // スマホをのぞきこむ
        p.armR = FWD * 1.15;
        p.armL = FWD * 0.6;
        p.headTilt = 0.25;
        if (md.special === 'gacha10' && f >= s) p.bob = Math.abs(Math.sin(f * 0.5)) * 0.08;
        return;
      case 'gacha1':
        p.armR = lerp(0.6 * wind, FWD * 1.1, k);
        p.lean = 0.3 * k;
        return;
      case 'bike':
        p.armR = FWD * 0.7;
        p.armL = FWD * 0.7;
        return;
      case 'food':
        p.squash = 0.82;
        p.armR = FWD * 0.6 * k;
        p.armL = FWD * 0.6 * k;
        p.lean = 0.3;
        return;
      case 'absorb':
        p.armL = FWD * 0.9;
        p.armR = FWD * 0.9;
        p.armLz = 0.5;
        p.armRz = -0.5;
        return;
      case 'decoy':
        p.armR = UP * 0.6 * k;
        p.headTilt = -0.1;
        return;
      case 'tether':
        p.armR = UP * 0.75;
        p.armL = 0.3;
        return;
    }
    switch (v.move) {
      case 'jab':
        p.armR = lerp(-0.1, FWD * 1.05, k);
        p.lean = 0.1 * k;
        break;
      case 'side':
      case 'fair':
        p.armR = lerp(0.6 * wind, FWD * 1.1, k);
        p.armL = 0.6 * k;
        p.lean = 0.25 * k;
        if (v.move === 'fair') {
          p.legL = -0.6;
          p.legR = 0.3;
        }
        break;
      case 'smash':
        if (v.charge > 0 || f < s) {
          p.armR = 0.9;
          p.armL = 0.5;
          p.lean = -0.2;
          p.squash = 0.93;
        } else {
          p.armR = lerp(0, FWD * 1.15, k);
          p.armL = lerp(0, FWD * 1.15, k);
          p.lean = 0.45 * k;
          p.legL = -0.5 * k;
          p.legR = 0.5 * k;
        }
        break;
      case 'up':
      case 'uair':
        p.armR = lerp(0, UP, k);
        p.armL = lerp(0, UP * 0.6, k);
        p.lean = -0.15 * k;
        break;
      case 'down':
        p.legR = lerp(0, FWD * 0.9, k);
        p.squash = 0.85;
        p.lean = -0.1;
        break;
      case 'nair':
        p.spinY = k * Math.PI * 2 * (f / (s + a));
        p.armL = FWD;
        p.armR = FWD;
        p.armLz = 1.2;
        p.armRz = -1.2;
        p.legL = -0.5;
        p.legR = 0.5;
        break;
      case 'bair':
        p.legR = lerp(0, 1.5, k);
        p.legL = -0.3;
        p.lean = 0.4 * k;
        break;
      case 'dair':
        p.legL = lerp(-0.5, 0, k);
        p.legR = lerp(-0.5, 0, k);
        p.armL = UP * 0.6;
        p.armR = UP * 0.6;
        p.squash = lerp(0.9, 1.1, k);
        break;
      case 'grab':
        p.armR = lerp(0, FWD, k);
        p.armL = lerp(0, FWD, k);
        p.lean = 0.2 * k;
        break;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
    for (const m of this.glowMats) m.dispose();
    this.outlineMat.dispose();
  }
}
