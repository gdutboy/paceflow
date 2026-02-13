---
name: change-management 变更管理
version: "1.0.0"
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

1. **检查 `implementation_plan.md`** — 是否存在？使用 [templates/implementation_plan.md](templates/implementation_plan.md) 创建
2. **生成变更 ID** — 格式 `CHG-YYYYMMDD-NN`
3. **更新索引表** — 插入新条目，状态设为 📝 规划中
4. **追加变更详情** — 使用 [templates/change_record.md](templates/change_record.md) 模板
5. **随任务进度更新状态** — 批准后 🔄 进行中，完成后 ✅ 完成

---

## 变更 ID 格式

```
CHG-YYYYMMDD-NN

CHG        = 固定前缀（Change 缩写）
YYYYMMDD   = 创建日期（如 20260117）
NN         = 当天序号（两位数，从 01 开始）

示例：CHG-20260117-01、CHG-20260117-02
```

### 生成规则

1. 获取当前日期（格式 YYYYMMDD）
2. 读取 `implementation_plan.md` 索引表
3. 统计当天已有变更数量（匹配 `CHG-{今日日期}-`）
4. 新 ID = `CHG-{日期}-{已有数量 + 1}`（补零至两位）

---

## 状态流转

详细状态定义与流转图请参阅 **[artifact-management](../artifact-management/SKILL.md#变更状态-change-status)**。

---

## PACE 集成

本 skill 与 PACE 协议深度集成：

| PACE 阶段 | 自动执行动作 |
|-----------|-------------|
| **P (Plan)** | 分析任务，判断是否需要变更 ID |
| **A (Artifact)** | ① 生成变更 ID<br>② 更新索引表（📝 规划中）<br>③ 追加变更详情<br>④ 更新统计概览 |
| **C (Check)** | 用户确认后，状态改为 🔄 进行中 |
| **E (Execute)** | ① 关联 task.md 任务<br>② 完成后状态改为 ✅ 完成<br>③ 添加完成标记<br>④ 写入 walkthrough.md |

---

## 索引表格式

```markdown
| 变更 ID | 日期 | 标题 | 状态 | 关联任务 | 影响范围 |
|---------|------|------|------|----------|----------|
| [CHG-20260117-01](#chg-20260117-01) | 2026-01-17 | 用户认证重构 | 🔄 进行中 | T-001, T-002 | src/auth/ |
```

**字段说明**：
- **变更 ID**：带锚点链接，可跳转到详情
- **日期**：创建日期
- **标题**：变更简述
- **状态**：当前状态图标
- **关联任务**：对应 task.md 中的任务编号
- **影响范围**：主要修改的目录/模块

---

## 统计概览维护

每次状态变更时同步更新：

```markdown
| 指标 | 数值 |
|------|------|
| 总变更数 | N |
| 已完成 | X |
| 进行中 | Y |
| 规划中 | Z |
```

**更新规则**：
- 新建变更：总变更数 +1，规划中 +1
- 开始实施：规划中 -1，进行中 +1
- 完成变更：进行中 -1，已完成 +1
- 废弃变更：对应状态 -1（不计入已完成）

---

## Artifact 联动规则

### 与 task.md 联动

任务按变更 ID 分组：

```markdown
## 当前任务

### CHG-20260117-01: 用户认证重构

- [ ] T-001: 创建 AuthService 基础类
- [ ] T-002: 实现 Token 轮换
- [x] T-003: 添加请求签名

### CHG-20260117-02: API 响应格式

- [ ] T-004: 定义统一响应结构
```

### 与 walkthrough.md 联动

完成记录引用变更 ID：

```markdown
## 2026-01-17 工作记录

> **追加时间**: 2026-01-17T15:30:00+08:00

### 完成内容
- **CHG-20260117-01**: 用户认证重构 ✅
  - 创建了 AuthService 统一认证服务
  - 实现了 Token 轮换机制
```

### 与 findings.md 联动

外部调研关联变更 ID：

```markdown
## [2026-01-17] JWT 安全最佳实践

**关联变更**: CHG-20260117-01

**发现内容**: ...
```

---

## 豁免条件

详细定义请查阅 **User Rule G-8**。

---

## 模板文件

- [templates/implementation_plan.md](templates/implementation_plan.md) — 完整 Implementation Plan 模板
- [templates/change_record.md](templates/change_record.md) — 单条变更记录模板

---

## 使用示例

见 [examples/example_workflow.md](examples/example_workflow.md)

---

## 检查清单

任务完成前必须验证：

- [ ] 变更索引表状态已更新为 ✅ 完成
- [ ] 关联任务已填写
- [ ] 统计概览数值正确
- [ ] 完成标记已添加（含时间戳）
- [ ] walkthrough.md 已记录
