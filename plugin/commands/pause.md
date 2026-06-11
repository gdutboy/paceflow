---
description: 仅本 session 暂停 PACEflow 流程门（session 结束自动失效，artifact 保护保留）
allowed-tools: Bash, AskUserQuestion, Read
---

# /paceflow:pause

用户运行了 `/paceflow:pause`。运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --pause --cwd "<当前项目 cwd 绝对路径>"`。向用户确认：PACEflow 流程门（Stop / 写码门）已在本 session 暂停，本 session 结束自动失效，随时可 `/paceflow:resume` 恢复。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移把标志写错 runtime）。
- helper 是唯一写入路径；不要手写 `.pace/paused-*` 标志，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
- **pause 只免流程门，不免 artifact 完整性门**：暂停期间 artifact（task.md / implementation_plan.md / changes/** 等）仍必须经 artifact-writer 写入，主 session 直接 Edit artifact 照常被拦。
- **pause 是用户的 session 级退出权，不是 AI 绕过门控的手段（对称 disable 的退出权约束，且更严）**：本 command 由用户主动运行（用户已表达意图），直接执行即可。但在**其他场景**你（AI）被 PACE deny 拦住时，**不得为绕过单次 deny 自行运行 `set-activation --pause`**——正确做法是走 PACE 流程（建 CHG / approve-and-start / 经用户确认接手）。只有用户**明确表达「本 session 不想要 PACEflow 约束」**时才暂停；若判断用户可能想暂停但用户没明说，先用 AskUserQuestion 确认，不自作主张。
