// CPUの思考。強さ(level 1〜9)で反応の速さと判断の正確さが変わる。

import { Rng } from './rng';
import { THREEB_RULES, TRAINER } from './moves';
import { BTN_A, BTN_B, BTN_JUMP, BTN_SHIELD, type AreaZone, type InputState } from './types';
import { ballBaskets, type Fighter, type Sim } from './sim';
import { lenForSpeed, speedToHit } from './ballThrow';

/** CPUが狙う相手（選手、または分身） */
interface Target {
  x: number;
  y: number;
  state: string;
  damage: number;
  grounded: boolean;
}

interface Brain {
  hold: InputState;
  holdFrames: number;
  cooldown: number;
  lastButtons: number;
}

export class CpuController {
  private brains = new Map<number, Brain>();
  private rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x9e3779b9);
  }

  think(sim: Sim, f: Fighter, level: number): InputState {
    let b = this.brains.get(f.slot);
    if (!b) {
      b = { hold: { mx: 0, my: 0, buttons: 0 }, holdFrames: 0, cooldown: 0, lastButtons: 0 };
      this.brains.set(f.slot, b);
    }
    // 玉入れは必殺技が出ない（Bは「投げる」）ので、待ち時間の確認はしない
    const raw = this.decide(sim, f, level, b);
    const out = sim.setup.rules.mode === 'ball' ? raw : this.avoidCooldown(sim, f, raw, b);
    // 同じボタンを連続で「押した」ことにするため、前フレームに押していたボタンは一度離す
    const fresh = out.buttons & ~b.lastButtons;
    const keepHeld = out.buttons & b.lastButtons & (BTN_SHIELD | BTN_A | BTN_JUMP | BTN_B);
    const buttons = fresh | (b.holdFrames > 0 ? keepHeld : 0);
    b.lastButtons = buttons;
    return { mx: out.mx, my: out.my, buttons };
  }

  private decide(sim: Sim, f: Fighter, level: number, b: Brain): InputState {
    const lv = Math.max(1, Math.min(9, level));
    const m = sim.stage.main;
    if (!f.alive) return { mx: 0, my: 0, buttons: 0 };
    // 玉入れ：拾う・奪う・狙って投げる（攻撃はしない）
    if (sim.setup.rules.mode === 'ball') return this.ballPlay(sim, f, lv, b);
    // つかまれている：ボタンを連打してもがく（強いほど速い）
    if (f.state === 'grabbed') return this.rng.chance(0.1 + lv * 0.06) ? { mx: 0, my: 0, buttons: BTN_A } : { mx: 0, my: 0, buttons: 0 };
    // つかんでいる：何回かつかみ攻撃をしてから投げる
    if (f.state === 'grab') {
      if (f.stateTime < 6) return { mx: 0, my: 0, buttons: 0 };
      if (this.rng.chance(0.1 + lv * 0.01)) {
        const v = sim.fighter(f.grabbing);
        if (v && v.damage > 90) {
          // %が高い相手は、近いほうの崖に向かって投げる
          const towardRight = m.x2 - f.x < f.x - m.x1 ? 1 : -1;
          return { mx: towardRight, my: 0, buttons: 0 };
        }
        return this.rng.chance(0.5) ? { mx: 0, my: -1, buttons: 0 } : { mx: f.facing, my: 0, buttons: 0 };
      }
      return this.rng.chance(0.2) ? { mx: 0, my: 0, buttons: BTN_A } : { mx: 0, my: 0, buttons: 0 };
    }

    // 崖につかまっている：少し待ってから上がる
    if (f.state === 'ledge') {
      if (f.stateTime < 10 + (9 - lv) * 4) return { mx: 0, my: 0, buttons: 0 };
      return this.rng.chance(0.5) ? { mx: 0, my: 0, buttons: BTN_JUMP } : { mx: 0, my: 1, buttons: 0 };
    }

    // 場外：ステージへ戻る。左右の操作が逆になっている（酔い）ときは、強いCPUほど逆に入れて戻る
    const offStage = f.x < m.x1 - 0.1 || f.x > m.x2 + 0.1;
    if (offStage && !f.grounded) {
      const toward = (f.x < 0 ? 1 : -1) * (f.confused > 0 && lv >= 4 ? -1 : 1);
      if (f.state === 'helpless' || f.state === 'attack' || f.state === 'hitstun') return { mx: toward, my: 0, buttons: 0 };
      // ハッカー：約2秒前にステージの上にいたなら、Ctrl+Z で戻る
      if (f.def.id === 'hacker' && f.cdS === 0 && lv >= 3 && this.rewindTarget(f, m) && this.rng.chance(0.25)) return { mx: toward, my: 0, buttons: BTN_B };
      if (f.vy < 1 && f.y < m.top + 2 && f.jumpsLeft > 0) return { mx: toward, my: 0, buttons: BTN_JUMP };
      if (f.vy < 0 && f.jumpsLeft === 0 && f.y < m.top - 0.5) return { mx: toward * 0.4, my: 1, buttons: BTN_B };
      if (f.vy < -2 && f.jumpsLeft === 0 && Math.abs(f.x) - m.x2 > 4 && !f.sideBUsed) return { mx: toward, my: 0, buttons: BTN_B };
      return { mx: toward, my: 0, buttons: 0 };
    }

    // 自転車（配達員）：ボタンは押さずに走り続けて体当たりする。崖の手前で折り返し、後ろの相手には向きを変える
    if (f.bike > 0) {
      b.holdFrames = 0;
      const t = this.target(sim, f);
      const room = f.facing > 0 ? m.x2 - f.x : f.x - m.x1;
      if (room < 2.2 + lv * 0.1) return { mx: -f.facing, my: 0, buttons: 0 };
      if (t && Math.sign(t.x - f.x) !== f.facing && Math.abs(t.x - f.x) > 2.5) return { mx: -f.facing, my: 0, buttons: 0 };
      // 相手が上にいて届かないときは、ジャンプで降りて追う
      if (t && t.y - f.y > 2.5 && Math.abs(t.x - f.x) < 3) return { mx: f.facing, my: 0, buttons: BTN_JUMP };
      return { mx: f.facing, my: 0, buttons: 0 };
    }

    // ガチャ会場のルーレット：ハズレのマスに立っていたら、近い当たり（なければ何もないマス）へ移る
    const tiles = f.grounded && f.groundRef === -1 && lv >= 3 ? sim.rouletteShown() : null;
    if (tiles) {
      const tw = (m.x2 - m.x1) / tiles.length;
      const mine = Math.max(0, Math.min(tiles.length - 1, Math.floor((f.x - m.x1) / tw)));
      if (tiles[mine] < 0 || (lv >= 6 && tiles[mine] === 0)) {
        let best = -1;
        let bestD = Infinity;
        tiles.forEach((r, i) => {
          if (r < 0 || (lv >= 6 && r === 0 && tiles.some((x) => x > 0))) return;
          const d = Math.abs(m.x1 + tw * (i + 0.5) - f.x) - (r > 0 ? 1.5 : 0);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0) {
          b.holdFrames = 0;
          return { mx: Math.sign(m.x1 + tw * (best + 0.5) - f.x), my: 0, buttons: 0 };
        }
      }
    }

    // ボタンを押し続けている途中（溜めやガード）
    if (b.holdFrames > 0) {
      b.holdFrames--;
      return b.hold;
    }

    // エリアバトル：エリアへ向かう。エリアの中では、外の相手を深追いしない
    if (sim.setup.rules.mode === 'area') {
      const go = this.areaMove(sim, f, lv);
      if (go) return go;
    }
    // 王冠うばい：中央に出た王冠を拾いに行く。持っているときは相手から離れる（はじめは相手を倒しに行く）
    if (sim.setup.rules.mode === 'crown') {
      const go = this.crownMove(sim, f, lv);
      if (go) return go;
    }
    // コイン集め：近くのコインを拾いに行く（相手がすぐそばにいれば戦う）
    if (sim.setup.rules.mode === 'coins') {
      const go = this.coinMove(sim, f, lv);
      if (go) return go;
    }

    if (b.cooldown > 0) {
      b.cooldown--;
      // 待っている間は軽く追いかける
      const t = this.target(sim, f);
      if (!t) return { mx: 0, my: 0, buttons: 0 };
      const dx = t.x - f.x;
      return { mx: Math.abs(dx) > 2 ? Math.sign(dx) * 0.8 : 0, my: 0, buttons: 0 };
    }

    const reaction = 26 - lv * 2.5;
    b.cooldown = Math.max(1, Math.round(this.rng.range(reaction * 0.5, reaction * 1.2)));

    const t = this.target(sim, f);
    if (!t) return { mx: 0, my: 0, buttons: 0 };
    const dx = t.x - f.x;
    const dy = t.y - f.y;
    const adx = Math.abs(dx);
    const dir = Math.sign(dx) || 1;

    // 相手が攻撃中で近い → ガードや回避
    if (t.state === 'attack' && adx < 2.4 && Math.abs(dy) < 2 && f.grounded && this.rng.chance(0.06 * lv)) {
      if (this.rng.chance(0.3)) return { mx: -dir, my: 0, buttons: BTN_SHIELD };
      b.hold = { mx: 0, my: 0, buttons: BTN_SHIELD };
      b.holdFrames = 10 + Math.round(this.rng.range(0, 12));
      return b.hold;
    }

    // キャラごとの必殺技の使い方
    const special = this.characterSpecial(f, t, adx, dy, dir, lv, b);
    if (special) return special;

    // 近い：攻撃
    if (adx < 1.9 && Math.abs(dy) < 1.6) {
      if (!f.grounded) {
        const back = dir !== f.facing;
        if (dy > 0.8) return { mx: 0, my: 1, buttons: BTN_A };
        if (dy < -0.8) return { mx: 0, my: -1, buttons: BTN_A };
        return { mx: back ? dir : this.rng.chance(0.5) ? dir : 0, my: 0, buttons: BTN_A };
      }
      const r = this.rng.next();
      const highDamage = t.damage > 90;
      if (t.state === 'shield' && this.rng.chance(0.5)) return { mx: 0, my: 0, buttons: BTN_SHIELD | BTN_A };
      if (dy > 1.0) return { mx: 0, my: 1, buttons: BTN_A };
      if (highDamage && r < 0.12) {
        // 溜め攻撃：Aを押し続ける（弱攻撃のあと溜めに入り、離すと殴る）
        b.hold = { mx: 0, my: 0, buttons: BTN_A };
        b.holdFrames = 24 + Math.round(this.rng.range(0, 40));
        return b.hold;
      }
      if (highDamage && r < 0.35 + lv * 0.03) {
        // スマッシュ（はじき入力のため、直前のフレームはスティックを戻している必要がある）
        if (Math.abs(f.input.mx) < 0.3) {
          b.hold = { mx: dir, my: 0, buttons: BTN_A };
          b.holdFrames = Math.round(this.rng.range(0, 20));
          return b.hold;
        }
        return { mx: 0, my: 0, buttons: 0 };
      }
      if (r < 0.35) return { mx: 0, my: 0, buttons: BTN_A };
      if (r < 0.6) return { mx: dir * 0.6, my: 0, buttons: BTN_A };
      if (r < 0.75) return { mx: 0, my: -1, buttons: BTN_A };
      if (r < 0.85) return { mx: 0, my: -1, buttons: BTN_B };
      if (r < 0.92) return { mx: 0, my: 0, buttons: BTN_JUMP };
      return { mx: dir, my: 0, buttons: BTN_SHIELD | BTN_A };
    }

    // 中距離：飛び道具・突進・ジャンプで近づく
    if (adx < 7 && Math.abs(dy) < 1.2 && f.grounded) {
      const r = this.rng.next();
      if (r < 0.12) return { mx: 0, my: 0, buttons: BTN_B };
      // ハッカーの横B（Ctrl+Z）は戻るための技なので、近づくのには使わない
      if (r < 0.2 && adx > 3 && f.def.id !== 'hacker') return { mx: dir, my: 0, buttons: BTN_B };
    }
    if (dy > 2 && adx < 4 && (f.grounded || f.jumpsLeft > 0) && this.rng.chance(0.5)) {
      return { mx: dir * 0.5, my: 0, buttons: BTN_JUMP };
    }
    if (dy < -1.5 && f.grounded && f.groundRef >= 0 && this.rng.chance(0.4)) {
      return { mx: 0, my: -1, buttons: 0 };
    }

    // 台の端に近づきすぎない
    const nextX = f.x + dir * 1.5;
    if ((nextX < m.x1 + 0.5 || nextX > m.x2 - 0.5) && !t.grounded) {
      return { mx: 0, my: 0, buttons: 0 };
    }
    b.cooldown = Math.min(b.cooldown, 4);
    return { mx: dir, my: 0, buttons: 0 };
  }

  /** Ctrl+Z（ハッカー）で戻る先（約2秒前の場所）がステージの上なら true */
  private rewindTarget(f: Fighter, m: { x1: number; x2: number; top: number }): boolean {
    const h = f.rewindHist;
    if (h.length < 3) return false;
    return h[0] > m.x1 + 0.3 && h[0] < m.x2 - 0.3 && h[1] >= m.top - 0.2;
  }

  /** キャラごとに得意な必殺技を、合う場面で使う */
  private characterSpecial(f: Fighter, t: Target, adx: number, dy: number, dir: number, lv: number, b: Brain): InputState | null {
    if (!f.grounded) return null;
    const near = Math.abs(dy) < 1.4;
    const skill = 0.25 + lv * 0.06;
    switch (f.def.id) {
      case 'dopa':
        // 倍速再生は使えるならすぐ使う。通知爆撃で引き寄せてから殴る。無限スクロールは押し直して続ける
        if (f.speedBuff === 0 && f.speedCd === 0 && this.rng.chance(skill)) return { mx: 0, my: 0, buttons: BTN_B };
        // あなたへのおすすめ：少し離れた相手の目の前へ飛んでいく（地上の相手のときだけ。場外へ飛び込まないように）
        if (near && t.grounded && adx > 3 && adx < 9 && this.rng.chance(skill * 0.35)) return { mx: 0, my: -1, buttons: BTN_B };
        if (near && adx > 3 && adx < 8 && this.rng.chance(skill * 0.4)) {
          b.hold = { mx: dir, my: 0, buttons: 0 };
          b.holdFrames = 0;
          return { mx: dir, my: 0, buttons: BTN_B };
        }
        break;
      case 'hacker':
        // Ctrl+Z：ここ2秒で大きくダメージを受けていたら、戻ってダメージを減らす
        if (f.cdS === 0 && f.rewindHist.length >= 3 && f.damage - f.rewindHist[2] >= 25 && this.rng.chance(skill * 0.5)) return { mx: dir, my: 0, buttons: BTN_B };
        break;
      case 'gacha':
        // 課金は効果が切れていて、%が低いうちに使う。離れていたら10連
        if (f.powerBuff === 0 && f.damage < 90 && adx > 3 && this.rng.chance(skill * 0.5)) return { mx: 0, my: -1, buttons: BTN_B };
        if (near && adx > 2.5 && adx < 7 && this.rng.chance(skill * 0.35)) return { mx: 0, my: 0, buttons: BTN_B };
        if (near && adx < 2.2 && t.damage > 60 && this.rng.chance(skill * 0.3)) return { mx: dir, my: 0, buttons: BTN_B };
        break;
      case 'streamer':
        // 強制アップデートは近くの地上の相手に。眠らせたらスマッシュ
        if (near && adx < 1.8 && t.grounded && t.state !== 'sleep' && this.rng.chance(skill * 0.3)) return { mx: 0, my: -1, buttons: BTN_B };
        if (t.state === 'sleep' && adx < 1.9 && near && Math.abs(f.input.mx) < 0.3) {
          b.hold = { mx: dir, my: 0, buttons: BTN_A };
          b.holdFrames = 20;
          return b.hold;
        }
        break;
      case 'threeb':
        // 3B：ときどき着替えて（早着替えで強くなる）、仕事ごとの得意技を使う
        if (f.jobCd === 0 && f.jobBuff === 0 && adx < 3.5 && this.rng.chance(skill * 0.12)) return { mx: 0, my: -1, buttons: BTN_B };
        if (f.job === 0) {
          if (near && adx < 1.6 && this.rng.chance(skill * 0.25)) return { mx: 0, my: 0, buttons: BTN_B };
          if (near && adx > 1.8 && adx < 3.8 && this.rng.chance(skill * 0.18)) return { mx: dir, my: 0, buttons: BTN_B };
        } else if (f.job === 1) {
          // 爆音ソロ：同じくらいの高さの、少し離れた相手へ音を飛ばす。遠い相手ほど長く溜めて届かせる（強いCPUほど溜める長さが正確）
          if (adx > 1.2 && adx < 10 && Math.abs(t.y - f.y) < 1.6 && this.rng.chance(skill * 0.2)) {
            if (dir !== f.facing) return { mx: dir, my: 0, buttons: 0 };
            const need = Math.max(0, ((adx + 0.5) / 4.4 - 1) / (THREEB_RULES.soundRange - 1)) * TRAINER.curlMax;
            b.hold = { mx: 0, my: 0, buttons: BTN_B };
            b.holdFrames = 16 + Math.round(Math.min(TRAINER.curlMax, need + this.rng.range(-1, 1) * (30 - lv * 3)));
            return b.hold;
          }
          if (near && adx > 2.5 && adx < 5 && this.rng.chance(skill * 0.25)) return { mx: dir, my: 0, buttons: BTN_B };
        } else {
          if (near && adx < 1.9 && this.rng.chance(skill * 0.3)) {
            if (dir !== f.facing) return { mx: dir, my: 0, buttons: 0 };
            return { mx: 0, my: 0, buttons: BTN_B };
          }
          if (near && t.grounded && adx > 1.4 && adx < 3.6 && this.rng.chance(skill * 0.3)) return { mx: dir, my: 0, buttons: BTN_B };
        }
        break;
      case 'menhera': {
        // 赤い糸で逃げられなくして、鬼電の印を付ける。近くに来たら泣き落とし
        const tf = t as Partial<Fighter>;
        if (f.cdD === 0 && near && adx < 2.6 && !(tf.awkward ?? 0) && this.rng.chance(skill * 0.35)) return { mx: 0, my: -1, buttons: BTN_B };
        if (f.cdN === 0 && near && adx > 1.8 && adx < 4.6 && !(tf.leashT ?? 0) && this.rng.chance(skill * 0.2)) {
          if (dir !== f.facing) return { mx: dir, my: 0, buttons: 0 };
          return { mx: 0, my: 0, buttons: BTN_B };
        }
        if (f.cdS === 0 && near && adx > 2.5 && adx < 7 && !(tf.callT ?? 0) && this.rng.chance(skill * 0.2)) return { mx: dir, my: 0, buttons: BTN_B };
        break;
      }
      case 'trainer':
        // プロテインは近くに相手がいるときに飲む。ガードしている相手や近い相手にはタックル。
        // 上にいる相手にはマッスルジャンプ。近ければダンベルカールを溜めて殴る
        if (f.armorCd === 0 && adx < 4 && this.rng.chance(skill * 0.5)) return { mx: 0, my: -1, buttons: BTN_B };
        if (near && t.grounded && adx > 1 && adx < 3.2 && this.rng.chance(skill * (t.state === 'shield' ? 0.8 : 0.3))) return { mx: dir, my: 0, buttons: BTN_B };
        if (dy > 1.2 && dy < 4 && adx < 1.5 && this.rng.chance(skill * 0.35)) return { mx: 0, my: 1, buttons: BTN_B };
        if (near && adx < 2.2 && this.rng.chance(skill * 0.2)) {
          if (dir !== f.facing) return { mx: dir, my: 0, buttons: 0 };
          b.hold = { mx: 0, my: 0, buttons: BTN_B };
          b.holdFrames = 14 + Math.round(this.rng.range(0, 30 + lv * 3));
          return b.hold;
        }
        break;
    }
    return null;
  }

  /**
   * 待ち時間中の必殺技は出ないので、押さずに別の行動にする：
   * 場外ならステージへ向かう。ステージの上では、敵がすぐ近くなら同じ向きのふつうの攻撃、いなければ動くだけ
   */
  private avoidCooldown(sim: Sim, f: Fighter, out: InputState, b: Brain): InputState {
    if (!(out.buttons & BTN_B)) return out;
    // 技を出している最中のB（溜めの押しっぱなし・連打で続ける技）は、新しく技を出すわけではないので止めない
    if (f.state === 'attack') return out;
    const ax = Math.abs(out.mx);
    const ay = Math.abs(out.my);
    const cd = ay > 0.5 && ay >= ax ? (out.my > 0 ? f.cdU : f.cdD) : ax > 0.5 ? f.cdS : f.cdN;
    if (cd <= 0) return out;
    // 押し続ける予定（溜め）もやめる
    if (b.holdFrames > 0 && b.hold.buttons & BTN_B) b.holdFrames = 0;
    const m = sim.stage.main;
    const offStage = f.x < m.x1 - 0.1 || f.x > m.x2 + 0.1;
    if (offStage) return { mx: f.x < (m.x1 + m.x2) / 2 ? 1 : -1, my: 0, buttons: out.buttons & ~BTN_B };
    // 敵がすぐ近くにいるときだけ、代わりにふつうの攻撃をする（味方を巻き込まないように）
    const foeNear = sim.fighters.some((o) => o !== f && o.alive && !o.out && !sim.sameTeam(o, f) && Math.abs(o.x - f.x) < 2 && Math.abs(o.y - f.y) < 1.6);
    if (!foeNear) return { mx: out.mx, my: 0, buttons: out.buttons & ~BTN_B };
    return { mx: out.mx, my: ay > 0.5 && ay >= ax ? out.my : 0, buttons: (out.buttons & ~BTN_B) | BTN_A };
  }

  /**
   * 玉入れの動き。null なら、ふつうに戦う。
   * かごまで4〜6.5mなら弱攻撃、7.5〜12mなら横攻撃で山なりに打ち込む（上から入ったときだけ点）。
   * 近すぎ・遠すぎるときは、ボールを体で押して（ドリブル）ちょうどいい距離まで運ぶ
   */
  private crownMove(sim: Sim, f: Fighter, lv: number): InputState | null {
    const c = sim.crown;
    const m = sim.stage.main;
    if (!f.grounded) return null;
    if (c.holder < 0) {
      // 中央に出ている王冠を拾いに行く（上にあればジャンプ）。出るのを待っているときは中央で待つ
      const tx = c.x;
      const dx = tx - f.x;
      if (c.on && c.y - f.y > 1.5 && Math.abs(dx) < 2.5) return { mx: Math.sign(dx) * 0.6, my: 0, buttons: BTN_JUMP };
      if ((c.on || c.timer > 0) && Math.abs(dx) > 0.4) return { mx: Math.sign(dx), my: 0, buttons: 0 };
      return null;
    }
    if (c.holder !== f.slot) return null;
    // 持っている：近くの相手からは離れる（すぐ近くなら戦う）。強いCPUほど上手に逃げる
    let near: Fighter | null = null;
    let nd = Infinity;
    for (const o of sim.fighters) {
      if (o === f || !o.alive || o.out || sim.sameTeam(o, f)) continue;
      const d = Math.abs(o.x - f.x);
      if (d < nd) {
        nd = d;
        near = o;
      }
    }
    if (!near || nd < 1.8 || nd > 7 || !this.rng.chance(0.25 + lv * 0.07)) return null;
    let dir = f.x < near.x ? -1 : 1;
    // 端に追いつめられたら、相手を飛び越える
    if ((dir < 0 && f.x - m.x1 < 2) || (dir > 0 && m.x2 - f.x < 2)) return { mx: -dir, my: 0, buttons: BTN_JUMP };
    return { mx: dir, my: 0, buttons: 0 };
  }

  private coinMove(sim: Sim, f: Fighter, lv: number): InputState | null {
    if (!f.grounded) return null;
    const foe = sim.fighters.some((o) => o !== f && o.alive && !o.out && !sim.sameTeam(o, f) && Math.abs(o.x - f.x) < 1.8 && Math.abs(o.y - f.y) < 1.5);
    if (foe && this.rng.chance(0.75)) return null;
    // 近くて、大きいほど魅力的なコイン
    let best: { x: number; y: number } | null = null;
    let bestD = 7 + lv * 0.4;
    for (const c of sim.coins) {
      if (c.noT > 0 && c.no === f.slot) continue;
      const d = Math.abs(c.x - f.x) + Math.max(0, c.y - f.y) * 0.8 - (c.v > 1 ? 3 : 0);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (!best || !this.rng.chance(0.55 + lv * 0.04)) return null;
    const dx = best.x - f.x;
    if (best.y - f.y > 1.4 && Math.abs(dx) < 2.5) return { mx: Math.sign(dx) * 0.6, my: 0, buttons: BTN_JUMP };
    if (Math.abs(dx) > 0.3) return { mx: Math.sign(dx), my: 0, buttons: 0 };
    return null;
  }

  /** 玉入れ（投げる玉入れ）の動き */
  private ballPlay(sim: Sim, f: Fighter, lv: number, b: Brain): InputState {
    const m = sim.stage.main;
    const ball = sim.ball;
    const idle: InputState = { mx: 0, my: 0, buttons: 0 };
    // 狙っている途中（Bを押し続けている）
    if (b.holdFrames > 0) {
      b.holdFrames--;
      if (ball.holder !== f.slot) {
        b.holdFrames = 0;
        return idle;
      }
      return b.hold;
    }
    // 台の外にいる：台へ戻る（ジャンプ）
    if (f.x < m.x1 - 0.1 || f.x > m.x2 + 0.1) {
      const toward = f.x < (m.x1 + m.x2) / 2 ? 1 : -1;
      return f.vy < 1 && f.jumpsLeft > 0 && f.y < m.top + 1 ? { mx: toward, my: 0, buttons: BTN_JUMP } : { mx: toward, my: 0, buttons: 0 };
    }
    const walk = (tx: number, speed = 1): InputState => {
      const dx = tx - f.x;
      if (Math.abs(dx) < 0.3) return idle;
      const nx = f.x + Math.sign(dx) * 0.8;
      if (f.grounded && (nx < m.x1 + 0.3 || nx > m.x2 - 0.3)) return idle;
      return { mx: Math.sign(dx) * speed, my: 0, buttons: 0 };
    };
    if (!ball.on) return walk((m.x1 + m.x2) / 2);
    const g = ballBaskets(sim.stage)[1 - (f.team % 2)];
    const toGoal = Math.sign(g.cx - (m.x1 + m.x2) / 2) || 1;
    const holder = ball.holder >= 0 ? sim.fighter(ball.holder) : undefined;
    // 自分が持っている：かごから少し離れた所まで運び、狙って投げる
    if (holder === f) {
      const foe = sim.fighters.find((o) => o.alive && !o.out && !sim.sameTeam(o, f) && Math.abs(o.x - f.x) < 1.7 && Math.abs(o.y - f.y) < 1.6);
      // 近くに相手：強いCPUほど、ガードで構えて奪われないようにする
      if (foe && f.grounded && this.rng.chance(0.012 * lv)) {
        b.hold = { mx: 0, my: 0, buttons: BTN_SHIELD };
        b.holdFrames = 12 + Math.round(this.rng.range(0, 14));
        return b.hold;
      }
      const dist = 4.5 + (this.rng.next() < 0.5 ? 0 : 1.5);
      const spot = g.cx - toGoal * dist;
      if (Math.abs(f.x - spot) > 0.9 || !f.grounded) return walk(spot);
      // 狙う：角度を決めて、かごの口のまん中に上から落ちる速さを計算する（弱いCPUほどずれる）
      const deg = 58 + this.rng.range(0, 10);
      const bx = ball.x;
      const by = ball.y;
      const sp = speedToHit(f.def.id, bx, by, deg, g.cx, g.y2 + 0.05);
      if (sp === null) return walk(g.cx - toGoal * 3.5);
      const err = 0.04 + (10 - lv) * 0.03;
      const s2 = sp * (1 + this.rng.range(-err, err));
      const a2 = ((deg + this.rng.range(-err * 60, err * 60)) * Math.PI) / 180;
      const len = lenForSpeed(f.def.id, s2);
      const dir = Math.sign(g.cx - bx) || 1;
      b.hold = { mx: Math.cos(a2) * len * dir, my: Math.sin(a2) * len, buttons: BTN_B };
      b.holdFrames = 10 + Math.round(this.rng.range(0, 30 - lv * 2));
      return b.hold;
    }
    // 自分たちのかご（守る側）
    const mine = ballBaskets(sim.stage)[f.team % 2];
    const toMine = Math.sign(mine.cx - (m.x1 + m.x2) / 2) || 1;
    // 守る：相手が投げたボールが自分たちのかごへ飛んでくる。かごの前で待って、上を通るときにジャンプで取る
    if (!holder && ball.last >= 0) {
      const thrower = sim.fighter(ball.last);
      const incoming = thrower && !sim.sameTeam(thrower, f) && Math.sign(ball.vx) === toMine && Math.abs(mine.cx - ball.x) < 9;
      if (incoming && this.rng.chance(0.25 + lv * 0.07)) {
        const dx = ball.x - f.x;
        if (Math.abs(dx) < 1.6 && ball.y > f.y + 1.6 && ball.y < f.y + 5 && f.grounded) return { mx: Math.sign(dx) * 0.5, my: 0, buttons: BTN_JUMP };
        return walk(mine.cx - toMine * 1.6);
      }
    }
    // 相手が持っている：追いかけて奪う。もう1人の味方が追っていれば、かごの前を守る
    if (holder && !sim.sameTeam(holder, f)) {
      const dx = holder.x - f.x;
      const mate = sim.fighters.find((o) => o !== f && o.alive && !o.out && sim.sameTeam(o, f));
      if (mate && Math.abs(mate.x - holder.x) < Math.abs(f.x - holder.x)) return walk(mine.cx - toMine * 1.8);
      const close = Math.abs(dx) < 1.4 && Math.abs(holder.y - f.y) < 1.6;
      if (close && f.stealCd <= 0 && this.rng.chance(0.08 + lv * 0.03)) return { mx: 0, my: 0, buttons: BTN_A };
      if (holder.y > f.y + 1.8 && Math.abs(dx) < 2.5 && f.grounded) return { mx: Math.sign(dx), my: 0, buttons: BTN_JUMP };
      return walk(holder.x);
    }
    // 味方が持っている：かごの手前で待つ（パスを受ける・こぼれ球を拾う）
    if (holder) return walk(g.cx - toGoal * 3);
    // だれも持っていない：ボールを拾いに行く（高い所なら落ちてくる所でジャンプ）
    const dx = ball.x - f.x;
    if (ball.y > f.y + 1.7 && Math.abs(dx) < 1.2 && f.grounded && ball.vy < 2) return { mx: Math.sign(dx) * 0.4, my: 0, buttons: BTN_JUMP };
    if (ball.y < f.y - 0.6 && f.grounded && f.groundRef >= 0) return { mx: Math.sign(dx) * 0.5, my: -1, buttons: 0 };
    return walk(ball.x);
  }

  /** エリアバトルの動き。null なら、ふつうに戦う */
  private areaMove(sim: Sim, f: Fighter, lv: number): InputState | null {
    let zones = sim.areaZones();
    if (!zones.length) return null;
    // 強いCPUほど、エリアが移る前に次の場所へ先回りする
    const nx = sim.areaNext();
    if (nx.zones.length && nx.nextIn < 40 + lv * 14) zones = nx.zones;
    // 行き先：近いエリア。動かない2つなら、味方がもう立っているエリアは後回し
    const key = sim.areaKey(f);
    let goal: AreaZone | null = null;
    let best = Infinity;
    for (const z of zones) {
      const ally = sim.fighters.some((o) => o !== f && sim.areaKey(o) === key && sim.inZone(o, z));
      const d = Math.abs((z.x1 + z.x2) / 2 - f.x) + Math.abs(z.y1 - f.y) * 1.5 + (ally ? 8 : 0);
      if (d < best) {
        best = d;
        goal = z;
      }
    }
    if (!goal) return null;
    const t = this.target(sim, f);
    const near = t && Math.abs(t.x - f.x) < 1.8 && Math.abs(t.y - f.y) < 1.6;
    const cx = (goal.x1 + goal.x2) / 2;
    if (sim.inZone(f, goal)) {
      // 中にいる：近くの相手や、エリアに入ってきた相手とは戦う。外の相手は追いかけない
      if (!t || near) return null;
      if (t.x >= goal.x1 - 0.5 && t.x <= goal.x2 + 0.5 && t.y >= goal.y1 - 0.5 && t.y <= goal.y2) return null;
      // 端に寄りすぎていたら、まん中に戻る
      return Math.abs(cx - f.x) > (goal.x2 - goal.x1) * 0.3 ? { mx: Math.sign(cx - f.x) * 0.6, my: 0, buttons: 0 } : { mx: 0, my: 0, buttons: 0 };
    }
    // 外にいる：じゃまな相手とは戦い、それ以外はエリアへ向かう
    if (near) return null;
    const dx = cx - f.x;
    const dir = Math.sign(dx) || 1;
    // エリアが上の足場：下まで来たらジャンプ
    if (goal.y1 > f.y + 0.6) {
      if (Math.abs(dx) < 2.6 && (f.grounded || (f.jumpsLeft > 0 && f.vy < 0))) return { mx: dir * 0.6, my: 0, buttons: BTN_JUMP };
      return { mx: dir, my: 0, buttons: 0 };
    }
    // エリアが下の床：足場から降りる
    if (f.y > goal.y2 - 0.2 && f.grounded && f.groundRef >= 0) return { mx: Math.abs(dx) > 1 ? dir * 0.5 : 0, my: -1, buttons: 0 };
    return { mx: dir, my: 0, buttons: 0 };
  }

  /** いちばん近い相手。分身（ハルシネーション）にもだまされる */
  private target(sim: Sim, f: Fighter): Target | null {
    const rules = sim.setup.rules;
    // 王冠うばい：相手が王冠を持っていたら、その人をねらう
    if (rules.mode === 'crown' && sim.crown.holder >= 0 && sim.crown.holder !== f.slot) {
      const h = sim.fighter(sim.crown.holder);
      if (h && h.alive && !sim.sameTeam(h, f)) return h;
      // 仲間が持っている：その仲間にいちばん近い相手をねらって守る
      if (h && h.alive && !h.out) {
        let guard: Fighter | null = null;
        let gd = Infinity;
        for (const o of sim.fighters) {
          if (!o.alive || o.out || sim.sameTeam(o, f)) continue;
          const d = Math.abs(o.x - h.x) + Math.abs(o.y - h.y);
          if (d < gd) {
            gd = d;
            guard = o;
          }
        }
        if (guard) return guard;
      }
    }
    // 賞金首：賞金首（相手）が近くにいれば、その人をねらう
    if (rules.mode === 'bounty' && sim.bountyHolder >= 0 && sim.bountyHolder !== f.slot) {
      const h = sim.fighter(sim.bountyHolder);
      if (h && h.alive && !h.out && !sim.sameTeam(h, f) && Math.abs(h.x - f.x) + Math.abs(h.y - f.y) < 9) return h;
    }
    // 金庫まもり：近くに相手がいなければ、相手の金庫をねらう
    if (rules.mode === 'vault' && sim.vaults.length === 2) {
      const v = sim.vaults[1 - (f.team % 2)];
      const mine = sim.vaults[f.team % 2];
      // 守り：自分の金庫に相手が近づいていて、自分のほうが自分の金庫に近ければ、その相手をねらう
      const raider = sim.fighters.find((o) => o.alive && !o.out && !sim.sameTeam(o, f) && Math.abs(o.x - mine.x) < 3.5);
      if (raider && Math.abs(f.x - mine.x) < Math.abs(f.x - v.x)) return raider;
      const foeNear = sim.fighters.some((o) => o !== f && o.alive && !o.out && !sim.sameTeam(o, f) && Math.abs(o.x - f.x) < 2.2 && Math.abs(o.y - f.y) < 1.6);
      if (v.hp > 0 && !foeNear) return { x: v.x, y: v.y, state: 'idle', damage: 0, grounded: true };
    }
    let best: Target | null = null;
    let bestD = Infinity;
    for (const o of sim.fighters) {
      if (o === f || !o.alive || o.out || sim.sameTeam(o, f)) continue;
      const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    for (const e of sim.entities) {
      if (e.kind !== 'decoy' || e.owner === f.slot) continue;
      const owner = sim.fighter(e.owner);
      if (owner && sim.sameTeam(owner, f)) continue;
      const d = Math.abs(e.x - f.x) + Math.abs(e.y - f.y) * 1.5;
      if (d < bestD) {
        bestD = d;
        best = { x: e.x, y: e.y, state: 'idle', damage: 0, grounded: true };
      }
    }
    return best;
  }
}
