#!/usr/bin/env node
/**
 * Convert Claude Code CLI JSON output into the compact report object consumed by
 * tests/agent-tests/run-tests.js verify.
 *
 * Supported inputs:
 *   - --output-format json       (single JSON object, common path)
 *   - JSON arrays                (older wrappers / tool-captured output)
 *   - --output-format stream-json (newline-delimited JSON events)
 *   - plain text fallback        (keeps raw text, metrics unknown)
 */

const fs = require('fs');

function readInput(filePath) {
  return filePath ? fs.readFileSync(filePath, 'utf8') : fs.readFileSync(0, 'utf8');
}

function parsePayload(text) {
  const trimmed = text.trim();
  if (!trimmed) return { events: [], payload: null, plainText: '' };

  try {
    const payload = JSON.parse(trimmed);
    return {
      events: Array.isArray(payload) ? payload : [payload],
      payload,
      plainText: '',
    };
  } catch (_) {
    const events = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const part = line.trim();
      if (!part) continue;
      try {
        events.push(JSON.parse(part));
      } catch (_) {
        return { events: [], payload: null, plainText: text };
      }
    }
    return { events, payload: events, plainText: '' };
  }
}

function contentToText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && item.type === 'text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractRaw(events, plainText) {
  if (plainText) return plainText;
  for (const event of [...events].reverse()) {
    if (!event || typeof event !== 'object') continue;
    if (typeof event.result === 'string') return event.result;
    const messageText = contentToText(event.message && event.message.content);
    if (messageText) return messageText;
    const contentText = contentToText(event.content);
    if (contentText) return contentText;
  }
  return '';
}

function findResultEvent(events) {
  return [...events].reverse().find((event) =>
    event && typeof event === 'object' &&
    (event.type === 'result' || typeof event.result === 'string' || event.duration_ms !== undefined),
  ) || {};
}

function sumTokenFields(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);

  let total = 0;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number' && /tokens?/i.test(key)) {
      total += child;
    } else if (child && typeof child === 'object') {
      total += sumTokenFields(child, seen);
    }
  }
  return total;
}

function budgetTokensFromUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
  const keys = [
    'input_tokens',
    'output_tokens',
    'cache_creation_input_tokens',
  ];
  const total = keys.reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
  return total > 0 ? total : null;
}

function countToolUseBlocks(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);

  let count = 0;
  if (value.type === 'tool_use') count += 1;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) count += countToolUseBlocks(item, seen);
    } else if (child && typeof child === 'object') {
      count += countToolUseBlocks(child, seen);
    }
  }
  return count;
}

function inferStatus(raw, resultEvent) {
  if (resultEvent && resultEvent.is_error) return 'FAILED';

  const text = String(raw || '');
  if (/(?:^|\b|["|*_ -])(?:status|状态)(?:["`*_ -]|\s)*[:|：]\s*`?FAILED`?/im.test(text)) return 'FAILED';
  if (/\berror_code\b/im.test(text) && /\bFAILED\b/im.test(text)) return 'FAILED';
  if (/\bSUCCESS_WITH_WARNINGS\b/im.test(text) || /SUCCESS\s*\(\s*with warnings\s*\)/im.test(text)) {
    return 'SUCCESS_WITH_WARNINGS';
  }
  if (/(?:^|\b|["|*_ -])(?:status|状态)(?:["`*_ -]|\s)*[:|：]\s*`?(?:SUCCESS|OK|success|ok)`?/im.test(text)) {
    return 'SUCCESS';
  }
  if (/\bFAILED\b/im.test(text)) return 'FAILED';
  if (/\bSUCCESS\b/im.test(text)) return 'SUCCESS';
  return raw ? 'UNKNOWN' : 'FAILED';
}

function convert(text) {
  const { events, payload, plainText } = parsePayload(text);
  const resultEvent = findResultEvent(events);
  const raw = extractRaw(events, plainText);
  const usageSource = resultEvent.usage || (resultEvent.message && resultEvent.message.usage) || payload || {};
  const tokenTotal = budgetTokensFromUsage(usageSource) || sumTokenFields(usageSource);
  const toolUseBlocks = countToolUseBlocks(events);
  const toolUses = toolUseBlocks || resultEvent.tool_uses || resultEvent.num_tool_uses || resultEvent.num_turns || 0;

  return {
    status: inferStatus(raw, resultEvent),
    tokens: tokenTotal,
    tool_uses: Number(toolUses) || 0,
    duration_ms: Number(resultEvent.duration_ms || resultEvent.durationMs || 0) || 0,
    raw,
  };
}

function main() {
  let inputPath = null;
  let outputPath = null;
  let promptMode = process.env.PROMPT_MODE || null;
  const positional = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--prompt-mode' && process.argv[i + 1]) {
      promptMode = process.argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--prompt-mode=')) {
      promptMode = arg.slice('--prompt-mode='.length);
    } else {
      positional.push(arg);
    }
  }
  [inputPath, outputPath] = positional;
  const report = convert(readInput(inputPath));
  if (promptMode) report.prompt_mode = promptMode;
  const json = JSON.stringify(report, null, 2);
  if (outputPath) fs.writeFileSync(outputPath, json + '\n', 'utf8');
  else process.stdout.write(json + '\n');
}

if (require.main === module) main();

module.exports = { convert };
