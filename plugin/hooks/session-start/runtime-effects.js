// session-start/runtime-effects.js — SessionStart 的「运行态副作用层」（集中 12 写盘点 W1–W12）。
//
// 用途：applyRuntimeEffects(...) 把重构前散落在 session-start.js 148–784 行的 12 个 .pace 写盘点
//   集中为单一副作用步骤。编排层在 PRINT_ONLY 时整段跳过此调用（一处短路），
//   替代重构前 7 处散落 `!PRINT_ONLY` 守卫。
//
// 行为锁定（docs/audits/2026-06-08-session-start-runtime-writes-reference.md）：
//   逐条保持每个写盘点的触发条件 / 事件模式（startup/compact/both）/ 目标 / 语义不变。
//   - W1–W6：startup 重置块（paceSignal && !rootChoicePending && eventType !== 'compact'）
//   - W7–W9：已退役（M4/T-002）。原 compact 快照消费（删非法快照 / 恢复 counter / 消费后删快照）整体移除；
//            compact 与 startup 统一走 collectState/buildLayers 实时读 artifact 路径（OQ-1 + A0 对称）。
//   - W10：ensureProjectInfra（both，paceSignal && !rootChoicePending）
//   - W11：createTemplates（both 无 eventType 守卫，rootChoicePending else-if）
//   - W12：findings-age flag（both，paceSignal && 当日首次）
//
// group 分流（CHG-20260608-11/T-001）：W12（findings-age flag 写）随 findings 过期提醒三元组
//   （①W12 flag 写 ②collectAgedFindings 读 ③renderAgedFindings 渲染）整体归 artifact group，
//   移出 core 的 applyRuntimeEffects、改由 applyArtifactGroupEffects 执行——三者必须同 group，
//   否则 core 写 flag、artifact 随后读到「已存在」→ 判「今日已提醒」→ 永不注入（时序割裂）。
//   W10/W11 在两个 group 都跑（applyArtifactGroupEffects 幂等再跑做自保：若 artifact hook 先于 core，
//   artifact 读文件前 task.md 模板已由自己建好；ensureProjectInfra/createTemplates 本身幂等，task.md
//   已存在则跳过，重复调用安全）。applyRuntimeEffects 现含 W1–W11（W12 已迁出）。
//
// PRINT_ONLY 不应到达本模块：编排层只在 !PRINT_ONLY 时调用 applyRuntimeEffects。
//   为防御散落写盘回归，本模块仍不读 PRINT_ONLY——靠单一调用点短路。
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 执行 SessionStart core group 的运行态写盘副作用（W1–W11）。仅在非 PRINT_ONLY 时由编排层调用。
 *   W12（findings-age flag）已随 findings 过期提醒三元组迁出至 applyArtifactGroupEffects（artifact group）。
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
 *   }
 * eventType 入参保留（W1–W6 startup 重置块仍用 eventType !== 'compact' 守卫）；W7–W9 compact
 *   快照消费已退役（M4/T-002），不再读 deps.compactSnapshot。
 */
function applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, deps) {
  const { paceUtils, log, PACE_RUNTIME, COUNTER_FILE, v5MigrationInfo, artifactRootChoice } = deps;
  const { SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, todayISO, ensureProjectInfra,
    createTemplates } = paceUtils; // readActive/getProjectRuntimeDir 随 W12 迁出，已移至 applyArtifactGroupEffects

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

  // === W7–W9（已退役，M4/T-002）===
  //   PreCompact 快照机制（pre-compact-state.json 读/写/消费 + counter 恢复）整体退役：
  //   collectState/buildLayers 实时读 artifact 已完整覆盖 compact 场景，compact 与 startup
  //   统一走实时读路径（OQ-1 + A0 对称）。原 W7 删非法快照 / W8 恢复 counter / W9 消费后删快照 全删。

  // === W10：ensureProjectInfra（重构前 276-278，both）===
  if (paceSignal && !rootChoicePending) {
    try { ensureProjectInfra(cwd); } catch (e) {}
  }

  // === W11：createTemplates（重构前 282-313 的 else-if，both 无 eventType 守卫）===
  //   rootChoicePending 分支本身无写盘（只注入提示 + log，注入文本由 layers 生成、log 由编排层 flush）。
  //   CHG-A A3：code-count/dated-plan 弱信号已从 isPaceProject 移除 → paceSignal=false → 守卫整块短路，
  //   不再对软信号项目静默建 changes/。仅强信号（manual/legacy，paceSignal!=='artifact' 且非空）走懒建模板。
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
}

/**
 * 执行 SessionStart artifact group 的运行态写盘副作用（W10 + W11 + W12）。仅在非 PRINT_ONLY 时由编排层调用。
 *   W10/W11 与 core 的 applyRuntimeEffects 重复执行（幂等自保）：保证 artifact hook 即便先于 core 执行，
 *   读 artifact 文件前 task.md/基础设施已就绪。W12（findings-age flag）随 findings 过期提醒三元组归此 group，
 *   与 collectAgedFindings 读 / renderAgedFindings 渲染同 group，杜绝跨 group 写读时序割裂致永不注入。
 *
 * @param {string} cwd - 项目工作目录。
 * @param {string|false} paceSignal - PACE 检测结果。
 * @param {string} artDir - artifact 根目录。
 * @param {object} deps - 依赖与编排层已算好的派生值：
 *   {
 *     paceUtils,                  // pace-utils 模块
 *     log,                        // 日志函数
 *     rootChoicePending,          // 首次 artifact-root 选择待定态（W10/W11 守卫）
 *     v5MigrationInfo,            // v5 迁移信息（W11 守卫）
 *     artifactRootChoice, proj,   // CREATE_TEMPLATES 日志字段
 *   }
 */
function applyArtifactGroupEffects(cwd, paceSignal, artDir, deps) {
  const { paceUtils, log, rootChoicePending, v5MigrationInfo, artifactRootChoice } = deps;
  const { todayISO, ensureProjectInfra, createTemplates, readActive, getProjectRuntimeDir } = paceUtils;

  // === W10：ensureProjectInfra（与 core 重复，幂等）===
  if (paceSignal && !rootChoicePending) {
    try { ensureProjectInfra(cwd); } catch (e) {}
  }

  // === W11：createTemplates（与 core 重复，幂等；task.md 已存在则不重建）===
  //   守卫与 core 的 applyRuntimeEffects 一字不差：rootChoicePending/v5MigrationInfo/task.md 存在性。
  //   CHG-A A3：code-count/dated-plan 弱信号已从 isPaceProject 移除 → paceSignal=false → 守卫整块短路，
  //   不再对软信号项目静默建 changes/。仅强信号（manual/legacy，paceSignal!=='artifact' 且非空）走懒建模板。
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
  //   随 findings 过期提醒三元组归 artifact group：写 flag 必须与 collectAgedFindings 读、
  //   renderAgedFindings 渲染同 group，否则 core 写 flag → artifact 读到已存在 → 永不注入。
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

module.exports = { applyRuntimeEffects, applyArtifactGroupEffects };
