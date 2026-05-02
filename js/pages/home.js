import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';

export async function renderHome() {
  setHeader({ title: 'EmMem', back: null });
  const page = document.getElementById('page');
  page.innerHTML = `<div class="loading">Loading…</div>`;

  const snap = await db.collection('items').orderBy('title').get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!items.length) {
    page.innerHTML = `
      <div class="empty-state">
        <p>No songs or poems yet.</p>
        <p>Go to <a href="#/admin">Admin</a> to add one!</p>
      </div>`;
    return;
  }

  page.innerHTML = `
    <div class="home">
      <p class="subtitle">What would you like to work on today?</p>
      <ul class="item-list">
        ${items.map(item => `
          <li class="item-card" data-id="${item.id}">
            <div class="item-card-inner">
              <span class="item-icon">${item.type === 'poem' ? '📜' : '🎵'}</span>
              <div class="item-info">
                <span class="item-title">${item.title}</span>
                <span class="item-meta">${item.sections?.length || 0} ${item.type === 'poem' ? 'stanzas' : 'sections'}</span>
              </div>
              <span class="item-arrow">›</span>
            </div>
          </li>`).join('')}
      </ul>
    </div>`;

  page.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => navigate(`/item/${card.dataset.id}`));
  });
}

export async function renderItemDetail({ id }) {
  const doc = await db.collection('items').doc(id).get();
  if (!doc.exists) { navigate('/'); return; }
  const item = { id: doc.id, ...doc.data() };

  setHeader({ title: item.title, back: '/' });
  const page = document.getElementById('page');

  page.innerHTML = `
    <div class="item-detail">
      <p class="subtitle">Choose a section and mode</p>
      <div class="mode-selector">
        <button class="mode-btn active" data-mode="learn">📖 Learn It</button>
        <button class="mode-btn" data-mode="practice">🎤 Practice</button>
      </div>
      <ul class="section-list">
        ${item.sections.map((s, i) => `
          <li class="section-card" data-index="${i}">
            <span class="section-name">${s.name}</span>
            <span class="section-lines">${s.lines.length} lines</span>
          </li>`).join('')}
        <li class="section-card section-all" data-index="all">
          <span class="section-name">⭐ Full ${item.type === 'poem' ? 'poem' : 'song'}</span>
          <span class="section-lines">${item.sections.reduce((a,s)=>a+s.lines.length,0)} lines</span>
        </li>
      </ul>
    </div>`;

  let mode = 'learn';
  page.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      page.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
    });
  });

  page.querySelectorAll('.section-card').forEach(card => {
    card.addEventListener('click', () => {
      const section = card.dataset.index;
      navigate(`/${mode}/${id}/${section}`);
    });
  });
}
