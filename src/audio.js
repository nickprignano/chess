// Our own short move sounds, synthesized with the Web Audio API (no sound files).

const MUTE_KEY = 'chess-muted';

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sounds {
  constructor() {
    this.muted = loadMuted();
    this.ctx = null;
  }

  // Browsers only allow sound after a tap or key press; iOS also suspends it in the background.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AudioContext) this.ctx = new AudioContext();
  }

  setMuted(muted) {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Storage blocked: the setting just isn't remembered.
    }
  }

  tone(freq, ms, { type = 'triangle', volume = 0.18, slideTo = null, delay = 0 } = {}) {
    const { ctx } = this;
    const start = ctx.currentTime + delay / 1000;
    const end = start + ms / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, end);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end);
  }

  // A soft wooden tap for a move, a lower knock for a capture, two rising notes for check,
  // and a short chord when the game ends.
  play(name) {
    if (this.muted || !this.ctx) return;
    switch (name) {
      case 'move':
        this.tone(420, 70, { slideTo: 300 });
        break;
      case 'capture':
        this.tone(260, 110, { type: 'square', volume: 0.1, slideTo: 140 });
        break;
      case 'check':
        this.tone(660, 90);
        this.tone(880, 120, { delay: 90 });
        break;
      case 'end':
        for (const [i, f] of [523.25, 659.25, 783.99].entries()) this.tone(f, 500, { type: 'sine', volume: 0.12, delay: i * 60 });
        break;
    }
  }
}
