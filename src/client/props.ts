// 飛び道具・置かれる物（壁・罠・広告ウィンドウ）・状態表示（Zzz）の見た目

import * as THREE from 'three';
import { SLOT_COLORS } from '../shared/characters';
import { POPUP, TRAP, WALL } from '../shared/moves';
import type { ViewState } from '../shared/types';

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
  private bubbles: { mesh: THREE.Mesh; life: number }[] = [];

  constructor(private scene: THREE.Scene) {
    this.zzzTex = canvasTexture(128, 64, (g) => {
      g.font = `bold 44px ${FONT}`;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#3a3a8a';
      g.lineWidth = 8;
      g.strokeText('Zzz', 10, 48);
      g.fillText('Zzz', 10, 48);
    });
    this.textures.push(this.zzzTex);
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
    }
    for (const e of view.entities) {
      const o = this.take(e.kind, e.owner, used);
      if (e.kind === 'wall') {
        o.position.set(e.x, e.y + WALL.h / 2, 0);
        const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = Math.min(0.75, e.life / 20) * (0.85 + Math.sin(time * 20) * 0.15);
      } else if (e.kind === 'trap') {
        o.position.set(e.x, e.y, 0);
        const led = o.getObjectByName('led');
        if (led) led.visible = Math.floor(time * 4) % 2 === 0;
      } else {
        o.position.set(e.x, e.y, -0.3);
        o.scale.setScalar(e.life < 40 && Math.floor(time * 10) % 2 === 0 ? 0.98 : 1);
      }
    }
    // 眠っている人の頭上に Zzz、毒の人から泡
    for (const f of view.fighters) {
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
    for (const b of this.bubbles) this.scene.remove(b.mesh);
    this.bubbles = [];
    for (const t of this.textures) if (t !== this.zzzTex) t.dispose();
    this.textures = [this.zzzTex];
  }
}
