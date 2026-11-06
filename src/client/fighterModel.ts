// 仮の3Dキャラクター（基本図形の組み合わせ）と、状態に合わせた手続き的なアニメーション。
// 後で glTF モデルに差し替えるときは、このクラスと同じ update() を持つクラスを作ればよい。

import * as THREE from 'three';
import type { CharacterDef } from '../shared/characters';
import { MOVES } from '../shared/moves';
import type { ViewFighter } from '../shared/types';

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
}

function basePose(): Pose {
  return { armL: 0.15, armR: -0.15, armLz: 0.15, armRz: -0.15, legL: 0, legR: 0, lean: 0, spinY: 0, spinZ: 0, squash: 1, bob: 0 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class FighterModel {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  /** 画面の奥行き方向の軸まわりに回すための入れ物（ふっとび中の回転用） */
  private spin = new THREE.Group();
  private hips = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private shieldMesh: THREE.Mesh;
  private marker: THREE.Mesh;
  private halo: THREE.Mesh;
  private mats: THREE.MeshStandardMaterial[] = [];
  private skin: THREE.MeshStandardMaterial;
  private turn = 0;
  private visualFacing = 1;

  constructor(def: CharacterDef, slotColor: number) {
    const s = def.scale;
    const main = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.55, metalness: 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.6 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0xffe0c2, roughness: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b2a, roughness: 0.4 });
    this.mats.push(main, accent, this.skin, dark);

    this.root.add(this.spin);
    this.spin.position.y = 0.9 * s;
    this.spin.add(this.body);
    this.body.rotation.order = 'YXZ';
    this.body.scale.setScalar(s);

    // 腰（脚の付け根）
    this.hips.position.y = 0.72;
    this.body.add(this.hips);
    for (const [g, x] of [
      [this.legL, 0.15],
      [this.legR, -0.15],
    ] as const) {
      g.position.set(x, 0, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.42, 4, 10), accent);
      leg.position.y = -0.33;
      leg.castShadow = true;
      g.add(leg);
      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), dark);
      shoe.scale.set(1, 0.7, 1.4);
      shoe.position.set(0, -0.62, 0.05);
      shoe.castShadow = true;
      g.add(shoe);
      this.hips.add(g);
    }

    // 胴体
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.42, 6, 14), main);
    torso.position.y = 1.08;
    torso.castShadow = true;
    this.body.add(torso);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.05, 8, 20), accent);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.86;
    this.body.add(belt);

    // 腕
    for (const [g, x] of [
      [this.armL, 0.38],
      [this.armR, -0.38],
    ] as const) {
      g.position.set(x, 1.34, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.36, 4, 10), main);
      arm.position.y = -0.26;
      arm.castShadow = true;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), this.skin);
      hand.position.y = -0.52;
      hand.castShadow = true;
      g.add(hand);
      this.body.add(g);
    }

    // 頭
    const head = new THREE.Group();
    head.position.y = 1.62;
    this.body.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), this.skin);
    skull.castShadow = true;
    head.add(skull);
    for (const x of [0.1, -0.1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), dark);
      eye.scale.set(1, 1.5, 0.6);
      eye.position.set(x, 0.03, 0.27);
      head.add(eye);
    }
    this.decorate(def.id, head, main, accent);

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
    this.marker.position.y = 2.35 * s;
    this.root.add(this.marker);

    // 復活時の台
    this.halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.6, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: slotColor, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }),
    );
    this.halo.position.y = -0.06;
    this.root.add(this.halo);
  }

  private decorate(id: string, head: THREE.Group, main: THREE.Material, accent: THREE.Material): void {
    if (id === 'mira') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 8, 24), accent);
      band.rotation.x = Math.PI / 2 - 0.25;
      band.position.y = 0.1;
      head.add(band);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.3, 4, 8), main);
      tail.position.set(0, 0.12, -0.38);
      tail.rotation.x = 0.9;
      head.add(tail);
    } else if (id === 'bolt') {
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 6), main);
        const a = -0.9 + i * 0.45;
        spike.position.set(Math.sin(a) * 0.2, 0.26, -0.05 - Math.cos(a) * 0.05);
        spike.rotation.set(-0.5, 0, -a * 0.6);
        head.add(spike);
      }
    } else if (id === 'gran') {
      for (const x of [0.2, -0.2]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 8), accent);
        horn.position.set(x, 0.28, 0);
        horn.rotation.z = x > 0 ? -0.5 : 0.5;
        head.add(horn);
      }
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.12), main);
      jaw.position.set(0, -0.18, 0.22);
      head.add(jaw);
    } else if (id === 'pico') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), accent);
      stem.position.set(0, 0.42, 0);
      head.add(stem);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), main);
      ball.position.set(0, 0.6, 0);
      head.add(ball);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), main);
      cap.position.y = 0.02;
      head.add(cap);
    }
  }

  update(v: ViewFighter, def: CharacterDef, time: number, dt: number): void {
    const visible = v.state !== 'dead';
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(v.x, v.y, 0);

    // 向き：少しカメラ側を向かせる
    if (v.facing !== this.visualFacing) this.visualFacing = v.facing;
    const targetTurn = this.visualFacing * (Math.PI / 2 - 0.45);
    this.turn += (targetTurn - this.turn) * Math.min(1, dt * 18);

    const p = this.pose(v, def, time);
    this.body.rotation.set(p.lean, this.turn + p.spinY, 0);
    this.spin.rotation.z = p.spinZ;
    this.body.position.y = -0.9 * def.scale + p.bob;
    this.body.scale.set(def.scale * (2 - p.squash) ** 0.5, def.scale * p.squash, def.scale * (2 - p.squash) ** 0.5);
    this.armL.rotation.set(p.armL, 0, p.armLz);
    this.armR.rotation.set(p.armR, 0, p.armRz);
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;

    // ガード
    const shielding = v.state === 'shield';
    this.shieldMesh.visible = shielding;
    if (shielding) this.shieldMesh.scale.setScalar((0.55 + 0.6 * v.shield) * def.scale);

    // 無敵中の点滅・溜めの発光・回避の半透明
    const flash = v.invuln && Math.floor(time * 20) % 2 === 0;
    const charging = v.charge > 0;
    const ghost = v.state === 'dodge' || v.state === 'airdodge';
    const helpless = v.state === 'helpless';
    for (const m of this.mats) {
      m.emissive.setHex(flash ? 0x666666 : charging ? 0xffaa00 : 0x000000);
      m.emissiveIntensity = charging ? 0.3 + 0.3 * Math.sin(time * 30) : 1;
      m.transparent = ghost;
      m.opacity = ghost ? 0.45 : 1;
      if (helpless) m.emissive.setHex(0x220022);
    }
    this.halo.visible = v.state === 'respawn';
    this.marker.position.y = 2.35 * def.scale + Math.sin(time * 4) * 0.05;
  }

  private pose(v: ViewFighter, def: CharacterDef, time: number): Pose {
    const p = basePose();
    const t = v.stateTime;
    switch (v.state) {
      case 'idle':
      case 'respawn': {
        const b = Math.sin(time * 3 + v.slot);
        p.bob = b * 0.02;
        p.armL = 0.1 + b * 0.05;
        p.armR = -0.1 - b * 0.05;
        break;
      }
      case 'run': {
        const c = Math.sin(t * 0.38);
        p.legL = c * 0.9;
        p.legR = -c * 0.9;
        p.armL = -c * 0.8;
        p.armR = c * 0.8;
        p.lean = 0.25;
        p.bob = Math.abs(Math.cos(t * 0.38)) * 0.06;
        break;
      }
      case 'air':
        p.legL = -0.7;
        p.legR = 0.35;
        p.armL = -0.6;
        p.armR = -1.2;
        p.armLz = 0.5;
        p.armRz = -0.5;
        if (t < 18) p.spinZ = 0;
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
        if (t > 4 && v.damage > 40) p.spinZ = t * 0.35 * -v.facing;
        break;
      case 'shieldbreak':
        p.lean = -0.3 + Math.sin(time * 5) * 0.2;
        p.armL = 0.4;
        p.armR = -0.4;
        p.spinY = Math.sin(time * 4) * 0.4;
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

  private attackPose(v: ViewFighter, def: CharacterDef, p: Pose): void {
    if (!v.move) return;
    const md = MOVES[v.move];
    const s = Math.max(1, Math.round(md.startup * def.frameMul));
    const a = md.active;
    const e = Math.max(1, Math.round(md.end * def.frameMul));
    const f = v.moveFrame;
    // 0→1: 振りかぶり、1: 攻撃の瞬間、1→0: 戻り
    const k = f < s ? f / s : f < s + a ? 1 : Math.max(0, 1 - (f - s - a) / e);
    const wind = f < s ? Math.sin((f / s) * Math.PI) : 0;
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
      case 'nspecial':
        p.armR = lerp(0.3, FWD, k);
        p.armL = lerp(0.3, FWD, k);
        break;
      case 'sspecial':
        p.armR = FWD;
        p.lean = 0.7 * k;
        p.legL = 0.6 * k;
        p.legR = -0.6 * k;
        break;
      case 'uspecial':
        p.armR = UP;
        p.armL = UP * 0.4;
        p.spinY = f * 0.6;
        break;
      case 'dspecial':
        p.squash = f < s ? 0.75 : 1.05;
        p.armL = f < s ? UP : 0.8;
        p.armR = f < s ? UP : -0.8;
        p.armLz = 1;
        p.armRz = -1;
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
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
