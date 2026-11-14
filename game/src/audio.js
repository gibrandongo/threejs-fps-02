// BREACHLINE — sound: every effect is synthesised with WebAudio.
// No audio files ship with the game. A shared noise buffer and a few
// oscillator envelopes cover gunfire, impacts, footsteps, the bomb
// beeper and round stingers. Audio starts on the first user gesture.
let ctx = null;
let master = null;
let noiseBuf = null;

export function ensureAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return false;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return true;
}

export function setMuted(muted) {
  if (master) master.gain.value = muted ? 0 : 0.5;
}

function noiseBurst(dur, filterFreq, filterType, gain, when) {
  if (!ctx || !Number.isFinite(gain) || gain <= 0) return;
  const t = when || ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur + 0.05);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, gain, type, slideTo, when) {
  if (!ctx || !Number.isFinite(gain) || gain <= 0 || !Number.isFinite(freq)) return;
  const t = when || ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Volume by distance: 1 at the ear, fading to 0 at maxDist.
function volFor(dist, maxDist) {
  if (!Number.isFinite(dist)) return 0;
  if (dist <= 1) return 1;
  const v = 1 - dist / maxDist;
  return v <= 0 ? 0 : v * v;
}

export const sfx = {
  shot(dist, heavy) {
    const v = volFor(dist, 55);
    if (v <= 0) return;
    noiseBurst(heavy ? 0.28 : 0.16, heavy ? 900 : 1600, 'lowpass', 0.7 * v);
    tone(heavy ? 90 : 140, 0.12, 0.35 * v, 'triangle', 45);
  },
  dryFire() {
    tone(2200, 0.03, 0.12, 'square');
  },
  reload() {
    tone(900, 0.05, 0.15, 'square');
    setTimeout(() => tone(620, 0.05, 0.15, 'square'), 260);
  },
  hit(headshot) {
    tone(headshot ? 1900 : 1400, 0.06, 0.22, 'sine');
  },
  hurt() {
    tone(160, 0.15, 0.3, 'sawtooth', 70);
  },
  step(dist) {
    const v = volFor(dist, 16);
    if (v <= 0) return;
    noiseBurst(0.06, 500, 'lowpass', 0.12 * v);
  },
  explosion(dist) {
    const v = volFor(dist, 90);
    if (v <= 0) return;
    noiseBurst(1.4, 300, 'lowpass', 1.0 * v);
    tone(55, 1.1, 0.7 * v, 'sine', 28);
  },
  beep(fast) {
    tone(fast ? 1400 : 1050, 0.09, 0.25, 'square');
  },
  plant() {
    tone(520, 0.12, 0.25, 'square');
    setTimeout(() => tone(780, 0.14, 0.25, 'square'), 140);
  },
  defuse() {
    tone(780, 0.12, 0.25, 'square');
    setTimeout(() => tone(1040, 0.16, 0.25, 'square'), 140);
  },
  grenade(dist) {
    const v = volFor(dist, 40);
    if (v <= 0) return;
    noiseBurst(0.1, 2400, 'highpass', 0.2 * v);
  },
  roundWin() {
    tone(392, 0.14, 0.25, 'triangle');
    setTimeout(() => tone(523, 0.14, 0.25, 'triangle'), 140);
    setTimeout(() => tone(659, 0.22, 0.28, 'triangle'), 280);
  },
  roundLose() {
    tone(330, 0.16, 0.22, 'triangle');
    setTimeout(() => tone(262, 0.24, 0.22, 'triangle'), 160);
  },
  buy() {
    tone(880, 0.07, 0.18, 'sine');
    setTimeout(() => tone(1320, 0.09, 0.18, 'sine'), 70);
  },
  denied() {
    tone(180, 0.12, 0.2, 'square');
  },
  click() {
    tone(1200, 0.03, 0.1, 'sine');
  },
};
