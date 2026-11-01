// DOM helpers. Everything is built with createElement/textContent, never by
// parsing HTML strings, so text from the card data can't become markup.

// h('a', { class: 'tile', href: '#/x', 'data-group': 'birds', onclick: fn }, child, ...)
// Children may be nodes, strings/numbers (added as text), arrays, or null/false (skipped).
// Props: class (string or array), style ({ prop: value } via CSSOM), on* (event
// listeners), true -> empty attribute, null/false/undefined -> left out.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

// The same for SVG elements (attributes only, no events).
const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Replace an element's contents.
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// Only http(s) links from the data are allowed into href attributes.
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Event delegation: on(root, 'click', '[data-act=x]', handler)
export function on(root, type, selector, handler) {
  const fn = e => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  };
  root.addEventListener(type, fn);
  return () => root.removeEventListener(type, fn);
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
