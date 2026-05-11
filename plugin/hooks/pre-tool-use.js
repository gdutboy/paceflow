// PreToolUse hook：多信号三级触发 + 懒创建模板 + C 阶段批准 + E 阶段 impl_plan [/] 检查
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, hasUnsyncedPlanFiles, CODE_EXTS, ARTIFACT_FILES, createTemplates, VAULT_PATH, readActive, isTeammate, getArtifactDir, getProjectRuntimeDir, formatBridgeHint, getNativePlanPath, getProjectName, displayDir, normalizeArtifactRootChoice, FORMAT_SNIPPETS, ARCHIVE_MARKER, getActiveChangeEntries, isChangeApproved, summarizeActiveChanges, artifactRootChoiceNeeded, artifactRootChoiceMessage, getV5MigrationInfo, v5MigrationPromptMessage } = paceUtils;

// I-05: 常量提升到模块级（ARTIFACT_FILES 是静态数组，filter 结果不变）
const PROTECTED_ARTIFACTS = ARTIFACT_FILES.filter(f => f !== 'spec.md');

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);

function isArtifactWriterAgent(stdin) {
  return paceUtils.isArtifactWriterAgentType(stdin.agentType);
}

function isFileMutationTool(toolName) {
  return ['Write', 'Edit', 'MultiEdit'].includes(toolName);
}

function isEditMutationTool(toolName) {
  return ['Edit', 'MultiEdit'].includes(toolName);
}

function isAgentTool(toolName) {
  return toolName === 'Agent';
}

function isBashTool(toolName) {
  return toolName === 'Bash';
}

function getArtifactRelIfRelevant(toolName, isInsideProject, paceSignal, artDir, filePath) {
  if (!isFileMutationTool(toolName) || !isInsideProject || !paceSignal) return null;
  return paceUtils.artifactRelativePathForFile(artDir, filePath);
}

function isArtifactWriterManagedRel(artifactRel) {
  return !!artifactRel && artifactRel !== 'spec.md';
}

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
    '如果看到写入繁忙，请等待当前 artifact 写入完成后重试；不要用 Bash 删除或改写 PaceFlow 运行态文件。详细目标已记录到 hook 日志。',
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

function isArtifactWriterAgentTool(stdin) {
  return paceUtils.isArtifactWriterAgentType(stdin.toolInput.subagent_type || stdin.toolInput.subagentType);
}

function normalizeArtifactDirValue(value) {
  const raw = normalizeArtifactRootChoice(value);
  if (!raw) return '';
  return paceUtils.normalizePath(raw.replace(/\\/g, '/')).replace(/\/+$/, '');
}

function extractPromptArtifactDir(prompt) {
  const match = String(prompt || '').match(/^\s*artifact_dir\s*[:=]\s*(.+?)\s*$/mi);
  return match ? normalizeArtifactDirValue(match[1]) : '';
}

function promptHasExactArtifactDir(prompt, dir) {
  const declared = extractPromptArtifactDir(prompt);
  return declared && declared === normalizeArtifactDirValue(dir);
}

function agentArtifactDirDenyReason(artDir, declared = '') {
  const dir = displayDir(artDir);
  const declaredLine = declared ? `\n当前 prompt 中的 artifact_dir 是：${displayDir(declared)}` : '';
  return [
    `派 paceflow:artifact-writer 时缺少或写错当前 artifact_dir。当前项目已启用 PaceFlow，hook 解析出的 artifact 目录是：${dir}${declaredLine}`,
    '请重派同一个 agent，并在 prompt 顶部加入：',
    `artifact_dir: ${dir}`,
    'artifact_dir 仅用于 PaceFlow artifacts：task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**。',
    '不要让 artifact-writer 自行推断或改写 artifact_dir。'
  ].join('\n');
}

function promptHasTrueField(prompt, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\n\\s,，;；])${escaped}\\s*[:=]\\s*true\\b`, 'i').test(String(prompt || ''));
}

function promptHasNonEmptyField(prompt, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\n,，;；])\\s*${escaped}\\s*[:=]\\s*\\S+`, 'mi').test(String(prompt || ''));
}

function promptFieldValue(prompt, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(prompt || '').match(new RegExp(`(?:^|[\\n,，;；])\\s*${escaped}\\s*[:=]\\s*([^\\n,，;；]+)`, 'mi'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

function explicitReservationFromPrompt(prompt) {
  const id = promptFieldValue(prompt, 'reserved-id').toUpperCase();
  const fileRel = promptFieldValue(prompt, 'reserved-file').replace(/\\/g, '/');
  let filePrefix = promptFieldValue(prompt, 'reserved-file-prefix').replace(/\\/g, '/');
  filePrefix = filePrefix.replace(/<slug>\.md$/i, '').replace(/\*\.md$/i, '');
  return { id, fileRel, filePrefix };
}

function relFromReservedId(id) {
  const m = String(id || '').match(/^(CHG|HOTFIX)-(\d{8})-(\d{2})$/i);
  if (!m) return '';
  return `changes/${m[1].toLowerCase()}-${m[2]}-${m[3]}.md`;
}

function reservationRelForLookup(explicit) {
  if (explicit.fileRel) return explicit.fileRel;
  const fromId = relFromReservedId(explicit.id);
  if (fromId) return fromId;
  if (explicit.filePrefix) return `${explicit.filePrefix}slug.md`;
  return '';
}

function reservationMatchesExplicit(reservation, explicit) {
  if (!reservation) return false;
  if (explicit.id && reservation.id !== explicit.id) return false;
  if (explicit.fileRel && reservation.fileRel !== explicit.fileRel) return false;
  if (explicit.filePrefix && reservation.filePrefix !== explicit.filePrefix) return false;
  return true;
}

function artifactWriterCreateChgHint(artDir) {
  return [
    FORMAT_SNIPPETS.skillRef,
    FORMAT_SNIPPETS.reserveHelper,
    '派 artifact-writer create-chg 时，Agent prompt 顶部必须包含：',
    `artifact_dir: ${displayDir(artDir)}`,
    'operation: create-chg',
    'reserved-id: <helper 输出或 hook deny 输出>',
    'reserved-file: <helper 输出或 hook deny 输出>',
    'title: <变更标题>',
    'tasks:',
    '- T-001: <首个任务>',
    '若未先运行 helper，hook 会用 deny 文案返回 reserved-id / reserved-file 作为 fallback；收到后原样写入 prompt 重派。'
  ].join('\n');
}

function reservationRequiredReason(operation, artDir, reservation) {
  const lines = [
    `PACEflow 已为 ${operation} 预留唯一编号。本次 Agent 已被阻止，请重派 artifact-writer 并带上以下字段：`,
    FORMAT_SNIPPETS.skillRef,
    operation === 'create-chg' ? FORMAT_SNIPPETS.reserveHelper : `后续可先运行 Bash: node "${path.resolve(__dirname, 'reserve-artifact-id.js').replace(/\\/g, '/')}" --operation record-correction 预留 correction 编号。`,
    `artifact_dir: ${displayDir(artDir)}`,
    `operation: ${operation}`,
  ];
  if (reservation.id) lines.push(`reserved-id: ${reservation.id}`);
  if (reservation.fileRel) lines.push(`reserved-file: ${reservation.fileRel}`);
  if (reservation.filePrefix) lines.push(`reserved-file-prefix: ${reservation.filePrefix}<slug>.md`);
  lines.push('不要启动不带 reserved-id 的 create-chg / record-correction agent；不要让 agent 扫描索引自行分配编号。');
  return lines.join('\n');
}

function reservationExplicitMissingReason(operation, explicit) {
  return [
    `artifact-writer prompt 中的预留字段无效或已过期，当前没有匹配的 hook reservation：${explicit.id || explicit.fileRel || explicit.filePrefix || 'reserved fields'}。`,
    FORMAT_SNIPPETS.skillRef,
    `请先在主 session 运行 Bash: node "${path.resolve(__dirname, 'reserve-artifact-id.js').replace(/\\/g, '/')}" --operation ${operation}，然后把新的 reserved-id / reserved-file 原样复制进 prompt 后重派。`,
    '不要手写或复用旧 session 的 reserved-id。'
  ].join('\n');
}

function promptMentionsVerifyAction(prompt) {
  const text = String(prompt || '');
  return /(?:^|[\s\n])action\s*[:=]\s*verify\b/i.test(text) ||
    /\bupdate-chg\s+action=verify\b/i.test(text) ||
    /执行\s*verify\s*操作/i.test(text) ||
    /\bverify\s+操作/i.test(text);
}

function promptMentionsApproveAndStart(prompt) {
  return /\bapprove-and-start\b/i.test(String(prompt || ''));
}

function promptMentionsApproveOnly(prompt) {
  const text = String(prompt || '');
  return /(?:^|[\s\n])action\s*[:=]\s*approve\b(?!-and-start)/i.test(text) ||
    /\bupdate-chg\s+action=approve\b(?!-and-start)/i.test(text) ||
    /执行\s*approve\s*操作/i.test(text) ||
    /action=approve(?!-and-start)/i.test(text);
}

function promptApproveContainsStartIntent(prompt) {
  const text = String(prompt || '');
  return /(?:status|状态)[^\n]{0,24}(?:in-progress|进行中)/i.test(text) ||
    /(?:改为|设为|推到|进入)[^\n]{0,24}(?:in-progress|进行中)/i.test(text) ||
    /(?:开始实施|开始执行|立即开始|启动任务|标记为\s*\[\/\]|标记.*进行中)/i.test(text);
}

function agentLifecyclePromptDenyReason(prompt) {
  const text = String(prompt || '');
  const mentionsApproveAndStart = promptMentionsApproveAndStart(text);
  const mentionsApproveOnly = promptMentionsApproveOnly(text);
  const mentionsApprovalAction = mentionsApproveAndStart || mentionsApproveOnly;
  const mentionsCloseChg = /\bclose-chg\b/i.test(text);
  const mentionsUpdateStatus = /\bupdate-status\b/i.test(text);

  if (mentionsApprovalAction) {
    const missing = [];
    if (!promptHasTrueField(text, 'approval-confirmed')) missing.push('approval-confirmed: true');
    if (!promptHasNonEmptyField(text, 'approval-source')) missing.push('approval-source');
    if (!promptHasNonEmptyField(text, 'approval-evidence')) missing.push('approval-evidence');
    if (mentionsApproveAndStart && !promptHasNonEmptyField(text, 'task-id')) missing.push('task-id');
    if (missing.length > 0) {
      return [
        `派 artifact-writer 执行 C 阶段批准时缺少必填字段：${missing.join(', ')}。`,
        FORMAT_SNIPPETS.skillRef,
        'C 阶段批准是确认边界：主 session 可以基于用户明确执行指令、已接受方案或 AskUserQuestion 设置 approval-confirmed: true，但必须写明确认来源与证据。',
        '示例：',
        'approval-confirmed: true',
        'approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan',
        'approval-evidence: <用户原话或已确认方案摘要>',
        mentionsApproveAndStart ? 'task-id: T-NNN' : '若批准后立即开始，请改用 action=approve-and-start 并提供 task-id。'
      ].join('\n');
    }
  }

  if (mentionsApproveOnly && promptApproveContainsStartIntent(text)) {
    return [
      '不要用 action=approve 同时表达开始执行或 in-progress 状态。',
      FORMAT_SNIPPETS.skillRef,
      'action=approve 只插入 APPROVED，适用于“先批准但暂不执行”。',
      '若用户已明确批准并准备开始，请改派 approve-and-start：',
      'action: approve-and-start',
      'approval-confirmed: true',
      'approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan',
      'approval-evidence: <用户原话或已确认方案摘要>',
      'task-id: T-NNN'
    ].join('\n');
  }

  if (mentionsUpdateStatus && promptMentionsVerifyAction(text) && !mentionsCloseChg) {
    return [
      '不要把 update-status 与 update-chg action=verify 串在同一次 agent 派遣中。',
      FORMAT_SNIPPETS.skillRef,
      '验证是确认边界：主 session 必须先运行验证命令并读取结果，确认通过后才允许写 VERIFIED。',
      '如果同一 CHG 会继续连续执行：不要为中间任务单独派 update-status，继续完成剩余代码/测试。',
      '只有暂停、阻塞、跳过、跨 session 或长任务进度可见性需要时，才派 update-chg action=update-status。',
      '如果这是最后任务且验证已通过：直接派 close-chg complete-open-tasks: true，合并完成状态、VERIFIED、归档和 walkthrough。'
    ].join('\n');
  }

  if (mentionsCloseChg) {
    const missing = [];
    if (!promptHasTrueField(text, 'verification-confirmed')) missing.push('verification-confirmed: true');
    if (!promptHasTrueField(text, 'complete-open-tasks')) missing.push('complete-open-tasks: true');
    if (!promptHasNonEmptyField(text, 'verify-summary')) missing.push('verify-summary');
    if (!promptHasNonEmptyField(text, 'walkthrough-summary')) missing.push('walkthrough-summary');
    if (missing.length > 0) {
      return [
        `派 artifact-writer 执行 close-chg 时缺少必填字段：${missing.join(', ')}。`,
        FORMAT_SNIPPETS.skillRef,
        'close-chg 只能在主 session 已运行并读取验证结果、确认通过后调用；agent 不得自行判断验证是否通过。',
        '最后任务收尾主路径：',
        'operation: close-chg',
        'verification-confirmed: true',
        'complete-open-tasks: true',
        'verify-summary: <已运行并读取的验证结果>',
        'walkthrough-summary: <完成摘要>'
      ].join('\n');
    }
  }

  return '';
}

function legacyArtifactWriterLockDenyReason(lock) {
  return [
    '检测到旧版本 artifact-writer 项目级写锁仍在当前项目中，已阻止本次派遣以避免跨版本并发写入。',
    '请等待当前 artifact-writer 结束后重试；不要用 Bash 删除或改写写锁。若长时间未恢复，请查看 pace-hooks.log。'
  ].join('\n');
}

function artifactResourceLockDenyReason(lockAttempt, resource, artifactRel) {
  return [
    `当前 artifact 正被其他 artifact-writer 写入，已阻止修改 ${artifactRel}。`,
    '不要循环重试或删除运行态文件；请等待对方写入完成后重新 Read 目标 artifact，再重试本次 artifact-writer 操作。'
  ].join('\n');
}

function artifactReservationDenyReason(match, artifactRel) {
  return [
    `artifact-writer 写入的详情文件不匹配 hook 预留编号：${artifactRel}。`,
    `期望：${match.expected}`,
    '请使用主 session 重派 prompt 中的 reserved-id / reserved-file，不要重新扫描索引自行分配编号。'
  ].join('\n');
}

function directArtifactMutationDenyReason(toolName, artifactRel) {
  return [
    `禁止主 session/非 artifact-writer 使用 ${toolName} 直接修改流程 artifact：${artifactRel}。`,
    FORMAT_SNIPPETS.skillRef,
    'v6 流程 artifact 只能由 paceflow:artifact-writer 通过受保护的 Write/Edit/MultiEdit 路径写入。',
    '请派 artifact-writer 执行 create-chg / update-chg / close-chg / archive-chg / record-finding / record-correction；不要改用 Write/Edit/MultiEdit 或 Bash 绕过。'
  ].join('\n');
}

// S-1: 统一 stdin 解析
paceUtils.withStdinParsed((stdin) => {
  try {
  const t0 = Date.now();
  const { toolName, content } = stdin;
  const editList = Array.isArray(stdin.toolInput.edits) ? stdin.toolInput.edits : [];
  const oldString = stdin.oldString || editList.map(e => e.old_string || '').join('\n');
  const newString = stdin.newString || editList.map(e => e.new_string || '').join('\n');
  const bashCommand = stdin.toolInput.command || '';
  const rawFilePath = stdin.filePath || '';
  const filePath = paceUtils.resolveToolFilePath(cwd, rawFilePath);
  log(paceUtils.logEntry('PreToolUse', 'ENTRY', { proj, tool: toolName, file: filePath, stdin_ok: stdin.ok }));

  // v4.7: teammate 降级——PACE 流程 deny → additionalContext 提醒
  function denyOrHint(reason) {
    const enrichedReason = paceUtils.appendArtifactDirHint(cwd, reason);
    if (isTeammate()) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `PACE 提醒（teammate 模式）：${enrichedReason}` } };
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: enrichedReason } };
  }
  function hardDeny(reason, action, fields = {}) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', action, { proj, tool: toolName, file: filePath, ...fields, dur: Date.now() - t0 }));
    return output;
  }
  const teammateTag = isTeammate() ? '_TEAMMATE' : '';

  // W-3: 缓存 isPaceProject 结果（避免多次调用）
  const paceSignal = isPaceProject(cwd);
  const artDir = getArtifactDir(cwd);
  const rootConfigError = paceSignal ? paceUtils.artifactRootConfigError(cwd) : null;
  const needsArtifactRootChoice = artifactRootChoiceNeeded(cwd);
  const artifactRootChoiceReason = needsArtifactRootChoice ? artifactRootChoiceMessage(cwd) : '';
  const v5MigrationInfo = getV5MigrationInfo(cwd);
  const v5MigrationReason = v5MigrationInfo.needsPrompt ? v5MigrationPromptMessage(cwd) : '';
  const artifactRootHint = paceUtils.artifactDirRuntimeHint(cwd);
  log(paceUtils.logEntry('PreToolUse', 'ROUTE', {
    proj,
    signal: paceSignal || 'none',
    artifact_dir: displayDir(artDir),
    choice: paceUtils.readArtifactRootChoice(cwd) || 'auto',
    choice_pending: needsArtifactRootChoice,
    legacy_v5: v5MigrationInfo.detected,
    migration_state: v5MigrationInfo.state || '',
  }));
  const taskFp = path.join(artDir, 'task.md');
  const taskFileExists = fs.existsSync(taskFp);
  function ensureArtifactWriterBase() {
    const missingBefore = [];
    const changesDir = path.join(artDir, 'changes');
    if (!fs.existsSync(changesDir)) missingBefore.push('changes/');
    for (const sub of ['changes/findings', 'changes/corrections']) {
      if (!fs.existsSync(path.join(artDir, sub))) missingBefore.push(`${sub}/`);
    }
    for (const file of ARTIFACT_FILES) {
      if (!fs.existsSync(path.join(artDir, file))) missingBefore.push(file);
    }
    let createdFiles = [];
    let error = '';
    if (missingBefore.length > 0) {
      try {
        createdFiles = createTemplates(cwd);
      } catch(e) {
        error = e.message || String(e);
      }
    }
    const missingAfter = [];
    if (!fs.existsSync(changesDir)) missingAfter.push('changes/');
    for (const sub of ['changes/findings', 'changes/corrections']) {
      if (!fs.existsSync(path.join(artDir, sub))) missingAfter.push(`${sub}/`);
    }
    for (const file of ARTIFACT_FILES) {
      if (!fs.existsSync(path.join(artDir, file))) missingAfter.push(file);
    }
    return { missingBefore, missingAfter, createdFiles, error };
  }

  // W-2: 使用 readActive 替换手动读取（内部自动解析 vault 路径）
  let taskActiveContent = readActive(cwd, 'task.md') || '';

  // v4.3.1: 仅 [ ]/[/]/[!] 算活跃任务，[x]/[-] 不算
  const hasActiveTasks = /- \[[ \/!]\]/.test(taskActiveContent);
  const isCodeFile = CODE_EXTS.some(ext => filePath.endsWith(ext));
  const fileName = filePath ? path.basename(filePath) : '';

  // P0-20260506-02: PACE 项目的 Write/Edit 保护链路必须 fail-closed。
  // 非 PACE 项目保持低干扰；PACE 项目中坏 stdin 或缺关键字段不能自然放行。
  if (paceSignal) {
    if (!stdin.ok) {
      return hardDeny(
        'PACE hook 无法解析 Claude Code 提供的 Write/Edit JSON 输入。为避免绕过 artifact 保护，本次写入已阻止；请重试工具调用。',
        'DENY_BAD_STDIN',
        { stdin_ok: false }
      );
    }
    if (rootConfigError && (isAgentTool(toolName) || isFileMutationTool(toolName) || (isBashTool(toolName) && bashCommandLooksMutating(bashCommand)))) {
      return hardDeny(rootConfigError.message, 'DENY_ARTIFACT_ROOT_CONFIG', {
        code: rootConfigError.code,
        choice_path: rootConfigError.choicePath,
      });
    }
    if (isAgentTool(toolName)) {
      if (isArtifactWriterAgentTool(stdin) && needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_AGENT_ARTIFACT_ROOT_CHOICE${teammateTag}`, {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin) && v5MigrationInfo.needsPrompt) {
        const output = denyOrHint(v5MigrationReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_AGENT_V5_MIGRATION${teammateTag}`, {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(v5MigrationInfo.dir),
          state_path: v5MigrationInfo.statePath,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin) && !promptHasExactArtifactDir(stdin.toolInput.prompt, artDir)) {
        const declaredArtifactDir = extractPromptArtifactDir(stdin.toolInput.prompt);
        const reason = agentArtifactDirDenyReason(artDir, declaredArtifactDir);
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ARTIFACT_DIR', {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(artDir),
          declared_artifact_dir: declaredArtifactDir ? displayDir(declaredArtifactDir) : '',
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin)) {
        const lifecycleReason = agentLifecyclePromptDenyReason(stdin.toolInput.prompt);
        if (lifecycleReason) {
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: lifecycleReason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_LIFECYCLE_PROMPT', {
            proj,
            agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
            reason: lifecycleReason.split('\n')[0],
            dur: Date.now() - t0,
          }));
          return;
        }
        const legacyLock = paceUtils.readArtifactWriterLock(cwd);
        if (legacyLock.ok) {
          const legacyCheck = paceUtils.artifactWriterLockMatches(cwd, '__paceflow-new-agent__');
          if (!legacyCheck.ok && legacyCheck.reason !== 'stale-cleared') {
            const reason = legacyArtifactWriterLockDenyReason(legacyLock);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_LEGACY_ARTIFACT_LOCK', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              lock: legacyLock.path,
              owner: legacyLock.sessionId || '',
              dur: Date.now() - t0,
            }));
            return;
          }
        }
        const ensured = ensureArtifactWriterBase();
        if (ensured.missingAfter.length > 0) {
          paceUtils.clearArtifactReservation(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
          const errorLine = ensured.error ? `\n底层错误：${ensured.error}` : '';
          const reason = `PACE hook 无法在 artifact_dir 创建完整 v6 Artifact 基础结构：${displayDir(artDir)}\n仍缺失：${ensured.missingAfter.join(', ')}${errorLine}\n请检查路径/权限后重试；禁止让 artifact-writer 自行创建 base changes/ 或根索引模板。`;
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ARTIFACT_BASE', {
            proj,
            agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
            artifact_dir: displayDir(artDir),
            missing: ensured.missingAfter.join(', '),
            error: ensured.error,
            dur: Date.now() - t0,
          }));
          return;
        }
        const operation = paceUtils.operationFromAgentPrompt(stdin.toolInput.prompt);
        let reservation = { reserved: false };
        if (operation === 'create-chg' || operation === 'record-correction') {
          const explicit = explicitReservationFromPrompt(stdin.toolInput.prompt);
          const hasExplicitReservation = !!(explicit.id || explicit.fileRel || explicit.filePrefix);
          if (!hasExplicitReservation) {
            const owner = { sessionId: stdin.sessionId, agentId: stdin.agentId };
            const existingReservation = paceUtils.readArtifactReservation(cwd, owner);
            reservation = existingReservation && existingReservation.operation === operation
              ? { reserved: true, ...existingReservation }
              : paceUtils.reserveArtifactId(cwd, {
                sessionId: stdin.sessionId,
                agentId: stdin.agentId,
                artifactDir: artDir,
                operation,
                prompt: stdin.toolInput.prompt,
              });
            if (!reservation.reserved) {
              const reason = [
                `PACE hook 无法为 ${operation} 预留唯一编号，已阻止本次 artifact-writer 以避免并发 ID 冲突。`,
                reservation.lock && reservation.lock.ok ? `当前 sequence 锁：${paceUtils.formatArtifactResourceLock(reservation.lock)}` : `原因：${reservation.reason || 'unknown'}`,
                '请稍后重试；不要让 agent 自行扫描索引分配编号。'
              ].join('\n');
              const output = {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: reason
                }
              };
              process.stdout.write(JSON.stringify(output));
              log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ID_RESERVATION', {
                proj,
                agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
                artifact_dir: displayDir(artDir),
                operation,
                reason: reservation.reason || '',
                dur: Date.now() - t0,
              }));
              return;
            }
            const reason = reservationRequiredReason(operation, artDir, reservation);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_RESERVED_PROMPT_REQUIRED', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              operation,
              reserved: reservation.id || reservation.fileRel || reservation.filePrefix || '',
              dur: Date.now() - t0,
            }));
            return;
          }

          const lookupRel = reservationRelForLookup(explicit);
          reservation = lookupRel
            ? paceUtils.findArtifactReservationForRel(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId }, lookupRel)
            : paceUtils.readArtifactReservation(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
          if (!reservationMatchesExplicit(reservation, explicit)) {
            const reason = reservationExplicitMissingReason(operation, explicit);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_RESERVED_PROMPT_MISMATCH', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              operation,
              reserved: explicit.id || explicit.fileRel || explicit.filePrefix || '',
              dur: Date.now() - t0,
            }));
            return;
          }
          reservation = { reserved: true, ...reservation };
        }
        const created = [...new Set([
          ...ensured.createdFiles,
          ...(ensured.missingBefore.includes('changes/') ? ['changes/'] : []),
          ...(ensured.missingBefore.includes('changes/findings/') ? ['changes/findings/'] : []),
          ...(ensured.missingBefore.includes('changes/corrections/') ? ['changes/corrections/'] : []),
        ])];
        const createdMsg = created.length > 0 ? `；已自动创建 Artifact 基础模板：${created.join(', ')}` : '';
        const reservationMsg = reservation.reserved
          ? `；reserved-id: ${reservation.id}${reservation.fileRel ? `；reserved-file: ${reservation.fileRel}` : ''}${reservation.filePrefix ? `；reserved-file-prefix: ${reservation.filePrefix}<slug>.md` : ''}。必须使用该预留编号，不得重新扫描索引分配编号`
          : '';
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: `artifact-writer ARTIFACT_DIR 已确认：${displayDir(artDir)}；仅用于 task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**${reservationMsg}${createdMsg}`
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT_ARTIFACT_BASE', {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(artDir),
          operation,
          reserved: reservation.reserved ? (reservation.id || reservation.fileRel || reservation.filePrefix || '') : '',
          created: created.join(', '),
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT', { proj, tool: toolName, dur: Date.now() - t0 }));
      return;
    }
    if (isBashTool(toolName)) {
      if (bashCommandMutatesArtifactRuntimeControl(bashCommand, cwd)) {
        const reason = bashArtifactRuntimeControlDenyReason(bashCommand);
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_BASH_ARTIFACT_RUNTIME${teammateTag}`, {
          proj,
          command: String(bashCommand).slice(0, 160).replace(/\n/g, ' '),
          runtime: paceUtils.getProjectRuntimeDir(cwd),
          dur: Date.now() - t0,
        }));
        return;
      }
      const mutatesArtifact = bashCommandRedirectsToArtifact(bashCommand, cwd, artDir) ||
        bashShellCommandRedirectsToArtifact(bashCommand, cwd, artDir) ||
        (bashCommandLooksMutating(bashCommand) &&
          (bashCommandReferencesArtifact(bashCommand, cwd, artDir) || bashShellCommandReferencesArtifact(bashCommand, cwd, artDir)));
      if (mutatesArtifact) {
        const reason = v5MigrationInfo.needsPrompt ? v5MigrationReason : bashArtifactDenyReason(bashCommand);
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_BASH_ARTIFACT${teammateTag}`, {
          proj,
          command: String(bashCommand).slice(0, 160).replace(/\n/g, ' '),
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_BASH', { proj, dur: Date.now() - t0 }));
      return;
    }
    if (!isFileMutationTool(toolName)) {
      return hardDeny(
        `PACE hook 收到缺失或未知工具名：${toolName || '(empty)'}。本 hook 只允许处理 Write/Edit/MultiEdit/Agent/Bash，已阻止以避免绕过保护。`,
        'DENY_BAD_TOOL'
      );
    }
    if (!rawFilePath) {
      return hardDeny(
        'PACE hook 缺少 tool_input.file_path，无法判断写入是否会修改 artifact。为避免绕过保护，本次写入已阻止；请重试工具调用。',
        'DENY_MISSING_FILE_PATH'
      );
    }
  }

  // v4.3.1: 项目外文件豁免（CWD 和 vault artifact 目录均视为"项目内"）
  // H-1: 使用 normalizePath 跨平台适配（Windows toLowerCase，Linux 保持原样）
  const normalizedFile = paceUtils.normalizePath(filePath);
  const normalizedCwd = paceUtils.normalizePath(cwd);
  if (isFileMutationTool(toolName) && paceUtils.isArtifactRuntimeControlPath(cwd, filePath)) {
    return hardDeny(
      `禁止使用 ${toolName} 修改 PaceFlow artifact 写入控制运行态：${filePath}。锁、编号计数、reservation 与索引事务只能由 hook 管理；不要手写或删除运行态文件。详细目标已记录到 hook 日志。`,
      'DENY_ARTIFACT_RUNTIME_CONTROL',
      {
        file: filePath,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
      }
    );
  }
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  let isInsideProject = normalizedFile.startsWith(cwdWithSlash);
  if (!isInsideProject && artDir !== cwd) {
    const normalizedArtDir = paceUtils.normalizePath(artDir);
    const artDirWithSlash = normalizedArtDir.endsWith('/') ? normalizedArtDir : normalizedArtDir + '/';
    isInsideProject = normalizedFile.startsWith(artDirWithSlash);
  }

  const artifactRelForMutation = getArtifactRelIfRelevant(toolName, isInsideProject, paceSignal, artDir, filePath);
  let artifactResourceLockHeld = null;
  if (artifactRelForMutation) {
    if (isArtifactWriterAgent(stdin)) {
      if (toolName === 'Write' && /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation)) {
        const fm = paceUtils.parseFrontmatter(content || '');
        const status = String(fm.status || '').replace(/^["']|["']$/g, '').trim();
        if (status && !['planned', 'in-progress', 'completed', 'archived', 'cancelled'].includes(status)) {
          const reason = `CHG/HOTFIX 详情 frontmatter status 非法：${status}。允许值：planned / in-progress / completed / archived / cancelled。create-chg 初始状态必须是 planned。`;
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_STATUS_INVALID', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            status,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            dur: Date.now() - t0,
          }));
          return;
        }
      }
      let reservation = paceUtils.findArtifactReservationForRel(cwd, {
        sessionId: stdin.sessionId,
        agentId: stdin.agentId,
      }, artifactRelForMutation);
      if (toolName === 'Write') {
        const writeNeedsReservation = !fs.existsSync(filePath) && (
          /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation) ||
          /^changes\/corrections\/correction-\d{4}-\d{2}-\d{2}-\d{2}-.+\.md$/i.test(artifactRelForMutation)
        );
        if (writeNeedsReservation && !reservation) {
          const reason = [
            `artifact-writer 正在新建 ${artifactRelForMutation}，但当前 session/agent 没有 hook 预留编号。`,
            '请从主 session 运行 reserve-artifact-id helper，把 helper 输出放进 artifact-writer prompt 顶部后重派。',
            '不要让 agent 自行扫描索引分配 CHG/HOTFIX/CORRECTION 编号。'
          ].join('\n');
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESERVATION_MISSING', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            dur: Date.now() - t0,
          }));
          return;
        }
        if (!reservation) {
          reservation = paceUtils.readArtifactReservation(cwd, {
            sessionId: stdin.sessionId,
            agentId: stdin.agentId,
          });
        }
        const reservationMatch = writeNeedsReservation
          ? paceUtils.reservationMatchesArtifactRel(reservation, artifactRelForMutation)
          : { ok: true };
        if (!reservationMatch.ok) {
          const reason = artifactReservationDenyReason(reservationMatch, artifactRelForMutation);
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESERVATION_MISMATCH', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            expected: reservationMatch.expected,
            dur: Date.now() - t0,
          }));
          return;
        }
      }
      const resource = paceUtils.artifactResourceForRel(artifactRelForMutation);
      const lockAttempt = paceUtils.acquireArtifactResourceLock(cwd, resource, {
        sessionId: stdin.sessionId,
        agentId: stdin.agentId,
        artifactDir: artDir,
        file: filePath,
        operation: reservation && reservation.operation || '',
        toolName,
      });
      if (!lockAttempt.acquired) {
        const reason = artifactResourceLockDenyReason(lockAttempt, resource, artifactRelForMutation);
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESOURCE_LOCK', {
          proj,
          tool: toolName,
          file: filePath,
          artifact: artifactRelForMutation,
          resource,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
          reason: lockAttempt.reason,
          dur: Date.now() - t0,
        }));
        return;
      }
      artifactResourceLockHeld = resource;
      log(paceUtils.logEntry('PreToolUse', lockAttempt.reentrant ? 'PASS_ARTIFACT_RESOURCE_LOCK_REENTRANT' : 'PASS_ARTIFACT_RESOURCE_LOCK', {
        proj,
        tool: toolName,
        file: filePath,
        artifact: artifactRelForMutation,
        resource,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
        waited_ms: lockAttempt.waitedMs || 0,
        dur: Date.now() - t0,
      }));
    } else {
      const resource = paceUtils.artifactResourceForRel(artifactRelForMutation);
      const existingLock = resource ? paceUtils.readArtifactResourceLock(cwd, resource) : { ok: false };
      if (existingLock.ok) {
        const reason = [
          `当前 artifact 正由 artifact-writer 写入，禁止主 session/其他 agent 同时修改 ${artifactRelForMutation}。`,
          '请等待 artifact 写入结束后再重试。'
        ].join('\n');
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_CONCURRENT_WRITE', {
          proj,
          tool: toolName,
          file: filePath,
          artifact: artifactRelForMutation,
          resource,
          owner: existingLock.sessionId,
          dur: Date.now() - t0,
        }));
        return;
      }
    }
  }

  // v4.8: artifact 已迁移到 vault 时，拦截对 CWD 中 artifact 文件的 Write/Edit 并重定向
  if (isFileMutationTool(toolName) && artDir !== cwd && paceSignal) {
    const cwdArtifactRel = paceUtils.artifactRelativePathForFile(cwd, filePath);
    if (cwdArtifactRel) {
      const correctPath = path.join(artDir, cwdArtifactRel).replace(/\\/g, '/');
      const reason = `当前 artifact_dir 是 ${displayDir(artDir)}。请将 artifact file_path 修改为：${correctPath}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_REDIRECT', { proj, tool: toolName, file: filePath, artifact: cwdArtifactRel, redirect: correctPath, dur: Date.now() - t0 }));
      return;
    }
  }

  if (isArtifactWriterManagedRel(artifactRelForMutation) && toolName === 'Write' && !isArtifactWriterAgent(stdin)) {
    return hardDeny(
      directArtifactMutationDenyReason(toolName, artifactRelForMutation),
      'DENY_DIRECT_ARTIFACT_WRITE',
      {
        artifact: artifactRelForMutation,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
      }
    );
  }

  if (isEditMutationTool(toolName) && isInsideProject && paceSignal) {
    const artifactRel = paceUtils.artifactRelativePathForFile(artDir, filePath);
    if (artifactRel && fs.existsSync(filePath) && isArtifactWriterAgent(stdin)) {
      try {
        const current = fs.readFileSync(filePath, 'utf8');
        const normalized = paceUtils.normalizeLineEndings(current);
        if (normalized !== current) {
          fs.writeFileSync(filePath, normalized, 'utf8');
          log(paceUtils.logEntry('PreToolUse', 'NORMALIZE_CRLF_ARTIFACT', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRel,
            dur: Date.now() - t0,
          }));
        }
      } catch(e) {
        log(paceUtils.logEntry('PreToolUse', 'NORMALIZE_CRLF_ARTIFACT_FAILED', {
          proj,
          tool: toolName,
          file: filePath,
          error: e.message,
          dur: Date.now() - t0,
        }));
      }
    }
  }

  // v4.3.2: Write 覆盖已有 artifact 保护（仅 PACE 项目内生效）
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    if (artifactRelForMutation && fs.existsSync(filePath)) {
      if (artifactResourceLockHeld) {
        paceUtils.releaseArtifactResourceLock(cwd, artifactResourceLockHeld, { sessionId: stdin.sessionId, agentId: stdin.agentId });
      }
      const reason = `禁止使用 Write 覆盖已有 artifact：${artifactRelForMutation}。create-chg 若遇到同名文件必须重新分配 CHG-ID；更新已有 artifact 请使用 Edit。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_WRITE_EXISTING_ARTIFACT', { proj, tool: toolName, file: filePath, artifact: artifactRelForMutation, dur: Date.now() - t0 }));
      return;
    }
    if (PROTECTED_ARTIFACTS.includes(fileName) && fs.existsSync(filePath)) {
      const reason = `禁止使用 Write 覆盖已有的 ${fileName}，请使用 Edit 工具进行修改。Write 会丢失全部历史内容。${FORMAT_SNIPPETS.skillRef}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_WRITE_ARTIFACT', { proj, tool: toolName, file: filePath, reason, dur: Date.now() - t0 }));
      return;
    }
  }

  // T-206: Write 新建 artifact 文件时，注入对应模板内容引导格式
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    if (ARTIFACT_FILES.includes(fileName) && !fs.existsSync(path.join(artDir, fileName))) {
      const TEMPLATES_DIR = path.join(__dirname, 'templates');
      const tmpl = path.join(TEMPLATES_DIR, fileName);
      if (fs.existsSync(tmpl)) {
        try {
          const tmplContent = paceUtils.normalizeLineEndings(fs.readFileSync(tmpl, 'utf8'));
          const ctx = `新建 ${fileName}：请严格按照以下官方模板格式，保留双区结构（${ARCHIVE_MARKER} 分隔符）和注释说明：\n\n${tmplContent}`;
          const output = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx } };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'INJECT_TEMPLATE', { proj, file: fileName, dur: Date.now() - t0 }));
          return;
        } catch(e) {}
      }
    }
  }

  // v4.4.1→v5.0.3: Obsidian 知识库笔记格式注入（Write 到 thoughts/knowledge 时注入格式要求）
  if (toolName === 'Write' && VAULT_PATH && filePath.endsWith('.md')) {
    const nf = normalizedFile;
    const vp = paceUtils.normalizePath(VAULT_PATH);
    const vpSlash = vp.endsWith('/') ? vp : vp + '/';
    let dirName = '';
    if (nf.startsWith(vpSlash + 'thoughts/')) dirName = 'thoughts';
    else if (nf.startsWith(vpSlash + 'knowledge/')) dirName = 'knowledge';
    if (dirName && path.basename(filePath) !== 'README.md') {
      const ctx = dirName === 'knowledge'
        ? '写入 knowledge/ 笔记时请先调用 Skill(paceflow:pace-knowledge)，按该 skill 的 frontmatter 与正文结构要求组织内容。'
        : '写入 thoughts/ 笔记时请先调用 Skill(paceflow:pace-knowledge)，按 thoughts 笔记格式组织 frontmatter 与正文。';
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'INJECT_FORMAT', { proj, file: filePath, dir: dirName, dur: Date.now() - t0 }));
      return;
    }
  }

  // v6: 项目一旦有 changes/，所有执行前检查只看详情文件与索引 wikilink。
  if (paceSignal === 'artifact') {
    const activeEntriesAll = getActiveChangeEntries(cwd);
    const actionableEntries = activeEntriesAll.filter(e => {
      const marks = [e.taskCheckbox, e.implCheckbox].filter(Boolean);
      return marks.some(m => m === ' ' || m === '/' || m === '!');
    });

    // 阻止主 session 直接手写 C/V 阶段标志；应派 artifact writer。
    const isChangeDetail = !!artifactRelForMutation &&
      /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation);
    const mutationText = newString || content || '';
    if (isFileMutationTool(toolName) && isInsideProject && isChangeDetail && mutationText) {
      const addedApproved = mutationText.includes('<!-- APPROVED -->') && !oldString.includes('<!-- APPROVED -->');
      const addedVerified = mutationText.includes('<!-- VERIFIED -->') && !oldString.includes('<!-- VERIFIED -->');
      const setVerifiedDate = paceUtils.hasNonNullVerifiedDate(mutationText) &&
        !paceUtils.hasNonNullVerifiedDate(oldString || '');
      if ((addedApproved || addedVerified || setVerifiedDate) && !isArtifactWriterAgent(stdin)) {
        const reason = `禁止主 session 直接写入 ${addedApproved ? 'APPROVED' : 'VERIFIED/verified-date'} 标志；请派 artifact-writer 执行对应批准或验证/收尾操作，字段格式见 Skill(paceflow:artifact-management)。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_MARKER${teammateTag}`, {
          proj,
          file: filePath,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
          addedApproved,
          addedVerified,
          setVerifiedDate,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (addedApproved || addedVerified || setVerifiedDate) {
        log(paceUtils.logEntry('PreToolUse', 'PASS_V6_MARKER_AGENT', {
          proj,
          file: filePath,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
          addedApproved,
          addedVerified,
          setVerifiedDate,
          dur: Date.now() - t0,
        }));
      }
    }

    if (isArtifactWriterManagedRel(artifactRelForMutation) && !isArtifactWriterAgent(stdin)) {
      return hardDeny(
        paceUtils.appendArtifactDirHint(cwd, directArtifactMutationDenyReason(toolName, artifactRelForMutation)),
        'DENY_DIRECT_ARTIFACT_EDIT',
        {
          artifact: artifactRelForMutation,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
        }
      );
    }

    if (isCodeFile && isInsideProject) {
      if (actionableEntries.length === 0) {
        const doneEntries = activeEntriesAll.filter(e => ['x', '-'].includes(e.taskCheckbox) || ['x', '-'].includes(e.implCheckbox));
        const reason = doneEntries.length > 0
          ? `v6 项目当前只有已完成/跳过索引，请先派 artifact-writer close-chg 收尾归档，或 create-chg 创建新的变更后再写代码。archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`
          : `v6 项目没有活跃 CHG/HOTFIX。请先创建 v6 CHG 后再写代码。\n${artifactWriterCreateChgHint(artDir)}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_NO_ACTIVE${teammateTag}`, { proj, tool: toolName, dur: Date.now() - t0 }));
        return;
      }

      const mismatched = actionableEntries.filter(e => !e.task || !e.impl);
      if (mismatched.length > 0) {
        const ids = mismatched.map(e => e.id).join(', ');
        const reason = `v6 索引不一致：${ids} 必须同时存在于 task.md 与 implementation_plan.md 活跃区。请派 artifact-writer 修复索引。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_INDEX_MISMATCH${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const missingDetails = actionableEntries.filter(e => !e.detail || e.detail.missing);
      if (missingDetails.length > 0) {
        const ids = missingDetails.map(e => e.id).join(', ');
        const reason = `v6 详情文件缺失：${ids} 对应 changes/<id>.md 不存在。请派 artifact-writer create-chg 或修复 wikilink。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_DETAIL_MISSING${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const approvedEntries = actionableEntries.filter(e => isChangeApproved(e.detail));
      if (approvedEntries.length === 0) {
        const ids = actionableEntries.map(e => e.id).join(', ');
        const reason = `v6 C 阶段未完成：${ids} 的详情文件缺少 <!-- APPROVED -->，且没有进行中任务。请确认用户是否已批准；若已批准并准备开始，派 artifact-writer approve-and-start，并带批准来源、证据和要开始的 task-id。字段格式见 Skill(paceflow:artifact-management)。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_C_PHASE${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const runnableEntries = approvedEntries.filter(e => {
        const fmStatus = (e.detail.frontmatter.status || '').replace(/^["']|["']$/g, '');
        return e.taskCheckbox === '/' && e.implCheckbox === '/' && fmStatus === 'in-progress';
      });
      if (runnableEntries.length === 0) {
        const ids = approvedEntries.map(e => e.id).join(', ');
        const reason = `v6 E 阶段未就绪：${ids} 已批准但索引/详情状态未进入 in-progress。若本次刚获得用户批准并准备开始，请派 artifact-writer approve-and-start；若此前已批准只需恢复执行，请派 update-chg action=update-status 将当前任务标为 [/] 并联动 frontmatter status。字段格式见 Skill(paceflow:artifact-management)。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_E_PHASE${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const summaries = summarizeActiveChanges(cwd)
        .filter(s => runnableEntries.some(e => e.slug === s.slug))
        .map(s => `- ${s.id} status=${s.status} task=${s.taskCheckbox} impl=${s.implCheckbox} pending=${s.pending} approved=${s.approved} verified=${s.verified} path=${s.path}`)
        .join('\n');
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `当前 v6 活跃变更：\n${summaries}`
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'PASS_V6', { proj, tool: toolName, entries: runnableEntries.length, dur: Date.now() - t0 }));
      return;
    }

    log(paceUtils.logEntry('PreToolUse', 'PASS_V6_NON_CODE', { proj, tool: toolName, dur: Date.now() - t0 }));
    return;
  }

  // v6-only：有 legacy task.md 但没有 changes/ 时，不再给 v5 自修提示。
  if (paceSignal && v5MigrationInfo.detected && taskFileExists && taskActiveContent.trim() && isInsideProject && (isCodeFile || ARTIFACT_FILES.includes(fileName))) {
    const reason = v5MigrationInfo.needsPrompt
      ? v5MigrationReason
      : `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。当前工具调用已被 hook 阻止，目标代码/artifact 尚未被修改。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 将当前计划桥接为 changes/<id>.md + task.md / implementation_plan.md wikilink 索引。不要继续在 task.md / implementation_plan.md 手写 v5 详情、APPROVED 或 VERIFIED。迁移或桥接后必须重试被阻止的原始工具调用；在写入工具成功前不要声称任务已完成。`;
    const output = denyOrHint(reason);
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', `DENY_LEGACY_ACTIVE${teammateTag}`, { proj, tool: toolName, file: filePath, reason, dur: Date.now() - t0 }));
    return;
  }

  // v5.0.1: native plan 桥接引导 — 检测 .pace/current-native-plan + task.md 无任务
  if (isCodeFile && isInsideProject && !hasActiveTasks && paceSignal) {
    const nativePlan = getNativePlanPath(cwd);
    if (nativePlan) {
      if (needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, dur: Date.now() - t0 }));
        return;
      }
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0
        ? `已自动创建 v6 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
        : `${artifactRootHint}。`;
      const reason = `${createdMsg}检测到未桥接的原生计划文件：${nativePlan}。请先调用 Skill(paceflow:pace-bridge)，按该 skill 将当前计划桥接为 v6 CHG 并记录同步标记；桥接完成后再重试本次代码写入。`;
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', `DENY_NATIVE_PLAN${teammateTag}`, { proj, plan: nativePlan, dur: Date.now() - t0 }));
      return;
    }
  }

  // v4.3.5: 多信号三级触发（仅对项目内代码文件 + 无活跃任务时生效）
  if (isCodeFile && isInsideProject && !hasActiveTasks) {
    // W-3: 使用顶层缓存的 paceSignal
    const codeCount = countCodeFiles(cwd);

    // 第一级：强信号 DENY（superpowers/manual/artifact/code-count）
    // I-06: isPaceProject() 返回 false 或字符串，truthy 检查等价于四重比较
    if (paceSignal) {
      if (v5MigrationInfo.needsPrompt) {
        const output = denyOrHint(v5MigrationReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V5_MIGRATION${teammateTag}`, {
          proj,
          signal: paceSignal,
          tool: toolName,
          file: filePath,
          artifact_dir: displayDir(v5MigrationInfo.dir),
          state_path: v5MigrationInfo.statePath,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, dur: Date.now() - t0 }));
        return;
      }
      // T-076: DENY 前懒创建缺失的模板文件；幂等同内容创建，不需要 artifact-writer 写锁。
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0
        ? `已自动创建 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
        : `${artifactRootHint}。`;

      // T-076: 场景化 DENY 消息
      let reason;
      // W-dry-2: 使用 formatBridgeHint 消除重复的 listPlanFiles + 格式化代码
      const bridgeHint = formatBridgeHint(cwd, artDir);
      if (paceSignal === 'superpowers' && bridgeHint) {
        reason = `${createdMsg}检测到 Superpowers 计划文件：${bridgeHint.fileList}。请执行桥接：${bridgeHint.bridgeSteps}\n${FORMAT_SNIPPETS.skillRef}`;
      } else if (paceSignal === 'superpowers') {
        reason = `${createdMsg}检测到 Superpowers 信号但无计划文件。请先执行 P-A-C 流程。\ntask.md 任务格式：${FORMAT_SNIPPETS.taskEntry}\nimpl_plan 索引格式：${FORMAT_SNIPPETS.implIndex}\n${FORMAT_SNIPPETS.skillRef}`;
      } else if (taskFileExists || createdFiles.includes('task.md')) {
        // W-flow-1: 区分"全部完成待归档"和"无任务"
        const hasDoneItems = /- \[[x\-]\]/.test(taskActiveContent);
        if (hasDoneItems) {
          reason = `${createdMsg}检测到 PACE 项目（${paceSignal}）但 task.md 中无进行中的活跃任务（全部已完成/跳过）。请先用 close-chg 收尾归档已完成任务，再定义新任务后写代码。\n收尾方法：${FORMAT_SNIPPETS.closeOp}`;
        } else {
          reason = `${createdMsg}检测到 PACE 项目（${paceSignal}）但 task.md 中无活跃任务。`;
          reason += hasUnsyncedPlanFiles(cwd)
            ? `检测到未同步的 Superpowers 计划文件，请调用 paceflow:pace-bridge：Read plan → 派 artifact-writer create-chg 创建 v6 CHG 后再写代码。`
            : `请先执行 P-A-C 流程（Plan→Artifact→Check）定义任务后再写代码。\n${artifactWriterCreateChgHint(artDir)}\ntask.md 格式：${FORMAT_SNIPPETS.taskGroup}\nimpl_plan 索引格式：${FORMAT_SNIPPETS.implIndex}\n任务状态：${FORMAT_SNIPPETS.statusHelp}\n变更状态：${FORMAT_SNIPPETS.changeStatusHelp}`;
        }
      } else {
        reason = `${createdMsg}检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在。\n${artifactWriterCreateChgHint(artDir)}\n${FORMAT_SNIPPETS.skillRef}`;
      }
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', `DENY${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, created: createdFiles.join(', '), reason, dur: Date.now() - t0 }));
      return;
    }

    // T-079: 第二级 — off-by-one 前瞻判断（无强信号但 Write 新文件将达到阈值）
    if (!paceSignal && toolName === 'Write' && !fs.existsSync(filePath)) {
      const futureCount = codeCount + 1;
      if (futureCount >= 3) {
        if (needsArtifactRootChoice) {
          const output = denyOrHint(artifactRootChoiceReason);
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, dur: Date.now() - t0 }));
          return;
        }
        let createdFiles = [];
        try { createdFiles = createTemplates(cwd); } catch(e) {}
        const createdMsg = createdFiles.length > 0
          ? `已自动创建 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
          : `${artifactRootHint}。`;
        const reason = `${createdMsg}即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先创建 v6 CHG；若用户已批准并准备开始，派 artifact-writer approve-and-start 后再写代码。字段格式见 Skill(paceflow:artifact-management)。\n${artifactWriterCreateChgHint(artDir)}\n${FORMAT_SNIPPETS.skillRef}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, created: createdFiles.join(', '), reason, dur: Date.now() - t0 }));
        return;
      }
    }

    // 第三级：软提醒（1-2 个代码文件）
    if (codeCount >= 1) {
      // I-9: 变量名语义化
      const isNewFileForHint = toolName === 'Write' && !fs.existsSync(filePath);
      const displayCountForHint = codeCount + (isNewFileForHint ? 1 : 0);
      const ctx = `提醒：这是项目中的第 ${displayCountForHint} 个代码文件，如果这是正式项目，建议先派 artifact-writer create-chg 建立 v6 CHG 后再继续写代码。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'SOFT_WARN', { proj, codeCount: displayCountForHint, tool: toolName, file: filePath, output: ctx, dur: Date.now() - t0 }));
      return;
    }

    // W-code-6: 当前无代码文件，不触发
    log(paceUtils.logEntry('PreToolUse', 'SKIP', { proj, tool: toolName, reason: 'no-trigger', dur: Date.now() - t0 }));
    return;
  }

  // 非 v6 的 legacy task.md 不再作为可执行上下文注入。
  if (taskFileExists && taskActiveContent) {
    const ctx = paceUtils.appendArtifactDirHint(cwd, `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。迁移或桥接只处理 artifact 状态，不能算作完成原始代码任务；之后必须重试被阻止的原始工具调用。`);
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: ctx
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', 'PASS', { proj, tool: toolName, injected: taskActiveContent.split('\n').length, dur: Date.now() - t0 }));
  } else {
    log(paceUtils.logEntry('PreToolUse', 'SKIP', { proj, tool: toolName, reason: 'no-task-content', dur: Date.now() - t0 }));
  }
  } catch(e) {
    try { log(paceUtils.logEntry('PreToolUse', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  }
});
