// session-start/collect-state.js — SessionStart 注入的「纯读取层」。
//
// 用途：把 SessionStart 注入所需的全部项目状态读成一个 plain object（state），
//   供 layers.js 的纯函数 buildLayers 消费。本模块只读不写：不调用 process.stdout.write、
//   不写 .pace 运行态文件、不发起任何副作用（写盘集中在 runtime-effects.js）。
//
// 设计（CHG-A 等价重构）：collectState 逐段对照重构前 session-start.js 的读取逻辑，
//   把「读项目状态 / 读 artifact 全文 / 汇总活跃 CHG / 算执行上下文 / 读 git / 扫相关笔记 /
//   判过期 finding」等读操作集中到此，返回的字段被 buildLayers 逐层渲染。
//   per-file 截断等「文本整形」留给 layers.js（纯文本，给定 full 内容即确定），
//   本模块只提供 raw 输入（readFull 结果 + 存在性 + cwd 派生值）。
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 读取 SessionStart 注入所需的全部项目状态，返回纯数据对象（无写盘、无 stdout）。
 *
 * @param {string} cwd - 解析后的项目工作目录（resolveProjectCwd 结果）。
 * @param {string} eventType - SessionStart 事件类型（'startup' / 'compact' / 'resume' / 'clear'）。
 * @param {string|false} paceSignal - isPaceProject 检测结果（'artifact' / 其它真值 / false）。
 * @param {string} artDir - artifact 根目录（paceSignal 时为 getArtifactDir，否则 cwd）。
 * @param {object} paceUtils - pace-utils 模块（依赖注入，便于测试）。
 * @param {object} extra - 编排层已算好的派生值：{ proj, hookInput, rootChoicePending, artifactRootChoice, v5MigrationInfo }。
 * @returns {object} state - 供 buildLayers 消费的纯数据对象。
 */
function collectState(cwd, eventType, paceSignal, artDir, paceUtils, extra) {
  const {
    ARTIFACT_FILES, readFull, summarizeActiveChanges, changeOwnerStatus,
    getNativePlanPath, formatBridgeHint, scanRelatedNotes, getProjectName,
    FORMAT_SNIPPETS,
    resolveEffectiveProjectRoot, getArtifactDir,
  } = paceUtils;
  const { proj, hookInput, rootChoicePending, artifactRootChoice, v5MigrationInfo } = extra;

  // --- group 分流：core 只读项目骨架 IO，artifact 只读文件内容 IO ---
  // extra.group 由编排层（session-start.js）从 CLI --group 参数解析后传入。
  const group = (extra && extra.group) || 'core';
  const isCore = group === 'core';
  const isArtifact = group === 'artifact';

  // --- 项目上下文（重构前 writeProjectContextSection 读取部分，104-117）---
  // 两个 group 都需要：artifactDir/rootInfo 是 session 基础信息。
  const rootInfo = resolveEffectiveProjectRoot(cwd);
  const contextArtDir = paceSignal ? artDir : getArtifactDir(cwd);

  // --- Artifact 目录 section 的 mode 判定（重构前 writeArtifactDirSection，315-327）---
  const artifactDir = computeArtifactDirInfo(cwd, artDir, paceUtils);

  // --- 活跃 CHG 摘要 + owner 富集（重构前 412-414 + enrichSummaryOwner 330-339）---
  // core 读：活跃 CHG 摘要归 core group（L0 渲染、跨会话提醒、执行上下文）。
  // artifact 也读：artifact 文件循环的 foldForeignOwnedArtifactOutput 需要 activeChangeSummaries
  //   中的 foreign owner 信息来折叠 task.md/implementation_plan.md 中的 foreign CHG 索引行。
  //   两个 group 都需要读，但 core 额外渲染摘要文本，artifact 仅用于折叠。
  const activeChangeSummaries = (paceSignal === 'artifact')
    ? summarizeActiveChanges(cwd).map(summary => enrichSummaryOwner(summary, cwd, hookInput, changeOwnerStatus))
    : [];

  // --- artifact 文件 raw 读取（重构前 416-423；截断整形留 layers）---
  // 仅 artifact 读：artifact 文件块只在 artifact group 注入，core 不读（跳过无用 IO）。
  const taskFp = path.join(artDir, 'task.md');
  // artifactDirInjected 依赖 task.md 存在性，两个 group 都需判（core 渲染 Artifact 目录 section）。
  const artifactDirInjected = !!(paceSignal && fs.existsSync(taskFp));
  const artifactFiles = [];
  let taskFullCached = null;
  if (isArtifact) {
    for (const file of ARTIFACT_FILES) {
      const fp = path.join(artDir, file);
      if (!fs.existsSync(fp)) continue;
      const full = readFull(cwd, file);
      if (!full) continue;
      if (file === 'task.md') taskFullCached = full;
      artifactFiles.push({ file, full });
    }
  }

  // --- 格式合规检查输入（重构前 638-672 读取部分）---
  // 仅 artifact 读：格式警告渲染归 artifact group（R 审计发现 A 修正后），implFullForFormat + found 与渲染同 group。
  // core 既不读也不再渲染格式警告——根除「渲染在 core 但数据在 artifact」致 found 恒空、警告全 group 丢失的错位。
  let implFullForFormat = null;
  if (isArtifact && paceSignal && artifactFiles.length > 0) {
    implFullForFormat = readFull(cwd, 'implementation_plan.md');
  }

  // --- 跨会话提醒用 task.md 全文（重构前 674-678 兜底读取）---
  // 仅 core 读（跨会话提醒在 core group，renderCrossSessionAndExecution 消费 taskFullCached）。
  // artifact group：taskFullCached 已从 ARTIFACT_FILES 循环赋值（若 task.md 在列）。
  if (isCore && !taskFullCached && fs.existsSync(taskFp)) {
    try { taskFullCached = fs.readFileSync(taskFp, 'utf8'); } catch (e) {}
  }

  // --- bridge hint（重构前 696）---
  // 仅 core 读（Superpowers 桥接提醒在 core group）。
  let bridgeHint = null;
  if (isCore && paceSignal) {
    try { bridgeHint = formatBridgeHint(cwd, artDir); } catch (e) { bridgeHint = null; }
  }

  // --- native plan 路径（重构前 266 / 211-214）---
  // 仅 core 读（Native Plan 桥接提醒在 core group）。
  let nativePlanPath = null;
  if (isCore) {
    try { nativePlanPath = getNativePlanPath(cwd); } catch (e) { nativePlanPath = null; }
  }

  // --- findings 过期判定（重构前 757-787 读取/判定部分，写 flag 留 effects）---
  //   ageFlagExistedBefore 由编排层在 effects（W12 写 flag）之前快照传入。
  //   R 审计发现 B 修正：agedFindings 留 core group——去重依赖 W12 flag（findings-age），
  //   而 W12 flag 当前写在 core 的 applyRuntimeEffects。读取(collectAgedFindings)+渲染(renderAgedFindings)
  //   +flag 写须同 group，否则跨 group 时序割裂致不注入（发现 B2）。CHG-11/T-006 整体移 artifact。
  //   artifact group：给空默认值，不做 findings 过期判定。
  const agedFindings = isCore
    ? collectAgedFindings(cwd, paceSignal, paceUtils, extra.ageFlagExistedBefore)
    : { shouldInject: false, aged: [] };

  // --- git 状态（重构前 790-799）---
  // 仅 core 读（git 状态块在 core group）。artifact 给 null。
  const git = isCore ? collectGit(cwd) : null;

  // --- 相关讨论（重构前 801-813）---
  // 仅 core 读（相关讨论块在 core group）。artifact 给空数组。
  const relatedNotes = isCore
    ? collectRelatedNotes(cwd, getProjectName, scanRelatedNotes)
    : [];

  return {
    cwd,
    eventType,
    paceSignal,
    proj,
    artDir,
    rootChoicePending,
    artifactRootChoice,
    v5MigrationInfo,
    hookInput,
    // 项目上下文
    projectContext: { cwd, rootInfo, contextArtDir },
    // Artifact 目录 section
    artifactDir,
    artifactDirInjected,
    // artifact 文件
    artifactFiles,
    taskFullCached,
    // 活跃 CHG
    activeChangeSummaries,
    // 格式检查
    implFullForFormat,
    // 提醒/桥接
    bridgeHint,
    nativePlanPath,
    // findings 过期
    agedFindings,
    // git
    git,
    // 相关讨论
    relatedNotes,
    // L2 格式速查
    formatReference: FORMAT_SNIPPETS,
  };
}

/**
 * 用 owner 状态富集单个活跃 CHG 摘要（重构前 enrichSummaryOwner 330-339）。
 * @param {object} summary - summarizeActiveChanges 单条结果。
 * @param {string} cwd - 项目工作目录。
 * @param {object} hookInput - 解析后的 SessionStart event。
 * @param {Function} changeOwnerStatus - pace-utils.changeOwnerStatus。
 * @returns {object} 富集 owner 字段后的摘要。
 */
function enrichSummaryOwner(summary, cwd, hookInput, changeOwnerStatus) {
  const ownerStatus = changeOwnerStatus(cwd, summary.id, hookInput.sessionId);
  return {
    ...summary,
    ownerDisposition: ownerStatus.disposition,
    ownerWorktree: ownerStatus.owner && ownerStatus.owner.worktree || '',
    ownerBranch: ownerStatus.owner && ownerStatus.owner.branch || '',
    ownerState: ownerStatus.owner && ownerStatus.owner.state || '',
  };
}

/**
 * 计算 Artifact 目录 section 的展示信息（重构前 writeArtifactDirSection 315-327 的非 I/O 部分）。
 * @param {string} cwd - 项目工作目录。
 * @param {string} artDir - artifact 根目录。
 * @param {object} paceUtils - pace-utils 模块。
 * @returns {object} { display, mode, content, scripts } —— 供 layers 渲染 artifact 目录段。
 */
function computeArtifactDirInfo(cwd, artDir, paceUtils) {
  const { normalizePath, getProjectStateDir, readArtifactRootChoice, VAULT_PATH, displayDir,
    PACE_ARTIFACT_ROOT_CONTENT, SET_ARTIFACT_ROOT_SCRIPT, SET_PROJECT_ROOT_SCRIPT,
    RESERVE_ARTIFACT_ID_SCRIPT, SYNC_PLAN_SCRIPT } = paceUtils;
  const normalizedArtDir = normalizePath(path.resolve(artDir));
  const stateDir = getProjectStateDir(cwd);
  const normalizedStateDir = normalizePath(path.resolve(stateDir));
  const choice = readArtifactRootChoice(cwd).toLowerCase();
  let mode = normalizedArtDir === normalizedStateDir ? '本地项目根目录' : '自定义 artifact 根目录';
  if (choice === 'vault') mode = 'Obsidian vault project';
  else if (choice === 'local') mode = '本地项目根目录';
  else if (VAULT_PATH) {
    const vaultRoot = normalizePath(path.resolve(VAULT_PATH, 'projects'));
    if (normalizedArtDir.startsWith(`${vaultRoot}/`)) mode = 'Obsidian vault project';
  }
  return {
    display: displayDir(artDir),
    mode,
    content: PACE_ARTIFACT_ROOT_CONTENT,
    scripts: {
      setArtifactRoot: SET_ARTIFACT_ROOT_SCRIPT,
      setProjectRoot: SET_PROJECT_ROOT_SCRIPT,
      reserveArtifactId: RESERVE_ARTIFACT_ID_SCRIPT,
      syncPlan: SYNC_PLAN_SCRIPT,
    },
  };
}

/**
 * 判定 findings 活跃区中超过 14 天未流转的开放项（重构前 757-787 的判定部分）。
 * 仅返回判定结果；写 findings-age flag 的副作用留给 runtime-effects.js。
 * @param {string} cwd - 项目工作目录。
 * @param {string|false} paceSignal - PACE 检测结果。
 * @param {object} paceUtils - pace-utils 模块。
 * @param {boolean} [ageFlagExistedBefore] - 编排层在 effects（W12 写 flag）之前快照的 flag 存在性；
 *   传入时用它判定「今日是否已提醒」，避免读到 W12 刚写的 flag。未传时回落到实时 stat（PRINT_ONLY 路径，
 *   effects 不跑、不会污染 flag）。
 * @returns {{ shouldInject: boolean, aged: Array<{title:string,days:number}> }}
 */
function collectAgedFindings(cwd, paceSignal, paceUtils, ageFlagExistedBefore) {
  const { readActive, todayISO, daysSinceISODate, getProjectRuntimeDir } = paceUtils;
  const result = { shouldInject: false, aged: [] };
  if (!paceSignal) return result;
  try {
    const findingsActive = readActive(cwd, 'findings.md');
    if (!findingsActive) return result;
    const yyyy = todayISO();
    const ageFlag = path.join(getProjectRuntimeDir(cwd), `findings-age-${yyyy}`);
    // flag 已存在 → 今日已提醒过，不再注入（与重构前 if (!fs.existsSync(ageFlag)) 一致）。
    const flagExists = (typeof ageFlagExistedBefore === 'boolean') ? ageFlagExistedBefore : fs.existsSync(ageFlag);
    if (flagExists) return result;
    const aged = [];
    const openLines = findingsActive.match(/^- \[ \] .+$/gm) || [];
    for (const line of openLines) {
      const dm = line.match(/\[date:: (\d{4}-\d{2}-\d{2})\]/);
      if (!dm) continue;
      const days = daysSinceISODate(dm[1], yyyy);
      if (days !== null && days >= 14) {
        const link = line.match(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
        const title = (link && (link[2] || link[1]) || (line.match(/^- \[ \] ([^—#\[]+)/) || [])[1] || line.slice(6, 60)).trim();
        aged.push({ title, days });
      }
    }
    result.shouldInject = true; // flag 不存在即「今日首次」，无论是否有 aged 都要写 flag（effects 据此）。
    result.aged = aged;
  } catch (e) {}
  return result;
}

/**
 * 读取 git 分支与最近提交（重构前 790-799）。
 * @param {string} cwd - 项目工作目录。
 * @returns {{ branch: string, lastCommit: string }|null} 非 git 项目返回 null。
 */
function collectGit(cwd) {
  try {
    const { execSync } = require('child_process');
    const gitOpts = { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
    const branch = execSync('git rev-parse --abbrev-ref HEAD', gitOpts).trim();
    const lastCommit = execSync('git log --oneline -1', gitOpts).trim();
    if (branch && lastCommit) return { branch, lastCommit };
  } catch (e) {} // 非 git 项目静默跳过
  return null;
}

/**
 * 扫描相关 thoughts/knowledge 笔记（重构前 801-813）。
 * @param {string} cwd - 项目工作目录。
 * @param {Function} getProjectName - pace-utils.getProjectName。
 * @param {Function} scanRelatedNotes - pace-utils.scanRelatedNotes。
 * @returns {Array} scanRelatedNotes 结果（Vault 不可用时空数组）。
 */
function collectRelatedNotes(cwd, getProjectName, scanRelatedNotes) {
  try {
    const projectName = getProjectName(cwd);
    return scanRelatedNotes(projectName) || [];
  } catch (e) { return []; } // Vault 不可用静默跳过
}

module.exports = { collectState, enrichSummaryOwner, collectAgedFindings, collectGit };
