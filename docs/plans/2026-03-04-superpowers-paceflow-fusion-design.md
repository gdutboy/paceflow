# Superpowers × PACEflow 融合设计

> **状态**: brainstorming 设计文档
> **日期**: 2026-03-04
> **版本**: PACEflow v4.8.0 + Superpowers 4.3.1

---

## 1. 背景与目标

PACEflow（P-A-C-E-V）和 Superpowers（brainstorming → writing-plans → executing）是两套独立的工作流系统。当前通过 pace-bridge skill 实现了**事后桥接**（Superpowers 完成后手动转换为 PACE artifacts）。

**目标**：将 Superpowers 三阶段**融入** PACE 五阶段，作为默认工作方式，而非事后补救。

**用户工作模式**：skip-permissions 全自动执行 → 事后审阅所有产出物 → 发现问题再讨论修正。

---

## 2. 阶段映射

### 2.1 核心映射

| PACE 阶段 | Superpowers Skill | 产出物 | 用户审阅点 |
|-----------|-------------------|--------|-----------|
| **P (Plan)** | `brainstorming` Step 1-5 | `docs/plans/*-design.md` | 事后审设计方向 |
| **P → A 过渡** | `brainstorming` Step 6 自动 invoke `writing-plans` | `docs/plans/*-plan.md` | 事后审实施计划 |
| **A (Artifact)** | `pace-bridge` | task.md + impl_plan.md + auto APPROVED | 事后审任务拆分 |
| **C (Check)** | 被 A 吸收 | — | — |
| **E (Execute)** | `EnterWorktree` → `subagent-driven-development`（默认） | 代码变更 | 事后审代码 |
| **E 收尾** | `finishing-a-development-branch` | merge/PR | — |
| **V (Verify)** | `verification-before-completion` + PACE VERIFIED | 测试结果 | 事后审验证 |

### 2.2 完整流程图

```
用户: "帮我实现 X 功能"
    │
    ▼
┌─ P 阶段 ──────────────────────────────┐
│  invoke brainstorming                  │
│    Step 1: 探索项目上下文               │
│    Step 2: 提问澄清（skip-perm 自动）   │
│    Step 3: 提出 2-3 方案 + trade-offs   │
│    Step 4: 展示设计（逐段）              │
│    Step 5: 写设计文档 → docs/plans/     │
│    Step 6: 自动 invoke writing-plans    │
│      → 写实施计划 → docs/plans/         │
└────────────────────────────────────────┘
    │
    ▼
┌─ A 阶段 ──────────────────────────────┐
│  invoke pace-bridge                    │
│    Step 1: 读取 docs/plans/ 最新计划    │
│    Step 2: 生成 CHG-ID + T-NNN 编号    │
│    Step 3: 写入 implementation_plan.md  │
│    Step 4: 写入 task.md + APPROVED      │
│    Step 5: 输出转换摘要                 │
│  (C 阶段被吸收：auto APPROVED)          │
└────────────────────────────────────────┘
    │
    ▼
┌─ E 阶段 ──────────────────────────────┐
│  EnterWorktree（创建隔离分支）           │
│    ↓                                   │
│  自动选择执行方式：                      │
│  ┌─────────────────────────────────┐   │
│  │ 默认: subagent-driven           │   │
│  │  Per task:                      │   │
│  │   Implementer（含 TDD）          │   │
│  │   → Spec Reviewer（规格审查）    │   │
│  │   → Code Quality Reviewer       │   │
│  │  Final: 整体 code review        │   │
│  ├─────────────────────────────────┤   │
│  │ 高风险: executing-plans          │   │
│  │  每 3 task 停下等人工反馈         │   │
│  ├─────────────────────────────────┤   │
│  │ 独立域: dispatching-parallel     │   │
│  │  多 agent 真并行                 │   │
│  └─────────────────────────────────┘   │
│    ↓                                   │
│  finishing-a-development-branch         │
│    → merge/PR/keep/discard              │
└────────────────────────────────────────┘
    │
    ▼
┌─ V 阶段 ──────────────────────────────┐
│  verification-before-completion         │
│    IDENTIFY → RUN → READ → VERIFY      │
│    ↓                                   │
│  PACE 验证收尾：                        │
│    task.md 标 [x] + <!-- VERIFIED -->   │
│    walkthrough.md 追加工作总结           │
│    impl_plan.md 标 [x]                  │
│    归档到 <!-- ARCHIVE -->              │
└────────────────────────────────────────┘
```

---

## 3. 降级条件

并非所有任务都需要完整 Superpowers 流程。

| 条件 | 行为 |
|------|------|
| HOTFIX / 紧急修复 | 跳过 brainstorming + writing-plans，直接手动创建 PACE artifacts |
| 用户已给出完整需求 + 明确说"直接做" | 跳过 brainstorming，可选 writing-plans |
| 单文件 / < 3 个 task | 跳过 worktree + subagent-driven，直接执行 |
| 用户指定执行方式 | 使用用户指定的 skill |

降级时回退到 PACE 原生流程（AI 自主规划 + 手动创建 artifacts + 手动 APPROVED）。

---

## 4. E 阶段执行方式决策树

```
task 之间有依赖？──是──→ executing-plans（人工逐批审）
    │
    否
    │
高风险/核心模块？──是──→ executing-plans（人工逐批审）
    │
    否
    │
task 跨不同 domain？──是──→ dispatching-parallel-agents（真并行）
    │
    否
    │
subagent-driven-development（默认，自动双审 + TDD）
```

**简化规则**：拿不准时，默认 `subagent-driven-development`。

---

## 5. auto-APPROVED 机制

### 5.1 设计理由

pace-bridge 在 A 阶段自动写入 `<!-- APPROVED -->`，因为：
- 用户在 brainstorming 中已参与设计决策（或 skip-perm 下 AI 自主决策）
- writing-plans 已生成详细计划
- 格式转换是机械性操作，不引入新设计决策
- 用户通过事后审阅 task.md 发现问题可随时叫停

### 5.2 Hook 兼容性

PreToolUse hook 检查 `<!-- APPROVED -->` 或 `[/]` 任务——pace-bridge 同时写入两者，hook 无需改动。

### 5.3 转换摘要

pace-bridge 完成后输出结构化摘要，供用户事后审阅：

```
=== pace-bridge 转换摘要 ===
源计划: docs/plans/2026-03-04-feature-x.md
变更 ID: CHG-20260304-05
任务范围: T-256 ~ T-262（共 7 个）
执行方式推荐: subagent-driven-development
```

---

## 6. Worktree 集成

### 6.1 验证结果

worktree 中 PACEflow 完全可用（已验证）：

| 检查项 | 结果 |
|--------|------|
| `resolveProjectCwd()` | Level 3 找到 `.pace/` → 原项目根 |
| `getProjectName()` | 正确返回 `paceflow-hooks` |
| `getArtifactDir()` | 正确返回 vault 路径 |
| 5 个 artifact 可访问 | 全部 OK |
| `readActive()` | 正常工作 |
| `isPaceProject()` | `artifact` 信号触发 |

### 6.2 使用时机

| 阶段 | worktree |
|------|----------|
| P（brainstorming + writing-plans） | 不使用 |
| A（pace-bridge） | 不使用 |
| E（执行） | **使用**（EnterWorktree） |
| V（验证） | 在 worktree 中完成，finishing-branch 后回到主分支 |

### 6.3 流程

```
E 阶段开始
→ EnterWorktree（自动创建分支，CWD 切到 worktree）
→ subagent-driven 在 worktree 中执行
→ finishing-branch 合并回主分支
→ V 阶段在主分支上验证最终状态
```

---

## 7. TDD 集成

Superpowers 的 `test-driven-development` skill 作为 E 阶段的**推荐开发方法**（非强制）：

| 场景 | TDD |
|------|-----|
| 新功能 / 业务逻辑 | 推荐使用 |
| HOTFIX / 紧急修复 | 可跳过 |
| UI / 样式改动 | 可跳过 |
| 已有测试框架的项目 | 推荐使用 |

TDD 流程（E 阶段内）：写失败测试 → 确认失败 → 写最小实现 → 确认通过 → commit。

PACE V 阶段在 TDD 之后，负责**最终全量验证**。

---

## 8. 改动清单

### 8.1 pace-workflow.md（核心改动）

重写 P / A / C / E / V 五个阶段说明：

- **P 阶段**：从"分析代码上下文"改为"默认 invoke brainstorming"，保留降级条件和搜索资源优先级
- **A 阶段**：从"手动创建 artifacts"改为"invoke pace-bridge"，保留 findings 反向关联
- **C 阶段**：从"停止询问用户"改为"Superpowers 流程时被 pace-bridge 吸收；降级流程保留手动确认"
- **E 阶段**：新增 worktree + 执行方式决策树 + TDD 推荐
- **V 阶段**：新增 verification-before-completion 引用 + finishing-branch 衔接

### 8.2 pace-bridge.md（辅助改动）

- 新增 `## auto-APPROVED 说明` 段落
- 新增 `## 转换摘要格式` 段落
- 现有 5 步骤不变

### 8.3 Hook 改动

**零改动**。所有 hook 检查的是 artifact 文件状态（APPROVED/VERIFIED/[/]/[x]），不关心谁写入的。

### 8.4 install.js 改动

无。pace-workflow 和 pace-bridge 都已在 SKILL_MAP 中。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| AI 不遵循 pace-workflow 文字引导 | Hook 兜底：无 APPROVED → deny，无 VERIFIED → block |
| brainstorming 在 skip-perm 下质量下降 | 仍强制走 6 步流程，产出设计文档供事后审阅 |
| pace-bridge 转换出错（遗漏 task） | 转换摘要暴露数量，用户事后可发现 |
| worktree 中 subagent 路径问题 | 已验证 resolveProjectCwd + vault artifacts 正常 |
| finishing-branch merge 冲突 | worktree 基于最新 HEAD 创建，冲突概率低 |

---

## 10. 不做什么

- **不新建 skill**：不创建 `pace-auto.md`，避免 skill 调 skill 嵌套
- **不改 hook 代码**：hook 层保持确定性保障，不添加 Superpowers 感知逻辑
- **不修改 Superpowers skills**：它们是外部插件，只通过 pace-workflow 引导调用
- **不删除降级路径**：HOTFIX 和简单任务仍可走 PACE 原生流程
