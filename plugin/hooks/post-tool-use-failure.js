// PostToolUseFailure hook：工具失败后给 PACE 恢复提示（logging + additionalContext）
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}

const { isPaceProject, getProjectName, resolveProjectCwd, createLogger, logEntry, isArtifactWriterAgentType, CODE_EXTS } = paceUtils;
const LOG = path.join(__dirname, 'pace-hooks.log');
const log = createLogger(LOG);
const cwd = resolveProjectCwd();
const proj = getProjectName(cwd);
const RECOVERY_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'Bash', 'PowerShell', 'Monitor', 'Agent']);

function bashLooksLikeValidationCommand(command) {
  const c = String(command || '');
  return /\b(npm|pnpm|yarn)\s+(?:test|run\s+(?:test|lint|typecheck|check|build)|exec\s+(?:tsc|eslint|vitest|jest))\b/i.test(c) ||
    /\b(pytest|ruff|mypy|cargo\s+test|cargo\s+clippy|go\s+test|go\s+vet|mvn\s+test|gradle\s+test|tsc\b|eslint\b|vitest\b|jest\b|make\s+(?:test|check|lint))\b/i.test(c) ||
    /\bpython(?:3)?\s+-m\s+(?:pytest|unittest|mypy|ruff)\b/i.test(c) ||
    /(?:^|[\s;&|()])(?:bash|sh|zsh)\s+(?:\.\/)?(?:[\w.-]+\/)*(?:run-)?(?:test|tests|check|lint|typecheck|build)(?:[-_\w.\/]*)(?:\.sh)?\b/i.test(c) ||
    /(?:^|[\s;&|()])(?:\.\/)?(?:scripts|tools|bin)\/[\w./-]*(?:test|tests|check|lint|typecheck|build)[\w./-]*(?:\.(?:sh|js|mjs|cjs|py))?\b/i.test(c) ||
    /(?:^|[\s;&|()])\.\/(?:run-)?(?:test|tests|check|lint|typecheck|build)(?:[-_\w.]*)(?:\.sh)?\b/i.test(c);
}

paceUtils.withStdinParsed((stdin) => {
  const t0 = Date.now();
  try {
    const paceSignal = isPaceProject(cwd);
    if (!paceSignal) {
      log(logEntry('PostToolUseFailure', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
      return;
    }

    const toolName = stdin.toolName || stdin.raw.tool_name || '';
    if (!RECOVERY_TOOLS.has(toolName)) {
      log(logEntry('PostToolUseFailure', 'SKIP', { proj, tool: toolName || '-', reason: 'tool-not-tracked', dur: Date.now() - t0 }));
      return;
    }

    const agentType = stdin.agentType || stdin.toolInput.subagent_type || stdin.toolInput.subagentType || '';
    const isArtifactWriterAgent = isArtifactWriterAgentType(agentType);
    const artDir = paceSignal === 'artifact' ? paceUtils.getArtifactDir(cwd) : cwd;
    const resolvedFilePath = stdin.filePath ? paceUtils.resolveToolFilePath(cwd, stdin.filePath) : '';
    const artifactRel = resolvedFilePath ? paceUtils.artifactRelativePathForFile(artDir, resolvedFilePath) : null;
    const isCodeFile = resolvedFilePath && CODE_EXTS.some(ext => resolvedFilePath.endsWith(ext));
    const commandInput = String(stdin.toolInput.command || stdin.toolInput.script || stdin.toolInput.cmd || '');
    const commandLooksLikeValidation = bashLooksLikeValidationCommand(commandInput);

    if (toolName === 'Agent' && isArtifactWriterAgentType(agentType)) {
      const releasedResources = paceUtils.releaseArtifactResourcesForOwner(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
      log(logEntry('PostToolUseFailure', 'RELEASE_ARTIFACT_RESOURCES_AFTER_AGENT_FAILURE', {
        proj,
        tool: toolName,
        agent_type: agentType,
        agent_id: stdin.agentId,
        resource_locks: releasedResources.length,
        dur: Date.now() - t0,
      }));
    }

    if (['Write', 'Edit', 'MultiEdit'].includes(toolName) && isArtifactWriterAgentType(agentType) && stdin.filePath) {
      const resource = paceUtils.artifactResourceForRel(artifactRel);
      if (resource) {
        // v7（CHG-20260611-08）：index-transaction 半开保锁逻辑随双写事务退役——单文件写失败
        // 没有「另一侧索引未写」的悬挂态，直接释放资源锁以减少并发阻塞。
        const owner = { sessionId: stdin.sessionId, agentId: stdin.agentId };
        const release = paceUtils.releaseArtifactResourceLock(cwd, resource, owner);
        log(logEntry('PostToolUseFailure', release.released ? 'RELEASE_ARTIFACT_RESOURCE_LOCK' : 'RELEASE_ARTIFACT_RESOURCE_LOCK_SKIP', {
          proj,
          tool: toolName,
          file: stdin.filePath,
          artifact: artifactRel,
          resource,
          agent_id: stdin.agentId,
          reason: release.reason,
          dur: Date.now() - t0,
        }));
      }
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

    const shouldInjectRecovery =
      (toolName === 'Agent' && isArtifactWriterAgent) ||
      (['Write', 'Edit', 'MultiEdit'].includes(toolName) && (artifactRel || isCodeFile)) ||
      (['Bash', 'PowerShell', 'Monitor'].includes(toolName) && commandLooksLikeValidation);
    if (!shouldInjectRecovery) return;

    const target = stdin.filePath ? `（目标：${stdin.filePath}）` : '';
    const reason = err ? `错误：${err}` : '错误详情见工具输出';
    const recovery = ['Bash', 'PowerShell', 'Monitor'].includes(toolName)
      ? '请先读取失败输出、修复后重跑；确认验证通过前不要派 verify/close-chg。'
      : '不要把失败工具调用视为完成；artifact 写入失败时按当前 artifact_dir 重试或重新派 artifact-writer。';
    const ctx = `PACE 工具失败恢复：${toolName} 执行失败${target}。${reason}。${paceUtils.artifactDirRuntimeHint(cwd)}。${recovery}`;
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
