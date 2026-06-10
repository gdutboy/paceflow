---
description: 在当前项目启用 PACEflow（首次启用会引导选择 artifact 存放位置）
allowed-tools: Bash, AskUserQuestion, Read
---

# /paceflow:enable

用户运行了 `/paceflow:enable`。运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --enable --cwd "<当前项目 cwd 绝对路径>"`。

- 若 helper 输出「已启用（首次）」或「已启用（manual 标记）」并给出 set-artifact-root 命令：用 AskUserQuestion 让用户选「Obsidian vault project」或「本地项目目录」（至少两个选项），再按用户选择运行 helper 输出里给出的对应 `set-artifact-root.js --choice local|vault` 命令（输出说明已配置过则跳过）。
- 若 helper 输出「恢复既有项目」：无需选 root，按提示调用 `Skill(paceflow:pace-workflow)` 继续。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移把状态写错 runtime）。
- helper 是唯一写入路径；不要手写 `.pace-enabled` 或 `.pace/disabled`，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
