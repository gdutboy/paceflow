/**
 * fixture-teardown.js
 *
 * 删除临时 vault 目录。安全：仅删除 /tmp/ 下的路径。
 */

const fs = require('fs');
const { execSync } = require('child_process');

function teardown(targetDir) {
  if (!targetDir || typeof targetDir !== 'string') return;
  if (!targetDir.startsWith('/tmp/')) {
    throw new Error(`Refuse to teardown non-/tmp path: ${targetDir}`);
  }
  if (!fs.existsSync(targetDir)) return;
  execSync(`rm -rf "${targetDir}"`);
}

module.exports = { teardown };
