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
  let lineRevealed = new Set(); // word indices in current line already shown green
  let advancing = false;        // true while animating line transition

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

  // LCS alignment: returns bool[] of which expected words were matched
  function matchAgainstLine(text, li) {
    const expected = lines[li].split(/\s+/).filter(Boolean);
    const spoken = normalize(text).split(/\s+/).filter(Boolean);
    const m = spoken.length, n = expected.length;
    if (!m || !n) return new Array(n).fill(false);

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = wordMatches(spoken[i - 1], expected[j - 1])
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);

    const matched = new Array(n).fill(false);
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (wordMatches(spoken[i - 1], expected[j - 1])) {
        matched[j - 1] = true;
        i--; j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }
    return matched;
  }

  function applyMatches(text) {
    if (!text.trim() || !/[\u0400-\u04FF]/.test(text) || lineIndex >= lines.length || advancing) return;
    const matched = matchAgainstLine(text, lineIndex);
    const ls = lineStart(lineIndex);
    matched.forEach((m, wi) => {
      if (m && !lineRevealed.has(wi)) {
        revealWordEl(ls + wi, false);
        lineRevealed.add(wi);
      }
    });
    // All words matched — advance immediately without waiting for a pause
    const wordCount = lines[lineIndex].split(/\s+/).filter(Boolean).length;
    if (lineRevealed.size >= wordCount) advanceLine(false);
  }

  function advanceLine(hasMissed) {
    if (advancing || lineIndex >= lines.length) return;
    advancing = true;
    const delay = hasMissed ? 500 : 250;
    setTimeout(() => {
      lineRevealed = new Set();
      lineIndex++;
      advancing = false;
      if (track) saveProgress(id, section, 'practice', lineIndex, lines.length);
      document.getElementById('progress-bar').style.width = `${(lineIndex / lines.length) * 100}%`;
      document.querySelectorAll('.practice-line').forEach((el, li) => {
        el.classList.toggle('current-line', li === lineIndex);
      });
      if (lineIndex >= lines.length) { stopListening(); showComplete(); }
    }, delay);
  }

  // Called at end of an utterance: reveal green + red, then move to next line
  function finalizeLine(text) {
    if (advancing || lineIndex >= lines.length) return;
    if (text) applyMatches(text);

    const expected = lines[lineIndex].split(/\s+/).filter(Boolean);
    const ls = lineStart(lineIndex);
    let hasMissed = false;
    for (let wi = 0; wi < expected.length; wi++) {
      if (!lineRevealed.has(wi)) { revealWordEl(ls + wi, true); hasMissed = true; }
    }
    advanceLine(hasMissed);
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
        if (!gotResult && Date.now() - startedAt < 600) {
          stopListening();
          showFeedback('Tap mic to continue', 'info');
          return;
        }
        if (lastFinal && !advancing) finalizeLine(lastFinal);
        const restartDelay = advancing ? 600 : 150;
        setTimeout(spawnRec, restartDelay);
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
    if (listening) setTimeout(spawnRec, 600);
  });
}
