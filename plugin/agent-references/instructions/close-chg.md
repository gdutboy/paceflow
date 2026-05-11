# close-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `verification-confirmed`（必填，必须为布尔 `true`）
- `complete-open-tasks`（必填，必须为布尔 `true`；主 session 已确认验证通过时允许把 `[ ]` / `[/]` 的 T-NNN 收口为 `[x]`）
- `verify-summary`（必填，一行验证结果摘要，写入 `## 工作记录`）
- `walkthrough-summary`（必填，一行完成摘要，写入 `walkthrough.md`）

## 语义

`close-chg` 是收尾合并操作，只能在主 session 已经运行并阅读验证结果后调用。它可以一次完成：

1. 必要时把未完成任务收口为 `[x]`
2. 推 frontmatter `status` 到 `completed`
3. 写入 `verified-date` + `<!-- VERIFIED -->`
4. 追加验证工作记录
5. 归档到 ARCHIVE 下方并写 `walkthrough.md`

**禁止**由 agent 自行判断验证是否通过。`verification-confirmed` 缺失或非 true 时，不得写任何 artifact。

主路径：一个连续 CHG 的代码写完后，主 session 先运行验证并读取结果；验证通过后直接派 `close-chg verification-confirmed: true complete-open-tasks: true`。即使详情中仍有 `[ ]` / `[/]` 的 T-NNN，只要这些任务已经在本轮执行并由验证覆盖，也由 close-chg 统一收口。不要先派逐个 `update-status [x]` 再派 `update-chg action=verify` 再归档，除非用户明确要求暂不归档或需要跨 session 留存进度。

> **报告标题强制**：最终报告第一行必须字面使用 `## artifact-writer 报告`。禁止在标题前输出任何自然语言、空行或说明，尤其禁止 `所有编辑均已通过。生成报告。` / `操作完成，报告如下：` / `验证通过。` 等前缀。失败、幂等、部分修复场景同样适用。
> **全局对话样式豁免**：最终报告不得继承主 session / CLAUDE.md 的时间戳、Insight 块、固定结尾语或任何前后缀。第一个字符必须是 `#`。

## 前置检查

0. 用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 检查 `$ARTIFACT_DIR/changes` 目录必须已存在；`MISSING` → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact。
1. 解析 target → 详情文件路径；文件不存在 → `target-not-found`
2. 校验必填字段：
   - 缺 `verification-confirmed` / `complete-open-tasks` / `verify-summary` / `walkthrough-summary` → `missing-fields`
   - `verification-confirmed` 非布尔 `true` → `format-violation`
   - `complete-open-tasks` 非布尔 `true` → `format-violation`
3. Read 详情文件，校验：
   - `<!-- APPROVED -->` 必须存在
   - frontmatter `status` 不得是 `cancelled`
   - `verified-date` 与 `<!-- VERIFIED -->` 必须同时存在或同时不存在；仅一者存在 → `format-violation: verification state inconsistent`
   - 任务清单不得包含 `[!]`
4. 任务收口规则：
   - 若存在 `[ ]` / `[/]` 且 `complete-open-tasks` 不是 true → `format-violation: tasks not done`
   - 若 `complete-open-tasks: true`，把所有 `[ ]` / `[/]` T-NNN 改为 `[x]`

## 操作步骤

> **CRLF / Edit 匹配失败处理**：若 `Edit` 因换行符差异匹配失败，禁止使用 `Write` 覆盖文件，禁止用 `Bash sed -i` / `perl -pi` / 重定向 / 脚本写文件修改 artifact。直接重试同一个 `Edit`；PreToolUse hook 会在 `Edit` / `MultiEdit` 前将 artifact 的 CRLF 机械归一化为 LF。

### 1. 完成状态联动

- 若 status 为 `planned` / `in-progress` / `completed`：
  - 确保所有 T-NNN 为 `[x]` 或 `[-]`
  - Edit frontmatter：`status: completed`
  - 若 `completed-date: null`，填 `<date '+%Y-%m-%dT%H:%M:%S+08:00'>`
  - Read + Edit `task.md` 和 `implementation_plan.md`，对应活跃索引 checkbox 改为 `[x]`
- 若 status 已是 `archived`：
  - 不改 status / completed-date / archived-date
  - 继续执行索引归档一致性修复（若根索引仍在活跃区）

### 2. 写入 V 阶段标记

- 若尚未 verified：
  - Edit frontmatter：`verified-date: <ISO 8601 datetime>`，置于 `completed-date` 与 `archived-date` 之间
  - Edit 详情正文：在 `<!-- APPROVED -->` 行之后紧邻插入 `<!-- VERIFIED -->`
  - Edit `## 工作记录` 表格末尾追加：`| <YYYY-MM-DD> | 验证通过：<verify-summary> |`
- 若已 verified：
  - 不重复写 `verified-date` / `<!-- VERIFIED -->`
  - 不重复追加验证工作记录

### 3. 归档索引

归档规则与 `archive-chg.md` 相同：**移动索引行内容到 ARCHIVE 下方，ARCHIVE 标记位置不变**。

- Read `task.md`
  - 若活跃区存在目标索引行：删除活跃区该行，并插入到 `<!-- ARCHIVE -->` 下方，checkbox 必须为 `[x]`
  - 若活跃区没有、ARCHIVE 下方已有目标索引行：视为幂等
  - 两处都没有 → `format-violation: index row not found`
- Read `implementation_plan.md` 同上
- Read `walkthrough.md`
  - `<slug>` 必须是目标详情文件名去掉 `.md` 后的 CHG/HOTFIX slug，例如 `CHG-20260511-02` 对应 `[[chg-20260511-02]]`。禁止用标题 slug。
  - 若今日或历史已有包含 `[[<slug>]]` 且关联变更列为 `<CHG-ID>` 的 walkthrough 行：不重复追加
  - 否则在 `## 最近工作` 表格活跃区追加：`| <YYYY-MM-DD> | [[<slug>]] <walkthrough-summary> | <CHG-ID> |`

### 4. 归档详情状态

- 若 status 不是 `archived`：
  - Edit frontmatter：`status: archived`
  - 若 `archived-date: null`，填 `<ISO 8601 datetime>`
- 若 status 已是 `archived`：
  - 保持不变，报告中写 `reason: "already archived, index checked/repaired"`

## 边界

- 缺必填字段 → `missing-fields`
- `verification-confirmed` 非 true → `format-violation`
- `complete-open-tasks` 非 true → `format-violation`
- `<!-- APPROVED -->` 缺失 → `format-violation`
- 任务存在 `[!]` → `format-violation: blocked tasks`
- 任务存在 `[ ]` / `[/]` 且 `complete-open-tasks` 不是 true → `format-violation: tasks not done`
- `verified-date` 与 `<!-- VERIFIED -->` 不一致 → `format-violation: verification state inconsistent`
- status 为 `cancelled` → `format-violation: cancelled change`
- ARCHIVE 标记缺失 → `format-violation: archive marker missing`
- 根索引行在活跃区和 ARCHIVE 下方都找不到 → `format-violation: index row not found`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

## 最终报告硬约束（最后执行）

完成所有 Write/Edit 后，不要先描述“编辑成功”“准备生成报告”“验证通过”。最终回答必须从下面这一行开始：

```markdown
## artifact-writer 报告
```

禁止在报告前写任何过渡句或说明文字。只输出报告本身，第一个字符必须是 `#`。
