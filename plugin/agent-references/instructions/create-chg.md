# create-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`（schema / wikilink / ARCHIVE 等通用规则）

## 输入字段

- `title`（必填）
- `tasks`（必填，至少 1 个；推荐格式 `["任务描述", ...]`，artifact-writer 为当前 CHG/HOTFIX 分配 `T-001...`）
- `type`（默认 change，可选 hotfix / research）
- `related-finding`（可选，wikilink）
- `background` / `scope` / `technical-decision`（可选）

缺失必填字段时必须立即报告 `missing-fields`，且不得推断 / 兜底：
- 缺 `title` 或 `title` 为空 → `missing-fields: title`，禁止用 `background` / `scope` / task 描述派生标题
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- 任一必填字段缺失时，不使用 hook 预留编号写入，不读取索引，不 Write / Edit 任何 artifact；报告 `missing-fields`

## 操作步骤

> **报告标题强制**：最终输出的第一行必须字面是 `## artifact-writer 报告`。禁止简化为 `## 报告`，禁止改写为 `## create-chg 报告` / `## 执行报告` / `## 操作摘要`，禁止在标题前添加任何说明文字。`report_title_strict` 会机械检查，标题不匹配即 FAIL。

0. 前置检查：先校验必填字段；缺字段 → `missing-fields` 且不写文件。再用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 检查 `$ARTIFACT_DIR/changes` 目录必须已存在；`MISSING` → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact。禁止用 `ls "$ARTIFACT_DIR/changes"` 空输出判断目录不存在。
1. 计算 chg-id（详见下方"CHG-ID 推算"段）
2. 为当前 CHG/HOTFIX 分配局部任务 ID：按输入顺序生成 `T-001...T-NNN`；若迁移/测试输入已显式带 `T-NNN:`，可保留该 CHG 内编号，但不得扫描全项目分配全局 T-ID。
3. 写入前生成并自检详情文件 payload（frontmatter 顺序、任务清单、4 段结构）
4. Write `changes/chg-yyyymmdd-nn.md`（详情文件结构见下）
5. Read + Edit `task.md` 添加索引行（活跃任务区，按时间倒序插入顶部）
6. Read + Edit `implementation_plan.md` 添加索引行（变更索引区）
7. 基于 payload + Edit 成功 + hook 反馈做低成本验证；除非 hook 报告本次目标问题，不要再 Read 刚写好的详情文件或两个索引文件

资源约束：
- 不读 `walkthrough.md` / `findings.md` / `corrections.md`
- 不搜索 `~/.claude`
- 不为报告统计大小或行数运行 `wc` / `du`

## CHG-ID 分配（hook reservation + 二次防御）

并发派多 agent 时不能靠扫描索引分配 nn。主 session 应先运行 `node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js" --operation create-chg` 原子预留 `CHG-YYYYMMDD-NN` 或 `HOTFIX-YYYYMMDD-NN`，再把 helper 输出的 `reserved-id` / `reserved-file` 原样写进 Agent prompt。若主 session 跳过 helper，PreToolUse:Agent 会先预留编号并 deny，要求重派，这是 fallback。artifact-writer 必须优先使用 prompt 中的 hook 预留编号；不得重新扫描索引自行分配编号。

二次防御：

1. 若 prompt 已包含 helper 或 hook deny 文案给出的 `reserved-id` / `reserved-file`：直接使用该编号与文件路径。
2. 若缺少 reserved 信息但仍要新建 `changes/chg-*.md` / `changes/hotfix-*.md`，不要自行扫描；报告 `hook-deny` 或让主 session 重新派遣 artifact-writer。
3. 写入目标文件已存在 → 报告 `file-conflict`，主 session 重新派遣；不要用 Write 覆盖已有详情。

## 详情文件结构

```markdown
---
[frontmatter, 见 spec §2.1]
---

# <title>

## 任务清单

- [ ] T-NNN <task description>
- [ ] T-NNN <task description>

## 实施详情

**背景（Why）**：<background>

**范围（What）**：<scope>

**技术决策（How）**：<technical-decision>

**T-NNN <task title>**：
- 具体改动说明

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研

- [[<related-finding>]] <关联说明>（如有）
```

## 任务 ID 与索引行

`T-NNN` 是 **当前 CHG/HOTFIX 内的局部任务 ID**，不是全项目全局 ID。不同 CHG 都可以有 `T-001`，后续操作必须同时带 `target: CHG-...` 与 `task-id: T-...` 消除歧义。主 session 不需要为新 CHG 预分配 T-ID。

```
- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN]
```

刚创建的 CHG 默认状态 `[ ]`（planned），详情文件 **不包含** `<!-- APPROVED -->` 标记。

## 边界

- 缺 `title` 或 `title` 为空 → `missing-fields: title`，不得使用其他字段兜底
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

PACE 流程后续：
- 若用户批准并准备开始 → 主 session 优先调用 `update-chg action=approve-and-start approval-confirmed:true approval-source:<source> approval-evidence:<evidence> task-id:T-NNN`
- 若用户只批准但暂不执行 → 才调用 `update-chg action=approve approval-confirmed:true approval-source:<source> approval-evidence:<evidence>` 添加 `<!-- APPROVED -->`
- 实施推进 → 连续执行时由主 session 写代码、运行验证，验证通过后优先 `close-chg complete-open-tasks:true` 收口；`update-chg action=update-status` 仅用于暂停、阻塞、跳过、跨 session 或暂不验证（详见 update-chg 规范）
