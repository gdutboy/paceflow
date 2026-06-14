const path = require('path');
const fs = require('fs');

function normalizeChangeId(id) {
  const match = String(id || '').trim().toUpperCase().match(/^(CHG|HOTFIX)-\d{8}-\d{2}$/);
  return match ? match[0] : '';
}

/**
 * 由稳定 ID 解析详情文件路径，兼容新旧两种命名。
 * 为什么 glob：CHG/HOTFIX 文件名追加描述性 slug 后是 `chg-id-<slug>.md`，
 * 而旧文件仍是 `chg-id.md`；精确命中优先保旧兼容（不迁移），glob 兜底新带 slug 文件。
 * 都不存在时回退精确路径（fail-safe，等价旧行为，交 readChangeDetail 走 missing 分支）。
 * @param {string} artDir - artifact 根目录。
 * @param {string} id - 稳定变更 ID（CHG-/HOTFIX-YYYYMMDD-NN，大小写不敏感）。
 * @returns {string|null} 详情文件绝对路径；非法 ID 返回 null。
 */
function detailPathForId(artDir, id) {
  if (!id) return null;
  const lower = id.toLowerCase();
  if (!/^chg-\d{8}-\d{2}$/.test(lower) && !/^hotfix-\d{8}-\d{2}$/.test(lower)) return null;
  const changesDir = path.join(artDir, 'changes');
  const exact = path.join(changesDir, `${lower}.md`);
  // 旧无 slug 文件：精确命中优先（向后兼容，不迁移）。
  if (fs.existsSync(exact)) return exact;
  // 新带 slug 文件：glob `chg-yyyymmdd-nn-<slug>.md`。nn 两位 + 后跟 `-`，不误匹配相邻序号。
  try {
    const prefix = `${lower}-`;
    const matches = fs.readdirSync(changesDir).filter(f => f.startsWith(prefix) && f.endsWith('.md')).sort();
    if (matches.length > 0) return path.join(changesDir, matches[0]); // 正常一 ID 一文件；多匹配取第一（sort 稳定）
  } catch (e) {}
  // 都没有 → 回退精确路径，让 readChangeDetail 的 readFileSync 走 missing 分支（fail-safe，等价旧行为）。
  return exact;
}

function slugForChangeId(id) {
  const lower = String(id || '').toLowerCase();
  if (/^(?:chg|hotfix)-\d{8}-\d{2}$/.test(lower)) return lower;
  return '';
}

// detailPathForId 的逆：从 CHG 详情 artifact rel（changes/chg|hotfix-yyyymmdd-nn[-slug].md）反解稳定 ID。
// 正则与 marker-guard.isChangeDetailArtifactRel 同口径（slug 段可选）；非 CHG 详情路径返回 ''。
function changeIdFromArtifactRel(rel) {
  const m = String(rel || '').match(/^changes\/((?:chg|hotfix)-\d{8}-\d{2})(?:-[^/]+)?\.md$/i);
  return m ? normalizeChangeId(m[1]) : '';
}

module.exports = {
  normalizeChangeId,
  detailPathForId,
  slugForChangeId,
  changeIdFromArtifactRel,
};
