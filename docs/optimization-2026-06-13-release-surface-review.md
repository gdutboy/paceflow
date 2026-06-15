# PACEflow 发布面优化与方向评审（2026-06-13）

> 本文是对 PACEflow **发布面（marketplace runtime）** 的一次完整评审，产出优化、改进与方向建议。
> 评审用多 agent 工作流并行深读 9 个切面后综合，所有结论 evidence-backed（附 `file:line` 出处）。
> 本文属仓库维护材料（`docs/`），**不随 marketplace runtime 发布**。

| 元数据 | 值 |
| --- | --- |
| 日期 | 2026-06-13 |
| 评审对象 | `plugin/**` 发布面（51 文件 ~15,500 行 JS/MD/JSON）+ `tests/**`（~13,300 行）+ `README.md` / `REFERENCE.md` |
| 基线 commit | `52f3461`（release v7.1.0） |
| 方法 | 10-agent Workflow：9 个 reader 并行深读各切面（OBS schema 结构化产出）→ 1 个 synthesizer 去重/拔高/分优先级 |
| 模型 | 全程 Opus（judgment-heavy） |
| 规模 | ~1.13M subagent tokens · 253 工具调用 · ~25 分钟 |
| 切面 | Hook 编排 / pace-utils 核心 / Session 生命周期 / Agent 合同 / Skills+Helper / 文档DX / 测试 / 战略方向 / 已知 backlog 去重 |
| 原始观察总数 | 76 条（含第 9 切面 21 条已知 backlog 去重清单） |

---

## 执行摘要（总判）

**工程内核非常健康，几乎没有真 bug——核心矛盾是「正确但脆」与「为一个作者打磨到极致、却没给第二个用户铺路」。**

- 护城河（hook 层物理 `deny` vs CLAUDE.md 软指令）早已建成，并被 1400+ 真断言覆盖；doc-as-code 反漂移（V7D 系列一致性锁）是教科书级。多数切面结论是「正确但脆」而非「有 bug」。
- 当前最大的债分两层：
  - **工程层**：同一逻辑写多遍的结构性冗余（`pre-tool-use.js` 1652 行单闭包、deny 出口 41 处手写、命令守卫块逐字复制、项目检测双实现）——与已知 P1「模板抄 5 份」是**同源拷贝漂移**，但发生在 hook 代码层、尚未进 backlog。
  - **产品层**：无 quickstart、无渐进档、无竞品对标——护城河已够深，**继续加固边际收益递减**。
- 真正的杠杆不是深化护城河，而是 **「降门槛 + 收敛重复逻辑」**：前者决定产品能否被第二个人采用，后者决定系统能否继续被维护。

> 综合层判定的一个真实可达隐患：`budget.js` 的 head 永不截断、且 head 自身超限时无任何信号（重蹈项目自己记录过的「上下文恢复残废」根因）。本文按项目自身的**可达性判据**将其重判为 medium/潜伏（详见核验结果），但仍建议优先于纯结构整理处理。

---

## 方法论与数据来源

1. **侦察**（主上下文）：枚举发布面文件与规模，读 `plugin.json` / `hooks.json` 掌握编排关系。
2. **并行深读**（9 个 reader agent，OBS schema）：每个 agent 被分配一个切面与精确文件清单，要求找优化机会（复杂度热点 / 死代码 / 文档漂移 / 耦合 / 可维护性 / DX / 冗余 / 测试质量 / 性能），每条 evidence-backed，并平衡列出 strengths。
3. **综合**（1 个 synthesizer agent）：跨切面去重聚类成高海拔方向，按 ROI 排序行动项，区分快赢 / 战略下注 / 明确不做，并**对已知 backlog 去重**（只保留新增或被拔高项）。
4. **独立核验**（主上下文，回代码/文件系统定锚）：对最高 ROI 的新增 high 断言用最小复现 + 路径追踪复核——agent 的结论是「二手」，必须回 spec/代码/文件系统定锚（见下表，其中一条早先 hunch 被定锚推翻）。

---

## 独立核验结果（主 session 回代码定锚）

| 断言 | 定锚结论 | 证据 |
| --- | --- | --- |
| budget head 永不截、超限无信号 | ✅ **机制属实**，严重度下修为 medium/潜伏 | `plugin/hooks/session-start/budget.js:37-46`：`headText` 全量返回，`remain=max(0,limit−headLen)`，head 自身超限时 `truncated` 仍只反映 L3 omit。SessionStart 已拆 core+artifact 两 hook 各控 10K，且 CHG 是小单元（close 即归档），堆到 30+ 活跃 CHG 罕见 |
| helper `--cwd` 裸 `++i` 吞后续 flag | ✅ **属实** | `plugin/hooks/reserve-artifact-id.js:24` / `set-project-root.js:21` 用 `String(argv[++i]||'')`；对照 `set-activation.js:35-36` 有 peek-next 守卫。触发条件：`--cwd` 后紧跟另一 flag（末位反而安全会回退）。命中 memory `reserve-artifact-id-cwd-flag` |
| README `$PLUGIN_DIR` 未定义 | ✅ **属实** | `README.md:75,86,124` 用 `$PLUGIN_DIR`，全文 0 处赋值；运行时真实变量是 `${CLAUDE_PLUGIN_ROOT}`。复制即指向文件系统根 → ENOENT，且正是 v7 最高风险的迁移命令 |
| 「README 仍停在 v6」（评审者早先 hunch） | ❌ **被定锚推翻** | `README.md:67` 有完整「v6→v7 升级」节 + changelog v7.0.0/v7.1.0；「v6 相比 v5」节是合法历史背景。记录于此以示纪律：二手 hunch 回文件系统后被证伪 |

---

## 编辑结论（杠杆排序）

> **先做 A 档快赢（一个下午的小 CHG，消除已定锚的真陷阱）→ 再做 B 档第 1 刀（把 agent-lifecycle 段 `pre-tool-use.js:388-757` 搬回 `agent-lifecycle-guard.js`，行为不变砍 ~370 行）→ 然后把精力转向 C 档产品方向，而不是继续审计。**

这个项目当前最大的风险不是「哪里有 bug」，而是「打磨成了一个完美但只有作者一个人用的工具」。

**A 档·立即快赢（建议合并成一个 `CHG 快赢清扫`，全 S 成本、定锚过、互不耦合）**

| 项 | 改动 | 出处 |
| --- | --- | --- |
| README `$PLUGIN_DIR` → `${CLAUDE_PLUGIN_ROOT}` + 普通 shell 一行 fallback | 3 处 + 文首声明 | `README.md:75,86,124` |
| helper `--cwd`/`--operation` 下沉 `set-activation` 的 peek-next 守卫为公共 `parseArgs` | 1 公共函数 + 3 调用 + 反向 e2e | `reserve-artifact-id.js:24`、`set-project-root.js:21`、`set-activation.js:35-36` |
| ~~`pace-utils.js` 导出对象 `escapeRegex` 重复 3 次 → 留 1 处~~ **【撤回·误读非冗余】** | — | **2026-06-15 定锚证伪**：实为依赖注入——`:88` 从 path-utils 导入（唯一定义源 `path-utils.js:484`）+ `:139/211` 注入 change-analysis/plans 工厂。删任一即 break 工厂，无需修改 |
| README「token 降低 57%」是 v5.1.0 旧基准 → 改定性或换 v7 实测 | 1 句 | `README.md:157`、`CHANGELOG.md:287/439` |
| `CLAUDE.md` 验证清单补 `test-session-layers.js` + `test-migrate-v7.js` | 2 行 | `CLAUDE.md:22-27` |
| Stop 的 `background_tasks` 提取上移到 `session.js parseHookStdin` 归一 | 单点 | `stop.js:80` |

**B 档·结构性可维护性（中期，行为不变；去重前先加等价断言锁，禁止「为绿删断言」）**

1. **单笔最高 ROI**：把 agent 生命周期段（`pre-tool-use.js:388-757`，~370 行）迁回天然归属的 `agent-lifecycle-guard.js`——纯搬迁、现有 e2e 即回归网。
2. 命令守卫块内（`:331-387`）外（`:878-945`）逐字复制 → 抽 `evaluateRuntimeControlGuards` 纯函数。
3. deny 出口手写 41 处仅 27 经 `hardDeny` → 统一 `emitDeny(reason, action, {escapeHatch, dirHint})`，逃生口富化显式化。
4. 项目检测在 `pace-utils.js:320-368` 与 `path-utils.js:246-321` 双实现且已分叉 → 下沉单一 detection 模块共享。
5. 门面把 vault 扫描（`parseYamlList`+`scanRelatedNotes`）抽到 `vault-notes.js`——**注意 `pace-utils.js` 本身是干净的工厂注入门面，不要整体拆它**。
6. `test-hooks-e2e.js` 7969 行单文件 → 按 hook 拆 + run-all 脚本。

**C 档·产品方向（战略下注，需先 brainstorm）**

1. **lite profile（坡道 vs 断崖）**：`.pace/profile=lite|full`，lite 只强制 P-A-C，V/R/archive 降软提醒。**红线：绝不能做成「绕过单次 deny 的开关」**，否则侵蚀护城河可信度。
2. **5 分钟 quickstart + 竞品对标**：写完整 transcript 的上手指南 + README H1 第一段加 Spec Kit/OpenSpec/plan mode/CLAUDE.md 对照。
3. **目标 persona + 反馈通道**：把路线图从「继续加固」切到「降门槛」并验证假设。

**D 档·明确建议不做**：见下方综合层 cautions（深化对抗向量 / 为对称补全部硬门 / 单独动已 backlog 的兼容资产 / 大重构前单独修双索引）。

---

<!-- 以下「综合优化方向」「优先级行动项」「9 切面原始观察」由 workflow 输出 JSON 忠实生成，未经转写改写。 -->

## 一、综合优化方向（topDirections）

> 综合执行摘要（workflow synthesizer 原文）：
>
> PACEflow 的工程内核非常健康——确定性 hook 网关是真护城河、测试是真断言（1428 处 assert）、doc-as-code 反漂移（V7D 系列）是教科书级，多数切面的结论是「正确但脆」而非「有 bug」。当前最大的债分两层：①工程层是「同一逻辑写两遍/抄多份」的结构性冗余（pre-tool-use.js 1652 行单闭包 + deny 出口 41 处手写 + 命令守卫块在 paceEntrySignal 内外逐字复制 + 项目检测在门面与 path-utils 双实现），这与已知 backlog 里 P1 artifact 大重构是同一根因（产物/拷贝漂移），但 hook 编排层的冗余尚未进 backlog，是新增可收割面。②产品层是「为单一重度作者打磨到极致、却没为第二个用户铺路」——无 quickstart、无渐进档、无竞品对标、迁移命令用未定义的 $PLUGIN_DIR，护城河已经够深，继续加固边际收益递减。最该走的方向不是深化护城河，而是「降门槛 + 收敛重复逻辑」：前者决定产品能否被采用，后者决定系统能否继续被维护。注意有一个真实可达的隐患（budget head 永不截在多活跃 CHG 下静默突破 10K char/hook 上限，正是项目自己记录过的「上下文恢复残废」根因），值得优先于纯结构整理处理。

### 方向 1：收敛「同一逻辑写多遍」的结构性冗余（hook 编排层 + 核心库检测路径）

- **为什么**：这是横跨 4 个切面的同一根因：pre-tool-use.js 命令守卫在 paceEntrySignal 内(331-387)外(878-945)逐字复制、bash≈monitor 三联分支大段拷贝、deny 出口 41 处手写仅 27 处经 hardDeny、项目检测在 pace-utils.js(320-368) 与 path-utils.js(246-321) 双实现且已分叉。它与已知 P1 backlog「模板抄 5 份 / 双索引拷贝」是完全同源的「拷贝漂移」债，但发生在 hook 代码层而非 artifact 层，尚未进 backlog。后果不是当前 bug，而是「改一处忘改另一处」的回归脆弱性——这恰是项目 correction 反复记录的坑。
- **跨切面证据**：plugin/hooks/pre-tool-use.js:331-387 vs 878-945（命令守卫逐字重复）；pre-tool-use.js:762-788 vs 815-841（bash/monitor 拷贝）；41×process.stdout.write vs 27×hardDeny；plugin/hooks/pace-utils.js:320-368 vs pace-utils/path-utils.js:246-321（检测双实现）
- **建议**：把命令守卫前置为单一 evaluateRuntimeControlGuards 纯函数、把 deny 出口统一为 emitDeny(reason,action,{escapeHatch,dirHint}) 显式参数化、把 hasChangesDir/legacyV5FilesInDir 检测原语下沉到单一 detection 模块由门面与 path-utils 共享。去重前先加「两条路径对同一 fixture 给出一致 isPaceProject 结论」的等价性断言锁，避免去重引回归。

### 方向 2：拆解超大单函数/单文件，把「正确但脆」的认知热点降为可测纯函数链

- **为什么**：pre-tool-use.js 1652 行（核心 1450 行单闭包，~40 个 deny 点 + agent 生命周期 370 行单分支）、pace-utils.js 971 行门面混 4 类异质职责、layers.js renderArtifactFiles 多层截断跨函数耦合、test-hooks-e2e.js 7969 行 403 测试扁平排列——这些都不是假绿/bug，是导航与回归成本。新增一个 deny 分支要脑内 carry 前面所有 early-return 前置条件，只能靠黑盒 e2e 覆盖。这是可维护性临界点，不处理会持续放大每次改动的风险半径。
- **跨切面证据**：plugin/hooks/pre-tool-use.js:180-1652（单闭包）；388-757（agent 生命周期单分支 370 行）；plugin/hooks/pace-utils.js:753-925（vault 扫描内联门面）；plugin/hooks/session-start/layers.js:322-388（跨函数截断耦合）；tests/test-hooks-e2e.js 7969 行 403 test
- **建议**：按已成功的 guard 模块范式，把 deny 决策流抽成 (ctx)=>DenyDecision|null 的 evaluator 链；先把 agent-lifecycle 整段(388-757)迁到 agent-lifecycle-guard.js（天然归属）即可砍 ~370 行主入口且不改行为。门面把 parseYamlList+scanRelatedNotes 抽到 vault-notes.js。e2e 按 hook 拆文件共享 test-utils。这些都是纯结构整理，现有测试即回归网。

### 方向 3：修掉真实可达的预算/可观测性缺口（非纯整理，有实际失效面）

- **为什么**：三个切面指向同一类「沉默的失效」：①budget head 永不截在多活跃 CHG 下输出突破 10K char/hook → 被 Claude persist 成 2KB preview，正是项目 memory(claude-hook-output-10k)记录的上下文恢复残废根因复发，且 truncated 字段在 head 超限时仍返回 false 无任何信号；②e2e 日志硬编码源码树、logger 锁竞争丢写/超 1MB 砍半 → 结构性 flaky（实测 388/389，日志已 792KB 逼近 1MB）；③Stop 后台豁免读未归一的 raw.background_tasks，上游字段漂移即静默失效。这些是会真出错的，优先级高于纯重复收敛。
- **跨切面证据**：plugin/hooks/session-start/budget.js:31-46（head 永不截 + truncated 仅反映 L3）；plugin/hooks/pace-utils/logger.js:27-36（锁竞争丢写 + >1MB 砍半）+ pace-hooks.log 实测 792KB；plugin/hooks/stop.js:80（raw.background_tasks 直读）
- **建议**：budget 给 head 设软上限并在 head 超限时置 truncated=true + 记 OVER_BUDGET 日志，补 30+ CHG 下 <9500 chars 的 e2e；日志路径改可注入 PACE_LOG_PATH，e2e 每次注入独立 tmp 日志彻底解耦截断/锁竞争；background_tasks 提取+双写兜底上移到 session.js parseHookStdin。

### 方向 4：把已建好的护城河变现：降门槛而非继续加固

- **为什么**：护城河（hook 层物理 deny vs CLAUDE.md 软指令）已实现且经测试，深化的边际收益已很低；真正瓶颈是转化。三大采用空洞：无 quickstart（README 500 行是参考手册不是上手指南，新用户首次接触是被 deny 拦住）、无渐进档（六阶段全有全无，唯一出口 disable=全关，单人改 3 文件被强制 R 审计 ROI 为负）、无竞品对标（全文 0 处提 Spec Kit/OpenSpec/plan mode，最锐利的「唯一强制层」卖点埋在术语里）。60+ 版多为自审修复，存在过度拟合作者工作流的战略风险。
- **跨切面证据**：README.md 无 Quick Start 锚点（grep 命中 0）；README:18-33 六阶段全强制 + stop.js 完成度门；README:5-16 差异化只对抽象稻草人；plugin.json keywords 仅 workflow/pace/hooks
- **建议**：把下一里程碑定为「采用面里程碑」：交付物=lite profile（只强制 P-A-C，V/R/archive 降软提醒）+ 5 分钟 quickstart（装→被 deny→建 CHG→批准→验证→close 完整 transcript）+ 竞品对照表（提到 H1 第一段）+ 本地默认叙事、Obsidian 降级为可选增强。成功指标=陌生开发者 10 分钟独立走完一个 CHG 闭环。

### 方向 5：修掉「照抄即失败 / 读了即误导」的一手文档与指标漂移

- **为什么**：几处文档缺口直接坑到用户或维护者，且不在已知 backlog：README 迁移命令用未定义的 $PLUGIN_DIR（实际是 ${CLAUDE_PLUGIN_ROOT}），复制即指向文件系统根报错，而这恰是 v7 最高风险的迁移操作（锁死风险窗口内命令跑不起来放大焦虑）；README 主打「token 降低 57%」实为 v5.1.0 一次性优化的旧基准，v6/v7 已重写注入模型，是失去出处的伪精确卖点；CLAUDE.md 验证清单漏列 test-session-layers/test-migrate-v7 两个发版门测试。
- **跨切面证据**：README.md:75,86,124（$PLUGIN_DIR 未定义，grep PLUGIN_DIR= 命中 0）；README.md:157（57%）来源 CHANGELOG.md:287/439（v5.1.0）；CLAUDE.md 验证清单缺两套 release-gated 测试
- **建议**：统一占位符为 ${CLAUDE_PLUGIN_ROOT} 并给普通 shell 的 PLUGIN_DIR 求值 fallback；57% 改定性表述或用 v7 实测数字替换；CLAUDE.md/REFERENCE 验证清单补齐 test-session-layers + test-migrate-v7（若做 run-all 脚本则收敛为一行）。

## 二、优先级行动项（按 ROI，已对已知 backlog 去重）

**1. [high / M] budget head 永不截在多活跃 CHG 下静默突破 10K char/hook，重蹈「上下文恢复残废」**　_（Session 注入 / 预算）_

- 建议：给 core group head 设软上限（活跃 CHG 摘要行数封顶或 per-CHG header 走类似 TASK_INJECTION_TOTAL_MAX 总量护栏）；head 自身超 limit 时 assembleWithBudget 置 truncated=true（或返回 headOverflow），session-start.js 据此记 OVER_BUDGET 日志；补 e2e：30+ 活跃 CHG 下 core 输出仍 <9500 chars。
- 出处：plugin/hooks/session-start/budget.js:31-39（head=l1head+l0+l1+l2 永不截）+ :39,46（truncated 仅反映 L3 omit，head 超限返回 false 无信号）；layers.js:189 activeChgText→l0。真实可达且命中项目自身 memory(claude-hook-output-10k)根因；与已知 backlog SessionStart 注入质量 P1(findings.md:22) 相关但此条是新的 budget 装配层缺口、非那条已记的内容质量问题

**2. [high / S] helper --cwd 裸 ++i 吞后续 flag，reserve/set-project-root/sync-plan 静默写错 cwd**　_（Helper 脚本 / DX）_

- 建议：把 set-activation/set-artifact-root 已有的 peek-next-token 守卫（next===undefined||startsWith('-')→记 missingValue fail-closed）下沉为 parseArgs 公共模式，套用到 reserve-artifact-id:24 / set-project-root:20 / sync-plan 的 --cwd（及 reserve 的 --operation/--type）；补 e2e：`--cwd --operation` 必须 DENY 而非静默 resolve 幽灵路径。
- 出处：plugin/hooks/reserve-artifact-id.js:24 `args.cwd=String(argv[++i]||'')`；set-project-root.js:20 同款；对照 set-activation.js:35-36 有守卫。reserve 是自动化最高频带 --cwd 的 helper，可达性高，正是 reserve-artifact-id-cwd-flag memory 同一类陷阱。新增、未在 backlog

**3. [high / M] e2e 日志硬编码源码树 + logger 丢写/砍半 → 结构性 flaky（实测 388/389，日志 792KB 逼近 1MB）**　_（测试面健康度）_

- 建议：hook 读 PACE_LOG_PATH（缺省回退现路径），e2e runHook 每次注入独立 tmp 日志，彻底解除「断言 vs 截断/锁竞争」耦合；解除后可删 logDelta/projectLogLines 兜底改全量断言。短期兜底：跑前 truncate pace-hooks.log 避免逼近 1MB 砍半。
- 出处：plugin/hooks/post-tool-use.js:12（LOG=path.join(__dirname,...) 不可注入）+ logger.js:27-36（锁竞争 return 丢弃 + >1MB 砍前半）+ tests/test-hooks-e2e.js:1419/1798/6826/6925 断言共享 log；pace-hooks.log 实测 792KB。新增、确定性门的回归网本身不确定，侵蚀「绿了就安全」信任；9ab 需先隔离确认真 bug 还是环境依赖

**4. [high / S] README 迁移命令用未定义的 $PLUGIN_DIR，复制即指向文件系统根报错（命中 v7 最高风险操作）**　_（文档 / 上手）_

- 建议：统一占位符为 ${CLAUDE_PLUGIN_ROOT}（会话内可用），并给普通 shell 的 PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/.../paceflow/*/|tail -1) 一行 fallback；REFERENCE 的 <plugin>/<hooks> 也在文首统一声明等价。
- 出处：README.md:75,86,124 用 `node "$PLUGIN_DIR/..."`，grep PLUGIN_DIR= 命中 0；运行时实际变量是 ${CLAUDE_PLUGIN_ROOT}（hooks.json/commands）。迁移在 upgrade-window-hook-data-lockstep 记录的锁死风险窗口内，命令跑不起来放大焦虑。新增、未在 backlog

**5. [medium / M] 命令守卫块在 paceEntrySignal 内外逐字复制，改一处要记得改两处**　_（Hook 编排）_

- 建议：把 LocalArtifactRootChoice/ProjectRootMarker/RuntimeControl 命令工具拦截统一前置为 evaluateRuntimeControlGuards 纯函数，paceEntrySignal 块内调一次；删 878-945 中 Bash/PS/Monitor 重复分支（保留 isFileMutationTool 分支）。删前加「非 PACE 项目 Bash 写 .pace/project-root」e2e 锁定真实期望。
- 出处：plugin/hooks/pre-tool-use.js:331-387（块内 6 判断）vs 878-945（块外逐字重复，且 762-841 命令分支以无条件 return 收尾使块外命令分支近似死分支）。新增、hook 编排层冗余未进 backlog（已知 backlog 去重都在 artifact/模板层）

**6. [medium / M] deny 输出 shape 手写 41 处仅 27 经 hardDeny，逃生口/dirHint 富化按命中哪条助手隐式决定**　_（Hook 编排）_

- 建议：统一 emitDeny(reason,action,fields,{escapeHatch,dirHint,teammateSoftenable}) 出口，富化做成显式参数；先把 agent 路径 10 处 raw deny 接入并确认是否应补逃生口（有意省略用显式 escapeHatch:false 自证）。可顺带建 DENY_REASONS 元数据表使 log 自带门类型。
- 出处：pre-tool-use.js 41×process.stdout.write vs 27×hardDeny；hardDeny(219) 只加逃生口、denyOrHint(206) 加逃生口+dirHint、agent 路径 388-760 两者都不加；无 DENY_REASONS 表（grep 命中 0）。新增、文案一致性漏洞（spec §5.1 要求所有 PACE deny 统一追加逃生口）非设计意图

**7. [high / M] 项目检测逻辑在门面与 path-utils 双实现且已分叉**　_（pace-utils 核心库）_

- 建议：把 hasChangesDir/legacyV5FilesInDir/artifactDirFromChoice 检测原语下沉到单一 detection 子模块（或并入 path-utils 由门面 re-export），门面与 resolveEffectiveProjectRoot 共享同一份。先加「两条路径对同一 fixture 给出一致 isPaceProject/projectRoot 结论」等价性断言再去重。
- 出处：plugin/hooks/pace-utils.js:320-368 与 pace-utils/path-utils.js:246-321 几乎逐字重复，legacyV5FilesInDir 签名正则已开始分叉。后果是写码门误判（deny 漏放/错放）。新增、与已知 P1 artifact 重构同源「双实现漂移」但发生在检测层、独立可收割

**8. [medium / S] Stop 后台豁免读未归一的 raw.background_tasks，上游字段漂移即静默失效**　_（Session 生命周期）_

- 建议：把 background_tasks 提取 + 双写兜底(background_tasks/backgroundTasks) +「present 即 active」判定上移到 pace-utils/session.js parseHookStdin 作为归一字段，stop.js 只消费归一结果。
- 出处：plugin/hooks/stop.js:80 `raw.background_tasks` 直读；session.js parseHookStdin 未纳入该字段。这是对已知 backlog findings.md:10（Stop 后台软放行疑被上游接口漂移击穿）的具体结构性根治方向——那条是行为复现记录，此条是归一层修法，列此作为新增的根治建议

**9. [medium / S] README 主打「token 降低 57%」是 v5.1.0 旧基准，作为 v7 卖点是失去出处的伪精确**　_（文档 / 战略叙事）_

- 建议：若有 v7 实测数据用新数字+口径替换；若无则删百分比改定性表述「按相关性截断、显著降低注入量与 Compact 频率」。
- 出处：README.md:157「57%」唯一来源 CHANGELOG.md:287/439（v5.1.0 SessionStart 精简），v6/v7 已重写注入模型（README:60）。新增、未在 backlog

**10. [high / M] lite profile：把六阶段「断崖」改成「坡道」，扩大单人/小项目采用面**　_（产品方向）_

- 建议：引入 .pace/profile=lite|full：lite 只强制 P-A-C（无活跃 CHG/未批准才 deny），V/R/archive 降为 SessionStart 软提醒而非 Stop 硬 block；用户从 lite 起步按价值升级到 full。必须保持人/AI 权限边界（用户有退出权、AI 不得为绕过 deny 自行降级）。
- 出处：README:18-33 六阶段全强制 + stop.js 完成度门要求全链路否则 block；唯一出口 disable/pause=完全关闭；grep lite/minimal/渐进/skip review 命中 0；R gate 按定位只记录审计不裁决质量，强制为关会话硬门对轻量场景纯摩擦。新增、战略杠杆高需 brainstorm 设计

**11. [high / M] 5 分钟 quickstart + 竞品对照表，让最强护城河对买家可见**　_（产品方向 / 上手）_

- 建议：写 docs/quickstart.md（装→被 deny→建 CHG→批准→写码→验证→close 完整 transcript）+ examples/hello-paceflow 最小项目；README H1 第一段加竞品对照（Spec Kit/OpenSpec=生成规格不强制；plan mode=单会话退出即失效；CLAUDE.md=软指令可绕过；PACEflow=唯一在 hook 层 deny）。
- 出处：README 无 Quick Start 锚点（grep 命中 0），500 行参考手册结构；全文 0 处提竞品；新用户首次接触是被 PreToolUse deny 拦住。新增、最高战略 ROI——技术正确不等于可上手

**12. [medium / S] CLAUDE.md/REFERENCE 验证清单补齐两个发版门测试 + 加 run-all 脚本**　_（测试面 / DX）_

- 建议：CLAUDE.md:22-27 补 test-session-layers.js + test-migrate-v7.js（README 已把其 42/12 计入发版门）；加最小 run-all 脚本串 5 套件聚合退出码，e2e 支持 PACE_TEST_FILTER 分片。
- 出处：CLAUDE.md 验证清单缺 test-session-layers/test-migrate-v7；二者被 git 跟踪且 README:416 计入发版门；项目无 package.json，验证靠手敲 5 条命令。按 CLAUDE.md 照做的人会漏跑上下文恢复与升级安全两个最易回归的面。新增、未在 backlog

## 三、快赢 / 战略下注 / 明确不做

### 快赢（quickWins，低成本高收益）

- helper --cwd 加 peek-next-token 守卫（reserve/set-project-root/sync-plan），把已有的 set-activation 模式下沉为公共 parseArgs——S 成本根治高频自动化陷阱（rank 2）
- README 统一占位符为 ${CLAUDE_PLUGIN_ROOT} + 给 PLUGIN_DIR 求值 fallback，消除迁移命令复制即报错（rank 4）
- 删/改 57% 旧指标为 v7 口径或定性表述（rank 9）
- CLAUDE.md/REFERENCE 验证清单补齐 test-session-layers + test-migrate-v7（rank 12）
- Stop 的 background_tasks 提取上移到 session.js parseHookStdin 归一层（rank 8）
- 短期：跑 e2e 前 truncate plugin/hooks/pace-hooks.log 避免逼近 1MB 砍半触发 flaky（rank 3 兜底）
- scanRelatedNotes 的字面 BOM(pace-utils.js:814) 改 unicode 转义，消除不可见字符隐患（与 frontmatter 解析统一同向）

### 战略下注（strategicBets，改变产品轨迹的投入）

- lite profile（.pace/profile=lite|full）把六阶段断崖改成坡道——最直接的采用面杠杆，但需 brainstorm 设计哪些门可降级、如何不破坏确定性网关的可信度（rank 10）
- 5 分钟 quickstart + examples/hello-paceflow + 竞品对照表——把已建好的护城河变现，决定产品能否触达第二个用户（rank 11）
- pre-tool-use.js 决策流抽成 (ctx)=>DenyDecision|null evaluator 链 + agent-lifecycle 整段(388-757)迁回 guard 模块——把 1450 行单闭包降为可单测纯函数，砍 ~370 行主入口且不改行为
- e2e 按 hook 拆文件（test-pre-tool-use/test-stop/test-session-start）共享 test-utils——解决 7969 行单文件导航/review 噪声，配 run-all 脚本零额外运行成本
- 把 agent 行为契约下沉为确定性校验：对 phase-a/b 做「给定 prompt→期望 frontmatter」纯 JS 断言喂 schema 校验器，让 9-key 合同回归进自动循环（半自动 CLI 套件已停更跨两个 schema 大版本，是覆盖盲区）
- 明确 1-2 个目标 persona 与反 persona + 最轻量外部反馈通道（GitHub Discussions +「我卡在哪」issue 模板），把路线图从「继续加固」切到「降门槛」假设并验证——避免持续优化错误维度

### 明确建议不做（cautions，看似该做但综合层建议避免，附理由）

- 不要继续深化确定性网关的对抗向量（argv/目标路径解析的纵深 blocklist 根治）——已知 backlog findings.md:38 已按「纪律工具非对抗器」定位有意降级；PACEflow 不是攻击对抗器，自然可达向量已补，故意攻击才可达的向量按可达性判据不该修，再加固边际收益接近零（与 paceflow-not-quality-control memory 一致）
- 不要为「未知 operation/update-finding/update-index 无 hook 门」立刻补全部硬门——这几项已在 backlog（findings.md:14、R-23/R-24）；其中 update-finding/update-index 的 finding 流转风险低，强行为「合同一致性」给全 8 类都加 hook 门可能是过度工程，更稳妥的是先文档化「这两类故意不设 hook 门」的取舍，避免为对称而对称
- 不要现在动 task-list-sync.js / implementation_plan.md 死模板 / batch type key 等——这些都已在 backlog（findings.md:14、G-template 组）且已文档化为有意保留的兼容资产，重复处理是噪声；它们应随既定退役里程碑（如 v8）一并清，不值得单独开 CHG
- 不要在做 P1 artifact 大重构前先单独修「task.md/implementation_plan.md 双索引重复」（findings.md:21）——它与 P1 重构(findings.md:19)同一主题，单独修会被大重构推翻，应留在重构窗口一起做
- 去重/拆函数时不要「为绿删断言」或仅凭新代码推断等价——必须 before/after 实证 + 等价断言锁先行（corrections.md:9/10/11 反复记录的坑）；命令守卫去重尤其要先加反向断言（非 PACE 项目写 .pace/project-root 仍拦）再删，否则可能误删可达防御
- lite profile 不要做成「绕过单次 deny 的开关」——必须保持人/AI 权限边界（用户有退出权、AI 不得为绕过 deny 自行降级），否则会侵蚀确定性网关这个唯一护城河的可信度

## 四、9 切面原始观察（raw，每条带类别 / 严重度 / 成本 / 出处 / 现状 / 建议）

> 以下为 9 个 reader agent 的逐条原始观察，未经转写改写。`evidence` 即出处 `file:line`；`现状与问题` 描述当前行为及为何是问题或机会。

### 切面 1：Hook 编排与守卫（PreToolUse 单入口分发 + bash/powershell/marker/agent-lifecycle guards + PostToolUse/Failure）

> **整体判断**：守卫识别层（command-recognition 抽取）和确定性网关设计扎实、测试极厚（e2e 7969 行 / 主 hook 1652 行），但 pre-tool-use.js 单函数 1450+ 行、deny 出口手写 41 处、跨工具守卫三联复制，已逼近可维护性临界点；最大的结构债是「同一守卫在 paceEntrySignal 内外各写一遍」造成的认知负担与回归脆弱性。

**值得保留的设计（strengths）**

- command-recognition.js 把段首锚点/redirect 扫描/脚本引擎识别抽成单一参数化模块（segmentAnchorPrefix/scanRedirectTargets/commandRunsScriptEngine），根治了 bash/powershell 两侧「手工移植不对称」的历史 BG/PSG 漏洞，是本切面最好的一笔重构（command-recognition.js:1-92）
- guard 按工具/职责拆成独立文件（bash-guard / powershell-guard / marker-guard / agent-lifecycle-guard），module 边界清晰、可单测，pre-tool-use.js 只做编排不做识别（pre-tool-use.js:47-98 的 import 分组）
- fail-closed 设计一致且彻底：stdin 解析失败、未知工具名、缺 file_path、顶层 catch 全部 deny 而非放行，符合「保护链路不能自然放行」的安全姿态（pre-tool-use.js:316-321,842-853,1636-1651）
- deny 文案普遍 model-facing 且可执行：不仅说「禁止」，还给出正确的 artifact-writer prompt 模板、reserved-id fallback、逃生口（/paceflow:disable|pause），符合正向 framing 原则（agent-lifecycle-guard.js:325-348, pre-tool-use.js:199-205）
- schema 前向兼容 guard 放在 artifact 完整性门之后、流程门之前的位置经过推敲：写保护语义与 schema 版本无关不软化，流程裁判权让位（pre-tool-use.js:1394-1405）

**观察项（8 条）**

#### 1.1　pre-tool-use.js 单入口函数 1450+ 行，是不可拆分的认知与回归热点

- **类别 / 严重度 / 成本**：`complexity` · `high` · `L`
- **出处**：plugin/hooks/pre-tool-use.js:180-1652（withStdinParsed 回调体）
- **现状与问题**：整个分发逻辑是一个 1450+ 行的匿名闭包，内部线性堆叠了 ~40 个 deny 决策点、5 种工具的处理分支、agent 生命周期校验（388-757，单分支就 370 行）、artifact reservation/lock 编排、v5/v6/v7 布局分流。所有局部变量（denyOrHint/hardDeny/heartbeatChangeOwners/ensureArtifactWriterBase）都定义在闭包内靠闭包捕获 cwd/stdin/t0，无法单测单个决策点，只能靠 7969 行 e2e 黑盒覆盖。新增一个 deny 分支需要在脑内 carry 前面所有 early-return 的前置条件，是回归风险的主要来源。
- **建议**：按已有 guard 模块的成功范式，把决策流抽成「纯函数 + 派发表」：每个 deny 点变成 (ctx)=>DenyDecision|null 的 evaluator，pre-tool-use.js 主体退化为「构造 ctx → 顺序跑 evaluator 链 → 第一个非空即 emit」。先抽 agent-lifecycle 整段（388-757）到 agent-lifecycle-guard.js（它已经是该文件的天然归属），可立即砍掉 ~370 行主入口体积且不改行为。

#### 1.2　deny 输出 shape 手写 41 处，hardDeny 助手只覆盖 27 处，逃生口/artifactDirHint 富化不一致

- **类别 / 严重度 / 成本**：`redundancy` · `medium` · `M`
- **出处**：pre-tool-use.js: 41× `process.stdout.write(JSON.stringify(output))` vs 27× `hardDeny(`；hardDeny(219-230) 经 withEscapeHatch 但不经 appendArtifactDirHint；denyOrHint(206-218) 两者都经；agent 路径 10 处 raw deny（388-760）两者都不经
- **现状与问题**：同一个 `{hookSpecificOutput:{hookEventName,permissionDecision:'deny',permissionDecisionReason}}` 结构被手写了 ~22 次（外加 additionalContext 变体），每处都重复 stdout.write+log+return 三连。更要命的是三条富化路径不一致：hardDeny 只加逃生口、denyOrHint 加逃生口+artifactDirHint、agent 生命周期 10 处 raw deny 两者都不加（已用 grep 确认 388-760 段 0 次 withEscapeHatch）。结果是「用户能否在被拦时看到 /paceflow:disable 出口」取决于命中哪条 deny，而非取决于该 deny 是否真的该给出口——这是文案一致性漏洞，不是设计意图（spec §5.1 要求所有 PACE deny 统一追加逃生口）。
- **建议**：统一一个 emitDeny(reason, action, fields, {escapeHatch, dirHint, teammateSoftenable}) 出口，所有 deny 经它。富化策略做成显式参数而非靠「调了哪个助手」隐式决定。先把 agent 路径 10 处 raw deny 接入 emitDeny，确认是否应补逃生口（若有意省略，在 emitDeny 里用显式 escapeHatch:false 自证而非靠遗漏）。

#### 1.3　local-artifact-root-choice / project-root-marker 守卫在 paceEntrySignal 内外各写一遍（Bash/PS/Monitor 路径几乎不可达）

- **类别 / 严重度 / 成本**：`redundancy` · `medium` · `M`
- **出处**：块内：pre-tool-use.js:331-387（isBashTool/isPowerShellTool/isMonitorTool × LocalArtifactRootChoice/ProjectRootMarker）；块外重复：878-945（同样六个判断逐字重复）；中间 762-841 每个命令工具分支以无条件 return 收尾
- **现状与问题**：在 `if(paceEntrySignal)` 块内（331-387）已对 Bash/PS/Monitor 做了 LocalArtifactRootChoice + ProjectRootMarker 拦截；而每个命令工具的专属分支（762-787 bash / 789-814 ps / 815-841 monitor）都以无条件 return 结束。因此 paceEntrySignal 为真时，控制流永远在 854 行前 return，878-945 行那套对 Bash/PS/Monitor 的重复判断只在 paceEntrySignal 为假（非 PACE 项目）时才可达——而 .pace/artifact-root、.pace/project-root 这些 marker 本就是 PACE 运行态，非 PACE 项目里几乎不会成为命令目标。即块外那 6 个命令工具判断是「为对称写的近似死分支」，且与块内逻辑逐字重复，改一处要记得改两处（典型单点污染多分支）。注意：Write/Edit/MultiEdit 在 854 行后才走到 868+，所以 868/908/946 的 isFileMutationTool 判断是真活的——只有命令工具那 6 段重复是问题。
- **建议**：把 LocalArtifactRootChoice/ProjectRootMarker/RuntimeControl 的命令工具拦截统一前置到一个 `evaluateRuntimeControlGuards(toolName, command, cwd)` 纯函数，在 paceEntrySignal 块内 Bash/PS/Monitor 分支调用一次即可；删掉 878-945 中针对 Bash/PS/Monitor 的重复分支（保留 isFileMutationTool 分支）。删前用 e2e 加一条「非 PACE 项目 Bash 写 .pace/project-root」断言锁定真实期望，避免误删可达防御。

#### 1.4　runtime-control / artifact-write 三联工具分支（bash≈monitor）大段复制

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `M`
- **出处**：pre-tool-use.js:762-788(bash) 与 815-841(monitor) 的 mutatesArtifact 表达式逐字相同（bashCommandRedirectsToArtifact||bashShell...||bashCommandEmbeds...||(looksMutating&&references)）；monitorArtifactDenyReason(150-156) 与 bashArtifactDenyReason 仅文案首词不同
- **现状与问题**：Monitor 工具完全复用 bash-guard 的识别函数（因为 Monitor 跑 bash 命令），导致 bash 分支与 monitor 分支是同一段逻辑的两份拷贝，唯一差别是 deny 文案里「Bash」vs「Monitor」和 log action 标签。同理 monitorArtifactRuntimeControlDenyReason/monitorArtifactDenyReason 与 bash 版仅首词不同。任何对 bash 识别管道的修正（如又一个 BG-xx）都要记得 monitor 分支同步，这正是 command-recognition 抽取想根治、但在 hook 编排层又复发的「移植不对称」。
- **建议**：把命令工具分支参数化为 handleCommandTool({toolName, guard, denyReason})，bash 与 monitor 传同一 bash-guard、不同 denyReason 工厂；PowerShell 传 powershell-guard。deny 文案用 `禁止使用 ${toolLabel} 修改 artifact...` 模板单源化，消除三份近似拷贝。

#### 1.5　commandInput 同时别名为 bashCommand 与 powershellCommand，按工具语义切换靠调用点纪律

- **类别 / 严重度 / 成本**：`coupling` · `low` · `S`
- **出处**：pre-tool-use.js:187-189 `const bashCommand = commandInput; const powershellCommand = commandInput;`；Monitor 分支(816,823,829) 用 bashCommand 喂 bash-guard 是对的，但 351/379/898/937 行 Monitor 也复用 bashCommand
- **现状与问题**：bashCommand 和 powershellCommand 是同一个 commandInput 的两个别名，纯粹为可读性。但这制造了一个隐式契约：调用点必须按当前 toolName 选对别名喂对应 guard。Monitor 分支选 bashCommand 喂 bash-guard 是正确的（Monitor 跑 bash），但这个正确性完全靠人工纪律——若某天 Monitor 改用 PowerShell 风格命令，这里不会有任何类型/结构提示。当前无 bug，是潜在脆弱点。
- **建议**：删除两个别名，统一用 commandInput；或者把「toolName → 对应 guard 模块」做成一张显式映射表（已有 commandExecutionLooksMutating(132-135) 在做类似分流，可扩展为完整 guard 选择器），让工具→guard 的对应关系集中可见而非散落在每个调用点。

#### 1.6　PostToolUse 单函数也开始堆叠（347 行线性 warning 累积），与 pre-tool-use 同构债

- **类别 / 严重度 / 成本**：`maintainability` · `low` · `M`
- **出处**：plugin/hooks/post-tool-use.js:22-347（withStdinParsed 回调体），含 schema 校验、verified/reviewed-date 校验、owner 催办循环、walkthrough 修复 continue-block、v5/v7 布局提示、Obsidian CLI 刷新等 ~10 类独立检查全塞进一个闭包
- **现状与问题**：PostToolUse 走的是 warning 累加模型（warnings[]/continueBlocks[]）而非 early-return，本身比 pre-tool-use 更线性、可读性稍好；但同样把 schema 合同校验、终态催办、知识库刷新、布局迁移催办等正交关注点堆在 347 行单函数里，且部分逻辑（marker 检测 186-192、verified/reviewed-date 校验 162-180）与 pre-tool-use/marker-guard 的检测语义重叠但各写一份。趋势上会复制 pre-tool-use 的可维护性问题。
- **建议**：把 PostToolUse 的检查也抽成 collectWarnings(ctx) 子函数数组（每个返回 warning[]），主体只做 ctx 构造与输出聚合。优先把 marker 检测（186-192）复用 marker-guard.detectChangeDetailMarkerMutation，消除 pre/post 两份 APPROVED/VERIFIED/REVIEWED 检测逻辑的漂移风险。

#### 1.7　reservation 校验在 agent 路径与文件写路径双重实现，语义重叠

- **类别 / 严重度 / 成本**：`complexity` · `low` · `M`
- **出处**：agent 派遣路径：pre-tool-use.js:485-609（explicitReservationFromPrompt + reservationMatchesExplicit + findArtifactReservationForRel）；文件写路径：1039-1103（findArtifactReservationForRel + reservationMatchesArtifactRel + writeNeedsReservation）
- **现状与问题**：reservation 的「是否需要预留 / 是否匹配预留」在两个地方各实现一套：一套针对 agent prompt 字段（reserved-id/reserved-file-prefix 文本解析），一套针对实际 Write 的目标文件路径。两者目标一致（确保 CHG/HOTFIX/CORRECTION 编号来自 hook 预留而非 agent 自分配），但用不同的 helper、不同的匹配规则（explicit prefix startsWith 容错 vs reservationMatchesArtifactRel 精确）。这是 reservation 这一不变量被切成两半防守，理解成本高，且容错策略不统一（prefix 容错只在 agent 路径有）。
- **建议**：中期把 reservation 校验收敛为单一 verifyReservation(ctx) 入口，输入归一为 {operation, declaredId, targetRel, owner}，让 agent 路径与文件写路径调同一个判定，容错策略单源。短期至少在两处加交叉引用注释，标明它们防守同一不变量、为何匹配规则不同。

#### 1.8　deny 决策点缺少集中的「门类型 → severity/可恢复性」分类，运维可观测性靠 log action 字符串

- **类别 / 严重度 / 成本**：`dx` · `low` · `S`
- **出处**：pre-tool-use.js 中 ~40 个 log action 标签（DENY_AGENT_LIFECYCLE_PROMPT / DENY_V6_C_PHASE / DENY_ARTIFACT_RESOURCE_LOCK / DENY_BAD_STDIN ...）散落在各 deny 点，无集中枚举
- **现状与问题**：每个 deny 点手写一个 log action 字符串，且分为「完整性硬门（fail-closed，如 BAD_STDIN/BAD_TOOL）」「流程软门（teammate 可降级，如 V6_C_PHASE）」「并发门（可重试，如 RESOURCE_LOCK）」三类语义，但这个分类只存在于阅读者脑中，没有任何机器可读的归类。调试某条 deny 为何触发、或统计哪类门最常拦截，只能 grep 字符串。这对一个「确定性流程门」产品的可观测性是缺口。
- **建议**：建一张 DENY_REASONS 常量表（action → {category:'integrity|flow|concurrency|config', recoverable, teammateSoftenable, escapeHatch}），deny 出口从表取元数据，既消除手写字符串漂移，又让 log 自带门类型，便于运维统计与 e2e 按类断言。

### 切面 2：pace-utils 核心库

> **整体判断**：核心库工程质量高（272/272 测试绿、失败模式考虑周全、关键路径有缓存与守卫），但 pace-utils.js 门面仍背负三类异质职责，且与 path-utils.js 存在一条平行的项目检测代码路径——这是最大的可维护性债与漂移风险源。

**值得保留的设计（strengths）**

- locks.js 的并发失败模式设计扎实：in-flight 空文件 1s 宽限（jsonLockIsStale ROB-02, locks.js:142-153）区分「另一进程刚 openSync(wx) 尚未写 body」与「真损坏锁」，避免抢占致双持；acquireJsonLock 用 openSync('wx') 原子建锁 + 指数退避（locks.js:155-193）是正确的跨进程互斥姿势。
- constants.js 对 TTL/wait/路径脚本做了真正的集中化，且全部走 `Math.max(下限, Number(env)||默认)` 模式（constants.js:23-33），既可 env 覆盖又有下限守卫，防止 0/NaN 致退化。
- path-utils.js 的 resolveToolFilePath 用 path.posix.normalize 折叠 ./.. 而非 path.resolve（path-utils.js:54-62），正确保留 Windows 盘符并堵住 PU-001 路径穿越伪造批准标志——这是 CWD 漂移历史教训的正向沉淀。
- change-analysis.js 用依赖注入（createChangeAnalysis(ctx) 接收 readActive/getArtifactDir）打破了与门面的循环依赖，子模块边界清晰、可独立测试。
- session.js parseHookStdin 对 JSON.parse 返回 null/数组/数字的非对象真值做了归一（session.js:26-28 PUC-02/ROB-01），fail-safe 到空对象，hook 入口稳健不崩。
- _artifactDirCache / _codeCountCache / _planFilesCache 三处模块级缓存（pace-utils.js:464,540, plans.js:14）把同一 hook 进程内重复 existsSync/readdirSync 从 N 次降到 1 次，针对 hook 高频调用的正确优化。

**观察项（6 条）**

#### 2.1　项目检测逻辑在门面与 path-utils 双实现且已分叉

- **类别 / 严重度 / 成本**：`redundancy` · `high` · `M`
- **出处**：plugin/hooks/pace-utils.js:320-368 (hasChangesDir + legacyV5FilesInDir) 与 plugin/hooks/pace-utils/path-utils.js:246-321 几乎逐字重复；path-utils 额外有 hasV6ArtifactRoot/configuredRootHasArtifacts(264-279) 复刻了门面 getConfiguredArtifactDir/getArtifactDir 的判定。
- **现状与问题**：同一个「这是不是 PACE 项目 / 是不是 v5 legacy / artifact 根在哪」的问题由两条独立代码路径回答：门面侧驱动 getArtifactDir/isPaceProject（运行时写保护、激活判定），path-utils 侧驱动 resolveEffectiveProjectRoot（Project Root 继承/worktree）。两份 legacyV5FilesInDir 的签名正则已经开始分叉（门面版有英文 fixture 注释段，路径版无差异但被 hasLegacyV5Root 包了一层 vault 扫描）。改一边忘改另一边时，「门面认为是 PACE 项目但 Project Root 解析认为不是」这类不一致正是项目记忆里 spec-vs-product 漂移的典型场景，且后果是写码门误判（deny 漏放或错放）。
- **建议**：把 hasChangesDir / legacyV5FilesInDir / artifactDirFromChoice 这组纯检测原语下沉到一个 detection 子模块（或并入 path-utils 并由门面 re-export），门面与 resolveEffectiveProjectRoot 都引用同一份。先加一个断言测试「两条路径对同一 fixture 目录给出一致的 isPaceProject/projectRoot 结论」锁死等价性，再做去重，避免去重过程引入回归。

#### 2.2　971 行门面仍混入 vault/wiki 扫描与 YAML 解析，非核心 PACE 职责

- **类别 / 严重度 / 成本**：`architecture` · `medium` · `M`
- **出处**：plugin/hooks/pace-utils.js:753-925 的 parseYamlList(753) + scanRelatedNotes(804) 共约 170 行处理 Obsidian wiki/knowledge/thoughts 递归扫描与 frontmatter，全部内联在门面；门面同时还有 v5 检测(325-410)、artifact-root 配置(266-318)、模板创建(719-742)。
- **现状与问题**：门面文件名义上是「兼容门面 + 子模块边界」（见 pace-utils.js:6 注释），但实际仍是最大的实现文件，承担了至少四类异质职责：①子模块 re-export 编排 ②artifact 目录/root 配置决策 ③v5 legacy 检测 ④Obsidian vault 知识库扫描。scanRelatedNotes 只被 SessionStart 注入用，与 PACE 流程门核心无关，却让门面无法被当作纯薄编排层阅读，新人定位「门控逻辑在哪」要先跳过 wiki 扫描。
- **建议**：把 parseYamlList + scanRelatedNotes 抽到 pace-utils/vault-notes.js（依赖注入 VAULT_PATH），artifact-root 配置与 v5 检测抽到 pace-utils/artifact-root.js / pace-utils/legacy-v5.js。门面回归到「require 子模块 + re-export + 少量跨模块胶水（getArtifactDir 这种需要 5+ 子模块协作的）」，目标把门面压到 400 行内、职责单一。

#### 2.3　门面 require-cache 注释与实际重载协议不符，易误导维护者

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：plugin/hooks/pace-utils.js:6-21 注释称「门面重载时也要刷新会读取 process.env 的子模块缓存」；实测 node -e 连续两次 require('./pace-utils') 在中途改 PACE_VAULT_PATH 后 VAULT_PATH 不变（仍是首次加载值），因为门面自身已被 cache、其顶层 `const {VAULT_PATH} = require(...)` 冻结在首次求值。
- **现状与问题**：门面内的 delete require.cache 循环只删子模块、删不掉门面自己；真正生效靠调用方先 delete 门面缓存（tests/test-hooks-e2e.js:7186 等处正是这么做的）。所以这是一个「两段式协议的后半段」，但注释读起来像门面自己就能完成重载。生产里每个 hook 是独立 node 进程、无此问题，但测试作者或后续维护者若据注释以为门面能自刷新 env，会写出错误的 env-scrub 测试或误判 bug。
- **建议**：把注释改成明确两段式：「调用方（测试）必须先 delete 门面缓存再 require；门面内的子模块缓存清理是为了让重载后的子模块也重读 env，二者缺一不可」。或者更彻底：把读 env 的常量（VAULT_PATH）改为 getter 函数而非顶层 const，从根上消除冻结问题（但会扩散调用点，权衡 effort）。

#### 2.4　163 个导出的扁平公共 API 表面过大

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `L`
- **出处**：node -e 统计 require('./pace-utils') 导出 163 个 symbol；module.exports 分组列在 pace-utils.js:928-971，覆盖常量/路径/锁/预留/计划/解析/stdin 七大类全部展平到一个命名空间。
- **现状与问题**：20 个 hook 全部 require 同一个门面（grep 确认无任何 hook 直连子模块），意味着任何 hook 想用一个函数就把 163 个全拉进作用域，且无法从 import 处看出某 hook 实际依赖哪个子系统。这让「这个锁函数还有没有人用」「删这个导出安不安全」很难判断——死代码探测、影响面分析都得全仓 grep。API 表面越大，前向兼容承诺越重（locks.js:238 注释已显示资源名因兼容不敢改）。
- **建议**：中期方向：按子系统暴露分命名空间（require('./pace-utils').locks.acquireJsonLock）或允许 hook 直接 require 子模块，让依赖在 import 处显形。短期低成本：在门面 export 块用注释标注每个分组的「唯一消费 hook」，并加一个测试断言「每个导出至少被一个 hook/test 引用」以机械化探测死导出。

#### 2.5　frontmatter 解析存在 3+ 份实现，BOM 处理不一致

- **类别 / 严重度 / 成本**：`redundancy` · `low` · `S`
- **出处**：pace-utils.js:814 用字面 BOM `^﻿?---`，pace-utils.js:899 与 change-analysis.js:43 用 `^﻿?---`，line-endings.js:12/22 用 `^---` + 独立 stripBom；共 4 个文件 5 处 frontmatter 起始匹配，三种 BOM 写法。
- **现状与问题**：scanRelatedNotes 的 wiki 层 fmOf(814) 用源码里直接敲进去的 BOM 字符（在 diff/编辑器里不可见，易被误删或编码转换破坏），而同函数的 knowledge 层(899) 却用安全的 ﻿ 转义——同一函数内两种写法本身就是漂移信号。已有导出的 parseFrontmatter（change-analysis.js:42）能力更全（返回 map），但 scanRelatedNotes 没复用而是内联了 fmOf/summaryOf/statusOf 三个迷你解析器。
- **建议**：统一一个 parseFrontmatter（含 ﻿ BOM + CRLF 容忍）作为唯一入口，scanRelatedNotes 改用它取代内联 fmOf/summaryOf/statusOf。至少先把 814 的字面 BOM 改成 ﻿ 转义，消除不可见字符隐患。

#### 2.6　锁/预留匹配的 fail-open 默认放行需显式测试护栏

- **类别 / 严重度 / 成本**：`test-quality` · `low` · `S`
- **出处**：reservationMatchesArtifactRel 对无法识别的 artifactRel 直接 return {ok:true}（locks.js:802，及 785 的空值短路）；ownerScopedPath 在无 ownerKey 时返回 '' 致 readArtifactReservation 静默返回 null（locks.js:280,300-312）。
- **现状与问题**：这些 fail-open 默认在「门控工具而非安全边界」的产品定位下是合理选择（漏放优于误锁），但默认放行分支一旦因上游 rel 格式变化（如未来 changes/ 子目录加深）意外命中，会静默放过本该匹配的预留校验，且不会有任何测试失败提示——因为默认就是 ok:true。这类「沉默的正确性」最容易在重构中悄悄退化。
- **建议**：为 reservationMatchesArtifactRel 的「已知 rel 形态必须走精确分支、绝不落入末尾默认」加显式断言测试：构造 changes/chg-... 与 corrections/... 各一例，断言不匹配的预留返回 {ok:false} 而非默认 true。把默认放行从「无测试覆盖的兜底」变成「有反向护栏的有意降级」。

### 切面 3：Session 生命周期与上下文注入

> **整体判断**：这一切面整体工程质量高——三段式解耦（effects/collect/layers/budget）让 1003 行注入逻辑里真正难测的纯渲染部分可喂 fixture 单测（42/42 通过），生命周期 hook 普遍 fail-open + 顶层 try-catch 不会 brick 主流程；但预算管理存在一个真实可达的破口：core group 的 head 永不截断假设在「多活跃 CHG 累积」场景下会静默突破 10K char/hook 上限，正是本项目自己记录过的「上下文恢复残废」根因。

**值得保留的设计（strengths）**

- 三段式解耦（runtime-effects 写盘 / collect-state 纯读 / layers 纯渲染 / budget 装配）把副作用与渲染彻底分离，PRINT_ONLY 单点短路替代原来 7 处散落守卫，是真正降低耦合的重构——layers.js 虽 1003 行但拆成 34 个命名良好的小纯函数，可测性极佳
- budget.js 的 L3 优先截断方向（head 永不截、L3 从尾按条 omit + 「已省略 N 条」footer）信噪比设计正确：动态上下文（我刚在做/git）优先于可随时 Read 的相关经验，且单位用 chars 对齐 Claude Code per-hook cap 而非过度保守的 bytes
- Stop gate 的后台任务豁免对 background_tasks 做了纵深防御（malformed/null/空 status 全过滤），并有完整 e2e 覆盖（含畸形输入、未 reviewed 不降级软通过等对抗 case）
- 生命周期 hook 全部 fail-open + 顶层 try-catch：counter 不可写时降级放行避免 Stop 死循环（STOP-02）、artifact-root 配置异常时反而 fail-closed 阻断（PUC-01），fail 方向按语义分别取舍而非一刀切
- PreCompact 快照机制整体退役、compact 与 startup 统一走实时读路径（A0 对称），消除了一整类「快照与实物漂移」的状态一致性 bug，是减法式的好架构演进
- findings 过期提醒三元组（W12 写 flag + collectAgedFindings 读 + renderAgedFindings 渲染）整体归同一 group，根除了跨 group 写读时序割裂导致「永不注入」的隐患，注释把时序约束讲得很清楚

**观察项（6 条）**

#### 3.1　core group 注入可静默突破 10K char/hook 上限——多活跃 CHG 场景下整段被 persist 成 2KB preview

- **类别 / 严重度 / 成本**：`performance` · `high` · `M`
- **出处**：plugin/hooks/session-start/budget.js:31-39（head=l1head+l0+l1+l2 永不截）+ layers.js:189 activeChgText→l0 + layers.js:203 crossSession→l0；实测 60 个 running CHG 摘要 → assembleWithBudget(9500) 输出 13704 chars
- **现状与问题**：assembleWithBudget 只截 l3，head 永不截。core group 把「活跃 CHG 摘要」（每个 CHG 一行 header → l0）、「执行上下文/foreign/blocked/inconsistent 段」（→ l0）全放在 head。renderActiveChangeSummary 只有 TASK_INJECTION_TOTAL_MAX=3000 限制任务**体**，对 per-CHG header 行数和执行上下文块没有任何上限。当项目累积大量未 close 的活跃 CHG（TASK_INJECTION_TOTAL_MAX 注释自己点名的「含忘 close 的累积」场景），core hook 输出突破 10000 chars 上限。按本项目自己的 memory（claude-hook-output-10k-char-cap）这会让整个 core hook 输出被 Claude persist 成 2KB preview——上下文恢复残废，正是当初拆双 hook 要解决的问题在 core 侧复发。全局 46000 bytes 字节守卫（session-start.js:58）拦不住：13704 chars 全 CJK≈41K bytes < 46000。
- **建议**：给 core group 的 head 也设一个软上限：要么把活跃 CHG 摘要行数封顶（如 >N 个 CHG 时折叠为「另有 K 个活跃 CHG，Read task.md」），要么让 renderActiveChangeSummary 的 per-CHG header 累计 chars 也走类似 TASK_INJECTION_TOTAL_MAX 的总量护栏；并补一条 e2e：core group 在 30+ 活跃 CHG 下输出仍 <9500 chars。

#### 3.2　Stop gate 后台任务豁免依赖未归一化的上游 raw 字段 background_tasks

- **类别 / 严重度 / 成本**：`coupling` · `medium` · `S`
- **出处**：plugin/hooks/stop.js:76-85 activeBackgroundTasks 直接读 input.raw.background_tasks；pace-utils/session.js:31-49 parseHookStdin 未把 background_tasks 纳入归一字段
- **现状与问题**：parseStdinSync 对所有其他 Claude Code 输入字段（session_id/tool_input/last_message…）都做了 snake/camel 双写归一和兜底，唯独 background_tasks 是 stop.js 直接从 raw 对象里抓的裸字段。代码注释（stop.js:78-79）还内联了对上游行为的假设「Claude Code removes completed/failed background work from this array」——这是对未公开/可能漂移接口的硬依赖。一旦上游改字段名（如 backgroundTasks）或语义（保留 completed 项），Stop gate 的豁免会静默失效（要么该豁免不豁免=误阻断，要么不该豁免误豁免=漏拦），且因为不在归一层、无单点可改。
- **建议**：把 background_tasks 的提取 + 双写兜底（background_tasks/backgroundTasks）+「present 即 active」的判定语义上移到 pace-utils/session.js 的 parseHookStdin，作为一个归一字段透出；stop.js 只消费归一结果。这样上游漂移时只改一处，且与其余字段的归一策略一致。

#### 3.3　SubagentStop 每次都 eager 读取最多 200KB agent transcript，即便 prompt 已能确定 operation

- **类别 / 严重度 / 成本**：`performance` · `low` · `S`
- **出处**：plugin/hooks/subagent-stop.js:88-96 candidates 数组用 `...readTranscriptStrings(stdin.agentTranscriptPath)` 在 spread 时立即求值；readTranscriptStrings 读 200000 bytes（行 60-65）
- **现状与问题**：inferCloseTarget 的 candidates 数组把 prompt/lastMessage 排在前、transcript 排最后，循环里命中即 return，本意是「优先用便宜的 candidate」。但 JS 数组字面量在构造时就 eager 求值所有元素——`...readTranscriptStrings(...)` 在进入循环前就把 200KB transcript 读盘 + JSON.parse 逐行 collectStrings 跑完了，短路根本没生效。这在每一次 artifact-writer SubagentStop 都发生（PACE 项目里非常高频），而绝大多数情况 operation 在第一个 candidate（prompt）就能确定。
- **建议**：把 transcript 读取改为 lazy：先只用前 5 个便宜 candidate 跑一轮匹配循环，全部 miss 时才调用 readTranscriptStrings 跑第二轮。或把 candidates 改为函数数组/生成器，按需求值。改动局部、行为等价、有现成单测（inferCloseTarget 已导出可测）保护。

#### 3.4　renderArtifactFiles 的多层 per-file 截断逻辑复杂度集中，且 truncators 互相耦合到 ARCHIVE 兜底分支

- **类别 / 严重度 / 成本**：`complexity` · `medium` · `M`
- **出处**：plugin/hooks/session-start/layers.js:322-388 renderArtifactFiles + 322-644 五个 truncate* 函数；findingsArchiveMissing 分支（337-339）与 truncateFindings 内的 footer 补写（369-371）跨函数耦合
- **现状与问题**：artifact 文件注入的截断是这一切面最难懂的热点：每个文件有「ARCHIVE 切分 / findings 缺 ARCHIVE 特例 / 通用字节兜底 / 类内 impact-或-date 优先截断」多条路径交织，findingsArchiveMissing 的判定在 renderArtifactFiles 算、footer 补写却在 truncateFindings 里、缩小生效又依赖下游 packL3——一个行为分散在三处。注释非常详尽（这是优点）说明逻辑本身经过多轮 finding 打磨且正确，但认知负荷高、改一处易碰另一处。这是「正确但脆」的可维护性债，不是 bug。
- **建议**：考虑把「单个 artifact 文件 → 截断后 block」抽成一个以 file 类型为 key 的策略表（每种文件一个 truncate 策略 + 是否需要 ARCHIVE footer 的声明），让 renderArtifactFiles 退化为「查策略 + 套用」的瘦循环，把 findingsArchiveMissing 这类跨函数状态收进单个策略内部。无需改输出，纯结构整理，现有 truncate* 单测可作为回归网。

#### 3.5　renderCrossSessionAndExecution 单函数 120 行、6 个执行上下文分支 + 多处 slice(0,5) 魔法数散落

- **类别 / 严重度 / 成本**：`maintainability` · `low` · `S`
- **出处**：plugin/hooks/session-start/layers.js:807-928（foreign/blocked/inconsistent/detailPending/hasCompleted/hasIndexPending/无活跃 六态）；slice(0,5) 重复出现于 875/889/904，slice(-3) 于 820
- **现状与问题**：这是 layers.js 里唯一明显偏长的渲染函数，把「跳过任务提醒 / Superpowers 桥接 / v7 迁移提示 / 前向兼容提示 / 4 个 owner 分组 section / 6 路执行上下文兜底」塞进一个 try。各段展示上限（5 条 / 3 条）是散落的字面量而非命名常量，与 collectState 里 IN_PROGRESS_TASK_LIMIT/TASK_LINE_MAX_CHARS 那种「命名 + 注释解释为什么」的风格不一致。整体不影响正确性，但相比同文件其他小函数，这里是认知密度突起点。
- **建议**：把 4 个 owner 分组 section（foreign/blocked/inconsistent + 执行上下文兜底）各抽成独立小 render 函数，与文件其余风格对齐；把 5/3 这类展示上限提为命名常量并注释取值依据。可顺带让执行上下文的六路 if/else-if 兜底改成更显式的状态判定，减少「自相矛盾」类 finding（注释 922-924 已在防这个）复发面。

#### 3.6　budget 的 head 永不截语义与「per-hook 是真预算」之间缺一条端到端守卫断言

- **类别 / 严重度 / 成本**：`test-quality` · `low` · `S`
- **出处**：tests/test-session-layers.js:253-278 仅断言 artifact group 满载被截到 ≤9500；无对应的 core group 满载断言；budget.js:46 返回 truncated 仅反映 L3 是否被截，不反映 head 是否已超 limit
- **现状与问题**：测试覆盖很好地证明了「L3 会被截、head 不会被截」，但没有一条测试守住「无论哪个 group、无论多少活跃 CHG，assembleWithBudget 的最终 text 不超过 limitChars（或至少标记 truncated）」这个真正重要的不变量。当前 truncated 字段在 head 自身就超出 limit 时仍返回 false（remain 被 Math.max(0,...) 夹到 0、L3 全 omit 但 head 原样输出），调用方（session-start.js:213）拿不到任何「我已超预算」的信号，日志里 truncated 也记 no——可观测性缺口，与上面 high 项是同一根因的两面。
- **建议**：补一条断言：assembleWithBudget 在 head 自身超 limit 时应至少把 truncated 置 true（或返回 headOverflow 标志），并让 session-start.js 在该情况下记一条 OVER_BUDGET 日志。再加一条 core group 满载（多 CHG）的端到端 chars 上限断言，把 high 项的回归网钉死。

### 切面 4：Agent 合同与确定性网关（artifact-writer contract + agent-lifecycle-guard gate）

> **整体判断**：合同设计成熟、确定性网关与封闭 schema 的分层职责清晰、且已有机器化反漂移测试（V7D-1/2/3）兜底；但"确定性门"并非全覆盖——未知 operation 与若干 operation 完全不经 hook 校验只靠 agent 自觉，且 agent.md 的可复制模板已与 hook 实际必填集发生 deny 级漂移（close-chg 缺 implementation-notes）。

**值得保留的设计（strengths）**

- 职责分层干净：agent system prompt 保持精简（~150 行），详细 schema/instruction 按需 Read（artifact-writer.md:145、spec.md:5-6），避免了 correction 记录里提到的「内嵌全部规范导致 prompt 膨胀」反模式。
- 封闭 9-key 合同三处单源对齐并有机器测试钉死：spec.md:83 的 `<!-- schema-keys: ... -->` 机器注释 = change-analysis.js:231-235 的 SCHEMA_V7_KEYS 代码字面量 = V7D-3 测试断言（test-pace-utils.js:3471），这是教科书级的 doc-as-code 防漂移。
- V7D-2（test-pace-utils.js:3437）把 hook deny 文案模板字段集 pin 到 instructions/*.md 模板字段集，从机制上消除了「hook 改字段但 instruction 没跟」这一类最高频漂移；V7D-1 验证 agent.md close-chg 必填集 ⊇ guard 实际校验集。
- 正向 framing 贯彻良好：模板全用「该填什么」结构化字段（artifact-writer.md:200-361），deny 文案都附带可复制的正确模板（agent-lifecycle-guard.js promptTemplateForOperation），符合 positive-instruction-framing 经验。
- 确认边界（approval/verification/review-confirmed）一律靠 hard-deny 字段强制而非 agent 自觉（agent-lifecycle-guard.js:480-578），符合 deterministic-gate-over-llm-soft 经验；REVIEWED/VERIFIED 双表示单权威 + 一致性约束设计自洽（spec.md §7/§7.1）。
- 幂等语义在每个写标记 action 上都明确定义（approve/verify/review/close 全部有「已存在→SUCCESS 幂等不重写」分支），重派安全。

**观察项（7 条）**

#### 4.1　agent.md 的 close-chg 可复制模板缺 implementation-notes，照抄即被 hook deny

- **类别 / 严重度 / 成本**：`doc-drift` · `high` · `S`
- **出处**：plugin/agents/artifact-writer.md:271-284（§正向输入模板 close-chg 块，无 implementation-notes）vs plugin/hooks/pre-tool-use/agent-lifecycle-guard.js:564（close-chg 缺 implementation-notes → DENY）vs plugin/agent-references/instructions/close-chg.md:22-24（模板含 implementation-notes）
- **现状与问题**：artifact-writer.md §正向输入模板是主 session 被反复指引去「复制 prompt 顶部模板」的权威来源（agent.md:160、202）。该 close-chg 模板缺少 implementation-notes 这一硬必填字段；主 session 若忠实照抄此模板派 close-chg，会被 agent-lifecycle-guard.js:556-578 直接 deny（missing-fields），属于一手文档把用户引进死路。这正是 spec-not-product-source-of-truth 经验里「产物漂移」的实例：三处模板（agent.md / instructions / hook）字段集本应一致却三向分叉。V7D-2 测试只 pin 了 instructions/*.md ↔ hook，没 pin agent.md §正向输入模板 ↔ hook，所以这条漂移测试绿灯也照不到。
- **建议**：在 agent.md:282 后补 `implementation-notes:` 行（与 instructions/close-chg.md:22-24 对齐）；并把 V7D-2 测试扩展为同时 pin agent.md §正向输入模板的 ```text 块（不只 instructions/），让 agent.md 模板也进机器反漂移网。

#### 4.2　close-chg 字段顺序三处不一致，增加人读对照成本

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `S`
- **出处**：agent-lifecycle-guard.js:144-153（complete-open-tasks→verify-summary→review-confirmed→...→implementation-notes→walkthrough）vs instructions/close-chg.md:17-25（...→review-findings→verify-summary→implementation-notes）vs agent.md:277-283（...→review-findings→verify-summary，无 implementation-notes）
- **现状与问题**：三份 close-chg 模板的字段排列顺序各不相同（verify-summary 相对 review-confirmed 块的位置在 hook 与两份 md 之间翻转）。字段集是 set 语义（V7D-2 用 .sort() 比较），功能上无害，但人在三处文档间核对时顺序错位会增加「这字段是不是漏了」的误判负担，也是漂移在累积的信号。
- **建议**：统一三处 close-chg 模板的字段书写顺序（建议以 instructions/close-chg.md 为锚，hook 模板与 agent.md 跟随），降低维护者跨文件比对的认知摩擦。

#### 4.3　未知 operation（delete-chg 等）不被网关拦截，out-of-scope 纯靠 agent 自觉

- **类别 / 严重度 / 成本**：`architecture` · `medium` · `M`
- **出处**：plugin/hooks/pace-utils/locks.js:50-58（operationFromAgentPrompt 只识别 6 个已知 op，其余返回空）+ agent-lifecycle-guard.js:421-429（operation 为空才 deny「缺少明确 operation」）；实测 `operation: delete-chg` 派遣返回空 deny（ALLOWED）；agent.md:367 把 out-of-scope 完全交给 agent 报告
- **现状与问题**：网关对 update-chg 的非法 action（如 action=xyz）会 hard-deny（实测 585 字 deny），但对整个未知 operation（delete-chg / rename-chg / merge-chg）反而放行——因为 operationFromAgentPrompt 识别不出就返回空字符串，落到「缺 operation」分支前需要 prompt 里连 operation: 字段都没有；写了 `operation: delete-chg` 反而能解析出非空值绕过该分支。结果是「合同声称封闭 8 类、越界报 out-of-scope」这条规则在确定性层面是空门，只靠 LLM agent 读 agent.md:367 自觉执行。与项目自身 deterministic-gate-over-llm-soft 的设计哲学（REVIEWED 空门根因同款）不符。日常可达性中等：正常工作流不会派 delete-chg，但一旦主 session prompt 拼装出错或未来扩展 op，网关不兜底。
- **建议**：在 agentLifecyclePromptDenyReason 入口加一个「operation 已声明但不在 8 类白名单」的 hard-deny 分支（白名单含 create-chg/update-chg/archive-chg/close-chg/record-finding/record-correction/update-finding/update-index），让 out-of-scope 像非法 action 一样确定性拦截；补一条 e2e 测试钉死 delete-chg → deny。

#### 4.4　update-finding 与 update-index 完全不经生命周期网关校验

- **类别 / 严重度 / 成本**：`coupling` · `medium` · `M`
- **出处**：agent-lifecycle-guard.js:408-591（agentLifecyclePromptDenyReason 全程无 update-finding / update-index 分支）；实测 update-index reorder 与 update-finding 缺 status 均返回空 deny（ALLOWED）
- **现状与问题**：8 类指令里 update-finding 和 update-index 是仅有的两个网关零校验的 operation——它们的必填/枚举校验全部下沉到 agent 自觉（instructions/update-finding.md:58-68、update-index.md:44-52）。对照 update-chg/close-chg/record-* 都有 hook 侧字段门，这两个属于「有名无门」。后果：主 session 派一个字段不全的 update-finding，hook 不拦，要等 agent 跑起来再报 format-violation（多一轮 agent 开销 + 没有确定性保证）。从合同一致性看，要么所有 8 类都有 hook 门，要么明确文档化「这两类无 hook 门、靠 agent」的设计取舍。
- **建议**：评估为 update-finding 加最小 hook 门（至少 target 存在性、status 枚举、rejected 必带 rejection-reason），update-index 加 target/action 枚举门；若刻意不加（因 finding 流转风险低），在 agent-lifecycle-guard.js 顶部注释明确记下「这两类故意不设 hook 门」的理由，避免被当成遗漏。

#### 4.5　e2e 测试套件非确定性，通过数在 386-388/389 间波动

- **类别 / 严重度 / 成本**：`test-quality` · `high` · `M`
- **出处**：连续 5 次 `node tests/test-hooks-e2e.js`：分别报 386、388、387、387/389；稳定失败项 9ab「marker 日志包含 agent_id/agent_type」断言 delta.includes('act=PASS_V6_MARKER_AGENT')，另有 1-2 项间歇失败
- **现状与问题**：确定性网关的回归防线本身不确定。同一份代码多次跑测试结果不一致（≥3 种通过数），说明测试间存在共享状态/顺序依赖/时序竞争（很可能是共享临时目录、session flag 文件 warnOnce 去重、或日志文件 append 竞争）。这直接侵蚀「测试绿了就安全」的信任——一个真实回归很容易被淹没在「又是那个 flaky 项」的噪音里，与 widen-matcher-verify-reverse 经验里「绿灯只证目标达成」的告诫同向。9ab 的稳定失败还可能是真 bug（marker 日志没带 agent_id/agent_type）而非纯 flaky。
- **建议**：先隔离 9ab 确认是真 bug 还是环境依赖（pre-tool-use 的 PASS_V6_MARKER_AGENT 日志路径）；再排查间歇失败根因（建议每个 test case 用独立 tmpdir + 跑前清 .pace runtime/日志，消除 warnOnce/append 共享态）；目标是连续 10 次跑 389/389 稳定，否则确定性门的回归网形同虚设。

#### 4.6　agent.md §正向输入模板缺 update-finding 模板，8 类覆盖不齐

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `S`
- **出处**：plugin/agents/artifact-writer.md:204-361（§正向输入模板含 13 个子段，有 update-index 无 update-finding）；agent.md:160-198 输入字段速查只列 6 类（缺 update-finding/update-index 的 ### 条目）
- **现状与问题**：agent.md 自称「8 类指令」（:143、:367、:379），但两处面向 copy-paste 的清单都不齐：§正向输入模板有 update-index 却独缺 update-finding；§输入字段速查只到 record-correction（6 类）。主 session 要派 update-finding 时在 agent.md 里找不到可复制模板，得跳去 instructions/update-finding.md。属于「8 类」声明与实际模板供给不对称的轻度漂移。
- **建议**：在 agent.md §正向输入模板补 update-finding 块（与 instructions/update-finding.md:14-21 对齐），并把 update-finding/update-index 纳入 V7D-2 的 agent.md 模板 pin 范围，使「8 类」名实一致。

#### 4.7　PostToolUse 的 schema 封闭合同校验是 WARN 级而非 DENY 级

- **类别 / 严重度 / 成本**：`architecture` · `low` · `S`
- **出处**：plugin/hooks/post-tool-use.js:155-158（validateFrontmatterSchema 不合法 → warnings.push）vs spec.md:60「hook validateFrontmatterSchema 确定性校验」「缺失任一 key 或出现集合外 key 都报 format-violation」
- **现状与问题**：spec.md:60/396 把 9-key 封闭合同描述为 hook「确定性校验」「报 format-violation」，读起来像 deny 级强约束；但实现是 PostToolUse 写盘后 push 到 warnings（软提示），并非 PreToolUse 阻断、也不回滚已落盘的非法 frontmatter。设计上这是合理的（写盘后即时打回 agent 自修，post-tool-use.js:150-151 注释如此说明），但文档措辞「format-violation」会让读者以为是硬门。这是承诺 vs 实现的措辞缺口，非功能 bug。
- **建议**：在 spec.md §2.1/§9 注明该 schema 合同的强制层级：「PostToolUse 软提示即时打回运行中的 agent 自修（非 PreToolUse deny、非回滚）」，让『确定性校验』的强度与实际一致，避免维护者误判其为不可绕过的硬门。

### 切面 5：Skills / Commands / Helper 脚本

> **整体判断**：这一切面整体成熟度高：4 个 skill 与 agent 合同/hook 行为的字段级一致性极好（close-chg/record-correction/approve 等必填字段在 SKILL、references、agent-references/instructions 三处完全对齐），commands 是薄包装且把唯一写入路径收敛到 helper，设计纪律清晰；主要债务集中在 helper 参数解析不对称（真实可触发的 --cwd 吞 flag 陷阱）、发布面里的孤儿/死代码（implementation_plan 模板、task-list-sync）、以及两个 skill 触发描述高度重叠和升级文档里未定义的 $PLUGIN_DIR。

**值得保留的设计（strengths）**

- skill↔agent 合同字段级一致：close-chg 的 verification-confirmed/complete-open-tasks/review-confirmed/review-source/review-findings/implementation-notes/walkthrough-summary 在 SKILL.md、artifact-management「最小字段模板」与 agent-references/instructions/close-chg.md 三处逐字对齐，record-correction 的 trigger-quote/wrong-behavior/.../knowledge-link|project-scope 同样三处一致——发布面没有出现常见的「文档说一套、合同要另一套」漂移
- commands 是极薄的安全包装：5 个 command 全部把写入收敛到单一 helper（set-activation.js），统一强制 --cwd 绝对路径（对齐 reserve-artifact-id-cwd-flag 记忆），并一致要求「把 helper stdout 原样转述、不臆测状态」；disable/pause 里明确区分「用户退出权」vs「AI 不得为绕过单次 deny 自行 disable/pause」，把人/AI 权限边界写进了产品契约
- 规范单源化做得克制有效：format-reference/change-lifecycle 都用「完整规范以 agent-references/artifact-writer-spec.md §N 为准」指针化，helper 命令来源只在 pace-workflow 定义一次、其余 skill 写「速记 + 指针」，避免了多副本各自漂移
- review-methodology.md 是高质量的通用资产：七条对抗审计内核（证据优先级 code>test>log>doc、误报防御七条、severity 反膨胀）不绑定本仓库，且反复强调「阻断-on-步骤不阻断-on-结论」「流程不裁决质量」，与 paceflow-not-quality-control 定位一致，可独立复用
- helper 报错文案普遍 actionable：unknown-option/missing-value/invalid-count 等都给出原因 + usage + 下一步命令（set-artifact-root 失败时直接吐出 reserve 的下一条命令），fail-closed 设计（reserve 用哨兵区分『未传 --count』与『--count 缺值』）显示出对边界的认真

**观察项（8 条）**

#### 5.1　helper --cwd 参数解析不对称：reserve/set-project-root/sync-plan 裸 ++i 会吞掉后续 flag，静默写错 cwd

- **类别 / 严重度 / 成本**：`dx` · `high` · `S`
- **出处**：plugin/hooks/reserve-artifact-id.js:23-24 `args.cwd = String(argv[++i] || '')`；set-project-root.js:19-20、sync-plan.js:18-19 同款；对照 set-activation.js:33-36 与 set-artifact-root.js:22-24 有 peek-next-token 守卫
- **现状与问题**：set-activation 与 set-artifact-root 对 --cwd 做了『下一 token 是 flag 或缺失即视为缺值』守卫，但 reserve-artifact-id、set-project-root、sync-plan 仍用裸 argv[++i]。实测 `node reserve-artifact-id.js --cwd --operation create-chg`：--operation 被当作 cwd 值吞掉，path.resolve 出 /tmp/--operation 这个幽灵项目根，--operation 丢失后 create-chg 落到 bare-positional 分支，最终吐出『首次启用需要选择 artifact 存放位置』这种与真实意图完全无关的提示（exit 0）。这正是 reserve-artifact-id-cwd-flag 记忆里『cwd 漂移→无效或已过期/误报』的同一类陷阱，且 reserve 是自动化里最高频带 --cwd 的 helper，可达性高。
- **建议**：把 set-activation/set-artifact-root 已有的 peek-next-token 守卫（next===undefined||next.startsWith('-') → 记为 missingValue 并 fail-closed）下沉为 parseArgs 的公共模式，套用到 reserve-artifact-id、set-project-root、sync-plan 的 --cwd（以及 reserve 的 --operation/--type、sync-plan 的 --plan）；补一条 e2e：`--cwd --operation` 必须 DENY 而非静默 resolve 幽灵路径。

#### 5.2　pace-workflow 与 artifact-management 的 skill description 触发边界高度重叠，模型难以区分该加载哪个

- **类别 / 严重度 / 成本**：`dx` · `medium` · `S`
- **出处**：pace-workflow/SKILL.md:4-6 『create, approve, resume, verify, close, or archive CHG/HOTFIX』 vs artifact-management/SKILL.md:4-6 『CHG/HOTFIX lifecycle operations, artifact-writer prompts, approvals, verification, and archive』
- **现状与问题**：两条 description 共享 CHG/HOTFIX + create/approve/verify/close/archive + artifact-writer prompts 几乎全部关键词。实际分工是清晰的（workflow=P-A-C-E-V-R 流程编排与 helper 来源权威；artifact-management=字段/格式/最小字段模板/状态映射的参考手册），但 description 没把这层『流程编排 vs 字段格式参考』的区分点显式抬到触发面，模型在『要做一次 close』时两个都像命中，容易加载冗余 skill 或加载错 skill，浪费上下文预算（与 claude-hook-output-10k 同源的预算意识相关）。
- **建议**：重写两条 description 让触发面正交：pace-workflow 强调『何时进入/推进 PACE 流程、阶段编排、helper 命令来源』；artifact-management 强调『需要 artifact 字段/格式/操作 prompt 模板时的查表参考，不负责何时触发流程』。可用 skill-creator 的 description 优化能力做一次触发准确性对比。

#### 5.3　hooks/templates/implementation_plan.md 是发布面孤儿模板——v7 已退役该文件，createTemplates 永不写它

- **类别 / 严重度 / 成本**：`redundancy` · `low` · `S`
- **出处**：plugin/hooks/templates/implementation_plan.md 仍存在；createTemplates 只遍历 ARTIFACT_FILES（pace-utils.js:730），而 ARTIFACT_FILES=['spec.md','task.md','walkthrough.md','findings.md','corrections.md']（pace-utils/constants.js:8）不含 implementation_plan.md；migrate-v7.js:46-51 把它改写为 tombstone
- **现状与问题**：v7.0 起 task.md 是唯一 CHG 索引、implementation_plan.md 退役为 tombstone。该文件作为 PROTECTED_ARTIFACTS（constants.js:11）和 v6 布局检测对象（path-utils.js:71/304）保留是对的（向后兼容旧项目），但 templates/ 目录里那份『# 实施计划 / ## 变更索引』创建模板已无任何代码路径会消费它——它只会误导维护者以为新项目仍创建该文件。属于发布面死重量。
- **建议**：删除 hooks/templates/implementation_plan.md（保留 PROTECTED/检测逻辑不动）；或若想留作 tombstone 源，把内容替换为 migrate-v7 用的 TOMBSTONE 文本并加注释说明仅供 migrate 引用，避免与『活跃索引模板』混淆。

#### 5.4　README v6→v7 升级章节用了未定义的 $PLUGIN_DIR，复制即失败

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：README.md:75 `node "$PLUGIN_DIR/migrate/migrate-v7.js" --cwd <项目目录> --dry-run`、README.md:86 同款 --restore；全 README 无任何 `PLUGIN_DIR=` 定义（grep 为空）
- **现状与问题**：升级是 v6 用户最敏感、最需要一次跑通的路径，且 WARNING 里强调『先升级 reload 再迁、否则锁死』。但迁移命令依赖 $PLUGIN_DIR 这个从未定义的 shell 变量，用户直接复制会得到 `node "/migrate/migrate-v7.js"` → 文件不存在。与 upgrade-window-hook-data-lockstep 记忆点高度相关：迁移本就在锁死风险窗口里，命令再跑不起来会放大焦虑/误操作。
- **建议**：在升级步骤前给出 $PLUGIN_DIR 的求值方式（如 marketplace 缓存路径示例，或让 SessionStart 注入的 helper 路径推导 migrate 路径：把 reserve helper 路径的 hooks/ 换成 migrate/），或直接给出 `PLUGIN_DIR=$(dirname <SessionStart 注入的任一 helper 绝对路径>)/..` 一行；并提供一个不依赖变量的『从 SessionStart 提示路径推导』fallback。

#### 5.5　migrate-v7.js 的 --hygiene 硬编码了作者私人 vault 的文档名，作为公开发布工具不应携带

- **类别 / 严重度 / 成本**：`maintainability` · `low` · `S`
- **出处**：plugin/migrate/migrate-v7.js:55-59 `HYGIENE_STRAY_DOCS = ['audit-prompt.md','paceflow-complete-flow.md','ticket12.md',...]`，注释明写『本 vault 专属卫生』；:364-385 据此把这些文件 rename 到 _archive/
- **现状与问题**：migrate-v7 本身适合随发布面发布（v6→v7 升级刚需、有 --dry-run/备份/验收回滚/--restore 的完整安全网，SessionStart/PostToolUse 也只在 detectUnmigratedV6Layout 为真时条件提示、迁移后自动消失——这部分设计是对的）。但 --hygiene 分支把 ticket12/14/18/24、paceflow-flow-ascii 等只在作者私人 vault 存在的文件名写死进公开工具，对任何其他用户都是无意义甚至意外移动同名文件的风险面，且暴露了内部资料。
- **建议**：从 migrate-v7.js 移除 HYGIENE_STRAY_DOCS 硬编码与 --hygiene 的『游离 v5 文档移 _archive/』分支（保留 .bak/.v5-backup 清理这类通用卫生即可）；作者私人 vault 的一次性整理移到 internal/ 脚本，不随 plugin/ 发布。

#### 5.6　task-list-sync.js 是不注册的 legacy observer，仍随发布面携带

- **类别 / 严重度 / 成本**：`redundancy` · `low` · `S`
- **出处**：plugin/hooks/task-list-sync.js:1 自述『Legacy compatibility observer』；hooks.json 中无任何 task-list-sync/TodoWrite/TaskCreated 注册（grep 为空）；README.md:310 与 REFERENCE.md:175 标注『当前不注册』
- **现状与问题**：该文件仅当用户有遗留的手写 settings.json hook 指向它时才会被调用，对 marketplace 安装用户完全是死代码。当前作为有意保留并已在 README/REFERENCE 文档化（防止旧手动配置 500），属可辩护的决策，但随着 v6 手动配置用户趋近于零，它是发布面里持续的维护噪声。
- **建议**：暂可保留（已文档化），但建议设一个退役里程碑：v8 或某个明确版本删除 task-list-sync.js，并在 changelog 提示旧手动 settings.json 用户移除对应 hook 行；现在至少在文件头加上『计划在 vX 退役』注释，避免后人误以为是活跃组件去维护它。

#### 5.7　pace-bridge 助记 bash 块缺 set-project-root，与同节散文提及不齐

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `S`
- **出处**：plugin/skills/pace-bridge/SKILL.md:30 散文要求『独立子项目先运行 set-project-root --mode independent』，但紧随其后的 :34-38 bash 助记块只列 set-artifact-root/reserve/sync-plan，无 set-project-root
- **现状与问题**：pace-workflow 的等价助记块（SKILL.md:50-55）是含 set-project-root 的；pace-bridge 与 artifact-management 的助记块都省略了它。bridge 场景恰恰常涉及子目录/worktree 判定，散文说要先跑 set-project-root 但可复制块里没有，AI 复制块时可能漏掉独立项目声明这一步。
- **建议**：在 pace-bridge（及 artifact-management）的助记 bash 块补一行 `node "<skill-root>/../../hooks/set-project-root.js" --mode independent`，与散文和 pace-workflow 块对齐；或在块上方注明『独立子项目另见 pace-workflow 块的 set-project-root』。

#### 5.8　migrate-v7.js 无 --help 且缺 --cwd 即硬退出，与其余 helper 的统一 --help/usage 约定不一致

- **类别 / 严重度 / 成本**：`dx` · `low` · `S`
- **出处**：plugin/migrate/migrate-v7.js:61-75 parseArgs 不识别 --help/-h，缺 --cwd 直接 console.error+process.exit(1)；对照 reserve/set-activation/set-artifact-root/set-project-root/sync-plan 全部支持 --help 并打印 usage()
- **现状与问题**：所有 hooks/ 下 helper 都遵循统一的 --help → usage() 约定，唯独随发布面发布、且面向最不熟练场景（v6 用户首次升级）的 migrate-v7 没有 --help。用户想先看用法只能触发错误输出。属一致性/可发现性小债。
- **建议**：给 migrate-v7.js 加 --help/-h 分支打印与其余 helper 同风格的 usage（含 --dry-run/--hygiene/--restore 说明）；移除 --hygiene 后顺带在 usage 里只保留对外承诺的 --cwd/--dry-run/--restore。

### 切面 6：文档 / 上手体验 / 文档-代码漂移

> **整体判断**：文档技术准确度高、自审纪律强（hook 事件数、命令数、skill 数、版本号、marketplace source 全部与代码一致），但存在三类系统性问题：①面向新用户的「0 到跑通」叙事缺失——README 直接堆砌内部概念，没有 Quick Start，激活模型（自动检测 vs /paceflow:enable）对外部读者割裂；②跨文档占位符约定不统一且 README 的 $PLUGIN_DIR 未定义，使 v7 迁移这一最脆弱操作的命令无法直接复制运行；③少量陈旧资产/陈旧指标残留（退役的 implementation_plan.md 模板仍在发布面、57% 性能指标实为 v5 来源）。

**值得保留的设计（strengths）**

- hook 事件数（9 类）、skill 数（4）、命令数（5）、schema-version（7.0）、plugin/marketplace 版本（7.1.0）、marketplace source（./plugin）等所有可机械核对的声明都与代码完全一致——对一个高频迭代项目这是罕见的文档纪律
- Obsidian 并非硬依赖且文档表达正确：PACE_VAULT_PATH 明确标注「可选」(README:109)，local 模式是默认路径，vault 仅 opt-in，多处反复澄清 local=Project Root 本地目录而非 .pace/——采用门槛被正确降低
- REFERENCE.md 的状态机表（§4）、PreToolUse 三档拒绝表（§5.1）、teammate 降级矩阵是高质量的「权威单源」式参考，把确定性 hook 行为表格化，远胜散文描述
- v6→v7 升级章节（README:67-93）把『先升级+reload 全部 session 再迁数据』的顺序铁律、兼容不对称警告、锁死三路径恢复讲得非常到位，体现了对真实运维陷阱的深刻理解
- 版本历史表（README:414-489）虽长，但为每个 patch 记录了根因+修法+测试计数，是优秀的可追溯审计轨迹

**观察项（7 条）**

#### 6.1　README 缺『0 到跑通』Quick Start，新用户上手路径陡峭

- **类别 / 严重度 / 成本**：`doc-drift` · `high` · `M`
- **出处**：/mnt/k/AI/paceflow-hooks/paceflow/README.md:97-129（安装节）与全文无『快速开始/Getting Started』锚点（grep 快速开始|Quick Start|入门 全部命中 0）
- **现状与问题**：README 安装后直接进入『多信号激活』『Project Root 与子目录继承』『PreToolUse 档位』等内部架构概念，没有一条贯穿『装好→第一次写代码会发生什么→怎么批准→怎么收口』的最短闭环叙事。新用户装完后第一次被 PreToolUse deny 时，README 没有告诉他『这是预期行为、下一步该做什么』。激活模型对外部读者尤其割裂：install 节强调『零配置、自动检测』(L107)，但 /paceflow:enable 命令直到 L267 才出现，二者关系（什么时候自动、什么时候需手动 enable）从未在一处讲清。这是采用率的首要摩擦点——技术正确不等于可上手。
- **建议**：在『安装』之后『特色功能』之前插入一节『5 分钟跑通第一个 CHG』：装好→打开一个有 3+ 代码文件的项目→尝试改代码触发 deny→AI 自动建 CHG→你说『开始吧』批准→改代码→验证→收口。配一张『自动激活 vs /paceflow:enable』的二选一决策说明（强信号自动、想显式开关用命令）。把内部架构章节下沉到 details 折叠或 REFERENCE。

#### 6.2　README 用未定义的 $PLUGIN_DIR，迁移命令无法直接复制运行

- **类别 / 严重度 / 成本**：`dx` · `high` · `S`
- **出处**：/mnt/k/AI/paceflow-hooks/paceflow/README.md:75、86、124 用 `node "$PLUGIN_DIR/..."`；README 全文从未定义 $PLUGIN_DIR（grep PLUGIN_DIR= 命中 0）；实际运行时变量是 ${CLAUDE_PLUGIN_ROOT}（见 plugin/commands/*.md 与 hooks.json）
- **现状与问题**：$PLUGIN_DIR 是 README 自创的占位符，既不是 Claude Code 提供的环境变量（那是 CLAUDE_PLUGIN_ROOT），README 也没给出任何解析方法。用户复制 `node "$PLUGIN_DIR/migrate/migrate-v7.js"` 时 shell 会把空变量展开成 `node "/migrate/migrate-v7.js"`，静默指向文件系统根并报错。最糟的是它命中的恰恰是 v7 最脆弱、最高风险的数据迁移操作（L75 dry-run、L86 锁死还原）——一旦用户在『被旧 hook 锁死』的紧张场景下跑错路径，体验极差。同一概念在三处文档用了三种写法：README=$PLUGIN_DIR、REFERENCE=<plugin>/<hooks>、运行时=${CLAUDE_PLUGIN_ROOT}，且互不交叉引用。
- **建议**：在 README 安装节加一句『如何定位插件目录』：插件安装在 ~/.claude/plugins/cache/paceaitian-paceflow/paceflow/<version>/（L407 已有此路径但藏在日志节），并统一占位符。要么全用 ${CLAUDE_PLUGIN_ROOT}（在 Claude Code 会话内运行时可用），要么给出在普通 shell 里 PLUGIN_DIR=$(ls -d ~/.claude/plugins/cache/.../paceflow/*/ | tail -1) 这类可解析的赋值。REFERENCE 的 <plugin>/<hooks> 也应在文首统一声明等价。

#### 6.3　退役的 implementation_plan.md 模板仍在发布面，是死资产+文档计数误导

- **类别 / 严重度 / 成本**：`redundancy` · `medium` · `S`
- **出处**：死模板：/mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks/templates/implementation_plan.md 仍存在；但 createTemplates() 只遍历 ARTIFACT_FILES（pace-utils/constants.js:8，已不含 implementation_plan.md，注释 L7 明确『退役出 artifact 集合』），故该模板在 v7 永不被复制。README:318 仍写『6 个 artifact 模板』
- **现状与问题**：v7 已把 implementation_plan.md 退役为 tombstone（constants.js:7 注释、change-analysis.js:368、layers.js:779 均确认 task.md 是唯一 CHG 索引）。但模板文件未删，且其内容（『# 实施计划 / ## 变更索引』）正是 v7 要迁出的旧布局。它现在是纯死代码：createTemplates 不会写它，新项目永远不会得到它。README:318 的『6 个 artifact 模板』把这个死模板算进去了（实际活模板只有 spec/task/walkthrough/findings/corrections = 5 个 + knowledge-note 参考模板）。REFERENCE 发布检查（L263）只点名 corrections.md 在不在，没有『不该有 implementation_plan.md』的反向断言，导致这个残留长期无人清理。
- **建议**：删除 plugin/hooks/templates/implementation_plan.md（它对未迁移项目的检测靠 path-utils/change-analysis 的正则，不依赖模板存在）。同步把 README:318 改为『5 个 artifact 模板 + 1 个 knowledge 参考模板』。在 REFERENCE §8 发布检查加一条反向断言『templates/ 不含 implementation_plan.md』防回归。

#### 6.4　README 主打性能指标『token 消耗降低 57%』来源是 v5，作为 v7 卖点是陈旧指标

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：/mnt/k/AI/paceflow-hooks/paceflow/README.md:157 『token 消耗降低 57%』；该数字唯一来源是 CHANGELOG.md:287/439『SessionStart 注入量精简 -57% (CHG-20260309-04)』，属 v5.1.0 时代；而 v6 已重写注入模型（README:60『只注入活跃索引和活跃 CHG 摘要』）
- **现状与问题**：57% 是 v5 一次性优化的旧基准，挂在 v7 README 的『智能上下文管理』特色节作为当前产品价值呈现。v6/v7 把整个 artifact 布局和注入策略都重构了（单索引、frontmatter 封闭合同、change-set 聚合注入），这个 v5 数字既无法对应当前实现，也无人重新测量。对读者是误导性的精确——一个看起来权威的量化卖点，实则失去了出处对应关系。同节其它表述（已完成省略、walkthrough 只留最近、findings 只注入未解决）描述的是行为而非指标，是站得住的。
- **建议**：两个选择：①若有 v7 实测数据，用新数字替换并标注测量口径；②若无，删掉具体百分比，改为定性表述『按相关性截断、显著降低注入量与 Compact 频率』，避免把无法复现的 v5 数字当 v7 卖点。

#### 6.5　REFERENCE §6 安装节缺 Claude Code 版本下限要求，与 README 不对称

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `S`
- **出处**：/mnt/k/AI/paceflow-hooks/paceflow/README.md:99 明确要求 Claude Code ≥2.1.139（args exec form）；/mnt/k/AI/paceflow-hooks/paceflow/REFERENCE.md:215-231 §6 安装节只给两条 /plugin 命令，无任何版本下限提示
- **现状与问题**：hooks.json 全部用 args 数组形式（exec form），这是 2.1.139 才支持的字段；低版本会只执行 command:"node" 而不传脚本路径，导致 hook 静默失效（不报错、不拦截）——这是最隐蔽的失败模式：用户以为装好了，实则所有流程门都没生效。README 正确警示了，但 REFERENCE（被定位为权威参考手册）的安装节完全没提。读者若只看 REFERENCE 照抄安装就可能踩这个静默坑。
- **建议**：在 REFERENCE §6 安装节顶部加一行版本下限要求，与 README:99 对齐；并可加一句自检『装后运行任意写操作应看到 PACE 注入/deny，否则检查 Claude Code 版本』。

#### 6.6　task-list-sync.js 在文档中被反复提及，对用户构成认知负担

- **类别 / 严重度 / 成本**：`maintainability` · `low` · `S`
- **出处**：hooks.json 不注册 task-list-sync（grep 命中 0）；但 README:310/366、REFERENCE:175 仍把它列入 hook/文件结构表并标注『legacy observer；当前不注册』；运行态文件表 README:366 也保留 `task-list-used` 标志
- **现状与问题**：task-list-sync.js 是已退役的 legacy observer，当前不挂任何 hook 事件。它在面向用户的 README/REFERENCE 中出现在多张表里，每次都要附带『当前不注册』的免责说明。对维护者是诚实的，但对新用户是纯噪声——一个不工作的东西占据了文档篇幅，还要读者理解它为何存在。这与项目整体『发布面只留运行时资产』的原则（CLAUDE.md 维护规则）略有张力。
- **建议**：评估把 task-list-sync.js 及其文档行从面向用户的 README/REFERENCE 移除，仅在 internal 或代码注释保留 legacy 说明。若出于历史兼容仍需保留文件，至少在用户文档的项目结构图里降级为一行脚注，不要在 hook 覆盖表里占一整行让读者误以为它是活跃 hook。

#### 6.7　模板内容语义干净，无过时 v5 口径残留（正向确认）

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `S`
- **出处**：逐一读取 /mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks/templates/{task,findings,corrections,walkthrough,spec,knowledge-note}.md
- **现状与问题**：除上面单列的死模板 implementation_plan.md 外，其余活模板内容均符合 v7 当前合同：task.md/findings.md/corrections.md 都正确表述『本文件只保留索引，详情在 changes/**』，corrections.md 正确指向 changes/corrections/<id>.md 与 knowledge 双写，walkthrough.md 用表格形式且带 ARCHIVE 双区，spec.md 正确标注『不参与归档、不要加 ARCHIVE』。没有发现『task 承载 C/V 标记』『findings 内嵌 correction 区』等 REFERENCE §8 列为禁止的旧口径。这是一个值得记录的正向结论——模板这一层的 v6→v7 迁移做得彻底。
- **建议**：无需改动，保持现状。仅建议删除死模板 implementation_plan.md 后，此层即完全干净。可在发布检查中加一条『活模板内容不出现 implementation_plan/内嵌详情』的轻量断言固化这个状态。

### 切面 7：测试面健康度（test suite health）

> **整体判断**：测试质量整体很高（真断言、子进程隔离、纯函数单测、计数与 README 同步），但存在一个结构性 flaky 根因（多个测试断言共享、可被截断/锁丢弃的源码树日志文件），以及若干 DX/可维护性债（无统一 runner、8K 行单文件、agent CLI 套件已休眠一周、CLAUDE.md 验证清单漏列两个 release-gated 套件）。

**值得保留的设计（strengths）**

- 断言全部为真断言：e2e 中 1428 处 assert.* 调用（934 assert.ok / 446 strictEqual / 等），零 bare assert、零无条件 ✅ 打印、零 throw-swallow——不存在「假绿/overclaim」反模式（tests/test-hooks-e2e.js:1-19 + grep 全量统计）
- 测试隔离模型正确：e2e 经 spawnSync 子进程跑真实 hook（tests/test-hooks-e2e.js:55），契合 hook 为同步进程的事实；状态走 os.tmpdir() 隔离临时目录（91 处 makeTmpDir）；PACE_VAULT_PATH 被重定向到 tmp（:22-30），生产代码确实读该变量（plugin/hooks/pace-utils/constants.js:19），真实 Obsidian vault 零污染风险
- 纯函数单测分层优秀：test-session-layers.js 把 buildLayers 当纯函数喂 in-memory fixture 断言、零 I/O（tests/test-session-layers.js:1-40），是对 SessionStart 三段式解耦的正确单测策略
- 脚手架已做工厂抽象：test-utils.js 的 createTestRunner 消除三文件重复（I-23），e2e 内有 makeV6Project/makeV6ProjectWithChanges/chgDetail/seedArtifactWriterLock 等 ~20 个工厂 helper（tests/test-hooks-e2e.js:159-470），不是纯手写复制
- 文档-代码计数同步：README v7.1.0 行声明的 272/389/12/42/9 与实跑数字逐一吻合，且存在 V7D 三组「漏改即红灯」一致性锁测试与显式 mutation 红绿判别注释（tests/test-hooks-e2e.js:3592 VT-01）——自审深度真实存在
- 存在显式对抗/反向验证文化：测试注释记录「去掉唯一拦截点 A04 时此 Edit 应放行→测试 FAIL 才证明判别力」（tests/test-hooks-e2e.js:3592），W2 测试专门锁死 logDelta 截断回归（:373）

**观察项（6 条）**

#### 7.1　测试断言耦合共享、可截断、可锁丢弃的源码树日志文件 → 结构性 flaky 根因

- **类别 / 严重度 / 成本**：`test-quality` · `high` · `M`
- **出处**：plugin/hooks/post-tool-use.js:12 (LOG=path.join(__dirname,'pace-hooks.log') 硬编码进源码树，不可注入); plugin/hooks/pace-utils/logger.js:27-28 (锁竞争时静默 return 丢弃写入); :30-36 (size>1MB 时砍掉前半文件); tests/test-hooks-e2e.js:1419/1798/6826/6925 (4 个测试 readFileSync 共享 log 并断言其内容)
- **现状与问题**：本次审计并发跑套件时实测复现 388/389：失败的是 `9ab. marker 日志包含 agent_id/agent_type`（tests/test-hooks-e2e.js:1415）。该测试断言 deny+pass 两条日志行同时出现，但日志路径硬编码在源码树（所有 hook 子进程都写同一个 plugin/hooks/pace-hooks.log），且 logger 在两种情况下会让断言落空：(1) 锁竞争时 logger 直接 return 丢弃整条写入（:27 注释自承「logs are diagnostic only」）；(2) 文件超 1MB 时砍掉前半，刚写的 deny 行可能随之消失。日志当前已 622KB-781KB 且每次跑 +~2KB，逼近 1MB 临界。W2 测试与 `projectLogLines || logDelta` 回退（:1452）都是对这个根因打的补丁，没消除根因——把测试正确性绑定到一个 best-effort、可丢弃、自截断、跨进程共享的 mutable 文件上。
- **建议**：让日志路径可注入：hook 读 PACE_LOG_PATH（缺省回退现路径），e2e 的 runHook 给每个测试或每次套件运行注入独立 tmp 日志路径，彻底解除「断言 vs 截断/锁竞争」耦合。短期兜底：跑 e2e 前 truncate plugin/hooks/pace-hooks.log，避免逼近 1MB 临界触发砍半。

#### 7.2　无统一 test runner / 无 package.json，验证靠手敲 5 条命令

- **类别 / 严重度 / 成本**：`dx` · `medium` · `S`
- **出处**：项目根及各层均无 package.json（find -maxdepth 2 -name package.json 为空）；CLAUDE.md:22-27 把验证写成 5 条独立 node 命令 + claude plugin validate
- **现状与问题**：没有 `npm test` / 单一入口脚本，CI 与人工都要逐条手敲 5 个文件且自己聚合 pass/fail。e2e 单跑就 100 秒 wall-clock（实测 1:40），5 个套件串行无并行编排。一旦漏跑某个文件（见下条 doc-drift），回归就漏网。这是高频维护动作的持续摩擦。
- **建议**：加一个最小 run-all 脚本（或 package.json 的 test script）串起全部 5 个套件并聚合退出码；e2e 内部可按 section 分片支持过滤跑（如环境变量 PACE_TEST_FILTER）缩短迭代回路。无需引第三方框架，保持零依赖风格即可。

#### 7.3　CLAUDE.md 验证清单漏列两个 release-gated 测试套件

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：CLAUDE.md:22-27「常用验证」只列 test-pace-utils/test-hooks-e2e/test-agent-tests-helpers，缺 test-session-layers.js 与 test-migrate-v7.js；但 README.md:416 v7.1.0 行把这两者的 42、12 计入发版门，.gitignore 也把二者列入白名单（被跟踪发布）
- **现状与问题**：两个被 git 跟踪、README 当作发版闸口计数的测试文件，没有出现在维护入口 CLAUDE.md 的「常用验证」里。按 CLAUDE.md 照做的人会漏跑 session-layers（SessionStart 注入层核心逻辑）与 migrate-v7（v6→v7 迁移，真实 vault 121 文件迁移验收）这两个高价值套件——恰恰是上下文恢复与升级安全这两个最易回归的面。
- **建议**：把 node tests/test-session-layers.js 与 node tests/test-migrate-v7.js 补进 CLAUDE.md:22-27 验证清单；REFERENCE.md 同步。若实现了上条的 run-all 脚本，此清单收敛为一行。

#### 7.4　agent-writer CLI 测试套件已休眠：结果停在 06-06，代码改到 06-13

- **类别 / 严重度 / 成本**：`test-quality` · `medium` · `M`
- **出处**：tests/agent-tests/results/ 最新结果目录为 2026-06-06（之后 v7.0.0/v7.1.0 大改 artifact schema）；tests/agent-tests/run-tests.js:5-8 自述「半自动模式，Agent tool 仅主 session 可用」；CLAUDE.md 验证清单不含 agent CLI 套件
- **现状与问题**：artifact-writer 是 v7 封闭合同（CHG 9-key/finding 3-key/correction 2-key）的唯一写入方，schema 在 v7.0.0/v7.1.0 刚做过破坏性重写。但验证这层契约的 YAML 用例套件（cases/phase-a..d，含 happy path + 拒绝路径 + 边界）因「必须主 session 派 Agent」无法进自动回归循环，结果已停更一周、跨越两个 schema 大版本。被自动化的只剩 test-agent-tests-helpers.js（9 个，只测框架本身的 YAML parse/verify，不测真 agent 行为）。这是覆盖盲区：合同最易漂移的时刻恰好没人在跑契约测试。
- **建议**：把 agent 行为契约下沉为确定性校验：artifact-writer 写盘后的 frontmatter 经 validateFrontmatterSchema 把关——可对 phase-a/b 的 expected 产物做「给定 prompt→期望 frontmatter」的纯 JS 断言（不派真 agent，直接喂 schema 校验器），让 9-key 合同回归进自动循环。半自动 CLI 套件保留做 prompt-quality smoke，但发版门不应只靠它。

#### 7.5　e2e 8K 行单文件、403 测试扁平排列、分节注释稀疏

- **类别 / 严重度 / 成本**：`maintainability` · `low` · `M`
- **出处**：tests/test-hooks-e2e.js 共 7969 行 403 个 test()，全文仅 ~18 处分节注释且集中在 7080 行之后（grep '^// ===' 统计）；最大单测体 67 行（:9hc0c）
- **现状与问题**：单文件承载 10 个 hook 的全部 e2e（pre-tool-use 一项就 204 处 runHook），缺乏 describe 式分组与文件级 TOC，靠 9ab/9hc-helper4d 这类编号定位。403 个测试无分组导致：定位某 hook 的覆盖面要全文 grep；新增测试易插错位置；review diff 噪声大。这不是假绿问题（断言都真），是纯导航/维护成本。
- **建议**：按 hook 拆分文件（test-pre-tool-use.js / test-stop.js / test-session-start.js…）共享 test-utils + 一组公共 fixture helper（现有 makeV6Project 等已可复用），或至少在文件内用一致的分节 banner + 顶部 TOC 注释建立可跳转结构。配合上条 run-all 脚本，拆分零额外运行成本。

#### 7.6　日志断言测试用 before/after delta 兜底，但截断窗口内仍可误判

- **类别 / 严重度 / 成本**：`test-quality` · `low` · `S`
- **出处**：tests/test-hooks-e2e.js:358 logDelta 实现；:1452 projectLogLines||logDelta 回退；plugin/hooks/pace-utils/logger.js:30-36 砍半发生在断言所需行之间时 delta 会缺行
- **现状与问题**：logDelta 的 before/after 差量法只解决了「after 整体短于 before（截断）返回空串」这一种 corruption（W2 已锁），但当截断恰好砍掉 before 之后、本测试两次 runHook 之间写入的某一行（如 9ab 的 deny 行落在被砍的前半），projectLogLines 过滤也救不回——这正是本次复现的失败形态。属于上面 high 条根因的同一族症状，单独列出是因为它揭示「补丁叠补丁」而非根治的债务模式。
- **建议**：随 high 条一并解决（日志路径可注入 + 每测试独立 tmp 日志）后，这些 delta/projectLogLines 兜底逻辑可整体删除，测试直接读自己的干净日志全量断言，判别力更强且更易读。

### 切面 8：产品定位与战略方向

> **整体判断**：护城河（确定性 hook 网关 vs CLAUDE.md 软指令）真实且工程上做得扎实，但产品在"对外可读性"和"采用曲线"上严重欠投入——它是一个为单一重度作者打磨到极致的工具，却几乎没有为第二个用户铺路：无竞品对标、无 quickstart、无渐进式采用层级，六阶段全有全无的重量对单人/小团队 ROI 偏负。下一步最高杠杆不是继续深化护城河（已经够深），而是降低门槛 + 让差异化对买家可见。

**值得保留的设计（strengths）**

- 核心差异化命题清晰且正确：README:7-16 把'AI 编程真正的问题是过程控制而非代码质量'+'hook 物理拦截 vs system prompt 建议'讲透了，这是相对 CLAUDE.md/plan mode 的真护城河，且 deny/exit-2 机制是已实现的确定性而非 PPT
- 护城河的工程论证自洽：MEMORY.md 与 README:11 反复强调'确定性网关 > LLM-soft 指令'、'hook 只做机械兜底不判断业务真伪'——边界划得清楚，没有把 PACEflow 错位成质量控制器或攻击对抗器，定位纪律工具是诚实且可防御的
- Obsidian 耦合在架构层已经是可选的：README:109 PACE_VAULT_PATH 明确标注'可选'，artifact-root 默认 local，vault 只是 backend 之一，feature-reference 2.3 的 getArtifactDir 优先级链证明 vault 不是硬依赖——这一点比表面看起来健康
- Superpowers / 原生 /plan 桥接（README:133-149）是正确的生态站位：不与上游规划工具竞争而是做它们的'落盘强制层'，pace-bridge 把已确认 plan 转成可强制的 CHG，这是聪明的差异化补位而非重复造轮子
- 极致的自审文化与可验证基线：feature-reference 把全部行为映射到五连测试绿灯作为'行为的机器表示'，这种'规格即测试'的纪律本身就是产品可信度资产

**观察项（7 条）**

#### 8.1　差异化命题未对外锚定到竞品坐标系，买家无法快速判断'我为什么选它'

- **类别 / 严重度 / 成本**：`product-direction` · `high` · `S`
- **出处**：/mnt/k/AI/paceflow-hooks/paceflow/README.md:5-16（核心理念只对比抽象的'system prompt 建议'）；grep 显示 README/REFERENCE/feature-reference 全文 0 处提及 Spec Kit / OpenSpec / plan mode / 原生 CLAUDE.md 作为对照
- **现状与问题**：护城河'确定性网关 vs 软指令'是真的，但它只相对一个无名的稻草人('AI 可以无视建议')成立。一个评估者面对 Spec Kit（spec-driven）、OpenSpec（change proposal）、Superpowers（skill 编排）、Claude Code 原生 plan mode 时，无法从 README 看出 PACEflow 的独占价值是什么。差异化点其实非常锐利——别人都是'生成规格/计划'（仍靠模型自觉执行），只有 PACEflow 在工具调用层做物理 deny——但这个唯一卖点被埋在术语里，没有被提炼成一句对买家的话。结果是技术上最强的护城河在营销面几乎不可见。
- **建议**：在 README 顶部加一张'与同类工具的关系'对照表（一行卖点）：Spec Kit/OpenSpec=生成规格但不强制执行；plan mode=单会话内规划、退出即失效；CLAUDE.md=软指令模型可绕过；PACEflow=唯一在 hook 层 deny 未规划/未批准/未验证的写操作。把'唯一强制层'这句话提到 H1 下第一段。这是 S 级改动、最高战略杠杆。

#### 8.2　系统'全有全无'缺渐进式采用层级，六阶段+强制 R 审计对单人/小项目 ROI 为负

- **类别 / 严重度 / 成本**：`product-direction` · `high` · `M`
- **出处**：README:18-33（PACE 六阶段全部强制）；README:16 与 stop.js 完成度门要求 completed→verified→reviewed→archived 全链路否则 block；grep 'lite|minimal|渐进|可选阶段|skip review' 在 README 与 pace-workflow/SKILL.md 命中 0；唯一'出口'是 disable/pause（README:268-273）即完全关闭，无中间档
- **现状与问题**：采用曲线是断崖式的：要么承受完整 P-A-C-E-V-R（建 CHG→批准 marker→执行→验证→强制对抗审计→归档+walkthrough），要么 disable 全关。对一个改 3 个文件的单人项目，强制 R 阶段对抗审计 + 归档 walkthrough 的纪律成本可能超过收益。MEMORY 自己也记录'PACEflow 不做质量控制'、R gate 只记录审计这步发生过——既然 R 不裁决质量，把它设为关闭会话的硬门槛对轻量场景就是纯摩擦。当前唯一逃逸阀是 pause/disable，但那是退出而非'轻量运行'。没有'只要 Plan+Approve+Execute 三阶段'这样的入门档，新用户第一次撞上 Stop 门被 block 3 次才降级，体验是惩罚性的。
- **建议**：设计一个 profile 维度（如 .pace/profile = lite|full）：lite 档只强制 P-A-C（无活跃 CHG/未批准才 deny），把 V/R/archive 降级为 SessionStart 软提醒而非 Stop 硬 block。让用户从 lite 起步、按价值自然升级到 full。这把'断崖'变成'坡道'，是扩大采用面最直接的杠杆。

#### 8.3　零 onboarding 路径：无 quickstart/无 hello-world/无第一个 CHG 的端到端示例

- **类别 / 严重度 / 成本**：`dx` · `high` · `M`
- **出处**：grep '快速开始|getting started|quickstart|第一个 CHG|tutorial|示例项目' 在 README 命中 0；README 安装(97)后直接跳到 Project Root 概念(111)、特色功能(131)、9 类 hook(223)；新用户首次接触是被 PreToolUse deny 拦住一个空模板
- **现状与问题**：README 有 32 个 H2/H3 段、500 行，结构是'参考手册'而非'上手指南'。一个新用户装完插件后，第一次写代码会被 deny，然后要在 261 行的 README + 4 个 skill（~1200 行）+ artifact-writer-spec（438 行）里自己拼出'怎么走完一个完整变更'。没有一个'从零到第一个归档 CHG'的 5 分钟教程，没有 cast/截图，没有最小可跑示例项目。这对一个'强制改变工作流'的工具是致命的采用障碍——它的学习曲线本来就陡，却没有任何缓冲。
- **建议**：写一个 docs/quickstart.md（或 README 顶部 60 秒章节）：装好→在示例 repo 里说一句'帮我加个 X'→展示被 deny→建 CHG→批准→写码→验证→close 的完整 transcript。配一个 examples/hello-paceflow 最小项目。让用户在读任何概念前先看到一次成功闭环。

#### 8.4　品牌叙事仍过度绑定 Obsidian，掩盖了'本地即默认'的事实，制造伪采用障碍

- **类别 / 严重度 / 成本**：`product-direction` · `medium` · `S`
- **出处**：README:159-169'Obsidian 知识中枢'作为四大特色功能之一独立成节；README:61 v6 改进表把 'Obsidian' 列为维度；而 README:109 才澄清 vault 是'可选'、local 是默认；feature-reference 2.3 确认 getArtifactDir 默认 local
- **现状与问题**：架构上 vault 是干净的可选 backend（这点做得好，见 strengths），但叙事重心让潜在用户误以为 PACEflow 是'给 Obsidian 用户的工具'。一个不用 Obsidian 的开发者读到'Obsidian 知识中枢'作为头部特色、版本表反复出现 vault/obsidian，很可能直接划走。这是营销定位与技术现实的漂移：技术上 vault 已经是 optional backend，但产品讲故事时把它当成主线，反而吓退了最大的潜在受众（不用 Obsidian 的纯代码用户）。
- **建议**：重排特色功能优先级：把'本地零配置开箱即用'作为默认叙事主线，Obsidian/knowledge 降级为'高级：跨项目知识中枢（需 Obsidian）'的可选增强章节。一句话定调：'默认写本地项目目录，零配置；可选接入 Obsidian 做跨项目知识沉淀。'

#### 8.5　目标用户画像隐性等于作者本人，缺少外部反馈回路与采用信号

- **类别 / 严重度 / 成本**：`product-direction` · `medium` · `L`
- **出处**：docs/ 下 60+ 版本条目（README:414-488）几乎全部由 dogfood/self-audit 驱动；internal/skills/audit 自审流程；feature-reference:5'三个 Explore agent 并行盘点+主 session 抽查'；无 CONTRIBUTING、无 issue 模板、无用户故事/persona 文档；REFERENCE/README 无'谁该用/谁不该用'章节
- **现状与问题**：产品的进化引擎是'作者用作者审'——极高的工程质量来自此，但也意味着所有设计决策都围绕一个深度用户的偏好（重纪律、重审计、Obsidian、多 worktree）。从 v6.0.0 到 v7.1.0 的 60+ 次发布几乎都是审计修复/自我加固，而非'某个外部用户卡住了所以简化'。没有目标 persona 定义（这是给谁的？纪律焦虑的资深独立开发者？需要合规追溯的团队？），就无法判断'重'到什么程度是对的。当唯一用户是作者时，过重不是 bug 是 feature；但若想扩大采用，缺少外部信号会让团队持续优化错误的维度（继续加固护城河而非降门槛）。
- **建议**：明确写下 1-2 个目标 persona 与反 persona（README 加'适合谁/不适合谁'），并建立最轻量的外部反馈通道（GitHub Discussions + 一个'我卡在哪'的 issue 模板）。在拿到外部信号前，把路线图从'继续加固'显式切换到'降门槛'假设并验证。

#### 8.6　版本演进史暴露'churn 即护城河'风险——60+ 版多为自审修复，可能在过度拟合作者工作流

- **类别 / 严重度 / 成本**：`product-direction` · `medium` · `M`
- **出处**：README:414-488 版本表：v6.0.0→v7.1.0 约 60 个条目，绝大多数为 audit-fix / smoke-fix / 对称补齐（如 v6.2.1 'REVIEWED 空门修复'、v6.0.41 '直接编辑绕过'、v6.1.4 'over-block 回归 HOTFIX'）；v7 又一次 breaking 重构（单索引+9key 封闭合同）
- **现状与问题**：高频自审修复是双刃剑：一面是质量（真发现并修了 over-block、空门、伪造 marker 等真问题）；另一面是这些修复绝大多数是在加固一个已经很复杂的系统的边角，复杂度在单调上升（11K 行 hooks、9 态 owner disposition、三层 schema 校验、index-transaction 退役又保签名）。每个 breaking 版本（v6→v7）都给现有用户施加迁移税（README:67-89 那段升级铁律+锁死恢复本身就是复杂度的症状：旧 hook 对新数据会 brick）。战略风险是：系统在向'只有作者能维护、只有作者能用'收敛，护城河变成了对自己的城墙。
- **建议**：设一条复杂度预算红线：每次发版要求净行数/净分支不增（修一个加固点就退役一个），并把'外部用户 0 配置首次成功率'作为和'测试全绿'并列的发布门槛。把工程精力的一部分从'加固已有门'转向'减少用户需要理解的概念数'（当前 Project Root/Artifact Root/CWD/owner/9态/profile 的认知负荷过高）。

#### 8.7　最该投入的下一个方向建议：降门槛 > 深化护城河（护城河已足够深）

- **类别 / 严重度 / 成本**：`product-direction` · `high` · `L`
- **出处**：综合证据：护城河已实现且经测试（README:9-16、stop.js/pre-tool-use guard 链）；vs 采用面三大空洞——无对标(本切面 obs#1)、无 quickstart(obs#3)、无渐进层(obs#2)；plugin.json keywords 仅 workflow/pace/hooks，homepage 指向个人 repo 无 landing
- **现状与问题**：四个候选方向（深化护城河 / 降低门槛 / 扩展集成 / 简化）里，深化护城河边际收益已经很低——确定性 deny 已经做到位，再加固也只是堵更罕见的绕过。扩展集成（更多 backend/IDE）在没有第二个用户验证核心价值前是 premature。真正的瓶颈是'转化'：技术上最强的 AI 工作流强制器，因为重、因为没对标、因为没上手路径，触达不到会从中受益的用户。降门槛（渐进层 + quickstart + 对标 + 去 Obsidian 主线）是把已建好的护城河变现的唯一路径。简化是降门槛的子集，应同步做。
- **建议**：把下一个里程碑定义为'采用面里程碑'而非'功能里程碑'：交付物=lite profile + 5分钟 quickstart + 竞品对照表 + persona 文档 + 本地默认叙事重排。成功指标=一个从未见过 PACEflow 的开发者能在 10 分钟内独立走完一个 CHG 闭环。这比任何新 hook 都更能决定产品命运。

### 切面 9：已知未解决问题去重清单（findings open + corrections 主题）

> **整体判断**：已知 backlog 的主导主题是「代码/规范假设 vs 真实产物脱节」——大量审计 finding 与所有 correction 都指向同一根因：把死代码/注入摘要/产物当成事实来源、规格与实现/文档漂移、模板抄多份导致一致性债，外加 v6 详情下沉后 task.md/implementation_plan.md 双索引职责重叠的结构性重构窗口尚未关闭。

**值得保留的设计（strengths）**

- finding/correction 双索引 + 详情文件分层，open/archive 边界用 <!-- ARCHIVE --> 明确区分，状态用 [ ]/[x]/[-] 三态语义化，便于机器与人共同消费
- correction 全部挂 knowledge-link 或 project-scope，反复踩的坑（产物当事实、负向 framing、cache 源混淆）已沉淀为可复用方法论而非一次性口头承认
- severity 判据有明确可达性标准（日常可达必修、故意攻击才可达降级），避免审计严重度膨胀
- 审计自带对抗验证文化（mutation 测试证伪 overclaim、并发 20 跑复现偶发失败、before/after 实证 regression），finding 普遍带可达性论证与处置去向（won't-fix/deferred/转 CHG）
- renderAgedFindings 14 天周期提醒兜底 open finding 不被遗忘，形成自审闭环

**观察项（21 条）**

#### 9.1　Stop 后台任务软放行疑似被上游 harness 接口漂移击穿

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `M`
- **出处**：findings.md:10
- **现状与问题**：已知问题：2026-06-12 实测后台 Bash + Monitor 活跃时 Stop 仍硬 BLOCK，harness 传入 background_tasks 为空（不再含 shell），对照 2026-05-31 基线 shell 形态曾在数组内；stop.js 豁免逻辑 6.7.1/7.0.0 逐字相同，疑上游接口漂移，Monitor 形态从未实测。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用——勿当新发现。

#### 9.2　规格与验收记录回写组 G-spec（spec 删除清单漏项 + 验收记录与产物不符 + 报错文案漏参数）

- **类别 / 严重度 / 成本**：`doc-drift` · `low` · `M`
- **出处**：findings.md:11
- **现状与问题**：已知问题：spec §3.1 correction 删除清单漏 project-scope、CHG-09 验收记录写不存在的 warnOnce 键、set-activation 报错首句漏列 --pause/--resume/--session；3 条待修 + 1 条 by-design 备案。
- **建议**：已在内部 backlog（P3 open），综合阶段去重用。

#### 9.3　7.0 封闭合同校验缺口组 G-schema（archived 配对不变量三层全静默 + finding/correction 帧无兜底）

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `M`
- **出处**：findings.md:12
- **现状与问题**：已知问题：archived 帧 verified/reviewed-date 为 null 时三层校验全通过（spec 承诺的 format-violation 无执行者，post-tool-use 兜底正则不匹配带 slug 文件名）、finding/correction 帧无 Stop/SessionStart 兜底、重复 key 静默覆盖、change-set 半空可通过校验。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用。

#### 9.4　测试质量组 G-test（V7D 锁覆盖 overclaim + 偶发失败根因 WIKI 直写真实 vault + 零覆盖分支）

- **类别 / 严重度 / 成本**：`test-quality` · `medium` · `L`
- **出处**：findings.md:13
- **现状与问题**：已知问题：『三处拷贝漂移即红灯』被 mutation 证伪（agent.md 模板在锁外）、偶发失败根因为 WIKI 测试直写真实 Obsidian vault（并发 20 跑复现 4 次）、cancelled/检测切片分支零覆盖、runner 不支持 async、2 个测试文件汇总行无条件打绿。共 10 条待修。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用。

#### 9.5　agent/SKILL 模板与合同覆盖缺口组 G-template（close-chg 模板漂移 + update-finding/update-index 无派遣模板 + 死模板）

- **类别 / 严重度 / 成本**：`redundancy` · `medium` · `L`
- **出处**：findings.md:14
- **现状与问题**：已知问题：agent.md close-chg 正向模板缺 implementation-notes（照抄即被 guard deny）、batch 指引引用已删 type key、update-finding/update-index 有名无模板（dogfood 实证主 session 越界自救）、implementation_plan.md 死模板等 10 条。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用。

#### 9.6　migrate-v7 工具缺陷组 G-migrate（status 引号回填不触发致整库中止 + hygiene 无备份 + 催办盲区）

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `L`
- **出处**：findings.md:15
- **现状与问题**：已知问题：rewriteFrontmatter 状态判定不剥引号致含引号 status 的野外 v6 vault 不可迁移（fixture 实测 exit=1）、零缩进块序列孤儿行验收假绿、--hygiene 无预览无备份不可还原、全归档/中途 crash 双形态永不催办、migration-state 零消费方。受众为未迁移野外 v6 项目。共 7 条待修。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用。

#### 9.7　artifact 体系三维度审计——hook 消费集窄 + 大量写而不读字段 + 模板抄 5 份 + 双文件各拖 v5 死尾巴（大重构事实基础）

- **类别 / 严重度 / 成本**：`architecture` · `high` · `L`
- **出处**：findings.md:19
- **现状与问题**：已知问题：hook 真实消费仅 status+verified/reviewed-date+change-set+索引行核心字段+任务清单段；aliases/tags/type/帧内ID/completed-date/finding 帧 impact·summary 等纯摆设（80/80 恒空且零消费）；每个 operation prompt 模板抄 4-5 份（artifact-management SKILL 内部就有两份 close-chg 模板）致 A1 漂移必然；task.md/impl_plan 各拖不同 v5 历史死尾巴零 v6 逻辑读取。这是计划中的大重构事实基础，待 compact 后 brainstorm。
- **建议**：已在内部 backlog（P1 open，重构窗口），综合阶段去重用——这是已知最高优先级结构性债。

#### 9.8　foreign worktree 写码门搭便车（isCodeFile gatedEntries 不滤 foreign owner 的 CHG）

- **类别 / 严重度 / 成本**：`security` · `low` · `S`
- **出处**：findings.md:20
- **现状与问题**：已知问题：pre-tool-use.js 写代码门的 gatedEntries 来源不过滤 foreign worktree owner 的 CHG——worktree B 写代码可搭 worktree A 的 running CHG 便车放行。
- **建议**：已在内部 backlog（P3 open），综合阶段去重用。

#### 9.9　task.md 与 implementation_plan.md 索引职责重复（v6 详情下沉后两文件退化为同一份拷贝）

- **类别 / 严重度 / 成本**：`redundancy` · `medium` · `M`
- **出处**：findings.md:21
- **现状与问题**：已知问题：v6 详情下沉后 task.md 与 implementation_plan.md 退化为同一份 CHG 索引行的两份拷贝，双文件维护成本（跨索引一致性校验、双写、双归档）失去对应收益，待 brainstorm 重新定位。与 P1 重构 finding 同一主题。
- **建议**：已在内部 backlog（P2 open），综合阶段去重用。

#### 9.10　SessionStart 注入质量修复 change-set（9 项内容质量问题 + 3 结构性根因）

- **类别 / 严重度 / 成本**：`maintainability` · `high` · `L`
- **出处**：findings.md:22
- **现状与问题**：已知问题：spec 版本过时、finding 状态过时、truncateSpec 对真实标题失效（死逻辑）、compact 比 startup 少注入相关知识、git 缺脏文件/ahead-behind、walkthrough 截断量、status 引号、Artifact 段去重、vault root 默认。共性根因：代码/注入假设 vs 真实产物脱节。分期 IQ-1/2/3。
- **建议**：已在内部 backlog（P1 open），综合阶段去重用。

#### 9.11　CC v2.1.91→v2.1.126 变更评估行动项（PreCompact 阻止能力升级机会 + updatedToolOutput + CLAUDE_EFFORT）

- **类别 / 严重度 / 成本**：`product-direction` · `low` · `L`
- **出处**：findings.md:68
- **现状与问题**：已知问题/机会：核对 pre-compact.js 事件类型并评估切到 PreCompact + exit 2 阻止能力（解决 V 阶段未完成时 compact 丢上下文痛点）、PostToolUse updatedToolOutput 全工具支持可替代部分 DENY 为 silent fix、${CLAUDE_EFFORT} 让 skill effort 自适应、plugin skill frontmatter hooks 修复。多为升级机会非缺陷。
- **建议**：已在内部 backlog（P1 open，CC 升级跟进），综合阶段去重用。

#### 9.12　LOCKS-001 跨 runtime 重复 ID（需引入 artifact-root-bound 运行态，架构决策 deferred）

- **类别 / 严重度 / 成本**：`architecture` · `medium` · `L`
- **出处**：findings.md:40
- **现状与问题**：已知问题：两独立 clone 配置同一 artifact root 并发 reserve 时 sequence lock/counter 绑 project-runtime 致跨 clone ID 重复；修复需引入 artifact-root-bound 运行态，属架构决策，已主动 deferred。
- **建议**：已在内部 backlog（P1，archive 区 deferred），综合阶段去重用。

#### 9.13　守卫识别层 blocklist 结构性不完整（架构债，纵深对抗向量留根治窗口）

- **类别 / 严重度 / 成本**：`architecture` · `low` · `L`
- **出处**：findings.md:38
- **现状与问题**：已知问题：守卫判定模型仍是双层 blocklist（动词枚举 + wrapper/引号状态机），结构性不完整；自然可达向量已补，纵深对抗向量按『纪律工具非对抗器』定位留架构根治窗口（argv/目标路径解析）。
- **建议**：已在内部 backlog（P3，archive 区 deferred），综合阶段去重用——按可达性判据有意降级，勿当新漏洞重复上报。

#### 9.14　[方法论] 大版本重构发布面 prompt 写成变更态 diff 而非目标态合同

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：corrections.md:7
- **现状与问题**：反复踩的坑（correction 主题）：重构发布面 prompt 应描述目标态合同而非记录从旧到新的变更 diff，否则后人读 prompt 看到的是过程而非当前规范。关联 knowledge ai-workflow-design。
- **建议**：已在内部 backlog（active correction），综合阶段作为已知方法论基线，勿当新观察。

#### 9.15　[方法论] 采纳 finding 前漏查设计意图导致 feature 当 bug

- **类别 / 严重度 / 成本**：`test-quality` · `high` · `S`
- **出处**：corrections.md:8
- **现状与问题**：反复踩的坑（correction 主题）：路由 finding 到修之前未查证设计意图，把有意 feature 误判为 bug。关联 knowledge strict-audit-methodology。综合阶段对任何疑似缺陷必须先做设计意图查证。
- **建议**：已在内部 backlog（active correction），综合阶段作为去重/复核基线。

#### 9.16　[方法论] 凭新代码推断 regression 未做 before/after 实证

- **类别 / 严重度 / 成本**：`test-quality` · `high` · `S`
- **出处**：corrections.md:9
- **现状与问题**：反复踩的坑（correction 主题）：仅凭新代码推断回归而未做 before/after 实证对比。关联 knowledge strict-audit-methodology。任何 regression 断言需实测两态。
- **建议**：已在内部 backlog（active correction），综合阶段作为复核基线。

#### 9.17　[方法论] 死代码/产物当事实导致三次同源误判

- **类别 / 严重度 / 成本**：`test-quality` · `high` · `S`
- **出处**：corrections.md:10
- **现状与问题**：反复踩的坑（correction 主题）：把死代码或产物当成事实来源，造成三次同源误判（死路径误报不可达等）。关联 knowledge strict-audit-methodology。二手『死路径/不可达』结论必须独立验产物。
- **建议**：已在内部 backlog（active correction），综合阶段作为最高频复核基线——多条 finding 的 severity 调整都源于此。

#### 9.18　[方法论] 规格 vs 产物不一致时把产物当事实来源

- **类别 / 严重度 / 成本**：`doc-drift` · `high` · `S`
- **出处**：corrections.md:11
- **现状与问题**：反复踩的坑（correction 主题）：规格与产物不一致时应回规格定锚，而非假设实物即合理。关联 knowledge strict-audit-methodology。
- **建议**：已在内部 backlog（active correction），综合阶段作为复核基线。

#### 9.19　[方法论] 给 agent 写 instruction 用负向措辞而非正向描述

- **类别 / 严重度 / 成本**：`maintainability` · `medium` · `S`
- **出处**：corrections.md:12
- **现状与问题**：反复踩的坑（correction 主题）：instruction 应写该做什么（正向 framing）而非禁止什么（blocklist 反模式）。关联 knowledge ai-workflow-design。
- **建议**：已在内部 backlog（active correction），综合阶段评 instruction 时作为基线。

#### 9.20　[方法论] 回规格定锚只判产物符合性漏评估规格最优

- **类别 / 严重度 / 成本**：`doc-drift` · `medium` · `S`
- **出处**：corrections.md:13
- **现状与问题**：反复踩的坑（correction 主题）：回规格定锚时只判产物是否符合规格，漏了评估规格本身是否最优。关联 knowledge strict-audit-methodology。
- **建议**：已在内部 backlog（active correction），综合阶段作为复核基线。

#### 9.21　[方法论] 改 repo agent-references 后用旧 cache 验证新行为（含 injection-output/cache 源混淆系列）

- **类别 / 严重度 / 成本**：`dx` · `medium` · `S`
- **出处**：corrections.md:14
- **现状与问题**：反复踩的坑（correction 主题，project-only）：改 repo 内 agent-references 后用旧 plugin cache 验证、把注入摘要当源文件状态——源/产物混淆系列。综合阶段验证行为需确认跑的是 cache 还是 repo，注入需 push+reload 后才进 cache。
- **建议**：已在内部 backlog（active correction，project-only），综合阶段作为验证流程基线。

---

_本文 9 切面观察与综合方向由后台 Workflow（run `wf_2d3e0626-92b`）生成；独立核验与编辑结论由主 session 回代码定锚后撰写。_
