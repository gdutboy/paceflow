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
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);

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

function collectStrings(value, out = [], depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, out, depth + 1));
    return out;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => collectStrings(value[key], out, depth + 1));
  }
  return out;
}

function readTranscriptStrings(transcriptPath) {
  if (!transcriptPath) return [];
  try {
    const stat = fs.statSync(transcriptPath);
    const maxBytes = 200000;
    const len = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, stat.size - len));
      const raw = buf.toString('utf8');
      const strings = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { collectStrings(JSON.parse(line), strings); }
        catch(e) { strings.push(line); }
      }
      return strings;
    } finally {
      fs.closeSync(fd);
    }
  } catch(e) {
    return [];
  }
}

function uniqueChangeIdFromText(text) {
  const matches = String(text || '').match(/\b(?:CHG|HOTFIX)-\d{8}-\d{2}\b/gi) || [];
  const ids = [...new Set(matches.map(id => id.toUpperCase()))];
  return ids.length === 1 ? ids[0] : '';
}

function inferCloseTarget(stdin) {
  const candidates = [
    stdin.toolInput && stdin.toolInput.prompt,
    stdin.raw && stdin.raw.tool_input && stdin.raw.tool_input.prompt,
    stdin.raw && stdin.raw.prompt,
    stdin.raw && stdin.raw.agent_prompt,
    stdin.lastMessage,
    ...readTranscriptStrings(stdin.agentTranscriptPath),
  ].filter(Boolean);

  let operation = '';
  for (const text of candidates) {
    operation = paceUtils.operationFromAgentPrompt(text);
    if (operation === 'close-chg' || operation === 'archive-chg') break;
    operation = '';
  }
  if (!operation) return { operation: '', target: '', reason: 'missing-operation' };

  for (const text of candidates) {
    const target = paceUtils.explicitChangeTargetFromAgentPrompt(text) || uniqueChangeIdFromText(text);
    if (target) return { operation, target, reason: '' };
  }
  return { operation, target: '', reason: 'missing-target' };
}

function closeOwnerIfArchived(stdin, status, t0) {
  const inferred = inferCloseTarget(stdin);
  if (!inferred.operation || !inferred.target) {
    log(logEntry('SubagentStop', 'CHANGE_OWNER_CLOSE_SKIP', {
      proj,
      operation: inferred.operation || '-',
      target: inferred.target || '-',
      reason: inferred.reason,
      dur: Date.now() - t0,
    }));
    return;
  }
  const stillActive = paceUtils.getActiveChangeEntries(cwd).some(entry => entry.id === inferred.target);
  if (stillActive) {
    log(logEntry('SubagentStop', 'CHANGE_OWNER_CLOSE_SKIP', {
      proj,
      operation: inferred.operation,
      target: inferred.target,
      reason: 'target-still-active',
      dur: Date.now() - t0,
    }));
    return;
  }
  const closed = paceUtils.markChangeOwnerClosed(cwd, inferred.target, {
    sessionId: stdin.sessionId,
    agentId: stdin.agentId,
    operation: inferred.operation,
  });
  log(logEntry('SubagentStop', closed.ok ? 'CHANGE_OWNER_CLOSED' : 'CHANGE_OWNER_CLOSE_SKIP', {
    proj,
    operation: inferred.operation,
    target: inferred.target,
    status: status || '-',
    reason: closed.reason || '',
    dur: Date.now() - t0,
  }));
}

function writeContext(message) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: paceUtils.appendArtifactDirHint(cwd, message),
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
  const releasedResources = paceUtils.releaseArtifactResourcesForOwner(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
  log(logEntry('SubagentStop', release.released ? 'RELEASE_ARTIFACT_LOCK' : 'RELEASE_ARTIFACT_LOCK_SKIP', {
    proj,
    agent_type: agentType,
    agent_id: stdin.agentId,
    reason: release.reason,
    lock: release.lock && release.lock.path,
    resource_locks: releasedResources.length,
    dur: Date.now() - t0,
  }));

  const lines = firstNonEmptyLines(stdin.lastMessage);
  const first = lines[0] || '';
  const second = lines[1] || '';
  const hasTitle = lines.includes(EXPECTED_TITLE);
  const allowedTimestampPrefix = TIMESTAMP_LINE.test(first) && second === EXPECTED_TITLE;
  const status = reportStatus(stdin.lastMessage);
  closeOwnerIfArchived(stdin, status, t0);

  if (!hasTitle && !status) {
    const ctx = 'PACE artifact-writer 报告未能解析：缺少标准报告标题和状态行。请检查 agent 实际是否完成 artifact 写入；需要修复时重新派 artifact-writer 按同一指令修复，不要由主 session 手写 C/V/归档标记。';
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'missing-title-status', transcript: stdin.agentTranscriptPath || '-', dur: Date.now() - t0 }));
  } else if (!hasTitle) {
    const ctx = 'PACE artifact-writer 报告未能解析：缺少标准报告标题。请检查 agent 实际是否完成 artifact 写入；需要修复时重新派 artifact-writer 按同一指令修复，不要由主 session 手写 C/V/归档标记。';
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'missing-title', transcript: stdin.agentTranscriptPath || '-', dur: Date.now() - t0 }));
  } else if (first !== EXPECTED_TITLE && !allowedTimestampPrefix) {
    const ctx = 'PACE artifact-writer 报告未能解析：标题前有额外内容或使用了标题变体。请在下一次派遣时要求 agent 只输出标准报告。';
    writeContext(ctx);
    log(logEntry('SubagentStop', 'WARN', { proj, agent_type: agentType, issue: 'title-prefix', first: first.slice(0, 80), dur: Date.now() - t0 }));
  } else if (!status) {
    const ctx = 'PACE artifact-writer 报告未能解析：缺少状态行。请确认 artifact 落盘结果；需要修复时重新派 artifact-writer，不要主 session 直接补写 artifact 状态。';
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
