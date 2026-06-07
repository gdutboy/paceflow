---
title: PaceFlow 严格审计 audit-2026-06-07-cdb3b03-to-HEAD（review gate + batch create CHG）
audit-date: 2026-06-07T16:30:00+08:00
git-range: cdb3b03..HEAD
git-head-short: 2543894
prior-audit: docs/audits/audit-2026-06-05-3625f0d-to-cdb3b03.md
audit-lineage: cdb3b03(v6.1.2) 基线审计 → 17 个 commit（v6.1.2→v6.2.1：review gate 5+2 commit / batch create 5 commit / 若干 release+hotfix）→ 本报告
status: completed
scope: cdb3b03..HEAD 全量严格审计——两大 feature（review gate REVIEWED 状态机门、batch create CHG）+ release/hotfix；核「新引入缺陷 + 回归 + 基线残留是否被处理/恶化」
method: 双轨——(A) 主 session 一手 harness（直调真实 guard 函数 + 真实 hook 子进程 + 真实 PowerShell 语义实测 + reserve 子进程边界）；(B) Workflow 9 路独立 finder（不预筛保广度）→ 逐发现对抗验证（默认立场=误报/高估）→ 2 路完整性 critic（覆盖度 + 真实子进程端到端攻击）→ 主 session 三方交叉（一手 + 工作流 + 基线报告）
scale: Workflow 15 agent / ~2.0M tokens / 867 tool uses / 112 min；主 session harnessA 38/38 + harnessB + PS 语义实测 + reserve 边界 + 全 hook diff 通读
verification: test-pace-utils 217/217、test-hooks-e2e 316/316、test-agent-tests-helpers 9/9、plugin validate 通过、版本三处一致 v6.2.1、git diff --check clean（主 session 一手）
verdict: 两大 feature 实现质量高、可安全发布——cdb3b03..HEAD 未引入任何 P0/P1；v6.2.0 的 REVIEWED 空门已被 838bd2e 真实关闭；基线多个 P2 残留（TM-①/HCR-01/PSG-03/ARCH-01/MIGV5-02-REG/VT-01）本批已修复确认。in-scope 发现全部 P3（cosmetic / advisory / 文档 / 窄边界）。唯一 P1 = 守卫识别层 blocklist 同根残留（ln -sf/ed/反引号/if-then），属 cdb3b03 之前 pre-existing 残留，本批仅补 xargs 未根治；最高优先后续 = 按基线建议收敛白名单/source-target 解析。
---

# audit-2026-06-07-cdb3b03-to-HEAD：review gate + batch create CHG 严格审计

## 审查摘要

- **审查对象**：`git range cdb3b03..HEAD`（cdb3b03=v6.1.2，HEAD=2543894=v6.2.1），共 17 个 commit。两大 feature：
  - **review gate（REVIEWED 状态机门）**：CHG-20260606-02..06 + HOTFIX-20260606-02 + HOTFIX-20260607-01。在 VERIFIED 之后、归档之前新增 REVIEWED 状态，与 VERIFIED 门同构。
  - **batch create CHG**：CHG-20260607-01..04。reserve --count N 批量连号预留、change-set/change-set-seq frontmatter、create-chg batch 多块 + 确定性校验、SessionStart 进度注入、Stop 不阻断软提醒。
- **核心结论**：**两大 feature 实现扎实、可安全发布，cdb3b03..HEAD 未引入任何 P0/P1 缺陷。** 关键安全/完整性不变量经一手 + 对抗验证 + 真实子进程端到端三重坐实：
  1. **REVIEWED 空门已真关**：v6.2.0(1d58ba2) 当时 `agent-lifecycle-guard` 完全无 review 处理（空门属实）；838bd2e 补 close-chg 三字段必填 + update-chg action=review 双门 + marker-guard 伪造识别 + post-tool-use 反向校验，与 VERIFIED 门高度同构。主 session 直写 REVIEWED → hardDeny；close-chg 缺 review-confirmed → DENY；batch reserved-id 各类错配 → DENY。
  2. **基线 P2 残留本批已修**：TM-①（teammate shell 写 artifact 升 hardInTeammate hardDeny）、HCR-01（BG-05 open mode= 关键字 + bash↔powershell 对称）、PSG-03（引号上下文感知 normalize）、ARCH-01（CJK footer 字节截断可达）、MIGV5-02-REG（force 回滚逐字节保真）、VT-01（9a04 vacuous 去信号）均确认修复。
  3. **batch 数据模型硬化扎实**：reserve --count 全 fail-closed、advance-by-N 原子无重号、frontmatterNullable 归一一致、parseBatchBlocks 防跨行吞值。
- **in-scope 发现全部 P3**：1 个原报 P2（batch 2.0 非整数绕过结构校验）经对抗验证下调 P3（双畸形触发 + write-time 预留门兜底）；其余为软提醒数学/foreign-owner 不对称/文档协议串遗漏/过期注释等 cosmetic/advisory 级。
- **唯一 P1 属 pre-existing（out of scope）**：守卫识别层 blocklist 同根残留（`ln -sf` / `ed` / 反引号命令替换 / `if…then rm` 仍绕过 bash artifact 写门**与** runtime-control lock 门），是 cdb3b03 基线 RES-GUARD 簇的延续；本批 2fb0dc8 只补了 `xargs` 一个点名向量、知情保留其余（commit message 自述「blocklist 架构债 record-finding 归档」）。
- **证据基线**：当前代码 + 真实 hook 子进程端到端 + 真实 PowerShell 7.5 语义实测为主，测试/revert/git archive 为佐证，文档仅作线索；全部 P0/P1 关键点经主 session 一手 harness 复跑，并与 cdb3b03 基线报告三方交叉。

### 运行验证（基线绿灯，主 session 一手）

| 套件 | 结果 | 备注 |
|------|------|------|
| `node tests/test-pace-utils.js` | ✅ 217/217 | 较 cdb3b03(199) +18 |
| `node tests/test-hooks-e2e.js` | ✅ 316/316 | 较 cdb3b03(274) +42（review gate + batch 用例）|
| `node tests/test-agent-tests-helpers.js` | ✅ 9/9 | — |
| `claude plugin validate ./plugin` | ✅ passed | — |
| 版本一致 | ✅ v6.2.1 | plugin.json / constants.js / marketplace.json |
| `git diff --check` | ✅ clean | 仅 CRLF 归一 warning |

### 计数

| 项 | 数据 |
|----|------|
| 审计维度 | 9 路 finder（rg-hooks / batch-data / batch-mechanism / tracking-integration / agent-contracts / docs-symmetry / tests-honesty / guard-residual / logic-fresh-eyes）+ 2 critic（覆盖度 / 高危集成点 e2e）+ 主 session 一手 |
| 本批确认修复（基线残留）| 6（TM-① / HCR-01 / PSG-03 / ARCH-01 / MIGV5-02-REG / VT-01）+ v6.2.0 空门 |
| 本批引入新缺陷（in-scope）| **P0×0 / P1×0 / P2×0 / P3×10** |
| pre-existing 残留（确认仍在）| **P1×1（RES-GUARD 簇）+ P3×5** |
| 对抗验证下调 | 2（batch 2.0：P2→P3；9ab flaky：P2→P3）|
| 对抗验证维持 confirmed | RES-GUARD P1（三层实证 + 基线交叉）|

---

## 一、本批确认修复（基线 P2 残留 + v6.2.0 空门）

> 全部经一手实证（harnessA 38/38、harnessB、真实子进程、PS 实测）+ 工作流交叉。

| 基线/历史 finding | 本批提交 | 状态 | 一手证据 |
|---|---|---|---|
| **v6.2.0 REVIEWED 空门**（close-chg 不校验 review，可折叠伪造 REVIEWED）| 838bd2e | ✅ 已关 | `git show 1d58ba2` 确认 v6.2.0 时 agent-lifecycle-guard 无 review 处理；HEAD close-chg 三字段进 missing[]，缺 review-confirmed → DENY（harnessA + 真实子进程双证）|
| **TM-①**(P2) teammate shell 写 artifact 软放行 | pre-tool-use.js:764/790/814 | ✅ 修复 | `denyOrHint(reason, {hardInTeammate:true})`——teammate 下仍 `permissionDecision:"deny"`（读 denyOrHint 实现确认）|
| **HCR-01**(P2) open 关键字参绕过 + bash↔ps 不对称 | BG-05 | ✅ 修复 | open(mode=)/open(file=...,mode=)/open(...,encoding=,mode=) 三路 bash+powershell **全 DENY**、只读 ALLOW（harnessA 9 项全过）|
| **PSG-03**(P1) backtick-n 反噬 | normalizePowerShellSearchText 重写 | ✅ 修复（安全侧）| 引号外 bt-n 锚定、引号内 bt-n 不 over-block、真换行/分号仍锚定（harnessA）。注：前提 framing 不准（见 P3-08）|
| **ARCH-01**(P2) CJK footer 不可达 | session-start.js sliceUtf8ToBytes | ✅ 修复 | 层2 改 `Buffer.byteLength` 判定 + `sliceUtf8ToBytes(full, LIMIT-footerBytes)+footer`，footer 字节算进预算 |
| **MIGV5-02-REG**(P2) force 回滚保真 | batch-archive-v5.js | ✅ 修复 | 回滚 before 改 `fs.readFileSync(filePath)`（覆盖前快照），逐字节保真（覆盖度 critic 实证）|
| **VT-01**(P2) 9a04 vacuous | 2fb0dc8 | ✅ 修复 | 三重门去信号 + revert 判别力实证（commit + tests-honesty finder 交叉）|

---

## 二、本批引入发现（in-scope，全部 P3）

> 无 P0/P1/P2。以下均为软提醒/advisory/文档/窄边界级，不破坏数据完整性、不构成可成功的安全绕过。

### [BATCH-2.0] 非整数 change-set-total（2.0）+ 同形 marker 使整个 batch 结构校验空转（P3，本批引入 743320c）

- **位置**：`agent-lifecycle-guard.js`（`looksBatch` 判定 + `parseBatchBlocks` 标记正则要整数）
- **机理**：`looksBatch = parseBatchBlocks.isBatch || (declaredTotal>1)`。当头部写 `change-set-total: 2.0` **且** 标记写成 `--- CHG 1/2.0 ---` 时：标记正则因 `.0 ---` 不匹配 → isBatch=false；declaredTotal 因 `2.0` 非 `^\d+$` → null；故 looksBatch=false → 当普通单条 create-chg 放行，跳过全部 batch 结构校验（块数/change-set 必填/title/tasks/重复 reserved-id/全 N 预留预校验）。
- **一手证据（harnessB）**：`2.0 + 同形 marker + 重复 reserved-id` → `deny=false`（结构门空转）；对照 `整数2 + 重复 reserved-id` → DENY；`parseBatchBlocks(2.0).isBatch=false`。**仅"头部 + marker 双畸形"才绕过**：仅头部 2.0 / 仅 marker 2.0 / 前导零 / 空格均仍正确 DENY（爆炸半径窄）。
- **定级 P3（原报 P2，对抗验证下调）**：触发非有机（prompt 由 AI 按模板 `change-set-total: <N=块数>` 撰写，无算术路径注入 .0）；纵深兜底——write-time per-file 预留门对未预留 CHG id 一律 DENY，绕过无法凭空创建未预留编号、counter advance-by-N 不产生真实碰撞；可漏过的仅"缺 title/tasks 的 planned 块"或"两块同 reserved-id"（后者第二次写同文件仍撞已存在/resource-lock）。
- **建议**：`declaredTotal` 解析加 `Number.isInteger` 校验，或"只要出现 change-set/change-set-total 任一字段即强制走 batch 校验路径"，消除静默降级窗口；补对应回归测试。

### [CS-PROGRESS] change-set 整体进度 done=N-活跃数 在「成员缺失非归档 / 分母不一致」时高估（P3，本批引入 6e3f965）

- **位置**：`session-start.js:611-616`
- **机理**：`n=Math.max(members.length, ...各成员 change-set-seq 分母); done=Math.max(0, n-members.length)`。注释称"done=已归档/完成数"，但任何"不在活跃摘要"的成员都被算 done，含 batch 尚未创建/被取消([-])/分母 typo 造成的 N 虚高。
- **一手证据（工作流真实 session-start 子进程）**：混合分母 2/4+1/6 → "进度 4/6"（实仅 2 活跃）；单成员 1/3 无兄弟 → "进度 2/3"（实 0 完成）；分母 typo 1/99 → "进度 97/99"。Happy path（同建、分母一致、逐个归档）正确（1/4、2/3、0/4）。
- **定级 P3**：纯 SessionStart 注入软提醒，无门、无数据写，仅误导用户对进度的直觉。
- **建议**：done 改为实数（归档区出现的本 change-set 成员数）；或文案以"待执行 X 个"为主、分母标注"估算"；同集分母不一致时降级只显示待执行数。

### [CS-FOREIGN] Stop change-set 软提醒未跳过 foreign owner，与 SessionStart 不对称（P3，本批引入 6e3f965）

- **位置**：`stop.js:264-272`
- **机理**：Stop 的 change-set planned 聚合是独立第二循环，仅过滤 `!changeSet || !isDeferredCategory`，未查 owner；而同 hook 第一循环对 foreign-owner 显式 `continue`，SessionStart 对应块也写了 `isForeignSummary(s)` 跳过。结果：change-set 成员全由其他 worktree/session 拥有时，SessionStart 进度行为空（正确），但 Stop 仍催"还有 N 个未执行成员；逐个 approve-and-start"——催当前 session 接手别人拥有的工作。
- **一手证据（工作流真实 stop.js 子进程）**：seed 另一 session 的 change-owner JSON，当前 session 不同 sid → SessionStart 进度行=[]、Stop 仍打印提醒。
- **定级 P3**：softReminders（exit0）、不阻断，仅误导 + 违背 owner 纪律对称性。
- **建议**：Stop 第二循环对齐 SessionStart，foreign-fresh/foreign-stale 时 continue。

### [BATCH-PERMUTE] batch 块 reserved-id 与块序号位置不绑定，集合相等但置换可过门（P3 cosmetic，743320c）

- **位置**：`agent-lifecycle-guard.js`（块校验只查 seq 连号 + reserved-id 不重复 + 各自匹配预留）+ `pre-tool-use.js`（逐块匹配，不查位置）
- **机理**：不校验"物理第 i 块携带 reserve 输出第 i 个连号"。块顺序 [02,01,04,03]（seq 标号仍 1..4，4 个都是有效预留）整批放行 → chg-...-02.md 拿到 change-set-seq 1/4，id 后缀与叙事序错位。
- **一手证据（critic 真实子进程）**：reserve --count 4 后置换块 → PASS；对照重复/缺块/多块/全伪造/markerTotal≠total 全 DENY。
- **定级 P3 cosmetic**：每个预留槽各消费一次、内容各异、无碰撞/双分配；追踪层按成员独立读 frontmatter 聚合不依赖 id↔seq 对齐。
- **建议**：若需强绑定则逐位比对；否则在 create-chg.md 明确"块序号与编号顺序无需对齐，seq 取自块标记"接受现状（推荐，成本低且无害）。

### [BATCH-ARCHIVE-DETECT] findActiveIndexBelowArchive 与 canonical ARCHIVE_PATTERN 标记识别不对称（P3 advisory，743320c）

- **位置**：`change-analysis.js:338,344`
- **机理**：新检测器用 `/^<!-- ARCHIVE -->[ \t]*$/m`（容行尾空格）+ `/^- \[([ /!])\]/`（不容缩进）；canonical `ARCHIVE_PATTERN` 不容行尾空格、`parseChangeIndex` 容缩进。两处不对称：trailing-space 标记下新检测器告警但 readActive 不切分（误置行仍算活跃=安全侧）；缩进误置行新检测器漏检（但已被 readActive 整体切掉、本不计活跃）。
- **定级 P3 advisory**：仅 post-tool-use 警告（非门），两方向都不开门，无门行为变化。
- **建议**：标记正则统一为 `ARCHIVE_PATTERN`；索引行正则放宽到 `/^\s*- \[([ /!])\]/` 与 parseChangeIndex 对齐。

### [WALK-COMMENT] session-start walkthrough 截断注释过期/自相矛盾（P3 doc-mismatch，68c18bb）

- **位置**：`session-start.js:447,490-491`
- **机理**：68c18bb 把 walkthrough 改 prepend（最新在顶）、两处 tie-breaker 统一 `a.index-b.index`（升序保最新），代码正确；但注释仍写"close-chg 追加记录…按倒序挑选""与上方索引表 append（b.index-a.index）方向相反"——与现状相悖。**注释主动误导，未来维护者按注释改回 `b.index-a.index` 会引入真 bug（同日多 CHG 保留最旧 10 条）。**
- **一手证据**：node 模拟 13 同日行确认 `a.index-b.index` 保最新；close-chg.md:136 "最新在顶，prepend"。
- **建议**：更正两处注释为 prepend 升序语义。

### [COV-PROTOCOL] 发布清单协议串未随 review gate 升级（P3 doc-mismatch，review gate 文档面）

- **位置**：`plugin/.claude-plugin/plugin.json:3`、`.claude-plugin/marketplace.json`（两处 description）
- **机理**：review gate 把协议名升级为 P-A-C-E-V-R 并同步 README/REFERENCE，但 plugin.json + marketplace.json 的 description 仍是 baseline 原文 `…Plan-Artifact-Check-Execute-Verify protocol`。marketplace 用户看到的产品描述与手册协议名分叉。
- **一手证据（覆盖度 critic）**：`git show cdb3b03` 三处一致为 -Verify；本批只改 README/REFERENCE。
- **建议**：两处 description 统一改为 `…-Verify-Review`。

### [GUARD-FRAME] PSG-03 测试 9hge5 + 注释把"引号外 backtick-n"误述为真实 PS 多语句分隔符（P3 doc-mismatch，838bd2e）

- **位置**：`tests/test-hooks-e2e.js`（9hge5 evil 分支）+ `powershell-guard.js:38-41` 注释
- **机理**：修复/测试以"引号外 bt-n 是可在真实 PowerShell 触发的删 artifact 攻击向量"为前提。**但实测 PowerShell 7.5：`Invoke-Expression 'Write-Host hi`nRemove-Item <probe>'` 输出 hi + 字面 `Remove-Item ...` 两行，探针未删——引号外 bt-n 不是语句分隔符（被当参数）；真正分隔符 `;`/真换行/`&` 实测真删探针。** guard 对该输入 DENY 属无害的防御性 over-block，断言（确实 DENY）正确，仅安全论据/注释对 PS 语义不准。
- **主 session 独立交叉**：本审计主 session 用 `Invoke-Expression 'Write-Output AAA`nWrite-Output BBB'` 实测得 `AAA / Write-Output / BBB`（第二 cmdlet 成字符串参数），独立得出同一结论。
- **定级 P3**：DENY 偏安全、引号内字面 bt-n 仍 ALLOW（不 over-block 合法只读），无功能/安全危害。
- **建议**：注释改为"引号外 bt-n/bt-r→换行 仅作防御性归一化，bt-n 本身非 PS 语句分隔符，真正需锚定的是 `;`/真换行/`&`（已覆盖）"；代码逻辑无需改。

### [DOC-TERM] Stop 完成度门档位术语 README"block(exit 2)"vs spec"warning 级软门"（P3 doc-style，24a557f）

- **位置**：`README.md:16,194,225` 与 `artifact-writer-spec.md:136`
- **机理**：同一机制（exit 2 阻断 + 连阻 3 次降级 exit 0）在 README 标"统一 block(exit 2)"、在 spec 标"warning 级软门/非 decision:block 硬阻断"。一手核 stop.js 证明二者描述同一段代码路径、都与不可降级的 PreToolUse hardDeny 区分，**行为一致、不误导**，仅字面标签张力。
- **定级 P3 style（低置信）**：HOTFIX-20260607-01 已实质修复 R↔V 虚构不对称；此为残留措辞瑕疵。
- **建议**：统一为"exit 2 阻断（可降级软门，连阻 3 次降级）"，与 PreToolUse 不可降级 hardDeny 区分。

### [ARCHIVE-LAYER] archive-chg 的 R/V 强制仅在指令层、hook 不校验（P3 info，838bd2e）

- **位置**：`agent-lifecycle-guard.js`（mentionsArchiveChg 仅校验 walkthrough-summary）；强制在 `archive-chg.md`
- **机理**：838bd2e 称"archive-chg 补 R 强制"，核实该强制只落指令层（archive-chg.md format-violation），hook 不做 reviewed/verified 确定性校验。**但这对 R 和 V 完全对称（V 也仅指令层），是既定 agent-trust 架构边界，非本批引入的不对称回归。** 报此仅澄清 commit message"R 强制"的实际层级。
- **建议**：若要 archive-chg R/V 成确定性门需读目标 CHG 详情校验，且应 R/V 一起做保持对称；当前自洽，无需当缺陷修。

---

## 三、pre-existing 残留（out of scope，确认仍在）

### P1：守卫识别层 blocklist 同根残留（RES-GUARD 簇）— 最高优先后续

#### [RES-GUARD] ln -sf / ed / 反引号命令替换 / if…then rm 仍绕过 bash artifact 写门与 runtime-control lock 门（✅ confirmed P1，主 session harnessB + 工作流双 finder + 双对抗验证 + 基线三方交叉）

- **根因**：bash 守卫识别层仍是 blocklist 锚点枚举（`MUTATING_VERB_SOURCE`/`INPLACE_EDITOR_SOURCE`/段首锚点）。组合门 = `looksMutating && referencesArtifact`；这些命令 `referencesArtifact=true` 但 `looksMutating=false`，故组合门空转。
- **主 session 一手证据（harnessB）**：

| 残留向量 | bashCommandLooksMutating | mutatesArtifactRuntimeControl(lock) | 性质 |
|---|---|---|---|
| `ln -sf /dev/null task.md` / `…/.pace/artifact-writer.lock` | **false** ❌ | **false** ❌ | 基线点名未修（MUTATING_VERB_SOURCE 无 ln）|
| `ed task.md` / `ed <lock>` | **false** ❌ | **false** ❌ | 基线点名未修（INPLACE_EDITOR 有 ex/vim 无 ed）|
| `echo \`rm task.md\`` | **false** ❌ | — | 基线点名未修（反引号非段首锚点）|
| `if true; then rm task.md; fi` | **false** ❌ | — | then 非 wrapper（do 加了 then/else 没加）|
| 对照 `rm task.md` / `ls\|xargs rm task.md` | true ✅ / true ✅ | true ✅ | 裸 rm 本就拦；xargs 本批已补 |

- **影响**：触碰 runtime-control（删 `.pace/*.lock`/sequences/index-transactions → 破坏 ID 唯一性/索引事务，**非 git 可恢复**）+ artifact-write。与基线 BG-01(P0) 同等影响，因最自然写法已堵、残留需非常规写法（可达性中）封顶 P1。
- **范围裁决**：`git archive cdb3b03` 复跑确认四向量在基线已全 false（pre-existing）；本批 2fb0dc8 仅向 `BASH_WRAPPERS` 加 `xargs`，commit message 自述「守卫识别层 blocklist 架构债…record-finding 归档」「纪律工具定位不做 blocklist 架构根治」——**知情保留**。完全吻合本审计纪律「fix 解决不对称 ≠ 解决 blocklist 不完整；复审守卫修复必查同根残留」。
- **建议（承接基线 #1）**：把 mutating/runtime-control 判定从 blocklist 锚点收敛为 **白名单 / redirect 式 source-target 路径解析**；过渡期至少补 `ln(\s+-\S+)*` / `ed` / 反引号递归 / `then`·`else` wrapper，并 bash↔powershell 对称补测 + e2e 钉死全部残留向量（含对 `.pace/*.lock` 与 `changes/*.md`）。

### P3 pre-existing（不阻塞，建议 record-finding 归档）

- **[RG-01]** `promptHasNonEmptyField` 正则 `\s*\S+` 跨行：空 `review-source:`/`review-findings:`（其下有兄弟字段）被误判非空而过门。V/C/R 三门共享此弱点（cdb3b03 字节相同），故 review gate「与 V 同构」连缺陷都对称。**讽刺**：同文件本批新增的 `blockFieldValue` 注释明确点出并用同行匹配修复了 batch 块的同款跨行吞值，却没把同行约束套到确认字段。可达性低（marker-guard hardDeny + post-tool-use 占位告警 + 真实 artifact 内容层独立校验，REVIEWED 不会凭空落地）。建议：`promptHasNonEmptyField` 值匹配从 `\s*\S+` 收紧为同行（`[^\S\r\n]*` 代 `\s*`），一处同时收紧 R/V/C。
- **[RES-WRITE-OK]** `reserveArtifactIds` 不校验 `writeArtifactReservation.ok`，批量中途磁盘写失败仍报 reserved=true（cdb3b03 单数版同模式，被 batch 放大）。**fail-closed**：counter 已 advance-by-N（烧号），但下游 `findArtifactReservationForRel` 找不到该 id → DENY_AGENT_BATCH_RESERVED_MISMATCH，不产生无预留/错号 artifact。建议：.map 回调校验 written.ok，失败不计入成功 reservations。
- **[TEST-9ab]** e2e 9ab/9c2a 依赖跨用例共享的全局 `pace-hooks.log` + 1MB 截断，并发跑 suite 时 flaky（对抗验证实测自然 0/25、刻意打边界 0.8%，远低于原报 18%）。纯测试取证脆弱，marker 安全门判定本身正确。建议：指向 per-test 临时日志或改断言 stdout。
- **[AGENT-TYPE]** marker 写入门信任 `stdin.agent_type`；伪造 `agent_type=paceflow:artifact-writer` 可写 APPROVED/VERIFIED/REVIEWED——但 agent_type 由 Claude Code harness 注入、模型不可在 stdin 自设，**真实环境不可达**；A/V/R 完全同构、非本批新增。信息项。
- **[ID-FILENAME]** artifact-writer Write 预留槽时不校验 frontmatter chg-id 与文件名一致。pre-existing、依赖 agent 层自律、仍占合法预留槽，低危。

---

## 四、系统性结论

1. **两大 feature 干净落地、未引入 P0/P1**：review gate 与 VERIFIED 门高度同构（必填字段、伪造识别、claimed-but-null 反向校验、marker hardDeny、post-tool-use warning、stop.js 同 counter 软门、SESSION_SCOPED_FLAG_PREFIXES 补 review-missing- 全部对称）；batch create 双层防御（agent-lifecycle 结构门 + pre-tool-use 逐块 reserved-id 匹配 + write-time per-file 预留兜底）；reserve --count 全 fail-closed、advance-by-N 原子。

2. **本批主动收口了基线多个 P2 残留**：TM-①/HCR-01/PSG-03/ARCH-01/MIGV5-02-REG/VT-01 + v6.2.0 空门——基线"修复另开 CHG/HOTFIX"的建议被切实执行。其中 BG-05 还把 bash↔powershell **对称**补齐（消除基线 HCR-01 新不对称）。

3. **唯一 P1 是知情保留的架构债**：守卫识别层 blocklist 同根残留是 cdb3b03 基线 RES-GUARD 的延续，本批补 `xargs` 但 `ln/ed/反引号/then` 兄弟形态仍空门、且触碰非 git 可恢复的 runtime-control lock。这是修复审计最精微的判断：**本批 fix 真实有效、但底层判定模型（blocklist）未升级，故同根漏判持续**。最高优先后续 = 白名单/source-target 重构，而非再补 blocklist。

4. **in-scope 瑕疵集中在"非门"表层**：进度数学高估、foreign-owner 软提醒不对称、协议串/注释/术语文档分叉、batch 块置换 cosmetic、2.0 双畸形窄边界——均不破坏数据完整性、不构成可成功伪造/绕过，且多有下游兜底。可在一个 cosmetic/doc 收口 CHG 中批量清理。

5. **PowerShell `` `n `` 语义被两处（基线 PSG-03 论断 + 本批测试/注释）共同误解**：实测证明引号外 bt-n 非语句分隔符。本批修复方向偏安全（不漏锚真分隔符、不 over-block 引号内字面），净效果正确，仅 framing 需更正。

---

## 五、建议后续动作

- **CHG-守卫识别层根治（最高优先，承接基线两轮 #1）**：blocklist → 白名单/redirect 式 source-target 解析；过渡补 `ln`/`ed`/反引号/`then`·`else`，bash↔powershell 对称 + e2e 钉死全部残留向量（artifact + `.pace/*.lock`）。
- **CHG-cosmetic/doc 批量收口**：BATCH-2.0（Number.isInteger 或字段存在即强制 batch 路径）、CS-PROGRESS（done 改实数）、CS-FOREIGN（Stop 跳过 foreign owner）、WALK-COMMENT（更正注释）、COV-PROTOCOL（plugin.json/marketplace.json 协议串）、GUARD-FRAME（PSG-03 注释/测试 framing）、DOC-TERM（Stop 门术语统一）、RG-01（promptHasNonEmptyField 同行收紧，连带 V/C/R）。
- **P3 归档**：RES-WRITE-OK / TEST-9ab / AGENT-TYPE / ID-FILENAME / BATCH-ARCHIVE-DETECT / BATCH-PERMUTE / ARCHIVE-LAYER 派 `record-finding`。
- **延续「先审不修」**：本报告只产出审计，修复另开 CHG/HOTFIX。

---

## 六、审计盲区

1. **多进程真实并发** 未起真实竞态（reserve 同锁 advance-by-N、9ab 日志截断窗口）属单进程 fixture/静态推断 + 边界注入复现。
2. **真实 Claude Code harness 注入路径**（agent_type 信任边界）按设计判定不可达，未在真实 harness 内验证。
3. **install.js/verify.js/test-install.js** git-untracked 本地工具，按 `paceflow/CLAUDE.md` 不在 marketplace scope，正确排除。
4. **第一轮 workflow 因服务端 5h 配额耗尽中断**（9 finder 失败），第二轮完整产出 15 agent；主 session 一手 backbone 全程不依赖该配额，覆盖完整。

## 证据来源

- **主 session 一手 harness**：`Temp/pf-audit/harnessA.js`（38/38：PSG-03/BG-05/hasNonNullReviewedDate/parseBatchBlocks/agentLifecycle 门）、`harnessB.js`（RES-GUARD ln/ed/反引号/if-then + runtime-control + batch 2.0）；真实 PowerShell 7.5 Invoke-Expression bt-n 语义实测；reserve-artifact-id.js 子进程 ~9 边界；denyOrHint 实现阅读。
- **Workflow**：9 路 finder（不预筛）→ 逐发现对抗验证（默认立场=误报）→ 2 critic（覆盖度 + 真实 pre-tool-use.js/session-start.js/stop.js 子进程端到端攻击 + 真实 PowerShell + git archive cdb3b03 基线复跑）。
- **提交**：`git range cdb3b03..HEAD`（review gate 4ea9630/8dc5aa3/6ea0fc8/500c8c7/60d2839/1d58ba2/838bd2e/24a557f；batch 95c6966/496d081/743320c/6e3f965/2543894；release cb41098/2fb0dc8 + prompt 68c18bb/ae93976）。
- **基线交叉**：`docs/audits/audit-2026-06-05-3625f0d-to-cdb3b03.md`（RES-GUARD 簇 P1、TM-①/HCR-01/PSG-03/ARCH-01/MIGV5-02-REG/VT-01 P2）。
- **测试**：test-pace-utils 217/217、test-hooks-e2e 316/316、test-agent-tests-helpers 9/9、plugin validate passed、版本 v6.2.1。
