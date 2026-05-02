# PACEflow v6.0.0 接班 Ticket

> **生成日期**：2026-05-02
> **接班日期**：2026-05-03（建议）
> **状态**：v6.0.0 设计完成 + Phase A 测试通过 3/5，待 P0 修复 + B 方案
> **目标**：v6.0.0 发布前完成 P0 缺陷修复 + v5→v6 归档迁移 + Phase A 重测

---

## 0. 5 分钟必读

PACEflow 是基于 Claude Code Hooks + Skills + Agent 的工作流强制系统（v5.1.4 当前生产）。**v6.0.0 是设计中的新架构**，目标解决长期项目 artifact 膨胀痛点（ccauth 项目实测：写文档归档单 CHG 消耗 100K+ tokens）。

**v6.0.0 三块基石**（已设计、待实施）：
1. **索引-详情拆分架构**：主 artifact 仅含索引，详情在 `changes/` 子目录，Obsidian wikilink 关联
2. **paceflow-artifact-writer agent**：替代主 session 直接 Edit artifact，避免上下文膨胀
3. **v5→v6 归档式迁移（B 方案）**：零内容迁移，仅划边界（v5 全部推 ARCHIVE 下方，v6 从空白活跃区开始）

**当前进度**：
- 设计文档：100%（4 份已 commit）
- agent 实现：v3.1 双轨 + v6-only 副本均已 commit
- Phase A 测试：5 测试全跑，3/5 完美 + 2/5 发现 2 个 P0 缺陷
- 代码实施：0%（hook 改造、模板更新、迁移脚本均未开始）

---

## 1. 关键文档清单（按阅读顺序）

| # | 路径 | 内容 | 必读 |
|---|------|------|------|
| 1 | `docs/v5-archival-strategy.md` | **B 方案核心**，伪迁移设计 + batch-archive-v5.js 伪代码 | ★★★ |
| 2 | `docs/agent-design.md` § 附录 A 修订历史 | agent v1→v3.1 演进，决策依据 | ★★★ |
| 3 | `docs/agent-testing-strategy.md` § Phase A | 测试用例 + 验收标准 | ★★ |
| 4 | `docs/v6.0.0-design.md` | 架构设计（16 节 + 3 附录） | ★★ |
| 5 | `docs/action-plan-2026-05-02.md` | 行动项规划（17 节决策矩阵） | ★ |
| 6 | `agents/paceflow-artifact-writer-v6.md` | **v6-only 副本，所有测试用此 agent** | ★★★ |
| 7 | `agents/references/artifact-writer-spec.md` | 通用 schema / 索引行模板 / ARCHIVE | ★★ |
| 8 | `agents/references/instructions/archive-chg.md` | **TODO-1 必看，含待修复算法** | ★★★ |

---

## 2. 决策逻辑（关键 Why）

### 2.1 为什么做 v6.0.0
ccauth 项目实测：findings 45KB / impl_plan 381KB / task 152KB → 单 CHG 收尾 100K+ tokens。Edit 大文件 old_string 冲突 + ARCHIVE 双步骤精确匹配 + 跨 4 文件归档 = Edit 循环爆炸。

### 2.2 为什么放弃 v5 兼容
PACEflow 是单团队工具，不面向社区。双轨 agent / hook / spec 复杂度翻倍，错误面翻倍，测试矩阵翻倍。**v6.0.0 = breaking change，可接受**。

### 2.3 为什么选 B 方案（伪迁移）
- C 方案（完整内容迁移）需解析 v5 多种字段命名变体（findings 第 514 行 H-2 三套字段名混乱），复杂度高
- D 方案（subagent 批量迁移）token 不经济（PACEflow 360K / ccauth 1.8M）
- **B 方案仅移动 ARCHIVE 标记**，零解析成本，旧数据完整保留在归档区，30 行 Python 脚本搞定

### 2.4 为什么用 agent 而非 skill
skill 是建议性（CLAUDE.md 评估遵守率 70-85%），agent 是执行性（受限工具 + 缓存 system prompt）。artifact CRUD 是机械任务，agent 优于 skill。

### 2.5 为什么 spec/instructions 外移
外部调研：v2.0 agent.md 357 行 / 12KB 是官方示例 claude-guide-agent.md（68 行 / 3.31KB）的 3.6 倍，**违反 sub-agent 轻量化原则**。v3.0 拆分到 references/，v3.1 进一步拆 instructions/。

---

## 3. Git 状态

```
02cfc3f feat: v6-only agent + Phase A 测试策略 + B 方案归档式迁移文档
ec827f6 fix(agent): paceflow-artifact-writer v3.1 修复 PoC v3 发现的 4 个缺陷
b00ab37 refactor(agent): paceflow-artifact-writer v3.0 精简重构（357→179）
4e119ef docs: v6.0.0 索引-详情拆分架构设计 + 2026-05-02 行动项规划
```

**⚠️ 警告**：仓库有 30 个其他 modified 文件（历史遗留，与本次工作无关）。**git add 时仅指定本次相关文件，禁止 `git add .`**。

未推送 origin。

---

## 4. Phase A 测试结果（必看）

| 用例 | 通过 | Token | 状态 |
|------|-----|-------|------|
| TC-A1 create-chg | 6/7 | 24K（超预算 3 倍） | ⚠️ 功能 OK，token 因 v5 污染爆表 |
| TC-A2 update-chg | 4/6 | 28-32K | ⚠️ 同上 + CHG-ID 冲突重试 |
| TC-A3 archive-chg | 8/10 | 远超 18K | ❌ **P0-1 设计缺陷** |
| TC-A4 record-finding | 6/6 ✅ | 8K | 完美 |
| TC-A5 record-correction | 9/9 ✅ | 5K | 完美 |

**核心结论**：
1. agent 设计正确（A4/A5 完美）
2. 大文件污染是真实问题（A1/A2/A3 token 爆表 → **B 方案必修**）
3. 复杂归档场景有设计缺陷（A3 → **P0-1/P0-2 必修**）

---

## 5. 待办清单（按执行顺序）

### 🔴 Sprint 1：修 P0 设计缺陷（~1.5 小时）

#### TODO-1（P0）：修 ARCHIVE 双步骤算法

**问题位置**：`agents/references/instructions/archive-chg.md` L43-87 "双步骤标记移动"算法。

**问题**：在活跃区有多个独立 CHG 时，"在待归档行上方插入新 ARCHIVE，删除旧 ARCHIVE" 会**把后续活跃 CHG 也意外归档**。TC-A3 subagent 不得不退化为"实际移动行内容"。

**修复方向**：改为"实际移动行内容到 ARCHIVE 下方"，标记位置不变。

**改动文件**：
- `agents/references/artifact-writer-spec.md` §6 ARCHIVE 标记规则
- `agents/references/instructions/archive-chg.md` 操作步骤 + 双步骤详解段

**实施方式**：**主 session 直 Edit**（agent 不修自己的 spec）。

#### TODO-2（P0）：修 status 联动

**问题**：`update-chg` 仅改任务 [ ]→[x]，不动 frontmatter `status`。CHG 永远卡 `planned`，`archive-chg` 严格执行会因 `cannot archive in current status` 失败。

**修复方向**（3 选 1，**推荐 a**）：
- **(a) update-chg 全部任务 [x] 时自动同步 frontmatter status: completed**
- (b) archive-chg 放宽起点状态，允许从 planned 归档
- (c) 增加 commit-chg 指令明确状态过渡

**改动文件**（如选 a）：`agents/references/instructions/update-chg.md` 增加 update-status 子流程的"全完成检测"。

**实施方式**：主 session 直 Edit。

---

### 🟡 Sprint 2：B 方案脚本 + 执行（~1.5 小时）

#### TODO-3（P1）：写 batch-archive-v5.js

**位置**：`paceflow/migrate/batch-archive-v5.js`（新增 migrate/ 目录）

**伪代码**：见 `docs/v5-archival-strategy.md` §3.1（~50 行 Node.js）

**核心逻辑**：
1. 对 task.md / implementation_plan.md / walkthrough.md / findings.md 各做：
2. Read 文件，找现有 ARCHIVE 标记位置
3. 提取顶部"模板部分"（标题 + ## 段标题，不含历史内容）
4. 重组：模板 + 新 ARCHIVE 标记 + 原活跃区内容 + 原归档区内容
5. 备份 .v5-backup + 写入新内容

**测试**：
1. 先 dry-run：`cp -r vault /tmp/test && node batch-archive-v5.js /tmp/test --dry-run`
2. 真跑副本验证 4 文件结构
3. 通过后跑生产 vault

#### TODO-4（P1）：执行 B 方案到 PACEflow vault

跑 batch-archive-v5.js 在 `vault/projects/paceflow-hooks/`：
- 4 个主 artifact 活跃区清空（仅顶部模板）
- v5 历史推到 ARCHIVE 下方
- 4 个 .v5-backup 自动备份

**验证**：用 `docs/v5-archival-strategy.md` §4.1 的脚本检查 ARCHIVE 标记数量、行数差异、活跃区行数。

---

### 🟢 Sprint 3：B 方案 + P0 修复后重测 Phase A（~30 min）

#### TODO-5（P1）：派 5 个 v6-only agent 重测 Phase A

**期望结果**：5/5 PASS，token 5-8K 内（vs 之前 24-32K）。

**实施方式**：**派 paceflow-artifact-writer-v6 subagent**，主 session 不直接 Edit artifact。

如未达 5/5：
- 分析失败根因
- 决定是修 agent / spec / instructions 还是回滚 B 方案
- 记录 record-correction（root-cause 标 phase-a-retest-failure）

---

### 🔵 Sprint 4：删除 v5 兼容章节（~30 min）

#### TODO-6（P2）：合并 v6-only 副本到主 agent

操作：
- 将 `agents/paceflow-artifact-writer-v6.md` 重命名为 `paceflow-artifact-writer.md`（覆盖双轨版）
- 删除 `agents/references/artifact-writer-spec.md` §7 v5.x 兼容规则
- 删除 5 个 `instructions/*.md` 中的 v5 子流程
- 升级 frontmatter 标记为 v4.0（breaking change）

---

### 🟣 Sprint 5：v6.0.0 发布准备（~3 小时）

#### TODO-7（P2）：版本 bump

- `pace-utils.js` PACE_VERSION → "6.0.0"
- `bump-version.js 6.0.0` 同步 6 文件
- `CHANGELOG.md` 写 v6.0.0 节
- `README.md` 更新架构说明
- 新建 `docs/migration-guide-v5-to-v6.md`

#### TODO-8（P3）：v6.0.0 dogfood 1 周

PACEflow 自身使用 paceflow-artifact-writer 处理所有 artifact 操作。每周收集：调用次数 / 一次成功率 / 平均 token / 失败模式。

#### TODO-9（P3）：决策 ccauth 等其他项目

用户决策时机。

---

## 6. 实施铁则

### 6.1 主 session 不直接 Edit artifact ⛔

**所有 artifact 操作必须派 paceflow-artifact-writer-v6 agent**。直接 Edit 是反模式（本次会话已实证：累积 30+ Edit 导致主上下文膨胀）。

例外：修 agent 自己的 spec / instructions / system prompt（agent 不修自己）。

### 6.2 Hook 不要绕过 ⛔

hook 阻止时：
1. AskUserQuestion 询问处理方式
2. agent 处理产出
3. **禁止** `--no-verify` 类绕过

### 6.3 commit 范围严格 ⛔

仓库 30 个 modified 文件是历史遗留。**仅 git add 本次任务文件**，禁止 `git add .` / `git add -A`。

---

## 7. vault 当前 PoC 产物（保留）

PACEflow vault `vault/projects/paceflow-hooks/` 含 9 个 PoC 文件：

```
changes/chg-20260502-01-poc.md           # PoC v1（主 session 设计验证）
changes/chg-20260502-02.md               # TC-A1（agent 测试）
changes/chg-20260502-03.md               # TC-A3（agent 测试，已归档）
changes/chg-20260502-04.md               # TC-A2（agent 测试）
changes/findings/finding-2026-05-01-paceflow-artifact-writer-poc.md      # PoC v1
changes/findings/finding-2026-05-01-paceflow-artifact-writer-v2-validation.md  # PoC v2
changes/findings/finding-2026-05-02-tc-a4-...md                           # TC-A4
changes/corrections/correction-2026-05-02-01-subagent-prompt-bloat.md     # PoC v3
changes/corrections/correction-2026-05-02-02-phase-a-test-char-boundary.md  # TC-A5
corrections.md                            # PoC v3 创建（v6.0.0 corrections 索引文件首次）
```

均已在 task.md / impl_plan.md / findings.md / corrections.md 索引为 [-] 保持现状（含 ≥10 字理由）。**保留作 v6.0.0 演示证据**。

---

## 8. 元洞察（务必内化）

1. **PACEflow 自身的开发流程就是它要解决的问题**——本次会话累积 30+ Edit / 多次 Read / 上下文膨胀，正是 ccauth 用户痛点的复现
2. **B 方案 + agent 分流是关键减压器**——主 session 不直接 Edit artifact 后立即缓解 80% 痛苦
3. **PoC 产物即真实数据**——不要因为是"测试"就轻视，它们就是 v6 数据流的真实样本
4. **A4/A5 完美 vs A1/A3 困难** = 小文件 OK / 大文件 + 复杂归档难 → B 方案归档让所有场景变小文件
5. **设计三块基石齐全后，实施才是真正的开始**——不要被设计文档完成度迷惑

---

## 9. 不确定项与默认决策

| # | 问题 | 默认 | 触发再决策 |
|---|------|------|----------|
| 1 | TODO-2 选 a/b/c | a（update-chg 自动同步） | 实施时发现 a 复杂度高 |
| 2 | TODO-6 v6-only 副本是合并还是删 | 合并到主 agent | 用户偏好分开 |
| 3 | PoC 产物保留还是清理 | 保留（已 [-]） | vault 体积压力 |
| 4 | ccauth 是否同步迁移 | 延后 | PACEflow 验证后用户决定 |
| 5 | 是否升 v4.0 标记 breaking | 是 | 用户偏好沿用 v3.x |

---

## 10. 接班 5 分钟启动命令

```bash
cd /mnt/k/AI/paceflow-hooks/paceflow

# 看 git 历史
git log --oneline -10

# 看本 ticket
cat ticket.md

# 读 3 个核心文档（30 min 内）
less docs/v5-archival-strategy.md      # B 方案（最高优先）
less docs/agent-design.md              # agent 设计修订史
less docs/agent-testing-strategy.md    # 测试策略

# 启动 Sprint 1 TODO-1：
# 主 session 直接 Edit
#   agents/references/instructions/archive-chg.md L43-87
#   agents/references/artifact-writer-spec.md §6
```

---

## 11. 质询点（Phase A 暴露但本次未深究）

如果时间允许，进一步调研：

1. **CHG-ID 并发推算的 race condition**（TC-A2 实测）：5 subagent 并发扫 changes/ 都得相同 max → 都申请 +1 → Write 冲突。需要在 instructions/create-chg.md 加"Write 失败后重新扫描重试"。
2. **大文件 Read 策略对 task.md / walkthrough.md 同样需要**：当前 system prompt 仅对 findings.md 提"grep + offset Read"。B 方案归档后此问题缓解，但应同步更新 prompt。
3. **PostToolUse v5 风格 TodoWrite 提醒**在 v6 项目仍出现：不影响功能但增加 noise。需要 hook 改造或 agent 静音处理。

---

## 12. 联系/参考

| 资源 | 位置 |
|------|------|
| 完整决策矩阵 | `docs/action-plan-2026-05-02.md` §17 + §13.13 |
| v6.0.0 完整设计 | `docs/v6.0.0-design.md` 16 节 + 3 附录 |
| agent 设计修订史 | `docs/agent-design.md` 附录 A 修订历史 |
| B 方案细节 | `docs/v5-archival-strategy.md` |
| 测试策略 | `docs/agent-testing-strategy.md` 5 Phase |
| 已 commit 的 v6 实现 | git log 4 commits（4e119ef → 02cfc3f） |
