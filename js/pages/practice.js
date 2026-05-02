import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';
import { createRecognizer, ensureVoices } from '../speech.js';
import { normalize, wordMatches } from '../fuzzy.js';

export async function renderPractice({ id, section }) {
  const doc = await db.collection('items').doc(id).get();
  if (!doc.exists) { navigate('/'); return; }
  const item = { id: doc.id, ...doc.data() };

  let lines;
  if (section === 'all') {
    lines = item.sections.flatMap(s => s.lines);
  } else {
    lines = item.sections[parseInt(section)]?.lines || [];
  }

  const sectionName = section === 'all'
    ? `Full ${item.type === 'poem' ? 'poem' : 'song'}`
    : item.sections[parseInt(section)]?.name;

  setHeader({ title: `🎤 ${item.title}`, back: `/item/${id}` });
  await ensureVoices();

  // Flatten all words with their line index
  const allWords = lines.flatMap((line, li) =>
    line.split(/\s+/).filter(Boolean).map((w, wi) => ({ word: w, lineIndex: li, wordIndex: wi }))
  );

  let nextExpected = 0; // index into allWords
  let recognizer = null;
  let listening = false;

  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="practice-container">
      <div class="section-label">${sectionName}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="progress-bar"></div></div>
      <div class="blurred-text" id="blurred-text"></div>
      <div class="practice-controls">
        <button class="ctrl-btn hint-btn" id="btn-hint" title="Show next word">💡 Hint</button>
        <button class="ctrl-btn primary" id="btn-mic">🎤 Start</button>
      </div>
      <div class="transcript-box" id="transcript-box"></div>
      <div id="feedback-msg" class="feedback-msg"></div>
    </div>`;

  function buildBlurredText() {
    const container = document.getElementById('blurred-text');
    container.innerHTML = lines.map((line, li) => `
      <div class="practice-line" data-line="${li}">
        ${line.split(/\s+/).filter(Boolean).map((w, wi) => {
          const globalIdx = allWords.findIndex(a => a.lineIndex === li && a.wordIndex === wi);
          return `<span class="pword blurred" data-global="${globalIdx}">${w}</span>`;
        }).join(' ')}
      </div>`).join('');
  }

  function revealWord(globalIdx) {
    const el = document.querySelector(`.pword[data-global="${globalIdx}"]`);
    if (el) { el.classList.remove('blurred'); el.classList.add('revealed'); }
    document.getElementById('progress-bar').style.width =
      `${(nextExpected / allWords.length) * 100}%`;
  }

  function flashError(lineIndex) {
    // Reveal current line words (up to nextExpected), highlight the problematic line
    document.querySelectorAll(`.practice-line[data-line="${lineIndex}"]`).forEach(row => {
      row.classList.add('flash-error');
      setTimeout(() => row.classList.remove('flash-error'), 1200);
    });
    // Reveal words on this line that should have been said
    allWords.forEach((w, gi) => {
      if (w.lineIndex === lineIndex && gi < nextExpected) revealWord(gi);
    });
  }

  function showHint() {
    if (nextExpected >= allWords.length) return;
    revealWord(nextExpected);
    const el = document.querySelector(`.pword[data-global="${nextExpected}"]`);
    if (el) { el.classList.add('hint-glow'); setTimeout(() => el.classList.remove('hint-glow'), 1500); }
  }

  function stopListening() {
    listening = false;
    if (recognizer) { try { recognizer.stop(); } catch(_) {} recognizer = null; }
    const btn = document.getElementById('btn-mic');
    if (btn) { btn.textContent = '🎤 Start'; btn.classList.remove('recording'); }
  }

  function processSpoken(text) {
    if (!text.trim()) return;
    document.getElementById('transcript-box').textContent = text;

    const spokenWords = normalize(text).split(/\s+/).filter(Boolean);
    let si = 0;

    for (si = 0; si < spokenWords.length && nextExpected < allWords.length; si++) {
      const expected = allWords[nextExpected];
      if (wordMatches(spokenWords[si], expected.word)) {
        revealWord(nextExpected);
        nextExpected++;
      } else {
        // Wrong word — show the line that's failing
        flashError(expected.lineIndex);
        showFeedback(`Hmm — check line ${expected.lineIndex + 1}`, 'warn');
        break;
      }
    }

    if (nextExpected >= allWords.length) {
      stopListening();
      showComplete();
    }
  }

  function startListening() {
    if (listening) { stopListening(); return; }
    recognizer = createRecognizer({
      continuous: true,
      onResult({ final, interim }) {
        if (final) processSpoken(final);
        else document.getElementById('transcript-box').textContent = interim;
      },
      onEnd() { stopListening(); }
    });
    if (!recognizer) { showFeedback('Speech recognition not supported in this browser', 'warn'); return; }
    listening = true;
    recognizer.start();
    const btn = document.getElementById('btn-mic');
    btn.textContent = '⏹ Stop'; btn.classList.add('recording');
  }

  function showFeedback(msg, type = 'info') {
    const el = document.getElementById('feedback-msg');
    el.textContent = msg;
    el.className = `feedback-msg feedback-${type}`;
    setTimeout(() => { if (el) el.textContent = ''; }, 3000);
  }

  function showComplete() {
    stopListening();
    page.innerHTML = `
      <div class="complete-screen">
        <div class="complete-star">🌟</div>
        <h2>Perfect!</h2>
        <p>You recited <strong>${sectionName}</strong> from memory!</p>
        <button class="btn-primary" id="btn-again">Try again</button>
        <button class="btn-secondary" id="btn-home">Back to songs</button>
      </div>`;
    document.getElementById('btn-again').addEventListener('click', () => renderPractice({ id, section }));
    document.getElementById('btn-home').addEventListener('click', () => navigate(`/item/${id}`));
  }

  buildBlurredText();

  document.getElementById('btn-mic').addEventListener('click', startListening);
  document.getElementById('btn-hint').addEventListener('click', showHint);
}
