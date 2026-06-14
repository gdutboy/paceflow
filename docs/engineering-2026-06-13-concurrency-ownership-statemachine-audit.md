# PACEflow 工程深挖：并发 / 所有权 / 状态机 / 锁 / agent 写入审计（2026-06-13）

> 针对用户点名的子系统做正确性与并发审计：强制 artifact-writer agent 写入、状态机（APPROVED→VERIFIED→REVIEWED→archived + 9-key 封闭合同）、artifact 资源锁 + stale sweep、session/worktree/子项目所有权与继承。
> 方法：4 子系统深读 + 1 对抗并发怀疑者并行取证 → 综合（分真 bug / 设计异味 / 可接受权衡）→ 主 session 回代码独立定锚。比 `optimization-2026-06-13-release-surface-review.md` 更深、聚焦正确性。
> 本文属仓库维护材料（`docs/`），不随 marketplace runtime 发布。

| 元数据 | 值 |
| --- | --- |
| 日期 | 2026-06-13 |
| 方法 | 6 agent（含对抗并发怀疑者）→ 综合；主 session 逐行代码定锚 + TTL 取值核对 |
| 规模 | ~825K subagent tokens · 238 工具调用 · ~20 分钟 |

---

## 执行摘要

**这套并发 / 所有权 / 状态机 / 锁 / agent-写入架构整体健康，骨架扎实，不需要推倒重来。**

- **互斥存储层经源码核验确为正确设计，明确「别动」**：`fs.openSync(lockPath, 'wx')` 原子建锁（非 `existsSync`+`writeFileSync` 竞态）、`jsonLockIsStale` 的 in-flight mtime 宽限（避免抢占另一进程刚 `openSync(wx)` 尚未写 body 的空窗口致双持）、`releaseJsonLock` 双条件防误删、序列锁 `reentrant:false` 串行取号 + finally 释放、`existingMax` 扫共享 changes/ 作双保险、SubagentStop/PostToolUseFailure 双清理、`.pace/.gitignore` 写 `*` 挡 git 入库。fail-closed 姿势一致（取锁失败转 deny、坏 stdin/未知工具 hardDeny）。TTL 自愈使无永久 brick。
- **要修的核心是一个确定性语义 bug + 一个软门**（原报的第三个 high「锁泄漏」经主 session 逐行复核**已证伪**，见独立定锚表）：① owner 活性判据用错信号（heartbeat 只刷 active/closing + sweep 用文件 mtime）→ 活跃 session 的 blocked CHG owner 被误清（severity 复核下修 high→medium，资源锁仍防数据损坏，后果是所有权混淆）；② V/R 偏序是 LLM-soft 门、缺确定性把守。
- **其余跨 clone 同 ID / symlink 命名空间 / takeover 无 CAS 等理论竞态，按真实可达性降级或仅文档化——不要为此引入分布式锁 / CAS / 常驻抽检（过度工程）。**

---

## 主 session 独立定锚

| 断言 | 定锚结论 | 证据 |
| --- | --- | --- |
| 互斥存储层是正确设计 | ✅ **确认** | `locks.js:163` `openSync(wx)` 原子；`:145-148` in-flight mtime 宽限；TTL 取值合理：sequence 30s / resource 5min / writer 30min / WAIT 2.5s（`constants.js:23-27`，均 env 可覆盖有下限） |
| Bug #1 锁泄漏（pause/newer-schema return） | ❌ **证伪（主 session 复核翻案）** | PreToolUse pause(`:1389`)/schema(`:1399`) return 是**放行**非 deny → 工具执行 → `post-tool-use.js:94-116` **无条件释放**资源锁（仅非 PACE 项目早退，无 pause 早退）。锁释放正确分工：PreToolUse 仅在 **deny** 路径（1183/1261）自释放，**allow** 路径由 PostToolUse 兜底。3 个 agent 同犯「PostToolUse 不触发」推理错误，综合层未追 allow-path 清理。**无泄漏。** |
| Bug #2 heartbeat/sweep 信号错配 | ✅ **机制确认，severity high→medium（复核下修）** | `pre-tool-use.js:238` heartbeat 仅 `['active','closing']`；`locks.js:442` sweep 按文件 mtime + `state==='closed'` 判删（确不读内部 timestampMs）→ 活跃 session 持有的 **blocked/backlog** CHG owner 30min 未刷新被误清。**但**资源锁仍串行化每次写盘 → 后果是**所有权混淆/双重接手**而非数据损坏；可达性主要在多 session/worktree。真实缺陷是 heartbeat 状态过滤不对称（session 活着且在干别的活，其 blocked CHG owner 却被当死） |
| 综合 agent 的自纠 | ✅ **采信** | 综合层主动纠正一个子 agent 过度断言"写盘即时校验层不存在"——`post-tool-use.js:155` 确有写盘后 schema 校验（含 verified/reviewed null-with-signal 162-178）；V/R 缺口真实范围比该 agent 描述的窄（缺的是 marker 偏序，不是整个写时层） |

---

## 优先级（按 ROI = severity × 可达性 ÷ effort）

> 详见下方「确认的 bug」「设计异味」「可接受权衡」「cautions」四节（由 workflow 综合 JSON 忠实生成）。

1. ~~#1 [high/S] 锁泄漏~~ — **已证伪**（PostToolUse allow-path 兜底释放，见独立定锚表）。3 agent 交叉命中同一推理错误而对抗验证未抓到——本身是「独立复核 > 攒一波分析」的活证据。
2. **#2 [medium/M] heartbeat/sweep 错配（原 high，复核下修）** — heartbeat 扩到全部非 closed 状态 + sweep 改用内部 timestampMs。后果是所有权混淆非数据损坏（资源锁仍串行写盘），主要在多 session/worktree 可达。
3. **#3 [high/M] V/R 偏序无确定性门** — agent-lifecycle-guard 的 verify/review/close 分支补 `readChangeDetail` + `isChangeApproved/isChangeVerified` 前置 hard-deny（把已有的字段缺失硬门补齐偏序硬门，与项目护城河同构；正是上一份「方向」文档说的"声明→证据"的状态机版）。
4. **#4 [low/S] status 枚举校验** — `validateFrontmatterSchema` 对 typo status（如 `archive` 漏 d）退化为 base-only，顺手补枚举校验。
5. **#5 [medium/M] 两套 frontmatter 解析器分叉** — 短期 `hasNonNull*` 去 whole-doc fallback + 块内匹配对齐 `parseFrontmatter`。
6. **#6 [medium/M] owner 写盘层不复核归属** — 写盘分支对 detail mutation 反解 CHG-ID 复核 owner，闭合 dispatch→write 判定割裂。

---

<!-- 以下四节由 workflow 综合 JSON 忠实生成，未经转写改写。 -->

## 确认的 bug（按 severity，含可复现/可推演场景 + 修法）

### Bug 1　[❌ 主 session 复核：已证伪 · 原报 high]　PreToolUse 取资源锁后命中 pause / newer-schema return 分支漏释放锁

> **复核修正（主 session 逐行定锚）**：此 bug 不成立。pause/newer-schema return 是**放行**（非 deny）→ 工具执行 → `post-tool-use.js:94-116` 无条件释放资源锁（PreToolUse 仅在 deny 路径 1183/1261 自释放，allow 路径由 PostToolUse 兜底）。3 个 agent 同犯「PostToolUse 不触发」推理错误，综合层未追 allow-path 清理。下方为 workflow 原始取证，保留以存证（说明对抗验证如何漏判）。

- **证据**：pre-tool-use.js:1137 `artifactResourceLockHeld = resource` 设置后，1389 `if (isSessionPaused(...)) return;` 与 1399-1403 newer-schema `return` 均无释放；对照 1183/1261 才有显式 release，证明释放是逐路径手补、非 try/finally 统一保障。5 个取证 agent 中 3 个独立命中此点（subsystem 1/3/5），我已在源码逐行核验设置点与两个 return 点。
- **触发场景**：session 已 /paceflow:pause，随后派 artifact-writer 写 artifact：PreToolUse 在 1106 取得 detail/index 资源锁、1137 记录持有、1389 命中 pause 直接 return。工具因后续被 pause 跳过而未执行 → PostToolUse 与 PostToolUseFailure 都不触发 → 锁悬挂至 5min ARTIFACT_RESOURCE_LOCK_TTL_MS 过期。期间另一 session/agent 对同 CHG 并发写被无谓阻塞满 2500ms 后 reason:locked。
- **修法**：用 try/finally 包裹 1106 之后逻辑，finally 中 `if (artifactResourceLockHeld && 本次为 deny/skip 决策) releaseArtifactResourceLock(...)`；最小修复是在 1389 pause-return 与 1403 schema-return 两处补显式释放，与 1183/1261 对称。或把 isSessionPaused 检查上提到资源锁 acquire 之前（pause 本就免流程门，没必要先占锁）。

### Bug 2　[high]　change-owner 心跳只刷 active/closing + sweep 用文件 mtime，导致 blocked/backlog/ready owner 必被 30min 后误清

- **证据**：pre-tool-use.js:236-239 heartbeat 仅传 `states:['active','closing']`；locks.js:548-549 `_rewriteChangeOwnersForSession` 对不在 states 集的记录 continue 跳过不刷新；locks.js:439/442 sweepStaleRuntimeOwners 仅按 `fs.statSync(fp).mtimeMs` 判 `now - mtimeMs > ttlMs` 删除，完全无视文件内 timestampMs。三处均经源码核验。
- **触发场景**：worktree-A 的 session 把 CHG 置 blocked 等用户解阻塞——该 owner 记录 state=blocked，永不被 heartbeat 触碰，mtime 静止。30min 后 worktree-B 新开 session，SessionStart W6 sweep 删掉 A 的 owner 记录（即使 A 仍活跃）。删除后 B 调 changeOwnerStatus 得 disposition=unknown（readChangeOwner 不 ok → locks.js:589），unknown 不在 takeover deny 列表 → B 绕过 owner-takeover 三字段握手直接 create/接手同 CHG → 双 owner 并发写。反向：纯做 Read/Grep/思考 30min 不写文件的 active session，其 owner 也因 heartbeat 只在 file-mutation/Bash 触发而 mtime 静止被误清。
- **修法**：(1) sweep 判 stale 改用 owner 内部 timestampMs（与 jsonLockIsStale 一致），或删除前 readChangeOwner 校验 `state!=='closed' 且 timestampMs 未过 TTL`；(2) heartbeat 的 states 过滤扩展到所有非 closed 活跃状态（backlog/ready/blocked/active/closing 全刷），使「session 活着 → owner mtime 持续刷新」对所有活跃状态成立。

### Bug 3　[high]　V/R 阶段偏序（VERIFIED 需 APPROVED、REVIEWED 需 VERIFIED）无确定性 hook 把守

- **证据**：agent-lifecycle-guard.js:530-554 mentionsVerifyOnly 只校验 prompt 含 verify-summary、mentionsReviewOnly 只校验 prompt 含 review-confirmed/source/findings——全程不 readChangeDetail 看文件是否已 APPROVED/VERIFIED；marker 写入对 agent 一律 PASS（不校验前置 marker）。与 MEMORY 记录的「确定性网关>LLM-soft；状态机标志强制靠字段缺失 hard-deny（REVIEWED 空门根因）」原则同构但偏序未覆盖。注：post-tool-use.js:155 已有写盘后 schema 校验，但它校验的是 frontmatter 必填集，不校验 marker 偏序。
- **触发场景**：主 session 在一个从未验证（无 verified-date、无 VERIFIED）的 completed CHG 上直接派 update-chg action=review，prompt 凑齐 review-confirmed/source/findings 三字段——prompt 门放行，agent 按 spec 本应拒绝但若误判/被诱导即写入 REVIEWED+reviewed-date，产出 reviewed=true 但 verified-date=null 的非法态（即 spec line 341 定义的 format-violation），无机器拦截。
- **修法**：在 agent-lifecycle-guard 的 mentionsReviewOnly/mentionsVerifyOnly/close-chg 分支增加确定性前置：用 changeIdFromAgentPrompt 解析 target，readChangeDetail 后 review 要求 isChangeVerified(detail)===true、verify 要求 isChangeApproved(detail)===true，否则 hard-deny。把偏序从 LLM-soft 升级为与字段缺失同构的确定性网关。

### Bug 4　[medium]　owner 校验只在 Task 派发时按声明 target 做一次，写盘路径不复核被改文件归属

- **证据**：派发门 pre-tool-use.js:638-703 仅对 explicitTargetChangeId 调 changeOwnerStatus；artifact-writer 写盘分支(976-1148)只做 ARCHIVE-marker/status/reservation(仅 Write 新建)/acquireArtifactResourceLock，全程无 changeOwnerStatus，也无 artifactRelForMutation 与派发 target 的一致性校验。资源锁只防同刻并发不防越权。
- **触发场景**：一个为 CHG-X 合法派发、已过 owner 门的 artifact-writer，在同次运行里对另一 sibling/foreign-owned 的 CHG-Y 详情做 Edit（已存在文件无需 reservation），只需抢到 CHG-Y 资源锁即放行。日常可达：复杂 close-chg/update-chg 指令里 agent 误把相邻 CHG 的索引行/详情一并整理。与项目『确定性网关>LLM-soft』原则相悖。
- **修法**：在写盘分支(976+)对 isChangeDetailArtifactRel 的 mutation 增加 owner 复核：从 artifactRelForMutation 反解 CHG-ID，调 changeOwnerStatus，foreign-fresh/sibling-fresh 且无 takeover 三字段则 deny，闭合 dispatch→write 之间的判定割裂。

### Bug 5　[low]　validateFrontmatterSchema 对 typo/未知 status 退化为只校验 base，绕过阶段必填集

- **证据**：change-analysis.js:259 `valueRequired = [...spec.base, ...((spec[st]) || [])]`——st 不在 SCHEMA_V7_VALUE_REQUIRED.chg 的 key 集合（archived/cancelled）时 spec[st] 为 undefined，退化为只 base。status 枚举本身从不被校验。源码核验确认。
- **触发场景**：status: archive（漏 d 的 typo）传入校验，因 'archive' 不在 archived/cancelled 必填集 → verified-date/reviewed-date/archived-date 全不被要求，全 null 的归档帧返回 ok=true。叠加 classifyChange 的 unknown-status 分支只对活跃帧生效，typo 归档帧既出活跃区又被 schema 判 ok，双重静默。
- **修法**：validateFrontmatterSchema 增加 status 枚举校验：status 不属于 {planned,in-progress,completed,archived,cancelled} 时 missing.push(`status(unknown-value:${st})`)，不静默退化到 base-only。成本极小，与现有 unknown-key 检测同位置。

### Bug 6　[medium]　两套 frontmatter 解析器对重复 key/异常位置 frontmatter 结论分叉

- **证据**：line-endings.js hasNonNullVerifiedDate 用 `/^verified-date:.../m`（首匹配优先）+ 无 frontmatter 时 target=全文 fallback；change-analysis.js:43 parseFrontmatter 要求 `^﻿?---`（frontmatter 必须文首），:48 `out[m[1]]=...`（重复 key last-wins）。两正则核验确认行为分叉。
- **触发场景**：详情含两行 verified-date（首行真 datetime、次行 null）：marker-guard 的 hasNonNullVerifiedDate=true（首匹配），但 parseFrontmatter→null（last-wins），isChangeVerified=false——marker-guard 认为此 Edit 在设 verified（对 agent PASS/主 session DENY），状态机认为未 verified，判定不可复现依赖谁先读。第二分叉：frontmatter 前有空行时 parseFrontmatter 返回 {}，hasNonNullVerifiedDate 走 whole-doc fallback 返回 true。
- **修法**：短期最低成本：hasNonNullVerifiedDate/hasNonNullReviewedDate 无 frontmatter 时返回 false（去 whole-doc fallback）+ 改首匹配为 frontmatter 块内匹配，与 parseFrontmatter 对齐。中期统一为单一解析入口，并在 parseFrontmatter 增加重复 key 检测计入 violation。

## 设计异味（可优化，非即时 bug）

### 异味 1　互斥层与编号锚在 per-checkout .pace，跨 clone/多机共享 vault 时不覆盖（同 CHG-ID 双文件 TOCTOU）

- **证据**：resolveEffectiveProjectRoot 用 path.resolve 把 runtimeRoot 设为 <projectRoot>/.pace（每 clone 各一份），getArtifactDir 可返回共享 VAULT_PATH。序列锁/资源锁/reservation/change-owner 全在 getProjectRuntimeDir 下。但 existingMax(locks.js:745) 已扫共享 artDir/changes 作安全网——所以碰撞窗口仅限「两 clone 都 reserve 但都未写盘」的 TOCTOU，单文件落盘后 existingMax 即关闭窗口。git worktree 经 worktreeBaseDir 解析到 host .pace 是安全的，仅独立 clone+云同步这条路径未覆盖。
- **建议**：这是设计权衡而非即时 bug：reserve→write 之间的 TOCTOU 需两个独立 clone 在共享 vault 上近乎同时 create-chg 才触发，非单人日常。若要彻底闭合，方向是 reserve 时在共享 artDir/changes 用 openSync(wx) 写原子占位文件 chg-DATE-NN.reserved 作跨 runtime 唯一性凭据。但需先量化「跨 clone 共享 vault 并发 create」的真实发生率——多数单人多 worktree 场景已被 host .pace 共享覆盖，不值得为罕见路径引入云同步锁文件的新复杂度。建议先补一个跨 runtime collision 回归测试锁定边界，实现按需。

### 异味 2　归档帧移出活跃索引后不再被 schema 合同校验（终态帧 schema 漂移无人复查）

- **证据**：getActiveChangeEntries(change-analysis.js:377) 只解析 readActive(task.md) ARCHIVE 上方；Stop(stop.js:230) 与 SessionStart 都只遍历 active entries。但需纠偏 subsystem-2 agent 的过度断言：post-tool-use.js:155 确有写盘后 schema 校验层（含 verified/reviewed null-with-signal 检查 162-178），『即写盘即时层根本不存在』是错的。真实残留缺口是：archived 帧已落盘后若被某次对其他文件的编辑间接波及、或落盘时绕过了 PostToolUse，此后不会被 active 循环重扫。
- **建议**：因写盘时已有 PostToolUse 校验，残留风险比 agent 描述的窄，severity 应从 high 降为 medium。优先做『写时校验加固』而非『归档区周期抽检』——后者是为窄窗口加常驻扫描的过度工程。具体：确保 archive-chg/close-chg 写盘路径的最后一次 detail Edit 必经 PostToolUse:155 校验（验证 close 流程最后落盘的是 detail 而非 task.md），即可让终态帧落盘即合规。归档区抽检仅在出现真实脏数据案例后再加。

### 异味 3　资源锁是 per-tool-call mutex 而非 per-operation mutex，多文件 artifact 操作跨 Edit 不连续持锁

- **证据**：PreToolUse 取锁(1106)/PostToolUse 立即释放(post-tool-use.js:94-99)，一次 close-chg operation 跨 detail+task.md+walkthrough 多次 Edit，且同一 detail 的连续 Edit 之间锁被释放。operation 级一致性实际靠 change-owner 记录 + Claude Code 的 modified-since-read 乐观检查，资源锁不提供该保证。
- **建议**：这是认知陷阱风险大于实际危害——审计/维护者易误以为资源锁提供 operation 级保证。最有价值的动作是文档化资源锁真实粒度（per-tool-call），并把 operation 级互斥的权威机制明确定为 change-owner 记录（这反过来强化了为何 owner 误清 bug 必须修）。真正的 per-operation 粗粒度锁（owner-keyed、覆盖整个 agent 生命周期）是 L 级改动，仅在 owner 记录可靠性修复后仍出现 operation 级不一致案例时才值得投入。

### 异味 4　强制 agent 间接写入：单行 artifact 更新放大为跨进程 LLM 往返，无同步降级路径

- **证据**：主 session 全程被 DENY_DIRECT_ARTIFACT_WRITE 禁直写，任何标记/状态翻转/索引行更新都须 reserve(Bash)→派 artifact-writer(子进程 LLM turn)→Read 指令→Edit→SubagentStop 报告解析。即便 [/]→[x] 一行索引改动也走完整 subagent 派遣。
- **建议**：对多 session/多 worktree 协作，强制 agent 承载的格式/索引不变量与确定性网关是真实收益，不应废除。但可为『确定性、无歧义、单行』的状态/标记更新（update-status/verify/review 这类机械操作）提供受 hook 校验的同步 helper（类似 reserve-artifact-id 由 hook 直接执行并自带格式/owner 校验），让主 session 免 subagent 往返；create-chg/close-chg 等需生成内容与多文件协调的仍强制走 agent。先量化日常派遣中机械单行更新占比再决定投入——若占比低则不值得。

## 可接受权衡（看似问题，但 by-design 可接受——别瞎改）

**1. symlink 路径分叉使同物理项目裂成两套 owner/lock 命名空间（path.resolve 不解析 symlink）**

- 为何可接受：理论上 IDE 与终端可能给出 symlink 与 canonical 两种形态，但同一用户在两个 session 一个用 /home/me/proj(symlink) 一个用 /mnt/disk/proj(真实路径) 操作同一 changes/ 是相当罕见的边界。当前 writeChangeOwner 必带 cwd/stateDir。修法 fs.realpathSync 归一确实低成本（S/M），可以加但不紧急；不应为此做大改。属可接受现状，realpath 归一作为锦上添花。

**2. takeover check-then-write 无 CAS，sibling-stale 并发接手 last-write-wins**

- 为何可接受：窗口在单次 hook 调用内极小，且接手本身已要求用户带 takeover 三字段（夺取是授权的）。触发需用户在两个 sibling session 几乎同时下达接手指令。单文件资源锁仍串行化每次具体写盘。属低可达性理论竞态，CAS 是 M 级改动，ROI 低，按可达性判据可降级或仅文档化。

**3. dispatch 时即写 backlog change-owner，agent 死亡留 phantom owner + 编号空洞**

- 为何可接受：phantom owner 在 30min TTL 内自愈，编号空洞无害（不影响正确性，只是号段不连续）。SessionStart sweep 兜底。仅是窗口期 sibling 可能误判『有人在做 NN』的整洁度问题。修法（推迟 owner 写入到 PostToolUse 或 SubagentStop 即时清理无文件的 backlog owner）是 S 级合理改进，但不属必修。

**4. lockMatchesOwner 的 session(no-agent)↔agent 经 sessionId 兜底 reentrant**

- 为何可接受：当前调用面安全——主 session 在 else 分支只读不取 artifact 资源锁，artifact 资源锁恒带 stdin.agentId。是『未来若有同 session 非 agent 路径取锁会双持』的隐含假设脆弱性，非当前可触发缺陷。补一条单元测试锁定预期即可，不必现在改匹配语义。

**5. foreign-fresh owner 无 takeover 通道，.pace 经非 git 整目录拷贝/云盘同步到新机时用户须等 30min 转 stale**

- 为何可接受：.pace/.gitignore 写 '*' 已挡住最常见的 git-commit 向量。剩余是 rsync 不带 filter / Docker 卷快照 / 项目根在 OneDrive 同步盘这条较窄路径。虽然本机 env 确有 OneDrive 路径，但 .pace 随项目根同步且新机同 branch=main 又恰好 cwd 不同才命中。可接受，优先做 deny 文案指引（告诉用户等过期或跑 sweep）而非给 foreign-fresh 开 takeover（跨 checkout 抢活跃 CHG 风险更高）。

**6. date↔comment 双表示一致性无确定性层把守（schema 合同 frontmatter-only 看不到 body marker）**

- 为何可接受：post-tool-use.js:166-178 写盘后其实已做 verified-date/reviewed-date 的 null-with-signal 交叉校验（status==archived 或含 VERIFIED 注释但 date 为 null 时报警），覆盖了最危险的『有信号无 date』方向。残留仅『有 date 无 comment』反向，isChangeVerified 的 AND 判据已保守判为未验证(fail-safe，不会让半验证 CHG 过归档门)。Stop 增加 XOR 交叉校验是零 IO 的合理加固但非必修，现状不破坏正确性只是审计文案不够精确。

## Cautions（看似该加固，但建议别动——过度工程风险）

- 存储互斥层（openSync(wx) 原子建锁 + jsonLockIsStale in-flight 1s grace + releaseJsonLock 双条件防误删 + 序列锁 finally 释放 + existingMax 双保险）这块经我源码核验确实很稳，多处经得起对抗（A 锁过期被 B 抢、两进程都 unlink 后重建仍只一个 wx 成功）。不要为追求『理论完美』重写这层或引入更重的锁原语，会得不偿失。
- 跨 clone 同 CHG-ID 碰撞：existingMax 已扫共享 artDir/changes，碰撞窗口仅限两独立 clone 都 reserve 但都未写盘的 TOCTOU。不要为此引入云同步锁文件或分布式锁——单人多 worktree 已被 host .pace 共享覆盖，跨 clone+共享 vault 并发 create 是罕见路径。先补回归测试锁定边界，实现按需，避免为 <1% 场景背上云同步延迟与『锁文件不该被同步』的新矛盾。
- 归档帧 schema 复查：不要加『SessionStart/Stop 周期抽检归档区最近 N 条』这种常驻扫描——post-tool-use.js:155 写盘时已校验，加常驻扫描是为窄窗口付常态成本的过度工程。优先确保 close 流程最后落盘的 detail 经 PostToolUse 校验即可。
- takeover CAS / sibling-stale 并发双接手：窗口在单次 hook 调用内极小且接手已要求用户三字段授权，单人/低并发现实下不可达。不要为此给 writeChangeOwner 加 CAS 或 change-owner 资源锁——属故意构造才可达，按可达性判据降级，补一条文档说明即可。
- symlink 命名空间分叉 / lockMatchesOwner session 兜底 / foreign-fresh 无 takeover：这三者都是『未来某调用面变化才会触发』或『非 git 整目录拷贝才命中』的低可达边界。realpath 归一与单元测试锁定预期可做，但不要把它们当 high 优先级与确定性 bug 混在一起赶工。
- date↔comment XOR 交叉校验：post-tool-use 已覆盖最危险的『有信号无 date』方向，isChangeVerified 的 AND 判据对归档门 fail-safe。补 Stop 的 XOR 校验是零 IO 锦上添花，但不要把它当必修项——现状不破坏正确性，只是审计文案精度。

---

_5 子系统取证（含对抗并发怀疑者）由后台 Workflow（run `wf_7291921e-6be`）生成；两个 HIGH bug 与互斥层正确性、TTL 取值由主 session 逐行代码定锚；综合层已自纠一处子 agent over-claim。_
