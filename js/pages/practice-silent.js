import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';

export async function renderPracticeSilent({ id, section }) {
  const doc = await db.collection('items').doc(id).get();
  if (!doc.exists) { navigate('/'); return; }
  const item = { id: doc.id, ...doc.data() };

  let parts;
  if (section === 'all') {
    parts = item.sections.filter(Boolean);
  } else {
    const s = item.sections[parseInt(section)];
    parts = s ? [s] : [];
  }
  if (!parts.length) { navigate(`/item/${id}`); return; }

  setHeader({ title: `👁 ${item.title}`, back: `/item/${id}` });

  let partIndex = 0;
  let linesRevealed = 0;   // lines fully revealed
  let wordsInNext = 0;     // words revealed in the next (partial) line

  const page = document.getElementById('page');

  function words(line) { return line.split(/\s+/).filter(Boolean); }

  function render() {
    const part = parts[partIndex];
    const lines = part.lines;
    const allRevealed = linesRevealed >= lines.length;
    const isLastPart = partIndex === parts.length - 1;

    let btnLabel;
    if (!allRevealed)     btnLabel = 'Next line ↓';
    else if (!isLastPart) btnLabel = 'Next part →';
    else                  btnLabel = 'Done! Start over?';

    page.innerHTML = `
      <div class="silent-container">
        ${parts.length > 1
          ? `<div class="part-indicator">Part ${partIndex + 1} of ${parts.length} · ${part.name}</div>`
          : `<div class="part-indicator">${part.name}</div>`}
        <div class="silent-lines">
          ${lines.map((line, li) => {
            if (li < linesRevealed) {
              return `<div class="silent-line">${line}</div>`;
            }
            if (li === linesRevealed && wordsInNext > 0) {
              const ws = words(line);
              return `<div class="silent-line">${ws.map((w, wi) =>
                `<span class="${wi < wordsInNext ? '' : 'silent-word-blur'}">${w}</span>`
              ).join(' ')}</div>`;
            }
            return `<div class="silent-line blurred-line">${line}</div>`;
          }).join('')}
        </div>
        <div class="silent-controls">
          ${!allRevealed ? `<button class="btn-secondary silent-hint-btn" id="btn-hint">💡 Hint</button>` : ''}
          <button class="btn-primary silent-btn" id="btn-action">${btnLabel}</button>
        </div>
      </div>`;

    document.getElementById('btn-action').addEventListener('click', () => {
      if (!allRevealed) {
        linesRevealed++;
        wordsInNext = 0;
      } else if (!isLastPart) {
        partIndex++;
        linesRevealed = 0;
        wordsInNext = 0;
      } else {
        partIndex = 0;
        linesRevealed = 0;
        wordsInNext = 0;
      }
      render();
    });

    document.getElementById('btn-hint')?.addEventListener('click', () => {
      const line = lines[linesRevealed];
      const wordCount = words(line).length;
      wordsInNext = Math.min(wordsInNext + 1, wordCount);
      if (wordsInNext >= wordCount) {
        linesRevealed++;
        wordsInNext = 0;
      }
      render();
    });
  }

  render();
}
