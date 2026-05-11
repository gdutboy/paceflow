# PACEflow v6.0.0 接班 Ticket

> **生成日期**：2026-05-02（最近大更新 2026-05-04 01:15）
> **接班日期**：2026-05-04（建议）
> **状态**：agent 稳定性 100% 验证（Tier 1-3 完成，48 runs baseline），下一战略瓶颈 hooks v6 适配
> **目标**：v6.0.0 发布前完成 hooks v6 适配 + v5→v6 归档迁移 + 版本 bump

---

## 0. 5 分钟必读

PACEflow 是基于 Claude Code Hooks + Skills + Agent 的工作流强制系统（v5.1.4 当前生产）。**v6.0.0 是设计中的新架构**，目标解决长期项目 artifact 膨胀痛点（ccauth 项目实测：写文档归档单 CHG 消耗 100K+ tokens）。

**v6.0.0 三块基石**：
1. **索引-详情拆分架构**：主 artifact 仅含索引，详情在 `changes/` 子目录，Obsidian wikilink 关联
2. **paceflow-artifact-writer agent**：替代主 session 直接 Edit artifact，避免上下文膨胀（**v4.0 已稳定，48 runs 100% PASS**）
3. **v5→v6 归档式迁移（B 方案）**：零内容迁移，仅划边界

**当前进度**（2026-05-04 01:15）：
- ✅ 设计文档：100%（4 份已 commit）
- ✅ agent 实现：v4.0 稳定（Tier 1-3 完成 8 项 spec/verify 修复）
- ✅ agent 测试：Phase A 7 用例 + Phase B 9 用例 × 3 = 48 runs，**16/16 functional 100% PASS**
- ✅ variance baseline：tokens spread 平均 7-30%（vs 修前 540%），最佳 0.5%（TC-B2）
- ❌ **hooks v6 适配未做**（最大战略瓶颈，§5 #1）
- ❌ B 方案脚本未写（§5 #2）
- ❌ 版本 bump 未做（§5 #3）

**最近 commits（2026-05-03 全程）**：
- `f412ae6` Tier 3：输出契约第二轮迭代 + 失败码封闭枚举 + verify default strict
- `99f6ac2` Tier 2：4 项 spec 模糊修复 + Phase A/B 6 用例补全
- `22cd06b` Tier 1：消除 record-finding §边界 与 §8 wikilink 校验矛盾
- `05cd0ed` 测试报告（截至 Tier 0）
- `9326f67` Phase B/D + verify 双 bug 修
- `ad27ae5` 测试框架 Sprint 3
- `2b71903` TODO-1/2 ARCHIVE 算法 + status 联动
- `ab0947a` TODO-6 删除 v5 兼容（v4.0 breaking）

---

## 1. 关键文档清单（按阅读顺序）

| # | 路径 | 内容 | 必读 |
|---|------|------|------|
| 0 | `docs/agent-testing-report-2026-05-03.md` | 完整测试报告（截至 Tier 0 修 4 + verify 双 bug，未含 Tier 1-3）| ★★★ |
| 0b | 本 ticket §4 + `tests/agent-tests/results/2026-05-03/*.variance.json` | **Tier 1-3 详细数据（48 runs baseline）** | ★★★ |
| 1 | `docs/v5-archival-strategy.md` | **B 方案核心**，伪迁移设计 + batch-archive-v5.js 伪代码 | ★★★ |
| 2 | `docs/v6.0.0-design.md` | 架构设计（16 节 + 3 附录） | ★★ |
| 3 | `docs/agent-design.md` § 附录 A | agent v1→v4 演进决策依据 | ★★ |
| 4 | `docs/agent-testing-strategy.md` | Phase A-E 测试策略 | ★★ |
| 5 | `agents/paceflow-artifact-writer.md` | **agent v4.0**（含 Tier 1-3 全部修复） | ★★★ |
| 6 | `agent-references/artifact-writer-spec.md` | schema / 索引行模板 / ARCHIVE / hashtag 与 type 对齐 | ★★ |
| 7 | `agent-references/instructions/*.md` | 5 类指令（含 record-finding §边界 lex specialis / update-chg id-mismatch） | ★★ |

---

## 2. 决策逻辑（关键 Why）

### 2.1 为什么做 v6.0.0
ccauth 项目实测：findings 45KB / impl_plan 381KB / task 152KB → 单 CHG 收尾 100K+ tokens。Edit 大文件 old_string 冲突 + ARCHIVE 双步骤精确匹配 + 跨 4 文件归档 = Edit 循环爆炸。

### 2.2 为什么放弃 v5 兼容
PACEflow 是单团队工具，不面向社区。双轨复杂度翻倍。**v6.0.0 = breaking change，可接受**。

### 2.3 为什么选 B 方案（伪迁移）
- C 方案（完整迁移）需解析 v5 多种字段命名变体，复杂度高
- D 方案（subagent 批量迁移）token 不经济
- **B 方案仅移动 ARCHIVE 标记**，零解析成本，30 行 Node.js 脚本搞定

### 2.4 为什么用 agent 而非 skill
skill 是建议性（70-85%），agent 是执行性（受限工具 + 缓存 system prompt）。**Tier 1-3 验证：48/48 functional PASS**。

### 2.5 spec 修复路径（Tier 1-3 经验）
**消除矛盾 → 消除模糊 → 消除推理变体**（Tier 1→2→3）逐层收紧。spec 修复比文字调教 ROI 高 10 倍。

---

## 3. Git 状态

```
f412ae6 fix(spec+verify): Tier 3 — 输出契约第二轮迭代 + 失败码封闭枚举 + verify default strict
99f6ac2 fix(spec+tests): Tier 2 — 4 项 spec 模糊修复 + Phase A/B 6 用例补全
22cd06b fix(spec): 消除 record-finding §边界 与 §8 wikilink 校验矛盾
05cd0ed docs(test-report): 2026-05-03 paceflow-artifact-writer 完整测试报告
9326f67 feat(agent+tests): Phase B/D + spec 4修+ runner 升级 + verify 双 bug 修
ad27ae5 feat(tests): Sprint 3 TODO-5a paceflow-artifact-writer 测试框架
85dfc1f docs(ticket): Sprint 3 加 TODO-5a 测试框架前置 + §11 质询点 4 hooks v6 适配缺口
a58fb42 feat(agent): 加固质询点 1+2（CHG-ID 并发 + 大文件 Read 通用化）
23989a6 feat(agent): references 路径用 ${CLAUDE_PLUGIN_ROOT} 绝对路径
ab0947a refactor(agent): TODO-6 删除 v5 兼容章节，paceflow-artifact-writer v4.0 (breaking)
2b71903 fix(agent): TODO-1/2 修 ARCHIVE 内容移动算法 + update-chg status 联动
02cfc3f feat: v6-only agent + Phase A 测试策略 + B 方案归档式迁移文档
```

**⚠️ 警告**：仓库有 30 个其他 modified 文件（历史遗留，与本次工作无关）。**git add 时仅指定本次相关文件，禁止 `git add .`**。

未推送 origin。

---

## 4. Tier 1-3 测试与修复成果（2026-05-03 完成）

### 4.1 8 项 spec / verify 修复演进（每项均 × 3 验证）

| Tier | Commit | 修复 | 验证 |
|------|--------|------|------|
| Tier 1 | `22cd06b` | record-finding §边界 加 related-changes 豁免（消除 §6.2 vs §8 矛盾，加 lex specialis 关系段）| TC-D5 × 3 全 PASS（duration spread 540%→62%）|
| Tier 2 #1 | `99f6ac2` | 输出契约"含失败/拒绝"明确 + 失败码列表删 unknown-operation | B6 × 3 完美 |
| Tier 2 #2 | `99f6ac2` | update-chg §边界加 id-mismatch + action 不在枚举 → format-violation | B6/B8 完美 |
| Tier 2 #3 | `99f6ac2` | spec §5.1 加 hashtag 与 type 对齐注释（type=hotfix → #hotfix）| A6 完美 |
| Tier 3 #1 | `f412ae6` | 输出契约第二轮：第一行字面 + 简单/复杂同等适用 + 详细禁止变体 | A2 × 3 完美（spread 3.7%）|
| Tier 3 #2 | `f412ae6` | 加 §v6 架构约束反向锚定（禁 v5 双区 fallback + 强制 changes/<chg-id>.md）| A1 v5 退化 0/3 复现 |
| Tier 3 #3 | `f412ae6` | 失败码封闭枚举 + step 1 显式禁用 unknown-operation | B7 × 3 全 out-of-scope |
| Tier 3 #4 | `f412ae6` | verify-output.js report_title_strict 默认值 | 11 yaml 自动启用机械检查 |

### 4.2 Tier 3 完整 variance baseline（48 runs / 16 用例）

| 用例 | tokens spread | 备注 |
|------|--------------|------|
| TC-B2 target-not-found | **0.5%** | over-investigation 反模式根治 |
| TC-B9 not-pace-project | 1.4% | 1 tool 早退 |
| TC-B1 missing-fields | 3.1% | 0-1 tool 早退 |
| TC-A2 update-chg | 3.7% | 标题契约第二轮迭代生效 |
| TC-B3 archive-blocked | 3.7% | format-violation 早退 |
| TC-A4 record-finding | 5.6% | 极稳定基线 |
| TC-A1 create-chg | 5.8% | v6 详情 + 索引 |
| TC-A7 merges | 4% | merges 双写一致 |
| TC-B6 id-mismatch | 5% | spec §边界条款生效 |
| TC-A5 record-correction | 7% | knowledge-link 归一 |
| TC-A6 hotfix | 7% | hashtag/前缀对齐 |
| TC-B7 out-of-scope (final) | 9% | 修 #2 第二轮生效 |
| TC-B8 unknown-operation | 24% | format-violation 自检 |
| TC-B5 wrong-behavior 短 | 25% | 字段长度自检方式不同 |
| TC-A3 archive-chg | 27% | 4 文件归档复杂 |
| TC-B4 summary 长 | 33% | 字段长度自检方式不同 |

**核心结论**：16/16 functional 100% PASS。spec 矛盾/模糊消除 = agent 推理依赖消除 = 结果稳定。

### 4.3 PACEflow 双层防御原则（Tier 1-3 验证）

| 层 | 角色 | Tier 1-3 演进 |
|----|------|-------------|
| **agent / spec**（模型层）| 70-85% 建议 | 8 项 spec/verify 修复（消除矛盾 + 模糊 + 反模式锚定）|
| **verify**（机械层）| 100% 兜底 | report_title_strict default + failure_reason_pattern + max_tokens |

---

## 5. 剩余工作（按 ROI 排序）

### 🔴 P1：v6.0.0 发布前必修

#### 5.1 hooks v6 适配（最大战略瓶颈，~3-5h）

**位置**：`hooks/pre-tool-use.js` / `stop.js` / `post-tool-use.js`

**问题**（原 §11 质询点 4）：v5 时代 hooks 强制保障 PACE 流程合规（pre-tool-use.js L144 impl_plan 详情守门 / stop.js L113 findings 详情终态 / C 阶段 APPROVED 检查 / V 阶段 VERIFIED 检查）。v6 索引-详情拆分后，详情移到 `changes/chg-xxx.md` 独立文件，hook 检查 `### CHG-ID` 段或 task.md 内 `<!-- APPROVED -->` 的逻辑可能误报或漏报。

**影响**：当前 v6 数据流下，hook 保障层处于"半瘫痪"状态——主 session 跳步骤风险重新出现。

**修复范围**：
1. pre-tool-use.js L144：impl_plan 详情守门改为检查 `changes/<chg-id>.md` 详情文件存在
2. stop.js L113：findings 详情终态改为检查 `changes/findings/finding-*.md` frontmatter `status` 字段
3. APPROVED 检查：从 task.md 内联 `<!-- APPROVED -->` 改为 `changes/<chg-id>.md` 内的 `<!-- APPROVED -->`
4. VERIFIED 检查：同上路径调整
5. PostToolUse v5 风格 TodoWrite 提醒：在 v6 项目静音处理（原 §11 质询点 3）

**实施方式**：主 session 直 Edit hooks（hooks 是脚本不是 artifact，agent 不操作）

#### 5.2 B 方案实施（PACEflow 自身上 v6，~1.5h）

##### 5.2.1 写 batch-archive-v5.js

**位置**：`paceflow/migrate/batch-archive-v5.js`（新增 migrate/ 目录）

**伪代码**：见 `docs/v5-archival-strategy.md` §3.1（~50 行 Node.js）

**核心逻辑**：
1. 对 task.md / implementation_plan.md / walkthrough.md / findings.md 各做：
2. Read 文件，找现有 ARCHIVE 标记位置
3. 提取顶部"模板部分"（标题 + ## 段标题，不含历史内容）
4. 重组：模板 + 新 ARCHIVE 标记 + 原活跃区内容 + 原归档区内容
5. 备份 .v5-backup + 写入新内容

**测试**：
1. dry-run：`cp -r vault /tmp/test && node batch-archive-v5.js /tmp/test --dry-run`
2. 真跑副本验证 4 文件结构
3. 通过后跑生产 vault

##### 5.2.2 执行 B 方案到 PACEflow vault

跑 batch-archive-v5.js 在 `vault/projects/paceflow-hooks/`：
- 4 个主 artifact 活跃区清空（仅顶部模板）
- v5 历史推到 ARCHIVE 下方
- 4 个 .v5-backup 自动备份

**验证**：用 `docs/v5-archival-strategy.md` §4.1 的脚本检查 ARCHIVE 标记数量、行数差异、活跃区行数。

### 🟡 P2：发布完成

#### 5.3 版本 bump v6.0.0（~30min）

- `pace-utils.js` PACE_VERSION → "6.0.0"
- `bump-version.js 6.0.0` 同步 6 文件
- `CHANGELOG.md` 写 v6.0.0 节
- `README.md` 更新架构说明
- 新建 `docs/migration-guide-v5-to-v6.md`

### 🟢 P3：测试增强（可选）

#### 5.4 Phase C 集成场景 × 3（~600K token）

5 步 lifecycle（create → update [/] → append work-record → update [x] × N → archive），验证多 step 串行 + cache 复用稳定性。

#### 5.5 修 TC-D4 background mode bug

Agent tool `run_in_background` 参数 boolean 类型校验拒绝（"expected as boolean but provided as string"）。需调研 Claude Code Agent tool schema。

#### 5.6 Phase E dogfood（持续）

PACEflow 自身 v6.0.0 上线后每个 CHG/finding/correction 都派 agent。每周收集：调用次数 / 一次成功率 / 平均 token / 失败模式。

---

## 6. 实施铁则

### 6.1 主 session 不直接 Edit artifact ⛔

所有 artifact 操作必须派 paceflow-artifact-writer agent。例外：修 agent 自己的 spec / instructions / system prompt。

### 6.2 Hook 不要绕过 ⛔

hook 阻止时：(1) AskUserQuestion 询问 (2) agent 处理产出 (3) **禁止** `--no-verify` 类绕过。

### 6.3 commit 范围严格 ⛔

仓库 30 个 modified 文件是历史遗留。**仅 git add 本次任务文件**，禁止 `git add .` / `git add -A`。

### 6.4 plugin cache 同步（agent 修改后）

```bash
cp /mnt/k/AI/paceflow-hooks/paceflow/agents/<file> \
   /home/paceaitian/.claude/plugins/cache/paceaitian-paceflow/paceflow/5.1.4/agents/<file>
```

agent 修改后必须同步到 plugin cache，否则 Agent tool 派遣加载的是旧版本。

---

## 7. vault 当前 PoC 产物（保留）

PACEflow vault `vault/projects/paceflow-hooks/` 含 9 个 PoC 文件（2026-05-02 阶段产物）：

```
changes/chg-20260502-01-poc.md           # PoC v1
changes/chg-20260502-02.md               # TC-A1
changes/chg-20260502-03.md               # TC-A3 已归档
changes/chg-20260502-04.md               # TC-A2
changes/findings/finding-2026-05-01-paceflow-artifact-writer-poc.md
changes/findings/finding-2026-05-01-paceflow-artifact-writer-v2-validation.md
changes/findings/finding-2026-05-02-tc-a4-...md
changes/corrections/correction-2026-05-02-01-subagent-prompt-bloat.md
changes/corrections/correction-2026-05-02-02-phase-a-test-char-boundary.md
corrections.md                            # PoC v3 创建
```

均已在 task.md / impl_plan.md / findings.md / corrections.md 索引为 [-] 保持现状（含 ≥10 字理由）。**保留作 v6.0.0 演示证据**。

---

## 8. 元洞察（务必内化）

1. **PACEflow 自身的开发流程就是它要解决的问题**——会话内累积 30+ Edit / 多次 Read / 上下文膨胀正是 ccauth 用户痛点的复现
2. **B 方案 + agent 分流是关键减压器**——主 session 不直接 Edit artifact 后立即缓解 80% 痛苦
3. **PoC 产物即真实数据**——它们就是 v6 数据流的真实样本
4. **Tier 1-3 经验：spec 修复 > 文字调教**——"消除矛盾 → 消除模糊 → 消除推理变体"3 步走，每步都能让 agent 行为更稳定。文字调教（修 #1 第一轮）3 次迭代不及结构化修复（Tier 1 一次）
5. **修 #2 unknown-operation 经历 2 轮迭代才生效**——印证"顶级 system prompt 段位置 > 中段 > 末段"教训：第一轮删失败码列表不够，第二轮加封闭枚举显式禁止才生效
6. **agent 测试发现的不稳定 ≠ 必然修文字 spec**——可考虑 mechanical 层（verify-output）兜底（双层防御原则）

---

## 9. 接班 5 分钟启动命令

```bash
cd /mnt/k/AI/paceflow-hooks/paceflow

# 看 git 历史
git log --oneline -12

# 看本 ticket
cat internal/audit-tickets/ticket.md

# 重点读 3 文档
less docs/agent-testing-report-2026-05-03.md  # Tier 0 测试报告
less docs/v5-archival-strategy.md              # B 方案
less internal/audit-tickets/ticket.md           # §4 / §5 看完整进度

# 启动 P1 #1：hooks v6 适配
# 先 grep 当前 hook 中的 v5 双区结构假设：
grep -n "ARCHIVE\|APPROVED\|impl_plan\|findings.md" hooks/pre-tool-use.js hooks/stop.js hooks/post-tool-use.js

# 启动 P1 #2：B 方案脚本
less docs/v5-archival-strategy.md  # §3.1 伪代码
mkdir -p paceflow/migrate
# 写 paceflow/migrate/batch-archive-v5.js
```

---

## 10. 联系/参考

| 资源 | 位置 |
|------|------|
| 完整决策矩阵 | `docs/action-plan-2026-05-02.md` §17 + §13.13 |
| v6.0.0 完整设计 | `docs/v6.0.0-design.md` 16 节 + 3 附录 |
| agent 设计修订史 | `docs/agent-design.md` 附录 A 修订历史 |
| B 方案细节 | `docs/v5-archival-strategy.md` |
| 测试策略 | `docs/agent-testing-strategy.md` 5 Phase |
| Tier 0 测试报告 | `docs/agent-testing-report-2026-05-03.md` |
| Tier 1-3 数据 | `tests/agent-tests/results/2026-05-03/*.variance.json` + 本 ticket §4 |
| 已 commit 的 v6 实现 | git log 12 commits |
