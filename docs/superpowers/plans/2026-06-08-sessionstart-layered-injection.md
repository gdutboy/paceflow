# SessionStart 分层注入重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **本计划走 PACEflow CHG 流程**：5 个阶段对应 batch create 的 5 个 CHG（CHG-A~E，一个 change-set）。每个 CHG 完成后 close-chg + git commit。
> **权威设计**：`docs/superpowers/specs/2026-06-08-sessionstart-layered-injection-design.md`
> **写盘 golden reference**：`docs/audits/2026-06-08-session-start-runtime-writes-reference.md`（CHG-A 回归基准）

**Goal:** 把 `session-start.js` 从「22 section 顺序=历史」的 831 行单文件，重构为「三段式编排 + L0–L3 分层注入 + 去噪精选高安全阀」，让新 session / compact 后精准恢复上下文。

**Architecture:** 三段式——(1) `collectState` 把项目状态读成纯数据；(2) `buildLayers` 纯函数渲染 L0–L3；(3) `assembleWithBudget` 按 128KB 阀 + L3 优先截断装配。运行态副作用（12 写盘点）抽成单一 `applyRuntimeEffects`，`PRINT_ONLY` 一处短路。compact 快照机制退役，compact 走与 startup 相同的实时读 + L2 工作流入口。

**Tech Stack:** Node.js（CommonJS），PACEflow hooks（`plugin/hooks/`），测试用 `tests/test-hooks-e2e.js` 风格（node 脚本 + 自定义 assert）。

---

## File Structure（CHG-A 锁定，后续 CHG 依赖这些接口）

**新增**（`plugin/hooks/session-start/` 子目录）：
- `collect-state.js` — `collectState(cwd, eventType, paceSignal, artDir) → state`。纯读取（无写盘），把所有注入所需项目状态读成一个 plain object：`{ projectContext, spec, task, impl, walkthrough, findings, corrections, activeChanges, changeSetGroups, git, relatedNotes, plans, foreign, blocked, … }`。
- `layers.js` — `buildLayers(state, eventType) → { l0, l1, l2, l3 }`。纯函数，输入 state 输出四层文本块（每块是字符串数组）。无 I/O、无 `process`、无 `Date.now`。
- `budget.js` — `assembleWithBudget(layers, { limitBytes }) → { text, truncated }`。L0/L1/L2 全注入，L3 用剩余预算、超出从尾部按条截断并附「已省略 N，Read X」。
- `runtime-effects.js` — `applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, deps)`。集中现 12 写盘点（W1–W12，见 reference §2）。`session-start.js` 在 `PRINT_ONLY` 时整段跳过此调用（一处短路）。

**修改**：
- `session-start.js` — 瘦身为编排：解析输入 → `if (!PRINT_ONLY) applyRuntimeEffects(...)` → `collectState` → `buildLayers` → `assembleWithBudget` → 输出 + log。目标 < 180 行。
- `pace-utils/plans.js` — `planSearchRoot` 扩展为多根（CHG-E）。
- `pace-utils/constants.js` — 新增 `SESSION_OUTPUT_BUDGET_BYTES` 改 128000；保留旧名兼容。
- `pre-compact.js` — 快照写入退役（CHG-C，OQ-1）。

**测试**：
- `tests/test-session-layers.js`（新）— 注入层纯函数单测（喂 fixture state 断言 L0–L3 输出/顺序/截断）。
- `tests/test-hooks-e2e.js`（扩）— 端到端：startup/compact 对称、reference 回归、plan 提醒。

---

## CHG-A：注入层解耦（三段式 + 副作用集中 + 纯函数化，行为等价）

**目标**：纯结构重构，**注入输出与写盘行为完全等价**，用 reference + e2e 回归证明。不改任何注入内容/顺序。

**Files:**
- Create: `plugin/hooks/session-start/collect-state.js`, `layers.js`, `budget.js`, `runtime-effects.js`
- Create: `tests/test-session-layers.js`
- Modify: `plugin/hooks/session-start.js`（重构为编排）

- [ ] **Step 1: 快照当前注入输出做黄金基准**

先在重构前抓两个模式的完整注入，存为回归基准：
```bash
cd /mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks
node print-session-context.js --cwd /mnt/k/AI/paceflow-hooks/paceflow > /tmp/golden-startup.txt 2>&1
node print-session-context.js --compact --cwd /mnt/k/AI/paceflow-hooks/paceflow > /tmp/golden-compact.txt 2>&1
wc -l /tmp/golden-startup.txt /tmp/golden-compact.txt
```
Expected: 两文件非空（startup ~15KB、compact ~14KB）。**这是 CHG-A 的等价性基准**。

- [ ] **Step 2: 写 collect-state.js（纯读取层）**

把 `session-start.js` 中所有「读项目状态」逻辑搬进 `collectState`，返回 plain object。不含任何 `process.stdout.write`、不含写盘。逐段对照现 `session-start.js`：项目上下文（104-120）、artifact 文件读取+截断（404-593 的 readFull/ARCHIVE 切分/各文件裁剪）、活跃 CHG（412-414 summarizeActiveChanges）、change-set（605-629）、git（790-799）、相关讨论（802-813 scanRelatedNotes）、findings 过期（758-787 的判定，不含写 flag）、foreign/blocked（712-744）。

关键签名：
```js
// collect-state.js
function collectState(cwd, eventType, paceSignal, artDir) {
  return {
    eventType, paceSignal,
    projectContext: { cwd, projectRoot, runtimeRoot, mode },
    artifacts: { spec, task, impl, walkthrough, findings, corrections }, // 已 ARCHIVE 切分+裁剪的注入文本
    activeChanges, changeSetGroups,
    executionContext, // detailPending/hasCompleted/hasIndexPending 分类结果
    git: { branch, lastCommit },
    relatedNotes,     // scanRelatedNotes 结果
    agedFindings,     // 过期 finding（判定结果，写 flag 留给 effects）
    foreign, blocked,
    formatReference: FORMAT_SNIPPETS, // L2 用
  };
}
module.exports = { collectState };
```

- [ ] **Step 3: 写 layers.js（注入纯函数），逐字复刻当前各 section 文本**

`buildLayers(state, eventType)` 输出 `{ l0, l1, l2, l3 }`，每个是 string[]。**本 CHG 内顺序/内容与当前完全一致**（等价重构），只是按层归类。即：先按现状把 22 section 的文本生成逻辑搬进来，归到对应层，但拼接顺序仍复刻 golden 基准。
```js
// layers.js
function buildLayers(state, eventType) {
  const l0 = [], l1 = [], l2 = [], l3 = [];
  // L1: 项目上下文（复刻 writeProjectContextSection 文本）
  // L2: 工作流入口（复刻 writeWorkflowEntrySection；本 CHG 仍按现状仅非 compact）
  // L0: 活跃 CHG 摘要 / change-set / 执行上下文（复刻现文本）
  // ... 逐段复刻，文本逐字一致
  return { l0, l1, l2, l3 };
}
module.exports = { buildLayers };
```
> 注意：CHG-A 不调整顺序/对称，只搬运。顺序调整、对称、内容增强留 CHG-B/C/D。

- [ ] **Step 4: 写 budget.js（先做等价装配）**

CHG-A 阶段 `assembleWithBudget` 先复刻当前行为（全局 46000 阀 + 顺序拼接），保证等价：
```js
function assembleWithBudget(layers, { limitBytes }) {
  const all = [...layers.l1head, ...layers.l0, ...layers.l1, ...layers.l2, ...layers.l3];
  // CHG-A: 复刻当前「顺序拼接 + 超 limit 截断 + footer」行为
  // CHG-B 再改为 L3 优先截断 + 128KB
  return assembleLegacy(all, limitBytes);
}
```

- [ ] **Step 5: 写 runtime-effects.js（集中 12 写盘点）**

把 W1–W12（reference §2）搬进 `applyRuntimeEffects`，逐条保持触发条件/目标/语义。删除 `session-start.js` 里 7 处散落 `!PRINT_ONLY` 守卫——改为 `session-start.js` 在调用处一次性 `if (!PRINT_ONLY) applyRuntimeEffects(...)`。
```js
function applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, deps) {
  // W1-W6: startup 重置块（eventType !== 'compact' && paceSignal && !rootChoicePending）
  // W7-W9: compact 快照消费（本 CHG 保留，CHG-C 退役）
  // W10: ensureProjectInfra; W11: createTemplates; W12: findings-age flag
}
```

- [ ] **Step 6: 重构 session-start.js 为编排**

```js
const PRINT_ONLY = !!process.env.PACE_PRINT_ONLY;
// ... 解析 eventType/paceSignal/artDir/rootChoicePending ...
if (!PRINT_ONLY) applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, deps);
const state = collectState(cwd, eventType, paceSignal, artDir);
const layers = buildLayers(state, eventType);
const { text, truncated } = assembleWithBudget(layers, { limitBytes: SESSION_OUTPUT_BUDGET_BYTES });
process.stdout.write(text);
log(... output_bytes, truncated ...);
```
保留顶层 try/catch（H-3 静默放行）+ installSessionOutputGuard（全局字节守卫仍在，作第二道防线）。

- [ ] **Step 7: 等价性回归——注入输出 byte-for-byte 一致**

```bash
cd /mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks
node print-session-context.js --cwd /mnt/k/AI/paceflow-hooks/paceflow > /tmp/after-startup.txt 2>&1
node print-session-context.js --compact --cwd /mnt/k/AI/paceflow-hooks/paceflow > /tmp/after-compact.txt 2>&1
diff /tmp/golden-startup.txt /tmp/after-startup.txt && echo "STARTUP 等价 ✓"
diff /tmp/golden-compact.txt /tmp/after-compact.txt && echo "COMPACT 等价 ✓"
```
Expected: 两个 diff 均空（完全等价）。**有差异即 CHG-A 失败，必须消除**。

- [ ] **Step 8: 写盘 reference 逐条回归**

按 reference §5 验证清单逐条勾验：用真实 SessionStart（非 PRINT_ONLY）跑一次，确认 W1–W12 仍按各自触发条件写/删对应 `.pace` 文件、`stop-block-count` 语义不变。
```bash
node tests/test-hooks-e2e.js   # 现有 e2e 全绿（含 W2/W8 counter、W3-W6 flag 清理等覆盖）
```
Expected: 现有 e2e 全部通过（写盘行为等价）。

- [ ] **Step 9: 注入层纯函数单测骨架**

`tests/test-session-layers.js`：喂一个 fixture state，断言 `buildLayers` 输出结构。CHG-A 只验「纯函数可调用 + 不触 I/O」：
```js
const { buildLayers } = require('../plugin/hooks/session-start/layers');
const fixture = require('./fixtures/session-state-active.json'); // 一个活跃 CHG 的 state
const { l0, l1, l2, l3 } = buildLayers(fixture, 'startup');
assert(Array.isArray(l0) && l0.join('\n').includes('活跃 CHG'), 'L0 含活跃 CHG');
assert(l2.join('\n').includes('pace-workflow'), 'L2 含 skill 入口');
```

- [ ] **Step 10: 全套验证 + commit**

```bash
node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-session-layers.js
node tests/test-agent-tests-helpers.js && claude plugin validate ./plugin && git diff --check
git add -A && git commit -m "refactor(session-start): CHG-A 注入层三段式解耦（collect-state/layers/budget/runtime-effects），输出 byte 等价"
```
Expected: 全绿 + diff 等价。

---

## CHG-B：四层模型骨架 + 预算策略（128KB 阀 + L3 优先截断 + 排序）

**目标**：在 CHG-A 的纯函数基础上，把「等价拼接」改成「分层优先级 + 去噪精选 + 128KB 高阀 + L3 先砍」。

**Files:**
- Modify: `plugin/hooks/session-start/budget.js`, `layers.js`
- Modify: `plugin/hooks/pace-utils/constants.js`（`SESSION_OUTPUT_BUDGET_BYTES` 46000→128000）
- Modify: `tests/test-session-layers.js`

- [ ] **Step 1: 失败测试——L3 优先截断 + L0/L1/L2 永不截**

```js
// test-session-layers.js
const big = 'x'.repeat(200000); // 撑爆预算的超大 L3
const layers = { l0: ['L0关键'], l1: ['L1'], l2: ['L2'], l3: ['findings', big] };
const { text } = assembleWithBudget(layers, { limitBytes: 128000 });
assert(text.includes('L0关键') && text.includes('L1') && text.includes('L2'), 'L0/L1/L2 永不截');
assert(text.includes('已省略') && !text.includes(big), 'L3 超预算从尾部截 + footer');
```
Run: `node tests/test-session-layers.js` → Expected: FAIL（当前 assembleLegacy 顺序截会先砍 L0/L1/L2 或不分层）。

- [ ] **Step 2: 实现 L3 优先截断装配**

```js
function assembleWithBudget(layers, { limitBytes }) {
  const head = [...layers.l0, ...layers.l1, ...layers.l2];   // 永不截
  const headText = head.join('\n');
  const headBytes = Buffer.byteLength(headText, 'utf8');
  const remain = Math.max(0, limitBytes - headBytes);
  // L3 是 [{block, label}] 条目数组；逐条累加到 remain，超出停并附 footer
  const { kept, omitted } = packL3(layers.l3, remain);
  const tail = omitted > 0
    ? kept.join('\n') + `\n（已省略 ${omitted} 条相关项，按需 Read 对应文件）\n`
    : kept.join('\n');
  return { text: headText + '\n' + tail, truncated: omitted > 0 };
}
```
Run: `node tests/test-session-layers.js` → Expected: PASS。

- [ ] **Step 3: constants 阀值 + 排序**

`constants.js`：`SESSION_OUTPUT_BUDGET_BYTES = Math.max(46000, Number(process.env.PACE_SESSION_OUTPUT_BUDGET_BYTES) || 128000)`。`layers.js` 的 L0 活跃 CHG 摘要改 running 优先排序（B5）：
```js
// layers.js — L0 活跃 CHG 排序
const ordered = [...state.activeChanges].sort((a,b) =>
  (rank(a.category) - rank(b.category))); // running=0 优先，其余按原序
// rank: running→0, closing-required→1, 其它→2
```

- [ ] **Step 4: 去噪断言 + 验证 + commit**

加测试：归档 CHG / 已解决 finding 不进 L0/L3（state 层已过滤，断言 buildLayers 不含）。
```bash
node tests/test-session-layers.js && node tests/test-hooks-e2e.js
git add -A && git commit -m "feat(session-start): CHG-B 四层预算策略——128KB 阀 + L3 优先截断 + L0 running 优先排序"
```

---

## CHG-C：L0/L1/L2 内容（A0 compact 对称 + git 增强 + walkthrough 10 不截 + 删死代码 + helper 去重 + 快照退役）

**Files:**
- Modify: `plugin/hooks/session-start/layers.js`, `collect-state.js`, `runtime-effects.js`
- Modify: `plugin/hooks/pre-compact.js`（快照写入退役）
- Modify: `tests/test-hooks-e2e.js`, `tests/test-session-layers.js`

- [ ] **Step 1: 失败测试——compact 也注入 L2 工作流入口（A0）**

```js
// test-hooks-e2e.js 新增 case
const out = runSessionStart({ type: 'compact', cwd: V6_PROJECT });
assert(/先调用 Skill\(paceflow:pace-workflow\)/.test(out), 'A0: compact 注入 skill 入口引导');
assert(/不要传 --artifact-dir/.test(out), 'A0: compact 注入 reserve helper 约束');
```
Run: `node tests/test-hooks-e2e.js` → Expected: FAIL（当前 compact 无工作流入口）。

- [ ] **Step 2: 实现 A0——L2 两模式都注入**

`layers.js` 的 L2 不再按 eventType 区分：工作流入口（skill 引导 + reserve 约束）+ 格式速查 + CHG 完成检查，startup/compact 都注入。helper 路径集中到 L2 一处（A4，删 L1/artifact 目录段的重复 helper）。
Run: `node tests/test-hooks-e2e.js` → Expected: PASS。

- [ ] **Step 3: 失败测试 + 实现——git 增强（A2）**

```js
assert(/未提交改动|工作区干净/.test(out), 'A2: git 含脏文件状态');
```
`collect-state.js` git 段加：`git status --porcelain`（计数脏文件）+ `git rev-list --count --left-right @{u}...HEAD`（ahead/behind，无 upstream 静默跳过），`timeout: 5000`、`stdio ignore stderr`。

- [ ] **Step 4: walkthrough 10 条不截 + 删死代码**

`collect-state.js` walkthrough 处理：保留索引表最近 10 行（现 462-480 逻辑），**删除详情段落处理（现 481-502，v6 死代码）**。单条不截（不再对摘要做长度截断）。
```js
assert(!/已省略 \d+ 条旧详情/.test(out), '删除 walkthrough 详情段落处理');
```

- [ ] **Step 5: compact 快照退役（OQ-1）**

`runtime-effects.js`：删除 W7/W8/W9（快照消费/counter 恢复/快照删除）。`pre-compact.js`：停止写 `pre-compact-state.json`（保留 hook 但不写快照，或整段移除快照逻辑）。compact 的 L0 走 `collectState` 实时读（与 startup 同源）。
```js
// 验证：compact 不再依赖快照，实时读活跃 CHG
const out = runSessionStart({ type: 'compact', cwd: V6_WITH_ACTIVE_CHG });
assert(/活跃 CHG/.test(out) && !/Compact 恢复（快照/.test(out), '快照退役，compact 实时读');
```
**前置确认测试**：加一个 case 证明 PreCompact→SessionStart:compact 间 artifact/.pace 不变（OQ-1 前提）。

- [ ] **Step 6: 验证 + commit**

```bash
node tests/test-hooks-e2e.js && node tests/test-session-layers.js && node tests/test-pace-utils.js
git add -A && git commit -m "feat(session-start): CHG-C L0/L1/L2——A0 compact 对称 + git 增强 + walkthrough 10不截 + 删死代码 + 快照退役"
```

---

## CHG-D：L3 内容（A1 相关讨论全修 + WIKI-1 wiki 注入 vault-gated）

**Files:**
- Modify: `plugin/hooks/pace-utils.js`（`scanRelatedNotes`）
- Modify: `plugin/hooks/session-start/layers.js`（L3 相关讨论渲染）
- Modify: `tests/test-pace-utils.js`

- [ ] **Step 1: 失败测试——多行 YAML projects 匹配 + 排序（A1 缺口 C/1）**

```js
// test-pace-utils.js，用 fixture vault
const notes = scanRelatedNotes('paceflow-hooks');
assert(notes.some(n => n.title === 'claude-code-2.1.75plus-paceflow-improvements'), 'A1-C: 多行 YAML projects 匹配');
assert(notes[0].updated >= notes[1].updated, 'A1-1: updated 降序排序');
```
Run → Expected: FAIL。

- [ ] **Step 2: 实现 scanRelatedNotes 修复（A1 五缺口）**

```js
function scanRelatedNotes(projectName) {
  if (!VAULT_PATH) return [];
  const results = [];
  for (const dir of ['thoughts', 'knowledge']) {
    // ... 现有读取 ...
    // 缺口C: projects 兼容 inline [a,b] + 多行 YAML 列表
    const projects = parseProjectsField(fm); // 新 helper：先试 /^projects:\s*\[([^\]]*)\]/，再试多行 /^projects:\s*\n((?:\s*-\s*.+\n?)+)/
    if (!projects.map(p=>p.toLowerCase()).includes(projectName.toLowerCase())) continue;
    const updated = (fm.match(/^updated:\s*(.+)/m)||[])[1] || (fm.match(/^created:\s*(.+)/m)||[])[1] || '';
    results.push({ title, summary, status, dir, updated: updated.trim().slice(0,10) }); // 缺口3: 带 dir
  }
  // 缺口1: updated 降序
  return results.sort((a,b) => (b.updated||'').localeCompare(a.updated||''));
}
```
Run → Expected: PASS。

- [ ] **Step 3: L3 渲染——去 limit + wikilink 定位 + section 说明（A1 缺口 2/3/4）**

`layers.js` L3 相关讨论：去掉 `slice(0, maxNotes)`（全量，靠 budget 截）；每条 `[${status}] [[${title}]] — "${summary}"`（wikilink 定位）；section 头加说明行「关联本项目、按最近更新排序，点 wikilink 或在 vault 对应目录查看」。

- [ ] **Step 4: WIKI-1——wiki article 优先注入（vault-gated）**

`scanRelatedNotes` 扩展或新增 `scanWikiArticles(projectName)`：扫 `VAULT_PATH/wiki/<topic>/*.md`，按 article 的 `sources`/`tags` 或 source 页 `artifact`/`change_id` 匹配项目名。L3 渲染：wiki article 优先 + 未被 wiki 覆盖的 raw 笔记补充。**降级**：`if (!VAULT_PATH || !fs.existsSync(wikiDir)) → 跳过 wiki，fallback raw`。
```js
const out = runSessionStart({ cwd: V6_NO_VAULT });
assert(!/相关讨论/.test(out), 'WIKI-1 降级: 无 vault 整段不出现');
```

- [ ] **Step 5: 验证 + commit**

```bash
node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-session-layers.js
git add -A && git commit -m "feat(session-start): CHG-D L3——A1 相关讨论全修 + WIKI-1 wiki article 注入 vault-gated 降级"
```

---

## CHG-E：plan 桥接修复（plans.js 扫描加 cwd 方案 C + L0 未桥接 plan 提醒解除门控）

**Files:**
- Modify: `plugin/hooks/pace-utils/plans.js`
- Modify: `plugin/hooks/session-start/layers.js`, `collect-state.js`
- Modify: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败测试——cwd 下的 plan 被扫到（方案 C）**

```js
// fixture: projectRoot=父, cwd=子, plan 在 子/docs/superpowers/plans/
const plans = listBridgeCandidatePlanFiles(CWD_CHILD);
assert(plans.some(p => p.name.includes('batch-create-chg')), '方案C: cwd plan 被扫到');
```
Run → Expected: FAIL（当前只扫 projectRoot）。

- [ ] **Step 2: 实现 planSearchRoot 多根 + plan 带 root**

```js
// plans.js
function planSearchRoots(cwd) {
  const projectRoot = ctx.getProjectStateDir ? ctx.getProjectStateDir(cwd) : cwd;
  const roots = [cwd]; // cwd 优先
  if (normalizePath(projectRoot) !== normalizePath(cwd)) roots.push(projectRoot);
  return roots;
}
function listPlanFiles(cwd) {
  const seen = new Set(), results = [];
  for (const root of planSearchRoots(cwd)) {        // cwd 优先去重
    for (const rel of PLAN_DIRS) {
      // ... readdir(path.join(root, rel)) ...
      if (matches && !seen.has(f)) { seen.add(f); results.push({ name: f, dir: rel, root }); } // 带 root
    }
  }
  return results.sort((a,b) => b.name.localeCompare(a.name));
}
// isFresh 用 p.root: statSync(path.join(p.root, p.dir, p.name))
```
Run → Expected: PASS。

- [ ] **Step 3: 失败测试 + 实现——L0 未桥接 plan 提醒解除门控**

```js
const out = runSessionStart({ cwd: CWD_WITH_UNSYNCED_PLAN_AND_ACTIVE_CHG });
assert(/未桥接 plan|可 Skill\(paceflow:pace-bridge\)/.test(out), 'L0 提醒解除 !hasActive 门控');
```
`collect-state.js` 收 `plans: listBridgeCandidatePlanFiles(cwd)`；`layers.js` L0 加未桥接 plan 提醒（精简一行 + fresh 过滤），**不再受 `!hasActive` 门控**（删现 `session-start.js:698` 的 hasActive 条件）。

- [ ] **Step 4: 验证 + commit**

```bash
node tests/test-pace-utils.js && node tests/test-hooks-e2e.js
# 实跑确认本仓 cwd plan 被扫到（真实环境验证）
node -e "const p=require('./plugin/hooks/pace-utils'); console.log(p.listBridgeCandidatePlanFiles('/mnt/k/AI/paceflow-hooks/paceflow').map(x=>x.name))"
git add -A && git commit -m "fix(plans): CHG-E plan 桥接修复——扫描加 cwd 方案C + L0 未桥接提醒解除门控"
```
Expected: 实跑输出含 `2026-06-06-review-gate.md`、`2026-06-07-batch-create-chg.md`、`2026-06-08-sessionstart-layered-injection.md`（本计划）。

---

## Self-Review

**1. Spec coverage**（design doc §5 缺口逐条 → task）：
- A0 → CHG-C Step 1-2 ✓ | A1 → CHG-D Step 1-3 ✓ | A2 → CHG-C Step 3 ✓ | A3（L3 先截）→ CHG-B Step 1-2 ✓ | A4（helper 去重）→ CHG-C Step 2 ✓ | B5（running 优先）→ CHG-B Step 3 ✓ | PLAN-1 → CHG-E ✓ | WIKI-1 → CHG-D Step 4 ✓ | 死代码删除 → CHG-C Step 4 ✓ | OQ-1 快照废弃 → CHG-C Step 5 ✓ | OQ-2 方案C → CHG-E Step 2 ✓ | 三段式解耦 → CHG-A ✓ | 128KB 阀 → CHG-B Step 3 ✓
- C 类边角（G2/G7/G8/G11/G12）：G11 由快照退役（CHG-C Step 5）消除；G7/G8 在 CHG-A collect-state 重构时顺带（artifact 目录位置统一、impl 不重复读）；G2/G12 记 backlog finding（不在本计划，CHG 关闭时 record-finding）。

**2. Placeholder scan**：各 Step 含具体代码/命令/断言，无 TBD/TODO。CHG-A Step 2/3 的「逐段对照现 session-start.js 行号」是引用既有实现（已有代码库重构的合理形态，非占位）。

**3. Type consistency**：`collectState → state` 对象贯穿 `buildLayers(state)`；`buildLayers → {l0,l1,l2,l3}` 贯穿 `assembleWithBudget(layers)`；plan 对象 `{name, dir, root}`（CHG-E）在 isFresh 一致使用。`SESSION_OUTPUT_BUDGET_BYTES` 单一来源（constants）。

**Gap 修复**：CHG-A 的 `assembleWithBudget` 用 `assembleLegacy`（等价），CHG-B 替换为 L3 优先——签名不变（`(layers, {limitBytes})`），仅内部实现演进，无类型冲突。
