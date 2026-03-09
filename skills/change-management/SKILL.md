---
name: change-management 变更管理
description: 变更 ID 管理模块，由 pace-workflow 的 A 阶段调用。管理 implementation_plan.md 中的变更索引、状态追踪和跨 Artifact 联动。
activation-conditions:
  - "由 pace-workflow 的 A (Artifact) 阶段调用"
  - "用户手动调用 /change-management 命令"
---

# 变更 ID 管理 Skill
> **注意**：本 Skill 不独立激活，作为 `pace-workflow` 的子模块被调用。
当 pace-workflow 调用本模块时，管理 `implementation_plan.md` 中的变更记录。

---

## 快速开始

当检测到复杂任务时，执行以下步骤：

1. **检查 `implementation_plan.md`** — 是否存在？使用 [templates/change-implementation_plan.md](templates/change-implementation_plan.md) 创建
2. **生成变更 ID** — 格式 `CHG-YYYYMMDD-NN`
3. **更新索引表** — 插入新条目，状态设为 `[ ]` 规划中
4. **追加变更详情** — 在 `## 活跃变更详情` 区追加 `### CHG-ID 标题` 段落：
   `**背景**`（为什么做）+ `**范围**`（改动量）+ `**T-NNN 任务标题**：` 具体改动。完整格式参见 implementation_plan.md 模板
5. **随任务进度更新状态** — 批准后 `[/]` 进行中，完成后 `[x]` 完成

---

## 变更 ID 格式

```
CHG-YYYYMMDD-NN       （常规变更）
HOTFIX-YYYYMMDD-NN    （紧急修复）

CHG/HOTFIX = 固定前缀
YYYYMMDD   = 创建日期（如 20260117）
NN         = 当天序号（两位数，从 01 开始）

示例：CHG-20260117-01、HOTFIX-20260304-01
```

### 生成规则

1. 获取当前日期（格式 YYYYMMDD）
2. 读取 `implementation_plan.md` 索引表
3. 统计当天已有变更数量（匹配 `CHG-{今日日期}-`）
4. 新 ID = `CHG-{日期}-{已有数量 + 1}`（补零至两位）

---

## 状态流转

```
[ ] 规划中 --> [/] 进行中 --> [x] 完成
                  |
                  +--> [!] 暂停 --> [/] 进行中
[ ] 规划中 --> [-] 废弃
```

**状态说明**: `[ ]` 规划中 | `[/]` 进行中 | `[x]` 完成 | `[-]` 废弃 | `[!]` 暂停

详细状态定义与转换规则请参阅 **[artifact-management](../artifact-management/SKILL.md)**。

---

## PACE 集成

本 skill 与 PACE 协议深度集成：

| PACE 阶段 | 自动执行动作 |
|-----------|-------------|
| **P (Plan)** | 分析任务，判断是否需要变更 ID |
| **A (Artifact)** | ① 生成变更 ID<br>② 更新索引表（`[ ]` 规划中）<br>③ 追加变更详情<br>④ 回写 findings `[change:: CHG-ID]` + 状态 `[x]` |
| **C (Check)** | 用户确认后，状态改为 `[/]` 进行中 |
| **E (Execute)** | ① 关联 task.md 任务<br>② 完成后状态改为 `[x]` 完成<br>③ 添加完成标记<br>④ 写入 walkthrough.md |
| **V (Verify)** | ① 验证通过后添加 `<!-- VERIFIED -->`<br>② 确认 findings 关联已更新 |

---

## 变更索引格式

```markdown
- [x] CHG-20260117-01 用户认证重构 #change [tasks:: T-001~T-002]
- [/] CHG-20260117-02 API 响应格式 #change [tasks:: T-003~T-004]
```

**状态说明**: `[ ]` 规划中 | `[/]` 进行中 | `[x]` 完成 | `[-]` 废弃 | `[!]` 暂停

**字段说明**：
- **checkbox 状态**：编码变更进度，兼容 Obsidian Tasks 跨项目查询
- **CHG-ID**：变更标识符
- **标题**：变更简述
- **#change**：Obsidian 标签，用于 Tasks/Dataview 过滤
- **[tasks:: T-NNN~T-NNN]**：Dataview inline field，关联 task.md 任务编号

> 统计概览已移除（由 Obsidian Tasks/Dataview 自动统计）

---

## Artifact 联动规则

### 与 task.md 联动

任务按变更 ID 分组：

```markdown
## 活跃任务

### CHG-20260117-01: 用户认证重构

<!-- APPROVED -->

- [ ] T-001 创建 AuthService 基础类
- [ ] T-002 实现 Token 轮换
- [x] T-003 添加请求签名

### CHG-20260117-02: API 响应格式

- [ ] T-004 定义统一响应结构
```

### 与 walkthrough.md 联动

完成记录引用变更 ID：

```markdown
## 2026-01-17 工作记录

> **追加时间**: 2026-01-17T15:30:00+08:00

### 完成内容
- **CHG-20260117-01**: 用户认证重构（已完成）
  - 创建了 AuthService 统一认证服务
  - 实现了 Token 轮换机制
```

### 与 findings.md 联动

外部调研关联变更 ID（索引区 + 详情区双区格式）：

```markdown
<!-- 索引区 -->
- [x] JWT 安全最佳实践 — HMAC-SHA256 签名 + 15 分钟过期 #finding [date:: 2026-01-17] [change:: CHG-20260117-01]

<!-- 详情区 -->
### [2026-01-17] JWT 安全最佳实践
**问题/目标**: JWT Token 安全加固
**发现内容**: ...
```

---

## 豁免条件

详细定义请查阅 **User Rule G-8**。

---

## 模板文件

- [templates/change-implementation_plan.md](templates/change-implementation_plan.md) — 完整 Implementation Plan 模板

---

## 检查清单

任务完成前必须验证：

- [ ] 变更索引表状态已更新为 `[x]` 完成
- [ ] 关联任务已填写
- [ ] 完成标记已添加（含时间戳）
- [ ] walkthrough.md 已记录
- [ ] **findings.md 关联条目状态已更新**（源自 finding 的变更须回写 `[x]`）
