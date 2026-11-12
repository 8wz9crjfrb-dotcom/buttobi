// ステージの見た目。キャラごとのステージ9つ（ジムを含む）と、デフォルト（そらの台地）を組み立てる。
// 当たり判定は shared/stages.ts の数値で決まっていて、ここは見た目だけ。

import * as THREE from 'three';
import type { StageDef } from '../shared/stages';
import type { Quality } from './renderer';
import {
  cloudTexture,
  FONT,
  hex,
  Kit,
  MONO,
  mix,
  neonSign,
  rand,
  skylineBackdrop,
  speckle,
  stars,
  windowsTexture,
  type BuiltStage,
} from './stageKit';

export { makeSkyTexture, type BuiltStage } from './stageKit';

export function buildStageScene(stage: StageDef, quality: Quality): BuiltStage {
  const kit = new Kit(stage, quality);
  switch (stage.theme.kind) {
    case 'sky':
      buildSky(kit);
      break;
    case 'rooftop':
      buildRooftop(kit);
      break;
    case 'cyber':
      buildCyber(kit);
      break;
    case 'vault':
      buildVault(kit);
      break;
    case 'studio':
      buildStudio(kit);
      break;
    case 'timeline':
      buildTimeline(kit);
      break;
    case 'gacha':
      buildGacha(kit);
      break;
    case 'arcade':
      buildArcade(kit);
      break;
    case 'lab':
      buildLab(kit);
      break;
    case 'gym':
      buildGym(kit);
      break;
  }
  return kit.finish();
}

/** 本体の台（面取りした厚い板）を置く */
function mainSlab(kit: Kit, top: THREE.Material, front: THREE.Material, h = 0.7, d = 5): THREE.Mesh {
  const s = kit.slab(kit.w, h, d, [front, top], { radius: 0.16, bevel: 0.08 });
  s.position.set(kit.cx, kit.m.top, 0);
  return kit.add(s);
}

/** アクセント色の照明を左右に置く（キャラに色が乗る） */
function accentLights(kit: Kit, a: number, b: number, power = 40): void {
  const { cx, w, m } = kit;
  const la = new THREE.PointLight(a, power, 30, 1.6);
  la.position.set(cx - w / 2 - 2, m.top + 6, 5);
  const lb = new THREE.PointLight(b, power, 30, 1.6);
  lb.position.set(cx + w / 2 + 2, m.top + 6, 5);
  kit.group.add(la, lb);
}

// ====================================================================== そらの台地（デフォルト）
function buildSky(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const grass = th.accentA;
  const earth = th.accentB;

  // 太陽と光の輪
  const sun = kit.plane(26, 26, kit.basic(0xffffff, { map: kit.soft(), transparent: true, depthWrite: false, fog: false, opacity: 0.95 }), cx - 40, 34, -125);
  kit.plane(9, 9, kit.basic(0xfffbe8, { map: kit.soft(), transparent: true, depthWrite: false, fog: false }), cx - 40, 34, -124);
  kit.anim((t) => sun.scale.setScalar(1 + Math.sin(t * 0.6) * 0.03));

  // 雲の層（奥ほど小さく、ゆっくり流れる）
  const cloudLayers = high ? [
    { z: -115, y: [-8, 22], n: 7, s: 34, speed: 0.4, shade: 'rgba(150,180,220,0.45)' },
    { z: -75, y: [-10, 14], n: 6, s: 24, speed: 0.8, shade: 'rgba(140,170,215,0.45)' },
    { z: -42, y: [-12, -3], n: 5, s: 18, speed: 1.3, shade: 'rgba(130,160,210,0.5)' },
  ] : [
    { z: -110, y: [-8, 20], n: 5, s: 34, speed: 0.4, shade: 'rgba(150,180,220,0.45)' },
    { z: -50, y: [-12, -2], n: 4, s: 20, speed: 1.1, shade: 'rgba(130,160,210,0.5)' },
  ];
  cloudLayers.forEach((L, li) => {
    const texs = [0, 1, 2].map((k) => cloudTexture(kit, li * 10 + k + 3, L.shade));
    const span = 260;
    const items: THREE.Mesh[] = [];
    for (let i = 0; i < L.n; i++) {
      const s = L.s * (0.7 + rnd() * 0.6);
      const me = kit.plane(s, s * 0.375, kit.basic(0xffffff, { map: texs[i % 3], transparent: true, depthWrite: false }), cx - span / 2 + (i / L.n) * span + rnd() * 20, L.y[0] + rnd() * (L.y[1] - L.y[0]), L.z - rnd() * 6);
      items.push(me);
    }
    kit.anim((_t, dt) => {
      for (const me of items) {
        me.position.x += L.speed * dt;
        if (me.position.x > cx + span / 2) me.position.x -= span;
      }
    });
  });

  // 遠くの浮島（シルエット。霞で青く見える）
  const island = (g: CanvasRenderingContext2D, cw: number, ch: number, seed: number, top: string, rock: string) => {
    const r = rand(seed);
    let x = 40;
    while (x < cw - 120) {
      const iw = 120 + r() * 200;
      const ih = ch * (0.35 + r() * 0.35);
      const y = ch * (0.2 + r() * 0.35);
      // 岩（下にとがる）
      g.fillStyle = rock;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k <= 8; k++) {
        const px = x + (iw * k) / 8;
        const depth = Math.sin((k / 8) * Math.PI) * ih * (0.7 + r() * 0.3);
        g.lineTo(px, y + depth);
      }
      g.lineTo(x + iw, y);
      g.closePath();
      g.fill();
      // 草の上面
      g.fillStyle = top;
      g.beginPath();
      g.ellipse(x + iw / 2, y, iw / 2 + 6, 10, 0, 0, Math.PI * 2);
      g.fill();
      // 木
      for (let k = 0; k < 3; k++) {
        if (r() < 0.5) continue;
        const tx = x + 20 + r() * (iw - 40);
        g.beginPath();
        g.arc(tx, y - 12, 10 + r() * 8, 0, Math.PI * 2);
        g.fill();
      }
      x += iw + 80 + r() * 160;
    }
  };
  kit.backdrop(300, 70, cx + 10, 6, -100, (g, cw, ch) => island(g, cw, ch, 11, '#a9cde6', '#a3bcd6'));
  kit.backdrop(220, 55, cx - 20, 0, -62, (g, cw, ch) => island(g, cw, ch, 23, '#8fc7a0', '#8fa4c4'));

  // 鳥（V字。ゆっくり横切る）
  const birdMat = kit.basic(0x3a4a66, { transparent: true, opacity: 0.7 });
  const birds: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Group();
    for (const s of [1, -1]) {
      const wing = kit.box(0.5, 0.05, 0.02, birdMat, s * 0.22, 0, 0, b);
      wing.rotation.z = s * 0.35;
      wing.name = s > 0 ? 'r' : 'l';
    }
    b.position.set(cx - 60 + i * 9, 10 + rnd() * 6, -32 - rnd() * 8);
    kit.add(b);
    birds.push(b);
  }
  kit.anim((t, dt) => {
    birds.forEach((b, i) => {
      b.position.x += (2.4 + i * 0.3) * dt;
      b.position.y += Math.sin(t + i) * 0.004;
      if (b.position.x > cx + 70) b.position.x = cx - 70;
      const flap = Math.sin(t * 9 + i * 2) * 0.5;
      (b.getObjectByName('r') as THREE.Mesh).rotation.z = 0.35 + flap;
      (b.getObjectByName('l') as THREE.Mesh).rotation.z = -0.35 - flap;
    });
  });

  // 本体の台：草の上面と、地層の見える土の正面
  const grassTex = kit.tex(256, 256, (g) => {
    g.fillStyle = hex(grass);
    g.fillRect(0, 0, 256, 256);
    const r = rand(5);
    for (let i = 0; i < 900; i++) {
      const x = r() * 256;
      const y = r() * 256;
      g.strokeStyle = r() < 0.5 ? hex(mix(grass, 0x1f5a2a, 0.35)) : hex(mix(grass, 0xffffff, 0.25));
      g.globalAlpha = 0.35 + r() * 0.4;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 6, y - 6 - r() * 8);
      g.stroke();
    }
    g.globalAlpha = 1;
    // 小さな花
    for (let i = 0; i < 18; i++) {
      g.fillStyle = ['#fff6a8', '#ffffff', '#ffb3d1'][i % 3];
      g.beginPath();
      g.arc(r() * 256, r() * 256, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }, [3, 3]);
  const strataTex = kit.tex(256, 256, (g) => {
    const r = rand(9);
    let y = 0;
    while (y < 256) {
      const h = 14 + r() * 30;
      g.fillStyle = hex(mix(earth, r() < 0.5 ? 0x3a2a1e : 0xc9a06a, r() * 0.35));
      g.fillRect(0, y, 256, h);
      y += h;
    }
    speckle(g, 256, 256, r, ['#2a1d14', '#d8b88a'], 500, 3);
    // ひび
    g.strokeStyle = 'rgba(40,25,15,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      let x = r() * 256;
      let yy = r() * 256;
      g.beginPath();
      g.moveTo(x, yy);
      for (let k = 0; k < 4; k++) {
        x += (r() - 0.5) * 30;
        yy += 10 + r() * 20;
        g.lineTo(x, yy);
      }
      g.stroke();
    }
  }, [4, 4]);
  const grassMat = kit.toon(0xffffff, { map: grassTex });
  const earthMat = kit.toon(0xffffff, { map: strataTex });
  mainSlab(kit, grassMat, earthMat, 0.9, 5);
  // 草が手前に垂れ下がる縁
  const fringe = kit.tex(512, 64, (g) => {
    const r = rand(4);
    g.fillStyle = hex(mix(grass, 0x1f5a2a, 0.1));
    g.beginPath();
    g.moveTo(0, 0);
    for (let x = 0; x <= 512; x += 8) g.lineTo(x, 14 + r() * 30 + (x % 24 === 0 ? 14 : 0));
    g.lineTo(512, 0);
    g.closePath();
    g.fill();
  });
  fringe.wrapS = THREE.RepeatWrapping;
  fringe.repeat.set(w / 8, 1);
  kit.plane(w + 0.2, 0.55, kit.toon(0xffffff, { map: fringe, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }), cx, m.top - 0.3, 2.53);

  // 台の下の岩のかたまり（段々に細くなる）
  const rockMat = kit.toon(0xffffff, { map: strataTex });
  const tiers = [
    { r: w * 0.48, h: 2.2 },
    { r: w * 0.36, h: 2.4 },
    { r: w * 0.22, h: 2.6 },
    { r: w * 0.08, h: 2.2 },
  ];
  let y = m.top - 0.9;
  tiers.forEach((tr, i) => {
    const next = tiers[i + 1]?.r ?? 0.2;
    const geo = new THREE.CylinderGeometry(tr.r, next, tr.h, 9, 1);
    const me = kit.mesh(geo, rockMat, cx + (i % 2 ? 0.4 : -0.3), y - tr.h / 2, -0.2);
    me.scale.z = 4.6 / (w * 0.96);
    me.rotation.y = i * 0.4;
    y -= tr.h * 0.92;
  });
  // ぶら下がる小さな岩とつる
  for (let i = 0; i < 6; i++) {
    const x = cx + (rnd() - 0.5) * w * 0.7;
    const cone = kit.mesh(new THREE.ConeGeometry(0.3 + rnd() * 0.4, 1 + rnd() * 1.5, 6), rockMat, x, m.top - 1.6 - rnd() * 2, 1.2 + rnd());
    cone.rotation.x = Math.PI;
  }

  // 台の奥の飾り：木・茂み・花
  const leaf = kit.toon(mix(grass, 0x1f5a2a, 0.15));
  const leaf2 = kit.toon(mix(grass, 0xffffff, 0.12));
  const trunk = kit.toon(0x7a5338);
  const tree = (x: number, s: number) => {
    kit.mesh(new THREE.CylinderGeometry(0.16 * s, 0.22 * s, 1.6 * s, 7), trunk, x, m.top + 0.8 * s, -1.9);
    for (let k = 0; k < 4; k++) {
      kit.mesh(new THREE.IcosahedronGeometry((0.8 - k * 0.1) * s, 1), k % 2 ? leaf2 : leaf, x + (rnd() - 0.5) * 0.7 * s, m.top + (1.7 + k * 0.45) * s, -1.9 + (rnd() - 0.5) * 0.4);
    }
  };
  tree(m.x1 + 1.3, 1.1);
  tree(m.x2 - 1.6, 0.85);
  for (let i = 0; i < 6; i++) {
    const x = m.x1 + 2.6 + (i / 5) * (w - 5.2) + (rnd() - 0.5);
    for (let k = 0; k < 3; k++) kit.mesh(new THREE.IcosahedronGeometry(0.28 + rnd() * 0.18, 1), k % 2 ? leaf2 : leaf, x + (k - 1) * 0.3, m.top + 0.22, -2.1 + rnd() * 0.3);
  }
  const petals = [0xfff6a8, 0xffffff, 0xffb3d1];
  for (let i = 0; i < 16; i++) {
    kit.mesh(new THREE.SphereGeometry(0.06, 6, 5), kit.toon(petals[i % 3]), m.x1 + 0.6 + rnd() * (w - 1.2), m.top + 0.06, -1.2 - rnd() * 1.1);
  }

  // すり抜け足場（このステージにはないが、地形を変えたときのため）：草の浮き板
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.32, 2.2, [earthMat, grassMat], { radius: 0.1, bevel: 0.05 }));
  });

  // 舞う花粉
  kit.particles({ count: high ? 70 : 30, x: [cx - 24, cx + 24], y: [m.top - 6, m.top + 14], z: [-8, 4], color: [0xffffff, 0xfff6c8], size: 0.18, vx: 0.4, vy: 0.15, wobble: 0.4, opacity: 0.7 });
}

// ====================================================================== データセンター屋上（警備員）
function buildRooftop(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  stars(kit, 420);
  // 月と、月にかかる薄い雲
  kit.plane(30, 30, kit.basic(0xb8c8ff, { map: kit.soft(), transparent: true, depthWrite: false, fog: false, opacity: 0.35 }), cx + 30, 32, -112);
  kit.mesh(new THREE.CircleGeometry(5, 40), kit.basic(0xfff3d0, { fog: false }), cx + 30, 32, -110);
  const thin = cloudTexture(kit, 77, 'rgba(20,10,40,0.6)');
  const moonCloud = kit.plane(36, 13, kit.basic(0x6a5a9a, { map: thin, transparent: true, depthWrite: false, opacity: 0.55, fog: false }), cx + 22, 29, -105);
  kit.anim((t) => (moonCloud.position.x = cx + 22 + Math.sin(t * 0.05) * 12));

  // 遠景の街のシルエット（2層）＋ビル群（箱）
  skylineBackdrop(kit, -118, 0, 48, '#120c26', hex(th.accentA), 31, 320);
  skylineBackdrop(kit, -95, -4, 40, '#1a1236', '#ffd9a0', 32, 280);
  cityBlocks(kit, [th.accentA, th.accentB, 0xffd9a0], 0.32);
  // 高い塔の上の航空障害灯（赤く点滅）
  const beacons: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) beacons.push(kit.mesh(new THREE.SphereGeometry(0.35, 8, 6), kit.glow(0xff3030), cx - 60 + i * 30 + rnd() * 10, 18 + rnd() * 16, -80));
  kit.anim((t) => beacons.forEach((b, i) => (b.visible = Math.sin(t * 2 + i * 1.3) > 0.2)));

  // サーチライト（街から空へ。ゆっくり首を振る）
  const lights = [-1, 1].map((s) => {
    const b = kit.beam(0xbfe6ff, 70, 5, 0.045);
    b.position.set(cx + s * 34, -18, -70);
    return b;
  });
  kit.anim((t) => {
    lights[0].rotation.z = Math.PI + Math.sin(t * 0.35) * 0.45 - 0.2;
    lights[1].rotation.z = Math.PI + Math.sin(t * 0.3 + 2) * 0.45 + 0.2;
  });

  // 屋上の床：コンクリートの継ぎ目・汚れ・ヘリポートの印
  const concrete = kit.tex(512, 512, (g) => {
    g.fillStyle = '#4a4e5c';
    g.fillRect(0, 0, 512, 512);
    const r = rand(12);
    speckle(g, 512, 512, r, ['#5a5f6e', '#3a3d49', '#666b7a'], 2500, 3);
    g.strokeStyle = 'rgba(20,20,30,0.6)';
    g.lineWidth = 3;
    for (let i = 0; i <= 512; i += 128) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    // しみ
    for (let i = 0; i < 6; i++) {
      const grad = g.createRadialGradient(r() * 512, r() * 512, 0, 256, 256, 60 + r() * 60);
      grad.addColorStop(0, 'rgba(20,20,30,0.18)');
      grad.addColorStop(1, 'rgba(20,20,30,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 512);
    }
  }, [6, 6]);
  const facade = windowsTexture(kit, 99, hex(th.accentA), 0.35);
  facade.wrapS = facade.wrapT = THREE.RepeatWrapping;
  facade.repeat.set(1 / 4, 1 / 4);
  mainSlab(kit, kit.toon(0xffffff, { map: concrete }), kit.std(0x1a1a28, { map: facade, emissive: 0xffffff, emissiveMap: facade, emissiveIntensity: 0.9 }), 0.7, 5);
  // ヘリポートの「H」（床にうっすら）
  const helipad = kit.tex(256, 256, (g) => {
    g.strokeStyle = 'rgba(255,210,63,0.55)';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 100, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.font = `900 150px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('H', 128, 182);
  });
  const hp = kit.plane(3.4, 3.4, kit.basic(0xffffff, { map: helipad, transparent: true, depthWrite: false }), cx, m.top + 0.005, -0.3);
  hp.rotation.x = -Math.PI / 2;
  // 手前の黄色と黒の注意線と、ネオンの縁
  const hazard = kit.tex(128, 16, (g) => {
    g.fillStyle = '#111111';
    g.fillRect(0, 0, 128, 16);
    for (let x = -16; x < 128; x += 16) {
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.moveTo(x, 16);
      g.lineTo(x + 8, 0);
      g.lineTo(x + 16, 0);
      g.lineTo(x + 8, 16);
      g.fill();
    }
  });
  hazard.wrapS = THREE.RepeatWrapping;
  hazard.repeat.set(w / 1.5, 1);
  kit.box(w - 0.2, 0.14, 0.04, kit.basic(0xffffff, { map: hazard }), cx, m.top - 0.12, 2.52);
  kit.box(w - 0.2, 0.05, 0.05, kit.glow(th.accentA), cx, m.top + 0.01, 2.47);
  // 下のビル（窓の明かり）
  const facade2 = windowsTexture(kit, 98, hex(th.accentA), 0.35);
  facade2.wrapS = facade2.wrapT = THREE.RepeatWrapping;
  facade2.repeat.set(9, 7);
  kit.box(w * 0.96, 14, 4.6, kit.std(0x1a1a28, { map: facade2, emissive: 0xffffff, emissiveMap: facade2, emissiveIntensity: 0.9 }), cx, m.top - 7.7, -0.1);

  // 奥の手すり
  const rail = kit.toon(0x8a90a0);
  for (let x = m.x1 + 0.2; x <= m.x2 - 0.2; x += 1.2) kit.box(0.06, 1.1, 0.06, rail, x, m.top + 0.55, -2.45);
  kit.box(w - 0.4, 0.07, 0.07, rail, cx, m.top + 1.1, -2.45);
  kit.box(w - 0.4, 0.05, 0.05, rail, cx, m.top + 0.6, -2.45);

  // サーバーラック（LEDが点滅）と、排気の湯気
  const leds: THREE.Mesh[] = [];
  const rackMat = kit.toon(0x1b1d28);
  const vents: number[] = [];
  for (let i = 0; i < 5; i++) {
    const x = cx - w / 2 + 2 + i * ((w - 4) / 4);
    if (Math.abs(x - cx) < 1.8) continue;
    kit.box(1.0, 1.9, 0.75, rackMat, x, m.top + 0.95, -1.85);
    kit.box(0.9, 0.04, 0.02, kit.toon(0x33364a), x, m.top + 1.5, -1.47);
    for (let k = 0; k < 9; k++) {
      leds.push(kit.box(0.07, 0.04, 0.02, k % 3 === 0 ? kit.glow(th.accentA) : kit.glow(0x4fff7a), x - 0.3 + (k % 3) * 0.3, m.top + 0.35 + Math.floor(k / 3) * 0.45, -1.46));
    }
    vents.push(x);
  }
  kit.anim((t) => leds.forEach((l, i) => (l.visible = Math.sin(t * (3 + (i % 5)) + i * 1.7) > -0.3)));
  if (high) {
    vents.forEach((x) =>
      kit.particles({ count: 10, x: [x - 0.3, x + 0.3], y: [m.top + 1.9, m.top + 4.5], z: [-1.9, -1.7], color: 0x9aa4c4, size: 0.9, vy: 0.9, wobble: 0.15, opacity: 0.18 }),
    );
  }
  // 室外機（ファンが回る）・給水タンク・アンテナ
  kit.box(1.4, 0.9, 0.9, kit.toon(0x8a8fa0), m.x2 - 1.3, m.top + 0.45, -1.9);
  const fan = kit.mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 4), kit.toon(0x2a2a33), m.x2 - 1.3, m.top + 0.45, -1.43);
  fan.rotation.x = Math.PI / 2;
  kit.anim((t) => (fan.rotation.y = t * 8));
  kit.mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 16), kit.toon(0x5a6070), m.x1 + 1.0, m.top + 0.7, -2.0);
  kit.box(0.08, 4.5, 0.08, kit.toon(0x777a88), m.x1 + 0.4, m.top + 2.25, -1.4);
  const beacon = kit.box(0.22, 0.22, 0.22, kit.glow(0xff3030), m.x1 + 0.4, m.top + 4.6, -1.4);
  kit.anim((t) => (beacon.visible = Math.sin(t * 3) > 0));
  // 巡回の回転灯（警備員のステージ）
  const patrol = kit.beam(0xffc845, 9, 2.2, 0.12);
  patrol.position.set(m.x2 - 0.5, m.top + 2.6, -2.3);
  kit.box(0.25, 0.25, 0.25, kit.glow(0xffc845), m.x2 - 0.5, m.top + 2.6, -2.3);
  kit.box(0.06, 1.5, 0.06, rail, m.x2 - 0.5, m.top + 1.8, -2.3);
  kit.anim((t) => {
    patrol.rotation.set(Math.PI / 2, 0, t * 2.5);
  });

  // すり抜け足場：金網の床と、ネオンの縁
  const grate = kit.tex(64, 64, (g) => {
    g.fillStyle = '#2c303d';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#4a5064';
    g.lineWidth = 3;
    for (let i = 0; i < 64; i += 8) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 64);
      g.moveTo(0, i);
      g.lineTo(64, i);
      g.stroke();
    }
  }, [0.6, 0.6]);
  const gm = kit.toon(0xffffff, { map: grate });
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.24, 2.3, [kit.toon(0x3a3e4c), gm], { radius: 0.06, bevel: 0.04 }));
    kit.box(pw, 0.05, 0.05, kit.glow(th.accentA), 0, 0.01, 1.15, g);
  });
  accentLights(kit, th.accentA, th.accentB);
}

/** 夜の街のビル群（箱を並べ、窓の明かりの画像を貼る。3層） */
function cityBlocks(kit: Kit, tints: number[], density: number): void {
  const { cx, rnd, high } = kit;
  const layers = high
    ? [
        { z: -28, count: 15, hMin: 6, hMax: 16, wMin: 3, wMax: 6, spread: 70 },
        { z: -48, count: 18, hMin: 10, hMax: 28, wMin: 4, wMax: 8, spread: 110 },
        { z: -76, count: 21, hMin: 16, hMax: 44, wMin: 5, wMax: 10, spread: 170 },
      ]
    : [
        { z: -32, count: 12, hMin: 6, hMax: 18, wMin: 3, wMax: 6, spread: 80 },
        { z: -70, count: 15, hMin: 14, hMax: 40, wMin: 5, wMax: 10, spread: 160 },
      ];
  layers.forEach((L, li) => {
    for (let v = 0; v < 3; v++) {
      const t = windowsTexture(kit, li * 31 + v * 7 + kit.stage.id.length, hex(tints[v % tints.length]), density);
      const count = Math.ceil(L.count / 3);
      const inst = new THREE.InstancedMesh(kit.track(new THREE.BoxGeometry(1, 1, 1)), kit.basic(0xffffff, { map: t }), count);
      const mtx = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const bw = L.wMin + rnd() * (L.wMax - L.wMin);
        const bh = L.hMin + rnd() * (L.hMax - L.hMin);
        const x = cx + (rnd() - 0.5) * L.spread * 2;
        mtx.compose(new THREE.Vector3(x, -14 + bh / 2, L.z - rnd() * 6), new THREE.Quaternion(), new THREE.Vector3(bw, bh, bw * 0.8));
        inst.setMatrixAt(i, mtx);
      }
      kit.add(inst);
    }
  });
}

// ====================================================================== 電脳空間（ハッカー）
function buildCyber(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const green = hex(th.accentA);

  // 流れ続けるコードの壁（3枚）
  const codeTex = (seed: number) =>
    kit.tex(512, 512, (g) => {
      const r = rand(seed);
      g.fillStyle = 'rgba(0,0,0,0)';
      g.clearRect(0, 0, 512, 512);
      g.font = `20px ${MONO}`;
      const words = ['sudo', 'rm', '-rf', 'ssh', 'root@', '0x', 'for', 'if', 'pkt', 'inject', 'grant', 'void', '{', '}', '=>', 'decrypt', 'exploit', 'bypass'];
      for (let y = 20; y < 512; y += 22) {
        let x = 6 + Math.floor(r() * 4) * 24;
        while (x < 500) {
          const word = r() < 0.4 ? Math.floor(r() * 0xffff).toString(16) : words[Math.floor(r() * words.length)];
          g.fillStyle = r() < 0.12 ? '#ffffff' : green;
          g.globalAlpha = 0.35 + r() * 0.6;
          g.fillText(word, x, y);
          x += g.measureText(word).width + 12 + r() * 30;
          if (r() < 0.15) break;
        }
      }
      g.globalAlpha = 1;
    });
  const walls = [
    { x: cx - 30, y: 6, z: -40, w: 34, ry: 0.45, s: 0.06 },
    { x: cx + 32, y: 8, z: -44, w: 36, ry: -0.45, s: 0.045 },
    { x: cx, y: 14, z: -70, w: 60, ry: 0, s: 0.03 },
  ];
  walls.forEach((wl, i) => {
    const t = codeTex(40 + i);
    t.repeat.set(1, 1);
    const me = kit.plane(wl.w, wl.w * 0.7, kit.basic(0xffffff, { map: t, transparent: true, depthWrite: false, opacity: 0.55 }), wl.x, wl.y, wl.z);
    me.rotation.y = wl.ry;
    kit.scroll(t, 0, wl.s);
  });
  // 大きな文字がときどき点滅（ACCESS GRANTED など）
  const banner = kit.tex(1024, 160, (g) => {
    g.font = `900 110px ${MONO}`;
    g.textAlign = 'center';
    g.shadowColor = green;
    g.shadowBlur = 30;
    g.fillStyle = green;
    g.fillText('ACCESS GRANTED', 512, 120);
  });
  const bn = kit.plane(40, 6.25, kit.basic(0xffffff, { map: banner, transparent: true, depthWrite: false, opacity: 0.7 }), cx, 22, -60);
  kit.anim((t) => {
    const ph = t % 7;
    (bn.material as THREE.MeshBasicMaterial).opacity = ph < 2.2 ? (Math.sin(t * 40) > -0.6 ? 0.7 : 0.15) : 0;
  });

  // どこまでも続くグリッドの床
  const floor = new THREE.GridHelper(400, 100, th.accentA, th.accentB);
  floor.position.set(cx, -16, -60);
  (floor.material as THREE.Material).transparent = true;
  (floor.material as THREE.Material).opacity = 0.5;
  kit.track(floor.geometry);
  kit.add(floor);
  // 浮かんで回る立体（線）
  const shapes: THREE.Mesh[] = [];
  for (let i = 0; i < (high ? 14 : 7); i++) {
    const geo = i % 2 ? new THREE.OctahedronGeometry(1 + rnd() * 2, 0) : new THREE.BoxGeometry(1.5 + rnd() * 2, 1.5 + rnd() * 2, 1.5 + rnd() * 2);
    shapes.push(kit.mesh(geo, kit.basic(i % 3 ? th.accentA : th.accentB, { wireframe: true }), cx + (rnd() - 0.5) * 120, -4 + rnd() * 30, -30 - rnd() * 50));
  }
  kit.anim((t) => shapes.forEach((s, i) => s.rotation.set(t * 0.2 + i, t * 0.3 + i * 0.5, 0)));
  // 流れ落ちるデータ
  const n = high ? 140 : 60;
  const pos = new Float32Array(n * 6);
  const speed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = cx + (rnd() - 0.5) * 110;
    const y = rnd() * 40 - 10;
    const z = -12 - rnd() * 45;
    pos.set([x, y, z, x, y - 1.6, z], i * 6);
    speed[i] = 4 + rnd() * 9;
  }
  const geo = kit.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  kit.add(new THREE.LineSegments(geo, kit.track(new THREE.LineBasicMaterial({ color: th.accentA, transparent: true, opacity: 0.6 }))));
  kit.anim((_t, dt) => {
    const a = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      let y = a.getY(i * 2) - speed[i] * dt;
      if (y < -14) y = 30;
      a.setY(i * 2, y);
      a.setY(i * 2 + 1, y - 1.6);
    }
    a.needsUpdate = true;
  });

  // 本体の台：黒いガラスに光る回路
  const circuit = kit.tex(256, 256, (g) => {
    const r = rand(77);
    g.fillStyle = '#020c08';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = green;
    g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      let x = Math.floor(r() * 16) * 16;
      let y = Math.floor(r() * 16) * 16;
      g.globalAlpha = 0.35 + r() * 0.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        if (r() < 0.5) x += (r() < 0.5 ? -1 : 1) * 16 * (1 + Math.floor(r() * 3));
        else y += (r() < 0.5 ? -1 : 1) * 16 * (1 + Math.floor(r() * 3));
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = green;
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    g.globalAlpha = 1;
  }, [2.5, 2.5]);
  const glass = kit.std(0x03140d, { map: circuit, emissive: 0xffffff, emissiveMap: circuit, emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.3 });
  mainSlab(kit, glass, glass, 0.6, 5);
  kit.box(w - 0.1, 0.05, 0.05, kit.glow(th.accentA), cx, m.top + 0.01, 2.47);
  kit.box(w - 0.1, 0.05, 0.05, kit.glow(th.accentB), cx, m.top + 0.01, -2.47);
  // 台の下：逆さのピラミッド（線だけ）と、中で回る核
  const cone = kit.mesh(new THREE.ConeGeometry(w / 2, 9, 4, 1, true), kit.basic(th.accentB, { wireframe: true, transparent: true, opacity: 0.55 }), cx, m.top - 5.2, 0);
  cone.rotation.set(Math.PI, Math.PI / 4, 0);
  const core = kit.mesh(new THREE.IcosahedronGeometry(1.2, 1), kit.basic(th.accentA, { wireframe: true }), cx, m.top - 4, 0);
  kit.anim((t) => core.rotation.set(t * 0.7, t, 0));

  // すり抜け足場：ターミナルの窓（タイトルバーつき）
  const win = kit.tex(256, 96, (g) => {
    g.fillStyle = 'rgba(2,24,14,0.85)';
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = green;
    g.fillRect(0, 0, 256, 16);
    g.fillStyle = '#021008';
    g.font = `bold 12px ${MONO}`;
    g.fillText('terminal — root', 8, 12);
    g.fillStyle = green;
    g.font = `14px ${MONO}`;
    g.fillText('$ ./exploit --target', 8, 40);
    g.fillText('> 100% ██████████', 8, 62);
    g.fillText('> shell opened_', 8, 84);
  });
  kit.platform((g, pw) => {
    kit.box(pw, 0.14, 2.2, kit.glow(th.accentA, 0.3), 0, -0.07, 0, g);
    kit.box(pw, 0.05, 0.05, kit.glow(th.accentA), 0, 0, 1.1, g);
    const face = kit.plane(pw, pw * 0.375, kit.basic(0xffffff, { map: win, transparent: true, depthWrite: false }), 0, -pw * 0.19 - 0.08, 1.12, g);
    face.renderOrder = 1;
  });
  accentLights(kit, th.accentA, th.accentB);
}

// ====================================================================== 深夜の金庫室（データ泥棒）
function buildVault(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  // 奥の壁：貸金庫の扉がずらり
  const boxes = kit.tex(256, 256, (g) => {
    const r = rand(3);
    g.fillStyle = '#20222c';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) {
      for (let x = 0; x < 256; x += 64) {
        const grad = g.createLinearGradient(x, y, x + 64, y + 64);
        grad.addColorStop(0, '#5a5e6e');
        grad.addColorStop(1, '#3a3d4a');
        g.fillStyle = grad;
        g.fillRect(x + 3, y + 3, 58, 58);
        g.fillStyle = '#2a2c36';
        g.beginPath();
        g.arc(x + 46, y + 32, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = r() < 0.2 ? '#ffc845' : '#8a8e9e';
        g.fillRect(x + 10, y + 26, 18, 10);
      }
    }
  }, [2.4, 2.4]);
  const wallMat = kit.toon(0xffffff, { map: boxes });
  kit.plane(120, 46, wallMat, cx, 8, -12);
  // 天井の照明（青白い光の筋）
  for (let i = 0; i < 5; i++) {
    const x = cx - 24 + i * 12;
    kit.box(3, 0.15, 0.6, kit.glow(0xcfe0ff), x, 20, -8);
    const b = kit.beam(0x9fbaff, 22, 3.5, 0.05);
    b.position.set(x, 20, -8);
  }

  // 大きな丸い金庫の扉（ゆっくりハンドルが回る）
  const door = new THREE.Group();
  door.position.set(cx, m.top + 6.5, -10.5);
  kit.add(door);
  const steel = kit.toon(0x8a90a2);
  const steelDark = kit.toon(0x4a4f5e);
  const ring = kit.mesh(new THREE.CylinderGeometry(7.2, 7.2, 0.8, 48), steelDark, 0, 0, 0, door);
  ring.rotation.x = Math.PI / 2;
  const face = kit.mesh(new THREE.CylinderGeometry(6.4, 6.4, 1.0, 48), steel, 0, 0, 0.2, door);
  face.rotation.x = Math.PI / 2;
  for (let k = 0; k < 3; k++) {
    const tor = kit.mesh(new THREE.TorusGeometry(5.6 - k * 1.6, 0.12, 8, 48), steelDark, 0, 0, 0.72, door);
    tor.rotation.z = k;
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const bolt = kit.mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), kit.toon(0xc9cedb), Math.cos(a) * 6.8, Math.sin(a) * 6.8, 0.5, door);
    bolt.rotation.x = Math.PI / 2;
  }
  const wheel = new THREE.Group();
  wheel.position.z = 0.9;
  door.add(wheel);
  kit.mesh(new THREE.TorusGeometry(1.6, 0.16, 8, 32), kit.toon(0xffc845), 0, 0, 0, wheel);
  for (let k = 0; k < 3; k++) {
    const bar = kit.box(3.6, 0.22, 0.22, kit.toon(0xffc845), 0, 0, 0, wheel);
    bar.rotation.z = (k / 3) * Math.PI;
  }
  kit.mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 16), kit.toon(0xffc845), 0, 0, 0, wheel).rotation.x = Math.PI / 2;
  kit.anim((t) => (wheel.rotation.z = Math.sin(t * 0.4) * 0.6));

  // 赤いレーザーの網（奥で動く・点滅する）
  const lasers: THREE.Mesh[] = [];
  for (let i = 0; i < (high ? 9 : 5); i++) {
    const l = kit.box(46, 0.06, 0.06, kit.additive(th.accentA, 0.85), cx, m.top + 1 + rnd() * 9, -6 - rnd() * 2);
    l.rotation.z = (rnd() - 0.5) * 0.7;
    lasers.push(l);
  }
  kit.anim((t) =>
    lasers.forEach((l, i) => {
      l.position.y += Math.sin(t * 0.8 + i) * 0.01;
      l.rotation.z += Math.sin(t * 0.5 + i * 2) * 0.0015;
      (l.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 6 + i) * 0.3;
    }),
  );
  // 警報灯（赤い光が回る）
  [m.x1 - 3, m.x2 + 3].forEach((x, i) => {
    kit.mesh(new THREE.SphereGeometry(0.45, 12, 8), kit.glow(th.accentA), x, m.top + 9, -9);
    const b = kit.beam(th.accentA, 14, 3, 0.1);
    b.position.set(x, m.top + 9, -9);
    kit.anim((t) => b.rotation.set(Math.PI / 2, 0, t * 3 + i * Math.PI));
  });

  // 金の延べ棒の山と、お金の袋（奥の左右）
  const gold = kit.toon(th.accentB);
  const bar = new THREE.CylinderGeometry(0.22, 0.3, 0.9, 4, 1);
  bar.rotateY(Math.PI / 4);
  bar.rotateZ(Math.PI / 2);
  kit.track(bar);
  for (const sx of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 4 - row; k++) {
        const me = new THREE.Mesh(bar, gold);
        me.position.set(cx + sx * (w / 2 - 1.6) + (k - (3 - row) / 2) * 0.5, m.top + 0.18 + row * 0.3, -2.0);
        kit.add(me);
      }
    }
    const bag = kit.mesh(new THREE.SphereGeometry(0.45, 12, 10), kit.toon(0xc9b48a), cx + sx * (w / 2 - 3.1), m.top + 0.42, -1.9);
    bag.scale.set(1, 1.1, 1);
    kit.mesh(new THREE.ConeGeometry(0.18, 0.3, 8), kit.toon(0xc9b48a), cx + sx * (w / 2 - 3.1), m.top + 0.95, -1.9);
  }

  // 床：大理石のタイル
  const marble = kit.tex(256, 256, (g) => {
    const r = rand(8);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        g.fillStyle = (x + y) % 2 ? '#2a2630' : '#3a3542';
        g.fillRect(x * 128, y * 128, 128, 128);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      let x = r() * 256;
      let y = r() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (r() - 0.5) * 60;
        y += (r() - 0.5) * 60;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,200,69,0.35)';
    g.strokeRect(0, 0, 256, 256);
  }, [2, 2]);
  const plate = kit.tex(256, 128, (g) => {
    g.fillStyle = '#2c2f3a';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3c404e';
    g.fillRect(0, 0, 256, 6);
    g.fillStyle = '#8a8e9e';
    for (let x = 12; x < 256; x += 40) {
      g.beginPath();
      g.arc(x, 20, 4, 0, Math.PI * 2);
      g.arc(x, 108, 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [3, 1.5]);
  mainSlab(kit, kit.std(0xffffff, { map: marble, roughness: 0.3, metalness: 0.1 }), kit.toon(0xffffff, { map: plate }), 0.8, 5);
  kit.box(w - 0.2, 0.05, 0.05, kit.glow(th.accentB), cx, m.top - 0.02, 2.48);
  // 台の下：鉄骨の柱
  for (let i = 0; i < 4; i++) {
    const x = m.x1 + 1.5 + (i / 3) * (w - 3);
    kit.box(0.5, 12, 0.5, steelDark, x, m.top - 6.8, 0);
  }
  kit.box(w * 0.9, 0.4, 0.4, steelDark, cx, m.top - 3, 0.4);

  // すり抜け足場：鉄の棚（金の縁）
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.24, 2.2, [kit.toon(0xffffff, { map: plate }), kit.toon(0x5a5e6e)], { radius: 0.05, bevel: 0.04 }));
    kit.box(pw, 0.04, 0.04, kit.glow(th.accentB), 0, 0.005, 1.1, g);
  });
  // 漂うほこり（照明に照らされて見える）
  kit.particles({ count: high ? 60 : 25, x: [cx - 16, cx + 16], y: [m.top, m.top + 16], z: [-7, 2], color: 0xcfd8ff, size: 0.12, vx: 0.1, vy: -0.05, wobble: 0.2, opacity: 0.5 });
  accentLights(kit, th.accentA, 0x6a8aff, 30);
}

// ====================================================================== 配信スタジオ（配信者）
function buildStudio(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const pink = hex(th.accentA);
  const purple = hex(th.accentB);
  // 奥の壁：パステルの吸音パネル
  const panel = kit.tex(256, 256, (g) => {
    g.fillStyle = '#f7d9ea';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) {
      for (let x = 0; x < 256; x += 64) {
        g.fillStyle = (x + y) % 128 ? '#f2c4dd' : '#ead0f5';
        g.beginPath();
        g.moveTo(x + 32, y + 4);
        g.lineTo(x + 60, y + 32);
        g.lineTo(x + 32, y + 60);
        g.lineTo(x + 4, y + 32);
        g.closePath();
        g.fill();
      }
    }
  }, [3, 3]);
  kit.plane(120, 46, kit.toon(0xffffff, { map: panel }), cx, 8, -12);
  // 大きなモニター：「LIVE」と視聴者数、流れるコメント
  const screen = kit.tex(1024, 576, (g) => {
    const grad = g.createLinearGradient(0, 0, 1024, 576);
    grad.addColorStop(0, '#ffb3d6');
    grad.addColorStop(1, '#b9a3ff');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 576);
    g.fillStyle = '#ff2a55';
    g.beginPath();
    g.roundRect(40, 36, 180, 70, 16);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `900 52px ${FONT}`;
    g.fillText('● LIVE', 56, 90);
    g.font = `800 40px ${FONT}`;
    g.fillText('👁 12,345 人が視聴中', 250, 86);
    g.font = `900 120px ${FONT}`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillText('ぶっとび配信', 400, 330);
    g.font = `700 44px ${FONT}`;
    g.fillText('高評価・チャンネル登録よろしく！', 400, 420);
  });
  kit.box(26, 15, 0.4, kit.toon(0x2a2433), cx, m.top + 8.5, -10.8);
  kit.plane(25, 14, kit.basic(0xffffff, { map: screen }), cx, m.top + 8.5, -10.55);
  const chat = kit.tex(256, 1024, (g) => {
    const r = rand(21);
    const lines = ['かわいい！', 'ナイス！', 'うますぎ', '草', '神回', 'ぶっとばせー', 'がんばれ！', '初見です', 'スパチャ ¥1,000', '888888', 'すご！', 'それな', 'おつ！', '今の何！？'];
    g.font = `bold 26px ${FONT}`;
    for (let y = 40; y < 1024; y += 52) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.roundRect(8, y - 32, 240, 44, 12);
      g.fill();
      const txt = lines[Math.floor(r() * lines.length)];
      g.fillStyle = txt.startsWith('スパチャ') ? '#ff2a55' : '#3a2a4a';
      g.fillText(txt, 20, y);
    }
  });
  chat.wrapT = THREE.RepeatWrapping;
  chat.repeat.set(1, 0.45);
  kit.plane(5.2, 9.6, kit.basic(0xffffff, { map: chat, transparent: true }), cx + 9.4, m.top + 8.5, -10.5);
  kit.scroll(chat, 0, 0.08);

  // リングライト（左右）と、ソフトボックス
  const stand = kit.toon(0x3a3444);
  for (const s of [-1, 1]) {
    const x = cx + s * (w / 2 + 1.5);
    kit.box(0.1, 4.8, 0.1, stand, x, m.top + 2.4, -4);
    const ringL = kit.mesh(new THREE.TorusGeometry(1.4, 0.16, 12, 40), kit.glow(0xffffff), x, m.top + 5.4, -4);
    ringL.rotation.y = -s * 0.5;
    kit.mesh(new THREE.TorusGeometry(1.4, 0.24, 8, 40), kit.toon(0x2a2433), x, m.top + 5.4, -4.08).rotation.y = -s * 0.5;
    // ソフトボックス（箱の正面が光る）
    const sb = new THREE.Group();
    sb.position.set(cx + s * (w / 2 - 2.5), m.top + 6.8, -8);
    sb.rotation.y = -s * 0.35;
    kit.add(sb);
    kit.box(2.2, 1.6, 0.8, kit.toon(0x2a2433), 0, 0, 0, sb);
    kit.plane(2.0, 1.4, kit.basic(0xfff4fb), 0, 0, 0.41, sb);
    kit.box(0.08, 6.8, 0.08, stand, 0, -3.4, -0.2, sb);
  }
  // 三脚のカメラ（奥の右）
  const cam = new THREE.Group();
  cam.position.set(m.x2 - 1.5, m.top, -2.2);
  kit.add(cam);
  for (let k = 0; k < 3; k++) {
    const leg = kit.box(0.06, 1.6, 0.06, stand, Math.cos(k * 2.1) * 0.25, 0.75, Math.sin(k * 2.1) * 0.25, cam);
    leg.rotation.set(Math.sin(k * 2.1) * 0.3, 0, -Math.cos(k * 2.1) * 0.3);
  }
  kit.box(0.6, 0.45, 0.4, kit.toon(0x1d1b24), 0, 1.75, 0, cam);
  kit.mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 16), kit.toon(0x1d1b24), -0.42, 1.75, 0, cam).rotation.z = Math.PI / 2;
  const rec = kit.mesh(new THREE.SphereGeometry(0.05, 8, 6), kit.glow(0xff2a55), 0.2, 2.02, 0.15, cam);
  kit.anim((t) => (rec.visible = Math.sin(t * 4) > 0));
  // ぬいぐるみの棚（奥の左）
  kit.box(3.4, 0.12, 0.8, kit.toon(0xffffff), m.x1 + 2.2, m.top + 1.6, -2.4);
  kit.box(0.12, 1.6, 0.8, kit.toon(0xffffff), m.x1 + 0.6, m.top + 0.8, -2.4);
  kit.box(0.12, 1.6, 0.8, kit.toon(0xffffff), m.x1 + 3.8, m.top + 0.8, -2.4);
  [0xffb3d6, 0xb9a3ff, 0xfff1a8].forEach((c, i) => {
    const x = m.x1 + 1.3 + i * 0.9;
    kit.mesh(new THREE.SphereGeometry(0.3, 12, 10), kit.toon(c), x, m.top + 1.95, -2.3);
    for (const e of [-1, 1]) kit.mesh(new THREE.SphereGeometry(0.11, 8, 6), kit.toon(c), x + e * 0.2, m.top + 2.22, -2.3);
  });
  // LEDのライン（奥の床ぎわ。色が流れる）
  const led = kit.tex(256, 4, (g) => {
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, pink);
    grad.addColorStop(0.5, purple);
    grad.addColorStop(1, pink);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 4);
  });
  led.wrapS = THREE.RepeatWrapping;
  led.repeat.set(3, 1);
  kit.box(60, 0.12, 0.05, kit.basic(0xffffff, { map: led }), cx, m.top + 0.1, -11.8);
  kit.scroll(led, 0.3, 0);

  // 床：明るい木のフローリングと、手前に光るライン
  const wood = kit.tex(256, 256, (g) => {
    const r = rand(14);
    for (let y = 0; y < 256; y += 32) {
      let x = -Math.floor(r() * 128);
      while (x < 256) {
        const len = 90 + r() * 100;
        g.fillStyle = hex(mix(0xf0d2b8, 0xd9b090, r() * 0.6));
        g.fillRect(x, y, len - 2, 30);
        x += len;
      }
    }
    speckle(g, 256, 256, r, ['#c99f80', '#fff0e0'], 300, 2);
  }, [3, 3]);
  const front = kit.tex(256, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = pink;
    g.font = `900 40px ${FONT}`;
    g.fillText('♥', 110, 48);
  }, [2.5, 0.7]);
  mainSlab(kit, kit.toon(0xffffff, { map: wood }), kit.toon(0xffffff, { map: front }), 0.7, 5);
  const edge = kit.box(w - 0.2, 0.06, 0.06, kit.glow(th.accentA), cx, m.top + 0.01, 2.47);
  kit.anim((t) => (edge.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 2) > 0 ? th.accentA : th.accentB));
  // 台の下：ステージの台とスピーカー
  kit.box(w * 0.94, 3, 4.4, kit.toon(0x2a2433), cx, m.top - 2.2, -0.2);
  for (const s of [-1, 1]) {
    kit.box(1.6, 2.2, 0.3, kit.toon(0x1d1b24), cx + s * (w / 2 - 1.6), m.top - 2.2, 2.05);
    kit.mesh(new THREE.CircleGeometry(0.55, 24), kit.toon(0x3a3444), cx + s * (w / 2 - 1.6), m.top - 2.0, 2.21);
  }

  // すり抜け足場：カメラクレーンの台／中央はリングライト
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.26, 2.2, [kit.toon(0xffffff, { map: front }), kit.toon(0xffffff, { map: wood })], { radius: 0.1, bevel: 0.05 }));
    kit.box(pw, 0.04, 0.04, kit.glow(th.accentA), 0, 0.005, 1.1, g);
    if (pw >= 3.9) {
      const r = kit.mesh(new THREE.TorusGeometry(1.5, 0.1, 10, 40), kit.glow(0xffffff, 0.9), 0, 1.0, -1.0, g);
      r.scale.y = 0.75;
    } else {
      // クレーンのアーム（下へ伸びる）
      kit.box(0.14, 2.6, 0.14, stand, 0, -1.4, -0.6, g);
    }
  });
  // ふわふわ上がるハート
  const heart = kit.tex(64, 64, (g) => {
    g.fillStyle = '#ffffff';
    g.font = `52px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('♥', 32, 50);
  });
  kit.particles({ count: high ? 36 : 16, x: [cx - 16, cx + 16], y: [m.top - 2, m.top + 14], z: [-9, -3], color: [th.accentA, th.accentB, 0xffffff], size: 0.7, vy: 0.9, wobble: 0.4, opacity: 0.85, map: heart });
  void rnd;
}

// ====================================================================== スマホのタイムライン（ドパガキ）
function buildTimeline(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const lime = hex(th.accentA);
  const orange = hex(th.accentB);
  // 動画の画面（サムネイル・再生ボタン・いいね数・再生バー）
  const thumbs = [0, 1, 2, 3, 4, 5].map((i) =>
    kit.tex(180, 320, (g) => {
      const r = rand(100 + i);
      const cols = [
        ['#ff7a1a', '#ff2a8a'],
        ['#2fd8ff', '#8a5cff'],
        ['#b6ff3a', '#1abf8a'],
        ['#ffd23f', '#ff5a3a'],
        ['#ff5ea8', '#ffd23f'],
        ['#5a7dff', '#2fd8ff'],
      ][i];
      g.fillStyle = '#000';
      g.beginPath();
      g.roundRect(0, 0, 180, 320, 22);
      g.fill();
      const grad = g.createLinearGradient(0, 0, 180, 320);
      grad.addColorStop(0, cols[0]);
      grad.addColorStop(1, cols[1]);
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(6, 6, 168, 308, 18);
      g.fill();
      // 中身（丸や星などの図形）
      for (let k = 0; k < 5; k++) {
        g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.3})`;
        g.beginPath();
        g.arc(30 + r() * 120, 60 + r() * 180, 10 + r() * 30, 0, Math.PI * 2);
        g.fill();
      }
      // 再生ボタン
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(76, 130);
      g.lineTo(76, 190);
      g.lineTo(122, 160);
      g.closePath();
      g.fill();
      // 右側のいいね・コメント
      g.font = `bold 26px ${FONT}`;
      g.fillStyle = '#fff';
      g.fillText('♥', 140, 220);
      g.font = `bold 14px ${FONT}`;
      g.fillText(`${(r() * 99).toFixed(1)}万`, 132, 240);
      g.fillText('💬', 140, 270);
      // 再生バー
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(14, 296, 152, 5);
      g.fillStyle = '#fff';
      g.fillRect(14, 296, 30 + r() * 110, 5);
    }),
  );
  // 流れていく動画（3層。上へスクロール）
  const layers = high
    ? [
        { z: -18, s: 5.5, n: 9, speed: 2.4, op: 0.75 },
        { z: -34, s: 7.5, n: 9, speed: 1.6, op: 0.55 },
        { z: -56, s: 10, n: 8, speed: 1.0, op: 0.4 },
      ]
    : [
        { z: -22, s: 6, n: 8, speed: 2.0, op: 0.7 },
        { z: -50, s: 9, n: 7, speed: 1.0, op: 0.4 },
      ];
  layers.forEach((L, li) => {
    const items: THREE.Mesh[] = [];
    const cols = 5;
    const spanY = 60;
    for (let i = 0; i < L.n * 2; i++) {
      const col = i % cols;
      const me = kit.plane(L.s * 0.5625, L.s, kit.basic(0xffffff, { map: thumbs[(i + li) % 6], transparent: true, depthWrite: false, opacity: L.op }), cx + (col - (cols - 1) / 2) * L.s * 1.6 + (li % 2) * L.s * 0.8, -20 + ((i * 13) % spanY), L.z);
      items.push(me);
    }
    kit.anim((_t, dt) => {
      for (const me of items) {
        me.position.y += L.speed * dt;
        if (me.position.y > 40) me.position.y -= spanY;
      }
    });
  });
  // 浮かぶアイコン（ハート・通知バッジ）
  const icon = (txt: string, bg: string) =>
    kit.tex(64, 64, (g) => {
      g.fillStyle = bg;
      g.beginPath();
      g.arc(32, 32, 28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `900 ${txt.length > 2 ? 22 : 34}px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(txt, 32, txt.length > 2 ? 40 : 44);
    });
  const icons = [icon('♥', '#ff2a55'), icon('99+', '#ff3b3b'), icon('▶', orange), icon('★', lime)];
  icons.forEach((t, i) => kit.particles({ count: high ? 8 : 4, x: [cx - 22, cx + 22], y: [m.top - 6, m.top + 18], z: [-12, -6], color: 0xffffff, size: 1.0, vy: 0.6 + i * 0.1, wobble: 0.3, opacity: 0.9, map: t }));

  // 本体の台：スマホ（黒いガラスの画面と、光る縁）
  const scr = kit.tex(256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#141826');
    grad.addColorStop(1, '#0a0c14');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(120, 0);
    g.lineTo(0, 120);
    g.fill();
  }, [3, 3]);
  const sideTex = kit.tex(512, 64, (g) => {
    g.fillStyle = '#1b1f2e';
    g.fillRect(0, 0, 512, 64);
    // アプリのアイコンの列
    const cols = ['#ff2a55', '#2fd8ff', lime, orange, '#8a5cff', '#ffd23f'];
    for (let i = 0; i < 12; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.roundRect(14 + i * 42, 14, 30, 30, 8);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.roundRect(206, 52, 100, 6, 3);
    g.fill();
  });
  sideTex.wrapS = THREE.RepeatWrapping;
  const glassMat = kit.std(0xffffff, { map: scr, roughness: 0.15, metalness: 0.4 });
  const frontMat = kit.basic(0xffffff, { map: sideTex });
  const slab = kit.slab(w, 0.9, 5, [frontMat, glassMat], { radius: 0.4, bevel: 0.1 });
  slab.position.set(cx, m.top, 0);
  kit.add(slab);
  // 正面の画像は1単位ごとの繰り返しなので、台の高さに合わせて縮める
  sideTex.repeat.set(1 / 10, 1 / 0.9);
  sideTex.offset.set(0.5, 1);
  kit.box(w - 0.2, 0.05, 0.05, kit.glow(th.accentA), cx, m.top + 0.01, 2.5);
  kit.box(w - 0.2, 0.05, 0.05, kit.glow(th.accentB), cx, m.top + 0.01, -2.5);
  // 台の下：通知の吹き出しがぶら下がる
  const notice = kit.tex(256, 64, (g) => {
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath();
    g.roundRect(0, 0, 256, 64, 16);
    g.fill();
    g.fillStyle = '#ff3b3b';
    g.beginPath();
    g.arc(32, 32, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1f2e';
    g.font = `bold 22px ${FONT}`;
    g.fillText('新しい動画があります', 62, 40);
  });
  for (let i = 0; i < 3; i++) {
    const me = kit.plane(4, 1, kit.basic(0xb8bccb, { map: notice, transparent: true }), cx + (i - 1) * 4.6, m.top - 2 - i * 1.4, 1.5);
    kit.anim((t) => (me.position.y = m.top - 2 - i * 1.4 + Math.sin(t * 1.5 + i) * 0.15));
  }

  // すり抜け足場：動画のカード（再生バーつき）
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.22, 2.2, [kit.toon(0x1b1f2e), kit.std(0xffffff, { map: scr, roughness: 0.2 })], { radius: 0.1, bevel: 0.04 }));
    kit.box(pw * 0.9, 0.05, 0.04, kit.glow(0xffffff, 0.35), 0, -0.12, 1.12, g);
    const bar = kit.box(pw * 0.9, 0.05, 0.04, kit.glow(th.accentA), -pw * 0.45, -0.12, 1.14, g);
    bar.geometry.translate(pw * 0.45, 0, 0);
    const ph = rnd() * 3;
    kit.anim((t) => (bar.scale.x = ((t * 0.2 + ph) % 1) + 0.01));
  });
  accentLights(kit, th.accentA, th.accentB);
}

// ====================================================================== ガチャ会場（ガチャ廃人）
function buildGacha(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  // 奥の壁：きらきらの壁紙
  const wall = kit.tex(256, 256, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5a2f9a');
    grad.addColorStop(1, '#ff8fc0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const r = rand(6);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 40; i++) {
      const x = r() * 256;
      const y = r() * 256;
      const s = 2 + r() * 4;
      g.beginPath();
      g.moveTo(x, y - s * 2);
      g.lineTo(x + s * 0.5, y);
      g.lineTo(x, y + s * 2);
      g.lineTo(x - s * 0.5, y);
      g.fill();
    }
  });
  kit.plane(130, 50, kit.basic(0xffffff, { map: wall }), cx, 10, -16);

  // 巨大なガチャの機械（カプセルが詰まった透明のドーム）
  const machine = (x: number, z: number, s: number, body: number) => {
    const g = new THREE.Group();
    g.position.set(x, m.top - 0.2, z);
    g.scale.setScalar(s);
    kit.add(g);
    kit.box(3, 3.2, 2.6, kit.toon(body), 0, 1.6, 0, g);
    kit.box(3.1, 0.3, 2.7, kit.toon(0xffffff), 0, 3.25, 0, g);
    const dome = kit.mesh(new THREE.SphereGeometry(1.5, 24, 16), kit.std(0xffffff, { transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.2, depthWrite: false }), 0, 4.8, 0, g);
    dome.renderOrder = 2;
    // ドームの中のカプセル（いろんな色）
    const n = 18;
    const caps = new THREE.InstancedMesh(kit.track(new THREE.SphereGeometry(0.32, 10, 8)), kit.toon(0xffffff), n);
    const mtx = new THREE.Matrix4();
    const col = new THREE.Color();
    const palette = [0xff4a6a, 0x4ad8ff, 0xffd23f, 0x7dff8a, 0xc77dff, 0xff9a3a];
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = rnd() * 1.0;
      mtx.makeTranslation(Math.cos(a) * rr, 4.2 + rnd() * 1.1, Math.sin(a) * rr);
      caps.setMatrixAt(i, mtx);
      caps.setColorAt(i, col.setHex(palette[i % palette.length]));
    }
    g.add(caps);
    // ハンドル（回る）と取り出し口
    const knob = kit.mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.25, 20), kit.toon(0xffffff), 0, 2.1, 1.35, g);
    knob.rotation.x = Math.PI / 2;
    kit.box(0.7, 0.12, 0.2, kit.toon(0x3a2a4a), 0, 2.1, 1.5, g);
    kit.box(1.0, 0.7, 0.2, kit.toon(0x2a1a3a), 0, 0.9, 1.32, g);
    kit.anim((t) => (knob.rotation.y = Math.sin(t * 0.8 + x) * 0.8));
    return g;
  };
  const bodies = [0xff4a6a, 0x4a9dff, 0xffd23f, 0x7ad86a, 0xc77dff];
  bodies.forEach((b, i) => machine(cx + (i - 2) * 7.5, -9.5 - (i % 2) * 2, 1.15, b));

  // つり下がる旗（SSR確率UP！など）
  const flags = ['SSR確率UP', '10連', '天井まで', 'ピックアップ', '限定'];
  flags.forEach((txt, i) => {
    const t = kit.tex(96, 320, (g) => {
      g.fillStyle = i % 2 ? '#ffd23f' : '#ff2a6a';
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(96, 0);
      g.lineTo(96, 290);
      g.lineTo(48, 320);
      g.lineTo(0, 290);
      g.closePath();
      g.fill();
      g.fillStyle = i % 2 ? '#3a1a4a' : '#ffffff';
      g.font = `900 46px ${FONT}`;
      g.textAlign = 'center';
      [...txt].slice(0, 6).forEach((c, k) => g.fillText(c, 48, 56 + k * 46));
    });
    const me = kit.plane(1.4, 4.6, kit.toon(0xffffff, { map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }), cx + (i - 2) * 8 + 3.6, m.top + 11, -7);
    kit.anim((tt) => (me.rotation.z = Math.sin(tt * 1.2 + i) * 0.05));
  });
  kit.box(60, 0.06, 0.06, kit.toon(0xffffff), cx, m.top + 13.4, -7);
  // 床を転がるカプセル（奥の通路）
  const rolling: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    kit.mesh(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), kit.toon([0xff4a6a, 0x4ad8ff, 0xffd23f, 0xc77dff, 0x7dff8a][i]), 0, 0, 0, g);
    kit.mesh(new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.toon(0xffffff), 0, 0, 0, g);
    g.position.set(cx - 40 + i * 16, m.top + 0.45, -5.5);
    kit.add(g);
    rolling.push(g);
  }
  kit.anim((_t, dt) =>
    rolling.forEach((g) => {
      g.position.x += 3 * dt;
      g.rotation.z -= (3 * dt) / 0.45;
      if (g.position.x > cx + 40) g.position.x -= 80;
    }),
  );

  // 床：カジノのようなじゅうたん
  const carpet = kit.tex(256, 256, (g) => {
    g.fillStyle = '#8a1f4a';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ffd23f';
    g.lineWidth = 3;
    for (let y = 0; y < 256; y += 64) {
      for (let x = 0; x < 256; x += 64) {
        g.beginPath();
        g.moveTo(x + 32, y + 6);
        g.lineTo(x + 58, y + 32);
        g.lineTo(x + 32, y + 58);
        g.lineTo(x + 6, y + 32);
        g.closePath();
        g.stroke();
        g.fillStyle = '#c23a6a';
        g.beginPath();
        g.arc(x + 32, y + 32, 8, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, [2, 2]);
  const front = kit.tex(256, 64, (g) => {
    g.fillStyle = '#c21f4a';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 256, 6);
    g.fillRect(0, 58, 256, 6);
    g.font = `900 34px ${FONT}`;
    g.fillText('★', 40, 46);
    g.fillText('★', 170, 46);
  }, [3, 0.75]);
  mainSlab(kit, kit.toon(0xffffff, { map: carpet }), kit.toon(0xffffff, { map: front }), 0.75, 5);
  // 電球の縁（順番に光る）
  const bulbs: THREE.Mesh[] = [];
  for (let x = m.x1 + 0.3; x <= m.x2 - 0.3; x += 0.7) bulbs.push(kit.mesh(new THREE.SphereGeometry(0.08, 8, 6), kit.glow(0xfff1a8), x, m.top - 0.06, 2.55));
  kit.anim((t) => bulbs.forEach((b, i) => (b.visible = Math.floor(t * 6 + i) % 3 !== 0)));
  // 台の下：巨大なカプセルの下半分
  const half = kit.mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.toon(0xffffff), cx, m.top - 0.7, 0);
  half.scale.set(w / 2 - 0.2, 5.5, 2.4);
  const rim = kit.mesh(new THREE.TorusGeometry(1, 0.035, 8, 48), kit.toon(0xffd23f), cx, m.top - 0.72, 0);
  rim.scale.set(w / 2 - 0.2, 2.4, 1);
  rim.rotation.x = Math.PI / 2;

  // すり抜け足場（上下するリフト）：カプセル型
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.26, 2.2, [kit.toon(0xffffff, { map: front }), kit.toon(0xffffff, { map: carpet })], { radius: 0.1, bevel: 0.05 }));
    const hc = kit.mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), kit.toon(pw > 4.5 ? 0xffd23f : 0xff4a6a), 0, -0.26, 0, g);
    hc.scale.set(pw / 2, 0.8, 1.05);
  });
  // 紙吹雪
  kit.particles({ count: high ? 90 : 35, x: [cx - 22, cx + 22], y: [m.top - 4, m.top + 18], z: [-8, 3], color: [0xff4a6a, 0xffd23f, 0x4ad8ff, 0x7dff8a, 0xffffff], size: 0.22, vy: -1.2, wobble: 0.8, opacity: 0.9 });
}

// ====================================================================== ネオン商店街（フードデリバリー配達員）
function buildArcade(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  stars(kit, 260);
  skylineBackdrop(kit, -115, 2, 46, '#1a0a26', hex(th.accentB), 41, 320);
  cityBlocks(kit, [th.accentA, th.accentB, 0xffd9a0], 0.45);
  // ビルの上のネオン看板
  const words = ['ラーメン', 'カラオケ', 'ネカフェ', 'SALE', 'ガチャ', '24時間', '激安'];
  words.forEach((word, i) => {
    const color = i % 2 ? th.accentA : th.accentB;
    const vertical = i % 3 === 0;
    const sign = neonSign(kit, word, color, vertical ? 1.6 : 4 + rnd() * 2, vertical);
    sign.position.set(cx + (i - words.length / 2) * 11 + rnd() * 4, 4 + rnd() * 10, -24 - rnd() * 4);
    kit.add(sign);
    const mat = sign.material as THREE.MeshBasicMaterial;
    const phase = rnd() * 10;
    kit.anim((t) => (mat.opacity = Math.sin(t * 13 + phase) > 0.96 || Math.sin(t * 0.7 + phase) > 0.995 ? 0.35 : 1));
  });
  // 奥の道を走るスクーター（ライトつき。左右に行き交う）
  const scooters: { g: THREE.Group; v: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const dir = i % 2 ? 1 : -1;
    kit.box(1.2, 0.5, 0.5, kit.toon([0x2fbf71, 0xff5a3a, 0xffd23f, 0x4a9dff][i]), 0, 0.55, 0, g);
    kit.box(0.6, 0.5, 0.5, kit.toon(0x2fbf71), -dir * 0.3, 1.05, 0, g);
    for (const x of [-0.45, 0.45]) kit.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12), kit.toon(0x111111), x, 0.25, 0, g).rotation.x = Math.PI / 2;
    kit.plane(1.6, 1.6, kit.basic(0xfff1c8, { map: kit.soft(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), dir * 0.8, 0.6, 0.3, g);
    g.position.set(cx - 30 + i * 18, -2.4, -14);
    kit.add(g);
    scooters.push({ g, v: dir * (5 + i) });
  }
  kit.anim((_t, dt) =>
    scooters.forEach((s) => {
      s.g.position.x += s.v * dt;
      if (s.g.position.x > cx + 40) s.g.position.x = cx - 40;
      if (s.g.position.x < cx - 40) s.g.position.x = cx + 40;
    }),
  );
  kit.box(140, 0.2, 4, kit.toon(0x1a1622), cx, -2.5, -14);

  // 通り：アスファルトに白い線と、ネオンが映る水たまり
  const asphalt = kit.tex(256, 256, (g) => {
    g.fillStyle = '#2b2730';
    g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, rand(19), ['#3a3540', '#1f1c24', '#4a4550'], 1800, 3);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 124, 36, 8);
  }, [4, 4]);
  const shutter = kit.tex(64, 64, (g) => {
    g.fillStyle = '#2a2833';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3a3845';
    for (let y = 0; y < 64; y += 6) g.fillRect(0, y, 64, 3);
  }, [2, 2]);
  mainSlab(kit, kit.toon(0xffffff, { map: asphalt }), kit.toon(0xffffff, { map: shutter }), 0.6, 5);
  for (let i = 0; i < 4; i++) {
    const p = kit.plane(1.6 + rnd() * 1.4, 0.8 + rnd() * 0.5, kit.std(i % 2 ? th.accentA : th.accentB, { roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35, emissive: i % 2 ? th.accentA : th.accentB, emissiveIntensity: 0.25 }), m.x1 + 2 + rnd() * (w - 4), m.top + 0.01, -0.5 + rnd() * 2.2);
    p.rotation.x = -Math.PI / 2;
  }
  kit.box(w - 0.1, 0.06, 0.06, kit.glow(th.accentA), cx, m.top + 0.01, 2.47);
  kit.box(w - 0.1, 0.05, 0.05, kit.glow(th.accentB), cx, m.top + 0.01, -2.4);
  kit.box(w * 0.98, 12, 4.6, kit.toon(0xffffff, { map: shutter }), cx, m.top - 6.6, -0.1);

  // 店先（奥）：看板・店の明かり・ひさし・ちょうちん
  const shops = ['ラーメン', 'カラオケ', 'ネカフェ', 'くすり', 'ガチャ'];
  shops.forEach((name, i) => {
    const x = cx - w / 2 + 2 + i * ((w - 4) / (shops.length - 1));
    kit.box(3.4, 3.6, 1.0, kit.toon(0x1d1a26), x, m.top + 1.8, -3.2);
    kit.box(2.8, 1.6, 0.05, kit.glow(i % 2 ? 0xffe2a8 : 0xa8e8ff, 0.55), x, m.top + 1.0, -2.68);
    const sign = neonSign(kit, name, i % 2 ? th.accentA : th.accentB, 2.8);
    sign.position.set(x, m.top + 2.9, -2.66);
    kit.add(sign);
    const awn = kit.box(3.4, 0.08, 0.8, kit.glow(i % 2 ? th.accentB : th.accentA, 0.85), x, m.top + 2.25, -2.4);
    awn.rotation.x = -0.3;
    if (i === 0 && high) kit.particles({ count: 12, x: [x - 0.6, x + 0.6], y: [m.top + 1.5, m.top + 4.5], z: [-2.6, -2.2], color: 0xffffff, size: 0.8, vy: 0.8, wobble: 0.2, opacity: 0.15 });
  });
  const lantern = kit.glow(0xff5a3a);
  for (let i = 0; i < 9; i++) kit.mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.45, 10), lantern, m.x1 + 0.8 + i * ((w - 1.6) / 8), m.top + 4.3 + Math.sin(i * 0.9) * 0.15, -2.6);
  kit.box(w, 0.03, 0.03, kit.toon(0x111111), cx, m.top + 4.55, -2.6);
  // 自動販売機
  kit.box(0.8, 1.7, 0.6, kit.toon(0xd8dde8), m.x2 - 0.8, m.top + 0.85, -2.2);
  kit.box(0.62, 0.9, 0.02, kit.glow(0xbff6ff), m.x2 - 0.8, m.top + 1.05, -1.89);

  // すり抜け足場：看板の板
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.24, 2.3, [kit.toon(0x2a2433), kit.toon(0x3a3444)], { radius: 0.05, bevel: 0.04 }));
    kit.box(pw, 0.05, 0.05, kit.glow(th.accentB), 0, 0.01, 1.15, g);
  });
  // 雨
  if (high) {
    const n = 260;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * 50;
      const y = rnd() * 30 - 5;
      const z = (rnd() - 0.3) * 10;
      pos.set([x, y, z, x - 0.05, y - 0.5, z], i * 6);
    }
    const geo = kit.track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    kit.add(new THREE.LineSegments(geo, kit.track(new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.35 }))));
    kit.anim((_t, dt) => {
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
  accentLights(kit, th.accentA, th.accentB);
}

// ====================================================================== AIラボ（AIエンジニア）
function buildLab(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const blue = hex(th.accentA);
  // 奥の壁：白いパネルと青い光の線
  const panel = kit.tex(256, 256, (g) => {
    g.fillStyle = '#eef4fa';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#cfdbe8';
    g.lineWidth = 4;
    for (let i = 0; i <= 256; i += 128) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
    g.fillStyle = blue;
    g.fillRect(0, 200, 256, 4);
  }, [4, 4]);
  kit.plane(130, 50, kit.toon(0xffffff, { map: panel }), cx, 10, -14);
  // ガラスの仕切り
  for (let i = 0; i < 4; i++) {
    const x = cx - 21 + i * 14;
    kit.box(10, 9, 0.1, kit.std(0xbfe0ff, { transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1, depthWrite: false }), x, m.top + 4.5, -8);
    kit.box(10, 0.08, 0.12, kit.glow(th.accentA), x, m.top + 9, -8);
  }
  // GPUの棚（青いLEDが流れる）
  const leds: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = cx + s * (w / 2 + 3 + k * 2.6);
      kit.box(2.2, 6, 1.6, kit.toon(0x2a3140), x, m.top + 3, -6 - k);
      for (let j = 0; j < 8; j++) leds.push(kit.box(1.8, 0.05, 0.02, kit.glow(th.accentA), x, m.top + 0.8 + j * 0.65, -5.19 - k));
    }
  }
  kit.anim((t) => leds.forEach((l, i) => (l.visible = Math.sin(t * 5 - i * 0.6) > -0.5)));

  // ホログラムのニューラルネット（ノードが光り、線でつながる）
  const net = new THREE.Group();
  net.position.set(cx, m.top + 8.5, -9);
  kit.add(net);
  const layers = [4, 6, 6, 3];
  const nodes: THREE.Vector3[][] = [];
  const nodeMeshes: THREE.Mesh[] = [];
  layers.forEach((n, li) => {
    const col: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const p = new THREE.Vector3((li - 1.5) * 5, (k - (n - 1) / 2) * 1.6, 0);
      col.push(p);
      nodeMeshes.push(kit.mesh(new THREE.SphereGeometry(0.28, 12, 8), kit.glow(li % 2 ? th.accentA : th.accentB), p.x, p.y, p.z, net));
    }
    nodes.push(col);
  });
  const lp: number[] = [];
  for (let li = 0; li < nodes.length - 1; li++) for (const a of nodes[li]) for (const b of nodes[li + 1]) lp.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const lg = kit.track(new THREE.BufferGeometry());
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lineMat = kit.track(new THREE.LineBasicMaterial({ color: th.accentA, transparent: true, opacity: 0.35 }));
  net.add(new THREE.LineSegments(lg, lineMat));
  kit.anim((t) => {
    net.rotation.y = Math.sin(t * 0.3) * 0.35;
    nodeMeshes.forEach((nm, i) => nm.scale.setScalar(0.8 + Math.max(0, Math.sin(t * 3 - i * 0.5)) * 0.6));
    lineMat.opacity = 0.25 + Math.sin(t * 2) * 0.1;
  });
  // モニター（学習の進み具合のグラフ）
  const graph = kit.tex(256, 160, (g) => {
    g.fillStyle = '#0d1a26';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = blue;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= 236; x += 4) {
      const y = 20 + 110 * Math.exp(-x / 60) + Math.sin(x * 0.5) * 3;
      if (x === 0) g.moveTo(10 + x, y);
      else g.lineTo(10 + x, y);
    }
    g.stroke();
    g.fillStyle = '#7dffcf';
    g.font = `bold 16px ${MONO}`;
    g.fillText('loss 0.0123', 140, 30);
  });
  for (const s of [-1, 1]) {
    kit.box(2.6, 1.7, 0.12, kit.toon(0x2a3140), cx + s * (w / 2 - 2.2), m.top + 1.9, -2.2);
    kit.plane(2.4, 1.5, kit.basic(0xffffff, { map: graph }), cx + s * (w / 2 - 2.2), m.top + 1.9, -2.13);
    kit.box(0.12, 1.0, 0.12, kit.toon(0x8a96a8), cx + s * (w / 2 - 2.2), m.top + 0.5, -2.2);
  }
  // ロボットアーム（奥の中央。ゆっくり動く）
  const arm = new THREE.Group();
  arm.position.set(cx, m.top, -3.4);
  kit.add(arm);
  kit.mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.4, 16), kit.toon(0xffffff), 0, 0.2, 0, arm);
  const seg1 = new THREE.Group();
  seg1.position.y = 0.4;
  arm.add(seg1);
  kit.box(0.3, 1.6, 0.3, kit.toon(0xf2f6fa), 0, 0.8, 0, seg1);
  const seg2 = new THREE.Group();
  seg2.position.y = 1.6;
  seg1.add(seg2);
  kit.box(0.25, 1.2, 0.25, kit.toon(0xf2f6fa), 0, 0.6, 0, seg2);
  kit.mesh(new THREE.SphereGeometry(0.18, 10, 8), kit.glow(th.accentA), 0, 1.25, 0, seg2);
  kit.anim((t) => {
    arm.rotation.y = Math.sin(t * 0.5) * 0.8;
    seg1.rotation.z = Math.sin(t * 0.7) * 0.35;
    seg2.rotation.z = Math.sin(t * 0.9 + 1) * 0.6;
  });

  // 床：白いタイル（つや）と、手前の青い光のライン
  const tile = kit.tex(128, 128, (g) => {
    g.fillStyle = '#f4f8fc';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#d6e2ee';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
  }, [1.5, 1.5]);
  const front = kit.tex(256, 64, (g) => {
    g.fillStyle = '#e8eef5';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#c8d4e2';
    for (let x = 16; x < 256; x += 32) g.fillRect(x, 20, 16, 24);
  }, [3, 0.75]);
  mainSlab(kit, kit.std(0xffffff, { map: tile, roughness: 0.25, metalness: 0.05 }), kit.toon(0xffffff, { map: front }), 0.7, 5);
  const strip = kit.box(w - 0.2, 0.06, 0.06, kit.glow(th.accentA), cx, m.top - 0.25, 2.5);
  kit.anim((t) => ((strip.material as THREE.MeshBasicMaterial).color.setHex(Math.sin(t * 1.5) > 0 ? th.accentA : th.accentB)));
  // 台の下：機械の土台と、浮かせる青い光
  kit.box(w * 0.8, 2.4, 3.6, kit.toon(0x3a4252), cx, m.top - 1.9, 0);
  kit.plane(w * 0.9, 3, kit.basic(th.accentA, { map: kit.soft(), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }), cx, m.top - 3.6, 0.5);

  // すり抜け足場：白い浮き板と、下の青い光
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.24, 2.2, [kit.toon(0xffffff, { map: front }), kit.std(0xffffff, { map: tile, roughness: 0.25 })], { radius: 0.1, bevel: 0.05 }));
    kit.box(pw, 0.04, 0.04, kit.glow(th.accentA), 0, 0.005, 1.1, g);
    const glow = kit.plane(pw * 0.9, 1.2, kit.basic(th.accentA, { map: kit.soft(), transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }), 0, -0.6, 0.2, g);
    glow.renderOrder = 1;
  });
  // 漂う光の粒（データ）
  kit.particles({ count: high ? 50 : 20, x: [cx - 18, cx + 18], y: [m.top, m.top + 14], z: [-8, 1], color: [th.accentA, th.accentB], size: 0.14, vy: 0.4, wobble: 0.3, opacity: 0.8 });
  void rnd;
}

// ====================================================================== 24時間ジム（パーソナルトレーナー）
function buildGym(kit: Kit): void {
  const { cx, w, m, rnd, high } = kit;
  const th = kit.stage.theme;
  const orange = hex(th.accentA);
  // 奥の壁：明るい壁と、大きな鏡、ネオンの看板
  const wall = kit.tex(256, 256, (g) => {
    g.fillStyle = '#efe6da';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e4d8c8';
    for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 2);
    g.fillStyle = orange;
    g.fillRect(0, 196, 256, 10);
  }, [6, 3]);
  kit.plane(130, 50, kit.toon(0xffffff, { map: wall }), cx, 10, -14);
  const mirror = kit.std(0xdfe8ee, { roughness: 0.05, metalness: 0.6 });
  for (const x of [-15, -5, 5, 15]) {
    kit.box(9.2, 6.2, 0.1, kit.toon(0x3a3a44), cx + x, m.top + 4.4, -12.9);
    kit.box(9, 6, 0.1, mirror, cx + x, m.top + 4.4, -12.8);
    kit.plane(2, 6, kit.basic(0xffffff, { transparent: true, opacity: 0.18, depthWrite: false }), cx + x - 2.5, m.top + 4.4, -12.7).rotation.z = 0.35;
  }
  const sign = neonSign(kit, '24H GYM', th.accentA, 7);
  sign.position.set(cx, m.top + 9.6, -12.6);
  kit.add(sign);
  // 天井の照明
  for (let i = -3; i <= 3; i++) kit.box(3.2, 0.12, 0.6, kit.glow(0xfff6e0), cx + i * 6, m.top + 12.5, -6);

  // ダンベル棚（左右の奥）
  const iron = kit.toon(0x2a2a32);
  for (const sd of [-1, 1]) {
    const x0 = cx + sd * (w / 2 + 4.5);
    kit.box(6, 0.2, 1.4, kit.toon(0x55555f), x0, m.top + 1.0, -5);
    kit.box(6, 0.2, 1.4, kit.toon(0x55555f), x0, m.top + 2.0, -5.3);
    for (const y of [1.0, 2.0]) {
      for (let k = 0; k < 5; k++) {
        const x = x0 - 2.4 + k * 1.2;
        const z = y > 1.5 ? -5.3 : -5;
        const bar = kit.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), kit.toon(0xa0a6b0), x, m.top + y + 0.3, z);
        bar.rotation.z = Math.PI / 2;
        for (const e of [-0.35, 0.35]) {
          const pl = kit.mesh(new THREE.CylinderGeometry(0.22 + k * 0.02, 0.22 + k * 0.02, 0.14, 14), k % 2 ? iron : kit.toon(th.accentA), x + e, m.top + y + 0.3, z);
          pl.rotation.z = Math.PI / 2;
        }
      }
    }
    for (const x of [x0 - 3, x0 + 3]) kit.box(0.2, 2.6, 0.2, kit.toon(0x55555f), x, m.top + 1.3, -5.2);
  }
  // 奥のランニングマシン（ベルトが流れる）
  const beltTex = kit.tex(64, 64, (g) => {
    g.fillStyle = '#26262c';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3a3a44';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 6, 64);
  }, [4, 1]);
  kit.scroll(beltTex, 1.2, 0);
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * 5;
    kit.box(3.6, 0.4, 1.6, kit.toon(0x3a3a44), x, m.top + 0.2, -9);
    kit.plane(3.2, 1.3, kit.basic(0xffffff, { map: beltTex }), x, m.top + 0.42, -9).rotation.x = -Math.PI / 2;
    kit.box(0.12, 1.6, 0.12, kit.toon(0x55555f), x - 1.5, m.top + 1.1, -9.6);
    kit.box(0.12, 1.6, 0.12, kit.toon(0x55555f), x + 1.5, m.top + 1.1, -9.6);
    kit.box(3.2, 0.5, 0.3, kit.toon(0x2a2a32), x, m.top + 1.9, -9.6);
    kit.box(1.2, 0.3, 0.05, kit.glow(i % 2 ? th.accentB : th.accentA), x, m.top + 1.95, -9.43);
  }
  // サンドバッグ（左右の手前寄り。ゆらゆら揺れる）
  const bags: THREE.Group[] = [];
  for (const sd of [-1, 1]) {
    const g = new THREE.Group();
    g.position.set(cx + sd * (w / 2 + 2.2), m.top + 8, -2.5);
    kit.add(g);
    kit.box(0.05, 2.2, 0.05, kit.toon(0x888890), 0, -1.1, 0, g);
    kit.mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.4, 16), kit.toon(0xc0392b), 0, -3.4, 0, g);
    kit.mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.15, 16), kit.toon(0x2a2a32), 0, -2.4, 0, g);
    bags.push(g);
  }
  kit.anim((t) => bags.forEach((g, i) => (g.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.08)));
  // ポスター
  const poster = kit.tex(128, 192, (g) => {
    g.fillStyle = '#1f1f2a';
    g.fillRect(0, 0, 128, 192);
    g.fillStyle = orange;
    g.font = `900 30px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('NO', 64, 60);
    g.fillText('PAIN', 64, 96);
    g.fillText('NO', 64, 140);
    g.fillText('GAIN', 64, 176);
  });
  for (const sd of [-1, 1]) kit.plane(2, 3, kit.basic(0xffffff, { map: poster }), cx + sd * 10.5, m.top + 9.5, -12.7);

  // 床：黒いゴムマット（オレンジのライン）。中央はランニングマシンのベルト
  const mat = kit.tex(128, 128, (g) => {
    g.fillStyle = '#2e2e36';
    g.fillRect(0, 0, 128, 128);
    speckle(g, 128, 128, rnd, ['#3a3a44', '#26262c'], 220, 2);
    g.strokeStyle = '#1f1f26';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 128, 128);
  }, [2, 1]);
  const front = kit.tex(256, 64, (g) => {
    g.fillStyle = '#26262c';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = orange;
    g.fillRect(0, 6, 256, 6);
    g.fillStyle = '#3a3a44';
    for (let x = 12; x < 256; x += 40) g.fillRect(x, 26, 20, 26);
  }, [3, 0.75]);
  mainSlab(kit, kit.std(0xffffff, { map: mat, roughness: 0.9 }), kit.toon(0xffffff, { map: front }), 0.7, 5);
  // 床のランニングマシン（ギミックのとき流れる。ふだんはゆっくり）
  const floorBelt = kit.tex(64, 64, (g) => {
    g.fillStyle = '#1c1c22';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#34343e';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 5, 64);
  }, [8, 1]);
  floorBelt.wrapS = floorBelt.wrapT = THREE.RepeatWrapping;
  const beltMesh = kit.plane(w - 3, 2.6, kit.basic(0xffffff, { map: floorBelt }), cx, m.top + 0.012, 0);
  beltMesh.rotation.x = -Math.PI / 2;
  for (const sd of [-1, 1]) kit.box(0.12, 0.06, 2.7, kit.toon(th.accentA), cx + sd * ((w - 3) / 2), m.top + 0.03, 0);
  kit.anim((_t, dt) => (floorBelt.offset.x += dt * 0.3));
  // 台の下：鉄骨
  kit.box(w * 0.8, 2.4, 3.6, kit.toon(0x3a3a44), cx, m.top - 1.9, 0);
  for (let i = -3; i <= 3; i++) kit.box(0.2, 2.4, 0.2, kit.toon(th.accentA), cx + i * 2.4, m.top - 1.9, 1.85);

  // すり抜け足場：トレーニングベンチ（黒いクッションとオレンジの縁）
  kit.platform((g, pw) => {
    g.add(kit.slab(pw, 0.3, 1.6, [kit.toon(0x2a2a32), kit.toon(0x1f1f26)], { radius: 0.12, bevel: 0.06 }));
    kit.box(pw, 0.06, 0.06, kit.toon(th.accentA), 0, -0.3, 0.8, g);
    if (pw < 3.8) {
      // 左右はベンチ：脚をつける
      for (const sd of [-1, 1]) kit.box(0.18, 1.1, 0.9, kit.toon(0x55555f), sd * (pw / 2 - 0.4), -0.85, 0, g);
    } else {
      // 中央の動く足場はバーベル（両端にプレート）
      for (const sd of [-1, 1]) {
        const pl = kit.mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.25, 20), iron, sd * (pw / 2 + 0.2), -0.1, 0, g);
        pl.rotation.z = Math.PI / 2;
        const rim = kit.mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.27, 20), kit.toon(th.accentA), sd * (pw / 2 + 0.2), -0.1, 0, g);
        rim.rotation.z = Math.PI / 2;
      }
    }
  });
  // ほこりのきらめき
  kit.particles({ count: high ? 36 : 14, x: [cx - 18, cx + 18], y: [m.top, m.top + 12], z: [-8, 1], color: [0xffffff, th.accentA], size: 0.1, vy: 0.2, wobble: 0.3, opacity: 0.6 });
}
