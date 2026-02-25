// PostToolUse hook：通过 JSON additionalContext 向 AI 反馈（多信号检测 + stdin 工具类型过滤 + TodoWrite 同步提醒）
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, isPaceProject, countCodeFiles, readActive, checkArchiveFormat, ARTIFACT_FILES, countByStatus } = paceUtils;

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
  let toolName = '', filePath = '';
  try {
    const parsed = JSON.parse(input);
    toolName = parsed.tool_name || '';
    filePath = parsed.tool_input?.file_path || '';
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
    if (doneCount > 0) {
      warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项，请归档到 ARCHIVE 下方`);

      // 2. impl_plan 一致性（仅编辑 task.md 或 impl_plan 时）
      if (fileName === 'task.md' || fileName === 'implementation_plan.md') {
        const planActive = readActive(cwd, 'implementation_plan.md');
        if (planActive) {
          if (pendingCount === 0 && /^- \[\/\]/m.test(planActive)) {
            warnings.push(`implementation_plan.md 仍有 [/] 进行中的变更，但任务已全部完成，请更新状态为 [x]`);
          }
        }
      }

      // 3. walkthrough 日期（仅编辑 task.md 或 walkthrough 时）
      if (fileName === 'task.md' || fileName === 'walkthrough.md') {
        const walkActive = readActive(cwd, 'walkthrough.md');
        if (walkActive) {
          const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
          const timeMatch = walkActive.match(/\*\*(?:追加)?时间\*\*:\s*(\d{4}-\d{2}-\d{2})/);
          const lastDate = timeMatch ? timeMatch[1] : null;
          if (lastDate && lastDate !== today) {
            warnings.push(`walkthrough.md 最近更新是 ${lastDate}，今天的工作尚未记录`);
          }
        } else if (!fs.existsSync(path.join(cwd, 'walkthrough.md'))) {
          warnings.push(`walkthrough.md 不存在，请创建工作记录文件`);
        }
      }
    }

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

    // 4. findings.md ⚠️ 提醒（v4.3.4: 从 Stop 阻塞降级为 PostToolUse 软提醒）
    // 🔒 替换 ⚠️ 表示已知限制，直接统计 ⚠️ 即可（🔒 条目无 ⚠️，自动排除）
    const findingsActive = readActive(cwd, 'findings.md');
    if (findingsActive) {
      const unresolved = (findingsActive.match(/⚠️/g) || []).length;
      if (unresolved > 0) {
        warnings.push(`findings.md 有 ${unresolved} 个未解决问题（⚠️），请检查是否需要处理`);
      }

      // 5. 否定决策理由提醒：编辑 findings.md 时检测"保持现状"缺理由
      if (fileName === 'findings.md') {
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
