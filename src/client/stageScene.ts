// ステージの見た目（サイバーパンク風）を組み立てる。
// 当たり判定は shared/stages.ts の数値で決まっており、ここは見た目だけ。

import * as THREE from 'three';
import type { StageDef } from '../shared/stages';
import type { Quality } from './renderer';

export interface BuiltStage {
  /** ステージ一式（背景も含む） */
  group: THREE.Group;
  /** すり抜け足場の見た目（動く足場の位置合わせに使う） */
  platformMeshes: THREE.Object3D[];
  /** 毎フレームの動き（LEDの点滅、看板のちらつき、雨など） */
  animate(time: number, dt: number): void;
  dispose(): void;
}

const FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSkyTexture(top: number, bottom: number): THREE.CanvasTexture {
  return canvasTexture(4, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, hex(top));
    grad.addColorStop(1, hex(bottom));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
  });
}

export function buildStageScene(stage: StageDef, quality: Quality): BuiltStage {
  const th = stage.theme;
  const group = new THREE.Group();
  const platformMeshes: THREE.Object3D[] = [];
  const animators: ((t: number, dt: number) => void)[] = [];
  const disposables: { dispose(): void }[] = [];
  const high = quality === 'high';
  const rnd = rand(stage.id.length * 7919 + 17);
  const m = stage.main;
  const cx = (m.x1 + m.x2) / 2;
  const w = m.x2 - m.x1;

  const track = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const basic = (color: number, extra: THREE.MeshBasicMaterialParameters = {}) => track(new THREE.MeshBasicMaterial({ color, ...extra }));
  const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => track(new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra }));
  const add = (mesh: THREE.Object3D, parent: THREE.Object3D = group) => {
    parent.add(mesh);
    return mesh;
  };
  const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(sx, sy, sz)), mat);
    mesh.position.set(x, y, z);
    return add(mesh) as THREE.Mesh;
  };

  // ---------------------------------------------------------------- 窓の明かりのテクスチャ
  const windowTex = (seed: number, lit: string, density: number) =>
    track(
      canvasTexture(64, 128, (g) => {
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
      }),
    );

  // ---------------------------------------------------------------- ネオン看板
  const neonSign = (text: string, color: number, width: number, vertical = false) => {
    const chars = [...text];
    const cw = vertical ? 96 : Math.max(128, chars.length * 70);
    const ch = vertical ? Math.max(128, chars.length * 80) : 96;
    const tex = track(
      canvasTexture(cw, ch, (g) => {
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
      }),
    );
    const height = (width * ch) / cw;
    const mesh = new THREE.Mesh(track(new THREE.PlaneGeometry(width, height)), basic(0xffffff, { map: tex, transparent: true }));
    return mesh;
  };

  // ---------------------------------------------------------------- 背景：夜空の星
  if (th.kind !== 'cyber') {
    const n = high ? 400 : 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 260;
      pos[i * 3 + 1] = 10 + rnd() * 70;
      pos[i * 3 + 2] = -110 - rnd() * 20;
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    add(new THREE.Points(geo, track(new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, sizeAttenuation: true, fog: false }))));
  }

  // ---------------------------------------------------------------- 背景：ビル群（3層。奥ほどゆっくり動いて見える）
  const tints = [th.neonA, th.neonB, 0xffd9a0];
  const layers = high
    ? [
        { z: -26, count: 16, hMin: 6, hMax: 16, wMin: 3, wMax: 6, spread: 70 },
        { z: -46, count: 20, hMin: 10, hMax: 28, wMin: 4, wMax: 8, spread: 110 },
        { z: -78, count: 24, hMin: 16, hMax: 44, wMin: 5, wMax: 10, spread: 170 },
      ]
    : [
        { z: -30, count: 14, hMin: 6, hMax: 18, wMin: 3, wMax: 6, spread: 80 },
        { z: -70, count: 16, hMin: 14, hMax: 40, wMin: 5, wMax: 10, spread: 160 },
      ];
  if (th.kind !== 'cyber') {
    layers.forEach((L, li) => {
      for (let v = 0; v < 3; v++) {
        const tex = windowTex(li * 31 + v * 7 + stage.id.length, hex(tints[v]), th.kind === 'arcade' ? 0.45 : 0.32);
        const count = Math.ceil(L.count / 3);
        const inst = new THREE.InstancedMesh(track(new THREE.BoxGeometry(1, 1, 1)), basic(0xffffff, { map: tex }), count);
        const mtx = new THREE.Matrix4();
        for (let i = 0; i < count; i++) {
          const bw = L.wMin + rnd() * (L.wMax - L.wMin);
          const bh = L.hMin + rnd() * (L.hMax - L.hMin);
          const x = cx + (rnd() - 0.5) * L.spread * 2;
          mtx.compose(new THREE.Vector3(x, -14 + bh / 2, L.z - rnd() * 6), new THREE.Quaternion(), new THREE.Vector3(bw, bh, bw * 0.8));
          inst.setMatrixAt(i, mtx);
        }
        add(inst);
      }
    });
    // ビルの上のネオン看板
    const words =
      th.kind === 'rooftop'
        ? ['DATA', '24H', 'SERVER', 'クラウド', '回線混雑中', 'NODE']
        : ['ラーメン', 'カラオケ', 'ネカフェ', 'SALE', 'ガチャ', '24時間', '激安'];
    words.forEach((word, i) => {
      const color = i % 2 ? th.neonA : th.neonB;
      const vertical = th.kind === 'arcade' && i % 3 === 0;
      const sign = neonSign(word, color, vertical ? 1.6 : 4 + rnd() * 2, vertical);
      sign.position.set(cx + (i - words.length / 2) * 11 + rnd() * 4, 4 + rnd() * 10, -24 - rnd() * 4);
      add(sign);
      const mat = sign.material as THREE.MeshBasicMaterial;
      const phase = rnd() * 10;
      animators.push((t) => {
        // ときどきチカチカする
        const flick = Math.sin(t * 13 + phase) > 0.96 || Math.sin(t * 0.7 + phase) > 0.995;
        mat.opacity = flick ? 0.35 : 1;
      });
    });
  }

  // ---------------------------------------------------------------- 月（データセンター屋上）
  if (th.kind === 'rooftop') {
    const moon = new THREE.Mesh(track(new THREE.CircleGeometry(5, 32)), basic(0xfff3d0, { fog: false }));
    moon.position.set(cx + 30, 32, -105);
    add(moon);
  }

  // ---------------------------------------------------------------- ステージ本体
  const neonA = basic(th.neonA);
  const neonB = basic(th.neonB);
  if (th.kind === 'rooftop') {
    // 屋上の床（コンクリート）と、手前の黄色黒の注意線、ネオンの縁
    box(w, 0.5, 5, std(0x3a3d4a), cx, m.top - 0.25, 0);
    const hazard = track(
      canvasTexture(128, 16, (g) => {
        for (let x = -16; x < 128; x += 16) {
          g.fillStyle = '#ffd23f';
          g.beginPath();
          g.moveTo(x, 16);
          g.lineTo(x + 8, 0);
          g.lineTo(x + 16, 0);
          g.lineTo(x + 8, 16);
          g.fill();
        }
      }),
    );
    hazard.wrapS = THREE.RepeatWrapping;
    hazard.repeat.set(w / 1.5, 1);
    box(w, 0.14, 0.05, std(0x111111, { map: hazard }), cx, m.top - 0.1, 2.51);
    box(w, 0.06, 0.06, neonA, cx, m.top + 0.01, 2.48);
    // 下のビル（窓の明かり）
    const facade = windowTex(99, hex(th.neonA), 0.35);
    facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
    facade.repeat.set(4, 3);
    box(w * 0.96, 14, 4.6, std(0x1a1a28, { emissive: 0xffffff, emissiveMap: facade, emissiveIntensity: 0.9, map: facade }), cx, m.top - 7.5, -0.1);
    // サーバーラック（奥）。LEDが点滅する
    const leds: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const x = cx - w / 2 + 2 + i * ((w - 4) / 4);
      if (Math.abs(x - cx) < 1.5) continue;
      box(1.0, 1.8, 0.7, std(0x15161f, { metalness: 0.4 }), x, m.top + 0.9, -1.9);
      for (let k = 0; k < 6; k++) {
        const led = box(0.08, 0.05, 0.02, k % 2 ? neonA : basic(0x4fff7a), x - 0.3 + (k % 3) * 0.2, m.top + 0.4 + Math.floor(k / 3) * 0.6, -1.54);
        leds.push(led);
      }
    }
    animators.push((t) => leds.forEach((l, i) => (l.visible = Math.sin(t * (3 + (i % 5)) + i * 1.7) > -0.3)));
    // 室外機・給水タンク・アンテナ
    box(1.4, 0.9, 0.9, std(0x8a8fa0), cx + w / 2 - 1.3, m.top + 0.45, -1.9);
    const fan = new THREE.Mesh(track(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 16)), std(0x2a2a33));
    fan.rotation.x = Math.PI / 2;
    fan.position.set(cx + w / 2 - 1.3, m.top + 0.45, -1.43);
    add(fan);
    const tank = new THREE.Mesh(track(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 16)), std(0x5a6070));
    tank.position.set(cx - w / 2 + 1.0, m.top + 0.7, -2.0);
    add(tank);
    box(0.08, 4.5, 0.08, std(0x777a88), cx - w / 2 + 0.4, m.top + 2.25, -1.4);
    const beacon = box(0.22, 0.22, 0.22, basic(0xff3030), cx - w / 2 + 0.4, m.top + 4.6, -1.4);
    animators.push((t) => (beacon.visible = Math.sin(t * 3) > 0));
  } else if (th.kind === 'arcade') {
    // 通り（アスファルト）と、手前・奥のネオンの縁
    box(w, 0.5, 5, std(0x2b2730), cx, m.top - 0.25, 0);
    box(w, 0.07, 0.07, neonA, cx, m.top + 0.01, 2.48);
    box(w, 0.05, 0.05, neonB, cx, m.top + 0.01, -2.4);
    // 下：シャッターの並ぶ建物
    const shutter = track(
      canvasTexture(64, 64, (g) => {
        g.fillStyle = '#2a2833';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#3a3845';
        for (let y = 0; y < 64; y += 6) g.fillRect(0, y, 64, 3);
      }),
    );
    shutter.wrapS = shutter.wrapT = THREE.RepeatWrapping;
    shutter.repeat.set(w / 2, 4);
    box(w * 0.98, 12, 4.6, std(0x2a2833, { map: shutter }), cx, m.top - 6.5, -0.1);
    // 店先（奥）：看板と店の明かり
    const shops = ['ラーメン', 'カラオケ', 'ネカフェ', 'くすり', 'ガチャ'];
    shops.forEach((name, i) => {
      const x = cx - w / 2 + 2 + i * ((w - 4) / (shops.length - 1));
      box(3.4, 3.6, 1.0, std(0x1d1a26), x, m.top + 1.8, -3.2);
      box(2.8, 1.6, 0.05, basic(i % 2 ? 0xffe2a8 : 0xa8e8ff, { transparent: true, opacity: 0.55 }), x, m.top + 1.0, -2.68);
      const sign = neonSign(name, i % 2 ? th.neonA : th.neonB, 2.8);
      sign.position.set(x, m.top + 2.9, -2.66);
      add(sign);
      // ひさし
      // ひさし（手前に下がるように傾けて、上の面が見えるようにする）
      const awn = box(3.4, 0.08, 0.8, basic(i % 2 ? th.neonB : th.neonA, { transparent: true, opacity: 0.85 }), x, m.top + 2.25, -2.4);
      awn.rotation.x = -0.3;
    });
    // 自動販売機
    box(0.8, 1.7, 0.6, std(0xd8dde8), cx + w / 2 - 0.8, m.top + 0.85, -2.2);
    box(0.62, 0.9, 0.02, basic(0xbff6ff), cx + w / 2 - 0.8, m.top + 1.05, -1.89);
  } else {
    // 電脳空間：光るグリッドの台
    const grid = track(
      canvasTexture(64, 64, (g) => {
        g.fillStyle = '#021018';
        g.fillRect(0, 0, 64, 64);
        g.strokeStyle = hex(th.neonA);
        g.lineWidth = 2;
        g.strokeRect(1, 1, 62, 62);
      }),
    );
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    grid.repeat.set(w / 1.5, 5 / 1.5);
    box(w, 0.5, 5, std(0x02121a, { map: grid, emissive: 0xffffff, emissiveMap: grid, emissiveIntensity: 0.6 }), cx, m.top - 0.25, 0);
    box(w, 0.06, 0.06, neonA, cx, m.top + 0.01, 2.48);
    box(w, 0.06, 0.06, neonA, cx, m.top + 0.01, -2.48);
    // 台の下：逆さのピラミッド（線だけ）
    const cone = new THREE.Mesh(track(new THREE.ConeGeometry(w / 2, 9, 4, 1, true)), basic(th.neonB, { wireframe: true, transparent: true, opacity: 0.6 }));
    cone.rotation.set(Math.PI, Math.PI / 4, 0);
    cone.position.set(cx, m.top - 5, 0);
    add(cone);
    // 遠くまで続くグリッドの床
    const floor = new THREE.GridHelper(400, 100, th.neonA, th.neonB);
    floor.position.set(cx, -16, -60);
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.55;
    track(floor.geometry);
    add(floor);
    // 浮かんで回る立体
    const shapes: THREE.Mesh[] = [];
    for (let i = 0; i < (high ? 14 : 7); i++) {
      const geo = i % 2 ? new THREE.OctahedronGeometry(1 + rnd() * 2, 0) : new THREE.BoxGeometry(1.5 + rnd() * 2, 1.5 + rnd() * 2, 1.5 + rnd() * 2);
      const mesh = new THREE.Mesh(track(geo), basic(i % 3 ? th.neonA : th.neonB, { wireframe: true }));
      mesh.position.set(cx + (rnd() - 0.5) * 120, -4 + rnd() * 30, -30 - rnd() * 50);
      add(mesh);
      shapes.push(mesh);
    }
    animators.push((t) =>
      shapes.forEach((s, i) => {
        s.rotation.set(t * 0.2 + i, t * 0.3 + i * 0.5, 0);
        s.position.y += Math.sin(t + i) * 0.003;
      }),
    );
    // 流れ落ちるデータ
    if (high) {
      const n = 120;
      const pos = new Float32Array(n * 6);
      const speed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 100;
        const y = rnd() * 40 - 10;
        const z = -15 - rnd() * 40;
        pos.set([x, y, z, x, y - 1.5, z], i * 6);
        speed[i] = 4 + rnd() * 8;
      }
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      add(new THREE.LineSegments(geo, track(new THREE.LineBasicMaterial({ color: th.neonA, transparent: true, opacity: 0.6 }))));
      animators.push((_t, dt) => {
        const a = geo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < n; i++) {
          let y = a.getY(i * 2) - speed[i] * dt;
          if (y < -14) y = 30;
          a.setY(i * 2, y);
          a.setY(i * 2 + 1, y - 1.5);
        }
        a.needsUpdate = true;
      });
    }
  }

  // ---------------------------------------------------------------- すり抜け足場
  for (const p of stage.platforms) {
    const g = new THREE.Group();
    const pw = p.x2 - p.x1;
    if (th.kind === 'cyber') {
      // ホログラムの窓
      const panel = new THREE.Mesh(track(new THREE.BoxGeometry(pw, 0.16, 2.2)), basic(th.neonA, { transparent: true, opacity: 0.35 }));
      g.add(panel);
      const edge = new THREE.Mesh(track(new THREE.BoxGeometry(pw, 0.05, 0.05)), neonA);
      edge.position.set(0, 0.06, 1.1);
      g.add(edge);
      const bar = new THREE.Mesh(track(new THREE.BoxGeometry(pw, 0.22, 0.05)), neonB);
      bar.position.set(0, 0.0, -1.1);
      g.add(bar);
    } else {
      const slab = new THREE.Mesh(track(new THREE.BoxGeometry(pw, 0.22, 2.4)), std(th.kind === 'arcade' ? 0x2a2433 : 0x3a3d4a));
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      const edge = new THREE.Mesh(track(new THREE.BoxGeometry(pw, 0.05, 0.05)), th.kind === 'arcade' ? neonB : neonA);
      edge.position.set(0, 0.1, 1.2);
      g.add(edge);
    }
    g.position.set((p.x1 + p.x2) / 2, p.y - 0.11, 0);
    group.add(g);
    platformMeshes.push(g);
  }

  // ---------------------------------------------------------------- 雨（ネオン商店街・画質「きれい」）
  if (th.kind === 'arcade' && high) {
    const n = 260;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 50;
      const y = rnd() * 30 - 5;
      const z = (rnd() - 0.3) * 10;
      pos.set([x, y, z, x - 0.05, y - 0.5, z], i * 6);
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    add(new THREE.LineSegments(geo, track(new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.35 }))));
    animators.push((_t, dt) => {
      const a = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        let y = a.getY(i * 2) - 22 * dt;
        if (y < -6) y += 32;
        a.setY(i * 2, y);
        a.setY(i * 2 + 1, y - 0.5);
      }
      a.needsUpdate = true;
    });
  }

  // ---------------------------------------------------------------- ネオンの色の照明（キャラに色が乗る）
  const lightA = new THREE.PointLight(th.neonA, 40, 30, 1.6);
  lightA.position.set(cx - w / 2 - 2, m.top + 6, 5);
  const lightB = new THREE.PointLight(th.neonB, 40, 30, 1.6);
  lightB.position.set(cx + w / 2 + 2, m.top + 6, 5);
  group.add(lightA, lightB);

  return {
    group,
    platformMeshes,
    animate: (t, dt) => animators.forEach((a) => a(t, dt)),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
