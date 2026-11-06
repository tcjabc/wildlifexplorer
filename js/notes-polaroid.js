// Polaroids waiting on the desk (js/notebook.js). A picture chosen from the pile slides off it and
// develops, fading in from blank; a finger then carries it onto the page. Nothing is kept until it
// lands there, so a picture left on the desk leaves no file behind.
import { h, reducedMotion } from './dom.js';

const SLIDE_MS = 260;
const DEVELOP_MS = 2000;
const PICKED_UP = 'rotate(-3deg) scale(1.06)';
const OFFSET = 14; // each further picture lies a little to the side of the last

//   host: the notebook's element. pile: the pile's button. onDrop(shot, x, y): where one was let go,
//   in screen px; resolves true if it went on the page.
export function polaroids({ host, pile, label, onDrop }) {
  const waiting = new Set();

  // On the desk just off the tray, level with the pile, on the page's side.
  function restFor(card, n) {
    const e = host.getBoundingClientRect(), p = pile.getBoundingClientRect(), tray = pile.parentElement.getBoundingClientRect(), w = card.offsetWidth, hgt = card.offsetHeight;
    const land = host.dataset.orient === 'landscape';
    const left = land ? tray.left - e.left - w : p.left - e.left + (p.width - w) / 2;
    const top = land ? p.top - e.top + (p.height - hgt) / 2 : tray.bottom - e.top;
    const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
    return { left: clamp(left - n * OFFSET, e.width - w), top: clamp(top + n * OFFSET, e.height - hgt) };
  }

  function add(shot, bmp) {
    const pic = h('canvas', { class: 'nb-polaroid__pic', width: Math.min(shot.w, 320), height: Math.round(Math.min(shot.w, 320) * shot.h / shot.w) });
    pic.getContext('2d').drawImage(bmp, 0, 0, pic.width, pic.height);
    const blank = h('span', { class: 'nb-polaroid__blank' });
    const card = h('div', { class: 'nb-polaroid', role: 'img', 'aria-label': label }, h('span', { class: 'nb-polaroid__window' }, pic, blank));
    host.append(card);
    const rest = restFor(card, waiting.size);
    card.style.setProperty('left', `${rest.left}px`);
    card.style.setProperty('top', `${rest.top}px`);
    waiting.add(card);
    if (reducedMotion()) blank.remove();
    else {
      const e = host.getBoundingClientRect(), p = pile.getBoundingClientRect();
      const from = `translate(${p.left - e.left + (p.width - card.offsetWidth) / 2 - rest.left}px, ${p.top - e.top + (p.height - card.offsetHeight) / 2 - rest.top}px) scale(0.6)`;
      card.animate([{ transform: from }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'ease-out' });
      blank.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DEVELOP_MS, easing: 'ease-in', fill: 'forwards' }).onfinish = () => blank.remove();
    }

    let held = null;
    card.addEventListener('pointerdown', e => {
      if (held) return;
      e.preventDefault();
      held = { id: e.pointerId, x: e.clientX, y: e.clientY };
      card.setPointerCapture(e.pointerId);
      card.dataset.held = '';
      card.style.setProperty('transform', PICKED_UP);
    });
    card.addEventListener('pointermove', e => {
      if (held?.id !== e.pointerId) return;
      card.style.setProperty('transform', `translate(${e.clientX - held.x}px, ${e.clientY - held.y}px) ${PICKED_UP}`);
    });
    const letGo = async e => {
      if (held?.id !== e.pointerId) return;
      held = null;
      const on = e.type === 'pointerup' && await onDrop(shot, e.clientX, e.clientY);
      delete card.dataset.held;
      if (on) { waiting.delete(card); card.remove(); return; }
      const was = card.style.getPropertyValue('transform');
      card.style.removeProperty('transform');
      if (!reducedMotion()) card.animate([{ transform: was }, { transform: 'none' }], { duration: SLIDE_MS, easing: 'ease-out' });
    };
    card.addEventListener('pointerup', letGo);
    card.addEventListener('pointercancel', letGo);
  }

  return { add, clear() { for (const c of waiting) c.remove(); waiting.clear(); } };
}
