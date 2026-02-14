// PreToolUse hook v4.3.9：多信号三级触发 + 懒创建模板 + off-by-one 修复 + C 阶段批准检查
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, hasPlanFiles, CODE_EXTS, createTemplates } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();

// v4: 异步读取 stdin 获取工具信息
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

  const taskFp = path.join(cwd, 'task.md');
  const taskFileExists = fs.existsSync(taskFp);

  // 读取活跃区内容（复用于 hasActiveTasks + hasApproval + inject）
  let taskActiveContent = '';
  if (taskFileExists) {
    try {
      const content = fs.readFileSync(taskFp, 'utf8');
      const archiveMatch = content.match(/^<!-- ARCHIVE -->$/m);
      taskActiveContent = archiveMatch ? content.slice(0, archiveMatch.index) : content;
    } catch(e) {}
  }

  // v4.3.1: 仅 [ ]/[/]/[!] 算活跃任务，[x]/[-] 不算
  const hasActiveTasks = /- \[[ \/!]\]/.test(taskActiveContent);
  // v4.3.2: C 阶段批准检查 — 有 [/] 进行中或 [!] 阻塞任务或 <!-- APPROVED --> 标记
  const hasApproval = /- \[[\/!]\]/.test(taskActiveContent) || /^<!-- APPROVED -->$/m.test(taskActiveContent);

  const isCodeFile = CODE_EXTS.some(ext => filePath.endsWith(ext));

  // v4.3.1: 项目外文件豁免
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  const isInsideProject = normalizedFile.startsWith(cwdWithSlash);

  // v4.3.2: Write 覆盖已有 artifact 保护（仅 PACE 项目内生效）
  if (toolName === 'Write' && isInsideProject && isPaceProject(cwd)) {
    const PROTECTED_ARTIFACTS = ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
    const fileName = path.basename(filePath);
    if (PROTECTED_ARTIFACTS.includes(fileName) && fs.existsSync(filePath)) {
      const reason = `禁止使用 Write 覆盖已有的 ${fileName}，请使用 Edit 工具进行修改。Write 会丢失全部历史内容。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_WRITE_ARTIFACT | tool: ${toolName} | file: ${filePath}\n  reason→AI: ${reason}\n`);
      return;
    }
  }

  // v4.3.5: 多信号三级触发（仅对项目内代码文件 + 无活跃任务时生效）
  if (isCodeFile && isInsideProject && !hasActiveTasks) {
    const paceSignal = isPaceProject(cwd);
    const codeCount = countCodeFiles(cwd);

    // 第一级：强信号 DENY（superpowers/manual/artifact/code-count）
    if (paceSignal === 'superpowers' || paceSignal === 'manual' || paceSignal === 'artifact' || paceSignal === 'code-count') {
      // T-076: DENY 前懒创建缺失的模板文件
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0 ? `已自动创建 Artifact 模板（${createdFiles.join(', ')}）。` : '';

      // T-076: 场景化 DENY 消息
      let reason;
      if (paceSignal === 'superpowers' && hasPlanFiles(cwd)) {
        reason = `${createdMsg}检测到 Superpowers 计划文件（docs/plans/）。请从 docs/plans/ 读取计划，将任务同步到 task.md，获取用户批准后再写代码。`;
      } else if (paceSignal === 'superpowers') {
        reason = `${createdMsg}检测到 Superpowers 信号但无计划文件。请先执行 P-A-C 流程。`;
      } else if (taskFileExists || createdFiles.includes('task.md')) {
        reason = `${createdMsg}检测到 PACE 项目（${paceSignal}）但 task.md 中无活跃任务。`;
        reason += hasPlanFiles(cwd)
          ? `检测到 docs/plans/ 中有计划文件，请将计划中的任务同步到 task.md 后再写代码。`
          : `请先执行 P-A-C 流程（Plan→Artifact→Check）定义任务后再写代码。`;
      } else {
        reason = `检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在。请先创建 Artifact 文件（spec.md / task.md / implementation_plan.md / walkthrough.md），参考 G-8 的 PACE 执行流程。`;
      }
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY | signal: ${paceSignal} | tool: ${toolName} | file: ${filePath}${createdFiles.length > 0 ? '\n  created: ' + createdFiles.join(', ') : ''}\n  reason→AI: ${reason}\n`);
      return;
    }

    // T-079: 第二级 — off-by-one 前瞻判断（无强信号但 Write 新文件将达到阈值）
    if (!paceSignal && toolName === 'Write' && !fs.existsSync(filePath)) {
      const futureCount = codeCount + 1;
      if (futureCount >= 3) {
        let createdFiles = [];
        try { createdFiles = createTemplates(cwd); } catch(e) {}
        const createdMsg = createdFiles.length > 0 ? `已自动创建 Artifact 模板（${createdFiles.join(', ')}）。` : '';
        const reason = `${createdMsg}即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先在 task.md 中定义任务，获取用户批准后再写代码。`;
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY | signal: code-count-lookahead(${futureCount}) | tool: ${toolName} | file: ${filePath}${createdFiles.length > 0 ? '\n  created: ' + createdFiles.join(', ') : ''}\n  reason→AI: ${reason}\n`);
        return;
      }
    }

    // 第三级：软提醒（1-2 个代码文件）
    if (codeCount >= 1) {
      const isNewFile2 = toolName === 'Write' && !fs.existsSync(filePath);
      const displayCount2 = codeCount + (isNewFile2 ? 1 : 0);
      const ctx = `提醒：这是项目中的第 ${displayCount2} 个代码文件，如果这是正式项目，建议先创建 PACE Artifact 文件（task.md 等）再继续写代码。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: SOFT_WARN | codeCount: ${displayCount2} | tool: ${toolName} | file: ${filePath}\n  output→AI: ${ctx}\n`);
      return;
    }

    log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: SKIP | tool: ${toolName} | file: ${filePath || '-'}\n  reason: 第 1 个代码文件，不触发\n`);
    return;
  }

  // v4.3.2: C 阶段检查 — 有活跃任务但未获批准时 deny
  if (isCodeFile && isInsideProject && hasActiveTasks && !hasApproval) {
    const reason = `task.md 有待做任务但未获用户批准。请先执行 C 阶段（Check）：询问用户是否批准计划，获批后在 task.md 活跃区添加 <!-- APPROVED --> 标记或将任务标为 [/] 进行中。`;
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_C_PHASE | tool: ${toolName} | file: ${filePath}\n  reason→AI: ${reason}\n`);
    return;
  }

  // 正常情况：注入 task.md 活跃区
  if (taskFileExists && taskActiveContent) {
    const ctx = `当前任务状态：\n${taskActiveContent}`;
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: ctx
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: INJECT | tool: ${toolName} | file: ${filePath || '-'}\n  output→AI: ${ctx.replace(/\n/g, '\\n').substring(0, 300)}\n`);
  } else {
    log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: SKIP | tool: ${toolName} | file: ${filePath || '-'}\n  reason: task.md 不存在或无活跃任务\n`);
  }
  } catch(e) {
    try { log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
  }
});
