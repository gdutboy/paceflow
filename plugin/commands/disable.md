---
description: 在当前项目停用 PACEflow（不删除任何 artifact，随时可恢复）
allowed-tools: Bash, AskUserQuestion, Read
---

# /paceflow:disable

用户运行了 `/paceflow:disable`。运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --disable --cwd "<当前项目 cwd 绝对路径>"`。向用户确认 PACEflow 已禁用、artifact 未被删除、随时可 `/paceflow:enable` 恢复。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移把状态写错 runtime）。
- helper 是唯一写入路径；不要手写 `.pace/disabled`，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
- **disable 是用户退出权，不是 AI 绕过门控的手段（spec §5.1 不变量 2）**：本 command 由用户主动运行（用户已表达意图），直接执行即可。但在**其他场景**你（AI）被 PACE deny 拦住时，**不得为绕过单次 deny 自行运行 `set-activation --disable`**——正确做法是走 PACE 流程（建 CHG / approve-and-start）。只有用户**明确表达「不想用 PACEflow」**时才停用；若判断用户可能想停用但用户没明说，先用 AskUserQuestion 确认，不自作主张。
