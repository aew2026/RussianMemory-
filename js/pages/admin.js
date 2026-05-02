import { db } from '../firebase.js';
import { navigate } from '../router.js';
import { setHeader } from '../app.js';

const ADMIN_PASSWORD = 'russian123'; // Change this to whatever you like

let authenticated = false;

export async function renderAdmin() {
  setHeader({ title: '⚙️ Admin', back: '/' });
  const page = document.getElementById('page');

  if (!authenticated) {
    page.innerHTML = `
      <div class="admin-login">
        <h2>Admin Login</h2>
        <input type="password" id="pw-input" placeholder="Password" class="text-input" />
        <button class="btn-primary" id="pw-submit">Enter</button>
        <div id="pw-error" class="feedback-msg feedback-warn hidden"></div>
      </div>`;

    const submit = () => {
      const val = document.getElementById('pw-input').value;
      if (val === ADMIN_PASSWORD) {
        authenticated = true;
        renderAdmin();
      } else {
        const err = document.getElementById('pw-error');
        err.textContent = 'Wrong password';
        err.classList.remove('hidden');
      }
    };
    document.getElementById('pw-submit').addEventListener('click', submit);
    document.getElementById('pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    return;
  }

  // Load all items
  const snap = await db.collection('items').orderBy('title').get();
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  page.innerHTML = `
    <div class="admin-container">
      <div class="admin-toolbar">
        <button class="btn-primary" id="btn-new">+ New Song / Poem</button>
      </div>
      <ul class="admin-list" id="admin-list">
        ${items.map(item => `
          <li class="admin-item" data-id="${item.id}">
            <span>${item.type === 'poem' ? '📜' : '🎵'} ${item.title}</span>
            <div class="admin-item-actions">
              <button class="btn-sm" data-action="edit" data-id="${item.id}">Edit</button>
              <button class="btn-sm btn-danger" data-action="delete" data-id="${item.id}">Delete</button>
            </div>
          </li>`).join('')}
      </ul>
    </div>
    <div id="editor-overlay" class="editor-overlay hidden">
      <div id="editor-panel" class="editor-panel"></div>
    </div>`;

  document.getElementById('btn-new').addEventListener('click', () => openEditor(null));

  page.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => i.id === btn.dataset.id);
      openEditor(item);
    });
  });

  page.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this item?')) return;
      await db.collection('items').doc(btn.dataset.id).delete();
      renderAdmin();
    });
  });
}

function openEditor(item) {
  const overlay = document.getElementById('editor-overlay');
  const panel = document.getElementById('editor-panel');
  overlay.classList.remove('hidden');
  document.body.classList.add('no-scroll');

  const isNew = !item;
  const sections = item?.sections ? JSON.parse(JSON.stringify(item.sections)) : [{ name: 'Stanza 1', lines: [''] }];

  function closeEditor() {
    document.getElementById('editor-overlay').classList.add('hidden');
    document.body.classList.remove('no-scroll');
  }

  function renderEditor() {
    panel.innerHTML = `
      <div class="editor">
        <h3>${isNew ? 'New Item' : 'Edit: ' + item.title}</h3>
        <label class="field-label">Title
          <input type="text" class="text-input" id="ed-title" value="${item?.title || ''}" placeholder="Title" />
        </label>
        <label class="field-label">Type
          <select class="text-input" id="ed-type">
            <option value="song" ${item?.type !== 'poem' ? 'selected' : ''}>🎵 Song</option>
            <option value="poem" ${item?.type === 'poem' ? 'selected' : ''}>📜 Poem</option>
          </select>
        </label>
        <div id="sections-editor">
          ${sections.map((s, si) => renderSection(s, si)).join('')}
        </div>
        <button class="btn-secondary" id="btn-add-section">+ Add Section</button>
        <div class="editor-actions">
          <button class="btn-primary" id="btn-save">💾 Save</button>
          <button class="btn-secondary" id="btn-cancel">Cancel</button>
        </div>
      </div>`;

    panel.querySelectorAll('.btn-remove-section').forEach(btn => {
      btn.addEventListener('click', () => {
        sections.splice(parseInt(btn.dataset.si), 1);
        syncSections();
        renderEditor();
      });
    });

    panel.querySelectorAll('.btn-add-line').forEach(btn => {
      btn.addEventListener('click', () => {
        syncSections();
        sections[parseInt(btn.dataset.si)].lines.push('');
        renderEditor();
        // Focus the new line
        const inputs = panel.querySelectorAll(`.section-lines[data-si="${btn.dataset.si}"] .line-input`);
        if (inputs.length) inputs[inputs.length - 1].focus();
      });
    });

    panel.querySelectorAll('.btn-remove-line').forEach(btn => {
      btn.addEventListener('click', () => {
        syncSections();
        const si = parseInt(btn.dataset.si), li = parseInt(btn.dataset.li);
        if (sections[si].lines.length > 1) sections[si].lines.splice(li, 1);
        renderEditor();
      });
    });

    document.getElementById('btn-add-section').addEventListener('click', () => {
      syncSections();
      sections.push({ name: `Stanza ${sections.length + 1}`, lines: [''] });
      renderEditor();
    });

    document.getElementById('btn-save').addEventListener('click', () => saveItem());
    document.getElementById('btn-cancel').addEventListener('click', closeEditor);
  }

  function renderSection(s, si) {
    return `
      <div class="section-editor" data-si="${si}">
        <div class="section-header">
          <input type="text" class="text-input section-name-input" data-si="${si}" value="${s.name}" placeholder="Section name" />
          <button class="btn-sm btn-danger btn-remove-section" data-si="${si}">✕</button>
        </div>
        <div class="section-lines" data-si="${si}">
          ${s.lines.map((line, li) => `
            <div class="line-row">
              <input type="text" class="text-input line-input" data-si="${si}" data-li="${li}" value="${escapeAttr(line)}" placeholder="Line ${li + 1}" />
              <button class="btn-sm btn-danger btn-remove-line" data-si="${si}" data-li="${li}">✕</button>
            </div>`).join('')}
        </div>
        <button class="btn-sm btn-add-line" data-si="${si}">+ Line</button>
      </div>`;
  }

  function syncSections() {
    panel.querySelectorAll('.section-editor').forEach(sec => {
      const si = parseInt(sec.dataset.si);
      if (!sections[si]) return;
      const nameInput = sec.querySelector('.section-name-input');
      if (nameInput) sections[si].name = nameInput.value;
      sec.querySelectorAll('.line-input').forEach(inp => {
        const li = parseInt(inp.dataset.li);
        sections[si].lines[li] = inp.value;
      });
    });
  }

  async function saveItem() {
    syncSections();
    const title = document.getElementById('ed-title').value.trim();
    const type = document.getElementById('ed-type').value;
    if (!title) { alert('Please enter a title'); return; }

    const data = {
      title,
      type,
      sections: sections.map(s => ({
        name: s.name,
        lines: s.lines.filter(l => l.trim())
      })).filter(s => s.lines.length)
    };

    if (isNew) {
      await db.collection('items').add(data);
    } else {
      await db.collection('items').doc(item.id).set(data);
    }
    closeEditor();
    renderAdmin();
  }

  renderEditor();
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
