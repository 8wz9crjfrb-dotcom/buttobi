// 効果音（Web Audio で合成。音声ファイルは使わない）
// ブラウザは操作前の音の再生を制限しているため、最初のタップで unlock() を呼ぶ。

export class Sfx {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;

  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  hit(power: number): void {
    const p = Math.min(1, power / 16);
    this.burst(0.08 + p * 0.15, 0.5 + p * 0.4, 1800 - p * 1200);
    this.tone(220 - p * 120, 0.08 + p * 0.12, 'square', 0.15 + p * 0.15, 60);
  }
  ko(): void {
    this.burst(0.6, 0.8, 500);
    this.tone(880, 0.5, 'sawtooth', 0.2, 110);
  }
  jump(): void {
    this.tone(330, 0.1, 'triangle', 0.15, 660);
  }
  shield(): void {
    this.tone(1200, 0.06, 'sine', 0.2, 900);
  }
  shot(): void {
    this.tone(700, 0.15, 'square', 0.08, 1400);
  }
  counter(): void {
    this.tone(660, 0.08, 'square', 0.18);
    this.tone(990, 0.25, 'square', 0.15);
  }
  boom(): void {
    this.burst(0.45, 0.9, 300);
    this.tone(120, 0.35, 'sawtooth', 0.2, 40);
  }
  shutter(): void {
    this.burst(0.05, 0.6, 5000);
    this.burst(0.07, 0.5, 2500);
  }
  warp(): void {
    this.tone(400, 0.18, 'sine', 0.18, 1600);
  }
  sleep(): void {
    this.tone(700, 0.4, 'triangle', 0.15, 250);
  }
  gacha(rarity: number): void {
    if (rarity >= 4) {
      // 大当たり：上がっていくファンファーレ
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.14), i * 90));
    } else if (rarity === 0) {
      this.tone(330, 0.5, 'triangle', 0.18, 110);
    } else {
      this.tone(700, 0.1, 'square', 0.1, 900);
    }
  }
  /** ガチャの演出：カプセルが落ちて弾む・揺れる・開く・金色に光る（確定演出）・カードがめくれる */
  gachaDrop(): void {
    this.tone(220, 0.12, 'sine', 0.2, 90);
  }
  gachaShake(power: number): void {
    this.tone(500 + power * 300, 0.05, 'square', 0.05 + power * 0.04);
  }
  gachaOpen(rarity: number): void {
    this.burst(0.35, rarity >= 5 ? 0.35 : 0.22, rarity >= 5 ? 2400 : 1600);
    this.tone(rarity >= 5 ? 660 : 520, 0.25, 'triangle', 0.14, rarity >= 5 ? 1320 : 1040);
  }
  gachaGold(): void {
    [880, 1109, 1319, 1760].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'sine', 0.12), i * 60));
  }
  gachaFlip(rarity: number): void {
    this.tone(rarity >= 5 ? 1320 : 990, 0.07, 'triangle', rarity >= 5 ? 0.14 : 0.08);
  }
  heal(): void {
    this.tone(880, 0.12, 'sine', 0.15, 1320);
    setTimeout(() => this.tone(1320, 0.18, 'sine', 0.12), 90);
  }
  poof(): void {
    this.burst(0.25, 0.5, 900);
  }
  buff(): void {
    this.tone(440, 0.25, 'square', 0.1, 880);
  }
  absorb(): void {
    this.tone(1200, 0.2, 'sine', 0.15, 300);
  }
  /** キャラごとの短いジングル（選んだとき・勝ったとき） */
  jingle(charId: string): void {
    const J: Record<string, [number[], OscillatorType, number]> = {
      guard: [[392, 523, 659, 784], 'square', 140],
      hacker: [[440, 660, 587, 880, 1175], 'sawtooth', 70],
      thief: [[659, 622, 659, 784, 988], 'triangle', 90],
      streamer: [[784, 988, 1175, 1568], 'triangle', 90],
      dopa: [[880, 1175, 880, 1319, 1568, 1760], 'square', 55],
      gacha: [[523, 659, 784, 1047, 1319], 'square', 80],
      courier: [[587, 740, 880, 1175], 'triangle', 75],
      ai: [[440, 554, 659, 880, 1109], 'sine', 95],
      trainer: [[392, 392, 523, 659, 784], 'square', 110],
      threeb: [[622, 740, 932, 831, 1245], 'sawtooth', 85],
    };
    const [notes, type, gap] = J[charId] ?? J.guard;
    notes.forEach((f, i) => setTimeout(() => this.tone(f, i === notes.length - 1 ? 0.35 : 0.12, type, 0.12), i * gap));
  }

  /** 撃墜確定：重い一撃と、高く鳴り響く音 */
  finish(): void {
    this.burst(0.5, 0.9, 220);
    this.tone(90, 0.5, 'sawtooth', 0.22, 40);
    this.tone(1760, 0.7, 'sine', 0.12, 1320);
  }
  swap(): void {
    this.tone(300, 0.15, 'sine', 0.16, 900);
    setTimeout(() => this.tone(900, 0.15, 'sine', 0.14, 300), 110);
  }
  notify(): void {
    // スマホの通知音っぽい「ポロン」を重ねる
    [0, 70, 140].forEach((d, i) => setTimeout(() => this.tone(1175 + i * 220, 0.12, 'sine', 0.13), d));
  }
  beep(high = false): void {
    this.tone(high ? 880 : 440, high ? 0.4 : 0.15, 'square', 0.15);
  }
  click(): void {
    this.tone(660, 0.05, 'triangle', 0.12);
  }
}

// ---------------------------------------------------------------------------
// BGM（Web Audio でその場で組み立てるオリジナル曲。音声ファイルは使わない）

export type TrackId = 'menu' | 'plain' | 'rooftop' | 'cyber' | 'vault' | 'studio' | 'timeline' | 'gacha' | 'arcade' | 'lab' | 'gym' | 'livebar';

interface Track {
  bpm: number;
  /** 主音（MIDIノート番号） */
  root: number;
  /** 4小節分のコード（主音からの半音数で表した和音） */
  chords: number[][];
  /** メロディに使う音階（主音からの半音数） */
  scale: number[];
  drums: 'soft' | 'drive' | 'half';
  seed: number;
  lead: OscillatorType;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

const TRACKS: Record<TrackId, Track> = {
  // メニュー：ゆったり（F長調 I-vi-IV-V）
  menu: { bpm: 100, root: 53, chords: [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]], scale: MAJOR, drums: 'soft', seed: 11, lead: 'triangle' },
  // そらの台地：明るく速い（C長調 I-V-vi-IV）
  plain: { bpm: 140, root: 48, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]], scale: MAJOR, drums: 'drive', seed: 23, lead: 'square' },
  // データセンター屋上：夜景の疾走感（A短調 i-VI-VII-v）
  rooftop: { bpm: 128, root: 45, chords: [[0, 3, 7], [8, 12, 15], [10, 14, 17], [7, 10, 14]], scale: MINOR, drums: 'drive', seed: 53, lead: 'sawtooth' },
  // 夜のライブバー：大人っぽいジャズ寄りのグルーヴ（E♭のドリアン i-IV-VII-iv）
  livebar: { bpm: 104, root: 51, chords: [[0, 3, 7, 10], [5, 9, 12], [10, 14, 17], [5, 8, 12]], scale: DORIAN, drums: 'half', seed: 113, lead: 'triangle' },
  // 24時間ジム：力強く熱い（F音のドリアン i-VII-VI-VII）
  gym: { bpm: 136, root: 41, chords: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]], scale: DORIAN, drums: 'drive', seed: 101, lead: 'sawtooth' },
  // ネオン商店街：ゆったりしたグルーヴ（C#短調 i-iv-VII-III）
  arcade: { bpm: 112, root: 49, chords: [[0, 3, 7], [5, 8, 12], [10, 14, 17], [3, 7, 10]], scale: MINOR, drums: 'half', seed: 61, lead: 'square' },
  // 電脳空間：速い電子音（D短調 i-VI-III-VII）
  cyber: { bpm: 142, root: 50, chords: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], scale: MINOR, drums: 'drive', seed: 71, lead: 'triangle' },
  // 深夜の金庫室：忍び足の緊張感（E短調 i-VI-i-V）
  vault: { bpm: 118, root: 52, chords: [[0, 3, 7], [8, 12, 15], [0, 3, 7], [7, 11, 14]], scale: MINOR, drums: 'half', seed: 83, lead: 'square' },
  // 配信スタジオ：明るくポップ（G長調 I-iii-IV-V）
  studio: { bpm: 132, root: 55, chords: [[0, 4, 7], [4, 7, 11], [5, 9, 12], [7, 11, 14]], scale: MAJOR, drums: 'drive', seed: 89, lead: 'square' },
  // スマホのタイムライン：せわしない（B短調 i-VII-VI-VII）
  timeline: { bpm: 150, root: 47, chords: [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]], scale: MINOR, drums: 'drive', seed: 97, lead: 'sawtooth' },
  // ガチャ会場：にぎやか（A長調 I-IV-V-IV）
  gacha: { bpm: 138, root: 45, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], scale: MAJOR, drums: 'drive', seed: 101, lead: 'square' },
  // AIラボ：静かで知的（Dドリア i-IV-i-IV）
  lab: { bpm: 116, root: 50, chords: [[0, 3, 7], [5, 9, 12], [0, 3, 7], [5, 9, 12]], scale: DORIAN, drums: 'half', seed: 107, lead: 'triangle' },
};

const midiHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private track: Track | null = null;
  private trackId: TrackId | null = null;
  private melody: (number | null)[] = [];
  private step = 0;
  private nextTime = 0;
  private _volume = 0.5;

  /** 効果音と同じ AudioContext を使う（最初のタップの後に呼ぶ） */
  attach(ctx: AudioContext | null): void {
    if (!ctx || this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this._volume * 0.35;
    this.out.connect(ctx.destination);
    const len = ctx.sampleRate * 0.3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.trackId) {
      const id = this.trackId;
      this.trackId = null;
      this.play(id);
    }
  }

  set volume(v: number) {
    this._volume = v;
    if (this.out) this.out.gain.value = v * 0.35;
  }

  /** ピンチ（残り30秒・最後の1機）：テンポを上げて音を足す */
  private pinch = false;
  setPinch(on: boolean): void {
    this.pinch = on;
  }

  play(id: TrackId): void {
    this.pinch = false;
    if (!TRACKS[id]) id = 'plain'; // 曲のないステージは標準の曲
    if (this.trackId === id) return;
    this.stop();
    this.trackId = id;
    if (!this.ctx) return; // まだ音を出せない（最初のタップ待ち）
    this.track = TRACKS[id];
    this.melody = makeMelody(this.track);
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.trackId = null;
    this.track = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    const tr = this.track;
    if (!ctx || !tr) return;
    const stepDur = 60 / (tr.bpm * (this.pinch ? 1.14 : 1)) / 4; // 16分音符（ピンチのときは速く）
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime, stepDur, tr);
      this.step = (this.step + 1) % 64;
      this.nextTime += stepDur;
    }
  }

  private playStep(step: number, t: number, dur: number, tr: Track): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = tr.chords[bar];
    // ベース：8分音符で主音と5度
    if (s % 2 === 0) {
      const n = tr.root - 12 + chord[0] + (s % 8 === 4 ? 7 : 0);
      this.note(n, t, dur * 1.8, 'triangle', 0.5);
    }
    // 伴奏：和音を分散して鳴らす
    if (tr.drums !== 'soft' || s % 2 === 0) {
      const n = tr.root + 12 + chord[s % 3] + (s % 6 >= 3 ? 12 : 0);
      this.note(n, t, dur * 0.9, 'square', 0.07);
    }
    // メロディ
    const m = this.melody[step];
    if (m !== null && m !== undefined) this.note(tr.root + 24 + m, t, dur * 1.7, tr.lead, tr.lead === 'sawtooth' ? 0.09 : 0.13);
    // ピンチ：細かいハイハットと、小節の頭に高い音を足して盛り上げる
    if (this.pinch) {
      this.hat(t, 0.07);
      if (s === 0) this.note(tr.root + 36 + chord[0], t, dur * 3, 'square', 0.05);
    }
    // ドラム
    if (tr.drums === 'soft') {
      if (s === 0 || s === 8) this.kick(t, 0.5);
      if (s % 4 === 2) this.hat(t, 0.08);
    } else if (tr.drums === 'half') {
      if (s === 0 || s === 10) this.kick(t, 0.7);
      if (s === 8) this.snare(t, 0.5);
      if (s % 2 === 0) this.hat(t, 0.1);
    } else {
      if (s % 4 === 0) this.kick(t, 0.8);
      if (s === 4 || s === 12) this.snare(t, 0.6);
      this.hat(t, s % 2 === 0 ? 0.12 : 0.06);
    }
  }

  private note(n: number, t: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(midiHz(n), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.2);
  }

  private noiseHit(t: number, vol: number, dur: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.14, 'bandpass', 1800);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, vol, 0.04, 'highpass', 7000);
  }
}

/** 各小節のコードの音を中心に、決まった手順でメロディを作る（2小節のリズムを繰り返す） */
function makeMelody(tr: Track): (number | null)[] {
  let s = tr.seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // 2小節分のリズム（拍の頭ほど音が入りやすい）
  const mask = Array.from({ length: 32 }, (_, i) => rnd() < (i % 4 === 0 ? 0.9 : i % 2 === 0 ? 0.45 : 0.15));
  const out: (number | null)[] = [];
  let deg = 0;
  for (let i = 0; i < 64; i++) {
    if (i === 60) {
      out.push(0); // 最後は主音で落ち着かせる
      continue;
    }
    if (!mask[i % 32] || i > 60) {
      out.push(null);
      continue;
    }
    const chord = tr.chords[Math.floor(i / 16)];
    if (i % 4 === 0) {
      // 拍の頭はコードの音
      const target = chord[Math.floor(rnd() * 3)] % 12;
      deg = tr.scale.reduce((best, v, idx) => (Math.abs(v - target) < Math.abs(tr.scale[best] - target) ? idx : best), 0);
    } else {
      // それ以外は音階を1つ上か下へ
      deg = Math.max(0, Math.min(tr.scale.length + 2, deg + (rnd() < 0.5 ? -1 : 1)));
    }
    out.push(tr.scale[deg % tr.scale.length] + (deg >= tr.scale.length ? 12 : 0));
  }
  return out;
}
