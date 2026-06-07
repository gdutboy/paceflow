# batch create CHG 设计 — change-set 多阶段变更落地

> 状态：设计待实现（pre-implementation, design-only）
> 日期：2026-06-07
> 影响面：`reserve-artifact-id.js`、`create-chg`（artifact-writer + 指令）、`agent-lifecycle-guard.js`、`session-start.js`、`stop.js`、`artifact-writer-spec.md`、pace-bridge / pace-workflow / artifact-management skill
> 不影响：REVIEWED/VERIFIED/APPROVED 状态机、close/archive 流程、schema-version（仍 6.0）

## 1. 背景与痛点

一个完整变更天然拆成多个**可验证闭环 CHG**（如 review gate = Phase 1 hooks → Phase 2 writer → Phase 3 skill → Phase 4 doc）。但当前机制只能逐个 `reserve-artifact-id`（一次一个 ID）+ 逐个派 `create-chg`（一次一个文件）。后果：

- **规划丢失**：后续阶段的 CHG 规划只活在 session 上下文，compact 或 session 中断就丢，且无法靠 artifact 恢复——这违背 PACEflow「artifact 是流程恢复机制」的初衷。
- **依赖单一 session**：多阶段变更"执行完一个才创建下一个"，强依赖同一 session 不被 compact。
- **bridge 裂缝**：`pace-bridge` Step 2 明说要按闭环边界拆多个 CHG、Step 4 说"其余 CHG 保持 planned"，但**没有 batch 落地机制**——4 个 CHG = 4 次 reserve + 4 次 agent 派遣，繁琐到实际没人做，规划退回上下文。

真实案例：本仓库 review gate 的 4 个 Phase CHG（chg-20260606-02~06）全是"执行完一个才建下一个"，规划从未一次性落地。

## 2. 目标 / 非目标

**目标**：一次操作把"一个完整变更拆成的 N 个 CHG"全部落地为 artifact（规划持久化），不依赖单一 session 存活；并提供轻量的整体进度追踪。

**非目标（YAGNI）**：
- ❌ 不引入独立的 epic / 完整变更 artifact 类型（采用「中间路」：CHG frontmatter 轻量字段）。
- ❌ 不改执行模型（仍逐个 `approve-and-start`、一次一个 in-progress）。
- ❌ batch create **不** auto-start 首个 CHG（A2：全 planned）。
- ❌ 不做整体进度状态机 / Stop 硬阻断联动（只做**不阻断**的可见软提醒）。
- ❌ 不设 N 硬上限（靠"CHG 是可验证闭环单元"原则自然约束）。

## 3. 设计决策（已与用户确认）

| 决策点 | 选择 |
|---|---|
| (a) 执行衔接 | **A2 全 planned**：batch 后全部 planned，开始执行走常规 `approve-and-start` 首个 CHG。理由：职责单一（batch 只做 A 阶段落地，不跨 C→E 确认门）、batch 场景天然在规划期不强迫立即执行、与 Stop 软提醒咬合。 |
| (b) change-set slug | **主 session 起**（语义化，如 `review-gate`），用户可改。 |
| (c) seq 格式 | **`2/4` 单字段**（`change-set-seq`）。 |
| (d) N 上限 | **不设**。复用并补全"CHG 是可验证闭环单元"原则（见 §5.5）。 |

## 4. 数据模型

CHG/HOTFIX 详情 frontmatter 新增 2 个**可选、nullable、向后兼容**字段（与 `reviewed-date` 同款处理，schema-version 仍 `6.0`）：

```yaml
change-set: review-gate        # nullable；完整变更标识 slug；单 CHG 不带（null）
change-set-seq: 2/4            # nullable；该 CHG 是这个变更的第几 / 共几阶段
```

- 写入位置：frontmatter 内，建议置于 `type` 之后、`schema-version` 之前（artifact-writer-spec §2.1 schema 顺序补这两字段）。
- 普通单 CHG：两字段为 `null`（或不写），行为完全不变。
- 同一 change-set 的 N 个 CHG 共享同一 `change-set` slug，`change-set-seq` 分别为 `1/N` … `N/N`。
- `change-set-total`（见 §5.2 模板）仅为 batch prompt 字段，artifact-writer 用它校验块数、并作为各块 `change-set-seq` 的分母；**不写入 frontmatter**。frontmatter 只存 `change-set` + `change-set-seq` 两个字段。

## 5. 组件设计

### 5.1 reserve 批量

`reserve-artifact-id.js` 加 `--count N`（默认 1，向后兼容）：

```bash
node reserve-artifact-id.js --operation create-chg --count 4 [--type hotfix] --cwd <dir>
```

- 输出 N 个连号 reserved-id + reserved-file（如 `CHG-20260607-02` … `-05`）。
- reservation 运行态一次写 N 条（复用现有 reservation 文件机制；N 条同 operation、同 session）。
- `--count 1`（默认）= 现有行为。
- 上限：不设硬上限；`--count` 取 ≥1 整数，非法值 fail-closed。

### 5.2 batch create 机制 + 正确性保障 ★

这是核心难点：**artifact-writer 一次建 N 个 CHG 必须不串号、不混 task**。靠两层保障——强模板（消歧）+ 确定性校验（兜底）。

**主 session → artifact-writer 的 batch 模板**（每块显式绑定 reserved-id）：

```
artifact_dir: <...>
operation: create-chg
change-set: review-gate
change-set-total: 4
--- CHG 1/4 ---
reserved-id: CHG-20260607-02
reserved-file: changes/chg-20260607-02.md
title: <第 1 阶段标题，体现闭环范围>
tasks:
  - T-001: <自包含目标 + 验收>
background: <Why>
scope: <What>
technical-decision: <How>
--- CHG 2/4 ---
reserved-id: CHG-20260607-03
reserved-file: changes/chg-20260607-03.md
title: ...
tasks: ...
（…CHG 3/4、4/4 同构…）
```

- 分隔符 `--- CHG i/N ---` + 每块**显式 reserved-id** → 消除"哪个 task 属于哪个 CHG / 哪个 id 对应哪个文件"的歧义。
- 单 CHG（无 `change-set` / 无 `--- CHG`）走现有 create-chg 路径，零变化。

**artifact-writer 处理**：
1. 检测 batch（出现 `--- CHG i/N ---` 块，或 `change-set-total` > 1）。
2. 逐块独立解析 → 逐块 create（内部循环）：每个写入 `change-set` + `change-set-seq: i/N` frontmatter + 各自 `changes/*.md` + task.md / implementation_plan.md 各 N 行 wikilink 索引。
3. 逐块验证（frontmatter schema / wikilink / 索引一致）。
4. 全部成功才报 SUCCESS；中途失败报告"已建哪几个 / 失败在哪块"，未用的 reservation 保留（可重派补建）。

**确定性校验（`agent-lifecycle-guard.js`）**——batch create 派遣时 hard-deny if（与现有 create-chg / close-chg 字段网关同构）：
- 任一 `--- CHG i/N ---` 块缺 `reserved-id` / `title` / `tasks`；
- prompt 中 reserved-id 集合 ≠ 本次 reserve 预留的 N 个（防漏建 / 串号 / 多建 / 用错号）；
- 缺 `change-set`，或 `change-set-total` ≠ 实际块数。

把"多 CHG 映射正确性"从 LLM-soft 提升为确定性保障（呼应 review gate 空门教训：复杂映射不靠 agent 自觉，靠 hook 兜底）。

### 5.3 追踪层

**SessionStart 注入（AI 上下文，人不可见）**：按 `change-set` 聚合活跃区 + planned CHG，注入形如
`change-set review-gate 进度 1/4（已完成 Phase 1，待执行 Phase 2-4）` 的摘要，让 AI compact 后仍知道整体进度与下一步。

**Stop hook 可见软提醒（人可见，不阻断）**：
- 触发：某 `change-set` 仍有 planned CHG 未执行 **且当前无 in-progress CHG**。
- 行为：走 stop.js 的 **softReminder / `emitAllowedStopReminders` 路径**（**exit 0 放行**），stderr 显示"change-set review-gate 还有 N 个阶段未执行（seq 2/4…），可继续 approve-and-start 或留待后续 session"。
- **关键**：planned 余项**不进** `warnings[]`、不触发 `exit 2` 阻断——因为 planned 阶段是"待办"不是"未收尾"。只有 in-progress CHG 才照现有逻辑阻断 Stop。这层只是"别忘了后续阶段"的人可见提醒。

### 5.4 执行衔接（A2）

- batch 后 N 个全 planned。
- 开始执行 = 常规 `update-chg action=approve-and-start`（带 approval-confirmed）首个 CHG，其余 planned。
- 一个 CHG `close-chg` 后，下一个仍 planned；靠 §5.3 的 Stop 软提醒 + SessionStart 注入引导继续。
- 执行模型与现状完全一致，batch 只前置了"规划落地"。

### 5.5 bridge 集成 + pace-workflow 闭环描述补全

**pace-bridge skill**：Step 2-3 改用 batch——按闭环边界拆 N 个 → `reserve --count N` → 一次 batch create（替代逐个 reserve+create）。Step 4 auto-APPROVED 仍只针对"当前要开始执行的"首个（A2 不变）。

**pace-workflow skill**：经逐行核对，pace-workflow 的多 CHG 语义大体已对，分三类处理——
- **粒度原则（`:74-80`）已较全**（最小单元 `:74`、领域拆分 `:78`、独立性 `:79`），相比 bridge `:62-67` 仅缺两点，补齐：① "独立**验证** / 独立**回滚**"的明确措辞（bridge `:65`；pace-workflow `:79` 只提暂停/等待/跨 session/worktree）；② "按闭环边界拆分、N 个独立功能各自一个 CHG 而非按 plan 层级合并"的反模式警告（bridge `:67`）。
- **A 阶段多 CHG 创建语义（`:88`）需更新**：从"按粒度拆成一个或多个 `create-chg` 输入"（逐个 create 语境）改为"按粒度拆成 N 个 → `reserve --count N` → 一次 batch create"。这是 pace-workflow 里**真正需要随 batch 改动的语义点**。
- **`:94` 后续 CHG planned 语义与 batch A2 一致，保留**；仅措辞微调对齐 batch（一次创建 N 个全 planned，只对当前要执行的首个派 `approve-and-start`，其余 planned）。
- 补 batch create 用法说明（每个 batch CHG 仍须是独立可验证闭环，N = 闭环拆分的自然数量、不是凑数）。

**artifact-management skill**：其多 CHG 拆分原则（`:79`，含"可独立验证"）已与 batch 一致、保留；补 batch create 机制三处——① 操作映射表（`:91`）加 batch create 行；② 单 `create-chg` 模板（`:123-126`）旁补 batch 多块模板（`--- CHG i/N ---` + change-set）；③ reserve helper 说明（`:322` / `:335`）补 `--count N`。

> 三个 skill（bridge / pace-workflow / artifact-management）的"CHG 闭环拆分原则"措辞详略不一（bridge 最全）。本设计只要求**语义覆盖对齐**（最小单元 + 领域拆分 + 独立验证/回滚/worktree + 闭环边界非层级合并），不强求逐字统一，避免 scope creep。

## 6. 测试策略

- **单元**（test-pace-utils）：reserve `--count N` 生成 N 个连号 reservation；`--count 1` 默认行为不变；非法 count fail-closed。change-set / change-set-seq frontmatter 解析。SessionStart change-set 聚合逻辑。
- **e2e**（test-hooks-e2e）：
  - batch create 带齐 N 块 → 放行；
  - 缺某块 reserved-id/title/tasks → DENY；
  - reserved-id 集合 ≠ 预留 N（漏/多/串）→ DENY；
  - 缺 change-set / total≠块数 → DENY；
  - SessionStart 注入含 change-set 进度；
  - Stop：change-set 有 planned + 无 in-progress → 可见软提醒 + **exit 0**（不阻断）；有 in-progress → 仍 exit 2（回归）；
  - 向后兼容：单 CHG 无 change-set、reserve 默认 count=1。
- **artifact-writer 契约测试**（agent-tests）：batch create 正确建 N 个文件 + N 对索引 + 各自 change-set/seq；中途失败报告部分成功。

## 7. 风险与边界

- **核心风险**：artifact-writer 一次建 N 个的正确性 → 由 §5.2 强模板 + 确定性校验双层兜底。
- **batch prompt 体积**：N 个 CHG 完整定义使 prompt 较大 → 可接受；artifact-writer 逐块处理。
- **部分失败**：batch 中途失败 → 报告已建/未建，未用 reservation 保留，可补派；不做自动回滚（已建的合法 CHG 保留）。
- **change-set slug 撞名**：主 session 起，软约束（同名不同变更理论可能但罕见）；不做唯一性强校验。
- **change-set-seq 与实际状态漂移**：seq 是创建时的静态标注；若后续插入/废弃某阶段，seq 可能与实际 CHG 数不符 → 接受（seq 是规划期快照，非动态状态机）。
