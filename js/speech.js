let _micWarmed = false;
export async function warmMic() {
  if (_micWarmed) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release immediately — just needed to trigger the permission grant.
    // Holding the stream open blocks SpeechRecognition on iOS.
    stream.getTracks().forEach(t => t.stop());
    _micWarmed = true;
  } catch (e) {
    console.warn('Mic permission denied:', e);
  }
}

export function createRecognizer({ onResult, onEnd, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.continuous = continuous;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    const results = Array.from(e.results);
    // Join ALL finalized segments — callers use this growing string to advance from their own cursor
    const final = results.filter(r => r.isFinal).map(r => r[0].transcript).join(' ');
    const interim = results.filter(r => !r.isFinal).map(r => r[0].transcript).join(' ');
    onResult({ final, interim });
  };

  rec.onend = () => onEnd && onEnd();
  rec.onerror = (e) => {
    if (e.error !== 'no-speech') console.warn('[speech] error:', e.error);
    onEnd && onEnd();
  };

  return rec;
}

export function speak(text, { rate = 0.85, onEnd } = {}) {
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ru-RU';
  utt.rate = rate;
  const voices = window.speechSynthesis.getVoices();
  const ruVoice = voices.find(v => v.lang.startsWith('ru'));
  if (ruVoice) utt.voice = ruVoice;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

export function ensureVoices() {
  return new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) { resolve(voices); return; }
    window.speechSynthesis.onvoiceschanged = () => resolve(window.speechSynthesis.getVoices());
  });
}
