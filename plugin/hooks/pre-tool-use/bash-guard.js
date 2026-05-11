// Bash guard helpers for PreToolUse.
const path = require('path');
const paceUtils = require('../pace-utils');

const { ARTIFACT_FILES } = paceUtils;

function shellCommandScripts(command) {
  const scripts = [];
  const c = String(command || '');
  const re = /(^|[;&|]\s*)(?:bash|sh|zsh|fish)\s+-c\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s;&|]+))/gi;
  let m;
  while ((m = re.exec(c)) !== null) {
    const script = m[2] || m[3] || m[4] || m[5] || '';
    if (script) scripts.push(script);
  }
  return scripts;
}

function commandTextLooksMutating(c) {
  return /(^|[;&|]\s*)(sed\b[^;\n]*\s-i(?:\b|[.\w'-])|perl\b[^;\n]*\s-[^\s;]*pi\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|rmdir\b|truncate\b|tee\b|dd\b|install\b|chmod\b|chown\b|dos2unix\b|unix2dos\b|git\s+(?:checkout|restore|clean|reset|mv|rm)\b)/i.test(c) ||
    /(^|[;&|]\s*)(npm|pnpm|yarn)\s+(?:run|exec|x)\b/i.test(c) ||
    /(^|[;&|]\s*)npx\b[\s\S]*(?:--write\b|-w\b|--fix\b)/i.test(c) ||
    /(^|[;&|]\s*)(prettier\b[^;\n]*(?:--write\b|-w\b)|eslint\b[^;\n]*--fix\b|biome\b[^;\n]*(?:--write\b|--fix\b))/i.test(c) ||
    /(^|[;&|]\s*)(python\d*|node)\b[\s\S]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\s*\()/i.test(c);
}

function bashCommandLooksMutating(command) {
  const c = String(command || '');
  return commandTextLooksMutating(c) || shellCommandScripts(c).some(script => commandTextLooksMutating(script));
}

function bashOutputRedirectTargets(command) {
  const c = String(command || '');
  const targets = [];
  let quote = null;
  let escaped = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
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
    if (ch !== '>') continue;

    let j = i + 1;
    if (c[j] === '>') j++;
    if (c[j] === '|') j++;
    while (/\s/.test(c[j] || '')) j++;
    if (!c[j]) continue;

    let target = '';
    if (c[j] === '"' || c[j] === "'") {
      const endQuote = c[j++];
      while (j < c.length && c[j] !== endQuote) target += c[j++];
    } else {
      while (j < c.length && !/[\s;&|<>]/.test(c[j])) target += c[j++];
    }
    if (target) targets.push(target);
  }
  return targets;
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
  const t = String(target || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!t || /^&\d+$/.test(t)) return false;
  try {
    const resolved = paceUtils.resolveToolFilePath(cwd, t);
    if (paceUtils.artifactRelativePathForFile(artDir, resolved)) return true;
    if (paceUtils.artifactRelativePathForFile(cwd, resolved)) return true;
  } catch(e) {}
  // Fallback only catches simple CWD-relative artifact names that tokenization cannot resolve.
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => String(dir).replace(/\\/g, '/').replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (t === `${root}/${file}`) return true;
    }
    if (t === `${root}/changes`) return true;
    if (t.startsWith(`${root}/changes/`)) return true;
  }
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
    /(?:^|\/)\.pace\/(?:locks|sequences|reservations|index-transactions)(?:\/|$)/.test(raw) ||
    raw === 'artifact-writer.lock';
}

function bashCommandRedirectsToArtifactRuntimeControl(command, cwd) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksArtifactRuntimeControl(target, cwd));
}

function bashShellCommandRedirectsToArtifactRuntimeControl(command, cwd) {
  return shellCommandScripts(command).some(script => bashCommandRedirectsToArtifactRuntimeControl(script, cwd));
}

function bashSearchText(command) {
  return String(command || '').replace(/\\(["'`])/g, '$1').replace(/\\/g, '/');
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
    (relRuntime && (
      bashTextReferencesPathOrChild(c, `${relRuntime}/locks`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/sequences`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/reservations`) ||
      bashTextReferencesPathOrChild(c, `${relRuntime}/index-transactions`)
    )) ||
    c.includes(paceUtils.getArtifactWriterLockPath(cwd).replace(/\\/g, '/')) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/artifact-writer\.lock(?=$|[\s"'`;|&<>])/.test(c) ||
    /(?:^|[\s"'`=;|&])(?:\.\/)?\.pace\/(?:locks|sequences|reservations|index-transactions)(?:\/|$)/.test(c) ||
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
  bashCommandMutatesArtifactRuntimeControl,
  bashCommandReferencesArtifact,
  bashShellCommandReferencesArtifact,
  bashArtifactRuntimeControlDenyReason,
  bashArtifactDenyReason,
};
