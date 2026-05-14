# PACEflow v6 历史设计 RFC 归档

> **归档日期**：2026-05-14
> **来源**：从 `docs/action-plan-2026-05-02.md` 的 `## 13~17` 章节移出。
> **状态**：历史架构 RFC，v6 索引-详情拆分、finding/correction 独立详情、wikilink 索引等核心设计已在后续 v6 实现中落地。本文不再作为当前执行优先级来源。

---

## 13. v6.0.0 架构提案：索引-详情拆分 + Obsidian Wikilink

### 13.1 触发原因（真实痛点）

用户在 ccauth 项目（长期项目，artifact 已 45KB+152KB+260KB+381KB）反馈：**改代码用 10K 上下文，写文档和归档用 100K+**。根因分析：

1. Claude Code 强制 Edit 前必须 Read（大文件 Read 消耗高）
2. `old_string` 在大文件中不唯一导致 Edit 循环失败（30-50% 失败率）
3. ARCHIVE 标记移动是双步骤精确匹配（每次 2 次 Edit）
4. 1 个 CHG 完成需在 task / impl_plan / walkthrough 3 处归档
5. 详情段落格式严格（多种字段命名系统，见 findings 第 514 行 H-1/H-2）

**痛点本质**：不是 SessionStart 注入（一次性税）或 AI 主动 Read（偶尔事件），而是**每次 CHG 收尾的归档循环**——是确定性的、每个任务都发生、且失败率高的"按次计费税"。

### 13.2 架构设计

```
projects/<project>/
├── task.md                    ~3KB    纯索引行（wikilink 引用 CHG 详情）
├── implementation_plan.md     ~5KB    纯索引行
├── walkthrough.md             ~5KB    纯索引行
├── findings.md                ~5KB    纯索引行 + 摘要
├── spec.md                    不变（项目说明，无 CHG 概念）
└── changes/                   <-- 新增
    ├── chg-20260502-01.md     ~3KB    单 CHG 全详情（任务/实施/记录/调研合并）
    ├── chg-20260502-02.md
    ├── hotfix-20260321-01.md
    └── findings/              <-- finding 类型独立子目录
        ├── finding-2026-05-02-v91-126.md
        └── finding-2026-04-12-ce-compare.md
```

### 13.3 主 artifact 索引格式（task.md 示例）

```markdown
# 项目任务追踪

## 活跃任务

- [/] [[chg-20260502-02]] PreCompact 阻止能力 #change [tasks:: T-501~T-505]
- [/] [[chg-20260502-01]] hooks.json if 条件优化 #change [tasks:: T-498~T-500]

<!-- ARCHIVE -->

- [x] [[chg-20260403-01]] SKILL.md 元数据修正 #change
- [x] [[chg-20260321-01]] v5.1.4 code review 修复 #change
```

### 13.4 CHG 详情文件格式（changes/chg-20260502-01.md）

```markdown
---
chg-id: CHG-20260502-01
status: in-progress | completed | archived
date: 2026-05-02
type: change | hotfix | research
related-finding: "[[finding-2026-05-02-v91-126]]"
aliases: ["CHG-20260502-01", "hooks.json if 优化"]
tags: [change, hooks-optimization]
parent-tasks: ["[[task]]"]
parent-impl: ["[[implementation_plan]]"]
---

# CHG-20260502-01: hooks.json `if` 条件优化

## 任务清单
- [/] T-498 todowrite-sync if 条件添加
- [-] T-499 config-guard if 条件添加（v6.0.28 已移除 ConfigChange）
- [ ] T-500 验证 hook 触发率

<!-- APPROVED -->

## 实施详情
**背景（Why）**: ...
**范围（What）**: ...
**技术决策（How）**: ...
**T-498 任务标题**: 具体改动说明

## 工作记录
| 日期 | 完成内容 |
| --- | --- |
| 2026-05-02 | T-498 完成 |

## 关联调研
- [[finding-2026-05-02-v91-126]] CC v2.1.91→v2.1.126 调研
```

**单一文件容纳一个 CHG 全部信息**：任务、实施、工作记录、关联调研。1 CHG = 1 文件 = 1 wikilink。

### 13.5 Obsidian 特性白送的好处

| 特性 | 用法 | 价值 |
|------|------|------|
| Backlinks | 在 chg-xxx.md 看到"被 task / impl_plan 引用" | 自动维护反向索引 |
| Graph view | 可视化 CHG 间依赖（HOTFIX 修复哪个 CHG） | 历史架构演进可视化 |
| Aliases | `aliases: [CHG-XXX, "短描述"]` | wikilink 用任一名称都能命中 |
| Dataview | `from "changes" where status = "in-progress"` | 跨 CHG 动态查询 |
| Bases (1.9+) | `.base` 文件按 frontmatter 表格化 | 比 Markdown 表格强 100 倍 |
| Templater | 模板自动生成 frontmatter | 减少手动错误 |
| Properties UI | Obsidian 表单编辑 frontmatter | 状态变更不必手敲 |

### 13.6 PoC 验证结果（2026-05-02 完成）

通过派 subagent 在真实 vault 创建 `changes/chg-20260502-01-poc.md` 验证：

| 验证项 | 结果 | 数据 |
|------|------|------|
| Subagent 一次写对全部格式 | ✅ YES | 60 行 / 2320 字节，零 Edit 循环 |
| `changes/` 新目录是否被 hook 拦截 | ✅ NO | PreToolUse PASS（dur=32ms），PostToolUse PASS（无归档提醒） |
| Hook 注入 additionalContext | ✅ YES（5 行） | 正常状态提醒，不阻断 Write |
| Subagent 总 token 消耗 | **~8K tokens** | 9 次工具调用 |
| 对比当前架构同操作估算 | **~30K tokens** | 节省 ≥ 73% |

**关键洞察**：用 Write 创建新文件 = 跳过"Read 大文件 + 精确 old_string 匹配"全过程，subagent 即使能力有限也能可靠完成。

### 13.7 操作映射表（痛点根治路径）

| 操作 | 当前架构 | v6.0.0 | 痛点缓解 |
|------|---------|--------|---------|
| 写新详情段落 | Edit 大 artifact + 找位置插入 | `Write changes/chg-xxx.md` | **零 Read** |
| 修改详情段落 | Edit 大 artifact + 精确范围 | Edit 单 CHG 文件（100 行级） | old_string 唯一性高 |
| 归档详情 | 双步骤移动 ARCHIVE 标记 | Edit 索引行移到 ARCHIVE + 详情 frontmatter `status:` | **不再需要移动多行内容** |
| 跨 artifact 同步 | 3 个大文件 Edit 3 次 | 改 3 个索引文件的 1 行 wikilink | Edit 范围极小 |

### 13.8 Hook 改造点（v6.0.0）

1. `readActive(cwd, file)` 语义不变，但内容是索引行（极小）
2. 新增 `readChgDetail(cwd, chgId)` 按需加载
3. 新增完整性 hook：检测索引引用了 `[[chg-xxx]]` 但 `changes/chg-xxx.md` 不存在 → 提醒
4. ARCHIVE 标记仍移动索引行（不移详情文件）；详情 frontmatter `status: archived` 同步
5. 跨 artifact 一致性由 Obsidian backlinks 自动维护
6. wikilink 解析正则：兼容 `[[chg-xxx]]`、`[[chg-xxx|alias]]`、`[[chg-xxx#section]]` 三种形式

### 13.9 决策矩阵

| 决策 | 选项 | 推荐 |
|------|------|------|
| CHG 详情合并还是分段 | 1 CHG=1 文件 vs 1 CHG=4 文件（task/impl/walk/finding 各一） | **合并**（文件数减 4 倍，AI 一次读完整故事） |
| finding 是否独立子目录 | 在 changes/ 下 vs 单独 findings/ | **changes/findings/**（CHG 是"做了什么"，finding 是"学到什么"，生命周期不同） |
| 旧 CHG 是否强制迁移 | 一次性迁移 vs 双轨保留 | **双轨**（新 CHG 走新结构，旧 CHG 保留，提供 migrate-chg.js） |
| 链接格式 | wikilink vs 标准 markdown link | **wikilink**（Obsidian 优先，重命名追踪 + backlinks 自动） |

### 13.10 实施路径（v6.0.0 完整设计）

```
Phase 1：PoC（已完成 2026-05-02）
  └── changes/chg-20260502-01-poc.md 验证（节省 73% tokens 已确认）
       ↓
Phase 2：v6.0.0 架构设计（~3 小时）
  ├── 6 个新模板设计（task / impl_plan / walkthrough / findings 索引模板 + chg-template + finding-template）
  ├── Hook 改造规范（8 个 hook 脚本的具体改动点）
  ├── SKILL.md 改造规范（当前发布面为 4 个用户 skill；audit 保留 internal）
  └── 写入 docs/plans/v6.0.0-design.md
       ↓
Phase 3：v6.0.0 实施（~15-20 小时）
  ├── 改造 8 个 hook 脚本（重点：readActive / countByStatus / 新增 wikilink 解析）
  ├── 改造 5 个 SKILL.md（新格式引导）
  ├── 改造 6 个模板
  ├── 编写 migrate-chg.js 迁移工具
  └── 文档：v5→v6 升级指南
       ↓
Phase 4：双轨支持
  ├── PACEflow 自身先用（dogfood）
  ├── ccauth 项目作为大型测试（验证 95% token 节省）
  └── 渐进式：新 CHG 走新结构，旧 CHG 保留
       ↓
Phase 5：v6.0.0 正式发布
```

### 13.11 风险与缓解

| 风险 | 缓解 |
|------|------|
| 详情文件丢失但索引仍引用 | 完整性 hook（PostToolUse 检测）+ Obsidian broken link 红色提示 |
| 多 subagent 并发写同一 CHG 详情 | 强制 1 CHG 1 subagent；用 `.pace/locks/chg-xxx.lock` 简易锁 |
| CHG-ID 三处一致性（文件名 / wikilink / frontmatter） | hook 校验三处必须匹配 |
| Obsidian sync 延迟 | OneDrive sync 是已知限制，新架构不引入新问题 |
| 历史 CHG 检索需打开多文件 | Obsidian 全文搜索 + Dataview 查询补足 |
| 非 Obsidian 环境 wikilink 失效 | PACEflow vault 主要在 Obsidian 查看；GitHub 渲染不支持但接受 |

### 13.12 Subagent 分流的协同效应

v6.0.0 拆分架构 + subagent 分流是**叠加增益**：

| 层级 | 方案 | 单独收益 | 叠加收益 |
|------|------|---------|---------|
| 架构层 | v6.0.0 拆分 | Edit 范围小，循环失败率降 | 80%+ |
| 工作流层 | subagent 分流 artifact 操作 | 主 session 不消耗读写 tokens | 50%+ |
| **叠加** | 两者结合 | — | **主 session token 消耗降低 95%+** |

PoC 已证明：subagent 用 8K tokens 完成在主 session 需 30K+ tokens 的操作。架构拆分后单 CHG 详情文件 ≤ 100 行，subagent 即使能力有限（Sonnet/Haiku）也能可靠操作。

### 13.13 待决策项

1. 是否启动 Phase 2（v6.0.0 完整架构设计 + docs/plans/v6.0.0-design.md）？
2. PoC 文件 `changes/chg-20260502-01-poc.md` 是否保留？（保留 = v6.0.0 正式实施时的基础；删除 = PoC 完成后清理）
3. 是否在 v6.0.0 实施前先做 CHG-20260502-01（hooks.json `if` 条件优化）走当前架构，作为最后一个传统 CHG？
4. ccauth 项目是否同步迁移（v6.0.0 验证场景）？

### 13.14 PoC Cleanup 命令（如不保留）

```bash
rm /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/chg-20260502-01-poc.md
rmdir /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/  # 仅当目录为空
```

---

## 14. findings 与 corrections 在 v6.0.0 中的处理

### 14.1 finding 与 CHG 的本质差异

| 维度 | CHG | finding |
|------|-----|---------|
| 生命周期 | 短（开始-完成-归档） | 长（可开放数月，可被合并/否定） |
| 状态 | `[/] → [x]` 单向 | `[ ]/[/]/[x]/[-]/[!]` 多状态 |
| 关联 | 关联当时的 task/impl/walk | 关联多个 CHG，可被另一 finding "merges/merged-into" |
| 内容 | 任务执行记录 | 调研结论 + 可能行动项 |
| 类型 | change / hotfix | research / observation / comparison / correction |

因此 finding **不能复用 CHG 的简单 frontmatter**，需要单独设计。

### 14.2 finding 详情文件结构

路径：`changes/findings/finding-YYYY-MM-DD-slug.md`

```markdown
---
finding-id: FINDING-2026-05-02-v91-126
status: open                              # open | investigating | accepted | rejected | merged | blocked
type: research                            # research | observation | comparison | correction | bug-report
date: 2026-05-02
impact: P1                                # P0 | P1 | P2 | P3
summary: "CC v2.1.91→126 共 35 版本：5 项关键发现，3 项升级机会"
related-changes:                          # 该 finding 关联到哪些 CHG
  - "[[chg-20260502-01]]"
  - "[[chg-20260502-02]]"
merges:                                   # 该 finding 替代了哪些（合并历史）
  - "[[finding-2026-04-02-v76-90]]"
merged-by: null                           # 该 finding 被哪个替代（更新版本时填）
rejection-reason: null                    # 仅 status=rejected 时必填，≥10 字符
aliases: ["v91-126 调研", "Claude Code 2.1.91 升级评估"]
tags: [finding, research, claude-code-changelog]
---

# CC v2.1.91→v2.1.126 完整变更评估

## 摘要
> 35 版本（缺 93/95/102/103/106/115/125/88-撤回）；5 项关键发现：(A)v2.1.97 file_path 绝对路径修复 (B)v2.1.105 PreCompact hook 阻止能力 (C)...

## 背景
（调研触发原因）

## 关键发现
### 发现 1：file_path 绝对路径修复
...

## 对前次行动项的影响
（表格）

## 新增行动项
（列表）

## 不确定项
（列表）

## 调研来源
（链接）
```

### 14.3 findings.md 索引格式（精简版）

```markdown
# 调研记录

## 摘要索引

<!-- 格式：- [状态] [[finding-id]] 标题 — summary [date::] [impact::] [tags::] -->

- [ ] [[finding-2026-05-02-v91-126]] CC v2.1.91→126 — 35 版本，5 关键发现 [date:: 2026-05-02] [impact:: P1] [merges:: [[finding-2026-04-02-v76-90]]]
- [-] [[finding-2026-04-12-ce-compare]] Compound Engineering 对比 — 可共存，3 借鉴方向 [date:: 2026-04-12] [impact:: P3]
- [-] [[finding-2026-04-02-v76-90]] CC v2.1.76→90 — 已合并 [date:: 2026-04-02] [merged-into:: [[finding-2026-05-02-v91-126]]]
- [x] [[finding-2026-03-12-ticket22]] v5.0.2 全面审查 — 0C+1H+12W+26I [date:: 2026-03-12] [change:: [[chg-20260312-04]]]

<!-- ARCHIVE -->

（更老 finding 索引）
```

**索引行从当前 200-500 字符缩到 50-100 字符**——长摘要移到详情 frontmatter 的 `summary:` 字段。

### 14.4 状态映射表（关键改进）

| 索引标记 | frontmatter status | 含义 | 是否阻止 stop hook |
|---------|------------------|------|-----------------|
| `[ ]` | `open` | 参考中/待评估 | 14 天后阻止 |
| `[/]` | `investigating` | 主动调查中 | 不阻止 |
| `[x]` | `accepted` | 已采纳/已验证 | 自动归档 |
| `[-]` | `rejected` | 保持现状/已否定 | 不阻止（需 ≥10 字符 rejection-reason） |
| `[-]` | `merged` | 被另一 finding 替代 | 不阻止（需 merged-into wikilink） |
| `[!]` | `blocked` | 阻塞 | 阻止 |

**关键改进点**：当前架构 `[-]` 同时表示"否定"和"合并"，hook 难以区分；v6.0.0 通过 frontmatter `status` 字段精确区分，hook 可基于 status 而非索引标记做判断。

### 14.5 与 CHG 的双向关联

| 方向 | 实现 |
|------|------|
| finding → CHG | finding 详情 frontmatter `related-changes: [[chg-xxx]]` |
| CHG → finding | CHG 详情 frontmatter `related-finding: [[finding-xxx]]` |
| 自动维护 | Obsidian backlinks（无需手动同步） |
| Dataview 查询 | `from "changes/findings" where contains(related-changes, [[chg-20260502-01]])` |

### 14.6 历史 finding 迁移策略

findings.md 当前有 60+ finding 索引 + 详情，格式相对统一（`### [日期] 标题` + 段落）。

**自动化迁移可行性高于 CHG**——可写脚本 `migrate-finding.js`：

```javascript
// migrate-finding.js 伪代码
1. 解析 findings.md 所有 `^### \[日期\] 标题$` 段落起止
2. 提取 metadata（日期 / 状态 / 关联 CHG / impact / tags）
3. 为每条生成独立 changes/findings/finding-yyyy-mm-dd-slug.md
4. 在新文件写入 frontmatter（含 summary 字段）+ 详情 body
5. 重写 findings.md 为索引（仅保留状态行 + wikilink + 短 summary）
6. 验证：每条索引 wikilink 指向的文件都存在
```

**渐进策略**：

| 版本 | 策略 |
|------|------|
| v6.0.0 | 双轨：新 finding 走新结构，旧 findings.md 保留双区结构 |
| v6.1.0 | 提供 `migrate-finding.js`，用户按需迁移 |
| v6.5.0 | 评估是否强制全迁移（若 90%+ 已迁移则强制） |

### 14.7 Hook 改造点（finding 特定）

1. `findings.md` 的 readActive() 仍读活跃区，但内容仅是索引行（极小）
2. **14 天阻止规则**：检查 `[ ]` 索引 + frontmatter `status: open`，**排除** `[/] investigating`（主动调查中不应被阻止）
3. **`[-] rejected` 必须有 `rejection-reason` ≥10 字符**（当前已是规则，frontmatter 强制化）
4. **`[-] merged` 必须有 `merged-into` wikilink 指向有效 finding 文件**（当前架构靠注释维护）
5. **CHG 完成后自动检查关联 finding 状态**：如果 CHG 标 `[x]` 但 `related-finding` 仍 `[ ]` → 提醒更新为 `[x] accepted`
6. **完整性检查**：索引 wikilink 指向的 `changes/findings/*.md` 必须存在

---

## 15. corrections 在 v6.0.0 中的处理

### 15.1 corrections 与 finding 的差异

| 维度 | finding | correction |
|------|---------|-----------|
| 生成方式 | AI 主动调研记录 | 用户纠正 AI 触发 |
| 内容焦点 | 技术问题 / 调研结论 | AI 行为问题 / 触发场景 / 根本原因 |
| 关联 knowledge | 偶尔（findings → knowledge 选择性） | 强制（每条 correction 必有 [knowledge:: link]） |
| 状态 | 5 种（open/accepted/rejected/...） | 通常仅 1 种（recorded） |
| 数量增长 | 中（每月几条） | 低（每月 1-2 条） |

corrections 当前作为 findings.md 的一个段落（`## Corrections 记录`），应独立处理。

### 15.2 corrections 详情文件结构

路径：`changes/corrections/correction-YYYY-MM-DD-NN.md`

```markdown
---
correction-id: CORRECTION-2026-04-15-01
date: 2026-04-15
trigger-quote: "用户原话或近似引用，如：'不对，归档不是这样'"
wrong-behavior: "AI 错误行为简述"
correct-behavior: "正确做法简述"
trigger-scenario: "什么场景下容易出现"
root-cause: "根本原因（认知偏差 / 工具限制 / 流程缺失）"
knowledge-link: "[[ai-verification-discipline]]"   # 必须指向 knowledge/ 笔记或写 "project-only"
project-scope: "project-only | universal"          # 是否仅本项目
tags: [correction, knowledge-discipline]
---

# Correction: 任务完成后未主动归档

## 错误行为
[详细描述错误]

## 正确做法
[详细描述正确]

## 触发场景
[什么时候 AI 容易犯]

## 根本原因
[认知层面的根因分析]

## 关联知识
- [[ai-verification-discipline]] 验证纪律
- 关联 finding：[[finding-2026-04-12-ce-compare]]（如有）
```

### 15.3 corrections 独立索引文件

新增 `corrections.md`（与 findings.md 同级）：

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

<!-- 格式：- [[correction-id]] 简要标题 [date::] [knowledge::] [scope::] -->

- [[correction-2026-04-15-archive-skip]] 任务完成后未主动归档 [date:: 2026-04-15] [knowledge:: project-only]
- [[correction-2026-03-22-todowrite-bypass]] TodoWrite 使用前未先 read task [date:: 2026-03-22] [knowledge:: [[ai-verification-discipline]]]

<!-- ARCHIVE -->

（更老 corrections 索引）
```

**为什么独立而非放 findings.md**：

| 维度 | 独立文件 | 嵌入 findings.md |
|------|---------|---------------|
| 语义清晰度 | 高（corrections vs findings 关注点不同） | 低（混在一个文件） |
| 检索 | 直接 `corrections.md` | 需在 findings.md 翻找 |
| frontmatter 设计 | 可独立优化（不与 finding 字段冲突） | 必须妥协 |
| Obsidian Dataview | `from "changes/corrections"` 干净 | 需过滤 type 字段 |
| stop hook 检查 | 单独规则（如新 correction 后 24h 内必须有 knowledge 双写验证） | 与 finding 规则混淆 |

### 15.4 Hook 改造点（correction 特定）

1. **新增 correction 必触发**：PostToolUse:Write 检测到 `changes/corrections/*.md` 创建后：
   - 检查 frontmatter `knowledge-link` 字段是否填写
   - 如指向 knowledge/ 笔记，验证笔记存在
   - 如填 `project-only`，记录但不强制 knowledge 写入
2. **stop hook 验证**：会话结束前检查本会话所有 correction 是否完成 knowledge 双写
3. **频次告警**：同一 root-cause 累计 3 次 correction → 提醒可能存在系统性问题（建议升级到 finding 或 hook 改造）

### 15.5 历史 corrections 迁移

findings.md 当前 Corrections 区有 ~10 条 correction 记录。迁移流程：

1. 解析 `### Correction: ...` 段落
2. 提取四要素（错误行为 / 正确做法 / 触发场景 / 根本原因）
3. 提取 `[knowledge:: ...]` 字段
4. 生成 `changes/corrections/correction-YYYY-MM-DD-NN.md`
5. 在 corrections.md 写入索引行
6. 从 findings.md 删除 Corrections 区

迁移工具：`migrate-correction.js`（可与 migrate-finding.js 合并为 `migrate-v6.js`）。

---

## 16. v6.0.0 完整文件结构（汇总）

```
projects/<project>/
├── task.md                         索引文件（CHG 索引）
├── implementation_plan.md          索引文件（CHG 索引）
├── walkthrough.md                  索引文件（CHG 完成记录索引）
├── findings.md                     索引文件（finding 索引 + 摘要）
├── corrections.md                  索引文件（correction 索引）⬅ 新增
├── spec.md                         不变（项目说明，无 CHG/finding 概念）
└── changes/
    ├── chg-20260502-01.md          CHG 详情
    ├── chg-20260502-02.md
    ├── hotfix-20260321-01.md
    ├── findings/                   ⬅ finding 子目录
    │   ├── finding-2026-05-02-v91-126.md
    │   └── finding-2026-04-12-ce-compare.md
    └── corrections/                ⬅ correction 子目录
        ├── correction-2026-04-15-archive-skip.md
        └── correction-2026-03-22-todowrite-bypass.md
```

5 个索引文件 + 1 个 spec.md + 3 类详情子目录（changes / findings / corrections），结构清晰。

---

## 17. 待决策汇总（v6.0.0 全面）

| # | 决策项 | 选项 | 推荐 |
|---|-------|------|------|
| 1 | 是否启动 v6.0.0 Phase 2（完整设计） | 启动 / 缓做 / 放弃 | 启动 |
| 2 | PoC 文件保留还是清理 | 保留作为 v6.0.0 基础 / 清理 | 保留 |
| 3 | hooks.json `if` 条件优化是否走传统架构 | 传统架构最后一个 CHG / 等 v6.0.0 | 传统架构（10 分钟收尾） |
| 4 | ccauth 是否同步迁移 | 同步（v6.0.0 验证） / 等 v6.0.0 稳定后 | 等稳定 |
| 5 | finding/correction 迁移工具优先级 | 与 v6.0.0 同期 / 单独 v6.1.0 | 单独 v6.1.0 |
| 6 | corrections 独立索引文件 | corrections.md / findings.md 嵌入 | 独立 |
| 7 | 详情文件命名（slug 部分） | 自动生成 / 手动指定 | 自动（基于标题转 kebab-case） |
| 8 | wikilink 是否支持别名引用 `[[chg-xxx|短名]]` | 仅 wikilink / 支持别名 | 支持别名（Obsidian 原生） |
