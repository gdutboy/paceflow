// Bash guard helpers for PreToolUse.
const fs = require('fs');
const path = require('path');
const paceUtils = require('../pace-utils');

const { ARTIFACT_FILES } = paceUtils;
const { segmentAnchorPrefix, scanRedirectTargets, commandRunsScriptEngine, BASH_WRAPPERS } = require('./command-recognition');

// 段首锚点（共享识别层）：覆盖 命令起始 / 换行 / ;&| / 分组 (){} / && / for…do / wrapper（env/sudo/...）。
// 该锚点同时喂 runtime-control(hardDeny) 与 artifact-write(denyOrHint) 两条处置档——修一处即修两分支（BG-01）。
const MUTATING_ANCHOR = segmentAnchorPrefix({ extraChars: '\\n;&|(){}', wrappers: BASH_WRAPPERS, allowLoops: true });

// in-place 文件编辑器：直接改写目标文件（区别于写 stdout）。BG-02 补全 --in-place / 拆分 -i / sponge / gawk -i inplace / ex / vim -es。
const INPLACE_EDITOR_SOURCE = '(?:' + [
  "sed\\b[^;\\n]*\\s(?:-i(?:\\b|[.\\w'-])|--in-place)",
  "perl\\b[^;\\n]*\\s-[^\\s;]*pi\\b",
  "perl\\b[^;\\n]*\\s-i(?:\\b|[.\\w'-])",
  "sponge\\b",
  "(?:g|m)?awk\\b[^;\\n]*-i\\s+inplace",
  "ex\\s+-[^\\s;]*c\\b",
  "vim\\s+-[^\\s;]*es\\b",
].join('|') + ')';

const MUTATING_VERB_SOURCE = '(?:' + [
  'rm', 'mv', 'cp', 'touch', 'mkdir', 'rmdir', 'truncate', 'tee', 'dd',
  'install', 'chmod', 'chown', 'dos2unix', 'unix2dos',
].join('|') + ')\\b';

const MUTATING_PATTERNS = [
  new RegExp(MUTATING_ANCHOR + '(?:' + INPLACE_EDITOR_SOURCE + '|' + MUTATING_VERB_SOURCE + "|git\\s+(?:checkout|restore|clean|reset|mv|rm)\\b)", 'i'),
  new RegExp(MUTATING_ANCHOR + 'find\\b[^;\\n]*(?:\\s-delete\\b|\\s-exec\\s+(?:rm|mv|cp)\\b)', 'i'),
  new RegExp(MUTATING_ANCHOR + '(?:npm|pnpm|yarn)\\s+(?:run|exec|x)\\b', 'i'),
  new RegExp(MUTATING_ANCHOR + 'npx\\b[^\\n;&|]*(?:--write\\b|-w\\b|--fix\\b)', 'i'),
  new RegExp(MUTATING_ANCHOR + '(?:prettier\\b[^;\\n]*(?:--write\\b|-w\\b)|eslint\\b[^;\\n]*--fix\\b|biome\\b[^;\\n]*(?:--write\\b|--fix\\b))', 'i'),
  new RegExp(MUTATING_ANCHOR + '(?:python\\d*|node)\\b[^\\n;&|]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\\s*\\()', 'i'),
];

function normalizeCommandSearchText(value) {
  return String(value || '')
    .replace(/\\(["'`])/g, '$1')
    .replace(/\\/g, '/')
    .replace(/\b([A-Za-z]:)\/+/g, '$1/')
    .replace(/([^:])\/{2,}/g, '$1/');
}

function stripHeredocBodies(command) {
  const lines = String(command || '').split('\n');
  const kept = [];
  function delimitersInLine(line) {
    const delimiters = [];
    let quote = null;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && quote !== "'") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch !== '<' || line[i + 1] !== '<') continue;
      let j = i + 2;
      if (line[j] === '-') j++;
      while (/\s/.test(line[j] || '')) j++;
      let delimiter = '';
      if (line[j] === '"' || line[j] === "'") {
        const endQuote = line[j++];
        while (j < line.length && line[j] !== endQuote) delimiter += line[j++];
      } else {
        while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) delimiter += line[j++];
      }
      if (delimiter) delimiters.push(delimiter);
      i = j;
    }
    return delimiters;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    kept.push(line);
    const delimiters = delimitersInLine(line);
    for (const delimiter of delimiters) {
      while (i + 1 < lines.length) {
        i++;
        const bodyLine = lines[i];
        if (bodyLine.trim() === delimiter) {
          kept.push(bodyLine);
          break;
        }
      }
    }
  }
  return kept.join('\n');
}

function shellCommandScripts(command) {
  const scripts = [];
  const c = stripHeredocBodies(command);
  const re = /(^|[;&|]\s*|\$\(\s*|`\s*|\beval\s+(?:["']\s*)?|\bxargs(?:\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*\s+)(?:bash|sh|zsh|fish)\s+-c\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s;&|]+))/gi;
  let m;
  while ((m = re.exec(c)) !== null) {
    const script = m[2] || m[3] || m[4] || m[5] || '';
    if (script) scripts.push(script);
  }
  return scripts;
}

function commandTextLooksMutating(c) {
  return MUTATING_PATTERNS.some((re) => re.test(c));
}

function commandTextContainsWriteApi(c) {
  return /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes)\b/i.test(c) ||
    /\bopen\s*\([^)]*,\s*['"][wax+]/i.test(c);
}

function bashCommandRunsScriptEngine(command) {
  // 共享引擎识别：允许路径前缀（/usr/bin/node）与 env 包装（env node）——修 BG-04。
  return commandRunsScriptEngine(command, { anchorChars: '\\n;&|' });
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

function bashScriptExecutionTargets(command, cwd) {
  const targets = [];
  const c = stripHeredocBodies(command);
  const specs = [
    {
      re: /(^|[\n;&|]\s*)(?:env(?:\s+\w+=\S*)*\s+)?(?:[^\s;&|]*\/)?(?:node|python\d*)\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+)(?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+))*)/gi,
      ext: /\.(?:[cm]?js|py)$/i,
    },
    {
      re: /(^|[\n;&|]\s*)(?:bash|sh|zsh|fish)\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+)(?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+))*)/gi,
      ext: /\.(?:sh|bash|zsh|fish)$/i,
    },
  ];
  for (const spec of specs) {
    let match;
    while ((match = spec.re.exec(c)) !== null) {
      const args = bashCommandPathTokens(match[2] || '');
      for (const arg of args) {
        if (!arg || arg.startsWith('-')) continue;
        if (!spec.ext.test(arg)) continue;
        try {
          targets.push(paceUtils.resolveToolFilePath(cwd, arg));
        } catch(e) {}
        break;
      }
    }
  }
  return targets;
}

function bashHeredocExecutionBodies(command, cwd) {
  const executed = new Set(bashScriptExecutionTargets(command, cwd).map(fp => path.resolve(fp)));
  if (executed.size === 0) return [];
  const lines = String(command || '').split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = />+\|?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))\s+<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      const target = match[1] || match[2] || match[3] || '';
      const delimiter = match[4] || match[5] || match[6] || '';
      if (!target || !delimiter) continue;
      let resolved = '';
      try { resolved = path.resolve(paceUtils.resolveToolFilePath(cwd, target)); } catch(e) {}
      if (!resolved || !executed.has(resolved)) continue;
      const body = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === delimiter) break;
        body.push(lines[j]);
      }
      bodies.push(body.join('\n'));
    }
  }
  return bodies;
}

function bashCommandLooksMutating(command) {
  const c = stripHeredocBodies(command);
  return commandTextLooksMutating(c) || shellCommandScripts(c).some(script => commandTextLooksMutating(script));
}

function bashOutputRedirectTargets(command) {
  // 共享扫描器：单引号内反斜杠字面（修 BG-03）；bash 转义符为 \，反引号是命令替换引号。
  return scanRedirectTargets(stripHeredocBodies(command), { escapeChar: '\\', backtickIsQuote: true });
}

function bashCommandPathTokens(command) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s;&|<>]+)/g;
  let match;
  while ((match = re.exec(String(command || ''))) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!token || token.startsWith('-') || /^\w+=/.test(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

function bashPathLooksArtifact(target, cwd, artDir) {
  const t = normalizeCommandSearchText(target).replace(/\/+$/, '');
  if (!t || /^&\d+$/.test(t)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, t);
    if (paceUtils.artifactRelativePathForFile(artDir, resolved)) return true;
    if (paceUtils.artifactRelativePathForFile(cwd, resolved)) return true;
  } catch(e) {}
  // Fallback only catches simple CWD-relative artifact names that tokenization cannot resolve.
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => normalizeCommandSearchText(dir).replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (t === `${root}/${file}`) return true;
    }
    if (t === `${root}/changes`) return true;
    if (t.startsWith(`${root}/changes/`)) return true;
  }
  // Bash writes to spec.md are still denied: unlike Edit, shell redirection
  // bypasses the line-ending and consistency checks around artifact files.
  return /^(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)$/.test(t) ||
    /^(?:\.\/)?changes(?:\/|$)/.test(t);
}

function bashCommandRedirectsToArtifact(command, cwd, artDir) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksArtifact(target, cwd, artDir));
}

function bashShellCommandRedirectsToArtifact(command, cwd, artDir) {
  return shellCommandScripts(command).some(script => bashCommandRedirectsToArtifact(script, cwd, artDir));
}

function bashPathLooksArtifactRuntimeControl(target, cwd) {
  const raw = String(target || '').trim().replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    if (paceUtils.isArtifactRuntimeControlPath(cwd, resolved)) return true;
  } catch(e) {}
  return /(?:^|\/)\.pace\/artifact-writer\.lock$/.test(raw) ||
    /(?:^|\/)\.pace\/(?:locks|sequences|reservations|index-transactions|change-owners)(?:\/|$)/.test(raw) ||
    raw === 'artifact-writer.lock';
}

function bashCommandRedirectsToArtifactRuntimeControl(command, cwd) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksArtifactRuntimeControl(target, cwd));
}

function bashShellCommandRedirectsToArtifactRuntimeControl(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandRedirectsToArtifactRuntimeControl(script, cwd));
}

function bashSearchText(command) {
  return normalizeCommandSearchText(stripHeredocBodies(command));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bashTextReferencesPathOrChild(text, target) {
  const normalized = String(target || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return false;
  const c = String(text || '');
  if (c.includes(`${normalized}/`)) return true;
  return new RegExp(`${escapeRegExp(normalized)}(?=$|[\\s"'\\\`;|&<>])`).test(c);
}

function bashCommandReferencesArtifactRuntimeControl(command, cwd) {
  const c = bashSearchText(command);
  const runtime = paceUtils.getProjectRuntimeDir(cwd).replace(/\\/g, '/').replace(/\/+$/, '');
  const relRuntime = path.relative(cwd, runtime).replace(/\\/g, '/').replace(/\/+$/, '');
  return bashTextReferencesPathOrChild(c, `${runtime}/locks`) ||
    bashTextReferencesPathOrChild(c, `${runtime}/sequences`) ||
    bashTextReferencesPathOrChild(c, `${runtime}/reservations`) ||
    bashTextReferencesPathOrChild(c, `${runtime}/index-transactions`) ||
    bashTextReferencesPathOrChild(c, `${runtime}/change-owners`) ||
    (relRuntime && (
      bashTextReferencesPathOrChild(c, `${relRuntime}/locks`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/sequences`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/reservations`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/index-transactions`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/change-owners`)
    )) ||
    c.includes(paceUtils.getArtifactWriterLockPath(cwd).replace(/\\/g, '/')) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-writer\.lock(?=$|[\s"'`;|&<>])/.test(c) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/(?:locks|sequences|reservations|index-transactions|change-owners)(?:\/|$)/.test(c) ||
    /(?:^|[\s"'`=;|&])artifact-writer\.lock(?=$|[\s"'`;|&<>])/.test(c) ||
    bashCommandPathTokens(c).some(target => bashPathLooksArtifactRuntimeControl(target, cwd));
}

function bashShellCommandReferencesArtifactRuntimeControl(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandReferencesArtifactRuntimeControl(script, cwd));
}

function bashCommandMutatesArtifactRuntimeControl(command, cwd) {
  return bashCommandRedirectsToArtifactRuntimeControl(command, cwd) ||
    bashShellCommandRedirectsToArtifactRuntimeControl(command, cwd) ||
    (bashCommandLooksMutating(command) &&
      (bashCommandReferencesArtifactRuntimeControl(command, cwd) || bashShellCommandReferencesArtifactRuntimeControl(command, cwd)));
}

function bashPathLooksLocalArtifactRootChoice(target, cwd) {
  const raw = String(target || '').trim().replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    return paceUtils.isLocalArtifactRootChoicePath(cwd, resolved);
  } catch(e) {
    return false;
  }
}

function bashCommandRedirectsToLocalArtifactRootChoice(command, cwd) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksLocalArtifactRootChoice(target, cwd));
}

function bashShellCommandRedirectsToLocalArtifactRootChoice(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandRedirectsToLocalArtifactRootChoice(script, cwd));
}

function bashCommandReferencesLocalArtifactRootChoice(command, cwd) {
  const c = bashSearchText(command);
  const localChoicePath = path.join(path.resolve(cwd || process.cwd()), '.pace', 'artifact-root').replace(/\\/g, '/');
  return bashTextReferencesPathOrChild(c, localChoicePath) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-root(?=$|[\s"'`;|&<>])/.test(c) ||
    bashCommandPathTokens(c).some(target => bashPathLooksLocalArtifactRootChoice(target, cwd));
}

function bashShellCommandReferencesLocalArtifactRootChoice(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandReferencesLocalArtifactRootChoice(script, cwd));
}

function bashCommandMutatesLocalArtifactRootChoice(command, cwd) {
  return bashCommandRedirectsToLocalArtifactRootChoice(command, cwd) ||
    bashShellCommandRedirectsToLocalArtifactRootChoice(command, cwd) ||
    (bashCommandLooksMutating(command) &&
      (bashCommandReferencesLocalArtifactRootChoice(command, cwd) ||
        bashShellCommandReferencesLocalArtifactRootChoice(command, cwd)));
}

function bashPathLooksProjectRootMarker(target, cwd) {
  const raw = String(target || '').trim().replace(/\\/g, '/').replace(/^['"]|['"]$/g, '');
  if (!raw || /^&\d+$/.test(raw)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, raw);
    return paceUtils.isProjectRootMarkerPath(cwd, resolved);
  } catch(e) {
    return false;
  }
}

function bashCommandRedirectsToProjectRootMarker(command, cwd) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksProjectRootMarker(target, cwd));
}

function bashShellCommandRedirectsToProjectRootMarker(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandRedirectsToProjectRootMarker(script, cwd));
}

function bashCommandReferencesProjectRootMarker(command, cwd) {
  const c = bashSearchText(command);
  return /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/project-root(?=$|[\s"'`;|&<>])/.test(c) ||
    bashCommandPathTokens(c).some(target => bashPathLooksProjectRootMarker(target, cwd));
}

function bashShellCommandReferencesProjectRootMarker(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandReferencesProjectRootMarker(script, cwd));
}

function bashCommandMutatesProjectRootMarker(command, cwd) {
  return bashCommandRedirectsToProjectRootMarker(command, cwd) ||
    bashShellCommandRedirectsToProjectRootMarker(command, cwd) ||
    (bashCommandLooksMutating(command) &&
      (bashCommandReferencesProjectRootMarker(command, cwd) ||
        bashShellCommandReferencesProjectRootMarker(command, cwd)));
}

function bashCommandReferencesArtifact(command, cwd, artDir) {
  const c = bashSearchText(command);
  if (bashCommandPathTokens(c).some(target => bashPathLooksArtifact(target, cwd, artDir))) return true;
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => String(dir).replace(/\\/g, '/').replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (bashTextReferencesPathOrChild(c, `${root}/${file}`)) return true;
    }
    if (bashTextReferencesPathOrChild(c, `${root}/changes`)) return true;
  }
  return /(^|[\s"'`=])(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)(?=$|[\s"'`;|&<>])/.test(c) ||
    /(^|[\s"'`=])(?:\.\/)?changes(?:\/|$)/.test(c);
}

function bashShellCommandReferencesArtifact(command, cwd, artDir) {
  return shellCommandScripts(command).some(script => bashCommandReferencesArtifact(script, cwd, artDir));
}

function scriptSourceWritesArtifactTarget(script, cwd, artDir) {
  const c = bashSearchText(script);
  const directCall = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes|open)\s*\(\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = directCall.exec(c)) !== null) {
    const target = m[1] || m[2] || '';
    if (target && bashPathLooksArtifact(target, cwd, artDir)) return true;
  }

  const pathJoinCall = /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|rmSync|renameSync|mkdirSync|write_text|write_bytes|open)\s*\(\s*path\.join\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*,\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = pathJoinCall.exec(c)) !== null) {
    const root = m[1] || m[2] || '';
    const child = m[3] || m[4] || '';
    if (root && child && bashPathLooksArtifact(path.join(root, child), cwd, artDir)) return true;
  }

  const pathlibCall = /\bPath\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*\)\s*\.\s*(?:write_text|write_bytes|unlink|rename|mkdir)\s*\(/gi;
  while ((m = pathlibCall.exec(c)) !== null) {
    const target = m[1] || m[2] || '';
    if (target && bashPathLooksArtifact(target, cwd, artDir)) return true;
  }
  return false;
}

function bashCommandEmbedsArtifactWriteScript(command, cwd, artDir, depth = 0, sourceMode = false) {
  const c = bashSearchText(command);
  if (!sourceMode &&
      commandTextContainsWriteApi(c) &&
      bashCommandRunsScriptEngine(c) &&
      (bashCommandReferencesArtifact(c, cwd, artDir) || bashShellCommandReferencesArtifact(c, cwd, artDir))) {
    return true;
  }
  for (const body of bashHeredocExecutionBodies(command, cwd)) {
    const normalizedBody = bashSearchText(body);
    if (commandTextContainsWriteApi(normalizedBody) && scriptSourceWritesArtifactTarget(normalizedBody, cwd, artDir)) return true;
    if (commandTextLooksMutating(normalizedBody) && bashCommandReferencesArtifact(normalizedBody, cwd, artDir)) return true;
    if (bashCommandRedirectsToArtifact(normalizedBody, cwd, artDir) || bashShellCommandRedirectsToArtifact(normalizedBody, cwd, artDir)) return true;
  }
  for (const target of bashScriptExecutionTargets(command, cwd)) {
    try {
      if (isPaceflowValidationScriptTarget(target, cwd)) continue;
      const stat = fsStat(target);
      if (!stat || !stat.isFile() || stat.size > 256 * 1024) continue;
      const script = fsRead(target);
      const normalizedScript = bashSearchText(script);
      if (commandTextContainsWriteApi(normalizedScript) && scriptSourceWritesArtifactTarget(normalizedScript, cwd, artDir)) return true;
      if (commandTextLooksMutating(normalizedScript) && bashCommandReferencesArtifact(normalizedScript, cwd, artDir)) return true;
      if (bashCommandRedirectsToArtifact(normalizedScript, cwd, artDir) || bashShellCommandRedirectsToArtifact(normalizedScript, cwd, artDir)) return true;
      if (depth < 2 && bashCommandEmbedsArtifactWriteScript(normalizedScript, cwd, artDir, depth + 1, true)) return true;
    } catch(e) {}
  }
  return false;
}

function fsStat(file) {
  try { return fs.statSync(file); } catch(e) { return null; }
}

function fsRead(file) {
  return fs.readFileSync(file, 'utf8');
}

function bashArtifactRuntimeControlDenyReason(command) {
  return [
    '禁止使用 Bash 修改 PaceFlow artifact 写入控制运行态。锁、编号计数、reservation 与索引事务只能由 hook 创建/释放。',
    '如果看到写入繁忙，请等待当前 artifact 写入完成后重试；不要用 Bash 删除或改写 PaceFlow 运行态文件。',
    `被拦截的命令：${String(command || '').slice(0, 500)}`
  ].join('\n');
}

function bashArtifactDenyReason(command) {
  return [
    '禁止使用 Bash 修改 artifact 文件。artifact 只能通过 artifact-writer 的 Write/Edit 路径修改，以便 hook 能检查格式和索引一致性。',
    '允许用 Bash 读取 artifact（test/grep/cat/wc 等），但禁止 sed -i、重定向、rm/mv/cp/touch/mkdir、脚本写文件等会改变 artifact 的命令。',
    '如果是 CRLF 导致 Edit 匹配失败，请直接重试 Edit；hook 会在 Edit/MultiEdit 前把 artifact 换行机械归一化为 LF。',
    `被拦截的命令：${String(command || '').slice(0, 500)}`
  ].join('\n');
}

module.exports = {
  bashCommandLooksMutating,
  bashCommandRedirectsToArtifact,
  bashShellCommandRedirectsToArtifact,
  bashCommandEmbedsArtifactWriteScript,
  bashCommandMutatesArtifactRuntimeControl,
  bashCommandMutatesLocalArtifactRootChoice,
  bashCommandMutatesProjectRootMarker,
  bashCommandReferencesArtifact,
  bashShellCommandReferencesArtifact,
  bashArtifactRuntimeControlDenyReason,
  bashArtifactDenyReason,
};
