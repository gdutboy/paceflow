# CLAUDE.md

本文件只提供本仓库维护入口。不要把它当作 PACEflow 用户工作流规范，也不要在这里放个人回复风格。

PACEflow 的运行时行为必须由以下位置定义：

- Hook 代码：`plugin/hooks/**`
- Agent 契约：`plugin/agents/artifact-writer.md` 与 `plugin/agent-references/**`
- 用户 skill：`plugin/skills/**/SKILL.md` 与其 `references/**`
- 发布/安装说明：`README.md`、`REFERENCE.md`

`CLAUDE.md` 不承担 artifact 创建、批准、验证、归档、Stop gate、worktree owner 或 helper 使用规则的权威职责；这些规则应写回 hooks、skills、agent references 或 README/REFERENCE。

## 维护规则

- 修改运行时行为时，优先改 `plugin/` 下的实际发布面，并补测试。
- `docs/`、`internal/`、`tests/` 是仓库维护材料，不随 marketplace runtime 发布。
- 历史设计文档保留背景时必须标明 historical / pre-implementation，避免旧 v5 或早期 v6 语义被误当当前规则。
- 不要把用户个人格式要求（时间戳、固定结尾、口癖）写进仓库级 `CLAUDE.md`。

## 常用验证

```bash
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
node tests/test-install.js
claude plugin validate ./plugin
git diff --check
```

`install.js` / `verify.js` 只作为本地 smoke 或手动安装健康检查工具；marketplace 安装以 `plugin/.claude-plugin/plugin.json`、`plugin/hooks/hooks.json` 和 `plugin/**` 发布面为准。
