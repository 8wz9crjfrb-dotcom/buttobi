// 玉入れ（投げる玉入れ）：キャラごとの性能と、投げたときの速さの計算（試合の計算・投げる道筋の表示・CPUで共通に使う）

/** キャラごとの玉入れの性能（1〜5。3がふつう）。throw = 投げる力、speed = ボールを持って走る速さ、steal = 奪う力（届く距離） */
export interface BallStats {
  throw: number;
  speed: number;
  steal: number;
}

export const BALL_STATS: Record<string, BallStats> = {
  guard: { throw: 3, speed: 2, steal: 4 },
  hacker: { throw: 3, speed: 3, steal: 3 },
  thief: { throw: 2, speed: 4, steal: 5 },
  streamer: { throw: 4, speed: 3, steal: 2 },
  dopa: { throw: 2, speed: 5, steal: 3 },
  gacha: { throw: 4, speed: 2, steal: 3 },
  courier: { throw: 3, speed: 5, steal: 2 },
  ai: { throw: 5, speed: 2, steal: 2 },
  trainer: { throw: 5, speed: 1, steal: 4 },
  threeb: { throw: 3, speed: 4, steal: 3 },
  menhera: { throw: 2, speed: 3, steal: 5 },
};

export function ballStats(charId: string): BallStats {
  return BALL_STATS[charId] ?? { throw: 3, speed: 3, steal: 3 };
}

/** 玉入れの決まり */
export const THROW = {
  /** 投げる速さ（いちばん弱い〜いちばん強い。投げる力3のとき） */
  min: 5,
  max: 15.5,
  /** 投げる力1段階ごとの、いちばん強い速さの倍率の差 */
  perThrow: 0.06,
  /** ボールを持って走る速さ（速さ3のとき）と、1段階ごとの差 */
  holdSpeed: 0.9,
  perSpeed: 0.06,
  /** 奪える距離（横・縦。奪う力3のとき）と、1段階ごとの横の距離の差 */
  stealX: 1.3,
  stealY: 1.7,
  perSteal: 0.15,
  /** 奪いに失敗したあと、次に奪えるまで（フレーム） */
  stealMiss: 45,
  /** 奪った・拾った直後は、奪われない（フレーム） */
  safe: 60,
  /** 奪われた人が、すぐに奪い返せない時間（フレーム） */
  stolenCd: 60,
  /** 点を取ったチームが、次に出てくるボールを取れない時間（ボールが出てきてから。フレーム） */
  scorerLock: 60,
  /** 投げた人がすぐ自分で取り直せない時間（フレーム） */
  noCatch: 25,
  /** 投げた直後は、だれも取れない時間（手から離れたばかり。すぐそばの相手に取られないように） */
  noCatchAll: 12,
  /** これより短く引っ張って離したら、投げずにやめる */
  deadZone: 0.2,
};

/** 狙い（向き ax, ay と、引っ張った長さ = 大きさ 0〜1）から、投げる速さ（vx, vy）を出す */
export function throwVelocity(charId: string, ax: number, ay: number): { vx: number; vy: number } {
  const len = Math.min(1, Math.hypot(ax, ay));
  if (len < 1e-6) return { vx: 0, vy: 0 };
  const st = ballStats(charId);
  const top = THROW.max * (1 + (st.throw - 3) * THROW.perThrow);
  const k = Math.min(1, (len - THROW.deadZone) / (1 - THROW.deadZone));
  const sp = THROW.min + (top - THROW.min) * Math.max(0, k);
  return { vx: (ax / Math.hypot(ax, ay)) * sp, vy: (ay / Math.hypot(ax, ay)) * sp };
}

/** 投げる力の最大の速さ */
export function throwTop(charId: string): number {
  return THROW.max * (1 + (ballStats(charId).throw - 3) * THROW.perThrow);
}

/** ボールの動き（試合の計算と同じ）：重力・空気抵抗。1フレームは 1/60 秒 */
export const BALL_GRAVITY = 15;
export const BALL_DRAG = 0.997;

/** 投げたボールの道筋（壁や床ではね返る前まで）。n フレーム分の点を返す（every フレームごと） */
export function throwPath(x: number, y: number, vx: number, vy: number, n: number, every = 1): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const dt = 1 / 60;
  for (let i = 1; i <= n; i++) {
    vy -= BALL_GRAVITY * dt;
    vx *= BALL_DRAG;
    x += vx * dt;
    y += vy * dt;
    if (i % every === 0) out.push({ x, y });
  }
  return out;
}

/** 速さ sp に必要な、引っ張る長さ（0〜1） */
export function lenForSpeed(charId: string, sp: number): number {
  const top = throwTop(charId);
  const k = Math.max(0, Math.min(1, (sp - THROW.min) / (top - THROW.min)));
  return THROW.deadZone + (1 - THROW.deadZone) * k;
}

/**
 * (x, y) から角度 deg で投げて、(tx, ty) の高さを上から下へ通るときに横の位置が tx になる速さ（届かなければ null）。
 * CPU が狙うのに使う
 */
export function speedToHit(charId: string, x: number, y: number, deg: number, tx: number, ty: number): number | null {
  const ang = (deg * Math.PI) / 180;
  const dir = Math.sign(tx - x) || 1;
  const cross = (sp: number): number | null => {
    let px = x;
    let py = y;
    let vx = Math.cos(ang) * sp * dir;
    let vy = Math.sin(ang) * sp;
    const dt = 1 / 60;
    for (let i = 0; i < 400; i++) {
      const ly = py;
      vy -= BALL_GRAVITY * dt;
      vx *= BALL_DRAG;
      px += vx * dt;
      py += vy * dt;
      if (vy < 0 && ly > ty && py <= ty) return px;
    }
    return null;
  };
  let lo = THROW.min;
  let hi = throwTop(charId);
  const far = cross(hi);
  if (far === null || (far - tx) * dir < 0) return null;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    const at = cross(mid);
    if (at === null || (at - tx) * dir < 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
