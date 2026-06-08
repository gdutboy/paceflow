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
const { buildLayers, buildCompactSnapshotText } = require('../plugin/hooks/session-start/layers');
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
    compactSnapshotText: '',
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
  const { text } = assembleWithBudget(layers, { limitBytes: 46000 });
  assert.ok(text.includes('活跃 CHG'), '装配输出应含活跃 CHG');
  assert.ok(text.includes('pace-workflow'), '装配输出应含 pace-workflow skill 入口');
});

// --- 5. compact 模式不注入工作流入口（CHG-A 对称现状：仅非 compact）---
test('SL-5. compact 模式工作流入口不注入（CHG-A 现状，A0 对称留 CHG-C）', () => {
  const state = makeActiveState({ eventType: 'compact' });
  const layers = buildLayers(state, 'compact', paceUtils);
  const headText = layers.l1head.join('\n');
  assert.ok(!headText.includes('=== PACEflow 工作流入口 ==='), 'compact 下 CHG-A 现状不注入工作流入口');
});

// --- 6. buildLayers 纯函数：不写 state 之外、可重复调用幂等 ---
test('SL-6. buildLayers 多次调用输出一致（无隐藏外部状态依赖）', () => {
  const a = buildLayers(makeActiveState(), 'startup', paceUtils);
  const b = buildLayers(makeActiveState(), 'startup', paceUtils);
  assert.strictEqual(a.l0.join('\n'), b.l0.join('\n'), 'L0 两次调用应一致');
  assert.strictEqual(a.l1head.join('\n'), b.l1head.join('\n'), 'head 两次调用应一致');
});

// --- 7. buildCompactSnapshotText 纯函数渲染快照恢复文本 ---
test('SL-7. buildCompactSnapshotText 渲染快照活跃 CHG 与格式速查', () => {
  const snap = {
    timestamp: '2026-06-08T00:00:00.000Z',
    artifacts: { 'task.md': { inProgress: ['- [/] 任务A'], pending: 2 } },
    activeChanges: [{ id: 'CHG-20260608-04', status: 'in-progress', pending: 5, approved: true, verified: false, reviewed: false }],
    runtime: { degraded: false },
    findings: { openCount: 3 },
    walkthrough: { hasTodayEntry: false },
  };
  const text = buildCompactSnapshotText(snap, 'artifact', '/tmp/fixture-project', null, paceUtils);
  assert.ok(text.includes('=== Compact 恢复（快照 2026-06-08T00:00:00.000Z）==='), '应含快照恢复标题');
  assert.ok(text.includes('CHG-20260608-04'), '应含快照活跃 CHG');
  assert.ok(text.includes('=== 格式快速参考 ==='), 'paceSignal 时应含格式速查');
  assert.ok(text.includes('findings 状态：3 个开放项'), '应含 findings 开放计数');
});

// --- 8. CHG-B：assembleWithBudget L3 优先截断——head（l1head/L0/L1/L2）永不截 ---
test('SL-8. L3 超预算从尾部按条截断 + footer，head 永不截', () => {
  const big = 'x'.repeat(200000); // 撑爆预算的超大 L3 条目
  const layers = {
    l1head: ['=== 项目上下文 ===\nHEAD关键\n'],
    l0: ['=== 活跃 CHG ===\nL0关键\n'],
    l1: ['=== git ===\nL1关键\n'],
    l2: ['=== 工作流入口 ===\nL2关键\n'],
    l3: ['=== findings ===\nF1保留\n', big],
  };
  const { text, truncated } = assembleWithBudget(layers, { limitBytes: 128000 });
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
  const { text, truncated } = assembleWithBudget(layers, { limitBytes: 128000 });
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

process.on('exit', () => {
  t.cleanup();
  console.log(`\n✅ ${t.passed}/${t.passed + t.failed} tests passed`);
  if (t.failed > 0) process.exitCode = 1;
});
