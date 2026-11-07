// An animal's call: tap its picture to hear it. Cards have none yet, so this does nothing until one
// has a "call" ({ file, author, license, licenseUrl, sourceUrl }; see hasCall in js/headings.js).
import { stop as stopSpeech } from './speech.js';
import { hasCall } from './headings.js';

let playing = null;

export function stopCall() {
  playing?.pause();
  playing = null;
}

export function playCall(card) {
  if (!hasCall(card)) return;
  stopCall();
  stopSpeech();
  playing = new Audio(card.call.file);
  playing.play().catch(() => { playing = null; }); // blocked or gone: the tap just does nothing
}
