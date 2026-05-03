import { route, startRouter, navigate } from './router.js';
import { renderHome, renderItemDetail } from './pages/home.js';
import { renderLearn } from './pages/learn.js';
import { renderPractice } from './pages/practice.js';
import { renderPracticeSilent } from './pages/practice-silent.js';
import { renderAdmin } from './pages/admin.js';

export function setHeader({ title, back }) {
  document.getElementById('header-title').textContent = title;
  const backBtn = document.getElementById('header-back');
  if (back) {
    backBtn.classList.remove('hidden');
    backBtn.onclick = () => navigate(back);
  } else {
    backBtn.classList.add('hidden');
    backBtn.onclick = null;
  }
}

route('/', renderHome);
route('/item/:id', renderItemDetail);
route('/learn/:id/:section', renderLearn);
route('/practice/:id/:section', renderPractice);
route('/practice-silent/:id/:section', renderPracticeSilent);
route('/admin', renderAdmin);

startRouter();
