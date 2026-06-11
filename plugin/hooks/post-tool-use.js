// PostToolUse hook：通过 JSON additionalContext 向 AI 反馈（多信号检测 + stdin 工具类型过滤 + artifact 终态提醒）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, readActive, checkArchiveFormat, ARTIFACT_FILES, CODE_EXTS, VAULT_PATH, getArtifactDir, getProjectName, ts, FORMAT_SNIPPETS, getActiveChangeEntries, countDetailTasks, isChangeVerified, isChangeReviewed } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const projectLogEntry = (hook, action, fields = {}) => paceUtils.projectLogEntry(cwd, hook, action, fields);

const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);

// S-1: 统一 stdin 解析
paceUtils.withStdinParsed((stdin) => {
  try {
  const t0 = Date.now();
  // H-1: 非 PACE 项目直接放行（.pace/disabled 豁免）
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) {
    log(projectLogEntry('PostToolUse', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
    return;
  }

  const { toolName, filePath, content } = stdin;
  const editList = Array.isArray(stdin.toolInput.edits) ? stdin.toolInput.edits : [];
  const oldString = stdin.oldString || editList.map(e => e.old_string || '').join('\n');
  const newString = stdin.newString || editList.map(e => e.new_string || '').join('\n');

  const warnings = [];
  const continueBlocks = [];
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
  const resolvedFilePath = filePath ? paceUtils.resolveToolFilePath(cwd, filePath) : '';
  const artDir = paceSignal === 'artifact' ? getArtifactDir(cwd) : cwd;
  const artifactRel = resolvedFilePath ? paceUtils.artifactRelativePathForFile(artDir, resolvedFilePath) : null;
  const fileName = artifactRel ? path.basename(artifactRel) : (filePath ? path.basename(filePath) : '');
  const isFileMutationTool = ['Write', 'Edit', 'MultiEdit'].includes(toolName);
  const isCodeFile = resolvedFilePath && CODE_EXTS.some(ext => resolvedFilePath.endsWith(ext));
  const isArtifactEdit = !!artifactRel && ARTIFACT_FILES.includes(artifactRel);
  const normalizedFile = paceUtils.normalizePath(resolvedFilePath || filePath || '');
  const isChangeDetailEdit = !!artifactRel && /^changes\/.+\.md$/i.test(artifactRel);
  const isV6ArtifactEdit = isArtifactEdit || isChangeDetailEdit;
  function continueBlockOnce(kind, basis, reason) {
    const hash = crypto.createHash('sha1').update(String(basis || kind)).digest('hex').slice(0, 12);
    const flagFile = path.join(PACE_RUNTIME, `post-continue-${kind}-${hash}`);
    if (fs.existsSync(flagFile)) return false;
    try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
    try { fs.writeFileSync(flagFile, '1', 'utf8'); } catch(e) {}
    continueBlocks.push({ kind, reason });
    return true;
  }

  function changeIdsFromMessages(messages) {
    const ids = new Set();
    for (const message of messages) {
      for (const match of String(message || '').matchAll(/\b(?:CHG|HOTFIX)-\d{8}-\d{2}\b/gi)) {
        ids.add(match[0].toUpperCase());
      }
    }
    return [...ids].sort();
  }
  if (paceSignal === 'artifact' && stdin.sessionId && isFileMutationTool && isCodeFile && !isV6ArtifactEdit) {
    // CHG-20260611-02：心跳前先 revive 本 session 的 detached 记录（同 pre-tool-use，spec §3.2）。
    paceUtils.reviveDetachedChangeOwnersForSession(cwd, { sessionId: stdin.sessionId });
    const touched = paceUtils.touchChangeOwnersForSession(cwd, {
      sessionId: stdin.sessionId,
      states: ['active', 'closing'],
    });
    if (touched.length > 0) {
      log(projectLogEntry('PostToolUse', 'CHANGE_OWNER_HEARTBEAT', {
        proj,
        tool: toolName,
        changes: touched.join(','),
        dur: Date.now() - t0,
      }));
    }
  }
  if (artifactRel && paceUtils.isArtifactWriterAgentType(stdin.agentType)) {
    const resource = paceUtils.artifactResourceForRel(artifactRel);
    if (resource) {
      const release = resource === 'index:changes'
        ? paceUtils.markIndexChangesTouchedAndMaybeRelease(cwd, artifactRel, { sessionId: stdin.sessionId, agentId: stdin.agentId })
        : paceUtils.releaseArtifactResourceLock(cwd, resource, { sessionId: stdin.sessionId, agentId: stdin.agentId });
      const reservationCleared = toolName === 'Write'
        ? paceUtils.clearArtifactReservationForRel(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId }, artifactRel)
        : false;
      log(projectLogEntry('PostToolUse', release.released ? 'RELEASE_ARTIFACT_RESOURCE_LOCK' : 'KEEP_ARTIFACT_RESOURCE_LOCK', {
        proj,
        tool: toolName,
        file: filePath || '-',
        artifact: artifactRel,
        resource,
        agent_id: stdin.agentId,
        reason: release.reason || '',
        touched: Array.isArray(release.touched) ? release.touched.join(',') : '',
        reservation_cleared: reservationCleared ? 'yes' : '',
        dur: Date.now() - t0,
      }));
    }
  }
  const runtimeConfigPaths = [
    paceUtils.getArtifactRootChoicePath(cwd),
    paceUtils.getV5MigrationStatePath(cwd),
  ];
  const isRuntimeConfigEdit = runtimeConfigPaths.some(fp => normalizedFile === paceUtils.normalizePath(fp));
  if (isRuntimeConfigEdit) {
    log(projectLogEntry('PostToolUse', 'PASS_RUNTIME_CONFIG', { proj, tool: toolName, file: filePath || '-', dur: Date.now() - t0 }));
    return;
  }

  const taskActive = readActive(cwd, 'task.md');

  // v4.3.4: 检测 Stop 降级标记
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  if (fs.existsSync(degradedFile)) {
    try {
      const degradedContent = fs.readFileSync(degradedFile, 'utf8').trim();
      warnings.push(`Stop 检查仍有未解决项：\n${degradedContent}\n请逐项解决上述问题。`);
    } catch(e) {
      warnings.push('Stop 检查仍有未解决项，请重新运行收尾检查。');
    }
  }

  if (paceSignal === 'artifact') {
    if (isArtifactEdit) {
      const archFmt = checkArchiveFormat(cwd, fileName);
      if (archFmt) warnings.push(archFmt);
    }

    if (isChangeDetailEdit && resolvedFilePath && fs.existsSync(resolvedFilePath)) {
      try {
        const content = fs.readFileSync(resolvedFilePath, 'utf8');
        const fm = paceUtils.parseFrontmatter(content);
        if (!fm['schema-version']) warnings.push(`${filePath} 缺少 frontmatter schema-version。请派 artifact-writer 修复 schema。`);
        if (/^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRel || '')) {
          if (!fm.status) warnings.push(`${filePath} 缺少 frontmatter status。`);
          if (!('verified-date' in fm)) {
            warnings.push(`${filePath} 缺少 frontmatter verified-date。`);
          } else {
            const status = paceUtils.normalizeFrontmatterStatus(fm.status).toLowerCase();
            const verificationClaimed = status === 'archived' || content.includes('<!-- VERIFIED -->');
            if (verificationClaimed && !paceUtils.hasNonNullVerifiedDate(content)) {
              warnings.push(`${filePath} frontmatter verified-date 为占位 null/空，但已出现 VERIFIED/archived 信号。`);
            }
          }
          if (!('reviewed-date' in fm)) {
            warnings.push(`${filePath} 缺少 frontmatter reviewed-date。`);
          } else {
            const status = paceUtils.normalizeFrontmatterStatus(fm.status).toLowerCase();
            const reviewClaimed = status === 'archived' || content.includes('<!-- REVIEWED -->');
            if (reviewClaimed && !paceUtils.hasNonNullReviewedDate(content)) {
              warnings.push(`${filePath} frontmatter reviewed-date 为占位 null/空，但已出现 REVIEWED/archived 信号。`);
            }
          }
        }
      } catch(e) {}
    }

    const mutationText = newString || content || '';
    if (isChangeDetailEdit && mutationText) {
      const addedApproved = mutationText.includes('<!-- APPROVED -->') && !oldString.includes('<!-- APPROVED -->');
      const addedVerified = mutationText.includes('<!-- VERIFIED -->') && !oldString.includes('<!-- VERIFIED -->');
      const setVerifiedDate = paceUtils.hasNonNullVerifiedDate(mutationText) &&
        !paceUtils.hasNonNullVerifiedDate(oldString || '');
      const addedReviewed = mutationText.includes('<!-- REVIEWED -->') && !oldString.includes('<!-- REVIEWED -->');
      const setReviewedDate = paceUtils.hasNonNullReviewedDate(mutationText) &&
        !paceUtils.hasNonNullReviewedDate(oldString || '');
      if ((addedApproved || addedVerified || setVerifiedDate || addedReviewed || setReviewedDate) && !paceUtils.isArtifactWriterAgentType(stdin.agentType)) {
        warnings.push(`检测到 C/V/R 阶段标志被直接写入 ${path.basename(filePath)}。v6 唯一路径是 artifact-writer 的对应批准/验证/审计/收尾操作，字段格式见 Skill(paceflow:artifact-management)。`);
      }
    }

    const entries = getActiveChangeEntries(cwd);

    if (artifactRel === 'task.md' || artifactRel === 'implementation_plan.md') {
      try {
        const indexContent = resolvedFilePath && fs.existsSync(resolvedFilePath) ? fs.readFileSync(resolvedFilePath, 'utf8') : '';
        const misplaced = paceUtils.findActiveIndexBelowArchive(indexContent);
        if (misplaced.length > 0) {
          warnings.push(`${path.basename(filePath)} 检测到活跃状态索引行（[ ]/[/]/[!]）落在 <!-- ARCHIVE --> 下方（归档区）：${misplaced.join(', ')}。活跃 CHG 索引必须在 ARCHIVE 上方，否则代码写入门会判定「无活跃 CHG」。请派 artifact-writer 把这些行移回活跃区（见 finding-2026-06-07-create-chg-empty-active-archive-insert）。`);
        }
      } catch(e) {}
    }

    if (!paceUtils.isArtifactWriterAgentType(stdin.agentType)) {
      for (const entry of entries) {
        if (!entry.detail || entry.detail.missing) continue;
        const ownerStatus = paceUtils.changeOwnerStatus(cwd, entry.id, stdin.sessionId);
        // CHG-20260611-02：sibling-fresh 对齐 foreign-fresh 跳过催办（B 不收 A 的 CHG 的
        // verify/review/archive 催办）；sibling-detached/stale 不跳过（B 是潜在接手者）。
        if (['foreign-fresh', 'sibling-fresh'].includes(ownerStatus.disposition)) continue;
        const status = (entry.detail.frontmatter.status || '').replace(/^["']|["']$/g, '');
        const tasks = countDetailTasks(entry.detail.content);
        if (entry.taskCheckbox === 'x' && !['completed', 'archived'].includes(status)) {
          warnOnce(`status-mismatch-${entry.slug}`, `${entry.id} 索引 [x] 与详情 status=${status || 'missing'} 不一致，请派 update-chg action=update-status 修复。`);
        }
        if (status === 'completed' && !isChangeVerified(entry.detail)) {
          warnOnce(`verify-missing-${entry.slug}`, `${entry.id} 已 completed 但缺少 verified-date 或 <!-- VERIFIED -->。请先运行验证并阅读结果；确认通过后派 close-chg complete-open-tasks: true，或只记录验证暂不归档时派 update-chg action=verify。`);
        }
        if (status === 'completed' && isChangeVerified(entry.detail) && !isChangeReviewed(entry.detail)) {
          warnOnce(`review-missing-${entry.slug}`, `${entry.id} 已验证但未审计（缺 reviewed-date 或 <!-- REVIEWED -->）。请按本 CHG diff 自选 review agent 做对抗审计、路由 findings，再派 close-chg（含 review-confirmed）写 REVIEWED；只记录审计暂不归档才派 update-chg action=review。`);
        }
        if (status === 'completed' && isChangeVerified(entry.detail) && isChangeReviewed(entry.detail)) {
          warnOnce(`archive-reminded-${entry.slug}`, `${entry.id} 已验证已审计但仍在活跃索引中，请优先派 close-chg 归档；archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`);
        }
        if (tasks.blocked > 0) {
          warnOnce(`blocked-tasks-${entry.slug}`, `${entry.id} 有 ${tasks.blocked} 个暂停/阻塞任务；不计入当前连续执行。恢复前先确认用户意图，必要时派 update-status 将任务重新标为 [/]。`);
        }
      }
    }

    // FC-01：纳入 Write 创建路径（content），record-correction 新建 correction 用 Write 提供 content、newString 为空
    if (artifactRel && /^changes\/corrections\/.+\.md$/i.test(artifactRel) && (newString || content)) {
      warnings.push('检测到 correction 详情变更。请确认已同步写入 knowledge/ 或在 corrections.md 索引标注 [knowledge:: project-only]。');
    }
    if (artifactRel === 'walkthrough.md') {
      const walkthroughIssues = paceUtils.validateWalkthroughLinks(cwd);
      for (const issue of walkthroughIssues) {
        warnings.push(issue);
      }
      if (walkthroughIssues.length > 0 && isFileMutationTool && paceUtils.isArtifactWriterAgentType(stdin.agentType)) {
        const ids = changeIdsFromMessages(walkthroughIssues);
        const target = ids.length > 0 ? ids.join(', ') : 'walkthrough.md';
        const reason = [
          `PACEflow PostToolUse 终态修复：你刚写入的 walkthrough.md 仍不符合 v6 完成记录规范（${target}）。`,
          ...walkthroughIssues.map((issue, idx) => `[${idx + 1}] ${issue}`),
          '请在当前 turn 继续修复，不要结束 artifact-writer 报告：读取 task.md / implementation_plan.md 对应索引与 changes/<id>.md，补齐正确 wikilink 和 [worktree:: ...] [branch:: ...] 上下文；修复后再报告。',
          '不要改用 Bash、临时脚本或主 session 直接改 artifact。'
        ].join('\n');
        continueBlockOnce('walkthrough', target, reason);
      }
    }
  } else if (taskActive) {
    warnings.push(`检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。PostToolUse 不再校验或修复 v5 活跃详情格式。迁移或桥接后仍需重试被阻止的原始代码写入；不要把迁移本身报告为代码任务完成。`);
  } else if (isFileMutationTool && isCodeFile) {
    // task.md 不存在时，只对代码写入提示，避免无关文档编辑被 PACE 提醒打扰。
    // CHG-A A1：'superpowers' 半边已删（isPaceProject 不再返回该值）；野外软信号项目（fallbackSignal=false）
    //   的提示措辞改指向 /paceflow:enable（显式启用为主，与 pre-tool-use 软提醒对称）。
    const fallbackSignal = isPaceProject(cwd);
    if (fallbackSignal === 'manual') {
      warnings.push(`检测到 PACE 激活信号（${fallbackSignal}）但 task.md 不存在；写代码或派 artifact-writer 前请先创建 v6 CHG。${FORMAT_SNIPPETS.skillRef}`);
    } else {
      const codeCount = countCodeFiles(cwd);
      if (codeCount >= 3) {
        warnings.push(`检测到 ${codeCount} 个代码文件。如需用 PACEflow 管理本项目的任务/变更/验证，运行 /paceflow:enable。`);
      }
    }
  }

  // H12: Obsidian 索引刷新 — artifact 写入后异步触发（每会话 1 次，fire-and-forget）
  // 无论 CLI 是否成功，每会话只触发一次（flag 在 spawn 后立即写入）
  const cliRefreshFile = path.join(PACE_RUNTIME, 'cli-refresh-done');
  if (isV6ArtifactEdit && resolvedFilePath && VAULT_PATH && !fs.existsSync(cliRefreshFile)) {
    try {
      // H-1: 使用 normalizePath 跨平台适配（Windows toLowerCase，Linux 保持原样）
      const normFile = paceUtils.normalizePath(resolvedFilePath);
      const normVault = paceUtils.normalizePath(VAULT_PATH);
      if (normFile.startsWith(normVault + '/')) {
        const relPath = path.relative(VAULT_PATH, resolvedFilePath).replace(/\\/g, '/');
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
    const ctx = `PACE 提醒：${warnings.join('；')}\n${paceUtils.artifactDirRuntimeHint(cwd)}`;
    const output = continueBlocks.length > 0
      ? {
          decision: "block",
          continue: true,
          reason: `${continueBlocks.map(block => block.reason).join('\n\n')}\n${paceUtils.artifactDirRuntimeHint(cwd)}`,
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: ctx
          }
        }
      : {
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: ctx
          }
        };
    process.stdout.write(JSON.stringify(output));
    log(projectLogEntry('PostToolUse', continueBlocks.length > 0 ? 'CONTINUE_BLOCK' : 'WARN', {
      proj,
      tool: toolName,
      file: filePath || '-',
      checks: warnings.length,
      continue_blocks: continueBlocks.map(block => block.kind).join(','),
      output: continueBlocks.length > 0 ? output.reason : ctx,
      dur: Date.now() - t0
    }));
  } else {
    log(projectLogEntry('PostToolUse', 'PASS', { proj, tool: toolName, dur: Date.now() - t0 }));
  }
  } catch(e) {
    try { log(projectLogEntry('PostToolUse', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  }
});
