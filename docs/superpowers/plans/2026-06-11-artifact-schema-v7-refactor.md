# Artifact 体系 v7 大重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 双索引文件合并为 task.md 单索引、frontmatter 瘦身到 7.0 封闭合同、规范单源化消灭模板漂移、migrate-v7 全量迁移存量 vault。

**Architecture:** 读端先行（CHG-A hook 兼容两布局 → CHG-B schema 合同校验 → CHG-C agent 写端单写 → CHG-D 单源化 → CHG-E migrate 工具 → CHG-F 本 vault 迁移+发布）。tombstone 保留 `<!-- ARCHIVE -->` 兼容旧 hook；锁资源名 `index:changes` 不改（防新旧锁不互斥）；删除字段全部零消费，migrate 对旧 hook 安全。

**Tech Stack:** Node.js（无依赖纯 fs）、tests/ 自定义 runner（`node tests/test-*.js`）、plugin markdown 发布面。

**权威 spec:** `docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md`（含附录 A 消费点盘点）。本 plan 对 spec 的一处修正：migrate-v7.js 放 `plugin/migrate/`（与 v5 先例 `plugin/migrate/batch-archive-v5.js` 并列），非 spec §5.1 写的 plugin/hooks/。

**全量基线命令**（每个 CHG 收尾必跑，全绿才进下一 CHG）：

```bash
node tests/test-pace-utils.js && node tests/test-hooks-e2e.js && node tests/test-session-layers.js && node tests/test-agent-tests-helpers.js && claude plugin validate ./plugin
```

---

## 文件结构总览

| 文件 | CHG | 职责变化 |
|---|---|---|
| `plugin/hooks/pace-utils/change-analysis.js` | A、B | getActiveChangeEntries 单读 task.md；classifyChange 退役双索引分支；新增 validateFrontmatterSchema + SCHEMA_V7 常量 |
| `plugin/hooks/pace-utils/locks.js` | A | index-transaction 退役（markIndexChangesTouchedAndMaybeRelease 简化、readArtifactIndexTransaction 删除） |
| `plugin/hooks/pace-utils/constants.js` | A | ARTIFACT_FILES 移除 impl_plan；FORMAT_SNIPPETS.implIndex/implDetail 删；impl-archive-reminded 删 |
| `plugin/hooks/pace-utils.js` | A、B | re-export 同步（两处清单） |
| `plugin/hooks/pre-tool-use.js` | A | PROTECTED_ARTIFACTS 显式 + impl_plan；DENY_V6_INDEX_MISMATCH 退役 |
| `plugin/hooks/post-tool-use.js` | A、B | 跨索引 warning 退役；index-transaction 调用点改；schema 合同接线 |
| `plugin/hooks/stop.js` | A、B | index-missing/index-mismatch 分支退役；schema 合同兜底 |
| `plugin/hooks/session-start/collect-state.js` | A、B、E | impl_plan readFull 删；schema 漂移检测；未迁移布局检测 |
| `plugin/hooks/session-start/layers.js` | A、E | impl_plan 注入/格式警告移除；migrate 提示注入 |
| `plugin/agent-references/instructions/{create,update,close,archive}-chg.md` | C | 双写步骤改单写 task.md；7.0 frontmatter 模板 |
| `plugin/agents/artifact-writer.md` + `plugin/agent-references/artifact-writer-spec.md` + `templates/` | C、D | 7.0 字段同步；单源化指针 |
| `plugin/skills/**/SKILL.md` + references | C、D | 单写文案；指针化 |
| `plugin/hooks/agent-lifecycle-guard.js`（若 promptTemplateForOperation 在此） | C | deny 文案模板同步单写 |
| `plugin/migrate/migrate-v7.js`（新建） | E | dry-run/备份/五步迁移/验收/--hygiene |
| `tests/test-pace-utils.js`、`tests/test-hooks-e2e.js`、`tests/test-session-layers.js` | 全部 | 既有 ~65 处 impl_plan 断言改语义 + 新增 V7-* 测试组 |

执行约定：所有 CHG 在 master 直接串行执行（本仓惯例，无 feature 分支）；每 task TDD；commit message 带 CHG 编号。执行前由 pace-bridge 把本 plan 桥接为 6 个 CHG（batch create）。

---

## CHG-A：hook 读端——单索引兼容 + 跨索引校验退役 + index-transaction 退役

### Task A1: getActiveChangeEntries 单读 task.md + classifyChange 退役双索引分支 + 误伤分支同步删除

> **中间态警告**：本 task 改数据层后 `e.impl` 恒 undefined。`pre-tool-use.js:1435` 与 `post-tool-use.js:189-195` 的双索引 filter 若不同步删除，会把所有 entry 判为 mismatched（前者 deny 一切写码、后者每次写盘误报）。这两处**必须并入本 task 同 commit**，不得留到 A2。

**Files:**
- Modify: `plugin/hooks/pace-utils/change-analysis.js:286-314`（getActiveChangeEntries）、`:227-284`（classifyChange）、`plugin/hooks/pre-tool-use.js:1435-1447`（误伤 deny 分支）、`plugin/hooks/post-tool-use.js:189-195`（误伤 warning 分支）
- Test: `tests/test-pace-utils.js`、`tests/test-hooks-e2e.js`

- [ ] **Step 1: 写失败测试**——在 test-pace-utils.js 的 change-analysis 测试区追加（fixture 风格参照文件内既有 `getActiveChangeEntries` 用例，使用临时目录 + 写入 task.md）：

```js
// V7A-1: getActiveChangeEntries 只读 task.md，不再要求 implementation_plan.md
{
  const dir = mkTmpProject(); // 复用文件内既有临时项目工具函数（如无则参照既有用例的 fs.mkdtempSync 模式）
  writeArtifact(dir, 'task.md', `# 任务\n\n- [/] [[chg-20260611-99-v7-test|chg-20260611-99]] 测试 #change\n\n<!-- ARCHIVE -->\n`);
  writeDetail(dir, 'changes/chg-20260611-99-v7-test.md', `---\nstatus: in-progress\nschema-version: "7.0"\n---\n\n## 任务清单\n\n- [/] T-001 任务\n`);
  // 注意：不创建 implementation_plan.md
  const entries = paceUtils.getActiveChangeEntries(dir);
  assert(entries.length === 1, 'V7A-1a: impl_plan 缺失时 entry 仍可见');
  assert(entries[0].taskCheckbox === '/', 'V7A-1b: taskCheckbox 正常');
  assert(!('impl' in entries[0]) && !('implCheckbox' in entries[0]), 'V7A-1c: entry 不再含 impl 字段');
  const c = paceUtils.classifyChange(entries[0]);
  assert(c.category === 'running', 'V7A-1d: 单索引下 classify 正常 running');
}
// V7A-2: classifyChange 不再产生 index-missing / index-mismatch
{
  // 同上 fixture，故意只建 task.md：不应出现 inconsistent
  // （旧语义：impl 缺行 → index-missing；新语义：task.md 是唯一权威）
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node tests/test-pace-utils.js`
Expected: V7A-1c FAIL（现状 entry 含 impl 字段）、V7A-1d FAIL（现状 impl 缺失 → index-missing → inconsistent）

- [ ] **Step 3: 实现**——`getActiveChangeEntries` 整体替换为：

```js
function getActiveChangeEntries(cwd) {
  // v7：task.md 是唯一 CHG/HOTFIX 索引（双文件合并，CHG-A）。
  // Map 按 ID 去重保留（同 CHG 重复行的脏数据防裂成两个 entry，沿旧实现语义）。
  const taskEntries = parseChangeIndex(ctx.readActive(cwd, 'task.md') || '');
  const taskById = new Map(taskEntries.map(e => [e.id, e]));
  return [...taskById.values()].map(task => ({
    slug: task.slug,
    id: task.id,
    task,
    taskCheckbox: task.checkbox,
    taskMalformed: Boolean(task.malformed),
    detail: readChangeDetail(cwd, task.id),
  }));
}
```

`classifyChange` 修改点（保持其余分支原样）：
1. 删除 `if (!entry || !entry.task || !entry.impl) ... 'index-missing'` 分支，改为 `if (!entry || !entry.task) return { ...base, category: 'inconsistent', reason: 'index-missing' };`（防卫空 entry，正常路径不可达）
2. `entry.taskMalformed || entry.implMalformed` → `entry.taskMalformed`
3. 删除 `taskCheckbox !== implCheckbox → 'index-mismatch'` 分支
4. 所有双 checkbox 条件简化为只看 `taskCheckbox`（**共 7 处**：`'x'` 三处 L266/L269/L279、`'/'` 两处 L272/L280、`'-'` 一处 L277、`'!'` 一处 L278；以 `grep -n implCheckbox` 清零为收口标准，不按计数核对）
5. base 对象删除 `implCheckbox` 字段
6. **同 commit 删除误伤分支（三处，缺一即 broken commit）**：
   - `pre-tool-use.js:1435-1447` 整段（`const mismatched = actionableEntries.filter(e => !e.task || !e.impl);` 起到该分支 `return;` 止）
   - `pre-tool-use.js:1490` 连续执行判定 `e.taskCheckbox === '/' && e.implCheckbox === '/'` 改 `e.taskCheckbox === '/'`（implCheckbox 恒 undefined 会使条件恒 false → 写码门全堵）
   - `post-tool-use.js:189-195`（`const mismatched = ...` 与 `v6 索引不一致` warning 段）
   - 无误伤但同步清理：`pre-tool-use.js:1350`（marks filter(Boolean) 容忍 undefined）、`:1462`（or 条件降级安全）、`:1503`（显示串删 `impl=` 段）——以 `grep -n implCheckbox plugin/hooks/pre-tool-use.js` 清零为收口

- [ ] **Step 4: 跑测试**——V7A 通过；既有用例中构造双索引 fixture 的会继续过（task.md 仍是输入）、断言 index-mismatch/index-missing/INDEX_MISMATCH deny 的会红，**在本 task 内一并改语义**：grep `index-mismatch\|index-missing\|INDEX_MISMATCH\|implCheckbox` 定位 test-pace-utils.js 与 test-hooks-e2e.js 内所有相关断言，按新语义改写（双索引不一致用例改为「仅 task.md 权威」或删除）。

Run: `node tests/test-pace-utils.js && node tests/test-hooks-e2e.js`
Expected: 全绿（A1 触碰了 hook 文件，e2e 必须在本 task 内过，不留 broken commit）

- [ ] **Step 5: Commit** `git commit -m "feat(v7): getActiveChangeEntries 单读 task.md，classifyChange 退役双索引分支（CHG-A T-001）"`

### Task A2: 下游 impl 引用清理（stop 文案/collect-state/layers）

> 执行顺序注意：A2 在 A3 之后执行也可（A2 与 A3 无依赖）；但 collect-state:82 的 readFull 删除与 A3 的 ARCHIVE_REQUIRED_FILES 收窄存在弱耦合（layers.js:335/343 注入兜底消费该常量），建议顺序 A1 → A3 → A2，或 A2/A3 同 commit。误伤性的 pre-tool-use:1435 / post-tool-use:189-195 已在 A1 删除，本 task 只剩无误伤的死代码与文案。

**Files:**
- Modify: `plugin/hooks/post-tool-use.js:197,249`、`plugin/hooks/stop.js:216-224`、`plugin/hooks/session-start/collect-state.js:82`、`plugin/hooks/session-start/layers.js`（371/716 截断、829-836 格式警告、54 优先级数组）
- Test: `tests/test-hooks-e2e.js`、`tests/test-session-layers.js`

- [ ] **Step 1: 写失败测试**——test-hooks-e2e.js 追加：

```js
// V7A-3: PreToolUse 不再因 impl_plan 缺行 deny（旧 DENY_V6_INDEX_MISMATCH 退役）
//   fixture：task.md 有活跃 [/] CHG + 详情 APPROVED + in-progress，impl_plan 完全没有该行
//   断言：写代码文件被放行（旧行为：deny "必须同时存在于 task.md 与 implementation_plan.md"）
// V7A-4: PostToolUse 写 task.md 后不再产生「v6 索引不一致」warning
// V7A-5: Stop 不再产生 index-missing / index-mismatch repair warning（同 fixture）
```

（具体 fixture 写法参照文件内既有 DENY_V6_INDEX_MISMATCH 用例——grep `INDEX_MISMATCH` 找到后复制其 fixture、反转断言。）

- [ ] **Step 2: 确认失败** `node tests/test-hooks-e2e.js` → V7A-3/4/5 FAIL

- [ ] **Step 3: 实现**：
1. `post-tool-use.js:197` 行 `if (artifactRel === 'task.md' || artifactRel === 'implementation_plan.md')` 改为 `if (artifactRel === 'task.md')`
2. `post-tool-use.js:249` 修复提示文案 `读取 task.md / implementation_plan.md 对应索引` 改 `读取 task.md 对应索引`
3. `stop.js:216-224`：删除 `index-missing`、`index-mismatch` 两个 reason 分支（A1 后不可达死代码）；`index-malformed`/`active-archived`/`active-cancelled` 分支文案中 `task.md / implementation_plan.md` 改 `task.md`
4. `collect-state.js:82` 删除 impl_plan readFull 行及其下游格式检查引用
4b. `change-analysis.js:83` `walkthroughContextForChange` 的 `for (const file of ['task.md', 'implementation_plan.md'])` 改 `['task.md']`；`:150` 文案「应与 task.md / implementation_plan.md 索引行一致」改「应与 task.md 索引行一致」
5. `layers.js`：54 行 ARTIFACT_BLOCK_PRIORITY 数组移除 `'implementation_plan.md'`；371-372/716 截断特殊处理删除；829-836 格式警告中 impl_plan 分支删除
6. 全文件 grep 验证：`grep -rn "implementation_plan" plugin/hooks/*.js plugin/hooks/session-start/*.js` 剩余命中只允许：pace-utils.js v5 检测（335-370 区）、constants.js DOC 字符串（PACE_ARTIFACT_ROOT_CONTENT，本 task 不动）、locks.js（A3 处理）、pre-tool-use.js PROTECTED 相关（A3 处理）

- [ ] **Step 4: 跑全量** `node tests/test-hooks-e2e.js && node tests/test-session-layers.js`——既有 impl_plan 断言（~50 处）按新语义改：双写 fixture 改单写、跨索引 deny/warning 断言删除或反转。
- [ ] **Step 5: Commit** `git commit -m "feat(v7): hook 下游 impl_plan 消费退役（CHG-A T-002）"`

### Task A3: 常量集调整 + PROTECTED 显式保留 + index-transaction 退役

**Files:**
- Modify: `plugin/hooks/pace-utils/constants.js:7-11,53-54,80`、`plugin/hooks/pre-tool-use.js:40`、`plugin/hooks/pace-utils/locks.js:667-701`、post-tool-use.js 中 `markIndexChangesTouchedAndMaybeRelease` 调用点、`plugin/hooks/pace-utils.js` re-export 两处
- Test: `tests/test-pace-utils.js`（含既有 1014/1023 锁测试）、`tests/test-hooks-e2e.js`（6237/6257 事务测试）

- [ ] **Step 1: 写失败测试**：

```js
// V7A-6: task.md 写后 index:changes 锁直接释放（不再等 impl_plan touched）
{
  const dir = mkTmpProject();
  const info = { sessionId: 's1', agentId: 'a1' };
  paceUtils.acquireArtifactResourceLock(dir, 'index:changes', info);
  const r = paceUtils.markIndexChangesTouchedAndMaybeRelease(dir, 'task.md', info);
  assert(r.released === true, 'V7A-6: task.md 单 touched 即释放');
}
// V7A-7: PROTECTED_ARTIFACTS 仍含 implementation_plan.md（tombstone 保护）
//   断言主 session 直接 Edit implementation_plan.md 仍被 PreToolUse deny（e2e）
```

- [ ] **Step 2: 确认失败**——V7A-6 FAIL（现状 released=false, reason=index-transaction-open）

- [ ] **Step 3: 实现**：
1. `constants.js:7` ARTIFACT_FILES 移除 `'implementation_plan.md'`（行 8 MIGRATABLE、行 11 ARCHIVE_REQUIRED 是 filter 派生，自动收窄）
2. `constants.js:53-54` 删除 `implIndex`、`implDetail` 两个 FORMAT_SNIPPETS（grep 下游 `FORMAT_SNIPPETS.implIndex\|FORMAT_SNIPPETS.implDetail` 改引 `taskEntry`——pre-tool-use:1621、layers:829/832、post-tool-use:249 若 A2 未涉及则此处收尾）
3. `constants.js:80` SESSION_SCOPED_FLAGS 删除 `'impl-archive-reminded'`；grep `impl-archive-reminded` 清理产生它的代码位置
4. `pre-tool-use.js:40` 改为：

```js
// v7：impl_plan 已退役出 ARTIFACT_FILES，但 tombstone 与未迁移存量仍受保护（主 session 不得直写）
const PROTECTED_ARTIFACTS = [...ARTIFACT_FILES.filter(f => f !== 'spec.md'), 'implementation_plan.md'];
```

**明确动作（非条件句）**：PROTECTED_ARTIFACTS 提升到 constants.js 导出，pre-tool-use.js / bash-guard.js / powershell-guard.js 三文件统一改用它。`bash-guard.js:243/414`、`powershell-guard.js:194/315` 现状遍历 ARTIFACT_FILES 做 artifact 写保护——若维持原集合，ARTIFACT_FILES 移除 impl_plan 后 Bash/PS 直写 tombstone 不再被拦，与 pre-tool-use 的 PROTECTED 保护不对称（保护门出现 Bash 旁路）。e2e 补断言：Bash `echo x >> implementation_plan.md` 形态写入仍被 deny
5. `locks.js:667-689` `markIndexChangesTouchedAndMaybeRelease` 整体替换为：

```js
function markIndexChangesTouchedAndMaybeRelease(cwd, artifactRel, info = {}) {
  // v7：双文件合并后 index:changes 单文件直接释放；保留函数名与签名（调用点零扰动）。
  const rel = String(artifactRel || '').replace(/\\/g, '/');
  return releaseArtifactResourceLock(cwd, artifactResourceForRel(rel), info);
}
```

6. `locks.js:691-701` `readArtifactIndexTransaction` 删除；`locks.js:237` `artifactResourceForRel` 改 `if (rel === 'task.md') return 'index:changes';`（资源名不改——旧版本并发 session 锁互斥依赖同名）；impl_plan 不再映射资源（写它的只剩 migrate，migrate 不走 resource lock）
7. `locks.js:841` sweep 白名单中 `index-transactions` 条目保留（继续清理残留目录）；`:859` export 删除 readArtifactIndexTransaction
8. `pace-utils.js` 两处 re-export 清单同步删除 readArtifactIndexTransaction

- [ ] **Step 4: 跑全量基线**——既有 index-transaction 断言（test-pace-utils 1014/1023、test-hooks-e2e 6237/6257）改为单文件直接释放语义。
- [ ] **Step 5: Commit** `git commit -m "feat(v7): index-transaction 退役 + PROTECTED 显式保留 impl_plan（CHG-A T-003）"`

### Task A4: CHG-A 收口

- [ ] 全量基线五连绿 → 按 G-9 流程：opus 对抗审计本 CHG diff（路径追踪棱镜：A1 entry 形态变化的全下游、A3 锁语义）→ findings 复核路由 → close-chg。

---

## CHG-B：schema 合同——validateFrontmatterSchema + 三层接线

### Task B1: validateFrontmatterSchema 纯函数

**Files:**
- Modify: `plugin/hooks/pace-utils/change-analysis.js`（countDetailTasks 之后新增）、`plugin/hooks/pace-utils.js` re-export 两处
- Test: `tests/test-pace-utils.js`

- [ ] **Step 1: 写失败测试**：

```js
// V7B-1: 7.0 CHG 帧完整合同通过
{
  const fm = { status: 'in-progress', date: '2026-06-11', 'change-set': 'null', 'change-set-seq': 'null',
    'verified-date': 'null', 'reviewed-date': 'null', 'archived-date': 'null',
    'parent-tasks': '["[[x/task|task]]"]', 'schema-version': '"7.0"' };
  const r = paceUtils.validateFrontmatterSchema('chg', 'in-progress', fm);
  assert(r.ok && r.missing.length === 0 && r.unknown.length === 0, 'V7B-1');
}
// V7B-2: 缺 key 报 missing-key（archived 状态缺 archived-date 值报 missing-value）
{
  const fm = { status: 'archived', date: '2026-06-11', 'change-set': 'null', 'change-set-seq': 'null',
    'verified-date': '2026-06-11T10:00:00+08:00', 'reviewed-date': '2026-06-11T10:00:00+08:00',
    'archived-date': 'null', 'parent-tasks': '["[[x/task|task]]"]', 'schema-version': '"7.0"' };
  const r = paceUtils.validateFrontmatterSchema('chg', 'archived', fm);
  assert(!r.ok && r.missing.includes('archived-date'), 'V7B-2: archived 必填 archived-date 非 null');
}
// V7B-3: 多余 key 报 unknown（aliases 复发场景）
//   fm 含 aliases: '[]' → r.unknown 含 'aliases'
// V7B-4: 6.0 文件跳过校验（skipped='non-7.0'，ok=true）
// V7B-5: finding/correction kind 各一组（finding 必填 status/date/schema-version；correction 必填 date/schema-version）
```

- [ ] **Step 2: 确认失败**（函数不存在 TypeError）
- [ ] **Step 3: 实现**——change-analysis.js 新增（frontmatterNullable 之后）：

```js
// v7 schema 封闭合同（spec §3.5）：key 集合恒定（缺失/多余都非法）+ 阶段必填值非 null。
// 字段恒在、未到阶段值为 null（与 hasNonNullVerifiedDate 等既有双表示判定兼容）。
const SCHEMA_V7_KEYS = {
  chg: ['status', 'date', 'change-set', 'change-set-seq', 'verified-date', 'reviewed-date', 'archived-date', 'parent-tasks', 'schema-version'],
  finding: ['status', 'date', 'schema-version'],
  correction: ['date', 'schema-version'],
};
const SCHEMA_V7_VALUE_REQUIRED = {
  chg: { base: ['status', 'date', 'parent-tasks', 'schema-version'], archived: ['archived-date'], cancelled: ['archived-date'] },
  finding: { base: ['status', 'date', 'schema-version'] },
  correction: { base: ['date', 'schema-version'] },
};

function validateFrontmatterSchema(kind, status, frontmatter) {
  const keys = SCHEMA_V7_KEYS[kind];
  if (!keys) return { ok: true, missing: [], unknown: [] };
  const fm = frontmatter || {};
  if (normalizeFrontmatterStatus(fm['schema-version']) !== '7.0') {
    return { ok: true, missing: [], unknown: [], skipped: 'non-7.0' };
  }
  const st = normalizeFrontmatterStatus(status);
  const spec = SCHEMA_V7_VALUE_REQUIRED[kind];
  const valueRequired = [...spec.base, ...((spec[st]) || [])];
  const keySet = new Set(keys);
  const present = Object.keys(fm);
  const missing = [
    ...keys.filter(k => !present.includes(k)).map(k => `${k}(missing-key)`),
    ...valueRequired.filter(k => present.includes(k) && !frontmatterNullable(fm[k])),
  ];
  const unknown = present.filter(k => !keySet.has(k));
  return { ok: missing.length === 0 && unknown.length === 0, missing, unknown };
}
```

模块 export 与 pace-utils.js 两处 re-export 同步加 `validateFrontmatterSchema`。

- [ ] **Step 4: 跑测试** → 绿。**Step 5: Commit** `git commit -m "feat(v7): validateFrontmatterSchema 封闭合同纯函数（CHG-B T-001）"`

### Task B2: 三层接线（post-tool-use 即时打回 / collect-state+stop 兜底）

**Files:**
- Modify: `plugin/hooks/post-tool-use.js`（artifact 写后区，~235 行 correction 提示附近）、`plugin/hooks/stop.js`（classify 消费区）、`plugin/hooks/session-start/collect-state.js`
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 写失败测试**：

```js
// V7B-6: artifact-writer 写盘 7.0 CHG 详情含多余字段 aliases → PostToolUse warning 含 'schema'
// V7B-7: 6.0 存量详情写盘 → 无 schema warning（skipped）
// V7B-8: Stop 对活跃 7.0 CHG 缺 parent-tasks key → repair warning
```

- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**：
1. post-tool-use.js：artifact 写盘分支（`/^changes\/.+\.md$/` 命中处）追加——kind 由 rel 推导（`changes/findings/` → finding、`changes/corrections/` → correction、其余 → chg），读盘 parseFrontmatter 后调 validateFrontmatterSchema，`!ok` 时 push warning：`` `${path.basename(filePath)} 不符合 v7 schema 合同：缺失 ${r.missing.join(', ') || '无'}；多余 ${r.unknown.join(', ') || '无'}。7.0 字段集见 artifact-writer-spec.md schema 表。` ``（artifact-writer 在跑时即时打回自修）
2. stop.js：活跃 entries 循环内对 `entry.detail.frontmatter` 调用同函数，`!ok` → `addWarning('repair', ...)` 同文案，`warnOnce` 键 `schema-violation-${entry.slug}`
3. collect-state.js：detectors 区追加同检测进 repair 注入（与 status-mismatch 同级）
4. finding/correction schema-version 存在性校验补全：grep 现有「schema-version 存在性校验」实现位置（仅 CHG 路径），将 finding/correction 写盘路径纳入同校验

- [ ] **Step 4: 全量基线绿**。**Step 5: Commit** `git commit -m "feat(v7): schema 合同三层接线（CHG-B T-002）"`

### Task B3: CHG-B 收口（同 A4 流程）

---

## CHG-C：agent 写端单写 + 7.0 字段模板 + 发布面同步

### Task C1: 4 instruction 单写改造

**Files:**
- Modify: `plugin/agent-references/instructions/create-chg.md:50,53,159,187`、`close-chg.md:86,98,149,152`、`update-chg.md`（grep implementation_plan 全部命中）、`archive-chg.md`（同）

- [ ] **Step 1**（文档无独立测试，验收靠 C3 e2e + agent-tests）：逐文件 Edit——
1. create-chg.md:50 删除「6. Read + Edit `implementation_plan.md` 添加索引行」整步（后续步骤序号顺延）；:53 改「本操作只触达详情文件与 `task.md` 一个索引」；:159 改「task.md 的索引行必须保留 `[worktree:: ...] [branch:: ...]`」；:187 batch 段「再写 task.md / implementation_plan.md 各一行」改「再写 task.md 一行」
2. close-chg.md:86 改「先 Read `task.md`」；:98 改「Read + Edit `task.md`，对应活跃索引 checkbox 改为 `[x]`」；:149 删除「Read implementation_plan.md 同上」；:152 改「从 `task.md` 的目标索引行提取执行上下文」
3. update-chg.md / archive-chg.md：grep `implementation_plan` 全部命中点同语义改造（双写步骤删半、文案单数化）
4. create-chg.md:69「frontmatter `id` 保持**纯 ID 不带 slug**」表述删除/改写——7.0 帧**无 id 字段**，ID 由文件名唯一承载（wikilink 全名+别名规则保留）
5. 全部 instruction 校验：`grep -rn "implementation_plan" plugin/agent-references/instructions/` 结果应为 0

- [ ] **Step 2: Commit** `git commit -m "feat(v7): 4 instruction 单写 task.md（CHG-C T-001）"`

### Task C2: 7.0 frontmatter 模板 + spec/agent.md/templates 同步

**Files:**
- Modify: `plugin/agent-references/artifact-writer-spec.md`（schema 表 + parent-impl 删除 + §5.1 索引行模板）、`plugin/agents/artifact-writer.md`、`plugin/skills/artifact-management/templates/*.md`、create-chg.md frontmatter 模板段

- [ ] **Step 1**: CHG 详情 7.0 frontmatter 模板统一为（写入 spec schema 表 + create-chg.md + templates/chg-detail 模板）：

```yaml
---
status: planned
date: 2026-06-11            # 创建日期（人读）
change-set: null            # 仅 batch 创建时非 null
change-set-seq: null
verified-date: null
reviewed-date: null
archived-date: null         # close/archive/取消归档时写入（人读）
parent-tasks: ["[[<artifact-dir-name>/task|task]]"]
schema-version: "7.0"
---
```

删除字段同步清理：spec 中 `chg-id`/`type`/`completed-date`/`aliases`/`tags`/`related-finding`/`parent-impl` 定义段删除；finding 模板帧改 `status`/`date`/`schema-version` 三字段；correction 模板帧改 `date`/`schema-version` 两字段（五文本字段只留正文 6 段，knowledge-link 走索引行 `[knowledge::]`）。

- [ ] **Step 2**: agent.md 同步——双写表述改单写；7.0 字段清单与 spec 一致（必填字段名清单保持自包含，D 期测试锁）。
- [ ] **Step 3**: guard 的 promptTemplateForOperation（grep `promptTemplateForOperation` 定位文件）中 deny 文案涉及 impl_plan/已删字段的同步。
- [ ] **Step 4**: cancelled 路径——archive-chg instruction 取消归档段补「写 `archived-date`」。
- [ ] **Step 5: Commit** `git commit -m "feat(v7): 7.0 frontmatter 模板与发布面同步（CHG-C T-002）"`

### Task C3: agent 链 e2e 语义更新

**Files:**
- Test: `tests/test-hooks-e2e.js`（批量创建 2196-2299、模板创建 2437-2610 区）、`tests/test-agent-tests-helpers.js`

- [ ] **Step 1**: 既有 agent 链测试改语义：create 后断言只有 task.md 有索引行（impl_plan 无新增行）；7.0 模板 fixture 替换旧 frontmatter fixture；guard 字段校验测试同步。新增：

```js
// V7C-1: create-chg 产物过 validateFrontmatterSchema（planned 态 ok）
// V7C-2: close-chg 产物（archived 态）含 archived-date 非 null 且 ok
```

- [ ] **Step 2**: 全量基线绿。**Step 3: Commit** + CHG-C 收口（同 A4 流程）。

---

## CHG-D：规范单源化——指针化 + 同义收敛 + 测试锁

### Task D1: 指针化（按 spec §4.1 权威位置矩阵）

**Files:**
- Modify: `plugin/skills/artifact-management/SKILL.md`（内部两份 close-chg 模板 L198+L461 → 保一删一改指针）、`plugin/skills/*/SKILL.md` helper 命令来源 4 步（保 pace-workflow，其余 3 个改指针）、`plugin/skills/artifact-management/references/{format-reference,change-lifecycle}.md` 状态映射表（改指针指 spec §4.1）、各 instruction CRLF/stale-read 块（spec 立单节，instruction 改一行指针）

- [ ] **Step 1**: 逐项执行矩阵。每项指针格式统一：`> 权威定义见 <文件>（本节不再复制，避免漂移）`+ 保留一行最小语义提示。**本步同时在 spec schema 表下方加机器可读注释行**（D2 的 V7D-3 测试解析用）：`<!-- schema-keys: chg = status,date,change-set,change-set-seq,verified-date,reviewed-date,archived-date,parent-tasks,schema-version | finding = status,date,schema-version | correction = date,schema-version -->`
- [ ] **Step 2**: D1 同义收敛——guard 中 `status-reason|block-reason|pause-reason` 三者任一放行的逻辑**不动**（宽容期）；所有文档（SKILL/instruction/spec）统一只写 `status-reason`：grep `block-reason\|pause-reason` 在 plugin/ 下的文档命中全部改 `status-reason`（guard JS 代码命中保留）。
- [ ] **Step 3**: D2 措辞——`templates/finding-detail.md` 段名注释加「推荐结构，record-finding body 为 opaque payload 时段名可异」。
- [ ] **Step 4: Commit** `git commit -m "refactor(v7): 规范单源化指针化 + status-reason 收敛（CHG-D T-001）"`

### Task D2: 三组一致性测试锁

**Files:**
- Test: `tests/test-agent-tests-helpers.js`（或新建 `tests/test-spec-consistency.js`，runner 形式照抄既有文件头）

- [ ] **Step 1: 写测试**（这组测试先写就该立即过——D1 已完成对齐；它们的价值是锁未来）：

```js
// V7D-1: agent.md close-chg 必填字段清单 ⊇ guard 实际校验集
//   实现：读 plugin/agents/artifact-writer.md 提取 close-chg 段字段名（正则提取反引号字段名），
//   读 guard 源码中 close-chg 的 required 数组字面量，断言集合包含关系
// V7D-2: guard deny 文案模板（promptTemplateForOperation）字段名集合 == 对应 instruction 模板字段集合
// V7D-3: spec schema 表字段集 == change-analysis.js SCHEMA_V7_KEYS 字面量
//   实现：spec 表用稳定标记行（如 `<!-- schema-keys: chg = ... -->` 注释行）供测试解析；
//   D1 在 spec schema 表下方加这行机器可读注释
```

- [ ] **Step 2**: 跑测试绿（不绿说明 D1 有漏改——修文档不修测试）。
- [ ] **Step 3: Commit** + CHG-D 收口。

---

## CHG-E：migrate-v7.js + 未迁移提示

### Task E1: migrate-v7.js 主体

**Files:**
- Create: `plugin/migrate/migrate-v7.js`
- Test: `tests/test-pace-utils.js` 新增 V7E 组（或独立 `tests/test-migrate-v7.js`）

- [ ] **Step 1: 写失败测试**：

```js
// V7E-1: dry-run 对 fixture vault 零写入（mtime/内容前后一致），输出报告含将删字段统计
// V7E-2: 执行后 CHG 详情 frontmatter == 7.0 合同（全量过 validateFrontmatterSchema）
// V7E-3: impl_plan 变 tombstone（含 <!-- ARCHIVE --> + 指向 task.md 文案；原 v5 尾巴消失）
// V7E-4: task.md v5 死尾巴段被清（归档区 v6 行保留）
// V7E-5: findings.md 三态重排（[x]/[-] 移 ARCHIVE 下，open 留活跃区）+ 表头含 [change::]
// V7E-6: 执行前备份目录 .pace/backups/v7-migration/<ts>/ 含全部被改文件原件
// V7E-7: archived 详情缺 archived-date → 从 walkthrough.md 索引行日期回填；walkthrough 无记录 → 用执行日，报告注明
// V7E-8: correction 索引 [knowledge:: project-only] → [scope:: project-only]；全角弯引号修复
```

fixture：测试内构造 mini vault（2 个 6.0 CHG 详情含全部待删字段 + task.md/impl_plan 带 v5 尾巴 + findings.md 三态混放 + 1 条脏 correction 索引行）。

- [ ] **Step 2: 确认失败**（脚本不存在）
- [ ] **Step 3: 实现**——`plugin/migrate/migrate-v7.js` 骨架（CLI 形式与 batch-archive-v5.js 对齐：`--cwd`/`--dry-run`/`--hygiene`，artifact_dir 经 pace-utils getArtifactDir 解析）：

```js
#!/usr/bin/env node
// v6→v7 artifact 迁移：frontmatter 瘦身到 7.0 封闭合同 + 双文件合并（impl_plan tombstone）
// + 索引卫生修复。spec: docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §5
const DROP_KEYS = {
  chg: ['chg-id', 'id', 'type', 'completed-date', 'aliases', 'tags', 'related-finding', 'parent-impl'],
  finding: ['finding-id', 'type', 'impact', 'summary', 'merges', 'merged-by', 'related-changes', 'rejection-reason', 'aliases', 'tags'],
  correction: ['correction-id', 'trigger-quote', 'wrong-behavior', 'correct-behavior', 'trigger-scenario', 'root-cause', 'knowledge-link', 'project-scope', 'aliases', 'tags'],
};
// 主流程：collect 详情文件 → 逐文件 rewriteFrontmatter（删 DROP_KEYS、补缺 key 置 null、
// schema-version → "7.0"、archived 无 archived-date 时从 walkthrough 回填）→ task.md 清 v5 尾巴
// → impl_plan 写 tombstone → findings.md 重排 → correction 索引修复 → 全量 validateFrontmatterSchema
// 验收（任一失败 → 还原备份并报错退出）→ 写 .pace/v7-migration-state → 输出报告
```

实现要点（完整写出，零猜测）：frontmatter 重写用「逐行处理 `---` 块」保持正文字节不动；删除 key 行、缺 key 在 `schema-version` 行前插入 `<key>: null`；YAML 数组多行值（aliases/tags/parent-tasks 可能多行）需吃掉续行（行首空白+`- `）；tombstone 全文固定为 spec §2.1 模板；备份为整目录 copy（仅被改文件）。

- [ ] **Step 4**: 测试绿。**Step 5: Commit** `git commit -m "feat(v7): migrate-v7 迁移脚本（CHG-E T-001）"`

### Task E2: 未迁移布局检测与提示

**Files:**
- Modify: `plugin/hooks/session-start/collect-state.js` + `layers.js`、`plugin/hooks/post-tool-use.js`
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1: 写失败测试**：

```js
// V7E-9: impl_plan 含活跃 CHG 索引行（非 tombstone）→ SessionStart 注入含 migrate-v7 完整命令
// V7E-10: impl_plan 是 tombstone 或不存在 → 无该提示
// V7E-11: 未迁移布局下 artifact 写盘 → PostToolUse 催办一次（session flag 防重复）
```

- [ ] **Step 2-3**: 实现——collect-state 检测函数 `detectUnmigratedV6Layout(cwd)`（**readActive** impl_plan——只看 ARCHIVE 上方活跃行；用 readFull 会把归档区旧行也算「未迁移」，全归档 vault 被永久催办。`parseChangeIndex(readActive(...))` 命中行即未迁移）；layers 注入文案含 `node "<hooks 同级 migrate/migrate-v7.js 绝对路径>" --dry-run`；post-tool-use 催办用新 flag `v7-migrate-reminded`（加入 SESSION_SCOPED_FLAGS）。
- [ ] **Step 4**: 全量基线绿。**Step 5: Commit** + CHG-E 收口。

---

## CHG-F：本 vault 迁移 + v7.0.0 发布

### Task F1: 本 vault 迁移执行

- [ ] **Step 1**: `node plugin/migrate/migrate-v7.js --cwd /mnt/k/AI/paceflow-hooks --dry-run` → 人工读报告（预期 ~108 文件、字段删除统计、archived-date 回填清单）
- [ ] **Step 2**: 真跑（无 --dry-run）→ 验收输出 100% 通过；`--hygiene` 跑卫生（6 备份删除、7 游离文档移 `_archive/`）
- [ ] **Step 3**: 抽查 3 个迁移产物（最老 CHG / 带 change-set 的 / cancelled 的）+ Obsidian 打开确认 properties 面板正常
- [ ] **Step 4: Commit**（vault 不在 git；commit 的是 migration-state 等 runtime 外的仓内变化，若无则跳过）

### Task F2: 发布闭环

- [ ] **Step 1**: `constants.js` PACE_VERSION → 'v7.0.0'；`plugin/.claude-plugin/plugin.json` version → "7.0.0"；README/REFERENCE 版本相关段同步
- [ ] **Step 2**: 全量基线五连绿
- [ ] **Step 3**: `git push` 后 `git rev-parse HEAD && git rev-parse origin/master` 双向确认（commit+push 链式陷阱防护）
- [ ] **Step 4**: 提示用户 reload → dogfood：新 session 注入无 impl_plan、create-chg 单写、schema 合同打回实测
- [ ] **Step 5**: CHG-F 收口 + 全 change-set 归档

---

## Self-Review 记录

- Spec 覆盖：§2 全消费点 → A1-A3；§3 字段表+合同 → B1/C2；§3.5 三层接线 → B2；§4 矩阵+收敛+测试锁 → D1/D2；§5 五步+提示 → E1/E2；§6 发布 → F2。无缺口。
- 占位符：无 TBD；文档类 task（C1/D1）以 grep 验证为收口标准。
- 类型一致：validateFrontmatterSchema 签名 B1/B2/E1 三处一致；getActiveChangeEntries 新 entry 形态（无 impl 字段）A1 定义、A2 消费一致；markIndexChangesTouchedAndMaybeRelease 保签名。
