// SessionStart hook：重置 Stop 计数器 + 多信号 PACE 检测创建模板 + 注入活跃区 + 跳过任务提醒 + TodoWrite 同步
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, ts, isPaceProject, ARTIFACT_FILES, SESSION_SCOPED_FLAGS, readFull, createTemplates, ensureProjectInfra, scanRelatedNotes, getArtifactDir, getProjectName, listUnsyncedPlanFiles, FORMAT_SNIPPETS, ARCHIVE_MARKER, ARCHIVE_PATTERN, extractOpenKeys } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const PACE_RUNTIME = path.join(cwd, '.pace');
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');

// v4: 重置 Stop 防无限循环计数器 + 清除降级标记 + 确保 .pace/ 目录存在
try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
try { fs.writeFileSync(COUNTER_FILE, '0', 'utf8'); } catch(e) {}
// W-code-4: 使用 SESSION_SCOPED_FLAGS 常量（与 pace-utils 保持同步）
for (const flag of SESSION_SCOPED_FLAGS) {
  try { const fp = path.join(PACE_RUNTIME, flag); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch(e) {}
}

// S-1: 统一 stdin 解析
const eventType = paceUtils.parseStdinSync().type || 'startup';

// H-3: 顶层 try-catch 安全网（内部 try-catch 保留不变）
try {

// v4.3: 多信号 PACE 检测（替换原有 codeFileCount >= 3）
const paceSignal = isPaceProject(cwd);
const files = ARTIFACT_FILES;
const artDir = paceSignal ? getArtifactDir(cwd) : cwd;

// v4.5: compact 事件读取 PreCompact 快照
if (eventType === 'compact') {
  const snapFile = path.join(PACE_RUNTIME, 'pre-compact-state.json');
  try {
    if (fs.existsSync(snapFile)) {
      const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
      const lines = [`=== Compact 恢复（快照 ${snap.timestamp}）===`];
      if (snap.artifacts?.['task.md']?.inProgress?.length > 0) {
        lines.push('进行中任务:');
        snap.artifacts['task.md'].inProgress.forEach(t => lines.push(`  ${t}`));
      }
      if (snap.artifacts?.['task.md']?.pending > 0) {
        lines.push(`待办任务: ${snap.artifacts['task.md'].pending} 个`);
      }
      if (snap.runtime?.degraded) {
        lines.push('⚠️ Stop hook 已降级');
      }
      // v5.0.1: compact 后 native plan 恢复提示
      if (snap.nativePlans && snap.nativePlans.length > 0) {
        lines.push('');
        lines.push('⚠️ 检测到 compact 前有未桥接的原生计划文件：');
        snap.nativePlans.forEach(p => lines.push(`  ${p}`));
        lines.push('请 Read 相关文件并桥接到 PACE artifacts（task.md + implementation_plan.md）。');
      }
      // AI 主动记录的 native plan 路径（优先于扫描结果）
      const nativePlanFile = path.join(PACE_RUNTIME, 'current-native-plan');
      try {
        if (fs.existsSync(nativePlanFile)) {
          const planPath = fs.readFileSync(nativePlanFile, 'utf8').trim();
          if (planPath) {
            lines.push('');
            lines.push(`⚠️ 你之前创建了原生计划文件：${planPath}`);
            lines.push('请 Read 该文件并桥接到 PACE artifacts。');
          }
        }
      } catch(e) {}
      process.stdout.write(lines.join('\n') + '\n\n');
      // v5.0.2: compact 恢复后注入格式快速参考
      if (paceSignal) {
        process.stdout.write(`\n=== 格式快速参考 ===\n`);
        process.stdout.write(`任务格式：${FORMAT_SNIPPETS.taskEntry}\n`);
        process.stdout.write(`索引格式：${FORMAT_SNIPPETS.implIndex}\n`);
        process.stdout.write(`任务状态：${FORMAT_SNIPPETS.statusHelp}\n`);
        process.stdout.write(`变更状态：${FORMAT_SNIPPETS.changeStatusHelp}\n`);
        process.stdout.write(`findings 格式：${FORMAT_SNIPPETS.findingsFormat}\n`);
        process.stdout.write(`walkthrough 格式：${FORMAT_SNIPPETS.walkthroughFormat}\n`);
        process.stdout.write(`标记位置：${FORMAT_SNIPPETS.approved}\n`);
        process.stdout.write(`验证标记：${FORMAT_SNIPPETS.verified}\n`);
        process.stdout.write(`impl_plan 详情：${FORMAT_SNIPPETS.implDetailRule}\n\n`);
      }
      // v5.0.2: compact 恢复 snapshot.findings/walkthrough
      if (snap.findings) {
        process.stdout.write(`findings 状态：${snap.findings.openCount} 个开放项\n`);
      }
      if (snap.walkthrough && !snap.walkthrough.hasTodayEntry) {
        process.stdout.write(`⚠️ compact 前 walkthrough 无今日记录\n`);
      }
      // W-11: 独立 try-catch 防止删除失败影响后续逻辑
      try { fs.unlinkSync(snapFile); } catch(e) {}
    }
  } catch(e) {}
}

// T-326: startup 路径也检测 .pace/current-native-plan（修复跨会话盲区）
if (eventType !== 'compact') {
  const nativePlanFile = path.join(PACE_RUNTIME, 'current-native-plan');
  try {
    if (fs.existsSync(nativePlanFile)) {
      const planPath = fs.readFileSync(nativePlanFile, 'utf8').trim();
      if (planPath) {
        process.stdout.write(`\n=== Native Plan 桥接提醒 ===\n`);
        process.stdout.write(`检测到未桥接的原生计划文件：${planPath}\n`);
        process.stdout.write(`请 Read 该文件并桥接到 PACE artifacts（task.md + implementation_plan.md），完成后删除 .pace/current-native-plan。\n\n`);
      }
    }
  } catch(e) {}
}

// T-204: 基础设施幂等确保（junction + .gitignore），不依赖模板是否创建
if (paceSignal) {
  try { ensureProjectInfra(cwd); } catch(e) {}
}

// T-077: 非 false 且非 'artifact'（已有文件不需重复创建）+ 无 task.md → 复用公共函数创建模板
if (paceSignal && paceSignal !== 'artifact' && !fs.existsSync(path.join(artDir, 'task.md'))) {
  const created = createTemplates(cwd);
  if (created.length > 0) {
    log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: CREATE_TEMPLATES | signal: ${paceSignal} | files: ${created.join(', ')}\n`);
  }
}

// 提取活跃区注入上下文（缓存 task.md 全文供后续复用）
const found = [];
let taskFullCached = null;

for (const file of files) {
  const fp = path.join(artDir, file);
  if (!fs.existsSync(fp)) continue;

  const full = readFull(cwd, file);
  if (!full) continue;

  if (file === 'task.md') taskFullCached = full;

  process.stdout.write(`=== ${file} ===\n`);
  const archiveMatch = full.match(ARCHIVE_PATTERN);
  let output = archiveMatch ? full.slice(0, archiveMatch.index) : full;

  // T-385: spec.md 截断 — 保留项目概述+技术栈，省略编码规范/目录结构/依赖列表
  if (file === 'spec.md') {
    const techMatch = output.match(/^## 技术栈/m);
    if (techMatch) {
      const rest = output.slice(techMatch.index);
      const nextH2 = rest.match(/\n## (?!技术栈)/);
      if (nextH2) {
        output = output.slice(0, techMatch.index + nextH2.index)
          + '\n\n（已省略编码规范/目录结构/依赖列表，需要时 Read spec.md）\n';
      }
    }
  }

  // T-386: walkthrough 智能截断 — 索引表最近 10 行 + 最近 3 条详情段落
  if (file === 'walkthrough.md') {
    // 索引表截断：保留表头 + 最近 10 行数据行
    const dataRe = /^\| \d{4}-\d{2}-\d{2} \|/gm;
    const dataRows = [];
    let m;
    while ((m = dataRe.exec(output)) !== null) {
      const lineStart = output.lastIndexOf('\n', m.index) + 1;
      dataRows.push(lineStart);
    }
    if (dataRows.length > 10) {
      const cutStart = dataRows[0];
      const cutEnd = dataRows[dataRows.length - 10];
      const omitted = dataRows.length - 10;
      output = output.slice(0, cutStart)
        + `| ... | （已省略 ${omitted} 条旧记录，需要时 Read walkthrough.md） | | | |\n`
        + output.slice(cutEnd);
    }
    // 详情截断：最近 3 条详情段落
    const pos = [];
    const re = /^## \d{4}-\d{2}-\d{2}/gm;
    while ((m = re.exec(output)) !== null) pos.push(m.index);
    if (pos.length > 3) {
      output = output.slice(0, pos[3]) + `（已省略 ${pos.length - 3} 条旧详情，需要时 Read walkthrough.md）\n`;
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
      let skip = false, cnt = 0;
      for (const l of lines) {
        const dm = l.match(/^### \[\d{4}-\d{2}-\d{2}\] (.+)/);
        if (dm) {
          // 正向匹配：匹配 open 索引 → 保留，否则跳过（避免共享前缀误跳开放项）
          skip = !openKeys.some(p => dm[1].includes(p));
          if (skip) { cnt++; continue; }
        } else if (skip) {
          if (/^#{2,3} /.test(l)) skip = false;
          else continue;
        }
        result.push(l);
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
      output = output.replace(/(^## 活跃变更详情)/m, `（已省略 ${skipIds.size} 条已完成变更）\n\n$1`);
    }
  }

  if (archiveMatch) output += ARCHIVE_MARKER + '\n';
  process.stdout.write(output);
  process.stdout.write('\n\n');
  found.push(`${file}(${output.length})`);
}

// v4.8: artifact 存储在 vault 时，注入目录路径指引 AI 读写
if (artDir !== cwd && found.length > 0) {
  process.stdout.write(`=== Artifact 目录 ===\n路径: ${artDir.replace(/\\/g, '/')}/\n请使用此路径读写 artifact 文件。\n\n`);
}

// T-333: 格式合规检查（注入活跃区后执行，不阻塞，仅引导）
if (paceSignal && found.length > 0) {
  const formatWarnings = [];
  // 检测 1：impl_plan 旧表格/emoji 格式
  const implFull = readFull(cwd, 'implementation_plan.md');
  if (implFull) {
    const implArchiveM = implFull.match(ARCHIVE_PATTERN);
    const implActive = implArchiveM ? implFull.slice(0, implArchiveM.index) : implFull;
    if (/[✅❌📋🔄⏳]/.test(implActive)) {
      formatWarnings.push(`implementation_plan.md 使用了 emoji 状态标记，hook 无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    if (/^\|.+\|$/m.test(implActive) && /^- \[.\]/m.test(implActive) === false) {
      formatWarnings.push(`implementation_plan.md 使用了表格格式，hook 无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    // 检测 2：双 ARCHIVE 标记
    const archiveCount = (implFull.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (archiveCount > 1) {
      formatWarnings.push(`implementation_plan.md 有 ${archiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），readActive 会截断到第一个标记处，可能丢失活跃内容`);
    }
  }
  // 检测 3：task.md 双 ARCHIVE 标记
  if (taskFullCached) {
    const taskArchiveCount = (taskFullCached.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (taskArchiveCount > 1) {
      formatWarnings.push(`task.md 有 ${taskArchiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），readActive 会截断到第一个标记处`);
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
      process.stdout.write(`\n=== 跨会话提醒 ===\ntask.md 有 ${skipped.length} 个跳过的任务（[-]），请检查是否已完成需更新为 [x]：\n`);
      skipped.slice(-3).forEach(t => process.stdout.write(`  ${t}\n`));
      process.stdout.write('\n');
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: SKIPPED_REMINDER | count: ${skipped.length}\n`);
    }

    // Superpowers 桥接检测：有未同步的 plan 文件但 task.md 无活跃任务
    if (paceSignal) {
      const unsyncedPlans = listUnsyncedPlanFiles(cwd);
      if (unsyncedPlans.length > 0) {
        const hasActive = active && /- \[[ \/!]\]/.test(active);
        if (!hasActive) {
          const fileList = unsyncedPlans.slice(0, 3).map(f => `docs/plans/${f}`).join(', ');
          process.stdout.write(`\n=== Superpowers 桥接提醒 ===\n`);
          process.stdout.write(`检测到计划文件（${fileList}）但 task.md 无活跃任务。\n`);
          process.stdout.write(`请在派 subagent 前执行桥接：Read plan → Edit task.md 添加任务 + APPROVED → Edit implementation_plan.md 添加 CHG 索引。\n`);
          process.stdout.write(`详见 /pace-bridge skill。\n\n`);
          log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: SUPERPOWERS_BRIDGE_HINT | plans: ${fileList}\n`);
        }
      }
    }

    // v4.3.6 方案 A：TodoWrite 同步指令注入（复用 active）
    const hasPending = /- \[[ \/!]\]/.test(active);
    const hasCompleted = /- \[[x\-]\]/.test(active);
    if (hasPending) {
      process.stdout.write(`\n=== TodoWrite 同步 ===\n⚠️ task.md 是任务权威来源。TodoWrite 与 task.md 冲突时，以 task.md 为准。\n请用 TodoWrite 创建与 task.md 活跃任务对应的 todo 项。\n\n`);
    } else if (hasCompleted) {
      process.stdout.write(`\n=== TodoWrite 同步 ===\ntask.md 活跃区有已完成/跳过任务待归档，无进行中任务。归档后再清空 TodoWrite。\n\n`);
    } else {
      process.stdout.write(`\n=== TodoWrite 同步 ===\ntask.md 无活跃任务。如 TodoWrite 仍有残留项，请清空。\n\n`);
    }
  } catch(e) {}
}

// W-5: findings 过期提醒仅对 PACE 项目生效
if (paceSignal) {
// findings [ ] 过期提醒（每日首次 session）
try {
  const findingsActive = paceUtils.readActive(cwd, 'findings.md');
  if (findingsActive) {
    const today = new Date();
    const yyyy = today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const ageFlag = path.join(PACE_RUNTIME, `findings-age-${yyyy}`);
    if (!fs.existsSync(ageFlag)) {
      const aged = [];
      const openLines = findingsActive.match(/^- \[ \] .+$/gm) || [];
      for (const line of openLines) {
        const dm = line.match(/\[date:: (\d{4}-\d{2}-\d{2})\]/);
        if (!dm) continue;
        const days = Math.floor((today - new Date(dm[1])) / 86400000);
        if (days >= 14) {
          const title = (line.match(/^- \[ \] (.+?)(?:\s*[#\[]|$)/) || [])[1] || line.slice(6, 60);
          aged.push({ title, days });
        }
      }
      if (aged.length > 0) {
        process.stdout.write(`\n=== Findings 过期提醒 ===\n以下 findings 超过 14 天未流转，请决定采纳 [x] 或否定 [-]：\n`);
        aged.forEach(f => process.stdout.write(`  (${f.days}天) ${f.title}\n`));
        process.stdout.write('\n');
      }
      try { fs.writeFileSync(ageFlag, '1', 'utf8'); } catch(e) {}
      // 清理过期去重标记
      try {
        const flags = fs.readdirSync(PACE_RUNTIME).filter(f => f.startsWith('findings-age-') && f !== `findings-age-${yyyy}`);
        flags.forEach(f => { try { fs.unlinkSync(path.join(PACE_RUNTIME, f)); } catch(e) {} });
      } catch(e) {}
    }
  }
} catch(e) {}
} // W-5: 关闭 paceSignal 守卫

// T-117: Git 状态注入（辅助跨会话上下文恢复）
try {
  const { execSync } = require('child_process');
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
  const lastCommit = execSync('git log --oneline -1', { cwd, encoding: 'utf8', timeout: 5000 }).trim();
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

log(`[${ts()}] SessionStart | cwd: ${cwd} | ${PACE_VERSION}\n  action: INJECT | files: ${found.length ? found.join(', ') : '无 Artifact 文件'}\n`);

} catch(e) {
  // H-3: 顶层异常捕获，静默放行
  try { log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
