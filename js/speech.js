let _micStream = null;
export async function warmMic() {
  if (_micStream) return;
  try {
    _micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

  let lastFinalIndex = 0;

  rec.onresult = (e) => {
    // Process each NEW final result exactly once
    for (let i = lastFinalIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        const transcript = e.results[i][0].transcript;
        console.log('[speech] final:', JSON.stringify(transcript));
        onResult({ final: transcript, interim: '' });
        lastFinalIndex = i + 1;
      }
    }
    // Show latest interim
    const last = e.results[e.results.length - 1];
    if (!last.isFinal) {
      onResult({ final: '', interim: last[0].transcript });
    }
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
