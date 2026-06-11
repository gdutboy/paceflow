---
description: 查询 PACEflow 在当前项目的激活状态
allowed-tools: Bash, Read
---

# /paceflow:status

用户运行了 `/paceflow:status`。运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --status --cwd "<当前项目 cwd 绝对路径>"`，把状态原样转述给用户（enabled / disabled / inactive、本 session 是否 paused，与对应下一步提示）。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移读错 runtime）。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
