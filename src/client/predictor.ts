// 自分のキャラの先行表示（クライアント側予測）。画面に依存しないので、テストからも使える。
//
// 仕組み：
// 1. 端末の中で、自分の選手だけを入れたシミュレーションを動かす（操作がすぐ反映される）
// 2. サーバーから「入力番号 ack まで処理した時点の、自分の選手の完全な状態」が届いたら、
//    その状態に戻し、ack より後の入力（まだサーバーが処理していない分）をやり直す
// 3. 戻した結果と直前の表示のずれが小さければ、表示側で少しずつ寄せる

import { Sim, type FighterSnapshot } from '../shared/sim';
import type { GameEvent, InputState, MatchSetup, ViewFighter } from '../shared/types';

export interface AuthorityInfo {
  frame: number;
  ack: number;
  state: FighterSnapshot;
}

export class Predictor {
  readonly sim: Sim;
  private pending: { seq: number; inp: InputState }[] = [];

  constructor(setup: MatchSetup, readonly slot: number) {
    this.sim = new Sim(setup, slot);
  }

  /** 1フレーム進める（入力は登録済みの通し番号つき）。起きたイベントを返す */
  step(seq: number, inp: InputState): GameEvent[] {
    this.pending.push({ seq, inp });
    if (this.pending.length > 240) this.pending.shift();
    this.sim.step(new Map([[this.slot, inp]]));
    return this.sim.events;
  }

  /** サーバーの状態に合わせ直す。戻り値は、合わせ直す前後の位置のずれ（x, y） */
  reconcile(au: AuthorityInfo): { dx: number; dy: number } {
    const f = this.sim.fighters[0];
    const bx = f.x;
    const by = f.y;
    f.restore(au.state);
    this.sim.frame = au.frame;
    this.sim.projectiles = [];
    this.pending = this.pending.filter((p) => p.seq > au.ack);
    for (const p of this.pending) this.sim.step(new Map([[this.slot, p.inp]]));
    return { dx: bx - f.x, dy: by - f.y };
  }

  /** まだサーバーの処理待ちになっている入力の数（≒ どれだけ先を表示しているか） */
  get lead(): number {
    return this.pending.length;
  }

  view(): ViewFighter {
    return this.sim.toView().fighters[0];
  }
}
