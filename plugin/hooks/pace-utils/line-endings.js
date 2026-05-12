function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

function hasNonNullVerifiedDate(text) {
  const match = normalizeLineEndings(text).match(/^verified-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

module.exports = {
  normalizeLineEndings,
  hasNonNullVerifiedDate,
};
