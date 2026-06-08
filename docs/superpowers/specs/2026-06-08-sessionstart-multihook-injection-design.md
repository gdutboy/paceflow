# SessionStart 多 hook 拆分注入 — 设计文档

> **状态**：设计（部分实现，2026-06-08）。M1+M2（CHG-20260608-09）已实现并经 R 审计修正；M3-M5 待实现。**本文档含 R 审计补充的 4 条动态约束原则**（依赖 / 耦合 / 层次 / 发布），标「R 审计补」处为原 design 盲点的修正，关联 `changes/findings/finding-2026-06-08-multi-hook-cross-chg-constraints.md`。
> **取代**：`docs/superpowers/specs/2026-06-08-sessionstart-layered-injection-design.md`（128K 单 hook 高预算方向**作废**——基于错误前提）。
> **关联**：
> - 根因 finding：`changes/findings/finding-2026-06-08-session-start-per-hook-10k-cap-context-broken.md`
> - 运行态写盘 golden reference：`docs/audits/2026-06-08-session-start-runtime-writes-reference.md`
> - 旧 design 已实现可复用部分：CHG-A 三段式解耦（已发布）、旧 CHG-05 的 L3 优先截断 + running 优先排序（已取消，代码在工作树可复用）

## 1. 目标

让 SessionStart 注入**真正进入对话上下文**（而非被 Claude Code 持久化成 2KB preview），在 per-hook 10K characters 约束下精准恢复项目上下文。这是 PACEflow 上下文恢复的核心入口——注入被 persist = 前面所有纪律记录白做。

## 2. 根因（实测铁证，详见关联 finding）

**Claude Code 对每个 hook 的 output string 独立 cap 10,000 characters**（官方 hooks 文档），超过即 persist 到磁盘 + 仅注入 first 2KB preview + 文件路径。

| 实测（当前 CLI，第一手） | 值 |
|---|---|
| PACEflow 单 hook 注入 | startup **13433 chars** / compact 16626 bytes |
| 框架阈值 | **10,000 characters per output string**（不是 bytes、不是 50K、不是 1M 百分比）|
| per-hook 独立判断 | 同 SessionStart 事件 4 hook（superpowers 5973 / explanatory 1129 / codex 0 / paceflow 13433），**仅 paceflow >10K 被 persist**，其余各自正常注入（若 per-event 累计 20535 应全 persist）|
| 工具 tool-result 阈值（对照）| 16-32KB（比 hook 宽松）|

**当前状态**：PACEflow 单 hook 13433 chars >10K **一直被 persist**，AI 默认只看 2KB preview——SessionStart 上下文恢复实际残废。这是「compact 后调 paceflow 出错率高」的真正大头。

**旧 design doc 的错误**：把约束当成"1M 上下文的百分比"，方向定为 46K→128K（扩大）。真实约束是 per-hook <10K chars，方向应是**精简 + 拆分**。

## 3. 架构

### 3.1 多 hook 拆分（固定 2 hook，一脚本 group 路由）

per-hook 独立 cap 10K 意味着：**把注入拆成多个 hook command，每个 <10K chars，各自独立注入、零 persist、零内容损失**（N hook = N×~9K chars 全进上下文）。用户真实配置已实证多 hook 可行（4 个跨 plugin SessionStart hook 共存）。

```
hooks.json SessionStart 注册 2 个 command（静态）:
  node session-start.js --group core
  node session-start.js --group artifact
        │
        ▼
session-start.js（瘦编排，复用 CHG-A 三段式，加 group 维度）:
  group = parseArg('--group') || 'core'                    // 默认 core，向后兼容
  if group==='core' && !PRINT_ONLY: applyRuntimeEffects(W1-W11)
  state  = collectState(cwd, ev, signal, artDir, paceUtils, {..., group})
  layers = buildLayers(state, ev, paceUtils, group)
  text   = assembleWithBudget(layers, {limitChars: 9500})  // <10K，artifact 截断
  stdout.write(text)
```

**关键决策**：
- **hook 数量固定 2**——hooks.json 是静态配置，运行时无法加 hook；增长靠 artifact 内部截断兜底，单类爆 10K 才考虑预注册第 3 个。
- **一个脚本 + `--group` arg**——复用 CHG-A 的 collectState/buildLayers/assembleWithBudget 三段式，零重复代码，只加 group 路由。CHG-A 的"内容生成/副作用解耦"正是多 hook 拆分的前提。
- **单位 bytes → chars**——assembleWithBudget 的 `limitBytes` 改 `limitChars`，对齐框架 10K characters 阈值，消除 bytes/chars 错配。

### 3.2 拆分维度：有界 vs 增长（不是 L0–L3）

实测揭示：注入内容分两类，**这才是正确的拆分维度**：

- **有界**（不随项目增长）：工作流入口、项目上下文、git、Artifact 目录、相关讨论（scanRelatedNotes 有 limit）、L0 执行上下文/change-set/暂停 ≈ 稳定 ~3–4K
- **增长**（随 artifact 累积膨胀）：活跃 CHG 摘要（并行 CHG 数）、findings（未解决数）、**corrections（只增不减，已 8 条）**、walkthrough（历史）、spec

单 hook 精简不可持续——增长块会自己涨爆 10K（推演：corrections 20条 ~3K + findings 10条 ~3.5K + 6 并行 CHG ~1.6K = ~8K，加有界 ~3K = 11K，破 10K）。所以**必须拆**：有界进 core（稳 <10K），增长进 artifact（截断 <10K）。

### 3.3 内容分配

```
core hook（有界骨架，稳 <10K）:
  项目上下文 + 工作流入口 + Artifact 目录
  + L0「我在做什么」（活跃 CHG 摘要 running 优先 top-N + change-set 进度 + 暂停 + 执行上下文）
  + git + 相关讨论（含 wiki article，见 §3.7）
  + findings 过期提醒 + W12 flag（耦合三元组，见 §3.4——CHG-09 阶段留 core，CHG-11 整体移 artifact）
artifact hook（增长块，截断 <10K）:
  findings.md 文件块（仅 active 待修，见 §4）+ corrections + walkthrough 摘要 + spec 摘要
  + 格式合规警告（依赖 artifact 文件，见下「依赖原则」）
```

**依赖原则（R 审计补，原 design 盲点）**：section 分两类，归属逻辑不同——
- **主内容块**（findings.md / corrections / walkthrough / spec / git / 活跃 CHG）：按「有界 vs 增长」直接归类。
- **衍生 section**（依赖别处数据才能渲染）：**必须跟随它依赖的数据所在 group**，不能独立分类——
  - 格式合规警告 `renderFormatWarnings` 依赖 artifact 文件全文（implFullForFormat/found）→ 归 **artifact**。
  - findings 过期提醒 `renderAgedFindings` 依赖 W12 flag 去重状态 → 归 **W12 所在 group**（§3.4 耦合三元组）。
  - Artifact 目录兜底（found>0）与 core 的 Artifact 目录 section 重复，多 hook 下退为死代码（core 已注入），不在 artifact 重复。

> **原 design 的错**：§3.3 原把归属细节「留 plan 列清单」，但衍生 section 的归属是非平凡判断（依赖什么数据决定归哪 group），plan/实现接不住就瞎猜——R 审计发现 A（格式警告误放 core 致全 group 丢失）正是这么来的。**design 必须给原则，不是留清单。**

### 3.4 副作用归属（逐条对照 golden reference 12 写盘点）

| 写盘点 | 归属 | 理由 |
|---|---|---|
| W1 mkdir / W2 counter reset / W3-6 清 flag·stale / W10 ensureProjectInfra / W11 createTemplates | **core** | 基础设施/清理/Stop gate，与注入内容无关，幂等 |
| W7-W9 compact 快照消费 | **退役** | OQ-1 决议废弃，compact 改实时读 |
| **W12 findings-age flag** | **core（CHG-09）→ artifact（CHG-11）** | 与 findings 过期提醒（agedFindings）是 `ageFlagExistedBefore` **耦合三元组**（见下）——写 flag / 读取 / 渲染须同 group 同里程碑移动。最终态归 artifact，但当前（M2/CHG-09）三者全留 core，CHG-11/M4 一起移 |

> **W12 不是孤立副作用，也别与「findings.md 文件块」混淆**：它耦合的是 findings **过期提醒**（agedFindings，基于 date 判过期），不是 findings.md 文件块（后者归 artifact 无 flag 耦合）。原 design 表格曾把 W12 单独归 artifact、却把 agedFindings 渲染留 core，正是 R 审计发现 B2 的割裂源。修正见下「耦合三元组」。

**耦合三元组（R 审计 B2 补）**：W12 flag 不是孤立副作用，它和 findings 过期提醒构成**状态耦合三元组**，三者必须同 group 且同里程碑整体移动：
1. **W12 flag 写**（runtime-effects：applyRuntimeEffects → 或 applyArtifactGroupEffects）
2. **agedFindings 读取**（collect-state：collectAgedFindings，用 ageFlagExistedBefore 去重）
3. **agedFindings 渲染**（layers：renderAgedFindings）

拆散即时序割裂——一 group 写 flag → 另一 group 读到「今日已提醒」→ 漏注入。
- **CHG-09（M2）现状**：三者全留 **core**。R 审计发现 T-004 曾误把读取+渲染移 artifact 但 flag 留 core（发现 B2），已撤回 core。
- **CHG-11（M4）目标**：三者**一起**移 artifact（W12 flag 写进 applyArtifactGroupEffects + collectAgedFindings 归 isArtifact + renderAgedFindings 归 artifact 块），在同一个 CHG 完成，不可分到两个 M。

### 3.5 执行顺序——健壮设计，不赌顺序

reference §2 钉死："W10/W11 创建模板须在 collectState 读文件前"。多 hook 下 core 的 W11 建模板 vs artifact hook collectState 读取存在竞态（取决于 Claude Code 多 hook 顺序/并行，未文档化）。

- **默认健壮设计**：artifact hook **也跑一次幂等的 W10/W11**（ensureProjectInfra/createTemplates 都"仅缺失时创建"）自保——无论顺序/并行都对。其余副作用仍只 core。
- **可选简化**：实测确认顺序（core 先）后可去掉 artifact 自保。实测法——PostToolUse 注册 2 测试 hook 各写时间戳观察。但健壮设计本不需要此实测。

### 3.6 增长块截断策略

artifact hook 按「**优先级全文 + 长尾计数指针**」截断：

| 增长类 | 截断策略 | 长尾指针 |
|---|---|---|
| **corrections**（无界，重点）| 最近 **N=6** 条全文索引 | `另有 M 条更早纠正记录，避免重犯请 Read corrections.md` |
| **findings 未解决** | 仅 active `[ ]`（见 §4）；P0/P1 全注入 + P2/P3 最近 5 | `另有 M 条 P2/P3 finding，详见 findings.md` |
| **walkthrough** | 最近 3 条摘要 | `另有 N 条完成历史，详见 walkthrough.md` |
| **spec** | 技术栈摘要（砍目录/依赖清单）| `完整规格见 spec.md` |

**两层截断**：① 类内截断（上表）② 全局兜底——artifact hook `assembleWithBudget(limitChars: 9500)` 按优先级排列（corrections → findings P0P1 → findings P2P3 → walkthrough → spec），正常类内截后 <9.5K 不触发；极端才跨类从尾部截 + 全局指针（复用旧 CHG-05 的 L3 优先截断逻辑）。

**层次约束（R 审计发现 1 补，关键）**：全局兜底（assembleWithBudget）**只截 l3 层**，head（l1head/l0/l1/l2）永不截。所以全局兜底要对 artifact 生效，**artifact 文件块必须放可截层（l3），不能放 l1head**。
- **原 design 盲点**：§3.6 假设全局兜底能兜住 artifact，但没说 artifact 文件块的层归属。CHG-09（M2）实现把 artifact 文件块放进了 l1head（永不截）→ 全局兜底对 artifact **完全失效**（实测注入 12000 chars spec 不被截、truncated=false）。当前仅靠真实内容 9852 chars 擦边（距 10K cap 余量 148）。
- **CHG-10/M3 设计要求（二选一，推荐 a）**：
  - **(a) 把 artifact 文件块从 l1head 移到 l3**（可截层），让两层截断都生效——artifact 文件按优先级进 l3，全局兜底从尾部截。与 design 原意一致。
  - (b) 接受 artifact 文件块在 head 不可截，则**类内截断是唯一保证**，必须确保所有 artifact 文件类内截断后总和 <9500 chars，不能依赖全局兜底。

**指针措辞原则**：长尾指针只赌低优先内容（最近/最严重的已全文 aware）；corrections 长尾给明确动机（"避免重犯"）；不写空泛"按需查看"。

> **治本留 future**：corrections 无界增长的根本解法在 artifact 层——给 corrections 一个归档生命周期（已内化/规则已固化的旧 correction 移 ARCHIVE）。但那是独立 change，本次先用注入截断兜住。

### 3.7 wiki article 注入（core 相关讨论，vault-gated）

LLM Wiki（用户 Obsidian `vault/wiki/`）的 article 是 `knowledge/`+`thoughts/` 的提炼合成，有界、高信噪比，属上下文恢复骨架——归 **core hook 的「相关讨论」section**。`scanRelatedNotes` 扩展：有 `wiki/` → article 优先 + 未进 wiki 的 raw 补充；无 vault/wiki → 静默跳过（整段不出现）。通用性铁律——paceflow 提供能力（检测相关知识）不绑定 wiki，按层降级（继承旧 design OQ-3）。

## 4. 关联 change：finding `[-]` 语义 + review gate（独立实现）

findings 注入应只取「**active 待修**」，排除「已决定不修的记录」（技术债/deferred/accepted）。当前 `[ ]` open 混了二者，导致技术债 finding 被误注入成噪音。

**关键**：**注入层零改动**——现有逻辑（CHG-20260309-04 + `collectAgedFindings` 的 `/^- \[ \] /` 正则）已只取 `[ ]`、跳过 `[x]/[-]`。一旦"已决定不修"的 finding 标 `[-]`，自动不注入。

真正改动在 **finding 生命周期 + review gate**（与 SessionStart 注入正交，独立实现/验证）：

| 改动点 | 内容 |
|---|---|
| review gate R 段（pace-workflow + CLAUDE.md G-9）| findings 处置路由：P0/P1 开 HOTFIX **或标 `[-]` won't-fix**；P2/P3 record-finding 后，actionable 留 `[ ]`、已决定不修标 `[-]` |
| record-finding / update-finding | 支持记录即 `[-]`（won't-fix 的 finding 一落地就是 `[-]`），或记录后 `update-finding` 改状态（update-finding 已存在，CHG-20260608-02）|
| 文档语义 | 明确 finding `[-]` = 「已决定不修的追踪记录」（不只任务"跳过"）|
| 迁移现有 | `audit-p3-deferred-backlog`×2 + `guard-blocklist-arch-debt` 等当前 `[ ]` 技术债 finding → 改标 `[-]` |
| 注入层 | **零改动**（`[-]` 已排除）|

## 5. 验证策略

| 验证 | 方法 |
|---|---|
| 各 group <9500 chars（M3 后达成）| 单测：`buildLayers(group)` 输出 chars 测量，用**满载 fixture**；注意 artifact 文件块在 l1head 时全局兜底失效（§3.6），M3 移 l3 + 类内截断后才稳 <9500 |
| 副作用归属 | e2e：core 跑 W1-W11 + 幂等自保；W12+agedFindings 三元组**当前在 core（CHG-09）**，M4/CHG-11 整体移 artifact 后才由 artifact 跑 W12 |
| 截断策略 | 单测：corrections N=6、findings P0/P1 必达 + `[-]` 排除、长尾指针出现 |
| 内容无丢失 | core+artifact 总覆盖 = 原注入内容（去重后）|
| **真实不再 persist（终极判据）** | reload 后实测 startup/compact，各 hook <10K、`<persisted-output>` 不再出现——唯一不能用单测代替的验证 |

## 6. 实现分期

**主线**（SessionStart 多 hook 拆分，新 change-set）：
| 阶段 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| **M1** | session-start.js group 路由 + collectState/buildLayers/assembleWithBudget 加 group 维度（chars 单位）；guard(bytes)/budget(chars) 解耦；默认 group=core | CHG-A | ✅ CHG-09 |
| **M2** | core/artifact 内容分配 + 块→group 映射（**依赖原则 §3.3**，含格式警告归 artifact、agedFindings 三元组留 core）+ L0 running 优先排序/倒序对称 + 现有 e2e group 迁移 | M1 | ✅ CHG-09（R 审计修正） |
| **M3** | artifact 截断策略（**先按 §3.6 层次约束把 artifact 文件块移 l3**，再类内 + 全局兜底）| M2 | CHG-10 |
| **M4** | hooks.json 注册 2 hook + **W12+agedFindings 耦合三元组整体移 artifact（§3.4）** + 执行顺序健壮（artifact 自保 W10/W11）+ 快照退役（OQ-1）| M2、M3 | CHG-11 |
| **M5** | wiki article 注入 core 相关讨论（vault-gated）| M2 | CHG-12 |

**发布单元原则（R 审计约束 3 补，关键）**：内容归 artifact（M2/M3）与 hooks.json 注册双 hook（M4）拆在不同里程碑，但 plugin cache 从 git remote 拉取——M4 前任何 push+reload，artifact 内容（文件块/格式警告）在单 hook（默认 core）下**静默丢失**。**整个重构 M1-M5 必须作为一个发布单元**：M4 注册双 hook + reload 实测各 hook <10K chars 后才 push；M1-M3 期间不发布中间态（CHG-09~CHG-11 commit 留本地）。

**关联**（独立 change）：finding `[-]` 语义 + review gate 路由 + 迁移现有 deferred finding。

> 旧 CHG-05 的 L3 优先截断（→ M3 全局兜底）+ running 优先排序 + 倒序对称修复（→ M2 L0）代码已在 CHG-09 复用；128K BUDGET + 删 HARD_LIMIT 已回退。

## 7. 已决议

- **拆分维度 = 有界 vs 增长**（非 L0–L3）——实测增长块会自涨爆 10K。
- **固定 2 hook + 内部截断**——hooks.json 静态，运行时不能加 hook。
- **执行顺序健壮设计**——artifact 跑幂等 W10/W11 自保，不赌顺序。
- **finding `[-]` = won't-fix/deferred/accepted**（最小改动；注入层零改动）。
- **wiki 归 core 相关讨论**（vault-gated）。
- **快照退役（OQ-1）**——继承旧 design，compact 实时读。

**R 审计补的 4 条动态约束原则**（原 design 把多 hook 拆分当静态分类问题，漏了这些动态维度——CHG-09 R 审计暴露并修正）：
- **依赖约束（§3.3）**——衍生 section（格式警告/agedFindings）跟随其数据所在 group，不独立分类。design 给原则、不留 plan 列清单。
- **耦合约束（§3.4）**——W12 flag 写 + agedFindings 读 + agedFindings 渲染是状态耦合三元组，同 group 同里程碑整体移；当前留 core，CHG-11 一起移 artifact。
- **层次约束（§3.6）**——全局兜底只截 l3，artifact 文件块必须进可截层（l3）兜底才生效；CHG-10 先移 l3。
- **发布约束（§6）**——M1-M5 是一个发布单元，M4 注册双 hook 前不 push 中间态。

## 8. 安全说明

SessionStart 无门控（纯注入 + 运行态副作用），改坏最多"注入不理想"，不 deny、不毁 artifact、不阻断开发。运行态副作用以 golden reference 锁定；多 hook 下 W1-W11 归 core、W12 归 artifact、artifact 幂等自保 W10/W11，副作用语义不变。
