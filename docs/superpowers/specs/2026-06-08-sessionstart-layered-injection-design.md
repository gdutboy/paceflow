# SessionStart 分层注入重构 — 设计文档

> **状态**：设计（pre-implementation，2026-06-08）。尚未实现，勿当现行行为。
> **关联**：运行态写盘 golden reference `docs/audits/2026-06-08-session-start-runtime-writes-reference.md`
> **触发**：用户定调「SessionStart 是极其重要的入口，上下文恢复是 paceflow 兑现 P-A-C-E-V-R 记录的环节，应尽可能完美」。

## 1. 目标

让 SessionStart 在**新 session / compact 后**精准恢复项目上下文，把 spec/CHG/walkthrough/findings 等 artifact 有效激活。注入不力 = 前面所有纪律白做。

## 2. 现状问题

`session-start.js`（831 行）有 22 个注入 section，**顺序 ≈ 历史添加顺序，无统一「上下文恢复优先级」模型**。症状（经实跑 + subagent 通读 + 主 session 复核裁定）：

| ID | 问题 | 性质 |
|---|---|---|
| **A0** | compact 缺整个 `=== PACEflow 工作流入口 ===`（skill 入口引导 + reserve helper 约束）→ **compact 后调 paceflow 出错率高**（用户实证） | 🔴 高优·实证 |
| **A1** | 相关讨论 5 缺口：多行 YAML projects 漏匹配 / 无排序 / limit 5·3 过严 / 无定位 / 无说明 | 🔴 真 bug |
| **A2** | git 仅分支+最近 commit，缺脏文件 / ahead-behind | 🟡 |
| **A3** | 截断顺序倒置：动态上下文（活跃 CHG/git/相关讨论）排大文件后，46KB 阀先截最该留的 | 🔴 结构性 |
| **A4** | helper 路径在 4 处重复，占预算 + 噪音 | 🟡 |
| **B5** | 活跃 CHG 摘要按 task.md 索引序、无 running 优先、无上限 | 🟡 |
| 死代码 | walkthrough 详情段落处理（`481-502`）对 v6 数据永不触发（v5 遗留，CHG 已单一文件化、walkthrough 只剩索引） | 删除 |
| C 类 | G2/G7/G8/G11/G12 边角（缺 ARCHIVE 兜底叠加 / 注释矛盾 / 重复读 impl / compact 快照与实时 CHG 重复 / detailPending 只算 running） | 顺带或 backlog |

根因：**无总体设计**。下面的四层模型是统一解法。

## 3. 架构

### 3.1 三段式编排（解耦——结构核心）

当前 `session-start.js` 把「内容生成」与「运行态副作用」缠在一条 800 行顺序流（12 写盘点散在 148–784 行、与 52 处 `stdout.write` 交错；PRINT_ONLY 靠 7 处散落守卫维持）。重构为：

```
session-start.js:
  1. 解析输入（cwd / eventType / paceSignal）  ← compact 不再读快照（§8 OQ-1 已废弃）
  2. 运行态副作用层  ← 12 个写盘点集中，PRINT_ONLY 一处短路（行为/时机/语义不变）
  3. 注入内容层（纯函数）← state → L0–L3 分层文本，可喂 fixture 单测
  4. 预算装配 + 输出
```

**边界**：写盘 12 点行为不变（以 §reference 逐条回归）；注入层纯函数化（首次可单测）。

### 3.2 四层模型（注入优先级 = 截断保护顺序）

| 层 | 含义 | 内容 | 截断 |
|---|---|---|---|
| **L0** | 我刚才在做 + 接下来 | 活跃 CHG 摘要（running 优先 B5）+ change-set 进度 + 进行中任务 + CHG 执行上下文 + **未桥接 plan 提醒（解除 `!hasActive` 门控、精简一行、fresh 过滤）** + **最近 10 条 walkthrough（单条完整不截）**；compact 直接实时读（**快照废弃**，见 §8 OQ-1） | **确定性永不截** |
| **L1** | 项目是什么 | 项目上下文（CWD/root/mode）+ spec 摘要 + **git（增强 A2：脏文件 + ahead/behind）** | 永不截 |
| **L2** | 怎么正确操作 paceflow | **工作流入口（skill 引导 + reserve helper 约束）+ helper（集中去重 A4）** —— **A0：startup + compact 都注入** | 永不截 |
<!-- 历史修正（CHG-20260609-09 §E）：本行原含「格式速查 + CHG 完成检查」，二者于 M4/CHG-20260608-11 退役 PreCompact 快照时一并从 layers.js 移除，改由 CLAUDE.md G-9（完成检查）+ artifact-management skill（格式速查）覆盖；当前 L2 实际仅注入工作流入口 + helper。本 design 为 historical；L2 运行时行为以 layers.js 源码为准，设计背景见 multihook-injection design（部分实现）。 -->
| **L3** | 相关经验与提醒 | 未解决 findings + corrections + **相关讨论（A1 全修 + WIKI-1 wiki article 优先注入，vault-gated 降级，见 §8 OQ-3）** + bridge/native-plan/blocked/foreign 提醒 | **预算紧张先砍**（附「已省略 N，Read X」）|

## 4. 预算策略

从「紧字节阀 + 截断」转为「**去噪精选 + 高安全阀**」：

- 全局安全阀 **46KB → 128KB**（极端 ~4–6% of 1M 中文为主估算，正常不触发）
- 注入量由**分层精选**决定（去噪 + 排序），不靠字节卡
- **截断方向反转**：L3 先砍，L0/L1/L2 精选永不截（修 A3）
- **去噪**：不注入归档 CHG / 已解决 finding / 远古 walkthrough——提信噪比（attention），非省 token

> token 估算（无精确 tokenizer，按中英混合 2–3.5 字节/token）：常态注入 30–50KB ≈ 1–2% of 1M；128KB 阀极端 ≈ 4–6%。

## 5. 缺口修复映射

| 缺口 | 修复 | 归属 |
|---|---|---|
| A0 | compact 也注入 L2 工作流入口 | L2 |
| A1 | 多行 YAML 匹配 + updated 降序 + 去 limit + wikilink 定位 + section 说明 | L3 / `scanRelatedNotes` |
| **WIKI-1** | 相关讨论双层升级：wiki article 优先（提炼）+ raw 笔记补充；**vault-gated 降级**（无 vault/wiki 静默跳过）| L3 / `scanRelatedNotes`（见 §8 OQ-3）|
| A2 | git +脏文件 + ahead/behind | L1 |
| A3 | L3 先砍 | 预算层 |
| A4 | helper 集中 L2 一处 | L2 |
| B5 | 活跃 CHG running 优先排序 | L0 |
| **PLAN-1** | plan 扫描加 cwd（方案 C）+ L0 未桥接 plan 提醒解除 `!hasActive` 门控 | `plans.js` + L0 |
| 死代码 | 删 `session-start.js:481-502` | 注入层 |
| C 类 | 重构顺带或记 backlog finding | — |

## 6. 测试策略

- 注入层纯函数单测（喂 fixture state → 断言 L0–L3 输出 / 顺序 / 截断方向）
- 写盘 §reference 逐条回归（行为等价）
- startup/compact 对称性测试（A0）
- 预算阀 + L3 优先截断测试
- 现有 `tests/test-hooks-e2e.js` 全绿

## 7. 实现分期（batch create CHG，一个 change-set 5 个 CHG）

| CHG | 内容 | 独立验证 | 依赖 |
|---|---|---|---|
| **A** | 注入层解耦（三段式 + 12 写盘点集中 + PRINT_ONLY 单点 + 纯函数化），**行为等价** | reference 回归 + e2e 全绿 + 新单测 | — |
| **B** | 四层模型骨架 + 预算策略（128KB 阀 + L3 优先截 + 排序） | 分层顺序/截断方向/阀测试 | A |
| **C** | L0/L1/L2 内容（A0 compact 对称 + A2 git + walkthrough 10条不截 + 删死代码 + B5 + A4 + G11） | compact 对称、git、walkthrough | A,B |
| **D** | L3 内容（A1 相关讨论全修 + **WIKI-1 wiki article 注入 vault-gated** + findings/corrections/提醒归位） | A1 五缺口 + wiki 降级链 | A,B |
| **E** | plan 桥接修复（`plans.js` 扫描加 cwd 方案 C + L0 未桥接 plan 提醒解除 `!hasActive` 门控） | cwd plan 被扫到 + 提醒出现 | A,B |

## 8. 已决议（原 Open Questions）

- **OQ-1 → compact 快照废弃**：compact 只压缩对话、**不改 artifact/.pace 文件**，故 compact 后实时读 artifact + `.pace` 运行态 = compact 前状态，快照中转无必要（连 `W8` 从快照恢复 counter 都冗余——counter 文件压根没被改）。新模型下**废弃 PreCompact 快照机制**，compact 的 L0 直接实时读（= startup L0 + A0 工作流入口），顺带消 G11 重复。**落地前加测试确认** PreCompact→SessionStart:compact 间无第三方改 artifact/.pace（判断成立）。`pre-compact.js` 快照写入 + `session-start.js` compact 快照消费（含 W7/W8/W9）一并退役。
- **OQ-2 → plan 桥接修复（用户方案 C，并入 CHG-E）**：根因 = project root 爬到父目录（`hasV6ArtifactRoot` 因子项目 vault 同名别名误判父目录为 artifact root，`path-utils.js:270-273`），导致 plan 扫描错位 + `!hasActive` 门控**双重失效**（已独立验证；与 [[getProjectName-cwd-drift-fix]] 同类）。解法（**不动 project root/runtime，父 `.pace/` 状态不破坏**）：`planSearchRoot` 从单一父根扩展为 `[projectRoot, cwd]`，plan 对象带实际 `root`（供 `isFresh` statSync `plans.js:89`），cwd 优先去重；synced-plans 仍在父 `.pace/`、按文件名兼容。配套 L0 未桥接 plan 提醒解除 `!hasActive` 门控（`session-start.js:698`）、精简一行、fresh 过滤、桥接后自动消失。
- **OQ-3 → wiki article 注入 L3（vault-gated 增强）+ 知识沉淀提醒另开**：LLM Wiki（用户个人 Obsidian 知识库 `vault/wiki/`）的 article 是 `knowledge/`+`thoughts/` 的提炼合成，信噪比更高，作为 L3「相关讨论」的优先注入源。**通用性铁律——paceflow 提供能力（检测相关知识）不绑定 wiki**，按层降级：无 `PACE_VAULT_PATH` → 整个 section 不出现；有 vault 无 `wiki/` → 只注 raw（现状）；有 `wiki/` → article 优先 + 未进 wiki 的 raw 补充。项目匹配用 wiki article 的 `sources`/`tags`/source 页 `artifact`+`change_id`（article 无 `projects` 字段）。**点 2（PACEflow→知识库沉淀提醒）单独 change-set 另开**：检测内生（CHG `technical-decision` 段 / correction `knowledge-link`）、展示 opt-in（默认关闭，`PACE_HARVEST_REMINDER` 配置 + 自定义文本激活，无知识库用户零打扰）、触发点 PostToolUse on artifact-writer agent、paceflow 不读 wiki 内部（单向解耦）。**不采纳** `~/llmwiki/HOOK-REQUIREMENTS.md` 的具体条款（外部 llm-wiki session 所写，不了解 paceflow 真实机制），仅保留其「消除 harvest 断档」内核。

## 9. 安全说明

SessionStart 无门控（纯注入 + 运行态副作用），改坏注入逻辑最多「注入不理想」，不 deny、不毁 artifact、不阻断开发。运行态副作用行为以 §reference 锁定不变。
