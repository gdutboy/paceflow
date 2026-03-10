// Stop hook：有未完成项时 exit 2 阻止 Claude 停止 + 多信号检测 + 防无限循环
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, isPaceProject, countCodeFiles, ARTIFACT_FILES, readActive, readFull, checkArchiveFormat, countByStatus, isTeammate, getArtifactDir, findMissingImplDetails, findMissingFindingsDetails, FORMAT_SNIPPETS } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const MAX_BLOCKS = 3; // 连续阻止超过此数后降级为软提醒
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const PACE_RUNTIME = path.join(cwd, '.pace');
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');
const warnings = [];

// H-1: 非 PACE 项目直接放行（.pace/disabled 豁免）
if (!isPaceProject(cwd)) process.exit(0);

// 防无限循环：读取连续阻止计数
function getBlockCount() {
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) || 0;
    }
  } catch(e) {}
  return 0;
}
function setBlockCount(n) {
  try { fs.writeFileSync(COUNTER_FILE, String(n), 'utf8'); } catch(e) {}
}

try {
// S-1: 统一 stdin 解析
const lastMessage = paceUtils.parseStdinSync().lastMessage;

// I-opt-4: 直接使用 ARTIFACT_FILES（消除无意义别名）
const artDir = getArtifactDir(cwd);
const existing = ARTIFACT_FILES.filter(f => fs.existsSync(path.join(artDir, f)));

const taskActive = readActive(cwd, 'task.md');

if (taskActive) {
  // 0. 检查 ARCHIVE 格式
  const archFmt1 = checkArchiveFormat(cwd, 'task.md');
  if (archFmt1) warnings.push(archFmt1);
  const archFmt2 = checkArchiveFormat(cwd, 'implementation_plan.md');
  if (archFmt2) warnings.push(archFmt2);

  // 1. 统一使用 countByStatus（仅顶层任务）
  // I-4: doneCount = [x] + [-]（countByStatus 设计），xCount 下方单独统计纯 [x]
  const { pending: pendingCount, done: doneCount } = countByStatus(taskActive, { topLevelOnly: true });
  if (pendingCount > 0) {
    // S-3: 包含进度信息（已完成/总数）
    const total = pendingCount + doneCount;
    warnings.push(`task.md 还有 ${pendingCount} 个未完成任务（进度 ${doneCount}/${total}）。状态：${FORMAT_SNIPPETS.statusHelp}`);
  }

  // 2. 检查活跃区已完成项（W7 V/归档优先级，xCount 单独统计 [x] 不含 [-]）
  const xCount = (taskActive.match(/^- \[x\]/gm) || []).length;
  if (xCount > 0) {
    if (!/^<!-- VERIFIED -->$/m.test(taskActive)) {
      // W7: 未验证时只报验证，不报归档
      warnings.push(`task.md 有 ${xCount} 个已完成任务但未验证，请先执行 V 阶段验证后添加 <!-- VERIFIED --> 标记。${FORMAT_SNIPPETS.verified}`);
    } else if (doneCount > 0) {
      // W7: 已验证时只报归档
      warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项已验证，请归档到 ARCHIVE 下方。${FORMAT_SNIPPETS.archiveOp}`);
    }
  } else if (doneCount > 0) {
    // 只有 [-] 跳过项，直接提醒归档
    warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项未归档。${FORMAT_SNIPPETS.archiveOp}`);
  }

  // 3. 检查 implementation_plan.md 状态一致性
  const planActive = readActive(cwd, 'implementation_plan.md');
  if (planActive && pendingCount === 0 && doneCount > 0 && /^- \[\/\]/m.test(planActive)) {
    warnings.push(`implementation_plan.md 仍有 [/] 进行中，但任务已全部完成。请将索引状态改为 [x] 完成。格式：${FORMAT_SNIPPETS.implIndex}`);
  }

  // v5.0.1: impl_plan 详情终态检查 — 所有 [x] 必须有 ### CHG-ID 详情
  if (planActive) {
    const planFullStop = readFull(cwd, 'implementation_plan.md');
    if (planFullStop) {
      const missingDetails = findMissingImplDetails(planFullStop);
      if (missingDetails.length > 0) {
        const display = missingDetails.length <= 3 ? missingDetails.join(', ') : missingDetails.slice(0, 3).join(', ') + ` 等 ${missingDetails.length} 个`;
        warnings.push(`implementation_plan.md 有 ${missingDetails.length} 个已完成变更缺少详情段落：${display}，请补充 "### CHG-..." 记录。格式：${FORMAT_SNIPPETS.implDetail}`);
      }
    }
  }

  // v5.0.2: findings.md 详情终态检查 — [ ] 索引必须有 ### 详情
  const findingsFull = readFull(cwd, 'findings.md');
  if (findingsFull) {
    const missingDetails = findMissingFindingsDetails(findingsFull);
    if (missingDetails.length > 0) {
      const display = missingDetails.length <= 2
        ? missingDetails.join('；')
        : missingDetails[0] + ` 等 ${missingDetails.length} 个`;
      warnings.push(`findings.md 有 ${missingDetails.length} 个 [ ] 索引缺少详情段落：${display}，请补充`);
    }
  }

  // v5.0.2: findings 过期检测（>14 天的 [ ] 项）
  const findingsActive = readActive(cwd, 'findings.md');
  if (findingsActive) {
    const agedMatches = [...findingsActive.matchAll(/^- \[ \] .+\[date:: (\d{4}-\d{2}-\d{2})\]/gm)];
    const now = Date.now();
    const agedCount = agedMatches.filter(m => {
      return (now - new Date(m[1]).getTime()) / 86400000 >= 14;
    }).length;
    if (agedCount > 0) {
      warnings.push(`findings.md 有 ${agedCount} 个超过 14 天的开放项，请决议（采纳/否定/保持现状）`);
    }

    // T-383: findings 归档检查 — 活跃区 [x]/[-] 详情段落存在时 warning
    const openKeys = [];
    (findingsActive.match(/^- \[ \] ([^—\n]+)/gm) || []).forEach(line => {
      openKeys.push(line.replace(/^- \[ \] /, '').trim().slice(0, 8));
    });
    const staleHeaders = findingsActive.match(/^### \[\d{4}-\d{2}-\d{2}\] (.+)/gm) || [];
    const staleCount = staleHeaders.filter(h => {
      const title = h.replace(/^### \[\d{4}-\d{2}-\d{2}\] /, '');
      return !openKeys.some(p => title.includes(p));
    }).length;
    if (staleCount > 0) {
      warnings.push(`findings 活跃区有 ${staleCount} 个已解决详情段落未归档`);
    }
  }

  // 4. 检查 walkthrough.md（索引表日期 + 详情段落日期 + 分层报告）
  const walkActive = readActive(cwd, 'walkthrough.md');
  // W-6: walkActive 可能为空字符串（文件存在但活跃区为空），需额外判断
  if (walkActive !== null && walkActive.trim() && (doneCount > 0 || pendingCount > 0)) {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); // I-5: sv-SE locale 返回 ISO 格式日期（YYYY-MM-DD）
    // 详情段落日期（**时间**: YYYY-MM-DD 或 **追加时间**: YYYY-MM-DD）
    const detailDates = [...walkActive.matchAll(/\*\*(?:追加)?时间\*\*:\s*(\d{4})-(\d{1,2})-(\d{1,2})/g)]
      .map(m => ({ full: `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` }));
    // 索引表日期（| YYYY-MM-DD |）
    const indexDates = [...walkActive.matchAll(/^\| (\d{4})-(\d{1,2})-(\d{1,2}) \|/gm)]
      .map(m => ({ full: `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` }));
    const hasDetailToday = detailDates.some(m => m.full === today);
    const hasIndexToday = indexDates.some(m => m.full === today);
    if (!hasDetailToday && !hasIndexToday) {
      // 索引和详情都没有今天的记录
      const allDates = [...detailDates.map(m => m.full), ...indexDates.map(m => m.full)];
      const latest = allDates.sort().pop() || null;
      if (latest) {
        warnings.push(`walkthrough.md 最近更新是 ${latest}，今天的工作尚未记录`);
      } else {
        warnings.push(`walkthrough.md 活跃区无日期记录，请更新工作记录`);
      }
    } else if (hasIndexToday && !hasDetailToday) {
      // 索引有今天的记录但详情没有 → 提醒补写详情段落
      warnings.push(`walkthrough.md 索引已更新但缺少详情段落，请补充 "## YYYY-MM-DD 摘要" 记录具体变更内容`);
    }
    // T-383: walkthrough 归档检查 — 活跃区详情 > 3 时 warning
    const walkDetailCount = (walkActive.match(/^## \d{4}-\d{2}-\d{2}/gm) || []).length;
    if (walkDetailCount > 3) {
      warnings.push(`walkthrough 活跃区有 ${walkDetailCount} 个详情段落（建议保留最近 3 个），请将旧详情归档到 <!-- ARCHIVE --> 下方`);
    }
  } else if (!fs.existsSync(path.join(artDir, 'walkthrough.md'))) {
    warnings.push(`walkthrough.md 不存在，缺少工作记录`);
  }

} else if (existing.length > 0) {
  // task.md 不存在，但有其他 artifact → 不完整
  warnings.push(`检测到 ${existing.join(', ')} 但缺少 task.md，Artifact 不完整。task.md 格式：${FORMAT_SNIPPETS.taskEntry}`);
} else {
  // 无任何 artifact：v4.3.5 多信号检测
  const paceSignal = isPaceProject(cwd);
  if (paceSignal === 'superpowers' || paceSignal === 'manual') {
    // T-078 D2 修复：无 artifact 时仅记录日志，不加入 warnings
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: SOFT_WARN | signal: ${paceSignal} | 无 artifact\n`);
  } else {
    const codeCount = countCodeFiles(cwd);
    if (codeCount >= 3) {
      warnings.push(`检测到 ${codeCount} 个代码文件但无 Artifact 文件，可能需要 PACE 流程。task.md 格式：${FORMAT_SNIPPETS.taskEntry}`);
    }
  }
}

// TodoWrite 残留检测：本会话用过 TodoWrite 且 task.md 无活跃任务 → 仅 log + 清理 flag（不阻止退出，因 hook 无法查询 TodoWrite 实际状态）
const twFlag = path.join(PACE_RUNTIME, 'todowrite-used');
if (fs.existsSync(twFlag) && taskActive) {
  const { pending, done } = countByStatus(taskActive, { topLevelOnly: true });
  if (pending === 0 && done === 0) {
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: TW_CLEANUP | TodoWrite flag 清理（无活跃任务）\n`);
    try { fs.unlinkSync(twFlag); } catch(e) {}
  }
}

// v4.5: 交叉验证 — AI 声称完成但 artifact 不一致
if (lastMessage && warnings.length === 0) {
  if (/(?:任务完成|已完成所有|全部完成|归档完毕)/.test(lastMessage)) {
    // I-3: 复用上方已读取的 taskActive，避免重复 readActive
    if (taskActive) {
      const { pending } = countByStatus(taskActive, { topLevelOnly: true });
      if (pending > 0) {
        warnings.push(`AI 声称完成，但 task.md 还有 ${pending} 个活跃任务。请先完成或标记 [-] 跳过，再归档到 ARCHIVE 下方`);
      }
    }
  }
}

if (warnings.length > 0) {
  // v4.7: teammate 降级 — 不阻止，仅输出 additionalContext 提醒
  if (isTeammate()) {
    const ctx = `PACE 提醒（teammate 模式，不阻止）：\n${warnings.map((w, i) => `[${i+1}] ${w}`).join('\n')}`;
    const output = { hookSpecificOutput: { hookEventName: "Stop", additionalContext: ctx } };
    process.stdout.write(JSON.stringify(output));
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: TEAMMATE_SOFT | team: ${process.env.CLAUDE_CODE_TEAM_NAME}\n  checks: ${warnings.join('; ')}\n`);
    // exit 0 放行
  } else {
    // W-7: 修正缩进（与 if 分支对齐）
    const blockCount = getBlockCount();
    const checksDetail = warnings.map((w, i) => `  [${i+1}] ${w}`).join('\n');
    if (blockCount >= MAX_BLOCKS) {
      // v4.3.3: 降级时写入标记文件，让 PostToolUse 提醒 AI
      try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
      try { fs.writeFileSync(path.join(PACE_RUNTIME, 'degraded'), `降级时间: ${ts()}\n未通过检查:\n${checksDetail}\n`, 'utf8'); } catch(e) {}
      log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: DOWNGRADE (${blockCount}/${MAX_BLOCKS})\n  checks:\n${checksDetail}\n  note: 已写入 .pace/degraded\n`);
      // exit 0：不阻止，仅记录
    } else {
      // v4：exit 2 阻止 Claude 停止，stderr 反馈给 Claude
      setBlockCount(blockCount + 1);
      // T-330: stderr 编号列表 + 降级递进式消息
      const stderrLines = warnings.map((w, i) => `[${i+1}] ${w}`);
      if (blockCount >= 1) stderrLines.push(`[提示] 这是第 ${blockCount + 1} 次阻止，请逐项修复上述问题后再结束会话。${FORMAT_SNIPPETS.skillRef}`);
      if (blockCount >= 2) stderrLines.push(`[警告] 下次将降级为软提醒不再阻止，但问题仍需修复。`);
      const stderrMsg = `PACE 检查未通过，请先修复：\n${stderrLines.join('\n')}`;
      process.stderr.write(stderrMsg + '\n');
      log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: BLOCK (${blockCount + 1}/${MAX_BLOCKS})\n  checks:\n${checksDetail}\n  stderr→AI: ${stderrMsg}\n`);
      process.exit(2);
    }
  } // 关闭 isTeammate else
} else {
  // 检查全部通过，重置计数器 + 清除降级标记
  setBlockCount(0);
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  try { if (fs.existsSync(degradedFile)) fs.unlinkSync(degradedFile); } catch(e) {}
  // PASS: 常规事件，不记录日志
}
} catch(e) {
  try { log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
