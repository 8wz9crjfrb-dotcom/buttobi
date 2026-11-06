// 効果音（Web Audio で合成。音声ファイルは使わない）
// ブラウザは操作前の音の再生を制限しているため、最初のタップで unlock() を呼ぶ。

export class Sfx {
  private ctx: AudioContext | null = null;
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
  beep(high = false): void {
    this.tone(high ? 880 : 440, high ? 0.4 : 0.15, 'square', 0.15);
  }
  click(): void {
    this.tone(660, 0.05, 'triangle', 0.12);
  }
}
