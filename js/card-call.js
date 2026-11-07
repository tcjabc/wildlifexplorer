// Recordings on a card: an animal's call, played by tapping its picture, and a heading's narration.
// Cards have neither yet, so this does nothing until one has a "call"
// ({ file, author, license, licenseUrl, sourceUrl }) or a "narration" (js/headings.js).
import { stop as stopSpeech } from './speech.js';
import { hasCall, narrationFiles } from './headings.js';

let playing = null;

export function stopCall() {
  playing?.pause();
  playing = null;
}

// One file after the other.
function play([file, ...rest]) {
  stopCall();
  stopSpeech();
  const audio = new Audio(file);
  playing = audio;
  audio.addEventListener('ended', () => { if (playing === audio) { playing = null; if (rest.length) play(rest); } });
  audio.play().catch(() => { if (playing === audio) playing = null; }); // blocked or gone: the tap just does nothing
}

export function playCall(card) {
  if (hasCall(card)) play([card.call.file]);
}

export function playNarration(card, heading, mode) {
  const files = narrationFiles(card, heading, mode);
  if (files.length) play(files);
}
