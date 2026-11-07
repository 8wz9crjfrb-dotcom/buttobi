// 飛び道具・置かれる物（壁・罠・広告ウィンドウ）・状態表示（Zzz）の見た目

import * as THREE from 'three';
import { SLOT_COLORS } from '../shared/characters';
import { POPUP, TRAP, WALL } from '../shared/moves';
import { FX_CONFUSED, type ViewState } from '../shared/types';

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
  private bubbles: { mesh: THREE.Mesh; life: number }[] = [];
  private texts: { sprite: THREE.Sprite; life: number; max: number }[] = [];

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
    this.textures.push(this.zzzTex, this.qTex);
  }

  /** 浮かんで消える文字（ガチャの結果など） */
  showText(text: string, color: string, x: number, y: number, big = false): void {
    const size = big ? 64 : 48;
    // 文字数に合わせて横幅を決める（長い文字が切れないように）
    const W = Math.max(256, Math.ceil((text.length * size + 30) / 64) * 64);
    const tex = canvasTexture(W, 96, (g) => {
      g.font = `900 ${size}px ${FONT}`;
      g.textAlign = 'center';
      g.lineWidth = 10;
      g.strokeStyle = '#1b1b28';
      g.strokeText(text, W / 2, 70);
      if (color === 'rainbow') {
        const grad = g.createLinearGradient(20, 0, W - 20, 0);
        ['#ff5a5a', '#ffd23f', '#4fd18b', '#4f9dff', '#c77dff'].forEach((c, i) => grad.addColorStop(i / 4, c));
        g.fillStyle = grad;
      } else g.fillStyle = color;
      g.fillText(text, W / 2, 70);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    const h = big ? 1.12 : 0.82;
    sprite.scale.set((h * W) / 96, h, 1);
    sprite.position.set(x, y, 1);
    this.scene.add(sprite);
    this.texts.push({ sprite, life: 70, max: 70 });
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
      else if (p.kind === 'mail') o.rotation.z = Math.sin(time * 12) * 0.25;
      else if (p.kind === 'thanks') o.scale.setScalar(0.6);
      else if (p.kind === 'stone' || p.kind === 'gold') o.rotation.set(time * 3, time * 4, 0);
      else if (p.kind === 'bag') o.rotation.z = time * 14;
      else if (p.kind === 'orb') o.scale.setScalar(1 + Math.sin(time * 20) * 0.1);
      else if (p.kind === 'spark') o.scale.setScalar(1 + Math.sin(time * 40) * 0.2);
    }
    for (const e of view.entities) {
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
      t.sprite.position.y += dt * 0.8;
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
    for (const t of this.texts) this.scene.remove(t.sprite);
    this.texts = [];
    for (const b of this.bubbles) this.scene.remove(b.mesh);
    this.bubbles = [];
    for (const t of this.textures) if (t !== this.zzzTex && t !== this.qTex) t.dispose();
    this.textures = [this.zzzTex, this.qTex];
  }
}
