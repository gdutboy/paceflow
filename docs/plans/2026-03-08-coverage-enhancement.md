# CHG-20260308-04 检查覆盖增强 + 指引补全 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增强 PACEflow 的 findings/walkthrough 检查覆盖率，从 <40% 提升到 75%+，并补全 compact 路径信息丢失和旧格式放行缺口。

**Architecture:** 新增 `findMissingFindingsDetails` 共享函数到 pace-utils.js，复用 H13 双层调用模式（PostToolUse 实时 + Stop 终态）。session-start.js compact 路径补充 knowledge L0 + FORMAT_SNIPPETS 注入。pre-tool-use.js 新增旧格式 DENY。pre-compact.js 快照扩展。

**Tech Stack:** Node.js, PACEflow hooks (pace-utils.js 公共库)

---

### Task 1: pace-utils.js — 新增 `findMissingFindingsDetails` + 导出

**Files:**
- Modify: `paceflow/hooks/pace-utils.js:291` (在 findMissingImplDetails 之后插入)
- Modify: `paceflow/hooks/pace-utils.js:384` (module.exports 追加)

**Step 1: 在 L291（findMissingImplDetails 函数结束）后插入新函数**

```javascript
/**
 * 检查 findings.md 全文中 [ ] 索引是否有对应 ### 详情段落
 * 匹配规则：索引标题前 8 字在详情 ### 行中子串匹配
 * @param {string} findingsFull - findings.md 全文
 * @returns {string[]} 缺少详情的标题列表
 */
function findMissingFindingsDetails(findingsFull) {
  if (!findingsFull) return [];
  const unresolved = findingsFull.match(/^- \[ \] ([^—\n]+)/gm) || [];
  if (unresolved.length === 0) return [];
  const detailHeaders = (findingsFull.match(/^### .+$/gm) || [])
    .map(h => h.replace(/^### (\[\d{4}-\d{2}-\d{2}\] )?/, ''));
  const missing = [];
  for (const line of unresolved) {
    const title = line.replace(/^- \[ \] /, '').trim();
    const key = title.length > 8 ? title.slice(0, 8) : title;
    if (!detailHeaders.some(dt => dt.includes(key))) {
      missing.push(title);
    }
  }
  return missing;
}
```

**Step 2: 在 module.exports 对象中追加 `findMissingFindingsDetails`**

在 L384 的 `module.exports = { ... findMissingImplDetails, getNativePlanPath }` 中，
在 `findMissingImplDetails` 后追加 `, findMissingFindingsDetails`。

**Step 3: 语法验证**

Run: `node -c paceflow/hooks/pace-utils.js`
Expected: `paceflow/hooks/pace-utils.js: Syntax OK`

**Step 4: Commit**

```bash
git add paceflow/hooks/pace-utils.js
git commit -m "feat(pace-utils): 新增 findMissingFindingsDetails 函数 — findings [ ] 索引 vs ### 详情匹配"
```

---

### Task 2: 单元测试 — findMissingFindingsDetails

**Files:**
- Modify: `paceflow/tests/test-pace-utils.js` (追加测试用例)

**Step 1: 在 test-pace-utils.js 末尾（process.exit 前）追加测试**

```javascript
// === findMissingFindingsDetails ===
(function testFindMissingFindingsDetails() {
  const { findMissingFindingsDetails } = require('../hooks/pace-utils');
  let pass = 0, fail = 0;

  // 1. 空输入
  assert(findMissingFindingsDetails(null).length === 0, 'null 输入返回空数组');
  assert(findMissingFindingsDetails('').length === 0, '空字符串返回空数组');
  pass += 2;

  // 2. 无 [ ] 索引
  assert(findMissingFindingsDetails('- [x] 已完成 — 结论').length === 0, '无 [ ] 返回空');
  pass += 1;

  // 3. 有 [ ] 索引，有对应详情
  const withDetail = `- [ ] knowledge 注入问题 — 结论\n\n## 未解决问题\n\n### [2026-03-08] knowledge 注入问题\n\n内容...`;
  assert(findMissingFindingsDetails(withDetail).length === 0, '有详情返回空');
  pass += 1;

  // 4. 有 [ ] 索引，缺少详情
  const noDetail = `- [ ] knowledge 注入问题 — 结论\n\n## 未解决问题\n`;
  const missing = findMissingFindingsDetails(noDetail);
  assert(missing.length === 1, '缺详情返回 1 项');
  assert(missing[0].startsWith('knowledge'), '标题正确');
  pass += 2;

  // 5. 多个 [ ] 索引，部分有详情
  const mixed = `- [ ] 问题一号标题 — 结论1\n- [ ] 问题二号标题 — 结论2\n\n### [2026-03-08] 问题一号标题\n\n详情`;
  const mixedMissing = findMissingFindingsDetails(mixed);
  assert(mixedMissing.length === 1, '只缺 1 个');
  assert(mixedMissing[0].startsWith('问题二号'), '缺的是问题二');
  pass += 2;

  // 6. [x]/[-] 不检查
  const doneItems = `- [x] 已完成 — ok\n- [-] 已跳过 — reason\n`;
  assert(findMissingFindingsDetails(doneItems).length === 0, '[x]/[-] 不检查');
  pass += 1;

  console.log(`findMissingFindingsDetails: ${pass} passed`);
})();
```

**Step 2: 运行单元测试**

Run: `cd paceflow && node tests/test-pace-utils.js`
Expected: 全部 passed（含新增的 9 个 findMissingFindingsDetails 用例）

**Step 3: Commit**

```bash
git add paceflow/tests/test-pace-utils.js
git commit -m "test: findMissingFindingsDetails 9 个单元测试"
```

---

### Task 3: post-tool-use.js — H14 findings 详情检查

**Files:**
- Modify: `paceflow/hooks/post-tool-use.js:177` (在 H8 "保持现状"检测后、else 分支前插入)

**Step 1: 在顶部 destructure 中确认导入 `findMissingFindingsDetails`**

在已有的 `const { ... findMissingImplDetails ... } = paceUtils;` 行中追加 `findMissingFindingsDetails`。

**Step 2: 在 L177（`keepCount` 检查块的 `}` 之后）插入 H14**

```javascript
      // H14: findings 详情完整性检查（仿 H13，每次编辑 findings 都触发）
      if (fileName === 'findings.md' && newString && /^- \[ \] /m.test(newString)) {
        const findingsFull = readFull(cwd, 'findings.md');
        if (findingsFull) {
          const missingDetails = findMissingFindingsDetails(findingsFull);
          if (missingDetails.length > 0) {
            const display = missingDetails.length <= 2
              ? missingDetails.join('；')
              : missingDetails[0] + ` 等 ${missingDetails.length} 个`;
            warnings.push(`findings.md 有 [ ] 索引缺少详情段落：${display}。请在"## 未解决问题"下补充"### [日期] 标题"记录问题背景和修复方向`);
          }
        }
      }
```

**Step 3: 语法验证**

Run: `node -c paceflow/hooks/post-tool-use.js`
Expected: Syntax OK

**Step 4: Commit**

```bash
git add paceflow/hooks/post-tool-use.js
git commit -m "feat(post-tool-use): H14 findings 详情检查 — Edit findings 新增 [ ] 时检测对应 ### 详情"
```

---

### Task 4: stop.js — findings 详情终态 + 过期检测 + 日期容错

**Files:**
- Modify: `paceflow/hooks/stop.js:99` (impl_plan 详情检查后插入 findings 检查)
- Modify: `paceflow/hooks/stop.js:107` (walkthrough 日期正则容错)

**Step 1: 在顶部 destructure 中追加 `findMissingFindingsDetails`**

**Step 2: 在 L99（impl_plan 详情检查 `}` 后）插入 findings 详情终态检查**

```javascript
  // v5.0.2: findings.md 详情终态检查 — [ ] 索引必须有 ### 详情
  const findingsFull = readFull(cwd, 'findings.md');
  if (findingsFull) {
    const missingDetails = findMissingFindingsDetails(findingsFull);
    if (missingDetails.length > 0) {
      const display = missingDetails.length <= 2
        ? missingDetails.join('；')
        : missingDetails[0] + ` 等 ${missingDetails.length} 个`;
      warnings.push(`findings.md 有 ${missingDetails.length} 个 [ ] 索引缺少详情段落：${display}，请补充`);
    }
  }

  // v5.0.2: findings 过期检测（>14 天的 [ ] 项）
  const findingsActive = readActive(cwd, 'findings.md');
  if (findingsActive) {
    const agedMatches = [...findingsActive.matchAll(/^- \[ \] .+\[date:: (\d{4}-\d{2}-\d{2})\]/gm)];
    const now = Date.now();
    const agedCount = agedMatches.filter(m => {
      return (now - new Date(m[1]).getTime()) / 86400000 >= 14;
    }).length;
    if (agedCount > 0) {
      warnings.push(`findings.md 有 ${agedCount} 个超过 14 天的开放项，请决议（采纳/否定/保持现状）`);
    }
  }
```

**Step 3: 修改 walkthrough 日期正则容错（原 L107 附近）**

将：
```javascript
const detailDates = [...walkActive.matchAll(/\*\*(?:追加)?时间\*\*:\s*(\d{4}-\d{2}-\d{2})/g)];
```
改为：
```javascript
const detailDates = [...walkActive.matchAll(/\*\*(?:追加)?时间\*\*:\s*(\d{4})-(\d{1,2})-(\d{1,2})/g)]
  .map(m => ({ full: `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` }));
```
对应地，将 `detailDates.some(m => m[1] === today)` 改为 `detailDates.some(m => m.full === today)`。

同样修改 indexDates 正则：
```javascript
const indexDates = [...walkActive.matchAll(/^\| (\d{4})-(\d{1,2})-(\d{1,2}) \|/gm)]
  .map(m => ({ full: `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` }));
```
对应 `indexDates.some(m => m[1] === today)` 改为 `indexDates.some(m => m.full === today)`。
以及 `allDates` 收集处相应改为 `.map(m => m.full)`。

**Step 4: 语法验证**

Run: `node -c paceflow/hooks/stop.js`
Expected: Syntax OK

**Step 5: Commit**

```bash
git add paceflow/hooks/stop.js
git commit -m "feat(stop): findings 详情终态+过期检测+walkthrough 日期前导零容错"
```

---

### Task 5: session-start.js — compact 路径 knowledge + 格式注入

**Files:**
- Modify: `paceflow/hooks/session-start.js:79` (compact 路径快照输出后追加格式)
- Modify: `paceflow/hooks/session-start.js:271-284` (移除 compact 守卫)

**Step 1: 在 compact 路径（L79 `process.stdout.write(lines.join...` 后）追加格式提示**

在 L79 行之后、L80 `try { fs.unlinkSync(snapFile) }` 之前插入：

```javascript
      // v5.0.2: compact 恢复后注入格式快速参考
      if (paceSignal) {
        process.stdout.write(`\n=== 格式快速参考 ===\n`);
        process.stdout.write(`任务格式：${FORMAT_SNIPPETS.taskEntry}\n`);
        process.stdout.write(`索引格式：${FORMAT_SNIPPETS.implIndex}\n`);
        process.stdout.write(`状态说明：${FORMAT_SNIPPETS.statusHelp}\n\n`);
      }
      // v5.0.2: compact 恢复 snapshot.findings/walkthrough
      if (snap.findings) {
        process.stdout.write(`findings 状态：${snap.findings.openCount} 个开放项\n`);
      }
      if (snap.walkthrough && !snap.walkthrough.hasTodayEntry) {
        process.stdout.write(`⚠️ compact 前 walkthrough 无今日记录\n`);
      }
```

**Step 2: 修改 knowledge 注入（L271-284）— 移除 compact 守卫**

将 L272 `if (eventType !== 'compact') {` 改为无条件执行，但 compact 时限制 3 条：

```javascript
// v5.0.2: 相关 thoughts/knowledge 注入（startup 5 条，compact 3 条）
try {
  const projectName = getProjectName(cwd);
  const notes = scanRelatedNotes(projectName);
  if (notes.length > 0) {
    const maxNotes = eventType === 'compact' ? 3 : 5;
    process.stdout.write(`=== 相关讨论 (thoughts/ + knowledge/) ===\n`);
    notes.slice(0, maxNotes).forEach(n => {
      process.stdout.write(`[${n.status}] ${n.title}${n.summary ? ' — "' + n.summary + '"' : ''}\n`);
    });
    process.stdout.write('\n');
  }
} catch(e) {}
```

删除原来 L272 的 `if (eventType !== 'compact') {` 和 L284 对应的 `}`。

**Step 3: 语法验证**

Run: `node -c paceflow/hooks/session-start.js`
Expected: Syntax OK

**Step 4: Commit**

```bash
git add paceflow/hooks/session-start.js
git commit -m "feat(session-start): compact 路径 knowledge L0 注入+格式提示+快照字段输出"
```

---

### Task 6: pre-tool-use.js — 旧格式 DENY + C 阶段微调

**Files:**
- Modify: `paceflow/hooks/pre-tool-use.js:191` (impl_plan 详情守门后插入旧格式 DENY)
- Modify: `paceflow/hooks/pre-tool-use.js:285` (C 阶段消息微调)

**Step 1: 在 L191（impl_plan 创建阶段守门 `}` 后、L193 native plan 桥接前）插入旧格式 DENY**

```javascript
  // v5.0.2: impl_plan 旧格式检测 DENY — 阻止在 emoji/表格格式基础上编辑
  if (toolName === 'Edit' && paceSignal && fileName === 'implementation_plan.md') {
    const implFull = readFull(cwd, 'implementation_plan.md');
    if (implFull) {
      const archiveMatch = implFull.match(/^<!-- ARCHIVE -->$/m);
      const implActive = archiveMatch ? implFull.slice(0, archiveMatch.index) : implFull;
      const hasEmoji = /[✅❌📋🔄⏳]/.test(implActive);
      const hasTable = /^\|.+\|$/m.test(implActive) && !/^- \[.\]/m.test(implActive);
      if (hasEmoji || hasTable) {
        const format = hasEmoji ? 'emoji 状态标记' : '表格格式';
        const reason = `implementation_plan.md 活跃区检测到旧的${format}，hook 无法识别。请先将内容迁移到新格式再编辑。\n索引格式：${FORMAT_SNIPPETS.implIndex}\n详情格式：${FORMAT_SNIPPETS.implDetail}\n${FORMAT_SNIPPETS.skillRef}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(`[${ts()}] PreToolUse  | cwd: ${cwd}\n  action: DENY_OLD_FORMAT${teammateTag} | file: ${filePath} | format: ${format}\n`);
        return;
      }
    }
  }
```

**Step 2: 微调 L285 C 阶段 DENY 消息**

在现有 reason 字符串末尾（`${FORMAT_SNIPPETS.statusHelp}` 后）追加：
```
\n⚠️ 请直接询问用户是否批准当前计划，而非反复尝试写代码。
```

**Step 3: 语法验证**

Run: `node -c paceflow/hooks/pre-tool-use.js`
Expected: Syntax OK

**Step 4: Commit**

```bash
git add paceflow/hooks/pre-tool-use.js
git commit -m "feat(pre-tool-use): impl_plan 旧格式 DENY + C 阶段用户引导增强"
```

---

### Task 7: pre-compact.js — 快照扩展 findings + walkthrough

**Files:**
- Modify: `paceflow/hooks/pre-compact.js:48` (runtime 赋值后、native plan 捕获前插入)

**Step 1: 在 L48（`snapshot.runtime = {...};` 后）插入 findings + walkthrough 快照**

```javascript
  // v5.0.2: 快照扩展 findings + walkthrough 状态
  try {
    const findingsActive = readActive(cwd, 'findings.md');
    if (findingsActive) {
      const openCount = (findingsActive.match(/^- \[ \] /gm) || []).length;
      const warningCount = (findingsActive.match(/⚠️/g) || []).length;
      snapshot.findings = { openCount, warningCount };
    }
  } catch(e) {}
  try {
    const walkActive = readActive(cwd, 'walkthrough.md');
    if (walkActive) {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const hasTodayEntry = walkActive.includes(today);
      snapshot.walkthrough = { hasTodayEntry };
    }
  } catch(e) {}
```

**Step 2: 语法验证**

Run: `node -c paceflow/hooks/pre-compact.js`
Expected: Syntax OK

**Step 3: Commit**

```bash
git add paceflow/hooks/pre-compact.js
git commit -m "feat(pre-compact): 快照扩展 findings openCount/warningCount + walkthrough hasTodayEntry"
```

---

### Task 8: E2E 测试 — 新增 3-4 个测试

**Files:**
- Modify: `paceflow/tests/test-hooks-e2e.js` (追加新测试)

**Step 1: 新增 E2E #58 — post-tool-use H14 findings 详情检查**

测试场景：Edit findings.md 添加 `- [ ]` 索引但无 `###` 详情 → 应输出 HINT 包含"缺少详情段落"。

**Step 2: 新增 E2E #59 — stop.js findings 详情终态检查**

测试场景：findings.md 有 `- [ ]` 索引无 `###` 详情 + task.md 有 `[x]` → stop 输出应包含"缺少详情段落"。

**Step 3: 新增 E2E #60 — pre-tool-use 旧格式 DENY**

测试场景：impl_plan 活跃区含 emoji `✅` → Edit impl_plan → 应 DENY 包含"旧的emoji 状态标记"。

**Step 4: 新增 E2E #61 — pre-tool-use 旧格式放行（正常格式）**

测试场景：impl_plan 活跃区为正常 checkbox 格式 → Edit impl_plan → 应放行。

**Step 5: 运行全部 E2E**

Run: `cd paceflow && node tests/test-hooks-e2e.js`
Expected: 全部 passed（57 + 4 = 61）

**Step 6: Commit**

```bash
git add paceflow/tests/test-hooks-e2e.js
git commit -m "test: E2E #58-61 — findings 详情检查+旧格式 DENY/ALLOW"
```

---

### Task 9: 版本号 + PACE_VERSION + 全量验证

**Files:**
- Modify: `paceflow/hooks/pace-utils.js:6` (PACE_VERSION 更新)

**Step 1: PACE_VERSION 从 `5.0.1` 改为 `5.0.2`**

**Step 2: 全量验证**

Run:
```bash
cd paceflow
for f in hooks/*.js; do node -c "$f"; done
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
node verify.js
```

Expected:
- 语法 8/8
- 单元测试全部 passed（含新增 9 个 findMissingFindingsDetails）
- E2E 61/61
- verify 4/8（plugin 模式预期）

**Step 3: Commit**

```bash
git add paceflow/hooks/pace-utils.js
git commit -m "chore: PACE_VERSION v5.0.1 → v5.0.2"
```
