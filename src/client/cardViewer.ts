// プロフィールの名刺カードで、お気に入りのキャラを3Dで動かして見せる。
// 描画の入れ物（WebGL）は1つだけ作り、カードを描き直すたびに新しいカードの絵の場所へ付け替えて使い回す。

import * as THREE from 'three';
import { getCharacter } from '../shared/characters';
import { getCostume } from '../shared/costumes';
import type { ViewFighter } from '../shared/types';
import { FighterModel } from './fighterModel';

/** 何もしないときに、自分から動き（アクション）をする間隔（秒） */
const AUTO_ACTION = 6;

export class CardViewer {
  private gl: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 0.8, 0.1, 50);
  private model: FighterModel | null = null;
  private key = '';
  private charId = '';
  private host: HTMLElement | null = null;
  private raf = 0;
  private last = 0;
  private time = 0;
  private idle = 0;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.8));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(1, 3, 5);
    this.scene.add(sun);
  }

  /** host（カードの絵の場所）に、そのキャラ・衣装を動かして出す。WebGL が使えなければ何もしない（静止画のまま） */
  mount(host: HTMLElement, charId: string, costumeId: string): void {
    if (!this.gl) {
      try {
        this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        return;
      }
      this.gl.outputColorSpace = THREE.SRGBColorSpace;
      this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      this.gl.setClearColor(0x000000, 0);
      this.gl.domElement.className = 'pc-canvas';
      this.gl.domElement.addEventListener('pointerdown', () => this.action());
    }
    this.host = host;
    host.appendChild(this.gl.domElement);
    host.classList.add('live');
    const key = `${charId}/${costumeId}`;
    if (key !== this.key) {
      if (this.model) {
        this.scene.remove(this.model.root);
        this.model.dispose();
      }
      const def = getCharacter(charId);
      const cos = getCostume(costumeId, charId);
      this.model = new FighterModel(def, cos, 0xffffff);
      this.model.previewTurn = 0.45;
      this.model.showMarker = false;
      // SSR・UR は、待っている間も特別な動き
      this.model.fancyIdle = cos.rarity >= 5;
      this.scene.add(this.model.root);
      this.key = key;
      this.charId = charId;
      this.idle = 0;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.frame(t));
    }
  }

  /** タップしたとき：アクション */
  action(): void {
    this.model?.playAction();
    this.idle = 0;
  }

  private frame(t: number): void {
    this.raf = 0;
    const host = this.host;
    // カードが画面から消えたら止める（入れ物は次に使う）
    if (!host || !host.isConnected || !this.gl || !this.model) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.time += dt;
    this.idle += dt;
    if (this.idle > AUTO_ACTION) this.action();
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const c = this.gl.domElement;
    if (c.width !== Math.round(w * this.gl.getPixelRatio()) || c.height !== Math.round(h * this.gl.getPixelRatio())) {
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const def = getCharacter(this.charId);
    const v: ViewFighter = {
      slot: 0, x: 0, y: 0, facing: 1, state: 'idle', stateTime: Math.floor(this.time * 60), move: null, moveFrame: 0,
      damage: 0, stocks: 0, invuln: false, shield: 1, charge: 0, kos: 0, falls: 0, out: false, poison: false, fx: 0,
    };
    this.model.update(v, def, this.time, dt);
    // 全身が入るように（大きいキャラは少し引く）
    const hy = 1.05 * def.scale;
    this.camera.position.set(0.3, hy + 0.15, 5.4 * def.scale);
    this.camera.lookAt(0, hy, 0);
    this.gl.render(this.scene, this.camera);
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }
}
