# Review Gate 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施。但本仓库受 PACEflow 治理——实际执行必须先 `create-chg` 把下列 Task 落成 T-001..T-NNN，获批后再写代码。步骤用 `- [ ]` checkbox 跟踪。

**Goal:** 给 PACEflow 状态机新增与 VERIFIED 同构的 `REVIEWED` 标记——CHG 收口前主 session 派自选 review agent 对 diff 做对抗审计，close-chg 把"审计这步跑过了"连同验证、归档一起落字；只强制步骤发生、不裁决质量。

**Architecture:** 编排在 workflow（主 session 派审计、读报告、路由 findings），落字在 artifact-writer（只写 REVIEWED）。stop.js 在现有 closing-required 分支内细分出"verified 但未 reviewed"门，复用现成全局 counter 防循环（连阻 3 次自动降级），照抄 verify 门即免疫 codex 式死循环。findings 走既有 HOTFIX / record-finding，severity 闸（P0/P1 处置、P2/P3 backlog）+ 迭代闸（HOTFIX 深度=1）+ marker 幂等三道防无止境。

**Tech Stack:** Node.js（CommonJS）hooks、PACEflow agent-references（Markdown 指令）、Claude Code plugin、`tests/test-pace-utils.js`（单元）+ `tests/test-hooks-e2e.js`（E2E）+ `tests/agent-tests/`（agent contract）。

**设计来源：** `docs/superpowers/specs/2026-06-06-review-gate-design.md`（spec，已获批）。

---

## 文件结构（改动地图）

| 文件 | 职责 | 动作 |
|---|---|---|
| `plugin/hooks/pace-utils/change-analysis.js` | 状态判定 | 加 `isChangeReviewed()`、导出、`classifyChange` 挂 `reviewed` 字段 |
| `plugin/hooks/stop.js` | Stop 门 | closing-required 分支由两段改三段（插 REVIEWED 门）|
| `plugin/hooks/post-tool-use.js` | PostToolUse 软催 | archive-reminded 加 `&& reviewed` 条件 + 新增 review-missing warnOnce |
| `plugin/hooks/pace-utils/constants.js` | session flag 清理 | `SESSION_SCOPED_FLAG_PREFIXES` 加 `'review-missing-'` |
| `plugin/agent-references/instructions/review-chg.md` | 新 writer 操作 | 新建：`update-chg action=review` 写 REVIEWED |
| `plugin/agent-references/instructions/close-chg.md` | 收口操作 | 折叠 REVIEWED（要 review-confirmed）|
| `plugin/agents/artifact-writer.md` | 操作注册 | 注册 `action=review` |
| `plugin/skills/pace-workflow/references/review-methodology.md` | 通用审计方法论 | 新建（可发布，抽 internal audit 内核）|
| `plugin/skills/pace-workflow/SKILL.md` | close 流编排 | 加"审计 + 路由"步骤 |
| `plugin/skills/artifact-management/SKILL.md` | 字段格式 | 加 review 字段格式 |
| `internal/skills/audit/SKILL.md` | 内部自审 | 加一行引用同一方法论 reference（去重）|
| `REFERENCE.md` | 权威手册 | 状态机表 + 操作表 + Stop 覆盖更新 |
| `tests/test-pace-utils.js` / `tests/test-hooks-e2e.js` / `tests/agent-tests/` | 测试 | 新增 REVIEWED 门 + writer 契约用例 |

---

## Phase 1 — 状态机判定层 + Stop/PostToolUse 门（核心触发）

> 这是用户最关心的硬阻断段。全部复用现成机制，零新防循环代码。

### Task 1：`isChangeReviewed()` + `classifyChange` 挂 `reviewed` 字段

**Files:**
- Modify: `plugin/hooks/pace-utils/change-analysis.js`（`isChangeVerified` 之后加 `isChangeReviewed`；`classifyChange` :203/:212 旁挂 `reviewed`；导出处加 `isChangeReviewed`）
- Test: `tests/test-pace-utils.js`

- [ ] **Step 1：写失败测试**（断言 `isChangeReviewed` 与 classifyChange.reviewed）

在 `tests/test-pace-utils.js` 仿现有 `isChangeVerified` 用例新增（用相同的 detail fixture 构造方式）：
```
// REVIEW-GATE T1：isChangeReviewed 仅在 reviewed-date 非 null + <!-- REVIEWED --> 同时存在时为真
detail = makeDetail({ frontmatter: { 'reviewed-date': '2026-06-06T10:00:00+08:00' }, content: '<!-- REVIEWED -->' });
assert.strictEqual(isChangeReviewed(detail), true);
assert.strictEqual(isChangeReviewed(makeDetail({ frontmatter: { 'reviewed-date': 'null' }, content: '<!-- REVIEWED -->' })), false);
assert.strictEqual(isChangeReviewed(makeDetail({ frontmatter: { 'reviewed-date': '2026-06-06T10:00:00+08:00' }, content: '' })), false);
// classifyChange 在 completed+verified 详情上挂 reviewed
const cls = classifyChange(entryCompletedVerifiedReviewed);
assert.strictEqual(cls.reviewed, true);
```
（`makeDetail` / `entry*` 照抄本文件现有 isChangeVerified 测试的构造 helper。）

- [ ] **Step 2：跑测试确认失败**

Run: `node tests/test-pace-utils.js`
Expected: FAIL（`isChangeReviewed is not defined` 或 `cls.reviewed === undefined`）

- [ ] **Step 3：实现**

在 `change-analysis.js` 的 `isChangeVerified`（:284-288）紧后加：
```js
  function isChangeReviewed(detail) {
    if (!detail || detail.missing) return false;
    const reviewedDate = normalizeFrontmatterStatus(detail.frontmatter['reviewed-date']).toLowerCase();
    return Boolean(reviewedDate && reviewedDate !== 'null' && /<!-- REVIEWED -->/.test(detail.content));
  }
```
在 `classifyChange` 里，`const verified = isChangeVerified(detail);`（:203）紧后加：
```js
    const reviewed = isChangeReviewed(detail);
```
在 `base` 对象 `verified,`（:212）紧后加：
```js
      reviewed,
```
在本模块工厂的返回对象里（`isChangeVerified` 被导出处）加 `isChangeReviewed,`，使 post-tool-use.js 可同样导入。

- [ ] **Step 4：跑测试确认通过**

Run: `node tests/test-pace-utils.js`
Expected: PASS

- [ ] **Step 5：提交**
```bash
git add plugin/hooks/pace-utils/change-analysis.js tests/test-pace-utils.js
git commit -m "feat(review-gate): isChangeReviewed 判定 + classifyChange 挂 reviewed 字段"
```

### Task 2：stop.js closing-required 三段分支（REVIEWED 门）

**Files:**
- Modify: `plugin/hooks/stop.js:249-256`
- Test: `tests/test-hooks-e2e.js`

- [ ] **Step 1：写失败测试**（E2E，照抄现有 verify 门 e2e 用例的 fixture 搭法）

新增两条 E2E：
```
// RG-2a：completed + verified 但未 reviewed → Stop 第 1 次硬阻断(exit 2)，stderr 含 "未审计"
fixture：changes/<id>.md status=completed + verified-date 非空 + <!-- VERIFIED -->，无 <!-- REVIEWED -->；task.md/impl 活跃索引 [x]
assert: exitCode === 2 && stderr 含 '未审计'
// RG-2b：completed + verified + reviewed → 不再触发 REVIEWED 门，落到 archive 门(exit 2，stderr 含 "仍在活跃索引")
fixture：同上但补 reviewed-date + <!-- REVIEWED -->
assert: exitCode === 2 && stderr 含 '仍在活跃索引' && stderr 不含 '未审计'
```

- [ ] **Step 2：跑测试确认失败**

Run: `node tests/test-hooks-e2e.js`
Expected: FAIL（RG-2a：当前 verified 即落 archive 门，stderr 不含"未审计"）

- [ ] **Step 3：实现**——把 `stop.js:249-256` 整段替换为三段：
```js
    if (change.category === 'closing-required') {
      if (!change.verified) {
        addWarning('verify', `${ownerPrefix}${change.id} 已 completed 但未验证。请先运行验证并阅读结果；确认通过后派 artifact-writer close-chg 写入 VERIFIED 并归档。若只记录验证暂不归档，才派 update-chg action=verify。字段格式见 Skill(paceflow:artifact-management)。`);
      } else if (!change.reviewed) {
        addWarning('verify', `${ownerPrefix}${change.id} 已验证但未审计。请按本 CHG diff 自选合适的 review agent 做对抗审计，路由 findings（P0/P1 开 HOTFIX 或记 won't-fix，P2/P3 派 record-finding），再派 close-chg（含 review-confirmed/review-source/review-findings）写入 REVIEWED 并归档。若只记录审计暂不归档，才派 update-chg action=review。字段格式见 Skill(paceflow:artifact-management)。`);
      } else {
        requiresWalkthrough = true;
        addWarning('repair', `${ownerPrefix}${change.id} 已 completed 且 verified、reviewed，仍在活跃索引中。请派 artifact-writer close-chg（已验证已审计则只做归档收尾）或 archive-chg 归档。字段格式见 Skill(paceflow:artifact-management)。`);
      }
    }
```
注意（来自调研的 over-block 雷点）：① REVIEWED 门**不置** `requiresWalkthrough`（还没到归档阶段，置了会误催 walkthrough）；② 三段互斥，同一 CHG 一次只出一条 warning；③ 整段在现有 for 循环内、`isForeignOwner` 跳过（:163-176）之后，自动不误拦别 worktree 的 CHG；④ category 用 `'verify'`，只影响 stderr 措辞（"仅修复"族），不影响阻断/降级——REVIEWED warning 进同一 `warnings` 数组即继承全局 counter 降级。

- [ ] **Step 4：跑测试确认通过**

Run: `node tests/test-hooks-e2e.js`
Expected: PASS（RG-2a/2b 均过）

- [ ] **Step 5：防循环 + 软路径边界回归确认**（不新增代码，验证继承机制 + 钉死边界）

5a 防循环：同一 verified-未reviewed fixture 连跑 4 次 Stop（mock `.pace/stop-block-count` 递增），断言第 4 次 `exitCode === 0` 且 `.pace/degraded` 被写（证 REVIEWED 门不会无限 exit 2）。
5b 软路径边界（回应"REVIEWED 门是否吃 deferred/background 软路径"）：verified-未reviewed fixture **+ 注入 background_tasks**，断言仍 `exitCode === 2` 且 stderr 含「未审计」（证不吃 background 豁免——该豁免限 `running`+`pending>0`）；同 fixture 断言 stdout 不含 deferred `systemMessage`（证 closing-required 不进 `softReminders`）。
Run: `node tests/test-hooks-e2e.js`
Expected: PASS

- [ ] **Step 6：提交**
```bash
git add plugin/hooks/stop.js tests/test-hooks-e2e.js
git commit -m "feat(review-gate): stop.js 插 verified-but-not-reviewed 门，复用 counter 防循环"
```

### Task 3：post-tool-use.js 镜像分支 + constants prefix

**Files:**
- Modify: `plugin/hooks/post-tool-use.js:196-198`（archive-reminded 加 reviewed 条件 + 插 review-missing）
- Modify: `plugin/hooks/pace-utils/constants.js`（`SESSION_SCOPED_FLAG_PREFIXES` 加 `'review-missing-'`）
- Test: `tests/test-pace-utils.js` 或 `tests/test-hooks-e2e.js`

- [ ] **Step 1：写失败测试**
```
// RG-3a：completed+verified 但未 reviewed → PostToolUse 软催 review-missing，不催 archive
assert: additionalContext 含 '未审计' && 不含 'archive-reminded' 文案 ('优先派 close-chg 归档')
// RG-3b：completed+verified+reviewed → 催 archive-reminded（恢复原行为）
assert: additionalContext 含 '优先派 close-chg 归档'
```

- [ ] **Step 2：跑测试确认失败**

Run: `node tests/test-pace-utils.js`（或 e2e）
Expected: FAIL（当前 verified 即催 archive，verified-未reviewed 时会错催归档）

- [ ] **Step 3：实现**——把 `post-tool-use.js:196-198` 改为（在 verify-missing 分支 :193-195 之后）：
```js
        if (status === 'completed' && isChangeVerified(entry.detail) && !isChangeReviewed(entry.detail)) {
          warnOnce(`review-missing-${entry.slug}`, `${entry.id} 已验证但未审计（缺 reviewed-date 或 <!-- REVIEWED -->）。请按本 CHG diff 自选 review agent 做对抗审计、路由 findings，再派 close-chg（含 review-confirmed）写 REVIEWED；只记录审计暂不归档才派 update-chg action=review。`);
        }
        if (status === 'completed' && isChangeVerified(entry.detail) && isChangeReviewed(entry.detail)) {
          warnOnce(`archive-reminded-${entry.slug}`, `${entry.id} 已验证已审计但仍在活跃索引中，请优先派 close-chg 归档；archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`);
        }
```
并确保 `isChangeReviewed` 已从 pace-utils 导入（同 `isChangeVerified` 的导入方式，Task 1 已导出）。
在 `constants.js` 的 `SESSION_SCOPED_FLAG_PREFIXES` 数组里 `'verify-missing-',` 后加：
```js
  'review-missing-',
```

- [ ] **Step 4：跑测试确认通过**

Run: `node tests/test-pace-utils.js && node tests/test-hooks-e2e.js`
Expected: PASS

- [ ] **Step 5：提交**
```bash
git add plugin/hooks/post-tool-use.js plugin/hooks/pace-utils/constants.js tests/test-pace-utils.js tests/test-hooks-e2e.js
git commit -m "feat(review-gate): post-tool-use 镜像分支 + review-missing session flag"
```

---

## Phase 2 — artifact-writer 写 REVIEWED（让门可满足）

### Task 4：新建 `update-chg action=review` 指令

**Files:**
- Create: `plugin/agent-references/instructions/review-chg.md`
- Modify: `plugin/agents/artifact-writer.md`（注册 `action=review`，仿 `action=verify`）

- [ ] **Step 1：写指令文件**——`review-chg.md` 必须规定（仿 `verify` 的 `verify-chg`/update-chg verify 路径）：
  - **必填字段**：`review-confirmed: true`、`review-source`（`manual` 或所选 review agent/棱镜名）、`review-findings`（P0/P1/P2/P3 计数 + 各自处置：HOTFIX wikilink / won't-fix finding wikilink / record-finding wikilink）。
  - **前置校验**：目标 CHG 必须已 verified（有 `verified-date` + `<!-- VERIFIED -->`）；否则拒绝并提示"先验证再审计"。缺 `review-confirmed` 拒绝（仿 approval-confirmed gating）。
  - **写入动作**：① frontmatter 写 `reviewed-date: <ISO8601+08:00>`；② 在 `<!-- VERIFIED -->` **下一行**插 `<!-- REVIEWED -->`；③ 在详情正文 append/更新 `## 审查记录` 段（review-source + findings 计数 + 处置 wikilink）。
  - **不归档**（这是"记审计暂不收口"的逃生口，对标 `update-chg action=verify`）。
- [ ] **Step 2：注册**——在 `artifact-writer.md` 操作表加 `update-chg action=review` 行（仿 `action=verify` 描述）。
- [ ] **Step 3：smoke**

Run: `claude plugin validate ./plugin`
Expected: 通过（无 schema/引用错误）

- [ ] **Step 4：提交**
```bash
git add plugin/agent-references/instructions/review-chg.md plugin/agents/artifact-writer.md
git commit -m "feat(review-gate): 新增 update-chg action=review 写 REVIEWED 标记"
```

### Task 5：close-chg 折叠 REVIEWED

**Files:**
- Modify: `plugin/agent-references/instructions/close-chg.md`

- [ ] **Step 1：改 close-chg 指令**——在现有 `verification-confirmed` 字段旁加必填 `review-confirmed: true` + `review-source` + `review-findings`；写入序列在 VERIFIED 之后、归档之前插 `reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录`。即 close-chg 主路径一把梭：完成→VERIFIED→**REVIEWED**→归档→walkthrough。
- [ ] **Step 2：明确缺字段行为**——close-chg 缺 `review-confirmed` 时拒绝并提示改派 `update-chg action=review` 或补字段（与缺 verification-confirmed 同款）。
- [ ] **Step 3：smoke**

Run: `claude plugin validate ./plugin`
Expected: 通过

- [ ] **Step 4：提交**
```bash
git add plugin/agent-references/instructions/close-chg.md
git commit -m "feat(review-gate): close-chg 折叠 REVIEWED 写入"
```

### Task 6：agent contract 测试

**Files:**
- Create: `tests/agent-tests/cases/phase-v/tc-v-review-chg.yaml`（仿现有 phase-c/phase-v 用例）
- Create: `tests/agent-tests/cases/phase-v/tc-v-close-chg-with-review.yaml`

- [ ] **Step 1：写 contract 用例**——`tc-v-review-chg`：给已 verified 的 CHG 派 `action=review`（带 review-confirmed/source/findings），断言产物含 `reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录`，且未归档。`tc-v-close-chg-with-review`：close-chg 带 review 字段，断言 VERIFIED+REVIEWED 都在、已归档。负例：未 verified 就 review → 拒绝；close-chg 缺 review-confirmed → 拒绝。
- [ ] **Step 2：跑**

Run: `node tests/agent-tests/run-tests.js dummy`（dummy 校验用例结构）+ `node tests/test-agent-tests-helpers.js`
Expected: PASS（结构合法）

- [ ] **Step 3：提交**
```bash
git add tests/agent-tests/cases/phase-v/
git commit -m "test(review-gate): action=review + close-chg with review 契约用例"
```

---

## Phase 3 — workflow 编排 + 方法论 reference（让审计真发生）

### Task 7：新建可发布通用审计方法论 reference

**Files:**
- Create: `plugin/skills/pace-workflow/references/review-methodology.md`

- [ ] **Step 1：写方法论**——抽 `internal/skills/audit/` 内核，**剥光 paceflow 靶子**，写成任意项目可用的"对抗审计方法论"。必含 spec §7 七条内核：① 独立发现不照文档打勾；② 证据优先级（代码>测试>日志>文档，文档不单独定 bug）；③ 报告全部→再验证（误报率 50-80%，验证是核心）；④ 路径追踪/实际 diff/设计意图查证；⑤ 严重度纪律（C/P0 须具体触发路径，反膨胀）；⑥ 误报防御 7 条；⑦ 记录审查基线。并说明主 session 如何按本 CHG diff 自选 review agent 并用本方法论 direct 它、输出 P0-P3 分级报告。
- [ ] **Step 2：smoke**

Run: `claude plugin validate ./plugin`
Expected: 通过（reference 随 pace-workflow skill 发布）

- [ ] **Step 3：提交**
```bash
git add plugin/skills/pace-workflow/references/review-methodology.md
git commit -m "feat(review-gate): 可发布通用审计方法论 reference"
```

### Task 8：pace-workflow close 流加审计步骤 + artifact-management 字段

**Files:**
- Modify: `plugin/skills/pace-workflow/SKILL.md`
- Modify: `plugin/skills/artifact-management/SKILL.md`

- [ ] **Step 1：改 pace-workflow close 流**——在 V（验证）与收口之间插 R（审计）步骤：① 看本 CHG diff；② 按内容自选 review agent，用 `references/review-methodology.md` direct；③ 读 P0-P3 报告；④ 路由 findings（P0/P1 开 HOTFIX 或记 won't-fix；P2/P3 record-finding；迭代闸：审计-findings 生的 HOTFIX 默认不自动重审）；⑤ 派 close-chg（含 review 字段）。明确：审计是主 session 编排、不是 artifact-writer 动作；审计 subagent 必须 **inline/foreground 派发**（Task/Agent 工具）、不可 background——确保审计在途时主 session 是 mid-turn 而非 Stop（见 spec §5.1）。
- [ ] **Step 2：改 artifact-management**——加 review 字段格式块（review-confirmed/review-source/review-findings 写法 + REVIEWED 标记位置说明）。
- [ ] **Step 3：smoke**

Run: `claude plugin validate ./plugin`
Expected: 通过

- [ ] **Step 4：提交**
```bash
git add plugin/skills/pace-workflow/SKILL.md plugin/skills/artifact-management/SKILL.md
git commit -m "feat(review-gate): pace-workflow close 流加审计步骤 + 字段格式"
```

### Task 9：internal audit 引用同一方法论（去重）

**Files:**
- Modify: `internal/skills/audit/SKILL.md`

- [ ] **Step 1：加引用**——在 audit SKILL「审查原则」处加一行：方法论内核见 `plugin/skills/pace-workflow/references/review-methodology.md`，本内部 skill 只在其上叠加 paceflow 专用靶子（plugin/hooks 等 Glob + 5 维度）。避免两套方法论漂移。
- [ ] **Step 2：提交**
```bash
git add internal/skills/audit/SKILL.md
git commit -m "refactor(review-gate): internal audit 引用共享方法论 reference 去重"
```

---

## Phase 4 — 文档 + 状态机权威

### Task 10：REFERENCE.md 更新

**Files:**
- Modify: `REFERENCE.md`（§3 操作表、§4 状态机表、§5 Hook 覆盖、§5.1 teammate 档位）

- [ ] **Step 1：改 §4 状态机表**——加 `reviewed-date` / `REVIEWED` 两列，新增"completed + verified 但未 reviewed = 活跃, Stop 拦'未审计'"行（照 spec §3.2 表）。
- [ ] **Step 2：改 §3 操作表**——加 `update-chg action=review` 行；close-chg 描述补 REVIEWED。
- [ ] **Step 3：改 §5 Hook 覆盖**——stop.js 职责补"verified-未reviewed 拦截"；post-tool-use 补 review-missing 软催。
- [ ] **Step 4：改 §5.1 teammate 档位**——REVIEWED 门归入 stop.js 现有"teammate 一刀切放行"（确认 spec 与代码一致：stop.js teammate 全门 exit 0）。
- [ ] **Step 5：核对一致性**

Run: `git diff --check`（无空白错误）+ 人读 §4 表与 spec §3.2 对齐
Expected: 一致

- [ ] **Step 6：提交**
```bash
git add REFERENCE.md
git commit -m "docs(review-gate): REFERENCE 状态机/操作/Hook 覆盖更新"
```

### Task 11：全套验证 + 版本承载（发布时）

**Files:** （随 review gate 发布版本时）`plugin/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`、`plugin/hooks/pace-utils/constants.js`（PACE_VERSION）、`README.md`

- [ ] **Step 1：全套验证**
```bash
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
node tests/test-agent-tests-helpers.js
node tests/agent-tests/run-tests.js dummy
claude plugin validate ./plugin
git diff --check
```
Expected: 全绿
- [ ] **Step 2：对抗回归验证**（吃自己的狗粮——本 feature 的 review gate 用在自己身上）：派一个 review subagent 对本 CHG 全 diff 做对抗审计，重点查 over-block（三段分支互斥、post-tool-use 镜像、foreign-owner 跳过）、teammate 行为、counter 降级。P0/P1 开 HOTFIX。
- [ ] **Step 3：版本 bump + README**——bump PACE_VERSION + plugin.json + marketplace.json + README 版本历史行。
- [ ] **Step 4：提交**
```bash
git add -A
git commit -m "release(review-gate): vX.Y.Z 承载 REVIEWED 状态机门"
```

---

## Self-Review（写计划者自查）

**1. Spec 覆盖**（逐节对 spec）：
- §3 状态机扩展 → Task 1（reviewed 判定）+ Task 2（Stop 门）✓
- §3.3 阻断-on-步骤不阻断-on-结论 → Task 2 门只查 marker 在不在、findings 不进门 ✓
- §4 分层 → Task 4/5（writer 只落字）+ Task 8（审计在 workflow）✓
- §5 流程（V→R→处置→close）→ Task 8 close 流 ✓
- §6 决策/范围闸/迭代闸/主体/频率 → Task 8 路由步骤（severity+迭代闸）+ Task 4/5（review-source 伸缩）✓
- §7 方法论 reference → Task 7 + Task 9 去重 ✓
- §8 close-chg 关系 → Task 5 折叠 ✓
- §9 发布物 6 项 → Task 1-3（hook）/4-5（writer）/7-8（skill+方法论）/10（REFERENCE）/6（测试）/2-3（stop+post mirror）✓
- §10 防循环（counter 复用）→ Task 2 Step 5 显式回归 ✓
- **缺口检查**：spec §10"频率 rigor dogfood"= Task 11 Step 2 吃狗粮；REVIEWED 标记格式 = Task 4 Step 1 定（VERIFIED 下一行）✓

**2. 占位扫描**：hook 改动全给精确 old/new 代码；agent/skill/doc 给具体必含内容（非"适当处理"）。测试用例给 fixture + 断言行为（harness helper 照抄现有 isChangeVerified/verify 门用例）。无 TODO/TBD。

**3. 类型/命名一致**：`isChangeReviewed`（Task 1 定义 = Task 3 调用 = 一致）；`reviewed` 字段（Task 1 挂 = Task 2 用 `change.reviewed` = 一致）；`reviewed-date` + `<!-- REVIEWED -->`（Task 1 判定 = Task 4/5 写入 = 一致）；`review-missing-` prefix（Task 3 用 = constants 注册 = 一致）；`review-confirmed/review-source/review-findings`（Task 4/5/6/8/10 全程同名）。

---

## 执行交接（PACEflow 适配）

本仓库受 PACEflow 治理，**不走 writing-plans 默认的 subagent/inline 直接执行**，而是：

1. 主 session `reserve-artifact-id --operation create-chg --cwd <repo>` 预留 CHG 编号。
2. 派 artifact-writer `create-chg`，把 Phase 1-4 的 Task 落成 T-001..T-011（task.md / implementation_plan.md 索引）。
3. 获你批准后 `approve-and-start`，逐 Task 执行（每个 Task = 一次 TDD：红→绿→提交）。
4. 末 Task 完成后——**本 feature 第一次吃自己狗粮**——用新建的 review gate 对全 diff 自审，再 close-chg（写 VERIFIED + REVIEWED + 归档）。

执行风格（CHG 内）：可 subagent-driven（每 Task 一个 fresh subagent + Task 间审查）或 inline。
