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

function artifactDirField(artDir) {
  return artDir ? `artifact_dir: ${displayDir(artDir)}` : 'artifact_dir: <hook 解析出的 artifact 目录>';
}

// Keep these recovery templates aligned with plugin/agents/artifact-writer.md and
// artifact-management skill examples when adding or changing an operation.
function promptTemplateForOperation({ prompt = '', artDir = '', operation = '', action = '', target = '' } = {}) {
  const op = String(operation || promptDeclaredOperation(prompt) || '').toLowerCase();
  const act = String(action || promptDeclaredAction(prompt) || '').toLowerCase();
  const id = target || paceUtils.explicitChangeTargetFromAgentPrompt(prompt) || 'CHG-YYYYMMDD-NN';
  const lines = [artifactDirField(artDir)];

  if (op === 'create-chg-batch') {
    return [
      ...lines,
      'operation: create-chg',
      'change-set: <变更集名>',
      'change-set-total: <N，必须等于下面 CHG 块数>',
      '--- CHG 1/N ---',
      'reserved-id: <reserve --count N 输出的第 1 个>',
      'title: <第 1 个 CHG 标题（可闭环单元）>',
      'tasks:',
      '  - T-001: <任务标题与验收>',
      '--- CHG 2/N ---',
      'reserved-id: <第 2 个 reserved-id>',
      'title: <第 2 个 CHG 标题>',
      'tasks:',
      '  - T-001: <任务标题与验收>',
      '（每块一个 reserved-id，重复到第 N 块；先运行 reserve --operation create-chg --count N 取 N 个连号）',
    ].join('\n');
  }

  if (op === 'create-chg') {
    return [
      ...lines,
      'operation: create-chg',
      'execution-context: <helper 输出>',
      'reserved-id: <helper 输出或 hook deny 输出>',
      'reserved-file: <helper 输出或 hook deny 输出>',
      'title: <变更标题>',
      'tasks:',
      '  - T-001: <任务标题与验收>',
      'background: <Why>',
      'scope: <What>',
      'technical-decision: <How>',
    ].join('\n');
  }

  if (op === 'update-chg' && act === 'approve') {
    return [
      ...lines,
      'operation: update-chg',
      `target: ${id}`,
      'action: approve',
      'approval-confirmed: true',
      'approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan',
      'approval-evidence: <用户原话或已确认方案摘要>',
    ].join('\n');
  }

  if (op === 'update-chg' && act === 'approve-and-start') {
    return [
      ...lines,
      'operation: update-chg',
      `target: ${id}`,
      'action: approve-and-start',
      'task-id: T-NNN',
      'approval-confirmed: true',
      'approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan',
      'approval-evidence: <用户原话或已确认方案摘要>',
    ].join('\n');
  }

  if (op === 'update-chg' && act === 'update-status') {
    return [
      ...lines,
      'operation: update-chg',
      `target: ${id}`,
      'section: tasks',
      'action: update-status',
      'task-id: T-NNN',
      'new-status: [/] | [!] | [x] | [-]',
      'status-reason: <new-status=[!] 时必填；其他状态按需说明>',
    ].join('\n');
  }

  if (op === 'update-chg' && act === 'verify') {
    return [
      ...lines,
      'operation: update-chg',
      `target: ${id}`,
      'action: verify',
      'verify-summary: <已运行并读取的验证结果>',
    ].join('\n');
  }

  if (op === 'update-chg' && act === 'review') {
    return [
      ...lines,
      'operation: update-chg',
      `target: ${id}`,
      'action: review',
      'review-confirmed: true',
      'review-source: manual | <所选 review agent 名>',
      "review-findings: <P0/P1/P2/P3 计数 + 各自处置（HOTFIX/won't-fix finding/record-finding 的 wikilink）>",
    ].join('\n');
  }

  if (op === 'close-chg') {
    return [
      ...lines,
      'operation: close-chg',
      `target: ${id}`,
      'verification-confirmed: true',
      'complete-open-tasks: true',
      'verify-summary: <已运行并读取的验证结果>',
      'review-confirmed: true',
      'review-source: manual | <所选 review agent 名>',
      "review-findings: <P0/P1/P2/P3 计数 + 各自处置（HOTFIX/won't-fix finding/record-finding 的 wikilink）>",
      'walkthrough-summary: <完成摘要>',
    ].join('\n');
  }

  if (op === 'archive-chg') {
    return [
      ...lines,
      'operation: archive-chg',
      `target: ${id}`,
      'walkthrough-summary: <完成摘要>',
    ].join('\n');
  }

  if (op === 'record-finding') {
    return [
      ...lines,
      'operation: record-finding',
      'title: <finding 标题>',
      'summary: <≤200 字摘要>',
      'type: research | observation | comparison | bug-report',
      'impact: P0 | P1 | P2 | P3',
      'body: <完整 Markdown 正文>',
    ].join('\n');
  }

  if (op === 'record-correction') {
    return [
      ...lines,
      'operation: record-correction',
      'reserved-id: <helper 输出>',
      'reserved-file-prefix: <helper 输出>',
      'trigger-quote: <用户纠正原话>',
      'wrong-behavior: <错误行为，至少 20 字符>',
      'correct-behavior: <正确行为，至少 20 字符>',
      'trigger-scenario: <触发场景>',
      'root-cause: <根因>',
      'knowledge-link: [[note]] 或 project-scope: project-only',
    ].join('\n');
  }

  return [
    ...lines,
    'operation: create-chg | update-chg | close-chg | archive-chg | record-finding | record-correction',
    'target: CHG-YYYYMMDD-NN 或 HOTFIX-YYYYMMDD-NN（create-chg / record-finding / record-correction 除外）',
    'action: <operation=update-chg 时必填>',
  ].join('\n');
}

function agentArtifactDirDenyReason(artDir, declared = '', prompt = '') {
  const dir = displayDir(artDir);
  const declaredLine = declared ? `\n当前 prompt 中的 artifact_dir 是：${displayDir(declared)}` : '';
  return [
    `派 paceflow:artifact-writer 时缺少或写错当前 artifact_dir。当前项目已启用 PaceFlow，hook 解析出的 artifact 目录是：${dir}${declaredLine}`,
    FORMAT_SNIPPETS.skillRef,
    '请重派同一个 agent，并使用完整 prompt 顶部模板：',
    promptTemplateForOperation({ prompt, artDir }),
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

// 块内字段取值：只取冒号同一行的非空内容，避免 promptFieldValue 的 \s* 跨行吞下一字段
//（否则空 `title:` 会把下一行 `tasks:` 误当 title，绕过 batch 块字段校验）。
function blockFieldValue(body, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = String(body || '').match(new RegExp(`^[ \\t]*${escaped}[ \\t]*[:=][ \\t]*(\\S.*)$`, 'mi'));
  return m ? m[1].trim() : '';
}

// 解析 batch create CHG 的 `--- CHG i/N ---` 分块；逐块取 reserved-id / title / 是否含 tasks。
// 无任何块标记时 isBatch=false（单 CHG / 普通 create-chg 走原路径）。
function parseBatchBlocks(prompt) {
  const text = String(prompt || '');
  const re = /^---[ \t]*CHG[ \t]+(\d+)\/(\d+)[ \t]*---[ \t]*$/gim;
  const markers = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    markers.push({ start: m.index, end: re.lastIndex, seq: Number(m[1]), markerTotal: Number(m[2]) });
  }
  const blocks = markers.map((mk, idx) => {
    const bodyEnd = idx + 1 < markers.length ? markers[idx + 1].start : text.length;
    const body = text.slice(mk.end, bodyEnd);
    return {
      seq: mk.seq,
      markerTotal: mk.markerTotal,
      reservedId: blockFieldValue(body, 'reserved-id').toUpperCase(),
      title: blockFieldValue(body, 'title'),
      hasTasks: /(?:^|\n)[ \t]*tasks[ \t]*[:=]/i.test(body) || /(?:^|\n)[ \t]*-[ \t]+T-\d/i.test(body),
    };
  });
  return { isBatch: markers.length > 0, blocks };
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

// A05：promptFieldValue 捕获到行尾（不被空格终止），operation/action 行带尾随说明文字时
// 取首个空白分隔 token，使 `operation: close-chg 顺便归档` 仍解析为 close-chg，生命周期字段强制不失效。
function firstToken(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

function promptDeclaredOperation(prompt) {
  const value = firstToken(promptFieldValue(prompt, 'operation')) || firstToken(promptFieldValue(prompt, '指令')) || paceUtils.operationFromAgentPrompt(prompt);
  return value.toLowerCase();
}

function promptDeclaredAction(prompt) {
  const value = firstToken(promptFieldValue(prompt, 'action'));
  if (value) return value.toLowerCase();
  const text = String(prompt || '');
  const m = text.match(/(?:^|[\n,，;；])\s*(approve-and-start|update-status|approve)(?=$|[\s,，;；:：])/i);
  return m ? m[1].toLowerCase() : '';
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

function agentLifecyclePromptDenyReason(prompt, artDir = '') {
  const text = String(prompt || '');
  const operation = promptDeclaredOperation(text);
  const action = promptDeclaredAction(text);
  const mentionsApproveAndStart = operation === 'update-chg' && action === 'approve-and-start';
  const mentionsApproveOnly = operation === 'update-chg' && action === 'approve';
  const mentionsApprovalAction = mentionsApproveAndStart || mentionsApproveOnly;
  const mentionsCloseChg = operation === 'close-chg';
  const mentionsArchiveChg = operation === 'archive-chg';
  const mentionsUpdateStatus = operation === 'update-chg' && action === 'update-status';
  const mentionsVerifyOnly = operation === 'update-chg' && action === 'verify';
  const mentionsReviewOnly = operation === 'update-chg' && action === 'review';

  if (!operation) {
    return [
      '派 artifact-writer 时缺少明确 operation。',
      FORMAT_SNIPPETS.skillRef,
      '请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir }),
      '执行 approve / approve-and-start / update-status / verify 时，operation 必须为 update-chg，并同时提供 action。'
    ].join('\n');
  }

  if (operation === 'create-chg') {
    const batch = parseBatchBlocks(text);
    const totalRaw = promptFieldValue(text, 'change-set-total');
    const declaredTotal = /^\d+$/.test(totalRaw) ? Number(totalRaw) : null;
    const looksBatch = batch.isBatch || (declaredTotal !== null && declaredTotal > 1);
    if (looksBatch) {
      const tpl = promptTemplateForOperation({ prompt, artDir, operation: 'create-chg-batch' });
      const deny = (msg) => [msg, FORMAT_SNIPPETS.skillRef, '请重派同一个 agent，使用 batch create 多块模板：', tpl].join('\n');
      if (!batch.isBatch) {
        return deny('batch create CHG（change-set-total>1）必须用 `--- CHG i/N ---` 分隔每个 CHG 块，但 prompt 未检测到任何块。');
      }
      if (!promptHasNonEmptyField(text, 'change-set')) {
        return deny('batch create CHG 缺少 change-set 字段（变更集名）。');
      }
      if (declaredTotal === null) {
        return deny('batch create CHG 缺少 change-set-total（应等于 batch 块数）。');
      }
      if (batch.blocks.length !== declaredTotal) {
        return deny(`batch create CHG 块数（${batch.blocks.length}）与 change-set-total（${declaredTotal}）不一致。`);
      }
      const errs = [];
      const seen = new Set();
      batch.blocks.forEach((b, idx) => {
        const where = `第 ${idx + 1} 块（--- CHG ${b.seq}/${b.markerTotal} ---）`;
        if (b.markerTotal !== declaredTotal) errs.push(`${where} 标记总数 ${b.markerTotal} 与 change-set-total ${declaredTotal} 不符`);
        if (b.seq !== idx + 1) errs.push(`${where} 序号应为 ${idx + 1}`);
        if (!b.reservedId) errs.push(`${where} 缺 reserved-id`);
        else if (seen.has(b.reservedId)) errs.push(`${where} reserved-id 与其他块重复：${b.reservedId}`);
        else seen.add(b.reservedId);
        if (!b.title) errs.push(`${where} 缺 title`);
        if (!b.hasTasks) errs.push(`${where} 缺 tasks`);
      });
      if (errs.length > 0) {
        return [`batch create CHG 块校验失败：`, ...errs.map(e => `- ${e}`), FORMAT_SNIPPETS.skillRef, '请重派同一个 agent，使用 batch create 多块模板：', tpl].join('\n');
      }
    }
    return '';
  }

  if (operation === 'update-chg' && !['append', 'replace', 'approve', 'approve-and-start', 'update-status', 'verify', 'review'].includes(action)) {
    return [
      `派 artifact-writer 执行 update-chg 时缺少或写错 action：${action || '(missing)'}。`,
      FORMAT_SNIPPETS.skillRef,
      'update-chg 的 action 只能是 append / replace / approve / approve-and-start / update-status / verify / review。',
      '请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir, operation: 'update-chg', action: action || 'update-status' })
    ].join('\n');
  }

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
        '请重派同一个 agent，并使用完整 prompt 顶部模板：',
        promptTemplateForOperation({ prompt, artDir, operation, action }),
        mentionsApproveAndStart ? '' : '若批准后立即开始，请改用 action=approve-and-start 并提供 task-id。'
      ].filter(Boolean).join('\n');
    }
  }

  if (mentionsApproveOnly && promptApproveContainsStartIntent(text)) {
    return [
      '不要用 action=approve 同时表达开始执行或 in-progress 状态。',
      FORMAT_SNIPPETS.skillRef,
      'action=approve 只插入 APPROVED，适用于“先批准但暂不执行”。',
      '若用户已明确批准并准备开始，请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir, operation: 'update-chg', action: 'approve-and-start' })
    ].join('\n');
  }

  if (mentionsUpdateStatus && promptMentionsVerifyAction(text) && !mentionsCloseChg) {
    return [
      '不要把 update-status 与 update-chg action=verify 串在同一次 agent 派遣中。',
      FORMAT_SNIPPETS.skillRef,
      '验证是确认边界：主 session 必须先运行验证命令并读取结果，确认通过后才允许写 VERIFIED。',
      '如果同一 CHG 会继续连续执行：不要为中间任务单独派 update-status，继续完成剩余代码/测试。',
      '只有暂停、阻塞、跳过、跨 session 或长任务进度可见性需要时，才派 update-chg action=update-status。',
      '如果这是最后任务且验证已通过，请使用完整 close-chg 模板：',
      promptTemplateForOperation({ prompt, artDir, operation: 'close-chg' })
    ].join('\n');
  }

  if (mentionsUpdateStatus && promptUpdateStatusValue(text) === '!' && !promptHasPauseOrBlockReason(text)) {
    return [
      '派 artifact-writer 将任务标记为 [!] 暂停/阻塞时缺少原因字段。',
      FORMAT_SNIPPETS.skillRef,
      '[!] 表示当前 CHG 暂停或阻塞，不是完成，也不是让其他 worktree 自动接手的信号。',
      '请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir, operation, action })
    ].join('\n');
  }

  if (mentionsVerifyOnly && !promptHasNonEmptyField(text, 'verify-summary')) {
    return [
      '派 artifact-writer 执行 update-chg action=verify 时缺少必填字段：verify-summary。',
      FORMAT_SNIPPETS.skillRef,
      '验证是确认边界：主 session 必须先运行验证命令并读取结果，确认通过后才允许写 VERIFIED。',
      '请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir, operation, action })
    ].join('\n');
  }

  if (mentionsReviewOnly) {
    const missing = [];
    if (!promptHasTrueField(text, 'review-confirmed')) missing.push('review-confirmed: true');
    if (!promptHasNonEmptyField(text, 'review-source')) missing.push('review-source');
    if (!promptHasNonEmptyField(text, 'review-findings')) missing.push('review-findings');
    if (missing.length > 0) {
      return [
        `派 artifact-writer 执行 update-chg action=review 时缺少必填字段：${missing.join(', ')}。`,
        FORMAT_SNIPPETS.skillRef,
        '审计是确认边界：主 session 必须先编排对抗审计、路由 findings，确认审计跑过后才允许写 REVIEWED；agent 以 review-confirmed 为唯一依据，不自行判断。',
        '请重派同一个 agent，并使用完整 prompt 顶部模板：',
        promptTemplateForOperation({ prompt, artDir, operation, action })
      ].join('\n');
    }
  }

  if (mentionsCloseChg) {
    const missing = [];
    if (!promptHasTrueField(text, 'verification-confirmed')) missing.push('verification-confirmed: true');
    if (!promptHasTrueField(text, 'complete-open-tasks')) missing.push('complete-open-tasks: true');
    if (!promptHasNonEmptyField(text, 'verify-summary')) missing.push('verify-summary');
    if (!promptHasTrueField(text, 'review-confirmed')) missing.push('review-confirmed: true');
    if (!promptHasNonEmptyField(text, 'review-source')) missing.push('review-source');
    if (!promptHasNonEmptyField(text, 'review-findings')) missing.push('review-findings');
    if (!promptHasNonEmptyField(text, 'walkthrough-summary')) missing.push('walkthrough-summary');
    if (missing.length > 0) {
      return [
        `派 artifact-writer 执行 close-chg 时缺少必填字段：${missing.join(', ')}。`,
        FORMAT_SNIPPETS.skillRef,
        'close-chg 只能在主 session 已运行并读取验证结果、且已编排对抗审计并路由 findings 后调用；验证是否通过经 verification-confirmed、审计是否跑过经 review-confirmed 传入，agent 不得自行判断。',
        '请重派同一个 agent，并使用完整 prompt 顶部模板：',
        promptTemplateForOperation({ prompt, artDir, operation: 'close-chg' })
      ].join('\n');
    }
  }

  if (mentionsArchiveChg && !promptHasNonEmptyField(text, 'walkthrough-summary')) {
    return [
      '派 artifact-writer 执行 archive-chg 时缺少必填字段：walkthrough-summary。',
      FORMAT_SNIPPETS.skillRef,
      'archive-chg 用于已完成且已验证的 CHG/HOTFIX 归档、已取消 CHG/HOTFIX 的索引归档，或终态索引修复；仍需由主 session 提供摘要写入 walkthrough.md。',
      '请重派同一个 agent，并使用完整 prompt 顶部模板：',
      promptTemplateForOperation({ prompt, artDir, operation: 'archive-chg' })
    ].join('\n');
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
  promptDeclaredAction,
  explicitReservationFromPrompt,
  parseBatchBlocks,
  promptUpdateStatusValue,
  reservationRelForLookup,
  reservationMatchesExplicit,
  promptTemplateForOperation,
  artifactWriterCreateChgHint,
  reservationRequiredReason,
  reservationExplicitMissingReason,
  agentLifecyclePromptDenyReason,
  legacyArtifactWriterLockDenyReason,
  artifactResourceLockDenyReason,
  artifactReservationDenyReason,
  agentArtifactDirDenyReason,
};
