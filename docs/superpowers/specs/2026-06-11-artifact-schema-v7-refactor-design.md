# Artifact 体系 v7 大重构设计（schema 瘦身 + 双文件合并 + 规范单源化 + vault 卫生）

> 日期：2026-06-11
> 状态：设计获批（用户逐议题裁定 + 整体确认）
> 事实基础：
> - `changes/findings/finding-2026-06-11-artifact-schema-audit-hook-consumption-bloat-dead.md`（三维度审计八节全景）
> - `changes/findings/finding-2026-06-10-task-md-impl-plan-md-duplicate-index-after-v6.md`（双文件问题）
> - `docs/artifact-locking-reference.md`（index-transaction 与双文件耦合）
> - 本 spec 附录 A：implementation_plan 全消费点盘点（2026-06-11 Explore agent 实测）

---

## 1. 目标与原则

把 v6 artifact 体系收敛到「写的每个字段都有读者」：hook 消费集为机器权威、人读字段显式保留、其余删除；双索引文件合并为单索引；规范单源化消灭 A1 类漂移（v6.6.2 改 4 处唯独漏 agent 契约的同步事故）。

- schema bump `"7.0"`，plugin bump `v7.0.0`，**单版本一次到尾**（用户裁定：上下文热时连续执行不留尾巴，前提是 spec 把所有事情搞清楚——本 spec 即兑现）。
- **读端先行**：hook 先兼容两种布局（双文件未迁移 / 已迁移单文件），再动写端；CHG 粒度上 A/B（读端）先于 C（写端）。
- **migrate 用户触发**：复用 v5→v6 的 dry-run + 确认 + migration-state 模式，绝不自动改用户数据。
- **删除的都是零消费字段**：新旧 hook 都不读，存量 migrate 对 cache 窗口里的旧 hook 安全。
- **确定性网关 > LLM-soft**：schema 合同由 hook 校验（§3.5），不靠 agent 指令自觉。

### 1.1 用户裁定记录（2026-06-11 AskUserQuestion）

| 议题 | 裁定 |
|---|---|
| 双文件方向 | 合并单索引：保留 task.md，implementation_plan.md 退役 |
| frontmatter 瘦身 | 激进瘦身 + 保留人读字段（判据：本体可找即删；点名保创建/归档时刻） |
| 存量兼容 | migrate 脚本全量（80 CHG + 18 finding + 10 correction 一次刷 7.0） |
| 单源化 | 指针化 + 测试锁 |
| vault 卫生 | 混合处置（脏数据 migrate 修 / 备份删 / 游离文档移 `_archive/`） |
| 发布编排 | 单版本 7.0 一把梭（用户原话：一次性到尾不留尾巴） |
| worktree/branch 条件写入 | **撤回**，维持恒写（用户质询后裁定，见 §3.4） |
| schema 合同 | **新增原则**（用户提出）：敲定字段必须存在，不写入即非法（见 §3.5） |

---

## 2. 双文件合并设计

### 2.1 终态布局

- `task.md` 是唯一 CHG/HOTFIX 索引（活跃区 + ARCHIVE 区），格式不变。
- `implementation_plan.md` 由 migrate 改写为 **tombstone**：

```markdown
# 实施计划（已退役）

> v7.0 起本文件退役，CHG/HOTFIX 索引统一见 [[task]]。本文件保留仅为旧版本兼容。

<!-- ARCHIVE -->
```

tombstone 保留 `<!-- ARCHIVE -->` 标记的原因：cache 未升级的旧 hook 的 ARCHIVE 双区结构检测（`checkArchiveFormat`，`ARCHIVE_REQUIRED_FILES` 路径）静默通过。旧 session 并发时旧 hook 的跨索引一致性校验最坏产生软 repair warning（task.md 活跃集 vs tombstone 空集不一致），不 deny、不 brick。

### 2.2 hook 读端改动（CHG-A）

按附录 A 盘点逐处处置：

| 消费点 | 处置 |
|---|---|
| 跨索引一致性校验：`pre-tool-use.js:1439`（deny 理由）、`post-tool-use.js:194-197`（写后检查）、`stop.js:218-232`（修复提示 5 处）、`implBySlug` join | 整体退役删除 |
| `session-start/layers.js` 注入 10 处（ARTIFACT_BLOCK_PRIORITY、renderArtifactFiles 截断、格式警告 3 处） | impl_plan 从注入与格式警告中移除，只注入 task.md |
| `session-start/collect-state.js:82`（readFull impl_plan） | 删除读取；新增「未迁移布局检测」（见 §5.3） |
| `constants.js` `ARTIFACT_FILES` | 移除 `implementation_plan.md` |
| `pre-tool-use.js:40` `PROTECTED_ARTIFACTS`（派生自 ARTIFACT_FILES） | **显式加回 `implementation_plan.md`**——tombstone 与未迁移存量仍受「主 session 不得直写」保护；`bash-guard.js` / `powershell-guard.js` 遍历同集合，同步确认 |
| `constants.js` `ARCHIVE_REQUIRED_FILES` / `MIGRATABLE_ARTIFACT_FILES` | 移除 impl_plan（7.0 hook 不再要求其双区结构） |
| `constants.js` `FORMAT_SNIPPETS.implIndex` / `implDetail` + 下游（pre-tool-use:1621、layers:829/832、post-tool-use:249） | 退役删除，下游文案改引用 taskEntry |
| `SESSION_SCOPED_FLAGS` 中 `impl-archive-reminded` | 退役删除 |
| `pace-utils.js:331-370` `legacyV5FilesInDir` v5 检测 | **不动**——服务 v5→v6 迁移路径，v5 双文件特征检测仍需读 impl_plan |

### 2.3 锁机制改动（CHG-A）

- `locks.js:237` `artifactResourceForRel`：`task.md` **保留资源名 `index:changes`**（不可改名——旧版本并发 session 用旧名锁同一文件，改名会使新旧两把锁互不互斥，并发写 task.md 保护失效），只退役双 touched 事务语义；impl_plan 不再映射（tombstone 受 PROTECTED 保护，artifact-writer 不再写它）。
- `locks.js:667` `markIndexChangesTouchedAndMaybeRelease` + `locks.js:691` `readArtifactIndexTransaction` + `.pace/index-transactions/` 目录：**整体退役**。PostToolUse 对 task.md 改走通用 `releaseArtifactResourceLock` 路径。
- resource lock 本身保留——单文件写互斥仍然需要（两 agent 并发写 task.md 的互斥语义不变）。
- 残留 `.pace/index-transactions/` 目录由 W 系列 sweep 或 migrate 清理。

### 2.4 agent 写端改动（CHG-C）

- 4 个 instruction（create-chg / update-chg / close-chg / archive-chg）中所有「Edit task.md 和 implementation_plan.md」步骤改为只写 task.md。
- agent.md、artifact-writer-spec.md、templates 同步（含 `parent-impl` 字段定义删除）。
- **未迁移窗口期取舍（已确认）**：用户装 7.0 未跑 migrate 时，agent 单写使 impl_plan 活跃区渐渐漂移——7.0 读端不消费它，漂移**无机械后果**，仅人读过时；由未迁移提示（§5.3）压缩窗口。放弃「agent 按布局分支双写」的零漂移方案（复杂度高、兼容分支永久留存，YAGNI）。

---

## 3. frontmatter 7.0 schema

### 3.1 字段表（保留 / 删除）

| 帧 | 保留 | 删除 |
|---|---|---|
| CHG/HOTFIX | `status`、`date`（创建，人读）、`verified-date`、`reviewed-date`、`archived-date`（人读，本体唯一不可推导日期）、`change-set`、`change-set-seq`（**key 恒在**，仅 batch 创建时值非 null——CHG-09 审计 P1 修正：6.0 规格「单 CHG 省略这两行」措辞废止，7.0 封闭合同下省略 = missing-key 非法）、`parent-tasks`、`schema-version: "7.0"` | `chg-id`、`type`、`completed-date`、`aliases`、`tags`、`related-finding`、`parent-impl` |
| finding | `status`、`date`（aged 14 天检测消费）、`schema-version` | `finding-id`、`type`、`impact`、`summary`（索引行同名字段为权威）、`merges`、`merged-by`、`related-changes`、`rejection-reason` |
| correction | `date`、`schema-version` | `correction-id`、五文本字段 trigger-quote/wrong-behavior/correct-behavior/trigger-scenario/root-cause（正文 6 段单源）、`aliases`、`tags`、`knowledge-link`（索引行 `[knowledge::]` + 正文承载） |

删除理由对照审计：帧内 ID 从文件名推导（`detailPathForId`）；type 由文件名前缀判定（change-id.js）；finding 帧 impact/summary 被索引行取代（注入只读索引行）；merge 家族 18/18 全空、机制有 schema 无实例；correction 五文本字段 hook 对已落盘帧零消费且与正文重复。

关联关系一律走正文 wikilink（`## 关联` / `## 关联调研` 段），Obsidian 反链照样生效——符合用户判据「本体可找即删」。

### 3.2 人读字段保留理由

- `date`（每帧统一）：创建日期。文件名虽含日期，但 Obsidian properties 面板直读的人体工学优于从文件名解析；成本一行。
- `archived-date`（CHG 帧）：归档时刻在本体内无任何其他来源（status: archived 只说终态不说何时），唯一不可推导的人读日期。
- cancelled CHG：取消归档时写 `archived-date`，根治审计吐槽的「cancelled 文件四日期字段恒 null」。

### 3.3 索引行 7.0

- findings.md 表头补 `[change::]` 第三字段声明（实际已存在使用，表头未声明）。
- correction 索引 `[knowledge::]` 只放真 knowledge wikilink；project-only 场景改用 `[scope:: project-only]`（修正 correction-04/05 两行语义失真）。
- `schema-version` 存在性校验从仅 CHG 路径补全到 finding/correction 路径（migrate 后全量 7.0，校验便宜）。

### 3.4 worktree/branch 维持恒写（撤回条件写入）

链路事实：值由 `reserve-artifact-id.js`（确定性脚本）产生于 `execution-context`，写入由 artifact-writer 照抄。条件写入会使「字段缺失」从可检测异常态变为合法态，读端永远无法区分「合法省略」与「AI 漏写」——feature worktree 中漏写会被缺省语义误判为 main/master，walkthrough 一致性校验与 owner 归属错判且不可检出。收益仅每行 ~30 字符。**裁定：维持恒写，hook 读端零改动；审计第六节「恒值噪音」记 accepted**——噪音是恒写换取可检测性的合理成本。

### 3.5 Schema 合同（用户新增原则）

**7.0 字段集是封闭合同：该有的缺失 = 非法，不该有的出现 = 非法**，两者都报 `format-violation`（走现有 repair 提醒通道，不 deny 写码）。多余字段也报——aliases/tags 类摆设字段当年即无人校验慢慢滋生，封闭合同根治复发。

阶段性字段与 status 状态机绑定（「必须存在」与生命周期的统一）：

| status | CHG 帧必填集 |
|---|---|
| planned / in-progress | `status`、`date`、`parent-tasks`、`schema-version`（+ batch 创建时 `change-set`、`change-set-seq`） |
| completed | 上行 + `verified-date`/`reviewed-date` 与 `<!-- VERIFIED -->`/`<!-- REVIEWED -->` 标记同在同缺（现有双表示不变量不变） |
| archived | 上行 + `archived-date` |
| cancelled | 基础集 + `archived-date` |

finding 必填集：`status`、`date`、`schema-version`。correction 必填集：`date`、`schema-version`。

校验三层接线，复用一个纯函数 `validateFrontmatterSchema(kind, status, frontmatter)`（kind = chg | finding | correction）：

1. **post-tool-use**：artifact-writer 写盘后立即读盘校验，不合法即时反馈给还在运行的 agent，写坏当场打回自修（最有价值的一层）。
2. **collect-state / stop**：兜底检测存量漂移，与 status-mismatch / verify-missing 等现有检测同级。
3. **migrate 验收**：迁移产物 100% 通过同一校验函数（§5.2 第 4 步）。

校验只对 `schema-version: "7.0"` 的文件生效；未迁移的 6.0 存量不按 7.0 合同报错（migrate 提示通道负责催办迁移）。

---

## 4. 规范单源化（指针化 + 测试锁）

> **范围扩充（2026-06-11，correction-2026-06-11-01）**：CHG-D 在指针化之前先做**目标态 framing 全发布面重写**——CHG-10 落地的文案含系统性「变更态 diff」反模式（「不再写 X」「7.0 帧无 X 字段」「v7 退役」负向提及 + 维护者向机理论述/历史掌故混入执行 agent 规程），用户抽样揪出 19 处并裁定全发布面扫描。重写原则见 plan D1 Step 0 与 vault `knowledge/claude-prompting-principles.md` §四。

### 4.1 权威位置矩阵

| 内容 | 权威单源 | 其他位置处置 |
|---|---|---|
| operation prompt 字段模板（现抄 4-5 份，含 artifact-management SKILL 内部两份 close-chg 模板 L198+L461） | `instructions/<op>.md` | agent.md 留必填字段名清单（必须自包含，e2e 锁一致性）；SKILL 改指针 + 最小示例；guard `promptTemplateForOperation` 必留（deny 文案必须自包含）但由 e2e 断言与 instruction 一致 |
| 7.0 schema 字段集定义 | `artifact-writer-spec.md` | hook 侧 `validateFrontmatterSchema` 是代码权威，e2e 断言两者字段集一致（规格与代码互锁） |
| 状态→checkbox 映射表（现 4 份：spec §4.1 / SKILL / change-lifecycle / format-reference） | spec §4.1 | 其余 3 处改指针 |
| 报告标题硬约束 + CRLF/stale-read 处理块（5+ 处已分叉） | spec 单节 | 各 instruction 改一行指针 |
| helper 命令来源 4 步顺序（4 个 skill 文件逐字重复） | pace-workflow SKILL | 其余 3 个 skill 改指针 |

约束说明：agent.md（system prompt 整读）、instructions（按 operation 按需读）、SKILL（主 session 读）是不同消费者不同时机，markdown 无运行时 include；guard deny 文案必须自包含。故「单源」= 权威位置 + 指针 + 测试锁，非字面一份文件。

### 4.2 同义收敛与措辞修正

- D1：`status-reason`/`block-reason`/`pause-reason` 文档统一只写 `status-reason`；guard 宽容期三者仍认（放宽不收紧，旧文档世代无害），N 个版本后评估删除。
- B2：`merged-by` vs `merged-into` 随 merge 家族字段删除自动消解。
- D2：finding-detail 模板段名改「推荐结构」措辞，维持 record-finding「body 为 opaque payload」语义。

### 4.3 测试锁（新增 e2e 断言组）

- agent.md 必填字段清单 ⊇ guard 实际校验集（防 A1 重演）。
- guard deny 文案中的字段名集合 = 对应 instruction 模板字段集合。
- spec schema 表字段集 = `validateFrontmatterSchema` 代码字段集。

A1 类漂移从「人肉同步靠运气」变为「漏改即红灯」。

---

## 5. migrate 工具与 vault 卫生

### 5.1 工具形态

`plugin/hooks/migrate-v7.js`，与 v5→v6 migrate 并列发布。`--dry-run` 预览（默认建议先跑）；执行前自动备份到 `.pace/backups/v7-migration/<timestamp>/`；`--cwd` 支持（reservation 同款防漂移）。迁移完成写 `.pace/v7-migration-state`。

### 5.2 动作顺序

1. 全量详情文件 frontmatter 瘦身至 7.0 合同（§3.1 删除集移除 + §3.5 状态机必填集补缺：archived 文件补 `archived-date`——walkthrough 索引行日期可考则取实际日期，不可考则用 migrate 执行日，补缺来源逐条记入迁移报告）。
2. `task.md` 清 v5 死尾巴段（无 T-NNN 旧 schema 段）；`implementation_plan.md` 整体改写为 tombstone（§2.1，其 v5 死尾巴随之消失）。
3. 结构性脏数据修复：correction-2026-06-04-01 全角弯引号 → 半角；findings.md 三态重排（`[x]`/`[-]` 行移 ARCHIVE 下方，活跃区只留 open）+ 表头补 `[change::]`；correction 索引 `[knowledge:: project-only]` 改 `[scope:: project-only]`（两行）；`## 关联调研` 空尾「（如有）」占位清除。
4. 验收：迁移产物全量跑 `validateFrontmatterSchema`，100% 通过才报成功，输出迁移报告（处理文件数 / 删除字段统计 / 补缺清单）。
5. 本 vault 专属卫生（`--hygiene` 选项，不在通用迁移路径内）：6 个 `.bak`/`.v5-backup`（~580KB）删除（v5→v6 安全窗口已过，本次迁移另有新备份）；7 个 v5 游离文档（audit-prompt.md、paceflow-complete-flow.md、paceflow-flow-ascii.md、ticket12/14/18/24.md）移 vault 内 `_archive/`。

### 5.3 未迁移提示

SessionStart（collect-state）检测「impl_plan 存在且含活跃索引行（非 tombstone）」→ 注入 migrate 提示（含完整 helper 命令）；PostToolUse 对 artifact 写入后催办一次（session-scoped flag 防重复）。复用 v5→v6 的 migration-state 检测模式。

---

## 6. 部署、测试与 CHG 分期

### 6.1 兼容论证（单版本一把梭的安全性）

1. plugin 整包分发，hook 与 agent 同版本到达，无包内混搭——「新旧并存」唯一形态是「新 hook vs 未迁移存量数据」与「旧版本并发 session」。
2. 删除的 frontmatter 字段新旧 hook 都不读；`schema-version` 校验只查存在性不查值——migrate 后旧 hook 照常工作。
3. 未迁移布局下 7.0 读端只认 task.md，impl_plan 漂移无机械后果（§2.4）。
4. 旧版本并发 session 读 tombstone：ARCHIVE 标记在，结构检测过；跨索引校验最坏软 warning（§2.1）。
5. migrate 用户触发 + dry-run + 自动备份 + 确定性验收（§5）。

### 6.2 测试策略

- 每 CHG TDD（先红后绿）；既有 ~65 处 impl_plan 相关测试逐一改语义：双写断言 → 单写断言；index-transaction 测试（test-pace-utils 1014/1023、test-hooks-e2e 6237/6257 等）→ 随机制退役删除或改为单文件释放断言。
- 新增：`validateFrontmatterSchema` 单测（三 kind × 各 status 必填/多余矩阵）；单源化一致性 e2e 锁（§4.3 三组）；migrate 端到端（fixture vault 迁移前后对照 + dry-run 无副作用断言 + 验收 100% 断言）。
- 全量基线：test-pace-utils / test-hooks-e2e / test-session-layers / test-agent-tests + `claude plugin validate ./plugin`。

### 6.3 CHG 分期（串行独立闭环，pace-bridge 批量落地）

| CHG | 范围 | 关键交付 |
|---|---|---|
| A | hook 读端 | 双布局兼容、跨索引校验退役、index-transaction 退役、常量集调整（PROTECTED 显式保留 impl_plan） |
| B | schema 合同 | `validateFrontmatterSchema` + post-tool-use/collect-state/stop 三层接线 + finding/correction schema-version 校验补全 |
| C | 写端 + 发布面 | 4 instruction 单写 + 7.0 字段模板 + agent.md/spec/templates 同步 |
| D | 单源化 | 指针化 + 同义收敛 + 一致性测试锁 |
| E | migrate 工具 | migrate-v7.js + SessionStart/PostToolUse 未迁移提示 |
| F | 本 vault 迁移 + 发布 | 执行迁移 + 卫生 + 全量验收 + bump v7.0.0 + push + reload 后 dogfood |

执行顺序 A→B→C→D→E→F：A/B 先行保证「读端先于写端」在 CHG 粒度成立；D 在 C 后（指针化基于已更新的 7.0 模板内容）；F 收尾含发布闭环。

### 6.4 风险与回滚

- 单 CHG 内 TDD + 全量基线绿才进下一个；任何 CHG 发现设计级缺口即停，回本 spec 修订。
- migrate 有自动备份 + dry-run，本 vault 执行失败可整体还原。
- 发布后 cache 生效面问题沿用既有「push 后 reload + dogfood」流程；v7.0.0 出问题可回 v6.7.1 tag（marketplace 用户侧 schema 7.0 文件对旧 hook 兼容，见 §6.1.2，降级不 brick）。

---

## 附录 A：implementation_plan 全消费点盘点（2026-06-11 实测）

> 分类：READ-JOIN（join/一致性校验）/ READ-EXIST（存在性/结构检测）/ WRITE-TEMPLATE（模板串）/ LOCK / INJECT / FLAG / DOC

**plugin/hooks/pace-utils.js**：335/357/364/370 — v5 检测（READ，保留不动）
**plugin/hooks/pace-utils/locks.js**：237（LOCK artifactResourceForRel）、667-688（LOCK markIndexChangesTouchedAndMaybeRelease）、691（LOCK readArtifactIndexTransaction）——后两者退役
**plugin/hooks/pace-utils/constants.js**：7（ARTIFACT_FILES）、8（MIGRATABLE）、11（ARCHIVE_REQUIRED）、37（DOC）、53-54（FORMAT_SNIPPETS implIndex/implDetail）、80（FLAG impl-archive-reminded）
**plugin/hooks/session-start/collect-state.js**：53（DOC）、82（READ-EXIST readFull）
**plugin/hooks/session-start/layers.js**：48（DOC）、54（INJECT 优先级）、84/371/372/716（INJECT 截断）、829/832/836（WRITE-TEMPLATE 格式警告）
**plugin/hooks/post-tool-use.js**：194/197（READ-JOIN 一致性）、249（WRITE-TEMPLATE 修复提示）
**plugin/hooks/pre-tool-use.js**：40（PROTECTED_ARTIFACTS 派生）、994（READ-EXIST ARCHIVE 检测）、1439（READ-JOIN deny 理由）、1621（WRITE-TEMPLATE）
**plugin/hooks/stop.js**：218/222（READ-JOIN）、224/230/232（WRITE-TEMPLATE 修复提示）
**plugin/agents/artifact-writer.md**：4/5/28-29/49/114（DOC + WRITE-TEMPLATE）
**plugin/agent-references/artifact-writer-spec.md**：14/34（DOC）、56（parent-impl 字段定义）
**instructions/**：create/update/close/archive 四文件共 10+ 处双写步骤
**测试**：test-hooks-e2e ~50 处、test-pace-utils ~15 处（含 index-transaction 专项 1014/1023/6237/6257）

易漏点：ARTIFACT_FILES 被 bash-guard.js:243/414、powershell-guard.js:194/315 遍历（PROTECTED 语义）；ARCHIVE_REQUIRED_FILES 下游 layers.js:335/343 注入兜底；FORMAT_SNIPPETS 下游 3 处；impl-archive-reminded flag 自动清理链。
