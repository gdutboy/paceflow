// PowerShell guard helpers for PreToolUse.
const fs = require('fs');
const path = require('path');
const paceUtils = require('../pace-utils');

const { ARTIFACT_FILES } = paceUtils;
const { segmentAnchorPrefix, scanRedirectTargets, commandRunsScriptEngine } = require('./command-recognition');

// 段首锚点（共享识别层）：PowerShell 侧覆盖 起始 / 换行 / ;| / & 调用操作符 / && || / 分组 (){} /
// 管道 ForEach `{ }`。修 PSG-01/02：& Remove-Item、Get-Date && Remove-Item、$null=(Remove-Item)、
// gci | % { Remove-Item } 等语句前缀此前绕过段首锚点。
const PS_MUTATING_ANCHOR = segmentAnchorPrefix({ extraChars: '\\n;|&(){}' });

// PowerShell mutating cmdlet 与默认别名全集。A08 补全 ri/rni/cpi/mi/si/spi/rd/clc/ren 等真正默认
// 别名（此前别名集只有 *nix 兼容别名 rm/mv/cp，漏了 PowerShell 内置别名，可被 ri 删锁绕过）。
const PS_MUTATING_CMDLETS = [
  'Set-Content', 'Add-Content', 'Out-File', 'Tee-Object', 'New-Item', 'Remove-Item',
  'Move-Item', 'Copy-Item', 'Clear-Content', 'Rename-Item', 'Set-Item',
  'Remove-ItemProperty', 'Set-ItemProperty', 'Invoke-WebRequest', 'Invoke-RestMethod',
  'Export-Csv', 'Export-Clixml', 'Compress-Archive', 'Expand-Archive', 'Start-Process', 'Start-Job',
  'mkdir', 'rmdir', 'rm', 'del', 'erase', 'mv', 'move', 'cp', 'copy', 'ni', 'sc', 'ac', 'tee',
  'iwr', 'irm', 'curl', 'wget', 'saps',
  'ri', 'rni', 'cpi', 'mi', 'si', 'spi', 'rd', 'clc', 'ren',
].join('|');

// positional 接受文件名的 cmdlet/别名子集（不含网络/进程类）。
const PS_POSITIONAL_CMDLETS = [
  'Set-Content', 'Add-Content', 'Out-File', 'Tee-Object', 'New-Item', 'Remove-Item',
  'Move-Item', 'Copy-Item', 'Clear-Content', 'Rename-Item', 'Set-Item',
  'Remove-ItemProperty', 'Set-ItemProperty', 'Export-Csv', 'Export-Clixml',
  'Compress-Archive', 'Expand-Archive', 'mkdir', 'rmdir', 'rm', 'del', 'erase',
  'mv', 'move', 'cp', 'copy', 'ni', 'sc', 'ac', 'tee',
  'ri', 'rni', 'cpi', 'mi', 'si', 'spi', 'rd', 'clc', 'ren',
].join('|');

function normalizePowerShellSearchText(value) {
  return String(value || '')
    .replace(/`([\s\S])/g, '$1')   // PSG-03：剥任意位置单反引号转义（ta`sk.md 运行时是 task.md）
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
  // PSG-01/02 共享锚点（含 & / 分组 / &&）+ A08 别名全集。
  const re = new RegExp(PS_MUTATING_ANCHOR + `((?:${PS_MUTATING_CMDLETS})\\b[^\\n;|]*)`, 'gi');
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

function powershellPositionalWriteTargets(command) {
  const targets = [];
  const positionalCommands = new RegExp(`^(?:${PS_POSITIONAL_CMDLETS})$`, 'i');
  for (const segment of powershellMutatingCommandSegments(command)) {
    const tokens = powershellCommandTokens(segment);
    if (tokens.length < 2 || !positionalCommands.test(tokens[0])) continue;
    for (const token of tokens.slice(1)) {
      if (!token || /^-[A-Za-z]/.test(token)) continue;
      targets.push(token);
    }
  }
  return targets;
}

function powershellOutputRedirectTargets(command) {
  // 共享扫描器：PowerShell 转义符为反引号（非引号），单引号内字面。
  return scanRedirectTargets(stripHereStrings(command), { escapeChar: '`', backtickIsQuote: false });
}

function commandTextLooksMutating(command) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  // PSG-01/02 共享锚点 + A08 别名全集 + git 还原拦截（与 bash 对称）。
  return new RegExp(PS_MUTATING_ANCHOR + `(?:${PS_MUTATING_CMDLETS}|git\\s+(?:checkout|restore|clean|reset|mv|rm))\\b`, 'i').test(c) ||
    new RegExp(PS_MUTATING_ANCHOR + '(?:node|python\\d*)\\b[^\\n;|]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\\s*\\()', 'i').test(c) ||
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

function isPaceflowValidationScriptTarget(target, cwd) {
  let root = '';
  let rel = '';
  try {
    root = path.resolve(cwd || process.cwd());
    rel = path.relative(root, path.resolve(target)).replace(/\\/g, '/');
  } catch(e) {
    return false;
  }
  if (!['tests/test-pace-utils.js', 'tests/test-hooks-e2e.js'].includes(rel)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
    return manifest && manifest.name === 'paceflow';
  } catch(e) {
    return false;
  }
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

function scriptSourceWritesArtifactTarget(script, cwd, artDir) {
  const c = normalizePowerShellSearchText(stripHereStrings(script));
  const directCall = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes|open)\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = directCall.exec(c)) !== null) {
    const target = m[1] || m[2] || '';
    if (target && powershellPathLooksArtifact(target, cwd, artDir)) return true;
  }

  const pathJoinCall = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes|open)\s*\(\s*path\.join\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*,\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = pathJoinCall.exec(c)) !== null) {
    const root = m[1] || m[2] || '';
    const child = m[3] || m[4] || '';
    if (root && child && powershellPathLooksArtifact(path.join(root, child), cwd, artDir)) return true;
  }

  const pathlibCall = /\bPath\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*\)\s*\.\s*(?:write_text|write_bytes|unlink|rename|mkdir)\s*\(/gi;
  while ((m = pathlibCall.exec(c)) !== null) {
    const target = m[1] || m[2] || '';
    if (target && powershellPathLooksArtifact(target, cwd, artDir)) return true;
  }

  const dotnetCall = /\[(?:System\.)?IO\.(?:File|Directory)\]::(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines|Delete|Move|Copy|Replace|Create|CreateDirectory)\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = dotnetCall.exec(c)) !== null) {
    const target = m[1] || m[2] || '';
    if (target && powershellPathLooksArtifact(target, cwd, artDir)) return true;
  }

  return powershellCommandRedirectsToArtifact(c, cwd, artDir) ||
    powershellNamedWriteTargets(c).some(target => powershellPathLooksArtifact(target, cwd, artDir)) ||
    powershellPositionalWriteTargets(c).some(target => powershellPathLooksArtifact(target, cwd, artDir));
}

// 仅 .NET 原生写 API（无需脚本引擎即可写文件），用于与 JS/Python 风格 token 区分。
function commandTextContainsDotNetWriteApi(command) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  return /\[(?:System\.)?IO\.File\]::(?:WriteAllText|WriteAllBytes|WriteAllLines|AppendAllText|AppendAllLines|Delete|Move|Copy|Replace|Create)\b/i.test(c) ||
    /\[(?:System\.)?IO\.(?:StreamWriter|FileStream)\]::new\b/i.test(c) ||
    /\[(?:System\.)?IO\.Directory\]::(?:Delete|Move|CreateDirectory)\b/i.test(c);
}

// 共享引擎识别：允许路径前缀（C:\tools\node.exe）与 env 包装。
function powershellCommandRunsScriptEngine(command) {
  return commandRunsScriptEngine(command, { anchorChars: '\\n;|&' });
}

function powershellCommandEmbedsArtifactWriteScript(command, cwd, artDir, depth = 0, sourceMode = false) {
  const c = normalizePowerShellSearchText(stripHereStrings(command));
  // PSG-04/A02：JS/Python 风格 write API token（writeFileSync 等）需真调脚本引擎才算内联写脚本；
  // .NET 原生写 API（[IO.File]::WriteAllText 等）无需引擎。这样只读命令（Get-Content | Select-String
  // writeFileSync）含 token 但既不调引擎又非 .NET 写，不再被 over-block。
  if (!sourceMode && commandTextContainsWriteApi(c) && powershellCommandReferencesArtifact(c, cwd, artDir) &&
      (powershellCommandRunsScriptEngine(c) || commandTextContainsDotNetWriteApi(c))) {
    return true;
  }
  for (const target of powershellScriptExecutionTargets(command, cwd)) {
    try {
      if (isPaceflowValidationScriptTarget(target, cwd)) continue;
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size > 256 * 1024) continue;
      const script = fs.readFileSync(target, 'utf8');
      const normalizedScript = normalizePowerShellSearchText(stripHereStrings(script));
      if (commandTextContainsWriteApi(normalizedScript) && scriptSourceWritesArtifactTarget(normalizedScript, cwd, artDir)) return true;
      if (commandTextLooksMutating(normalizedScript) && scriptSourceWritesArtifactTarget(normalizedScript, cwd, artDir)) return true;
      if (powershellCommandRedirectsToArtifact(normalizedScript, cwd, artDir)) return true;
      if (depth < 2 && powershellCommandEmbedsArtifactWriteScript(normalizedScript, cwd, artDir, depth + 1, true)) return true;
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
