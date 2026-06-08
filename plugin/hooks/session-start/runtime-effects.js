// session-start/runtime-effects.js — SessionStart 的「运行态副作用层」（集中 12 写盘点 W1–W12）。
//
// 用途：applyRuntimeEffects(...) 把重构前散落在 session-start.js 148–784 行的 12 个 .pace 写盘点
//   集中为单一副作用步骤。编排层在 PRINT_ONLY 时整段跳过此调用（一处短路），
//   替代重构前 7 处散落 `!PRINT_ONLY` 守卫。
//
// 行为锁定（docs/audits/2026-06-08-session-start-runtime-writes-reference.md）：
//   逐条保持每个写盘点的触发条件 / 事件模式（startup/compact/both）/ 目标 / 语义不变。
//   - W1–W6：startup 重置块（paceSignal && !rootChoicePending && eventType !== 'compact'）
//   - W7–W9：compact 快照消费（W7 删非法快照 / W8 从快照恢复 counter / W9 消费后删快照）
//   - W10：ensureProjectInfra（both，paceSignal && !rootChoicePending）
//   - W11：createTemplates（both 无 eventType 守卫，rootChoicePending else-if）
//   - W12：findings-age flag（both，paceSignal && 当日首次）
//
// PRINT_ONLY 不应到达本模块：编排层只在 !PRINT_ONLY 时调用 applyRuntimeEffects。
//   为防御散落写盘回归，本模块仍不读 PRINT_ONLY——靠单一调用点短路。
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 执行 SessionStart 的全部运行态写盘副作用（W1–W12）。仅在非 PRINT_ONLY 时由编排层调用。
 *
 * @param {string} cwd - 项目工作目录。
 * @param {string} eventType - SessionStart 事件类型。
 * @param {string|false} paceSignal - PACE 检测结果。
 * @param {boolean} rootChoicePending - 是否处于首次 artifact-root 选择待定态。
 * @param {string} artDir - artifact 根目录。
 * @param {object} deps - 依赖与编排层已算好的派生值：
 *   {
 *     paceUtils,                  // pace-utils 模块
 *     log,                        // 日志函数
 *     PACE_RUNTIME, COUNTER_FILE, // .pace 目录与 counter 文件路径
 *     v5MigrationInfo, artifactRootChoice, proj,
 *     compactSnapshot,            // 编排层预解析的 compact 快照（{ exists, valid, snap }）；
 *                                 //   先于本调用读取，确保 W9 删除前注入文本已生成
 *   }
 */
function applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, deps) {
  const { paceUtils, log, PACE_RUNTIME, COUNTER_FILE, v5MigrationInfo, artifactRootChoice } = deps;
  const { SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, todayISO, ensureProjectInfra,
    createTemplates, readActive, getProjectRuntimeDir } = paceUtils;

  // === W1–W6：startup 重置块（重构前 147-171）===
  if (paceSignal && !rootChoicePending && eventType !== 'compact') {
    try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch (e) {}                 // W1
    try { fs.writeFileSync(COUNTER_FILE, '0', 'utf8'); } catch (e) {}                      // W2
    for (const flag of SESSION_SCOPED_FLAGS) {                                             // W3
      try { const fp = path.join(PACE_RUNTIME, flag); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
    }
    try {                                                                                  // W4
      for (const f of fs.readdirSync(PACE_RUNTIME)) {
        if (SESSION_SCOPED_FLAG_PREFIXES.some(prefix => f.startsWith(prefix))) {
          try { fs.unlinkSync(path.join(PACE_RUNTIME, f)); } catch (e) {}
        }
      }
    } catch (e) {}
    try {                                                                                  // W5
      const todayFindingsFlag = `findings-age-${todayISO()}`;
      for (const f of fs.readdirSync(PACE_RUNTIME)) {
        if (f.startsWith('findings-age-') && f !== todayFindingsFlag) {
          try { fs.unlinkSync(path.join(PACE_RUNTIME, f)); } catch (e) {}
        }
      }
    } catch (e) {}
    try { paceUtils.sweepStaleRuntimeOwners(cwd); } catch (e) {}                           // W6
  }

  // === W7–W9：compact 快照消费写盘（重构前 181 / 203-208 / 257）===
  //   注入文本由编排层先读快照生成（state.compactSnapshotText），此处只做写盘。
  if (eventType === 'compact') {
    const snapFile = path.join(PACE_RUNTIME, 'pre-compact-state.json');
    const cs = deps.compactSnapshot || { exists: false, valid: false, snap: null };
    if (cs.exists) {
      if (!cs.valid) {
        try { fs.unlinkSync(snapFile); } catch (e) {}                                      // W7 删非法快照
      } else {
        const snap = cs.snap;
        if (Number.isFinite(Number(snap.runtime?.blockCount)) && Number(snap.runtime.blockCount) > 0) {
          try {                                                                            // W8 从快照恢复 counter
            fs.mkdirSync(PACE_RUNTIME, { recursive: true });
            fs.writeFileSync(COUNTER_FILE, String(Number(snap.runtime.blockCount)), 'utf8');
          } catch (e) {}
        }
        try { fs.unlinkSync(snapFile); } catch (e) {}                                      // W9 消费后删快照
      }
    }
  }

  // === W10：ensureProjectInfra（重构前 276-278，both）===
  if (paceSignal && !rootChoicePending) {
    try { ensureProjectInfra(cwd); } catch (e) {}
  }

  // === W11：createTemplates（重构前 282-313 的 else-if，both 无 eventType 守卫）===
  //   rootChoicePending 分支本身无写盘（只注入提示 + log，注入文本由 layers 生成、log 由编排层 flush）。
  if (!(rootChoicePending && !fs.existsSync(path.join(artDir, 'task.md')))
      && paceSignal && paceSignal !== 'artifact' && !v5MigrationInfo.detected
      && !fs.existsSync(path.join(artDir, 'task.md'))) {
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

  // === W12：findings-age flag（重构前 784，both，当日首次）===
  if (paceSignal) {
    try {
      const findingsActive = readActive(cwd, 'findings.md');
      if (findingsActive) {
        const yyyy = todayISO();
        const ageFlag = path.join(getProjectRuntimeDir(cwd), `findings-age-${yyyy}`);
        if (!fs.existsSync(ageFlag)) {
          try { fs.writeFileSync(ageFlag, '1', 'utf8'); } catch (e) {}
        }
      }
    } catch (e) {}
  }
}

/**
 * 读取并解析 compact 快照（供编排层先于 applyRuntimeEffects 调用，以在 W9 删除前生成注入文本）。
 * @param {string} runtimeDir - .pace 运行态目录。
 * @returns {{ exists: boolean, valid: boolean, snap: object|null }}
 */
function readCompactSnapshot(runtimeDir) {
  const snapFile = path.join(runtimeDir, 'pre-compact-state.json');
  try {
    if (!fs.existsSync(snapFile)) return { exists: false, valid: false, snap: null };
    const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
    if (!snap || typeof snap !== 'object') return { exists: true, valid: false, snap: null };
    return { exists: true, valid: true, snap };
  } catch (e) {
    // 重构前外层 try/catch 吞掉解析异常并整段跳过；这里返回「不存在」语义等价（无注入、无写盘）。
    return { exists: false, valid: false, snap: null };
  }
}

module.exports = { applyRuntimeEffects, readCompactSnapshot };
