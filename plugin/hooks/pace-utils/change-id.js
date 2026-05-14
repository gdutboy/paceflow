const path = require('path');

function normalizeChangeId(id) {
  const match = String(id || '').trim().toUpperCase().match(/^(CHG|HOTFIX)-\d{8}-\d{2}$/);
  return match ? match[0] : '';
}

function detailPathForId(artDir, id) {
  if (!id) return null;
  const lower = id.toLowerCase();
  if (/^chg-\d{8}-\d{2}$/.test(lower) || /^hotfix-\d{8}-\d{2}$/.test(lower)) {
    return path.join(artDir, 'changes', `${lower}.md`);
  }
  return null;
}

function slugForChangeId(id) {
  const lower = String(id || '').toLowerCase();
  if (/^(?:chg|hotfix)-\d{8}-\d{2}$/.test(lower)) return lower;
  return '';
}

module.exports = {
  normalizeChangeId,
  detailPathForId,
  slugForChangeId,
};
