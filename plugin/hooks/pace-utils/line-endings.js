function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

// 去除可选的 UTF-8 BOM 前缀（U+FEFF），避免 frontmatter 起始 --- 匹配失败。
function stripBom(text) {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function hasNonNullVerifiedDate(text) {
  const normalized = stripBom(normalizeLineEndings(text));
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---/);
  const target = frontmatter ? frontmatter[1] : normalized;
  const match = target.match(/^verified-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

function hasNonNullReviewedDate(text) {
  const normalized = stripBom(normalizeLineEndings(text));
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---/);
  const target = frontmatter ? frontmatter[1] : normalized;
  const match = target.match(/^reviewed-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

module.exports = {
  normalizeLineEndings,
  hasNonNullVerifiedDate,
  hasNonNullReviewedDate,
};
