// test-session-layers.js — SessionStart 注入层纯函数单测（CHG-20260608-04 / CHG-A 骨架）。
//
// 目标（CHG-A）：验证三段式解耦后 buildLayers 是可单测的纯函数——喂 fixture state，
//   断言返回 { l0, l1, l2, l3 } 结构、不触 I/O、关键内容归位。
//   - L0 含活跃 CHG 摘要（「我刚才在做」）
//   - 工作流入口（skill 引导 pace-workflow）被注入（CHG-A 仍在 head 区，CHG-C 才移入 L2）
//   后续 CHG-B/C/D 在此扩展：分层优先级 / 截断方向 / compact 对称 / L3 内容断言。
'use strict';

const assert = require('assert');
const { createTestRunner } = require('./test-utils');
const paceUtils = require('../plugin/hooks/pace-utils');
const { buildLayers } = require('../plugin/hooks/session-start/layers');
const { buildTaskInjection } = require('../plugin/hooks/session-start/collect-state');
const { assembleWithBudget } = require('../plugin/hooks/session-start/budget');

const t = createTestRunner('pace-session-layers');
const test = t.test;

/**
 * 构造一个「活跃 CHG」fixture state（不触磁盘）：模拟 collectState 对一个 artifact 项目、
 * 含一个 running 活跃 CHG 的产出。只填 buildLayers 渲染所需字段。
 * @returns {object} fixture state
 */
function makeActiveState(overrides = {}) {
  const base = {
    cwd: '/tmp/fixture-project',
    eventType: 'startup',
    paceSignal: 'artifact',
    proj: 'fixture-project',
    artDir: '/tmp/fixture-project',
    rootChoicePending: false,
    artifactRootChoice: 'local',
    v5MigrationInfo: { detected: false },
    hookInput: { type: 'startup' },
    projectContext: {
      cwd: '/tmp/fixture-project',
      rootInfo: {
        mode: 'independent',
        projectRoot: '/tmp/fixture-project',
        runtimeRoot: '/tmp/fixture-project/.pace',
      },
      contextArtDir: '/tmp/fixture-project',
    },
    artifactDir: {
      display: '/tmp/fixture-project',
      mode: '本地项目根目录',
      content: paceUtils.PACE_ARTIFACT_ROOT_CONTENT,
      scripts: {
        setArtifactRoot: paceUtils.SET_ARTIFACT_ROOT_SCRIPT,
        setProjectRoot: paceUtils.SET_PROJECT_ROOT_SCRIPT,
        reserveArtifactId: paceUtils.RESERVE_ARTIFACT_ID_SCRIPT,
        syncPlan: paceUtils.SYNC_PLAN_SCRIPT,
      },
    },
    artifactDirInjected: false,
    artifactFiles: [],
    taskFullCached: null,
    activeChangeSummaries: [
      {
        id: 'CHG-20260608-04', category: 'running', status: 'in-progress',
        ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
        taskCheckbox: '/', implCheckbox: '/', pending: 5, approved: true, verified: false, reviewed: false,
        path: '/tmp/fixture-project/changes/chg-20260608-04.md',
        changeSet: '', changeSetSeq: '',
      },
    ],
    implFullForFormat: null,
    bridgeHint: null,
    nativePlanPath: null,
    agedFindings: { shouldInject: false, aged: [] },
    git: null,
    relatedNotes: [],
    formatReference: paceUtils.FORMAT_SNIPPETS,
    rootChoicePromptText: '',
  };
  return Object.assign(base, overrides);
}

// --- 1. buildLayers 可调用且返回四层结构（+ head 区）---
test('SL-1. buildLayers 返回 { l1head, l0, l1, l2, l3 } 且均为数组', () => {
  const state = makeActiveState();
  const layers = buildLayers(state, 'startup', paceUtils);
  assert.ok(layers && typeof layers === 'object', 'buildLayers 应返回对象');
  for (const key of ['l1head', 'l0', 'l1', 'l2', 'l3']) {
    assert.ok(Array.isArray(layers[key]), `layers.${key} 应为数组`);
  }
});

// --- 2. L0 含活跃 CHG 摘要 ---
test('SL-2. L0 含活跃 CHG 摘要（含 CHG-id 与「活跃 CHG」标题）', () => {
  const state = makeActiveState();
  const { l0 } = buildLayers(state, 'startup', paceUtils);
  const l0Text = l0.join('\n');
  assert.ok(l0Text.includes('=== 活跃 CHG 摘要 ==='), 'L0 应含「活跃 CHG 摘要」section');
  assert.ok(l0Text.includes('CHG-20260608-04'), 'L0 应含活跃 CHG id');
});

// --- 3. 工作流入口注入 skill 引导（CHG-A 在 head 区；CHG-C 才移入 L2）---
test('SL-3. 工作流入口注入 pace-workflow skill 引导', () => {
  const state = makeActiveState();
  const layers = buildLayers(state, 'startup', paceUtils);
  const headText = layers.l1head.join('\n');
  assert.ok(headText.includes('=== PACEflow 工作流入口 ==='), 'head 区应含工作流入口 section');
  assert.ok(headText.includes('Skill(paceflow:pace-workflow)'), 'head 区应含 pace-workflow skill 引导');
  assert.ok(headText.includes('reserve helper'), 'head 区应含 reserve helper 约束');
});

// --- 4. 装配后整体注入同时含活跃 CHG 与 skill 入口（层无关的端到端断言）---
test('SL-4. assembleWithBudget 装配后含活跃 CHG 与 pace-workflow', () => {
  const state = makeActiveState();
  const layers = buildLayers(state, 'startup', paceUtils);
  const { text } = assembleWithBudget(layers, { limitChars: 46000 });
  assert.ok(text.includes('活跃 CHG'), '装配输出应含活跃 CHG');
  assert.ok(text.includes('pace-workflow'), '装配输出应含 pace-workflow skill 入口');
});

// --- 5. compact 模式也注入工作流入口（M4/T-002 A0 对称：快照退役后 compact 与 startup 同路径）---
test('SL-5. compact 模式注入工作流入口（A0 对称，快照退役）', () => {
  const state = makeActiveState({ eventType: 'compact' });
  const layers = buildLayers(state, 'compact', paceUtils);
  const headText = layers.l1head.join('\n');
  assert.ok(headText.includes('=== PACEflow 工作流入口 ==='), 'compact 下也实时注入工作流入口（renderWorkflowEntry 去 compact 守卫）');
});

// --- 6. buildLayers 纯函数：不写 state 之外、可重复调用幂等 ---
test('SL-6. buildLayers 多次调用输出一致（无隐藏外部状态依赖）', () => {
  const a = buildLayers(makeActiveState(), 'startup', paceUtils);
  const b = buildLayers(makeActiveState(), 'startup', paceUtils);
  assert.strictEqual(a.l0.join('\n'), b.l0.join('\n'), 'L0 两次调用应一致');
  assert.strictEqual(a.l1head.join('\n'), b.l1head.join('\n'), 'head 两次调用应一致');
});

// --- 7. （已删）buildCompactSnapshotText 单测随 PreCompact 快照机制退役（M4/T-002）移除。
//   compact 不再生成「Compact 恢复（快照…）」注入文本；compact 与 startup 走同一条实时读路径，
//   覆盖由 SL-5（compact 注入工作流入口）+ e2e MH-5（compact 实时注入、无快照段）承接。

// --- 8. CHG-B：assembleWithBudget L3 优先截断——head（l1head/L0/L1/L2）永不截 ---
test('SL-8. L3 超预算从尾部按条截断 + footer，head 永不截', () => {
  const big = 'x'.repeat(20000); // 撑爆 9500 chars 预算的超大 L3 条目
  const layers = {
    l1head: ['=== 项目上下文 ===\nHEAD关键\n'],
    l0: ['=== 活跃 CHG ===\nL0关键\n'],
    l1: ['=== git ===\nL1关键\n'],
    l2: ['=== 工作流入口 ===\nL2关键\n'],
    l3: ['=== findings ===\nF1保留\n', big],
  };
  const { text, truncated } = assembleWithBudget(layers, { limitChars: 9500 });
  assert.ok(text.includes('HEAD关键') && text.includes('L0关键') && text.includes('L1关键') && text.includes('L2关键'),
    'l1head/L0/L1/L2 永不截');
  assert.ok(text.includes('F1保留'), 'L3 预算内的前置条目保留');
  assert.ok(!text.includes(big), 'L3 超预算条目被截掉（不进注入）');
  assert.ok(text.includes('已省略'), 'L3 截断附「已省略 N 条」footer');
  assert.strictEqual(truncated, true, 'truncated 标记为 true');
});

// --- 9. CHG-B：L3 全部在预算内 → 全保留、truncated=false、无 footer ---
test('SL-9. L3 在预算内时全保留、truncated=false、无 footer', () => {
  const layers = {
    l1head: ['HEAD\n'], l0: ['L0\n'], l1: ['L1\n'], l2: ['L2\n'],
    l3: ['F1\n', 'F2\n'],
  };
  const { text, truncated } = assembleWithBudget(layers, { limitChars: 9500 });
  assert.ok(text.includes('F1') && text.includes('F2'), 'L3 全保留');
  assert.strictEqual(truncated, false, 'truncated=false');
  assert.ok(!text.includes('已省略'), '无 footer');
});

// CHG-B 排序测试共用：构造一个活跃 CHG summary（含 render 所需字段）。
function mkSummary(id, category, seq) {
  const running = category === 'running';
  return {
    id, category, status: running ? 'in-progress' : 'planned',
    ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
    taskCheckbox: running ? '/' : ' ', implCheckbox: running ? '/' : ' ',
    pending: 2, approved: running, verified: false, reviewed: false,
    path: `/tmp/fixture-project/changes/${id.toLowerCase()}.md`,
    changeSet: 'cs-x', changeSetSeq: seq,
  };
}

// --- 10. CHG-B：活跃 CHG 摘要 running 优先 + CHG-ID 升序（B5 + 修 batch create 倒序）---
test('SL-10. 活跃 CHG 摘要 running 优先 + 同档 CHG-ID 升序', () => {
  // 模拟 summarizeActiveChanges 继承 task.md 物理倒序 08→07→06→05，其中 06 是 running。
  const state = makeActiveState({
    activeChangeSummaries: [
      mkSummary('CHG-20260608-08', 'backlog', '5/5'),
      mkSummary('CHG-20260608-07', 'backlog', '4/5'),
      mkSummary('CHG-20260608-06', 'running', '3/5'),
      mkSummary('CHG-20260608-05', 'backlog', '2/5'),
    ],
  });
  const l0Text = buildLayers(state, 'startup', paceUtils).l0.join('\n');
  const pos = id => l0Text.indexOf(id); // CHG-id 仅出现在活跃摘要块（进度块用 seq 不含 id）
  assert.ok(pos('CHG-20260608-06') < pos('CHG-20260608-05'), 'running CHG-06 应排在 backlog 之前');
  assert.ok(pos('CHG-20260608-06') < pos('CHG-20260608-08'), 'running CHG-06 应排在所有 backlog 之前');
  assert.ok(pos('CHG-20260608-05') < pos('CHG-20260608-07'), 'backlog 档内 CHG-ID 升序 05<07（修倒序）');
  assert.ok(pos('CHG-20260608-07') < pos('CHG-20260608-08'), 'backlog 档内 CHG-ID 升序 07<08');
});

// --- 11. CHG-B：change-set 进度按纯 seq 升序（与 stop.js 成组提醒对称，不受 running 优先影响）---
test('SL-11. change-set 进度按 change-set-seq 升序展示', () => {
  const state = makeActiveState({
    activeChangeSummaries: [
      mkSummary('CHG-20260608-08', 'backlog', '5/5'),
      mkSummary('CHG-20260608-07', 'backlog', '4/5'),
      mkSummary('CHG-20260608-06', 'running', '3/5'),
      mkSummary('CHG-20260608-05', 'backlog', '2/5'),
    ],
  });
  const l0Text = buildLayers(state, 'startup', paceUtils).l0.join('\n');
  assert.ok(l0Text.includes('2/5, 3/5, 4/5, 5/5'),
    `change-set 进度应按 seq 升序「2/5, 3/5, 4/5, 5/5」（running 优先不污染进度序列），实际 L0：${l0Text}`);
  assert.ok(!l0Text.includes('5/5, 4/5, 3/5, 2/5'), 'change-set 进度不应为倒序');
});

// --- 12. group=core 含工作流入口+L0、不含 findings/corrections ---
test('SL-12. group=core 含工作流入口+L0、不含 findings/corrections', () => {
  // makeActiveState 的 artifactFiles 默认为空，补 findings/corrections 字段用于 artifact group 渲染
  const state = makeActiveState({
    artifactFiles: [
      { file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[finding-x|测试 finding]] — summary [date:: 2026-06-08] [impact:: P1]\n' },
      { file: 'corrections.md', full: '# Corrections 索引\n\n## 活跃记录\n\n- [[correction-x]] 测试纠正 [date:: 2026-06-08]\n' },
    ],
  });
  const { l1head, l0, l3 } = buildLayers(state, 'startup', paceUtils, 'core');
  const all = [...l1head, ...l0, ...l3].join('\n');
  assert.ok(all.includes('=== PACEflow 工作流入口 ==='), 'core 含工作流入口');
  assert.ok(all.includes('=== 活跃 CHG 摘要 ==='), 'core 含 L0 活跃 CHG 摘要');
  assert.ok(!all.includes('=== findings.md ==='), 'core 不含 findings.md');
  assert.ok(!all.includes('=== corrections.md ==='), 'core 不含 corrections.md');
});

// --- 13. group=artifact 含 findings/corrections、不含工作流入口 ---
test('SL-13. group=artifact 含 findings/corrections、不含工作流入口', () => {
  const state = makeActiveState({
    artifactFiles: [
      { file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[finding-x|测试 finding]] — summary [date:: 2026-06-08] [impact:: P1]\n' },
      { file: 'corrections.md', full: '# Corrections 索引\n\n## 活跃记录\n\n- [[correction-x]] 测试纠正 [date:: 2026-06-08]\n' },
    ],
  });
  const { l1head, l3 } = buildLayers(state, 'startup', paceUtils, 'artifact');
  const all = [...l1head, ...l3].join('\n');
  assert.ok(
    all.includes('=== findings.md ===') || all.includes('=== corrections.md ==='),
    'artifact 含 findings/corrections'
  );
  assert.ok(!all.includes('=== PACEflow 工作流入口 ==='), 'artifact 不含工作流入口');
});

// --- 14a. M3：artifact 文件块移 l3（可截层）后受全局 chars 兜底约束 ---
// CHG-09 R 审计发现 1：artifact 文件块原 push 进 l1head（head 永不截），全局 budget 对 artifact 主体失效。
// 移 l3 后，满载 artifact group 经 assembleWithBudget(9500) 兜底，整体应被截到 ≤9500(+footer)。
test('SL-14a. artifact group 满载文件块移 l3 后被全局兜底截到 <9500', () => {
  const bigCorr = '# Corrections\n\n## 活跃记录\n\n' + Array.from({length: 30}, (_, i) => `- [[correction-2026-06-${String(i+1).padStart(2,'0')}-01-x]] 纠正记录占位较长文本测试字符串内容 ${i}`).join('\n') + '\n';
  const bigSpec = '# 规格\n\n' + 'x'.repeat(12000) + '\n';
  const state = makeActiveState({ artifactFiles: [
    { file: 'corrections.md', full: bigCorr },
    { file: 'spec.md', full: bigSpec },
  ]});
  const layers = buildLayers(state, 'startup', paceUtils, 'artifact');
  const { text } = assembleWithBudget(layers, { limitChars: 9500 });
  assert.ok(text.length <= 9500 + 200, `artifact 满载应被全局兜底截到 ≤9500(+footer)，实际 ${text.length}`);
});

// --- 14b. M3 T-002：artifact 满载经「类内截断」缩小后存活 packL3（非整条 omit）+ 含长尾指针 ---
// T-001 移 l3 后，超大块 > remain 会被 packL3 整条 omit、连带后续块也 omit。
// T-002 加类内截断把 corrections（最近 6）/findings（P0P1全+P2P3 最近 5）缩小，使其存活 packL3，
// 内容缩小后随块注入（含「另有 N 条…」长尾指针），而非整条 omit。
test('SL-14b. artifact 满载类内截断后优雅 + 含长尾指针（非整条 omit）', () => {
  const corr = Array.from({length: 20}, (_, i) => `- [[correction-2026-06-${String(i+1).padStart(2,'0')}-01-x]] 纠正记录 ${i} 较长占位字符串测试内容`).join('\n');
  const finds = Array.from({length: 10}, (_, i) => `- [ ] [[finding-x${i}|finding ${i}]] — summary 较长占位 [date:: 2026-06-08] [impact:: ${i<2?'P1':'P3'}]`).join('\n');
  const state = makeActiveState({ artifactFiles: [
    { file: 'corrections.md', full: `# Corrections\n\n## 活跃记录\n\n${corr}\n` },
    { file: 'findings.md', full: `# 调研记录\n\n## 未解决问题\n\n${finds}\n` },
  ]});
  const layers = buildLayers(state, 'startup', paceUtils, 'artifact');
  const { text } = assembleWithBudget(layers, { limitChars: 9500 });
  assert.ok(text.length <= 9500 + 200, `≤9500(+footer)，实际 ${text.length}`);
  // 类内截断让块缩小后存活（非整条 omit）——corrections/findings 内容都在
  assert.ok(text.includes('避免重犯请 Read corrections.md') || text.includes('另有'), '含类内截断长尾指针');
});

// --- 15. findings 仅 active [ ] 注入，[-] won't-fix 排除（impact 优先类内截断保持 active 过滤）---
test('SL-15. findings 仅 active [ ] 注入，[-] won-t-fix 排除', () => {
  const state = makeActiveState({ artifactFiles: [
    { file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[f-active|active P1]] — x [date:: 2026-06-08] [impact:: P1]\n- [-] [[f-wontfix|已决定不修]] — y [date:: 2026-06-08] [impact:: P3]\n' },
  ]});
  const layers = buildLayers(state, 'startup', paceUtils, 'artifact');
  const all = [...layers.l1head, ...layers.l3].join('\n');
  assert.ok(all.includes('active P1'), 'active [ ] 注入');
  assert.ok(!all.includes('已决定不修'), '[-] won\'t-fix 不注入');
});

// === CHG-20260609-01 收尾质量修复断言 ===

// --- T-001 G：inconsistent CHG 不被渲染成「无活跃 CHG」 ---
test('SL-16. inconsistent CHG 注入「状态异常」段、不渲染成「无活跃 CHG」（G 修复）', () => {
  const state = makeActiveState({
    taskFullCached: '# 任务\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n',
    activeChangeSummaries: [
      { id: 'CHG-20260609-09', category: 'inconsistent', status: 'unknown',
        ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
        pending: 0, approved: false, verified: false, reviewed: false,
        path: '/tmp/fixture-project/changes/chg-20260609-09.md', changeSet: '', changeSetSeq: '' },
    ],
  });
  const { l0 } = buildLayers(state, 'startup', paceUtils, 'core');
  const text = l0.join('\n');
  assert.ok(text.includes('=== CHG 状态异常'), '损坏 CHG 应注入「CHG 状态异常」段');
  assert.ok(text.includes('CHG-20260609-09'), '状态异常段含损坏 CHG id');
  assert.ok(!text.includes('当前无活跃 CHG'), '有 inconsistent 时不注入「无活跃 CHG」（G：避免与摘要矛盾误导）');
});

// --- T-001 D：inconsistent 排序最前 ---
test('SL-17. inconsistent CHG 排序在 running 之前（rankChangeCategory，D 修复）', () => {
  const state = makeActiveState({
    taskFullCached: '# 任务\n\n<!-- ARCHIVE -->\n',
    activeChangeSummaries: [
      { id: 'CHG-RUN', category: 'running', status: 'in-progress', ownerDisposition: 'current',
        ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
        pending: 3, approved: true, verified: false, reviewed: false, path: '/tmp/x/run.md', changeSet: '', changeSetSeq: '' },
      { id: 'CHG-BROKEN', category: 'inconsistent', status: 'unknown', ownerDisposition: 'current',
        ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
        pending: 0, approved: false, verified: false, reviewed: false, path: '/tmp/x/broken.md', changeSet: '', changeSetSeq: '' },
    ],
  });
  const { l0 } = buildLayers(state, 'startup', paceUtils, 'core');
  const summary = l0.find(b => b.includes('活跃 CHG 摘要')) || '';
  const idxBroken = summary.indexOf('CHG-BROKEN');
  const idxRun = summary.indexOf('CHG-RUN');
  assert.ok(idxBroken >= 0 && idxRun >= 0, '两个 CHG 都在摘要');
  assert.ok(idxBroken < idxRun, 'inconsistent 排在 running 之前（损坏优先暴露）');
});

// --- T-002 C/#3：findings 截断指针末尾 + impact 优先 + 同档新→旧 ---
test('SL-18. findings 截断指针在列表末尾不割裂 P0/P1 + impact 优先 + 同档新→旧（C/#3 修复）', () => {
  const finds = [
    '- [ ] [[f-p1|P1 项]] — x [date:: 2026-06-04] [impact:: P1]',
    '- [ ] [[f-p3a|P3 a]] — x [date:: 2026-06-01] [impact:: P3]',
    '- [ ] [[f-p3b|P3 b]] — x [date:: 2026-06-02] [impact:: P3]',
    '- [ ] [[f-p3c|P3 c]] — x [date:: 2026-06-03] [impact:: P3]',
    '- [ ] [[f-p3d|P3 d]] — x [date:: 2026-06-05] [impact:: P3]',
    '- [ ] [[f-p3e|P3 e]] — x [date:: 2026-06-06] [impact:: P3]',
    '- [ ] [[f-p3f|P3 f]] — x [date:: 2026-06-07] [impact:: P3]',
  ].join('\n');
  const state = makeActiveState({ artifactFiles: [
    { file: 'findings.md', full: `# 调研记录\n\n## 未解决问题\n\n${finds}\n` },
  ]});
  const { l3 } = buildLayers(state, 'startup', paceUtils, 'artifact');
  const block = l3.find(b => b.includes('=== findings.md ===')) || '';
  const listLines = block.split('\n').filter(l => /^- \[ \]/.test(l) || l.includes('另有'));
  const pointerIdx = listLines.findIndex(l => l.includes('另有'));
  assert.ok(pointerIdx >= 0, '应有长尾指针（6 条 P3 超 5）');
  assert.strictEqual(pointerIdx, listLines.length - 1, '指针在列表末尾（不夹在 finding 中间，C 修复）');
  assert.ok(block.indexOf('P1 项') < block.indexOf('P3 f'), 'P1 排在 P3 前（impact 优先）');
  assert.ok(block.indexOf('P3 f') < block.indexOf('P3 c'), 'P3 同档新→旧（06-07 在 06-03 前）');
});

// --- T-002 H/#3：corrections 截断指针末尾 + 新→旧 ---
test('SL-19. corrections 截断保留新→旧 + 指针在末尾不在顶部（H/#3 修复）', () => {
  const corr = Array.from({ length: 8 }, (_, i) =>
    `- [[correction-2026-06-0${i + 1}-01-x]] 纠正 ${i} [date:: 2026-06-0${i + 1}]`).join('\n');
  const state = makeActiveState({ artifactFiles: [
    { file: 'corrections.md', full: `# Corrections 索引\n\n## 活跃记录\n\n${corr}\n` },
  ]});
  const { l3 } = buildLayers(state, 'startup', paceUtils, 'artifact');
  const block = l3.find(b => b.includes('=== corrections.md ===')) || '';
  const recLines = block.split('\n').filter(l => /^- \[\[correction/.test(l));
  assert.ok(recLines[0].includes('2026-06-08'), `首条应是最近 06-08（新→旧，实际 ${recLines[0]}）`);
  const listLines = block.split('\n').filter(l => /^- \[\[correction/.test(l) || l.includes('另有'));
  assert.ok(listLines[listLines.length - 1].includes('另有'), '指针在列表末尾');
  assert.ok(!listLines[0].includes('另有'), '指针不在顶部（H 修复）');
});

// === CHG-20260609-02 文案 + helper 精简断言 ===

test('SL-20. 工作流入口含 finding/correction 场景 + 正向 framing（CHG-02 T-001）', () => {
  const state = makeActiveState();
  const head = buildLayers(state, 'startup', paceUtils, 'core').l1head.join('\n');
  assert.ok(head.includes('finding/correction'), '工作流入口含 finding/correction 场景');
  assert.ok(head.includes('自动解析') && head.includes('--cwd'), '正向 framing（自动解析 + --cwd）');
  assert.ok(!head.includes('不要搜索') && !head.includes('不要传'), '无负向 framing（不要搜索/不要传）');
});

test('SL-21. helper 去重（Artifact 目录指向工作流入口）+ findings 子路径（CHG-02 T-002）', () => {
  const state = makeActiveState({
    artifactDirInjected: true,
    artifactFiles: [{ file: 'findings.md', full: '# 调研记录\n\n## 未解决问题\n\n- [ ] [[f|x]] — y [date:: 2026-06-08] [impact:: P1]\n' }],
  });
  const headText = buildLayers(state, 'startup', paceUtils, 'core').l1head.join('\n');
  const artDirSection = headText.split('=== Artifact 目录 ===')[1] || '';
  assert.ok(artDirSection.includes('见上方') && artDirSection.includes('工作流入口'), 'Artifact 目录 helper 指向工作流入口（去重）');
  assert.ok(!artDirSection.includes('artifact-root helper:'), 'Artifact 目录段不再重复 artifact-root helper');
  const findingsBlock = buildLayers(state, 'startup', paceUtils, 'artifact').l3.find(b => b.includes('=== findings.md ===')) || '';
  assert.ok(findingsBlock.includes('changes/findings/'), 'findings 块含子路径线索');
});

test('SL-22. change-set 进度区分执行中 vs 待执行（running 不算待执行，CHG-02 T-002）', () => {
  const state = makeActiveState({
    activeChangeSummaries: [
      { id: 'CHG-A', category: 'running', status: 'in-progress', ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active', pending: 2, approved: true, verified: false, reviewed: false, path: '/tmp/x/a.md', changeSet: 'cs-test', changeSetSeq: '1/3' },
      { id: 'CHG-B', category: 'backlog', status: 'planned', ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active', pending: 0, approved: false, verified: false, reviewed: false, path: '/tmp/x/b.md', changeSet: 'cs-test', changeSetSeq: '2/3' },
    ],
  });
  const csText = buildLayers(state, 'startup', paceUtils, 'core').l0.find(b => b.includes('change-set 整体进度')) || '';
  assert.ok(csText.includes('执行中'), 'change-set 进度区分执行中');
  assert.ok(!csText.includes('还有 2 个待执行'), '不把 running 算入待执行（1 running + 1 backlog ≠ 2 待执行）');
});

// --- SL-23/24/25：活跃 CHG 摘要下注入任务清单本体（CHG-20260609-03 T-001）---
// in-progress（running）CHG 注入完整任务行（含 [状态]），planned 只注入任务标题。
// collectState 已把任务行加工成 summary.tasks = { items, omitted, mode }，渲染层只缩进展开。
test('SL-23. in-progress CHG 摘要下注入完整任务清单本体', () => {
  const base = makeActiveState().activeChangeSummaries[0];
  const state = makeActiveState({
    activeChangeSummaries: [Object.assign({}, base, {
      status: 'in-progress', category: 'running',
      tasks: { items: ['- [/] T-001 任务甲', '- [ ] T-002 任务乙'], omitted: 0, mode: 'full' },
    })],
  });
  const text = buildLayers(state, 'startup', paceUtils, 'core').l0.join('\n');
  assert.ok(text.includes('T-001') && text.includes('任务甲'), '注入任务本体 T-001');
  assert.ok(text.includes('T-002') && text.includes('任务乙'), '注入任务本体 T-002');
  assert.ok(text.includes('[/]'), '完整模式保留 [状态] 标记');
  // 摘要行 + path + 末尾「先 Read 详情」提示保持不变
  assert.ok(text.includes('继续、恢复或收口已有 CHG'), '末尾 Read 详情提示保持不变');
});

test('SL-24. in-progress 任务超展开上限 → 含「另有 K 个任务」指针', () => {
  const base = makeActiveState().activeChangeSummaries[0];
  const state = makeActiveState({
    activeChangeSummaries: [Object.assign({}, base, {
      status: 'in-progress', category: 'running',
      tasks: { items: ['- [/] T-001 甲', '- [ ] T-002 乙'], omitted: 3, mode: 'full' },
    })],
  });
  const text = buildLayers(state, 'startup', paceUtils, 'core').l0.join('\n');
  assert.ok(text.includes('另有 3 个任务'), '超量提示「另有 K 个任务」');
  assert.ok(/Read changes\//.test(text), '指针指向 Read changes/<id>.md');
});

test('SL-25. planned CHG mode=title 只注入任务标题、不含独立 [状态] 标记', () => {
  const base = makeActiveState().activeChangeSummaries[0];
  const state = makeActiveState({
    activeChangeSummaries: [Object.assign({}, base, {
      id: 'CHG-PLANNED', status: 'planned', category: 'backlog', approved: false,
      tasks: { items: ['T-001 规划任务甲', 'T-002 规划任务乙'], omitted: 0, mode: 'title' },
    })],
  });
  const text = buildLayers(state, 'startup', paceUtils, 'core').l0.join('\n');
  assert.ok(text.includes('T-001') && text.includes('规划任务甲'), 'planned 注入任务标题');
  // title 模式去掉 checkbox 状态标记，不应出现 [ ] / [/] / [x] 形态
  assert.ok(!/\[[ /x!-]\]\s+T-/.test(text), 'title 模式不含 [状态] 前缀的任务行');
});

// --- SL-26：预算护栏②——单行任务字符截断（验收详情常写进任务标题，单行可达 400+ 字）---
test('SL-26. buildTaskInjection 长任务行截断到上限 + 补省略号（预算护栏②）', () => {
  const longTitle = '甲'.repeat(300); // 远超 160 字上限
  const raw = `- [/] T-001 ${longTitle}\n- [ ] T-002 短任务`;
  const t = buildTaskInjection({ status: 'in-progress', category: 'running', taskSectionRaw: raw });
  assert.ok(t, '有任务返回非 null');
  assert.strictEqual(t.mode, 'full', 'in-progress 为 full 模式');
  assert.ok(t.items[0].length <= 161, '长行截断到 ~160 字（+省略号）');
  assert.ok(t.items[0].endsWith('…'), '截断行补省略号');
  assert.ok(t.items[0].includes('T-001'), '截断仍保住 T-NNN 主干');
  assert.ok(t.items[1].includes('短任务') && !t.items[1].endsWith('…'), '短行不截断');
});

// --- SL-27：降级——无任务清单段 / 无任务行 → 返回 null，渲染层不出空展开 ---
test('SL-27. buildTaskInjection 无任务行降级返回 null（渲染层不出空展开）', () => {
  assert.strictEqual(buildTaskInjection({ status: 'in-progress', taskSectionRaw: '' }), null, '空段 → null');
  assert.strictEqual(buildTaskInjection({ status: 'in-progress', taskSectionRaw: '只有正文，提到 T-999 但非任务行' }), null, '无任务行 → null');
  assert.strictEqual(buildTaskInjection({ status: 'in-progress' }), null, '无 taskSectionRaw 字段 → null');
  // 渲染层：summary 无 tasks 字段时摘要正常、不出现空缩进展开
  const state = makeActiveState();
  const text = buildLayers(state, 'startup', paceUtils, 'core').l0.join('\n');
  assert.ok(text.includes('=== 活跃 CHG 摘要 ==='), '无 tasks 时摘要仍注入');
});

test('SL-28. 跨 CHG 任务本体总量护栏（超上限后续 CHG 不展开 + 指针，P2 修复）', () => {
  const bigTasks = Array.from({ length: 8 }, (_, i) => `T-00${i + 1} [/] ${'长任务标题占位'.repeat(12)}`);
  const summaries = Array.from({ length: 6 }, (_, k) => ({
    id: `CHG-2026060${k}-09`, category: 'running', status: 'in-progress',
    ownerDisposition: 'current', ownerWorktree: 'main', ownerBranch: 'master', ownerState: 'active',
    taskCheckbox: '/', implCheckbox: '/', pending: 8, approved: true, verified: false, reviewed: false,
    path: `/tmp/x/chg-${k}.md`, changeSet: '', changeSetSeq: '',
    tasks: { items: bigTasks, omitted: 0, mode: 'full' },
  }));
  const { l0 } = buildLayers(makeActiveState({ activeChangeSummaries: summaries }), 'startup', paceUtils, 'core');
  const text = l0.join('\n');
  assert.ok(text.includes('任务本体注入已达预算上限'), '超跨 CHG 总量护栏后注入收口指针');
  assert.ok(l0.join('').length < 9500, `l0 任务本体总量受控 <9500（实际 ${l0.join('').length}）`);
});

process.on('exit', () => {
  t.cleanup();
  console.log(`\n✅ ${t.passed}/${t.passed + t.failed} tests passed`);
  if (t.failed > 0) process.exitCode = 1;
});
