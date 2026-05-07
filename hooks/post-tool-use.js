// PostToolUse hook：通过 JSON additionalContext 向 AI 反馈（多信号检测 + stdin 工具类型过滤 + Claude 任务列表同步提醒）
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, readActive, checkArchiveFormat, ARTIFACT_FILES, VAULT_PATH, getProjectName, ts, FORMAT_SNIPPETS, getActiveChangeEntries, countDetailTasks, isChangeVerified } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);

const PACE_RUNTIME = path.join(cwd, '.pace');

// S-1: 统一 stdin 解析
paceUtils.withStdinParsed((stdin) => {
  try {
  const t0 = Date.now();
  // H-1: 非 PACE 项目直接放行（.pace/disabled 豁免）
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) {
    log(paceUtils.logEntry('PostToolUse', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
    return;
  }

  const { toolName, filePath, content } = stdin;
  const editList = Array.isArray(stdin.toolInput.edits) ? stdin.toolInput.edits : [];
  const oldString = stdin.oldString || editList.map(e => e.old_string || '').join('\n');
  const newString = stdin.newString || editList.map(e => e.new_string || '').join('\n');

  const warnings = [];
  // W-dry-4: 每会话首次提醒辅助函数（flag 检查+写入去重）
  function warnOnce(flagName, message) {
    const flagFile = path.join(PACE_RUNTIME, flagName);
    if (fs.existsSync(flagFile)) return false;
    warnings.push(message);
    // W-12: 确保 .pace/ 目录存在（极端边缘：PostToolUse 先于 SessionStart 触发时）
    try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
    try { fs.writeFileSync(flagFile, '1', 'utf8'); } catch(e) {}
    return true;
  }
  const fileName = filePath ? path.basename(filePath) : '';
  const isArtifactEdit = ARTIFACT_FILES.includes(fileName);
  const normalizedFile = paceUtils.normalizePath(filePath || '');
  const isChangeDetailEdit = /\/changes\/.+\.md$/i.test(normalizedFile);
  const isV6ArtifactEdit = isArtifactEdit || isChangeDetailEdit;

  const taskActive = readActive(cwd, 'task.md');

  // v4.3.4: 检测 Stop 降级标记
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  if (fs.existsSync(degradedFile)) {
    try {
      const degradedContent = fs.readFileSync(degradedFile, 'utf8').trim();
      warnings.push(`Stop hook 已降级（连续阻止 3 次后不再阻止退出，但问题未修复）。未通过的检查项：\n${degradedContent}\n请逐项解决上述问题。`);
    } catch(e) {
      warnings.push(`Stop hook 已降级，请检查 .pace/degraded 文件`);
    }
  }

  if (paceSignal === 'artifact') {
    if (isArtifactEdit) {
      const archFmt = checkArchiveFormat(cwd, fileName);
      if (archFmt) warnings.push(archFmt);
    }

    if (isChangeDetailEdit && filePath && fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const fm = paceUtils.parseFrontmatter(content);
        if (!fm['schema-version']) warnings.push(`${filePath} 缺少 frontmatter schema-version。请派 artifact-writer 修复 schema。`);
        if (/\/changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(normalizedFile)) {
          if (!fm.status) warnings.push(`${filePath} 缺少 frontmatter status。`);
          if (!('verified-date' in fm)) warnings.push(`${filePath} 缺少 frontmatter verified-date。`);
        }
      } catch(e) {}
    }

    const mutationText = newString || content || '';
    if (isChangeDetailEdit && mutationText) {
      const addedApproved = mutationText.includes('<!-- APPROVED -->') && !oldString.includes('<!-- APPROVED -->');
      const addedVerified = mutationText.includes('<!-- VERIFIED -->') && !oldString.includes('<!-- VERIFIED -->');
      const setVerifiedDate = paceUtils.hasNonNullVerifiedDate(mutationText) &&
        !paceUtils.hasNonNullVerifiedDate(oldString || '');
      if ((addedApproved || addedVerified || setVerifiedDate) && !paceUtils.isArtifactWriterAgentType(stdin.agentType)) {
        warnings.push(`检测到 C/V 阶段标志被直接写入 ${path.basename(filePath)}。v6 唯一路径是 artifact-writer 的 ${addedApproved ? 'update-chg action=approve 或 approve-and-start（均需 approval-confirmed/source/evidence）' : 'update-chg action=verify 或 close-chg'}。`);
      }
    }

    const entries = getActiveChangeEntries(cwd);
    const mismatched = entries.filter(e => !e.task || !e.impl);
    if (mismatched.length > 0) {
      warnings.push(`v6 索引不一致：${mismatched.map(e => e.id).join(', ')} 未同时存在于 task.md 和 implementation_plan.md。`);
    }

    for (const entry of entries) {
      if (!entry.detail || entry.detail.missing) continue;
      const status = (entry.detail.frontmatter.status || '').replace(/^["']|["']$/g, '');
      const tasks = countDetailTasks(entry.detail.content);
      if ((entry.taskCheckbox === 'x' || entry.implCheckbox === 'x') && !['completed', 'archived'].includes(status)) {
        warnings.push(`${entry.id} 索引 [x] 与详情 status=${status || 'missing'} 不一致，请派 update-chg action=update-status 修复。`);
      }
      if (status === 'completed' && !isChangeVerified(entry.detail)) {
        warnings.push(`${entry.id} 已 completed 但缺少 verified-date 或 <!-- VERIFIED -->。请先运行验证并阅读结果；确认通过后派 close-chg complete-open-tasks: true，或只记录验证暂不归档时派 update-chg action=verify。`);
      }
      if (status === 'completed' && isChangeVerified(entry.detail)) {
        warnOnce(`archive-reminded-${entry.slug}`, `${entry.id} 已验证但仍在活跃索引中，请优先派 close-chg 归档；archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`);
      }
      if (tasks.blocked > 0) {
        warnings.push(`${entry.id} 有 ${tasks.blocked} 个阻塞任务，请用 AskUserQuestion 询问用户如何处理。`);
      }
    }

    if (/\/changes\/corrections\/.+\.md$/i.test(normalizedFile) && newString) {
      warnings.push('检测到 correction 详情变更。请确认已同步写入 knowledge/ 或在 corrections.md 索引标注 [knowledge:: project-only]。');
    }
  } else if (taskActive) {
    warnings.push(`检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。PostToolUse 不再校验或修复 v5 活跃详情格式。`);
  } else {
    // task.md 不存在时：v4.3 多信号检测
    const fallbackSignal = isPaceProject(cwd);
    if (fallbackSignal === 'superpowers' || fallbackSignal === 'manual') {
      warnings.push(`检测到 PACE 激活信号（${fallbackSignal}）但 task.md 不存在，请先创建 Artifact 文件。task.md 格式：${FORMAT_SNIPPETS.taskGroup}`);
    } else {
      const codeCount = countCodeFiles(cwd);
      if (codeCount >= 3) {
        warnings.push(`检测到 ${codeCount} 个代码文件但 task.md 不存在。如果这是 PACE 任务，请先创建 Artifact 文件。task.md 格式：${FORMAT_SNIPPETS.taskGroup}`);
      }
    }
  }

  // H12: Obsidian 索引刷新 — artifact 写入后异步触发（每会话 1 次，fire-and-forget）
  // 无论 CLI 是否成功，每会话只触发一次（flag 在 spawn 后立即写入）
  const cliRefreshFile = path.join(PACE_RUNTIME, 'cli-refresh-done');
  if (isV6ArtifactEdit && filePath && VAULT_PATH && !fs.existsSync(cliRefreshFile)) {
    try {
      // H-1: 使用 normalizePath 跨平台适配（Windows toLowerCase，Linux 保持原样）
      const normFile = paceUtils.normalizePath(filePath);
      const normVault = paceUtils.normalizePath(VAULT_PATH);
      if (normFile.startsWith(normVault + '/')) {
        const relPath = path.relative(VAULT_PATH, filePath).replace(/\\/g, '/');
        // 延迟加载：仅 vault 内文件编辑时才 require（避免非 Obsidian 环境报错）
        const { spawn } = require('child_process');
        // fire-and-forget：CLI 读取文件促进 Obsidian 感知外部变更
        const child = spawn('obsidian', ['read', '--file', relPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        // H-1: 防御性 error 监听（fire-and-forget 模式下 ENOENT 等不会未捕获）
        child.on('error', () => {});
        child.unref();
        // W-4: flag 在 spawn 后写入——若 spawn 同步抛错（ENOENT），catch 捕获，flag 不写入，允许下次重试
        fs.writeFileSync(cliRefreshFile, '1', 'utf8');
      }
    } catch(e) {
      // CLI 不可用（未安装/Obsidian 未运行），静默跳过，不写 flag 允许下次重试
    }
  }

  // I-8: warnings 通过 additionalContext 输出给 AI（单条拼接，非逐条输出）
  if (warnings.length > 0) {
    const ctx = `PACE 提醒：${warnings.join('；')}`;
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: ctx
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PostToolUse', 'WARN', { proj, tool: toolName, file: filePath || '-', checks: warnings.length, output: ctx, dur: Date.now() - t0 }));
  } else {
    log(paceUtils.logEntry('PostToolUse', 'PASS', { proj, tool: toolName, dur: Date.now() - t0 }));
  }
  } catch(e) {
    try { log(paceUtils.logEntry('PostToolUse', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  }
});
