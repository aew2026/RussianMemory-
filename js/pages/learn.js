import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';
import { createRecognizer, speak, ensureVoices } from '../speech.js';
import { scoreMatch, alignWords } from '../fuzzy.js';
import { getProgress, saveProgress } from '../progress.js';

const REQUIRED_SUCCESSES = 2;

export async function renderLearn({ id, section }) {
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

  setHeader({ title: `📖 ${item.title}`, back: `/item/${id}` });
  await ensureVoices();

  const saved = await getProgress(id, section);
  const savedLine = saved?.learnValue ?? 0;

  // Show resume prompt if there's meaningful saved progress
  if (savedLine > 0 && savedLine < lines.length) {
    await showResumePrompt(id, section, item, lines, sectionName, savedLine);
    return;
  }

  startLearn({ id, section, lines, sectionName, startLine: 0, track: true });
}

function showResumePrompt(id, section, item, lines, sectionName, savedLine) {
  return new Promise(resolve => {
    const page = document.getElementById('page');
    page.innerHTML = `
      <div class="resume-screen">
        <div class="resume-icon">📖</div>
        <h2>Welcome back!</h2>
        <p>Last time you reached <strong>line ${savedLine} of ${lines.length}</strong> in <em>${sectionName}</em>.</p>
        <div class="resume-progress-wrap">
          <div class="resume-progress-bar" style="width:${(savedLine/lines.length)*100}%"></div>
        </div>
        <div class="resume-actions">
          <button class="btn-primary" id="btn-continue">▶ Continue from line ${savedLine}</button>
          <button class="btn-secondary" id="btn-restart">↺ Start from beginning</button>
        </div>
        <label class="no-track-label">
          <input type="checkbox" id="no-track" />
          Don't save progress this session
        </label>
      </div>`;

    document.getElementById('btn-continue').addEventListener('click', () => {
      const track = !document.getElementById('no-track').checked;
      resolve();
      startLearn({ id, section, lines, sectionName, startLine: savedLine, track });
    });
    document.getElementById('btn-restart').addEventListener('click', () => {
      const track = !document.getElementById('no-track').checked;
      resolve();
      startLearn({ id, section, lines, sectionName, startLine: 0, track });
    });
  });
}

function startLearn({ id, section, lines, sectionName, startLine, track }) {
  let lineIndex = startLine;
  let successes = 0;
  let recognizer = null;
  let listening = false;

  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="learn-container">
      <div class="section-label">${sectionName}${!track ? ' · <span class="no-track-badge">not tracking</span>' : ''}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="progress-bar"></div></div>
      <div class="line-display" id="line-display"></div>
      <div class="word-row" id="word-row"></div>
      <div class="success-dots" id="success-dots"></div>
      <div class="transcript-box" id="transcript-box"></div>
      <div class="learn-controls">
        <button class="ctrl-btn" id="btn-listen" title="Listen to line">🔊</button>
        <button class="ctrl-btn primary" id="btn-mic" title="Start speaking">🎤 Speak</button>
        <button class="ctrl-btn" id="btn-skip" title="Skip line">⏭</button>
      </div>
      <div id="feedback-msg" class="feedback-msg"></div>
    </div>`;

  function renderLine() {
    const line = lines[lineIndex];
    const words = line.split(/\s+/);
    document.getElementById('progress-bar').style.width = `${(lineIndex / lines.length) * 100}%`;
    document.getElementById('line-display').textContent = line;
    document.getElementById('word-row').innerHTML = words
      .map((w, i) => `<span class="word" data-index="${i}">${w}</span>`).join(' ');
    document.getElementById('success-dots').innerHTML = Array.from({ length: REQUIRED_SUCCESSES })
      .map((_, i) => `<span class="dot ${i < successes ? 'filled' : ''}"></span>`).join('');
    document.getElementById('transcript-box').textContent = '';
    document.getElementById('feedback-msg').textContent = '';
    stopListening();
  }

  function updateWordHighlights(spokenText) {
    const matched = alignWords(spokenText, lines[lineIndex].split(/\s+/));
    document.querySelectorAll('#word-row .word').forEach((el, i) => {
      el.classList.toggle('green', matched[i] === true);
    });
  }

  function stopListening() {
    listening = false;
    if (recognizer) { try { recognizer.stop(); } catch(_) {} recognizer = null; }
    const btn = document.getElementById('btn-mic');
    if (btn) { btn.textContent = '🎤 Speak'; btn.classList.remove('recording'); }
  }

  function startListening() {
    if (listening) { stopListening(); return; }
    let accepted = false; // prevent double-firing from interim + final
    recognizer = createRecognizer({
      onResult({ final, interim }) {
        const text = final || interim;
        document.getElementById('transcript-box').textContent = text;
        updateWordHighlights(text);

        if (accepted) return;

        // Only score text that contains Cyrillic — interim can be English phonetics
        const checkText = final || interim;
        const hasCyrillic = /[\u0400-\u04FF]/.test(checkText);
        if (!hasCyrillic && !final) return;
        const score = scoreMatch(checkText, lines[lineIndex]);
        if (score >= 0.6) {
          accepted = true;
          successes++;
          document.getElementById('success-dots').innerHTML = Array.from({ length: REQUIRED_SUCCESSES })
            .map((_, i) => `<span class="dot ${i < successes ? 'filled' : ''}"></span>`).join('');
          stopListening();
          if (successes >= REQUIRED_SUCCESSES) {
            showFeedback('✅ Great!', 'success');
            setTimeout(async () => {
              accepted = false;
              lineIndex++;
              successes = 0;
              if (track) await saveProgress(id, section, 'learn', lineIndex, lines.length);
              if (lineIndex >= lines.length) {
                showComplete();
              } else {
                renderLine();
              }
            }, 700);
          } else {
            showFeedback(`👍 Once more! (${successes}/${REQUIRED_SUCCESSES})`, 'info');
            setTimeout(() => { accepted = false; }, 300);
          }
        } else if (final) {
          stopListening();
          showFeedback(`Try again — got ${Math.round(score * 100)}% match`, 'warn');
          speak(lines[lineIndex]);
        }
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
  }

  function showComplete() {
    stopListening();
    page.innerHTML = `
      <div class="complete-screen">
        <div class="complete-star">⭐</div>
        <h2>Section complete!</h2>
        <p>You've finished <strong>${sectionName}</strong></p>
        <button class="btn-primary" id="btn-again">Do it again</button>
        <button class="btn-secondary" id="btn-home">Back to songs</button>
      </div>`;
    document.getElementById('btn-again').addEventListener('click', () => renderLearn({ id, section }));
    document.getElementById('btn-home').addEventListener('click', () => navigate(`/item/${id}`));
  }

  renderLine();
  document.getElementById('btn-listen').addEventListener('click', () => speak(lines[lineIndex]));
  document.getElementById('btn-mic').addEventListener('click', startListening);
  document.getElementById('btn-skip').addEventListener('click', () => {
    stopListening(); successes = 0;
    lineIndex = Math.min(lineIndex + 1, lines.length - 1);
    renderLine();
  });
}
