# PACEflow v6.0.30 参考手册

> 最后更新：2026-05-08
> 协议：PACE (Plan-Artifact-Check-Execute-Verify)
> v6 决策：不兼容 v5 活跃流程；v5 内容只作为 ARCHIVE 历史。

---

## 1. 权威入口

| 范围 | 权威文件 |
|------|----------|
| 用户安装 | `.claude-plugin/plugin.json` + `hooks/hooks.json`，通过 Claude Code `/plugin install` |
| Artifact 写入 | `agents/artifact-writer.md` |
| Artifact schema | `agent-references/artifact-writer-spec.md` |
| Agent 操作步骤 | `agent-references/instructions/*.md` |
| Hook 运行逻辑 | `hooks/*.js` + `hooks/pace-utils.js` |
| 主 session 规则 | `CLAUDE.md` |
| 用户 Skill 规则 | `skills/*/SKILL.md` |
| 内部审计资料 | `internal/skills/audit/` |
| v6 迁移 guidebook | `docs/paceflow-v6-guidebook.md` |

`install.js` / `verify.js` 只允许作为本地 smoke/健康检查工具，不是 v6 正式安装路径。

---

## 2. 文件结构

```text
projects/<project>/
├── spec.md
├── task.md
├── implementation_plan.md
├── walkthrough.md
├── findings.md
├── corrections.md
└── changes/
    ├── chg-yyyymmdd-nn.md
    ├── hotfix-yyyymmdd-nn.md
    ├── findings/finding-yyyy-mm-dd-slug.md
    └── corrections/correction-yyyy-mm-dd-nn-slug.md
```

索引文件只保留摘要/wikilink 行。所有 CHG/HOTFIX/finding/correction 详情都写在 `changes/**`。

---

## 3. Agent 操作

| 操作 | 用途 |
|------|------|
| `create-chg` | 创建 `changes/<id>.md`，同步 `task.md` / `implementation_plan.md` 索引 |
| `update-chg action=approve` | C 阶段批准，写 `<!-- APPROVED -->` |
| `update-chg action=approve-and-start` | 用户已批准后插入 `APPROVED`、标记首个 T-NNN `[/]`、推 `in-progress` |
| `update-chg action=update-status` | 更新 T-NNN 状态，联动 frontmatter 与根索引 |
| `update-chg action=append/replace` | 更新实施详情、工作记录、关联调研 |
| `update-chg action=verify` | V 阶段验证，写 `verified-date` + `<!-- VERIFIED -->` |
| `archive-chg` | 归档已 verified CHG/HOTFIX |
| `close-chg` | 验证确认后合并完成、验证、归档与 walkthrough |
| `record-finding` | 写 `changes/findings/<id>.md` + `findings.md` 摘要索引 |
| `record-correction` | 写 `changes/corrections/<id>.md` + `corrections.md` 摘要索引 |

主 session 禁止直接写 `APPROVED`、`VERIFIED`、`verified-date`，也禁止在 task/impl 中写内嵌详情。

---

## 4. 状态机

| frontmatter status | verified-date | VERIFIED | 索引位置 |
|--------------------|---------------|----------|----------|
| `planned` | null | 缺 | 活跃区 `[ ]` |
| `in-progress` | null | 缺 | 活跃区 `[/]` |
| `completed` | null | 缺 | 活跃区 `[x]`，Stop 阻止退出 |
| `completed` | 非 null | 有 | 活跃区 `[x]`，待 `close-chg` / `archive-chg` |
| `archived` | 非 null | 有 | ARCHIVE 下方 `[x]` |
| `cancelled` | null | 缺 | ARCHIVE 下方 `[-]` |

`verified-date` 是机器权威；`<!-- VERIFIED -->` 是人读/hook 信号。两者必须一致。

---

## 5. Hook 覆盖

| Hook | v6 职责 |
|------|---------|
| `session-start.js` | 创建/注入索引模板，输出活跃 CHG 摘要 |
| `pre-tool-use.js` | 写代码前检查活跃 CHG、详情文件、APPROVED、可执行状态 |
| `post-tool-use.js` | schema/wikilink/直接 C-V 写入/correction knowledge 提醒 |
| `post-tool-use-failure.js` | 写入/验证工具失败后提醒不要误判完成 |
| `subagent-stop.js` | 观察 `artifact-writer` 报告标题/状态并记录 transcript |
| `stop.js` | 阻止未完成、未 verified、verified 未归档、索引不一致 |
| `task-list-sync.js` | 用 `changes/<id>.md` 任务清单校验 Claude 任务列表（TaskCreate/TaskUpdate/TodoWrite） |
| `pre-compact.js` | 快照活跃 CHG、pending、approved、verified 状态 |
| `stop-failure.js` | API 错误中断日志 |

---

## 6. 安装

在 Claude Code 中：

```text
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

安装后应包含：
- `hooks/`
- `skills/`
- `agents/`
- `.claude-plugin/plugin.json`
- `hooks/hooks.json`

---

## 7. 验证入口

Hook 单元/E2E：

```bash
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
```

Agent contract smoke：

```bash
node tests/agent-tests/run-tests.js dummy
```

语法：

```bash
for f in hooks/*.js; do node -c "$f" || exit 1; done
```

---

## 8. 发布检查

- `PACE_VERSION` 与 `.claude-plugin/plugin.json` 均为当前发布版本
- artifact frontmatter `schema-version` 仍为 `"6.0"`；不要随插件 patch 版本滚动
- `hooks/templates/` 有 `corrections.md`
- `hooks/hooks.json` 注册 `StopFailure`
- `agents/artifact-writer.md` 与 `agent-references/**` 存在
- README/CLAUDE/skills 不再要求主 session 直接 Edit artifact
- README/CLAUDE/skills/hooks 模板不再出现 v5 活跃详情区、task 承载 C/V 标记、task 任务权威、findings 内 correction 区等旧口径
