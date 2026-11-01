// Read-aloud with the Web Speech API. English uses an en-GB voice, Chinese a
// zh-TW voice. In "both" mode the English is read first, then the Chinese.

const synth = window.speechSynthesis;
export const speechSupported = Boolean(synth && window.SpeechSynthesisUtterance);

let voices = [];
const loadVoices = () => { voices = synth?.getVoices() ?? []; };
if (speechSupported) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
}

const norm = l => l.replace('_', '-').toLowerCase();
function voiceFor(lang) {
  const want = norm(lang);
  const exact = voices.find(v => norm(v.lang) === want);
  if (exact) return exact;
  if (want.startsWith('zh')) {
    return voices.find(v => /^zh-(tw|hant)/.test(norm(v.lang))) ?? voices.find(v => norm(v.lang).startsWith('zh'));
  }
  return voices.find(v => norm(v.lang).startsWith(want.split('-')[0]));
}

let current = null; // { onend }

export function stop() {
  if (!speechSupported) return;
  const c = current;
  current = null;
  synth.cancel();
  c?.onend?.();
}

export const isSpeaking = () => current !== null;

// pairs: [{ en, zh }, ...]; mode: 'en' | 'zh' | 'both'
export function speak(pairs, { mode = 'both', rate = 0.9, onend } = {}) {
  if (!speechSupported) return;
  stop();
  const en = pairs.map(p => p.en).filter(Boolean);
  const zh = pairs.map(p => p.zh).filter(Boolean);
  const queue = [];
  if (mode !== 'zh' || !zh.length) en.forEach(text => queue.push([text, 'en-GB']));
  if (mode !== 'en' || !en.length) zh.forEach(text => queue.push([text, 'zh-TW']));
  if (!queue.length) return;

  const job = { onend };
  current = job;
  // Safari can drop an utterance queued in the same tick as cancel().
  setTimeout(() => {
    if (current !== job) return;
    queue.forEach(([text, lang], i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      const v = voiceFor(lang);
      if (v) u.voice = v;
      u.rate = rate;
      if (i === queue.length - 1) {
        u.onend = u.onerror = () => {
          if (current === job) { current = null; onend?.(); }
        };
      }
      synth.speak(u);
    });
  }, 60);
}
