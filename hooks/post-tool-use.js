// PostToolUse hook：通过 JSON additionalContext 向 AI 反馈（多信号检测 + stdin 工具类型过滤 + TodoWrite 同步提醒）
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, isPaceProject, countCodeFiles, readActive, checkArchiveFormat, ARTIFACT_FILES, countByStatus, VAULT_PATH } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();

const PACE_RUNTIME = path.join(cwd, '.pace');

// v4.3.3: 异步读取 stdin 获取工具信息，按工具类型过滤检查范围
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
  let toolName = '', filePath = '', oldString = '', newString = '';
  try {
    const parsed = JSON.parse(input);
    toolName = parsed.tool_name || '';
    filePath = parsed.tool_input?.file_path || '';
    oldString = parsed.tool_input?.old_string || '';
    newString = parsed.tool_input?.new_string || '';
  } catch(e) {}

  const warnings = [];
  const fileName = filePath ? path.basename(filePath) : '';
  const isArtifactEdit = ARTIFACT_FILES.includes(fileName);

  const taskActive = readActive(cwd, 'task.md');

  // v4.3.4: 检测 Stop 降级标记
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  if (fs.existsSync(degradedFile)) {
    try {
      const degradedContent = fs.readFileSync(degradedFile, 'utf8').trim();
      warnings.push(`Stop hook 已降级（连续阻止 3 次），请检查未通过的 PACE 检查项：${degradedContent.split('\n')[0]}`);
    } catch(e) {
      warnings.push(`Stop hook 已降级，请检查 .pace/degraded 文件`);
    }
  }

  if (taskActive) {
    // 0. ARCHIVE 格式检查（仅编辑 artifact 文件时）
    if (isArtifactEdit) {
      const archFmt = checkArchiveFormat(cwd, fileName);
      if (archFmt) warnings.push(archFmt);
    }

    // 1. W2: 统一使用 countByStatus（仅顶层任务）
    const { pending: pendingCount, done: doneCount } = countByStatus(taskActive, { topLevelOnly: true });
    // H3: 归档提醒 → 每会话首次（Stop exit 2 兜底）
    const archiveRemindedFile = path.join(PACE_RUNTIME, 'archive-reminded');
    if (doneCount > 0 && !fs.existsSync(archiveRemindedFile)) {
      warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项，请归档到 ARCHIVE 下方`);
      try { fs.writeFileSync(archiveRemindedFile, '1', 'utf8'); } catch(e) {}
    }
    // H4(impl_plan 一致性) + H5(walkthrough 日期) 已删除：Stop W3/W4 完全覆盖

    // v4.3.6 方案 C：编辑 task.md 后提醒同步 TodoWrite（复用 doneCount，避免与归档提醒重叠）
    if (fileName === 'task.md') {
      if (doneCount > 0) {
        // 有已完成项时，归档提醒已在上方触发，只附加 TodoWrite 同步提示
        warnings.push(`归档后请同步更新 TodoWrite（标记完成或清空）`);
      } else {
        if (pendingCount > 0) {
          warnings.push(`task.md 有 ${pendingCount} 个活跃任务，请用 TodoWrite 同步对应的 todo 项`);
        }
      }
    }

    // APPROVED/VERIFIED 自签检测：Edit 添加标记时提醒用户确认
    if (fileName === 'task.md' && newString) {
      const markers = ['<!-- APPROVED -->', '<!-- VERIFIED -->'];
      for (const marker of markers) {
        if (newString.includes(marker) && !oldString.includes(marker)) {
          warnings.push(`检测到 ${marker} 被添加到 task.md，请确认此操作已获用户审核`);
        }
      }
    }

    // H9: CHG 完成时检查关联 findings 状态（实时 hook）
    if (fileName === 'implementation_plan.md' && newString) {
      const chgDone = newString.match(/^- \[x\] (CHG-\d{8}-\d{2})/gm);
      const chgOld = oldString.match(/^- \[x\] (CHG-\d{8}-\d{2})/gm);
      // 只检测本次新标为 [x] 的 CHG
      if (chgDone) {
        const oldSet = new Set((chgOld || []).map(m => m.match(/CHG-\d{8}-\d{2}/)[0]));
        const newlyDone = chgDone.map(m => m.match(/CHG-\d{8}-\d{2}/)[0]).filter(id => !oldSet.has(id));
        if (newlyDone.length > 0) {
          const fa = readActive(cwd, 'findings.md');
          if (fa) {
            const stale = [];
            for (const chgId of newlyDone) {
              const re = new RegExp(`^- \\[ \\] .+\\[change:: ${chgId}\\]`, 'gm');
              const hits = fa.match(re) || [];
              hits.forEach(h => stale.push({ chgId, line: h.slice(6, 60) }));
            }
            if (stale.length > 0) {
              warnings.push(`CHG 已完成但关联 finding 仍为 [ ]：${stale.map(s => s.chgId + ' → ' + s.line).join('；')}，请更新为 [x]`);
            }
          }
        }
      }
    }

    // H10: implementation_plan.md 活跃区详情归档提醒 → 每会话首次
    const implArchiveRemindedFile = path.join(PACE_RUNTIME, 'impl-archive-reminded');
    if (!fs.existsSync(implArchiveRemindedFile)) {
      const planActive = readActive(cwd, 'implementation_plan.md');
      if (planActive) {
        const doneIndex = planActive.match(/^- \[(?:x|-)\] (CHG-\d{8}-\d{2})/gm) || [];
        const doneIds = new Set(doneIndex.map(m => m.match(/CHG-\d{8}-\d{2}/)[0]));
        const detailHeaders = planActive.match(/^### (CHG-\d{8}-\d{2})/gm) || [];
        const staleDetails = detailHeaders.map(h => h.match(/CHG-\d{8}-\d{2}/)[0]).filter(id => doneIds.has(id));
        if (staleDetails.length > 0) {
          warnings.push(`implementation_plan.md 活跃区有 ${staleDetails.length} 个已完成变更详情未归档：${staleDetails.join(', ')}，请更新状态并移至 ARCHIVE 下方`);
          try { fs.writeFileSync(implArchiveRemindedFile, '1', 'utf8'); } catch(e) {}
        }
      }
    }

    // H7: findings.md ⚠️ 提醒 → 每会话首次
    const findingsRemindedFile = path.join(PACE_RUNTIME, 'findings-reminded');
    const findingsActive = readActive(cwd, 'findings.md');
    if (findingsActive) {
      const unresolved = (findingsActive.match(/⚠️/g) || []).length;
      if (unresolved > 0 && !fs.existsSync(findingsRemindedFile)) {
        warnings.push(`findings.md 有 ${unresolved} 个未解决问题（⚠️），请检查是否需要处理`);
        try { fs.writeFileSync(findingsRemindedFile, '1', 'utf8'); } catch(e) {}
      }

      // H8: 否定决策理由提醒（增强版 v4.5）
      if (fileName === 'findings.md') {
        // H11: Correction 双写提醒 — 检测新增 correction，提醒同步写入 knowledge/
        if (newString && /### Correction:/.test(newString)) {
          warnings.push('检测到新 Correction 写入 findings.md。请评估是否为跨项目通用经验：如果是，同步写入 knowledge/ 对应笔记并在 correction 条目补 [knowledge:: 笔记名]；如果仅限本项目，补 [knowledge:: project-only]');
        }

        // 扩展：[-] 条目理由 < 10 字
        const skippedLines = findingsActive.match(/^- \[-\] .+$/gm) || [];
        for (const line of skippedLines) {
          // 提取"—"或"："后的理由部分
          const reasonMatch = line.match(/[—:：]\s*(.+)$/);
          const reason = reasonMatch ? reasonMatch[1].trim() : '';
          if (reason.length < 10) {
            warnings.push(`findings [-] 条目理由不足: "${line.slice(6, 50)}..." 请补充否定决策理由`);
            break; // 只报第一个
          }
        }
        // 原有"保持现状"检测保留
        const keepCount = (findingsActive.match(/保持现状/g) || []).length;
        if (keepCount > 0) {
          warnings.push(`findings.md 有 ${keepCount} 条"保持现状"条目，请确认已记录否定理由（为什么不做）`);
        }
      }
    }
  } else {
    // task.md 不存在时：v4.3 多信号检测
    const paceSignal = isPaceProject(cwd);
    if (paceSignal === 'superpowers' || paceSignal === 'manual') {
      warnings.push(`检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在，请先创建 Artifact 文件`);
    } else {
      const codeCount = countCodeFiles(cwd);
      if (codeCount >= 3) {
        warnings.push(`检测到 ${codeCount} 个代码文件但 task.md 不存在。如果这是 PACE 任务，请先创建 Artifact 文件（G-8）`);
      }
    }
  }

  // H12: Obsidian 索引刷新 — artifact 写入后异步触发（每会话 1 次，fire-and-forget）
  // 无论 CLI 是否成功，每会话只触发一次（flag 在 spawn 后立即写入）
  const cliRefreshFile = path.join(PACE_RUNTIME, 'cli-refresh-done');
  if (isArtifactEdit && filePath && VAULT_PATH && !fs.existsSync(cliRefreshFile)) {
    try {
      // Windows 大小写不敏感，比较时统一小写（与 pre-tool-use.js 一致）
      const normFile = filePath.replace(/\\/g, '/').toLowerCase();
      const normVault = VAULT_PATH.replace(/\\/g, '/').toLowerCase();
      if (normFile.startsWith(normVault + '/')) {
        const relPath = path.relative(VAULT_PATH, filePath).replace(/\\/g, '/');
        const { spawn } = require('child_process');
        // fire-and-forget：CLI 读取文件促进 Obsidian 感知外部变更
        const child = spawn('obsidian', ['read', '--file', relPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        fs.writeFileSync(cliRefreshFile, '1', 'utf8');
      }
    } catch(e) {
      // CLI 不可用（未安装/Obsidian 未运行），静默跳过，不写 flag 允许下次重试
    }
  }

  // v4：使用 JSON stdout 的 additionalContext，确保 AI 能看到
  if (warnings.length > 0) {
    const ctx = `PACE 提醒：${warnings.join('；')}`;
    const output = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: ctx
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(`[${ts()}] PostToolUse | cwd: ${cwd}\n  action: WARN | tool: ${toolName} | file: ${filePath || '-'} | checks: ${warnings.length} 项\n  output→AI: ${ctx}\n`);
  }
  // PASS: 常规事件，不记录日志
  } catch(e) {
    try { log(`[${ts()}] PostToolUse | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
  }
});
