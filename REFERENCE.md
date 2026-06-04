# PACEflow v6.1.0 参考手册

> 最后更新：2026-06-04
> 协议：PACE (Plan-Artifact-Check-Execute-Verify)
> v6 决策：不兼容 v5 活跃流程；v5 内容只作为 ARCHIVE 历史。

---

## 1. 权威入口

| 范围 | 权威文件 |
|------|----------|
| Marketplace 入口 | `.claude-plugin/marketplace.json`，`source` 指向 `./plugin` |
| 用户安装 | `plugin/.claude-plugin/plugin.json` + `plugin/hooks/hooks.json`，通过 Claude Code `/plugin install` |
| Artifact 写入 | `plugin/agents/artifact-writer.md` |
| Artifact schema | `plugin/agent-references/artifact-writer-spec.md` |
| Agent 操作步骤 | `plugin/agent-references/instructions/*.md` |
| Hook 运行逻辑 | `plugin/hooks/*.js` + `plugin/hooks/pre-tool-use/*.js` + `plugin/hooks/pace-utils.js` |
| 仓库维护入口 | `CLAUDE.md`（不承载 PACEflow 用户工作流规范） |
| 用户 Skill 规则 | `plugin/skills/*/SKILL.md` |
| 内部审计资料 | `internal/skills/audit/` |
| v6 迁移 guidebook | `docs/paceflow-v6-guidebook.md` |

`install.js` / `verify.js` 只允许作为本地 smoke/健康检查工具，不是 v6 正式安装路径；对应本地测试文件 `tests/test-install.js` 也不属于 tracked release gate。

---

## 1.1 Project Root / Artifact Root / CWD

PACEflow 的运行边界使用以下术语：

| 名称 | 含义 |
|------|------|
| Current CWD | Claude Code 当前打开目录，可能是 Project Root，也可能是其子目录 |
| Project Root | PACEflow 管理的项目边界；`.pace` 运行态、CHG owner、Stop 检查和 `local` artifact root 归属这里 |
| Artifact Root | `spec.md / task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**` 的存放目录 |

普通子目录默认继承最近的父级 PACEflow Project Root。真实 git worktree 仍共享宿主 Project Root。只有当前子目录确实是独立项目时，运行：

```bash
node "<plugin>/hooks/set-project-root.js" --mode independent
```

再运行 `set-artifact-root.js --choice local|vault` 选择该子项目自己的 Artifact Root。

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
| `pre-tool-use.js` | 写代码、运行 Bash/PowerShell/Monitor 命令或派 artifact-writer 前，检查活跃 CHG、详情文件、APPROVED、可执行状态，并阻止直接写 artifact / `.pace` 控制面 |
| `post-tool-use.js` | schema/wikilink/直接 C-V 写入/correction knowledge 提醒 |
| `post-tool-use-failure.js` | 写入/验证工具失败后提醒不要误判完成 |
| `subagent-stop.js` | 观察 `artifact-writer` 报告标题/状态并记录 transcript |
| `stop.js` | 阻止未完成、未 verified、verified 未归档、索引不一致 |
| `task-list-sync.js` | legacy 兼容 observer；当前插件不注册任务面板 hook，PACE 权威仍是 `changes/<id>.md` |
| `pre-compact.js` | 快照活跃 CHG、pending、approved、verified 状态 |
| `stop-failure.js` | API 错误中断日志 |

Helper 脚本不是 hook 事件，但属于发布运行时入口：

| Helper | 用途 |
|--------|------|
| `reserve-artifact-id.js` | 原子预留 CHG/HOTFIX/CORRECTION 编号 |
| `set-artifact-root.js` | 写入 Project Root runtime 的 artifact-root 选择 |
| `set-project-root.js` | 将当前 cwd 声明为独立 Project Root |
| `sync-plan.js` | pace-bridge 成功后记录已桥接 plan |

Helper 成功返回 exit code 0；业务校验失败返回 exit code 2 并在 stdout 给出可读修复信息。Hook 脚本自身通常以容错为主，除 PreToolUse/Stop 的明确阻断外，不把内部错误升级为 shell 崩溃。

## 5.1 PreToolUse 拒绝档位与 teammate 降级

PreToolUse 的拒绝分三档。**teammate 模式（`CLAUDE_CODE_TEAM_NAME` 非空）只软化第一档**，另两档不降级。

| 档位 | 实现 | 正常模式 | teammate 模式 | 典型守卫 |
|------|------|----------|---------------|---------|
| 流程引导类 | `denyOrHint(reason)`（无 `hardInTeammate`）| deny | **降级为 additionalContext（放行+提示）** | artifact-root 选择、v5 迁移、native plan 桥接、强信号/code-count 引导 |
| 批准/完整性类 | `denyOrHint(reason, { hardInTeammate: true })` | deny | **仍 deny（不降级）+ 回报主 session 引导** | C 阶段批准门、E 阶段就绪门、无活跃 CHG、索引完整性三门（malformed / mismatch / detail-missing）|
| 完整性/安全类 | `hardDeny()` 或 inline-deny | deny | **仍 deny（不降级）** | marker 伪造（APPROVED/VERIFIED）、runtime-control 删锁、改 `.pace` 控制面、直接 Write/Edit artifact、bad stdin/tool、ID 预留、status 校验、change-owner 隔离 |

**设计定位：teammate = 纯执行者。** 主 session 负责任务编排与更新（批准、建/归档 CHG、改任务状态），teammate 只在主 session 已批准的 CHG 范围内执行（写代码、跑测试、调研）。根本理由：artifact 状态必须有单一权威源，否则多个独立 teammate session 并发改 artifact 会让任务状态失去一致视图，无法维护上下文。

在此定位下，「无阻断」与「遵循规则」自动统一：teammate 跟随已批准 CHG 执行时所有写代码门天然通过（无阻断）；一旦在未批准 / 无活跃 CHG / 索引损坏时写代码，或试图碰任务管理、runtime，则硬阻断（遵循规则）。流程引导类（artifact-root 选择、迁移、桥接）保持软化，因为它们需主 session 与用户交互完成，硬拦会死锁 teammate。

**日志 action 的 `_TEAMMATE` 后缀 ≠ 被降级。** marker 伪造、runtime-control 等带 `_TEAMMATE` 后缀但走 `hardDeny`，teammate 下仍硬阻断——后缀只标记"在 teammate 进程触发"，不代表软化。

**teammate ≠ subagent。** subagent（Task / Agent 工具）在主进程内执行、结果回流主 session、共享主 session 上下文、不独立触发 PACE owner；teammate 是独立平级 session，有自己的 session_id。调研 fan-out 这类「给结果就好、回流主 session」的场景应用 subagent，不用 teammate。

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

源码仓库中这些运行时资产位于 `plugin/`；安装到 Claude Code cache 后，`plugin/` 目录本身不会作为额外前缀出现。

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
for f in plugin/hooks/*.js; do node -c "$f" || exit 1; done
```

---

## 8. 发布检查

- `PACE_VERSION` 与 `plugin/.claude-plugin/plugin.json` 均为当前发布版本
- artifact frontmatter `schema-version` 仍为 `"6.0"`；不要随插件 patch 版本滚动
- `.claude-plugin/marketplace.json` 的 `source` 指向 `./plugin`
- `plugin/hooks/templates/` 有 `corrections.md`
- `plugin/hooks/hooks.json` 注册 `StopFailure`
- `plugin/agents/artifact-writer.md` 与 `plugin/agent-references/**` 存在
- README/CLAUDE/skills 不再要求主 session 直接 Edit artifact
- README/CLAUDE/skills/hooks 模板不再出现 v5 活跃详情区、task 承载 C/V 标记、task 任务权威、findings 内 correction 区等旧口径
