# SessionStart 注入质量修复 Implementation Plan

> For agentic workers. 每个 task 严格 TDD（先写失败测试 → 跑看红 → 实现 → 跑看绿 → commit）。layers.js / collect-state.js / pace-utils.js 均为可单测的纯/半纯函数；优先 fixture 单测（快、稳），仅真实 git 子进程行为用临时 repo。

## Goal

修复本会话 SessionStart 注入审计发现的 9 项内容质量问题（N1/M2/M1/E3/E4/C2/F3 + E1/E2 结构性残余）。每项的共性根因是「代码/注入假设的状态 ≠ 真实产物状态」（spec §5）。不动门控逻辑、不新增 deny 路径；最坏失败是「注入仍不理想」，不阻断开发、不毁 artifact。

E1/E2 的**存量**部分（vault `spec.md` 版本号、`injection-wrap-backlog` finding 标 `[x]`）已由主 session 立即修，本计划不重复存量；只处理 E1/E2 的结构性残余（模板 spec.md 核对 + finding 维护机制评估）。

## Architecture

注入管线三段式：
- `collect-state.js` `collectState(cwd, ...)` 读磁盘 → 产出纯数据 `state`（含 `state.git` / `state.relatedNotes` / `state.activeChangeSummaries`）。
- `layers.js` `buildLayers(state, eventType, paceUtils, group)` 纯函数 → 分层文本 `{ l1head, l0, l1, l2, l3 }`，内部各 `render*` 子函数（纯）。
- `budget.js` `assembleWithBudget` 装配 + 截断。

本计划只动 `collect-state.js`（M1 `collectGit`）、`layers.js`（N1/M2/E3/E4/C2/M1 `renderGit`）、`pace-utils.js`（F3 `getArtifactDir`）、`plugin/hooks/templates/spec.md`（E1/E3 模板核对）。

## Tech Stack

- Node.js（CommonJS），无构建步骤；hook 是裸 node 脚本。
- 测试：`node:assert` + 自研 `createTestRunner`（`tests/test-utils.js`），无第三方 runner。
- 验证命令：
  - `node tests/test-session-layers.js`（layers 纯函数 + collectGit 单测）
  - `node tests/test-pace-utils.js`（getArtifactDir 单测）
  - `node tests/test-hooks-e2e.js`（端到端，确保未回归）
  - `claude plugin validate ./plugin`（发布面校验）

## File Structure（每个 modify 文件 + 职责）

| 文件 | 改动 | 职责 |
|---|---|---|
| `plugin/hooks/session-start/layers.js` | N1 去 compact 三元（951-953）；M2 `WALK_KEEP` 3→10（366）；E3 `truncateSpec` 改前缀匹配（612-645）；E4 `renderArtifactDirSection` 精简（279-281）；C2 `renderActiveChangeSummary` status 归一（725）；M1 `renderGit` 渲染脏文件/ahead-behind（934-937） | 注入渲染纯函数 |
| `plugin/hooks/session-start/collect-state.js` | M1 `collectGit` 加 `git status --porcelain`（脏文件数）+ ahead/behind（272-281） | git 状态收集 |
| `plugin/hooks/pace-utils.js` | F3 `getArtifactDir` 新项目默认 vault→local（527-530） | artifact 目录解析 |
| `plugin/hooks/templates/spec.md` | E1/E3 核对：模板无版本号硬编码（已确认），标题 `## 目录结构` / `## 依赖列表`（E3 前缀匹配后命中） | 新用户首次注入模板 |
| `tests/test-session-layers.js` | N1 对称（SL-33）、M2（SL-34）、E3（SL-35/36）、E4（SL-37）、C2（SL-38）、M1 renderGit（SL-39）、collectGit 真实 git（SL-40） | layers 纯函数 + collectGit 单测 |
| `tests/test-pace-utils.js` | F3 getArtifactDir 新项目→local（改现有「新项目（无 artifact）→ vault 目录」断言 + 加回归） | getArtifactDir 单测 |

---

## CHG IQ-1：注入完整性（该注入的注全）

闭环主题：N1 compact 对称 + M2 walkthrough 回 10 + M1 git A2。

### T-1（N1）：renderRelatedNotes 去 compact 三元，startup/compact 名额逐项对称

**根因**：`renderRelatedNotes`（layers.js:951-953）`wikiMax = compact?2:3` / `knowledgeMax = compact?1:2` / `thoughtsMax = compact?2:3` 硬编码。单 hook 时代 compact 走快照恢复、精简为省快照体积；M4 退役快照后该约束消失，精简名额成无主残留。统一到 startup 名额（wiki 3 / knowledge 2 / thoughts 3）。原对称测试（SL-29/30）只验在场不验数量。

#### ① 失败测试（写入 `tests/test-session-layers.js`，紧接 SL-32 之后、`process.on('exit'...)` 之前）

```javascript
// --- 33. N1：renderRelatedNotes startup/compact 名额逐项相等（去 compact 三元后对称）---
test('SL-33. startup/compact 相关知识+thoughts 注入数量逐项相等（N1 对称）', () => {
  // 各类喂足 6 条（> 任何名额），强制名额成为唯一截断因素，从而暴露 startup/compact 数量差。
  const wiki = Array.from({ length: 6 }, (_, i) => ({ title: `wiki-${i}`, summary: 'w', status: 'confirmed', kind: 'wiki' }));
  const knowledge = Array.from({ length: 6 }, (_, i) => ({ title: `know-${i}`, summary: 'k', status: 'concluded', kind: 'knowledge' }));
  const thoughts = Array.from({ length: 6 }, (_, i) => ({ title: `think-${i}`, summary: 't', status: 'discussing', kind: 'thoughts' }));
  const notes = [...wiki, ...knowledge, ...thoughts];
  const startupText = buildLayers(makeActiveState({ relatedNotes: notes, eventType: 'startup' }), 'startup', paceUtils, 'core').l3.join('\n');
  const compactText = buildLayers(makeActiveState({ relatedNotes: notes, eventType: 'compact' }), 'compact', paceUtils, 'core').l3.join('\n');
  const countLabel = (text, label) => (text.match(new RegExp(`\\[${label}`, 'g')) || []).length;
  // 逐项相等：wiki / knowledge / thoughts 三类 startup 与 compact 注入数量必须一致。
  const startupWiki = countLabel(startupText, 'wiki\\]');
  const compactWiki = countLabel(compactText, 'wiki\\]');
  const startupKnow = countLabel(startupText, 'knowledge·');
  const compactKnow = countLabel(compactText, 'knowledge·');
  const startupThink = countLabel(startupText, 'thought·');
  const compactThink = countLabel(compactText, 'thought·');
  assert.strictEqual(compactWiki, startupWiki, `wiki 名额 compact(${compactWiki}) 应等于 startup(${startupWiki})`);
  assert.strictEqual(compactKnow, startupKnow, `knowledge 名额 compact(${compactKnow}) 应等于 startup(${startupKnow})`);
  assert.strictEqual(compactThink, startupThink, `thoughts 名额 compact(${compactThink}) 应等于 startup(${startupThink})`);
  // 统一到 startup 名额：wiki 3 / knowledge 2 / thoughts 3。
  assert.strictEqual(startupWiki, 3, 'startup wiki 名额 3');
  assert.strictEqual(startupKnow, 2, 'startup knowledge 名额 2');
  assert.strictEqual(startupThink, 3, 'startup thoughts 名额 3');
});
```

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-33 失败，断言 `wiki 名额 compact(2) 应等于 startup(3)`（compact 当前 wiki=2/knowledge=1/thoughts=2，与 startup 3/2/3 不等）。

#### ③ 实现（`plugin/hooks/session-start/layers.js`，替换 951-953）

```javascript
  // 各类独立名额（分别 slice）——knowledge 不被 wiki 挤光（CHG-04 修复 M5 的 wiki≥5 挤出问题）；thoughts 独立段。
  // N1：去掉 compact?2:3 三元——单 hook 时代 compact 走快照恢复故精简名额；M4 退役快照后 compact 与 startup
  //   同走实时读路径，精简约束已无主，名额统一到 startup（wiki 3 / knowledge 2 / thoughts 3）。
  const wikiMax = 3;
  const knowledgeMax = 2;
  const thoughtsMax = 3;
```

同时删除上方现已无用的 `const compact = eventType === 'compact';`（layers.js:945）——确认该 `compact` 变量在本函数内除三元外无其它引用后删除；若 lint/调用方仍需 `eventType` 入参，保留签名 `renderRelatedNotes(state, eventType)` 不变，仅删 `compact` 局部变量。

> 实现细节核对：`renderRelatedNotes(state, eventType)` 签名第二参为 `eventType`，函数内 `const compact = eventType === 'compact'` 仅服务三类 `compact?x:y` 三元。删三元后该局部变量无引用，一并删除，避免「声明未用」噪声。

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
```

预期：SL-33 通过；SL-29 / SL-30（原相关讨论测试）仍绿（startup 名额未变）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): N1 去 renderRelatedNotes compact 三元，startup/compact 名额对称

compact 精简名额是单 hook 快照时代残留；M4 退役快照后 compact 与 startup 同走
实时读路径，名额统一到 startup（wiki 3/knowledge 2/thoughts 3）。补 SL-33 逐项
相等对称测试（原 SL-29/30 只验在场不验数量）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### T-2（M2）：walkthrough WALK_KEEP 3 → 10

**根因**：`WALK_KEEP=3`（layers.js:366）M3 T-002 有意收紧体积，与 design L0「10 条」冲突；用户裁定回 10。

#### ① 失败测试（写入 `tests/test-session-layers.js`，SL-33 之后）

```javascript
// --- 34. M2：walkthrough 索引表保留最近 10 行（WALK_KEEP 回 10，对齐 design L0）---
test('SL-34. walkthrough 注入保留最近 10 条索引行（M2 WALK_KEEP=10）', () => {
  // 构造 12 行数据（date 递增），断言保留 10 行 + 省略指针报「已省略 2 条」。
  const rows = Array.from({ length: 12 }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return `| 2026-06-${d} | 第${i + 1}条 | CHG-x |`;
  }).join('\n');
  const walk = `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n${rows}\n\n<!-- ARCHIVE -->\n`;
  const state = makeActiveState({ artifactFiles: [{ file: 'walkthrough.md', full: walk }] });
  const text = [...buildLayers(state, 'startup', paceUtils, 'artifact').l1head,
                ...buildLayers(state, 'startup', paceUtils, 'artifact').l3].join('\n');
  // 保留最近 10 条：第12..第3 在，第2/第1 被省略。
  assert.ok(text.includes('第12条') && text.includes('第3条'), '最近 10 条应保留（第12..第3）');
  assert.ok(!text.includes('第2条|') && !/第1条[^0-9]/.test(text), '第1/第2 条应被省略（超出 10 条）');
  assert.ok(text.includes('已省略 2 条旧记录'), '省略指针应报「已省略 2 条」（12-10）');
});
```

> 断言细节：`第1条` 子串会被 `第11条`/`第12条` 误包含，故用 `/第1条[^0-9]/` 边界匹配；`第2条|` 同理避开 `第12条`。第3..第12 共 10 条保留。

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-34 失败，当前 `WALK_KEEP=3` → 只保留第12/11/10 条、省略指针报「已省略 9 条」，断言 `第3条应保留` 与 `已省略 2 条` 均失败。

#### ③ 实现（`plugin/hooks/session-start/layers.js`，替换 366 及上方注释 363-366）

```javascript
/** walkthrough 索引表截断：保留最近 10 行 + 删除 v6 永不触发的详情段落处理（重构前 449-503；M2 回 10 对齐 design L0）。 */
function truncateWalkthrough(output) {
  // 索引表截断：保留表头 + 最近 10 行数据行（M2：design L0 规定 10 条，从 M3 的 3 回归 10）。
  const WALK_KEEP = 10;
```

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
```

预期：SL-34 通过；其余 walkthrough 相关 e2e/单测仍绿（行数阈值放宽不破坏 ≤10 行场景）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): M2 walkthrough WALK_KEEP 3→10 对齐 design L0

M3 T-002 把索引表收紧到 3 行，与 design L0「10 条」冲突；用户裁定回 10。
补 SL-34（12 行→保留 10 + 省略 2 指针）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### T-3（M1）：collectGit 加脏文件/ahead-behind，renderGit 渲染

**根因**：`collectGit`（collect-state.js:272-281）只取 branch + lastCommit；`renderGit`（layers.js:934-937）只渲染这两项。design §5 A2 要求脏文件数 + ahead/behind 从未实现。

实现策略：`collectGit` 增量加两个子进程调用，沿用现有 `gitOpts`（含 `timeout: 5000` / `stdio` 静默）。`git status --porcelain` 行数即脏文件数；`git status -sb` 首行（如 `## master...origin/master [ahead 1, behind 2]`）解析 ahead/behind，无上游则无该括号、记 0/0/无上游。新增字段对 `branch`/`lastCommit` 缺失场景保持 null（向后兼容）。

`renderGit` 渲染策略：脏文件 > 0 显示「工作区: N 个文件未提交」，否则「工作区: 干净」；有上游且 ahead/behind 任一 > 0 显示「与上游: ahead N / behind M」。字段缺省（旧 fixture 无新字段）时不渲染对应行（向后兼容 SL 现有 git 断言——实际无既有 git 渲染断言，但保守处理）。

#### ① 失败测试

**(a) renderGit 纯函数测试**（写入 `tests/test-session-layers.js`，SL-34 之后）

```javascript
// --- 35. M1：renderGit 渲染脏文件数 + ahead/behind（design §5 A2）---
test('SL-35. renderGit 渲染脏文件数与 ahead/behind（M1 A2）', () => {
  const dirty = makeActiveState({ git: {
    branch: 'master', lastCommit: 'abc123 改了点东西',
    dirtyCount: 3, ahead: 1, behind: 2, hasUpstream: true,
  }});
  const text = buildLayers(dirty, 'startup', paceUtils, 'core').l1.join('\n')
             + buildLayers(dirty, 'startup', paceUtils, 'core').l0.join('\n')
             + buildLayers(dirty, 'startup', paceUtils, 'core').l3.join('\n');
  assert.ok(text.includes('=== Git 状态 ===') && text.includes('分支: master'), 'Git 段含分支');
  assert.ok(text.includes('3 个文件未提交') || text.includes('3'), '渲染脏文件数 3');
  assert.ok(text.includes('ahead 1') && text.includes('behind 2'), '渲染 ahead/behind');
});

test('SL-36. renderGit 干净工作区 + 无上游不渲染 ahead/behind（M1 A2 边界）', () => {
  const clean = makeActiveState({ git: {
    branch: 'master', lastCommit: 'abc123 init',
    dirtyCount: 0, ahead: 0, behind: 0, hasUpstream: false,
  }});
  const text = buildLayers(clean, 'startup', paceUtils, 'core').l1.join('\n')
             + buildLayers(clean, 'startup', paceUtils, 'core').l3.join('\n');
  assert.ok(text.includes('=== Git 状态 ===') && text.includes('干净'), '干净工作区显示「干净」');
  assert.ok(!text.includes('ahead') && !text.includes('behind'), '无上游不渲染 ahead/behind 行');
});
```

> Git 段当前进哪一层需确认：`renderGit` 在 buildLayers 中于 core group 渲染（layers.js:142），实际 push 到 l1（非 head）。测试拼接 l1+l0+l3 兜底定位，避免对具体层号脆性依赖。**执行时先 `node -e` 打印一次 `buildLayers(makeActiveState({git:{...}}),'startup',paceUtils,'core')` 确认 Git 段所在层**，再据实收紧断言到该层。

**(b) collectGit 真实 git 测试**（写入 `tests/test-session-layers.js`，需在文件头补 `const { collectGit } = require('../plugin/hooks/session-start/collect-state');` —— 现有 import 已含 `buildTaskInjection`，扩展为 `const { buildTaskInjection, collectGit } = require(...)`；并补 `const fs/os/path/cp` require 与 makeTmpDir）

```javascript
// --- collectGit 真实 git 行为：临时 repo，1 commit + 1 脏文件 + 模拟上游分叉 ---
test('SL-37. collectGit 报脏文件数 + ahead/behind（真实临时 git repo）', () => {
  const cp = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-collectgit-'));
  const run = (cmd) => cp.execSync(cmd, { cwd: repo, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    run('git init -q');
    run('git config user.email t@t.t');
    run('git config user.name t');
    run('git checkout -q -b master');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v1\n');
    run('git add a.txt');
    run('git commit -q -m init');
    // 脏：改 a.txt 不提交 + 新增未跟踪文件 → porcelain 2 行。
    fs.writeFileSync(path.join(repo, 'a.txt'), 'v2\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
    const git = collectGit(repo);
    assert.ok(git && git.branch === 'master', 'branch=master');
    assert.strictEqual(git.dirtyCount, 2, 'porcelain 2 行（1 改 + 1 未跟踪）');
    assert.strictEqual(git.hasUpstream, false, '无 remote → hasUpstream=false');
    assert.strictEqual(git.ahead, 0, '无上游 ahead=0');
    assert.strictEqual(git.behind, 0, '无上游 behind=0');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

> 不测真实 ahead/behind 的远程分叉（需建裸 remote + push，子进程多、慢、易跨平台抖动）；ahead/behind 解析逻辑由 SL-35（renderGit 喂 fixture）+ collectGit 的 `git status -sb` 解析单元覆盖。collectGit 的解析正确性靠「无上游→0/0」边界 + renderGit fixture 双向夹逼，符合 YAGNI。

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-35 失败（renderGit 当前不渲染脏文件/ahead-behind）；SL-36 失败（无「干净」文案）；SL-37 失败（`git.dirtyCount` undefined ≠ 2）。

#### ③ 实现

**(a) `plugin/hooks/session-start/collect-state.js`（替换 267-281）**

```javascript
/**
 * 读取 git 分支、最近提交、脏文件数与 ahead/behind（design §5 A2）。
 * @param {string} cwd - 项目工作目录。
 * @returns {{ branch: string, lastCommit: string, dirtyCount: number, ahead: number, behind: number, hasUpstream: boolean }|null} 非 git 项目返回 null。
 */
function collectGit(cwd) {
  try {
    const { execSync } = require('child_process');
    const gitOpts = { cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
    const branch = execSync('git rev-parse --abbrev-ref HEAD', gitOpts).trim();
    const lastCommit = execSync('git log --oneline -1', gitOpts).trim();
    if (!(branch && lastCommit)) return null;
    // 脏文件数：porcelain 每行一个变更文件（含未跟踪），空输出即干净。
    let dirtyCount = 0;
    try {
      const porcelain = execSync('git status --porcelain', gitOpts);
      dirtyCount = porcelain.split('\n').filter(l => l.trim().length > 0).length;
    } catch (e) {}
    // ahead/behind：status -sb 首行如 `## master...origin/master [ahead 1, behind 2]`；无上游则无 `...remote`。
    let ahead = 0, behind = 0, hasUpstream = false;
    try {
      const sb = execSync('git status -sb', gitOpts).split('\n')[0] || '';
      if (/\.\.\./.test(sb)) {
        hasUpstream = true;
        const am = sb.match(/ahead (\d+)/);
        const bm = sb.match(/behind (\d+)/);
        if (am) ahead = Number(am[1]);
        if (bm) behind = Number(bm[1]);
      }
    } catch (e) {}
    return { branch, lastCommit, dirtyCount, ahead, behind, hasUpstream };
  } catch (e) {} // 非 git 项目静默跳过
  return null;
}
```

**(b) `plugin/hooks/session-start/layers.js`（替换 933-937）**

```javascript
/** Git 状态 section（重构前 790-799；M1 A2 加脏文件数 + ahead/behind）。 */
function renderGit(state) {
  if (!state.git) return '';
  const g = state.git;
  let out = `=== Git 状态 ===\n分支: ${g.branch}\n最近提交: ${g.lastCommit}\n`;
  // 脏文件：design §5 A2——有未提交变更时提示数量，干净时显式标注（避免「无信息=不确定」）。
  if (typeof g.dirtyCount === 'number') {
    out += g.dirtyCount > 0 ? `工作区: ${g.dirtyCount} 个文件未提交\n` : `工作区: 干净\n`;
  }
  // ahead/behind：仅有上游且任一 > 0 时渲染，无上游/已同步不噪声。
  if (g.hasUpstream && (g.ahead > 0 || g.behind > 0)) {
    out += `与上游: ahead ${g.ahead} / behind ${g.behind}\n`;
  }
  out += '\n';
  return out;
}
```

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
node tests/test-hooks-e2e.js
```

预期：SL-35/36/37 通过；e2e 全绿（collectGit 新字段对 e2e 无既有断言冲突，git 段在 e2e tmp 项目非 git repo 时 `state.git=null`、不渲染）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/collect-state.js plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): M1 git 段加脏文件数与 ahead/behind（design §5 A2）

collectGit 增 git status --porcelain（脏文件数）+ status -sb（ahead/behind/有无上游），
沿用现有 gitOpts timeout/静默；renderGit 渲染「工作区: N 未提交/干净」「与上游: ahead/behind」。
补 SL-35/36（renderGit fixture）+ SL-37（collectGit 真实临时 repo）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## CHG IQ-2：注入精度（截断/渲染对真实产物生效）

闭环主题：E3 truncateSpec 前缀匹配 + 模板 spec.md 核对 + E4 去重 + C2 引号归一。

### T-1（E3 + E1 模板）：truncateSpec 前缀匹配，核对模板 spec.md

**根因**：`SPEC_OMIT_SECTIONS = ['目录', '依赖列表']`（layers.js:614）用 `includes`（精确匹配）。真实/模板标题是 `## 目录结构`（≠`目录`）→ `'目录'` 永不命中 → 该段全文注入；`'依赖列表'` 恰好精确命中模板 `## 依赖列表`。改为前缀匹配（`heads[i].name.startsWith(omit)`），`'目录'` 即命中 `目录结构`。

**模板核对**（已读 `plugin/hooks/templates/spec.md`）：模板 frontmatter 仅 `project-summary`，**无版本号硬编码**（E1 模板部分无需改）；标题为 `## 目录结构` / `## 依赖列表`，前缀匹配后两者均命中。E1 模板侧结论：核对通过，无改动，仅在 commit message 记录已核对。

> 执行时复核真实 vault spec.md（主 session 已改过）：`rg "^## " /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/spec.md`，确认 OMIT 目标标题与 `['目录','依赖列表']` 前缀关系；若 vault 真实标题已偏离（如改成 `## 目录与结构`），仍由 `startsWith('目录')` 覆盖，无需扩表。

#### ① 失败测试（写入 `tests/test-session-layers.js`，SL-37 之后）

```javascript
// --- 38. E3：truncateSpec 前缀匹配真实标题「## 目录结构」（原精确匹配失效）---
test('SL-38. truncateSpec 砍掉「## 目录结构」段（前缀匹配，非精确）', () => {
  const spec = [
    '# 项目规格',
    '## 项目概述', '这是概述，必须保留。',
    '## 目录结构', '```', 'project/', '└── src/', '```',
    '## 禁止事项', '禁止 X，必须保留。',
    '## 依赖列表', '| 包 | 版本 |', '| a | 1 |',
  ].join('\n') + '\n';
  const state = makeActiveState({ artifactFiles: [{ file: 'spec.md', full: spec }] });
  const text = [...buildLayers(state, 'startup', paceUtils, 'artifact').l1head,
                ...buildLayers(state, 'startup', paceUtils, 'artifact').l3].join('\n');
  assert.ok(text.includes('这是概述'), '项目概述保留');
  assert.ok(text.includes('禁止 X'), '禁止事项保留（高价值约束）');
  assert.ok(!text.includes('└── src/'), '「## 目录结构」段被砍（前缀匹配命中 目录结构）');
  assert.ok(!text.includes('| a | 1 |'), '「## 依赖列表」段被砍');
  assert.ok(text.includes('已省略 spec 目录/依赖列表'), '附省略指针');
});
```

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-38 失败——`'目录'` 精确匹配 `## 目录结构` 不命中，`└── src/` 仍在全文，断言 `「## 目录结构」段被砍` 失败。

#### ③ 实现（`plugin/hooks/session-start/layers.js`，替换 632-633 的匹配条件）

将 612 注释与 614 常量保留语义、633 行匹配改前缀：

```javascript
// spec 类内摘要要砍掉的低频可随时 Read 的段落（标题前缀匹配）：目录（含「目录结构」）、依赖列表。
//   保留「项目概述 / 技术栈 / 禁止事项」等高价值约束段——禁止事项是 AI 不可违反的约束，必须保住（e2e 2h）。
//   E3：改前缀匹配——真实/模板标题是「## 目录结构」，精确 includes('目录') 永不命中、致 spec 全文注入。
const SPEC_OMIT_SECTIONS = ['目录', '依赖列表'];
```

以及（632-636 循环内，把 `includes` 改 `startsWith`）：

```javascript
  for (let i = 0; i < heads.length; i++) {
    if (!SPEC_OMIT_SECTIONS.some(omit => heads[i].name.startsWith(omit))) continue;
    const end = i + 1 < heads.length ? heads[i + 1].start : output.length;
    dropRanges.push([heads[i].start, end]);
  }
```

> DRY 取舍：保留 `SPEC_OMIT_SECTIONS` 数组 + `some(startsWith)`，而非把表改成真实全名 `['目录结构','依赖列表']`。理由（spec §5）：前缀匹配对未来标题漂移（`目录与结构`/`目录说明`）鲁棒，消除「代理信号=精确字面 ≠ 真实标题」的复发结构，优于把字面再钉死一次。

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
```

预期：SL-38 通过；既有 spec 相关 e2e/单测仍绿（前缀匹配是精确匹配的超集，原本命中的 `依赖列表` 仍命中）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): E3 truncateSpec 前缀匹配真实标题，核对模板 spec.md

SPEC_OMIT_SECTIONS 精确 includes('目录') 不命中真实「## 目录结构」→ spec 全文注入；
改 some(startsWith) 前缀匹配，对标题漂移鲁棒（spec §5 消除字面代理）。核对
plugin/hooks/templates/spec.md：无版本号硬编码（E1 模板侧无改动），标题 目录结构/依赖列表
前缀匹配后均命中。补 SL-38。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### T-2（E4）：Artifact 目录段去重

**根因**：core 段「PACEflow 项目上下文」（`renderProjectContext`，layers.js:217-235）已输出 `Artifact Root: <显示路径>`；「Artifact 目录」段（`renderArtifactDirSection`，layers.js:279-281）又输出 `路径: <显示路径>` + 模式 + 用途 + helper。两段路径重复（A4 去重未做透，preexisting）。

**去重策略**：`renderArtifactDirSection` 去掉与「项目上下文」重复的 `路径:` / `模式:` 行（这两项已在项目上下文段以 `Artifact Root:` / `模式:` 出现），只保留该段**独有**的增量信息——「仅用于 PaceFlow artifacts：<content>」用途说明 + plan 同步 helper + CHG/artifact-root 指针。段标题保留（功能定位锚点）。

> 影响面核对：`renderArtifactDirSection(state)` 读 `state.artifactDir.{display,mode,content,scripts.syncPlan}`。去掉 `display`/`mode` 渲染不影响其它 section（项目上下文段读的是 `state.projectContext.contextArtDir`，独立来源）。无其它调用方依赖「Artifact 目录」段的 `路径:`/`模式:` 行文案（grep 确认仅此处 + 测试断言）。**执行时先 grep `路径: \|模式: ` 在 e2e/单测的断言，若有断言依赖这两行需同步更新**。

#### ① 失败测试（写入 `tests/test-session-layers.js`，SL-38 之后）

```javascript
// --- 39. E4：Artifact 目录段不重复项目上下文已给的路径（去重）---
test('SL-39. Artifact 目录段不重复 artifact 路径（E4 去重）', () => {
  const state = makeActiveState({ artifactDirInjected: true });
  const head = buildLayers(state, 'startup', paceUtils, 'core').l1head.join('\n');
  // 项目上下文段已给 Artifact Root，Artifact 目录段应只留增量（用途/helper），不再重复「路径:」行。
  assert.ok(head.includes('=== PACEflow 项目上下文 ==='), '项目上下文段在');
  assert.ok(head.includes('Artifact Root:'), '项目上下文段给出 Artifact Root');
  assert.ok(head.includes('=== Artifact 目录 ==='), 'Artifact 目录段标题保留（功能锚点）');
  assert.ok(!head.includes('\n路径: '), 'Artifact 目录段不再重复「路径:」行');
  assert.ok(head.includes('仅用于 PaceFlow artifacts'), 'Artifact 目录段保留独有用途说明');
  assert.ok(head.includes('plan 同步 helper'), 'Artifact 目录段保留 plan 同步 helper');
});
```

> 断言用 `\n路径: ` 锚定行首，避免误伤项目上下文段的 `Project Root:` 等其它 `Root:` 文案。

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-39 失败——当前 `renderArtifactDirSection` 输出 `路径: <display>`，断言 `不再重复「路径:」行` 失败。

#### ③ 实现（`plugin/hooks/session-start/layers.js`，替换 278-281）

```javascript
/** Artifact 目录 section（重构前 writeArtifactDirSection 315-327）。
 *  E4 去重：路径/模式已在「项目上下文」段（Artifact Root / 模式）出现，本段只留增量——
 *  用途说明 + plan 同步 helper + CHG/artifact-root 指针，避免同一路径注入两次。 */
function renderArtifactDirSection(state) {
  const ad = state.artifactDir;
  return `=== Artifact 目录 ===\n仅用于 PaceFlow artifacts：${ad.content}（路径见上方「项目上下文」段 Artifact Root）。\nCHG 编号 / artifact-root / 独立子项目 helper 见上方「PACEflow 工作流入口」段。\nplan 同步 helper: node "${ad.scripts.syncPlan}" --plan "<已桥接 plan 绝对路径>"\n\n`;
}
```

> 注意原函数体首行是 `const ad = state.artifactDir;`（279 行后半，被截断未显示但存在于源）；执行时 Read 279-281 完整三行确认 `ad` 声明位置，替换时保留 `const ad = state.artifactDir;`。

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
node tests/test-hooks-e2e.js
```

预期：SL-39 通过；e2e 中若有断言 `路径: ` / `模式: ` 在 Artifact 目录段的，已在 ③ 前 grep 同步（若无则 e2e 直接绿）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): E4 Artifact 目录段去重，路径只注入一次

「项目上下文」段已给 Artifact Root + 模式；Artifact 目录段去掉重复的 路径:/模式: 行，
只留增量（用途说明 + plan 同步 helper + helper 指针）。补 SL-39。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### T-3（C2）：活跃 CHG 摘要 status 引号归一

**根因**：`renderActiveChangeSummary`（layers.js:725）`status=${s.status}` 直出原始值；若 frontmatter 写 `status: "in-progress"`（带引号），渲染成 `status="in-progress"`。`category` 已经过归一化、是权威，故 status 仅 cosmetic。用 `paceUtils.normalizeFrontmatterStatus`（`change-analysis.js:194`，去首尾引号 + trim）归一。

#### ① 失败测试（写入 `tests/test-session-layers.js`，SL-39 之后）

```javascript
// --- 40. C2：活跃 CHG 摘要 status 字段去引号（normalizeFrontmatterStatus 归一）---
test('SL-40. 活跃 CHG 摘要 status 渲染去引号（C2 cosmetic 归一）', () => {
  const state = makeActiveState({ activeChangeSummaries: [{
    id: 'CHG-20260610-01', category: 'running', status: '"in-progress"',
    ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
    taskCheckbox: '/', implCheckbox: '/', pending: 1, approved: true, verified: false, reviewed: false,
    path: '/tmp/fixture-project/changes/chg-20260610-01.md', changeSet: '', changeSetSeq: '',
  }]});
  const l0 = buildLayers(state, 'startup', paceUtils, 'core').l0.join('\n');
  assert.ok(l0.includes('status=in-progress'), 'status 去引号渲染为 in-progress');
  assert.ok(!l0.includes('status="in-progress"'), '不再渲染原始引号');
});
```

#### ② 跑看红

```bash
node tests/test-session-layers.js
```

预期：SL-40 失败——当前直出 `status="in-progress"`，断言 `status=in-progress` 失败。

#### ③ 实现（`plugin/hooks/session-start/layers.js`，替换 725 行 `status=${s.status}` 片段）

`renderActiveChangeSummary` 内已通过 `state`/参数访问数据，但 `paceUtils` 未传入该函数。核对调用链：`buildLayers(state, eventType, paceUtils, group)` → `renderActiveChangeSummary(state)`（仅 state）。`normalizeFrontmatterStatus` 是纯字符串函数，最小改动是在 buildLayers 调用处把归一后的值预存到 state，或给 renderActiveChangeSummary 传 paceUtils。选**传 paceUtils**（与 renderRelatedNotes/renderProjectContext 等已收 paceUtils 的渲染函数一致，避免污染 state）。

- 改函数签名（718）：`function renderActiveChangeSummary(state, paceUtils) {`
- 改调用处（183 附近）：`const activeChgText = renderActiveChangeSummary(state, paceUtils);`
- 改 725 行 status 字段：

```javascript
    const statusText = paceUtils.normalizeFrontmatterStatus(s.status);
    out += `- ${s.id} category=${s.category} status=${statusText} owner=${ownerDisplay(s)} task=[${s.taskCheckbox || '?'}] impl=[${s.implCheckbox || '?'}] pending=${s.pending ?? '?'} approved=${s.approved} verified=${s.verified} reviewed=${s.reviewed}\n  ${s.path ? s.path.replace(/\\/g, '/') : 'missing detail'}\n`;
```

> 执行时核对 183 行调用处上下文（Read 180-186），确认 `paceUtils` 在 buildLayers 作用域可见（buildLayers 第三参即 paceUtils，作用域内可直接传）。

#### ④ 跑看绿

```bash
node tests/test-session-layers.js
```

预期：SL-40 通过；SL-2 / SL-10 等既有活跃 CHG 摘要断言仍绿（无引号 status 经归一不变）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/layers.js tests/test-session-layers.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): C2 活跃 CHG 摘要 status 去引号归一

status=${s.status} 直出原始值，带引号 frontmatter 渲染成 status="in-progress"；
过 normalizeFrontmatterStatus 与 category 同源归一（cosmetic）。renderActiveChangeSummary
增 paceUtils 入参（与其它渲染函数一致）。补 SL-40。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## CHG IQ-3：漂移防治（结构性根因）

闭环主题：F3 root 默认偏 local + E2 finding 维护机制评估。

### T-1（F3）：新项目 root 默认偏 local

**根因**：`getArtifactDir`（pace-utils.js:527-530）新项目（无配置、无 vault changes/、无 local changes/、无 legacy）默认 `VAULT_PATH ? vault : CWD`。有 vault 机器上全新项目默认指 vault → 注入 Artifact Root 显示 vault 路径（被 artifact-root choice 门挡住静默写入，非污染，是默认值偏向 + 注入误导）。改为全新无配置项目默认偏 **local（stateDir）**。

**影响面（关键）**：现有测试 `tests/test-pace-utils.js:1014` `新项目（无 artifact）→ vault 目录` 直接断言旧默认（→vault），F3 反转后此断言必须改为 →local。其余 getArtifactDir 测试（已配置 local/vault、已有 changes/、legacy、缓存）均走 527 行**之前**的分支，不受默认值改动影响——只有「四不沾全新项目」这一条路径改变。已配置 vault（`.pace/artifact-root=vault`）仍走 `getConfiguredArtifactDir` 早返回（498），不受影响。

> 与激活重构协调：激活重构的 `/paceflow enable` 选 root 流程在 enable 时显式定 root（写 `.pace/artifact-root`）；F3 只改「用户尚未通过任何方式表态」的隐式默认。两者不冲突——显式选择优先级恒高于默认。

#### ① 失败测试

**(a) 改现有断言**（`tests/test-pace-utils.js:1014-1019`，把期望从 vault 改 local，并改测试名）

```javascript
test('新项目（无 artifact、无配置）→ 默认本地项目根（F3 偏 local）', () => {
  const dir = makeTmpDir('gad-new');
  // F3：全新无配置项目默认偏 local（项目根），不再隐式指 vault；显式 artifact-root=vault 仍走 vault。
  assert.strictEqual(getArtifactDir(dir), dir);
});
```

**(b) 加回归——已配置 vault 不被 F3 影响**（紧接其后新增）

```javascript
test('新项目 + 显式 artifact-root=vault → 仍 vault（F3 不破坏显式选择）', () => {
  const dir = makeTmpDir('gad-new-vault-choice');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const expected = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  assert.strictEqual(getArtifactDir(dir), expected, '显式 vault 选择优先级高于 F3 默认');
});
```

> `_clearArtifactDirCache` 在 makeTmpDir 之间是否需手动清：现有测试每个 `makeTmpDir` 生成唯一 dir（含随机后缀），缓存 key 是 cwd，dir 不同 → 缓存自然 miss，无需手动清（与现有 `vault 有 artifact → 返回 vault` 等测试一致，未清缓存）。

#### ② 跑看红

```bash
node tests/test-pace-utils.js
```

预期：改写后的「新项目...→ 默认本地项目根」失败（当前实现返回 vault 路径 ≠ dir）；「显式 artifact-root=vault → 仍 vault」通过（走 configured 分支，不依赖 F3）——红的是 (a)，(b) 一开始就绿（守护不回归）。

#### ③ 实现（`plugin/hooks/pace-utils.js`，替换 527-528）

```javascript
  // 新项目（无配置、无 vault v6、无 local v6、无 legacy）→ 默认本地项目根（F3：偏 local，不隐式指 vault）。
  //   显式 artifact-root/已有 changes/ 在上方分支已早返回；此处仅「四不沾全新项目」的隐式默认，
  //   配合 /paceflow enable 的显式选 root 流程——用户未表态前默认 local，避免注入误导指向 vault。
  result = stateDir;
```

> `stateDir` 在函数顶部已 `const stateDir = getProjectStateDir(cwd)`（495 行），且 `let result = stateDir` 初值（496）本就是它；527 行原 `result = VAULT_PATH ? ... : stateDir` 收窄为恒 `stateDir`。可直接删 528 行的三元、保留 `result = stateDir`（或依赖 496 初值，显式赋值更清晰）。VAULT_PATH 守卫分支（504-516）仍保留——已有 vault changes/ 的项目仍解析到 vault（向后兼容已迁 vault 的项目）。

#### ④ 跑看绿

```bash
node tests/test-pace-utils.js
```

预期：全绿——(a) 改写后断言 →local 通过，(b) 显式 vault 回归通过，其余 getArtifactDir 测试（CWD 有 artifact / vault 有 artifact / vault+CWD vault 优先 / local choice / vault choice / 缓存 / env）均不受影响（都不走「四不沾」默认路径）。

#### ⑤ commit

```bash
git add plugin/hooks/pace-utils.js tests/test-pace-utils.js
git commit -m "$(cat <<'EOF'
feat(inject-quality): F3 全新无配置项目 artifact 默认偏 local（不隐式指 vault）

getArtifactDir 四不沾全新项目原默认 VAULT_PATH?vault:CWD → 恒 stateDir（本地项目根）；
显式 artifact-root/已有 changes/已迁 vault 项目走前置分支不受影响。改现有「新项目→vault」
断言为「→local」+ 加「显式 vault 选择仍 vault」回归。配合 /paceflow enable 显式选 root。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### T-2（E2）：finding 完成状态维护机制评估（YAGNI 决策）

**背景**：E2 存量（`injection-wrap-backlog` finding 标 `[x]`）已由主 session 修。结构性残余是「finding 完成状态无维护机制——backlog 做完没流程标 `[x]`」。spec §2.1 与 §4 IQ-3 明示此项「YAGNI 待定」，本 task 是**决策 task**，结论可以是 won't-fix + 记录理由，不强求实现代码。

**评估维度**（执行时据实判断，三选一落定）：

1. **现状盘点**：grep `close-chg` / `update-finding` 在 `plugin/agent-references/**` 与 `plugin/skills/**`，确认 close-chg 流程当前是否已涉及关联 finding 检查；grep `findings.md` 注入是否已有「过期提醒」（`renderAgedFindings`，layers.js:924——已存在 14 天 aged 提醒机制）。
2. **重叠判断**：`renderAgedFindings` 已对超 14 天未流转 finding 注入提醒（「请决定采纳 [x] 或否定 [-]」）。这已是一条**周期性维护信号**——open finding 超期会主动提示用户处置。若该机制覆盖「backlog 做完忘标」场景（做完的 finding 若仍 open 会在 14 天后被 aged 提醒捕获），则新增 close-chg 时检查关联 finding 属**重复机制**，判 YAGNI / won't-fix。
3. **决策落定**（默认倾向 won't-fix，除非盘点发现 aged 机制有明确盲区）：
   - **若判 won't-fix**：派 `artifact-writer record-finding`（或在本 CHG changes/<id>.md 记录），写明：根因「finding 完成状态无强制维护流程」、现有缓解「renderAgedFindings 14 天周期提醒已捕获超期 open finding」、决策「won't-fix：close-chg 时强制检查关联 finding 是过度工程，aged 提醒已覆盖遗忘场景；代价（每次 close 扫关联 finding）> 收益（aged 已兜底）」、复发监测「若 aged 提醒被证实漏掉 backlog 类 finding，再开 HOTFIX」。
   - **若盘点发现真实盲区**（如 backlog finding 不进 aged 扫描范围）：降级为最小实现——close-chg agent-reference 加一句「收口前检查本 CHG 关联 finding 是否已 [x]/[-]」软提示（不加确定性门），并补一条 agent-tests 断言该提示存在。

**本 task 无 TDD 代码五步的硬性要求**（评估/决策性质）。若结论是 won't-fix：

#### ① 决策记录（替代失败测试）

执行盘点命令，确认 `renderAgedFindings` 覆盖面：

```bash
grep -rn "renderAgedFindings\|过期提醒\|14 天\|shouldInject" plugin/hooks/session-start/layers.js plugin/hooks/session-start/collect-state.js
grep -rln "close-chg\|关联 finding\|update-finding" plugin/agent-references/ plugin/skills/
```

#### ② 落定结论

依盘点结果二选一：won't-fix（record-finding 记录理由）或最小软提示实现（加 agent-reference 一句 + agent-tests 断言）。

#### ③ 若 won't-fix——派 artifact-writer 记录（主 session 执行，不在本 plan 内写代码）

> 本 task 的产出是「决策 + 持久化记录」，不一定有代码改动。若 won't-fix，commit 仅含 record-finding 产生的 artifact 变更（由 artifact-writer 写），或并入 CHG 收口的 walkthrough。若最小实现，则补 agent-reference + agent-tests 后照常 TDD commit。

#### ⑤ commit（仅最小实现路径时）

```bash
git add plugin/agent-references/ tests/agent-tests/
git commit -m "$(cat <<'EOF'
feat(inject-quality): E2 close-chg 软提示检查关联 finding 状态（YAGNI 最小实现）

评估 finding 完成状态维护机制：renderAgedFindings 14 天周期提醒已覆盖超期 open finding，
close-chg 增一句软提示检查本 CHG 关联 finding 是否已流转（不加确定性门，避免过度工程）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## 收口（每个 CHG 最后一个 task 代码写完后）

按 G-9：先跑全量验证并读完结果，再 R 审计，再派一次 `close-chg`。

```bash
node tests/test-session-layers.js
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
claude plugin validate ./plugin
git diff --check
```

- IQ-1 收口：T-3（M1）后跑上述全量；R 审计聚焦 git 子进程超时/非 git repo 降级、N1 名额对称无 over-inject。
- IQ-2 收口：T-3（C2）后跑全量；R 审计聚焦 E3 前缀匹配无误删高价值段（禁止事项/技术栈）、E4 去重无信息丢失（用途/helper 仍在）。
- IQ-3 收口：T-1（F3）后跑全量；R 审计聚焦 F3 不破坏已配置/已迁 vault 项目（对称反向验证：vault choice / 已有 changes/ 仍解析正确）。

> 共性回归护栏（spec §6）：本 change-set 不动门控、不新增 deny；最坏失败「注入不理想」。每个 CHG 收口必跑 `test-hooks-e2e.js` 确认注入管线端到端未回归。
