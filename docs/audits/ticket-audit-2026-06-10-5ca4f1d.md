---
title: PaceFlow v6.4.0..HEAD 区间审计 audit-2026-06-10-5ca4f1d
audit-date: 2026-06-10T13:36:33+08:00
audit-range: v6.4.0 (5b626b1) .. HEAD (5ca4f1d, v6.5.2)
git-head: 5ca4f1d28500afc1f84b9b5ba2c8ea50eeb625e9
git-head-short: 5ca4f1d
prior-audit: internal/audit-tickets/ticket-audit-2026-05-29-ac0d15c.md
status: completed
method: 5 维度并行独立发现（区间定位 + HEAD 审计）+ 主 session C/H 一手实证仲裁（反向论据）+ 兄弟形态穷举 + 历史报告/已知 finding 交叉
scale: 5 agent（2 个中断后续传恢复）/ ~1,258,000 subagent tokens / 区间 43 commits +7405/-1012
note: 本文件暂存于项目外——仓库内写入被运行中的 6.1.2 安装版 hook 实时拦截（见关键观察 6），待处置 CHG 启动后落盘 internal/audit-tickets/
---

# audit-2026-06-10-5ca4f1d: PaceFlow v6.4.0..HEAD 区间审计

## 审查摘要

- **审查时间**: 2026-06-10T13:36:33+08:00
- **审查范围**: v6.4.0..HEAD 共 43 个提交（SessionStart 多 hook 重构 M0-M5、注入收尾整改 CHG-20260609-01~05、backlog 清理 CHG-06~09、chg-slug 系列、inject-quality IQ-1/2/3、HOTFIX-20260608-01、HOTFIX-20260609-01），审计对象为 HEAD 当前代码，区间 diff 用于定位
- **证据基线**: git HEAD `5ca4f1d`；**工作区非 clean**——审计全程存在并发 session 的未提交 WIP（`pace-utils.js` / `pre-tool-use.js` / 两个测试文件，CHG-20260610-06 激活信号收紧 A1 进行中）。所有代码结论以 `git archive HEAD` 干净提取物为准；3 个 agent 独立用提取物复证测试全绿
- **版本基线**: v6.5.2（plugin.json / marketplace.json / PACE_VERSION 三处一致，已核实）

### 计数

| 阶段 | 数据 |
|------|------|
| Phase 1 原始发现（5 维度，去 N 级与通过项） | 6H + 29W + 31I ≈ 66 条候选 |
| 去重后独立 H 候选 | 4（locks 取号 ×3 重复、packL3 饿死、wikilink 契约 ×2、guard:315 ×2） |
| Phase 2 主 session 一手验证（H 池） | 2 ✅ 确认 H / 2 ⚠️ 仲裁降 W / **0 ❌ 误报** |
| W/I 池环境归因排除 | 1（e2e 9ab7/18d/18e 失败 = 并发 WIP 污染，HEAD 提取物 341/341 复证） |
| 测试基线（HEAD 提取物） | pace-utils 231/231、hooks-e2e 341/341、session-layers 40/40、agent-tests-helpers 9/9、plugin validate 通过 |

### 关键观察

1. **本区间最大系统性模式：chg-slug 改造"一处格式变更、N 处消费者漏同步"**。设计文档 §4 只列了 reservation 与 `detailPathForId` 两个消费点，实际漏了：取号扫描（H-1）、PostToolUse schema 告警（W-1）、close/archive/update-chg 指令（W-3/W-4）、guard hint 模板（W-5）、agent-tests fixture（W-6）、约 10 处文档文件名描述（P2 批）。主 session 已穷举全仓库：文件路径匹配缺口仅 H-1 与 W-1 两处，wikilink 类正则（change-analysis/layers）均为有意纯 ID，无更多隐藏兄弟。
2. **生产 vault 当前就处于 H-1 易损状态**：`changes/` 同时存在无 slug 旧文件（`chg-20260610-01..04.md`，扫描可见 max=04）与带 slug 新文件（`chg-20260610-06..09-*.md`，扫描不可见）。一旦 `.pace` 重置/换机/重 clone，连续两次 create-chg 即与现存 06 撞号。
3. **R 审计修复自述与实际 diff 不符的"同根残留"再现**：4a83e33 自称修 4 处裸 `reserved-file`，实修 3 处，漏同函数 4 行之下的 :315；配套 T-slug-R 测试只断言 Agent 派遣 deny 路径，代码门 deny 路径无负向断言，测试绿但残留在产。
4. **审计派单基线错误（流程教训）**：主 session 派单时声称"工作区 clean"，实际会话起始 git status 即有 4 文件 M。5 个 agent 均自行发现污染并正确切换到 HEAD 提取物，未造成误报，但派单前必须核对 git status。
5. 05-29 历史 ticket 的 `nextSequenceNumber` reentrant 缺陷已修复在产（`reentrant: false`）；本次 H-1 是同一"ID 唯一性承诺"的另一条腿（目录扫描兜底）被新格式打断，非旧问题复发。
6. **版本偏差实时事故（W-9 活体证据）**：审计报告写入 `internal/audit-tickets/` 被实时硬 deny——运行中的 **6.1.2 安装版** pre-tool-use（cache :1366）对 CHG-20260610-06~09 判"v6 详情文件缺失"（其 `detailPathForId` 无 glob 兜底，找不到带 slug 新文件），触发全项目代码写锁。四个文件实际全部在盘；6.5.2 的 glob 兜底不会误判。结论：**新版工具产出的 slug artifact + 旧版安装 hook = 项目级写入锁死**，且 deny 文案给出的两个出路（create-chg / 修 wikilink）对该场景均无效——与已知 P0 finding（code-count 无逃生口）同款"deny 无可行出口"模式。

---

## P0 必修（确认）

### [H-1] locks.js:695 — create-chg 取号扫描正则不识别 slug 文件名，counter 缺失时铸重复 CHG/HOTFIX ID（✅ 确认，3 agent 独立复现 + 主 session 代码核实）

- **位置**: `plugin/hooks/pace-utils/locks.js:695`
- **描述**: `scanMaxNumberInDir(changes/, /^${lower}-${dateCompact}-(\d{2})\.md$/i)` 只匹配旧无 slug 文件；同函数 :703 自己产出的 reservation 就是 `filePrefix = changes/chg-date-nn-`（artifact-writer 按 title 补 slug 写盘），:712 的 correction 分支正则却是 slug-aware 的 `-(\d{2})-.+\.md$`——同函数内不对称。
- **触发路径**: `nextSequenceNumbers`（:660）`first = Math.max(counter, existingMax) + 1`；counter 是 `.pace/sequences/` 本地 runtime，vault 模式跨机共享 artifact 而 `.pace` 每机独立。counter 缺失（换机/重 clone/`.pace` 清理）+ 当日已有带 slug 文件 → existingMax 漏计 → 重发已用编号。撞号后第二个文件因 slug 不同路径不同，`DENY_WRITE_EXISTING_ARTIFACT` 不触发；`detailPathForId` glob 多匹配静默取 sort 第一，索引出现两条同 ID wikilink。
- **实测证据**: audit-core/audit-consistency/audit-arch 三方独立确定性复现（写 `chg-20260610-01-<slug>.md` + 删 sequences → 再 reserve 返回同一 `CHG-20260610-01`；对照组无 slug 文件正确推进到 -02；correction slug 文件也正确推进）。主 session 核实生产 vault 现状即易损配置（见关键观察 2）。
- **影响**: ID 唯一性承诺的最后防线失效；README LOCKS-001 known-limitation 的"概率极低"论证（依赖两端近乎同时 reserve）被破坏——同日跨机任意时刻必撞。
- **修复**: 正则改 `^${lower}-${dateCompact}-(\d{2})(?:-[^/]+)?\.md$`；补「counter 缺失 + 仅 slug 文件在盘」单测；同步修 `tests/test-pace-utils.js:933` 的 fileRel 空转断言（改断 filePrefix）；评估 LOCKS-001 文案是否随修复重写。
- **CHG 归属建议**: 「chg-slug 收尾批」CHG（与 W-1/W-3/W-4/W-5/W-6 同根合并）。

### [H-2] layers.js:317-321 + budget.js packL3 — 非 findings 文件缺 ARCHIVE 且超 20KB 时饿死 artifact hook 全部注入（✅ 确认，agent 复现 + 主 session 代码链核实）

- **位置**: `plugin/hooks/session-start/layers.js:317-321`（通用字节兜底）+ `plugin/hooks/session-start/budget.js:63-67`（packL3 omit-all-rest 语义）+ `plugin/hooks/pace-utils/constants.js:15`（`ARCHIVE_MISSING_INJECT_LIMIT=20000` bytes）
- **描述**: M3（CHG-20260608-10）把 artifact 文件块从 l1head（永不截）移到 l3（可截层）后，task/implementation_plan/walkthrough/corrections 缺 ARCHIVE 的兜底仍是 20000 **bytes** 截断（为旧 46000-byte 守卫时代设计）。packL3 JSDoc 明文"一旦某条超预算，其后所有条目都计 omitted"。ASCII 为主内容 20000 bytes≈20000 chars > 9500 chars 预算 → 该块 omit 且其后所有 artifact 块（implementation_plan/findings 等）全部 omit，"缺 ARCHIVE 请修复"警告 footer 在被 omit 的块内不可达。**作者自己的注释（layers.js:304-307）已写明此失效机制并只为 findings.md 修了类内截断**，:307"其余文件保持原行为"声明不成立——v6.4.0 原行为是注入 20KB 截断文本+警告（l1head 不截），现行为是整组静默丢失，属区间行为回退。
- **实测证据**: audit-lifecycle 复现——25KB 无 ARCHIVE task.md → l3 sizes [15634, 69, 129] → artifact hook 最终输出仅 86 chars（只剩省略 footer）。
- **细化（主 session 补充）**: 纯中文内容 20000 bytes≈6667 chars < 9500，反而能存活；ASCII/代码为主内容才触发整组丢失。
- **缓解**: 触发需 artifact 已损坏（模板自带 ARCHIVE）+ 文件超大；stop.js checkArchiveFormat 每次 Stop 仍会 nag 修复（恢复路径存在）。
- **修复**（二选一，需产品决策）: ① 非 findings 文件的缺-ARCHIVE 兜底改为 chars 类内截断（≪9500，与 findings 的 impact 截断对称）；② packL3 对超预算单块降级截断而非整链 omit（动"从尾部按条截"语义，影响面更大）。推荐 ①。顺手修 constants.js:12-15 的 ARCH-01 过时注释（其旧字节推导正是本问题根源）。
- **CHG 归属建议**: 「注入预算与可观测性修复」CHG（与 W-2/W-10/W-11 合并）。

---

## P1 建议（确认 W 级，按推荐 CHG 分组）

### 组 A：chg-slug 收尾批（与 H-1 同 CHG）

- **[W-1]** `plugin/hooks/post-tool-use.js:149` — CHG 详情 frontmatter 校验门（缺 status/verified-date/reviewed-date/占位 null 四类告警）用无 slug 正则，对所有新建带 slug 文件整层静默（audit-core 已实证对照）。修复：复用 `marker-guard.js:25` 已导出的 `isChangeDetailArtifactRel`（slug-aware，主 session 已核实）。硬门（close-chg 字段强制）不受影响故 W。
- **[W-3]** `plugin/agent-references/instructions/close-chg.md:133` + `archive-chg.md:70` — walkthrough wikilink 规则文字"`<slug>` 取目标详情文件名去掉 `.md`（slug 来源是文件名）"对带 slug 新文件产出 `[[chg-id-<slug>]]`，与 `change-analysis.js:114-122 validateWalkthroughLinks` 强制的纯 ID 契约矛盾；同段例子给的又是纯 ID（指令自相矛盾）。后果：post-tool-use continueBlockOnce 修复循环 + stop.js repair 软门（3 次降级），可自愈不损数据 → 仲裁 W 不升 H（尚无真实触发实证：vault 无带 slug CHG 走到 close）。修复：改为"wikilink 用纯 ID `[[chg-yyyymmdd-nn]]`（从文件名前缀提取，不含描述性 slug）"，幂等检查措辞同步；补带 slug close/archive 的 agent contract 用例。
- **[W-4]** `plugin/agent-references/instructions/update-chg.md:81-82` — target 解析硬编码 `changes/chg-yyyymmdd-nn.md`，字面执行对带 slug CHG 报 target-not-found。生产实证有自愈（`chg-20260610-06-*` 已成功 approve-and-start，agent 经 Bash 只读定位），但契约字面错误浪费回合。修复：补"先精确 `chg-id.md`、缺失 glob `chg-id-*.md`"（对齐 detailPathForId 语义）；close-chg.md:59 / archive-chg.md:27 同补。
- **[W-5]** `plugin/hooks/pre-tool-use/agent-lifecycle-guard.js:315` — 4a83e33（R 审计 P2-1）自称修 4 处实修 3 处，`artifactWriterCreateChgHint` 残留裸 `reserved-file:` 字段行，与同函数 :319 自相矛盾。该 hint 注入 4 条高频代码门 deny（pre-tool-use.js:1428/1583/1586/1609）。误填后 :295（create-chg reservation 已无 fileRel）mismatch 多吃一轮 deny，`reservationExplicitMissingReason` 可一轮自愈 → 仲裁 W。主 session 已穷举：全仓库唯一残留。修复：:315 改 `reserved-file-prefix`；把 T-slug-R 负向断言 `!/reserved-file(?!-prefix)/` 扩展到 4 条 Write/Edit deny 输出。
- **[W-6]** `tests/agent-tests/` — 套件零提交未随 slug 契约更新：`cases/phase-a/tc-a1-create-chg.yaml:27` 钉死 `changes/chg-{date}-01.md` 精确路径；`helpers/verify-output.js:74-79 toLenientSlugPattern` 只支持 finding-/correction- 前缀（主 session 已核实）。下次真实运行 create 类用例必失败。slug-design §6 要求的"create-chg 生成带 slug 文件名 agent test"未交付。
- **配套注释修正**: `locks.js:681-683`（"create-chg: {id,fileRel,...}"已无 fileRel）、`guard:301`（"create-chg 用 fileRel 走 === 分支"已失效）——位于 reservation 匹配核心路径，误导维护。

### 组 B：注入预算与可观测性（与 H-2 同 CHG）

- **[W-2]** `plugin/hooks/session-start/layers.js:107-114` — buildLayers 活跃 CHG ≥2 时 `state = {...state}` 重绑，之后 `state._found`/`state._logs` 写到副本，编排层（session-start.js:208-224）从原对象 flush → 多 CHG 常态下 SKIPPED_REMINDER/FOREIGN/BLOCKED/INCONSISTENT_CHANGE_SUMMARY 等日志静默丢失、INJECT 日志 files 字段错记（2 agent 独立复现：1 条 summaries 正常、2 条全 undefined）。纯观测性但恰好丢在最需要日志的多 CHG 场景。修复：排序结果用局部变量或把 _found/_logs 改为返回值。
- **[W-10]** `runtime-effects.js:155-166` + `layers.js:174-175` — W12 findings 过期提醒 flag 写入与渲染可达性脱钩：flag 当日首次必写，agedText 排 l3 末位最易被 packL3 omit → 被截当日提醒静默丢失。窄影响（14 天 aged 提醒延迟一天）。修复：agedText 前移或确认未截后再写 flag。
- **[W-11]** `layers.js:723-752 renderActiveChangeSummary` — head 无总上界：每活跃 CHG 约 2 行不限条数（仅任务本体有 3000 上限），几十个活跃 CHG（batch backlog 忘 close 累积）可使 core head 超 10K cap 触发 harness persist（项目自有 finding 已记录该后果：核心上下文残废成 2KB preview）。修复：摘要行加条数上限 + 长尾指针（与 foreign/blocked slice(0,5) 对称）。

### 组 C：测试与发布面收口（可独立小 CHG 或并入组 A/B）

- **[W-8]** `CLAUDE.md` 常用验证 + `REFERENCE.md` §7 — 新增 701 行的 `tests/test-session-layers.js` 未注册进任何验证清单；仓库无 CI，手动清单是唯一测试入口，遗漏即不跑（`.gitignore` 白名单已正确）。
- **[W-9]** 生产部署缺口 — 本机插件 cache 止于 **6.1.2**（本 session 的 SessionStart hook 即从 6.1.2 cache 运行，直接实证），v6.2.0~v6.5.2 全部区间特性零真实安装验证；multihook 设计 §5 自定义的终极判据"reload 后实测各 hook <10K、`<persisted-output>` 不再出现"从未执行。**已升级为实时事故**（见关键观察 6）：6.1.2 hook 对带 slug 详情文件判缺失 → 全项目代码写锁，本审计 ticket 写入被实际拦截。建议：立即更新本机插件 → 重启 session → 跑 v6.5.x production smoke（双 hook 注入、PreCompact 退役、slug 全链路、core/artifact 各 <10K）。
- **[I→P1 顺手]** `layers.js:739` — 任务超量指针 `Read changes/${s.slug||id}.md` 对带 slug 新文件指向不存在路径（真实路径上一行已注入，影响小；`change-analysis.js:130` 已有正确双形态文案可抄）。

## P2 文档（确认，建议一个文档批 CHG 或随组 A 顺手）

- README.md:61/:227/:280/:310 + REFERENCE.md:176 — PreCompact 快照描述全部过时（区间已退役，现仅 native plan 兜底）。主 session 已逐行核实。
- README.md:374-378 — 版本历史止于 v6.4.0，缺 v6.5.0/v6.5.1/v6.5.2（含用户可见的双 hook 注入结构变化）。
- 无 slug 文件名形态批量滞后：`artifact-writer-spec.md:16` §1 树、`artifact-management/SKILL.md:62-66` 文件模型树、`references/change-lifecycle.md:14-19`、`references/format-reference.md:89`、`pace-workflow/SKILL.md:91`、`pace-bridge/SKILL.md:132`、`constants.js:49,51 FORMAT_SNIPPETS`、`artifact-writer.md:41/:65/:109-110`、REFERENCE.md:59-60。统一为 `chg-yyyymmdd-nn[-slug].md` 表述。
- `pace-knowledge/SKILL.md:17` — 注入名额描述落后两轮变更（N1 对称化 + M5 wiki 层）。
- `artifact-management/SKILL.md:256` — update-finding rejected 漏必填 `rejection-reason`（≥10 字符，否则 missing-fields 往返）；路径表无 update-finding 行。
- won't-fix 术语漂移 — `update-finding.md:56`（accepted=won't-fix）vs 其余三处（rejected=won't-fix），两 status 注入行为相反。建议统一：rejected=won't-fix（不注入），accepted 不带 change 改称 known-limitation。
- `artifact-writer.md:388` 操作枚举 6/8（缺 update-finding/update-index）与 :379"8 类"自相矛盾；`guard:203` 兜底模板缺 update-index。
- REFERENCE.md:140 change-set 进度旧描述、REFERENCE.md:3 最后更新日期、CLAUDE.md 与 REFERENCE §7 验证清单互不一致。
- 设计文档状态行反向过时：slug-design 与 injection-quality-design 仍写"尚未实现勿当现行"（已全部落地）；layered-injection-design 被宣告作废但自身无标记。
- 注释卫生：`session-start.js:10` + `layers.js:7-14` "byte-等价重构"声明过时、`constants.js:12-15` ARCH-01（见 H-2）、`collect-state.js:261`、`layers.js:100-106` B5 注释重复、孤立 JSDoc（layers.js:480-499）、`sliceUtf8ToBytes` 双实现。

## P3 延后（preexisting + I 级，建议派 record-finding 持久化）

1. **[W-pre] pre-tool-use.js:1653-1668** — 顶层 catch 对非 PACE 项目 fail-closed deny，与 :302"非 PACE 低干扰"注释矛盾；pace-utils 任一运行时异常会拦死非 PACE 用户全部 Write/Edit/Bash（eb506cb 引入）。需设计裁决：建议非 PACE 信号下降级放行 + stderr。
2. **[W-pre] constants.js:21** — `PACE_ARTIFACT_LOCK_TTL_MS` 全文件唯一无 `|| fallback` 的 TTL；env 非数字 → NaN → legacy lock 永不判 stale（DENY 死锁且文案禁手删）+ reservation TTL 过滤失效。
3. **[W-pre] locks.js:168-186** — acquireJsonLock stale 抢占 unlink/recreate 竞态（双持锁窗口，无回读自校验）。
4. **[W-pre] plans.js:104-112** — expandHomePath 只认 HOME 不认 USERPROFILE（Windows cmd/PowerShell 下 `~` 解析错）。
5. **[W-pre] path-utils.js:54-62** — UNC 路径 posix/win32 归一不对称 → UNC 部署 artifact 守卫绕过（niche）。
6. **[W-pre]** `hasChangesDir`+`legacyV5FilesInDir` 双份实现（pace-utils.js:318-366 / path-utils.js:243-318），v5 签名演进会分叉。
7. **[I-pre] subagent-stop.js:182 + locks.js:103-109** — 锁释放无 agentId 时回落 session 匹配，并行多 writer 窗口内可释放他人锁（TTL 5min 兜底）。
8. **[I] reserve-artifact-id.js:53-65** — reservationConsumed 对 agent 偏离指令写旧式无 slug 文件的盲区（同 session 复用 reserved-id 可造同 ID 双文件；需先偏离指令）。
9. **[I] pre-tool-use.js:636-718** — batch create-chg 仅首块 reserved-id 写 change-owner，其余 N-1 个 owner 门启动滞后。
10. **[I] collect-state.js:272-300** — collectGit 4 个串行 execSync（各 5s timeout）冷盘最坏 ~20s 启动延迟；scanRelatedNotes 大 vault 全文 readFileSync IO 放大（均纯性能）。
11. **[I] session-start.js:54** — 预算 env 只能上调不能下调，注释误导。
12. **[I-pre] layers.js:553-557** — truncateImplPlan skipIds 正则不匹配 v6 wikilink 行（影响小）。
13. **[I] internal/skills/audit/** — 审查范围表 `plugin/hooks/*.js` 漏子目录（本次派单已手动修正为递归 glob）；agent-prompts.md Agent 4 维度 C 缺 slug/finding-gate 新语义靶子。
14. 其余 I/N 级卫生项见各 agent 报告原文（pace-utils JSDoc 缺 'legacy'、displayDir 死注入、post-tool-use.js:255 重复调用、clampTaskLine surrogate pair、correction-detail.md 孤立模板 drift、hook templates 与 spec 措辞级 drift、superpowers-integration V/R 行不对称、print-session-context res.status 等）。

---

## 部分正确 / 有意设计（不修复，记录依据）

| 发现 | 裁定依据 |
|------|---------|
| stop.js:35-40 rootConfigError 无条件 exit 2 绕过 MAX_BLOCKS | PUC-01 注释明示 fail-closed 有意设计（防 vault 配置静默降级漏检活跃 CHG）；建议未来加计数降级但非缺陷 [preexisting] |
| pre-tool-use.js:1263 PROTECTED_ARTIFACTS basename 宽拦 | 与 05-29 ticket"裸文件名兜底是有意反绕过设计"同族；轻度 over-block 是接受的代价 [preexisting] |
| CHG wikilink 纯 ID 在 Obsidian 不可解析（新 slug 文件） | slug-design 决策 B 已明示取舍（索引行标题已含描述）；vault 人读体验受损属已记录意图 |
| pace-utils.js:216-220 isProjectRootMarkerPath 宽拦 | 与 helper-only 政策一致的有意宽拦；仅参数签名误导 |
| packL3 omit-all-rest 语义本身 | JSDoc 明文设计（"从尾部按条截"）；H-2 的修复对象是喂给它的未截块，不是该语义 |

## 误报分析

- **C/H 池零完全误报**（历史 50-80%）：延续 05-29 对抗验证 + 实证复现路线；2 条 H 候选经主 session 反向论据降 W（wikilink 契约矛盾——修复循环可自愈非阻塞；guard:315——真实 deny 输出字段名正确、一轮自愈），降级依据为审查纪律第 8 条。
- **环境污染归因 1 例**：e2e 9ab7/18d/18e 失败初看像区间回归，3 个 agent 分别用 `git archive HEAD` 提取物复跑 341/341 排除——根因是并发 session 的 CHG-A A1 未提交 WIP（TDD 红灯阶段）。**该 WIP 落地时需在其 CHG 内同步 9ab7/18d/18e 与 README 多信号激活表**（已知关联：finding-2026-06-09 code-count P0 的处置 CHG-20260610-06 正在执行）。
- 派单声明"工作区 clean"与实际不符（主 session 失误），未造成误报但已记录为流程教训。

## 验证矩阵（C/H 级）

| 发现 | 验证方法 | 结论 |
|------|---------|------|
| H-1 locks.js:695 slug 扫描 | 3 agent 独立最小复现（含正反对照）+ 主 session 源码核实（:695 vs :703 vs :712 同函数不对称）+ 生产 vault 易损状态实证 + 兄弟形态穷举 | ✅ 确认 H |
| H-2 packL3 饿死 | agent 复现（25KB → 86 chars）+ 主 session 代码链核实（layers.js:304-321 作者注释自证 + budget.js:63-67 语义）+ CJK 反例细化 + v6.4.0 行为对照 | ✅ 确认 H（行为回退） |
| wikilink 契约矛盾（skills 报 H） | 主 session 读 close-chg.md:133/archive-chg.md:70 全段 + change-analysis 契约 + 自愈链路（continueBlockOnce/软门 3 次降级）反向论据 | ⚠️ 降 W（确认存在，自愈非阻塞，无真实触发实证） |
| guard:315 残留（skills 报 H） | 主 session 读 :306-334 全函数 + 穷举全仓库裸 reserved-file + 真实 deny 输出字段核实（:332-333 条件守卫正确） | ⚠️ 降 W（一轮自愈摩擦） |

## 证据来源

- 源码（HEAD 提取物或非 WIP 文件直读）：`plugin/hooks/**` 全部 hook 与子模块、`plugin/agents/**`、`plugin/agent-references/**`（9/9 instruction 全读）、`plugin/skills/**` 4 skill 全量、`hooks.json`、`plugin.json`、`marketplace.json`
- 区间：`git diff --stat v6.4.0..HEAD`（47 文件 +7405/-1012）、43 commits 逐主题定位、关键 commit 全 diff（6550ec4/b597bc7/b381042/4a83e33/03447f3/996b799 等）
- 动态实证：H-1 撞号复现 ×3（独立）、H-2 饿死复现、W-1 slug/无 slug 告警对照、W-2 _logs 丢失复现 ×2、UNC 归一探针
- 真实生产证据：vault `changes/` 混合 slug 状态与 `chg-20260610-06-*` in-progress（approve-and-start 自愈实证）、本机 plugin cache 版本目录（6.1.2 上限）、本 session SessionStart hook 注入路径、**本 session ticket 写入被 6.1.2 hook 实时 deny（关键观察 6）**
- 测试：4 套件 HEAD 提取物全绿 + `claude plugin validate` 通过；工作区失败逐项归因 WIP
- 历史交叉：ticket-audit-2026-05-29（nextSequenceNumber reentrant 已修复确认）、findings.md 开放项（code-count P0 已知且处置中，无重复上报）、IQ/R 审计 won't-fix 裁定（无冲突）

## 后续建议

1. **CHG-A（chg-slug 收尾批，含 H-1）**: locks.js:695 正则 + 单测、post-tool-use.js:149 复用 isChangeDetailArtifactRel、close/archive/update-chg 指令 slug 对齐 + wikilink 纯 ID 措辞、guard:315 + T-slug-R 断言扩展、agent-tests fixture 适配（tc-a1 + toLenientSlugPattern 加 chg/hotfix）、layers.js:739 指针、两处过时注释、LOCKS-001 文案评估。
2. **CHG-B（注入预算修复，含 H-2）**: 非 findings 缺-ARCHIVE chars 类内截断、buildLayers state 重绑、W12 可达性、活跃 CHG 摘要条数上限、ARCH-01 注释。
3. **CHG-C（文档与验证面批）**: P2 全部 + test-session-layers.js 注册验证清单。
4. **生产 smoke（紧急，先于一切）**: 更新本机插件至 6.5.x → 重启 session 解除写锁 → 执行 multihook 设计 §5 终极判据 + slug 全链路 dogfood（真实 create-chg → close-chg 观察 wikilink 产出）。
5. **P3 批**: 派 artifact-writer record-finding 持久化 preexisting 系列（fail-closed catch、NaN TTL、锁竞态、HOME、UNC、v5 双实现等）。
6. **交接提醒**: CHG-20260610-06 执行 session 需把 9ab7/18d/18e 测试同步与 README 激活表更新纳入其任务清单，避免下次发布带红测试。

## 后续测试建议（最小复现集）

- H-1: `reserveArtifactIds` 在「无 counter + 当日仅 `chg-date-01-<slug>.md` 在盘」下断言返回 -02。
- H-2: 25KB 无 ARCHIVE ASCII task.md → artifact group 断言 implementation_plan/findings 块存活 + 缺-ARCHIVE 警告可见。
- W-2: 2 条 activeChangeSummaries → 断言编排层 `_logs`/`_found` 非空。
- W-5: 对 4 条代码门 deny 输出断言 `!/reserved-file(?!-prefix)/`。
- W-3: 带 slug 详情文件的 close-chg agent contract 用例断言 walkthrough 行为 `[[chg-yyyymmdd-nn]]` 纯 ID。
