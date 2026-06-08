# SessionStart 多 hook 拆分注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SessionStart 单 hook 注入（13433 chars，超 Claude Code per-hook 10K cap 被 persist）拆成 2 个 hook（core + artifact）各 <10K chars，各自独立注入、零 persist、零内容损失。

**Architecture:** 复用 CHG-A 三段式（collectState/buildLayers/assembleWithBudget），加一个 `group` 维度——`session-start.js --group core|artifact` 路由：core 装有界骨架（工作流入口/L0/项目上下文/git/相关讨论），artifact 装增长块（findings/corrections/walkthrough/spec，带截断）。副作用 W1-W11 归 core、W12 归 artifact、artifact 幂等自保 W10/W11。

**Tech Stack:** Node.js CommonJS（plugin/hooks），自定义 test runner（tests/test-utils.js），node:assert。验证：`node tests/test-session-layers.js`、`node tests/test-hooks-e2e.js`、`node tests/test-pace-utils.js`。

> **⚠️ 发布单元约束（CHG-09 R 审计发现）**：内容归 artifact group（M1-M2）与 hooks.json 双 hook 注册（M4/T-008）在不同里程碑，但 artifact 内容（文件块/格式警告）在单 hook（默认 core）下会静默丢失。plugin cache 从 git remote 拉取——**整个重构（M1-M5）必须作为一个发布单元**：T-008 双 hook 注册 + 实测各 hook <10K chars 后才 push，中间里程碑不发布中间态。
>
> **⚠️ M3 截断设计校正（CHG-09 R 审计发现 1）**：artifact 文件块在 l1head，而 assembleWithBudget 的 head 永不截——9500 budget 对 artifact group **完全失效**（实测 12000 chars spec 不被截）。M3 的 per-file 类内截断是 artifact <10K 的**唯一保证**，不能依赖全局 budget 兜底；务必确保所有 artifact 文件截断后总和 <9500。
>
> **⚠️ M4 W12 归属（CHG-09 R 审计发现 B2）**：M4 把 W12 flag 写移 artifact 时，必须同步把 agedFindings 渲染（layers.js section 14）+ 读取（collect-state.js）一起移 artifact——flag 写/数据读/渲染三者必须同 group，否则跨 group 时序割裂致过期提醒永不注入。

---

## 背景与复用

- **per-hook 10K cap 实测**：见 `changes/findings/finding-2026-06-08-session-start-per-hook-10k-cap-context-broken.md`。
- **设计**：`docs/superpowers/specs/2026-06-08-sessionstart-multihook-injection-design.md`（本 plan 实现其 M1-M5 主线）。
- **工作树未 commit 的旧 CHG-05 代码可复用**（先不动，相关 task 内调整）：
  - `budget.js`：`assembleWithBudget(layers,{limitBytes})` + `packL3(items,remainBytes)` —— L3 优先截断（bytes）。**Task 1 改 chars**。
  - `layers.js`：`rankChangeCategory`(31)、`changeSetSeqNum`(38)、buildLayers 开头 activeChangeSummaries 排序(67)、`renderChangeSetProgress` seq 排序(511) —— running 优先 + 倒序对称。**Task 4 归入 core group，逻辑保留**。
- **golden reference**：`docs/audits/2026-06-08-session-start-runtime-writes-reference.md`（12 写盘点 W1-W12）。

## File Structure

| 文件 | 职责 | 改动 |
|---|---|---|
| `plugin/hooks/session-start.js` | 编排 + group 路由 | 加 `--group` 解析；`applyRuntimeEffects` 只 core；传 group 给 collectState/buildLayers；`limitChars` |
| `plugin/hooks/session-start/budget.js` | 预算装配 | `limitBytes` → `limitChars`，`Buffer.byteLength` → `.length` |
| `plugin/hooks/session-start/collect-state.js` | 纯读取 | `collectState(...,extra)` 读 `extra.group`，按 group 跳过不需要的读取；W12 flag 存在性快照只 artifact 用 |
| `plugin/hooks/session-start/layers.js` | 纯渲染 | `buildLayers(state,ev,paceUtils,group)`，按 group 填层；artifact 增长块截断 |
| `plugin/hooks/session-start/runtime-effects.js` | 副作用 | W12 移出（归 artifact）；`applyRuntimeEffects` 加 `group` 参数，artifact 只跑幂等 W10/W11 |
| `plugin/hooks/hooks.json` | hook 注册 | SessionStart 一个 matcher 块 2 command（core/artifact）|
| `plugin/hooks/pace-utils/*.js`（`scanRelatedNotes` 所在）| 相关讨论扫描 | 扩展 wiki article（vault-gated）|
| `tests/test-session-layers.js` | 纯函数单测 | group 渲染 + 截断 + <9500 chars 满载断言 |
| `tests/test-hooks-e2e.js` | e2e | 多 hook 副作用归属 + 各 group 注入 |

**锁定接口**（后续 task 一致使用）：
- `const GROUP_CORE='core', GROUP_ARTIFACT='artifact';`
- `assembleWithBudget(layers, { limitChars }) → { text, truncated }`
- `collectState(cwd, eventType, paceSignal, artDir, paceUtils, { ..., group }) → state`
- `buildLayers(state, eventType, paceUtils, group) → { l1head, l0, l1, l2, l3 }`（只填该 group 的层，其余为空数组）
- `applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, { ..., group })`
- `SESSION_OUTPUT_BUDGET_CHARS = 9500`（替代 `SESSION_OUTPUT_BUDGET_BYTES`）

---

## M1 — group 路由骨架 + chars 单位

### Task 1: assembleWithBudget 改 chars 单位

**Files:**
- Modify: `plugin/hooks/session-start/budget.js`
- Test: `tests/test-session-layers.js`（SL-8 已有截断测试，改断言单位）

- [ ] **Step 1: 改现有 SL-8 测试断言为 chars 语义**

`tests/test-session-layers.js` 的 SL-8 已断言「200000 超大 L3 被截 + 已省略 footer」。把 `limitBytes: 128000` 改为 `limitChars: 9500`，big 改 `'x'.repeat(20000)`（超 9500 chars）：
```js
const big = 'x'.repeat(20000);
const layers = { l1head: ['=== 项目上下文 ===\nHEAD关键\n'], l0: ['=== 活跃 CHG ===\nL0关键\n'],
  l1: ['=== git ===\nL1关键\n'], l2: ['=== 工作流入口 ===\nL2关键\n'], l3: ['=== findings ===\nF1保留\n', big] };
const { text, truncated } = assembleWithBudget(layers, { limitChars: 9500 });
assert.ok(text.includes('HEAD关键') && text.includes('L0关键') && text.includes('L1关键') && text.includes('L2关键'), 'head 永不截');
assert.ok(text.includes('F1保留') && !text.includes(big), 'L3 超预算条目被截');
assert.ok(text.includes('已省略') && truncated === true, '附 footer + truncated');
```
SL-9 同改 `limitChars: 9500`。

- [ ] **Step 2: 跑红**

Run: `node tests/test-session-layers.js 2>&1 | grep -E "SL-8|SL-9|FAIL"`
Expected: SL-8 FAIL（当前 `assembleWithBudget` 读 `opts.limitBytes`，传 `limitChars` 时 `limitBytes=Infinity` 不截，big 进 text）。

- [ ] **Step 3: 改 budget.js 为 chars**

`assembleWithBudget` 与 `packL3` 全线 bytes → chars（`Buffer.byteLength(x,'utf8')` → `x.length`，`limitBytes` → `limitChars`，footer 文案 `bytes` → `chars`）：
```js
function assembleWithBudget(layers, opts) {
  const limitChars = opts && Number.isFinite(opts.limitChars) ? opts.limitChars : Infinity;
  const head = [...(layers.l1head||[]), ...(layers.l0||[]), ...(layers.l1||[]), ...(layers.l2||[])];
  const headText = head.join('');
  const remain = Math.max(0, limitChars - headText.length);
  const { kept, omitted } = packL3(layers.l3 || [], remain);
  let tail = kept.join('');
  if (omitted > 0) {
    tail += `\n=== 相关提醒已省略 ${omitted} 条（注入预算 ${limitChars} chars）===\n按需 Read 对应 artifact（findings.md / 相关讨论笔记）查看完整内容。\n`;
  }
  return { text: headText + tail, truncated: omitted > 0 };
}
function packL3(items, remainChars) {
  const kept = []; let used = 0, omitted = 0;
  for (const item of items) {
    const c = item.length;
    if (omitted === 0 && used + c <= remainChars) { kept.push(item); used += c; }
    else omitted++;
  }
  return { kept, omitted };
}
```
更新文件头注释 + JSDoc 的 `limitBytes`/bytes 措辞为 chars。

- [ ] **Step 4: 跑绿**

Run: `node tests/test-session-layers.js 2>&1 | tail -2`
Expected: 全绿（SL-8/SL-9 PASS）。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/session-start/budget.js tests/test-session-layers.js
git commit -m "feat(session-start): M1 assembleWithBudget 改 chars 单位（对齐 per-hook 10K chars cap）"
```

### Task 2: session-start.js --group 解析 + 透传

**Files:**
- Modify: `plugin/hooks/session-start.js`（37 行 BUDGET 常量、173 collectState 调用、181 buildLayers、188 assembleWithBudget）

- [ ] **Step 1: 加 group 解析 + 常量（替换 128K BUDGET）**

`session-start.js` 顶部（现 37 行 `SESSION_OUTPUT_BUDGET_BYTES` 一带，旧 CHG-05 改成了 128000，本 task 替换）：
```js
const GROUP_CORE = 'core';
const GROUP_ARTIFACT = 'artifact';
function parseGroupArg() {
  const i = process.argv.indexOf('--group');
  const v = i >= 0 ? process.argv[i + 1] : '';
  return v === GROUP_ARTIFACT ? GROUP_ARTIFACT : GROUP_CORE; // 默认 core，向后兼容无 arg
}
const GROUP = parseGroupArg();
const SESSION_OUTPUT_BUDGET_CHARS = Math.max(9500, Number(process.env.PACE_SESSION_OUTPUT_BUDGET_CHARS) || 9500);
```
删除旧的 `SESSION_OUTPUT_HARD_LIMIT_BYTES`（已在旧 CHG-05 删）+ `SESSION_OUTPUT_BUDGET_BYTES`。**`installSessionOutputGuard` 的字节阈值不与 chars 主预算共用**——新增独立常量 `SESSION_OUTPUT_GUARD_BYTES = Number(process.env.PACE_SESSION_OUTPUT_GUARD_BYTES) || 46000`，guard 内引用从 `SESSION_OUTPUT_BUDGET_BYTES` 改为 `SESSION_OUTPUT_GUARD_BYTES`，字节计量 `Buffer.byteLength` 保留。**关键纠错（T-002 执行中发现，原 plan 此处有误）**：guard 是 bytes 兜底、assembleWithBudget 是 chars 主截断，二者是独立机制——若共用 9500，guard 会按字节误截合法 CJK 注入（9500 chars 全 CJK≈28500 bytes），复活 2d3 ARCH-01（层2 footer 不可达）。阈值须 >28500（单 hook 合法上限）、<50000（旧 e2e 2d 系列的 50KB 持久化边界），46000 满足。notice 文案同步改字节语义，但保留「SessionStart 输出截断」「请按需 Read artifact 文件」两短语供 2d 断言。

- [ ] **Step 2: 副作用只 core + 传 group**

173 行 `applyRuntimeEffects` 调用包在 `if (GROUP === GROUP_CORE && !PRINT_ONLY)`（artifact 的幂等自保留 Task 6）。collectState/buildLayers/assembleWithBudget 传 group：
```js
if (GROUP === GROUP_CORE && !PRINT_ONLY) {
  applyRuntimeEffects(cwd, eventType, paceSignal, rootChoicePending, artDir, {
    paceUtils, log, PACE_RUNTIME, COUNTER_FILE, v5MigrationInfo, artifactRootChoice, proj, compactSnapshot, group: GROUP,
  });
}
const state = collectState(cwd, eventType, paceSignal, artDir, paceUtils, {
  proj, hookInput, rootChoicePending, artifactRootChoice, v5MigrationInfo, ageFlagExistedBefore, group: GROUP,
});
// ...
const layers = buildLayers(state, eventType, paceUtils, GROUP);
const { text } = assembleWithBudget(layers, { limitChars: SESSION_OUTPUT_BUDGET_CHARS });
```

- [ ] **Step 3: 验证语法 + 现有 e2e 不回归（默认 core 全量，行为暂等价）**

本 task collectState/buildLayers 还没按 group 过滤（Task 3/4 做），默认 core 仍渲染全部层 → 单 hook 行为暂时不变。
Run: `node -c plugin/hooks/session-start.js && node tests/test-hooks-e2e.js 2>&1 | tail -2`
Expected: 语法 OK + e2e 全绿（行为未变）。

- [ ] **Step 4: Commit**
```bash
git add plugin/hooks/session-start.js
git commit -m "feat(session-start): M1 --group 解析 + 副作用归 core + chars 预算透传"
```

---

## M2 — 内容分配 + 块→group 映射 + L0 排序

### Task 3: buildLayers 按 group 渲染

**Files:**
- Modify: `plugin/hooks/session-start/layers.js`（buildLayers 44 起；各 render section）
- Test: `tests/test-session-layers.js`

**group→块映射**（design §3.3）：
- **core**：项目上下文 / 工作流入口 / Artifact 目录 / L0（活跃 CHG 摘要+change-set+暂停+执行上下文）/ git / 相关讨论
- **artifact**：spec / task.md+impl 索引原文 / walkthrough / findings / corrections

- [ ] **Step 1: 失败测试——core 不含 findings、artifact 不含工作流入口**

```js
test('SL-12. group=core 含工作流入口+L0、不含 findings/corrections', () => {
  const state = makeActiveState();
  const { l1head, l0, l3 } = buildLayers(state, 'startup', paceUtils, 'core');
  const all = [...l1head, ...l0, ...l3].join('\n');
  assert.ok(all.includes('=== PACEflow 工作流入口 ==='), 'core 含工作流入口');
  assert.ok(all.includes('=== 活跃 CHG 摘要 ==='), 'core 含 L0');
  assert.ok(!all.includes('=== findings.md ==='), 'core 不含 findings');
  assert.ok(!all.includes('=== corrections.md ==='), 'core 不含 corrections');
});
test('SL-13. group=artifact 含 findings/corrections、不含工作流入口', () => {
  const state = makeActiveState();
  const { l1head, l3 } = buildLayers(state, 'startup', paceUtils, 'artifact');
  const all = [...l1head, ...l3].join('\n');
  assert.ok(all.includes('=== findings.md ===') || all.includes('=== corrections.md ==='), 'artifact 含 findings/corrections');
  assert.ok(!all.includes('=== PACEflow 工作流入口 ==='), 'artifact 不含工作流入口');
});
```
（`makeActiveState` 需补 findings/corrections artifact 文件字段——见 Step 3。）

- [ ] **Step 2: 跑红**

Run: `node tests/test-session-layers.js 2>&1 | grep -E "SL-12|SL-13|FAIL"`
Expected: FAIL（buildLayers 忽略 group 参数，core/artifact 都渲染全部）。

- [ ] **Step 3: buildLayers 加 group 分支**

`buildLayers(state, eventType, paceUtils, group)` 签名加 `group`（默认 `'core'`）。在各 push 处用 group 守卫。当前 l1head 混了 core 块（项目上下文/工作流入口/Artifact目录）和 artifact 块（spec/task/impl/walkthrough/findings/corrections）——按 group 拆：
```js
function buildLayers(state, eventType, paceUtils, group) {
  const g = group || 'core';
  const isCore = g === 'core', isArtifact = g === 'artifact';
  // ... 现有排序（rankChangeCategory，工作树已有，保留）...
  const l1head = [], l0 = [], l1 = [], l2 = [], l3 = [];
  // 项目上下文 / 工作流入口 / Artifact 目录 / git / L0 / 相关讨论 → 仅 isCore push
  // artifact 文件 section（renderArtifactFiles 产出的 spec/task/impl/walkthrough/findings/corrections 块）→ 仅 isArtifact push
  // ...
  return { l1head, l0, l1, l2, l3 };
}
```
关键：把现有 `for (const block of filesRender.blocks) l1head.push(block)`（artifact 文件块）改为 `if (isArtifact) for (...) l1head.push(block)`；项目上下文/工作流入口/Artifact目录/git/L0/相关讨论的 push 包 `if (isCore)`。

`makeActiveState` 补 artifact 文件字段（让 artifact group 有内容渲染）：
```js
artifactFiles: [
  { file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[finding-x|测试 finding]] — summary [date:: 2026-06-08] [impact:: P1]\n' },
  { file: 'corrections.md', full: '# Corrections 索引\n\n## 活跃记录\n\n- [[correction-x]] 测试纠正 [date:: 2026-06-08]\n' },
],
```

- [ ] **Step 4: 跑绿 + 现有 SL-1~11 不回归**

Run: `node tests/test-session-layers.js 2>&1 | tail -2`
Expected: 全绿（SL-1~11 用默认 group='core'，行为兼容；SL-12/13 PASS）。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "feat(session-start): M2 buildLayers 按 group 渲染（core 骨架 / artifact 文件块）"
```

### Task 4: collectState 按 group 跳过读取 + L0 排序归 core

**Files:**
- Modify: `plugin/hooks/session-start/collect-state.js`（45 activeChangeSummaries、84 agedFindings、91 git、94 relatedNotes、49-61 artifact 文件读取）

- [ ] **Step 1: 失败测试——artifact group 不跑 git/relatedNotes，core 不读 findings/corrections 全文**

直接断言难（collectState 触磁盘）。改用「调用计数」——在 e2e 用真实项目跑两个 group，断言注入内容差异（core 有 git section、artifact 无）：
```js
// tests/test-hooks-e2e.js
test('MH-1. SessionStart --group core 注入工作流入口+git、不含 findings 文件块', () => {
  const dir = makeV6Project('mh-core');
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' }, args: ['--group', 'core'] });
  assert.ok(r.stdout.includes('=== PACEflow 工作流入口 ==='));
  assert.ok(!r.stdout.includes('=== findings.md ==='));
});
test('MH-2. SessionStart --group artifact 注入 artifact 文件块、不含工作流入口', () => {
  const dir = makeV6Project('mh-artifact');
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' }, args: ['--group', 'artifact'] });
  assert.ok(!r.stdout.includes('=== PACEflow 工作流入口 ==='));
});
```
（`runHook` 需支持 `args` 透传到 node 命令——若不支持，Step 3 先加。）

- [ ] **Step 2: 跑红**

Run: `node tests/test-hooks-e2e.js 2>&1 | grep -E "MH-1|MH-2|FAIL"`
Expected: FAIL（runHook 不传 args，或 collectState 全量读 + buildLayers 已分组但 collectState 仍读全部——MH 测的是注入差异，buildLayers 分组后应已 PASS 部分；此 task 聚焦 collectState 不做无用 IO）。

- [ ] **Step 3: runHook 支持 args + collectState 按 group 跳过**

`tests/test-hooks-e2e.js` 的 `runHook` 加 `opts.args` 透传到 spawn 的 node 参数末尾。
`collect-state.js` 的 `collectState` 读 `extra.group`，按 group 跳过：
```js
const group = (extra && extra.group) || 'core';
const isCore = group === 'core', isArtifact = group === 'artifact';
// 活跃 CHG 摘要：两个 group 都读——core 渲染 L0；artifact 的 foldForeignOwnedArtifactOutput
//   折叠 foreign owner 详情也需要它（实现中发现，原 plan「仅 isCore 读」不完整）。
const activeChangeSummaries = (paceSignal === 'artifact')
  ? summarizeActiveChanges(cwd).map(s => enrichSummaryOwner(s, cwd, hookInput, changeOwnerStatus)) : [];
// artifact 文件 raw：仅 isArtifact 读
// git：仅 isCore
const git = isCore ? collectGit(cwd) : null;
// relatedNotes：仅 isCore
const relatedNotes = isCore ? collectRelatedNotes(cwd, getProjectName, scanRelatedNotes) : [];
// agedFindings：仅 isArtifact（W12 + findings 过期注入耦合，归 artifact）
const agedFindings = isArtifact ? collectAgedFindings(cwd, paceSignal, paceUtils, extra.ageFlagExistedBefore) : { shouldInject: false, aged: [] };
```
（L0 排序逻辑在 buildLayers，工作树已有，归 core 自然生效——无需改。）

- [ ] **Step 3.5: 迁移现有 9 个 e2e 到 group-aware（T-003 buildLayers 分组的连带，原 plan 缺口）**

T-003 让 core 不再渲染 artifact 文件，以下现有 e2e（测 artifact 文件注入/截断）失败——**全部是预期变化（已复核无真 bug）**，按下表迁移（runHook 加 `args: ['--group', 'artifact']`，或拆 core+artifact 断言为两个 test）：

| e2e | 断言内容 | 迁移方式 |
|---|---|---|
| `2` | task.md/corrections.md 文件块 + 活跃 CHG 摘要 + artifact_dir 路由 | 拆：默认 core 验活跃 CHG 摘要+路由；新增 `2-art`（`--group artifact`）验 `=== task.md ===`/`=== corrections.md ===` |
| `2d`/`2d2`/`2d3` | findings 超大截断 / ARCHIVE 缺失层2截断 | runHook 加 `--group artifact` |
| `2e`/`2e2`/`2e3` | walkthrough 截断 | runHook 加 `--group artifact` |
| `2f` | 跨会话提醒（core）+ foreign 折叠提示（附在 artifact 文件 output） | 拆：默认 core 验跨会话+「不计入执行」断言；新增 `2f-art`（`--group artifact`）验「已折叠 N 个」 |
| `2h` | spec.md 截断 | runHook 加 `--group artifact` |

迁移后这些 e2e 测 artifact group 的注入/截断——现有截断逻辑跟 `renderArtifactFiles` 走，本 task 即生效（T-005 类内截断细化后仍兼容）。

- [ ] **Step 4: 跑绿 + 全量回归**

Run: `node tests/test-hooks-e2e.js 2>&1 | tail -2 && node tests/test-session-layers.js 2>&1 | tail -2`
Expected: 全绿。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/session-start/collect-state.js tests/test-hooks-e2e.js
git commit -m "feat(session-start): M2 collectState 按 group 跳过 IO（core 读 git/相关讨论，artifact 读文件/agedFindings）"
```

---

## M3 — artifact 增长块截断

### Task 5: corrections/findings/walkthrough/spec 截断 + active findings 过滤

**Files:**
- Modify: `plugin/hooks/session-start/layers.js`（artifact 文件 render：walkthrough/findings/corrections/spec 截断）
- Test: `tests/test-session-layers.js`

- [ ] **Step 1: 失败测试——满载 artifact group <9500 + 截断指针**

```js
test('SL-14. artifact group 满载（20 corrections + 10 findings）仍 <9500 chars + 截断指针', () => {
  const corr = Array.from({length: 20}, (_, i) => `- [[correction-2026-06-${String(i+1).padStart(2,'0')}-01-x]] 纠正记录 ${i} 较长文本占位字符串测试 [date:: 2026-06-${String(i+1).padStart(2,'0')}]`).join('\n');
  const finds = Array.from({length: 10}, (_, i) => `- [ ] [[finding-x${i}|finding ${i}]] — summary 较长占位 [date:: 2026-06-08] [impact:: ${i<2?'P1':'P3'}]`).join('\n');
  const state = makeActiveState({ artifactFiles: [
    { file: 'findings.md', full: `# 调研记录\n\n## 未解决问题\n\n${finds}\n` },
    { file: 'corrections.md', full: `# Corrections 索引\n\n## 活跃记录\n\n${corr}\n` },
  ]});
  const layers = buildLayers(state, 'startup', paceUtils, 'artifact');
  const { text } = assembleWithBudget(layers, { limitChars: 9500 });
  assert.ok(text.length <= 9500 + 200, `artifact <9500(+footer)，实际 ${text.length}`); // footer 容差
  assert.ok(text.includes('避免重犯请 Read corrections.md') || text.includes('详见'), '含截断长尾指针');
});
test('SL-15. findings 仅 active [ ] 注入，[-] won-t-fix 排除', () => {
  const state = makeActiveState({ artifactFiles: [
    { file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[f-active|active P1]] — x [date:: 2026-06-08] [impact:: P1]\n- [-] [[f-wontfix|已决定不修]] — y [date:: 2026-06-08] [impact:: P3]\n' },
  ]});
  const layers = buildLayers(state, 'startup', paceUtils, 'artifact');
  const all = [...layers.l1head, ...layers.l3].join('\n');
  assert.ok(all.includes('active P1'), 'active [ ] 注入');
  assert.ok(!all.includes('已决定不修'), '[-] won\'t-fix 不注入');
});
```

- [ ] **Step 2: 跑红**

Run: `node tests/test-session-layers.js 2>&1 | grep -E "SL-14|SL-15|FAIL"`
Expected: SL-14 FAIL（无类内截断，满载超 9500）；SL-15 取决于现有 findings render 是否已滤 `[-]`——若已滤则 PASS（现有逻辑跳过 `[x]/[-]`），断言现状。

- [ ] **Step 3: 加类内截断**

`layers.js` 渲染 artifact 文件块时（findings/corrections/walkthrough），加截断（design §3.6）：
- **corrections**：解析活跃区 `- [[correction-...]]` 行，取最近 6 条（按 date 降序），超出追加 `\n（另有 ${M} 条更早纠正记录，避免重犯请 Read corrections.md）\n`。
- **findings**：现有逻辑已只渲染活跃区 `[ ]`（跳过 `[x]/[-]`，SL-15 据此 PASS）。加 impact 优先——P0/P1 全保留 + P2/P3 最近 5，超出 `\n（另有 ${M} 条 P2/P3 finding，详见 findings.md）\n`。
- **walkthrough**：表格只保留最近 3 行 + `\n（另有 ${N} 条完成历史，详见 walkthrough.md）\n`（现有 walkthrough 截断逻辑保留 10 条 → 改 3）。
- **spec**：保留「项目概述 + 技术栈」段，砍目录/依赖（现有 spec 截断逻辑已部分做，确认 <~400 chars）。

每个写成 layers.js 内的小函数（`truncateCorrections(content, 6)` 等），返回截断后文本 + 长尾计数。全局 `assembleWithBudget(9500)` 兜底（Task 1 已 chars 化）。

- [ ] **Step 4: 跑绿 + 回归**

Run: `node tests/test-session-layers.js 2>&1 | tail -2 && node tests/test-hooks-e2e.js 2>&1 | tail -2`
Expected: 全绿（SL-14/15 PASS）。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "feat(session-start): M3 artifact 增长块类内截断（corrections N=6 + findings P0P1优先 + walkthrough 3）"
```

---

## M4 — hooks.json 注册 + W12 归 artifact + 顺序健壮 + 快照退役

### Task 6: W12 移到 artifact + artifact 幂等自保 W10/W11

**Files:**
- Modify: `plugin/hooks/session-start/runtime-effects.js`（W12 findings-age flag）、`plugin/hooks/session-start.js`（group 守卫）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败测试——core 不写 W12 flag、artifact 写 W12**

```js
test('MH-3. --group core 不写 findings-age flag（W12 归 artifact）', () => {
  const dir = makeV6Project('mh-w12-core');
  const flag = path.join(dir, '.pace', `findings-age-${today()}`);
  runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' }, args: ['--group', 'core'] });
  assert.ok(!fs.existsSync(flag), 'core 不写 W12 flag');
});
test('MH-4. --group artifact 写 findings-age flag', () => {
  const dir = makeV6Project('mh-w12-art');
  const flag = path.join(dir, '.pace', `findings-age-${today()}`);
  runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' }, args: ['--group', 'artifact'] });
  assert.ok(fs.existsSync(flag), 'artifact 写 W12 flag');
});
```

- [ ] **Step 2: 跑红**

Run: `node tests/test-hooks-e2e.js 2>&1 | grep -E "MH-3|MH-4|FAIL"`
Expected: FAIL（W12 当前在 applyRuntimeEffects/core；core 写了 flag → MH-3 FAIL；artifact 不跑 effects → MH-4 FAIL）。

- [ ] **Step 3: W12 移出 applyRuntimeEffects、artifact 自跑 W12 + 幂等 W10/W11**

`runtime-effects.js`：把 W12（findings-age flag 写）从 `applyRuntimeEffects` 主体移到独立导出 `applyArtifactGroupEffects(cwd, paceSignal, artDir, { paceUtils, ... })`，内含 W12 + 幂等 W10/W11（ensureProjectInfra/createTemplates 自保）。`applyRuntimeEffects` 保留 W1-W11（core）。
`session-start.js`：
```js
if (GROUP === GROUP_CORE && !PRINT_ONLY) applyRuntimeEffects(... group: GROUP);
if (GROUP === GROUP_ARTIFACT && !PRINT_ONLY) applyArtifactGroupEffects(cwd, paceSignal, artDir, { paceUtils, log, PACE_RUNTIME });
```
`ageFlagExistedBefore` 快照：仅 artifact group 需要（collectState Task 4 已让 agedFindings 仅 artifact）；core 不读 agedFindings，不需快照。

- [ ] **Step 4: 跑绿 + 回归（含 e2e findings-age 既有测试）**

Run: `node tests/test-hooks-e2e.js 2>&1 | tail -2`
Expected: 全绿（MH-3/4 PASS，既有 findings-age 测试用 artifact 路径仍绿）。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/session-start/runtime-effects.js plugin/hooks/session-start.js tests/test-hooks-e2e.js
git commit -m "feat(session-start): M4 W12 findings-age flag 归 artifact + artifact 幂等自保 W10/W11"
```

### Task 7: 快照退役（OQ-1）

**Files:**
- Modify: `plugin/hooks/pre-compact.js`（删快照写入）、`plugin/hooks/session-start.js` + `collect-state.js`（删 compact 快照消费 W7/W8/W9 + buildCompactSnapshotText）、`plugin/hooks/session-start/layers.js`（buildCompactSnapshotText）
- Test: `tests/test-hooks-e2e.js`、`tests/test-session-layers.js`（SL-7 buildCompactSnapshotText 测试删除）

- [ ] **Step 1: 失败测试——compact 走实时读、不依赖快照**

```js
test('MH-5. compact 无快照文件时正常实时注入（快照退役）', () => {
  const dir = makeV6Project('mh-compact');
  // 不写 .pace/pre-compact-state.json
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'compact' }, args: ['--group', 'core'] });
  assert.ok(r.stdout.includes('=== PACEflow 工作流入口 ==='), 'compact core 实时注入工作流入口（A0 对称）');
  assert.ok(!r.stdout.includes('快照'), '不再有快照恢复段');
});
```

- [ ] **Step 2: 跑红**

Run: `node tests/test-hooks-e2e.js 2>&1 | grep -E "MH-5|FAIL"`
Expected: 视当前 compact 分支而定——若 compact 仍走快照消费分支且无快照时降级，可能已部分 PASS；断言"无快照段"驱动删除快照消费代码。

- [ ] **Step 3: 删快照机制**

- `pre-compact.js`：删除 `.pace/pre-compact-state.json` 写入（snapshot 构造 + writeFile）。保留 native plan 检测（与快照无关）。
- `session-start.js` + `collect-state.js`：删 compact 快照消费（W7/W8/W9 unlink、blockCount 从快照恢复、`buildCompactSnapshotText` 调用、`compactSnapshotText` state 字段）。compact 与 startup 走**同一** collectState/buildLayers 路径（A0：compact 也注入工作流入口——core group 的工作流入口 push 去掉 `eventType !== 'compact'` 守卫，若有）。
- `layers.js`：删 `buildCompactSnapshotText` 函数 + 导出。
- `tests/test-session-layers.js`：删 SL-7（buildCompactSnapshotText 测试）。

- [ ] **Step 4: 跑绿 + 全量**

Run: `node tests/test-hooks-e2e.js 2>&1 | tail -2 && node tests/test-session-layers.js 2>&1 | tail -2 && node tests/test-pace-utils.js 2>&1 | tail -2`
Expected: 全绿。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/pre-compact.js plugin/hooks/session-start.js plugin/hooks/session-start/collect-state.js plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "feat(session-start): M4 退役 PreCompact 快照机制——compact 与 startup 统一实时读（OQ-1 + A0 对称）"
```

### Task 8: hooks.json 注册 2 hook

**Files:**
- Modify: `plugin/hooks/hooks.json`（SessionStart）
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 失败测试——hooks.json SessionStart 有 2 个 command**

```js
test('MH-6. hooks.json SessionStart 注册 core + artifact 两个 command', () => {
  const hj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const ss = hj.hooks.SessionStart;
  const cmds = ss.flatMap(block => block.hooks).map(h => (h.args || []).join(' '));
  assert.ok(cmds.some(c => c.includes('--group core')), '有 core command');
  assert.ok(cmds.some(c => c.includes('--group artifact')), '有 artifact command');
});
```

- [ ] **Step 2: 跑红**

Run: `node tests/test-hooks-e2e.js 2>&1 | grep -E "MH-6|FAIL"`
Expected: FAIL（当前单 command 无 --group）。

- [ ] **Step 3: 改 hooks.json**

```json
"SessionStart": [
  { "matcher": "startup|resume|clear|compact", "hooks": [
    { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js", "--group", "core"] },
    { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/session-start.js", "--group", "artifact"] }
  ]}
]
```

- [ ] **Step 4: 跑绿 + plugin validate**

Run: `node tests/test-hooks-e2e.js 2>&1 | tail -2 && claude plugin validate ./plugin`
Expected: 全绿 + plugin 合法。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/hooks.json tests/test-hooks-e2e.js
git commit -m "feat(session-start): M4 hooks.json 注册 core + artifact 两个 SessionStart hook"
```

---

## M5 — wiki article 注入 core 相关讨论

### Task 9: scanRelatedNotes 扩展 wiki（vault-gated）

**Files:**
- Modify: `plugin/hooks/pace-utils/*.js`（`scanRelatedNotes` 定义文件——先 `rg -l "function scanRelatedNotes" plugin/hooks/pace-utils/` 定位）
- Test: `tests/test-pace-utils.js`（scanRelatedNotes 既有单测附近）

- [ ] **Step 1: 失败测试——有 wiki/ 时 article 优先，无 vault/wiki 静默跳过**

```js
// tests/test-pace-utils.js（用 tmp vault fixture）
test('WIKI-1. scanRelatedNotes 有 wiki/ 时优先注入 article', () => {
  // 构造 tmp vault：wiki/ai-workflow/topic.md（frontmatter sources/tags 匹配项目）+ knowledge/raw.md
  // 断言返回结果 article 在前、含 wiki article 标题
});
test('WIKI-2. 无 wiki/ 目录时只返回 raw（现状不破坏）', () => {
  // tmp vault 无 wiki/，断言 scanRelatedNotes 返回 knowledge/thoughts raw（现有行为）
});
```
（精确 fixture 构造参照 `tests/test-pace-utils.js` 现有 scanRelatedNotes 测试的 vault 搭建方式。）

- [ ] **Step 2: 跑红**

Run: `node tests/test-pace-utils.js 2>&1 | grep -E "WIKI-1|WIKI-2|FAIL"`
Expected: WIKI-1 FAIL（scanRelatedNotes 不读 wiki/）；WIKI-2 PASS（现状）。

- [ ] **Step 3: scanRelatedNotes 加 wiki 层**

`scanRelatedNotes`：vault 下若存在 `wiki/`，先扫 `wiki/**/*.md`——按 article frontmatter 的 `sources`/`tags` + source 页 `artifact`/`change_id` 匹配当前项目，article 优先；再补充未进 wiki 的 `knowledge/`+`thoughts/` raw。无 `PACE_VAULT_PATH` → 返回 `[]`（整段不出现）；有 vault 无 `wiki/` → 只 raw（现状）。匹配项目用 getProjectName。

- [ ] **Step 4: 跑绿 + 回归**

Run: `node tests/test-pace-utils.js 2>&1 | tail -2`
Expected: 全绿（WIKI-1/2 PASS，既有 scanRelatedNotes 测试不回归）。

- [ ] **Step 5: Commit**
```bash
git add plugin/hooks/pace-utils/ tests/test-pace-utils.js
git commit -m "feat(session-start): M5 scanRelatedNotes 扩展 wiki article 注入（core 相关讨论，vault-gated）"
```

---

## 终极验证（M1-M5 全部完成后）

- [ ] **真实 reload 实测不再 persist**（design §5 终极判据，单测不可代替）

```bash
node tests/test-session-layers.js && node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && claude plugin validate ./plugin && git diff --check
# push + /plugin + /reload-plugins 后，新 session 观察：
# - startup 不再出现 "Output too large ... persist"
# - core hook 输出 <10K chars（含工作流入口+L0），artifact hook 输出 <10K chars
printf '{"type":"startup"}' | PACE_PRINT_ONLY=1 CLAUDE_PROJECT_DIR=$PWD node plugin/hooks/session-start.js --group core 2>/dev/null | wc -m
printf '{"type":"startup"}' | PACE_PRINT_ONLY=1 CLAUDE_PROJECT_DIR=$PWD node plugin/hooks/session-start.js --group artifact 2>/dev/null | wc -m
# 两者各应 <9500
```

---

## Self-Review

**1. Spec coverage**（design §3-5 逐条 → task）：
- §3.1 多 hook + group 路由 → Task 2、8 ✓
- §3.1 chars 单位 → Task 1 ✓
- §3.2/3.3 有界 vs 增长 + 内容分配 → Task 3、4 ✓
- §3.4 副作用归属（W12 artifact）→ Task 6 ✓
- §3.5 执行顺序健壮（artifact 自保 W10/W11）→ Task 6 ✓
- §3.6 截断策略 → Task 5 ✓
- §3.7 wiki → Task 9 ✓
- §4 finding `[-]` 注入过滤 → 注入层零改动（Task 5 SL-15 断言现状 `[-]` 已排除）；finding 生命周期/review gate 是**关联独立 change**，不在本 plan（design §4 明示）✓
- OQ-1 快照退役 → Task 7 ✓
- §5 验证（各 <9500 + reload 实测）→ 各 task Step 4 + 终极验证 ✓

**2. Placeholder scan**：Task 9 Step 1 测试 fixture「参照现有 scanRelatedNotes 测试搭建」——非占位，是指向现有可参照代码（vault fixture 构造在 test-pace-utils.js 已有，避免重复 200 行）；Task 3 Step 3 buildLayers 分支用「…」省略未改动的现有 section——执行者读现有 layers.js 即可，关键改动（isCore/isArtifact 守卫位置）已明示。可接受。

**3. Type consistency**：`group`/`GROUP_CORE`/`GROUP_ARTIFACT` 贯穿 Task 2-6；`limitChars` 贯穿 Task 1、3、5；`assembleWithBudget(layers,{limitChars})`、`buildLayers(state,ev,paceUtils,group)`、`collectState(...,{...,group})`、`applyArtifactGroupEffects` 签名前后一致 ✓。

**风险提示**：Task 3/4 的"块→group 映射"是改动最密集处（拆 l1head），执行时需对照现有 layers.js 各 render section 逐个归类；建议这两个 task 用 subagent-driven 单独 review。Task 7 快照退役牵动 pre-compact + compact 分支，回归面较大，须跑全量 e2e。
