// Registers the service worker and asks it to keep every card image cached.
import { mount } from './dom.js';
import { tx } from './i18n.js';
import { state, thumbOf } from './store.js';

let status = 'working'; // 'working' | 'ready' | 'unsupported'
const listeners = new Set();

export const offlineStatus = () =>
  status === 'ready' ? tx('more.offlineReady') : status === 'working' ? tx('more.offlineWorking') : '';
export const onOfflineStatus = fn => listeners.add(fn);

function setStatus(s) {
  status = s;
  listeners.forEach(fn => fn(s));
  const el = document.querySelector('[data-offline]');
  if (el) mount(el, offlineStatus());
}

function imageUrls() {
  return state.cards.flatMap(c => ['photo', 'illustration']
    .map(k => c[k]?.file).filter(Boolean)
    .flatMap(f => [f, thumbOf(f)]));
}

export async function registerOffline() {
  if (!('serviceWorker' in navigator)) { setStatus('unsupported'); return; }
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'images-cached') setStatus('ready');
  });
  try {
    await navigator.serviceWorker.register('sw.js');
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'cache-images', urls: imageUrls() });
  } catch {
    setStatus('unsupported');
  }
}
