# Claude Code 2.1.76-2.1.131 PaceFlow Evaluation

> Date: 2026-05-06
> Baseline: PaceFlow was designed against Claude Code <= 2.1.75 behavior.
> Current target: Claude Code 2.1.131.
> Local CLI observed during task-tool revalidation: Claude Code 2.1.128.

## Sources

- Official Claude Code changelog: <https://code.claude.com/docs/en/changelog>
- Official GitHub changelog source: <https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md>
- Official hooks reference: <https://code.claude.com/docs/en/hooks>
- Official plugins reference: <https://code.claude.com/docs/en/plugins-reference>
- Official subagents reference: <https://code.claude.com/docs/en/sub-agents>
- Official tools reference: <https://code.claude.com/docs/en/tools-reference>

Collection command used locally:

```bash
gh api repos/anthropics/claude-code/contents/CHANGELOG.md --jq .content | base64 -d > /tmp/claude-code-changelog.md
```

Covered versions: `2.1.76`, `2.1.77`, `2.1.78`, `2.1.79`, `2.1.80`, `2.1.81`, `2.1.83`, `2.1.84`, `2.1.85`, `2.1.86`, `2.1.87`, `2.1.89`, `2.1.90`, `2.1.91`, `2.1.92`, `2.1.94`, `2.1.96`, `2.1.97`, `2.1.98`, `2.1.101`, `2.1.105`, `2.1.107`, `2.1.108`, `2.1.109`, `2.1.110`, `2.1.111`, `2.1.112`, `2.1.113`, `2.1.114`, `2.1.116`, `2.1.117`, `2.1.118`, `2.1.119`, `2.1.120`, `2.1.121`, `2.1.122`, `2.1.123`, `2.1.126`, `2.1.128`, `2.1.129`.

Note: upstream GitHub already contains `2.1.131`. It was checked during the Task Tool Revalidation section and does not add PaceFlow-relevant task/hook changes; plugin/subagent reference docs were also rechecked for the `agents/` directory behavior.

## Executive Findings

Claude Code added enough hook and plugin surface after `2.1.75` that PaceFlow should not treat 2.1.75-era behavior as stable. The most useful additions are:

1. `agent_id` / `agent_type` in hook input when inside subagents.
2. `SubagentStart` / `SubagentStop` hooks with agent transcript access.
3. `CwdChanged` / `FileChanged` hooks and `watchPaths`.
4. `PostToolUseFailure` and `PostToolBatch`.
5. `PreToolUse.updatedInput`, `permissionDecision: "defer"`, and stronger permission semantics.
6. `PostToolUse.updatedToolOutput`.
7. Component-scoped hooks in skills and agents.
8. Worktree hooks and worktree behavior fixes.
9. Plugin validation, plugin zip/url install, plugin userConfig, and plugin persistent data.
10. Skill / agent frontmatter extensions: `effort`, `maxTurns`, `disallowedTools`, `permissionMode`, `initialPrompt`, hooks, paths list, and color.
11. Headless / SDK / production-test improvements: stream-json plugin errors, `--print` respecting agent tools, forked subagents in non-interactive sessions.
12. Telemetry/resource fields: `duration_ms`, `tool_use_id`, OTel skill/tool events, status-line effort.
13. Native plan UX is less random than the 2.1.75-era behavior: accepted plans now auto-name sessions from plan content, `/plan` / `/plan open` reuse the existing plan correctly, and forked conversations no longer share one plan file. PaceFlow should bridge plans by explicit file path/content and recency, not by assuming opaque random names.

## Already Applied During v6 Work

| Update | PaceFlow status |
|---|---|
| Hook input has `agent_id` / `agent_type` inside subagents | Applied in `6.0.9`: `artifact-writer` may write `APPROVED` / `VERIFIED`, main session still denied |
| Agent frontmatter supports `effort` and `color` | Applied in `6.0.7`: `effort: max`, `color: orange` |
| Agent frontmatter supports `maxTurns` | Applied in `6.0.15`: `maxTurns: 32` for `artifact-writer` after merged baseline showed legitimate close operations below this bound |
| Worktree behavior changed and native `EnterWorktree` exists | Applied in `6.0.8`: `worktrees/<name>` maps to host project artifact directory |
| Native plan handling changed after 2.1.75 | Current bridge already keys off explicit paths, content, and recent mtime; do not design logic that depends on random plan filenames |
| Plugin validation catches hook/frontmatter schema issues | Partially applied: local tests cover plugin shape; add `claude plugin validate` to release gate |
| Production tests can rely on agent frontmatter tools in `--print` | Partially applied: production prompt gate exists; should explicitly test installed plugin/agent |

## 2.1.131 Plugin Agent Directory Validation

Official plugin docs define `agents/` as the default discovery location for plugin agents, and `plugin.json.agents` as a custom path list that replaces default agent directory scanning. Therefore, if reference Markdown files live under `agents/references/`, Claude Code is allowed to treat them as agent candidates. This is not currently classified as a Claude Code 2.1.131 bug; it is a PaceFlow packaging/layout mistake.

Applied fix:

- Move non-agent reference files from `agents/references/**` to `agent-references/**`.
- Add `.claude-plugin/plugin.json` `agents: ["./agents/artifact-writer.md"]` so plugin agent discovery is explicit even if future support files are added.
- Keep `${CLAUDE_PLUGIN_ROOT}/agent-references/**` as the runtime path used by the agent prompt and test harness.

Related official-doc opportunities:

- `SubagentStart` can inject context but cannot block subagent creation. This is a good future replacement for some `PreToolUse:Agent` retry friction: inject resolved `artifact_dir` into `artifact-writer` at start, while keeping the current deny rule as a fail-closed guard.
- `SubagentStop` exposes `last_assistant_message` and subagent transcript path. This can become a bounded report-title/status verifier for `artifact-writer`, but must avoid infinite retry loops.
- `TaskCreated` / `TaskUpdated` / `TaskCompleted` are now first-class task hooks. PaceFlow can eventually move Claude task-list sync away from broad `PreToolUse` matching.
- `CwdChanged` can persist refreshed env through `CLAUDE_ENV_FILE`; useful for worktree/vault artifact route refresh, but each hook should still recompute critical paths to avoid stale env after resume/compact.

## P0 / P1 Candidate Improvements

### P0.1 Subagent Identity As First-Class Hook Context

Claude Code hook common input now includes `agent_id` and `agent_type` when running inside a subagent. This is the correct mechanism for differentiating main session edits from `artifact-writer` edits.

Recommended work:

- Keep current `agent_type` allowlist for C/V markers.
- Add tests for unknown agent types attempting `APPROVED` / `VERIFIED`.
- Log `agent_id` and `agent_type` in all marker-related hook logs.
- Extend `parseHookStdin` docs and REFERENCE.

### P0.2 SubagentStart / SubagentStop For Artifact Writer

Claude Code now has lifecycle hooks for subagent start/stop. `SubagentStop` includes `agent_transcript_path` and the subagent's last assistant message.

Potential PaceFlow use:

- Inject minimal artifact-writer context on `SubagentStart`: resolved `ARTIFACT_DIR`, project name, report title contract, and operation reminder.
- Verify `## artifact-writer 报告` in `SubagentStop`, using `last_assistant_message` instead of relying on the main session summary.
- Record subagent transcript path in `.pace/` for postmortem and baseline debugging.
- Add a targeted `SubagentStop` hook for only `artifact-writer`, not all agents.

Risk:

- Stop-style loops can happen if `SubagentStop` blocks and the agent keeps producing invalid output. Use a bounded retry counter similar to `stop-block-count`.

### P0.3 CwdChanged / FileChanged For Artifact Directory Re-resolution

Claude Code now fires `CwdChanged` when the working directory changes and `FileChanged` for watched files. Both can persist environment updates through `CLAUDE_ENV_FILE`.

Potential PaceFlow use:

- Recompute `PACE_PROJECT_NAME`, `PACE_ARTIFACT_DIR`, and worktree host mapping when Claude runs `cd`.
- Watch `.env`, `.envrc`, `.pace/project`, `.pace/disabled`, and possibly `.git` to refresh project routing.
- Replace some current per-hook recomputation with session-scoped env values.
- Prevent the bug class where the main session changes into a worktree but hooks keep stale assumptions.

Risk:

- File watching large artifact files is unnecessary and could become noisy. Watch configuration files only.

### P0.4 WorktreeCreate / WorktreeRemove Integration

Claude Code supports worktree hooks and native `--worktree` / subagent `isolation: "worktree"`. Changelog fixes after 2.1.75 include local HEAD creation, stale cleanup, sparse paths, and loading hooks/skills from worktree.

Potential PaceFlow use:

- Add `WorktreeCreate` hook to write `.pace/worktree-host` or `.pace/project-name` into worktrees.
- Copy `.pace/.gitignore` and optional environment bootstrap into worktrees.
- Use `worktree.sparsePaths` guidance for large monorepos.
- Add `WorktreeRemove` hook to check for unarchived local artifacts before cleanup.

Risk:

- A `WorktreeCreate` hook replaces default git behavior entirely, so do not add it until tested. A lighter CwdChanged/FileChanged solution may be enough.

### P1.1 PreToolUse `updatedInput`

`PreToolUse` can rewrite tool input before execution. It can also combine rewrite with `permissionDecision: "allow"` or `"ask"`.

Potential PaceFlow use:

- Redirect writes from CWD artifact files to vault `ARTIFACT_DIR` without a deny/retry loop.
- Normalize CRLF-sensitive artifact content before Write/Edit.
- Auto-answer controlled `AskUserQuestion` only in non-interactive test harnesses.

Risk:

- `updatedInput` replaces the entire tool input object. Every rewrite must preserve unchanged fields.
- For human approval, avoid silently answering user-facing questions in production sessions.

### P1.2 PreToolUse `defer` For Headless Approval

`permissionDecision: "defer"` is available for non-interactive `claude -p` flows. It exits with `stop_reason: "tool_deferred"` and preserves the pending tool call for resume.

Potential PaceFlow use:

- Production baseline can defer `AskUserQuestion`, collect a deterministic fixture answer, then resume with `updatedInput`.
- CI can test approve/verify paths without manual dialog hacks.

Risk:

- Only works in non-interactive mode and only for single tool-call turns. Do not rely on it in normal Claude Code sessions.

### P1.3 PostToolUseFailure

`PostToolUseFailure` fires after failed tool execution and receives `error`, `is_interrupt`, and `duration_ms`.

Potential PaceFlow use:

- When Write/Edit fails on artifacts, inject a precise recovery message: use `artifact-writer`, check vault path, avoid Bash overwrite.
- When Bash test fails, tell the model to record failure in walkthrough or keep CHG in-progress.
- Distinguish user interrupt from actual tool failure.

Risk:

- Do not duplicate Stop hook completion checks. Keep this focused on immediate failed tool recovery.

### P1.4 PostToolBatch

`PostToolBatch` runs once after a batch of parallel tool calls. PostToolUse runs once per tool and may run concurrently.

Potential PaceFlow use:

- Collapse multiple file-change reminders into one.
- Detect multiple artifact mutations in the same batch and run a single consistency check.
- Avoid race-prone `.pace/` flag writes from parallel PostToolUse invocations.

Risk:

- Requires new parser for `tool_calls`; keep it read-only at first.

### P1.5 PostToolUse `updatedToolOutput`

`PostToolUse` can replace what Claude sees from a tool result. This now works for all tools, not just MCP.

Potential PaceFlow use:

- Trim huge test output while preserving summary + failure lines.
- Redact sensitive vault paths or environment values before they enter model context.
- Convert noisy hook/tool output into a small structured result.

Risk:

- Hiding too much output can make the model proceed on false assumptions. Only use for high-volume successful outputs or well-defined redaction.

### P1.6 Component-Scoped Hooks In Skills / Agents

Hooks can now be defined in skill and agent frontmatter, scoped to the component lifecycle.

Potential PaceFlow use:

- Put artifact-writer-specific report/marker guardrails in the agent itself.
- Add audit skill hooks that only run during `/audit`.
- Reduce global hook complexity.

Risk:

- Global invariants still need global hooks. Component hooks should enforce component-specific behavior only.

### P1.7 Plugin UserConfig And Persistent Data

Changelog introduced plugin options (`manifest.userConfig`) exposed externally, sensitive fields, and `${CLAUDE_PLUGIN_DATA}` persistent storage.

Potential PaceFlow use:

- Replace raw `PACE_VAULT_PATH` env dependency with plugin userConfig: `vaultPath`, `projectNameOverride`, `enableAgentBaseline`, `strictReportTitle`.
- Store plugin runtime metadata under `${CLAUDE_PLUGIN_DATA}` instead of ad hoc locations when data should survive plugin updates.

Risk:

- Do not move project-specific `.pace/` state into plugin data; `.pace/` remains the correct per-project session/runtime state.

### P1.8 Release Gate With `claude plugin validate`

`claude plugin validate` now checks skill, agent, command frontmatter and `hooks/hooks.json`.

Potential PaceFlow use:

- Add release command:

```bash
claude plugin validate .
```

- Make it part of production release gate next to unit tests and agent fixture tests.

Risk:

- Requires current Claude Code installed in CI/local validation. Keep a fallback JSON/frontmatter lint for environments without Claude Code.

### P1.9 Skill / Agent Frontmatter Updates

Relevant changelog items:

- Plugin agents support `effort`, `maxTurns`, and `disallowedTools`.
- Skills and slash commands support `effort`.
- Skills can reference `${CLAUDE_EFFORT}`.
- Rules and skills `paths:` accepts YAML list of globs.
- Agents can declare `initialPrompt`.
- `--print` honors an agent definition's `tools` and `disallowedTools`.
- `skillOverrides` can hide skills from model or slash menu.

Potential PaceFlow use:

- Set `maxTurns` for `artifact-writer` after production baseline shows stable upper bound.
- Consider `disallowedTools` if artifact-writer should never call high-risk tools.
- Use `${CLAUDE_EFFORT}` in skills to align guidance with main session effort.
- Add `paths:` to skills so they are activated in relevant artifact paths only.
- Document `skillOverrides` recommendation for users who want fewer proactive skills.

Risk:

- `maxTurns` too low can fail legitimate archive operations. Treat as P2 until measured.

### P1.10 Headless / Production Baseline Improvements

Relevant changelog items:

- `--print` honors agent tools/disallowedTools.
- `CLAUDE_CODE_FORK_SUBAGENT=1` works in non-interactive sessions.
- Deferred tools support `claude -p --resume`.
- `--output-format stream-json` exposes plugin load failures.
- `--bare` skips hooks, LSP, plugin sync, and skill walks.

Potential PaceFlow use:

- Production gate should assert plugin load errors are absent in stream-json init.
- Do not use `--bare` for PaceFlow hook/plugin tests.
- Use forked subagent mode in CI to approximate production subagent behavior.
- Capture `deferred_tool_use` when testing approval flows.

Risk:

- CLI behavior varies across auth modes and providers; keep fixtures hermetic.

### P1.11 Telemetry And Resource Metrics

Relevant changelog items:

- PostToolUse/PostToolUseFailure include `duration_ms`.
- OTel tool events include `tool_use_id`, input size, and skill activation trigger.
- Status line stdin includes `effort.level` and thinking status.
- PR count metric includes MCP-created PRs.

Potential PaceFlow use:

- Add duration metrics to `.pace/` hook logs for slow operations.
- Correlate hook deny/pass events by `tool_use_id`.
- Track artifact-writer invocation trigger and effort level in baseline reports.
- Mark resource budgets as warnings for production prompt tests, hard gates only for structural invariants.

Risk:

- OTel may be disabled by users; do not make telemetry required for correctness.

## Security / Policy Updates To Consider

| Version | Change | PaceFlow assessment |
|---|---|---|
| 2.1.77 | PreToolUse `"allow"` no longer bypasses deny permission rules | Good. PaceFlow should continue using deny for hard invariants; allow cannot override admin deny |
| 2.1.78 | Sandbox absolute write allow paths fixed; missing sandbox dependencies visibly warn | Add sandbox path tests if PaceFlow documents sandbox use |
| 2.1.83 | `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from subprocesses | Ensure `PACE_VAULT_PATH` and project name still reach hooks when users enable scrubbing |
| 2.1.83 | managed-settings drop-in directory | ConfigGuard should tolerate policy fragments and not assume only one managed-settings file |
| 2.1.126 | managed sandbox blocks fixed | Re-check ConfigGuard assumptions under enterprise managed settings |
| 2.1.129 | `deniedMcpServers` scheme wildcard fix | Low impact unless PaceFlow adds MCP integration |

## Worktree-Related Updates

| Version | Change | PaceFlow implication |
|---|---|---|
| 2.1.76 | `worktree.sparsePaths`; improved `--worktree` startup; stale cleanup | Document recommended worktree testing path and sparse checkout option |
| 2.1.78 | `--worktree` loads skills/hooks from worktree directory | Validate plugin-in-worktree behavior; this can change which version of hooks runs |
| 2.1.83 | fixed `--worktree` names with slash; background subagent/worktree cleanup fixes | Keep worktree path parser robust; do not rely on slash names |
| 2.1.119 | Agent `isolation: "worktree"` stale worktree reuse fixed; PR link in git worktree fixed | Production tests should include native isolated agent path |
| 2.1.128 | `EnterWorktree` creates from local HEAD, not origin default branch | Important for local unpushed PaceFlow testing |

## Hook Feature Inventory From Official Docs

| Hook feature | Use in PaceFlow |
|---|---|
| Common `agent_id` / `agent_type` | Authorize artifact-writer stage marker writes |
| PreToolUse `permissionDecision` | Already central to PACE flow |
| PreToolUse `updatedInput` | Candidate for vault path redirects and test AskUserQuestion answers |
| PreToolUse `defer` | Candidate for headless approval test harness |
| PermissionRequest `updatedPermissions` | Candidate for safer "allow once / local" workflows; avoid for core PACE invariants |
| PostToolUse `duration_ms` | Add metrics to hook logs |
| PostToolUse `updatedToolOutput` | Candidate for redaction/trimming |
| PostToolUseFailure | Add corrective context after failed tool calls |
| PostToolBatch | Single consistency pass after parallel tools |
| SubagentStart / SubagentStop | Inject artifact context and validate agent report format |
| ConfigChange | Already has config guard; update parser for source/file_path |
| CwdChanged / FileChanged | Recompute project/artifact routing and watch env/config |
| WorktreeCreate / WorktreeRemove | Optional P2 because they replace default worktree behavior |
| Elicitation / ElicitationResult | Useful only if PaceFlow adds MCP approval forms |
| Prompt/agent hooks | Optional audit/verifier, not for core deterministic invariants |
| Hooks in skills/agents | Move component-specific checks out of global hooks |
| `/hooks` menu | Add to troubleshooting docs |

## Task Tool Revalidation

Revalidated on 2026-05-06 against the current official tools reference and changelog.

Current official tool status:

- `TodoWrite` still exists, but official docs now scope it to non-interactive mode and Agent SDK.
- Interactive Claude Code sessions use `TaskCreate`, `TaskGet`, `TaskList`, and `TaskUpdate` instead.
- `TaskCreated` is a hook event for the `TaskCreate` tool; it is not the same thing as PaceFlow's markdown task checklist.
- Changelog still contains `TaskCreate` / `TaskUpdate` changes, including task deletion through `TaskUpdate`; it does not say task tools were removed.

PaceFlow implication:

- Keep `PreToolUse` matcher `TodoWrite|TaskCreate|TaskUpdate`, because PaceFlow needs both non-interactive/SDK and interactive Claude Code paths.
- Stop describing this as "TodoWrite sync" in user-visible guidance. The correct user-facing concept is "Claude task list sync".
- Keep the legacy `.pace/todowrite-used` runtime filename unless there is a separate migration reason; it is an internal flag, not a public contract.
- Do not use `TaskCreated` as a direct replacement for `PreToolUse:TaskCreate`. It can become a supplemental hook after minimal stdin/behavior testing.

## Version-by-Version Relevant Notes

This section records the relevant items found in changelog versions after `2.1.75`. UI-only, voice-only, auth-only, and unrelated provider fixes were reviewed but excluded unless they affect PaceFlow hooks, plugins, skills, agents, permissions, worktrees, test automation, or resource control.

### 2.1.129

- `--plugin-url <url>` can load a plugin zip for the current session.
- Plugin manifest `themes` and `monitors` should move under `experimental`.
- `skillOverrides` works; can hide or collapse skills.
- Fixed in-project `Bash(mkdir *)` / `Bash(touch *)` allow rules.
- Fixed agent panel visibility while subagents run.
- Fixed `/context` wasting tokens by dumping ASCII visualization into conversation.

### 2.1.128

- `--plugin-dir` accepts zip plugin archives.
- SDK hosts receive `localSettings` suggestion for Bash permission prompts.
- `EnterWorktree` creates from local HEAD.
- Parallel read-only shell failures no longer cancel sibling calls.
- Fixed sub-agent progress summary cache and repeated-summary token waste.
- stream-json init includes plugin directory load failures.

### 2.1.126

- `/model` can discover gateway models when enabled.
- `claude project purge` can clear project state.
- Skill activation OTel includes trigger type.
- PowerShell is primary shell on Windows when enabled.
- Deferred tools are available to forked skills/subagents on first turn.
- Bounded file-modified reminders when linters touch many files.
- Agent SDK hang fixed for malformed tool names in parallel batches.

### 2.1.122

- OTel numeric attributes fixed; `at_mention` event added.
- Effort option fixed for Bedrock inference profile ARNs.
- Malformed hooks entry no longer invalidates the entire settings file.

### 2.1.121

- `alwaysLoad` MCP option.
- `claude plugin prune`.
- PostToolUse `updatedToolOutput` works for all tools.
- `CLAUDE_CODE_FORK_SUBAGENT=1` works in non-interactive sessions.
- Plugin/agent/skill paths can be edited under skip-permissions without prompts.
- OTel request spans include stop reason and finish reasons.
- Resume skips corrupt transcript lines.
- Invalid legacy enum values no longer invalidate whole settings.
- Embedded grep/find/rg wrappers fall back to installed tools if binary deleted.

### 2.1.120

- PowerShell fallback on Windows without Git Bash.
- `claude ultrareview` CI command.
- Skills can reference `${CLAUDE_EFFORT}`.
- `AI_AGENT` env var set for subprocesses.
- `claude plugin validate` accepts schema/version/description in plugin/marketplace manifests.
- Auto-compact display fixed.
- Telemetry disable flags fixed for usage metrics.
- Plugin marketplace resilient to unrecognized source formats.

### 2.1.119

- `/config` persists settings with precedence.
- `--print` honors agent tools/disallowedTools.
- `--agent` honors agent permissionMode.
- PowerShell auto-approval parity with Bash.
- PostToolUse/PostToolUseFailure include `duration_ms`.
- Subagent/SDK MCP reconfiguration is parallel.
- Tool events include `tool_use_id` and input size.
- Status line stdin includes effort and thinking state.
- ToolSearch disabled by default on Vertex.
- Skills invoked before auto-compaction no longer re-execute against next user message.
- Agent worktree isolation no longer reuses stale worktrees.
- PR linked correctly in git worktree.

### 2.1.118

- Hooks can invoke MCP tools directly via `type: "mcp_tool"`.
- Plugin can tag releases.
- `/resume` / `--continue` find sessions that added current directory via `/add-dir`.
- Gateway model picker honors custom model labels.
- MCP tool-call and auth fixes.

### 2.1.117 / 2.1.116 / 2.1.113 / 2.1.111 / 2.1.110

- Multiple plugin, MCP, permissions, and session-resume fixes.
- Relevant action: keep production tests on current Claude Code, not 2.1.75, because plugin and MCP behavior changed repeatedly.

### 2.1.108

- `ENABLE_PROMPT_CACHING_1H` and `FORCE_PROMPT_CACHING_5M`.
- `/recap` feature.
- Model can invoke built-in slash commands via Skill tool.
- Stale worktree cleanup improved.
- `--plugin-dir` changed to one path per flag.

### 2.1.105 / 2.1.101 / 2.1.98 / 2.1.97

- Large sets of plugin, MCP, permissions, transcript, resume, and fullscreen fixes.
- Relevant action: production baseline should capture plugin load errors and transcript/subagent behavior, not just file outputs.

### 2.1.94 / 2.1.92 / 2.1.91 / 2.1.90 / 2.1.89

- Fullscreen renderer and hook output features stabilized.
- PreToolUse `defer` requires 2.1.89 or later.

### 2.1.86 / 2.1.85 / 2.1.84

- PowerShell tool preview and related shell behavior.
- `TaskCreated` hook.
- `WorktreeCreate` HTTP support.
- `allowedChannelPlugins`.
- Rules/skills `paths:` accepts YAML list.
- MCP descriptions capped to reduce context bloat.
- Prompt cache improvements.

### 2.1.83

- `managed-settings.d/`.
- `CwdChanged` and `FileChanged`.
- `sandbox.failIfUnavailable`.
- `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`.
- Agents can declare `initialPrompt`.
- Fixed background subagent invisibility after compaction.
- Fixed uninstalled plugin hooks firing until next session.
- Improved plugin startup from disk cache.
- Deprecated `TaskOutput`; use `Read` on background output file path.
- Plugin `manifest.userConfig` is externally available with sensitive storage.
- Fixed `--worktree` slash-name hang.

### 2.1.81

- `--bare` skips hooks/plugin/skills; must not be used for PaceFlow validation.
- `--channels` permission relay.
- Resuming a worktree session switches back to that worktree.
- Plugin freshness improvements.
- Plan mode clear-context hidden by default.

### 2.1.80

- Inline plugin marketplace source in settings.
- Plugin tips detect CLI usage.
- `effort` frontmatter for skills and slash commands.
- `--channels` research preview.
- Parallel tool results restored on resume.
- Simplified plugin install tips.

### 2.1.79

- `SessionEnd` hooks now fire on interactive `/resume` session switching.
- `CLAUDE_CODE_PLUGIN_SEED_DIR` supports multiple seed dirs.

### 2.1.78

- `StopFailure` hook.
- `${CLAUDE_PLUGIN_DATA}` for plugin persistent state.
- Plugin agents support `effort`, `maxTurns`, `disallowedTools`.
- Sandbox and protected directory permission fixes.
- `--worktree` loads skills/hooks from worktree directory.
- Custom model picker option env vars.

### 2.1.77

- Larger model output limits.
- `allowRead` sandbox setting.
- PreToolUse `"allow"` no longer bypasses deny permission rules.
- Write line ending conversion fixed.
- `claude plugin validate` checks skill/agent/command frontmatter and `hooks/hooks.json`.
- Sessions are auto-named from accepted plan content; VS Code plan preview titles use the plan heading.
- Agent tool `resume` removed; use `SendMessage`.
- `/fork` renamed to `/branch`.

### 2.1.76

- MCP elicitation and `Elicitation` / `ElicitationResult` hooks.
- `worktree.sparsePaths`.
- `PostCompact` hook.
- `/effort`.
- Auto-compaction circuit breaker.
- Improved background agent behavior preserves partial results.
- Improved stale worktree cleanup.

## Recommended Next Work Items

| Priority | Task | Why |
|---|---|---|
| P0 | Add `SubagentStop` report-title verifier for `artifact-writer` | Catches real production prompt drift without over-prompting |
| P0 | Add release gate command for `claude plugin validate .` | Uses modern Claude Code schema checks |
| P0 | Add CwdChanged/FileChanged design for project/artifact routing | Prevents cwd/worktree/vault drift |
| P1 | Add PostToolUseFailure hook | Better recovery after failed Write/Edit/Bash |
| P1 | Add PostToolBatch hook as read-only consistency observer | Reduces duplicate reminders under parallel tool calls |
| P1 | Evaluate PreToolUse `updatedInput` vault redirection | Can remove deny/retry loops for wrong artifact path |
| P1 | Add plugin userConfig design for `vaultPath` and project override | Reduces env-var fragility |
| P1 | Add production test for native plan bridge using current Claude Code plan naming | Verifies PaceFlow no longer assumes random plan filenames or stale fork-shared plan files |
| P1 | Add production baseline checks for stream-json plugin load errors | Catches install/runtime mismatch earlier |
| P2 | Evaluate component-scoped hooks in `artifact-writer` | Can shrink global hook complexity |
| P2 | Evaluate `updatedToolOutput` for redaction/trimming | Useful but risky if it hides needed details |

## Obsidian Report Cross-Check

Cross-checked against the user's Obsidian note:

`/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/knowledge/claude-code-2.1.75plus-paceflow-improvements.md`

Useful additions from that note that should be tracked:

| Candidate | Assessment |
|---|---|
| Hook `if` filters | Valid performance candidate. Use only to reduce obviously irrelevant hook spawns. Do not rely on it to detect PACE projects, because `if` cannot know vault/project state |
| PreCompact can block compaction | Valid, but should be P1/P2 and bounded. Blocking compaction can trap the user in a large session; prefer snapshot + warning unless a hard invariant is at risk |
| `PermissionDenied` hook | Worth evaluating for auto-mode recovery and logging. It is not a replacement for PaceFlow's deterministic PreToolUse deny rules |
| Hook output over 50K saved to disk | Add a SessionStart output-size check. PaceFlow should emit a compact summary and explicit file paths rather than relying on huge injected context |
| `hookSpecificOutput.sessionTitle` | Useful P2 status polish: session title can include project/current CHG |
| Plugin `bin/` | Useful P2 packaging option for future `paceflow validate`, `paceflow migrate`, or fixture runners |
| Absolute `file_path` in Write/Edit/Read hook input | Add regression tests that path matching works for both absolute and relative input shapes |
| `cleanupPeriodDays: 0` rejected | Search docs/examples and remove any recommendation to use `0` as "disable cleanup" |

Corrections to the Obsidian note:

| Claim | Correction |
|---|---|
| "2.1.75 to 2.1.129 equals 55 versions" | Numeric patch range is 55, but official changelog contains 40 released version headings in this interval |
| PaceFlow baseline/current is `6.0.7` | Current local work is past that; marker/subagent fix is `6.0.9` |
| Hook `if` can make non-PACE projects zero overhead | Not fully true. It can filter by tool/arguments, but cannot inspect `isPaceProject()` without running code |
| Example `if` only matches code extensions | Unsafe for PaceFlow if applied globally; PaceFlow must still guard artifact files, walkthrough/findings/corrections, and native plan bridge files |
| `updatedToolOutput` makes reminders "必定可见" and therefore reliable | It changes what Claude sees, but the model can still ignore content. Keep deterministic invariants in PreToolUse/Stop |
| `--bare` needs hook-side detection | Official behavior says `--bare` skips hooks/plugins/skills. PaceFlow tests should avoid `--bare`; hook-side detection is not a priority |
| `TaskCreated` can directly sync markdown task.md | It refers to Claude Code task creation, not PaceFlow markdown checklist semantics. Treat as experimental, not active sync |
| `skillOverrides` should hide core skills by default | Good user-level tuning, but risky as plugin default. Hiding skills may reduce workflow discovery and model self-correction |
| `--dangerously-skip-permissions` should reduce artifact prompts | Do not recommend this as PaceFlow guidance. It weakens safety posture and is unrelated to deterministic artifact validation |

Priority adjustment after cross-check:

1. Keep `agent_id` / `agent_type` and `SubagentStop` as P0 because they address the actual v6 agent/hook boundary.
2. Promote hook `if`, PreCompact block, PermissionDenied, and 50K SessionStart output checks into the evaluation backlog.
3. Keep `updatedToolOutput`, `TaskCreated`, `sessionTitle`, plugin `bin/`, and `skillOverrides` as optional or user-configurable improvements.

## Findings.md Cross-Check

Cross-checked against the long PaceFlow finding file:

`/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/findings.md`

Relevant entries:

- `[2026-05-02] CC v2.1.91->v2.1.126 full change evaluation`
- `[2026-04-02] CC v2.1.76->v2.1.90 evaluation`
- Earlier hook behavior notes around Task hooks, compact hooks, stdin parsing, and agent/team compatibility

Status updates after comparing those findings with current v6 code:

| Finding item | Current status |
|---|---|
| Check whether PaceFlow uses `PreCompact` or `PostCompact` | Resolved. `hooks/hooks.json` currently registers `PreCompact`, and `hooks/pre-compact.js` snapshots before compaction |
| Evaluate PreCompact block ability | Still open. Current hook snapshots only; it does not block. Treat as bounded P1/P2 policy work, not an event migration |
| Add skill `effort` frontmatter | Resolved. All 5 skills declare `effort`; `artifact-writer` declares `effort: max` |
| Keep `TodoWrite|TaskCreate|TaskUpdate` matcher | Revalidated. `TodoWrite` covers non-interactive/SDK; `TaskCreate|TaskUpdate` cover interactive sessions |
| Absolute `file_path` handling | Mostly resolved by `parseHookStdin` path normalization. Add regression tests for absolute/relative and slash/backslash variants |
| Hook output over 50K saved to disk | Still open. Add SessionStart output-size tests and keep injected context compact |
| `${CLAUDE_EFFORT}` in skill bodies | Useful but not implemented. Add as P1/P2 wording improvement, not core correctness |
| Plugin skill frontmatter hooks | Technically available after the upstream fix, but optional. Keep global deterministic hooks for global invariants |
| `updatedToolOutput` as silent fix | Rejected as a core strategy. It can trim/redact/annotate output, but should not silently mutate artifacts or hide tool truth |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | Still worth a compatibility test for `PACE_VAULT_PATH`, `CLAUDE_PROJECT_DIR`, and plugin root/env availability |
| FileChanged outside CWD | Still unverified. Important if vault artifact files live outside repo CWD |
| stdin fail-open risk | Historical finding remains important. Current parser tests exist, but hook entry behavior should continue to fail closed for malformed stdin on enforcement paths |

Additional backlog items derived from findings:

| Priority | Task | Why |
|---|---|---|
| P1 | Add PreCompact block policy design | Current PreCompact only snapshots; decide when blocking compact is justified |
| P1 | Add SessionStart output-size guard/test | Prevent silent loss when hook output is persisted instead of injected |
| P1 | Add absolute/relative `file_path` regression cases | Protect Write/Edit/Read path logic across Claude Code versions |
| P1 | Test `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` | Ensure vault/project/plugin env still reaches hooks |
| P1 | Evaluate `${CLAUDE_EFFORT}` in `pace-workflow` and `audit` | Align workflow guidance with current thinking budget |
| P2 | Verify `FileChanged` can watch vault paths outside CWD | Needed before using it for artifact-directory re-resolution |
| P2 | Evaluate hook `if` filters only for cheap event narrowing | Do not encode project semantics in hook config |
