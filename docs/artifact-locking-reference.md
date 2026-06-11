# PACEflow Artifact 竞态锁机制参考

> 摸底日期：2026-06-11（基于 v6.6.2，commit 545416a）。主 session 对 Explore 全景扫描结论逐项抽查验证后成文；file:line 以当时代码为准，重构后以函数名/常量名定位。
> 摸底动因：多 session 软化设计（`docs/superpowers/specs/2026-06-11-multi-session-softening-design.md`）落地前，确认双向影响——设计是否破坏既有锁 feature / 既有锁机制是否约束设计。结论见 §7。

## 1. 锁与运行态类型总表（6 种）

全部存储于 `getProjectRuntimeDir(cwd)`（宿主项目 `.pace/`，worktree 与继承子目录共享，见 §3）。

| # | 类型 | 路径模式 | 互斥? | TTL | 获取方 | 释放/清理 |
|---|------|---------|------|-----|--------|----------|
| 1 | artifact-writer 项目级写锁（v5 legacy） | `.pace/artifact-writer.lock` | 是 | 30min（`ARTIFACT_WRITER_LOCK_TTL_MS`） | v5 流程遗留 | stale 自清；v6 仅在 agent-lifecycle-guard 检测到未过期锁时 deny 派遣（`legacyArtifactWriterLockDenyReason`） |
| 2 | artifact resource lock（v6 核心） | `.pace/locks/artifacts/<resource>.lock` | 是（按资源粒度） | 5min（`ARTIFACT_RESOURCE_LOCK_TTL_MS`） | artifact-writer 的 Write/Edit 经 PreToolUse `acquireArtifactResourceLock` | PostToolUse `releaseArtifactResourceLock`；`index:changes` 走 index-transaction 双写后释放 |
| 3 | sequence lock（编号预留互斥） | `.pace/locks/sequences/<name>.lock` | 是（non-reentrant） | 30s（`ARTIFACT_SEQUENCE_LOCK_TTL_MS`） | `reserve-artifact-id` helper 经 `nextSequenceNumbers` | 写完 counter 即释放；non-reentrant 防 batch 重入重复计数 |
| 4 | index-transaction（双写事务记录） | `.pace/index-transactions/<owner-key>.json` | 否（记录） | 随 #2 | PostToolUse `markIndexChangesTouchedAndMaybeRelease` | task.md 与 implementation_plan.md 均 touched 后删除事务文件并释放 `index:changes` 锁 |
| 5 | reservation（编号预留记录） | `.pace/reservations/<owner-key>*.json` | 否（owner-scoped 记录） | 30min（随 owner sweep） | `reserveArtifactId` | artifact-writer Write 落盘后 PostToolUse `clearArtifactReservationForRel`；W6 sweep 兜底 |
| 6 | change-owner（CHG 归属记录） | `.pace/change-owners/<change-id>.json` | **否（归属记录，非锁）** | 30min（`CHANGE_OWNER_TTL_MS`，env 可覆盖） | artifact-writer 流程 `writeChangeOwner`（普通覆写，非原子创建） | `markChangeOwnerClosed`（subagent-stop.js:134，agent 收口时）置 closed；W6 sweep 删 closed/超期 |

资源映射（`artifactResourceForRel`，locks.js ~L236-239）：`task.md` + `implementation_plan.md` → 共享 `index:changes`；`findings.md` / `corrections.md` / `walkthrough.md` → 各自 `index:<name>`；`changes/*.md` → `detail:<rel>`；`spec.md` 无锁。

锁的 ownerKey = `agent:<agentId>` 优先，否则 `session:<sessionId>`（locks.js:99）；同 owner 重入（reentrant）放行，resource lock 跨 owner 互斥。

## 2. 典型写入时序（close-chg 写 4 文件）

1. **派遣前（PreToolUse → agent-lifecycle-guard）**：legacy 写锁未过期 → deny；close-chg 必填字段校验（含 v6.6.2 起的 `implementation-notes`）。
2. **agent 逐文件写（每次 Write/Edit 都过 PreToolUse）**：
   - `changes/<id>.md` → 获取 `detail:changes/<id>.md`
   - `task.md` → 获取 `index:changes`，PostToolUse 标记 touched={task.md}，**锁保留**（`reason: index-transaction-open`）
   - `implementation_plan.md` → 同 owner 重入 `index:changes`，PostToolUse touched 双全 → 删事务文件 + 释放锁
   - `walkthrough.md` → 独立 `index:walkthrough` 获取/释放
3. **异常中断恢复**：agent 死在两索引之间 → `index:changes` 锁悬挂 → 5min TTL 后下一次 acquire 自动清除；事务文件由 owner-key 命名，新派遣覆写。无人工干预路径，自愈型。

防双持：`acquireJsonLock` 用 `openSync('wx')` 原子创建；ROB-02——空锁文件（已创建未写入）按 mtime 给 1s `INFLIGHT_GRACE_MS` 宽限，超宽限才判损坏清理。

## 3. Worktree 与子目录归一

- `getProjectRuntimeDir(cwd)` 经 `resolveEffectiveProjectRoot` 归一到**宿主项目 `.pace/`**：git worktree 与继承父 Project Root 的普通子目录全部共享同一套锁/owner/counter/reservation 存储。独立子项目（`set-project-root --mode independent`）才有自己的 `.pace`。
- `executionContextForCwd(cwd)` 产出 `{worktree, branch, cwd, stateDir, isWorktree}`：worktree 名取 checkout basename（主 checkout 为 `main`），写入 change-owner 记录。
- **「继承 .pace 但不继承 CHG」的确切语义**：锁与 owner *存储*物理共享（都在宿主 `.pace/`），但 CHG *归属*由 owner 记录的 `(stateDir, worktree, branch)` 三元组 + `sessionId` 区分——`changeOwnerStatus`（locks.js ~L563-586）按 `sameSession` → `sameCheckout` → fresh/stale 分层判定，跨 worktree 的 CHG 判 `foreign-fresh`/`foreign-stale`，Stop 对 foreign 的 progress/deferred CHG 静默跳过（stop.js:171-184，CS-FOREIGN 对 change-set 成组提醒对称跳过）。即：别的 worktree 的 CHG 不拦你，但你也不能静默接手（pre-tool-use.js:647 起，foreign-fresh deny / foreign-stale 要求 `owner-takeover` 三字段）。

## 4. 场景矩阵

| 场景 | 行为 | 机制 |
|------|------|------|
| a. 同 checkout 两 session 同时写**不同** artifact（findings.md vs task.md） | 并发放行 | 不同 resource 锁路径独立 |
| b. 同 checkout 两 session 同时写**同一** artifact | 后到者 deny（`artifactResourceLockDenyReason`：等待对方完成后重 Read 重试，禁循环重试/删锁） | resource lock 按 ownerKey 互斥 |
| c. 两 worktree 各收口自己的 CHG，同时写共享 task.md | 后到者 deny（同 b——锁在宿主 `.pace` 共享） | `index:changes` 单资源互斥 |
| d. worktree B 看 worktree A 的 active CHG | Stop 静默跳过；artifact 操作 deny（fresh）/要求 takeover（stale） | owner 三元组 foreign 判定 |
| e. 继承子目录派 artifact-writer | 与宿主同一套锁/owner，行为同 a-d；owner.cwd 记录实际派遣 cwd | runtimeRoot 归一 |
| f. crash/中断残留 | resource lock 5min 自愈；sequence lock 30s；owner/reservation 由 SessionStart W6 `sweepStaleRuntimeOwners`（RSL-01/02）删 closed + mtime>30min | TTL 分层 + startup sweep |
| g. 同 checkout 两 session 的 Stop/修复提醒 | **现状无隔离**——`current-worktree`（current: true）使 B 收 A 的全部硬约束 | 多 session 软化设计的根因，见 §7 |

## 5. 并发相关防御注记

| 编号 | 位置 | 语义 |
|------|------|------|
| ROB-02 | locks.js（jsonLockIsStale / readJsonLock） | in-flight 空锁 mtime 1s 宽限，防误抢占双持 |
| STOP-03 | locks.js（changeOwnerStatus） | sid 不可得时不判 foreign，防误跳过当前 session 的 running CHG |
| RSL-01/02 | locks.js（sweepStaleRuntimeOwners） | owner/reservation 按 mtime+TTL 清理，遏制无界增长与孤儿泄漏 |
| BCG-1 | locks.js（reservation 匹配） | id 精确 + filePrefix 前缀双匹配，防多 reservation 误取 |
| CS-FOREIGN | stop.js | foreign owner 成员集合供 change-set 成组提醒对称跳过 |
| 心跳 states 过滤 | pre-tool-use.js:229-234 / post-tool-use.js:78-82 | `touchChangeOwnersForSession(states: ['active','closing'])`——仅活跃态记录被刷新 mtime，closed（及未来的 detached）不被心跳续命 |

## 6. 测试覆盖与缺口

已覆盖（test-pace-utils.js）：acquireJsonLock 互斥/重入/ROB-02、sequence lock 防重入、resource lock 并发矩阵、stale+ENOENT 重试、changeOwnerStatus 三元组与 STOP-03、运行态路径识别。

缺口（摸底时确认未覆盖）：
1. index-transaction 双写释放的 e2e（仅单测层面间接覆盖）
2. agent 中断后锁残留→TTL 自愈的端到端观测
3. CS-FOREIGN change-set 成组跳过
4. 多 worktree 并发 close-chg 端到端（场景 c）
5. owner-takeover 全流程

## 7. 与多 session 软化设计的交叉影响分析（摸底结论）

> 对照 `docs/superpowers/specs/2026-06-11-multi-session-softening-design.md`（sibling 三态细分 + SessionEnd 降级 + /paceflow:pause）。

### 7.1 设计不影响的锁 feature（正交性论证）

- **resource lock / sequence lock / index-transaction / reservation 完全正交**：四者按 `ownerKey`（sessionId/agentId）键控，不消费 `changeOwnerStatus` 的 disposition；sibling 细分只改 disposition 分类，不触碰锁的获取/释放路径。同 checkout 两 session 写同一 artifact 的互斥（场景 b）在细分前后行为一致。
- **跨 worktree foreign 判定不动**：细分只发生在 `sameCheckout && !sameSession` 分支内部，foreign-fresh/foreign-stale 路径、CS-FOREIGN、takeover 协议原样保留。
- **部署窗口兼容（无 brick 风险）**：owner 记录只新增 `state` 枚举值 `detached`；旧 cache 的 `changeOwnerStatus` 对未知 state 不特判（仅特判 closed），detached 记录走现状 fresh/stale 判定 → `current-worktree`，即旧 hook 读新记录 = 维持现状行为，新旧共存窗口安全。

### 7.2 既有机制对设计的约束（spec 需吸收的发现）

1. **disposition 消费点是 5 处不止 3 处**：除 stop.js:170、pre-tool-use.js:647、pre-tool-use.js:1382 外，还有 **post-tool-use.js:208**（修复提醒按 `foreign-fresh` 跳过——sibling-fresh 需对齐跳过，否则 B 仍收 A 的 CHG 的 verify/review/archive 催办，软化不完整）与 **session-start/collect-state.js:191（enrichSummaryOwner）**（SessionStart 注入摘要的 `owner=` 字段直接显示 disposition——细分后注入显示三态，detached 可顺带提示「原 session 已关闭，可接手」）。
2. **detached 生命周期受 W6 sweep 约束（30min 终点）**：心跳 states 过滤不含 detached → SessionEnd 写入后 mtime 不再刷新 → 30min 后被 `sweepStaleRuntimeOwners` 清除 → owner 记录消失，CHG 变无主（disposition `unknown`），回到现状「谁碰到谁负责」语义。即接手窗口分两段：30min 内显式 takeover；30min 后自然无主可直接接续。语义自洽，spec 写明即可，无需对抗 sweep。
3. **同 session resume 需 revive detached**（spec 遗漏，已补）：Claude Code resume 延续同 sessionId 时，A 自己经 `sameSession` 分支正常工作，但 owner state 停留 detached——sibling B 会看到「可接手」并可能在 A 活跃时抢走 CHG。修法：心跳路径（`heartbeatChangeOwnersForSession`）遇本 session 的 detached 记录升回 active（state 改写 + 刷新 mtime）。
4. **closed 优先级**：`markChangeOwnerClosed`（subagent-stop）置 closed 的记录，SessionEnd 不得 detach（spec 已写「非 closed」）；closed 由 W6 sweep 清理，与 detach 无竞争。
5. **pause 与心跳/锁释放不冲突**：pause 免「Stop gate + PreToolUse 写码流程门」，但 post-tool-use 的锁释放、owner 心跳不免——A pause 后继续工作时 owner 保持 fresh，sibling B 看到的「A 执行中」与事实一致；artifact 完整性门（resource lock + artifact-writer 唯一写入）全程保留。
6. **pause 标志不能用 SESSION_SCOPED_FLAGS 共享机制**（spec 已修正）：W3/W4 startup 清理会让任何新 session 清掉他人标志，且共享标志无 session 隔离；用 `paused-<sessionId>` 键控 + SessionEnd 删除 + mtime TTL 兜底，且**不进** `SESSION_SCOPED_FLAG_PREFIXES`。

### 7.3 结论

设计与既有锁机制**无冲突**：锁层（互斥、事务、自愈）完全正交不动；归属层（change-owner）只在 sameCheckout 分支内细分 + 新增 detached 枚举，部署窗口向后兼容。代价是 spec 消费点清单从 3 处扩到 5 处、补 detached 生命周期与 revive 规则——均已回写 spec（见 spec §3.1/§3.2 修订）。
