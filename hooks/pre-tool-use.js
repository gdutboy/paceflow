// PreToolUse hook：多信号三级触发 + 懒创建模板 + C 阶段批准 + E 阶段 impl_plan [/] 检查
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, isPaceProject, countCodeFiles, hasPlanFiles, listPlanFiles, CODE_EXTS, ARTIFACT_FILES, createTemplates, VAULT_PATH, readActive, isTeammate, getArtifactDir } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger ? paceUtils.createLogger(LOG) : ((msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} });
const cwd = paceUtils.resolveProjectCwd ? paceUtils.resolveProjectCwd() : process.cwd();

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

  // v4.7: teammate 降级——PACE 流程 deny → additionalContext 提醒
  function denyOrHint(reason) {
    if (isTeammate()) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `PACE 提醒（teammate 模式）：${reason}` } };
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
  }
  const teammateTag = isTeammate() ? '_TEAMMATE' : '';

  // W-3: 缓存 isPaceProject 结果（避免多次调用）
  const paceSignal = isPaceProject(cwd);
  const artDir = getArtifactDir(cwd);
  const taskFp = path.join(artDir, 'task.md');
  const taskFileExists = fs.existsSync(taskFp);

  // W-2: 使用 readActive 替换手动读取（内部自动解析 vault 路径）
  let taskActiveContent = readActive(cwd, 'task.md') || '';

  // v4.3.1: 仅 [ ]/[/]/[!] 算活跃任务，[x]/[-] 不算
  const hasActiveTasks = /- \[[ \/!]\]/.test(taskActiveContent);
  // v4.3.2: C 阶段批准检查 — 有 [/] 进行中或 [!] 阻塞任务或 <!-- APPROVED --> 标记
  const hasApproval = /- \[[\/!]\]/.test(taskActiveContent) || /^<!-- APPROVED -->$/m.test(taskActiveContent);

  const isCodeFile = CODE_EXTS.some(ext => filePath.endsWith(ext));

  // v4.3.1: 项目外文件豁免（CWD 和 vault artifact 目录均视为"项目内"）
  const normalizedFile = filePath.replace(/\\/g, '/').toLowerCase();
  const normalizedCwd = cwd.replace(/\\/g, '/').toLowerCase();
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  let isInsideProject = normalizedFile.startsWith(cwdWithSlash);
  if (!isInsideProject && artDir !== cwd) {
    const normalizedArtDir = artDir.replace(/\\/g, '/').toLowerCase();
    const artDirWithSlash = normalizedArtDir.endsWith('/') ? normalizedArtDir : normalizedArtDir + '/';
    isInsideProject = normalizedFile.startsWith(artDirWithSlash);
  }

  // v4.8: artifact 已迁移到 vault 时，拦截对 CWD 中 artifact 文件的 Write/Edit 并重定向
  if ((toolName === 'Write' || toolName === 'Edit') && artDir !== cwd && paceSignal) {
    const fileName = path.basename(filePath);
    if (ARTIFACT_FILES.includes(fileName) && normalizedFile.startsWith(cwdWithSlash)) {
      const correctPath = path.join(artDir, fileName).replace(/\\/g, '/');
      const reason = `artifact 文件已迁移到 Obsidian vault。请将 file_path 修改为：${correctPath}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_REDIRECT | tool: ${toolName} | file: ${filePath}\n  redirect: ${correctPath}\n`);
      return;
    }
  }

  // v4.3.2: Write 覆盖已有 artifact 保护（仅 PACE 项目内生效）
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    const PROTECTED_ARTIFACTS = ARTIFACT_FILES.filter(f => f !== 'spec.md');
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

  // T-206: Write 新建 artifact 文件时，注入对应模板内容引导格式
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    const fileName = path.basename(filePath);
    if (ARTIFACT_FILES.includes(fileName) && !fs.existsSync(path.join(artDir, fileName))) {
      const TEMPLATES_DIR = path.join(__dirname, 'templates');
      const tmpl = path.join(TEMPLATES_DIR, fileName);
      if (fs.existsSync(tmpl)) {
        try {
          const tmplContent = fs.readFileSync(tmpl, 'utf8');
          const ctx = `新建 ${fileName}：请严格按照以下官方模板格式，保留双区结构（<!-- ARCHIVE --> 分隔符）和注释说明：\n\n${tmplContent}`;
          const output = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx } };
          process.stdout.write(JSON.stringify(output));
          return;
        } catch(e) {}
      }
    }
  }

  // v4.4.1: Obsidian 知识库笔记模板提醒（Write 到 thoughts/knowledge 时注入 additionalContext）
  if (toolName === 'Write' && VAULT_PATH && filePath.endsWith('.md')) {
    const nf = normalizedFile;
    const vp = VAULT_PATH.replace(/\\/g, '/').toLowerCase();
    const vpSlash = vp.endsWith('/') ? vp : vp + '/';
    let dirName = '';
    if (nf.startsWith(vpSlash + 'thoughts/')) dirName = 'thoughts';
    else if (nf.startsWith(vpSlash + 'knowledge/')) dirName = 'knowledge';
    if (dirName && path.basename(filePath) !== 'README.md') {
      const ctx = `写入 ${dirName}/ 笔记，请遵循 pace-knowledge skill 模板：frontmatter 必含 summary/status/projects 字段，正文用 ## 摘要（L1）+ ## 详情（L2）结构。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      return;
    }
  }

  // v4.3.5: 多信号三级触发（仅对项目内代码文件 + 无活跃任务时生效）
  if (isCodeFile && isInsideProject && !hasActiveTasks) {
    // W-3: 使用顶层缓存的 paceSignal
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
        const planFiles = listPlanFiles(cwd);
        const fileList = planFiles.slice(0, 3).map(f => `docs/plans/${f}`).join(', ');
        const artPath = artDir.replace(/\\/g, '/');
        reason = `${createdMsg}检测到 Superpowers 计划文件：${fileList}。` +
          `请执行桥接（artifact 为 .md 文件，Edit 不受此限制）：` +
          `(1) Read ${planFiles[0] ? 'docs/plans/' + planFiles[0] : 'docs/plans/'} 提取任务列表；` +
          `(2) Edit ${artPath}/implementation_plan.md 添加 - [/] CHG-YYYYMMDD-NN 变更索引；` +
          `(3) Edit ${artPath}/task.md 添加 - [ ] T-NNN 任务 + <!-- APPROVED --> 标记，首个任务标为 [/]；` +
          `(4) 桥接完成后重试写代码。或使用 /pace-bridge skill。`;
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
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY${teammateTag} | signal: ${paceSignal} | tool: ${toolName} | file: ${filePath}${createdFiles.length > 0 ? '\n  created: ' + createdFiles.join(', ') : ''}\n  reason→AI: ${reason}\n`);
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
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY${teammateTag} | signal: code-count-lookahead(${futureCount}) | tool: ${toolName} | file: ${filePath}${createdFiles.length > 0 ? '\n  created: ' + createdFiles.join(', ') : ''}\n  reason→AI: ${reason}\n`);
        return;
      }
    }

    // 第三级：软提醒（1-2 个代码文件）
    if (codeCount >= 1) {
      // I-9: 变量名语义化
      const isNewFileForHint = toolName === 'Write' && !fs.existsSync(filePath);
      const displayCountForHint = codeCount + (isNewFileForHint ? 1 : 0);
      const ctx = `提醒：这是项目中的第 ${displayCountForHint} 个代码文件，如果这是正式项目，建议先创建 PACE Artifact 文件（task.md 等）再继续写代码。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: SOFT_WARN | codeCount: ${displayCountForHint} | tool: ${toolName} | file: ${filePath}\n  output→AI: ${ctx}\n`);
      return;
    }

    // 第 1 个代码文件，不触发
    return;
  }

  // v4.3.2: C 阶段检查 — 有活跃任务但未获批准时 deny
  if (isCodeFile && isInsideProject && hasActiveTasks && !hasApproval) {
    const reason = `task.md 有待做任务但未获用户批准。请先执行 C 阶段（Check）：询问用户是否批准计划，获批后在 task.md 活跃区添加 <!-- APPROVED --> 标记或将任务标为 [/] 进行中。`;
    const output = denyOrHint(reason);
    process.stdout.write(JSON.stringify(output));
    log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_C_PHASE${teammateTag} | tool: ${toolName} | file: ${filePath}\n  reason→AI: ${reason}\n`);
    return;
  }

  // v4.4.3: E 阶段前提检查 — implementation_plan.md 需有 [/] 进行中的变更索引
  if (isCodeFile && isInsideProject && hasActiveTasks && hasApproval) {
    const planActive = readActive(cwd, 'implementation_plan.md');
    if (planActive === null || !/^- \[\/\]/m.test(planActive)) {
      const reason = planActive === null
        ? `implementation_plan.md 不存在。请先在 A 阶段创建变更索引（CHG-YYYYMMDD-NN），标记为 [/] 进行中后再写代码。`
        : `implementation_plan.md 无进行中的变更索引（[/]）。请先将当前变更的索引状态从 [ ] 改为 [/] 后再写代码。`;
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_E_PHASE${teammateTag} | tool: ${toolName} | file: ${filePath}\n  reason→AI: ${reason}\n`);
      return;
    }
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
  } else {
    // SKIP / INJECT: 常规事件，不记录日志
  }
  } catch(e) {
    try { log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
  }
});
