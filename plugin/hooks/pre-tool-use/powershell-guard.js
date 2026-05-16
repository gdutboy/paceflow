// PowerShell guard helpers for PreToolUse.
const fs = require('fs');
const path = require('path');
const paceUtils = require('../pace-utils');

const { ARTIFACT_FILES } = paceUtils;

function normalizePowerShellSearchText(value) {
  return String(value || '')
    .replace(/`(["'`\s\\])/g, '$1')
    .replace(/\\+/g, '/')
    .replace(/\b([A-Za-z]:)\/+/g, '$1/')
    .replace(/([^:])\/{2,}/g, '$1/');
}

function stripHereStrings(command) {
  return String(command || '').replace(/@(["'])[\s\S]*?\1@/g, '@""@');
}

function powershellCommandPathTokens(command) {
  const tokens = [];
  const re = /"((?:`.|[^"])*)"|'([^']*)'|([^\s;|<>]+)/g;
  let match;
  while ((match = re.exec(String(command || ''))) !== null) {
    let token = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    token = normalizePowerShellSearchText(token).replace(/^['"]|['"]$/g, '');
    if (!token || token === '&' || token === '.' || token.startsWith('-') || /^\w+=/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function powershellOutputRedirectTargets(command) {
  const c = stripHereStrings(command);
  const targets = [];
  let quote = null;
  let escaped = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '`') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch !== '>') continue;

    let j = i + 1;
    if (c[j] === '>') j++;
    while (/\s/.test(c[j] || '')) j++;
    if (!c[j] || c[j] === '&') continue;

    let target = '';
    if (c[j] === '"' || c[j] === "'") {
      const endQuote = c[j++];
      while (j < c.length && c[j] !== endQuote) target += c[j++];
    } else {
      while (j < c.length && !/[\s;|<>]/.test(c[j])) target += c[j++];
    }
    if (target) targets.push(target);
  }
  return targets;
}

function commandTextLooksMutating(command) {
  const c = normalizePowerShellSearchText(command);
  return /(^|[\n;|]\s*)(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Clear-Content|Rename-Item|Set-Item|Remove-ItemProperty|Set-ItemProperty|mkdir|rmdir|rm|del|erase|mv|move|cp|copy|ni|sc|ac)\b/i.test(c) ||
    /(^|[\n;|]\s*)(?:node|python\d*)\b[\s\S]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\s*\()/i.test(c);
}

function commandTextContainsWriteApi(command) {
  const c = normalizePowerShellSearchText(command);
  return /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes)\b/i.test(c) ||
    /\bopen\s*\([^)]*,\s*['"][wax+]/i.test(c);
}

function powershellCommandLooksMutating(command) {
  return commandTextLooksMutating(command);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textReferencesPathOrChild(text, target) {
  const normalized = normalizePowerShellSearchText(target).replace(/\/+$/, '');
  if (!normalized) return false;
  const c = normalizePowerShellSearchText(text);
  if (c.includes(`${normalized}/`)) return true;
  return new RegExp(`${escapeRegExp(normalized)}(?=$|[\\s"'\\\`;|&<>])`).test(c);
}

function powershellPathLooksArtifact(target, cwd, artDir) {
  const t = normalizePowerShellSearchText(target).replace(/\/+$/, '');
  if (!t || /^&\d+$/.test(t)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, t);
    if (paceUtils.artifactRelativePathForFile(artDir, resolved)) return true;
    if (paceUtils.artifactRelativePathForFile(cwd, resolved)) return true;
  } catch(e) {}
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => normalizePowerShellSearchText(dir).replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (t === `${root}/${file}`) return true;
    }
    if (t === `${root}/changes`) return true;
    if (t.startsWith(`${root}/changes/`)) return true;
  }
  return /^(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)$/i.test(t) ||
    /^(?:\.\/)?changes(?:\/|$)/i.test(t);
}

function powershellCommandRedirectsToArtifact(command, cwd, artDir) {
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksArtifact(target, cwd, artDir));
}

function powershellPathLooksArtifactRuntimeControl(target, cwd) {
  const raw = normalizePowerShellSearchText(target).trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    if (paceUtils.isArtifactRuntimeControlPath(cwd, resolved)) return true;
  } catch(e) {}
  return /(?:^|\/)\.pace\/artifact-writer\.lock$/i.test(raw) ||
    /(?:^|\/)\.pace\/(?:locks|sequences|reservations|index-transactions|change-owners)(?:\/|$)/i.test(raw) ||
    /^artifact-writer\.lock$/i.test(raw);
}

function powershellCommandRedirectsToArtifactRuntimeControl(command, cwd) {
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksArtifactRuntimeControl(target, cwd));
}

function powershellCommandReferencesArtifactRuntimeControl(command, cwd) {
  const c = normalizePowerShellSearchText(command);
  const runtime = normalizePowerShellSearchText(paceUtils.getProjectRuntimeDir(cwd)).replace(/\/+$/, '');
  const relRuntime = path.relative(cwd, runtime).replace(/\\/g, '/').replace(/\/+$/, '');
  return textReferencesPathOrChild(c, `${runtime}/locks`) ||
    textReferencesPathOrChild(c, `${runtime}/sequences`) ||
    textReferencesPathOrChild(c, `${runtime}/reservations`) ||
    textReferencesPathOrChild(c, `${runtime}/index-transactions`) ||
    textReferencesPathOrChild(c, `${runtime}/change-owners`) ||
    (relRuntime && (
      textReferencesPathOrChild(c, `${relRuntime}/locks`) ||
      textReferencesPathOrChild(c, `${relRuntime}/sequences`) ||
      textReferencesPathOrChild(c, `${relRuntime}/reservations`) ||
      textReferencesPathOrChild(c, `${relRuntime}/index-transactions`) ||
      textReferencesPathOrChild(c, `${relRuntime}/change-owners`)
    )) ||
    c.includes(normalizePowerShellSearchText(paceUtils.getArtifactWriterLockPath(cwd))) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-writer\.lock(?=$|[\s"'`;|&<>])/i.test(c) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/(?:locks|sequences|reservations|index-transactions|change-owners)(?:\/|$)/i.test(c) ||
    /(?:^|[\s"'`=;|&])artifact-writer\.lock(?=$|[\s"'`;|&<>])/i.test(c) ||
    powershellCommandPathTokens(c).some(target => powershellPathLooksArtifactRuntimeControl(target, cwd));
}

function powershellCommandMutatesArtifactRuntimeControl(command, cwd) {
  return powershellCommandRedirectsToArtifactRuntimeControl(command, cwd) ||
    (powershellCommandLooksMutating(command) && powershellCommandReferencesArtifactRuntimeControl(command, cwd));
}

function powershellPathLooksWorktreeLocalArtifactRootChoice(target, cwd) {
  const raw = normalizePowerShellSearchText(target).trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    return paceUtils.isWorktreeLocalArtifactRootChoicePath(cwd, resolved);
  } catch(e) {
    return false;
  }
}

function powershellCommandRedirectsToWorktreeLocalArtifactRootChoice(command, cwd) {
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksWorktreeLocalArtifactRootChoice(target, cwd));
}

function powershellCommandReferencesWorktreeLocalArtifactRootChoice(command, cwd) {
  const context = paceUtils.executionContextForCwd(cwd);
  if (!context.isWorktree) return false;
  const c = normalizePowerShellSearchText(command);
  const localChoicePath = path.join(path.resolve(cwd || process.cwd()), '.pace', 'artifact-root').replace(/\\/g, '/');
  return textReferencesPathOrChild(c, localChoicePath) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-root(?=$|[\s"'`;|&<>])/i.test(c) ||
    powershellCommandPathTokens(c).some(target => powershellPathLooksWorktreeLocalArtifactRootChoice(target, cwd));
}

function powershellCommandMutatesWorktreeLocalArtifactRootChoice(command, cwd) {
  return powershellCommandRedirectsToWorktreeLocalArtifactRootChoice(command, cwd) ||
    (powershellCommandLooksMutating(command) && powershellCommandReferencesWorktreeLocalArtifactRootChoice(command, cwd));
}

function powershellCommandReferencesArtifact(command, cwd, artDir) {
  const c = normalizePowerShellSearchText(command);
  if (powershellCommandPathTokens(c).some(target => powershellPathLooksArtifact(target, cwd, artDir))) return true;
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => normalizePowerShellSearchText(dir).replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (textReferencesPathOrChild(c, `${root}/${file}`)) return true;
    }
    if (textReferencesPathOrChild(c, `${root}/changes`)) return true;
  }
  return /(^|[\s"'`=])(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)(?=$|[\s"'`;|&<>])/i.test(c) ||
    /(^|[\s"'`=])(?:\.\/)?changes(?:\/|$)/i.test(c);
}

function powershellScriptExecutionTargets(command, cwd) {
  const targets = [];
  for (const token of powershellCommandPathTokens(command)) {
    if (!/\.(?:[cm]?js|py|ps1|psm1)$/i.test(token)) continue;
    try {
      targets.push(paceUtils.resolveToolFilePath(cwd, token));
    } catch(e) {}
  }
  return targets;
}

function powershellCommandEmbedsArtifactWriteScript(command, cwd, artDir, depth = 0) {
  const c = normalizePowerShellSearchText(command);
  if (commandTextContainsWriteApi(c) && powershellCommandReferencesArtifact(c, cwd, artDir)) {
    return true;
  }
  for (const target of powershellScriptExecutionTargets(command, cwd)) {
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const script = fs.readFileSync(target, 'utf8');
      const normalizedScript = normalizePowerShellSearchText(script);
      if (commandTextContainsWriteApi(normalizedScript) && powershellCommandReferencesArtifact(normalizedScript, cwd, artDir)) return true;
      if (commandTextLooksMutating(normalizedScript) && powershellCommandReferencesArtifact(normalizedScript, cwd, artDir)) return true;
      if (powershellCommandRedirectsToArtifact(normalizedScript, cwd, artDir)) return true;
      if (depth < 2 && powershellCommandEmbedsArtifactWriteScript(normalizedScript, cwd, artDir, depth + 1)) return true;
    } catch(e) {}
  }
  return false;
}

function powershellArtifactRuntimeControlDenyReason(command) {
  return [
    '禁止使用 PowerShell 修改 PaceFlow artifact 写入控制运行态。锁、编号计数、reservation 与索引事务只能由 hook 创建/释放。',
    '如果看到写入繁忙，请等待当前 artifact 写入完成后重试；不要用 PowerShell 删除或改写 PaceFlow 运行态文件。',
    `被拦截的命令：${String(command || '').slice(0, 500)}`
  ].join('\n');
}

function powershellArtifactDenyReason(command) {
  return [
    '禁止使用 PowerShell 修改 artifact 文件。artifact 只能通过 artifact-writer 的 Write/Edit 路径修改，以便 hook 能检查格式和索引一致性。',
    '允许用 PowerShell 读取 artifact（Get-Content/Select-String 等），但禁止 Set-Content、Add-Content、Out-File、Remove-Item、Move-Item、Copy-Item、重定向或脚本写文件等会改变 artifact 的命令。',
    '如果是 CRLF 导致 Edit 匹配失败，请直接重试 Edit；hook 会在 Edit/MultiEdit 前把 artifact 换行机械归一化为 LF。',
    `被拦截的命令：${String(command || '').slice(0, 500)}`
  ].join('\n');
}

module.exports = {
  powershellCommandLooksMutating,
  powershellCommandRedirectsToArtifact,
  powershellCommandEmbedsArtifactWriteScript,
  powershellCommandMutatesArtifactRuntimeControl,
  powershellCommandMutatesWorktreeLocalArtifactRootChoice,
  powershellCommandReferencesArtifact,
  powershellArtifactRuntimeControlDenyReason,
  powershellArtifactDenyReason,
};
