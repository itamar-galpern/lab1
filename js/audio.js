// Space Chess sound effects, synthesized with WebAudio (no files to load).
// The audio context starts on the first user gesture, as browsers require.

let ctx = null, master = null, noiseBuf = null;
let enabled = true;
try { enabled = localStorage.getItem('spacechess.sound') !== 'off'; } catch {}

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export const isEnabled = () => enabled;
export function setEnabled(on) {
  enabled = on;
  try { localStorage.setItem('spacechess.sound', on ? 'on' : 'off'); } catch {}
}
export function unlock() { if (enabled) ac(); }

// One oscillator note with an attack/decay envelope and an optional pitch glide.
function tone(freq, { type = 'square', dur = 0.12, vol = 0.5, at = 0, to = null, attack = 0.005 } = {}) {
  const c = ac();
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.5, at = 0, from = 4000, to = 200, q = 0.8 } = {}) {
  const c = ac();
  const t = c.currentTime + at;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf;
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const SOUNDS = {
  nav: () => tone(660, { dur: 0.05, vol: 0.18 }),
  select: () => { tone(520, { dur: 0.06, vol: 0.22 }); tone(880, { dur: 0.08, vol: 0.22, at: 0.05 }); },
  back: () => { tone(600, { dur: 0.06, vol: 0.2 }); tone(380, { dur: 0.08, vol: 0.2, at: 0.05 }); },
  pick: () => tone(740, { type: 'triangle', dur: 0.09, vol: 0.35, to: 990 }),
  move: () => { noise({ dur: 0.22, vol: 0.25, from: 1800, to: 300 }); tone(180, { type: 'sine', dur: 0.16, vol: 0.4, to: 110 }); },
  jump: () => { noise({ dur: 0.45, vol: 0.3, from: 600, to: 3000, q: 2 }); tone(140, { type: 'sawtooth', dur: 0.35, vol: 0.12, to: 320 }); },
  boom: () => { noise({ dur: 0.7, vol: 0.7, from: 3000, to: 60 }); tone(90, { type: 'sine', dur: 0.5, vol: 0.6, to: 35 }); },
  warp: () => {
    tone(200, { type: 'sine', dur: 0.4, vol: 0.4, to: 1400 });
    tone(1400, { type: 'sine', dur: 0.45, vol: 0.3, to: 220, at: 0.42 });
    tone(300, { type: 'triangle', dur: 0.8, vol: 0.12, to: 900 });
  },
  wrap: () => { noise({ dur: 0.3, vol: 0.3, from: 5000, to: 800, q: 4 }); tone(900, { type: 'sine', dur: 0.2, vol: 0.2, to: 450 }); },
  check: () => { tone(880, { dur: 0.12, vol: 0.3 }); tone(880, { dur: 0.12, vol: 0.3, at: 0.18 }); },
  promote: () => [523, 659, 784, 1047].forEach((f, k) => tone(f, { type: 'triangle', dur: 0.14, vol: 0.3, at: k * 0.07 })),
  win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, k) => tone(f, { dur: 0.16, vol: 0.28, at: k * 0.11 })),
  lose: () => [440, 392, 349, 262].forEach((f, k) => tone(f, { type: 'triangle', dur: 0.26, vol: 0.3, at: k * 0.2 })),
  draw: () => [523, 523, 392].forEach((f, k) => tone(f, { type: 'triangle', dur: 0.2, vol: 0.28, at: k * 0.16 })),
  tick: () => tone(1500, { type: 'square', dur: 0.03, vol: 0.18 }),
  alarm: () => [0, 0.25, 0.5].forEach(at => { tone(950, { dur: 0.18, vol: 0.32, at }); tone(700, { dur: 0.18, vol: 0.32, at: at + 0.1 }); }),
  event: () => { tone(440, { type: 'sawtooth', dur: 0.5, vol: 0.14, to: 880 }); tone(880, { type: 'sawtooth', dur: 0.5, vol: 0.14, to: 440, at: 0.5 }); },
  drift: () => { tone(55, { type: 'sine', dur: 1.6, vol: 0.55, to: 38, attack: 0.3 }); noise({ dur: 1.5, vol: 0.18, from: 400, to: 80 }); },
  meteor: () => { tone(1800, { type: 'sine', dur: 0.7, vol: 0.18, to: 300 }); noise({ dur: 0.7, vol: 0.15, from: 6000, to: 900, q: 3 }); },
  portal: () => { tone(330, { type: 'sine', dur: 0.9, vol: 0.25, to: 990 }); tone(495, { type: 'triangle', dur: 0.9, vol: 0.12, to: 1480, at: 0.1 }); },
  clear: () => noise({ dur: 0.5, vol: 0.25, from: 2000, to: 200 }),
  hint: () => [784, 988, 1175].forEach((f, k) => tone(f, { type: 'sine', dur: 0.18, vol: 0.25, at: k * 0.08 })),
  trophy: () => [659, 784, 988, 1319, 988, 1319].forEach((f, k) => tone(f, { type: 'square', dur: 0.12, vol: 0.2, at: k * 0.09 })),
};

export function play(name) {
  if (!enabled || !SOUNDS[name]) return;
  if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // no gesture yet
  try { if (ac()) SOUNDS[name](); } catch {}
}
