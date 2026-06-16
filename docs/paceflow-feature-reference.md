# PACEflow Feature Reference（v6.7.1 行为基线）

> 用途：v7 大重构（artifact-schema-v7-refactor change-set，CHG-20260611-08 ~ 13）前的全量 feature 基线，供变更后逐项校验回归。
> 方法：2026-06-11 三个 Explore agent 并行盘点（hook 入口层 / 机制层 / agent-skill 发布面）+ 主 session 抽查校正。
> **测试覆盖结论的校正说明**：agent 报告大量「无测试」标记经抽查为假阴性——本仓测试是自定义 runner 脚本式断言（无 describe/it），按特征 grep 实测：pause 相关 24 处、owner/sibling 87 处、resource/sequence 锁 32 处、change-analysis 状态机 33 处、激活判定 66 处、reserve/v5 192 处。基线五连全绿（385 e2e + 261 pace-utils + 42 layers + 9 agent-tests + plugin validate）即为行为基线的机器表示；本文档是其人读索引。

---

## 1. Hook 入口层

### 1.1 SessionStart 注入体系（session-start.js + session-start/layers.js + collect-state.js）

| Feature | 触发条件 | 代码锚点 | v7 触碰 |
|---|---|---|---|
| L0 软信号提问层 | code-count/manifest/dated-plan 命中且未激活未禁用 | layers.js renderSoftSignalPrompt | 不动 |
| L1 项目上下文（root/mode/helper 命令） | paceSignal 或 rootChoicePending | renderProjectContext | 不动 |
| L2 工作流入口（skill 指引） | paceSignal && !rootChoicePending | renderWorkflowEntry | 不动 |
| L3 native plan 桥接提醒 | 非 compact && 检测到未同步 plan | renderNativePlanReminder | 不动 |
| L5 Artifact 目录段 | task.md 存在 | renderArtifactDirSection | 不动 |
| L6 格式合规警告 | artifact group && 格式异常 | renderFormatWarnings | **CHG-08**（impl_plan 警告分支移除） |
| L7 活跃 CHG 摘要 + 任务行 | activeChanges 存在 | renderActiveChangeSummary | **CHG-08**（数据源 entries 形态变化） |
| L8 change-set 进度 | changeSet 存在 | renderChangeSetProgress | 不动 |
| L9 artifact 文件块按优先级注入+截断 | artifact group | sortArtifactBlocksByPriority/renderArtifactFiles | **CHG-08**（impl_plan 出注入优先级数组） |
| L10 aged findings 提醒（14 天） | open finding 超期 | renderAgedFindings | 不动 |
| L11 跨会话提醒+执行上下文 | core group 活跃 CHG | renderCrossSessionAndExecution | 不动 |
| L12 Git 状态（脏文件/ahead-behind） | core group | renderGit | 不动 |
| L13 相关知识/thoughts 注入 | wiki/knowledge 匹配 | renderRelatedNotes | 不动 |
| 注入预算（10K chars/hook 拆分 + 46KB 字节守卫） | 超预算 | assembleWithBudget/installSessionOutputGuard | 不动 |
| core/artifact 双 hook 分组 | hooks.json 注册 | GROUP 路由 | 不动 |
| W1-W12 runtime 副作用（flags 清理/模板创建/sweep） | core/artifact group | applyRuntimeEffects | **CHG-08**（W 系 sweep 保留 index-transactions 清理） |
| **新增（v7）** 未迁移布局提示 | impl_plan 活跃行存在 | CHG-12 新建 | **CHG-12** |

### 1.2 PreToolUse 防护链（pre-tool-use.js + bash-guard.js + powershell-guard.js + agent-lifecycle-guard.js + marker-guard.js）

| Feature | 触发条件 | v7 触碰 |
|---|---|---|
| 非 PACE 项目放行（最高优先早返） | !paceSignal | 不动 |
| 写码门：无活跃 CHG deny（含软信号 siblingHint） | Write/Edit 代码文件 && 无 running CHG | **CHG-08**（连续执行判定 1490 行 implCheckbox 简化——A1 点名误伤点） |
| 写码门：未批准 / ready 未开始 / [!] 阻塞 deny | approved/category 状态机 | **CHG-08**（数据源） |
| 跨索引不一致 deny（DENY_V6_INDEX_MISMATCH） | task/impl 集合不一致 | **CHG-08 退役** |
| artifact 直写保护（PROTECTED_ARTIFACTS + changes/**） | 主 session Write/Edit artifact | **CHG-08**（PROTECTED 提升 constants 共享，显式保留 impl_plan） |
| C/V/R 标记突变防护（marker-guard） | Edit 详情文件标记 | 不动 |
| Bash/PowerShell artifact 写保护（重定向/嵌入脚本模式集） | Bash/PS 命令匹配 | **CHG-08**（保护集合改用共享 PROTECTED，含 impl_plan——校验对称性） |
| Bash/PS/Monitor runtime 控制保护（artifact-root/project-root/migration-state/disabled） | 命令试图改 runtime 文件 | 不动 |
| agent 派遣门：artifact_dir 精确匹配 / operation 枚举 / 字段硬校验 | Agent 工具派 artifact-writer | **CHG-10**（deny 文案模板同步 7.0 字段） |
| reserve 强制（create-chg/record-correction 必带预留；batch 块校验） | 无 reserved-id | 不动 |
| owner 接手防护（foreign-fresh 无条件 deny；sibling-fresh 接受 takeover；stale/detached 三字段） | 跨 session/worktree 操作他人 CHG | 不动（消费 entries 但不读 impl 字段） |
| session pause 早返（流程门免除，artifact 完整性门保留） | isSessionPaused | 不动 |
| escape hatch 双出口（disable+pause）幂等追加 | 所有 deny 文案 | 不动 |
| teammate 软化（workflow 门降 hint，代码门保 hard） | isTeammate | 不动 |
| v5 迁移门 / artifact root 选择门 | legacy 检测 / rootChoicePending | 不动 |
| 写码心跳（heartbeat + revive change-owners） | 代码写入成功路径 | 不动 |

### 1.3 PostToolUse 检测与催办（post-tool-use.js）

| Feature | 触发条件 | v7 触碰 |
|---|---|---|
| C/V/R 标志直写检测（非 artifact-writer） | 写入含 APPROVED/VERIFIED/REVIEWED | 不动 |
| 跨索引不一致 warning | task/impl entry 缺一 | **CHG-08 退役** |
| 活跃行落 ARCHIVE 下检测 | task.md/impl 写入 | **CHG-08**（只检 task.md） |
| status-mismatch / verify-missing / review-missing / archive-reminded / blocked-tasks 五类催办（warnOnce + sibling/foreign 跳过） | 活跃 entries 状态机 | **CHG-08**（数据源）；催办语义不变 |
| correction 知识同步提醒 | 写 corrections 详情 | 不动 |
| walkthrough 链接校验 + artifact-writer 终态修复打回 | 写 walkthrough.md | **CHG-08**（修复文案单数化） |
| artifact-writer 资源锁释放（index-transaction 两段式） | agent 写盘后 | **CHG-08**（index-transaction 退役，改直接释放） |
| 心跳 + revive | 代码写入 | 不动 |
| reservation 清理（clearArtifactReservationForRel） | 详情文件落盘 | 不动（待查项：并行 agent 误清疑案另行复现） |
| **新增（v7）** schema 合同写盘校验（即时打回 agent） | 写 7.0 详情不合合同 | **CHG-09** |
| **新增（v7）** 未迁移催办 | v7-migrate-reminded flag | **CHG-12** |

### 1.4 Stop 完成度门（stop.js）

| Feature | 触发条件 | v7 触碰 |
|---|---|---|
| 非 PACE 放行 / pause 早返 / 防无限阻断（MAX_BLOCKS 降级） | — | 不动 |
| inconsistent CHG 硬拦（detail-missing/malformed/active-archived/active-cancelled/task-list-empty/completed 联动） | classifyChange | **CHG-08**（index-missing/index-mismatch 两分支退役；文案单数化） |
| 已完成未验证 / 已验证未审计 / 已验审未归档 三级拦截 | status=completed 状态机 | 不动 |
| deferred 软提醒（backlog/ready/blocked 不拦截只提醒） | isDeferredCategory | 不动 |
| change-set 成组提醒 | 同 set 未执行成员 | 不动 |
| foreign 跳过 / sibling 软化（硬警告转软提醒） | ownerStatus disposition | 不动 |
| ~~AI 声称完成检测（COMPLETION_PHRASES vs pending）~~ | ~~lastMessage 匹配~~ | **CHG-20260616-04 退役**：话术门删除——Stop 是确定性事件信号，不再读 lastMessage 调制放行，确定性 running-pending 检查独扛；COMPLETION_PHRASES 常量摘除 |
| findings 超期催办 / walkthrough 当日记录检查 | aged/requiresWalkthrough | 不动 |
| **新增（v7）** schema 合同兜底检测 | 活跃 entry 帧违反合同 | **CHG-09** |

### 1.5 辅助 hook

| Hook | Feature | v7 触碰 |
|---|---|---|
| subagent-stop.js | artifact-writer 报告协议观察 + close/archive 后 owner 清理 | 不动 |
| session-end.js | detach 本 session owners + 清 pause 标志 | 不动 |
| pre-compact.js | native plan 快照兜底检测（1h 新鲜度 + 项目匹配） | 不动 |
| task-list-sync.js | TodoWrite/任务面板事件观察标记 | 不动 |
| post-tool-use-failure.js | agent 失败资源释放 / 半开事务保锁 / 恢复提示 | **CHG-08**（半开事务保锁逻辑随 index-transaction 退役简化） |
| stop-failure.js | API 错误日志 | 不动 |

---

## 2. 机制层（pace-utils）

### 2.1 锁与运行态（locks.js）——详见 docs/artifact-locking-reference.md

| Feature | 语义 | v7 触碰 |
|---|---|---|
| artifact-writer 全局锁（30min TTL） | 单 agent 独占写入期 | 不动 |
| resource lock（5min TTL，按资源粒度，重入 + in-flight 宽限） | index:changes / index:* / detail:* | **CHG-08**（task.md 仍映射 index:changes——资源名不改防新旧锁不互斥；impl_plan 不再映射） |
| index-transaction 双写事务 | task+impl 双 touched 才释放 | **CHG-08 退役**（简化为直接释放，保函数签名） |
| sequence lock（30s TTL，批量连号） | reserve --count N | 不动 |
| plan-sync lock | synced-plans 原子记录 | 不动 |
| reservation（owner 键控，30min TTL，复用未消费） | create-chg/record-correction 编号预留 | 不动 |
| safeLockName 路径转义 | sessionId/resource 防穿越 | 不动 |
| W6 sweep（30min stale owner/reservation 清理） | SessionStart 每会话 | **CHG-08**（白名单保留 index-transactions 残留清理） |

### 2.2 owner 机制（多 session/worktree）

| Feature | 语义 | v7 触碰 |
|---|---|---|
| change-owner 写入/heartbeat/detach/revive | .pace/change-owners/<slug>.json 生命周期 | 不动 |
| changeOwnerStatus 9 态 disposition | current / current-closed / current-worktree / sibling-fresh / sibling-detached / sibling-stale / foreign-fresh / foreign-stale / unknown | 不动 |
| takeover 三字段协议 | confirmed+source+evidence | 不动 |
| session pause（24h TTL 懒清理，sessionId 键控） | 流程门免除 | 不动 |

### 2.3 激活与根解析

| Feature | 语义 | v7 触碰 |
|---|---|---|
| isPaceProject 信号链 | disabled 优先 → artifact（changes/ 目录）→ legacy v5 → manual | 不动（信号 1 是 changes/ 目录，非双索引文件） |
| detectSoftSignal | code-count(≥3) > manifest(7 清单文件) > dated-plan | 不动 |
| artifact root 解析（vault/local/自定义 + env 覆盖 + 4096 截断） | getArtifactDir 优先级链 | 不动 |
| Project Root 解析（worktree 归一宿主 / 继承 / independent marker） | resolveEffectiveProjectRoot | 不动 |
| CWD 漂移防护 | resolveProjectCwd / helper --cwd | 不动 |
| v5 检测与迁移（legacyV5FilesInDir 特征码 + migration-state 抑制 + batch-archive-v5 四步原子迁移） | v5→v6 路径 | 不动（v5 检测仍读双文件特征——grep 白名单保留） |

### 2.4 change-analysis 状态机

| Feature | 语义 | v7 触碰 |
|---|---|---|
| parseChangeIndex（checkbox+wikilink 全名/slug/别名+malformed 检测） | 索引行解析 | 不动 |
| getActiveChangeEntries | **现状双索引 join；v7 改 task.md 单读（Map 去重保留）** | **CHG-08 核心改造** |
| classifyChange category/reason 全集 | backlog/ready/running/closing-required/blocked/inconsistent(8 reason) | **CHG-08**（index-missing 防卫化、index-mismatch 删、implCheckbox 7 处简化） |
| APPROVED/VERIFIED/REVIEWED 判定（标记+日期双表示同在同缺） | isChange* 三函数 | 不动 |
| countDetailTasks（## 任务清单 T-NNN 统计） | 唯一被结构化解析的正文段 | 不动 |
| validateWalkthroughLinks（slug 死链+\|转义+上下文校验） | walkthrough 完整性 | **CHG-08**（walkthroughContextForChange:83 改单文件循环） |
| findActiveIndexBelowArchive | 活跃行误落归档区 | 不动 |
| parseFrontmatter（扁平 string map + BOM/CRLF 容错） | 帧解析 | 不动 |
| **新增（v7）** validateFrontmatterSchema + SCHEMA_V7_KEYS | 封闭合同（缺失/多余都非法 + 阶段必填） | **CHG-09 新建** |

### 2.5 横切机制

| Feature | 语义 | v7 触碰 |
|---|---|---|
| SESSION_SCOPED_FLAGS + PREFIXES（W3/W4 startup 清理） | session 级一次性提醒 | **CHG-08**（impl-archive-reminded 删）+ **CHG-12**（v7-migrate-reminded 增） |
| 注入预算三层（10K/hook、46KB 守卫、ARCHIVE 缺失 20KB 截断） | context 防爆 | 不动 |
| 日志轮转（1MB 半分割 + lock 防撕裂） | createLogger | 不动 |
| CRLF/BOM 归一（normalizeLineEndings/stripBom/hasNonNull*Date） | 行尾容错 | 不动 |
| FORMAT_SNIPPETS 模板串 | deny/提醒文案素材 | **CHG-08**（implIndex/implDetail 删） |

### 2.6 helper 脚本

| Helper | 行为 | v7 触碰 |
|---|---|---|
| reserve-artifact-id.js | 原子预留（单/batch ≤20/hotfix/correction/复用/--new/--cwd） | 不动 |
| set-activation.js | enable/disable/pause/resume/status 五态 | 不动 |
| set-artifact-root.js / set-project-root.js | root 配置唯一写入路径 | 不动 |
| sync-plan.js | plan 桥接标记 | 不动 |
| print-session-context.js | 执行上下文输出 | 不动 |
| **新增（v7）** migrate/migrate-v7.js | dry-run/备份/瘦身/tombstone/卫生/验收 | **CHG-12 新建** |

---

## 3. Agent/Skill 发布面

### 3.1 artifact-writer 8 操作字段契约（guard 硬校验 18 条全部 confirmed）

| 操作 | 硬校验字段（缺失即 deny） | v7 触碰 |
|---|---|---|
| create-chg 单 | reserved-id、reserved-file-prefix、title、tasks、artifact_dir、operation | **CHG-10**（产物 frontmatter 7.0 模板；双写步骤改单写） |
| create-chg batch | + change-set、change-set-total=块数、每块 reserved-id 唯一+title+tasks+序号连续 | **CHG-10**（同上） |
| update-chg approve / approve-and-start | approval-confirmed=true + approval-source + approval-evidence（+start 加 task-id）；approve 与「开始」意图混淆检测 | 不动 |
| update-chg update-status | [!] 必带 status-reason 家族（三同义任一）；与 verify 混派检测 | **CHG-11**（文档收敛只写 status-reason，guard 宽容期不动） |
| update-chg verify / review | verify-summary / review 三字段 | 不动 |
| close-chg | 八字段全必填：verification-confirmed、complete-open-tasks、verify-summary、review-confirmed、review-source、review-findings、**implementation-notes**（v6.6.2+）、walkthrough-summary | **CHG-10**（写端单写；归档段 7.0 字段） |
| archive-chg | walkthrough-summary；取消归档路径 | **CHG-10**（取消归档补写 archived-date） |
| record-finding / record-correction | finding 字段集；correction 必带 reserve 前置 + 六段正文 | **CHG-10**（帧瘦身：finding 3 字段 / correction 2 字段） |

guard 错误码族：out-of-scope / missing-fields / format-violation / hook-deny / not-pace-project / target-not-found / file-conflict / id-mismatch——**CHG-10/11 改文案不改语义**。

### 3.2 命令（5 个）

`/paceflow:enable|disable|status|pause|resume`——行为全部不动；disable/pause 防滥用条款（AI 不得为绕过 deny 自行运行）不动。

### 3.3 skill 流程承诺（soft 层，文档约定）

| 承诺 | v7 触碰 |
|---|---|
| P-A-C-E-V-R 六阶段编排、CHG 粒度原则、R 审计五步（inline 派发/修前复核/迭代闸 depth=1） | 不动 |
| helper 命令来源 4 步顺序（4 文件重复） | **CHG-11**（单源化到 pace-workflow，其余改指针） |
| 状态→checkbox 映射表（4 份） | **CHG-11**（单源 spec §4.1） |
| operation 模板（抄 4-5 份，SKILL 内两份 close-chg） | **CHG-11**（单源 instructions + 测试锁） |
| 唯一写入路径（artifact 只由 artifact-writer 写） | 不动 |
| 标记位置约束（APPROVED/VERIFIED/REVIEWED 三行相邻） | 不动 |

### 3.4 已知 soft 宣称（文档说但代码不强制——v7 不处理，记录在案）

- correction `wrong-behavior`/`correct-behavior` ≥20 字符：仅文档宣称，guard 只查非空
- `approval-source`/`review-source` 枚举值：guard 只查非空不验枚举
- `implementation-notes` 内容格式（### T-NNN 结构）：guard 只查非空
- batch 成员 frontmatter 最终落盘 change-set 字段：guard 校验 prompt 结构，落盘结果由 schema 合同（CHG-09 起）补位

---

## 4. v7 变更后校验矩阵

| 校验面 | 方式 |
|---|---|
| 全部机器行为基线 | 五连测试全绿：`node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-session-layers.js && node tests/test-agent-tests-helpers.js && claude plugin validate ./plugin` |
| CHG-08 读端（本文档 1.2/1.4/2.1/2.4 标记项） | V7A-* 测试组 + grep implCheckbox/implementation_plan 白名单清零 + 既有 sibling/owner/pause 测试组无回归 |
| CHG-09 schema 合同 | V7B-* + 6.0 存量零误报断言 |
| CHG-10 写端 | V7C-* + agent 链 e2e（create 单写断言）+ guard 测试组 |
| CHG-11 单源化 | V7D-* 三组一致性锁（故意改坏任一处会红） |
| CHG-12 migrate | V7E-* fixture 迁移前后对照 + dry-run 零副作用 |
| CHG-13 发布 | 本 vault 迁移验收 100% + reload 后 dogfood：注入无 impl_plan、create-chg 单写、schema 打回、未迁移提示（用第二项目验证）、五命令可用、sibling/pause 行为抽查 |
| 不动项抽查（防意外触碰） | reload 后 dogfood：软信号提问层（非 PACE 项目）、owner 接手 deny、escape hatch 文案、v5 项目检测提示 |
