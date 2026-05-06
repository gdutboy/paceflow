# Claude Code 2.1.76-2.1.131 Validation Report

> Date: 2026-05-06
> Local CLI: Claude Code 2.1.128
> Official changelog latest checked: 2.1.131
> Scope: Validate the PaceFlow evaluation document item by item, then screen GitHub issues for current blocking risks.

## Sources

- Official changelog: <https://code.claude.com/docs/en/changelog>
- Official hooks reference: <https://code.claude.com/docs/en/hooks>
- Official tools reference: <https://code.claude.com/docs/en/tools-reference>
- GitHub issues: <https://github.com/anthropics/claude-code/issues>

Collection commands used locally:

```bash
gh api repos/anthropics/claude-code/contents/CHANGELOG.md --jq .content | base64 -d > /tmp/claude-code-changelog-current.md
gh issue list -R anthropics/claude-code --state open --limit 100 --json number,title,url,labels,createdAt,updatedAt,comments
gh search issues --repo anthropics/claude-code --state open hooks --limit 50
gh search issues --repo anthropics/claude-code --state open plugin --limit 50
gh search issues --repo anthropics/claude-code --state open worktree --limit 50
gh search issues --repo anthropics/claude-code --state open PreToolUse --limit 30
gh search issues --repo anthropics/claude-code --state open SubagentStop --limit 30
gh search issues --repo anthropics/claude-code --state open FileChanged --limit 30
gh search issues --repo anthropics/claude-code --state open CwdChanged --limit 30
```

## Validation Matrix

| Item | Evidence | PaceFlow status | Decision |
|---|---|---|---|
| `agent_id` / `agent_type` in hook stdin | Official changelog + hooks docs; local parser handles fields | Implemented in `6.0.9` | Keep P0. Added regression: unknown subagent still denied for stage markers |
| `artifact-writer` can write `APPROVED` / `VERIFIED` | `tests/test-hooks-e2e.js` passes for `artifact-writer` and `paceflow:artifact-writer` | Implemented | Keep allowlist narrow |
| `SubagentStart` / `SubagentStop` | Official docs list both events; GitHub has open behavior/docs bugs | Not implemented | Downgrade from immediate P0 implementation to P0 PoC first |
| `last_assistant_message` in `SubagentStop` | Official changelog says Stop/SubagentStop include it | Not implemented | Use for report-title verifier only after local production PoC |
| `CwdChanged` / `FileChanged` | Official docs confirm; GitHub has env-cache and watcher risks | Not implemented | `CwdChanged` remains useful; `FileChanged` must be limited to config files |
| Worktree hooks and native worktree isolation | Official docs/changelog confirm; GitHub shows multiple data-loss/isolation bugs | PaceFlow has manual worktree artifact routing fix in `6.0.8` | Do not depend on native `EnterWorktree` / `isolation: "worktree"` yet |
| `PreToolUse.updatedInput` | Official docs/changelog confirm; GitHub reports failures with multiple hooks and Agent tool | Not implemented | Keep as PoC-only; do not use for core artifact redirects yet |
| `permissionDecision: "defer"` | Official docs/changelog confirm | Not implemented | Headless test-harness candidate only |
| `PostToolUseFailure` | Official hooks docs confirm | Not implemented | P1 candidate for failed Write/Edit/Bash recovery |
| `PostToolBatch` | Official hooks docs confirm | Not implemented | P1 read-only observer candidate; avoid writes first |
| `updatedToolOutput` for all tools | Official changelog confirms | Not implemented | Use only for trimming/redaction/annotation, not silent artifact mutation |
| Component-scoped hooks in skills/agents | Official hooks docs describe scoped hooks | Not implemented | Optional. Keep global deterministic invariants global |
| Plugin `userConfig` / `${CLAUDE_PLUGIN_DATA}` | Official changelog confirms | Not implemented | Good P1 config work; do not move per-project `.pace/` state |
| `claude plugin validate .` | Local command passes with marketplace description warning | Partially adopted | Add to release gate; warning is non-blocking |
| Skill/agent frontmatter `effort`, `color` | Local files and plugin validate confirm | Implemented | Done |
| `${CLAUDE_EFFORT}` in skill body | Official changelog confirms | Not implemented | P1/P2 wording improvement for `pace-workflow` and `audit` |
| `TaskCreate` / `TaskUpdate` / `TodoWrite` tool split | Official tools reference confirms `TodoWrite` is non-interactive/SDK; interactive uses Task tools | Implemented in `6.0.10` | Keep triple matcher; user-facing text says "Claude task list" |
| `TaskCreated` hook | Official docs/changelog confirm | Not implemented | Do not replace `PreToolUse:TaskCreate`; optional supplement after stdin PoC |
| Absolute `file_path` | Official changelog confirms; parser normalizes paths | Implemented | Added relative and POSIX absolute parser regressions |
| Hook `if` filters | Official changelog confirms; GitHub reports pattern edge cases | Not implemented | Use only for cheap tool narrowing, not project semantics |
| PreCompact block | Official changelog confirms block support | Current hook snapshots only | Design bounded policy before enabling block |
| Hook output over 50K saved to disk | Official changelog confirms | Not tested | Add SessionStart output-size guard/test |
| `cleanupPeriodDays: 0` rejection | Official changelog confirms | No active recommendation found in tracked main docs | Keep as doc lint item |
| `--bare` skips hooks/plugins/skills | Official changelog/docs confirm | Test guidance only | Never use `--bare` for PaceFlow validation |

## GitHub Risk Scan

Severity is assessed for PaceFlow users, not for Claude Code globally.

| Severity | Issue | Impact on PaceFlow | Recommendation |
|---|---|---|---|
| Critical | [#56349 Worktree exit prompt bypasses PreToolUse hooks and can delete worktrees](https://github.com/anthropics/claude-code/issues/56349) | Native worktree lifecycle can bypass hook protections | Do not rely on PreToolUse to block `ExitWorktree`; avoid native cleanup prompts for protected worktrees |
| Critical | [#56603 PowerShell/cmd quoting can cause catastrophic deletion](https://github.com/anthropics/claude-code/issues/56603) | Windows users using PowerShell tool for destructive cleanup are exposed | PaceFlow should not recommend `cmd /c rd /s /q`; avoid destructive cleanup through PowerShell, especially paths with spaces/Unicode |
| High | [#56595 2.1.129 Bedrock sends unsupported beta flags](https://github.com/anthropics/claude-code/issues/56595) | Bedrock users may fail every request on 2.1.129 | Bedrock users should pin/verify 2.1.128 or another known-good version until fixed |
| High | [#56593](https://github.com/anthropics/claude-code/issues/56593) / [#56191](https://github.com/anthropics/claude-code/issues/56191) Windows Bash `session-env` EEXIST after compaction | Can break Bash/hook-adjacent flows after compact/resume | If hit, restart session; avoid assuming `CLAUDE_ENV_FILE` is stable after compaction on Windows |
| High | [#56400 stale env vars after `/resume`](https://github.com/anthropics/claude-code/issues/56400) | Any future CwdChanged/SessionStart env cache strategy can go stale on resume | Do not make env-file values sole authority; recompute critical artifact routing in each hook |
| High | [#56147 Bash CWD drifts into worktree](https://github.com/anthropics/claude-code/issues/56147) | Wrong-target git writes are possible in worktree-heavy workflows | PaceFlow's artifact routing fix helps artifacts only; keep git commands explicit (`pwd`, `git status`, `git -C`) |
| High | [#55724 parallel worktree agents lose work](https://github.com/anthropics/claude-code/issues/55724), [#55708](https://github.com/anthropics/claude-code/issues/55708), [#56137](https://github.com/anthropics/claude-code/issues/56137) | Native `isolation: "worktree"` is not reliable enough for PaceFlow-critical work | Do not build P0 flows on native isolated agent worktrees yet |
| Medium | [#44482 Windows PreToolUse JSON/permission bugs](https://github.com/anthropics/claude-code/issues/44482) | Shell hooks that pipe stdin through `echo` can fail open; pre-approved permissions may bypass hooks in some Windows cases | PaceFlow uses Node stdin parsing, which avoids the `echo` bug; still test installed Windows plugin before release |
| Medium | [#42702 multiple hooks same tool stdin contention](https://github.com/anthropics/claude-code/issues/42702) | Multiple matching hooks on same tool can be unreliable | PaceFlow currently has one Write/Edit PreToolUse hook; avoid adding parallel Write/Edit hooks |
| Medium | [#34692](https://github.com/anthropics/claude-code/issues/34692), [#21460](https://github.com/anthropics/claude-code/issues/21460), [#44534](https://github.com/anthropics/claude-code/issues/44534) subagent hook enforcement reports | Some environments report subagent tool calls bypassing hooks | Local PaceFlow tests cover stdin behavior; production smoke tests remain required after plugin install |
| Medium | [#55889 Bash matcher context injection dropped](https://github.com/anthropics/claude-code/issues/55889) | Bash matcher additionalContext may be unreliable in affected versions | PaceFlow does not rely on Bash matcher for core enforcement |
| Medium | [#56623 `/plugin` unavailable in Desktop Mac](https://github.com/anthropics/claude-code/issues/56623) | Desktop `/plugin` install path may fail for some users | PaceFlow release should document CLI `/plugin install` as primary path |
| Low | [#41943 `/reload-plugins` crash with marketplace `hooks` string](https://github.com/anthropics/claude-code/issues/41943) | Only relevant if marketplace manifest directly declares `hooks` as a string | PaceFlow marketplace manifest does not do this |

## Local Changes Made During Validation

- Added `tests/test-hooks-e2e.js` coverage that unknown subagents cannot write `APPROVED` / `VERIFIED`.
- Added `tests/test-pace-utils.js` coverage for relative and POSIX absolute `file_path` parsing.
- Earlier in the same validation sequence, updated task-list wording and tests for `TaskCreate` / `TaskUpdate` / `TodoWrite` split.

## Current Decisions

1. Keep the `agent_type` allowlist and stage-marker guard as current P0 behavior.
2. Do not implement native worktree hook flows yet; keep PaceFlow's manual/vault artifact routing.
3. Do not use `updatedInput` or `updatedToolOutput` for core artifact mutation until isolated PoCs pass on the installed Claude Code version.
4. Treat `SubagentStop` report validation as the next best PoC, but include loop prevention from the first patch.
5. Treat `CwdChanged` as useful but never make env-file state authoritative because of `/resume` cache issues.

## Verification Commands

```bash
node tests/test-hooks-e2e.js
node tests/test-pace-utils.js
node tests/test-install.js
claude plugin validate .
git diff --check
```
