// PreToolUse hook：多信号三级触发 + 懒创建模板 + C 阶段批准 + E 阶段 impl_plan [/] 检查
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, hasUnsyncedPlanFiles, CODE_EXTS, ARTIFACT_FILES, createTemplates, VAULT_PATH, readActive, isTeammate, getArtifactDir, formatBridgeHint, getNativePlanPath, getProjectName, ts, FORMAT_SNIPPETS, ARCHIVE_MARKER, getActiveChangeEntries, countDetailTasks, isChangeApproved, summarizeActiveChanges, artifactRootChoiceNeeded, artifactRootChoiceMessage } = paceUtils;

// I-05: 常量提升到模块级（ARTIFACT_FILES 是静态数组，filter 结果不变）
const PROTECTED_ARTIFACTS = ARTIFACT_FILES.filter(f => f !== 'spec.md');

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);

function hasNonNullVerifiedDate(text) {
  const match = String(text || '').match(/^verified-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim();
  return value !== '' && value !== 'null';
}

function isArtifactWriterAgent(stdin) {
  return ['artifact-writer', 'paceflow:artifact-writer'].includes(stdin.agentType || '');
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

function bashCommandLooksMutating(command) {
  const c = String(command || '');
  return /(^|[;&|]\s*)(sed\b[^;\n]*\s-i(?:\b|[.\w'-])|perl\b[^;\n]*\s-[^\s;]*pi\b|rm\b|mv\b|cp\b|touch\b|mkdir\b|rmdir\b|truncate\b|tee\b|dd\b|install\b|chmod\b|chown\b|dos2unix\b|unix2dos\b|git\s+(?:checkout|restore|clean|reset|mv|rm)\b)/i.test(c) ||
    /(^|[;&|]\s*)(python\d*|node)\b[\s\S]*(?:writeFile|appendFile|rmSync|renameSync|mkdirSync|write_text|write_bytes|open\s*\()/i.test(c);
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

function bashPathLooksArtifact(target, cwd, artDir) {
  const t = String(target || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!t || /^&\d+$/.test(t)) return false;
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => String(dir).replace(/\\/g, '/').replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (t === `${root}/${file}`) return true;
    }
    if (t.startsWith(`${root}/changes/`)) return true;
  }
  return /^(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)$/.test(t) ||
    /^(?:\.\/)?changes\//.test(t);
}

function bashCommandRedirectsToArtifact(command, cwd, artDir) {
  return bashOutputRedirectTargets(command).some(target => bashPathLooksArtifact(target, cwd, artDir));
}

function bashCommandReferencesArtifact(command, cwd, artDir) {
  const c = String(command || '').replace(/\\/g, '/');
  const roots = [...new Set([cwd, artDir].filter(Boolean).map(dir => String(dir).replace(/\\/g, '/').replace(/\/+$/, '')))];
  for (const root of roots) {
    for (const file of ARTIFACT_FILES) {
      if (c.includes(`${root}/${file}`)) return true;
    }
    if (c.includes(`${root}/changes/`)) return true;
  }
  return /(^|[\s"'`=])(?:\.\/)?(?:task\.md|implementation_plan\.md|walkthrough\.md|findings\.md|corrections\.md|spec\.md)(?=$|[\s"'`;|&<>])/.test(c) ||
    /(^|[\s"'`=])(?:\.\/)?changes\//.test(c);
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
  const agentType = String(stdin.toolInput.subagent_type || stdin.toolInput.subagentType || '').toLowerCase();
  return agentType === 'artifact-writer' || agentType === 'paceflow:artifact-writer' || agentType.endsWith(':artifact-writer');
}

function displayDir(dir) {
  return String(dir || '').replace(/\\/g, '/').replace(/\/?$/, '/');
}

function normalizeArtifactDirValue(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
    raw = raw.slice(1, -1).trim();
  }
  return raw.replace(/\\/g, '/').replace(/\/+$/, '');
}

function extractPromptArtifactDir(prompt) {
  const match = String(prompt || '').match(/^\s*artifact_dir\s*:\s*(.+?)\s*$/mi);
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
    '所有 task.md / implementation_plan.md / changes/** 读写都必须使用该目录。',
    '不要让 artifact-writer fallback 到 cwd，也不要写到 docs/ 等子目录；cwd 可能只是代码工作目录，不是 artifact 根目录。'
  ].join('\n');
}

function promptHasTrueField(prompt, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[\\n\\s])${escaped}\\s*[:=]\\s*true\\b`, 'i').test(String(prompt || ''));
}

function promptHasNonEmptyField(prompt, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*${escaped}\\s*:\\s*\\S+`, 'mi').test(String(prompt || ''));
}

function promptMentionsVerifyAction(prompt) {
  const text = String(prompt || '');
  return /(?:^|[\s\n])action\s*[:=]\s*verify\b/i.test(text) ||
    /\bupdate-chg\s+action=verify\b/i.test(text) ||
    /执行\s*verify\s*操作/i.test(text) ||
    /\bverify\s+操作/i.test(text);
}

function agentLifecyclePromptDenyReason(prompt) {
  const text = String(prompt || '');
  const mentionsApproveAndStart = /\bapprove-and-start\b/i.test(text);
  const mentionsCloseChg = /\bclose-chg\b/i.test(text);
  const mentionsUpdateStatus = /\bupdate-status\b/i.test(text);

  if (mentionsApproveAndStart && !promptHasTrueField(text, 'approval-confirmed')) {
    return [
      '派 artifact-writer 执行 approve-and-start 时缺少 approval-confirmed: true。',
      'approve-and-start 只能在用户已明确批准、且准备开始某个 T-NNN 后调用；agent 不得自行推断批准。',
      '请先用 AskUserQuestion 获取批准；批准后重派，并在 prompt 中写明：',
      'approval-confirmed: true',
      'task-id: T-NNN'
    ].join('\n');
  }

  if (mentionsUpdateStatus && promptMentionsVerifyAction(text) && !mentionsCloseChg) {
    return [
      '不要把 update-status 与 update-chg action=verify 串在同一次 agent 派遣中。',
      '验证是确认边界：主 session 必须先运行验证命令并读取结果，确认通过后才允许写 VERIFIED。',
      '如果只是中间任务完成：只派 update-chg action=update-status。',
      '如果这是最后任务且验证已通过：直接派 close-chg complete-open-tasks: true，合并完成状态、VERIFIED、归档和 walkthrough。'
    ].join('\n');
  }

  if (mentionsCloseChg) {
    const missing = [];
    if (!promptHasTrueField(text, 'verification-confirmed')) missing.push('verification-confirmed: true');
    if (!promptHasNonEmptyField(text, 'verify-summary')) missing.push('verify-summary');
    if (!promptHasNonEmptyField(text, 'walkthrough-summary')) missing.push('walkthrough-summary');
    if (missing.length > 0) {
      return [
        `派 artifact-writer 执行 close-chg 时缺少必填字段：${missing.join(', ')}。`,
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
    if (isTeammate()) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `PACE 提醒（teammate 模式）：${reason}` } };
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
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
  const needsArtifactRootChoice = artifactRootChoiceNeeded(cwd);
  const artifactRootChoiceReason = needsArtifactRootChoice ? artifactRootChoiceMessage(cwd) : '';
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
        const ensured = ensureArtifactWriterBase();
        if (ensured.missingAfter.length > 0) {
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
        const created = [...new Set([
          ...ensured.createdFiles,
          ...(ensured.missingBefore.includes('changes/') ? ['changes/'] : []),
          ...(ensured.missingBefore.includes('changes/findings/') ? ['changes/findings/'] : []),
          ...(ensured.missingBefore.includes('changes/corrections/') ? ['changes/corrections/'] : []),
        ])];
        const createdMsg = created.length > 0 ? `；已自动创建 Artifact 基础模板：${created.join(', ')}` : '';
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: `artifact-writer ARTIFACT_DIR 已确认：${displayDir(artDir)}${createdMsg}`
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT_ARTIFACT_BASE', {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(artDir),
          created: created.join(', '),
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT', { proj, tool: toolName, dur: Date.now() - t0 }));
      return;
    }
    if (isBashTool(toolName)) {
      const mutatesArtifact = bashCommandRedirectsToArtifact(bashCommand, cwd, artDir) ||
        (bashCommandLooksMutating(bashCommand) && bashCommandReferencesArtifact(bashCommand, cwd, artDir));
      if (mutatesArtifact) {
        const reason = bashArtifactDenyReason(bashCommand);
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
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  let isInsideProject = normalizedFile.startsWith(cwdWithSlash);
  if (!isInsideProject && artDir !== cwd) {
    const normalizedArtDir = paceUtils.normalizePath(artDir);
    const artDirWithSlash = normalizedArtDir.endsWith('/') ? normalizedArtDir : normalizedArtDir + '/';
    isInsideProject = normalizedFile.startsWith(artDirWithSlash);
  }

  // v4.8: artifact 已迁移到 vault 时，拦截对 CWD 中 artifact 文件的 Write/Edit 并重定向
  if (isFileMutationTool(toolName) && artDir !== cwd && paceSignal) {
    const cwdArtifactRel = paceUtils.artifactRelativePathForFile(cwd, filePath);
    if (cwdArtifactRel) {
      const correctPath = path.join(artDir, cwdArtifactRel).replace(/\\/g, '/');
      const reason = `artifact 文件已迁移到 Obsidian vault。请将 file_path 修改为：${correctPath}`;
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

  if (isEditMutationTool(toolName) && isInsideProject && paceSignal) {
    const artifactRel = paceUtils.artifactRelativePathForFile(artDir, filePath);
    if (artifactRel && fs.existsSync(filePath)) {
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
        ? `写入 knowledge/ 笔记，必须包含以下格式：\n` +
          `YAML frontmatter 示例：\n---\nstatus: discussing\nprojects: [项目名]\ntags: [标签1, 标签2]\nsummary: "≤80字关键结论"\ncreated: YYYY-MM-DDTHH:mm:ss+08:00\nupdated: YYYY-MM-DDTHH:mm:ss+08:00\nsources: [来源]\n---\n` +
          `正文结构：## 摘要（L1，300-500 tokens 关键结论列表）+ ## 详情（L2，完整内容含代码示例、对比表格、### 子章节）`
        : `写入 thoughts/ 笔记，请包含 YAML frontmatter（status/projects/tags/summary/created/updated）和 ## 摘要 + ## 详情 结构。`;
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
    const isChangeDetail = /\/changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(normalizedFile);
    const mutationText = newString || content || '';
    if (isFileMutationTool(toolName) && isInsideProject && isChangeDetail && mutationText) {
      const addedApproved = mutationText.includes('<!-- APPROVED -->') && !oldString.includes('<!-- APPROVED -->');
      const addedVerified = mutationText.includes('<!-- VERIFIED -->') && !oldString.includes('<!-- VERIFIED -->');
      const setVerifiedDate = hasNonNullVerifiedDate(mutationText) &&
        !hasNonNullVerifiedDate(oldString || '');
      if ((addedApproved || addedVerified || setVerifiedDate) && !isArtifactWriterAgent(stdin)) {
        const reason = `禁止主 session 直接写入 ${addedApproved ? 'APPROVED' : 'VERIFIED/verified-date'} 标志；请派 artifact-writer 执行 ${addedApproved ? 'update-chg action=approve 或 approve-and-start' : 'update-chg action=verify 或 close-chg'}。`;
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

    if (isCodeFile && isInsideProject) {
      if (actionableEntries.length === 0) {
        const doneEntries = activeEntriesAll.filter(e => ['x', '-'].includes(e.taskCheckbox) || ['x', '-'].includes(e.implCheckbox));
        const reason = doneEntries.length > 0
          ? `v6 项目当前只有已完成/跳过索引，请先派 artifact-writer close-chg 收尾归档，或 create-chg 创建新的变更后再写代码。archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`
          : `v6 项目没有活跃 CHG/HOTFIX。请派 artifact-writer create-chg 创建 changes/<id>.md，并同步 task.md / implementation_plan.md 索引后再写代码。`;
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
        const reason = `v6 C 阶段未完成：${ids} 的详情文件缺少 <!-- APPROVED -->，且没有进行中任务。请询问用户是否批准；批准并准备开始时，派 artifact-writer update-chg action=approve-and-start（需 approval-confirmed: true + task-id）。${FORMAT_SNIPPETS.approveAndStartOp}`;
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
        const reason = `v6 E 阶段未就绪：${ids} 已批准但索引/详情状态未进入 in-progress。若本次刚获得用户批准，请派 artifact-writer update-chg action=approve-and-start（需 approval-confirmed: true + task-id）；若已批准只需开始任务，请派 update-chg action=update-status 将当前任务标为 [/] 并联动 frontmatter status。`;
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
  if (paceSignal && taskFileExists && taskActiveContent.trim() && isInsideProject && (isCodeFile || ARTIFACT_FILES.includes(fileName))) {
    const reason = `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 将当前计划桥接为 changes/<id>.md + task.md / implementation_plan.md wikilink 索引。不要继续在 task.md / implementation_plan.md 手写 v5 详情、APPROVED 或 VERIFIED。`;
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
      const createdMsg = createdFiles.length > 0 ? `已自动创建 v6 Artifact 模板（${createdFiles.join(', ')}）。` : '';
      const reason = `${createdMsg}检测到未桥接的原生计划文件：${nativePlan}。请执行桥接：Read ${nativePlan} → 派 artifact-writer create-chg 创建 changes/<id>.md 与 task.md / implementation_plan.md wikilink 索引；若计划已获用户确认并准备开始，再派 update-chg action=approve-and-start；完成后删除 .pace/current-native-plan。`;
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
      if (needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, dur: Date.now() - t0 }));
        return;
      }
      // T-076: DENY 前懒创建缺失的模板文件
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0 ? `已自动创建 Artifact 模板（${createdFiles.join(', ')}）。` : '';

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
            : `请先执行 P-A-C 流程（Plan→Artifact→Check）定义任务后再写代码。\ntask.md 格式：${FORMAT_SNIPPETS.taskGroup}\nimpl_plan 索引格式：${FORMAT_SNIPPETS.implIndex}\n任务状态：${FORMAT_SNIPPETS.statusHelp}\n变更状态：${FORMAT_SNIPPETS.changeStatusHelp}`;
        }
      } else {
        reason = `${createdMsg}检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在。请派 artifact-writer create-chg 创建 changes/<id>.md 与 task.md / implementation_plan.md wikilink 索引。\n${FORMAT_SNIPPETS.skillRef}`;
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
        const createdMsg = createdFiles.length > 0 ? `已自动创建 Artifact 模板（${createdFiles.join(', ')}）。` : '';
        const reason = `${createdMsg}即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先派 artifact-writer create-chg 创建 v6 CHG，获取用户批准并执行 update-chg action=approve-and-start（需 approval-confirmed: true + task-id）后再写代码。\n${FORMAT_SNIPPETS.skillRef}`;
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
    const ctx = `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。`;
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
