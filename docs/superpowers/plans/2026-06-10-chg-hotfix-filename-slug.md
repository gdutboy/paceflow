# CHG/HOTFIX 文件名 slug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** CHG/HOTFIX 详情文件名追加描述性 slug（`chg-yyyymmdd-nn-slug.md`），对称 finding/correction；frontmatter ID / wikilink / 索引标题不变。

**Architecture:** 稳定 ID（`CHG-YYYYMMDD-NN`）与文件名解耦——reservation 改用 `filePrefix`（带 slug 占位，复用 correction 范式），`detailPathForId` 从精确拼接改 glob。

**Tech Stack:** Node.js CommonJS hooks；自定义 test runner（`tests/test-utils.js`）+ `node:assert`。

依据 spec：`docs/superpowers/specs/2026-06-10-chg-hotfix-filename-slug-design.md`（范围决策 B + A）。

---

## File Structure

| 文件 | 改动 |
|---|---|
| `plugin/hooks/pace-utils/change-id.js` | `detailPathForId` 精确拼接 → glob（加 `fs`）|
| `plugin/hooks/pace-utils/locks.js` | `reserveArtifactIds` CHG/HOTFIX 分支 `fileRel` → `filePrefix`（701-703）；`reservationMatchesArtifactRel` CHG/HOTFIX 改前缀匹配（735-738）|
| `plugin/agent-references/instructions/create-chg.md` | `reserved-file` → `reserved-file-prefix`；文件名 `chg-id.md` → `chg-id-<slug>.md` + slug 生成说明 |
| `tests/test-pace-utils.js` | `detailPathForId` glob 单测 |
| `tests/test-hooks-e2e.js` | reserve CHG 输出 `reserved-file-prefix` + 兼容回归 e2e |

**自动跟随不需改**：`reserve-artifact-id.js`（`formatReservationBlock`:95-98 已把 `filePrefix` 输出成 `reserved-file-prefix`；`reservationConsumed`:55-63 已处理 `filePrefix` 的 readdirSync startsWith）。

---

## Task 1: `detailPathForId` 改 glob（基础——让带 slug 文件可被 readChangeDetail 找到）

**Files:**
- Modify: `plugin/hooks/pace-utils/change-id.js:1,8-15`
- Test: `tests/test-pace-utils.js`（`detailPathForId` 段，新增）

- [ ] **Step 1: 写失败测试**

`tests/test-pace-utils.js` 顶部解构确认含 `detailPathForId`（`pace-utils.js:935` 已 export）；若测试文件未解构，追加。然后新增段：

```js
console.log('\n--- detailPathForId (slug glob) ---');

test('detailPathForId：旧无 slug 文件 chg-id.md 命中', () => {
  const dir = makeTmpDir('dp-old');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-01.md'), '# old');
  assert.strictEqual(detailPathForId(dir, 'CHG-20260101-01'), path.join(dir, 'changes', 'chg-20260101-01.md'));
});

test('detailPathForId：新带 slug 文件 chg-id-slug.md 命中', () => {
  const dir = makeTmpDir('dp-slug');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-02-some-feature.md'), '# new');
  assert.strictEqual(detailPathForId(dir, 'CHG-20260101-02'), path.join(dir, 'changes', 'chg-20260101-02-some-feature.md'));
});

test('detailPathForId：精确优先于 glob（同时存在取精确无 slug）', () => {
  const dir = makeTmpDir('dp-both');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-03.md'), '# exact');
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-03-x.md'), '# slug');
  assert.strictEqual(detailPathForId(dir, 'CHG-20260101-03'), path.join(dir, 'changes', 'chg-20260101-03.md'));
});

test('detailPathForId：HOTFIX 带 slug 命中', () => {
  const dir = makeTmpDir('dp-hotfix');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'hotfix-20260101-01-urgent-fix.md'), '# hf');
  assert.strictEqual(detailPathForId(dir, 'HOTFIX-20260101-01'), path.join(dir, 'changes', 'hotfix-20260101-01-urgent-fix.md'));
});

test('detailPathForId：文件不存在回退精确路径（fail-safe）', () => {
  const dir = makeTmpDir('dp-missing');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  assert.strictEqual(detailPathForId(dir, 'CHG-20260101-04'), path.join(dir, 'changes', 'chg-20260101-04.md'));
});

test('detailPathForId：非法 id 返回 null', () => {
  const dir = makeTmpDir('dp-bad');
  assert.strictEqual(detailPathForId(dir, 'not-an-id'), null);
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `node tests/test-pace-utils.js`
Expected: 「新带 slug 文件命中」「HOTFIX 带 slug 命中」FAIL（当前精确拼接 `chg-20260101-02.md` ≠ 实际 `chg-20260101-02-some-feature.md`）；旧/精确/missing/非法 测试 PASS。

- [ ] **Step 3: 实现 glob**

`change-id.js` 顶部加 `fs`：
```js
const path = require('path');
const fs = require('fs');
```

`detailPathForId`（8-15）改为：
```js
function detailPathForId(artDir, id) {
  if (!id) return null;
  const lower = id.toLowerCase();
  if (!/^chg-\d{8}-\d{2}$/.test(lower) && !/^hotfix-\d{8}-\d{2}$/.test(lower)) return null;
  const changesDir = path.join(artDir, 'changes');
  const exact = path.join(changesDir, `${lower}.md`);
  // 旧无 slug 文件：精确命中优先（向后兼容，不迁移）。
  if (fs.existsSync(exact)) return exact;
  // 新带 slug 文件：glob `chg-yyyymmdd-nn-<slug>.md`。nn 两位 + 后跟 `-`，不误匹配相邻序号。
  try {
    const prefix = `${lower}-`;
    const matches = fs.readdirSync(changesDir).filter(f => f.startsWith(prefix) && f.endsWith('.md')).sort();
    if (matches.length > 0) return path.join(changesDir, matches[0]); // 正常一 ID 一文件；多匹配取第一（sort 稳定）
  } catch (e) {}
  // 都没有 → 回退精确路径，让 readChangeDetail 的 readFileSync 走 missing 分支（fail-safe，等价旧行为）。
  return exact;
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `node tests/test-pace-utils.js`
Expected: `detailPathForId` 段全 PASS。其余既有单测全 PASS。

- [ ] **Step 5: 兼容核对 + commit**

Run: `node tests/test-hooks-e2e.js`（确认现有 readChangeDetail 依赖的 e2e——活跃 CHG 摘要/状态读取——不退化，旧 `chg-id.md` 仍被精确分支命中）。
```bash
git add plugin/hooks/pace-utils/change-id.js tests/test-pace-utils.js
git commit -m "feat(chg-slug): detailPathForId 改 glob——兼容带 slug 新文件 + 精确旧文件（CHG-slug T-1）"
```

---

## Task 2: reservation 改用 `filePrefix`（CHG/HOTFIX 带 slug 占位）

**Files:**
- Modify: `plugin/hooks/pace-utils/locks.js:701-703`（生成）、`:735-738`（匹配校验）
- Test: `tests/test-hooks-e2e.js`（reserve CHG 输出 `reserved-file-prefix`）

> 执行前核对：`rg -n "fileRel" plugin/hooks/` 找出所有依赖 CHG `fileRel` 的点。已知 `reservationConsumed`(reserve-artifact-id.js:54-63) 和 `formatReservationBlock`(94-98) 都已同时处理 `fileRel`/`filePrefix`，改后自动走 `filePrefix` 分支。**重点核对 `plugin/hooks/agent-lifecycle-guard.js`**（artifact-writer 派遣校验）是否硬校验 create-chg 的 `reserved-file`（精确）——若是，需放宽为 `reserved-file-prefix`（前缀），与 record-correction 校验一致。

- [ ] **Step 1: 写失败测试**

`tests/test-hooks-e2e.js` 末尾追加（reserve create-chg 应输出 `reserved-file-prefix` 而非 `reserved-file`）：
```js
// CHG-slug T-2：reserve create-chg 输出 reserved-file-prefix（带 slug 占位，对称 correction）
test('T-2：reserve create-chg 输出 reserved-file-prefix 含 <slug> 占位', () => {
  const dir = makeTmpDir('t2-reserve-prefix');
  // 该 helper 需要 PACE 项目 + artifact-root 已定；造 changes/ 强信号 + 本地 root。
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  const r = runReserveHelper({ cwd: dir, args: ['--operation', 'create-chg'], env: { PACE_VAULT_PATH: '' } });
  assert.match(r.stdout, /reserved-file-prefix: changes\/chg-\d{8}-\d{2}-<slug>\.md/, 'CHG 应输出 reserved-file-prefix 带 <slug> 占位');
  assert.doesNotMatch(r.stdout, /reserved-file: changes\/chg-\d{8}-\d{2}\.md/, '不应再输出精确 reserved-file');
});
```
> 若 e2e 无 `runReserveHelper`，参照现有 `runSetArtifactRootHelper`/`runReserveHelper` 惯例加一个 spawnSync runner（指向 `RESERVE_ARTIFACT_ID_SCRIPT`，传 `CLAUDE_PROJECT_DIR`/`CLAUDE_CODE_SESSION_ID`）。`grep -n "reserve" tests/test-hooks-e2e.js` 看是否已有。

- [ ] **Step 2: 跑测试看失败**

Run: `node tests/test-hooks-e2e.js`
Expected: T-2 FAIL（当前输出 `reserved-file: changes/chg-...md` 精确，无 `reserved-file-prefix`）。

- [ ] **Step 3: 实现——locks.js CHG/HOTFIX 改 filePrefix**

`locks.js:701-703`（CHG/HOTFIX 生成，确认 `lower`=kind 小写 / `dateCompact`=yyyymmdd / `nn`=两位序号）：
```js
        const fileRel = `changes/${lower}-${dateCompact}-${nn}.md`;
        const written = writeArtifactReservation(cwd, owner, { operation, kind, id, fileRel });
        return { reserved: true, operation, kind, id, fileRel, path: written.path };
```
改为（`fileRel` → `filePrefix`，末尾 `-` 留 slug 占位，对称 correction:716-718）：
```js
        const filePrefix = `changes/${lower}-${dateCompact}-${nn}-`;
        const written = writeArtifactReservation(cwd, owner, { operation, kind, id, filePrefix });
        return { reserved: true, operation, kind, id, filePrefix, path: written.path };
```

`locks.js:735-738`（CHG/HOTFIX 匹配校验，当前精确）：
```js
    if (reservation.fileRel && /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(rel)) {
      return rel === reservation.fileRel
        ? { ok: true }
        : { ok: false, expected: reservation.fileRel, actual: rel };
    }
```
改为（前缀匹配，对称 correction:740-743）：
```js
    if (reservation.filePrefix && /^changes\/(?:chg|hotfix)-\d{8}-\d{2}-.+\.md$/i.test(rel)) {
      return rel.startsWith(reservation.filePrefix) && rel.endsWith('.md')
        ? { ok: true }
        : { ok: false, expected: `${reservation.filePrefix}<slug>.md`, actual: rel };
    }
```

- [ ] **Step 4: 跑测试看通过**

Run: `node tests/test-hooks-e2e.js && node tests/test-pace-utils.js`
Expected: T-2 PASS。若 `agent-lifecycle-guard` 核对发现硬校验 `reserved-file`，按上方 note 放宽，并跑 `node tests/test-agent-tests-helpers.js` 确认 create-chg 派遣校验不退化。

- [ ] **Step 5: commit**
```bash
git add plugin/hooks/pace-utils/locks.js tests/test-hooks-e2e.js
git commit -m "feat(chg-slug): reservation CHG/HOTFIX 改 filePrefix——reserve 输出 reserved-file-prefix（CHG-slug T-2）"
```

---

## Task 3: create-chg.md instruction——reserved-file-prefix + slug 文件名

**Files:** Modify `plugin/agent-references/instructions/create-chg.md`（输入字段 L16-17、步骤 L45/48、CHG-ID 推算段）

- [ ] **Step 1: 改输入字段**

L16-17：
```text
reserved-id: <reserve helper 输出>
reserved-file: <reserve helper 输出>
```
改为：
```text
reserved-id: <reserve helper 输出>
reserved-file-prefix: <reserve helper 输出，形如 changes/chg-yyyymmdd-nn-，末尾 <slug>.md 占位由你按 title 生成>
```

- [ ] **Step 2: 改文件写入步骤 + slug 生成说明**

L48 `Write changes/chg-yyyymmdd-nn.md` 改为：
```text
4. 按 title 生成描述性 slug（英文 kebab-case，中文 title 语义概括为英文，长度/去特殊字符规则同 record-correction），Write `changes/chg-yyyymmdd-nn-<slug>.md`（用 reserved-file-prefix 拼上你生成的 slug + `.md`；详情文件结构见下）。frontmatter `id:` 仍为纯 `CHG-YYYYMMDD-NN`（不含 slug）。
```

在「CHG-ID 推算」段后补一句（参照 record-correction.md 的 slug 段——执行前 `rg -n "slug" plugin/agent-references/instructions/record-correction.md` 抄其措辞）：
```text
**文件名 slug（对称 finding/correction）**：reserved-file-prefix 形如 `changes/chg-yyyymmdd-nn-`，你按 title 生成 slug 补上 `<slug>.md`。slug 只进文件名——frontmatter `id` 与 task.md/implementation_plan.md 索引行 wikilink `[[chg-yyyymmdd-nn]]` 都保持**纯 ID 不带 slug**（索引行标题已含描述，wikilink 无需 slug）。
```

> wikilink 模板 L106/135/145 的 `[[chg-yyyymmdd-nn]]` **保持不变**（纯 ID）。

- [ ] **Step 3: 验证 instruction 一致性**

Run: `claude plugin validate ./plugin`（确认 instruction 文件无格式破坏）。
人工核对：create-chg.md 不再出现裸 `reserved-file:`（除 prefix）、文件名模板含 `<slug>`、wikilink 仍纯 ID。
```bash
rg -n "reserved-file|chg-yyyymmdd-nn" plugin/agent-references/instructions/create-chg.md
```

- [ ] **Step 4: 同步 batch create 块说明**

create-chg.md L159-183 的 batch 段同理：每块 `reserved-id` 不变，文件写 `chg-yyyymmdd-nn-<slug>.md`。若 batch 段显式写了 `changes/<id>.md`，补 slug 说明。

- [ ] **Step 5: commit**
```bash
git add plugin/agent-references/instructions/create-chg.md
git commit -m "feat(chg-slug): create-chg 用 reserved-file-prefix + 按 title 生成文件名 slug（CHG-slug T-3）"
```

---

## Task 4: 端到端验证 + 兼容回归

**Files:** Test `tests/test-hooks-e2e.js`（兼容回归）；`tests/test-agent-tests-helpers.js`（若有 create-chg agent 测试场景）

- [ ] **Step 1: 兼容回归测试**

`tests/test-hooks-e2e.js` 末尾追加（旧无 slug CHG 仍能被读取——锁定不退化）：
```js
// CHG-slug T-4：兼容回归——旧无 slug chg-id.md 仍被 readChangeDetail/detailPathForId 找到
test('T-4：旧无 slug CHG 文件仍可读（不退化）', () => {
  const dir = makeTmpDir('t4-compat');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-01.md'), '---\nid: CHG-20260101-01\nstatus: completed\n---\n# 旧 CHG\n');
  const pu = require('../plugin/hooks/pace-utils');
  const detail = pu.readChangeDetail(dir, 'CHG-20260101-01');
  assert.ok(detail && !detail.missing, '旧无 slug CHG 应被 readChangeDetail 找到');
  assert.match(detail.content, /旧 CHG/);
});
```

- [ ] **Step 2: 跑全量验证**

Run:
```bash
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
node tests/test-agent-tests-helpers.js
claude plugin validate ./plugin
git diff --check
```
Expected: 全绿。T-4 PASS（旧文件不退化）。

- [ ] **Step 3: commit**
```bash
git add tests/test-hooks-e2e.js
git commit -m "test(chg-slug): 兼容回归——旧无 slug CHG 文件不退化（CHG-slug T-4）"
```

- [ ] **Step 4: push 后 dogfood（reload 后）**

按记忆 `plugin-cache-from-git-remote`：create-chg 的 slug 生成走 artifact-writer cache 版，需 push + reload 才能 live 验证「新建 CHG 真的带 slug 文件名」。push 后下一个真实 create-chg 即可观测（changes/ 目录出现 `chg-yyyymmdd-nn-slug.md`），列为 push 后跟进项。

---

## 实现顺序与依赖

T-1（detailPathForId glob，基础，让带 slug 文件可读）→ T-2（reservation filePrefix）→ T-3（create-chg slug 文件名）→ T-4（验证）。T-1 独立可验；T-3 依赖 T-1（glob 能找到新文件）+ T-2（reserved-file-prefix）。

## 向后兼容总结

稳定 ID 不变 → `update-chg`/`close-chg`/`archive-chg` target 不受影响；wikilink 纯 ID 不变 → `parseChangeIndex`/归档逻辑/索引行不受影响；旧 CHG 文件 glob 兼容不迁移；`detailPathForId` 唯一解析点，改一处全局兼容。
