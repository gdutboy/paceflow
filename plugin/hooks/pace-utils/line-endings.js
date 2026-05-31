function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

function hasNonNullVerifiedDate(text) {
  const normalized = normalizeLineEndings(text);
  const frontmatter = normalized.match(/^\uFEFF?---\n([\s\S]*?)\n---/);
  const target = frontmatter ? frontmatter[1] : normalized;
  const match = target.match(/^verified-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

module.exports = {
  normalizeLineEndings,
  hasNonNullVerifiedDate,
};
