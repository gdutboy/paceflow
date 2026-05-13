// Artifact-writer Agent prompt/lifecycle helpers for PreToolUse.
const paceUtils = require('../pace-utils');

const {
  displayDir,
  normalizeArtifactRootChoice,
  FORMAT_SNIPPETS,
  RESERVE_ARTIFACT_ID_SCRIPT,
} = paceUtils;

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
    `artifact_dir 仅用于 PaceFlow artifacts：${paceUtils.PACE_ARTIFACT_ROOT_CONTENT}。`,
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
    'execution-context: <helper 输出>',
    'reserved-id: <helper 输出或 hook deny 输出>',
    'reserved-file: <helper 输出或 hook deny 输出>',
    'title: <变更标题>',
    'tasks:',
    '- T-001: <首个任务>',
    '若未先运行 helper，hook 会用 deny 文案返回 reserved-id / reserved-file 作为 fallback；收到后原样写入 prompt 重派。'
  ].join('\n');
}

function reservationRequiredReason(operation, artDir, reservation, cwd = process.cwd()) {
  const lines = [
    `PACEflow 已为 ${operation} 预留唯一编号。本次 Agent 已被阻止，请重派 artifact-writer 并带上以下字段：`,
    FORMAT_SNIPPETS.skillRef,
    operation === 'create-chg' ? FORMAT_SNIPPETS.reserveHelper : `后续可先运行 Bash: node "${RESERVE_ARTIFACT_ID_SCRIPT}" --operation record-correction 预留 correction 编号。`,
    `artifact_dir: ${displayDir(artDir)}`,
    `operation: ${operation}`,
  ];
  if (reservation.id) lines.push(`reserved-id: ${reservation.id}`);
  if (reservation.fileRel) lines.push(`reserved-file: ${reservation.fileRel}`);
  if (reservation.filePrefix) lines.push(`reserved-file-prefix: ${reservation.filePrefix}<slug>.md`);
  if (operation === 'create-chg') lines.splice(5, 0, `execution-context: ${paceUtils.executionContextForCwd(cwd).text}`);
  lines.push('不要启动不带 reserved-id 的 create-chg / record-correction agent；不要让 agent 扫描索引自行分配编号。');
  return lines.join('\n');
}

function reservationExplicitMissingReason(operation, explicit) {
  return [
    `artifact-writer prompt 中的预留字段无效或已过期，当前没有匹配的 hook reservation：${explicit.id || explicit.fileRel || explicit.filePrefix || 'reserved fields'}。`,
    FORMAT_SNIPPETS.skillRef,
    `请先在主 session 运行 Bash: node "${RESERVE_ARTIFACT_ID_SCRIPT}" --operation ${operation}，然后把新的 reserved-id / reserved-file 原样复制进 prompt 后重派。`,
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

function promptDeclaredOperation(prompt) {
  const value = promptFieldValue(prompt, 'operation') || promptFieldValue(prompt, '指令');
  return value.toLowerCase();
}

function promptDeclaredAction(prompt) {
  return promptFieldValue(prompt, 'action').toLowerCase();
}

function promptApproveContainsStartIntent(prompt) {
  const text = String(prompt || '');
  return /(?:status|状态)[^\n]{0,24}(?:in-progress|进行中)/i.test(text) ||
    /(?:改为|设为|推到|进入)[^\n]{0,24}(?:in-progress|进行中)/i.test(text) ||
    /(?:开始实施|开始执行|立即开始|启动任务|标记为\s*\[\/\]|标记.*进行中)/i.test(text);
}

function normalizeTaskStatusValue(value) {
  const raw = String(value || '').trim().toLowerCase();
  const checkbox = raw.match(/^\[([ x\/!\-])\]$/);
  if (checkbox) return checkbox[1];
  if ([' ', '/', 'x', '!', '-'].includes(raw)) return raw;
  if (['pending', 'todo', 'open', '未开始'].includes(raw)) return ' ';
  if (['in-progress', 'running', 'active', '进行中'].includes(raw)) return '/';
  if (['done', 'completed', 'complete', '完成', '已完成'].includes(raw)) return 'x';
  if (['blocked', 'paused', 'pause', 'hold', '阻塞', '暂停'].includes(raw)) return '!';
  if (['skipped', 'skip', 'cancelled', 'canceled', '跳过', '取消'].includes(raw)) return '-';
  return '';
}

function promptUpdateStatusValue(prompt) {
  if (promptDeclaredAction(prompt) !== 'update-status') return '';
  return normalizeTaskStatusValue(promptFieldValue(prompt, 'new-status') || promptFieldValue(prompt, 'new_status'));
}

function promptHasPauseOrBlockReason(prompt) {
  return promptHasNonEmptyField(prompt, 'status-reason') ||
    promptHasNonEmptyField(prompt, 'block-reason') ||
    promptHasNonEmptyField(prompt, 'pause-reason');
}

function agentLifecyclePromptDenyReason(prompt) {
  const text = String(prompt || '');
  const operation = promptDeclaredOperation(text);
  const action = promptDeclaredAction(text);
  const mentionsApproveAndStart = operation === 'update-chg' && action === 'approve-and-start';
  const mentionsApproveOnly = operation === 'update-chg' && action === 'approve';
  const mentionsApprovalAction = mentionsApproveAndStart || mentionsApproveOnly;
  const mentionsCloseChg = operation === 'close-chg';
  const mentionsUpdateStatus = operation === 'update-chg' && action === 'update-status';

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

  if (mentionsUpdateStatus && promptUpdateStatusValue(text) === '!' && !promptHasPauseOrBlockReason(text)) {
    return [
      '派 artifact-writer 将任务标记为 [!] 暂停/阻塞时缺少原因字段。',
      FORMAT_SNIPPETS.skillRef,
      '[!] 表示当前 CHG 暂停或阻塞，不是完成，也不是让其他 worktree 自动接手的信号。',
      '请重派同一 update-status，并加入以下任一字段：',
      'status-reason: <用户要求暂停、等待外部信息、环境阻塞或其他原因>',
      'block-reason: <阻塞原因>',
      'pause-reason: <暂停原因>'
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

module.exports = {
  isArtifactWriterAgentTool,
  extractPromptArtifactDir,
  promptHasExactArtifactDir,
  promptHasTrueField,
  explicitReservationFromPrompt,
  promptUpdateStatusValue,
  reservationRelForLookup,
  reservationMatchesExplicit,
  artifactWriterCreateChgHint,
  reservationRequiredReason,
  reservationExplicitMissingReason,
  agentLifecyclePromptDenyReason,
  legacyArtifactWriterLockDenyReason,
  artifactResourceLockDenyReason,
  artifactReservationDenyReason,
  agentArtifactDirDenyReason,
};
