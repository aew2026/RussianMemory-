import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';
import { createRecognizer, ensureVoices, warmMic } from '../speech.js';
import { normalize, wordMatches } from '../fuzzy.js';
import { getProgress, saveProgress } from '../progress.js';

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
  await Promise.all([ensureVoices(), warmMic()]);

  const saved = await getProgress(id, section);
  const savedLine = saved?.practiceValue ?? 0;

  if (savedLine > 0 && savedLine < lines.length) {
    const resume = await showPracticeResumePrompt(sectionName, savedLine, lines.length);
    startPractice({ id, section, lines, sectionName, startLine: resume.startLine, track: resume.track });
    return;
  }

  startPractice({ id, section, lines, sectionName, startLine: 0, track: true });
}

function showPracticeResumePrompt(sectionName, savedLine, total) {
  return new Promise(resolve => {
    const page = document.getElementById('page');
    page.innerHTML = `
      <div class="resume-screen">
        <div class="resume-icon">🎤</div>
        <h2>Welcome back!</h2>
        <p>Last time you reached <strong>line ${savedLine} of ${total}</strong> in <em>${sectionName}</em>.</p>
        <div class="resume-progress-wrap">
          <div class="resume-progress-bar" style="width:${(savedLine/total)*100}%"></div>
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
      resolve({ startLine: savedLine, track: !document.getElementById('no-track').checked });
    });
    document.getElementById('btn-restart').addEventListener('click', () => {
      resolve({ startLine: 0, track: !document.getElementById('no-track').checked });
    });
  });
}

function startPractice({ id, section, lines, sectionName, startLine, track }) {
  let lineIndex = startLine;
  let recognizer = null;
  let listening = false;
  let lineRevealed = new Set(); // word indices within current line already revealed green

  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="practice-container">
      <div class="section-label">${sectionName}${!track ? ' · <span class="no-track-badge">not tracking</span>' : ''}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" id="progress-bar"></div></div>
      <div class="blurred-text" id="blurred-text"></div>
      <div class="practice-controls">
        <button class="ctrl-btn hint-btn" id="btn-hint" title="Reveal next word">💡 Hint</button>
        <button class="ctrl-btn primary" id="btn-mic">🎤 Start</button>
        <button class="ctrl-btn" id="btn-skip" title="Skip line">⏭</button>
      </div>
      <div class="transcript-box" id="transcript-box"></div>
      <div id="feedback-msg" class="feedback-msg"></div>
    </div>`;

  // Returns the global word index of the first word on line li
  function lineStart(li) {
    let n = 0;
    for (let i = 0; i < li; i++) n += lines[i].split(/\s+/).filter(Boolean).length;
    return n;
  }

  function buildBlurredText() {
    const container = document.getElementById('blurred-text');
    container.innerHTML = lines.map((line, li) => `
      <div class="practice-line${li === lineIndex ? ' current-line' : ''}" data-line="${li}">
        ${line.split(/\s+/).filter(Boolean).map((w, wi) => {
          const gi = lineStart(li) + wi;
          return `<span class="pword ${li < startLine ? 'revealed' : 'blurred'}" data-global="${gi}">${w}</span>`;
        }).join(' ')}
      </div>`).join('');
    document.getElementById('progress-bar').style.width = `${(lineIndex / lines.length) * 100}%`;
  }

  function revealWordEl(gi, missed) {
    const el = document.querySelector(`.pword[data-global="${gi}"]`);
    if (!el) return;
    el.classList.remove('blurred', 'revealed', 'revealed-missed');
    el.classList.add(missed ? 'revealed-missed' : 'revealed');
  }

  // Match spoken text against a line, returning bool[] of which words matched
  function matchAgainstLine(text, li) {
    const lineWords = lines[li].split(/\s+/).filter(Boolean);
    const spoken = normalize(text).split(/\s+/).filter(Boolean);
    const matched = new Array(lineWords.length).fill(false);
    let si = 0;
    for (let ei = 0; ei < lineWords.length && si < spoken.length; ) {
      if (wordMatches(spoken[si], lineWords[ei])) {
        matched[ei] = true;
        si++;
        ei++;
      } else {
        si++;
      }
    }
    return matched;
  }

  // Reveal matched words green immediately (used on interim results)
  function applyMatches(text) {
    if (!text.trim() || !/[\u0400-\u04FF]/.test(text) || lineIndex >= lines.length) return;
    const matched = matchAgainstLine(text, lineIndex);
    const ls = lineStart(lineIndex);
    matched.forEach((m, wi) => {
      if (m && !lineRevealed.has(wi)) {
        revealWordEl(ls + wi, false);
        lineRevealed.add(wi);
      }
    });
  }

  // Called when an utterance ends: reveal matched green, unmatched red, advance line
  function finalizeLine(text) {
    if (lineIndex >= lines.length) return;
    if (text) applyMatches(text);

    const lineWords = lines[lineIndex].split(/\s+/).filter(Boolean);
    const ls = lineStart(lineIndex);
    for (let wi = 0; wi < lineWords.length; wi++) {
      if (!lineRevealed.has(wi)) revealWordEl(ls + wi, true);
    }

    // Highlight current line marker
    document.querySelectorAll('.practice-line').forEach((el, li) => {
      el.classList.toggle('current-line', li === lineIndex + 1);
    });

    lineRevealed = new Set();
    lineIndex++;
    if (track) saveProgress(id, section, 'practice', lineIndex, lines.length);
    document.getElementById('progress-bar').style.width = `${(lineIndex / lines.length) * 100}%`;

    if (lineIndex >= lines.length) {
      setTimeout(() => { stopListening(); showComplete(); }, 600);
    }
  }

  function showHint() {
    if (lineIndex >= lines.length) return;
    const lineWords = lines[lineIndex].split(/\s+/).filter(Boolean);
    const ls = lineStart(lineIndex);
    const wi = lineWords.findIndex((_, i) => !lineRevealed.has(i));
    if (wi === -1) return;
    revealWordEl(ls + wi, false);
    lineRevealed.add(wi);
    const el = document.querySelector(`.pword[data-global="${ls + wi}"]`);
    if (el) { el.classList.add('hint-glow'); setTimeout(() => el.classList.remove('hint-glow'), 1500); }
  }

  function stopListening() {
    listening = false;
    if (recognizer) { try { recognizer.stop(); } catch(_) {} recognizer = null; }
    const btn = document.getElementById('btn-mic');
    if (btn) { btn.textContent = '🎤 Start'; btn.classList.remove('recording'); }
  }

  function spawnRec() {
    if (!listening) return;
    let gotResult = false;
    let lastFinal = '';
    const startedAt = Date.now();

    recognizer = createRecognizer({
      continuous: false,
      onResult({ final, interim }) {
        gotResult = true;
        if (final) lastFinal = final;
        document.getElementById('transcript-box').textContent = final || interim;
        applyMatches(final || interim);
      },
      onEnd() {
        recognizer = null;
        if (!listening) { stopListening(); return; }
        // iOS kills auto-restart after a few cycles — session ends instantly with no result
        if (!gotResult && Date.now() - startedAt < 600) {
          stopListening();
          showFeedback('Tap mic to continue', 'info');
          return;
        }
        if (lastFinal) {
          finalizeLine(lastFinal);
          setTimeout(spawnRec, 800); // wait for line advance animation
        } else {
          setTimeout(spawnRec, 150);
        }
      }
    });
    if (!recognizer) { showFeedback('Speech recognition not supported', 'warn'); listening = false; return; }
    try { recognizer.start(); } catch(e) { if (listening) setTimeout(spawnRec, 300); }
  }

  function startListening() {
    if (listening) { stopListening(); return; }
    listening = true;
    const btn = document.getElementById('btn-mic');
    btn.textContent = '⏹ Stop'; btn.classList.add('recording');
    spawnRec();
  }

  function showFeedback(msg, type = 'info') {
    const el = document.getElementById('feedback-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = `feedback-msg feedback-${type}`;
    setTimeout(() => { if (el) el.textContent = ''; }, 3000);
  }

  function showComplete() {
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
  document.getElementById('btn-skip').addEventListener('click', () => {
    finalizeLine('');
    if (listening) setTimeout(spawnRec, 800);
  });
}
