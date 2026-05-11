#!/usr/bin/env node
// Pre-reserve artifact IDs for artifact-writer prompts.

const fs = require('fs');
const path = require('path');
const paceUtils = require('./pace-utils');

const LOG_PATH = path.join(__dirname, 'pace-hooks.log');
const log = paceUtils.createLogger(LOG_PATH);

function parseArgs(argv) {
  const args = { operation: '', type: '', cwd: '', sessionId: '', newReservation: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--new') {
      args.newReservation = true;
    } else if (arg === '--operation' || arg === '-o') {
      args.operation = String(argv[++i] || '');
    } else if (arg === '--type' || arg === '--kind') {
      args.type = String(argv[++i] || '');
    } else if (arg === '--cwd') {
      args.cwd = String(argv[++i] || '');
    } else if (arg === '--session-id') {
      args.sessionId = String(argv[++i] || '');
    } else if (!args.operation && !arg.startsWith('-')) {
      args.operation = arg;
    }
  }
  args.operation = args.operation.trim().toLowerCase();
  args.type = args.type.trim().toLowerCase();
  args.cwd = args.cwd ? path.resolve(args.cwd) : paceUtils.resolveProjectCwd();
  args.sessionId = paceUtils.normalizeSessionId(args.sessionId || paceUtils.currentSessionId());
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node hooks/reserve-artifact-id.js --operation create-chg [--type hotfix] [--new]',
    '  node hooks/reserve-artifact-id.js --operation record-correction [--new]',
    '',
    'Run this from the main session before dispatching paceflow:artifact-writer.',
  ].join('\n');
}

function reservationConsumed(artDir, reservation) {
  if (reservation.fileRel) return fs.existsSync(path.join(artDir, reservation.fileRel));
  if (reservation.filePrefix) {
    const dir = path.join(artDir, path.dirname(reservation.filePrefix));
    const base = path.basename(reservation.filePrefix);
    try {
      return fs.readdirSync(dir).some(file => file.startsWith(base) && file.endsWith('.md'));
    } catch(e) {
      return false;
    }
  }
  return false;
}

function reusableReservation(cwd, artDir, sessionId, operation) {
  const existing = paceUtils.readArtifactReservation(cwd, { sessionId });
  if (!existing || existing.operation !== operation) return null;
  if (existing.timestampMs && Date.now() - existing.timestampMs > paceUtils.ARTIFACT_WRITER_LOCK_TTL_MS) return null;
  if (reservationConsumed(artDir, existing)) {
    const rel = existing.fileRel || (existing.filePrefix ? `${existing.filePrefix}used.md` : '');
    if (rel) paceUtils.clearArtifactReservationForRel(cwd, { sessionId }, rel);
    return null;
  }
  return existing;
}

function promptForReservation(operation, type) {
  const lines = [`operation: ${operation}`];
  if (operation === 'create-chg' && type) lines.push(`type: ${type}`);
  return lines.join('\n');
}

function formatReservationBlock(artDir, operation, reservation, reused) {
  const lines = [
    `artifact_dir: ${paceUtils.displayDir(artDir)}`,
    `operation: ${operation}`,
  ];
  if (reservation.id) lines.push(`reserved-id: ${reservation.id}`);
  if (reservation.fileRel) lines.push(`reserved-file: ${reservation.fileRel}`);
  if (reservation.filePrefix) lines.push(`reserved-file-prefix: ${reservation.filePrefix}<slug>.md`);
  lines.push('把以上字段原样放到 paceflow:artifact-writer prompt 顶部；不要让 agent 扫描索引分配编号。');
  if (reused) lines.push('已复用当前 session 尚未消费的 reservation；如确实要再创建一个新编号，请重新运行本 helper 并加 --new。');
  return lines.join('\n');
}

function fail(cwd, action, message, fields = {}) {
  log(paceUtils.logEntry('ReserveID', action, { proj: paceUtils.getProjectName(cwd), ...fields }));
  process.stdout.write(`${message}\n`);
  process.exitCode = 2;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!['create-chg', 'record-correction'].includes(args.operation)) {
    fail(args.cwd, 'DENY_INVALID_OPERATION', `reserve-artifact-id 只支持 create-chg 或 record-correction。\n\n${usage()}`, { operation: args.operation || '-' });
    return;
  }
  if (args.operation === 'create-chg' && args.type && !['change', 'hotfix', 'research'].includes(args.type)) {
    fail(args.cwd, 'DENY_INVALID_TYPE', 'create-chg --type 只支持 change / hotfix / research。', { type: args.type });
    return;
  }
  if (!args.sessionId) {
    fail(args.cwd, 'DENY_MISSING_SESSION', '缺少 CLAUDE_CODE_SESSION_ID，无法创建可被后续 artifact-writer Agent 匹配的 session reservation。请在 Claude Code 主 session 的 Bash 工具中运行本 helper。');
    return;
  }

  const configError = paceUtils.artifactRootConfigError(args.cwd);
  if (configError) {
    fail(args.cwd, 'DENY_ARTIFACT_ROOT_CONFIG', configError.message, { reason: configError.code });
    return;
  }
  if (paceUtils.artifactRootChoiceNeeded(args.cwd)) {
    fail(args.cwd, 'DENY_ARTIFACT_ROOT_CHOICE', paceUtils.artifactRootChoiceMessage(args.cwd));
    return;
  }
  const migrationInfo = paceUtils.getV5MigrationInfo(args.cwd);
  if (migrationInfo.needsPrompt) {
    fail(args.cwd, 'DENY_V5_MIGRATION', paceUtils.v5MigrationPromptMessage(args.cwd), { artifact_dir: paceUtils.displayDir(migrationInfo.dir) });
    return;
  }

  const artDir = paceUtils.getArtifactDir(args.cwd);
  try { paceUtils.ensureProjectInfra(args.cwd); } catch(e) {}
  try { paceUtils.createTemplates(args.cwd); } catch(e) {
    fail(args.cwd, 'DENY_TEMPLATE_CREATE', `PACE hook 无法在 artifact_dir 创建完整 v6 Artifact 基础结构：${paceUtils.displayDir(artDir)}\n底层错误：${e.message || String(e)}`, { artifact_dir: paceUtils.displayDir(artDir) });
    return;
  }

  let reservation = null;
  let reused = false;
  if (!args.newReservation) {
    reservation = reusableReservation(args.cwd, artDir, args.sessionId, args.operation);
    reused = !!reservation;
  }
  if (!reservation) {
    reservation = paceUtils.reserveArtifactId(args.cwd, {
      sessionId: args.sessionId,
      artifactDir: artDir,
      operation: args.operation,
      prompt: promptForReservation(args.operation, args.type),
    });
  }
  if (!reservation || !reservation.reserved && !reservation.id && !reservation.fileRel && !reservation.filePrefix) {
    const detail = reservation && reservation.lock && reservation.lock.ok
      ? paceUtils.formatArtifactResourceLock(reservation.lock)
      : (reservation && reservation.reason || 'unknown');
    fail(args.cwd, 'DENY_ID_RESERVATION', `PACE hook 无法为 ${args.operation} 预留唯一编号，已停止以避免并发 ID 冲突。\n原因：${detail}`, { operation: args.operation, reason: reservation && reservation.reason || '' });
    return;
  }

  log(paceUtils.logEntry('ReserveID', reused ? 'REUSE' : 'RESERVE', {
    proj: paceUtils.getProjectName(args.cwd),
    operation: args.operation,
    artifact_dir: paceUtils.displayDir(artDir),
    reserved: reservation.id || reservation.fileRel || reservation.filePrefix || '',
  }));
  process.stdout.write(`${formatReservationBlock(artDir, args.operation, reservation, reused)}\n`);
}

main();
