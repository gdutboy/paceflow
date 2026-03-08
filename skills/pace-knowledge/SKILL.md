---
name: pace-knowledge 知识库管理
description: PACEflow 知识库笔记管理规则。当操作知识库目录时自动激活：(1) 创建/更新 thoughts/ 笔记（酝酿中的想法），(2) 创建/更新 knowledge/ 笔记（跨项目可复用经验），(3) 从项目 findings 提取知识到 knowledge/。定义 frontmatter 结构、L0/L1/L2 信息分层和状态流转规则。
---

# Obsidian 知识库笔记管理规则

管理 Obsidian Vault 中 `thoughts/` 和 `knowledge/` 目录的笔记创建与维护。

**Vault 路径**：由 `PACE_VAULT_PATH` 环境变量指定的 Vault 路径

> **SessionStart 自动注入**：SessionStart hook 会自动扫描 `thoughts/` 和 `knowledge/` 目录中与当前项目相关的笔记（通过 frontmatter `projects` 字段匹配），将 L0 摘要注入到会话上下文中。compact 恢复时不触发扫描。

> **状态体系说明**：knowledge/thoughts 笔记使用 `discussing`/`concluded`/`archived` 状态标记（frontmatter `status` 字段），与 task.md/implementation_plan.md 的 checkbox 状态标记（`[ ]`/`[/]`/`[x]`）是**完全独立的含义系统**，不可混用。

---

## thoughts/ 笔记

**用途**：酝酿中的想法、方案讨论、可行性验证——尚未成熟到进入 PACE 执行阶段。

### 模板

```markdown
---
status: discussing
projects: [项目名]
tags: [标签1, 标签2]
summary: "一句话摘要，Home.md 仪表盘显示用"
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# 标题

## 摘要

<!-- L1：关键结论/想法，300-500 tokens -->

- 结论 1
- 结论 2

## 详情

<!-- L2：完整分析过程、对比、推理链 -->
```

### 状态流转

| 状态 | 含义 | 流转条件 |
|------|------|---------|
| `discussing` | 酝酿中，尚无定论 | 创建时默认 |
| `concluded` | 已有结论，可执行或归档 | 讨论收敛、方案确定 |
| `archived` | 已过时或已被执行吸收 | 关联 CHG 完成 / 内容过时 |

### 规则

- `summary` 必填，不超过 80 字
- `projects` 至少关联一个项目名（对应 `projects/` 下的目录名）
- 更新内容时同步更新 `updated` 日期
- Home.md 仪表盘查询 `status = "discussing"` 的笔记

---

## knowledge/ 笔记

**用途**：跨项目可复用的经验、模式、最佳实践——从项目 findings 中提炼的知识沉淀。

### 模板

```markdown
---
status: concluded
projects: [来源项目1, 来源项目2]
tags: [标签1, 标签2]
summary: "一句话摘要，Home.md 仪表盘显示用"
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources:
  - 来源项目/findings
---

# 标题

## 摘要

<!-- L1：关键结论，300-500 tokens -->

- 结论 1
- 结论 2

## 详情

<!-- L2：完整内容、代码示例、对比表格 -->
```

### 规则

- `summary` 必填，不超过 80 字
- `sources` 标注知识来源（哪个项目的 findings）
- `status` 通常为 `concluded`（已验证的知识）
- 知识过时时更新内容或改 status 为 `archived`
- Home.md 仪表盘显示所有非 README 的 knowledge/ 笔记

---

## 创建时机

### thoughts/ 创建条件

- 讨论中出现值得持久化但未成熟的想法
- 方案对比需要跨会话保持
- 用户主动要求"记下来"或"先想想"

### knowledge/ 创建条件

- 项目 findings 中发现跨项目通用经验
- 同一踩坑经验在 2+ 个项目出现
- 用户要求提取知识

### 不创建的情况

- 项目特有的实现细节 → 留在项目 findings.md
- 一次性调试信息 → 不持久化
- 已有同主题笔记 → 更新现有笔记而非新建

---

## L0/L1/L2 信息分层

| 层级 | 内容 | Token 量 | 用途 |
|------|------|---------|------|
| **L0** | frontmatter `summary` | ~50 | SessionStart 匹配注入 |
| **L1** | `## 摘要` section | ~300-500 | 快速了解核心结论 |
| **L2** | `## 详情` 及以下 | 不限 | 按需 Read 全文 |

---

## Obsidian 操作指引

操作 Obsidian 笔记时，优先调用 plugin skill（需安装 obsidian-skills 插件，未安装时回退到 fs 操作）：

- **CLI 操作**（搜索/创建/追加/属性编辑）→ 调用 `obsidian:obsidian-cli`
- **Markdown 语法**（wikilinks/callouts/embeds/properties）→ 调用 `obsidian:obsidian-markdown`
- **Obsidian 未运行**时 → 回退 fs 直接操作（Read/Write/Edit 工具）
- **Hook 层**始终使用 fs（延迟 <5ms），仅 post-tool-use H12 用 fire-and-forget spawn 调用 CLI
