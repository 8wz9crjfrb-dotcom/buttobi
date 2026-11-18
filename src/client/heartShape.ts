// ハートの形（なめらかな曲線のハートを、厚みを付けて立体にする）。ステージの飾りや、重い愛のハートに使う

import * as THREE from 'three';

/** 幅がおよそ 2×size、厚みが depth×size のハート（中心が原点、とがりが下） */
export function heartGeometry(size = 1, depth = 0.45): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -1);
  s.bezierCurveTo(-0.25, -0.72, -1, -0.32, -1, 0.22);
  s.bezierCurveTo(-1, 0.78, -0.38, 1.0, 0, 0.56);
  s.bezierCurveTo(0.38, 1.0, 1, 0.78, 1, 0.22);
  s.bezierCurveTo(1, -0.32, 0.25, -0.72, 0, -1);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.45, bevelSize: 0.12, bevelSegments: 4, curveSegments: 20 });
  geo.center();
  geo.scale(size, size, size);
  return geo;
}
