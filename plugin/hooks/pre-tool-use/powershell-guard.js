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

function powershellCommandTokens(command) {
  const tokens = [];
  const re = /"((?:`.|[^"])*)"|'([^']*)'|([^\s;|<>]+)/g;
  let match;
  while ((match = re.exec(stripHereStrings(command))) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (token) tokens.push(normalizePowerShellSearchText(token).replace(/^['"]|['"]$/g, ''));
  }
  return tokens;
}

function powershellCommandPathTokens(command) {
  const tokens = [];
  for (const token of powershellCommandTokens(command)) {
    if (!token || token === '&' || token === '.' || token.startsWith('-') || /^\w+=/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function powershellMutatingCommandSegments(command) {
  const c = stripHereStrings(command);
  const mutatingCommand =
    '(?:Set-Content|Add-Content|Out-File|Tee-Object|New-Item|Remove-Item|Move-Item|Copy-Item|Clear-Content|Rename-Item|Set-Item|Remove-ItemProperty|Set-ItemProperty|Invoke-WebRequest|Invoke-RestMethod|Export-Csv|Export-Clixml|Compress-Archive|Expand-Archive|Start-Process|Start-Job|mkdir|rmdir|rm|del|erase|mv|move|cp|copy|ni|sc|ac|tee|iwr|irm|curl|wget|saps)';
  const re = new RegExp(`(?:^|[\\n;|]\\s*)(${mutatingCommand}\\b[^\\n;|]*)`, 'gi');
  const segments = [];
  let match;
  while ((match = re.exec(c)) !== null) {
    if (match[1]) segments.push(match[1]);
  }
  return segments;
}

function powershellNamedWriteTargets(command) {
  const targets = [];
  const targetParams = /^(?:-FilePath|-OutFile|-Path|-LiteralPath|-Destination|-OutputPath)$/i;
  for (const segment of powershellMutatingCommandSegments(command)) {
    const tokens = powershellCommandTokens(segment);
    for (let i = 0; i < tokens.length; i++) {
      if (!targetParams.test(tokens[i])) continue;
      let j = i + 1;
      while (j < tokens.length && /^-[A-Za-z]/.test(tokens[j])) j++;
      if (j < tokens.length && tokens[j] && !/^-[A-Za-z]/.test(tokens[j])) targets.push(tokens[j]);
    }
  }
  return targets;
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
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  return /(^|[\n;|]\s*)(?:Set-Content|Add-Content|Out-File|Tee-Object|New-Item|Remove-Item|Move-Item|Copy-Item|Clear-Content|Rename-Item|Set-Item|Remove-ItemProperty|Set-ItemProperty|Invoke-WebRequest|Invoke-RestMethod|Export-Csv|Export-Clixml|Compress-Archive|Expand-Archive|Start-Process|Start-Job|mkdir|rmdir|rm|del|erase|mv|move|cp|copy|ni|sc|ac|tee|iwr|irm|curl|wget|saps)\b/i.test(c) ||
    /(^|[\n;|]\s*)(?:node|python\d*)\b[\s\S]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\s*\()/i.test(c) ||
    /\[(?:System\.)?IO\.File\]::(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines|Delete|Move|Copy|Replace|Create)\b/i.test(c) ||
    /\[(?:System\.)?IO\.(?:StreamWriter|FileStream)\]::new\b/i.test(c) ||
    /\[(?:System\.)?IO\.Directory\]::(?:Delete|Move|CreateDirectory)\b/i.test(c);
}

function commandTextContainsWriteApi(command) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  return /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes)\b/i.test(c) ||
    /\bopen\s*\([^)]*,\s*['"][wax+]/i.test(c) ||
    /\[(?:System\.)?IO\.File\]::(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines|Delete|Move|Copy|Replace|Create)\b/i.test(c) ||
    /\[(?:System\.)?IO\.(?:StreamWriter|FileStream)\]::new\b/i.test(c) ||
    /\[(?:System\.)?IO\.Directory\]::(?:Delete|Move|CreateDirectory)\b/i.test(c);
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
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksArtifact(target, cwd, artDir)) ||
    powershellNamedWriteTargets(command).some(target => powershellPathLooksArtifact(target, cwd, artDir));
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
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksArtifactRuntimeControl(target, cwd)) ||
    powershellNamedWriteTargets(command).some(target => powershellPathLooksArtifactRuntimeControl(target, cwd));
}

function powershellCommandReferencesArtifactRuntimeControl(command, cwd) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
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

function powershellPathLooksLocalArtifactRootChoice(target, cwd) {
  const raw = normalizePowerShellSearchText(target).trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    return paceUtils.isLocalArtifactRootChoicePath(cwd, resolved);
  } catch(e) {
    return false;
  }
}

function powershellCommandRedirectsToLocalArtifactRootChoice(command, cwd) {
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksLocalArtifactRootChoice(target, cwd)) ||
    powershellNamedWriteTargets(command).some(target => powershellPathLooksLocalArtifactRootChoice(target, cwd));
}

function powershellCommandReferencesLocalArtifactRootChoice(command, cwd) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  const localChoicePath = path.join(path.resolve(cwd || process.cwd()), '.pace', 'artifact-root').replace(/\\/g, '/');
  return textReferencesPathOrChild(c, localChoicePath) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-root(?=$|[\s"'`;|&<>])/i.test(c) ||
    powershellCommandPathTokens(c).some(target => powershellPathLooksLocalArtifactRootChoice(target, cwd));
}

function powershellCommandMutatesLocalArtifactRootChoice(command, cwd) {
  return powershellCommandRedirectsToLocalArtifactRootChoice(command, cwd) ||
    (powershellCommandLooksMutating(command) && powershellCommandReferencesLocalArtifactRootChoice(command, cwd));
}

function powershellPathLooksProjectRootMarker(target, cwd) {
  const raw = normalizePowerShellSearchText(target).trim().replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    return paceUtils.isProjectRootMarkerPath(cwd, resolved);
  } catch(e) {
    return false;
  }
}

function powershellCommandRedirectsToProjectRootMarker(command, cwd) {
  return powershellOutputRedirectTargets(command).some(target => powershellPathLooksProjectRootMarker(target, cwd)) ||
    powershellNamedWriteTargets(command).some(target => powershellPathLooksProjectRootMarker(target, cwd));
}

function powershellCommandReferencesProjectRootMarker(command, cwd) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  return /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/project-root(?=$|[\s"'`;|&<>])/i.test(c) ||
    powershellCommandPathTokens(c).some(target => powershellPathLooksProjectRootMarker(target, cwd));
}

function powershellCommandMutatesProjectRootMarker(command, cwd) {
  return powershellCommandRedirectsToProjectRootMarker(command, cwd) ||
    (powershellCommandLooksMutating(command) && powershellCommandReferencesProjectRootMarker(command, cwd));
}

function powershellCommandReferencesArtifact(command, cwd, artDir) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
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
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  if (commandTextContainsWriteApi(c) && powershellCommandReferencesArtifact(c, cwd, artDir)) {
    return true;
  }
  for (const target of powershellScriptExecutionTargets(command, cwd)) {
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const script = fs.readFileSync(target, 'utf8');
      const normalizedScript = normalizePowerShellSearchText(stripHereStrings(script));
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
  powershellCommandMutatesLocalArtifactRootChoice,
  powershellCommandMutatesProjectRootMarker,
  powershellCommandReferencesArtifact,
  powershellArtifactRuntimeControlDenyReason,
  powershellArtifactDenyReason,
};
