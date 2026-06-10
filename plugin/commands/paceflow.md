---
description: 启用 / 禁用 / 查询 PACEflow 在本项目的激活状态
argument-hint: enable | disable | status
allowed-tools: Bash, AskUserQuestion, Read
---

# /paceflow

用户运行了 `/paceflow $ARGUMENTS`。根据参数管理 PACEflow 在当前项目的激活状态。helper 脚本位于 `${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js`。

## 按 `$ARGUMENTS` 分派

- `enable` → 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --enable --cwd "<当前项目 cwd 绝对路径>"`
  - 若 helper 输出「已启用（首次）」或「已启用（manual 标记）」并给出 set-artifact-root 命令：用 AskUserQuestion 让用户选「Obsidian vault project」或「本地项目目录」（至少两个选项），再按用户选择运行 helper 输出里给出的对应 `set-artifact-root.js --choice local|vault` 命令（输出说明已配置过则跳过）。
  - 若 helper 输出「恢复既有项目」：无需选 root，按提示调用 `Skill(paceflow:pace-workflow)` 继续。
- `disable` → 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --disable --cwd "<当前项目 cwd 绝对路径>"`。向用户确认 PACEflow 已禁用、artifact 未被删除、随时可 `/paceflow enable` 恢复。
- `status`（或参数为空）→ 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --status --cwd "<当前项目 cwd 绝对路径>"`，把状态原样转述给用户。
- 其他参数 → 运行 `--status` 并提示有效参数为 `enable` / `disable` / `status`。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移把状态写错 runtime）。
- helper 是唯一写入路径；不要手写 `.pace/disabled` 或 `.pace-enabled`，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
- **disable 是用户退出权，不是 AI 绕过门控的手段（spec §5.1 不变量 2）**：本 command 由用户主动运行（用户已表达意图），直接执行即可。但在**其他场景**你（AI）被 PACE deny 拦住时，**不得为绕过单次 deny 自行运行 `set-activation --disable`**——正确做法是走 PACE 流程（建 CHG / approve-and-start）。只有用户**明确表达「不想用 PACEflow」**时才停用；若判断用户可能想停用但用户没明说，先用 AskUserQuestion 确认，不自作主张。
