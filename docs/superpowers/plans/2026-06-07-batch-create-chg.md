# batch create CHG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) for tracking.
> **PACEflow self-dev note:** 本 feature 是 PACEflow 自身开发，实现走 CHG 流程。下面 4 个阶段（CHG-A..D）即未来要创建的 4 个可验证闭环 CHG，构成一个 `change-set: batch-create-chg`——讽刺地，这正是本 feature 要解决的多阶段场景（先用现有逐个 create 落地，做完后即可用它自己 dogfood）。

**Goal:** 让 PACEflow 一次把"完整变更拆成的 N 个 CHG"落地为 artifact（规划持久化、不依赖单一 session），并提供轻量整体进度追踪。

**Architecture:** 中间路——CHG frontmatter 加 `change-set` + `change-set-seq` 两个 nullable 字段（不引入独立 epic artifact）；`reserve --count N` 批量预留 + create-chg batch 多块输入；`agent-lifecycle-guard` 加确定性校验兜底 artifact-writer 多 CHG 映射正确性；SessionStart 注入整体进度（AI 上下文）+ Stop 不阻断软提醒（人可见）。执行模型不变（逐个 approve-and-start，A2）。

**Tech Stack:** Node.js CommonJS hooks、artifact-writer agent 契约、node:test 单元/e2e、agent-tests YAML contract。

**Spec:** `docs/superpowers/specs/2026-06-07-batch-create-chg-design.md`

**全局验收（每阶段 commit 前必跑）:**
```bash
node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-agent-tests-helpers.js && claude plugin validate ./plugin && git diff --check
```

---

## CHG-A: 数据模型 + reserve 批量（基础件）

**闭环：** frontmatter 新字段可被解析、reserve 能产 N 连号。无下游依赖，可独立验证。

**Files:**
- Modify: `plugin/hooks/reserve-artifact-id.js`（`parseArgs` 加 `--count`；主流程批量预留）
- Modify: `plugin/hooks/pace-utils/change-analysis.js`（`classifyChange`/`summarizeActiveChanges` 解析 `change-set` + `change-set-seq`）
- Modify: `plugin/agent-references/artifact-writer-spec.md`（§2.1 schema 加两字段）
- Test: `tests/test-pace-utils.js`、`tests/test-hooks-e2e.js`

### Task A1: reserve `--count N` 解析 + 批量预留

- [ ] **Step 1: 写失败测试**（`tests/test-hooks-e2e.js`，仿现有 reserve helper 测试 `9hc-helper*`）

```js
test('RES-batch1. reserve --count 4 产 4 个连号 reserved-id', () => {
  const dir = makeV6Project('reserve-count');
  const r = runHelper('reserve-artifact-id.js', ['--operation','create-chg','--count','4','--cwd',dir]);
  assert.strictEqual(r.code, 0);
  const ids = (r.stdout.match(/reserved-id:\s*(CHG-\d{8}-\d{2})/g) || []);
  assert.strictEqual(ids.length, 4, '应输出 4 个 reserved-id');
  // 连号校验
  const nums = ids.map(s => Number(s.match(/-(\d{2})$/)[1]));
  assert.deepStrictEqual(nums, [nums[0], nums[0]+1, nums[0]+2, nums[0]+3]);
});
test('RES-batch2. reserve 默认 count=1 行为不变（回归）', () => {
  const dir = makeV6Project('reserve-default');
  const r = runHelper('reserve-artifact-id.js', ['--operation','create-chg','--cwd',dir]);
  assert.strictEqual((r.stdout.match(/reserved-id:/g)||[]).length, 1);
});
test('RES-batch3. reserve --count 非法值 fail-closed', () => {
  const dir = makeV6Project('reserve-bad-count');
  const r = runHelper('reserve-artifact-id.js', ['--operation','create-chg','--count','0','--cwd',dir]);
  assert.notStrictEqual(r.code, 0);
});
```
（若 `runHelper` 不存在，沿用现有 reserve 测试调用方式；先 grep `reserve-artifact-id` 在 test-hooks-e2e.js 的现有调用 helper。）

- [ ] **Step 2: 跑测试确认红** — `node tests/test-hooks-e2e.js 2>&1 | grep RES-batch`，预期 FAIL。
- [ ] **Step 3: 实现 `--count`**
  - `parseArgs`：加 `args.count`，`else if (arg === '--count') args.count = Number(argv[++i])`；默认 1。
  - 校验：`count` 非整数或 <1 → `fail(... 'DENY_INVALID_COUNT', 'reserve --count 必须是 ≥1 整数')`。
  - 主流程：把单条预留逻辑包成循环 N 次（复用现有 `promptForReservation`/reservation 写入；序列号锁内连续取 N 个，保证连号原子）。输出 N 个 `formatReservationBlock`，每块标 `# --- reserved 1/N ---` 便于主 session 对应。
  - **关键**：N 次预留在**同一序列锁**内完成（现有 reserve 已有序列锁机制），避免并发插号。
- [ ] **Step 4: 跑测试确认绿** — `node tests/test-hooks-e2e.js 2>&1 | grep RES-batch`，预期全 PASS + 全局验收。
- [ ] **Step 5: Commit** — `git commit -m "feat(batch-chg): reserve-artifact-id --count N 批量预留连号"`

### Task A2: frontmatter `change-set` + `change-set-seq` schema + 解析

- [ ] **Step 1: 写失败测试**（`tests/test-pace-utils.js`，仿 isChangeReviewed 测试）

```js
test('CS-1. classifyChange 解析 change-set / change-set-seq', () => {
  const dir = makeTmpDir('cs-parse');
  fs.mkdirSync(path.join(dir,'changes'),{recursive:true});
  fs.writeFileSync(path.join(dir,'changes','chg-20260101-01.md'),
    '---\nchg-id: CHG-20260101-01\nstatus: planned\ntype: change\nchange-set: review-gate\nchange-set-seq: 2/4\nschema-version: "6.0"\n---\n\n## 任务清单\n- [ ] T-001 x\n','utf8');
  fs.writeFileSync(path.join(dir,'task.md'),'# t\n\n## 活跃任务\n\n- [ ] [[chg-20260101-01]] x #change [tasks:: T-001]\n\n<!-- ARCHIVE -->\n','utf8');
  fs.writeFileSync(path.join(dir,'implementation_plan.md'),'# i\n\n## 变更索引\n\n- [ ] [[chg-20260101-01]] x #change [tasks:: T-001]\n\n<!-- ARCHIVE -->\n','utf8');
  const e = paceUtils.getActiveChangeEntries(dir).find(x=>x.id==='CHG-20260101-01');
  const cls = paceUtils.classifyChange(e);
  assert.strictEqual(cls.changeSet, 'review-gate');
  assert.strictEqual(cls.changeSetSeq, '2/4');
});
test('CS-2. 无 change-set 字段 → changeSet null（回归）', () => {
  // 用现有无 change-set 的 fixture，断言 cls.changeSet == null
});
```

- [ ] **Step 2: 跑测试确认红** — `node tests/test-pace-utils.js 2>&1 | grep CS-`
- [ ] **Step 3: 实现**
  - `change-analysis.js` `classifyChange`：从 `detail.frontmatter['change-set']` / `['change-set-seq']` 读取（用现有 `normalizeFrontmatterStatus` 同款去引号），加入返回对象 `changeSet`、`changeSetSeq`（缺则 null）。
  - `summarizeActiveChanges`：base 对象加 `changeSet`、`changeSetSeq`（供 session-start/stop 聚合）。
  - `artifact-writer-spec.md` §2.1 schema：在 `type` 后、`schema-version` 前加 `change-set: null` + `change-set-seq: null`，标注 nullable/向后兼容（schema-version 仍 6.0），并在 §2.1 顺序说明里注明位置。
- [ ] **Step 4: 跑测试确认绿** + 全局验收
- [ ] **Step 5: Commit** — `git commit -m "feat(batch-chg): change-set/change-set-seq frontmatter schema + 解析"`

---

## CHG-B: batch create 机制 + 确定性校验（核心）

**闭环：** 主 session 能 batch 派遣、guard 兜底正确性、artifact-writer 正确建 N 个。

**Files:**
- Modify: `plugin/hooks/pre-tool-use/agent-lifecycle-guard.js`（batch 检测 + 校验 + 模板分支）
- Modify: `plugin/agent-references/instructions/create-chg.md`（batch 多块处理规范）
- Modify: `plugin/agents/artifact-writer.md`（batch create 说明）
- Test: `tests/test-hooks-e2e.js`、`tests/agent-tests/cases/`

### Task B1: guard 确定性校验（batch 缺字段/串号/数量不符 → DENY）

- [ ] **Step 1: 写失败测试**（`tests/test-hooks-e2e.js`，仿 9hc4r）

```js
const batchPrompt = (dir, blocks) => [
  `artifact_dir: ${dir.replace(/\\/g,'/')}/`,
  'operation: create-chg','change-set: review-gate','change-set-total: 2',
  ...blocks,
].join('\n');
test('BCG-1. batch create 带齐 2 块 + 匹配 reserved-id → 放行', () => {
  const dir = makeV6Project('batch-ok');
  // 预设两个 reservation（helper 或 seed），blocks 含两块完整 reserved-id/title/tasks
  // 断言 !stdout.includes('"deny"') && stdout.includes('ARTIFACT_DIR 已确认')
});
test('BCG-2. 某块缺 title → DENY', () => { /* 断言 deny + 'title' */ });
test('BCG-3. reserved-id 集合 ≠ 预留 N（漏/多/串号）→ DENY', () => { /* 断言 deny + 'reserved-id' */ });
test('BCG-4. change-set-total ≠ 实际块数 → DENY', () => { /* 断言 deny + 'change-set-total' */ });
test('BCG-5. 缺 change-set → DENY', () => { /* 断言 deny + 'change-set' */ });
test('BCG-6. 单 CHG（无 --- CHG 块）→ 走现有路径放行（回归）', () => { /* 现有 create-chg 不受影响 */ });
```

- [ ] **Step 2: 跑测试确认红**
- [ ] **Step 3: 实现 `agent-lifecycle-guard.js`**
  - 加 `parseBatchBlocks(prompt)`：按 `/^--- CHG \d+\/\d+ ---$/m` 切块，每块解析 `reserved-id`/`title`/`tasks`。
  - 在 `agentLifecyclePromptDenyReason` 的 create-chg 分支：检测 batch（出现 `--- CHG` 或 `change-set-total>1`）→ batch 校验：
    - 每块缺 `reserved-id`/`title`/`tasks` → deny（列出第几块缺什么）；
    - 块数 ≠ `change-set-total` → deny；
    - 缺 `change-set` → deny；
    - reserved-id 集合校验（与 hook reservation 比对，复用现有 `explicitReservationFromPrompt`/reservation 查找逻辑扩展为多 id）→ 不匹配 deny。
  - 复用现有 `promptHasNonEmptyField` 风格；deny 文案给出 batch 重派模板（见 B2）。
- [ ] **Step 4: 跑测试确认绿** + 全局验收
- [ ] **Step 5: Commit** — `git commit -m "feat(batch-chg): agent-lifecycle-guard batch create 确定性校验"`

### Task B2: guard batch 模板分支（promptTemplateForOperation）

- [ ] **Step 1: 写失败测试** — batch deny 文案含 `--- CHG i/N ---` + `change-set` + 每块 reserved-id/title/tasks 模板。
- [ ] **Step 2: 红** → **Step 3: 实现** `promptTemplateForOperation` 加 batch create 模板分支（多块骨架）→ **Step 4: 绿** → **Step 5: Commit** `git commit -m "feat(batch-chg): batch create deny 模板分支"`

### Task B3: create-chg 指令 + artifact-writer batch 处理（contract）

- [ ] **Step 1: 写 contract 测试**（`tests/agent-tests/cases/`，仿 phase-a create-chg case）— batch 输入 2 块 → 期望建 2 个 changes/*.md + 各写 change-set/change-set-seq + task.md/impl 各 2 行索引；中途失败报告部分成功。
- [ ] **Step 2: 跑 contract 确认红**（dummy 模式校验 YAML 结构）
- [ ] **Step 3: 实现指令**
  - `create-chg.md`：加 "batch 模式" 段——检测多个 `--- CHG i/N ---` 块 → 逐块独立 create（内部循环）：每块写 `change-set` + `change-set-seq: i/总数` frontmatter + `changes/*.md` + task.md/impl 各一行索引；逐块验证；全成功才 SUCCESS；中途失败报告"已建哪些/失败在哪块"，未用 reservation 保留。
  - `artifact-writer.md`：操作说明 + 报告格式补 batch（报告列出 N 个建好的 CHG）。
- [ ] **Step 4: 跑 contract 确认绿** + 全局验收
- [ ] **Step 5: Commit** — `git commit -m "feat(batch-chg): create-chg 指令 + artifact-writer batch 多块处理"`

---

## CHG-C: 追踪层（SessionStart 注入 + Stop 软提醒）

**闭环：** change-set 整体进度对 AI（SessionStart）和人（Stop）可见。

**Files:**
- Modify: `plugin/hooks/session-start.js`（change-set 聚合注入）
- Modify: `plugin/hooks/stop.js`（change-set planned 软提醒，不阻断）
- Test: `tests/test-hooks-e2e.js`

### Task C1: SessionStart change-set 进度注入

- [ ] **Step 1: 写失败测试** — 项目有同 change-set 的 1 archived + 3 planned CHG → SessionStart stdout 含 "change-set review-gate" + 进度 "1/4" + 下一步 planned。
- [ ] **Step 2: 红** → **Step 3: 实现** — session-start 活跃区/planned 聚合时按 `changeSet` 分组（用 CHG-A2 的 summarize 字段），注入形如 `change-set review-gate 进度 1/4（待执行 seq 2/4,3/4,4/4）`。位置：紧随活跃 CHG 摘要。→ **Step 4: 绿** + 全局验收 → **Step 5: Commit** `git commit -m "feat(batch-chg): SessionStart 注入 change-set 整体进度"`

### Task C2: Stop change-set planned 软提醒（不阻断）

- [ ] **Step 1: 写失败测试**（关键——验证不阻断）

```js
test('STOP-cs1. change-set 有 planned + 无 in-progress → 软提醒 exit 0（不阻断）', () => {
  const dir = makeV6Project('stop-cs-planned'); // 1 archived + 2 planned 同 change-set，无 in-progress
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 0, '不阻断');
  assert.ok(r.stderr.includes('change-set') || r.stdout.includes('change-set'), '可见软提醒');
});
test('STOP-cs2. 有 in-progress CHG → 仍 exit 2（回归，不被软提醒降级）', () => {
  const dir = makeV6Project('stop-cs-inprogress'); // 含 in-progress
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
});
```

- [ ] **Step 2: 跑测试确认红**
- [ ] **Step 3: 实现 `stop.js`**
  - 在现有 closing-required 检查**之后**、`warnings.length>0` 判定**之前**：扫描 change-set 有 planned CHG 未执行的组；若**无任何 in-progress/closing-required warning**（即不阻断态），把 change-set 余项加入 `softReminders`（走 `emitAllowedStopReminders` 路径，exit 0），**不进 `warnings[]`**。
  - **关键**：planned 余项绝不进 `warnings[]`（否则触发 exit 2）；只在"本来就要放行"时附加可见软提醒。若已有 in-progress 阻断 warning，照常 exit 2，不附加（避免混淆）。
- [ ] **Step 4: 跑测试确认绿** + 全局验收（特别确认 STOP-cs2 回归）
- [ ] **Step 5: Commit** — `git commit -m "feat(batch-chg): Stop change-set planned 不阻断软提醒"`

---

## CHG-D: skill 文档对称（bridge / pace-workflow / artifact-management）

**闭环：** 三个 skill 的 batch 语义一致、可指导主 session 用 batch。纯文档，grep 验收。

**Files:**
- Modify: `plugin/skills/pace-bridge/SKILL.md`（Step 2-3 改 batch）
- Modify: `plugin/skills/pace-workflow/SKILL.md`（:79 闭环补全 + :88 batch 语义 + :94 措辞）
- Modify: `plugin/skills/artifact-management/SKILL.md`（:91/:123/:322/:335 补 batch + --count + 模板）

### Task D1: bridge Step 2-3 改 batch
- [ ] **Step 1**: 改 `pace-bridge/SKILL.md` Step 2-3——拆 N 个 → `reserve --count N` → 一次 batch create（替代逐个）；Step 4 auto-APPROVED 仍只针对当前首个（A2 不变）。
- [ ] **Step 2**: grep 验收 `grep -n "count\|batch" plugin/skills/pace-bridge/SKILL.md` 含 batch 流程。
- [ ] **Step 3: Commit** — `git commit -m "docs(batch-chg): bridge skill 改用 batch create"`

### Task D2: pace-workflow 闭环补全 + batch 语义
- [ ] **Step 1**: 改 `pace-workflow/SKILL.md`：① `:79` 补 "独立验证/回滚" 措辞 + 加 "按闭环边界拆、N 功能各自 CHG 而非按 plan 层级合并" 反模式（对齐 bridge :65/:67）；② `:88` "一个或多个 create-chg 输入" → "拆 N 个 → reserve --count N → 一次 batch create"；③ `:94` 措辞对齐 batch（一次创建全 planned，approve 首个）。
- [ ] **Step 2**: grep 验收闭环判据 + batch 语义存在。
- [ ] **Step 3: Commit** — `git commit -m "docs(batch-chg): pace-workflow 闭环原则补全 + batch 语义"`

### Task D3: artifact-management batch 模板 + reserve --count
- [ ] **Step 1**: 改 `artifact-management/SKILL.md`：`:91` 操作表加 batch create 行；`:123-126` 旁补 batch 多块模板；`:322`/`:335` reserve 说明补 `--count N`。
- [ ] **Step 2**: grep 验收。
- [ ] **Step 3: Commit** — `git commit -m "docs(batch-chg): artifact-management batch 模板 + reserve --count"`

---

## CHG-E（可选）: 版本 bump + 发布

若决定发版：bump 6.2.1→6.3.0（新 feature，minor）于 plugin.json/marketplace.json/PACE_VERSION/REFERENCE 标题 + README 版本历史行 + REFERENCE 写 change-set/batch 机制章节。全局验收后 commit + tag。

---

## Self-Review

**1. Spec coverage（逐节核对）:**
- §4 数据模型 → CHG-A2 ✓
- §5.1 reserve 批量 → CHG-A1 ✓
- §5.2 batch 机制 + 确定性校验 → CHG-B1/B2/B3 ✓
- §5.3 追踪层 → CHG-C1/C2 ✓
- §5.4 执行衔接 A2 → 不需新 task（复用现有 approve-and-start），bridge D1 Step 4 重申 ✓
- §5.5 bridge/pace-workflow/artifact-management → CHG-D1/D2/D3 ✓
- §6 测试策略 → 各 task 内 TDD ✓
- §7 风险（artifact-writer 正确性）→ CHG-B1 确定性校验 + B3 contract ✓

**2. Placeholder scan:** 测试代码 BCG-1/2 等用了 "/* 断言... */" 注释占位——执行时按同文件 BCG-3..6 的具体断言模式补全（已给断言关键串：deny + 字段名）。reserve `runHelper` 调用执行时先 grep 现有 helper 调用方式对齐。其余无 TBD。

**3. Type/命名一致性:** `changeSet`/`changeSetSeq`（camelCase，代码内）↔ `change-set`/`change-set-seq`（frontmatter/prompt，kebab）；`change-set-total` 仅 prompt 字段不入 frontmatter（CHG-A2 不写它，CHG-B1 只校验它）——一致。

**执行顺序依赖:** A（基础件）→ B（依赖 A 的字段/reserve）→ C（依赖 A 的 summarize 字段）→ D（文档，依赖 A-C 行为定稿）。B 与 C 可并行（都只依赖 A）。
