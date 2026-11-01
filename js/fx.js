// Little celebrations: confetti and two short tones (no audio files needed).
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

export const chimeGood = () => tone([660, 880, 1175]);
export const chimeSoft = () => tone([392, 330], 0.16);
export const chimeReveal = () => tone([523, 659, 784, 1047], 0.1);
