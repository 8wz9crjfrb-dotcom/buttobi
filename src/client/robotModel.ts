// 3Dモデル（RobotExpressive）を使ったキャラクター表示。
// 移動・待機・ジャンプなどはモデルに入っているアニメーションを使い、
// 技はパンチの動きを土台に、腕や脚の関節をプログラムで回して形を作る。

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { CharacterDef } from '../shared/characters';
import { MOVES } from '../shared/moves';
import type { ViewFighter } from '../shared/types';

const HEIGHT = 1.8; // キャラの身長（当たり判定と同じ）

/** パンチの動きを土台にする技（それ以外の技は待機の姿勢から腕・脚を回して形を作る） */
const PUNCH_MOVES = new Set(['jab', 'side', 'smash', 'grab', 'nspecial', 'sspecial', 'fair']);

type ClipName = 'Idle' | 'Running' | 'Jump' | 'Punch' | 'Death' | 'Dance' | 'Walking' | 'Wave';

/** 体の部位を、体の横方向の軸（左右）まわりに回す量など */
interface Override {
  armR?: number;
  armL?: number;
  legR?: number;
  legL?: number;
  lean?: number;
  spinY?: number;
  spinZ?: number;
  squash?: number;
}

export class RobotModel {
  readonly root = new THREE.Group();
  private turn = new THREE.Group();
  private spin = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  private mats: THREE.MeshStandardMaterial[] = [];
  private bones: Record<string, THREE.Bone | undefined> = {};
  private shieldMesh: THREE.Mesh;
  private marker: THREE.Mesh;
  private halo: THREE.Mesh;
  private decor = new THREE.Group();
  private head: THREE.Object3D | null = null;
  private headCenter = new THREE.Vector3();
  private headRadius = 0.3;
  private headHalfH = 0.3;
  private turnAngle = 0;
  private lastState = '';
  private victory = false;
  private baseScale: number;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();

  constructor(gltf: GLTF, def: CharacterDef, slotColor: number) {
    this.model = cloneSkeleton(gltf.scene);
    // 材質を複製して、キャラごとの色・発光を変えられるようにする
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      const src = m.material as THREE.MeshStandardMaterial;
      const mat = src.clone();
      if (src.name === 'Main') mat.color.setHex(def.color);
      if (src.name === 'Grey') mat.color.setHex(def.accent).lerp(new THREE.Color(0xcccccc), 0.5);
      m.material = mat;
      this.mats.push(mat);
    });
    // three.js は読み込み時に名前から「.」を取り除く（例：UpperArm.R → UpperArmR）
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones[o.name] = o as THREE.Bone;
    });
    // 頭の部品（材質ごとに分かれた複数の形のまとまりになっている）
    this.head = this.bones.Head?.children.find((c) => (c as THREE.Mesh).isMesh || c.type === 'Group') ?? null;

    // 身長をそろえ、足元を原点にする
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const h = box.max.y - box.min.y;
    this.baseScale = (HEIGHT / h) * def.scale;
    this.model.scale.multiplyScalar(this.baseScale);
    this.model.position.y = -box.min.y * this.baseScale;

    this.spin.position.y = 0.9 * def.scale;
    this.model.position.y -= 0.9 * def.scale;
    this.root.add(this.turn);
    this.turn.add(this.spin);
    this.spin.add(this.model);

    if (this.head) {
      this.root.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(this.head);
      wb.getCenter(this.headCenter);
      this.head.worldToLocal(this.headCenter);
      this.headRadius = Math.min(wb.max.x - wb.min.x, wb.max.z - wb.min.z) / 2;
      this.headHalfH = (wb.max.y - wb.min.y) / 2;
    }

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) {
      const name = clip.name as ClipName;
      const a = this.mixer.clipAction(clip);
      if (name === 'Jump' || name === 'Punch' || name === 'Death') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions.set(name, a);
    }
    this.play('Idle', 0);

    // 頭の飾り（キャラの見分け用）
    this.root.add(this.decor);
    this.buildDecor(def);

    // ガード
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshStandardMaterial({ color: slotColor, transparent: true, opacity: 0.35, emissive: slotColor, emissiveIntensity: 0.4, depthWrite: false }),
    );
    this.shieldMesh.position.y = 0.95 * def.scale;
    this.root.add(this.shieldMesh);
    // 頭上の目印
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), new THREE.MeshBasicMaterial({ color: slotColor }));
    this.marker.rotation.x = Math.PI;
    this.root.add(this.marker);
    // 復活時の台
    this.halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.6, 0.12, 24),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: slotColor, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }),
    );
    this.halo.position.y = -0.06;
    this.root.add(this.halo);
  }

  private buildDecor(def: CharacterDef): void {
    const r = Math.min(this.headRadius, 0.3);
    const top = this.headHalfH;
    const main = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: def.accent, roughness: 0.5 });
    this.mats.push(main, accent);
    const add = (m: THREE.Mesh) => {
      m.castShadow = true;
      this.decor.add(m);
    };
    if (def.id === 'mira') {
      // とさか（前後に長い板状）
      const crest = new THREE.Mesh(new THREE.ConeGeometry(r * 0.5, r * 0.6, 4), accent);
      crest.scale.set(0.25, 1, 1.4);
      crest.position.y = top + r * 0.1;
      add(crest);
    } else if (def.id === 'bolt') {
      for (let i = 0; i < 3; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, r * 0.8, 6), main);
        spike.position.set((i - 1) * r * 0.45, top + r * 0.3, -r * 0.1);
        spike.rotation.set(-0.4, 0, -(i - 1) * 0.5);
        add(spike);
      }
    } else if (def.id === 'gran') {
      for (const x of [1, -1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(r * 0.18, r * 0.8, 8), accent);
        horn.position.set(x * r * 0.8, top + r * 0.2, 0);
        horn.rotation.z = -x * 0.5;
        add(horn);
      }
    } else if (def.id === 'pico') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.8, 6), accent);
      stem.position.set(0, top + r * 0.4, 0);
      add(stem);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 10, 8), main);
      ball.position.set(0, top + r * 0.85, 0);
      add(ball);
    }
  }

  private play(name: ClipName, fade = 0.12, startAt = 0, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.paused = false;
    next.timeScale = timeScale;
    next.time = startAt * next.getClip().duration;
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (prev && prev !== next && fade > 0) next.crossFadeFrom(prev, fade, false);
    else if (prev && prev !== next) prev.stop();
    next.play();
    this.current = name;
  }

  /** 結果画面などで勝ったキャラを踊らせる */
  setVictory(on: boolean): void {
    if (on === this.victory) return;
    this.victory = on;
    this.lastState = '';
    if (on) this.play('Dance', 0.2);
  }

  update(v: ViewFighter, def: CharacterDef, time: number, dt: number): void {
    const visible = v.state !== 'dead';
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.set(v.x, v.y, 0);

    // 向き：少しカメラ側を向かせる
    // 勝利のダンス中はカメラの方を向く
    const target = this.victory ? 0 : v.facing * (Math.PI / 2 - 0.45);
    this.turnAngle += (target - this.turnAngle) * Math.min(1, dt * 18);

    const ov: Override = {};
    if (this.victory) {
      this.mixer.update(dt);
    } else {
      this.chooseClip(v, def);
      // 技は、技の進み具合に合わせてパンチの動きを再生位置ごと合わせる
      if (v.state === 'attack' && v.move) {
        const md = MOVES[v.move];
        const s = Math.max(1, Math.round(md.startup * def.frameMul));
        const total = s + md.active + Math.max(1, Math.round(md.end * def.frameMul));
        const a = PUNCH_MOVES.has(v.move) ? this.actions.get('Punch') : null;
        if (a) {
          // パンチの当たる瞬間（再生位置の約45%）を、技が出る瞬間に合わせる
          const p = v.moveFrame < s ? (v.moveFrame / s) * 0.45 : 0.45 + ((v.moveFrame - s) / Math.max(1, total - s)) * 0.55;
          a.paused = true;
          a.time = Math.min(0.999, p) * a.getClip().duration;
        }
        this.attackOverride(v, def, s, md.active, total, ov);
      }
      this.mixer.update(dt);
      this.stateOverride(v, time, ov);
    }

    this.turn.rotation.y = this.turnAngle + (ov.spinY ?? 0);
    this.spin.rotation.z = ov.spinZ ?? 0;
    this.model.rotation.x = ov.lean ?? 0;
    const sq = ov.squash ?? 1;
    this.spin.scale.set(Math.sqrt(2 - sq), sq, Math.sqrt(2 - sq));

    this.root.updateMatrixWorld(true);
    this.applyLimbs(ov);

    // 頭の飾りを頭に追従させる
    if (this.head) {
      this.root.updateMatrixWorld(true);
      this.head.localToWorld(this.tmpV.copy(this.headCenter));
      this.root.worldToLocal(this.tmpV);
      this.decor.position.copy(this.tmpV);
      this.decor.quaternion.setFromEuler(new THREE.Euler(0, this.turn.rotation.y, this.spin.rotation.z));
      this.marker.position.set(this.tmpV.x, this.tmpV.y + this.headHalfH + 0.6 + Math.sin(time * 4) * 0.05, this.tmpV.z);
    }

    // ガード
    const shielding = v.state === 'shield';
    this.shieldMesh.visible = shielding;
    if (shielding) this.shieldMesh.scale.setScalar((0.55 + 0.6 * v.shield) * def.scale);

    // 無敵の点滅・溜めの発光・回避の半透明
    const flash = v.invuln && Math.floor(time * 20) % 2 === 0;
    const charging = v.charge > 0;
    const ghost = v.state === 'dodge' || v.state === 'airdodge';
    const helpless = v.state === 'helpless';
    for (const m of this.mats) {
      m.emissive.setHex(flash ? 0x666666 : charging ? 0xffaa00 : helpless ? 0x220022 : 0x000000);
      m.emissiveIntensity = charging ? 0.3 + 0.3 * Math.sin(time * 30) : 1;
      m.transparent = ghost;
      m.opacity = ghost ? 0.45 : 1;
    }
    this.halo.visible = v.state === 'respawn';
  }

  private chooseClip(v: ViewFighter, def: CharacterDef): void {
    const key = v.state === 'attack' ? `attack:${v.move}` : v.state;
    // 同じ技を続けて出したとき（技の経過フレームが戻ったとき）も最初から
    const restart = v.state === 'attack' && v.moveFrame < this.prevMoveFrame;
    this.prevMoveFrame = v.moveFrame;
    if (key === this.lastState && !restart) return;
    this.lastState = key;
    switch (v.state) {
      case 'run':
        this.play('Running', 0.12, 0, 1.25 / def.scale);
        break;
      case 'air':
      case 'airdodge':
      case 'helpless':
        // ジャンプのうち、踏み切りの後から再生する
        this.play('Jump', 0.1, 0.25, 1);
        break;
      case 'attack':
        if (v.move && PUNCH_MOVES.has(v.move)) this.play('Punch', 0.06, 0, 1);
        else this.play('Idle', 0.06);
        break;
      case 'hitstun':
      case 'shieldbreak': {
        this.play('Death', 0.05, 0.05, 0);
        const a = this.actions.get('Death');
        if (a) a.paused = true;
        break;
      }
      default:
        this.play('Idle', 0.15);
    }
  }
  private prevMoveFrame = 0;

  private attackOverride(v: ViewFighter, def: CharacterDef, s: number, act: number, total: number, ov: Override): void {
    const f = v.moveFrame;
    // 0→1 振りかぶり、1 当たる瞬間、1→0 戻り
    const k = f < s ? f / s : f < s + act ? 1 : Math.max(0, 1 - (f - s - act) / Math.max(1, total - s - act));
    const FWD = -Math.PI / 2;
    const UP = -Math.PI;
    switch (v.move) {
      case 'smash':
        if (v.charge > 0 || f < s) {
          ov.armR = 0.8;
          ov.lean = -0.15;
          ov.squash = 0.94;
        } else {
          ov.lean = 0.35 * k;
        }
        break;
      case 'side':
      case 'sspecial':
        ov.lean = (v.move === 'sspecial' ? 0.6 : 0.25) * k;
        break;
      case 'up':
      case 'uair':
        ov.armR = UP * 0.9 * k;
        ov.armL = UP * 0.4 * k;
        ov.lean = -0.15 * k;
        break;
      case 'down':
        ov.legR = FWD * 0.9 * k;
        ov.squash = 0.88;
        break;
      case 'fair':
        ov.armR = FWD * 0.6 * k;
        ov.legL = FWD * 0.5;
        break;
      case 'nair':
        ov.spinY = k * Math.PI * 2 * (f / Math.max(1, s + act));
        ov.legL = FWD * 0.5;
        ov.legR = 0.4;
        break;
      case 'bair':
        ov.legR = 1.5 * k;
        ov.lean = 0.35 * k;
        break;
      case 'dair':
        ov.legL = -0.6 * (1 - k);
        ov.legR = -0.6 * (1 - k);
        ov.armL = UP * 0.5;
        ov.armR = UP * 0.5;
        break;
      case 'nspecial':
        ov.armL = FWD * k;
        break;
      case 'uspecial':
        ov.armR = UP;
        ov.armL = UP * 0.4;
        ov.spinY = f * 0.6;
        break;
      case 'dspecial':
        ov.squash = f < s ? 0.75 : 1.05;
        ov.armL = f < s ? UP : 0.5;
        ov.armR = f < s ? UP : 0.5;
        break;
      case 'grab':
        ov.armL = FWD * k * 0.8;
        break;
    }
  }

  private stateOverride(v: ViewFighter, time: number, ov: Override): void {
    const t = v.stateTime;
    switch (v.state) {
      case 'hitstun':
        ov.armR = -Math.PI * 0.7 + Math.sin(time * 25) * 0.3;
        ov.armL = -Math.PI * 0.6 - Math.sin(time * 25) * 0.3;
        if (t > 4 && v.damage > 40) ov.spinZ = t * 0.35 * -v.facing;
        break;
      case 'shieldbreak':
        ov.spinY = Math.sin(time * 4) * 0.4;
        break;
      case 'shield':
        ov.squash = 0.93;
        break;
      case 'land':
        ov.squash = t < 4 ? 0.82 : 0.95;
        break;
      case 'dodge':
        ov.squash = 0.85;
        ov.lean = 0.4;
        break;
      case 'airdodge':
        ov.spinY = t * 0.5;
        break;
      case 'ledge':
        ov.armR = -Math.PI;
        ov.armL = -Math.PI;
        break;
      case 'helpless':
        ov.spinZ = Math.sin(time * 6) * 0.2;
        break;
    }
  }

  /**
   * 腕・脚を「体の左右方向の軸」まわりに回す。骨ごとの軸の向きに左右されないよう、
   * 体の向きを基準にした回転を、それぞれの骨の座標に直してから掛ける。
   * 角度は、下に垂らした腕で -π/2 が前、-π が真上。
   */
  private applyLimbs(ov: Override): void {
    const axis = this.tmpV.set(1, 0, 0).applyQuaternion(this.model.getWorldQuaternion(this.tmpQ2)).normalize().clone();
    const rot = (name: string, angle: number | undefined) => {
      if (!angle) return;
      const bone = this.bones[name];
      if (!bone || !bone.parent) return;
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const q = this.tmpQ.setFromAxisAngle(axis, angle).multiply(boneQ);
      bone.quaternion.copy(parentQ.invert().multiply(q));
      bone.updateMatrixWorld(true);
    };
    rot('UpperArmR', ov.armR);
    rot('UpperArmL', ov.armL);
    rot('UpperLegR', ov.legR);
    rot('UpperLegL', ov.legL);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.mats) m.dispose();
    // モデル本体の形状データは全キャラで共有しているので、ここでは捨てない
  }
}
