---
description: 恢复本 session 的 PACEflow（删除 pause 标志）
allowed-tools: Bash, Read
---

# /paceflow:resume

用户运行了 `/paceflow:resume`。运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --resume --cwd "<当前项目 cwd 绝对路径>"`。向用户确认 PACEflow 已在本 session 恢复（或本就没有 pause 标志）。

## 规则

- `--cwd` 必须传当前项目根的绝对路径。
- helper 是唯一写入路径；不要手写删除 `.pace/paused-*` 标志，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
