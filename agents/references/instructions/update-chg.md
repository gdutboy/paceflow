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

1. 解析 target → 路径：`changes/chg-yyyymmdd-nn.md` 或 `changes/hotfix-yyyymmdd-nn.md`
2. 文件不存在 → 报告 `target-not-found`

### action=append

Read + Edit changes/chg-xxx.md 对应 section 末尾追加 content

### action=replace

Read + Edit 整个 section 替换为 content

### action=update-status

- 仅适用于 `section=tasks`
- 子流程：
  1. Read changes/chg-xxx.md 找到 `- [<old>] T-NNN`
  2. Edit 改 `<old>` 为 `<new-status>`（参考 spec §4 状态映射）
  3. **frontmatter 联动**（每次 update-status 后必执行）：
     - Read `## 任务清单` 段，统计任务状态
     - 全部为 `[x]` 或 `[-]` → Edit frontmatter `status` → `completed`，并添加 `completed-date: <ISO 8601 datetime>`
     - 仍有 `[/]` 但 frontmatter `status: planned` → Edit frontmatter `status` → `in-progress`
     - 否则 frontmatter 不变

## section 含义

| section | 对应文件位置 |
|---------|------------|
| tasks | changes/chg-xxx.md `## 任务清单` |
| implementation | changes/chg-xxx.md `## 实施详情` |
| work-record | changes/chg-xxx.md `## 工作记录` |
| research | changes/chg-xxx.md `## 关联调研` |

## 边界

- target 不存在 → `target-not-found`
- section 不在枚举内 → `format-violation`
- action=update-status 但 section ≠ tasks → `format-violation`
- task-id 在 tasks 段中找不到 → `target-not-found`
