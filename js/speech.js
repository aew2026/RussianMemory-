// Request mic permission once and hold the stream so the browser doesn't re-prompt
let _micStream = null;
export async function warmMic() {
  if (_micStream) return;
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.warn('Mic permission denied:', e);
  }
}

// Speech recognition wrapper (Web Speech API, ru-RU)
export function createRecognizer({ onResult, onEnd, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.continuous = continuous;
  rec.maxAlternatives = 3;

  rec.onresult = (e) => {
    // Only look at the result that just changed — e.resultIndex tells us which one
    const result = e.results[e.resultIndex];
    const transcript = result[0].transcript;
    if (result.isFinal) {
      onResult({ final: transcript, interim: '' });
    } else {
      onResult({ final: '', interim: transcript });
    }
  };

  rec.onend = () => onEnd && onEnd();
  rec.onerror = (e) => {
    if (e.error !== 'no-speech') console.warn('Speech error:', e.error);
    onEnd && onEnd();
  };

  return rec;
}

// Text-to-speech helper
export function speak(text, { rate = 0.85, onEnd } = {}) {
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ru-RU';
  utt.rate = rate;

  // Prefer a Russian voice if available
  const voices = window.speechSynthesis.getVoices();
  const ruVoice = voices.find(v => v.lang.startsWith('ru'));
  if (ruVoice) utt.voice = ruVoice;

  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

// Voices may load async — retry once voices are ready
export function ensureVoices() {
  return new Promise(resolve => {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) { resolve(voices); return; }
    window.speechSynthesis.onvoiceschanged = () => resolve(window.speechSynthesis.getVoices());
  });
}
