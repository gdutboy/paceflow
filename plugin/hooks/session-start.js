// SessionStart hook：瘦编排层。
//   解析输入 → （非 PRINT_ONLY）运行态副作用 → collectState 纯读取 → buildLayers 纯渲染
//   → assembleWithBudget 装配 → 单次输出 + flush 日志。
//
// 三段式解耦（CHG-20260608-04 / CHG-A）：
//   - 运行态副作用（12 写盘点 W1–W12）集中在 session-start/runtime-effects.js，PRINT_ONLY 一处短路；
//   - 注入内容生成（L0–L3 各 section 文本）是 session-start/layers.js 的纯函数，可喂 fixture 单测；
//   - 项目状态读取集中在 session-start/collect-state.js（纯读、无写盘、无 stdout）；
//   - 预算装配在 session-start/budget.js。
//   本 CHG 为 byte-等价重构：注入输出与重构前逐字一致（print-session-context.js diff 为空）。
//
// PACE_PRINT_ONLY：print-session-context.js helper 设此 env，让本 hook 只产出注入 stdout、
//   跳过一切 .pace 运行态写盘——靠「!PRINT_ONLY 时才调用 applyRuntimeEffects」单点短路实现
//   （替代重构前 7 处散落 !PRINT_ONLY 守卫）。
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, isPaceProject, getArtifactDir, getProjectName, artifactRootChoiceNeeded } = paceUtils;
const { collectState } = require('./session-start/collect-state');
const { buildLayers, buildCompactSnapshotText } = require('./session-start/layers');
const { assembleWithBudget } = require('./session-start/budget');
const { applyRuntimeEffects, readCompactSnapshot } = require('./session-start/runtime-effects');

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');
const PRINT_ONLY = !!process.env.PACE_PRINT_ONLY;
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

// 全局字节守卫：注入输出单次 write 经此累计字节、超 SESSION_OUTPUT_BUDGET_BYTES 截断。
//   重构后注入只有一次 write，但守卫作为第二道防线保留（任何额外 write 仍受约束）。
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

// v4.3: 多信号 PACE 检测
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

// === compact 快照预读（先于运行态副作用，确保 W9 删除前注入文本已生成）===
//   重构前 compact 注入文本与 W7/W8/W9 写盘缠在同一 if（174-258）。解耦后：编排层先读快照并
//   生成注入文本，再把已解析快照交给 applyRuntimeEffects 做写盘，避免「先删后读」丢失注入。
let compactSnapshotText = '';
let compactSnapshot = { exists: false, valid: false, snap: null };
if (eventType === 'compact') {
  compactSnapshot = readCompactSnapshot(PACE_RUNTIME);
  if (compactSnapshot.exists && !compactSnapshot.valid) {
    // 重构前 180：非法快照 → COMPACT_SNAPSHOT_SKIP 日志（PRINT_ONLY 也记；unlink 由 effects 守卫）。
    log(paceUtils.logEntry('SessionStart', 'COMPACT_SNAPSHOT_SKIP', { cwd, reason: 'invalid-snapshot' }));
  } else if (compactSnapshot.valid) {
    let snapNativePlan = null;
    try { snapNativePlan = paceUtils.getNativePlanPath(cwd); } catch(e) {}
    compactSnapshotText = buildCompactSnapshotText(compactSnapshot.snap, paceSignal, cwd, snapNativePlan, paceUtils);
  }
}

// === rootChoicePending 启用提示文本（重构前 282-300）===
//   该分支无写盘（只注入 + log）；注入文本在此生成、注入位置由 layers 复刻 golden。
let rootChoicePromptText = '';
if (rootChoicePending && !fs.existsSync(path.join(artDir, 'task.md'))) {
  log(paceUtils.logEntry('SessionStart', 'ARTIFACT_ROOT_CHOICE_PENDING', {
    cwd,
    signal: paceSignal,
    choice_path: paceUtils.getArtifactRootChoicePath(cwd),
    local_artifact_dir: paceUtils.displayDir(paceUtils.getProjectStateDir(cwd)),
    vault_artifact_dir: paceUtils.VAULT_PATH ? paceUtils.displayDir(path.join(paceUtils.VAULT_PATH, 'projects', getProjectName(cwd))) : '',
  }));
  rootChoicePromptText = [
    '=== PACEflow 启用提示 ===',
    '本项目已触发 PACEflow 信号；收到代码修改任务时先调用 Skill(paceflow:pace-workflow)。',
    '涉及 artifact/CHG 字段、任务状态、批准、验证或归档时，再调用 Skill(paceflow:artifact-management)。',
    '首次写代码或派 artifact-writer 时，PreToolUse 会要求选择 artifact root；选择前不会创建 .pace/、changes/ 或 Obsidian 空项目目录。',
    `若当前子目录应作为独立 PaceFlow 项目，先运行：node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    `若用户已明确选择 vault/local，先从当前项目 cwd 运行：node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    `配置写入后再运行：node "${paceUtils.RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg`,
    'reserve helper 不接受 --artifact-dir / --artifact-root / --project-dir；不要搜索 plugin cache 猜版本。',
    '',
  ].join('\n') + '\n';
}

// findings-age flag 存在性快照（必须在 effects 的 W12 写 flag 之前取）：
//   重构前注入判定与 W12 写 flag 在同一 if (!fs.existsSync(ageFlag)) 块内、用写之前的状态；
//   解耦后 effects 先于 collectState，故在此先快照，传给 collectState 判定注入。
let ageFlagExistedBefore = false;
if (paceSignal) {
  try { ageFlagExistedBefore = fs.existsSync(path.join(PACE_RUNTIME, `findings-age-${paceUtils.todayISO()}`)); } catch(e) {}
}

// === 运行态副作用：12 写盘点集中，PRINT_ONLY 一处短路（替代散落守卫）===
//   注意：effects 内 W10/W11 会创建 .gitignore / task.md 模板，须在 collectState 读文件前执行
//   （与重构前 276/282 写盘先于 416 读取循环的顺序一致）。
if (!PRINT_ONLY) {
  applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, {
    paceUtils, log, PACE_RUNTIME, COUNTER_FILE,
    v5MigrationInfo, artifactRootChoice, proj, compactSnapshot,
  });
}

// === 纯读取层：项目状态 → state ===
const state = collectState(cwd, eventType, paceSignal, artDir, paceUtils, {
  proj, hookInput, rootChoicePending, artifactRootChoice, v5MigrationInfo, ageFlagExistedBefore,
});
// 编排层预生成的注入文本块挂到 state，供 layers 在 golden 原位拼接。
state.compactSnapshotText = compactSnapshotText;
state.rootChoicePromptText = rootChoicePromptText;

// === 纯渲染层：state → L0–L3 文本块 ===
const layers = buildLayers(state, eventType, paceUtils);

// === flush layers 渲染期累积的日志（FINDINGS_DETAIL_MATCH_MISS / SKIPPED_REMINDER / 桥接 / owner / blocked）===
if (Array.isArray(state._logs)) {
  for (const entry of state._logs) { try { log(entry); } catch(e) {} }
}

// === 预算装配 + 单次输出 ===
const { text } = assembleWithBudget(layers, { limitBytes: SESSION_OUTPUT_BUDGET_BYTES });
process.stdout.write(text);

log(paceUtils.projectLogEntry(cwd, 'SessionStart', 'INJECT', {
  cwd,
  proj,
  event: eventType,
  signal: paceSignal || 'none',
  artifact_dir: paceUtils.displayDir(artDir),
  choice: artifactRootChoice,
  files: (state._found && state._found.length) ? state._found.join(', ') : '无 Artifact 文件',
  output_bytes: sessionOutputBytes,
  truncated: sessionOutputTruncated ? 'yes' : 'no',
  version: PACE_VERSION,
}));

} catch(e) {
  // H-3: 顶层异常捕获，静默放行
  try { log(paceUtils.logEntry('SessionStart', 'ERROR', { cwd, error: e.message })); } catch(e2) {}
}
