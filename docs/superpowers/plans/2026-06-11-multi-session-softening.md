# 多 session 软化实现计划（sibling 细分 + SessionEnd 降级 + /paceflow:pause）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **PACEflow:** 本 plan 经 pace-bridge 拆为 3 个 CHG（对应下方三部分）批量落地后执行；每个 CHG 独立验证、独立 close（close-chg 必带 implementation-notes）。

**Goal:** 同 checkout 多 session 下，B 对 A 正在执行的 CHG 只收软提醒（A 不活跃才提示接手），并提供 /paceflow:pause 作 session 级显式出口。

**Architecture:** 归属层细分（`changeOwnerStatus` 的 sameCheckout 分支拆 sibling 三态，6 个消费点对齐）+ SessionEnd hook 优雅降级（detached）+ sessionId 键控 pause 标志免流程门。锁层（resource/sequence/index-transaction/reservation）完全不动（正交性见 `docs/artifact-locking-reference.md` §7）。

**Tech Stack:** Node.js hooks（无依赖），自定义 test runner（`tests/test-pace-utils.js` / `tests/test-hooks-e2e.js`）。

**权威规格:** `docs/superpowers/specs/2026-06-11-multi-session-softening-design.md`（含 6 消费点全集、detached 生命周期、isCodeFile 门事实修正）。

---

## Part 1（CHG-A）：sibling 三态细分 + SessionEnd 降级

### Task A1: changeOwnerStatus 三态细分

**Files:**
- Modify: `plugin/hooks/pace-utils/locks.js`（`changeOwnerStatus`，~L578-585）
- Test: `tests/test-pace-utils.js`（changeOwnerStatus 测试区，~L1545-1688 附近追加）

- [ ] **Step 1: 写失败单测**（新增 `SIB-1`~`SIB-4`，仿既有 changeOwnerStatus 测试的 owner 文件构造方式——直接写 `.pace/change-owners/<slug>.json`）

```js
test('SIB-1. 同 checkout 不同 session：fresh owner → sibling-fresh（current: false）', () => {
  // 构造：writeChangeOwner 以 session-A 写入；以 session-B + 同 cwd 查询
  // 断言：disposition === 'sibling-fresh'，current === false，sameCheckout === true
});
test('SIB-2. 同 checkout 不同 session：state=detached → sibling-detached（优先于 stale 判定）', () => {
  // 构造：owner 文件 state: 'detached'，mtime 新鲜
  // 断言：disposition === 'sibling-detached'，current === false
});
test('SIB-3. 同 checkout 不同 session：超 TTL → sibling-stale', () => {
  // 构造：owner timestampMs = Date.now() - CHANGE_OWNER_TTL_MS - 1000，并 utimesSync 老化 mtime
  // 断言：disposition === 'sibling-stale'，stale === true
});
test('SIB-4. sid 空 + 同 checkout → 保留 current-worktree（STOP-03 对称保守）', () => {
  // 查询时 sessionId 传 ''，且确保 env CLAUDE_CODE_SESSION_ID 不泄入（测试内显式传参）
  // 断言：disposition === 'current-worktree'，current === true
});
test('SIB-5. 同 session 与 foreign 行为不回归', () => {
  // 同 session → 'current'；不同 checkout（owner.worktree 改别名）→ 'foreign-fresh'
});
```

- [ ] **Step 2: 跑红** `node tests/test-pace-utils.js`，预期 SIB-1/2/3 FAIL（现状返回 current-worktree）
- [ ] **Step 3: 实现**（替换 L580 的单行 sameCheckout return）

```js
    if (sameCheckout) {
      // STOP-03 对称：sid 空时无法区分同 session 与 sibling，保留 current-worktree 保守路径，
      // 避免把可能属于当前 session 的 running CHG 误降级（spec 2026-06-11 §3.1）。
      if (!sid) return { disposition: 'current-worktree', owner, current: true, sameSession: false, sameCheckout: true, fresh: !stale, stale };
      // sibling 三态：同 checkout 不同 session。detached（原 session 已正常关闭）优先判，
      // 其余按新鲜度分 fresh（原 session 活跃，B 只软提醒）/ stale（疑似 crash，可接手）。
      if (owner.state === 'detached') return { disposition: 'sibling-detached', owner, current: false, sameSession: false, sameCheckout: true, fresh: !stale, stale };
      if (stale) return { disposition: 'sibling-stale', owner, current: false, sameSession: false, sameCheckout: true, fresh: false, stale: true };
      return { disposition: 'sibling-fresh', owner, current: false, sameSession: false, sameCheckout: true, fresh: true, stale: false };
    }
```

- [ ] **Step 4: 跑绿** `node tests/test-pace-utils.js` 全绿（既有 current-worktree 相关测试若按旧语义断言 sibling 场景，按新语义更新并在注释记录变更依据）
- [ ] **Step 5: Commit** `feat(owner): changeOwnerStatus sameCheckout 分支拆 sibling 三态（CHG-A T-001）`

### Task A2: detach / revive 函数（locks.js）

**Files:**
- Modify: `plugin/hooks/pace-utils/locks.js`（`touchChangeOwnersForSession` L526-561 旁）+ exports + `plugin/hooks/pace-utils.js` re-export
- Test: `tests/test-pace-utils.js`

- [ ] **Step 1: 失败单测**

```js
test('SIB-6. detachChangeOwnersForSession 只降级本 session 非 closed 记录', () => {
  // 构造三条 owner：本 session active / 本 session closed / 他 session active
  // 调用后断言：仅第一条 state==='detached' 且 timestampMs 刷新；其余原样
});
test('SIB-7. reviveDetachedChangeOwnersForSession 把本 session detached 升回 active', () => {
  // 构造：本 session detached + 他 session detached
  // 调用后断言：仅本 session 记录 state==='active'
});
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——提取 `touchChangeOwnersForSession` 的目录循环为私有 `_rewriteChangeOwnersForSession(cwd, info, { fromStates, patch })`（sessionId 匹配 + state 过滤 + `{...parsed, ...patch, cwd/stateDir/worktree/branch/executionContext 刷新, updatedAt, timestampMs}` 覆写），三个公开函数成为薄包装：

```js
  function touchChangeOwnersForSession(cwd, info = {}) {
    const states = Array.isArray(info.states) && info.states.length > 0 ? info.states : null;
    return _rewriteChangeOwnersForSession(cwd, info, { fromStates: states, patch: {} });
  }
  // CHG-A：SessionEnd 把本 session 持有的活跃 owner 记录降级 detached（原 session 已正常
  // 关闭、CHG 待接手）；crash 不触发 SessionEnd 时由 CHANGE_OWNER_TTL_MS 转 stale 兜底。
  function detachChangeOwnersForSession(cwd, info = {}) {
    return _rewriteChangeOwnersForSession(cwd, info, { fromStates: ['active', 'closing'], patch: { state: 'detached' } });
  }
  // CHG-A：同 session resume 后心跳把本 session 的 detached 记录升回 active——否则 state
  // 停留 detached 会让 sibling 误判「可接手」，在原 session 活跃时抢走 CHG（spec §3.2）。
  function reviveDetachedChangeOwnersForSession(cwd, info = {}) {
    return _rewriteChangeOwnersForSession(cwd, info, { fromStates: ['detached'], patch: { state: 'active' } });
  }
```

`_rewriteChangeOwnersForSession` 注意保留 touch 现状语义：`fromStates === null` 时仅排除 `closed`（对齐 L543-544 现状）。

- [ ] **Step 4: 跑绿**（touch 既有行为由 SIB-6/7 的「他 session/closed 不动」断言间接锁定；若 touch 有既有单测一并跑）
- [ ] **Step 5: Commit** `feat(owner): detach/revive owner 记录函数（CHG-A T-002）`

### Task A3: session-end.js + hooks.json + 心跳 revive 接线

**Files:**
- Create: `plugin/hooks/session-end.js`
- Modify: `plugin/hooks/hooks.json`（新增 SessionEnd 块）、`plugin/hooks/pre-tool-use.js`（`heartbeatChangeOwners` L229-241）、`plugin/hooks/post-tool-use.js`（心跳块 L78-91）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败 e2e**

```js
test('SE-1. SessionEnd 把本 session 活跃 owner 降级 detached', () => {
  // makeV6Project + 写 owner（session-A active）→ runHook('session-end.js', {stdin: {session_id: 'session-A'}})
  // 断言 owner 文件 state === 'detached'
});
test('SE-2. SessionEnd 不动 closed 与他 session 记录', () => { /* 同型构造，断言原样 */ });
test('SE-3. 心跳 revive：detached + 同 session 写码 → 升回 active', () => {
  // owner state=detached（session-A）→ runHook('pre-tool-use.js', {stdin: {session_id: 'session-A', tool_name: 'Edit', ...写码 input}})
  // 断言 owner state === 'active'
});
```

- [ ] **Step 2: 跑红**（session-end.js 不存在即 FAIL）
- [ ] **Step 3: 实现**

`plugin/hooks/session-end.js`（新文件全文，仿 subagent-stop.js 骨架）：

```js
// SessionEnd hook（CHG-A）：session 正常结束时把本 session 持有的活跃 change-owner 记录
// 降级 state: detached——重开 session 见 detached 即知原 session 已关闭、CHG 可接手；
// crash 不触发本 hook，由 CHANGE_OWNER_TTL_MS（30min）转 sibling-stale 兜底。不阻断。
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch (e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const log = paceUtils.createLogger(path.join(__dirname, 'pace-hooks.log'));

paceUtils.withStdinParsed((stdin) => {
  try {
    const cwd = paceUtils.resolveProjectCwd();
    if (!paceUtils.isPaceProject(cwd) || !stdin.sessionId) return;
    const detached = paceUtils.detachChangeOwnersForSession(cwd, { sessionId: stdin.sessionId });
    if (detached.length > 0) {
      log(paceUtils.logEntry('SessionEnd', 'DETACH_OWNERS', {
        proj: paceUtils.getProjectName(cwd), changes: detached.join(','),
      }));
    }
  } catch (e) {
    log(paceUtils.logEntry('SessionEnd', 'ERROR', { error: e.message }));
  }
});
```

`hooks.json` 在 `"Stop"` 块前插入（格式照抄 Stop）：

```json
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-end.js"] }
        ]
      }
    ],
```

心跳 revive 接线：`pre-tool-use.js` `heartbeatChangeOwners` 与 `post-tool-use.js` 心跳块内，在 `touchChangeOwnersForSession(...)` 调用前加一行：

```js
    paceUtils.reviveDetachedChangeOwnersForSession(cwd, { sessionId: stdin.sessionId });
```

- [ ] **Step 4: 跑绿** + `claude plugin validate ./plugin`
- [ ] **Step 5: Commit** `feat(session-end): SessionEnd 降级 detached + 心跳 revive（CHG-A T-003）`

### Task A4: stop.js sibling 软化

**Files:**
- Modify: `plugin/hooks/stop.js`（`isForeignOwnerStatus` L61-63、主循环 L169-184、CS-FOREIGN 集合 L168/172）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败 e2e**

```js
test('SIB-STOP-1. sibling-fresh：B 的 Stop 跳过硬约束，softReminders 提示另一 session 执行中', () => {
  // makeV6Project + running CHG + owner(session-A, active, fresh) → runHook('stop.js', {stdin: {session_id: 'session-B'}})
  // 断言：无 deny（exit 0 路径），stdout/stderr 含「同目录另一 session 执行中」，不含未完成任务硬 warning
});
test('SIB-STOP-2. sibling-detached：软提醒含 AskUserQuestion 接手指引与 owner-takeover 字段名', () => {});
test('SIB-STOP-3. sibling-stale 同 detached 型指引；同 session 与 foreign 行为不回归', () => {});
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——`isForeignOwnerStatus` 旁新增：

```js
function isSiblingOwnerStatus(ownerStatus) {
  return String(ownerStatus.disposition || '').startsWith('sibling-');
}
```

主循环 L171-184 改为：

```js
    const isForeignOwner = isForeignOwnerStatus(ownerStatus);
    const isSiblingOwner = isSiblingOwnerStatus(ownerStatus);
    if (isForeignOwner || isSiblingOwner) foreignOwnedIds.add(change.id);
    const isProgressState = ['running', 'blocked', 'closing-required'].includes(change.category);
    if ((isForeignOwner || isSiblingOwner) && (isProgressState || isDeferredCategory(change.category))) {
      if (isSiblingOwner) {
        // CHG-A 软化：sibling 的 CHG 不进硬 warnings，改人可见软提醒（emitAllowedStopReminders 通道）。
        softReminders.push(ownerStatus.disposition === 'sibling-fresh'
          ? `${change.id} 正由同目录另一 session 执行中（owner fresh），本 session 不受其完成约束；请勿接手。`
          : `${change.id} 的原 session 已${ownerStatus.disposition === 'sibling-detached' ? '正常关闭' : '失联（owner 记录过期）'}。如需本 session 接手，先用 AskUserQuestion 向用户确认，artifact 操作带 owner-takeover-confirmed/owner-takeover-source/owner-takeover-evidence。`);
      }
      log(projectLogEntry('Stop', isSiblingOwner ? 'SKIP_SIBLING_CHANGE_OWNER' : (ownerStatus.disposition === 'foreign-stale' ? 'SKIP_FOREIGN_STALE_CHANGE_OWNER' : 'SKIP_FOREIGN_CHANGE_OWNER'), {
        proj, change: change.id, owner_state: ownerStatus.owner.state || '',
        owner_worktree: ownerStatus.owner.worktree || '', owner_branch: ownerStatus.owner.branch || '',
        category: change.category, disposition: ownerStatus.disposition,
      }));
      continue;
    }
```

- [ ] **Step 4: 跑绿**
- [ ] **Step 5: Commit** `feat(stop): sibling CHG 软提醒不拦 Stop（CHG-A T-004）`

### Task A5: pre-tool-use.js 接手防护 + 写码门 sibling 过滤

**Files:**
- Modify: `plugin/hooks/pre-tool-use.js`（L648/L673 接手防护分支；L1381-1388 currentOwned/gatedEntries；L1430-1440 deny 文案）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败 e2e**

```js
test('SIB-PTU-1. sibling-fresh 的 CHG：artifact-writer update/close 派遣 deny（不可静默接手）', () => {});
test('SIB-PTU-2. sibling-detached/stale：缺 takeover 三字段 deny，带齐放行', () => {});
test('SIB-PTU-3. B 写代码不搭 A 的 sibling CHG 便车：项目仅 A 的 running CHG 时 B 写码 deny，文案含接手指引与 create-chg', () => {});
test('SIB-PTU-4. foreign worktree 写码搭便车现状不回归（isCodeFile 仍放行 foreign CHG）', () => {});
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——
  - L648 `if (ownerStatus.disposition === 'foreign-fresh')` → `if (['foreign-fresh', 'sibling-fresh'].includes(ownerStatus.disposition))`，reason 首行按 sibling 改为「正由同目录另一 Claude Code session 负责」；
  - L673 `=== 'foreign-stale'` → `['foreign-stale', 'sibling-stale', 'sibling-detached'].includes(...)`，sibling-detached 文案用「原 session 已正常关闭」；
  - L1381 区改为单次计算 ownerStatus 复用 + sibling 过滤（spec §3.1 消费点 3 事实修正——isCodeFile 门显式排除 sibling，foreign 维持现状）：

```js
    const ownerStatusById = new Map(actionableEntries.map(e => [e.id, paceUtils.changeOwnerStatus(cwd, e.id, stdin.sessionId)]));
    const currentOwnedActionableEntries = actionableEntries.filter(e => {
      const ownerStatus = ownerStatusById.get(e.id);
      return ownerStatus.current && ownerStatus.disposition !== 'current-closed';
    });
    // CHG-A 收紧：写码门排除同目录其他 session 持有的 CHG（B 不搭 A 便车）；foreign worktree
    // 的既有搭便车行为不动（范围见 spec §3.1 消费点 3）。
    const nonSiblingActionableEntries = actionableEntries.filter(e => !String(ownerStatusById.get(e.id).disposition || '').startsWith('sibling-'));
    ...
    const gatedEntries = isCodeFile ? nonSiblingActionableEntries : currentOwnedActionableEntries;
```

  - L1431 `gatedEntries.length === 0` 分支：计算 `const siblingHeld = actionableEntries.length - nonSiblingActionableEntries.length;`，`siblingHeld > 0` 时 reason 末尾追加：

```js
`（另有 ${siblingHeld} 个活跃 CHG 由同目录其他 session 持有，不计入本 session：接手需用户确认并带 owner-takeover 字段；本 session 独立工作请先 create-chg。）`
```

- [ ] **Step 4: 跑绿**
- [ ] **Step 5: Commit** `feat(pre-tool-use): sibling 接手防护 + 写码门排除 sibling CHG（CHG-A T-005）`

### Task A6: post-tool-use 催办 skip + SessionStart 注入（显示/折叠）

**Files:**
- Modify: `plugin/hooks/post-tool-use.js`（L209）、`plugin/hooks/session-start/layers.js`（`isForeignSummary` L678-680、`appendForeignFoldNote` L697-700、活跃摘要行渲染 L756 旁加 detached 提示）
- Test: `tests/test-hooks-e2e.js` + `tests/test-session-layers.js`

- [ ] **Step 1: 失败测试**

```js
// e2e：SIB-POST-1. sibling-fresh 的 CHG 催办（verify-missing 等）跳过；sibling-stale 不跳过
// layers：SIB-LAY-1. sibling 三态进折叠集合（task.md 行被过滤 + 折叠注记）；
//         SIB-LAY-2. sibling-detached 摘要行含「原 session 已关闭，可接手」
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——
  - post-tool-use.js L209：`if (['foreign-fresh', 'sibling-fresh'].includes(ownerStatus.disposition)) continue;`
  - layers.js：

```js
function isForeignSummary(summary) {
  const d = String(summary.ownerDisposition || '');
  return d === 'foreign-fresh' || d === 'foreign-stale' || d.startsWith('sibling-');
}
```

  - `appendForeignFoldNote` 注记改为：「已折叠 N 个其他 worktree/session owner 的 CHG…同目录其他 session 正在执行的 CHG 请勿接手；接手必须有用户明确指令与证据。」
  - 活跃摘要行（L756 `ownerDisplay` 输出处）：`s.ownerDisposition === 'sibling-detached'` 时行尾追加 `（原 session 已关闭，可接手）`。
- [ ] **Step 4: 跑绿**（`node tests/test-session-layers.js` + e2e）
- [ ] **Step 5: Commit** `feat(injection): sibling 催办 skip + 注入折叠/detached 提示（CHG-A T-006）`

### Task A7: CHG-A 收口

- [ ] 全量验证：四套测试 + `claude plugin validate ./plugin` + `git diff --check`
- [ ] 记 finding：「foreign worktree 写码门搭便车（isCodeFile gatedEntries 不滤 foreign）」P3 record-finding（spec §3.1 范围裁定的后议项）
- [ ] R 审计（opus，逻辑/边界改动——路径追踪棱镜 + 独立探针）→ close-chg（implementation-notes 按 T-001~T-006 整理）

---

## Part 2（CHG-B）：/paceflow:pause（完全 per-session disable）

### Task B1: pause 标志机制（locks.js + constants）

**Files:**
- Modify: `plugin/hooks/pace-utils/constants.js`、`plugin/hooks/pace-utils/locks.js` + exports、`plugin/hooks/pace-utils.js` re-export
- Test: `tests/test-pace-utils.js`

- [ ] **Step 1: 失败单测**

```js
test('PAUSE-1. write/isSessionPaused/clearSessionPause 基本闭环 + sessionId 键控隔离', () => {});
test('PAUSE-2. mtime 超 SESSION_PAUSE_TTL_MS → isSessionPaused false 且懒清理 unlink', () => {});
test('PAUSE-3. sid 空 → 全部 no-op/false', () => {});
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——constants.js：

```js
// session 级 pause 标志 TTL：防 crash 残留永久免门；正常失效靠 /paceflow:resume 或 SessionEnd 删除。
const SESSION_PAUSE_TTL_MS = Math.max(60 * 1000, Number(process.env.PACE_SESSION_PAUSE_TTL_MS || 24 * 60 * 60 * 1000) || 24 * 60 * 60 * 1000);
```

locks.js（注意：标志文件名前缀 `paused-` **不得**加入 `SESSION_SCOPED_FLAG_PREFIXES`——W4 startup 清理会让任何新 session 清掉他人 pause，见 spec §3.3）：

```js
  // CHG-B：session 级 pause 标志（sessionId 键控）。SESSION_SCOPED_FLAGS 是项目级共享标志
  // 且被任何新 session 的 W3/W4 startup 清理，不可用于 per-session 状态——此处独立键控，
  // 失效路径：resume/SessionEnd 删除 + mtime TTL 懒清理（crash 兜底）。
  function sessionPausePath(cwd, sessionId) {
    const sid = ctx.normalizeSessionId(sessionId);
    return sid ? path.join(ctx.getProjectRuntimeDir(cwd), `paused-${sid}`) : '';
  }
  function writeSessionPause(cwd, sessionId) {
    const fp = sessionPausePath(cwd, sessionId);
    if (!fp) return false;
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, `${JSON.stringify({ sessionId: ctx.normalizeSessionId(sessionId), createdAt: new Date().toISOString(), timestampMs: Date.now() }, null, 2)}\n`, 'utf8');
      return true;
    } catch (e) { return false; }
  }
  function clearSessionPause(cwd, sessionId) {
    const fp = sessionPausePath(cwd, sessionId);
    if (!fp) return false;
    try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true; } } catch (e) {}
    return false;
  }
  function isSessionPaused(cwd, sessionId, now = Date.now()) {
    const fp = sessionPausePath(cwd, sessionId);
    if (!fp) return false;
    let st;
    try { st = fs.statSync(fp); } catch (e) { return false; }
    if (now - st.mtimeMs > ctx.SESSION_PAUSE_TTL_MS) {
      try { fs.unlinkSync(fp); } catch (e) {}
      return false;
    }
    return true;
  }
```

- [ ] **Step 4: 跑绿**；**Step 5: Commit** `feat(pause): sessionId 键控 pause 标志机制（CHG-B T-001）`

### Task B2: set-activation --pause/--resume + status 扩展

**Files:**
- Modify: `plugin/hooks/set-activation.js`（parseArgs L17-39、usage L41-52、doStatus L159-177、main L179-195）
- Test: `tests/test-hooks-e2e.js`（B1 helper 测试区风格）

- [ ] **Step 1: 失败 e2e**：`--pause` 写标志（env 注入 `CLAUDE_CODE_SESSION_ID`）/ env 空 fail exit 2 / `--resume` 删标志 / `--status` 显示 `session-paused: true`
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——parseArgs 加 `--pause`/`--resume` action；新增：

```js
function doPause(cwd) {
  const sid = paceUtils.currentSessionId();
  if (!sid) {
    fail(cwd, 'DENY_PAUSE_NO_SESSION', '无法识别当前 session（CLAUDE_CODE_SESSION_ID 为空）。请在 Claude Code session 内运行，或显式传 --session <id>。');
    return;
  }
  if (!paceUtils.writeSessionPause(cwd, sid)) { fail(cwd, 'DENY_PAUSE_WRITE_FAILED', '无法写入 pause 标志。'); return; }
  log(paceUtils.logEntry('SetActivation', 'PAUSE', { proj: paceUtils.getProjectName(cwd), sid }));
  process.stdout.write([
    'PACEflow 已在本 session 暂停（paused）。',
    '仅流程门（Stop / 写码门）跳过；artifact 仍只能经 artifact-writer 写入。',
    '本 session 结束自动失效；恢复运行 /paceflow:resume。',
  ].join('\n') + '\n');
}
```

（`doResume` 对称：`clearSessionPause` + 报告；`--session <id>` 参数解析对齐 `--cwd` 模式；`doStatus` 在 lines 中插入 `session-paused: ${paceUtils.isSessionPaused(cwd, paceUtils.currentSessionId())}`）

- [ ] **Step 4: 跑绿**；**Step 5: Commit** `feat(pause): set-activation --pause/--resume（CHG-B T-002）`

### Task B3: 免门接线（pre-tool-use / stop）+ SessionEnd 清理

**Files:**
- Modify: `plugin/hooks/pre-tool-use.js`（在 `DENY_DIRECT_ARTIFACT_EDIT`（L1369-1379）**之后**、currentOwned 计算（L1381）之前插入）、`plugin/hooks/stop.js`（PACE 信号判定后、warnings 收集循环前）、`plugin/hooks/session-end.js`（加 pause 清理）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败 e2e**

```js
test('PAUSE-E2E-1. paused session：写码不被 PACE 门拦（无活跃 CHG 也放行）', () => {});
test('PAUSE-E2E-2. paused session：Stop 不拦未完成 CHG，输出一条 paused 提醒', () => {});
test('PAUSE-E2E-3. paused 不免 artifact 完整性门：主 session 直接 Edit task.md 仍 deny', () => {});
test('PAUSE-E2E-4. 隔离：A paused 不影响 B（B 照常被门拦）', () => {});
test('PAUSE-E2E-5. SessionEnd 清除本 session pause 标志', () => {});
test('PAUSE-E2E-6. 新 session startup（session-start.js）不清他人 pause 标志', () => {});
```

- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——pre-tool-use.js 插入（位置约束：artifact 完整性门之后，流程门之前）：

```js
    // CHG-B：session 级 pause——免流程门（写码/索引/批准门），不免上方 artifact 完整性门。
    if (paceUtils.isSessionPaused(cwd, stdin.sessionId)) {
      log(projectLogEntry('PreToolUse', 'SKIP_SESSION_PAUSED', { proj, tool: toolName, dur: Date.now() - t0 }));
      return;
    }
```

stop.js（对应位置，输出走既有 reminder 通道）：

```js
  // CHG-B：paused session 跳过全部 Stop gate，仅留一条人可见提醒。
  if (paceUtils.isSessionPaused(cwd, stdin.sessionId)) {
    log(projectLogEntry('Stop', 'SKIP_SESSION_PAUSED', { proj }));
    emitAllowedStopReminders({ deferredReminders: ['本 session 已 pause PACEflow（流程门跳过中）；恢复运行 /paceflow:resume。'], backgroundReminders: [], backgroundTasks: [], t0 });
    process.exit(0);
  }
```

session-end.js 在 detach 行后加：

```js
    const pauseCleared = paceUtils.clearSessionPause(cwd, stdin.sessionId);
```

（并入既有 log 字段 `pause_cleared`）

- [ ] **Step 4: 跑绿**；**Step 5: Commit** `feat(pause): 免流程门接线 + SessionEnd 自动失效（CHG-B T-003）`

### Task B4: 命令面（pause.md / resume.md）+ CHG-B 收口

**Files:**
- Create: `plugin/commands/pause.md`、`plugin/commands/resume.md`（结构仿 disable.md：调 helper + 转述 stdout + 防滥用约束段）
- Modify: `plugin/.claude-plugin/plugin.json`（commands 数组加两文件）、`plugin/commands/status.md`（提及 paused 状态）、`plugin/skills/pace-workflow/SKILL.md`（disable 防滥用段旁补 pause 一句）
- Test: `tests/test-hooks-e2e.js`（仿 B2 断言：manifest 含两命令、文件调对应子命令、含防滥用约束）

- [ ] **Step 1: 失败 e2e**（B2 风格断言）
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**——pause.md 核心约束段（对称 disable.md §5.1 不变量 2，更严）：

```markdown
- **pause 是用户的 session 级退出权，不是 AI 绕过门控的手段**：本 command 由用户主动运行。
  你（AI）被 PACE deny 拦住时，不得为绕过单次 deny 自行运行 set-activation --pause——正确做法
  是走 PACE 流程（建 CHG / approve-and-start / 接手确认）。只有用户明确表达「本 session 不想要
  PACEflow 约束」时才暂停；拿不准时先 AskUserQuestion 确认。
- pause 只免流程门：artifact 仍必须经 artifact-writer 写入；本 session 结束自动失效。
```

- [ ] **Step 4: 跑绿** + `claude plugin validate ./plugin`
- [ ] **Step 5: CHG-B 收口**：全量四套 + R 审计（opus）→ close-chg（implementation-notes T-001~T-004）

---

## Part 3（CHG-C）：deny 文案双出口整合

### Task C1: PACE_ESCAPE_HATCH 双出口 + 发布面扫描

**Files:**
- Modify: `plugin/hooks/pre-tool-use.js`（`PACE_ESCAPE_HATCH` 常量与 `withEscapeHatch` 幂等守卫）、Task A5 的 L1431 三出口文案补 `/paceflow:pause`
- Test: `tests/test-hooks-e2e.js`（既有逃生口 e2e 更新 + B2 风格旧形态扫描确认无 `/paceflow pause` 空格形态）

- [ ] **Step 1: 失败 e2e**：deny 文案含双出口（disable + pause）且重复包裹不叠加；A5 的 sibling deny 文案含 pause 出口
- [ ] **Step 2: 跑红**
- [ ] **Step 3: 实现**：

```js
const PACE_ESCAPE_HATCH = '若你（用户）不需要 PACEflow 管理本项目，可运行 /paceflow:disable 停用；仅本 session 临时停用可运行 /paceflow:pause。';
```

（幂等守卫从「reason 已含 /paceflow:disable」改为「已含 PACE_ESCAPE_HATCH 全文或 /paceflow:pause」防半截重复；L1431 sibling 提示句末补「仅想临时摆脱本 session 约束可由用户运行 /paceflow:pause。」）

- [ ] **Step 4: 跑绿** + 全量四套 + validate
- [ ] **Step 5: CHG-C 收口**：R 审计（manual 可，文案改动 + 扫描断言护航）→ close-chg → **bump 6.7.0 + push + rev-parse 双向确认**（SessionEnd hook + 两命令是功能面扩展）

---

## 部署与验证注意（全程）

- **本仓库 dogfood 限制**：hooks.json/SessionEnd/命令文件改动在 cache reload 前不生效——开发期全靠 e2e（runHook 直跑仓库源码）；push + `/reload-plugins` 后补一轮实测（detached 流、/paceflow:pause 实际命令、双出口文案）。
- **close-chg 必带 implementation-notes**（v6.6.2 机制，cache 生效前人肉带字段）。
- 每个 Part 收口后跑全量基线：`node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-session-layers.js && node tests/test-agent-tests-helpers.js && claude plugin validate ./plugin && git diff --check`。
