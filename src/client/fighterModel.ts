// 3頭身のキャラクター（基本図形の組み合わせ）と、状態に合わせた手続き的なアニメーション。
// アニメ調に見えるよう、陰影を段階的にする塗り（トゥーン）と輪郭線を付けている。
// 色は衣装（costumes.ts）から受け取るので、着せ替えにも対応できる。

import * as THREE from 'three';
import { threebDef, type CharacterDef } from '../shared/characters';
import type { Accessory, Costume, CostumeFx } from '../shared/costumes';
import { moveOf } from '../shared/moves';
import { FX_ARMOR, FX_BIKE, FX_CHARGED, FX_POWER, FX_SPEED, fxJob, type ViewFighter } from '../shared/types';

const FWD = -Math.PI / 2; // 腕・脚を前に向ける回転（x軸まわり）
const UP = -Math.PI;
/** スマホを持つ角度（胸の前で持ったとき、画面が顔を向く） */
const PHONE_TILT = -0.35;

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

/** ばねでなめらかに動かす値（回転のスピンは除く） */
const SPRING_KEYS = ['armL', 'armR', 'armLz', 'armRz', 'legL', 'legR', 'lean', 'squash', 'bob', 'headTilt'] as const;

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

/**
 * 材質の色をキャラの明るさの上限で抑える。
 * band = true のときは、髪のつやの帯（天使の輪）を足す（カメラから見た法線の向きで決めるので、動くと帯も動く）
 */
function capBrightness(m: THREE.Material, key: string, band = false): void {
  const sheen = band
    ? `{ vec3 nn = normalize(vNormal); float b = smoothstep(0.42, 0.52, nn.y) * (1.0 - smoothstep(0.62, 0.72, nn.y)); gl_FragColor.rgb += b * 0.16; }\n`
    : '';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>\n${sheen} gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${CHAR_MAX}));`,
    );
  };
  m.customProgramCacheKey = () => key;
}

// ---------------------------------------------------------------- 目（絵を描いた画像を顔の丸みに沿って貼る）
type EyeKind = 'normal' | 'angry' | 'closed' | 'happy' | 'hurt' | 'panic' | 'smug' | 'tired' | 'look' | 'lookTired';
const eyeTextures = new Map<string, THREE.CanvasTexture>();

/** アニメ調の目を描く。side = 1 は画面の右側に見える目（外側の目じりが右） */
function eyeTexture(kind: EyeKind, iris: number, side: 1 | -1, sparkle: boolean, sharp = false): THREE.CanvasTexture {
  const key = `${kind}-${iris}-${side}-${sparkle}-${sharp}`;
  const hit = eyeTextures.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const ink = '#1d1d2b';
  const col = new THREE.Color(iris);
  const css = (k: number, mix = 0) => {
    const r = Math.round((col.r * k + mix) * 255);
    const gg = Math.round((col.g * k + mix) * 255);
    const b = Math.round((col.b * k + mix) * 255);
    return `rgb(${Math.min(255, r)},${Math.min(255, gg)},${Math.min(255, b)})`;
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const outer = side === 1 ? 1 : -1; // 外側の目じりの向き（画像の右=+1）
  const lash = (y1: number, y2: number, w = 9) => {
    // 上まつげ：内側(y1)から外側(y2)へ、少し反った太い線と、目じりのはね
    const xi = 64 - outer * 34;
    const xo = 64 + outer * 34;
    g.strokeStyle = ink;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(xi, y1);
    g.quadraticCurveTo(64, Math.min(y1, y2) - 10, xo, y2);
    g.lineTo(xo + outer * 8, y2 - 6);
    g.stroke();
  };
  const drawOpenEye = (irisRx: number, irisRy: number, pupil: number, dy = 0) => {
    // 白目
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(64, 72, 30, 40, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.beginPath();
    g.ellipse(64, 72, 30, 40, 0, 0, Math.PI * 2);
    g.clip();
    // 瞳：上が濃く、下が明るいグラデーション
    const grad = g.createLinearGradient(0, 72 - irisRy, 0, 76 + irisRy);
    grad.addColorStop(0, css(0.35));
    grad.addColorStop(0.45, css(1));
    grad.addColorStop(1, css(0.75, 0.3));
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(64 - outer * 2, 76 + dy, irisRx, irisRy, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = ink;
    g.beginPath();
    g.ellipse(64 - outer * 2, 78 + dy, pupil * 0.7, pupil, 0, 0, Math.PI * 2);
    g.fill();
    // ハイライト
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(64 - outer * 12, 60 + dy, Math.max(4, irisRx * 0.38), 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(64 + outer * 9, 96, Math.max(2, irisRx * 0.16), 0, Math.PI * 2);
    g.fill();
    if (sparkle) {
      g.fillStyle = '#fff6a0';
      g.beginPath();
      g.arc(64 + outer * 10, 70, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // 下まつげ（短く細い）
    g.strokeStyle = ink;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(64 + outer * 10, 111);
    g.quadraticCurveTo(64 + outer * 24, 108, 64 + outer * 30, 98);
    g.stroke();
  };
  /** 上の部分を消して、まぶたの線を引く（怒り・眠そう・ドヤ顔） */
  const lid = (yInner: number, yOuter: number) => {
    const xi = 64 - outer * 40;
    const xo = 64 + outer * 40;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(xi, 0);
    g.lineTo(xo, 0);
    g.lineTo(xo, yOuter);
    g.lineTo(xi, yInner);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = ink;
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(64 - outer * 32, yInner + (yOuter - yInner) * 0.1);
    g.lineTo(64 + outer * 34, yInner + (yOuter - yInner) * 0.92);
    g.stroke();
  };
  /** 下まぶたも少し上げて、目を細くする */
  const narrowBottom = (y: number) => {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, y, 128, 128 - y);
    g.restore();
    g.strokeStyle = ink;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(64 - outer * 14, y);
    g.lineTo(64 + outer * 26, y - 2);
    g.stroke();
  };
  g.strokeStyle = ink;
  // キリッとした目（警備員）：瞳を少し小さく、上まぶたを内側へ下げ、下まぶたも上げる
  if (sharp && (kind === 'normal' || kind === 'look' || kind === 'tired' || kind === 'lookTired')) {
    const look = kind === 'look' || kind === 'lookTired';
    drawOpenEye(21, 30, 13, look ? 10 : 2);
    lid(kind === 'tired' || kind === 'lookTired' ? 66 : 58, kind === 'tired' || kind === 'lookTired' ? 58 : 42);
    narrowBottom(104);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    eyeTextures.set(key, t);
    return t;
  }
  switch (kind) {
    case 'normal':
      drawOpenEye(24, 34, 15);
      lash(40, 36);
      break;
    case 'angry':
      drawOpenEye(24, 34, 15);
      lid(66, 44);
      break;
    case 'tired':
      drawOpenEye(24, 34, 15);
      lid(64, 62);
      break;
    case 'smug':
      drawOpenEye(24, 34, 15);
      lid(62, 56);
      // 下まぶたも少し上げる
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(0, 104, 128, 24);
      g.restore();
      break;
    case 'look':
      // 下（手元のスマホ）を見ている：瞳を下げて、まぶたを少し下ろす
      drawOpenEye(24, 32, 14, 12);
      lid(54, 50);
      break;
    case 'lookTired':
      drawOpenEye(24, 32, 14, 12);
      lid(66, 64);
      break;
    case 'panic':
      drawOpenEye(13, 18, 7);
      lash(38, 36, 7);
      break;
    case 'closed':
      g.lineWidth = 9;
      g.beginPath();
      g.arc(64, 54, 32, 0.18 * Math.PI, 0.82 * Math.PI);
      g.stroke();
      break;
    case 'happy':
      g.lineWidth = 9;
      g.beginPath();
      g.arc(64, 100, 32, 1.18 * Math.PI, 1.82 * Math.PI);
      g.stroke();
      break;
    case 'hurt': {
      // 「><」：とがった先が内側
      const xi = 64 - outer * 26;
      const xo = 64 + outer * 26;
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(xo, 46);
      g.lineTo(xi, 74);
      g.lineTo(xo, 102);
      g.stroke();
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  eyeTextures.set(key, t);
  return t;
}

/** 頭のてっぺんの高さ（帽子・髪の上。王冠や天使の輪を置く位置） */
const HEAD_TOP: Record<string, number> = { guard: 0.67, hacker: 0.7, thief: 0.67, streamer: 0.66, dopa: 0.72, gacha: 0.66, courier: 0.66, ai: 0.64, trainer: 0.68, threeb: 0.68 };

/** SSR の粒の絵 */
const fxTextures = new Map<string, THREE.Texture>();
export function fxTexture(kind: string): THREE.Texture {
  const hit = fxTextures.get(kind);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  const glyph = (t: string, size: number) => {
    g.font = `900 ${size}px "Hiragino Sans","Noto Sans JP",sans-serif`;
    g.fillText(t, 32, 32 + size * 0.36);
  };
  switch (kind) {
    case 'sparkle':
      g.beginPath();
      g.moveTo(32, 2);
      g.quadraticCurveTo(36, 28, 62, 32);
      g.quadraticCurveTo(36, 36, 32, 62);
      g.quadraticCurveTo(28, 36, 2, 32);
      g.quadraticCurveTo(28, 28, 32, 2);
      g.fill();
      break;
    case 'medal': {
      // ゲームセンターのメダル（ふちのある円に、星のくりぬき）
      g.beginPath();
      g.arc(32, 32, 27, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(32, 32, 20, 0, Math.PI * 2);
      g.stroke();
      g.font = `900 26px sans-serif`;
      g.fillText('★', 32, 41);
      break;
    }
    case 'qubit':
      // 量子ビットの球（円と、横の楕円と、上向きの矢印）
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(32, 32, 25, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(32, 32, 25, 8, 0, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(32, 32);
      g.lineTo(42, 12);
      g.stroke();
      g.beginPath();
      g.arc(42, 12, 5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'gear': {
      // 歯車（歯のある円に、まんなかの穴）
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = i % 2 ? 22 : 29;
        g.lineTo(32 + Math.cos(a - 0.12) * r, 32 + Math.sin(a - 0.12) * r);
        g.lineTo(32 + Math.cos(a + 0.12) * r, 32 + Math.sin(a + 0.12) * r);
      }
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(32, 32, 9, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'zzz':
      // ねむけの「Z」（大小2つ）
      g.font = `900 34px sans-serif`;
      g.fillText('Z', 24, 50);
      g.font = `900 22px sans-serif`;
      g.fillText('z', 48, 24);
      break;
    case 'pixel':
      // ドット絵の四角（角を少し欠いたブロック）
      g.fillRect(14, 8, 36, 48);
      g.fillRect(8, 14, 48, 36);
      g.clearRect(26, 20, 12, 12);
      break;
    case 'data':
      g.font = `bold 40px monospace`;
      g.fillText(Math.random() < 0.5 ? '01' : '10', 32, 46);
      break;
    case 'petal':
      g.beginPath();
      g.ellipse(32, 32, 14, 26, 0.6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'heart':
      glyph('♥', 56);
      break;
    case 'star':
      glyph('★', 56);
      break;
    case 'coin': {
      g.beginPath();
      g.arc(32, 32, 26, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.font = `900 30px sans-serif`;
      g.fillText('¥', 32, 43);
      break;
    }
    case 'flame': {
      const r = g.createRadialGradient(32, 40, 2, 32, 36, 28);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.beginPath();
      g.moveTo(32, 4);
      g.quadraticCurveTo(56, 40, 32, 60);
      g.quadraticCurveTo(8, 40, 32, 4);
      g.fill();
      break;
    }
    case 'ring': {
      const r = g.createRadialGradient(32, 32, 10, 32, 32, 32);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.6, 'rgba(255,255,255,1)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
      break;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  fxTextures.set(kind, t);
  return t;
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
  trainer: 0x6a3a1a,
  threeb: 0x8a4ad0,
};

/** 体の横幅（警備員とトレーナーはがっしり、データ泥棒は細身） */
function bodyWidth(id: string): number {
  return id === 'guard' ? 1.22 : id === 'trainer' ? 1.2 : id === 'thief' ? 0.95 : 1;
}

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
  /** 目（顔に貼った絵）。表情に合わせて絵を切り替える */
  private eyePatches: { mat: THREE.MeshBasicMaterial; side: 1 | -1 }[] = [];
  private eyeKind: EyeKind | '' = '';
  /** キラキラの目（ドパガキ） */
  private sparkle = false;
  /** キリッとした目（警備員） */
  private sharpEyes = false;
  /** 焦ったときの汗 */
  private sweat: THREE.Group | null = null;
  /** 揺れもの（髪・ひも・バッグなど）：体の動きに少し遅れてついてくる */
  private swings: { g: THREE.Group; amt: number; ang: number; vel: number; phase: number }[] = [];
  private prevX = 0;
  private prevY = 0;
  private prevVx = 0;
  private prevVy = 0;
  private prevLean = 0;
  /** なめらかに動かすための、今のポーズと変化の速さ */
  private cur: Pose | null = null;
  private vel: Partial<Record<keyof Pose, number>> = {};
  private prevSpin = { spinY: 0, spinZ: 0 };
  /** 攻撃のときだけ持つ道具（警棒・ホログラムの剣・ガチャのカプセル） */
  private attackProps: { obj: THREE.Object3D; moves: string[]; job?: number }[] = [];
  /** 3B：仕事ごとの見た目（髪・服・小物）。今の仕事のものだけ表示する */
  private jobParts: THREE.Object3D[][] = [[], [], []];
  private job = 0;
  /** 3B：背中のギター（手に持っている間は隠す） */
  private backGuitar: THREE.Object3D | null = null;
  /** キャラ選択画面で見せる仕事（タップで切り替える。null なら試合の状態に合わせる） */
  previewJob: number | null = null;
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
  /** AIアシスタントがドローンとして出かけている間は隠す */
  buddyAway = false;
  /** キャラ選択画面：この角度でカメラの方を向かせる（null なら通常） */
  previewTurn: number | null = null;
  /** 分身として半透明で表示するとき（0 = 通常） */
  ghost = 0;
  /** 頭上の目印を出すか（残像では出さない） */
  showMarker = true;
  /** 衣装一覧などで、SSR衣装の特別な待機モーションにする */
  fancyIdle = false;
  /** ガチャ・衣装一覧：3B の仕事を一定時間ごとに切り替えて見せる */
  cycleJobs = false;
  /** タップしたときのアクションの残り時間（秒） */
  private actionT = 0;
  private actionKind = 0;

  /** タップされたときのアクション（決めポーズで跳ねる） */
  playAction(): void {
    // 3B はタップするたびに着替える
    if (this.def.id === 'threeb') this.previewJob = ((this.previewJob ?? 0) + 1) % 3;
    this.actionT = 1.4;
    this.actionKind = (this.actionKind + 1) % 2;
  }
  private c: Costume['colors'];
  private blinkSeed: number;

  constructor(
    private def: CharacterDef,
    private costume: Costume,
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
    this.buildAttackProps(def.id);
    this.buildExtras(costume);
    if (costume.fx) this.buildFx(costume.fx, costume.rarity >= 6);

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
    const wide = bodyWidth(this.def.id);
    // トレーナーは袖なし（腕が太く、肌が見える）
    const bare = this.def.id === 'trainer';
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
      if (bare) {
        // 太い腕・力こぶ・肩・リストバンド
        this.part(g, new THREE.CapsuleGeometry(0.082, 0.26, 4, 10), this.toon(c.skin), [0, -0.19, 0]);
        this.part(g, new THREE.SphereGeometry(0.098, 12, 10), this.toon(c.skin), [0, -0.13, 0.025], { scale: [1, 1.2, 1] });
        this.part(g, new THREE.SphereGeometry(0.11, 12, 10), this.toon(c.skin), [0, -0.01, 0], { outline: false });
        this.part(g, new THREE.TorusGeometry(0.084, 0.03, 6, 14), this.toon(c.accent), [0, -0.33, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
        this.part(g, new THREE.SphereGeometry(0.096, 12, 10), this.toon(c.skin), [0, -0.42, 0]);
      } else {
        this.part(g, new THREE.CapsuleGeometry(0.068, 0.26, 4, 10), this.toon(c.main), [0, -0.19, 0]);
        // 袖口
        this.part(g, new THREE.TorusGeometry(0.066, 0.022, 6, 14), this.toon(c.sub), [0, -0.33, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
        this.part(g, new THREE.SphereGeometry(0.086, 12, 10), this.toon(c.skin), [0, -0.41, 0]);
      }
      this.body.add(g);
    }
    // 頭（首の付け根を中心に回す）
    this.head.position.y = 1.2;
    this.body.add(this.head);
    this.part(this.head, new THREE.SphereGeometry(0.31, 26, 20), this.toon(c.skin), [0, 0.29, 0], { scale: [1, 0.95, 0.95] });
    // 目：絵を描いた画像を、顔の丸みに沿った曲面に貼る（表情は絵を切り替える）
    const iris = EYE_COLORS[this.def.id] ?? 0x3a5aa0;
    for (const x of [0.11, -0.11]) {
      // 顔の球（半径0.31、縦と奥行きを0.95倍）の中心から見た、目の方向
      const ey = -0.02 / 0.95;
      const ez = 0.27 / 0.95;
      const phi = Math.atan2(ez, -x);
      const theta = Math.acos(ey / Math.hypot(x, ey, ez));
      const side: 1 | -1 = x > 0 ? 1 : -1;
      const mat = new THREE.MeshBasicMaterial({ map: eyeTexture('normal', iris, side, false), transparent: true, depthWrite: false });
      capBrightness(mat, 'eye-cap');
      const geo = new THREE.SphereGeometry(0.313, 10, 10, phi - 0.33, 0.66, theta - 0.37, 0.74);
      const patch = new THREE.Mesh(geo, mat);
      patch.position.set(0, 0.29, 0);
      patch.scale.set(1, 0.95, 0.95);
      patch.renderOrder = 2;
      this.head.add(patch);
      this.eyePatches.push({ mat, side });
    }
    // 焦ったときの汗（ふだんは隠す）
    const sweat = new THREE.Group();
    const drop = this.glow(0x9fdcff);
    this.part(sweat, new THREE.SphereGeometry(0.035, 10, 8), drop, [0, 0, 0], { outline: false });
    this.part(sweat, new THREE.ConeGeometry(0.03, 0.06, 10), drop, [0, 0.04, 0], { outline: false });
    sweat.position.set(-0.27, 0.42, 0.14);
    sweat.visible = false;
    this.head.add(sweat);
    this.sweat = sweat;
  }

  private hairToon(color: number): THREE.MeshToonMaterial {
    const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    capBrightness(m, 'toon-hair', true);
    this.mats.push(m);
    return m;
  }

  /** 揺れものの付け根を作る（中の部品は付け根からの位置で置く） */
  private swingPivot(parent: THREE.Object3D, pos: [number, number, number], amt: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(...pos);
    parent.add(g);
    this.swings.push({ g, amt, ang: 0, vel: 0, phase: Math.random() * 6 });
    return g;
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

  private brows(angle: number, color: number, thick = 0.022, y = 0.37): void {
    for (const x of [0.11, -0.11]) {
      const side = x > 0 ? -1 : 1;
      const mesh = this.part(this.head, new THREE.BoxGeometry(0.11, thick, 0.02), this.toon(color), [x, y, 0.28], { rot: [0, 0, side * angle], outline: false });
      this.browMeshes.push({ mesh, base: side * angle, side });
    }
  }

  /** 表情を切り替える */
  private setExpression(kind: 'normal' | 'angry' | 'hurt' | 'closed' | 'happy' | 'panic' | 'smug' | 'look', mouth: 'line' | 'open' | 'smile', tired: boolean): void {
    const eye: EyeKind = kind === 'normal' && tired ? 'tired' : kind === 'look' && tired ? 'lookTired' : kind;
    if (eye !== this.eyeKind) {
      this.eyeKind = eye;
      const iris = EYE_COLORS[this.def.id] ?? 0x3a5aa0;
      for (const p of this.eyePatches) p.mat.map = eyeTexture(eye, iris, p.side, this.sparkle, this.sharpEyes);
    }
    if (this.sweat) this.sweat.visible = kind === 'panic';
    const browAdd = kind === 'angry' ? 0.3 : kind === 'hurt' || kind === 'panic' ? -0.25 : kind === 'smug' ? 0.12 : 0;
    for (const b of this.browMeshes) b.mesh.rotation.z = b.base + b.side * browAdd;
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
      // キリッとした太い眉（内側が下がる）と目
      this.brows(-0.3, c.hair, 0.034, 0.36);
      this.sharpEyes = true;
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
        this.part(h, new THREE.ConeGeometry(0.06, 0.16, 6), this.hairToon(c.hair), [x, 0.43, 0.24], { rot: [1.9, 0, r], outline: false });
      }
      const glass = this.glow(c.accent);
      for (const x of [0.11, -0.11]) this.part(h, new THREE.BoxGeometry(0.13, 0.08, 0.02), glass, [x, 0.27, 0.31], { outline: false });
      this.part(h, new THREE.BoxGeometry(0.06, 0.015, 0.015), glass, [0, 0.29, 0.31], { outline: false });
      // パーカーのひも・ポケット・ファスナー
      for (const x of [0.06, -0.06]) {
        const sw = this.swingPivot(this.body, [x, 1.14, 0.17], 1);
        this.part(sw, new THREE.CylinderGeometry(0.008, 0.008, 0.18, 6), this.toon(0xeeeeee), [0, -0.09, 0], { outline: false });
      }
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
      // ニット帽のぼんぼり（揺れる）
      const pom = this.swingPivot(h, [0, 0.66, -0.02], 1.3);
      this.part(pom, new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6), beanie, [0, 0.025, 0], { outline: false });
      this.part(pom, new THREE.SphereGeometry(0.07, 12, 10), this.toon(c.main), [0, 0.08, 0]);
      for (const [x, z, r] of [
        [0.26, -0.1, -1.0],
        [-0.26, -0.1, 1.0],
        [0.1, -0.27, -0.4],
      ]) {
        this.part(h, new THREE.ConeGeometry(0.05, 0.18, 6), this.hairToon(c.hair), [x, 0.3, z], { rot: [-0.5, 0, r], outline: false });
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
      const hair = this.hairToon(c.hair);
      // 髪は後ろに傾けてかぶせ、顔（目）にかからないようにする
      this.part(h, new THREE.SphereGeometry(0.34, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 0.31, -0.03], { rot: [-0.55, 0, 0] });
      for (const [x, col] of [
        [0.26, c.hair],
        [-0.26, c.accent],
      ] as const) {
        const sw = this.swingPivot(h, [x, 0.3, 0.05], 0.8);
        this.part(sw, new THREE.CapsuleGeometry(0.075, 0.2, 4, 8), col === c.hair ? hair : this.toon(col), [0, -0.13, 0]);
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
      for (const x of [0.05, -0.05]) {
        const sw = this.swingPivot(this.body, [x, 1.12, 0.17], 1);
        this.part(sw, new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), this.toon(c.accent), [0, -0.08, 0], { outline: false });
      }
      // 自撮り棒とスマホ（右手）
      const stick = this.hand(this.armR);
      // 手から上へ伸ばし、先のスマホを自分に向ける
      this.part(stick, new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), this.toon(0x444455), [0, 0.27, 0.1], { rot: [-0.35, 0, 0], outline: false });
      this.part(stick, new THREE.BoxGeometry(0.11, 0.19, 0.02), this.toon(0x222233), [0, 0.58, 0.21], { rot: [-0.35, 0, 0] });
      this.part(stick, new THREE.BoxGeometry(0.095, 0.17, 0.005), this.glow(c.accent), [0, 0.58, 0.195], { rot: [-0.35, 0, 0], outline: false });
    }
  }

  // ---------------------------------------------------------------- 衣装の小物
  private buildExtras(costume: Costume): void {
    const list = costume.extras ?? [];
    if (!list.length) return;
    const col = costume.extraColor ?? this.c.accent;
    const top = HEAD_TOP[this.def.id] ?? 0.66;
    const h = this.head;
    const b = this.body;
    const wide = bodyWidth(this.def.id);
    const gold = this.toon(col);
    for (const a of list as Accessory[]) {
      switch (a) {
        case 'sunglasses': {
          const glass = this.toon(0x121218);
          for (const x of [0.11, -0.11]) this.part(h, new THREE.BoxGeometry(0.14, 0.08, 0.025), glass, [x, 0.275, 0.305], { outline: false });
          this.part(h, new THREE.BoxGeometry(0.08, 0.018, 0.02), glass, [0, 0.29, 0.31], { outline: false });
          for (const x of [0.2, -0.2]) this.part(h, new THREE.BoxGeometry(0.02, 0.018, 0.2), glass, [x, 0.29, 0.2], { rot: [0, x > 0 ? 0.5 : -0.5, 0], outline: false });
          // レンズの反射
          for (const x of [0.13, -0.09]) this.part(h, new THREE.BoxGeometry(0.03, 0.012, 0.005), this.glow(0xffffff), [x, 0.3, 0.32], { rot: [0, 0, -0.5], outline: false });
          this.hideEyes = true;
          break;
        }
        case 'sash':
          this.part(b, new THREE.BoxGeometry(0.075, 0.56, 0.02), gold, [0, 0.92, 0.175], { rot: [0, 0, 0.75], outline: false });
          break;
        case 'cape': {
          const sw = this.swingPivot(b, [0, 1.16, -0.17], 0.45);
          const geo = new THREE.CylinderGeometry(0.22 * wide, 0.36 * wide, 0.8, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8);
          const mat = this.toon(col);
          mat.side = THREE.DoubleSide;
          this.part(sw, geo, mat, [0, -0.4, 0.08], { outline: false });
          break;
        }
        case 'crown': {
          const g = new THREE.Group();
          g.position.set(0, top - 0.02, 0.02);
          g.rotation.z = -0.12;
          h.add(g);
          const ring = this.toon(col);
          ring.side = THREE.DoubleSide;
          this.part(g, new THREE.CylinderGeometry(0.13, 0.12, 0.07, 16, 1, true), ring, [0, 0.035, 0]);
          for (let k = 0; k < 5; k++) {
            const ang = (k / 5) * Math.PI * 2;
            this.part(g, new THREE.ConeGeometry(0.03, 0.08, 5), ring, [Math.cos(ang) * 0.12, 0.1, Math.sin(ang) * 0.12], { outline: false });
          }
          this.part(g, new THREE.SphereGeometry(0.025, 8, 6), this.glow(0xff3a5a), [0, 0.04, 0.125], { outline: false });
          break;
        }
        case 'headphones': {
          const hp = this.toon(col);
          this.part(h, new THREE.TorusGeometry(0.34, 0.03, 8, 24, Math.PI), hp, [0, 0.3, 0]);
          for (const x of [0.34, -0.34]) {
            this.part(h, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18), hp, [x, 0.27, 0], { rot: [0, 0, Math.PI / 2] });
            this.part(h, new THREE.CylinderGeometry(0.06, 0.06, 0.085, 14), this.glow(this.c.accent), [x * 1.02, 0.27, 0], { rot: [0, 0, Math.PI / 2], outline: false });
          }
          break;
        }
        case 'catEars':
          for (const x of [0.17, -0.17]) {
            this.part(h, new THREE.ConeGeometry(0.09, 0.17, 4), this.toon(col), [x, top - 0.02, 0.02], { rot: [0, Math.PI / 4, x > 0 ? -0.35 : 0.35] });
            this.part(h, new THREE.ConeGeometry(0.05, 0.1, 4), this.toon(0xffd6e8), [x * 0.98, top - 0.03, 0.06], { rot: [0, Math.PI / 4, x > 0 ? -0.35 : 0.35], outline: false });
          }
          break;
        case 'halo': {
          const ringG = new THREE.Group();
          ringG.position.set(0, top + 0.14, 0);
          h.add(ringG);
          this.part(ringG, new THREE.TorusGeometry(0.2, 0.022, 8, 32), this.glow(col), [0, 0, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
          this.halos.push(ringG);
          break;
        }
        case 'scarf': {
          this.part(b, new THREE.TorusGeometry(0.16, 0.06, 8, 20), this.toon(col), [0, 1.17, 0], { rot: [Math.PI / 2, 0, 0] });
          const sw = this.swingPivot(b, [0.1, 1.13, -0.12], 1.0);
          this.part(sw, new THREE.BoxGeometry(0.1, 0.36, 0.035), this.toon(col), [0, -0.17, -0.03], { rot: [0.3, 0, 0.1] });
          break;
        }
        // ---------------- UR の豪華な小物
        case 'hexShield': {
          // まわりを回る、六角形の光の盾（3枚）
          const g = new THREE.Group();
          g.position.y = 0.95;
          b.add(g);
          const mat = this.glow(col);
          mat.transparent = true;
          mat.opacity = 0.75;
          mat.side = THREE.DoubleSide;
          for (let k = 0; k < 3; k++) {
            // 盾の面が外を向くように、円柱の軸を半径の向き（X）に倒す
            const pv = new THREE.Group();
            pv.rotation.y = (k / 3) * Math.PI * 2;
            g.add(pv);
            this.part(pv, new THREE.CylinderGeometry(0.2, 0.2, 0.02, 6), mat, [0.72, 0, 0], { rot: [0, 0, Math.PI / 2], outline: false });
            this.part(pv, new THREE.TorusGeometry(0.2, 0.018, 4, 6), this.glow(0xffffff), [0.73, 0, 0], { rot: [0, Math.PI / 2, 0], outline: false });
          }
          this.spinners.push({ g, speed: 1.1 });
          break;
        }
        case 'starRing': {
          // 頭の上を回る星の輪（5つ）
          const g = new THREE.Group();
          g.position.set(0, top + 0.18, 0);
          h.add(g);
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2;
            const st = new THREE.Group();
            st.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
            g.add(st);
            for (const r of [0, Math.PI / 5]) this.part(st, new THREE.ConeGeometry(0.07, 0.03, 5), this.glow(k % 2 ? col : 0xffffff), [0, 0, 0], { rot: [Math.PI / 2, 0, r], outline: false });
          }
          this.spinners.push({ g, speed: 1.6 });
          break;
        }
        case 'playBadge': {
          // 背中に浮かぶ、大きな再生ボタンの盾
          const g = new THREE.Group();
          g.position.set(0, 1.25, -0.42);
          b.add(g);
          this.part(g, new THREE.BoxGeometry(0.62, 0.46, 0.05), this.toon(col), [0, 0, 0]);
          this.part(g, new THREE.BoxGeometry(0.54, 0.38, 0.052), this.glow(0xfff6c9), [0, 0, 0.002], { outline: false });
          const tri = new THREE.Shape();
          tri.moveTo(-0.08, -0.11);
          tri.lineTo(0.13, 0);
          tri.lineTo(-0.08, 0.11);
          tri.closePath();
          this.part(g, new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false }), this.toon(0xe5304a), [0, 0, -0.05], { rot: [0, Math.PI, 0], outline: false });
          this.floaters.push({ g, base: g.position.y });
          break;
        }
        case 'capsuleOrbit': {
          // まわりを回るガチャのカプセル（4つ、色ちがい）
          const g = new THREE.Group();
          g.position.y = 1.0;
          b.add(g);
          const tops = [0xe5484d, 0x3d8bff, 0xffd23f, 0x4fd18b];
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2;
            const cg = new THREE.Group();
            cg.position.set(Math.cos(a) * 0.7, Math.sin(a * 2) * 0.12, Math.sin(a) * 0.7);
            g.add(cg);
            this.part(cg, new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.toon(tops[k]), [0, 0, 0]);
            this.part(cg, new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.toon(0xf2f2f5), [0, 0, 0]);
          }
          this.spinners.push({ g, speed: 1.3 });
          break;
        }
        case 'orbitRings': {
          // 体のまわりを回る光の輪（斜めに2本）
          for (const [tilt, sp] of [
            [0.5, 1.4],
            [-0.6, -1.1],
          ]) {
            const g = new THREE.Group();
            g.position.y = 0.95;
            g.rotation.z = tilt;
            b.add(g);
            this.part(g, new THREE.TorusGeometry(0.72, 0.015, 6, 48), this.glow(col), [0, 0, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
            this.part(g, new THREE.SphereGeometry(0.05, 8, 6), this.glow(0xffffff), [0.72, 0, 0], { outline: false });
            this.spinners.push({ g, speed: sp });
          }
          break;
        }
        case 'royalCape': {
          // 金のふち取りの、長い王様のマント
          const sw = this.swingPivot(b, [0, 1.18, -0.17], 0.4);
          const mat = this.toon(0x7a1020);
          mat.side = THREE.DoubleSide;
          this.part(sw, new THREE.CylinderGeometry(0.24 * wide, 0.46 * wide, 1.05, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), mat, [0, -0.52, 0.08], { outline: false });
          const trim = this.toon(col);
          trim.side = THREE.DoubleSide;
          this.part(sw, new THREE.CylinderGeometry(0.465 * wide, 0.47 * wide, 0.07, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), trim, [0, -1.03, 0.08], { outline: false });
          this.part(b, new THREE.TorusGeometry(0.17, 0.045, 6, 18), trim, [0, 1.17, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
          break;
        }
        case 'miniDrones': {
          // 肩のそばに浮かぶ小さなドローン2機（緑のライト）
          for (const sd of [1, -1]) {
            const g = new THREE.Group();
            g.position.set(sd * 0.55, 1.55, -0.2);
            b.add(g);
            this.part(g, new THREE.BoxGeometry(0.18, 0.06, 0.18), this.toon(0x1a2a3a), [0, 0, 0]);
            this.part(g, new THREE.SphereGeometry(0.035, 8, 6), this.glow(this.c.accent), [0, -0.04, 0.06], { outline: false });
            for (const [x, z] of [
              [0.1, 0.1],
              [-0.1, 0.1],
              [0.1, -0.1],
              [-0.1, -0.1],
            ]) {
              this.part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.01, 10), this.glow(0x9adfff), [x, 0.04, z], { outline: false });
            }
            this.floaters.push({ g, base: g.position.y });
          }
          break;
        }
        case 'micBoom': {
          // 左耳のカップから口元へのびるマイク（2本の棒を、点と点を結ぶ向きに置く）
          const arm = this.toon(0x22222c);
          const pts = [new THREE.Vector3(0.37, 0.24, 0.04), new THREE.Vector3(0.3, 0.1, 0.2), new THREE.Vector3(0.13, 0.08, 0.3)];
          for (let k = 0; k < 2; k++) {
            const d = pts[k + 1].clone().sub(pts[k]);
            const m = this.part(h, new THREE.CylinderGeometry(0.016, 0.016, d.length(), 6), arm, [0, 0, 0], { outline: false });
            m.position.copy(pts[k]).addScaledVector(d, 0.5);
            m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
          }
          this.part(h, new THREE.SphereGeometry(0.038, 10, 8), this.glow(col), [0.13, 0.08, 0.3], { outline: false });
          break;
        }
        case 'rgbKeys': {
          // 胸の光るキーボード柄（4列×3段。左から青→紫→ピンク）
          const keyCols = [0x5ab8ff, 0x7a8cff, 0xa070ff, 0xff5ec8];
          for (let r = 0; r < 3; r++) {
            for (let k = 0; k < 4; k++) {
              const x = (-1.5 + k + (r === 1 ? 0.25 : 0)) * 0.052 * wide;
              this.part(b, new THREE.BoxGeometry(0.038, 0.034, 0.012), this.glow(keyCols[(k + r) % 4]), [x, 0.9 - r * 0.048, 0.168], { outline: false });
            }
          }
          // スペースキー
          this.part(b, new THREE.BoxGeometry(0.12, 0.03, 0.012), this.glow(0x5ab8ff), [0, 0.9 - 3 * 0.048, 0.166], { outline: false });
          break;
        }
        case 'capFront': {
          // 前向きのキャップ（つばが前）
          const cap = this.toon(col);
          this.part(h, new THREE.SphereGeometry(0.335, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), cap, [0, 0.31, -0.01], { rot: [-0.15, 0, 0] });
          this.part(h, new THREE.BoxGeometry(0.3, 0.025, 0.22), cap, [0, 0.52, 0.38], { rot: [-0.12, 0, 0] });
          this.part(h, new THREE.SphereGeometry(0.035, 8, 6), this.toon(0xf3ead2), [0, 0.645, -0.04], { outline: false });
          break;
        }
        case 'jacketRib': {
          // えりとすその、しま模様のリブ（服の副色と差し色）
          for (const [y, r, rx] of [
            [1.17, 0.16, Math.PI / 2],
            [0.67, 0.225 * wide, Math.PI / 2],
          ] as const) {
            this.part(b, new THREE.TorusGeometry(r, 0.035, 6, 24), this.toon(this.c.sub), [0, y, 0], { rot: [rx, 0, 0], scale: [1, y > 1 ? 1 : 0.8, 1], outline: false });
            this.part(b, new THREE.TorusGeometry(r, 0.013, 4, 24), this.toon(col), [0, y + 0.02, 0], { rot: [rx, 0, 0], scale: [1.02, y > 1 ? 1.02 : 0.82, 1], outline: false });
          }
          break;
        }
        case 'medalPouch': {
          // 腰にさげたメダルの袋
          const bag = new THREE.Group();
          bag.position.set(0.25 * wide, 0.62, 0.06);
          b.add(bag);
          this.part(bag, new THREE.SphereGeometry(0.1, 12, 10), this.toon(0x8a5a2a), [0, 0, 0], { scale: [1, 1.1, 0.8] });
          this.part(bag, new THREE.TorusGeometry(0.05, 0.015, 6, 12), this.toon(0x5a3a1a), [0, 0.1, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
          for (const [x, y, z] of [
            [0, 0.12, 0],
            [0.035, 0.1, 0.03],
            [-0.03, 0.11, 0.02],
          ]) this.part(bag, new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12), this.glow(0xffd23f), [x, y, z], { rot: [0.5, 0, 0.3], outline: false });
          break;
        }
        case 'nightcap': {
          // 頭にかぶって、先が横にたれさがるナイトキャップ
          const cap = this.toon(col);
          this.part(h, new THREE.SphereGeometry(0.34, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), cap, [0, 0.32, -0.02], { rot: [-0.2, 0, 0] });
          this.part(h, new THREE.TorusGeometry(0.31, 0.04, 6, 28), this.toon(0xf2f2f5), [0, 0.42, -0.02], { rot: [Math.PI / 2 - 0.2, 0, 0], outline: false });
          const sw = this.swingPivot(h, [0, top - 0.02, -0.05], 0.7);
          this.part(sw, new THREE.ConeGeometry(0.17, 0.42, 14), cap, [-0.14, 0.04, -0.04], { rot: [0, 0, 1.25] });
          this.part(sw, new THREE.SphereGeometry(0.07, 10, 8), this.toon(0xf2f2f5), [-0.34, -0.03, -0.04]);
          break;
        }
        case 'eyeBags':
          // 目の下のクマ（うすい紫）
          for (const x of [0.12, -0.12]) this.part(h, new THREE.SphereGeometry(0.06, 10, 8), this.toon(0x9a82a8), [x, 0.17, 0.262], { scale: [1, 0.35, 0.3], outline: false });
          break;
        case 'pajama': {
          // パジャマのえり（左右）と、前のボタン
          const sub = this.toon(this.c.sub);
          for (const x of [0.06, -0.06]) this.part(b, new THREE.BoxGeometry(0.11, 0.08, 0.02), sub, [x, 1.12, 0.165], { rot: [0.25, 0, x > 0 ? 0.55 : -0.55], outline: false });
          for (let i = 0; i < 4; i++) this.part(b, new THREE.CylinderGeometry(0.018, 0.018, 0.01, 10), this.toon(col), [0, 1.02 - i * 0.1, 0.183 - Math.abs(i - 1.5) * 0.004], { rot: [Math.PI / 2, 0, 0], outline: false });
          // 胸ポケット
          this.part(b, new THREE.BoxGeometry(0.09, 0.08, 0.012), sub, [-0.1 * wide, 0.98, 0.17], { outline: false });
          break;
        }
        case 'phone2': {
          // 左手にもう1台のスマホ（画面が光る）
          const hnd = this.hand(this.armL);
          this.part(hnd, new THREE.BoxGeometry(0.1, 0.17, 0.02), this.toon(0x1a1a22), [0, -0.08, 0.06], { rot: [0.3, 0, 0] });
          this.part(hnd, new THREE.BoxGeometry(0.085, 0.145, 0.004), this.glow(0x9cdcff), [0, -0.08, 0.072], { rot: [0.3, 0, 0], outline: false });
          break;
        }
        case 'glassHelmet': {
          // 頭をおおう透明なヘルメット（中の顔が見えるように、うすく）
          const glass = new THREE.MeshBasicMaterial({ color: 0xcfefff, transparent: true, opacity: 0.18, depthWrite: false });
          this.part(h, new THREE.SphereGeometry(0.47, 24, 18), glass, [0, 0.3, 0.02], { outline: false });
          // 光の反射
          this.part(h, new THREE.TorusGeometry(0.4, 0.012, 4, 16, 0.9), this.glow(0xffffff), [0, 0.32, 0.18], { rot: [0, 0, 2.0], outline: false });
          // 首の金のリング
          this.part(h, new THREE.TorusGeometry(0.17, 0.05, 8, 24), this.toon(col), [0, -0.1, 0.0], { rot: [Math.PI / 2, 0, 0] });
          break;
        }
        case 'goldPipes': {
          // 背中の冷却装置：金色の円盤が段になり、細い配管が下にのびる
          const gold = this.toon(col);
          const pack = new THREE.Group();
          pack.position.set(0, 0.95, -0.24);
          b.add(pack);
          for (let i = 0; i < 3; i++) {
            this.part(pack, new THREE.CylinderGeometry(0.17 - i * 0.03, 0.17 - i * 0.03, 0.035, 18), gold, [0, 0.16 - i * 0.14, 0], { outline: i === 0 });
          }
          for (const [x, z] of [
            [0.07, 0.04],
            [-0.07, 0.04],
            [0, -0.07],
          ]) this.part(pack, new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6), gold, [x, -0.02, z], { outline: false });
          this.part(pack, new THREE.SphereGeometry(0.04, 10, 8), this.glow(this.c.accent), [0, -0.25, 0], { outline: false });
          // 肩ごしにヘルメットへつながる配管
          for (const sd of [1, -1]) this.part(b, new THREE.TorusGeometry(0.17, 0.016, 6, 14, Math.PI * 0.7), gold, [sd * 0.17, 1.2, -0.12], { rot: [0, Math.PI / 2, sd > 0 ? 0.3 : 2.4], outline: false });
          break;
        }
        case 'haori': {
          // 前の開いた羽織（藍色）。丈はひざ上、そでは広め
          const ai = this.toon(0x24305a);
          ai.side = THREE.DoubleSide;
          this.part(b, new THREE.CylinderGeometry(0.235 * wide, 0.3 * wide, 0.68, 18, 1, true, 0.45, Math.PI * 2 - 0.9), ai, [0, 0.78, 0], { scale: [1, 1, 0.85] });
          // えり（前の2本の帯）
          const eri = this.toon(0x141a33);
          for (const x of [0.085, -0.085]) this.part(b, new THREE.BoxGeometry(0.05, 0.62, 0.02), eri, [x * wide, 0.8, 0.17], { rot: [0.05, 0, x > 0 ? -0.08 : 0.08], outline: false });
          // 羽織ひも（金のひもと房）
          this.part(b, new THREE.BoxGeometry(0.14, 0.022, 0.02), this.toon(col), [0, 0.98, 0.185], { outline: false });
          this.part(b, new THREE.SphereGeometry(0.035, 10, 8), this.toon(col), [0, 0.98, 0.195], { outline: false });
          this.part(b, new THREE.ConeGeometry(0.025, 0.07, 8), this.toon(col), [0, 0.93, 0.195], { rot: [Math.PI, 0, 0], outline: false });
          // 広いそで
          for (const arm of [this.armL, this.armR]) this.part(arm, new THREE.CylinderGeometry(0.1, 0.135, 0.3, 14), ai, [0, -0.17, 0]);
          break;
        }
        case 'triCrest': {
          // 背中の家紋：金の輪の中に、ハサミ・ギター・シェイカーを三角に並べる
          const g = new THREE.Group();
          g.position.set(0, 0.98, -0.218);
          g.rotation.y = Math.PI;
          g.scale.setScalar(1.35);
          b.add(g);
          const gold = this.glow(col);
          this.part(g, new THREE.TorusGeometry(0.12, 0.012, 6, 28), gold, [0, 0, 0], { outline: false });
          // ハサミ（上）
          for (const r of [0.4, -0.4]) this.part(g, new THREE.BoxGeometry(0.012, 0.075, 0.006), gold, [0, 0.055, 0], { rot: [0, 0, r], outline: false });
          // ギター（左下）
          this.part(g, new THREE.CircleGeometry(0.026, 12), gold, [-0.055, -0.05, 0], { outline: false });
          this.part(g, new THREE.BoxGeometry(0.01, 0.06, 0.006), gold, [-0.04, -0.015, 0], { rot: [0, 0, -0.5], outline: false });
          // シェイカー（右下）
          this.part(g, new THREE.CylinderGeometry(0.016, 0.022, 0.06, 8), gold, [0.055, -0.05, 0], { outline: false });
          this.part(g, new THREE.ConeGeometry(0.016, 0.025, 8), gold, [0.055, -0.008, 0], { outline: false });
          break;
        }
        case 'circuitCoat': {
          // 黒いロングコート（前が開く）に、虹色に光る回路の線と点
          const coat = this.toon(0x0c0e14);
          coat.side = THREE.DoubleSide;
          const R0 = 0.24 * wide;
          const R1 = 0.33 * wide;
          this.part(b, new THREE.CylinderGeometry(R0, R1, 0.82, 20, 1, true, 0.4, Math.PI * 2 - 0.8), coat, [0, 0.72, 0], { scale: [1, 1, 0.85] });
          // 高いえり
          this.part(b, new THREE.CylinderGeometry(0.19, 0.2, 0.12, 16, 1, true, 0.6, Math.PI * 2 - 1.2), coat, [0, 1.2, -0.01]);
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
          // 回路：縦の線と、横に曲がる短い線と、端の点（コートの表面にそって置く）
          const surf = (ang: number, y: number) => {
            const t = (1.13 - y) / 0.82;
            const r = (R0 + (R1 - R0) * t) * 1.02;
            return [Math.sin(ang) * r, y, Math.cos(ang) * r * 0.85] as [number, number, number];
          };
          const lines: [number, number, number][] = [
            // [角度, 上のy, 下のy]
            [0.7, 1.0, 0.45],
            [1.3, 0.9, 0.4],
            [2.2, 1.05, 0.5],
            [2.9, 0.95, 0.38],
            [-0.7, 1.0, 0.45],
            [-1.3, 0.85, 0.4],
            [-2.2, 1.05, 0.5],
            [-2.9, 0.95, 0.38],
          ];
          lines.forEach(([ang, y1, y2], i) => {
            const m = this.glow(rainbow[i % rainbow.length]);
            const mid = surf(ang, (y1 + y2) / 2);
            this.part(b, new THREE.BoxGeometry(0.014, y1 - y2, 0.01), m, mid, { rot: [0, ang, 0], outline: false });
            const end = surf(ang, y1);
            this.part(b, new THREE.SphereGeometry(0.022, 8, 6), m, end, { outline: false });
            // 横に曲がる線
            const side = surf(ang + 0.18, y2 + 0.12);
            this.part(b, new THREE.BoxGeometry(0.07, 0.012, 0.01), m, side, { rot: [0, ang, 0], outline: false });
          });
          break;
        }
        case 'monitorOrbit': {
          // まわりを回る6枚の半透明モニター（それぞれ違う色の画面。面は外向き）
          const g = new THREE.Group();
          g.position.y = 1.05;
          b.add(g);
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff, 0x39ff88];
          for (let k = 0; k < 6; k++) {
            const pv = new THREE.Group();
            pv.rotation.y = (k / 6) * Math.PI * 2;
            g.add(pv);
            const scr = new THREE.MeshBasicMaterial({ color: rainbow[k], transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
            capBrightness(scr, 'basic-cap');
            const y = (k % 2 ? 0.12 : -0.08);
            this.part(pv, new THREE.PlaneGeometry(0.3, 0.2), scr, [0, y, 0.9], { outline: false });
            // 画面のふちと、中の文字の行
            const fr = this.glow(rainbow[k]);
            for (const sy of [0.1, -0.1]) this.part(pv, new THREE.BoxGeometry(0.31, 0.012, 0.006), fr, [0, y + sy, 0.9], { outline: false });
            for (const sx of [0.15, -0.15]) this.part(pv, new THREE.BoxGeometry(0.012, 0.2, 0.006), fr, [sx, y, 0.9], { outline: false });
            for (let r = 0; r < 3; r++) this.part(pv, new THREE.PlaneGeometry(0.06 + ((k + r) % 3) * 0.05, 0.018), this.glow(0xffffff), [-0.1 + (0.06 + ((k + r) % 3) * 0.05) / 2, y + 0.05 - r * 0.045, 0.902], { outline: false });
          }
          this.spinners.push({ g, speed: 0.6 });
          break;
        }
        case 'rainbowTie': {
          // 白いシャツの胸元に、虹色のしまのネクタイ
          this.part(b, new THREE.BoxGeometry(0.13, 0.2, 0.012), this.toon(0xf4f4f8), [0, 1.04, 0.163], { outline: false });
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
          rainbow.forEach((cl, i) => this.part(b, new THREE.BoxGeometry(0.05 - i * 0.002, 0.05, 0.014), this.glow(cl), [0, 1.1 - i * 0.05, 0.168 + i * 0.002], { outline: false }));
          this.part(b, new THREE.ConeGeometry(0.026, 0.04, 4), this.glow(0xc77dff), [0, 0.85, 0.178], { rot: [0, Math.PI / 4, Math.PI], outline: false });
          break;
        }
        case 'dataSack': {
          // 背中に背負った、半透明に光る袋。中で0と1（小さな光る四角）がきらめく
          const g = new THREE.Group();
          g.position.set(0, 1.02, -0.32);
          b.add(g);
          const bag = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false });
          capBrightness(bag, 'basic-cap');
          this.part(g, new THREE.SphereGeometry(0.22, 18, 14), bag, [0, 0, 0], { scale: [1, 1.1, 0.8], outline: false });
          // 口をしばったところ
          this.part(g, new THREE.ConeGeometry(0.08, 0.12, 10), this.toon(0xd9a020), [0, 0.27, 0], { outline: false });
          this.part(g, new THREE.TorusGeometry(0.05, 0.015, 6, 12), this.toon(0x8a5a2a), [0, 0.23, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
          // 中の光（虹色の小さな四角）
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
          for (let i = 0; i < 9; i++) {
            const a = i * 2.4;
            this.part(g, new THREE.BoxGeometry(0.035, 0.05, 0.01), this.glow(rainbow[i % 5]), [Math.cos(a) * 0.12 * ((i % 3) / 3 + 0.3), -0.1 + (i / 9) * 0.22, Math.sin(a) * 0.08], { rot: [0, a, 0], outline: false });
          }
          this.floaters.push({ g, base: g.position.y });
          break;
        }
        case 'fileOrbit': {
          // まわりを回るファイルのアイコン（白い紙の角が折れていて、色つきの帯）
          const g = new THREE.Group();
          g.position.y = 1.0;
          b.add(g);
          const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff];
          for (let k = 0; k < 5; k++) {
            const pv = new THREE.Group();
            pv.rotation.y = (k / 5) * Math.PI * 2;
            g.add(pv);
            const y = Math.sin(k * 1.9) * 0.18;
            const shape = new THREE.Shape();
            shape.moveTo(-0.08, -0.1);
            shape.lineTo(0.08, -0.1);
            shape.lineTo(0.08, 0.06);
            shape.lineTo(0.04, 0.1);
            shape.lineTo(-0.08, 0.1);
            shape.closePath();
            const paper = this.glow(0xf8f8ff);
            paper.side = THREE.DoubleSide;
            this.part(pv, new THREE.ShapeGeometry(shape), paper, [0, y, 0.82], { outline: false });
            this.part(pv, new THREE.PlaneGeometry(0.16, 0.05), this.glow(rainbow[k]), [0, y - 0.04, 0.823], { outline: false });
          }
          this.spinners.push({ g, speed: -0.8 });
          break;
        }
        case 'suitLines': {
          // 胸のV字・ベルト・腕のライン（光る）
          const ln = this.glow(col);
          for (const sd of [1, -1]) this.part(b, new THREE.BoxGeometry(0.018, 0.26, 0.01), ln, [sd * 0.065, 1.03, 0.172], { rot: [0.1, 0, -sd * 0.45], outline: false });
          this.part(b, new THREE.TorusGeometry(0.205 * wide, 0.014, 4, 32), ln, [0, 0.74, 0], { rot: [Math.PI / 2, 0, 0], scale: [1.08, 0.86, 1], outline: false });
          this.part(b, new THREE.BoxGeometry(0.06, 0.05, 0.012), ln, [0, 0.74, 0.18], { outline: false });
          for (const arm of [this.armL, this.armR]) this.part(arm, new THREE.TorusGeometry(0.075, 0.012, 4, 16), ln, [0, -0.26, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
          break;
        }
        case 'clockRing': {
          // 背中の大きな時計：まわりの歯車の輪がゆっくり回り、長針と短針が進む
          const clock = new THREE.Group();
          clock.position.set(0, 1.05, -0.62);
          b.add(clock);
          const gold = this.glow(col);
          const face = new THREE.MeshBasicMaterial({ color: 0x1a2350, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
          capBrightness(face, 'basic-cap');
          this.part(clock, new THREE.CircleGeometry(0.42, 40), face, [0, 0, -0.01], { outline: false });
          // 歯車の輪（回る）
          const teeth = new THREE.Group();
          clock.add(teeth);
          this.part(teeth, new THREE.TorusGeometry(0.44, 0.022, 6, 48), gold, [0, 0, 0], { outline: false });
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            this.part(teeth, new THREE.BoxGeometry(0.05, 0.05, 0.02), gold, [Math.cos(a) * 0.48, Math.sin(a) * 0.48, 0], { rot: [0, 0, a], outline: false });
          }
          this.spinners.push({ g: teeth, speed: 0.25, axis: 'z' });
          // 目もり（12か所。3・6・9・12は長め）
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const len = i % 3 ? 0.04 : 0.08;
            this.part(clock, new THREE.BoxGeometry(0.018, len, 0.01), gold, [Math.sin(a) * (0.37 - len / 2), Math.cos(a) * (0.37 - len / 2), 0], { rot: [0, 0, -a], outline: false });
          }
          // 長針・短針（逆回り。背中側から見て時計回りに見えるように）
          for (const [len, w, sp] of [
            [0.3, 0.022, 1.2],
            [0.2, 0.034, 0.1],
          ] as const) {
            const hand = new THREE.Group();
            clock.add(hand);
            this.part(hand, new THREE.BoxGeometry(w, len, 0.012), gold, [0, len / 2, 0.01], { outline: false });
            this.spinners.push({ g: hand, speed: sp, axis: 'z' });
          }
          this.part(clock, new THREE.SphereGeometry(0.035, 10, 8), gold, [0, 0, 0.02], { outline: false });
          break;
        }
        case 'gearOrbit': {
          // まわりを回る小さな歯車（3つ、高さと大きさを変える）
          const g = new THREE.Group();
          g.position.y = 0.9;
          b.add(g);
          const gold = this.toon(col);
          for (let k = 0; k < 3; k++) {
            const pv = new THREE.Group();
            pv.rotation.y = (k / 3) * Math.PI * 2;
            g.add(pv);
            const r = 0.09 + k * 0.025;
            const gear = new THREE.Group();
            gear.position.set(0, [-0.15, 0.25, 0.05][k], 0.78);
            pv.add(gear);
            this.part(gear, new THREE.CylinderGeometry(r, r, 0.03, 16), gold, [0, 0, 0], { rot: [Math.PI / 2, 0, 0] });
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2;
              this.part(gear, new THREE.BoxGeometry(0.035, 0.035, 0.03), gold, [Math.cos(a) * (r + 0.015), Math.sin(a) * (r + 0.015), 0], { rot: [0, 0, a], outline: false });
            }
            this.part(gear, new THREE.CylinderGeometry(r * 0.35, r * 0.35, 0.035, 10), this.toon(0x0e1430), [0, 0, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
            this.spinners.push({ g: gear, speed: k % 2 ? 1.5 : -1.5, axis: 'z' });
          }
          this.spinners.push({ g, speed: 0.7 });
          break;
        }
        case 'festTowel': {
          // フェスのタオル：片方の肩にかけて、前と後ろに垂らす（しま模様と「FES」の文字）
          const tex = new THREE.CanvasTexture(
            (() => {
              const cv = document.createElement('canvas');
              cv.width = 64;
              cv.height = 256;
              const g = cv.getContext('2d')!;
              const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
              g.fillStyle = hex(col);
              g.fillRect(0, 0, 64, 256);
              g.fillStyle = '#ffffff';
              for (const y of [14, 236]) g.fillRect(0, y, 64, 8);
              g.font = '900 30px sans-serif';
              g.textAlign = 'center';
              g.save();
              g.translate(32, 128);
              g.rotate(Math.PI / 2);
              g.fillText('FES!', 0, 11);
              g.restore();
              return cv;
            })(),
          );
          tex.colorSpace = THREE.SRGBColorSpace;
          const towel = this.toon(0xffffff);
          towel.map = tex;
          const plain = this.toon(col);
          // 肩の上を通る部分と、前・後ろに垂れる部分
          this.part(b, new THREE.BoxGeometry(0.15, 0.03, 0.4), plain, [0.2 * wide, 1.19, 0], { rot: [0, 0, -0.35] });
          const front = this.swingPivot(b, [0.2 * wide, 1.16, 0.18], 0.35);
          this.part(front, new THREE.BoxGeometry(0.14, 0.4, 0.022), towel, [0.01, -0.19, 0.01], { rot: [-0.1, 0, -0.08] });
          const back = this.swingPivot(b, [0.2 * wide, 1.16, -0.18], 0.35);
          this.part(back, new THREE.BoxGeometry(0.14, 0.36, 0.022), towel, [0.01, -0.17, -0.01], { rot: [0.1, 0, -0.08] });
          break;
        }
        case 'fesBand':
          // フェスのリストバンド（両手首。布のバンドに四角いタグ）
          for (const arm of [this.armL, this.armR]) {
            this.part(arm, new THREE.TorusGeometry(0.075, 0.024, 6, 14), this.toon(this.c.accent), [0, -0.355, 0], { rot: [Math.PI / 2, 0, 0], outline: false });
            this.part(arm, new THREE.BoxGeometry(0.05, 0.04, 0.02), this.toon(0xffffff), [0, -0.355, 0.09], { outline: false });
          }
          break;
        case 'starClip': {
          const g = new THREE.Group();
          g.position.set(0.25, top - 0.17, 0.14);
          h.add(g);
          for (const r of [0, Math.PI / 4]) this.part(g, new THREE.OctahedronGeometry(0.06, 0), this.toon(col), [0, 0, 0], { rot: [0, 0, r], scale: [1, 1, 0.35], outline: false });
          break;
        }
        case 'bow': {
          const g = new THREE.Group();
          g.position.set(0.16, top - 0.06, 0.04);
          g.rotation.z = -0.4;
          h.add(g);
          for (const x of [0.07, -0.07]) this.part(g, new THREE.ConeGeometry(0.06, 0.13, 8), this.toon(col), [x, 0, 0], { rot: [0, 0, x > 0 ? Math.PI / 2 : -Math.PI / 2] });
          this.part(g, new THREE.SphereGeometry(0.035, 8, 6), this.toon(col), [0, 0, 0]);
          break;
        }
        case 'wings':
          for (const x of [1, -1]) {
            const sw = new THREE.Group();
            sw.position.set(x * 0.1, 1.02, -0.18);
            b.add(sw);
            this.part(sw, new THREE.SphereGeometry(0.2, 14, 10), this.toon(0xffffff), [x * 0.2, 0.08, -0.02], { scale: [1.1, 0.75, 0.22], rot: [0, 0, x * 0.5] });
            this.part(sw, new THREE.SphereGeometry(0.14, 12, 8), this.toon(col), [x * 0.18, -0.08, -0.03], { scale: [1.0, 0.6, 0.2], rot: [0, 0, x * 0.9], outline: false });
            this.wingGroups.push({ g: sw, side: x });
          }
          break;
        case 'capBack': {
          const cap = this.toon(col);
          this.part(h, new THREE.SphereGeometry(0.335, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), cap, [0, 0.31, -0.01], { rot: [-0.15, 0, 0] });
          this.part(h, new THREE.BoxGeometry(0.3, 0.025, 0.17), cap, [0, 0.47, -0.36], { rot: [-0.45, 0, 0] });
          break;
        }
        case 'headband':
          this.part(h, new THREE.TorusGeometry(0.318, 0.032, 6, 28), this.toon(col), [0, 0.42, 0], { rot: [Math.PI / 2 + 0.12, 0, 0], outline: false });
          this.part(h, new THREE.BoxGeometry(0.08, 0.18, 0.02), this.toon(col), [0.12, 0.33, -0.3], { rot: [0.2, 0.3, -0.4], outline: false });
          break;
        case 'coat': {
          const mat = this.toon(col);
          mat.side = THREE.DoubleSide;
          this.part(b, new THREE.CylinderGeometry(0.235 * wide, 0.29 * wide, 0.42, 16, 1, true, 0.35, Math.PI * 2 - 0.7), mat, [0, 0.58, 0]);
          for (const x of [0.06, -0.06]) this.part(b, new THREE.BoxGeometry(0.05, 0.3, 0.02), mat, [x, 1.0, 0.175], { rot: [0, 0, x > 0 ? -0.25 : 0.25], outline: false });
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- SSR のエフェクト（まわりに舞う粒と足元の光）
  private buildFx(fx: CostumeFx, ur = false): void {
    // UR は粒が多く、虹色。体のまわりに虹色のオーラもまとう
    const n = ur ? 26 : 14;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (ur) {
      const rainbow = [0xff5a5a, 0xffd23f, 0x4fd18b, 0x4f9dff, 0xc77dff].map((h) => new THREE.Color(h));
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) rainbow[i % rainbow.length].toArray(cols, i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    const mat = new THREE.PointsMaterial({ size: fx.particle === 'data' || fx.particle === 'pixel' ? 0.26 : 0.22, map: fxTexture(fx.particle), color: ur ? 0xffffff : fx.color, vertexColors: ur, transparent: true, depthWrite: false, opacity: 0.9 });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.root.add(pts);
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(0.35, 0.62, 32),
      new THREE.MeshBasicMaterial({ color: fx.color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, map: fxTexture('ring') }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.02;
    this.root.add(aura);
    const seeds = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, r: 0.35 + (i % 3) * 0.1, s: 0.6 + (i % 4) * 0.15, o: i / n }));
    let glow: THREE.Mesh | null = null;
    if (ur) {
      // 体を包む、色が移り変わる光（後ろから当てた光のように見せる）
      glow = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 2.8),
        new THREE.MeshBasicMaterial({ map: fxTexture('ring'), color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      glow.position.set(0, 1.0 * this.def.scale, -0.35);
      glow.renderOrder = -1;
      this.root.add(glow);
    }
    this.fxState = { pts, aura, seeds, kind: fx.particle, glow };
  }
  private fxState: { pts: THREE.Points; aura: THREE.Mesh; seeds: { a: number; r: number; s: number; o: number }[]; kind: CostumeFx['particle']; glow: THREE.Mesh | null } | null = null;
  private hideEyes = false;
  private halos: THREE.Group[] = [];
  /** ゆっくり回る小物（光の盾・星の輪など）と、ふわふわ浮く小物 */
  private spinners: { g: THREE.Group; speed: number; axis?: 'y' | 'z' }[] = [];
  private floaters: { g: THREE.Group; base: number }[] = [];
  private wingGroups: { g: THREE.Group; side: number }[] = [];

  private updateFx(time: number, visible: boolean): void {
    for (const hg of this.halos) {
      hg.position.y = (HEAD_TOP[this.def.id] ?? 0.66) + 0.14 + Math.sin(time * 2.4) * 0.02;
      hg.rotation.y = time * 1.5;
    }
    for (const w of this.wingGroups) w.g.rotation.y = w.side * (0.25 + Math.sin(time * 3.2) * 0.25);
    for (const sp of this.spinners) {
      if (sp.axis === 'z') sp.g.rotation.z = time * sp.speed;
      else sp.g.rotation.y = time * sp.speed;
      sp.g.visible = visible;
    }
    this.floaters.forEach((f, i) => (f.g.position.y = f.base + Math.sin(time * 2.4 + i * 1.7) * 0.05));
    const st = this.fxState;
    if (!st) return;
    st.pts.visible = visible;
    st.aura.visible = visible;
    const a = st.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sc = this.def.scale;
    st.seeds.forEach((sd, i) => {
      const life = (time * sd.s * 0.35 + sd.o) % 1;
      const ang = sd.a + time * (st.kind === 'flame' ? 0.4 : 1.1);
      const r = sd.r * (st.kind === 'petal' ? 1.2 : 1) * sc;
      const y = (st.kind === 'coin' || st.kind === 'petal' ? 2.1 - life * 2.1 : life * 2.1) * sc;
      a.setXYZ(i, Math.cos(ang) * r, y, Math.sin(ang) * r * 0.6);
    });
    a.needsUpdate = true;
    (st.pts.material as THREE.PointsMaterial).opacity = 0.75 + Math.sin(time * 4) * 0.15;
    (st.aura.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(time * 3) * 0.1;
    st.aura.rotation.z = time * 0.8;
    if (st.glow) {
      // UR：オーラと足元の輪の色を、虹色に移り変わらせる
      st.glow.visible = visible;
      const hue = (time * 0.15) % 1;
      (st.glow.material as THREE.MeshBasicMaterial).color.setHSL(hue, 0.9, 0.6);
      (st.glow.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(time * 2.5) * 0.08;
      (st.aura.material as THREE.MeshBasicMaterial).color.setHSL((hue + 0.5) % 1, 0.9, 0.6);
    }
  }

  /** 攻撃のときだけ手に持つ道具 */
  private buildAttackProps(id: string): void {
    const c = this.c;
    if (id === 'guard') {
      // 警棒（腕の先へ伸びるように持つ）
      const hnd = this.hand(this.armR);
      const g = new THREE.Group();
      hnd.add(g);
      this.part(g, new THREE.CylinderGeometry(0.03, 0.035, 0.5, 8), this.toon(0x15151c), [0, -0.2, 0.03]);
      this.part(g, new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), this.toon(0x444455), [0, 0.03, 0.03], { outline: false });
      this.attackProps.push({ obj: g, moves: ['jab', 'side', 'smash', 'charge', 'fair', 'up', 'uair'] });
    } else if (id === 'ai') {
      // ホログラムの剣
      const hnd = this.hand(this.armR);
      const g = new THREE.Group();
      hnd.add(g);
      const m = new THREE.MeshBasicMaterial({ color: c.accent, transparent: true, opacity: 0.75 });
      capBrightness(m, 'basic-cap');
      this.part(g, new THREE.BoxGeometry(0.05, 0.62, 0.015), m, [0, -0.33, 0.02], { outline: false });
      this.part(g, new THREE.BoxGeometry(0.12, 0.03, 0.04), this.toon(0x2a2f3a), [0, -0.02, 0.02], { outline: false });
      this.attackProps.push({ obj: g, moves: ['side', 'smash', 'charge', 'fair', 'up', 'uair'] });
    } else if (id === 'gacha') {
      // ガチャのカプセル（上が赤、下が白）
      const hnd = this.hand(this.armR);
      const g = new THREE.Group();
      hnd.add(g);
      this.part(g, new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.toon(0xe5484d), [0, -0.12, 0.08]);
      this.part(g, new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), this.toon(0xf2f2f5), [0, -0.12, 0.08]);
      this.attackProps.push({ obj: g, moves: ['smash', 'charge'] });
    } else if (id === 'trainer') {
      // ダンベル（ダンベルカール・スマッシュ・溜め攻撃）
      const hnd = this.hand(this.armR);
      const g = new THREE.Group();
      hnd.add(g);
      const iron = this.toon(0x2a2a32);
      this.part(g, new THREE.CylinderGeometry(0.03, 0.03, 0.46, 8), this.toon(0x9aa0aa), [0, -0.02, 0.04], { rot: [0, 0, Math.PI / 2] });
      for (const x of [0.17, -0.17]) {
        this.part(g, new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16), iron, [x, -0.02, 0.04], { rot: [0, 0, Math.PI / 2] });
        this.part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), this.toon(c.main), [x * 1.4, -0.02, 0.04], { rot: [0, 0, Math.PI / 2] });
      }
      this.attackProps.push({ obj: g, moves: ['nspecial', 'smash', 'charge'] });
      // プロテインのシェイカー
      const hnd2 = this.hand(this.armR);
      const sh = new THREE.Group();
      hnd2.add(sh);
      this.part(sh, new THREE.CylinderGeometry(0.065, 0.055, 0.22, 14), this.toon(0xf2f2f5), [0, -0.04, 0.07]);
      this.part(sh, new THREE.CylinderGeometry(0.068, 0.068, 0.06, 14), this.toon(c.main), [0, 0.09, 0.07], { outline: false });
      this.part(sh, new THREE.BoxGeometry(0.11, 0.07, 0.005), this.toon(c.accent), [0, -0.04, 0.135], { outline: false });
      this.attackProps.push({ obj: sh, moves: ['dspecial'] });
    } else if (id === 'threeb') {
      const metal = this.toon(0xd8dde6);
      // 美容師：ハサミ（B）・ドライヤー（横B）・スプレー（上B）
      {
        const g = new THREE.Group();
        this.hand(this.armR).add(g);
        for (const r of [0.25, -0.25]) this.part(g, new THREE.BoxGeometry(0.025, 0.3, 0.012), metal, [0, -0.15, 0.05], { rot: [0, 0, r], outline: false });
        for (const x of [0.05, -0.05]) this.part(g, new THREE.TorusGeometry(0.035, 0.012, 5, 10), this.toon(c.accent), [x, 0.02, 0.05], { outline: false });
        this.attackProps.push({ obj: g, moves: ['nspecial'], job: 0 });
        const dr = new THREE.Group();
        this.hand(this.armR).add(dr);
        this.part(dr, new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), this.toon(0x2a2a32), [0, -0.04, 0.05]);
        this.part(dr, new THREE.CylinderGeometry(0.075, 0.06, 0.26, 12), this.toon(c.accent), [0, -0.14, 0.13], { rot: [Math.PI / 2, 0, 0] });
        this.attackProps.push({ obj: dr, moves: ['sspecial'], job: 0 });
        const sp = new THREE.Group();
        this.hand(this.armR).add(sp);
        this.part(sp, new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12), this.toon(c.accent), [0, -0.06, 0.06]);
        this.part(sp, new THREE.CylinderGeometry(0.02, 0.03, 0.05, 8), metal, [0, 0.07, 0.06], { outline: false });
        this.attackProps.push({ obj: sp, moves: ['uspecial'], job: 0 });
      }
      // バンドマン：手に持つギター（B・上B・スマッシュ・溜め）
      {
        const g = new THREE.Group();
        g.rotation.set(0, 0, 0);
        this.hand(this.armR).add(g);
        this.buildGuitar(g, [0, -0.15, 0.12], 0.75);
        g.children[0].rotation.x = Math.PI / 2;
        this.attackProps.push({ obj: g, moves: ['nspecial', 'uspecial', 'smash', 'charge'], job: 1 });
      }
      // バーテンダー：ボトル（B）とシェイカー（上B）
      {
        const bt = new THREE.Group();
        this.hand(this.armR).add(bt);
        this.part(bt, new THREE.CylinderGeometry(0.06, 0.07, 0.2, 12), this.toon(0x2f8a4a), [0, -0.18, 0.04]);
        this.part(bt, new THREE.CylinderGeometry(0.025, 0.04, 0.12, 10), this.toon(0x2f8a4a), [0, -0.02, 0.04], { outline: false });
        this.part(bt, new THREE.BoxGeometry(0.1, 0.07, 0.005), this.toon(0xf2e6c8), [0, -0.18, 0.105], { outline: false });
        this.attackProps.push({ obj: bt, moves: ['nspecial'], job: 2 });
        const sh = new THREE.Group();
        this.hand(this.armR).add(sh);
        this.part(sh, new THREE.CylinderGeometry(0.06, 0.05, 0.2, 12), metal, [0, -0.06, 0.06]);
        this.part(sh, new THREE.ConeGeometry(0.06, 0.08, 12), metal, [0, 0.08, 0.06], { outline: false });
        this.attackProps.push({ obj: sh, moves: ['uspecial'], job: 2 });
      }
    }
    for (const p of this.attackProps) p.obj.visible = false;
  }

  /** 追加の4体 */
  private buildCharacter2(id: string): void {
    const c = this.c;
    const h = this.head;
    if (id === 'dopa') {
      // ドパガキ：ぶかぶかの蛍光パーカー・イヤホン・スマホ・エナジードリンク・キラキラの目
      this.mouth();
      const hair = this.hairToon(c.hair);
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
      this.sparkle = true;
      // イヤホン
      for (const x of [0.3, -0.3]) this.part(h, new THREE.SphereGeometry(0.035, 8, 6), this.glow(0xffffff), [x, 0.26, 0.04], { outline: false });
      // ぶかぶかのパーカー（フードは下ろしている）
      this.part(this.body, new THREE.TorusGeometry(0.18, 0.07, 8, 20), this.toon(c.main), [0, 1.16, -0.04], { rot: [Math.PI / 2 - 0.35, 0, 0] });
      this.part(this.body, new THREE.BoxGeometry(0.3, 0.1, 0.03), this.toon(c.sub), [0, 0.76, 0.17], { outline: false });
      for (const x of [0.06, -0.06]) {
        const sw = this.swingPivot(this.body, [x, 1.13, 0.17], 1.1);
        this.part(sw, new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), this.toon(c.accent), [0, -0.1, 0], { outline: false });
      }
      // エナジードリンク（腰）
      this.part(this.body, new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), this.toon(c.accent), [-0.27, 0.72, 0.05]);
      this.part(this.body, new THREE.CylinderGeometry(0.046, 0.046, 0.03, 12), this.toon(0x222222), [-0.27, 0.74, 0.05], { outline: false });
      // スマホ（右手）
      // 画面が顔のほうを向くように傾けて持つ
      const phone = new THREE.Group();
      phone.rotation.x = PHONE_TILT;
      this.hand(this.armR).add(phone);
      this.part(phone, new THREE.BoxGeometry(0.12, 0.21, 0.02), this.toon(0x222233), [0, -0.11, 0.095]);
      this.part(phone, new THREE.BoxGeometry(0.104, 0.19, 0.005), this.glow(0x8ef0ff), [0, -0.11, 0.107], { outline: false });
    } else if (id === 'gacha') {
      // ガチャ廃人：目の下のクマ・ぼさぼさの長い髪・ジャージ・光るスマホ
      this.mouth();
      for (const x of [0.11, -0.11]) {
        this.part(h, new THREE.SphereGeometry(0.05, 10, 6), this.glow(0x6a4a8a), [x, 0.2, 0.27], { scale: [1, 0.35, 0.3], outline: false });
      }
      const hair = this.hairToon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.345, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, [0, 0.3, -0.03], { rot: [-0.5, 0, 0] });
      for (const [x, y] of [
        [0.25, 0.12],
        [-0.25, 0.12],
        [0.15, 0.02],
        [-0.15, 0.02],
      ]) {
        const sw = this.swingPivot(h, [x, y + 0.15, -0.08], 0.7);
        this.part(sw, new THREE.CapsuleGeometry(0.06, 0.24, 4, 8), hair, [0, -0.15, 0], { rot: [0.2, 0, x > 0 ? 0.15 : -0.15] });
      }
      for (let i = 0; i < 3; i++) this.part(h, new THREE.ConeGeometry(0.06, 0.18, 6), hair, [-0.1 + i * 0.1, 0.5, 0.22], { rot: [1.6, 0, (i - 1) * 0.3], outline: false });
      // ジャージ（腕と胴に線）
      for (const arm of [this.armL, this.armR]) this.part(arm, new THREE.BoxGeometry(0.02, 0.28, 0.14), this.toon(c.accent), [0, -0.19, 0], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.02, 0.38, 0.01), this.toon(c.accent), [0, 0.94, 0.168], { outline: false });
      this.part(this.body, new THREE.TorusGeometry(0.15, 0.04, 8, 20), this.toon(c.sub), [0, 1.18, 0], { rot: [Math.PI / 2, 0, 0] });
      // 光るスマホ（右手）
      const phone = new THREE.Group();
      phone.rotation.x = PHONE_TILT;
      this.hand(this.armR).add(phone);
      this.part(phone, new THREE.BoxGeometry(0.12, 0.21, 0.02), this.toon(0x222233), [0, -0.11, 0.095]);
      this.part(phone, new THREE.BoxGeometry(0.104, 0.19, 0.005), this.glow(c.accent), [0, -0.11, 0.107], { outline: false });
    } else if (id === 'courier') {
      // 配達員：ヘルメット・四角い配達バッグ・自転車
      this.mouth();
      this.brows(0.05, c.hair);
      const helmet = this.hairToon(c.main);
      this.part(h, new THREE.SphereGeometry(0.335, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), helmet, [0, 0.33, 0], { scale: [1, 0.95, 1.08] });
      this.part(h, new THREE.BoxGeometry(0.06, 0.04, 0.5), this.toon(c.accent), [0, 0.62, 0], { outline: false });
      this.part(h, new THREE.BoxGeometry(0.3, 0.025, 0.12), this.toon(0x15151c), [0, 0.42, 0.32], { rot: [0.25, 0, 0] });
      // 配達バッグ（背中）
      const bag = this.swingPivot(this.body, [0, 1.22, -0.2], 0.35);
      this.part(bag, new THREE.BoxGeometry(0.5, 0.48, 0.32), this.toon(c.main), [0, -0.22, -0.13]);
      this.part(bag, new THREE.BoxGeometry(0.51, 0.08, 0.33), this.toon(c.accent), [0, -0.16, -0.13], { outline: false });
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
      const hair = this.hairToon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.335, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, 0.31, -0.02], { rot: [-0.35, 0, 0] });
      const lock = this.swingPivot(h, [0.06, 0.55, 0.2], 0.5);
      this.part(lock, new THREE.CapsuleGeometry(0.07, 0.22, 4, 8), hair, [0, -0.05, 0], { rot: [0, 0, Math.PI / 2 - 0.25], outline: false });
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
    } else if (id === 'trainer') {
      // パーソナルトレーナー：短いツンツン頭・タンクトップ・ホイッスル・肩のタオル
      this.mouth();
      this.brows(-0.18, c.hair, 0.032, 0.365);
      const hair = this.hairToon(c.hair);
      this.part(h, new THREE.SphereGeometry(0.325, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, [0, 0.32, -0.02], { rot: [-0.2, 0, 0] });
      for (const [x, z, rx, rz] of [
        [0.12, 0.12, 0.5, -0.5],
        [0, 0.15, 0.55, 0],
        [-0.12, 0.12, 0.5, 0.5],
        [0.08, -0.06, -0.3, -0.4],
        [-0.08, -0.06, -0.3, 0.4],
      ]) {
        this.part(h, new THREE.ConeGeometry(0.06, 0.15, 5), hair, [x, 0.6, z], { rot: [rx, 0, rz], outline: false });
      }
      for (const x of [0.29, -0.29]) this.part(h, new THREE.BoxGeometry(0.03, 0.09, 0.07), hair, [x, 0.36, 0.02], { outline: false });
      // タンクトップの肩ひもと胸のライン・腰のベルト
      for (const x of [0.14, -0.14]) this.part(this.body, new THREE.BoxGeometry(0.07, 0.16, 0.36), this.toon(c.main), [x, 1.13, 0], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.3, 0.03, 0.01), this.toon(c.sub), [0, 0.98, 0.17], { outline: false });
      this.part(this.body, new THREE.BoxGeometry(0.02, 0.2, 0.01), this.toon(c.sub), [0, 0.86, 0.172], { outline: false });
      this.part(this.body, new THREE.CylinderGeometry(0.235 * 1.2, 0.235 * 1.2, 0.07, 18), this.toon(c.sub), [0, 0.66, 0], { scale: [1, 1, 0.78], outline: false });
      // ホイッスル
      this.part(this.body, new THREE.TorusGeometry(0.15, 0.01, 5, 20, Math.PI), this.toon(c.accent), [0, 1.16, 0.06], { rot: [Math.PI / 2 + 0.9, 0, Math.PI], outline: false });
      const wh = this.swingPivot(this.body, [0, 1.09, 0.19], 0.6);
      this.part(wh, new THREE.CylinderGeometry(0.025, 0.025, 0.07, 10), this.toon(0xc0c4cc), [0, -0.04, 0.01], { rot: [0, 0, Math.PI / 2] });
      // 肩のタオル
      const towel = this.swingPivot(this.body, [0.22, 1.18, -0.05], 0.5);
      this.part(towel, new THREE.BoxGeometry(0.13, 0.05, 0.36), this.toon(0xf4f4f6), [0, 0, 0], { rot: [0, 0, -0.25] });
      this.part(towel, new THREE.BoxGeometry(0.13, 0.3, 0.04), this.toon(0xf4f4f6), [0.04, -0.15, -0.17], { rot: [0, 0, -0.1] });
    } else if (id === 'threeb') {
      this.buildThreeB();
    }
  }

  /** 3B：美容師・バンドマン・バーテンダーの3つの見た目を作り、今の仕事のものだけ表示する */
  private buildThreeB(): void {
    const c = this.c;
    const h = this.head;
    const b = this.body;
    this.mouth();
    this.brows(0.08, c.hair, 0.026);
    // バンドマンの髪（衣装ごとの色）
    const hair = this.hairToon(this.jobHair(1));
    /** 仕事 j の部品を入れる入れ物を、親に付けて返す */
    const grp = (j: number, parent: THREE.Object3D) => {
      const g = new THREE.Group();
      parent.add(g);
      this.jobParts[j].push(g);
      return g;
    };
    // ---- 美容師：センター分けのマッシュヘア・黒いエプロン・腰のハサミ入れ
    {
      const hg = grp(0, h);
      this.buildBeauticianHair(hg);
      const bg = grp(0, b);
      this.part(bg, new THREE.BoxGeometry(0.36, 0.5, 0.02), this.toon(c.sub), [0, 0.78, 0.18], { outline: false });
      for (const x of [0.13, -0.13]) this.part(bg, new THREE.BoxGeometry(0.03, 0.26, 0.02), this.toon(c.sub), [x, 1.08, 0.16], { rot: [0, 0, x > 0 ? -0.3 : 0.3], outline: false });
      this.part(bg, new THREE.BoxGeometry(0.12, 0.16, 0.06), this.toon(0x2a2a32), [-0.24, 0.72, 0.1]);
      for (const x of [-0.22, -0.26]) this.part(bg, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), this.toon(0xd8dde6), [x, 0.85, 0.1], { outline: false });
    }
    // ---- バンドマン：長くてぼさぼさの髪・黒いベスト・チェーン・背中のギター
    {
      // ウルフカット：てっぺんはツンツン、顔の横と襟足は長くギザギザ。差し色のメッシュ入り
      const hg = grp(1, h);
      const hr = this.hairToon(this.jobHair(1));
      hr.side = THREE.DoubleSide;
      const streak = this.hairToon(c.accent);
      this.hairShell(hg, hr, 0.34, 0, Math.PI * 2, 0, 1.1, [1.04, 1.04, 1.04]);
      this.hairShell(hg, hr, 0.345, Math.PI / 2 + 1.05, Math.PI * 2 - 2.1, 0.9, 1.0, [1.06, 1, 1.04]);
      // 頭のてっぺんの、立ち上がった毛束
      for (const [x, z, rx, rz, mesh] of [
        [0, 0.14, -0.45, 0, 0],
        [0.14, 0.1, -0.3, -0.6, 1],
        [-0.14, 0.1, -0.3, 0.6, 0],
        [0.09, -0.06, -0.95, -0.4, 0],
        [-0.09, -0.06, -0.95, 0.4, 0],
        [0, -0.15, -1.25, 0, 0],
        [0.24, 0, -0.35, -1.05, 0],
        [-0.24, 0, -0.35, 1.05, 0],
      ]) {
        this.part(hg, new THREE.ConeGeometry(0.08, 0.27, 6), mesh ? streak : hair, [x, 0.6, z], { rot: [rx, 0, rz], outline: false });
      }
      // ギザギザの前髪（毛先が眉と目にかかる）
      const fringe: [number, number, number][] = [
        [-0.75, 0.16, 0],
        [-0.42, 0.2, 0],
        [-0.12, 0.17, 1],
        [0.18, 0.26, 0],
        [0.48, 0.18, 1],
        [0.78, 0.15, 0],
      ];
      for (const [a, len, mesh] of fringe) {
        const th = 1.0;
        const r = 0.35;
        const x = r * Math.sin(th) * Math.sin(a);
        const y = 0.29 + r * 0.95 * Math.cos(th);
        const z = r * 0.95 * Math.sin(th) * Math.cos(a);
        const lk = this.swingPivot(hg, [x, y + 0.02, z], 0.3);
        this.part(lk, new THREE.ConeGeometry(0.07, len, 6), mesh ? streak : hair, [0, -len / 2, 0.02], { rot: [Math.PI + 0.35, a * 0.6, -a * 0.25], outline: false });
      }
      // 顔の横に垂れる長い毛（あごまで）と、肩まで届く襟足
      for (const sd of [1, -1]) {
        for (const [dz, len, out, mesh] of [
          [0.08, 0.3, 0.25, sd > 0 ? 1 : 0],
          [-0.06, 0.36, 0.35, 0],
        ]) {
          const lk = this.swingPivot(hg, [sd * 0.31, 0.32, dz], 0.7);
          this.part(lk, new THREE.ConeGeometry(0.075, len, 6), mesh ? streak : hair, [sd * 0.02, -len / 2, 0], { rot: [Math.PI, 0, -sd * out], outline: false });
        }
      }
      for (const x of [-0.17, 0, 0.17]) {
        const lk = this.swingPivot(hg, [x, 0.24, -0.27], 0.9);
        this.part(lk, new THREE.ConeGeometry(0.08, 0.42, 6), hair, [x * 0.5, -0.2, -0.04], { rot: [Math.PI - 0.3, 0, -x * 2.2], outline: false });
      }
      const bg = grp(1, b);
      this.part(bg, new THREE.CapsuleGeometry(0.205, 0.2, 6, 16), this.toon(c.sub), [0, 0.95, 0], { scale: [1.14, 0.9, 0.86] });
      this.part(bg, new THREE.BoxGeometry(0.1, 0.4, 0.02), this.toon(c.main), [0, 0.95, 0.18], { outline: false });
      this.part(bg, new THREE.TorusGeometry(0.1, 0.012, 5, 16, Math.PI), this.toon(0xd8dde6), [-0.12, 0.66, 0.16], { rot: [0, 0, Math.PI], outline: false });
      // 背中のギター
      const gt = this.swingPivot(b, [0, 1.12, -0.2], 0.3);
      this.jobParts[1].push(gt);
      this.buildGuitar(gt, [0, -0.3, -0.06], 0.6);
      this.backGuitar = gt;
    }
    // ---- バーテンダー：なでつけた髪・ベスト・蝶ネクタイ
    {
      const hg = grp(2, h);
      this.buildBartenderHair(hg);
      const bg = grp(2, b);
      this.part(bg, new THREE.CapsuleGeometry(0.205, 0.2, 6, 16), this.toon(c.sub), [0, 0.9, 0], { scale: [1.14, 0.85, 0.86] });
      this.part(bg, new THREE.BoxGeometry(0.08, 0.36, 0.02), this.toon(c.main), [0, 0.98, 0.18], { outline: false });
      for (const y of [0.92, 0.82]) this.part(bg, new THREE.SphereGeometry(0.018, 6, 5), this.toon(c.accent), [0.07, y, 0.18], { outline: false });
      for (const x of [0.05, -0.05]) this.part(bg, new THREE.ConeGeometry(0.045, 0.08, 4), this.toon(c.accent), [x, 1.15, 0.17], { rot: [0, 0, x > 0 ? Math.PI / 2 : -Math.PI / 2], outline: false });
      this.part(bg, new THREE.SphereGeometry(0.025, 8, 6), this.toon(c.accent), [0, 1.15, 0.18], { outline: false });
    }
    this.setJob(0);
  }

  /**
   * 頭の形に沿った髪の曲面。phi は水平の角度（π/2 が顔の正面）、theta は頭のてっぺんからの角度。
   * 場所ごとに長さの違う髪（前は眉まで・横と後ろは耳の下まで、など）を組み合わせて作る
   */
  private hairShell(parent: THREE.Object3D, mat: THREE.Material, r: number, phiStart: number, phiLen: number, thetaStart: number, thetaLen: number, scale: [number, number, number] = [1, 1, 1]): THREE.Mesh {
    const geo = new THREE.SphereGeometry(r, Math.max(8, Math.round(phiLen * 6)), Math.max(4, Math.round(thetaLen * 8)), phiStart, phiLen, thetaStart, thetaLen);
    const mesh = new THREE.Mesh(geo, mat);
    // 頭（半径0.31、縦と奥行き0.95倍）と同じ中心・同じつぶれ方
    mesh.position.set(0, 0.29, 0);
    mesh.scale.set(scale[0], 0.95 * scale[1], 0.95 * scale[2]);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /**
   * 毛束：頭の表面の (phi, theta) に、流れる向き flow に沿って細長い楕円体を置く。
   * phi は水平の角度（π/2 が顔の正面）、theta は頭のてっぺんからの角度。
   */
  private hairLock(parent: THREE.Object3D, mat: THREE.Material, phi: number, theta: number, len: number, wid: number, thick: number, flow: [number, number, number], lift = 1.06): THREE.Mesh {
    const r = 0.31 * lift;
    const n = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const pos = new THREE.Vector3(n.x * r, 0.29 + n.y * r * 0.95, n.z * r * 0.95);
    const f = new THREE.Vector3(...flow);
    const t = f.sub(n.clone().multiplyScalar(f.dot(n))).normalize();
    const x = new THREE.Vector3().crossVectors(n, t).normalize();
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, n, t));
    mesh.scale.set(wid, thick, len);
    // 毛束の真ん中を、流れの向きに半分ずらして根元を置いた位置にする
    mesh.position.copy(pos).addScaledVector(t, len * 0.55);
    mesh.castShadow = true;
    parent.add(mesh);
    const ol = new THREE.Mesh(geo, this.outlineMat);
    ol.scale.setScalar(1.04);
    mesh.add(ol);
    return mesh;
  }

  /**
   * 外ハネの毛先：頭の表面の (phi, theta) から、いったん下へ落ちて外側へくるっと上向きに曲がる毛先。
   * r はカーブの大きさ、tube は太さ、arc は曲がる角度（π なら真横、1.3π なら上向きまで）
   */
  private hairCurl(parent: THREE.Object3D, mat: THREE.Material, phi: number, theta: number, r: number, tube: number, arc: number, lift = 1.06): void {
    const rr = 0.31 * lift;
    const n = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const root = new THREE.Vector3(n.x * rr, 0.29 + n.y * rr * 0.95, n.z * rr * 0.95);
    // 外向き（水平）・上・横の向きで、曲がる面を決める
    const out = new THREE.Vector3(n.x, 0, n.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(out, up);
    const g = new THREE.Group();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(out, up, side));
    g.position.copy(root);
    parent.add(g);
    // 円の中心を根元の外側に置き、根元（円の左端）から下を回って外へ曲がる
    const geo = new THREE.TorusGeometry(r, tube, 6, 14, arc);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(r, 0, 0);
    m.rotation.z = Math.PI;
    m.scale.set(1, 1, 1.6);
    m.castShadow = true;
    g.add(m);
    const ol = new THREE.Mesh(geo, this.outlineMat);
    ol.scale.setScalar(1.06);
    m.add(ol);
    // とがった毛先（曲がり終わりの向きへ）
    const ex = r - r * Math.cos(arc);
    const ey = -r * Math.sin(arc);
    const dir = Math.atan2(-r * Math.cos(arc), r * Math.sin(arc));
    const tipGeo = new THREE.ConeGeometry(tube * 1.05, tube * 4.5, 8);
    const tip = new THREE.Mesh(tipGeo, mat);
    tip.position.set(ex + Math.cos(dir) * tube * 2, ey + Math.sin(dir) * tube * 2, 0);
    tip.rotation.z = dir - Math.PI / 2;
    tip.scale.set(1, 1, 1.6);
    g.add(tip);
    const tol = new THREE.Mesh(tipGeo, this.outlineMat);
    tol.scale.setScalar(1.08);
    tip.add(tol);
  }

  /** 3B の仕事ごとの髪色（衣装で決まる。決まっていなければ、美容師は明るく、バーテンダーは黒） */
  private jobHair(job: number): number {
    const fixed = this.costume.jobHair?.[job];
    if (fixed !== undefined) return fixed;
    if (job === 0) return new THREE.Color(this.c.hair).lerp(new THREE.Color(0xf3dfb8), 0.72).getHex();
    if (job === 2) return 0x16161c;
    return this.c.hair;
  }

  /** 美容師の髪：ハイトーンの外ハネ（衣装ごとの明るい髪色） */
  private buildBeauticianHair(hg: THREE.Group): void {
    const tone = this.jobHair(0);
    const hair = this.hairToon(tone);
    const hr = this.hairToon(tone);
    hr.side = THREE.DoubleSide;
    const F = Math.PI / 2;
    // あごの高さまで下ろしてから、毛先を外へ跳ねさせる
    const bottom = 2.15;
    const curlR = 0.075;
    // 土台：頭の上から、横・後ろは毛先の高さまで頭に沿って下ろす
    this.hairShell(hg, hr, 0.33, 0, Math.PI * 2, 0, 0.8, [1.03, 1.03, 1.03]);
    this.hairShell(hg, hr, 0.332, F + 0.95, Math.PI * 2 - 1.9, 0.6, bottom - 0.6, [1.03, 1, 1.03]);
    // 毛先：横と後ろをぐるっと、外へくるっとはねる
    const count = 14;
    for (let i = 0; i <= count; i++) {
      const ph = F + 0.95 + (i / count) * (Math.PI * 2 - 1.9);
      // 毛先ごとに、はね方を少しずつ変える
      this.hairCurl(hg, hair, ph, bottom - 0.04, curlR * (0.85 + (i % 3) * 0.12), 0.032, Math.PI * (0.62 + (i % 2) * 0.1), 1.06);
    }
    // 顔の横（もみあげの前）にも、はねる毛先
    for (const sd of [1, -1]) {
      this.hairShell(hg, hr, 0.334, sd > 0 ? F + 0.78 : F - 0.95, 0.17, 0.75, bottom - 0.75, [1.03, 1, 1.03]);
      this.hairCurl(hg, hair, F + sd * 0.86, bottom - 0.02, curlR, 0.032, Math.PI * 0.7, 1.06);
    }
    // 前髪：すき間のある軽い前髪を、少し横へ流して眉の上まで
    for (const [a, len] of [
      [-0.6, 0.16],
      [-0.33, 0.19],
      [-0.07, 0.2],
      [0.18, 0.19],
      [0.44, 0.17],
      [0.68, 0.15],
    ]) {
      this.hairLock(hg, hair, F + a, 0.78, len, 0.08, 0.026, [0.3, -1, 0.2], 1.05);
    }
  }

  /** バーテンダーの髪（どの衣装でも黒髪） */
  private buildBartenderHair(hg: THREE.Group): void {
    const black = this.jobHair(2);
    const hair = this.hairToon(black);
    const shine = this.hairToon(0x4a4a5c);
    const hr = this.hairToon(black);
    hr.side = THREE.DoubleSide;
    const F = Math.PI / 2;
    this.hairShell(hg, hr, 0.322, 0, Math.PI * 2, 0, 0.84);
    this.hairShell(hg, hr, 0.325, F + 1.2, Math.PI * 2 - 2.4, 0.75, 0.75);
    // オールバック：生えぎわから後ろへ、細い毛束を頭の丸みに沿って何段も重ねてなでつける。ところどころ明るい束でつや
    let k = 0;
    for (const [th, list] of [
      [0.82, [-0.85, -0.57, -0.28, 0, 0.28, 0.57, 0.85]],
      [0.6, [-0.8, -0.48, -0.16, 0.16, 0.48, 0.8]],
      [0.38, [-0.7, -0.35, 0, 0.35, 0.7]],
      [0.16, [-0.5, 0, 0.5]],
    ] as [number, number[]][]) {
      for (const a of list) {
        k++;
        this.hairLock(hg, k % 3 === 0 ? shine : hair, F + a, th, 0.15, 0.1, 0.03, [0, 0.4, -1], 1.03);
      }
    }
    // 頭の後ろ：首のほうへ流れる
    for (const [th, list] of [
      [0.25, [-0.6, 0, 0.6]],
      [0.55, [-0.9, -0.45, 0, 0.45, 0.9]],
      [0.85, [-0.9, -0.45, 0, 0.45, 0.9]],
    ] as [number, number[]][]) {
      for (const a of list) {
        k++;
        this.hairLock(hg, k % 3 === 0 ? shine : hair, (Math.PI * 3) / 2 + a, th, 0.16, 0.11, 0.03, [0, -1, -0.4], 1.03);
      }
    }
    // 横：耳の上を後ろへ（ぴったり）
    for (const a of [-1.25, -1.6, 1.25, 1.6]) this.hairLock(hg, hair, F + a, 1.05, 0.17, 0.09, 0.028, [0, 0.15, -1], 1.02);
  }

  /** ギター（背中と手持ちで共用） */
  private buildGuitar(parent: THREE.Object3D, pos: [number, number, number], size: number): void {
    const c = this.c;
    const g = new THREE.Group();
    g.position.set(...pos);
    g.scale.setScalar(size);
    parent.add(g);
    this.part(g, new THREE.SphereGeometry(0.22, 16, 12), this.toon(c.accent), [0, -0.12, 0], { scale: [1, 1.15, 0.3] });
    this.part(g, new THREE.SphereGeometry(0.17, 16, 12), this.toon(c.accent), [0, 0.15, 0], { scale: [1, 1, 0.3] });
    this.part(g, new THREE.BoxGeometry(0.06, 0.55, 0.04), this.toon(0x3a2a20), [0, 0.5, 0], { outline: false });
    this.part(g, new THREE.BoxGeometry(0.1, 0.12, 0.05), this.toon(0x1a1a22), [0, 0.82, 0]);
    this.part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12), this.toon(0x1a1a22), [0, -0.05, 0.07], { rot: [Math.PI / 2, 0, 0], outline: false });
  }

  /** 3B の見た目を、その仕事のものに切り替える */
  private setJob(j: number): void {
    this.job = j;
    this.jobParts.forEach((list, k) => list.forEach((o) => (o.visible = k === j)));
  }

  // ---------------------------------------------------------------- 毎フレームの更新
  update(v: ViewFighter, def: CharacterDef, time: number, dt: number): void {
    // 3B：仕事に合わせて見た目と性能（技の速さ）を切り替える
    if (def.id === 'threeb') {
      if (this.cycleJobs) this.previewJob = Math.floor(time / 1.3) % 3;
      const j = this.previewJob ?? fxJob(v.fx);
      if (j !== this.job) this.setJob(j);
      def = threebDef(j);
    }
    const visible = v.state !== 'dead';
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(v.x, v.y, 0);

    // 向き：少しカメラ側を向かせる
    const target = this.victory ? 0 : this.previewTurn ?? v.facing * (Math.PI / 2 - 0.45);
    this.turn += (target - this.turn) * Math.min(1, dt * 18);

    if (this.actionT > 0) this.actionT = Math.max(0, this.actionT - dt);
    const acting = this.actionT > 0;
    const target0 = acting
      ? this.actionPose(def.id, time)
      : this.victory
        ? this.victoryPose(def.id, time)
        : this.fancyIdle && (v.state === 'idle' || v.state === 'respawn')
          ? this.fancyPose(def.id, time)
          : this.pose(v, def, time);
    // キャラごとの姿勢のくせ（ドパガキ・ガチャ廃人は猫背、警備員は胸を張る）
    if (!this.victory && v.state !== 'hitstun' && v.state !== 'grabbed') {
      const lean = def.id === 'dopa' ? 0.07 : def.id === 'gacha' ? 0.06 : def.id === 'guard' ? -0.04 : 0;
      const tilt = def.id === 'dopa' ? 0.1 : def.id === 'gacha' ? 0.08 : def.id === 'guard' ? -0.05 : 0;
      target0.lean += lean;
      target0.headTilt += tilt;
    }
    // 自転車（配達員）：乗っている間と、立ちこぎジャンプ中に表示
    const onBike = (v.fx & FX_BIKE) !== 0 || (def.id === 'courier' && v.state === 'attack' && v.move === 'uspecial');
    if (this.bikeGroup) {
      this.bikeGroup.visible = onBike;
      if (onBike) {
        const c = Math.sin(time * 18);
        target0.legL = -0.9 + c * 0.6;
        target0.legR = -0.9 - c * 0.6;
        target0.lean = 0.25;
        target0.armL = FWD * 0.75;
        target0.armR = FWD * 0.75;
        target0.bob = 0.34;
        target0.spinY = 0;
      }
    }
    // 攻撃のときだけ持つ道具
    for (const ap of this.attackProps) ap.obj.visible = v.state === 'attack' && !!v.move && ap.moves.includes(v.move) && (ap.job === undefined || ap.job === this.job);
    // 背中のギターは、手に持っている間は隠す
    if (this.backGuitar) this.backGuitar.visible = this.job === 1 && !(v.state === 'attack' && ['nspecial', 'uspecial', 'smash', 'charge'].includes(v.move ?? ''));
    // AIアシスタント：ふわふわ浮かぶ
    if (this.buddy) {
      this.buddy.visible = !this.buddyAway;
      // 少し遅れてついてくる
      const k = 1 - Math.exp(-dt * 6);
      const bp = this.buddy.position;
      bp.x += (-v.facing * 0.55 - (v.x - this.prevX) * 0.6 - bp.x) * k;
      bp.y += (1.95 * def.scale + Math.sin(time * 3) * 0.08 - bp.y) * k;
      bp.z = 0.1;
      this.buddy.rotation.y = Math.sin(time * 1.5) * 0.4;
    }
    // ポーズをいきなり切り替えず、ばねのように追いかけてなめらかにする（攻撃中は速く追いかける）
    const p = this.smooth(target0, dt, v.state === 'attack');
    this.updateSwings(v, p, time, dt);
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
    const special = v.state === 'attack' && v.move ? moveOf(def.id, v.move, this.job).special : undefined;
    const smugType = def.id === 'guard' || def.id === 'hacker' || def.id === 'thief' || def.id === 'ai';
    if (acting) this.setExpression('happy', 'open', false);
    else if (this.victory || this.fancyIdle) this.setExpression(smugType ? 'smug' : 'happy', smugType ? 'smile' : 'open', false);
    else if (v.state === 'hitstun' || v.state === 'shieldbreak' || v.state === 'helpless' || v.state === 'grabbed') this.setExpression('hurt', 'open', false);
    else if (v.state === 'sleep' || blinking) this.setExpression('closed', 'line', false);
    // 課金・倍速・吸収などの「強化」はドヤ顔
    else if (special === 'pay' || special === 'speedup' || special === 'absorb' || special === 'drone' || special === 'armor' || special === 'jobchange') this.setExpression('smug', 'smile', false);
    else if (special === 'taunt') this.setExpression(smugType ? 'smug' : 'happy', 'open', false);
    else if (v.state === 'attack') this.setExpression('angry', v.move === 'smash' || v.move === 'charge' || (v.move ?? '').endsWith('special') || (v.move ?? '').endsWith('throw') ? 'open' : 'line', false);
    // ピンチ（崖につかまっている・%が高い）は焦り顔と汗
    else if (v.state === 'ledge' || v.damage >= 100) this.setExpression('panic', 'open', false);
    // スマホを見ている待機（ドパガキ・ガチャ廃人）は、目線を手元に
    else if ((v.state === 'idle' || v.state === 'respawn') && (def.id === 'dopa' || def.id === 'gacha')) this.setExpression('look', 'line', tired);
    else this.setExpression('normal', 'line', tired);

    // ガード
    const shielding = v.state === 'shield';
    this.shieldMesh.visible = shielding;
    if (shielding) this.shieldMesh.scale.setScalar((0.55 + 0.6 * v.shield) * def.scale);

    // 無敵の点滅・溜めの発光・回避や透明化・毒
    const md = v.state === 'attack' && v.move ? moveOf(def.id, v.move, this.job) : null;
    const invisible = md?.special === 'invis' && v.moveFrame >= Math.round(md.startup * def.frameMul) && v.moveFrame < Math.round(md.startup * def.frameMul) + md.active;
    const flash = v.invuln && !invisible && Math.floor(time * 20) % 2 === 0;
    const charging = v.charge > 0;
    const ghost = v.state === 'dodge' || v.state === 'airdodge' || invisible;
    const helpless = v.state === 'helpless';
    const poisoned = v.poison && Math.floor(time * 6) % 2 === 0;
    const opacity = this.ghost > 0 ? this.ghost : invisible ? 0.12 : ghost ? 0.45 : 1;
    // 倍速（青）・課金（赤）・吸収済み（水色）は、体がほんのり光る
    const pulse = 0.5 + 0.5 * Math.sin(time * 10);
    // プロテイン（ひるまない）はオレンジ
    const fxGlow = v.fx & FX_POWER ? 0x5a1010 : v.fx & FX_CHARGED ? 0x0a4a5a : v.fx & FX_ARMOR ? 0x5a2a00 : v.fx & FX_SPEED ? 0x10305a : 0;
    for (const m of this.mats) {
      m.emissive.setHex(flash ? 0x555555 : charging ? 0xffaa00 : poisoned ? 0x5a1a7a : helpless ? 0x220022 : fxGlow);
      m.emissiveIntensity = charging ? 0.12 + 0.1 * Math.sin(time * 30) : fxGlow && !flash && !poisoned ? 0.6 + 0.6 * pulse : 1;
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
    for (const m of this.glowMats) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
    for (const e of this.eyePatches) e.mat.opacity = opacity;
    this.outlineMat.transparent = opacity < 1;
    this.outlineMat.opacity = opacity;
    this.outlineMat.visible = opacity > 0.3;
    this.halo.visible = v.state === 'respawn';
    this.updateFx(time, opacity > 0.5);
    if (this.hideEyes) for (const e of this.eyePatches) e.mat.visible = false;
    this.marker.visible = !invisible && this.previewTurn === null && this.showMarker;
    this.marker.position.y = 2.25 * def.scale + Math.sin(time * 4) * 0.05;
  }

  /** ばねのように目標のポーズを追いかける（少し行き過ぎて戻るので、動きに余韻が出る） */
  private smooth(t: Pose, dt: number, snappy: boolean): Pose {
    if (!this.cur) {
      this.cur = { ...t };
      return this.cur;
    }
    const c = this.cur;
    const w = snappy ? 62 : 30;
    const z = snappy ? 0.62 : 0.75;
    const h = Math.min(dt, 1 / 20);
    const n = Math.max(1, Math.ceil(h / (1 / 120)));
    const st = h / n;
    for (const k of SPRING_KEYS) {
      let x = c[k];
      let vel = this.vel[k] ?? 0;
      const goal = t[k];
      for (let i = 0; i < n; i++) {
        vel += (w * w * (goal - x) - 2 * z * w * vel) * st;
        x += vel * st;
      }
      c[k] = x;
      this.vel[k] = vel;
    }
    // 回転：くるくる回る動き（空中攻撃・ふっとび）はそのまま、体のひねり程度ならなめらかに
    for (const k of ['spinY', 'spinZ'] as const) {
      const fast = Math.abs(t[k] - this.prevSpin[k]) > 0.15 || Math.abs(t[k] - c[k]) > 1.2;
      this.prevSpin[k] = t[k];
      if (fast) c[k] = t[k];
      else c[k] += (t[k] - c[k]) * (1 - Math.exp(-h * (snappy ? 30 : 18)));
    }
    return c;
  }

  /** 揺れもの：体の加速・傾きの変化で揺れて、ばねで戻る */
  private updateSwings(v: ViewFighter, p: Pose, time: number, dt: number): void {
    const h = Math.max(1 / 240, Math.min(dt, 1 / 20));
    let vx = (v.x - this.prevX) / h;
    let vy = (v.y - this.prevY) / h;
    // 復活・入れ替えなどの瞬間移動では揺らさない
    if (Math.abs(v.x - this.prevX) > 1.5 || Math.abs(v.y - this.prevY) > 1.5) {
      vx = this.prevVx;
      vy = this.prevVy;
    }
    const ax = (vx - this.prevVx) / h;
    const ay = (vy - this.prevVy) / h;
    const dLean = (p.lean - this.prevLean) / h;
    this.prevX = v.x;
    this.prevY = v.y;
    this.prevVx = vx;
    this.prevVy = vy;
    this.prevLean = p.lean;
    const fwdAcc = ax * v.facing;
    for (const s of this.swings) {
      const drive = Math.max(-40, Math.min(40, fwdAcc * 0.05 + ay * 0.02 + dLean * 0.8)) * s.amt;
      const steps = Math.max(1, Math.ceil(h / (1 / 120)));
      const st = h / steps;
      for (let i = 0; i < steps; i++) {
        s.vel += (drive - 140 * s.ang - 9 * s.vel) * st;
        s.ang += s.vel * st;
      }
      s.ang = Math.max(-0.7, Math.min(0.7, s.ang));
      // 何もしていなくても、ほんの少しゆらゆら
      s.g.rotation.x = s.ang + Math.sin(time * 2.2 + s.phase) * 0.04 * s.amt;
      s.g.rotation.z = Math.sin(time * 1.7 + s.phase) * 0.03 * s.amt;
    }
  }

  private victory = false;
  /** 結果画面で勝ったときのポーズ */
  setVictory(on: boolean): void {
    this.victory = on;
  }

  /** タップしたときのアクション：前半はくるっと回って跳ね、後半はキャラごとの決めポーズ */
  private actionPose(id: string, time: number): Pose {
    const e = 1.4 - this.actionT; // 経過時間
    if (e < 0.55) {
      const k = e / 0.55;
      const p = basePose();
      p.bob = Math.sin(k * Math.PI) * 0.45;
      p.squash = k < 0.15 ? 0.82 : 1.08;
      p.armL = UP * 0.8;
      p.armR = UP * 0.8;
      p.armLz = 0.5;
      p.armRz = -0.5;
      p.legL = -0.4;
      p.legR = 0.3;
      if (this.actionKind === 0) p.spinY = k * Math.PI * 2;
      else p.spinZ = Math.sin(k * Math.PI * 2) * 0.25;
      return p;
    }
    const p = this.victoryPose(id, time);
    if (e < 0.7) p.squash = 0.86; // 着地
    return p;
  }

  /** SSR衣装の特別な待機モーション（衣装一覧で見せる） */
  private fancyPose(id: string, time: number): Pose {
    const p = basePose();
    const b = Math.sin(time * 2.2);
    const f = Math.sin(time * 6);
    switch (id) {
      case 'guard':
        // 腰に手を当てて胸を張り、ゆっくり見回す
        p.armL = 0.25;
        p.armLz = 0.85;
        p.armR = 0.25;
        p.armRz = -0.85;
        p.lean = -0.12;
        p.headTilt = -0.12;
        p.spinY = Math.sin(time * 0.7) * 0.35;
        p.bob = Math.abs(b) * 0.02;
        break;
      case 'hacker':
        // 宙に浮かび、両手を広げてデータを操る
        p.bob = 0.25 + b * 0.08;
        p.armL = FWD * 0.6 + f * 0.08;
        p.armLz = 0.9;
        p.armR = FWD * 0.6 - f * 0.08;
        p.armRz = -0.9;
        p.legL = -0.5;
        p.legR = -0.7;
        p.headTilt = 0.1;
        break;
      case 'thief':
        // 怪盗の一礼
        {
          const k = (Math.sin(time * 1.6) + 1) / 2;
          p.lean = k * 0.5;
          p.armR = FWD * 0.3 * k;
          p.armRz = 0.9 * k;
          p.armL = 0.6 * k;
          p.armLz = 0.4;
          p.headTilt = 0.2 * k;
          p.legL = -0.2 * k;
        }
        break;
      case 'streamer':
        // アイドルのダンス
        p.bob = Math.abs(Math.sin(time * 4)) * 0.1;
        p.armR = UP * 0.7 + Math.sin(time * 4) * 0.4;
        p.armRz = -0.4;
        p.armL = UP * 0.7 - Math.sin(time * 4) * 0.4;
        p.armLz = 0.4;
        p.spinY = Math.sin(time * 2) * 0.45;
        p.legL = Math.max(0, Math.sin(time * 4)) * -0.4;
        p.legR = Math.max(0, -Math.sin(time * 4)) * -0.4;
        break;
      case 'dopa':
        // くるくる回って跳ねる
        p.spinY = time * 3;
        p.bob = Math.abs(Math.sin(time * 6)) * 0.14;
        p.armR = UP * 0.8;
        p.armL = UP * 0.5 + f * 0.2;
        break;
      case 'gacha':
        // 金貨を投げ上げて喜ぶ
        p.armR = UP * (0.6 + Math.max(0, Math.sin(time * 3)) * 0.35);
        p.armL = UP * 0.4;
        p.armLz = 0.5;
        p.bob = Math.abs(Math.sin(time * 3)) * 0.08;
        p.headTilt = -0.25;
        break;
      case 'courier':
        // その場で全力ダッシュ
        p.legL = Math.sin(time * 14) * 1.1;
        p.legR = -Math.sin(time * 14) * 1.1;
        p.armL = -Math.sin(time * 14) * 1.0;
        p.armR = Math.sin(time * 14) * 1.0;
        p.lean = 0.35;
        p.bob = Math.abs(Math.cos(time * 14)) * 0.07;
        break;
      case 'threeb':
        // 3B：その場でくるくる回りながら、仕事が次々に変わる
        p.spinY = time * 2.4;
        p.bob = Math.abs(Math.sin(time * 4.8)) * 0.1;
        p.armL = UP * 0.4;
        p.armR = UP * 0.4;
        p.armLz = 0.7;
        p.armRz = -0.7;
        break;
      case 'trainer':
        // スクワットをくり返す（腕は前にそろえる）
        p.bob = -Math.abs(Math.sin(time * 2.6)) * 0.22;
        p.squash = 1 - Math.abs(Math.sin(time * 2.6)) * 0.08;
        p.armL = FWD * 0.95;
        p.armR = FWD * 0.95;
        p.legL = Math.abs(Math.sin(time * 2.6)) * 0.35;
        p.legR = Math.abs(Math.sin(time * 2.6)) * 0.35;
        p.lean = Math.abs(Math.sin(time * 2.6)) * 0.25;
        break;
      case 'ai':
        // 浮かんで目を閉じ、手のひらを上に
        p.bob = 0.3 + b * 0.06;
        p.armL = FWD * 0.5;
        p.armLz = 0.6;
        p.armR = FWD * 0.5;
        p.armRz = -0.6;
        p.legL = -0.3;
        p.legR = -0.3;
        p.headTilt = -0.15;
        break;
    }
    return p;
  }

  /** キャラごとの勝利ポーズ */
  private victoryPose(id: string, time: number): Pose {
    const p = basePose();
    const b = Math.sin(time * 8);
    const slow = Math.sin(time * 3);
    switch (id) {
      case 'guard':
        // 敬礼して胸を張る
        p.armR = UP * 0.78;
        p.armRz = 1.15;
        p.armL = 0.05;
        p.armLz = 0.1;
        p.lean = -0.08;
        p.headTilt = -0.12;
        p.bob = Math.abs(slow) * 0.02;
        break;
      case 'hacker':
        // ノートPCを掲げてガッツポーズ
        p.armL = UP * 0.85;
        p.armLz = 0.2;
        p.armR = FWD * 0.6 + b * 0.25;
        p.armRz = 0.5;
        p.bob = Math.abs(b) * 0.06;
        break;
      case 'thief':
        // USBメモリを見せびらかす
        p.armR = FWD * 1.25 + slow * 0.1;
        p.armRz = 0.3;
        p.armL = 0.3;
        p.armLz = 0.6;
        p.lean = 0.1;
        p.squash = 0.95;
        p.spinY = slow * 0.15;
        break;
      case 'streamer':
        // ピースして跳ねる
        p.armR = UP * 0.7;
        p.armRz = 0.9;
        p.armL = 0.2;
        p.armLz = 0.5;
        p.bob = Math.abs(b) * 0.14;
        p.legL = Math.max(0, b) * -0.5;
        p.headTilt = -0.15 + slow * 0.05;
        break;
      case 'dopa':
        // スマホで自撮りしながら跳ねる
        p.armR = UP * 0.75;
        p.armRz = -0.2;
        p.armL = UP * 0.4 + b * 0.3;
        p.bob = Math.abs(Math.sin(time * 11)) * 0.15;
        p.headTilt = -0.2;
        break;
      case 'gacha':
        // 両手を上げて大喜び
        p.armR = UP * 0.95 + b * 0.15;
        p.armL = UP * 0.95 - b * 0.15;
        p.armLz = 0.3;
        p.armRz = -0.3;
        p.bob = Math.abs(b) * 0.16;
        p.headTilt = -0.25;
        break;
      case 'courier':
        // 親指を立てる
        p.armR = FWD * 1.0;
        p.armRz = 0.25;
        p.armL = 0.3;
        p.armLz = 0.55;
        p.bob = Math.abs(slow) * 0.03;
        p.lean = -0.05;
        break;
      case 'threeb':
        // 3B：仕事ごとの決めポーズ（美容師はハサミを顔の横に、バンドマンは拳を突き上げ、バーテンダーは一礼）
        if (this.job === 0) {
          p.armR = FWD * 1.35;
          p.armRz = 0.55;
          p.armL = 0.3;
          p.armLz = 0.5;
          p.headTilt = -0.1;
          p.lean = -0.05 + Math.sin(time * 2) * 0.02;
        } else if (this.job === 1) {
          p.armR = UP * (0.95 + Math.max(0, Math.sin(time * 5)) * 0.05);
          p.armL = 0.3;
          p.armLz = 0.4;
          p.headTilt = 0.25 * Math.abs(Math.sin(time * 5));
          p.bob = Math.abs(Math.sin(time * 5)) * 0.06;
        } else {
          p.lean = 0.35 + Math.sin(time * 1.5) * 0.03;
          p.armR = FWD * 0.6;
          p.armRz = 0.75;
          p.armL = -0.3;
          p.armLz = 0.25;
          p.headTilt = 0.15;
        }
        break;
      case 'trainer':
        // 両腕を上げて力こぶ（ダブルバイセップス）。ぐっと力を入れるたびに体が締まる
        p.armL = UP * 0.55;
        p.armLz = 1.05;
        p.armR = UP * 0.55;
        p.armRz = -1.05;
        p.lean = -0.08;
        p.squash = 1 - Math.max(0, Math.sin(time * 4)) * 0.05;
        p.headTilt = -0.12;
        break;
      case 'ai':
        // メガネ（ヘッドセット）に手を当ててきめる
        p.armR = FWD * 1.4;
        p.armRz = 0.75;
        p.armL = 0.15;
        p.armLz = 0.35;
        p.headTilt = -0.1 + slow * 0.04;
        break;
      default:
        p.bob = Math.abs(b) * 0.12;
        p.armR = UP * 0.9 + b * 0.2;
        p.armL = 0.3 - b * 0.3;
        p.armLz = 0.6;
        p.legL = b * 0.3;
        p.legR = -b * 0.3;
        p.headTilt = -0.1;
    }
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
        p.legL = c * 1.05;
        p.legR = -c * 1.05;
        p.armL = -c * 0.95;
        p.armR = c * 0.95;
        p.armLz = 0.2;
        p.armRz = -0.2;
        p.lean = 0.3;
        p.bob = Math.abs(Math.cos(t * 0.42)) * 0.07;
        p.squash = 1 - Math.abs(Math.cos(t * 0.42)) * 0.04;
        p.headTilt = -0.08;
        break;
      }
      case 'air':
        if (t < 7) {
          // 跳んだ直後は体が伸びる
          p.squash = 1.12;
          p.legL = -0.2;
          p.legR = 0.1;
          p.armL = 0.3;
          p.armR = -0.3;
          break;
        }
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
        if (t < 5) p.squash = 0.84; // 当たった瞬間につぶれる
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
      case 'grab':
        // つかんでいる：両手を前に出して相手を押さえる
        p.armR = FWD * 0.95;
        p.armL = FWD * 0.95;
        p.armLz = 0.25;
        p.armRz = -0.25;
        p.lean = 0.15;
        p.legL = -0.25;
        p.legR = 0.25;
        break;
      case 'grabbed':
        // つかまれている：じたばたする
        p.armL = UP * 0.45 + Math.sin(time * 22) * 0.35;
        p.armR = UP * 0.4 - Math.sin(time * 22) * 0.35;
        p.legL = Math.sin(time * 18) * 0.4;
        p.legR = -Math.sin(time * 18) * 0.4;
        p.lean = -0.25;
        p.headTilt = -0.2;
        p.bob = 0.12;
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
      case 'dopa': {
        // 胸の前のスマホを見下ろして、親指でスクロール。片手はだらんと下げて、足でリズム
        const scroll = Math.max(0, Math.sin(time * 4)) ** 3;
        p.armR = FWD * 0.78 - scroll * 0.06;
        p.armRz = 0.42;
        p.armL = 0.08;
        p.armLz = 0.12;
        p.headTilt = 0.22;
        p.legL = Math.max(0, Math.sin(time * 10)) * -0.2;
        break;
      }
      case 'gacha':
        // 両手でスマホを持って画面を連打。眠そうにふらふら
        p.armR = FWD * 0.8 + Math.sin(time * 30) * 0.025;
        p.armRz = 0.45;
        p.armL = FWD * 0.74;
        p.armLz = -0.42;
        p.headTilt = 0.24;
        p.lean = Math.sin(time * 1.1) * 0.05;
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
      case 'threeb':
        if (this.job === 0) {
          // 美容師：指でハサミのしぐさ
          p.armR = FWD * 0.75 + Math.sin(time * 6) * 0.05;
          p.armRz = 0.3;
          p.armL = 0.3;
          p.armLz = 0.5;
        } else if (this.job === 1) {
          // バンドマン：リズムに乗ってヘッドバンギング
          p.headTilt = Math.max(0, Math.sin(time * 6)) * 0.3;
          p.bob = Math.abs(Math.sin(time * 6)) * 0.04;
          p.armL = 0.15;
          p.armR = -0.15;
        } else {
          // バーテンダー：グラスを磨く
          p.armR = FWD * 0.7;
          p.armRz = 0.4 + Math.sin(time * 5) * 0.12;
          p.armL = FWD * 0.65;
          p.armLz = -0.4;
          p.headTilt = 0.12;
        }
        break;
      case 'trainer':
        // 軽く弾みながら、腕をぐるぐる回してウォームアップ
        p.bob = Math.abs(Math.sin(time * 5)) * 0.04;
        p.armR = Math.sin(time * 3) * 1.2;
        p.armL = 0.2;
        p.armLz = 0.45;
        p.armRz = -0.2;
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
    const md = moveOf(def.id, v.move, this.job);
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
        // データ泥棒・3B（美容師・バーテンダー）は回りながら上がる
        if (def.id === 'thief' || (def.id === 'threeb' && this.job !== 1)) p.spinY = f * 0.6;
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
        p.armR = FWD * 0.85;
        p.armRz = 0.4;
        p.armL = FWD * 0.75;
        p.armLz = -0.4;
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
      case 'curl':
        if (def.id === 'threeb') {
          // 爆音ソロ：ギターを構えてかき鳴らし（溜め中は激しく）、鳴らす瞬間にのけぞる
          const strum = Math.sin(v.stateTime * 1.6) * 0.25;
          p.armR = FWD * 0.6 + (f < s || v.charge > 0 ? strum : 0);
          p.armRz = 0.3;
          p.armL = FWD * 0.7;
          p.armLz = -0.6;
          p.lean = f < s || v.charge > 0 ? 0.15 : -0.35 * k;
          p.headTilt = f < s || v.charge > 0 ? 0.2 + strum * 0.4 : -0.3 * k;
          p.legL = 0.35;
          p.legR = -0.35;
          return;
        }
        if (v.charge > 0 || f < s) {
          // ダンベルを胸の前に持ち上げて溜める（溜まるほど震える）
          const shake = Math.sin(v.stateTime * 2.3) * 0.05 * Math.min(1, v.charge / 40);
          p.armR = FWD * 0.35 + shake;
          p.armRz = 0.25;
          p.armL = 0.4;
          p.armLz = 0.3;
          p.lean = -0.15;
          p.squash = 0.92;
          p.legL = 0.3;
          p.legR = -0.3;
        } else {
          p.armR = lerp(FWD * 0.35, FWD * 1.2, Math.min(1, k * 1.6));
          p.armRz = 0;
          p.lean = 0.5 * k;
          p.legL = -0.6 * k;
          p.legR = 0.5 * k;
        }
        return;
      case 'jobchange':
        // くるっと回って着替える
        p.spinY = Math.min(1, f / (s + a)) * Math.PI * 2;
        p.armL = UP * 0.4;
        p.armR = UP * 0.4;
        p.armLz = 0.8;
        p.armRz = -0.8;
        p.bob = Math.sin(Math.min(1, f / (s + a)) * Math.PI) * 0.2;
        return;
      case 'rush':
        // シザーラッシュ：ハサミを細かく速く動かす
        p.armR = FWD * (0.85 + Math.sin(f * 1.7) * 0.18);
        p.armRz = Math.sin(f * 1.3) * 0.35;
        p.armL = FWD * 0.4;
        p.armLz = -0.3;
        p.lean = 0.2;
        return;
      case 'dive':
        // ステージダイブ：体を横にして飛び込む
        p.lean = 1.1 * k;
        p.armL = FWD * 1.1;
        p.armR = FWD * 1.1;
        p.armLz = -0.5;
        p.armRz = 0.5;
        p.legL = 0.3;
        p.legR = -0.2;
        return;
      case 'bottle':
        // フレアボトル：ボトルをくるっと回してから振り下ろす
        p.armR = f < s ? UP * 0.9 : lerp(UP * 0.9, FWD * 0.9, k);
        p.armRz = f < s ? Math.sin(f * 0.9) * 0.6 : 0;
        p.armL = 0.4;
        p.armLz = 0.5;
        p.lean = 0.3 * k;
        return;
      case 'slide':
        // スライド：のけぞりながら足から滑り込む
        p.lean = -0.55 * k;
        p.legR = FWD * 1.0 * k;
        p.legL = 0.5 * k;
        p.armL = 0.9;
        p.armR = 0.6;
        p.bob = -0.25 * k;
        return;
      case 'tackle':
        // 体を低くして突っ込む
        p.lean = 0.85 * k;
        p.armL = FWD * 0.9;
        p.armR = FWD * 0.9;
        p.armLz = -0.35;
        p.armRz = 0.35;
        p.legL = Math.sin(f * 0.9) * 0.8 * k;
        p.legR = -Math.sin(f * 0.9) * 0.8 * k;
        p.headTilt = 0.15;
        return;
      case 'slam':
        // 両手を上げて飛び上がり、つかんだ相手を頭上にかかえる
        p.armR = UP;
        p.armL = UP;
        p.armLz = 0.25;
        p.armRz = -0.25;
        p.legL = -0.5;
        p.legR = 0.2;
        p.headTilt = -0.15;
        return;
      case 'armor':
        // プロテインを一気に飲む
        p.armR = f < s ? UP * 0.62 : lerp(0.4, UP * 0.62, k);
        p.armRz = 0.35;
        p.armL = 0.3;
        p.armLz = 0.55;
        p.headTilt = -0.35 * Math.min(1, f / 6);
        p.lean = -0.1;
        return;
      case 'taunt':
        // アピール：キャラごとの決めポーズ
        Object.assign(p, this.victoryPose(def.id, v.moveFrame / 60 + 0.3));
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
      case 'charge':
        if (v.charge > 0 || f < s) {
          // 溜め：大きく振りかぶって、溜まるほど体が震える
          const shake = Math.sin(v.stateTime * 2.1) * 0.04 * Math.min(1, v.charge / 45);
          p.armR = 1.35;
          p.armRz = -0.35;
          p.armL = FWD * 0.5;
          p.lean = -0.3 + shake;
          p.legL = 0.35;
          p.legR = -0.35;
          p.squash = 0.9;
        } else {
          // 解放：体ごと踏み込んで殴る
          p.armR = lerp(1.35, FWD * 1.2, Math.min(1, k * 1.6));
          p.armL = lerp(FWD * 0.5, -0.6, k);
          p.lean = 0.55 * k;
          p.legL = -0.7 * k;
          p.legR = 0.6 * k;
          p.spinY = -0.35 * (1 - k);
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
      case 'pummel':
        // つかみ攻撃：つかんだまま頭突き
        p.armR = FWD * 0.95;
        p.armL = FWD * 0.95;
        p.lean = 0.15 + 0.35 * k;
        p.headTilt = 0.3 * k;
        break;
      case 'fthrow':
        // 前投げ：両手で突き飛ばす
        p.armR = lerp(FWD * 0.6, FWD * 1.15, k);
        p.armL = lerp(FWD * 0.6, FWD * 1.15, k);
        p.lean = lerp(-0.2, 0.45, k);
        p.legL = -0.5 * k;
        p.legR = 0.4 * k;
        break;
      case 'bthrow':
        // 後ろ投げ：ぐるっと回って後ろへ投げる
        p.armR = FWD * 0.9;
        p.armL = FWD * 0.9;
        // （向きは投げる瞬間に反転するので、ここでは振りかぶりのひねりだけ）
        p.spinY = f < s ? -Math.sin((f / s) * Math.PI) * 0.9 * v.facing : 0;
        p.lean = 0.2;
        break;
      case 'uthrow':
        // 上投げ：持ち上げて放り投げる
        p.armR = lerp(FWD * 0.8, UP, k);
        p.armL = lerp(FWD * 0.8, UP, k);
        p.lean = -0.2 * k;
        p.squash = f < s ? 1 - wind * 0.1 : 1;
        break;
      case 'dthrow':
        // 下投げ：地面にたたきつける
        p.armR = lerp(UP * 0.7, FWD * 0.3, k);
        p.armL = lerp(UP * 0.7, FWD * 0.3, k);
        p.lean = 0.5 * k;
        p.squash = 1 - 0.12 * k;
        break;
    }
    // キャラごとの通常技の動き（道具を使う・蹴るなど）
    this.attackStyle(def.id, v, s, a, e, p);
    // 予備動作：出す前に少し体を引く
    if (f < s && (v.move === 'jab' || v.move === 'side' || v.move === 'up' || v.move === 'down')) {
      p.lean -= 0.15 * wind;
      p.squash *= 1 - 0.05 * wind;
    }
  }

  /**
   * キャラごとの通常技の動き。振りかぶり・当てる瞬間・戻りのポーズを決めるだけで、
   * 間のつながりはばね（smooth）がなめらかにする。技の当たり判定は全キャラ共通のまま。
   */
  private attackStyle(id: string, v: ViewFighter, s: number, a: number, e: number, p: Pose): void {
    const f = v.moveFrame;
    const charging = v.charge > 0;
    const wind = f < s || charging; // 振りかぶり中
    const rec = f >= s + a ? Math.min(1, (f - s - a) / e) : 0; // 戻り（0→1）
    const hold = 1 - rec * rec; // 当てたポーズをしばらく保ってから戻す
    const m = v.move;
    if (m !== 'jab' && m !== 'side' && m !== 'smash' && m !== 'charge') return;
    const strong = m === 'smash' || m === 'charge';
    switch (id) {
      case 'guard':
        // 警棒：弱は突き、横・スマッシュは振り下ろし
        if (m === 'jab') {
          p.armR = wind ? 0.2 : FWD * 1.05 * hold;
          p.lean = wind ? -0.05 : 0.2 * hold;
        } else {
          p.armR = wind ? UP * 1.08 : FWD * 0.65 * hold;
          p.armRz = -0.15;
          p.armL = wind ? FWD * 0.4 : 0.4;
          p.lean = wind ? -0.25 : (strong ? 0.55 : 0.35) * hold;
          p.squash = wind ? 0.94 : 1 - 0.08 * hold;
          p.legL = wind ? 0.2 : -0.5 * hold;
          p.legR = wind ? -0.2 : 0.4 * hold;
        }
        return;
      case 'hacker':
        // 左手のノートPCで殴る（弱は押し出し、横は横なぎ、スマッシュは振り下ろし）
        p.armR = 0.3;
        if (m === 'jab') {
          p.armL = wind ? FWD * 0.4 : FWD * 1.05 * hold;
          p.armLz = 0;
        } else if (m === 'side') {
          p.armL = FWD * 0.9;
          p.armLz = wind ? 1.2 : -0.6 * hold;
          p.lean = wind ? -0.1 : 0.3 * hold;
          p.spinY = wind ? 0.35 : -0.25 * hold;
        } else {
          p.armL = wind ? UP * 1.05 : FWD * 0.6 * hold;
          p.armR = wind ? UP * 1.05 : FWD * 0.6 * hold;
          p.lean = wind ? -0.25 : 0.5 * hold;
          p.squash = wind ? 0.93 : 1 - 0.08 * hold;
        }
        return;
      case 'thief':
        // USBメモリで素早く突く。踏み込みが深い
        p.armR = wind ? 0.5 : FWD * 1.15 * hold;
        p.armL = wind ? FWD * 0.3 : 0.6 * hold;
        p.lean = wind ? -0.05 : (strong ? 0.7 : m === 'side' ? 0.55 : 0.35) * hold;
        p.legL = wind ? 0.1 : (strong ? -0.9 : -0.6) * hold;
        p.legR = wind ? -0.1 : 0.6 * hold;
        p.squash = wind ? 0.9 : 1 - 0.06 * hold;
        return;
      case 'streamer':
        // 自撮り棒をバットのように振る
        if (m === 'jab') {
          p.armR = wind ? 0.3 : FWD * 0.9 * hold;
          p.armRz = wind ? -0.6 : 0.3 * hold;
        } else {
          p.armR = wind ? (strong ? UP * 1.0 : 0.9) : FWD * (strong ? 0.6 : 0.85) * hold;
          p.armRz = wind ? -1.1 : 0.5 * hold;
          p.armL = wind ? FWD * 0.5 : 0.3;
          p.spinY = wind ? 0.4 : -0.35 * hold;
          p.lean = wind ? -0.15 : 0.35 * hold;
        }
        return;
      case 'dopa':
        // 弱はスマホで小突く、横は裏拳、スマッシュは跳び蹴り
        if (m === 'jab') {
          p.armR = wind ? FWD * 0.6 : FWD * 1.1 * hold;
        } else if (m === 'side') {
          p.armR = FWD * 0.9;
          p.armRz = wind ? -1.2 : 0.7 * hold;
          p.spinY = wind ? -0.4 : 0.45 * hold;
          p.lean = 0.2;
        } else {
          p.legL = wind ? 0.3 : FWD * 0.9 * hold;
          p.legR = wind ? -0.3 : FWD * 0.6 * hold;
          p.lean = wind ? 0.15 : -0.45 * hold;
          p.bob = wind ? 0 : 0.16 * hold;
          p.armL = UP * 0.4;
          p.armR = UP * 0.3;
        }
        return;
      case 'gacha':
        // 弱・横はだるそうにスマホを振る、スマッシュはカプセルをたたきつける
        if (strong) {
          p.armR = wind ? UP * 1.1 : FWD * 0.55 * hold;
          p.armL = wind ? UP * 0.9 : FWD * 0.5 * hold;
          p.lean = wind ? -0.3 : 0.55 * hold;
          p.squash = wind ? 0.92 : 1 - 0.1 * hold;
        } else {
          p.armR = wind ? 0.4 : FWD * (m === 'side' ? 1.0 : 0.9) * hold;
          p.armRz = m === 'side' ? (wind ? -0.8 : 0.5 * hold) : 0;
          p.lean = wind ? 0.05 : 0.25 * hold;
          p.headTilt = 0.2;
        }
        return;
      case 'courier':
        // 足技：弱はひざ蹴り、横は前蹴り、スマッシュは回し蹴り
        p.armL = FWD * 0.5;
        p.armR = FWD * 0.4;
        p.armLz = -0.3;
        p.armRz = 0.3;
        if (m === 'jab') {
          p.legR = wind ? 0.2 : FWD * 0.7 * hold;
          p.bob = wind ? 0 : 0.04 * hold;
        } else if (m === 'side') {
          p.legR = wind ? 0.4 : FWD * 1.15 * hold;
          p.lean = wind ? 0.1 : -0.3 * hold;
        } else {
          p.legR = wind ? 0.5 : FWD * 1.25 * hold;
          p.lean = wind ? 0.15 : -0.4 * hold;
          p.spinY = wind ? 0.5 : -0.3 * hold;
          p.armL = 0.5;
          p.armR = -0.5;
        }
        return;
      case 'trainer':
        // 弱はジャブ、横はラリアット、スマッシュ・溜めはダンベルを振り下ろす
        if (m === 'jab') {
          p.armR = wind ? 0.1 : FWD * 1.1 * hold;
          p.lean = wind ? -0.05 : 0.2 * hold;
        } else if (m === 'side') {
          p.armR = FWD * 0.15;
          p.armRz = wind ? 0.2 : -1.45 * hold;
          p.spinY = wind ? 0.6 : -0.5 * hold;
          p.lean = 0.2 * hold;
        } else {
          p.armR = wind ? UP * 1.1 : FWD * 0.7 * hold;
          p.armL = wind ? UP * 0.9 : FWD * 0.4 * hold;
          p.lean = wind ? -0.3 : 0.6 * hold;
          p.squash = wind ? 0.92 : 1 - 0.1 * hold;
        }
        return;
      case 'ai':
        // 弱は手のひらで押す、横・スマッシュはホログラムの剣で斬る
        if (m === 'jab') {
          p.armR = wind ? FWD * 0.5 : FWD * 1.05 * hold;
          p.armRz = 0.2;
        } else if (m === 'side') {
          p.armR = FWD * 0.9;
          p.armRz = wind ? -1.25 : 0.65 * hold;
          p.spinY = wind ? 0.35 : -0.3 * hold;
          p.lean = 0.2 * hold;
        } else {
          p.armR = wind ? UP * 1.05 : FWD * 0.6 * hold;
          p.armL = wind ? UP * 1.0 : FWD * 0.55 * hold;
          p.lean = wind ? -0.25 : 0.5 * hold;
          p.squash = wind ? 0.93 : 1 - 0.08 * hold;
        }
        return;
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.mats) m.dispose();
    for (const m of this.glowMats) m.dispose();
    if (this.fxState) {
      (this.fxState.pts.material as THREE.Material).dispose();
      (this.fxState.aura.material as THREE.Material).dispose();
      if (this.fxState.glow) (this.fxState.glow.material as THREE.Material).dispose();
    }
    this.outlineMat.dispose();
  }
}
