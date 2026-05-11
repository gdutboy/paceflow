# PaceFlow 文案越界审计（2026-05-11）

## 背景

> 用户要求：完整阅读 paceflow plugin 的所有文案（skills、hooks 提示、agent.md、agent-references），寻找"文案越界"问题——即 PaceFlow 提示中包含了不属于 PaceFlow 的内容：
>
> - 把 PaceFlow 扩展成普通路径裁判（如"不要 fallback 到 cwd，也不要写到 docs/ 等子目录；cwd 可能只是代码工作目录"）
> - 把内部实现细节、Claude Code 缺陷假设直接暴露给主 session
> - 过长的调试解释直接输出到主 session，导致文案噪声和误导

审计范围（已逐行阅读）：

- `plugin/hooks/*.js`（pre-tool-use / post-tool-use / post-tool-use-failure / session-start / subagent-stop / stop / stop-failure / task-list-sync / pre-compact / reserve-artifact-id / pace-utils）
- `plugin/skills/{pace-workflow,pace-bridge,artifact-management,pace-knowledge}/SKILL.md` 及 references
- `plugin/agents/artifact-writer.md`
- `plugin/agent-references/artifact-writer-spec.md`
- `plugin/agent-references/instructions/{create-chg,update-chg,close-chg,archive-chg,record-finding,record-correction}.md`

总计发现 ~36 处明显越界文案，集中在 `pre-tool-use.js`、`session-start.js`、`pace-utils.js`。

---

## 结构性根因（两个共病模式）

1. **"附录追加器"**
   `pace-utils.js:1045` `artifactDirRuntimeHint` / `1053` `appendArtifactDirHint` 把"Artifact 根目录 + `.pace/` 不存 artifact"这句路径科普追加到几乎每条 hook 输出尾部。这是下面"通用路径裁判"几乎所有条目的源头——修一个函数能消掉一大半。

2. **"教学式 deny"**
   deny 文案被设计成"主 session 速成手册"，把 schema 字段表、`reserve-artifact-id.js` 调用、桥接步骤、worktree 规则、`approval-confirmed/source/evidence` 字段表都塞进同一条 stderr。应只回答"为什么被拒"+ "去哪个 skill 找完整步骤"，而不是"接下来 12 步怎么做"。

---

## 一、通用路径裁判（PaceFlow 越权当 path/filesystem 监管）

| # | 位置 | 越界文案（节选） | 问题 |
|---|------|-----------------|------|
| 1 | `plugin/hooks/pre-tool-use.js:290` (`agentArtifactDirDenyReason`) | `不要让 artifact-writer fallback 到 cwd，也不要写到 docs/ 等子目录；cwd 可能只是代码工作目录` | 用户给的范例。本只判 artifact_dir 不一致，却扩散到"什么是代码工作目录" |
| 2 | `pre-tool-use.js:291`（同函数） | `如果用户选择"本地项目目录"，artifact_dir 是项目根目录本身，不是 .pace/。.pace/ 只保存配置与运行态信号。` | deny 里复述 `.pace/` 用途科普 |
| 3 | `pace-utils.js:1050` (`artifactDirRuntimeHint`) | `Artifact 根目录：...（选择=auto；配置文件=...；.pace/ 只保存配置/运行状态，不存 task.md / changes/**）` | 被 PostToolUse / SubagentStop / Stop / PreToolUse 反复 append，几乎每条 PACE 提示尾巴都挂一遍——典型噪声源 |
| 4 | `pace-utils.js:1038` (`artifactRootChoiceMessage`) | `${stateDir}/.pace 只是 PaceFlow 配置/运行态目录，不是 artifact 根目录；不要把 task.md / implementation_plan.md / changes/** 写进 .pace/` | 首次选择消息里再说一次 |
| 5 | `reserve-artifact-id.js:91`、`pre-tool-use.js:369、840` | 同样的"`.pace/` 只保存配置/运行状态，不存 artifact" | 第 3、4、5 次复述 |
| 6 | `agents/artifact-writer.md:151`、`agent-references/artifact-writer-spec.md:38` | 大段反复解释 `.pace/` vs `.pace-enabled` vs artifact dir | agent 内部已吃过一遍，主 session 文档再重复 |
| 7 | `skills/pace-workflow/SKILL.md:37`、`skills/artifact-management/SKILL.md:14` | 同样的"`.pace/` 不能作为 artifact_dir"科普 | skill 层再重复一次 |
| 8 | `pre-tool-use.js:909`、`244-251` (`bashArtifactRuntimeControlDenyReason`) | `不要手写/删除 .pace/locks、.pace/sequences、.pace/reservations、.pace/index-transactions 或 legacy artifact-writer.lock` | deny 文案中把内部锁子目录清单当黑名单挂出来 |

---

## 二、内部实现细节暴露给主 session

| # | 位置 | 文案 | 暴露了什么 |
|---|------|------|-----------|
| 1 | `post-tool-use.js:94-97` | `Stop hook 已降级（连续阻止 3 次后不再阻止退出，但问题未修复）。未通过的检查项：...` | 内部状态机 `MAX_BLOCKS=3` + degraded flag |
| 2 | `session-start.js:138-139` | `⚠️ Stop hook 之前已降级（本次已重置计数）` | 同上 |
| 3 | `session-start.js:468-484` | `implementation_plan.md 使用了 emoji 状态标记，hook 无法识别` / `readActive 会截断到第一个标记处。请删除多余的标记...` | 暴露内部函数名 `readActive`、解析器局限 |
| 4 | `pre-tool-use.js:840` (`PASS_AGENT_ARTIFACT_BASE`) | `artifact 写入采用 hook resource lock：读/思考可并发，真实 Write/Edit/MultiEdit 时按目标文件短暂加锁` | 锁机制讲给 AI，AI 不需要知道 |
| 5 | `pre-tool-use.js:487-502`（`legacyArtifactWriterLockDenyReason` / `artifactResourceLockDenyReason`） | `当前锁：session=... agent=... artifact_dir=... age=Ns lock=<path>` + `hook 已等待 0ms` | 锁 owner、`waitedMs` 等调试数值入 prompt |
| 6 | `subagent-stop.js:91、95、99` | 三种"报告格式提醒"提到 `EXPECTED_TITLE = '## artifact-writer 报告'`、"机械可检测的硬约束" | 把"hook 用 grep 字面匹配"实现告诉 AI |
| 7 | `agents/artifact-writer.md:21-39`、`agent-references/instructions/close-chg.md:108-123` | `所有编辑均已通过。生成报告。` 等过渡句黑名单 | grep 失败案例硬编码进 prompt |
| 8 | `session-start.js:535-541` | `请为它们创建或更新对应任务列表项（交互式 TaskCreate/TaskUpdate；非交互/SDK TodoWrite）` | 把 CC 工具枚举（TaskCreate vs TodoWrite vs SDK）塞进 PaceFlow 提示 |
| 9 | `session-start.js:174-182` | `=== G-9 完成检查（每个 CHG/HOTFIX 最后任务代码写完后立即执行）===` | "G-9" 是用户个人 CLAUDE.md 章节号，被硬编码进 plugin |
| 10 | `pre-tool-use.js:170-213`（runtime control 检测）相关 deny | 把 `.pace/locks` / `.pace/sequences` / `.pace/reservations` / `.pace/index-transactions` 全清单贴给 AI | runtime 目录结构本应黑盒 |

---

## 三、Claude Code 缺陷假设（把 CC 不稳定行为写成文案）

| # | 位置 | 文案 | 风险 |
|---|------|------|------|
| 1 | `session-start.js:58` | `=== SessionStart 输出截断 ===\n注入内容超过 N bytes，已停止继续注入以避免 Claude Code 将 hook 输出落盘` | "CC 会把 hook 输出落盘" 是版本相关 bug 假设，写进运行时提示 |
| 2 | `pre-tool-use.js:359` (`reservationRequiredReason`) | `PACE hook 已为 ${operation} 预留唯一编号，但 Claude Code 不会可靠地把 PreToolUse additionalContext 注入到 subagent 初始 prompt。` | 直白告诉模型"CC 不可靠" |
| 3 | `skills/pace-knowledge/SKILL.md:139` | `如果当前 Claude Code native build 返回 No such tool available: Grep，改用只读 Bash fallback` | 假设特定 build 缺 Grep |
| 4 | `skills/pace-bridge/SKILL.md:30` | `Claude Code 原生 plan 的文件名/会话名可能随版本变化` | 假设 CC 内部命名不稳定 |
| 5 | `hooks/stop-failure.js:2` 注释 | `CC v2.1.78 新增事件，文档缺失(#35620)，仅做日志记录不依赖关键路径` | 不暴露给 AI 但思路同源，把 CC issue 编号硬编码 |
| 6 | `agents/artifact-writer.md:87` | `Claude Code 工具层强制要求 Edit 前同会话 Read。` | Edit tool 自身规则被冒充为"PaceFlow 关键操作规则" |
| 7 | `agents/artifact-writer.md:29` | `若全局 / 用户 / 项目 CLAUDE.md 要求普通回复带时间戳、解释性 Insight 块、结尾签名或其他对话装饰，本 agent 的最终报告一律豁免这些样式规则` | 把用户外层 CLAUDE.md 的 G-5 时间戳/Insight 块行为硬编码进 PaceFlow 来 override |

---

## 四、过长解释 / 调试痕迹直接输出 main session

| # | 位置 | 简述 |
|---|------|------|
| 1 | `post-tool-use-failure.js:93-97` | 本次会话亲眼看到的那条：`ls` 路径错也会注入 `不要把失败工具调用视为完成；若失败发生在 artifact 写入...；若失败发生在 Bash 验证...`。覆盖 Write/Edit/MultiEdit/Bash/Agent 全部工具，对纯 read-only Bash 失败完全是噪声，且把两种完全无关的修复路径揉成一句 |
| 2 | `pre-tool-use.js:1345-1346` (legacy v5 DENY) | 单条 ~250 字，含 `migrate/batch-archive-v5.js` 脚本路径、桥接命令、"不要在 task.md / implementation_plan.md 手写 v5 详情、APPROVED 或 VERIFIED"、"迁移或桥接后必须重试被阻止的原始工具调用"。把整套迁移教学塞进一条 deny |
| 3 | `pre-tool-use.js:1371` (native plan 桥接 DENY) | 单条 deny 包含自动建模板提示 + plan 路径 + 桥接命令 + auto-APPROVED 字段表 + `synced-plans` 路径 + worktree 注意 + 删除 `.pace/current-native-plan`。一次输出八个不同主题 |
| 4 | `pre-tool-use.js:1428-1436、1459` (各种 DENY 拼接) | `${createdMsg}` + `artifactWriterCreateChgHint` + `taskGroup` + `implIndex` + `statusHelp` + `changeStatusHelp` + `closeOp` + `skillRef` 全堆一起，单条 ~600 字 |
| 5 | `stop.js:99-118`（warnings） | 每条 warning 含完整修复指令（`approve-and-start 需 approval-confirmed: true + approval-source + approval-evidence + task-id`），多个 warning 一起 stderr 输出，单次阻止可输出十几条 |
| 6 | `pre-tool-use.js:1226 / 1302 / 1315`（C/E 阶段 deny） | 反复展开 `approve` vs `approve-and-start` 区别、`approval-confirmed/source/evidence/task-id` 必填——这些是 agent-writer 内部 schema，本不该每次都教 main session |
| 7 | `task-list-sync.js:75-79` | TodoWrite 同步的 hint 里教 `archive-chg vs close-chg` 使用边界、`approval-source` 枚举值——同步任务列表 ≠ 流程教学 |
| 8 | `session-start.js:202-204` + `146-156` | 在 startup 与 compact 两个路径都注入 native plan 桥接提醒，提醒里附带 `.pace/current-native-plan` 删除命令 |
| 9 | `agents/artifact-writer.md:31-39、66-82`（"你不要做的事"） | 列了 14 条"禁止"，包括针对 14 种 H2 标题变体；本质是把 hook grep 匹配规则扩成宣言式 prompt 守则 |
| 10 | `agent-references/instructions/update-chg.md:153` / `close-chg.md:118-123` | 罗列"被视为格式失败的前缀样例"——把内部 grep 失败案例当业务规则展示 |
| 11 | `session-start.js:127、146、188` | 多处使用 `⚠️` emoji 注入主上下文，与用户 CLAUDE.md G-5"避免 emoji"要求冲突——PaceFlow 自带的样式越界 |
| 12 | `post-tool-use.js:159` / `pre-tool-use.js:1345` | "迁移或桥接只处理 artifact 状态，不能算作完成原始代码任务；之后必须重试被阻止的原始工具调用" 重复出现 ≥ 3 处——心智模型校正语反复轰炸 |

---

## 收敛方向建议（非实现）

1. **`appendArtifactDirHint` 收敛**：只在 artifact_dir 真正出错或被新选定时才追加；常规 PASS/WARN 不附加路径科普。
2. **删除"CC 不可靠/落盘/native build 缺 Grep"等 CC 行为推断**，把这些写在内部 `findings.md` 而不是运行时文案。
3. **degraded / lock owner / `waitedMs` / 函数名（`readActive`）/ 文件路径（`migrate/batch-archive-v5.js`、`.pace/current-native-plan`、`.pace/locks` 列表）一律从对外文案剥离**，移入日志。
4. **deny 文案瘦身**：保留"违反的是哪条规则" + "去哪个 skill 找完整步骤" 两段即可，不内联整套 schema/示例。
5. **`post-tool-use-failure.js`** 限定到 artifact 写入路径中的 Write/Edit/MultiEdit 或 artifact-writer Agent 失败才输出 additionalContext；纯 Bash 失败、纯非 artifact 文件失败完全不追加 PaceFlow 文案。
6. **artifact-writer agent prompt** 删除 `## 报告` 等 14 种变体黑名单——交给 SubagentStop 单点反馈即可，不必在 agent.md 列举。
7. **`G-9` / `⚠️` / "Insight 块豁免"等耦合到用户私人 CLAUDE.md 的内容下沉到用户层**，不写进 plugin。

---

## 跟进项（建议派 CHG）

| 优先级 | 主题 | 范围 |
|--------|------|------|
| P1 | 删除 `appendArtifactDirHint` 的无差别尾巴附加 | `pace-utils.js` + 8 处调用点 |
| P1 | 收紧 `post-tool-use-failure.js` 触发条件 | 单文件 |
| P2 | 剥离 deny 文案中的 schema/教学段，用 skillRef 替代 | `pre-tool-use.js` 7+ 处 deny |
| P2 | 删除 CC 缺陷假设文案 | `session-start.js:58` / `pre-tool-use.js:359` / `pace-knowledge/SKILL.md:139` / `pace-bridge/SKILL.md:30` |
| P3 | artifact-writer agent prompt 瘦身（标题黑名单 + CLAUDE.md override） | `agents/artifact-writer.md` |
| P3 | 删除 `G-9` 字样与多余 emoji | `session-start.js` |

---

## 复审（2026-05-11 09:22）

> 第二轮复读 `plugin/hooks/{*.js,hooks.json,templates/*}`、4 个 skill、agent.md / agent-references/* 全部文件，与初稿做交叉核对。

### 修正项（初稿判断有误，已下调或撤销）

| # | 初稿条目 | 修正 |
|---|---------|------|
| R1 | 四（11） `session-start.js:127、146、188` 多处使用 `⚠️` emoji，与"用户 CLAUDE.md G-5 避免 emoji"冲突 | **撤销**。用户 CLAUDE.md G-5 与项目 CLAUDE.md G-5 均未禁用 emoji；"避免 emoji" 是 Claude 自身回答的指南，不是 hook 输出的约束 |
| R2 | 二（9） "G-9 是 vpsuser 个人 CLAUDE.md 章节号" | **修正措辞**。G-9 同时存在于 paceflow 项目自身的 `CLAUDE.md` 与用户全局 CLAUDE.md。问题仍成立——**plugin 文案不应耦合到任何具体 CLAUDE.md 的章节号**（其他项目使用本 plugin 时不一定有 G-9） |
| R3 | 三（7） `agents/artifact-writer.md:29` "本 agent 的最终报告一律豁免这些样式规则"被列为越界 | **下调**。这是必要的 prompt 隔离：subagent 报告需要被 `SubagentStop` grep `## artifact-writer 报告` 字面解析，外层 CLAUDE.md 装饰会破坏匹配。判断从"越界"下调为"实现细节披露过详"——只需 "本 agent 的最终报告必须只输出报告 H2，禁止任何前/后缀文字" 即可，不必逐条列出"时间戳/Insight/结尾签名" |
| R4 | 三（4） `skills/pace-bridge/SKILL.md:30` "CC 原生 plan 文件名/会话名可能随版本变化" | **下调**。这是合理的实践经验描述，用于解释"为何以 hook 提供的路径为依据"，并非典型 CC 缺陷暴露。可保留但措辞中性化 |

### 新增遗漏项

| # | 位置 | 越界类型 | 问题 |
|---|------|---------|------|
| N1 | `plugin/hooks/pre-tool-use.js:1183-1205` (`INJECT_FORMAT`) | 越权监管（同类一） | Hook 在 Write `knowledge/` 或 `thoughts/` 笔记时直接注入完整 frontmatter 模板（`status/projects/tags/summary/created/updated/sources`）+ 正文 L1/L2 结构。本应由 `paceflow:pace-knowledge` skill 决定的格式规范被硬编进 hook，越过 skill 层。`knowledge` 分支文案 ~6 行嵌进 PreToolUse additionalContext |
| N2 | `pace-utils.js:990-1012` (`v5MigrationPromptMessage`) | 教学式 deny（类四的源头） | 单次 deny 输出 14-17 行：含 3 个选项菜单、`AskUserQuestion` 调用要求、`node "${script}" --dry-run` 命令、二次确认指令、`.pace/v5-migration-state` 写入命令、"不要声称本次写入完成"、"再重试被阻止的原始工具调用"。被 `pre-tool-use.js:1345`、`task-list-sync.js`、`stop.js:151` 多处复用。是初稿"过长 v5 deny"项的真正源头 |
| N3 | `pace-utils.js:1026-1042` (`artifactRootChoiceMessage`) | 教学式 deny | 单次 deny 输出 11 行：含 vault/local 两个路径展示、`AskUserQuestion` 调用要求、"写入纯文本 vault 或 local，不要包含引号"的具体编码格式、`.pace/` 用途科普、被拦截的是代码 vs agent 两种重试路径。同样属于把流程教学塞进首次启用提示 |
| N4 | `pre-tool-use.js:1077` (`DENY_REDIRECT` 文案) | 措辞误导 | `artifact 文件已迁移到 Obsidian vault。请将 file_path 修改为：${correctPath}` —— 措辞暗示发生了"迁移动作"，但实际只是用户选了 vault 作为 artifact root。应改为"当前 artifact_dir 是 Obsidian vault" |
| N5 | `reserve-artifact-id.js:83-95` (`formatReservationBlock`) | 教学性指令重复 | helper 每次输出尾部固定附加 `把以上字段原样放到 paceflow:artifact-writer prompt 顶部；不要让 agent 自行扫描索引分配编号` 与 `.pace/ 只保存配置/运行状态，不存 artifact`。主 session 已从 skill 了解，每次 helper 调用都重复属于噪声 |

### 复审保留的高置信问题（未变）

以下条目在复审中已与代码逐行核对、判断有效：

- **一（1）/（3）/（4）/（5）/（8）通用路径裁判系列**：`.pace/ 只保存配置/运行状态` 通过 `appendArtifactDirHint` 几乎每条 hook 输出都尾随一次，**确证为最高频噪声源**。
- **二（1）（2）Stop 降级机制暴露**：内部 `MAX_BLOCKS=3`、"连续阻止"、"已重置计数" 不应进入 main session prompt。
- **三（1）`session-start.js:58` "落盘"假设**、**三（2）`pre-tool-use.js:359` "CC 不会可靠"**、**三（3）`pace-knowledge/SKILL.md:139` "native build 缺 Grep"**：均为 CC 内部行为推断写入运行时文案，确证越界。
- **四（1）`post-tool-use-failure.js:93-97`**：再次核对 `hooks.json` matcher 是 `Write|Edit|MultiEdit|Bash|Agent`，确认在 PACE 项目中**任何 Bash 失败**（含 `ls`/`cat` 等只读）都会注入 `若失败发生在 artifact 写入...若失败发生在 Bash 验证...`。判断准确，且本次会话两次踩到（`ls` 误用 Windows 风格路径）。
- **四（9）artifact-writer agent prompt 的 14 种 H2 变体黑名单**：必要规则可保留，**列举清单本身过长**——一行"严格字面 `## artifact-writer 报告`，任何变体一律失败" 即可。

### 修订后的总量

- 初稿列 ~36 处。
- 复审：移除 1 处（R1）、下调 2 处（R3、R4）、修正措辞 1 处（R2）、**新增 5 处**（N1-N5）。
- 修订后净计 **~39 处**有效越界文案。
- 结构性根因不变：**`appendArtifactDirHint` 尾巴附加** + **教学式 deny**（其中 v5MigrationPrompt 与 artifactRootChoice 是两个最大的源头函数）。

---

## 复审 2（2026-05-11 11:29）—— 对 commit `a7d0e85` + `44662ab` 的修复对账

> 用户提交了 `a7d0e85 fix paceflow production retry copy noise` 与 `44662ab fix walkthrough link validation gap` 两个 commit。本节按本审计原编号逐项核对，**不引入新规范**。

### 核心修复模式

把"消极描述（`.pace/` 不存 X）"换成"积极描述（artifact_dir 仅用于 X）"，并通过常量 `PACE_ARTIFACT_ROOT_CONTENT` 统一出口。此举从工程上根除负面措辞，但**附录追加器本身仍在**——每条 hook 输出仍贴一遍 artifact 文件列表。

### A. 已切实修复（19 项）

| 原编号 | 文件:行号 | 验证 |
|--------|----------|------|
| 一#1 | `pre-tool-use.js:285-291` `agentArtifactDirDenyReason` | `不要让 artifact-writer fallback 到 cwd...docs/ 等子目录...cwd 可能只是代码工作目录` 整段**删除**，换成"不要让 artifact-writer 自行推断或改写 artifact_dir" |
| 一#2、#5、#6、#7 | `pace-utils.js:1045`、`reserve-artifact-id.js:88`、`pre-tool-use.js:369、840`、agent.md/spec.md/4 skill | `.pace/ 只保存配置/运行状态，不存 X` **大面积删除**或改为 `仅用于 X`（正向） |
| 二#4 | `pre-tool-use.js:837` `PASS_AGENT_ARTIFACT_BASE` | `hook resource lock：读/思考可并发...短暂加锁` **删除** |
| 二#7（部分） | `agents/artifact-writer.md:31-39` | 14 种 H2 变体黑名单 → 一行"禁止任何标题变体、前缀句、时间戳、Insight 块、固定结尾语、寒暄或装饰性文本" |
| 三#2 | `pre-tool-use.js:358` `reservationRequiredReason` | `Claude Code 不会可靠地把 PreToolUse additionalContext 注入到 subagent 初始 prompt` **删除** |
| 三#7 | `agents/artifact-writer.md:27` | "若全局 / 用户 / 项目 CLAUDE.md 要求时间戳/Insight 块/结尾签名"段**删除** |
| 四#1 | `post-tool-use-failure.js:96-100` | **新增 `shouldInjectRecovery` 门禁**：纯 Bash 失败须命中 validation 正则才注入；Write/Edit/MultiEdit 须 artifact 或代码文件；非 artifact-writer Agent 失败不注入。**`ls` 路径错 → 不再注入**。措辞按工具类型分流 |
| 四#2 | `pace-utils.js:995` `v5MigrationPromptMessage` | 17 行 → 13 行，删除"1./2./3." 选项菜单与"不得把第一次选择当作正式迁移授权" |
| 四#4 | 多处 deny 拼接 | 通过常量 `PACE_ARTIFACT_ROOT_CONTENT` 替换长串字面量，平均字数下降 |
| N1 | `pre-tool-use.js:1212` `INJECT_FORMAT` | `YAML frontmatter 示例：---...` 模板**整段删除**，改为"请先调用 Skill(paceflow:pace-knowledge)" |
| N2 | `pace-utils.js:995` v5 | 见四#2 |
| N3 | `pace-utils.js:1031` `artifactRootChoiceMessage` | 11 行 → 8 行，删除"若选择本地项目目录..."与"若本次被拦截的是代码 Write/Edit/MultiEdit..."双重重试教学段 |
| N4 | `pre-tool-use.js:1099` `DENY_REDIRECT` | "已迁移到 Obsidian vault" 误导措辞 → "当前 artifact_dir 是 ${displayDir(artDir)}" |
| N5 | `reserve-artifact-id.js:88` | `.pace/ 只保存配置...artifact_dir 必须指向 X` 行**删除** |
| **P1** | `post-tool-use.js:160` | 无条件 `else` → `else if ((isFileMutationTool && isCodeFile) \|\| isAgentTool)`：**写 `docs/audits/*.md` 这类非代码 .md 不再触发 "task.md 不存在" 提醒** |

### B. 部分缓解（5 项）

| 编号 | 现状 |
|------|------|
| 三#4 `pace-bridge:30` | 文字未改，但已下调严重度（合理实践经验） |
| 三#3 `pace-knowledge:139` "native build 缺 Grep" | 未改，但属下调项 |
| 四#7 `task-list-sync.js` | 把 superpowers `permissionDecision: deny` **改为 hint**，TodoWrite 不再硬阻断；hint 文字也精简。副作用：G-8 强制桥接的硬保障变弱（trade-off） |
| 四#9 `agents/artifact-writer.md` H2 变体黑名单 | 已收敛，但 `close-chg.md` / `update-chg.md` 内的同类清单未跟随精简 |
| 四#12 "迁移/桥接只处理 artifact 状态" | post-tool-use 被 isCodeFile 守门覆盖；其他源点仍重复 |

### C. 未修复且仍重要（19 项，按风险从高到低）

| 编号 | 文件:行号 | 问题 |
|------|----------|------|
| 二#1 | `post-tool-use.js:94-97` | "Stop hook 已降级（连续阻止 3 次后不再阻止退出）" —— `MAX_BLOCKS=3` 暴露 |
| 二#2 | `session-start.js:138-139` | `⚠️ Stop hook 之前已降级（本次已重置计数）` |
| 二#3 | `session-start.js:468-484` | `hook 无法识别` / `readActive 会截断到第一个标记处` —— 内部函数名暴露 |
| 二#5 | `pre-tool-use.js:487-502` | `legacyArtifactWriterLockDenyReason` / `artifactResourceLockDenyReason` 仍带 `session=... agent=... age=Ns lock=<path>` + `hook 已等待 0ms` 调试数值 |
| 二#6 | `subagent-stop.js:91/95/99` | "机械可检测的硬约束"、`EXPECTED_TITLE` 仍暴露 grep 机制（**两个 commit 完全未触及该文件**） |
| 二#8 | `session-start.js:535-541` | `交互式 TaskCreate/TaskUpdate；非交互/SDK TodoWrite` 工具枚举仍硬编 |
| 二#9 | `session-start.js:174-182` | `=== G-9 完成检查 ===` 章节号硬编（未触及）|
| 一#8 | `pre-tool-use.js:244-251` `bashArtifactRuntimeControlDenyReason` | `.pace/locks` / `.pace/sequences` / `.pace/reservations` / `.pace/index-transactions` 黑名单清单仍贴给 AI |
| 三#1 | `session-start.js:58` | `已停止继续注入以避免 Claude Code 将 hook 输出落盘` —— CC 缺陷假设原话保留 |
| 三#5 | `stop-failure.js:2` | `CC v2.1.78 新增事件，文档缺失(#35620)` 注释保留（仅注释，**优先级最低**）|
| 三#6 | `agents/artifact-writer.md:81` | `Claude Code 工具层强制要求 Edit 前同会话 Read` 仍在 |
| 四#3 | `pre-tool-use.js:1371` | native plan 桥接 DENY 8 主题（自动建模板提示 + plan 路径 + 桥接命令 + auto-APPROVED 字段表 + synced-plans 路径 + worktree 注意 + 删除 `.pace/current-native-plan`）**完全未动** |
| 四#5 | `stop.js:99-118` | 每条 warning 仍含完整 `approval-confirmed: true + approval-source + approval-evidence + task-id` schema 教学 |
| 四#6 | `pre-tool-use.js:1226/1302/1315` | C/E 阶段 deny 仍展开 `approve vs approve-and-start` 区别与字段表 |
| 四#8 | `session-start.js:202-204` + `146-156` | startup 与 compact 两条 native plan 提醒重复 |
| 四#10 | `update-chg.md:153` / `close-chg.md:108-123` | 报告前缀失败案例样例仍列举 |

### D. 复审中新发现的潜在副作用

| # | 位置 | 风险 |
|---|------|------|
| D1 | `post-tool-use-failure.js:37-38` `bashLooksLikeValidation` 白名单正则 | 仅匹配 npm/pnpm/yarn test+run+exec、pytest/ruff/mypy/cargo/go/mvn/gradle/tsc/eslint/vitest/jest/make。**自定义脚本验证**（`bash scripts/test.sh` / `./run-tests.sh` / `python -m pytest <path>`）会被漏掉，PaceFlow 不再注入 verify 纪律提醒。trade-off：噪声↓ 但漏报↑ |
| D2 | `task-list-sync.js` superpowers DENY → hint | TodoWrite 不再被硬阻止；G-8 桥接强制下沉为软提醒。AI 忽略 hint 会出现"任务列表与 artifact 长期脱节"|
| D3 | `pre-tool-use.js:925` 新增 `DENY_ARTIFACT_STATUS_INVALID` | 与本审计无关；增强正确性，不构成越界 |
| D4 | `validateWalkthroughLinks`（commit `44662ab` 主体）| 与本审计无关；增强 walkthrough wikilink 与详情对应性 |
| D5 | `reserve-artifact-id.js` 末尾仍保留 `把以上字段原样放到 paceflow:artifact-writer prompt 顶部；不要让 agent 扫描索引分配编号` | 仍属"教学性指令"，但已是单行，可接受 |

### E. P1 验证

> 用户特别指出：Edit `docs/audits/*.md` 也会触发"请先创建 Artifact 文件"

- 修复路径：`post-tool-use.js:160` 的 `else` 分支加上 `(isFileMutationTool && isCodeFile) || isAgentTool` 守门
- 必要性：`docs/audits/*.md` 后缀不在 `CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte']`，因此 `isCodeFile = false`
- PreToolUse 同类路径：早就用 `isCodeFile && isInsideProject && !hasActiveTasks` 守门（L1267 / 1353 / 1380）。**问题只在 PostToolUse，已堵上**
- 结论：**P1 源码层完全修复**

#### E.1 运行时验证（2026-05-11 11:32）

复审过程中再次编辑 `docs/audits/*.md` 时仍看到旧 PACE 提醒"请先创建 Artifact 文件"。grep 定位发现：

- 源码版本：`pace-utils.js:PACE_VERSION = 'v6.0.50'`
- 运行时加载路径：`~/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.32/hooks/post-tool-use.js`
- 新文案 `写代码或派 artifact-writer 前请先创建 v6 CHG` 仅出现在源码 `plugin/hooks/post-tool-use.js:174`，6.0.32 cache 中是旧文案

**结论**：修复在源码层确认有效，但本会话进程加载的是 6.0.32 plugin cache，需要插件 marketplace 拉取新版（≥ 6.0.50）或本地 reinstall 才能生效。运行时验证需在新插件加载后另一会话进行。

### F. 统计

| 类别 | 原始项 | 修复 | 部分缓解 | 未修复 |
|------|-------|------|---------|--------|
| 一、通用路径裁判 | 8 | 7 | 0 | 1 |
| 二、内部实现细节 | 10 | 2 | 0 | 8 |
| 三、CC 缺陷假设 | 7 | 2 | 0 | 5 |
| 四、过长解释 | 12 | 3 | 4 | 5 |
| N1–N5 新增 | 5 | 4 | 1 | 0 |
| P1 文档编辑 | 1 | 1 | 0 | 0 |
| **合计** | **43** | **19** | **5** | **19** |

修复率 ≈ **56%**（含部分缓解则 ≈ 67%）。

### G. 下一波 P1 建议（按风险/工作量比）

1. `pre-tool-use.js:1371` native plan DENY 拆分 —— 单条 8 主题，是 deny 噪声王
2. `subagent-stop.js` 三条 grep 机制提醒 —— 两 commit 完全未触及；合并成一条中性"agent 报告未能解析"
3. `stop.js:99-118` warnings 内嵌 schema 字段表 —— 交给 skill，不在 stderr 教学
4. `session-start.js:174-182` `G-9` 章节号 + `:535-541` 交互式/SDK 区分 —— 解除项目 CLAUDE.md 与 plugin 耦合
5. `pre-tool-use.js:487-502` 锁详情 deny reason —— 隐去 `session=/agent=/age=/lock=path` 调试字段
6. D1 `bashLooksLikeValidation` 漏报 —— 可考虑保留单行 hint 作为兜底（"Bash 验证失败，未通过前不要派 verify/close-chg"）
