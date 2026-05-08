// SubagentStop hook：artifact-writer 报告协议观察器（不阻断，只提示/记录）
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}

const {
  isPaceProject,
  getProjectName,
  resolveProjectCwd,
  createLogger,
  logEntry,
  isArtifactWriterAgentType,
  normalizeLineEndings,
  releaseArtifactWriterLock,
} = paceUtils;

const EXPECTED_TITLE = '## artifact-writer 报告';
const TIMESTAMP_LINE = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]$/;
const LOG = path.join(__dirname, 'pace-hooks.log');
const log = createLogger(LOG);
const cwd = resolveProjectCwd();
const proj = getProjectName(cwd);
const PACE_RUNTIME = path.join(cwd, '.pace');

function firstNonEmptyLines(message) {
  return normalizeLineEndings(message)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function reportStatus(message) {
  const m = normalizeLineEndings(message).match(/(?:\*\*)?状态(?:\*\*)?\s*[：:]\s*(SUCCESS|FAILED)/i);
  return m ? m[1].toUpperCase() : '';
}

function writeContext(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: message,
    },
  }));
}

try {
  const t0 = Date.now();
  const stdin = paceUtils.parseStdinSync();
  if (!isPaceProject(cwd)) {
    log(logEntry('SubagentStop', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
    process.exit(0);
  }

  const agentType = stdin.agentType || stdin.raw.agent_name || '';
  if (!isArtifactWriterAgentType(agentType)) {
    log(logEntry('SubagentStop', 'SKIP', { proj, agent_type: agentType || '-', reason: 'not-artifact-writer', dur: Date.now() - t0 }));
    process.exit(0);
  }

  if (stdin.agentTranscriptPath) {
    try {
      fs.mkdirSync(PACE_RUNTIME, { recursive: true });
      fs.writeFileSync(path.join(PACE_RUNTIME, 'last-artifact-writer-transcript'), stdin.agentTranscriptPath, 'utf8');
    } catch(e) {}
  }

  const release = releaseArtifactWriterLock(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
  log(logEntry('SubagentStop', release.released ? 'RELEASE_ARTIFACT_LOCK' : 'RELEASE_ARTIFACT_LOCK_SKIP', {
    proj,
    agent_type: agentType,
    agent_id: stdin.agentId,
    reason: release.reason,
    lock: release.lock && release.lock.path,
    dur: Date.now() - t0,
  }));

  const lines = firstNonEmptyLines(stdin.lastMessage);
  const first = lines[0] || '';
  const second = lines[1] || '';
  const hasTitle = lines.includes(EXPECTED_TITLE);
  const allowedTimestampPrefix = TIMESTAMP_LINE.test(first) && second === EXPECTED_TITLE;
  const status = reportStatus(stdin.lastMessage);

  if (!hasTitle) {
    const ctx = `PACE artifact-writer 报告格式提醒：SubagentStop 未检测到 \`${EXPECTED_TITLE}\`。请检查 agent 实际是否完成 artifact 写入；如格式失败或状态缺失，重新派 artifact-writer 按同一指令修复，不要由主 session 手写 C/V/归档标记。`;
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'missing-title', transcript: stdin.agentTranscriptPath || '-', dur: Date.now() - t0 }));
  } else if (first !== EXPECTED_TITLE && !allowedTimestampPrefix) {
    const ctx = `PACE artifact-writer 报告格式提醒：检测到标题前缀或标题变体；协议标题必须是第一个非空 H2：\`${EXPECTED_TITLE}\`。请在下一次派遣时要求 agent 修正报告格式。`;
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'title-prefix', first: first.slice(0, 80), dur: Date.now() - t0 }));
  } else if (!status) {
    const ctx = 'PACE artifact-writer 报告格式提醒：报告缺少 `**状态**：SUCCESS` 或 `**状态**：FAILED`。请确认 artifact 落盘结果；需要修复时重新派 artifact-writer，不要主 session 直接补写 artifact 状态。';
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'missing-status', dur: Date.now() - t0 }));
  } else {
    log(logEntry('SubagentStop', allowedTimestampPrefix ? 'WARN_PREFIX' : 'PASS', {
      proj,
      agent_type: agentType,
      status,
      transcript: stdin.agentTranscriptPath || '-',
      dur: Date.now() - t0,
    }));
  }
} catch(e) {
  try { log(logEntry('SubagentStop', 'ERROR', { proj, error: e.message })); } catch(e2) {}
}
