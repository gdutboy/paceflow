---
name: pace-knowledge
effort: medium
description: >
  PACEflow 知识库笔记管理。自动激活：(1) 创建/更新 thoughts/ 或 knowledge/ 笔记，
  (2) 从 findings 提取知识到 knowledge/，(3) 用户被纠正时写 Corrections 并双写
  knowledge/，(4) 技术调研记录到 findings。定义 frontmatter 结构和 L0/L1/L2 信息分层。
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

## Findings → Knowledge 提取 SOP

当 findings.md 中的调研结论被判定为跨项目通用经验时，执行以下步骤：

1. **判定通用性**：该经验是否在其他项目中也可能遇到？（如 Hook I/O 协议、AI 验证纪律、路径处理）
2. **检查 knowledge/ 是否已有同主题笔记**：Grep `knowledge/` 目录中的标题和标签
3. **已有** → Edit 追加新内容到 `## 详情` section，更新 `updated` 日期和 `sources`
4. **未有** → Write 创建新笔记，使用 knowledge/ 模板，`status: concluded`
5. **回写 finding 条目**：在 findings.md 索引补 `[knowledge:: slug]`（kebab-case 命名）

> 提取的知识必须自包含——不依赖原 finding 的上下文就能理解。摘要是结论，详情是完整推理。

### 联动触发

此 SOP **不仅**由用户手动触发。以下场景应**主动评估**是否需要提取：

- **记录新 finding 时**（由 `paceflow:artifact-management` 触发）：recording finding → 评估通用性 → 通用则执行本 SOP
- **Corrections 双写时**：写入 correction → 评估通用性 → 通用则提取到 knowledge/
- **审查发现时**（由 `paceflow:paceflow-audit` Phase 3 触发）：P0/P1 发现 → 评估是否为通用模式

> artifact-management 的"findings 记录时的联动检查"会指引 AI 在记录 finding 后主动评估并触发本 SOP。

---

## Corrections 双写流程

被用户纠正时（"不对"、"别这样"、"错了"等），CLAUDE.md G-3 要求双写：

1. **写入 findings.md** `## Corrections 记录` 区：错误行为 + 正确做法 + 触发场景 + 根本原因
2. **评估通用性**：该纠正是否跨项目通用？
   - **通用**（如 AI 验证习惯、决策偏差模式）→ 步骤 3
   - **仅限本项目**（如特定 API 用法）→ 补 `[knowledge:: project-only]`，结束
3. **写入 knowledge/**：追加到已有笔记或新建，标注来源项目
4. **回写 correction 条目**：补 `[knowledge:: 笔记名]`

> PostToolUse hook 检测 correction 写入后会 HINT 提醒双写 knowledge/。

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
