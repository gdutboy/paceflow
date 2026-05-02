# update-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `section`（必填，枚举：`tasks` | `implementation` | `work-record` | `research`）
- `action`（必填，枚举：`append` | `replace` | `update-status`）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）

## 操作步骤

### 通用前置

1. 检测项目版本（v5 / v6）
2. 解析 target → 路径：
   - v6: `changes/chg-yyyymmdd-nn.md` 或 `changes/hotfix-yyyymmdd-nn.md`
   - v5: 主 artifact 详情段落（task.md / implementation_plan.md / walkthrough.md）
3. 文件不存在 → 报告 `target-not-found`

### action=append

- v6: Read + Edit changes/chg-xxx.md 对应 section 末尾追加 content
- v5: Read + Edit 主 artifact 详情段落对应位置追加

### action=replace

- v6: Read + Edit 整个 section 替换为 content
- v5: 同上

### action=update-status

- 仅适用于 `section=tasks`
- v6 子流程：
  1. Read changes/chg-xxx.md 找到 `- [<old>] T-NNN`
  2. Edit 改 `<old>` 为 `<new-status>`（参考 spec §4 状态映射）
- v5 子流程：直接在主 artifact 详情段落对应行 Edit

## section 含义

| section | 对应文件位置（v6） | 对应文件位置（v5） |
|---------|------------------|-----------------|
| tasks | changes/chg-xxx.md `## 任务清单` | task.md / implementation_plan.md 详情段 |
| implementation | changes/chg-xxx.md `## 实施详情` | implementation_plan.md 详情段 |
| work-record | changes/chg-xxx.md `## 工作记录` | walkthrough.md 详细记录 |
| research | changes/chg-xxx.md `## 关联调研` | findings.md 详情段 |

## 边界

- target 不存在 → `target-not-found`
- section 不在枚举内 → `format-violation`
- action=update-status 但 section ≠ tasks → `format-violation`
- task-id 在 tasks 段中找不到 → `target-not-found`
