// PostToolUseFailure hook：工具失败后给 PACE 恢复提示（logging + additionalContext）
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}

const { isPaceProject, getProjectName, resolveProjectCwd, createLogger, logEntry, isArtifactWriterAgentType, releaseArtifactWriterLock } = paceUtils;
const LOG = path.join(__dirname, 'pace-hooks.log');
const log = createLogger(LOG);
const cwd = resolveProjectCwd();
const proj = getProjectName(cwd);
const RECOVERY_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Bash', 'Agent']);

paceUtils.withStdinParsed((stdin) => {
  const t0 = Date.now();
  try {
    if (!isPaceProject(cwd)) {
      log(logEntry('PostToolUseFailure', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
      return;
    }

    const toolName = stdin.toolName || stdin.raw.tool_name || '';
    if (!RECOVERY_TOOLS.has(toolName)) {
      log(logEntry('PostToolUseFailure', 'SKIP', { proj, tool: toolName || '-', reason: 'tool-not-tracked', dur: Date.now() - t0 }));
      return;
    }

    const agentType = stdin.agentType || stdin.toolInput.subagent_type || stdin.toolInput.subagentType || '';
    if (toolName === 'Agent' && isArtifactWriterAgentType(agentType)) {
      const release = releaseArtifactWriterLock(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
      log(logEntry('PostToolUseFailure', release.released ? 'RELEASE_ARTIFACT_LOCK' : 'RELEASE_ARTIFACT_LOCK_SKIP', {
        proj,
        tool: toolName,
        agent_type: agentType,
        agent_id: stdin.agentId,
        reason: release.reason,
        lock: release.lock && release.lock.path,
        dur: Date.now() - t0,
      }));
    }

    const err = String(stdin.error || stdin.raw.error_message || stdin.raw.stderr || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);

    log(logEntry('PostToolUseFailure', stdin.isInterrupt ? 'INTERRUPT' : 'WARN', {
      proj,
      tool: toolName,
      file: stdin.filePath || '-',
      interrupt: stdin.isInterrupt ? 'yes' : 'no',
      duration_ms: stdin.durationMs || '',
      error: err || '-',
      dur: Date.now() - t0,
    }));

    if (stdin.isInterrupt) return;

    const target = stdin.filePath ? `（目标：${stdin.filePath}）` : '';
    const reason = err ? `错误：${err}` : '错误详情见工具输出';
    const ctx = [
      `PACE 工具失败恢复：${toolName} 执行失败${target}。${reason}。`,
      `${paceUtils.artifactDirRuntimeHint(cwd)}。`,
      '不要把失败工具调用视为完成；若失败发生在 artifact 写入，请按 SessionStart 注入的 Artifact 目录重试或重新派 artifact-writer。',
      '若失败发生在 Bash 验证，请先读取失败输出、修复后重跑；确认验证通过前不要派 verify/close-chg。',
    ].join('');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUseFailure',
        additionalContext: ctx,
      },
    }));
  } catch(e) {
    try { log(logEntry('PostToolUseFailure', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  }
});
