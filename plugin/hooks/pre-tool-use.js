// PreToolUse hook：多信号三级触发 + 懒创建模板 + C 阶段批准 + E 阶段 impl_plan [/] 检查
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, hasUnsyncedPlanFiles, CODE_EXTS, ARTIFACT_FILES, createTemplates, VAULT_PATH, readActive, isTeammate, getArtifactDir, getProjectRuntimeDir, formatBridgeHint, getNativePlanPath, getProjectName, displayDir, FORMAT_SNIPPETS, ARCHIVE_MARKER, getActiveChangeEntries, isChangeApproved, summarizeActiveChanges, artifactRootChoiceNeeded, artifactRootChoiceMessage, getV5MigrationInfo, v5MigrationPromptMessage } = paceUtils;

// I-05: 常量提升到模块级（ARTIFACT_FILES 是静态数组，filter 结果不变）
const PROTECTED_ARTIFACTS = ARTIFACT_FILES.filter(f => f !== 'spec.md');

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const {
  bashCommandLooksMutating,
  bashCommandRedirectsToArtifact,
  bashShellCommandRedirectsToArtifact,
  bashCommandEmbedsArtifactWriteScript,
  bashCommandMutatesArtifactRuntimeControl,
  bashCommandMutatesWorktreeLocalArtifactRootChoice,
  bashCommandReferencesArtifact,
  bashShellCommandReferencesArtifact,
  bashArtifactRuntimeControlDenyReason,
  bashArtifactDenyReason,
} = require('./pre-tool-use/bash-guard');
const {
  isArtifactWriterAgentTool,
  extractPromptArtifactDir,
  promptHasExactArtifactDir,
  promptHasTrueField,
  promptDeclaredAction,
  promptUpdateStatusValue,
  explicitReservationFromPrompt,
  reservationRelForLookup,
  reservationMatchesExplicit,
  promptTemplateForOperation,
  artifactWriterCreateChgHint,
  reservationRequiredReason,
  reservationExplicitMissingReason,
  agentLifecyclePromptDenyReason,
  legacyArtifactWriterLockDenyReason,
  artifactResourceLockDenyReason,
  artifactReservationDenyReason,
  agentArtifactDirDenyReason,
} = require('./pre-tool-use/agent-lifecycle-guard');
const {
  isArtifactWriterManagedRel,
  directArtifactMutationDenyReason,
  detectChangeDetailMarkerMutation,
  markerMutationDenyReason,
} = require('./pre-tool-use/marker-guard');

function isArtifactWriterAgent(stdin) {
  return paceUtils.isArtifactWriterAgentType(stdin.agentType);
}

function isFileMutationTool(toolName) {
  return ['Write', 'Edit', 'MultiEdit'].includes(toolName);
}

function isEditMutationTool(toolName) {
  return ['Edit', 'MultiEdit'].includes(toolName);
}

function isAgentTool(toolName) {
  return toolName === 'Agent';
}

function isBashTool(toolName) {
  return toolName === 'Bash';
}

function getArtifactRelIfRelevant(toolName, paceSignal, artDir, filePath) {
  if (!isFileMutationTool(toolName) || !paceSignal) return null;
  return paceUtils.artifactRelativePathForFile(artDir, filePath);
}

function isUnderDir(baseDir, targetPath) {
  const base = paceUtils.normalizePath(path.resolve(baseDir || ''));
  const target = paceUtils.normalizePath(path.resolve(targetPath || ''));
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return !!base && (target === base || target.startsWith(baseWithSlash));
}

function worktreeHostNonArtifactWriteNote(cwd, artDir, filePath, artifactRel) {
  if (!filePath || artifactRel) return '';
  const context = paceUtils.executionContextForCwd(cwd);
  if (!context.isWorktree) return '';
  if (!isUnderDir(context.stateDir, filePath)) return '';
  if (isUnderDir(cwd, filePath)) return '';
  const relToHost = path.relative(context.stateDir, filePath).replace(/\\/g, '/');
  return [
    `当前 cwd 是 worktree：${displayDir(cwd)}；本次普通文件目标在宿主 checkout：${filePath}`,
    `artifact_dir=${displayDir(artDir)} 仅用于 PaceFlow artifacts；${relToHost} 不是 artifact。`,
    '如果用户要求修改当前 worktree，请改用当前 worktree 下的对应路径；如果用户明确要求修改宿主 checkout，可继续使用该路径。'
  ].join('\n');
}

// S-1: 统一 stdin 解析
paceUtils.withStdinParsed((stdin) => {
  try {
  const t0 = Date.now();
  const { toolName, content } = stdin;
  const editList = Array.isArray(stdin.toolInput.edits) ? stdin.toolInput.edits : [];
  const oldString = stdin.oldString || editList.map(e => e.old_string || '').join('\n');
  const newString = stdin.newString || editList.map(e => e.new_string || '').join('\n');
  const bashCommand = stdin.toolInput.command || '';
  const rawFilePath = stdin.filePath || '';
  const filePath = paceUtils.resolveToolFilePath(cwd, rawFilePath);
  log(paceUtils.logEntry('PreToolUse', 'ENTRY', { proj, tool: toolName, file: filePath, stdin_ok: stdin.ok }));

  // v4.7: teammate 降级——PACE 流程 deny → additionalContext 提醒
  function denyOrHint(reason) {
    const enrichedReason = paceUtils.appendArtifactDirHint(cwd, reason);
    if (isTeammate()) {
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `PACE 提醒（teammate 模式）：${enrichedReason}` } };
    }
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: enrichedReason } };
  }
  function hardDeny(reason, action, fields = {}) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', action, { proj, tool: toolName, file: filePath, ...fields, dur: Date.now() - t0 }));
    return output;
  }
  function heartbeatChangeOwners(reason) {
    if (paceSignal !== 'artifact' || !stdin.sessionId) return;
    const touched = paceUtils.touchChangeOwnersForSession(cwd, {
      sessionId: stdin.sessionId,
      states: ['active', 'closing'],
    });
    if (touched.length > 0) {
      log(paceUtils.logEntry('PreToolUse', 'CHANGE_OWNER_HEARTBEAT', {
        proj,
        reason,
        changes: touched.join(','),
        dur: Date.now() - t0,
      }));
    }
  }
  const teammateTag = isTeammate() ? '_TEAMMATE' : '';

  // W-3: 缓存 isPaceProject 结果（避免多次调用）
  const paceSignal = isPaceProject(cwd);
  const artDir = getArtifactDir(cwd);
  const rootConfigError = paceSignal ? paceUtils.artifactRootConfigError(cwd) : null;
  const needsArtifactRootChoice = artifactRootChoiceNeeded(cwd);
  const artifactRootChoiceReason = needsArtifactRootChoice ? artifactRootChoiceMessage(cwd) : '';
  const v5MigrationInfo = getV5MigrationInfo(cwd);
  const v5MigrationReason = v5MigrationInfo.needsPrompt ? v5MigrationPromptMessage(cwd) : '';
  const artifactRootHint = paceUtils.artifactDirRuntimeHint(cwd);
  log(paceUtils.logEntry('PreToolUse', 'ROUTE', {
    proj,
    signal: paceSignal || 'none',
    artifact_dir: displayDir(artDir),
    choice: paceUtils.readArtifactRootChoice(cwd) || 'auto',
    choice_pending: needsArtifactRootChoice,
    legacy_v5: v5MigrationInfo.detected,
    migration_state: v5MigrationInfo.state || '',
  }));
  if (paceSignal === 'artifact' && (isFileMutationTool(toolName) || isBashTool(toolName))) {
    heartbeatChangeOwners(toolName);
  }
  const taskFp = path.join(artDir, 'task.md');
  const taskFileExists = fs.existsSync(taskFp);
  function ensureArtifactWriterBase() {
    const missingBefore = [];
    const changesDir = path.join(artDir, 'changes');
    if (!fs.existsSync(changesDir)) missingBefore.push('changes/');
    for (const sub of ['changes/findings', 'changes/corrections']) {
      if (!fs.existsSync(path.join(artDir, sub))) missingBefore.push(`${sub}/`);
    }
    for (const file of ARTIFACT_FILES) {
      if (!fs.existsSync(path.join(artDir, file))) missingBefore.push(file);
    }
    let createdFiles = [];
    let error = '';
    if (missingBefore.length > 0) {
      try {
        createdFiles = createTemplates(cwd);
      } catch(e) {
        error = e.message || String(e);
      }
    }
    const missingAfter = [];
    if (!fs.existsSync(changesDir)) missingAfter.push('changes/');
    for (const sub of ['changes/findings', 'changes/corrections']) {
      if (!fs.existsSync(path.join(artDir, sub))) missingAfter.push(`${sub}/`);
    }
    for (const file of ARTIFACT_FILES) {
      if (!fs.existsSync(path.join(artDir, file))) missingAfter.push(file);
    }
    return { missingBefore, missingAfter, createdFiles, error };
  }

  // W-2: 使用 readActive 替换手动读取（内部自动解析 vault 路径）
  let taskActiveContent = readActive(cwd, 'task.md') || '';

  // v4.3.1: 仅 [ ]/[/]/[!] 算活跃任务，[x]/[-] 不算
  const hasActiveTasks = /- \[[ \/!]\]/.test(taskActiveContent);
  const isCodeFile = CODE_EXTS.some(ext => filePath.endsWith(ext));
  const fileName = filePath ? path.basename(filePath) : '';

  // P0-20260506-02: PACE 项目的 Write/Edit 保护链路必须 fail-closed。
  // 非 PACE 项目保持低干扰；PACE 项目中坏 stdin 或缺关键字段不能自然放行。
  if (paceSignal) {
    if (!stdin.ok) {
      return hardDeny(
        'PACE hook 无法解析 Claude Code 提供的 Write/Edit JSON 输入。为避免绕过 artifact 保护，本次写入已阻止；请重试工具调用。',
        'DENY_BAD_STDIN',
        { stdin_ok: false }
      );
    }
    if (rootConfigError && (isAgentTool(toolName) || isFileMutationTool(toolName) || (isBashTool(toolName) && bashCommandLooksMutating(bashCommand)))) {
      return hardDeny(rootConfigError.message, 'DENY_ARTIFACT_ROOT_CONFIG', {
        code: rootConfigError.code,
        choice_path: rootConfigError.choicePath,
      });
    }
    if (isAgentTool(toolName)) {
      if (isArtifactWriterAgentTool(stdin) && needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_AGENT_ARTIFACT_ROOT_CHOICE${teammateTag}`, {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin) && v5MigrationInfo.needsPrompt) {
        const output = denyOrHint(v5MigrationReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_AGENT_V5_MIGRATION${teammateTag}`, {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(v5MigrationInfo.dir),
          state_path: v5MigrationInfo.statePath,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin) && !promptHasExactArtifactDir(stdin.toolInput.prompt, artDir)) {
        const declaredArtifactDir = extractPromptArtifactDir(stdin.toolInput.prompt);
        const reason = agentArtifactDirDenyReason(artDir, declaredArtifactDir, stdin.toolInput.prompt);
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ARTIFACT_DIR', {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(artDir),
          declared_artifact_dir: declaredArtifactDir ? displayDir(declaredArtifactDir) : '',
          dur: Date.now() - t0,
        }));
        return;
      }
      if (isArtifactWriterAgentTool(stdin)) {
        const lifecycleReason = agentLifecyclePromptDenyReason(stdin.toolInput.prompt, artDir);
        if (lifecycleReason) {
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: lifecycleReason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_LIFECYCLE_PROMPT', {
            proj,
            agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
            reason: lifecycleReason.split('\n')[0],
            dur: Date.now() - t0,
          }));
          return;
        }
        const legacyLock = paceUtils.readArtifactWriterLock(cwd);
        if (legacyLock.ok) {
          const legacyCheck = paceUtils.artifactWriterLockMatches(cwd, '__paceflow-new-agent__');
          if (!legacyCheck.ok && legacyCheck.reason !== 'stale-cleared') {
            const reason = legacyArtifactWriterLockDenyReason(legacyLock);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_LEGACY_ARTIFACT_LOCK', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              lock: legacyLock.path,
              owner: legacyLock.sessionId || '',
              dur: Date.now() - t0,
            }));
            return;
          }
        }
        const ensured = ensureArtifactWriterBase();
        if (ensured.missingAfter.length > 0) {
          paceUtils.clearArtifactReservation(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
          const errorLine = ensured.error ? `\n底层错误：${ensured.error}` : '';
          const reason = `PACE hook 无法在 artifact_dir 创建完整 v6 Artifact 基础结构：${displayDir(artDir)}\n仍缺失：${ensured.missingAfter.join(', ')}${errorLine}\n请检查路径/权限后重试；禁止让 artifact-writer 自行创建 base changes/ 或根索引模板。`;
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ARTIFACT_BASE', {
            proj,
            agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
            artifact_dir: displayDir(artDir),
            missing: ensured.missingAfter.join(', '),
            error: ensured.error,
            dur: Date.now() - t0,
          }));
          return;
        }
        const operation = paceUtils.operationFromAgentPrompt(stdin.toolInput.prompt);
        let reservation = { reserved: false };
        if (operation === 'create-chg' || operation === 'record-correction') {
          const explicit = explicitReservationFromPrompt(stdin.toolInput.prompt);
          const hasExplicitReservation = !!(explicit.id || explicit.fileRel || explicit.filePrefix);
          if (!hasExplicitReservation) {
            const owner = { sessionId: stdin.sessionId, agentId: stdin.agentId };
            const existingReservation = paceUtils.readArtifactReservation(cwd, owner);
            reservation = existingReservation && existingReservation.operation === operation
              ? { reserved: true, ...existingReservation }
              : paceUtils.reserveArtifactId(cwd, {
                sessionId: stdin.sessionId,
                agentId: stdin.agentId,
                artifactDir: artDir,
                operation,
                prompt: stdin.toolInput.prompt,
              });
            if (!reservation.reserved) {
              const reason = [
                `PACE hook 无法为 ${operation} 预留唯一编号，已阻止本次 artifact-writer 以避免并发 ID 冲突。`,
                reservation.lock && reservation.lock.ok ? `当前 sequence 锁：${paceUtils.formatArtifactResourceLock(reservation.lock)}` : `原因：${reservation.reason || 'unknown'}`,
                '请稍后重试；不要让 agent 自行扫描索引分配编号。'
              ].join('\n');
              const output = {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: reason
                }
              };
              process.stdout.write(JSON.stringify(output));
              log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_ID_RESERVATION', {
                proj,
                agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
                artifact_dir: displayDir(artDir),
                operation,
                reason: reservation.reason || '',
                dur: Date.now() - t0,
              }));
              return;
            }
            const reason = reservationRequiredReason(operation, artDir, reservation, cwd);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_RESERVED_PROMPT_REQUIRED', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              operation,
              reserved: reservation.id || reservation.fileRel || reservation.filePrefix || '',
              dur: Date.now() - t0,
            }));
            return;
          }

          const lookupRel = reservationRelForLookup(explicit);
          reservation = lookupRel
            ? paceUtils.findArtifactReservationForRel(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId }, lookupRel)
            : paceUtils.readArtifactReservation(cwd, { sessionId: stdin.sessionId, agentId: stdin.agentId });
          if (!reservationMatchesExplicit(reservation, explicit)) {
            const reason = reservationExplicitMissingReason(operation, explicit);
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_RESERVED_PROMPT_MISMATCH', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              artifact_dir: displayDir(artDir),
              operation,
              reserved: explicit.id || explicit.fileRel || explicit.filePrefix || '',
              dur: Date.now() - t0,
            }));
            return;
          }
          reservation = { reserved: true, ...reservation };
        }
        const explicitTargetChangeId = paceUtils.explicitChangeTargetFromAgentPrompt(stdin.toolInput.prompt);
        if (['update-chg', 'close-chg', 'archive-chg'].includes(operation) && !explicitTargetChangeId) {
          const reason = [
            `派 artifact-writer 执行 ${operation} 时缺少明确 target。`,
            FORMAT_SNIPPETS.skillRef,
            '请重派同一个 agent，并在 prompt 顶部使用完整模板：',
            promptTemplateForOperation({ prompt: stdin.toolInput.prompt, artDir, operation }),
            '不要只在正文或摘要里提到 CHG-ID；hook 不会用正文中随便出现的 ID 判断 owner。'
          ].join('\n');
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_TARGET_REQUIRED', {
            proj,
            agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
            operation,
            dur: Date.now() - t0,
          }));
          return;
        }
        const targetChangeId = operation === 'create-chg'
          ? (reservation && reservation.id || paceUtils.changeIdFromAgentPrompt(stdin.toolInput.prompt))
          : explicitTargetChangeId;
        if (targetChangeId && ['update-chg', 'close-chg', 'archive-chg'].includes(operation)) {
          const ownerStatus = paceUtils.changeOwnerStatus(cwd, targetChangeId, stdin.sessionId);
          if (ownerStatus.disposition === 'foreign-fresh') {
            const reason = [
              `${targetChangeId} 正由另一个 Claude Code session 负责，当前 session 不应接手更新或收尾。`,
              `owner: worktree=${ownerStatus.owner.worktree || '-'} branch=${ownerStatus.owner.branch || '-'} state=${ownerStatus.owner.state || '-'}`,
              '请回到该 worktree/session 完成、暂停或取消；当前 fresh owner 仍有效时，不要由本 session 接手。'
            ].join('\n');
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_CHANGE_OWNER', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              target: targetChangeId,
              owner_session: ownerStatus.owner.sessionId || '',
              owner_state: ownerStatus.owner.state || '',
              owner_worktree: ownerStatus.owner.worktree || '',
              dur: Date.now() - t0,
            }));
            return;
          }
          if (ownerStatus.disposition === 'foreign-stale' && !paceUtils.ownerTakeoverConfirmed(stdin.toolInput.prompt)) {
            const reason = [
              `${targetChangeId} 的 owner 记录已过期，但属于另一个 session。`,
              '优先回到原 worktree/session 继续处理。若用户明确要求由当前 checkout 接手，请重派同一 artifact-writer，并加入：',
              'owner-takeover-confirmed: true',
              'owner-takeover-source: user-directive',
              'owner-takeover-evidence: <用户明确要求当前 session 接手的原话>'
            ].join('\n');
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_AGENT_CHANGE_OWNER_STALE', {
              proj,
              agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
              target: targetChangeId,
              owner_session: ownerStatus.owner.sessionId || '',
              dur: Date.now() - t0,
            }));
            return;
          }
        }
        if (targetChangeId && ['create-chg', 'update-chg', 'close-chg', 'archive-chg'].includes(operation)) {
          const action = operation === 'update-chg' ? promptDeclaredAction(stdin.toolInput.prompt) : '';
          const updateStatusValue = operation === 'update-chg' ? promptUpdateStatusValue(stdin.toolInput.prompt) : '';
          const ownerState = ['close-chg', 'archive-chg'].includes(operation)
            ? 'closing'
            : operation === 'create-chg'
              ? 'backlog'
            : action === 'approve'
              ? 'ready'
            : updateStatusValue === '!'
              ? 'blocked'
              : 'active';
          const ownerWrite = paceUtils.writeChangeOwner(cwd, targetChangeId, {
            sessionId: stdin.sessionId,
            agentId: stdin.agentId,
            operation,
            state: ownerState,
          });
          log(paceUtils.logEntry('PreToolUse', ownerWrite.ok ? 'CHANGE_OWNER_SET' : 'CHANGE_OWNER_SET_FAILED', {
            proj,
            target: targetChangeId,
            operation,
            state: ownerState,
            reason: ownerWrite.reason || '',
            dur: Date.now() - t0,
          }));
        }
        const created = [...new Set([
          ...ensured.createdFiles,
          ...(ensured.missingBefore.includes('changes/') ? ['changes/'] : []),
          ...(ensured.missingBefore.includes('changes/findings/') ? ['changes/findings/'] : []),
          ...(ensured.missingBefore.includes('changes/corrections/') ? ['changes/corrections/'] : []),
        ])];
        const createdMsg = created.length > 0 ? `；已自动创建 Artifact 基础模板：${created.join(', ')}` : '';
        const reservationMsg = reservation.reserved
          ? `；reserved-id: ${reservation.id}${reservation.fileRel ? `；reserved-file: ${reservation.fileRel}` : ''}${reservation.filePrefix ? `；reserved-file-prefix: ${reservation.filePrefix}<slug>.md` : ''}。必须使用该预留编号，不得重新扫描索引分配编号`
          : '';
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: `artifact-writer ARTIFACT_DIR 已确认：${displayDir(artDir)}；仅用于 ${paceUtils.PACE_ARTIFACT_ROOT_CONTENT}；execution-context: ${paceUtils.executionContextForCwd(cwd).text}${reservationMsg}${createdMsg}`
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT_ARTIFACT_BASE', {
          proj,
          agent: stdin.toolInput.subagent_type || stdin.toolInput.subagentType,
          artifact_dir: displayDir(artDir),
          operation,
          reserved: reservation.reserved ? (reservation.id || reservation.fileRel || reservation.filePrefix || '') : '',
          created: created.join(', '),
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_AGENT', { proj, tool: toolName, dur: Date.now() - t0 }));
      return;
    }
    if (isBashTool(toolName)) {
      if (bashCommandMutatesArtifactRuntimeControl(bashCommand, cwd)) {
        const reason = bashArtifactRuntimeControlDenyReason(bashCommand);
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_BASH_ARTIFACT_RUNTIME${teammateTag}`, {
          proj,
          command: String(bashCommand).slice(0, 160).replace(/\n/g, ' '),
          runtime: paceUtils.getProjectRuntimeDir(cwd),
          dur: Date.now() - t0,
        }));
        return;
      }
      const mutatesArtifact = bashCommandRedirectsToArtifact(bashCommand, cwd, artDir) ||
        bashShellCommandRedirectsToArtifact(bashCommand, cwd, artDir) ||
        bashCommandEmbedsArtifactWriteScript(bashCommand, cwd, artDir) ||
        (bashCommandLooksMutating(bashCommand) &&
          (bashCommandReferencesArtifact(bashCommand, cwd, artDir) || bashShellCommandReferencesArtifact(bashCommand, cwd, artDir)));
      if (mutatesArtifact) {
        const reason = v5MigrationInfo.needsPrompt ? v5MigrationReason : bashArtifactDenyReason(bashCommand);
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_BASH_ARTIFACT${teammateTag}`, {
          proj,
          command: String(bashCommand).slice(0, 160).replace(/\n/g, ' '),
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_BASH', { proj, dur: Date.now() - t0 }));
      return;
    }
    if (!isFileMutationTool(toolName)) {
      return hardDeny(
        `PACE hook 收到缺失或未知工具名：${toolName || '(empty)'}。本 hook 只允许处理 Write/Edit/MultiEdit/Agent/Bash，已阻止以避免绕过保护。`,
        'DENY_BAD_TOOL'
      );
    }
    if (!rawFilePath) {
      return hardDeny(
        'PACE hook 缺少 tool_input.file_path，无法判断写入是否会修改 artifact。为避免绕过保护，本次写入已阻止；请重试工具调用。',
        'DENY_MISSING_FILE_PATH'
      );
    }
  }

  // v4.3.1: 项目外文件豁免（CWD 和 vault artifact 目录均视为"项目内"）
  // H-1: 使用 normalizePath 跨平台适配（Windows toLowerCase，Linux 保持原样）
  const normalizedFile = paceUtils.normalizePath(filePath);
  const normalizedCwd = paceUtils.normalizePath(cwd);
  if (isFileMutationTool(toolName) && paceUtils.isWorktreeLocalArtifactRootChoicePath(cwd, filePath)) {
    return hardDeny(
      paceUtils.worktreeLocalArtifactRootChoiceDenyReason(cwd),
      'DENY_WORKTREE_LOCAL_ARTIFACT_ROOT_CHOICE',
      {
        file: filePath,
        authoritative: paceUtils.getArtifactRootChoicePath(cwd),
      }
    );
  }
  if (isBashTool(toolName) && bashCommandMutatesWorktreeLocalArtifactRootChoice(bashCommand, cwd)) {
    return hardDeny(
      paceUtils.worktreeLocalArtifactRootChoiceDenyReason(cwd, `被拦截的命令：${String(bashCommand || '').slice(0, 500)}`),
      'DENY_BASH_WORKTREE_LOCAL_ARTIFACT_ROOT_CHOICE',
      {
        command: String(bashCommand).slice(0, 160).replace(/\n/g, ' '),
        authoritative: paceUtils.getArtifactRootChoicePath(cwd),
      }
    );
  }
  if (isFileMutationTool(toolName) && paceUtils.isArtifactRuntimeControlPath(cwd, filePath)) {
    return hardDeny(
      `禁止使用 ${toolName} 修改 PaceFlow artifact 写入控制运行态：${filePath}。锁、编号计数、reservation 与索引事务只能由 hook 管理；不要手写或删除运行态文件。`,
      'DENY_ARTIFACT_RUNTIME_CONTROL',
      {
        file: filePath,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
      }
    );
  }
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  const artifactRelForMutation = getArtifactRelIfRelevant(toolName, paceSignal, artDir, filePath);
  // Artifact paths are part of the guarded project surface even when vault/local routing
  // puts them outside the current worktree cwd. Ordinary host-checkout files from a
  // worktree get a soft note only; PaceFlow hard-gates artifact semantics, not generic
  // edits to every path the user may explicitly request.
  const isInsideProject = normalizedFile.startsWith(cwdWithSlash) || !!artifactRelForMutation;
  const hostNonArtifactWriteNote = isFileMutationTool(toolName) && paceSignal
    ? worktreeHostNonArtifactWriteNote(cwd, artDir, filePath, artifactRelForMutation)
    : '';
  let artifactResourceLockHeld = null;
  if (artifactRelForMutation) {
    if (isArtifactWriterAgent(stdin)) {
      if (/^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation)) {
        const mutationText = [content, newString].filter(Boolean).join('\n');
        if (/^status:\s*archived\s*$/mi.test(mutationText)) {
          const missingArchive = ['task.md', 'implementation_plan.md'].filter(file => {
            try { return !paceUtils.ARCHIVE_PATTERN.test(fs.readFileSync(path.join(artDir, file), 'utf8')); }
            catch(e) { return true; }
          });
          if (missingArchive.length > 0) {
            const reason = [
              `禁止在根索引缺少 ARCHIVE 标记时先把详情归档：${artifactRelForMutation}。`,
              `缺少 ARCHIVE 标记：${missingArchive.join(', ')}`,
              '请先修复根索引双区结构，再执行 close-chg / archive-chg；不要留下详情 archived 但索引仍活跃的半归档状态。'
            ].join('\n');
            const output = {
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: reason
              }
            };
            process.stdout.write(JSON.stringify(output));
            log(paceUtils.logEntry('PreToolUse', 'DENY_ARCHIVE_WITHOUT_INDEX_MARKER', {
              proj,
              tool: toolName,
              file: filePath,
              artifact: artifactRelForMutation,
              missing: missingArchive.join(','),
              agent_id: stdin.agentId,
              agent_type: stdin.agentType,
              dur: Date.now() - t0,
            }));
            return;
          }
        }
      }
      if (toolName === 'Write' && /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation)) {
        const fm = paceUtils.parseFrontmatter(content || '');
        const status = String(fm.status || '').replace(/^["']|["']$/g, '').trim();
        if (status && !['planned', 'in-progress', 'completed', 'archived', 'cancelled'].includes(status)) {
          const reason = `CHG/HOTFIX 详情 frontmatter status 非法：${status}。允许值：planned / in-progress / completed / archived / cancelled。create-chg 初始状态必须是 planned。`;
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_STATUS_INVALID', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            status,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            dur: Date.now() - t0,
          }));
          return;
        }
      }
      let reservation = paceUtils.findArtifactReservationForRel(cwd, {
        sessionId: stdin.sessionId,
        agentId: stdin.agentId,
      }, artifactRelForMutation);
      if (toolName === 'Write') {
        const writeNeedsReservation = !fs.existsSync(filePath) && (
          /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(artifactRelForMutation) ||
          /^changes\/corrections\/correction-\d{4}-\d{2}-\d{2}-\d{2}-.+\.md$/i.test(artifactRelForMutation)
        );
        if (writeNeedsReservation && !reservation) {
          const reason = [
            `artifact-writer 正在新建 ${artifactRelForMutation}，但当前 session/agent 没有 hook 预留编号。`,
            '请从主 session 运行 reserve-artifact-id helper，把 helper 输出放进 artifact-writer prompt 顶部后重派。',
            '不要让 agent 自行扫描索引分配 CHG/HOTFIX/CORRECTION 编号。'
          ].join('\n');
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESERVATION_MISSING', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            dur: Date.now() - t0,
          }));
          return;
        }
        if (!reservation) {
          reservation = paceUtils.readArtifactReservation(cwd, {
            sessionId: stdin.sessionId,
            agentId: stdin.agentId,
          });
        }
        const reservationMatch = writeNeedsReservation
          ? paceUtils.reservationMatchesArtifactRel(reservation, artifactRelForMutation)
          : { ok: true };
        if (!reservationMatch.ok) {
          const reason = artifactReservationDenyReason(reservationMatch, artifactRelForMutation);
          const output = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: reason
            }
          };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESERVATION_MISMATCH', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRelForMutation,
            agent_id: stdin.agentId,
            agent_type: stdin.agentType,
            expected: reservationMatch.expected,
            dur: Date.now() - t0,
          }));
          return;
        }
      }
      const resource = paceUtils.artifactResourceForRel(artifactRelForMutation);
      const lockAttempt = paceUtils.acquireArtifactResourceLock(cwd, resource, {
        sessionId: stdin.sessionId,
        agentId: stdin.agentId,
        artifactDir: artDir,
        file: filePath,
        operation: reservation && reservation.operation || '',
        toolName,
      });
      if (!lockAttempt.acquired) {
        const reason = artifactResourceLockDenyReason(lockAttempt, resource, artifactRelForMutation);
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_RESOURCE_LOCK', {
          proj,
          tool: toolName,
          file: filePath,
          artifact: artifactRelForMutation,
          resource,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
          reason: lockAttempt.reason,
          dur: Date.now() - t0,
        }));
        return;
      }
      artifactResourceLockHeld = resource;
      log(paceUtils.logEntry('PreToolUse', lockAttempt.reentrant ? 'PASS_ARTIFACT_RESOURCE_LOCK_REENTRANT' : 'PASS_ARTIFACT_RESOURCE_LOCK', {
        proj,
        tool: toolName,
        file: filePath,
        artifact: artifactRelForMutation,
        resource,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
        waited_ms: lockAttempt.waitedMs || 0,
        dur: Date.now() - t0,
      }));
    } else {
      const resource = paceUtils.artifactResourceForRel(artifactRelForMutation);
      const existingLock = resource ? paceUtils.readArtifactResourceLock(cwd, resource) : { ok: false };
      if (existingLock.ok) {
        const reason = [
          `当前 artifact 正由 artifact-writer 写入，禁止主 session/其他 agent 同时修改 ${artifactRelForMutation}。`,
          '请等待 artifact 写入结束后再重试。'
        ].join('\n');
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason
          }
        };
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', 'DENY_ARTIFACT_CONCURRENT_WRITE', {
          proj,
          tool: toolName,
          file: filePath,
          artifact: artifactRelForMutation,
          resource,
          owner: existingLock.sessionId,
          dur: Date.now() - t0,
        }));
        return;
      }
    }
  }

  // v4.8: artifact 已迁移到 vault 时，拦截对 CWD 中 artifact 文件的 Write/Edit 并重定向
  if (isFileMutationTool(toolName) && artDir !== cwd && paceSignal) {
    const cwdArtifactRel = paceUtils.artifactRelativePathForFile(cwd, filePath);
    if (cwdArtifactRel) {
      const correctPath = path.join(artDir, cwdArtifactRel).replace(/\\/g, '/');
      const reason = `当前 artifact_dir 是 ${displayDir(artDir)}。请将 artifact file_path 修改为：${correctPath}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_REDIRECT', { proj, tool: toolName, file: filePath, artifact: cwdArtifactRel, redirect: correctPath, dur: Date.now() - t0 }));
      return;
    }
  }

  if (isArtifactWriterManagedRel(artifactRelForMutation) && toolName === 'Write' && !isArtifactWriterAgent(stdin)) {
    return hardDeny(
      directArtifactMutationDenyReason(toolName, artifactRelForMutation),
      'DENY_DIRECT_ARTIFACT_WRITE',
      {
        artifact: artifactRelForMutation,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
      }
    );
  }

  if (isEditMutationTool(toolName) && isInsideProject && paceSignal) {
    const artifactRel = paceUtils.artifactRelativePathForFile(artDir, filePath);
    if (artifactRel && fs.existsSync(filePath) && isArtifactWriterAgent(stdin)) {
      try {
        const current = fs.readFileSync(filePath, 'utf8');
        const normalized = paceUtils.normalizeLineEndings(current);
        if (normalized !== current) {
          fs.writeFileSync(filePath, normalized, 'utf8');
          log(paceUtils.logEntry('PreToolUse', 'NORMALIZE_CRLF_ARTIFACT', {
            proj,
            tool: toolName,
            file: filePath,
            artifact: artifactRel,
            dur: Date.now() - t0,
          }));
        }
      } catch(e) {
        log(paceUtils.logEntry('PreToolUse', 'NORMALIZE_CRLF_ARTIFACT_FAILED', {
          proj,
          tool: toolName,
          file: filePath,
          error: e.message,
          dur: Date.now() - t0,
        }));
      }
    }
  }

  // v4.3.2: Write 覆盖已有 artifact 保护（仅 PACE 项目内生效）
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    if (artifactRelForMutation && fs.existsSync(filePath)) {
      if (artifactResourceLockHeld) {
        paceUtils.releaseArtifactResourceLock(cwd, artifactResourceLockHeld, { sessionId: stdin.sessionId, agentId: stdin.agentId });
      }
      const reason = `禁止使用 Write 覆盖已有 artifact：${artifactRelForMutation}。create-chg 若遇到同名文件必须重新分配 CHG-ID；更新已有 artifact 请使用 Edit。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_WRITE_EXISTING_ARTIFACT', { proj, tool: toolName, file: filePath, artifact: artifactRelForMutation, dur: Date.now() - t0 }));
      return;
    }
    if (PROTECTED_ARTIFACTS.includes(fileName) && fs.existsSync(filePath)) {
      const reason = `禁止使用 Write 覆盖已有的 ${fileName}，请使用 Edit 工具进行修改。Write 会丢失全部历史内容。${FORMAT_SNIPPETS.skillRef}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'DENY_WRITE_ARTIFACT', { proj, tool: toolName, file: filePath, reason, dur: Date.now() - t0 }));
      return;
    }
  }

  // T-206: Write 新建 artifact 文件时，注入对应模板内容引导格式
  if (toolName === 'Write' && isInsideProject && paceSignal) {
    if (ARTIFACT_FILES.includes(fileName) && !fs.existsSync(path.join(artDir, fileName))) {
      const TEMPLATES_DIR = path.join(__dirname, 'templates');
      const tmpl = path.join(TEMPLATES_DIR, fileName);
      if (fs.existsSync(tmpl)) {
        try {
          const tmplContent = paceUtils.normalizeLineEndings(fs.readFileSync(tmpl, 'utf8'));
          const ctx = `新建 ${fileName}：请严格按照以下官方模板格式，保留双区结构（${ARCHIVE_MARKER} 分隔符）和注释说明：\n\n${tmplContent}`;
          const output = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx } };
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', 'INJECT_TEMPLATE', { proj, file: fileName, dur: Date.now() - t0 }));
          return;
        } catch(e) {}
      }
    }
  }

  // v4.4.1→v5.0.3: Obsidian 知识库笔记格式注入（Write 到 thoughts/knowledge 时注入格式要求）
  if (toolName === 'Write' && VAULT_PATH && filePath.endsWith('.md')) {
    const nf = normalizedFile;
    const vp = paceUtils.normalizePath(VAULT_PATH);
    const vpSlash = vp.endsWith('/') ? vp : vp + '/';
    let dirName = '';
    if (nf.startsWith(vpSlash + 'thoughts/')) dirName = 'thoughts';
    else if (nf.startsWith(vpSlash + 'knowledge/')) dirName = 'knowledge';
    if (dirName && path.basename(filePath) !== 'README.md') {
      const ctx = dirName === 'knowledge'
        ? '写入 knowledge/ 笔记时请先调用 Skill(paceflow:pace-knowledge)，按该 skill 的 frontmatter 与正文结构要求组织内容。'
        : '写入 thoughts/ 笔记时请先调用 Skill(paceflow:pace-knowledge)，按 thoughts 笔记格式组织 frontmatter 与正文。';
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'INJECT_FORMAT', { proj, file: filePath, dir: dirName, dur: Date.now() - t0 }));
      return;
    }
  }

  // v6: 项目一旦有 changes/，所有执行前检查只看详情文件与索引 wikilink。
  if (paceSignal === 'artifact') {
    const activeEntriesAll = getActiveChangeEntries(cwd);
    const actionableEntries = activeEntriesAll.filter(e => {
      const marks = [e.taskCheckbox, e.implCheckbox].filter(Boolean);
      return marks.some(m => m === ' ' || m === '/' || m === '!');
    });

    // 阻止主 session 直接手写 C/V 阶段标志；应派 artifact writer。
    const markerMutation = detectChangeDetailMarkerMutation({
      artifactRel: artifactRelForMutation,
      newString,
      oldString,
      content,
    });
    if (isFileMutationTool(toolName) && isInsideProject && markerMutation.hasMarkerMutation) {
      if (!isArtifactWriterAgent(stdin)) {
        const reason = markerMutationDenyReason(markerMutation);
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_MARKER${teammateTag}`, {
          proj,
          file: filePath,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
          addedApproved: markerMutation.addedApproved,
          addedVerified: markerMutation.addedVerified,
          setVerifiedDate: markerMutation.setVerifiedDate,
          dur: Date.now() - t0,
        }));
        return;
      }
      log(paceUtils.logEntry('PreToolUse', 'PASS_V6_MARKER_AGENT', {
        proj,
        file: filePath,
        agent_id: stdin.agentId,
        agent_type: stdin.agentType,
        addedApproved: markerMutation.addedApproved,
        addedVerified: markerMutation.addedVerified,
        setVerifiedDate: markerMutation.setVerifiedDate,
        dur: Date.now() - t0,
      }));
    }

    if (isArtifactWriterManagedRel(artifactRelForMutation) && !isArtifactWriterAgent(stdin)) {
      return hardDeny(
        paceUtils.appendArtifactDirHint(cwd, directArtifactMutationDenyReason(toolName, artifactRelForMutation)),
        'DENY_DIRECT_ARTIFACT_EDIT',
        {
          artifact: artifactRelForMutation,
          agent_id: stdin.agentId,
          agent_type: stdin.agentType,
        }
      );
    }

    const currentOwnedActionableEntries = actionableEntries.filter(e => {
      const ownerStatus = paceUtils.changeOwnerStatus(cwd, e.id, stdin.sessionId);
      return ownerStatus.current && ownerStatus.disposition !== 'current-closed';
    });
    const currentToolIsArtifactWriter = isArtifactWriterAgent(stdin);
    const artifactWriterArtifactMutation = currentToolIsArtifactWriter && !!artifactRelForMutation;
    const projectMutationNeedsGate = !artifactWriterArtifactMutation && isInsideProject && (isCodeFile || (isFileMutationTool(toolName) && currentOwnedActionableEntries.length > 0));
    const gatedEntries = isCodeFile ? actionableEntries : currentOwnedActionableEntries;
    const structuralCheckNeeded = !artifactWriterArtifactMutation && isInsideProject && (isCodeFile || isFileMutationTool(toolName));

    if (structuralCheckNeeded) {
      const malformed = actionableEntries.filter(e => e.taskMalformed || e.implMalformed);
      if (malformed.length > 0) {
        const ids = malformed.map(e => e.id).join(', ');
        const reason = [
          `v6 索引行格式损坏：${ids} 的 CHG/HOTFIX 行必须独占一行，并以 "- [ ] [[...]]"、"[/]"、"[x]"、"[!]" 或 "[-]" 开头。`,
          '请派 artifact-writer 修复索引行边界；修复后再继续写项目文件。'
        ].join('\n');
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_INDEX_MALFORMED${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const mismatched = actionableEntries.filter(e => !e.task || !e.impl);
      if (mismatched.length > 0) {
        const ids = mismatched.map(e => e.id).join(', ');
        const reason = [
          `v6 索引不一致：${ids} 必须同时存在于 task.md 与 implementation_plan.md 活跃区。`,
          '请派 artifact-writer 修复索引；不要用 Bash、临时脚本、Obsidian CLI 或主 session 直接改 artifact。',
          '如果 artifact-writer 修复索引也被同一检查阻止，请停止重试并报告 hook 日志。'
        ].join('\n');
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_INDEX_MISMATCH${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const missingDetails = actionableEntries.filter(e => !e.detail || e.detail.missing);
      if (missingDetails.length > 0) {
        const ids = missingDetails.map(e => e.id).join(', ');
        const reason = `v6 详情文件缺失：${ids} 对应 changes/<id>.md 不存在。请派 artifact-writer create-chg 或修复 wikilink。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_DETAIL_MISSING${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }
    }

    if (projectMutationNeedsGate) {
      if (gatedEntries.length === 0) {
        const doneEntries = activeEntriesAll.filter(e => ['x', '-'].includes(e.taskCheckbox) || ['x', '-'].includes(e.implCheckbox));
        const reason = doneEntries.length > 0
          ? `v6 项目当前只有已完成/跳过索引，请先派 artifact-writer close-chg 收尾归档，或 create-chg 创建新的变更后再写代码。archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`
          : `v6 项目没有活跃 CHG/HOTFIX。请先创建 v6 CHG 后再写代码。\n${artifactWriterCreateChgHint(artDir)}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_NO_ACTIVE${teammateTag}`, { proj, tool: toolName, dur: Date.now() - t0 }));
        return;
      }

      const approvedEntries = gatedEntries.filter(e => isChangeApproved(e.detail));
      if (approvedEntries.length === 0) {
        const ids = gatedEntries.map(e => e.id).join(', ');
        const reason = `v6 C 阶段未完成：${ids} 的详情文件缺少 <!-- APPROVED -->，且没有进行中任务。请确认用户是否已批准；若已批准并准备开始，派 artifact-writer approve-and-start，并带批准来源、证据和要开始的 task-id。字段格式见 Skill(paceflow:artifact-management)。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_C_PHASE${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const runnableEntries = approvedEntries.filter(e => {
        const fmStatus = (e.detail.frontmatter.status || '').replace(/^["']|["']$/g, '');
        const tasks = paceUtils.countDetailTasks(e.detail.content);
        return e.taskCheckbox === '/' && e.implCheckbox === '/' && fmStatus === 'in-progress' && tasks.blocked === 0;
      });
      if (runnableEntries.length === 0) {
        const ids = approvedEntries.map(e => e.id).join(', ');
        const reason = `v6 E 阶段未就绪：${ids} 已批准但索引/详情状态未进入可执行状态，或仍有 [!] 暂停/阻塞任务。若本次刚获得用户批准并准备开始，请派 artifact-writer approve-and-start；若此前已暂停/阻塞并确认恢复，请派 update-chg action=update-status 将当前任务标为 [/] 并联动 frontmatter/index 状态。字段格式见 Skill(paceflow:artifact-management)。`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V6_E_PHASE${teammateTag}`, { proj, ids, dur: Date.now() - t0 }));
        return;
      }

      const summaries = summarizeActiveChanges(cwd)
        .filter(s => runnableEntries.some(e => e.slug === s.slug))
        .map(s => `- ${s.id} status=${s.status} task=${s.taskCheckbox} impl=${s.implCheckbox} pending=${s.pending} approved=${s.approved} verified=${s.verified} path=${s.path}`)
        .join('\n');
      const additionalContext = hostNonArtifactWriteNote
        ? `当前 v6 活跃变更：\n${summaries}\n\n${hostNonArtifactWriteNote}`
        : `当前 v6 活跃变更：\n${summaries}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'PASS_V6', { proj, tool: toolName, entries: runnableEntries.length, dur: Date.now() - t0 }));
      return;
    }

    if (hostNonArtifactWriteNote) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: hostNonArtifactWriteNote
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'PASS_V6_WORKTREE_HOST_NOTE', { proj, tool: toolName, file: filePath, dur: Date.now() - t0 }));
      return;
    }

    log(paceUtils.logEntry('PreToolUse', 'PASS_V6_NON_CODE', { proj, tool: toolName, dur: Date.now() - t0 }));
    return;
  }

  // v6-only：有 legacy task.md 但没有 changes/ 时，不再给 v5 自修提示。
  if (paceSignal && v5MigrationInfo.detected && taskFileExists && taskActiveContent.trim() && isInsideProject && (isCodeFile || ARTIFACT_FILES.includes(fileName))) {
    const reason = v5MigrationInfo.needsPrompt
      ? v5MigrationReason
      : `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。当前工具调用已被 hook 阻止，目标代码/artifact 尚未被修改。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 将当前计划桥接为 changes/<id>.md + task.md / implementation_plan.md wikilink 索引。不要继续在 task.md / implementation_plan.md 手写 v5 详情、APPROVED 或 VERIFIED。迁移或桥接后必须重试被阻止的原始工具调用；在写入工具成功前不要声称任务已完成。`;
    const output = denyOrHint(reason);
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', `DENY_LEGACY_ACTIVE${teammateTag}`, { proj, tool: toolName, file: filePath, reason, dur: Date.now() - t0 }));
    return;
  }

  // v5.0.1: native plan 桥接引导 — 检测 .pace/current-native-plan + task.md 无任务
  if (isCodeFile && isInsideProject && !hasActiveTasks && paceSignal) {
    const nativePlan = getNativePlanPath(cwd);
    if (nativePlan) {
      if (needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, dur: Date.now() - t0 }));
        return;
      }
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0
        ? `已自动创建 v6 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
        : `${artifactRootHint}。`;
      const reason = `${createdMsg}检测到未桥接的原生计划文件：${nativePlan}。请先调用 Skill(paceflow:pace-bridge)，按该 skill 将当前计划桥接为 v6 CHG 并记录同步标记；桥接完成后再重试本次代码写入。`;
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', `DENY_NATIVE_PLAN${teammateTag}`, { proj, plan: nativePlan, dur: Date.now() - t0 }));
      return;
    }
  }

  // v4.3.5: 多信号三级触发（仅对项目内代码文件 + 无活跃任务时生效）
  if (isCodeFile && isInsideProject && !hasActiveTasks) {
    // W-3: 使用顶层缓存的 paceSignal
    const codeCount = countCodeFiles(cwd);

    // 第一级：强信号 DENY（superpowers/manual/artifact/code-count）
    // I-06: isPaceProject() 返回 false 或字符串，truthy 检查等价于四重比较
    if (paceSignal) {
      if (v5MigrationInfo.needsPrompt) {
        const output = denyOrHint(v5MigrationReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_V5_MIGRATION${teammateTag}`, {
          proj,
          signal: paceSignal,
          tool: toolName,
          file: filePath,
          artifact_dir: displayDir(v5MigrationInfo.dir),
          state_path: v5MigrationInfo.statePath,
          dur: Date.now() - t0,
        }));
        return;
      }
      if (needsArtifactRootChoice) {
        const output = denyOrHint(artifactRootChoiceReason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, dur: Date.now() - t0 }));
        return;
      }
      // T-076: DENY 前懒创建缺失的模板文件；幂等同内容创建，不需要 artifact-writer 写锁。
      let createdFiles = [];
      if (!taskFileExists) {
        try { createdFiles = createTemplates(cwd); } catch(e) {}
      }
      const createdMsg = createdFiles.length > 0
        ? `已自动创建 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
        : `${artifactRootHint}。`;

      // T-076: 场景化 DENY 消息
      let reason;
      // W-dry-2: 使用 formatBridgeHint 消除重复的 listPlanFiles + 格式化代码
      const bridgeHint = formatBridgeHint(cwd, artDir);
      if (paceSignal === 'superpowers' && bridgeHint) {
        reason = `${createdMsg}检测到 Superpowers 计划文件：${bridgeHint.fileList}。请执行桥接：${bridgeHint.bridgeSteps}\n${FORMAT_SNIPPETS.skillRef}`;
      } else if (paceSignal === 'superpowers') {
        reason = `${createdMsg}检测到 Superpowers 信号但无计划文件。请先执行 P-A-C 流程。\ntask.md 任务格式：${FORMAT_SNIPPETS.taskEntry}\nimpl_plan 索引格式：${FORMAT_SNIPPETS.implIndex}\n${FORMAT_SNIPPETS.skillRef}`;
      } else if (taskFileExists || createdFiles.includes('task.md')) {
        // W-flow-1: 区分"全部完成待归档"和"无任务"
        const hasDoneItems = /- \[[x\-]\]/.test(taskActiveContent);
        if (hasDoneItems) {
          reason = `${createdMsg}检测到 PACE 项目（${paceSignal}）但 task.md 中无进行中的活跃任务（全部已完成/跳过）。请先用 close-chg 收尾归档已完成任务，再定义新任务后写代码。\n收尾方法：${FORMAT_SNIPPETS.closeOp}`;
        } else {
          reason = `${createdMsg}检测到 PACE 项目（${paceSignal}）但 task.md 中无活跃任务。`;
          reason += hasUnsyncedPlanFiles(cwd)
            ? `检测到未同步的 Superpowers 计划文件，请调用 paceflow:pace-bridge：Read plan → 派 artifact-writer create-chg 创建 v6 CHG 后再写代码。`
            : `请先执行 P-A-C 流程（Plan→Artifact→Check）定义任务后再写代码。\n${artifactWriterCreateChgHint(artDir)}\ntask.md 格式：${FORMAT_SNIPPETS.taskGroup}\nimpl_plan 索引格式：${FORMAT_SNIPPETS.implIndex}\n任务状态：${FORMAT_SNIPPETS.statusHelp}\n变更状态：${FORMAT_SNIPPETS.changeStatusHelp}`;
        }
      } else {
        reason = `${createdMsg}检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在。\n${artifactWriterCreateChgHint(artDir)}\n${FORMAT_SNIPPETS.skillRef}`;
      }
      const output = denyOrHint(reason);
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', `DENY${teammateTag}`, { proj, signal: paceSignal, tool: toolName, file: filePath, created: createdFiles.join(', '), reason, dur: Date.now() - t0 }));
      return;
    }

    // T-079: 第二级 — off-by-one 前瞻判断（无强信号但 Write 新文件将达到阈值）
    if (!paceSignal && toolName === 'Write' && !fs.existsSync(filePath)) {
      const futureCount = codeCount + 1;
      if (futureCount >= 3) {
        if (needsArtifactRootChoice) {
          const output = denyOrHint(artifactRootChoiceReason);
          process.stdout.write(JSON.stringify(output));
          log(paceUtils.logEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, dur: Date.now() - t0 }));
          return;
        }
        let createdFiles = [];
        try { createdFiles = createTemplates(cwd); } catch(e) {}
        const createdMsg = createdFiles.length > 0
          ? `已自动创建 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
          : `${artifactRootHint}。`;
        const reason = `${createdMsg}即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先创建 v6 CHG；若用户已批准并准备开始，派 artifact-writer approve-and-start 后再写代码。字段格式见 Skill(paceflow:artifact-management)。\n${artifactWriterCreateChgHint(artDir)}\n${FORMAT_SNIPPETS.skillRef}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(paceUtils.logEntry('PreToolUse', `DENY${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, created: createdFiles.join(', '), reason, dur: Date.now() - t0 }));
        return;
      }
    }

    // 第三级：软提醒（1-2 个代码文件）
    if (codeCount >= 1) {
      // I-9: 变量名语义化
      const isNewFileForHint = toolName === 'Write' && !fs.existsSync(filePath);
      const displayCountForHint = codeCount + (isNewFileForHint ? 1 : 0);
      const ctx = `提醒：这是项目中的第 ${displayCountForHint} 个代码文件，如果这是正式项目，建议先派 artifact-writer create-chg 建立 v6 CHG 后再继续写代码。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('PreToolUse', 'SOFT_WARN', { proj, codeCount: displayCountForHint, tool: toolName, file: filePath, output: ctx, dur: Date.now() - t0 }));
      return;
    }

    // W-code-6: 当前无代码文件，不触发
    log(paceUtils.logEntry('PreToolUse', 'SKIP', { proj, tool: toolName, reason: 'no-trigger', dur: Date.now() - t0 }));
    return;
  }

  // 非 v6 的 legacy task.md 不再作为可执行上下文注入。
  if (taskFileExists && taskActiveContent) {
    const ctx = paceUtils.appendArtifactDirHint(cwd, `检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。PACEflow v6 不继续兼容 v5 活跃流程；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。迁移或桥接只处理 artifact 状态，不能算作完成原始代码任务；之后必须重试被阻止的原始工具调用。`);
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: ctx
      }
    };
    process.stdout.write(JSON.stringify(output));
    log(paceUtils.logEntry('PreToolUse', 'PASS', { proj, tool: toolName, injected: taskActiveContent.split('\n').length, dur: Date.now() - t0 }));
  } else {
    log(paceUtils.logEntry('PreToolUse', 'SKIP', { proj, tool: toolName, reason: 'no-task-content', dur: Date.now() - t0 }));
  }
  } catch(e) {
    try { log(paceUtils.logEntry('PreToolUse', 'ERROR', { proj, error: e.message })); } catch(e2) {}
  }
});
