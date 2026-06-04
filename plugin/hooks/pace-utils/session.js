const fs = require('fs');

function isTeammate() {
  return !!process.env.CLAUDE_CODE_TEAM_NAME;
}

function isArtifactWriterAgentType(agentType) {
  const type = String(agentType || '').toLowerCase();
  return type === 'artifact-writer' || type === 'paceflow:artifact-writer' || type.endsWith(':artifact-writer');
}

let _lastHookSessionId = '';

function normalizeSessionId(sessionId) {
  return String(sessionId || '').trim();
}

function currentSessionId() {
  return normalizeSessionId(process.env.CLAUDE_CODE_SESSION_ID || _lastHookSessionId);
}

function parseHookStdin(rawInput) {
  let parsed = {};
  let ok = false;
  try { parsed = JSON.parse(rawInput); ok = true; } catch(e) {}
  // PUC-02/ROB-01：JSON.parse 对字面量 null/数组/数字返回非对象真值（ok=true），
  // 后续 parsed.session_id 等属性访问会对 null 抛 TypeError；归一为空对象并置 ok=false。
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { parsed = {}; ok = false; }
  const sessionId = normalizeSessionId(parsed.session_id || parsed.sessionId || process.env.CLAUDE_CODE_SESSION_ID || '');
  if (sessionId) _lastHookSessionId = sessionId;
  return {
    ok,
    sessionId,
    toolName: parsed.tool_name || '',
    filePath: (parsed.tool_input?.file_path || '').replace(/\\/g, '/'),
    oldString: parsed.tool_input?.old_string || '',
    newString: parsed.tool_input?.new_string || '',
    content: parsed.tool_input?.content || '',
    toolInput: parsed.tool_input || {},
    type: parsed.source || parsed.type || '',
    agentId: parsed.agent_id || parsed.subagent_id || '',
    agentType: parsed.agent_type || parsed.subagent_type || parsed.tool_input?.subagent_type || '',
    lastMessage: parsed.last_assistant_message || parsed.last_message || parsed.message || '',
    agentTranscriptPath: parsed.agent_transcript_path || parsed.transcript_path || '',
    error: parsed.error || parsed.error_type || '',
    isInterrupt: parsed.is_interrupt === true || parsed.is_interrupt === 'true' || parsed.isInterrupt === true,
    durationMs: Number(parsed.duration_ms || parsed.durationMs || 0) || 0,
    raw: parsed,
  };
}

function withStdinParsed(callback) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    // ROB-01：纵深防御，parseHookStdin 异常时以空输入兜底，避免异步入口未捕获异常致进程崩溃 fail-open
    let parsed;
    try { parsed = parseHookStdin(input); } catch (e) { parsed = parseHookStdin(''); }
    callback(parsed, input);
  });
}

function parseStdinSync() {
  try { return parseHookStdin(fs.readFileSync(0, 'utf8')); }
  catch(e) { return parseHookStdin(''); }
}

module.exports = {
  isTeammate,
  isArtifactWriterAgentType,
  normalizeSessionId,
  currentSessionId,
  parseHookStdin,
  withStdinParsed,
  parseStdinSync,
};
