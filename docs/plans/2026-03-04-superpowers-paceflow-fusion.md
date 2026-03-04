# Superpowers × PACEflow 融合实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Superpowers 三阶段（brainstorming → writing-plans → executing）融入 PACE 五阶段（P-A-C-E-V）作为默认工作方式。

**Architecture:** 仅修改 2 个 skill 文档（pace-workflow.md + pace-bridge.md），hook 零改动。pace-workflow.md 作为唯一入口编排器，每阶段引导 invoke 对应的 Superpowers skill；pace-bridge.md 增加 auto-APPROVED 说明和转换摘要格式。

**Tech Stack:** Markdown skill 文档（无代码变更）

**设计文档:** `docs/plans/2026-03-04-superpowers-paceflow-fusion-design.md`

---

### Task 1: 重写 pace-workflow.md P 阶段

**Files:**
- Modify: `paceflow/skills/pace-workflow.md:38-56`

**Step 1: 定位当前 P 阶段内容**

当前 L38-56 的内容需要替换。保留搜索资源优先级（L53-56），其余重写。

**Step 2: 替换 P 阶段内容**

将 L38-56 替换为：

```markdown
### P (Plan - 设计)

**默认使用 brainstorming skill** 探索设计空间：

invoke `superpowers:brainstorming` — 完整 6 步流程：
1. 探索项目上下文
2. 提问澄清需求
3. 提出 2-3 方案 + trade-offs
4. 逐段展示设计
5. 写设计文档 → `docs/plans/YYYY-MM-DD-<topic>-design.md` + git commit
6. 自动 invoke `superpowers:writing-plans` → `docs/plans/YYYY-MM-DD-<feature>.md`

P 阶段完成标志：`docs/plans/` 中有新的计划文件。

**降级条件**（不使用 brainstorming，回退 PACE 原生规划）：
- HOTFIX / 紧急修复
- 用户已给出完整需求，无需设计探索
- 用户明确说"直接做"/"不需要 brainstorming"

降级时：直接分析代码上下文、识别依赖、风险评估，然后进入 A 阶段手动创建 artifacts。

**搜索资源优先级**：
1. **Context7 MCP**：库/框架官方文档（优先）
2. **互联网搜索**：通用问题、Stack Overflow、博客
3. **GitHub Issues/Discussions**：特定库的已知问题
```

**Step 3: 验证修改**

确认 P 阶段内容正确：默认 brainstorming、6 步流程、降级条件、搜索优先级保留。

---

### Task 2: 重写 pace-workflow.md A 阶段

**Files:**
- Modify: `paceflow/skills/pace-workflow.md:58-70`

**Step 1: 定位当前 A 阶段内容**

当前 L58-70 的内容需要替换。保留 findings 反向关联（L63）和 Artifact 存储位置说明（L65）。

**Step 2: 替换 A 阶段内容**

将 L58-70 替换为：

```markdown
### A (Artifact - 准备)

**Superpowers 流程**（P 阶段使用了 brainstorming）：

invoke `pace-bridge` skill — 自动完成以下步骤：
1. 读取 `docs/plans/` 最新计划文件，提取任务列表
2. 生成 CHG-ID（`CHG-YYYYMMDD-NN`）+ T-NNN 编号
3. 写入 `implementation_plan.md` 变更索引（`[/]` 状态）
4. 写入 `task.md` 活跃任务 + `<!-- APPROVED -->`（auto-APPROVED，详见 pace-bridge skill）
5. 输出转换摘要供事后审阅

A 阶段完成标志：task.md 有活跃任务 + `<!-- APPROVED -->` + impl_plan 有 `[/]` 条目。

**降级流程**（P 阶段未使用 brainstorming）：
1. 手动创建/更新 `task.md`
2. 累积更新 `implementation_plan.md`（变更索引添加 `[ ]` 条目）
3. 读取 [change-management](change-management.md) skill 执行变更 ID 管理
4. 进入 C 阶段等待用户审批

**findings 反向关联**：如果本次变更源自 findings.md 调研结论，在对应 finding 条目补 `[change:: CHG-ID]` 并将状态更新为 `[x]`。

> **Artifact 存储位置**：所有 Artifact 文件存储在 Obsidian Vault（`VAULT_PATH/projects/<projectName>/`），PreToolUse hook 自动将 CWD 路径重定向到 vault 路径。详细的 artifact 结构和 Write vs Edit 规则参见 [artifact-management](artifact-management.md)。
```

**Step 3: 验证修改**

确认 A 阶段：Superpowers 流程 invoke pace-bridge、降级路径保留手动创建、findings 反向关联保留、存储位置说明保留。

---

### Task 3: 重写 pace-workflow.md C 阶段

**Files:**
- Modify: `paceflow/skills/pace-workflow.md:72-87`

**Step 1: 定位当前 C 阶段内容**

当前 L72-87 是完整的手动审批流程。需要改为双模式（Superpowers 自动 / 降级手动）。

**Step 2: 替换 C 阶段内容**

```markdown
### C (Check - 确认)

**Superpowers 流程**：pace-bridge 已在 A 阶段自动标记 `<!-- APPROVED -->`（auto-APPROVED），因为用户在 brainstorming 中已参与设计决策，writing-plans 中已审阅实施计划。C 阶段被吸收，直接进入 E 阶段。

**降级流程**（未使用 Superpowers 时）：
**停止执行**，询问用户：是否批准该计划？

前置检查（询问确认前必须执行）：
- 重读 `task.md` - 确认任务范围未偏离
- 重读 `implementation_plan.md` - 确认技术方案一致

获批后：在 `task.md` 活跃区添加 `<!-- APPROVED -->` 标记，将首个任务标为 `[/]`。同时将 `implementation_plan.md` 变更索引状态从 `[ ]` 改为 `[/]`。

**严禁批准前修改代码。**

> [!note] v4.8.0 Hook 强制
> PreToolUse 会检查活跃区是否有 `<!-- APPROVED -->` 标记或 `[/]` 任务。
> 若所有任务为 `[ ]` 且无 APPROVED 标记，写代码文件会被 **deny**。
> v4.4.3 起还会检查 `implementation_plan.md` 是否有 `[/]` 进行中的变更索引，无则 **deny**。
```

**Step 3: 验证修改**

确认 C 阶段：Superpowers 时自动跳过、降级时保留完整手动审批、Hook 强制说明保留。

---

### Task 4: 重写 pace-workflow.md E 阶段

**Files:**
- Modify: `paceflow/skills/pace-workflow.md:89-100`

**Step 1: 定位当前 E 阶段内容**

当前 L89-100 是基本执行指导。需要大幅扩展：加入 worktree + 执行方式决策树 + TDD + finishing-branch。

**Step 2: 替换 E 阶段内容**

```markdown
### E (Execute - 执行)

**Superpowers 流程**：

**Step 1 — Worktree 隔离**（推荐）：
`EnterWorktree` 创建隔离分支。PACEflow 在 worktree 中完全可用（`resolveProjectCwd` 向上搜索 `.pace/`，vault artifacts 正常访问）。

降级条件（不使用 worktree）：HOTFIX / 单文件修改 / 用户指定不用。

**Step 2 — 选择执行方式**：

| 条件 | 执行 skill | 说明 |
|------|-----------|------|
| task 有依赖 / 高风险 / 核心模块 | `superpowers:executing-plans` | 每 3 task 停下等人工反馈 |
| 独立 task + 不同 domain | `superpowers:dispatching-parallel-agents` | 多 agent 真并行 |
| 独立 task + 同 domain（**默认**） | `superpowers:subagent-driven-development` | 自动 Spec + Code Quality 双审 |
| 降级（HOTFIX / 简单任务） | 直接执行 | 不使用 Superpowers |

**Step 3 — TDD 开发方法**（推荐）：
invoke `superpowers:test-driven-development` — 写失败测试 → 确认失败 → 写最小实现 → 确认通过 → commit。
降级条件：HOTFIX / UI 样式改动 / 无测试框架。

**Step 4 — 收尾**：
invoke `superpowers:finishing-a-development-branch` — 验证测试 → 选择 merge/PR/keep/discard。

**执行中维护**：
1. 更新 `task.md` 进度（`[/]` → `[x]`）
2. 累积更新 `walkthrough.md`
3. 技术栈变更时同步更新 `spec.md`

**并行执行**：标记 `[P]` 的任务可分配给 subagent 或 Agent Teams teammate 并行执行，参见 [artifact-management](artifact-management.md#并行任务标记-p)。

**执行中检查**：
- 每完成 5 个子任务后，重读 `task.md` 确认方向正确
- 对话超过 20 轮时，主动重读核心 Artifact 刷新上下文
```

**Step 3: 验证修改**

确认 E 阶段：4 步流程（worktree → 执行选择 → TDD → finishing-branch）、降级条件、执行中维护和检查保留。

---

### Task 5: 更新 pace-workflow.md V 阶段

**Files:**
- Modify: `paceflow/skills/pace-workflow.md:102-119`

**Step 1: 定位当前 V 阶段内容**

当前 V 阶段基本完整，只需在开头补充 verification-before-completion 引用。

**Step 2: 在 V 阶段开头添加 Superpowers 引用**

在 `### V (Verify - 验证)` 下方第一行添加：

```markdown
**推荐**：invoke `superpowers:verification-before-completion` — 确保所有完成声称都有新鲜验证证据（IDENTIFY → RUN → READ → VERIFY → CLAIM）。
```

其余内容（测试要求、验证替代、VERIFIED 标记、Hook 强制、G-9 检查）保持不变。

**Step 3: 验证修改**

确认 V 阶段：新增 verification 引用、原有内容完整保留。

---

### Task 6: 增强 pace-bridge.md

**Files:**
- Modify: `paceflow/skills/pace-bridge.md:55-60`

**Step 1: 在 pace-bridge.md 末尾（"重要提示"之后）追加两个新段落**

在 L60 之后追加：

```markdown

## auto-APPROVED 说明

pace-bridge 自动在 task.md 写入 `<!-- APPROVED -->`，这是设计行为而非遗漏：
- 用户在 brainstorming 中已参与设计决策（What to build）
- writing-plans 已生成详细实施计划（How to build）
- 格式转换是机械性操作，不引入新的设计决策
- 用户通过事后审阅 task.md 发现问题可随时叫停

此行为等价于 PACE C 阶段的 `<!-- APPROVED -->`，使 C 阶段被吸收。

## 转换摘要格式

桥接完成后，**必须**输出以下结构化摘要供用户事后审阅：

```
=== pace-bridge 转换摘要 ===
源计划: docs/plans/YYYY-MM-DD-<feature>.md
变更 ID: CHG-YYYYMMDD-NN
任务范围: T-NNN ~ T-NNN（共 N 个）
执行方式推荐: subagent-driven-development / executing-plans / dispatching-parallel-agents
```
```

**Step 2: 验证修改**

确认 pace-bridge.md：原有 5 步骤不变、新增 auto-APPROVED 说明 + 转换摘要格式。

---

### Task 7: 同步生产环境 + 验证

**Files:**
- Run: `paceflow/install.js --force`
- Run: `paceflow/verify.js`

**Step 1: 语法验证**

```bash
for f in paceflow/hooks/*.js; do node -c "$f"; done
```

Expected: 8/8 通过（hook 文件未改动，仅确认环境正常）

**Step 2: 运行 install.js --force 同步 skill 到生产**

```bash
node paceflow/install.js --force
```

Expected: pace-workflow 和 pace-bridge 显示"已更新"

**Step 3: 运行 verify.js 确认一致性**

```bash
node paceflow/verify.js
```

Expected: 5/5 通过

**Step 4: Commit**

```bash
git add paceflow/skills/pace-workflow.md paceflow/skills/pace-bridge.md docs/plans/
git commit -m "feat: Superpowers × PACEflow 融合 — pace-workflow P/A/C/E/V 重写 + pace-bridge auto-APPROVED"
```
