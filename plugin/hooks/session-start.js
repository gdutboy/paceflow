// SessionStart hook：重置 Stop 计数器 + 多信号 PACE 检测创建模板 + 注入活跃区 + 跳过任务提醒 + CHG 执行上下文
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, ts, todayISO, isPaceProject, ARTIFACT_FILES, SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, readFull, createTemplates, ensureProjectInfra, scanRelatedNotes, getArtifactDir, getProjectName, formatBridgeHint, FORMAT_SNIPPETS, ARCHIVE_MARKER, ARCHIVE_PATTERN, ARCHIVE_REQUIRED_FILES, ARCHIVE_MISSING_INJECT_LIMIT, extractOpenKeys, detectLegacyImplFormat, summarizeActiveChanges, artifactRootChoiceNeeded, artifactRootChoiceMessage } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');
const SESSION_OUTPUT_HARD_LIMIT_BYTES = 50000;
const SESSION_OUTPUT_BUDGET_BYTES = 46000;
let sessionOutputBytes = 0;
let sessionOutputTruncated = false;
const realStdoutWrite = process.stdout.write.bind(process.stdout);

function sliceUtf8ToBytes(str, maxBytes) {
  if (maxBytes <= 0) return '';
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo);
}

function installSessionOutputGuard() {
  process.stdout.write = (chunk, encoding, callback) => {
    const cb = typeof encoding === 'function' ? encoding : callback;
    const enc = typeof encoding === 'string' ? encoding : undefined;
    const text = Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
    if (sessionOutputTruncated) {
      if (typeof cb === 'function') process.nextTick(cb);
      return true;
    }

    const bytes = Buffer.byteLength(text, 'utf8');
    if (sessionOutputBytes + bytes <= SESSION_OUTPUT_BUDGET_BYTES) {
      sessionOutputBytes += bytes;
      return realStdoutWrite(chunk, encoding, callback);
    }

    const remaining = Math.max(0, SESSION_OUTPUT_BUDGET_BYTES - sessionOutputBytes);
    const prefix = sliceUtf8ToBytes(text, remaining);
    if (prefix) {
      sessionOutputBytes += Buffer.byteLength(prefix, 'utf8');
      realStdoutWrite(prefix);
    }
    const notice = `\n\n=== SessionStart 输出截断 ===\n注入内容超过 ${SESSION_OUTPUT_BUDGET_BYTES} bytes，已停止继续输出。请按需 Read artifact 文件；硬上限 ${SESSION_OUTPUT_HARD_LIMIT_BYTES} bytes。\n`;
    sessionOutputBytes += Buffer.byteLength(notice, 'utf8');
    realStdoutWrite(notice);
    sessionOutputTruncated = true;
    if (typeof cb === 'function') process.nextTick(cb);
    return true;
  };
}
installSessionOutputGuard();

// S-1: 统一 stdin 解析
const hookInput = paceUtils.parseStdinSync();
const eventType = hookInput.type || 'startup';

// H-3: 顶层 try-catch 安全网（内部 try-catch 保留不变）
try {

// v4.3: 多信号 PACE 检测（替换原有 codeFileCount >= 3）
const paceSignal = isPaceProject(cwd);
const artDir = paceSignal ? getArtifactDir(cwd) : cwd;
const v5MigrationInfo = paceSignal ? paceUtils.getV5MigrationInfo(cwd) : { detected: false };
const rootConfigError = paceSignal ? paceUtils.artifactRootConfigError(cwd) : null;
if (rootConfigError) {
  log(paceUtils.logEntry('SessionStart', 'ARTIFACT_ROOT_CONFIG_ERROR', {
    proj,
    code: rootConfigError.code,
    choice_path: rootConfigError.choicePath,
  }));
  process.stdout.write(`=== PACEflow 配置错误 ===\n${rootConfigError.message}\n\n`);
  process.exit(0);
}
const rootChoicePending = paceSignal && paceSignal !== 'artifact' && artifactRootChoiceNeeded(cwd);
const artifactRootChoice = paceUtils.readArtifactRootChoice(cwd) || 'auto';

function projectContextMode(rootInfo) {
  if (rootInfo.mode === 'inherited') return '继承父级 PACEflow 项目';
  if (rootInfo.mode === 'independent') return '当前 cwd 是 independent Project Root';
  if (rootInfo.mode === 'worktree') return 'git worktree 共享宿主 Project Root';
  if (rootInfo.mode === 'disabled') return '当前 Project Root 已禁用 PACEflow';
  return '当前 cwd 作为 Project Root';
}

function writeProjectContextSection() {
  const rootInfo = paceUtils.resolveEffectiveProjectRoot(cwd);
  const contextArtDir = paceSignal ? artDir : paceUtils.getArtifactDir(cwd);
  const lines = [
    '=== PACEflow 项目上下文 ===',
    `Current CWD: ${cwd.replace(/\\/g, '/')}`,
    `Project Root: ${rootInfo.projectRoot.replace(/\\/g, '/')}`,
    `Artifact Root: ${paceUtils.displayDir(contextArtDir)}`,
    `Runtime Root: ${rootInfo.runtimeRoot.replace(/\\/g, '/')}`,
    `模式: ${projectContextMode(rootInfo)}（mode=${rootInfo.mode}）`,
  ];
  if (rootInfo.mode === 'inherited') {
    lines.push(`若这是独立子项目，先运行：node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`);
  }
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

function writeWorkflowEntrySection(reason) {
  const lines = [
    '=== PACEflow 工作流入口 ===',
    `信号: ${reason}`,
    '收到实现、迁移、CHG、验证或归档任务时，先调用 Skill(paceflow:pace-workflow)。',
    '涉及 artifact/CHG 字段、任务状态、批准、验证或归档时，再调用 Skill(paceflow:artifact-management)。',
    `artifact-root helper: node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    `独立子项目 helper: node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    `预留编号 helper: node "${paceUtils.RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg`,
    'reserve helper 从当前项目 cwd 和 .pace/artifact-root 解析 artifact_dir；不要搜索 plugin cache，也不要传 --artifact-dir / --artifact-root / --project-dir。',
    '',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

if (paceSignal || rootChoicePending || paceUtils.resolveEffectiveProjectRoot(cwd).mode === 'inherited') {
  writeProjectContextSection();
}

if (paceSignal && !rootChoicePending && eventType !== 'compact') {
  const reason = v5MigrationInfo.detected ? 'legacy-v5' : String(paceSignal);
  writeWorkflowEntrySection(reason);
}

// v4: PACE 项目才创建/重置运行态 .pace 文件；首次 root 选择前保持 SessionStart 零写入。
if (paceSignal && !rootChoicePending && eventType !== 'compact') {
  try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
  try { fs.writeFileSync(COUNTER_FILE, '0', 'utf8'); } catch(e) {}
  // W-code-4: 使用 SESSION_SCOPED_FLAGS 常量（与 pace-utils 保持同步）
  for (const flag of SESSION_SCOPED_FLAGS) {
    try { const fp = path.join(PACE_RUNTIME, flag); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
  }
  try {
    for (const f of fs.readdirSync(PACE_RUNTIME)) {
      if (SESSION_SCOPED_FLAG_PREFIXES.some(prefix => f.startsWith(prefix))) {
        try { fs.unlinkSync(path.join(PACE_RUNTIME, f)); } catch(e) {}
      }
    }
  } catch(e) {}
  try {
    const todayFindingsFlag = `findings-age-${todayISO()}`;
    for (const f of fs.readdirSync(PACE_RUNTIME)) {
      if (f.startsWith('findings-age-') && f !== todayFindingsFlag) {
        try { fs.unlinkSync(path.join(PACE_RUNTIME, f)); } catch(e) {}
      }
    }
  } catch(e) {}
  // RSL-01/02：每会话清理 stale change-owners / reservations，遏制无界增长与孤儿泄漏
  try { paceUtils.sweepStaleRuntimeOwners(cwd); } catch(e) {}
}

// v4.5: compact 事件读取 PreCompact 快照
if (eventType === 'compact') {
  const snapFile = path.join(PACE_RUNTIME, 'pre-compact-state.json');
  try {
    if (fs.existsSync(snapFile)) {
      const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      if (!snap || typeof snap !== 'object') {
        log(paceUtils.logEntry('SessionStart', 'COMPACT_SNAPSHOT_SKIP', { cwd, reason: 'invalid-snapshot' }));
        try { fs.unlinkSync(snapFile); } catch(e) {}
      } else {
        const lines = [`=== Compact 恢复（快照 ${snap.timestamp}）===`];
        if (snap.artifacts?.['task.md']?.inProgress?.length > 0) {
          lines.push('进行中任务:');
          snap.artifacts['task.md'].inProgress.forEach(t => lines.push(`  ${t}`));
        }
        if (snap.artifacts?.['task.md']?.pending > 0) {
          lines.push(`待办任务: ${snap.artifacts['task.md'].pending} 个`);
        }
        if (snap.activeChanges && snap.activeChanges.length > 0) {
          lines.push('活跃 CHG:');
          snap.activeChanges.forEach(c => {
            const owner = c.ownerDisposition
              ? ` owner=${[c.ownerDisposition, c.ownerWorktree ? `worktree=${c.ownerWorktree}` : '', c.ownerBranch ? `branch=${c.ownerBranch}` : '', c.ownerState ? `state=${c.ownerState}` : ''].filter(Boolean).join(' ')}`
              : '';
            lines.push(`  ${c.id} status=${c.status}${owner} pending=${c.pending} approved=${c.approved} verified=${c.verified} reviewed=${c.reviewed}`);
          });
        }
        if (snap.runtime?.degraded) {
          lines.push('Stop 检查上次仍有未解决项；本次会话会继续检查。');
        }
        if (Number.isFinite(Number(snap.runtime?.blockCount)) && Number(snap.runtime.blockCount) > 0) {
          try {
            fs.mkdirSync(PACE_RUNTIME, { recursive: true });
            fs.writeFileSync(COUNTER_FILE, String(Number(snap.runtime.blockCount)), 'utf8');
          } catch(e) {}
        }
        // v5.0.1: compact 后 native plan 恢复提示
        const pendingNativePlans = new Set(Array.isArray(snap.nativePlans) ? snap.nativePlans : []);
        try {
          const planPath = paceUtils.getNativePlanPath(cwd);
          if (planPath) pendingNativePlans.add(planPath);
        } catch(e) {}
        if (pendingNativePlans.size > 0) {
          lines.push('');
          lines.push('检测到未桥接的原生计划文件：');
          Array.from(pendingNativePlans).forEach(p => lines.push(`  ${p}`));
          lines.push('请调用 Skill(paceflow:pace-bridge)，按该 skill 桥接为 v6 CHG 并记录同步标记。');
        }
        process.stdout.write(lines.join('\n') + '\n\n');
        // v5.0.2: compact 恢复后注入格式快速参考
        if (paceSignal) {
          // I-10: 合并 9 次 stdout.write 为单次 I/O
          const formatLines = [
            '',
            '=== 格式快速参考 ===',
            `CHG 索引格式：${FORMAT_SNIPPETS.taskEntry}`,
            `实施索引格式：${FORMAT_SNIPPETS.implIndex}`,
            `任务状态：${FORMAT_SNIPPETS.statusHelp}`,
            `详情位置：changes/<id>.md`,
            `findings 格式：${FORMAT_SNIPPETS.findingsFormat}`,
            `walkthrough 索引：${FORMAT_SNIPPETS.walkthroughDetail}`,
            `批准标记：${FORMAT_SNIPPETS.approved}`,
            `验证标记：${FORMAT_SNIPPETS.verified}`,
            `impl_plan 规则：${FORMAT_SNIPPETS.implDetail}`,
            '',
            '=== CHG 完成检查（每个 CHG/HOTFIX 最后任务代码写完后立即执行）===',
            `1. 先运行验证并阅读结果；未读取结果前不要派 verify/close-chg`,
            `2. 通过后派 close-chg complete-open-tasks: true — 收口最后任务、写 VERIFIED、归档索引并写 walkthrough`,
            `3. 中间任务完成才用 update-status [x]；只记录验证暂不归档才用 update-chg action=verify`,
            '4. spec.md — 同步技术栈变更（如有）',
            '',
          ];
          process.stdout.write(formatLines.join('\n') + '\n');
        }
        // v5.0.2: compact 恢复 snapshot.findings/walkthrough
        if (snap.findings) {
          process.stdout.write(`findings 状态：${snap.findings.openCount} 个开放项\n`);
        }
        if (snap.walkthrough && !snap.walkthrough.hasTodayEntry) {
          process.stdout.write(`⚠️ compact 前 walkthrough 无今日记录，请在完成任务后更新。${FORMAT_SNIPPETS.walkthroughDetail}\n`);
        }
        // W-11: 独立 try-catch 防止删除失败影响后续逻辑
        try { fs.unlinkSync(snapFile); } catch(e) {}
      }
    }
  } catch(e) {}
}

// T-326: startup 路径也检测 .pace/current-native-plan（修复跨会话盲区）
if (eventType !== 'compact') {
  try {
    const planPath = paceUtils.getNativePlanPath(cwd);
    if (planPath) {
      process.stdout.write(`\n=== Native Plan 桥接提醒 ===\n`);
      process.stdout.write(`检测到未桥接的原生计划文件：${planPath}\n`);
      process.stdout.write('请调用 Skill(paceflow:pace-bridge)，按该 skill 桥接为 v6 CHG 并记录同步标记。\n\n');
    }
  } catch(e) {}
}

// T-204: 基础设施幂等确保（junction + .gitignore），不依赖模板是否创建
if (paceSignal && !rootChoicePending) {
  try { ensureProjectInfra(cwd); } catch(e) {}
}

// 首次启用且 vault/local 都无 artifact 时，SessionStart 只注入轻量 skill 提醒，不询问、不落盘。
// 真正写代码或派 artifact-writer 时由 PreToolUse 强制询问 artifact root 并阻断。
if (rootChoicePending && !fs.existsSync(path.join(artDir, 'task.md'))) {
  log(paceUtils.logEntry('SessionStart', 'ARTIFACT_ROOT_CHOICE_PENDING', {
    cwd,
    signal: paceSignal,
    choice_path: paceUtils.getArtifactRootChoicePath(cwd),
    local_artifact_dir: paceUtils.displayDir(paceUtils.getProjectStateDir(cwd)),
    vault_artifact_dir: paceUtils.VAULT_PATH ? paceUtils.displayDir(path.join(paceUtils.VAULT_PATH, 'projects', getProjectName(cwd))) : '',
  }));
  process.stdout.write([
    '=== PACEflow 启用提示 ===',
    '本项目已触发 PACEflow 信号；收到代码修改任务时先调用 Skill(paceflow:pace-workflow)。',
    '涉及 artifact/CHG 字段、任务状态、批准、验证或归档时，再调用 Skill(paceflow:artifact-management)。',
    '首次写代码或派 artifact-writer 时，PreToolUse 会要求选择 artifact root；选择前不会创建 .pace/、changes/ 或 Obsidian 空项目目录。',
    `若当前子目录应作为独立 PaceFlow 项目，先运行：node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    `若用户已明确选择 vault/local，先从当前项目 cwd 运行：node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    `配置写入后再运行：node "${paceUtils.RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg`,
    'reserve helper 不接受 --artifact-dir / --artifact-root / --project-dir；不要搜索 plugin cache 猜版本。',
    '',
  ].join('\n') + '\n');
// T-077: 非 false 且非 'artifact'（已有文件不需重复创建）+ 无 task.md → 复用公共函数创建模板
} else if (paceSignal && paceSignal !== 'artifact' && !v5MigrationInfo.detected && !fs.existsSync(path.join(artDir, 'task.md'))) {
  const created = createTemplates(cwd);
  if (created.length > 0) {
    log(paceUtils.logEntry('SessionStart', 'CREATE_TEMPLATES', {
      cwd,
      signal: paceSignal,
      artifact_dir: paceUtils.displayDir(artDir),
      choice: artifactRootChoice,
      files: created.join(', '),
    }));
  }
}

function writeArtifactDirSection() {
  const normalizedArtDir = paceUtils.normalizePath(path.resolve(artDir));
  const stateDir = paceUtils.getProjectStateDir(cwd);
  const normalizedStateDir = paceUtils.normalizePath(path.resolve(stateDir));
  const choice = paceUtils.readArtifactRootChoice(cwd).toLowerCase();
  let mode = normalizedArtDir === normalizedStateDir ? '本地项目根目录' : '自定义 artifact 根目录';
  if (choice === 'vault') mode = 'Obsidian vault project';
  else if (choice === 'local') mode = '本地项目根目录';
  else if (paceUtils.VAULT_PATH) {
    const vaultRoot = paceUtils.normalizePath(path.resolve(paceUtils.VAULT_PATH, 'projects'));
    if (normalizedArtDir.startsWith(`${vaultRoot}/`)) mode = 'Obsidian vault project';
  }
  process.stdout.write(`=== Artifact 目录 ===\n路径: ${paceUtils.displayDir(artDir)}\n模式: ${mode}\n仅用于 PaceFlow artifacts：${paceUtils.PACE_ARTIFACT_ROOT_CONTENT}。\nartifact-root helper: node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault\n独立子项目 helper: node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent\n预留编号 helper: node "${paceUtils.RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg\nplan 同步 helper: node "${paceUtils.SYNC_PLAN_SCRIPT}" --plan "<已桥接 plan 绝对路径>"\n\n`);
}

function enrichSummaryOwner(summary) {
  const ownerStatus = paceUtils.changeOwnerStatus(cwd, summary.id, hookInput.sessionId);
  return {
    ...summary,
    ownerDisposition: ownerStatus.disposition,
    ownerWorktree: ownerStatus.owner && ownerStatus.owner.worktree || '',
    ownerBranch: ownerStatus.owner && ownerStatus.owner.branch || '',
    ownerState: ownerStatus.owner && ownerStatus.owner.state || '',
  };
}

function ownerDisplay(summary) {
  const parts = [summary.ownerDisposition || 'unknown'];
  if (summary.ownerWorktree) parts.push(`worktree=${summary.ownerWorktree}`);
  if (summary.ownerBranch) parts.push(`branch=${summary.ownerBranch}`);
  if (summary.ownerState) parts.push(`state=${summary.ownerState}`);
  return parts.join(' ');
}

function isForeignSummary(summary) {
  return summary.ownerDisposition === 'foreign-fresh' || summary.ownerDisposition === 'foreign-stale';
}

function foreignOwnedSummariesForInjection(summaries) {
  return summaries.filter(s => isForeignSummary(s) && s.category !== 'inconsistent');
}

function lineReferencesChangeId(line, ids) {
  if (!line || !ids || ids.size === 0) return false;
  const re = /(?:\[\[((?:chg|hotfix)-\d{8}-\d{2})(?:\|[^\]]*)?\]\]|((?:CHG|HOTFIX)-\d{8}-\d{2}))/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    const id = String(m[1] || m[2] || '').toUpperCase();
    if (ids.has(id)) return true;
  }
  return false;
}

function appendForeignFoldNote(output, count) {
  if (count <= 0) return output;
  return `${output.trimEnd()}\n\n（已折叠 ${count} 个其他 worktree/session owner 的 CHG；见下方 owner 摘要。优先回到原 worktree/session；接手必须有用户明确指令与证据。）\n`;
}

function foldForeignOwnedArtifactOutput(file, output, summaries) {
  const foreignSummaries = foreignOwnedSummariesForInjection(summaries);
  if (foreignSummaries.length === 0) return output;
  const ids = new Set(foreignSummaries.map(s => s.id).filter(Boolean));
  if (ids.size === 0) return output;
  if (file === 'task.md') {
    const filtered = output.split('\n').filter(line => !lineReferencesChangeId(line, ids)).join('\n');
    return appendForeignFoldNote(filtered, ids.size);
  }
  if (file === 'implementation_plan.md') {
    const result = [];
    let skipping = false;
    for (const line of output.split('\n')) {
      const detail = line.match(/^###\s+(?:\[\[)?((?:CHG|HOTFIX)-\d{8}-\d{2})(?:\|[^\]]*)?(?:\]\])?(?=[\s:|-]|$)/i);
      if (detail && ids.has(detail[1].toUpperCase())) {
        skipping = true;
        continue;
      }
      if (skipping && /^(?:###\s+|##\s+|<!--\s*ARCHIVE\s*-->)/i.test(line)) {
        skipping = false;
      }
      if (skipping) continue;
      if (/^-\s+\[.\]/.test(line) && lineReferencesChangeId(line, ids)) continue;
      result.push(line);
    }
    return appendForeignFoldNote(result.join('\n'), ids.size);
  }
  return output;
}

let artifactDirInjected = false;
if (paceSignal && fs.existsSync(path.join(artDir, 'task.md'))) {
  writeArtifactDirSection();
  artifactDirInjected = true;
}

// 提取活跃区注入上下文（缓存 task.md 全文供后续复用）
const found = [];
let taskFullCached = null;
let activeChangeSummaries = paceSignal === 'artifact'
  ? summarizeActiveChanges(cwd).map(enrichSummaryOwner)
  : [];

for (const file of ARTIFACT_FILES) {
  const fp = path.join(artDir, file);
  if (!fs.existsSync(fp)) continue;

  const full = readFull(cwd, file);
  if (!full) continue;

  if (file === 'task.md') taskFullCached = full;

  process.stdout.write(`=== ${file} ===\n`);
  const archiveMatch = full.match(ARCHIVE_PATTERN);
  let output;
  if (archiveMatch) {
    output = full.slice(0, archiveMatch.index);
  } else if (ARCHIVE_REQUIRED_FILES.includes(file) && Buffer.byteLength(full, 'utf8') > ARCHIVE_MISSING_INJECT_LIMIT) {
    // 层2：应有 ARCHIVE 的双区文件缺标记且超限 → 截断兜底，防全文灌爆 context（findings/walkthrough 可达 10 万字符）
    const archiveFooter = `\n\n（⚠️ ${file} 缺少 <!-- ARCHIVE --> 标记，已截断注入以防全文灌爆 context；请派 artifact-writer 修复双区结构）\n`;
    // ARCH-01：按 UTF-8 字节截断，并把 footer 字节算进预算——确保整段（含警告）≤ 阈值，footer 不被全局字节守卫抢先截断而不可达（CJK ~3 字节/字符）。
    output = sliceUtf8ToBytes(full, Math.max(0, ARCHIVE_MISSING_INJECT_LIMIT - Buffer.byteLength(archiveFooter, 'utf8')))
      + archiveFooter;
  } else {
    output = full;
  }

  // T-385: spec.md 截断 — 保留项目事实与禁止事项，省略依赖长列表
  if (file === 'spec.md') {
    const depsMatch = output.match(/^## 依赖列表/m);
    if (depsMatch) {
      output = output.slice(0, depsMatch.index)
        + '\n\n（已省略依赖列表，需要时 Read spec.md）\n';
    }
  }

  // T-386: walkthrough 智能截断 — 索引表最近 10 行 + 最近 3 条详情段落
  if (file === 'walkthrough.md') {
    // 索引表截断：保留表头 + 最近 10 行数据行。close-chg 追加记录，因此按日期/原始行号倒序挑选最近项。
    const dataRe = /^\| \d{4}-\d{2}-\d{2} \|/gm;
    const dataRows = [];
    let m;
    while ((m = dataRe.exec(output)) !== null) {
      const lineStart = output.lastIndexOf('\n', m.index) + 1;
      const lineEnd = output.indexOf('\n', lineStart);
      const line = output.slice(lineStart, lineEnd >= 0 ? lineEnd : output.length);
      const date = (line.match(/^\| (\d{4}-\d{2}-\d{2}) \|/) || [])[1] || '';
      dataRows.push({ lineStart, lineEnd, line, date, index: dataRows.length });
    }
    if (dataRows.length > 10) {
      const omitted = dataRows.length - 10;
      const keep = new Set(dataRows
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
        .slice(0, 10)
        .map(row => row.index));
      const firstRowStart = dataRows[0].lineStart;
      const last = dataRows[dataRows.length - 1];
      const lastRowEnd = last.lineEnd >= 0 ? last.lineEnd : output.length;
      const keptLines = dataRows
        .filter(row => keep.has(row.index))
        .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
        .map(row => row.line);
      output = output.slice(0, firstRowStart)
        + keptLines.join('\n') + '\n'
        + `| ... | （已省略 ${omitted} 条旧记录，需要时 Read walkthrough.md） | | | |\n`
        + output.slice(lastRowEnd >= 0 ? lastRowEnd + 1 : output.length);
    }
    // 详情截断：保留最近 3 条 `## YYYY-MM-DD` 段落，防 context 膨胀。
    // 兼容 ARCHIVE 历史区的段落格式；active 区当前是表格行（走上方索引表截断），全表格时 pos.length=0、本段不触发。（CHG-20260605-05）
    const pos = [];
    const re = /^## \d{4}-\d{2}-\d{2}/gm;
    while ((m = re.exec(output)) !== null) pos.push(m.index);
    if (pos.length > 3) {
      const sections = pos.map((start, index) => {
        const end = index + 1 < pos.length ? pos[index + 1] : output.length;
        const headerEnd = output.indexOf('\n', start);
        const header = output.slice(start, headerEnd >= 0 ? headerEnd : end);
        const date = (header.match(/^## (\d{4}-\d{2}-\d{2})/) || [])[1] || '';
        return { text: output.slice(start, end).trimEnd(), date, index };
      });
      // 详情段落是 close-chg prepend（最新在最前、index 小=新），date 相等时按 index 升序挑最新；
      // 与上方索引表 append（index 大=新、tie 用 b.index-a.index）方向相反，故此处 tie-breaker 不同。
      const latest = sections
        .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
        .slice(0, 3);
      output = output.slice(0, pos[0])
        + latest.map(section => section.text).join('\n')
        + `\n（已省略 ${pos.length - 3} 条旧详情，需要时 Read walkthrough.md）\n`;
    }
  }

  // T-387+T-379: findings 智能截断 — [x]/[-] 索引+详情跳过，[ ] 开放索引+详情全量，Corrections 保留
  if (file === 'findings.md') {
    // T-387: 跳过 [x]/[-] 索引行
    const resolvedRe = /^- \[(?:x|-)\] .+$/gm;
    const resolvedCount = (output.match(resolvedRe) || []).length;
    if (resolvedCount > 0) {
      output = output.replace(resolvedRe, '');
      output = output.replace(/\n{3,}/g, '\n\n');
      // 在 **状态说明** 行前插入省略提示
      const statusLine = output.match(/^\*\*状态说明\*\*/m);
      if (statusLine) {
        output = output.slice(0, statusLine.index)
          + `（已省略 ${resolvedCount} 条已解决索引，需要时 Read findings.md）\n\n`
          + output.slice(statusLine.index);
      }
    }
    // T-379: 跳过已解决详情段落（正向匹配保留 open 项详情）
    const openKeys = extractOpenKeys(output);
    const totalDetails = (output.match(/^### \[\d{4}-\d{2}-\d{2}\]/gm) || []).length;
    if (totalDetails > 0 && totalDetails > openKeys.length) {
      const lines = output.split('\n');
      const result = [];
      let skip = false, cnt = 0, kept = 0;
      const skippedTitles = [];
      for (const l of lines) {
        const dm = l.match(/^### \[\d{4}-\d{2}-\d{2}\] (.+)/);
        if (dm) {
          // 正向精确匹配：只保留 open 索引对应详情，避免共享前缀误保留/误跳过。
          const key = paceUtils.normalizeFindingKey(dm[1]);
          skip = !openKeys.includes(key);
          if (skip) { cnt++; skippedTitles.push(dm[1]); continue; }
          kept++;
        } else if (skip) {
          if (/^#{2,3} /.test(l)) skip = false;
          else continue;
        }
        result.push(l);
      }
      if (openKeys.length > 0 && kept === 0 && skippedTitles.length > 0) {
        log(paceUtils.logEntry('SessionStart', 'FINDINGS_DETAIL_MATCH_MISS', {
          proj,
          open: openKeys.length,
          skipped: skippedTitles.slice(0, 5).join('; '),
        }));
      }
      if (cnt > 0) {
        output = result.join('\n');
        const ci = output.match(/^## Corrections/m);
        const hint = `（已省略 ${cnt} 条已解决详情，需要时 Read findings.md）\n\n`;
        output = ci ? output.slice(0, ci.index) + hint + output.slice(ci.index) : output + '\n' + hint;
      }
    }
  }

  // T-380: impl_plan 智能截断 — 只注入 [/]/[ ] 索引+详情，跳过 [x]/[-]
  if (file === 'implementation_plan.md') {
    const skipIds = new Set();
    (output.match(/^- \[(?:x|-)\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/gm) || []).forEach(line => {
      const id = line.match(/((?:CHG|HOTFIX)-\d{8}-\d{2})/);
      if (id) skipIds.add(id[1]);
    });
    if (skipIds.size > 0) {
      const lines = output.split('\n');
      const result = [];
      let skip = false;
      for (const l of lines) {
        const im = l.match(/^- \[.\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/);
        if (im && skipIds.has(im[1])) continue;
        const dm = l.match(/^### ((?:CHG|HOTFIX)-\d{8}-\d{2})/);
        if (dm) {
          skip = skipIds.has(dm[1]);
          if (skip) continue;
        } else if (skip) {
          if (/^(?:### |## |<!-- )/.test(l)) skip = false;
          else continue;
        }
        result.push(l);
      }
      output = result.join('\n');
      output = output.replace(/(^## 变更索引)/m, `（已省略 ${skipIds.size} 条已完成变更）\n\n$1`);
    }
  }

  output = foldForeignOwnedArtifactOutput(file, output, activeChangeSummaries);
  if (archiveMatch) output += ARCHIVE_MARKER + '\n';
  process.stdout.write(output);
  process.stdout.write('\n\n');
  found.push(`${file}(${output.length})`);
}

if (paceSignal === 'artifact') {
  if (activeChangeSummaries.length > 0) {
    process.stdout.write(`=== 活跃 CHG 摘要 ===\n`);
    for (const s of activeChangeSummaries) {
      process.stdout.write(`- ${s.id} category=${s.category} status=${s.status} owner=${ownerDisplay(s)} task=[${s.taskCheckbox || '?'}] impl=[${s.implCheckbox || '?'}] pending=${s.pending ?? '?'} approved=${s.approved} verified=${s.verified} reviewed=${s.reviewed}\n  ${s.path ? s.path.replace(/\\/g, '/') : 'missing detail'}\n`);
    }
    process.stdout.write(`继续、恢复或收口已有 CHG 前，先 Read 对应 changes/<id>.md，确认任务清单、实施详情和工作记录；本摘要只用于定位，不替代 CHG 详情。\n`);
    process.stdout.write('\n');
  }
}

// v4.8/v6.0.26: 注入 artifact 根目录；local 模式也显式说明，避免把 .pace/ 误当 artifact 目录。
// v6.0.27: 放在大文件内容前，防止 SessionStart 输出截断时丢失最关键的写入路径。
if (found.length > 0 && !artifactDirInjected) {
  writeArtifactDirSection();
}

// T-333: 格式合规检查（注入活跃区后执行，不阻塞，仅引导）
if (paceSignal && found.length > 0) {
  const formatWarnings = [];
  // 检测 1：impl_plan 旧表格/emoji 格式
  const implFull = readFull(cwd, 'implementation_plan.md');
  if (implFull) {
    const implArchiveM = implFull.match(ARCHIVE_PATTERN);
    const implActive = implArchiveM ? implFull.slice(0, implArchiveM.index) : implFull;
    // W-5: 使用共享检测函数（消除与 pre-tool-use.js 的重复）
    const { hasEmoji, hasTable } = detectLegacyImplFormat(implActive);
    if (hasEmoji) {
      formatWarnings.push(`implementation_plan.md 使用了 emoji 状态标记，当前索引解析无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    if (hasTable) {
      formatWarnings.push(`implementation_plan.md 使用了表格格式，当前索引解析无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    // 检测 2：双 ARCHIVE 标记
    const archiveCount = (implFull.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (archiveCount > 1) {
      formatWarnings.push(`implementation_plan.md 有 ${archiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），会导致活跃区识别错误。请删除多余的标记，只保留活跃区与归档区之间的那个`);
    }
  }
  // 检测 3：task.md 双 ARCHIVE 标记
  if (taskFullCached) {
    const taskArchiveCount = (taskFullCached.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (taskArchiveCount > 1) {
      formatWarnings.push(`task.md 有 ${taskArchiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），会导致活跃区识别错误。请删除多余的标记，只保留活跃区与归档区之间的那个`);
    }
  }
  if (formatWarnings.length > 0) {
    process.stdout.write(`\n=== 格式合规警告 ===\n`);
    formatWarnings.forEach((w, i) => process.stdout.write(`[${i+1}] ${w}\n`));
    process.stdout.write(`\n${FORMAT_SNIPPETS.skillRef}\n\n`);
  }
}

// v4.3.1: 跨会话提醒 — 检测归档区中跳过的任务（复用缓存）
const taskFp = path.join(artDir, 'task.md');
if (!taskFullCached && fs.existsSync(taskFp)) {
  try { taskFullCached = fs.readFileSync(taskFp, 'utf8'); } catch(e) {}
}
if (taskFullCached) {
  try {
    // 提前计算 ARCHIVE 分割点（W3 跳过扫描 + 方案 A 共用）
    const archMatch = taskFullCached.match(ARCHIVE_PATTERN);
    const active = archMatch ? taskFullCached.slice(0, archMatch.index) : taskFullCached;

    // W3: 只扫描活跃区的跳过任务（避免已归档的历史 [-] 项永久计入提醒）
    const skipped = active.match(/- \[-\] .+/g) || [];
    if (skipped.length > 0) {
      process.stdout.write(`\n=== 跨会话提醒 ===\ntask.md 有 ${skipped.length} 个跳过的任务（[-]），请用 AskUserQuestion 询问用户这些跳过的任务是否需要重新开启或更新为 [x]：\n`);
      skipped.slice(-3).forEach(t => process.stdout.write(`  ${t}\n`));
      process.stdout.write('\n');
      log(paceUtils.logEntry('SessionStart', 'SKIPPED_REMINDER', { cwd, count: skipped.length }));
    }

    // Superpowers/native plan 桥接检测：有未同步的 plan 文件但 task.md 无活跃任务
    if (paceSignal) {
      const bridgeHint = formatBridgeHint(cwd, artDir);
      if (bridgeHint) {
        const hasActive = active && /- \[[ \/!]\]/.test(active);
        if (!hasActive) {
          process.stdout.write(`\n=== Superpowers 桥接提醒 ===\n`);
          process.stdout.write(`检测到计划文件（${bridgeHint.fileList}）但 task.md 无活跃任务。\n`);
          process.stdout.write(`请在派 subagent 前执行桥接：${bridgeHint.bridgeSteps}\n\n`);
          log(paceUtils.logEntry('SessionStart', 'SUPERPOWERS_BRIDGE_HINT', { cwd, plans: bridgeHint.fileList }));
        }
      }
    }

    // v4.3.6 方案 A + v6 修正：执行上下文以详情 T-NNN 为权威，task.md 只是索引。
    const currentCategories = new Set(['running']);
    const currentSessionSummaries = activeChangeSummaries.filter(s => !isForeignSummary(s));
    const blockedSessionSummaries = currentSessionSummaries.filter(s => s.category === 'blocked');
    const foreignProgressSummaries = foreignOwnedSummariesForInjection(activeChangeSummaries);
    const detailPending = activeChangeSummaries
      .filter(s => !isForeignSummary(s))
      .filter(s => currentCategories.has(s.category))
      .reduce((sum, s) => sum + (Number.isFinite(s.pending) ? s.pending : 0), 0);
    const hasCompleted = currentSessionSummaries.some(s => s.category === 'closing-required');
    const hasIndexPending = currentSessionSummaries.some(s => ['backlog', 'ready', 'running', 'blocked', 'closing-required'].includes(s.category));
    if (foreignProgressSummaries.length > 0) {
      process.stdout.write(`\n=== 其他 worktree/session 活跃 CHG ===\n`);
      for (const s of foreignProgressSummaries.slice(0, 5)) {
        process.stdout.write(`- ${s.id} category=${s.category} owner=${ownerDisplay(s)} pending=${s.pending ?? '?'}\n`);
      }
      if (foreignProgressSummaries.length > 5) process.stdout.write(`- ... 另有 ${foreignProgressSummaries.length - 5} 个\n`);
      process.stdout.write('这些 CHG 由其他 worktree/session 负责；当前 session 仅显示 owner 摘要。优先回到原 worktree/session，接手必须有用户明确指令与证据。\n\n');
      log(paceUtils.logEntry('SessionStart', 'FOREIGN_CHANGE_OWNER_SUMMARY', {
        cwd,
        count: foreignProgressSummaries.length,
        changes: foreignProgressSummaries.slice(0, 5).map(s => s.id).join(','),
      }));
    }
    if (blockedSessionSummaries.length > 0) {
      process.stdout.write(`\n=== 暂停/阻塞 CHG ===\n`);
      for (const s of blockedSessionSummaries.slice(0, 5)) {
        process.stdout.write(`- ${s.id} owner=${ownerDisplay(s)} blocked=${s.blocked ?? '?'} pending=${s.pending ?? '?'}\n`);
      }
      if (blockedSessionSummaries.length > 5) process.stdout.write(`- ... 另有 ${blockedSessionSummaries.length - 5} 个\n`);
      process.stdout.write('这些 CHG 属于 deferred，不计入当前执行中的 T-NNN；恢复前先确认用户意图，必要时派 update-status 将任务重新标为 [/]。\n\n');
      log(paceUtils.logEntry('SessionStart', 'BLOCKED_CHANGE_SUMMARY', {
        cwd,
        count: blockedSessionSummaries.length,
        changes: blockedSessionSummaries.slice(0, 5).map(s => s.id).join(','),
      }));
    }
    if (detailPending > 0) {
      process.stdout.write(`\n=== CHG 执行上下文 ===\nv6 任务权威是 changes/<id>.md 的 ## 任务清单；task.md 只是 CHG 索引。\n当前执行中的 CHG 有 ${detailPending} 个未完成 T-NNN；继续前先 Read 对应 changes/<id>.md。Claude 任务面板只是工作记忆，按需要使用。\n\n`);
    } else if (hasCompleted) {
      process.stdout.write(`\n=== CHG 执行上下文 ===\n活跃索引中有已完成/跳过变更待 close-chg；archive-chg 仅用于已 verified 的单独归档修复。\n\n`);
    } else if (hasIndexPending && paceSignal === 'artifact') {
      process.stdout.write(`\n=== CHG 执行上下文 ===\n当前没有执行中的未完成 T-NNN；backlog / ready / blocked 属于 deferred。Stop 会用可见提醒提示这些 deferred CHG。\n\n`);
    } else {
      process.stdout.write(`\n=== CHG 执行上下文 ===\n当前无活跃 CHG。\n\n`);
    }
  } catch(e) {}
}

// W-5: findings 过期提醒仅对 PACE 项目生效
if (paceSignal) {
// findings [ ] 过期提醒（每日首次 session）
try {
  const findingsActive = paceUtils.readActive(cwd, 'findings.md');
  if (findingsActive) {
    // I-14: 日期字符串集中到 todayISO()
    const yyyy = todayISO();
    const ageFlag = path.join(PACE_RUNTIME, `findings-age-${yyyy}`);
    if (!fs.existsSync(ageFlag)) {
      const aged = [];
      const openLines = findingsActive.match(/^- \[ \] .+$/gm) || [];
      for (const line of openLines) {
        const dm = line.match(/\[date:: (\d{4}-\d{2}-\d{2})\]/);
        if (!dm) continue;
        const days = paceUtils.daysSinceISODate(dm[1], yyyy);
        if (days !== null && days >= 14) {
          const link = line.match(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
          const title = (link && (link[2] || link[1]) || (line.match(/^- \[ \] ([^—#\[]+)/) || [])[1] || line.slice(6, 60)).trim();
          aged.push({ title, days });
        }
      }
      if (aged.length > 0) {
        process.stdout.write(`\n=== Findings 过期提醒 ===\n以下 findings 超过 14 天未流转，请决定采纳 [x] 或否定 [-]：\n`);
        aged.forEach(f => process.stdout.write(`  (${f.days}天) ${f.title}\n`));
        process.stdout.write('\n');
      }
      try { fs.writeFileSync(ageFlag, '1', 'utf8'); } catch(e) {}
    }
  }
} catch(e) {}
} // W-5: 关闭 paceSignal 守卫

// T-117: Git 状态注入（辅助跨会话上下文恢复）
try {
  const { execSync } = require('child_process');
  const gitOpts = { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
  const branch = execSync('git rev-parse --abbrev-ref HEAD', gitOpts).trim();
  const lastCommit = execSync('git log --oneline -1', gitOpts).trim();
  if (branch && lastCommit) {
    process.stdout.write(`=== Git 状态 ===\n分支: ${branch}\n最近提交: ${lastCommit}\n\n`);
  }
} catch(e) {} // 非 git 项目静默跳过

// v5.0.2: 相关 thoughts/knowledge 注入（startup 5 条，compact 3 条）
try {
  const projectName = getProjectName(cwd);
  const notes = scanRelatedNotes(projectName);
  if (notes.length > 0) {
    const maxNotes = eventType === 'compact' ? 3 : 5;
    process.stdout.write(`=== 相关讨论 (thoughts/ + knowledge/) ===\n`);
    notes.slice(0, maxNotes).forEach(n => {
      process.stdout.write(`[${n.status}] ${n.title}${n.summary ? ' — "' + n.summary + '"' : ''}\n`);
    });
    process.stdout.write('\n');
  }
} catch(e) {} // Vault 不可用静默跳过

log(paceUtils.projectLogEntry(cwd, 'SessionStart', 'INJECT', {
  cwd,
  proj,
  event: eventType,
  signal: paceSignal || 'none',
  artifact_dir: paceUtils.displayDir(artDir),
  choice: artifactRootChoice,
  files: found.length ? found.join(', ') : '无 Artifact 文件',
  output_bytes: sessionOutputBytes,
  truncated: sessionOutputTruncated ? 'yes' : 'no',
  version: PACE_VERSION,
}));

} catch(e) {
  // H-3: 顶层异常捕获，静默放行
  try { log(paceUtils.logEntry('SessionStart', 'ERROR', { cwd, error: e.message })); } catch(e2) {}
}
