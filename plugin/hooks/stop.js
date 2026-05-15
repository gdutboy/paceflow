// Stop hook：有未完成项时 exit 2 阻止 Claude 停止 + 多信号检测 + 防无限循环
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, todayISO, isPaceProject, countCodeFiles, ARTIFACT_FILES, readActive, checkArchiveFormat, countByStatus, isTeammate, getArtifactDir, getProjectName, FORMAT_SNIPPETS, COMPLETION_PHRASES, getActiveChangeEntries, classifyChange, v5MigrationPromptMessage } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const MAX_BLOCKS = 3; // 连续阻止超过此数后降级为软提醒
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');
const warnings = [];
const warningTypes = [];
const softReminders = [];

const paceSignal = isPaceProject(cwd);

// H-1: 非 PACE 项目直接放行（.pace/disabled 豁免）
if (!paceSignal) {
  log(paceUtils.logEntry('Stop', 'SKIP', { proj, reason: 'non-pace' }));
  process.exit(0);
}

// 防无限循环：读取连续阻止计数
// I-12: 消除 existsSync TOCTOU 竞态，直接 try-catch readFileSync
function getBlockCount() {
  try {
    return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) || 0;
  } catch(e) { return 0; }
}
function setBlockCount(n, { ensure = false } = {}) {
  try {
    if (ensure) fs.mkdirSync(PACE_RUNTIME, { recursive: true });
    fs.writeFileSync(COUNTER_FILE, String(n), 'utf8');
  } catch(e) {}
}

function isDeferredCategory(category) {
  return ['backlog', 'ready', 'blocked'].includes(category);
}

function isForeignOwnerStatus(ownerStatus) {
  return ownerStatus.disposition === 'foreign-fresh' || ownerStatus.disposition === 'foreign-stale';
}

function addWarning(type, message) {
  warnings.push(message);
  warningTypes.push(type || 'repair');
}

function deferredNextAction(change) {
  if (change.category === 'backlog') return '先确认用户批准；若准备执行，派 approve-and-start';
  if (change.category === 'ready') return '已批准但未开始；执行前派 approve-and-start 或 update-status 将当前任务恢复为 [/]';
  if (change.category === 'blocked') return '已暂停/阻塞；恢复前确认用户意图，并派 update-status 将当前任务恢复为 [/]';
  return '继续前确认下一步状态';
}

function resetHardBlockRuntime() {
  if (fs.existsSync(PACE_RUNTIME)) setBlockCount(0);
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  try { if (fs.existsSync(degradedFile)) fs.unlinkSync(degradedFile); } catch(e) {}
}

function emitSoftReminders(reminders, t0) {
  if (reminders.length === 0) return false;
  resetHardBlockRuntime();
  const shown = reminders.slice(0, 5);
  const more = reminders.length > shown.length ? `；另有 ${reminders.length - shown.length} 个` : '';
  const systemMessage = `PACEflow: 仍有 deferred CHG 可后续处理（已允许结束）：${shown.join('；')}${more}。`;
  process.stdout.write(JSON.stringify({ systemMessage }) + '\n');
  log(paceUtils.logEntry('Stop', 'SOFT_DEFERRED_PASS', {
    proj,
    count: reminders.length,
    changes: reminders.map(r => (r.match(/^(CHG|HOTFIX)-\d{8}-\d{2}/) || [''])[0]).filter(Boolean).join(','),
    dur: Date.now() - t0,
  }));
  return true;
}

try {
const t0 = Date.now();
// S-1: 统一 stdin 解析
const stdin = paceUtils.parseStdinSync();
const lastMessage = stdin.lastMessage;
log(paceUtils.logEntry('Stop', 'ENTRY', { proj }));

// I-opt-4: 直接使用 ARTIFACT_FILES（消除无意义别名）
const artDir = getArtifactDir(cwd);
const existing = ARTIFACT_FILES.filter(f => fs.existsSync(path.join(artDir, f)));

const taskActive = readActive(cwd, 'task.md');

if (paceSignal === 'artifact') {
  for (const file of ARTIFACT_FILES) {
    const archFmt = checkArchiveFormat(cwd, file);
    if (archFmt) addWarning('repair', archFmt);
  }

  const classifiedEntries = getActiveChangeEntries(cwd).map(e => classifyChange(e));

  let completionPending = 0;
  let requiresWalkthrough = false;
  for (const change of classifiedEntries) {
    const ownerStatus = paceUtils.changeOwnerStatus(cwd, change.id, stdin.sessionId);
    const isForeignOwner = isForeignOwnerStatus(ownerStatus);
    const isProgressState = ['running', 'blocked', 'closing-required'].includes(change.category);
    if (isForeignOwner && (isProgressState || isDeferredCategory(change.category))) {
      log(paceUtils.logEntry('Stop', ownerStatus.disposition === 'foreign-stale' ? 'SKIP_FOREIGN_STALE_CHANGE_OWNER' : 'SKIP_FOREIGN_CHANGE_OWNER', {
        proj,
        change: change.id,
        owner_state: ownerStatus.owner.state || '',
        owner_worktree: ownerStatus.owner.worktree || '',
        owner_branch: ownerStatus.owner.branch || '',
        category: change.category,
      }));
      continue;
    }
    const ownerPrefix = ownerStatus.disposition === 'foreign-stale'
      ? `${change.id} 的 owner 记录已过期；优先回到原 worktree/session 处理。若用户明确要求当前 session 修复或接手，请在 artifact-writer prompt 中带 owner-takeover-source 与 owner-takeover-evidence。`
      : '';

    if (change.category === 'inconsistent') {
      if (change.reason === 'index-missing') {
        addWarning('repair', `${ownerPrefix}task.md 与 implementation_plan.md 活跃 CHG 集合不一致：${change.id} 必须同时存在。请派 artifact-writer 修复索引。`);
      } else if (change.reason === 'detail-missing') {
        addWarning('repair', `${ownerPrefix}${change.id} 的详情文件缺失（应为 changes/${change.slug}.md），请派 artifact-writer 修复。`);
      } else if (change.reason === 'index-mismatch') {
        addWarning('repair', `${ownerPrefix}${change.id} 索引状态不一致：task.md=[${change.taskCheckbox}]，implementation_plan.md=[${change.implCheckbox}]。请派 update-chg action=update-status 修复。`);
      } else if (change.reason === 'index-malformed') {
        addWarning('repair', `${ownerPrefix}${change.id} 索引行格式损坏：task.md / implementation_plan.md 中的 CHG/HOTFIX 行必须独占一行，并以 "- [ ] [[...]]"、"[/]"、"[x]"、"[!]" 或 "[-]" 开头。请派 artifact-writer 修复索引行边界。`);
      } else if (change.reason === 'index-completed-with-pending-tasks') {
        addWarning('execution', `${ownerPrefix}${change.id} 索引已是 [x]，但详情仍有 ${change.tasks.pending} 个未完成任务。请派 update-chg action=update-status 修复状态联动，或继续完成任务。`);
      } else if (change.reason === 'index-completed-status-mismatch') {
        addWarning('repair', `${ownerPrefix}${change.id} 索引已是 [x]，但详情 frontmatter status=${change.status || 'missing'}。请派 update-chg action=update-status 修复状态联动。`);
      } else if (change.reason === 'active-archived') {
        addWarning('repair', `${ownerPrefix}${change.id} 详情已 archived，但索引仍在活跃区。请派 artifact-writer close-chg 或 archive-chg 做索引修复：从 task.md / implementation_plan.md 活跃区删除该行，并移动到 ARCHIVE 下方。${FORMAT_SNIPPETS.closeOp}`);
      } else if (change.reason === 'active-cancelled') {
        addWarning('repair', `${ownerPrefix}${change.id} 已取消或索引为 [-]，但仍在活跃区。请派 artifact-writer 修复索引：从 task.md / implementation_plan.md 活跃区删除该行，并移动到 ARCHIVE 下方。`);
      } else if (change.reason === 'task-list-empty') {
        addWarning('repair', `${ownerPrefix}${change.id} 详情 status=${change.status}，但 ## 任务清单 中没有可识别的 T-NNN 任务行。请派 artifact-writer 修复 changes/${change.slug}.md 任务清单。`);
      } else {
        addWarning('repair', `${ownerPrefix}${change.id} 状态无法识别（status=${change.status || 'missing'}）。请派 artifact-writer 修复 frontmatter/index 状态。`);
      }
      continue;
    }

    if (isDeferredCategory(change.category)) {
      const pending = Number(change.tasks && change.tasks.pending || 0);
      softReminders.push(`${change.id} ${change.category}: ${deferredNextAction(change)}`);
      log(paceUtils.logEntry('Stop', 'SOFT_DEFERRED_CHANGE', {
        proj,
        change: change.id,
        category: change.category,
        pending,
        blocked: change.tasks.blocked,
        owner: ownerStatus.disposition,
      }));
      continue;
    }

    completionPending += change.tasks.pending;

    if (change.category === 'running') {
      if (!change.approved) {
        addWarning('user-action', `${ownerPrefix}${change.id} 正在执行但未批准。请确认用户是否已批准；若已批准并准备开始，派 artifact-writer approve-and-start，并带批准来源、证据和要开始的 task-id。字段格式见 Skill(paceflow:artifact-management)。`);
        continue;
      }
      if (change.tasks.pending > 0) {
        addWarning('execution', `${ownerPrefix}${change.id} 还有 ${change.tasks.pending} 个未完成任务（完成 ${change.tasks.done}/${change.tasks.total}）。若本轮仍可连续执行，请继续完成代码/测试，不必为中间任务逐个 update-status；只有暂停、阻塞、跳过或跨 session 时才派 update-chg action=update-status 维护 T-NNN 状态。`);
        continue;
      }
      if (change.tasks.total > 0) {
        addWarning('repair', `${ownerPrefix}${change.id} 任务已全部完成，但 frontmatter status=${change.status || 'missing'}。若验证已通过，请直接派 close-chg complete-open-tasks: true 收尾归档；若暂不验证，才派 update-chg action=update-status 修复 completed 状态。`);
      }
      continue;
    }

    if (change.category === 'closing-required') {
      if (!change.verified) {
        addWarning('verify', `${ownerPrefix}${change.id} 已 completed 但未验证。请先运行验证并阅读结果；确认通过后派 artifact-writer close-chg 写入 VERIFIED 并归档。若只记录验证暂不归档，才派 update-chg action=verify。字段格式见 Skill(paceflow:artifact-management)。`);
      } else {
        requiresWalkthrough = true;
        addWarning('repair', `${ownerPrefix}${change.id} 已 completed 且 verified，仍在活跃索引中。请派 artifact-writer close-chg（已验证则只做归档收尾）或 archive-chg 归档。字段格式见 Skill(paceflow:artifact-management)。`);
      }
    }
  }

  const walkActive = readActive(cwd, 'walkthrough.md');
  if (walkActive !== null && requiresWalkthrough) {
    const today = todayISO();
    const hasToday = new RegExp(`^\\|\\s*${today}\\s*\\|`, 'm').test(walkActive);
    if (!hasToday) {
      addWarning('repair', `walkthrough.md 缺少 ${today} 的工作记录索引行；上方 close-chg 派遣会自动补写，不要由主 session 直接补。${FORMAT_SNIPPETS.walkthroughDetail}`);
    }
  }
  for (const issue of paceUtils.validateWalkthroughLinks(cwd)) {
    addWarning('repair', issue);
  }

  try {
    const findingsDir = path.join(artDir, 'changes', 'findings');
    const aged = fs.existsSync(findingsDir)
      ? fs.readdirSync(findingsDir).filter(f => f.endsWith('.md')).filter(f => {
          const fd = fs.openSync(path.join(findingsDir, f), 'r');
          let detail = '';
          try {
            const buffer = Buffer.alloc(65536);
            const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
            detail = buffer.toString('utf8', 0, bytes);
          } finally {
            fs.closeSync(fd);
          }
          const fm = paceUtils.parseFrontmatter(detail);
          if ((paceUtils.normalizeFrontmatterStatus(fm.status) || 'open') !== 'open' || !fm.date) return false;
          const days = paceUtils.daysSinceISODate(fm.date);
          return days !== null && days >= 14;
        }).length
      : 0;
    if (aged > 0) addWarning('user-action', `changes/findings/ 有 ${aged} 个 open finding 超过 14 天未流转，请询问用户采纳、否定或保持开放。`);
  } catch(e) {}

  if (lastMessage && COMPLETION_PHRASES.test(lastMessage) && completionPending > 0) {
    addWarning('execution', `AI 声称完成，但 v6 详情文件中仍有 ${completionPending} 个未完成任务。请继续执行、明确暂停/阻塞，或用 update-chg action=update-status 标记 [-] 跳过；若验证已通过并准备收尾，可派 close-chg complete-open-tasks: true。`);
  }

} else if (taskActive) {
  addWarning('user-action', v5MigrationPromptMessage(cwd) || `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。不要继续在 task.md/implementation_plan.md/findings.md 手写 v5 活跃详情或 C/V 标记。若前一个代码写入被 hook 阻止，迁移或桥接后必须重试原始工具调用；不要把迁移本身报告为代码任务完成。`);

} else if (existing.length > 0) {
  // task.md 不存在，但有其他 artifact → 不完整
  addWarning('repair', `检测到 ${existing.join(', ')} 但缺少 task.md，Artifact 不完整。task.md 格式：${FORMAT_SNIPPETS.taskGroup}`);
} else {
  // 无任何 artifact：v4.3.5 多信号检测
  if (paceSignal === 'superpowers' || paceSignal === 'manual') {
    // T-078 D2 修复：无 artifact 时仅记录日志，不加入 warnings
    log(paceUtils.logEntry('Stop', 'SOFT_WARN', { proj, signal: paceSignal, reason: 'no artifact' }));
  } else {
    const codeCount = countCodeFiles(cwd);
    if (codeCount >= 3) {
      log(paceUtils.logEntry('Stop', 'SOFT_WARN', { proj, signal: paceSignal, codeCount, reason: 'code-count-no-artifact' }));
    }
  }
}

// Claude 任务列表残留检测：本会话用过任务列表工具且 task.md 无活跃任务 → 仅 log + 清理 flag
// v6 artifact 模式的 task-list flags 由 SessionStart 按会话清理；Stop 不在收尾中改写这些运行态。
// 不阻止退出，因为 hook 无法查询 Claude 内部任务列表实际状态。
const taskListFlags = [path.join(PACE_RUNTIME, 'task-list-used'), path.join(PACE_RUNTIME, 'todowrite-used')];
if (paceSignal !== 'artifact' && taskListFlags.some(f => fs.existsSync(f)) && taskActive) {
  const { pending, done } = countByStatus(taskActive, { topLevelOnly: true });
  if (pending === 0 && done === 0) {
    log(paceUtils.logEntry('Stop', 'TASK_LIST_CLEANUP', { proj, reason: 'no active task' }));
    for (const flag of taskListFlags) {
      try { fs.unlinkSync(flag); } catch(e) {}
    }
  }
}

// T-424: 交叉验证移出 warnings.length===0 守卫，确保已有 warning 时仍检测虚假完成声明
if (paceSignal !== 'artifact' && lastMessage && taskActive && COMPLETION_PHRASES.test(lastMessage)) {
  const { pending } = countByStatus(taskActive, { topLevelOnly: true });
  if (pending > 0) {
    addWarning('execution', `AI 声称完成，但 task.md 还有 ${pending} 个活跃任务。请先完成或标记 [-] 跳过，再归档到 ARCHIVE 下方。标记 [-] 时需在同行或 findings 中记录跳过理由。${FORMAT_SNIPPETS.archiveOp}`);
  }
}

if (warnings.length > 0) {
  // v4.7: teammate 降级 — 不阻止，仅输出 additionalContext 提醒
  if (isTeammate()) {
    // I-6: Stop hook 不支持 additionalContext，teammate 直接 exit 0 放行
    log(paceUtils.logEntry('Stop', 'TEAMMATE_PASS', { proj, team: process.env.CLAUDE_CODE_TEAM_NAME, checks: warnings.join('; ') }));
    process.exit(0);
  } else {
    // W-7: 修正缩进（与 if 分支对齐）
    const blockCount = getBlockCount();
    const checksDetail = warnings.map((w, i) => `  [${i+1}] ${w}`).join('\n');
    if (blockCount >= MAX_BLOCKS) {
      // v4.3.3: 降级时写入标记文件，让 PostToolUse 提醒 AI
      try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
      try { fs.writeFileSync(path.join(PACE_RUNTIME, 'degraded'), `降级时间: ${ts()}\n未通过检查:\n${checksDetail}\n`, 'utf8'); } catch(e) {}
      // T-424: 降级后重置计数器，避免下次会话冻结在 MAX_BLOCKS
      setBlockCount(0, { ensure: true });
      log(paceUtils.logEntry('Stop', 'DOWNGRADE', { proj, blockCount, maxBlocks: MAX_BLOCKS, checks: warnings.join('; '), note: '.pace/degraded written' }));
      process.exit(0);
    } else {
      // v4：exit 2 阻止 Claude 停止，stderr 反馈给 Claude
      setBlockCount(blockCount + 1, { ensure: true });
      // T-330: stderr 编号列表 + 降级递进式消息
      const stderrLines = warnings.map((w, i) => `[${i+1}] ${w}`);
      stderrLines.push(`[提示] 处理上述 PACEflow 检查前，${FORMAT_SNIPPETS.skillRef}。`);
      if (blockCount >= 1) stderrLines.push(`[提示] 这是第 ${blockCount + 1} 次阻止，请逐项处理上述问题后再结束会话。`);
      if (blockCount >= 2) stderrLines.push(`[警告] 下次将降级为软提醒不再阻止，但问题仍需处理。`);
      // HOTFIX-20260314-02: 场景感知前缀——区分"用户决策"/"继续执行"/"收尾修复"
      const hasUserActionWarning = warningTypes.includes('user-action');
      const hasExecutionWarning = warningTypes.includes('execution');
      let prefix;
      if (hasUserActionWarning && hasExecutionWarning) {
        prefix = 'PACE 检查未通过，请继续执行任务并处理以下问题；其中部分问题需要用户决策：';
      } else if (hasUserActionWarning) {
        prefix = 'PACE 检查未通过，以下问题需要用户决策：';
      } else if (hasExecutionWarning) {
        prefix = 'PACE 检查未通过，请继续执行任务并处理以下问题：';
      } else {
        prefix = 'PACE 完成度检查未通过。请仅修复以下检查项，不要执行新任务：';
      }
      const stderrMsg = `${prefix}\n${paceUtils.artifactDirRuntimeHint(cwd)}\n${stderrLines.join('\n')}`;
      process.stderr.write(stderrMsg + '\n');
      log(paceUtils.logEntry('Stop', 'BLOCK', { proj, blockCount: blockCount + 1, maxBlocks: MAX_BLOCKS, checks: warnings.join('; '), stderr: stderrMsg }));
      process.exit(2);
    }
  } // 关闭 isTeammate else
} else {
  // 检查全部通过，重置计数器 + 清除降级标记
  if (emitSoftReminders(softReminders, t0)) process.exit(0);
  resetHardBlockRuntime();
  log(paceUtils.logEntry('Stop', 'PASS', { proj, dur: Date.now() - t0 }));
  process.exit(0);
}
} catch(e) {
  try { log(paceUtils.logEntry('Stop', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  process.exit(0);
}
