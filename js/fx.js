// Little celebrations: confetti, a few short tones and a stamp's thunk (no audio files needed).
import { reducedMotion } from './dom.js';

const CONFETTI_COLOURS = ['--c-accent', '--g-mammals', '--g-birds', '--g-reptiles', '--g-microscopic', '--g-behavior', '--g-invertebrates'];

export function confetti(container, count = 48) {
  if (reducedMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 30}vw`);
    p.style.setProperty('--d', `${0.9 + Math.random() * 1.4}s`);
    p.style.setProperty('--delay', `${Math.random() * 0.35}s`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    p.style.background = `var(${CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]})`;
    layer.append(p);
  }
  container.append(layer);
  setTimeout(() => layer.remove(), 3200);
}

let ctx;
function tone(freqs, dur = 0.12) {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t0 = ctx.currentTime + i * dur;
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 1.6);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + dur * 1.8);
    });
  } catch { /* sound is optional */ }
}

// A rubber stamp landing: a low knock falling away fast, with a tick of paper on top.
export function thunk() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.07);
    g.gain.setValueAtTime(0.45, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.11);
    const noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.02), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const n = ctx.createBufferSource(), ng = ctx.createGain();
    n.buffer = noise;
    ng.gain.value = 0.12;
    n.connect(ng).connect(ctx.destination);
    n.start(t0);
  } catch { /* sound is optional */ }
}

export const chimeGood = () => tone([660, 880, 1175]);
export const chimeSoft = () => tone([392, 330], 0.16);
export const chimeReveal = () => tone([523, 659, 784, 1047], 0.1);
