/**
 * Continuous Web Audio API Strict Alarm Synthesizer.
 * Operates 100% offline with zero external audio asset dependencies.
 */

class StrictAlarmAudioEngine {
  private ctx: AudioContext | null = null;
  private intervalId: number | null = null;
  private isPlaying = false;
  private volume = 0.85;

  public start(volume = 0.85): void {
    this.volume = Math.max(0.1, Math.min(1, volume));
    if (this.isPlaying) return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      this.ctx = new AudioCtx();
      this.isPlaying = true;
      this.triggerPulseSequence();
      this.intervalId = window.setInterval(() => {
        if (this.isPlaying) {
          this.triggerPulseSequence();
        }
      }, 1550);
    } catch {
      this.isPlaying = false;
    }
  }

  private triggerPulseSequence(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const freqs = [880, 1174.66, 880]; // Sharp high-attention A5 -> D6 -> A5 pattern

    freqs.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + idx * 0.24);

      const startAt = now + idx * 0.24;
      const peakGain = this.volume * 0.22;
      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.2);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.21);
    });

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([260, 120, 260]);
    }
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}

export const alarmAudioEngine = new StrictAlarmAudioEngine();
