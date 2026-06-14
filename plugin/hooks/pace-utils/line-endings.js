function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

// CHG-20260614-03 T-002：与 change-analysis.parseFrontmatter 同口径解析 frontmatter 块内字段，消除双解析器分叉。
// 仅文首 frontmatter（可选 BOM）才解析，无 frontmatter 不做 whole-doc fallback；重复 key 取末值（last-wins）；
// 返回 null 表示无该字段。正则与 parseFrontmatter 完全一致，使 hasNonNull* 与 isChangeVerified 结论永不分叉。
function frontmatterFieldRaw(text, field) {
  const match = String(text || '').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  let value = null;
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m && m[1] === field) value = m[2].trim(); // last-wins，与 parseFrontmatter 一致
  }
  return value;
}

// 字段值非 null/非空（去引号后，与 isChangeVerified 的 normalizeFrontmatterStatus 同口径）。
function nonNullDateField(text, field) {
  const raw = frontmatterFieldRaw(text, field);
  if (raw === null) return false;
  const value = raw.replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

function hasNonNullVerifiedDate(text) {
  return nonNullDateField(text, 'verified-date');
}

function hasNonNullReviewedDate(text) {
  return nonNullDateField(text, 'reviewed-date');
}

module.exports = {
  normalizeLineEndings,
  hasNonNullVerifiedDate,
  hasNonNullReviewedDate,
};
