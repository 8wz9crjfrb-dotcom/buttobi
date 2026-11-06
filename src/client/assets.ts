// 3Dモデルの読み込み
//
// robot.glb：three.js のサンプルに含まれる「RobotExpressive」
//   作者 Tomás Laulhé（Quaternius）、改変 Don McCurdy、ライセンス CC0 1.0
//   出典 https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive

import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let robot: GLTF | null = null;
let loading: Promise<GLTF | null> | null = null;

export function loadRobot(): Promise<GLTF | null> {
  if (!loading) {
    const url = `${import.meta.env.BASE_URL}models/robot.glb`;
    loading = new GLTFLoader()
      .loadAsync(url)
      .then((g) => (robot = g))
      .catch((e) => {
        console.warn('モデルを読み込めませんでした。仮モデルで続けます', e);
        return null;
      });
  }
  return loading;
}

export function getRobot(): GLTF | null {
  return robot;
}
