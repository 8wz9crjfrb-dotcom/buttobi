// 飛び道具・置かれる物（壁・罠・広告ウィンドウ）・状態表示（Zzz）の見た目

import * as THREE from 'three';
import { ITEM_COLORS, ITEM_INFO, SLOT_COLORS } from '../shared/characters';
import { POPUP, TRAP, WALL } from '../shared/moves';
import { FX_ATK_DOWN, FX_ATK_UP, FX_CONFUSED, FX_SPD_DOWN, FX_SPD_UP, type ViewState } from '../shared/types';
import { drawBuff, whenBuffDrawn } from './buffIcons';
import { heartGeometry } from './heartShape';

/** 文字や絵を描いたテクスチャ */
function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';

export class PropRenderer {
  private pools = new Map<string, THREE.Object3D[]>();
  private textures: THREE.Texture[] = [];
  private zzzTex: THREE.CanvasTexture;
  private zzz = new Map<number, THREE.Sprite>();
  private qTex: THREE.CanvasTexture;
  private question = new Map<number, THREE.Sprite>();
  /** 攻撃力・スピードの上がり下がりの目印（剣・ブーツに↑↓） */
  private buffTex: Record<string, THREE.CanvasTexture> = {};
  private debuffs = new Map<string, THREE.Sprite>();
  private bubbles: { mesh: THREE.Mesh; life: number }[] = [];
  private texts: { sprite: THREE.Sprite; life: number; max: number; still?: boolean }[] = [];

  constructor(private scene: THREE.Scene) {
    this.zzzTex = canvasTexture(128, 64, (g) => {
      g.font = `bold 44px ${FONT}`;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#3a3a8a';
      g.lineWidth = 8;
      g.strokeText('Zzz', 10, 48);
      g.fillText('Zzz', 10, 48);
    });
    this.qTex = canvasTexture(64, 64, (g) => {
      g.font = `bold 54px ${FONT}`;
      g.fillStyle = '#ffd23f';
      g.strokeStyle = '#3a2a00';
      g.lineWidth = 8;
      g.strokeText('?', 16, 52);
      g.fillText('?', 16, 52);
    });
    for (const kind of ['atk', 'spd'] as const) {
      for (const up of [true, false]) {
        const tex = canvasTexture(64, 64, (g) => drawBuff(g, kind, up));
        this.buffTex[`${kind}${up ? 'Up' : 'Down'}`] = tex;
        this.textures.push(tex);
      }
    }
    whenBuffDrawn(() => Object.values(this.buffTex).forEach((t) => (t.needsUpdate = true)));
    this.textures.push(this.zzzTex, this.qTex);
  }

  /** 吹き出し（アピールのセリフ）。キャラの頭の上に出て、しばらくして消える */
  showBubble(text: string, x: number, y: number): void {
    const size = 40;
    const W = Math.max(256, Math.ceil((text.length * size + 60) / 64) * 64);
    const tex = canvasTexture(W, 112, (g) => {
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#1b1b28';
      g.lineWidth = 6;
      g.beginPath();
      g.roundRect(6, 6, W - 12, 78, 30);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(W / 2 - 14, 82);
      g.lineTo(W / 2, 104);
      g.lineTo(W / 2 + 14, 82);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillRect(W / 2 - 12, 76, 24, 8);
      g.fillStyle = '#1b1b28';
      g.font = `900 ${size}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(text, W / 2, 60);
    });
    // 白を少し暗くして、夜のステージで光のにじみがかからないようにする（読めるように）
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, color: 0xcfcfcf }));
    const h = 0.95;
    sprite.scale.set((h * W) / 112, h, 1);
    sprite.position.set(x, y, 1);
    sprite.renderOrder = 10; // ほかの物より手前に描く
    this.scene.add(sprite);
    this.texts.push({ sprite, life: 100, max: 100, still: true });
  }

  /** 浮かんで消える文字（ガチャの結果など） */
  showText(text: string, color: string, x: number, y: number, big = false, life = 70, warn = false): void {
    const size = big ? 64 : 48;
    // 注意の三角（絵文字ではなく自分で描く）の分だけ左を空ける
    const icon = warn ? size * 1.1 : 0;
    // 文字数に合わせて横幅を決める（長い文字が切れないように）
    const W = Math.max(256, Math.ceil((text.length * size + 30 + icon) / 64) * 64);
    const tex = canvasTexture(W, 96, (g) => {
      g.font = `900 ${size}px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = 10;
      g.strokeStyle = '#1b1b28';
      if (warn) {
        // 文字の幅を測って、三角を文字の左に置く
        const tw = g.measureText(text).width;
        const cx = W / 2 + icon / 2 - tw / 2 - size * 0.55;
        const s = size * 0.5;
        g.beginPath();
        g.moveTo(cx, 70 - s * 1.55);
        g.lineTo(cx + s, 70 + s * 0.2);
        g.lineTo(cx - s, 70 + s * 0.2);
        g.closePath();
        g.lineJoin = 'round';
        g.stroke();
        g.fillStyle = '#ffd23f';
        g.fill();
        g.fillStyle = '#1b1b28';
        g.fillRect(cx - s * 0.1, 70 - s * 1.0, s * 0.2, s * 0.62);
        g.fillRect(cx - s * 0.1, 70 - s * 0.26, s * 0.2, s * 0.2);
        g.translate(icon / 2, 0);
      }
      g.strokeText(text, W / 2, 70);
      if (color === 'rainbow') {
        const grad = g.createLinearGradient(20, 0, W - 20, 0);
        ['#ff5a5a', '#ffd23f', '#4fd18b', '#4f9dff', '#c77dff'].forEach((c, i) => grad.addColorStop(i / 4, c));
        g.fillStyle = grad;
      } else g.fillStyle = color;
      g.fillText(text, W / 2, 70);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, color: 0xd6d6d6 }));
    const h = big ? 1.12 : 0.82;
    sprite.scale.set((h * W) / 96, h, 1);
    sprite.renderOrder = 10;
    sprite.position.set(x, y, 1);
    this.scene.add(sprite);
    // 注意の文字はその場にとどめる（上へ流れて画面の外に出ないように）
    this.texts.push({ sprite, life, max: life, still: warn });
  }

  // ---------------------------------------------------------------- 部品の作り方
  private make(kind: string, owner: number): THREE.Object3D {
    const color = SLOT_COLORS[owner % SLOT_COLORS.length];
    const basic = (c: number, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: c, ...extra });
    switch (kind) {
      case 'text': {
        // 利用規約の看板
        const tex = canvasTexture(256, 192, (g) => {
          g.fillStyle = '#fffdf2';
          g.fillRect(0, 0, 256, 192);
          g.strokeStyle = '#2c3e75';
          g.lineWidth = 10;
          g.strokeRect(5, 5, 246, 182);
          g.fillStyle = '#2c3e75';
          g.font = `bold 40px ${FONT}`;
          g.fillText('利用規約', 46, 56);
          g.fillStyle = '#9aa3b8';
          for (let i = 0; i < 5; i++) g.fillRect(24, 80 + i * 20, 208 - (i % 2) * 40, 8);
        });
        this.textures.push(tex);
        return new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.9), basic(0xffffff, { map: tex, side: THREE.DoubleSide }));
      }
      case 'bullet':
        return new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), basic(0x39ff88));
      case 'mail': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.05), basic(0xffffff)));
        const flap = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.16, 3), basic(0xdfe6f0));
        flap.rotation.set(Math.PI / 2, 0, Math.PI);
        flap.position.set(0, 0.08, 0.03);
        flap.scale.set(1, 1, 0.2);
        g.add(flap);
        const seal = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), basic(0xe5484d));
        seal.position.set(0, 0.02, 0.04);
        g.add(seal);
        return g;
      }
      case 'malware':
        return new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshToonMaterial({ color: 0x9b4fff, emissive: 0x4a1a8a }));
      case 'thread': {
        // 赤い糸（メンヘラ）：先に小さなハートが付いた糸
        const g = new THREE.Group();
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), basic(0xff3b6c));
        line.rotation.z = Math.PI / 2;
        line.position.x = -0.45;
        g.add(line);
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), basic(0xff3b6c));
        heart.scale.set(1, 0.85, 0.5);
        g.add(heart);
        return g;
      }
      case 'phone': {
        // 鬼電（メンヘラ）：着信中の光るスマホ
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.05), new THREE.MeshToonMaterial({ color: 0xff9ec8 })));
        const screen = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.32, 0.01), basic(0xbfe8ff));
        screen.position.z = 0.03;
        g.add(screen);
        return g;
      }
      case 'heart': {
        // 重い愛のハート：大きく光るハート
        const g = new THREE.Group();
        const body = new THREE.Group();
        body.name = 'body';
        g.add(body);
        body.add(new THREE.Mesh(heartGeometry(0.8), new THREE.MeshToonMaterial({ color: 0xff4f9a, emissive: 0x7a1040 })));
        // うしろでほんのり光る
        const halo = new THREE.Mesh(heartGeometry(1.0, 0.05), basic(0xff9ec8, { transparent: true, opacity: 0.35, depthWrite: false }));
        halo.position.z = -0.4;
        body.add(halo);
        return g;
      }
      case 'leash': {
        // 赤い糸のつながり：持ち主とつながれた人の間に伸ばす（長さは毎フレーム合わせる）
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), basic(0xff3b6c, { transparent: true, opacity: 0.9 })));
        return g;
      }
      case 'call': {
        // 鬼電の印：頭の上の「着信中」の吹き出し
        const tex = canvasTexture(160, 96, (c) => {
          c.fillStyle = '#ff3b6c';
          c.beginPath();
          c.roundRect(6, 6, 148, 64, 18);
          c.fill();
          c.beginPath();
          c.moveTo(70, 68);
          c.lineTo(80, 90);
          c.lineTo(92, 68);
          c.fill();
          c.fillStyle = '#ffffff';
          c.font = `bold 34px ${FONT}`;
          c.textAlign = 'center';
          c.fillText('着信中', 80, 50);
        });
        this.textures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
        sp.scale.set(1.0, 0.6, 1);
        const g = new THREE.Group();
        g.add(sp);
        return g;
      }
      case 'coin': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.06, 18), new THREE.MeshToonMaterial({ color: 0xffd23f, emissive: 0x7a5a00 }));
        m.rotation.x = Math.PI / 2;
        const g = new THREE.Group();
        g.add(m);
        return g;
      }
      case 'thanks': {
        const tex = canvasTexture(64, 64, (g) => {
          g.font = `bold 52px ${FONT}`;
          g.fillStyle = '#ff6fae';
          g.fillText('♥', 6, 52);
        });
        this.textures.push(tex);
        return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
      }
      case 'badge': {
        // 通知バッジ
        const tex = canvasTexture(64, 64, (g) => {
          g.fillStyle = '#ff3b3b';
          g.beginPath();
          g.arc(32, 32, 28, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#fff';
          g.font = `bold 38px ${FONT}`;
          g.textAlign = 'center';
          g.fillText('1', 32, 46);
        });
        this.textures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
        sp.scale.setScalar(0.55);
        return sp;
      }
      case 'sound': {
        // 爆音ソロ（3B・バンドマン）：前へ広がる紫の音の輪
        const g = new THREE.Group();
        for (const [r, o] of [[0.32, 0.9], [0.5, 0.6], [0.68, 0.35]] as const) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 20, Math.PI * 0.9), basic(0xc77dff, { transparent: true, opacity: o }));
          ring.rotation.z = -Math.PI * 0.45;
          ring.position.x = -r * 0.6;
          g.add(ring);
        }
        return g;
      }
      case 'stone':
        return new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshToonMaterial({ color: 0x6fd0ff, emissive: 0x1a4a7a }));
      case 'gold':
        return new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), basic(0xffd23f));
      case 'bag': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.4), new THREE.MeshToonMaterial({ color: 0x2fbf71 })));
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.09, 0.41), basic(0xffffff));
        band.position.y = 0.06;
        g.add(band);
        return g;
      }
      case 'orb': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), basic(0x4fd8ff, { transparent: true, opacity: 0.55 })));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), basic(0xffffff)));
        return g;
      }
      case 'packet': {
        // データの小包（ステージギミック）
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), basic(0x39ff88, { wireframe: true })));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), basic(0x39ff88)));
        return g;
      }
      case 'laser': {
        // 赤い光の棒（進む向きに傾ける）。芯は白っぽく
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.16), basic(0xff2a3a)));
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.18), basic(0xffd0d0)));
        return g;
      }
      case 'beam':
        return new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.05, 16, 1, true), basic(0x2fe8ff, { transparent: true, opacity: 0.75, side: THREE.DoubleSide }));
      case 'comment': {
        const words = ['草', 'それな', '神', '888', 'うますぎ', 'ナイス'];
        const word = words[Math.floor(Math.random() * words.length)];
        const tex = canvasTexture(256, 72, (g) => {
          g.fillStyle = 'rgba(255,255,255,0.95)';
          g.beginPath();
          g.roundRect(4, 4, 248, 64, 20);
          g.fill();
          g.fillStyle = '#ff5ea8';
          g.font = `900 40px ${FONT}`;
          g.textAlign = 'center';
          g.fillText(word, 128, 50);
        });
        this.textures.push(tex);
        return new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.62), basic(0xffffff, { map: tex, transparent: true, side: THREE.DoubleSide }));
      }
      case 'notif': {
        const tex = canvasTexture(64, 64, (g) => {
          g.fillStyle = '#ff3b3b';
          g.beginPath();
          g.arc(32, 32, 28, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#fff';
          g.font = `bold 26px ${FONT}`;
          g.textAlign = 'center';
          g.fillText('99+', 32, 42);
        });
        this.textures.push(tex);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
        sp.scale.setScalar(0.8);
        return sp;
      }
      case 'capsule': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshToonMaterial({ color: [0xff4a6a, 0x4ad8ff, 0xffd23f, 0xc77dff][owner & 3] })));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshToonMaterial({ color: 0xffffff })));
        return g;
      }
      case 'scooter': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.5, 0.55), new THREE.MeshToonMaterial({ color: 0xff5a3a })));
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), new THREE.MeshToonMaterial({ color: 0x2fbf71 }));
        seat.position.set(-0.3, 0.45, 0);
        g.add(seat);
        for (const x of [-0.45, 0.45]) {
          const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12), new THREE.MeshToonMaterial({ color: 0x111111 }));
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x, -0.3, 0);
          g.add(wheel);
        }
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), basic(0xfff1c8));
        light.position.set(0.68, 0.1, 0);
        light.name = 'front';
        g.add(light);
        return g;
      }
      case 'item0':
      case 'item1':
      case 'item2':
      case 'item3':
      case 'item4':
      case 'item5':
      case 'item6': {
        // アイテム：光る台座の上に、種類ごとの形
        const g = new THREE.Group();
        const k = Number(kind.slice(4));
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.45, 24), basic([0x4fd18b, 0xb6ff3a, 0xff3b3b, 0x4f9dff, 0xff8a3a, 0xa070ff, 0xffd84a][k], { transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        g.add(ring);
        const body = new THREE.Group();
        body.name = 'body';
        body.position.y = 0.45;
        g.add(body);
        const toon = (c: number) => new THREE.MeshToonMaterial({ color: c });
        if (k === 0) {
          // おにぎり：角の丸い白い三角に、のりを巻く
          // 三角柱（横から見ると三角）。とがったほうを上に向ける
          const rice = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 3, 1), toon(0xfaf7ee));
          rice.rotation.x = Math.PI / 2;
          rice.rotation.y = Math.PI;
          body.add(rice);
          const nori = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), toon(0x1f3a2a));
          nori.position.y = -0.1;
          body.add(nori);
        } else if (k === 1) {
          // スニーカー：白い底と、色のついた甲、つま先（少し大きめに）
          body.scale.setScalar(1.25);
          const sole = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.08, 0.24), toon(0xffffff));
          sole.position.y = -0.16;
          body.add(sole);
          const upper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), toon(0x9be22d));
          upper.position.set(-0.08, -0.03, 0);
          body.add(upper);
          const toe = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), toon(0x9be22d));
          toe.scale.set(1.2, 0.8, 0.95);
          toe.position.set(0.15, -0.08, 0);
          body.add(toe);
          const lace = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.23), basic(0xffffff));
          lace.position.set(0.0, 0.03, 0);
          body.add(lace);
        } else if (k === 2) {
          // 砂時計：上下の木の板と、ガラスの中の赤い砂
          for (const y of [0.24, -0.24]) {
            const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16), toon(0x8a5a32));
            plate.position.y = y;
            body.add(plate);
          }
          for (const [y, flip] of [[0.11, 1], [-0.11, -1]]) {
            const glass = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.22, 16, 1, true), new THREE.MeshToonMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
            glass.position.y = y;
            glass.rotation.x = flip > 0 ? Math.PI : 0;
            body.add(glass);
          }
          const sand = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.1, 14), toon(0xff5a5a));
          sand.position.y = -0.17;
          body.add(sand);
        } else if (k === 4) {
          // カイロ：白い平たい袋に、オレンジの「あったか」の帯と湯気
          const bag = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.44, 0.06), toon(0xfaf7ee));
          body.add(bag);
          const band = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.14, 0.065), toon(0xff7a1a));
          body.add(band);
          for (const x of [-0.08, 0.08]) {
            const steam = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 12, Math.PI * 1.4), basic(0xffffff));
            steam.position.set(x, 0.32, 0);
            steam.rotation.z = Math.PI / 2;
            body.add(steam);
          }
        } else if (k === 5) {
          // 傘：開いた紫の傘（8本の骨）と、曲がった持ち手
          const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.22, 8, 1, true), new THREE.MeshToonMaterial({ color: 0x8a5cff, side: THREE.DoubleSide }));
          canopy.position.y = 0.18;
          body.add(canopy);
          const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), toon(0xffffff));
          tip.position.y = 0.3;
          body.add(tip);
          const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 8), toon(0x3a2a20));
          stick.position.y = -0.06;
          body.add(stick);
          const hook = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 12, Math.PI), toon(0x3a2a20));
          hook.position.set(0.06, -0.31, 0);
          hook.rotation.z = Math.PI;
          body.add(hook);
        } else if (k === 6) {
          // メガホン：横向きの黄色いラッパ（口は白）と、持ち手
          const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 0.42, 16, 1, true), new THREE.MeshToonMaterial({ color: 0xffd23f, side: THREE.DoubleSide }));
          horn.rotation.z = -Math.PI / 2;
          body.add(horn);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 20), toon(0xffffff));
          rim.position.x = 0.21;
          rim.rotation.y = Math.PI / 2;
          body.add(rim);
          const back = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 12), toon(0x3a3a48));
          back.position.x = -0.24;
          back.rotation.z = Math.PI / 2;
          body.add(back);
          const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), toon(0x3a3a48));
          grip.position.set(-0.06, -0.14, 0);
          body.add(grip);
        } else {
          // お守り：紺色の袋に金の縁取りと、上のひも
          const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.08), toon(0x2d4fb3));
          body.add(bag);
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.09), toon(0xffd23f));
          trim.position.y = -0.02;
          body.add(trim);
          const inner = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.095), toon(0x2d4fb3));
          inner.position.y = -0.02;
          body.add(inner);
          const knot = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 14), basic(0xffd23f));
          knot.position.y = 0.27;
          body.add(knot);
        }
        // 上に効果の短い説明（回復・スピードアップ など）
        const text = ITEM_INFO[k].short;
        const W = Math.max(128, Math.ceil((text.length * 40 + 24) / 32) * 32);
        const tex = canvasTexture(W, 64, (c) => {
          c.font = `900 40px ${FONT}`;
          c.textAlign = 'center';
          c.lineWidth = 8;
          c.strokeStyle = '#1b1b28';
          c.strokeText(text, W / 2, 46);
          c.fillStyle = ITEM_COLORS[k];
          c.fillText(text, W / 2, 46);
        });
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, color: 0xe0e0e0 }));
        label.name = 'label';
        label.scale.set((0.42 * W) / 64, 0.42, 1);
        label.position.y = 1.05;
        label.renderOrder = 9;
        g.add(label);
        return g;
      }
      case 'spark': {
        // ドローンの電撃弾
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), basic(0xffffff)));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), basic(0x4fd8ff, { transparent: true, opacity: 0.5 })));
        return g;
      }
      case 'drone': {
        // エージェント起動：AIアシスタントがプロペラ付きのドローンになる
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshToonMaterial({ color: 0x4fd8ff })));
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.05), basic(0x0b1a2a));
        visor.position.set(0, 0.03, 0.2);
        g.add(visor);
        for (const x of [0.06, -0.06]) {
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), basic(0x7dffcf));
          eye.position.set(x, 0.03, 0.23);
          g.add(eye);
        }
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.06), basic(0x2a2a33));
        arm.position.y = 0.2;
        g.add(arm);
        for (const x of [0.4, -0.4]) {
          const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.015, 16), basic(0xdfe6f0, { transparent: true, opacity: 0.6 }));
          prop.position.set(x, 0.23, 0);
          prop.name = 'prop';
          g.add(prop);
        }
        return g;
      }
      case 'food': {
        // 置き配：お弁当
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.36), new THREE.MeshToonMaterial({ color: 0xc0392b }));
        box.position.y = 0.08;
        g.add(box);
        const rice = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.3), basic(0xffffff));
        rice.position.set(-0.11, 0.17, 0);
        g.add(rice);
        const egg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), basic(0xffd23f));
        egg.position.set(0.1, 0.18, -0.06);
        g.add(egg);
        const ume = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), basic(0xe5484d));
        ume.position.set(-0.11, 0.2, 0);
        g.add(ume);
        return g;
      }
      case 'wall': {
        // 物理ファイアウォール：燃えるレンガの壁
        const tex = canvasTexture(64, 256, (g) => {
          g.fillStyle = '#ff7a1a';
          g.fillRect(0, 0, 64, 256);
          g.fillStyle = '#ffd23f';
          for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? -16 : 0; x < 64; x += 32) g.fillRect(x + 2, y + 2, 28, 28);
        });
        this.textures.push(tex);
        return new THREE.Mesh(
          new THREE.BoxGeometry(WALL.w, WALL.h, 1.4),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false }),
        );
      }
      case 'trap': {
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.34), new THREE.MeshToonMaterial({ color: 0x2a2a33 }));
        box.position.y = 0.11;
        g.add(box);
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), basic(0xff3030));
        led.position.set(0, 0.24, 0);
        led.name = 'led';
        g.add(led);
        const ring = new THREE.Mesh(new THREE.RingGeometry(TRAP.r * 0.9, TRAP.r, 24), basic(0x39ff88, { transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        g.add(ring);
        return g;
      }
      case 'popup': {
        // ポップアップ広告：立てた窓。上の辺が足場になる
        const tex = canvasTexture(256, 128, (g) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 256, 128);
          g.fillStyle = '#3b6cff';
          g.fillRect(0, 0, 256, 26);
          g.fillStyle = '#ffffff';
          g.font = `bold 18px ${FONT}`;
          g.fillText('広告', 8, 19);
          g.fillText('×', 234, 19);
          g.fillStyle = '#ff3b6c';
          g.font = `bold 34px ${FONT}`;
          g.fillText('今すぐ', 70, 74);
          g.fillText('クリック！', 46, 112);
        });
        this.textures.push(tex);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(POPUP.w, 1.2), basic(0xffffff, { map: tex, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
        panel.position.y = -0.6;
        const g = new THREE.Group();
        g.add(panel);
        const edge = new THREE.Mesh(new THREE.BoxGeometry(POPUP.w, 0.08, 0.6), basic(0x3b6cff));
        edge.position.y = -0.04;
        g.add(edge);
        return g;
      }
    }
    return new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), basic(color));
  }

  /** 種類ごとに使い回す（毎フレーム作り直さない） */
  private take(kind: string, owner: number, used: Map<string, number>): THREE.Object3D {
    const n = used.get(kind) ?? 0;
    used.set(kind, n + 1);
    let pool = this.pools.get(kind);
    if (!pool) this.pools.set(kind, (pool = []));
    if (!pool[n]) {
      const o = this.make(kind, owner);
      this.scene.add(o);
      pool[n] = o;
    }
    pool[n].visible = true;
    return pool[n];
  }

  update(view: ViewState, time: number, dt: number): void {
    for (const pool of this.pools.values()) for (const o of pool) o.visible = false;
    const used = new Map<string, number>();
    for (const p of view.projectiles) {
      const o = this.take(p.kind, p.owner, used);
      o.position.set(p.x, p.y, 0.2);
      if (p.kind === 'malware') o.rotation.set(time * 4, time * 5, 0);
      else if (p.kind === 'coin') o.rotation.y = time * 10;
      else if (p.kind === 'phone') o.rotation.z = time * 12;
      else if (p.kind === 'thread') {
        // 糸は進む向きに向ける
        const px = o.userData.px as number | undefined;
        if (px !== undefined && Math.abs(p.x - px) > 0.001) o.rotation.y = p.x > px ? 0 : Math.PI;
        o.userData.px = p.x;
      }
      else if (p.kind === 'mail') o.rotation.z = Math.sin(time * 12) * 0.25;
      else if (p.kind === 'thanks') o.scale.setScalar(0.6);
      else if (p.kind === 'stone' || p.kind === 'gold') o.rotation.set(time * 3, time * 4, 0);
      else if (p.kind === 'bag') o.rotation.z = time * 14;
      else if (p.kind === 'orb') o.scale.setScalar(1 + Math.sin(time * 20) * 0.1);
      else if (p.kind === 'spark') o.scale.setScalar(1 + Math.sin(time * 40) * 0.2);
      else if (p.kind === 'packet' || p.kind === 'capsule') o.rotation.set(time * 3, time * 4, 0);
      else if (p.kind === 'laser') {
        // 進む向きに傾ける（前のフレームの位置と比べる）
        const px = o.userData.px as number | undefined;
        const py = o.userData.py as number | undefined;
        if (px !== undefined && py !== undefined && Math.hypot(p.x - px, p.y - py) > 0.01) o.rotation.z = Math.atan2(p.y - py, p.x - px);
        o.userData.px = p.x;
        o.userData.py = p.y;
        o.scale.y = 1 + Math.sin(time * 50) * 0.3;
      }
      else if (p.kind === 'scooter' || p.kind === 'comment' || p.kind === 'sound') {
        // 進む向きに合わせる（前のフレームの位置と比べる）
        const px = o.userData.px as number | undefined;
        if (px !== undefined && Math.abs(p.x - px) > 0.01 && p.kind !== 'comment') o.rotation.y = p.x > px ? 0 : Math.PI;
        o.userData.px = p.x;
      }
    }
    for (const e of view.entities) {
      if (e.kind === 'item') {
        const o = this.take(`item${e.dir}`, 0, used);
        o.position.set(e.x, e.y, 0.3);
        const body = o.getObjectByName('body');
        if (body) {
          body.rotation.y = time * 2;
          body.position.y = 0.45 + Math.sin(time * 4) * 0.06;
        }
        o.visible = e.life > 120 || Math.floor(time * 8) % 2 === 0;
        continue;
      }
      const o = this.take(e.kind, e.owner, used);
      if (e.kind === 'wall') {
        o.position.set(e.x, e.y + WALL.h / 2, 0);
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(0.75, e.life / 20) * (0.85 + Math.sin(time * 20) * 0.15);
      } else if (e.kind === 'decoy') {
        o.visible = false; // 分身は描画側でキャラのモデルを使って表示する
      } else if (e.kind === 'food') {
        o.position.set(e.x, e.y, 0);
        o.rotation.y = Math.sin(time * 2) * 0.3;
        if (Math.random() < dt * 3) {
          // 湯気
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
          b.position.set(e.x + (Math.random() - 0.5) * 0.3, e.y + 0.25, 0.3);
          this.scene.add(b);
          this.bubbles.push({ mesh: b, life: 0.8 });
        }
      } else if (e.kind === 'drone') {
        o.position.set(e.x, e.y + Math.sin(time * 4) * 0.08, 0.3);
        o.rotation.set(0, e.dir > 0 ? 0.5 : -0.5, Math.sin(time * 3) * 0.08);
        o.traverse((c) => {
          if (c.name === 'prop') c.rotation.y = time * 40;
        });
        // 残り時間が少ないと点滅
        o.visible = e.life > 60 || Math.floor(time * 10) % 2 === 0;
      } else if (e.kind === 'leash') {
        // 赤い糸：持ち主の手元から、つながれた人の胸まで
        const a = view.fighters.find((f) => f.slot === e.owner);
        const b = view.fighters.find((f) => f.slot === e.dir);
        if (!a || !b) {
          o.visible = false;
          continue;
        }
        const ax = a.x;
        const ay = a.y + 1.0;
        const bx = b.x;
        const by = b.y + 0.9;
        const len = Math.max(0.01, Math.hypot(bx - ax, by - ay));
        o.position.set((ax + bx) / 2, (ay + by) / 2, 0.25);
        o.rotation.z = Math.atan2(by - ay, bx - ax) - Math.PI / 2;
        o.scale.set(1, len, 1);
        // 切れそうになると点滅
        o.visible = e.life > 45 || Math.floor(time * 10) % 2 === 0;
      } else if (e.kind === 'heart') {
        // ゆらゆら揺れながら、ゆっくり降りてくる（床をそのまま通りぬける）
        o.position.set(e.x + Math.sin(time * 1.6) * 0.15, e.y, 0.3);
        const body = o.getObjectByName('body');
        if (body) {
          body.position.y = 0.5;
          body.rotation.set(0, Math.sin(time * 1.2) * 0.5, Math.sin(time * 1.6) * 0.12);
        }
      } else if (e.kind === 'call') {
        // 着信中：頭の上でふるえ、爆発が近いほど速く点滅して大きくなる
        const near = e.life < 50;
        o.position.set(e.x + Math.sin(time * 40) * 0.05, e.y + 2.3, 0.6);
        o.scale.setScalar(near ? 1.15 + Math.sin(time * 30) * 0.08 : 1);
        o.visible = !near || Math.floor(time * 12) % 2 === 0;
      } else if (e.kind === 'trap') {
        o.position.set(e.x, e.y, 0);
        const led = o.getObjectByName('led');
        if (led) led.visible = Math.floor(time * 4) % 2 === 0;
      } else {
        o.position.set(e.x, e.y, -0.3);
        o.scale.setScalar(e.life < 40 && Math.floor(time * 10) % 2 === 0 ? 0.98 : 1);
      }
    }
    // 眠っている人の頭上に Zzz、操作が逆の人に「？」、毒の人から泡
    for (const f of view.fighters) {
      let q = this.question.get(f.slot);
      if (f.fx & FX_CONFUSED && f.state !== 'dead') {
        if (!q) {
          q = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.qTex, depthWrite: false }));
          q.scale.setScalar(0.5);
          this.scene.add(q);
          this.question.set(f.slot, q);
        }
        q.visible = true;
        q.position.set(f.x + Math.sin(time * 6) * 0.3, f.y + 2.5, 0.5);
      } else if (q) q.visible = false;
      // 攻撃力・スピードの上がり下がり：頭の上に、剣・ブーツの目印を横に並べる
      const marks: [string, boolean][] = [
        ['atkUp', (f.fx & FX_ATK_UP) !== 0],
        ['atkDown', (f.fx & FX_ATK_DOWN) !== 0],
        ['spdUp', (f.fx & FX_SPD_UP) !== 0],
        ['spdDown', (f.fx & FX_SPD_DOWN) !== 0],
      ];
      const shown = marks.filter(([, on]) => on).length;
      let col = 0;
      for (const [key, on] of marks) {
        const id = `${key}${f.slot}`;
        let sp = this.debuffs.get(id);
        if (on && f.state !== 'dead') {
          if (!sp) {
            sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.buffTex[key], depthWrite: false, transparent: true }));
            sp.scale.setScalar(0.42);
            this.scene.add(sp);
            this.debuffs.set(id, sp);
          }
          sp.visible = true;
          sp.position.set(f.x + (col - (shown - 1) / 2) * 0.46, f.y + 2.75 + Math.sin(time * 3 + col) * 0.03, 0.5);
          col++;
        } else if (sp) sp.visible = false;
      }
      let z = this.zzz.get(f.slot);
      if (f.state === 'sleep') {
        if (!z) {
          z = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.zzzTex, depthWrite: false }));
          z.scale.set(0.9, 0.45, 1);
          this.scene.add(z);
          this.zzz.set(f.slot, z);
        }
        z.visible = true;
        z.position.set(f.x + 0.4, f.y + 2.3 + Math.sin(time * 3) * 0.1, 0.5);
      } else if (z) z.visible = false;
      if (f.poison && f.state !== 'dead' && Math.random() < dt * 8) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xb06bff, transparent: true }));
        b.position.set(f.x + (Math.random() - 0.5) * 0.6, f.y + 0.8 + Math.random() * 0.8, 0.4);
        this.scene.add(b);
        this.bubbles.push({ mesh: b, life: 0.8 });
      }
    }
    this.texts = this.texts.filter((t) => {
      t.life -= dt * 60;
      if (!t.still) t.sprite.position.y += dt * 0.8;
      (t.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, t.life / 20);
      if (t.life <= 0) {
        this.scene.remove(t.sprite);
        (t.sprite.material as THREE.SpriteMaterial).map?.dispose();
        t.sprite.material.dispose();
        return false;
      }
      return true;
    });
    this.bubbles = this.bubbles.filter((b) => {
      b.life -= dt;
      b.mesh.position.y += dt * 1.2;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.8);
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        (b.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  clear(): void {
    for (const pool of this.pools.values()) for (const o of pool) this.scene.remove(o);
    this.pools.clear();
    for (const z of this.zzz.values()) this.scene.remove(z);
    this.zzz.clear();
    for (const q of this.question.values()) this.scene.remove(q);
    this.question.clear();
    // 試合の途中で消える文字・泡も、画像と形を片付ける（残すと試合のたびにたまっていく）
    for (const t of this.texts) {
      this.scene.remove(t.sprite);
      (t.sprite.material as THREE.SpriteMaterial).map?.dispose();
      t.sprite.material.dispose();
    }
    this.texts = [];
    for (const b of this.bubbles) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
    }
    this.bubbles = [];
    for (const t of this.textures) if (t !== this.zzzTex && t !== this.qTex) t.dispose();
    this.textures = [this.zzzTex, this.qTex];
  }
}
