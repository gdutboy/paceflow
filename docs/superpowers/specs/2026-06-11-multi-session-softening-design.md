# 多 session 软化设计（sibling 细分 + SessionEnd 降级 + /paceflow:pause）

> 状态：design approved（用户 2026-06-11 批准设计草案「没问题，写 spec 吧」）
> 来源：用户需求（2026-06-10）「session A 执行 CHG 时，同目录 session B 的 Stop 只软提醒；A 不活跃才 AskUserQuestion 接手；或 slash command 有仅对本 session 生效的临时禁用出口」

## 1. 背景与根因

同一 checkout（同 cwd/worktree/branch）下开两个 Claude Code session：A 正在执行 CHG，B 只是问问题或做无关小事。现状 B 在 Stop 时收到 A 的 CHG 的全部硬约束（未完成任务拦截、verify/review 催办），与 B 无关却拦 B。

**根因**：`plugin/hooks/pace-utils/locks.js` `changeOwnerStatus`（~L563-586）——`sameCheckout && !sameSession` 一律返回 `disposition: 'current-worktree'` 且 `current: true`，即同 checkout 的其他 session 被当成 owner 本人，不进入 foreign skip 路径（`stop.js` `isForeignOwnerStatus` 只认 `foreign-fresh` / `foreign-stale`）。

owner 机制现状（直接复用，不新造）：
- owner 记录（`.pace` 运行态 change-owners JSON）已有 `sessionId` / `state` / `timestampMs`（`touchChangeOwnersForSession` 在 session 活动时刷新）。
- 新鲜度判定已有：`jsonLockIsStale(owner, CHANGE_OWNER_TTL_MS)`，TTL 默认 30min（`constants.js:28`，可经 `PACE_CHANGE_OWNER_TTL_MS` 覆盖）。
- 接手协议已有：`ownerTakeoverConfirmed`（`owner-takeover-confirmed: true` + `owner-takeover-source: user-directive` + `owner-takeover-evidence`），`foreign-stale` 路径已消费。

## 2. 用户决策记录（AskUserQuestion，2026-06-11）

| 问题 | 用户选择 |
|---|---|
| 方案取向 | **细分为主 + pause 兜底**：owner 新鲜度自动区分（A 活跃→B 软提醒；A 不活跃→AskUserQuestion 接手），另加 /paceflow:pause 作 session 级显式出口 |
| 重开 session 接续保障 | **SessionEnd 降级 + takeover 兜底**：A 正常关闭时 owner 降级 `state: detached`；重开 C 见 detached 经确认即接手；crash 场景走既有 takeover 协议 + TTL 30min 兜底 |
| pause 强度 | **完全 per-session disable**：Stop gate + PreToolUse 写码流程门全免；不免 artifact 完整性门；session 结束自动失效；防滥用对称项目级 disable |

## 3. 设计

### 3.1 owner disposition 细分（locks.js changeOwnerStatus）

拆 `sameCheckout && !sameSession` 分支（现 L580）为三态，均 `current: false`：

| disposition | 条件（判定顺序自上而下） | 语义 |
|---|---|---|
| `sibling-detached` | `owner.state === 'detached'` | 原 session 已正常关闭，CHG 待接手 |
| `sibling-stale` | `jsonLockIsStale(...)` 为真 | 原 session 疑似 crash/超时（TTL 30min） |
| `sibling-fresh` | 其余 | 原 session 正活跃执行中 |

`sameSession` 分支与 foreign 分支行为不变。**sid 空时不细分**（STOP-03 对称保守）：stdin 缺 session_id 且 env 无时无法区分「同 session」与「sibling」，保留现状 `current-worktree`（`current: true`）路径，避免把可能属于当前 session 的 running CHG 误降级；故 `current-worktree` 仅在 sid 空场景产生，消费点保留对它的现有处理。

**消费点改动**：

1. **`stop.js`（软化面）**：
   - `isForeignOwnerStatus` 扩展或新增 sibling 判定：`sibling-fresh` 对 progress/deferred 类 CHG 跳过硬 warnings（同 foreign skip），改为 softReminders 一条：「CHG-X 正由同目录另一 session 执行中（owner fresh），本 session 不受其完成约束」。
   - `sibling-detached` / `sibling-stale`：跳过硬 warnings，softReminders 提示「CHG-X 的原 session 已关闭/记录过期；如需本 session 接手，用 AskUserQuestion 向用户确认，接手时 artifact 操作带 owner-takeover 三字段」。
2. **`pre-tool-use.js` L647 区（artifact 操作接手防护，收紧面）**：
   - `sibling-fresh` → deny（同 `foreign-fresh` 文案模式，补充「同目录另一 session」措辞）。
   - `sibling-detached` / `sibling-stale` → 要求 `owner-takeover` 三字段（同 `foreign-stale` 路径）；带字段放行并由既有机制把 owner 改写为当前 session。
3. **`pre-tool-use.js` L1381 区（currentOwnedActionableEntries，收紧面）**：
   - sibling 三态 `current: false` 自然使 B 不再搭 A 的 running CHG 便车写项目代码。B 写代码撞「无活跃（自有）CHG」时，deny 文案给三出口：自己建 CHG / 用户确认接手（takeover）/ `/paceflow:pause`。
   - 执行期核对 `gatedEntries` / `projectMutationNeedsGate` 周边逻辑，确认 `current: false` 不引入其他路径回归（如 isCodeFile 分支用的是 `actionableEntries` 不是 currentOwned——行为差异要在测试里锁定）。

### 3.2 SessionEnd hook（新发布面）

- `plugin/hooks/hooks.json` 注册 `SessionEnd` → 新 `plugin/hooks/session-end.js`。
- 行为：对本 session 持有（`sessionId` 匹配）且 `state` 非 `closed` 的 owner 记录，写 `state: 'detached'`（刷新 `updatedAt`/`timestampMs`；其余字段保留）。实现为 `touchChangeOwnersForSession` 的变体或新函数 `detachChangeOwnersForSession(cwd, info)`（locks.js）。
- 同时删除本 session 的 pause 标志（见 3.3）。
- crash/断电不触发 SessionEnd → owner 不降级，由 TTL 30min 自动转 `sibling-stale` 兜底。
- 接手流：重开 session C 在 SessionStart 注入或 Stop 软提醒中看到 detached CHG 提示 → AskUserQuestion 向用户确认（用户一句「继续」即满足 `user-directive`）→ C 的首次 artifact 操作带 takeover 三字段 → owner 改写为 C，后续 C 即 `current`。
- SessionStart 注入增强（可选任务，低优先级）：活跃 CHG 摘要中 owner 为 detached 时标注「原 session 已关闭，可接手」。

### 3.3 /paceflow:pause（完全 per-session disable）

**标志机制（重要修正）**：`SESSION_SCOPED_FLAGS` 现状是「SessionStart 时清掉的项目级共享标志」（所有 session 共用 `PACE_RUNTIME`，且 W3/W4 在任何新 session startup 时清除）——**不能直接用**，否则 A 的 pause 泄漏给 B、且被任何新 session 清掉。pause 用 sessionId 键控变体：

- 标志文件：`getProjectRuntimeDir(cwd)/paused-<normalizedSessionId>`（内容含 sessionId + 创建时间 ISO）。
- 读取：`isSessionPaused(cwd, sessionId)`（pace-utils）——文件存在且 mtime 在 TTL 内（TTL 复用或新设 `PACE_SESSION_PAUSE_TTL_MS`，默认建议 24h，防 crash 残留永久免门）。
- 失效路径：① `/paceflow:resume` 或 SessionEnd 删除；② mtime TTL 过期视为无效（懒清理：读到过期即 unlink）。
- **不加入** `SESSION_SCOPED_FLAG_PREFIXES`（W4 startup 清理会让任何新 session 清掉其他 session 的 pause）。

**helper 与命令面**：
- `set-activation.js` 扩 `--pause` / `--resume`（沿用 argv 解析/fail/stdout 报告模式）。sessionId 来源：helper 作为 Bash 子进程经 `currentSessionId()` 读 `CLAUDE_CODE_SESSION_ID` env——**已在本仓库实测可得**（2026-06-11，Bash 工具子进程 env 含该变量）；env 空时 helper 报错退出并提示手动传 `--session <id>`（不静默写无主标志）。`--status` 输出补 paused 状态行。
- `plugin/commands/pause.md` + `resume.md`（plugin.json `commands` 数组同步），文案双约束：pause 是用户的 session 级退出权；AI 不得为绕过单次 deny 自行运行（对称 disable 的 spec §5.1 不变量 2，措辞更严：pause 免除的是流程门，artifact 完整性门保留）。
- `enable.md`/`disable.md`/`status.md` 文案如有「临时停用」语境处补 pause 指引。

**免门范围**：
- `pre-tool-use.js` 与 `stop.js` 入口处（PACE 信号判定后、各 gate 前）检查 `isSessionPaused` → 直接放行/跳过 PACE 检查，log `SKIP_SESSION_PAUSED`。
- **不免**：artifact-writer 保护门（主 session 直接 Edit artifact 仍 deny）、bash-guard 的 artifact 改写防护——pause 免「流程纪律门」不免「artifact 完整性门」。
- Stop 在 paused 时输出一条人可见提醒（非阻断）：「本 session 已 pause PACEflow（流程门跳过中）；恢复运行 /paceflow:resume」。

**deny 逃生口双出口**：`pre-tool-use.js` `PACE_ESCAPE_HATCH` 文案扩为：「若你（用户）不需要 PACEflow 管理本项目，可运行 /paceflow:disable 停用；仅本 session 临时停用可运行 /paceflow:pause。」（幂等守卫同款）。

## 4. 边界与错误处理

- **sid 缺失**：`changeOwnerStatus` 既有 STOP-03 守卫（sid 空不判 foreign）对 sibling 同理——sid 空时维持现状 `current-worktree` 等价行为（不细分，保守不误伤）。
- **detached + 同 session 重连**：Claude Code resume 同 sessionId 场景，`sameSession` 分支优先于 detached 判定，A 自己 resume 不受影响。
- **多 sibling 并存**：B、C 同时 sibling-fresh 看 A 的 CHG——各自软提醒，互不影响；接手竞态由既有 owner 锁/原子写保障。
- **pause 与 sibling 叠加**：paused session 完全跳过 PACE 检查，不再产生 sibling 提醒。
- **TTL 边界**：`CHANGE_OWNER_TTL_MS` 不改默认值（30min）；pause TTL 独立常量。

## 5. 测试

- 单测（test-pace-utils）：`changeOwnerStatus` 三态矩阵（fresh/stale/detached × sameSession/sibling/foreign/sid 空）；`isSessionPaused` TTL 与懒清理；`detachChangeOwnersForSession` 只降级本 session 非 closed 记录。
- e2e（test-hooks-e2e）：
  - Stop：sibling-fresh 软提醒不出硬 warnings；sibling-detached/stale 给接手指引；同 session 不回归；foreign 行为不变。
  - PreToolUse：sibling-fresh artifact 操作 deny；detached/stale 带 takeover 三字段放行且 owner 改写；B 写代码不搭便车（deny 文案含三出口）；接手后写码放行。
  - SessionEnd：降级仅本 session 记录；pause 标志同步清除。
  - pause：paused session Stop/写码免门 + log；artifact 直接 Edit 仍 deny；A paused 不影响 B；resume 恢复；TTL 过期失效；新 session startup 不清他人 pause 标志。
  - 逃生口：deny 文案含双出口且幂等。
- 回归基线：全量四套（pace-utils / hooks-e2e / session-layers / agent-tests）+ `claude plugin validate`。

## 6. CHG 分期（按闭环边界，pace-bridge 时批量建）

1. **CHG-A：disposition 细分 + SessionEnd 降级**（locks.js 三态 + stop.js/pre-tool-use.js 消费点 + session-end.js + hooks.json + 测试）——核心痛点闭环，可独立验证回滚。
2. **CHG-B：/paceflow:pause 命令面 + 免门**（isSessionPaused + set-activation --pause/--resume + pause.md/resume.md + plugin.json + 入口免门 + 测试）——依赖 CHG-A 无（机制独立），但文案三出口引用 pause，建议顺序 A→B。
3. **CHG-C：deny 文案双出口 + sibling deny 三出口整合**（PACE_ESCAPE_HATCH 扩展 + L1381 deny 文案 + B2 类发布面文案扫描断言）——依赖 A、B 落地后做，避免文案指向 404 命令（HOTFIX-20260610-02 教训）。

## 7. 部署注意

- hooks.json 新增 SessionEnd 是 cache 生效面：push + `/reload-plugins` 后生效；reload 前本仓库 dogfood 时 SessionEnd 不触发，detached 流不可同 session 实测（列 push 后跟进验证）。
- 三个 CHG 全部归档后 bump 一个 minor（建议 6.7.0——新增 SessionEnd hook + 两个新命令属功能面扩展）+ push + rev-parse 双向确认。
- release sanity：commands/ 新文件（pause.md/resume.md）在白名单内（commands/ 目录已白名单）；hooks.json 新事件注册核对 `claude plugin validate`。
