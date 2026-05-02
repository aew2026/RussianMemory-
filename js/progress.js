import { db } from './firebase.js';

function key(itemId, section) {
  return `${itemId}_${section}`;
}

export async function getProgress(itemId, section) {
  const doc = await db.collection('progress').doc(key(itemId, section)).get();
  return doc.exists ? doc.data() : null;
}

export async function saveProgress(itemId, section, mode, value, total) {
  const ref = db.collection('progress').doc(key(itemId, section));
  await ref.set({
    [`${mode}Value`]: value,
    [`${mode}Total`]: total,
    [`${mode}UpdatedAt`]: new Date().toISOString(),
  }, { merge: true });
}

export async function resetProgress(itemId, section) {
  await db.collection('progress').doc(key(itemId, section)).delete();
}

export async function resetAllProgress(itemId) {
  const snap = await db.collection('progress')
    .where('__name__', '>=', `${itemId}_`)
    .where('__name__', '<=', `${itemId}_\uf8ff`)
    .get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

export async function getAllProgress() {
  const snap = await db.collection('progress').get();
  const result = {};
  snap.docs.forEach(d => { result[d.id] = d.data(); });
  return result;
}
