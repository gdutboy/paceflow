# PACEflow 激活 UX 重构 — 设计文档

> **状态**：设计（pre-implementation，2026-06-09）。尚未实现，勿当现行行为。
> **触发**：审计发现野外 code-count / dated-plan 弱信号致 SessionStart 静默锁定 + 无逃生口 =逼用户卸载。
> **关联 finding**：`changes/findings/finding-2026-06-09-code-count-sessionstart-silent-lock-no-escape.md`（P0）

## 1. 目标与背景

### 问题（审计确证）
野外项目（根目录 3+ 代码文件 + 无 `PACE_VAULT_PATH` + 无 `.pace/disabled`）开 session：
1. `isPaceProject` 前置强信号全不满足 → `countCodeFiles≥3` → 弱信号 `code-count`（pace-utils.js:610）
2. 无 vault → `artifactRootChoiceNeeded` 短路 `false`（pace-utils.js:430）→ `rootChoicePending=false`
3. SessionStart W11 守卫失守 → 静默建 `changes/` + 6 模板（runtime-effects.js:92-95），**无 stdout 提示**
4. 下次 session → `hasChangesDir` 永久锁定 `artifact`（单向不可逆）
5. 写代码 → pre-tool-use 硬 deny「无活跃任务」，消息全 paceflow 术语、**不给逃生口**

`superpowers` 信号（dated-plan）是同病理的另一入口：`docs/plans/<date>-*.md`（14 天内、仅匹配文件名不验内容）→ 同样静默锁定 + deny。

**第二激活入口（实现计划阶段发现，原审计漏看）**：`pre-tool-use.js:1593-1614`（T-079 off-by-one 前瞻）是独立于 `isPaceProject` 的另一条 code-count 门控——非 PACE 项目用 Write 写「将达第 3 个」代码文件时，直接 `createTemplates` 静默建模板 + deny「请先建 CHG」。比 SessionStart W11 更刁：用户连 session 都没重开、写第 3 个文件那一刻就被拦 + 项目凭空多出 artifact。说明「信号倒挂」不是单点 bug，是散布在 `isPaceProject` / W11 / pre-tool-use lookahead **三处**的同一模式，根治必须同时铲除三处（见 §10 CHG-A）。

### 根因
**信号强度与后果倒挂**：最弱信号（「有代码文件」/「有个像 plan 的文件名」）触发最重后果（静默建 artifact + 永久锁定 + 写代码 deny + 无逃生口）。`code-count` 只证明「这是代码项目」，完全不证明「用户想用 PACE」。dogfood 盲区——paceflow 自身永远是 `artifact` 强信号、永远有 vault、开发者知道 `.pace/disabled`，结构性测不到野外路径。

## 2. 核心思想

从「**自动检测即激活**」转向「**显式启用为主，软信号只提示**」。把确定性从「自动检测」搬到「用户主动 enable」：弱信号不再触发任何门控，只用于提示 AI 主动询问用户；真正的激活靠用户显式 `/paceflow enable` 或既有 `changes/`。漏提示 = 不激活 = 野外安全。

## 3. 架构：激活判定 ⊥ 软信号提示（解耦）

当前 `isPaceProject` 把弱信号（code-count/dated-plan）和强信号（changes/）混在一个函数、都当激活。拆成两层正交：

| 层 | 函数 | 认什么 | 后果 |
|---|---|---|---|
| **激活层** | `isPaceProject`（收紧） | 仅强信号：`changes/` 存在 / artifact-root 配置 / `.pace-enabled` / legacy v5 | 激活门控（deny 等） |
| **软信号层** | `detectSoftSignal`（新） | code-count(3+文件) / dated-plan(`docs/plans/<date>-*.md`) | **只提示，不激活不门控** |

关键变更：**从 `isPaceProject` 移除 `code-count` 与 `superpowers`(dated-plan) 两个返回值**——它们不再触发任何门控，只喂给提问层。`disabled` 标记存在时 `detectSoftSignal` 也返回空（不提示）。另：`pre-tool-use.js` 还有一条独立于 `isPaceProject` 的 code-count 门控（T-079 lookahead，写第 3 个代码文件时 deny + 建模板），同属激活层，一并移除（§10 CHG-A）。

## 4. 组件（5 个）

1. **信号分层**（`pace-utils.js`）：`isPaceProject` 收紧（移除 code-count/dated-plan 激活）；新增 `detectSoftSignal(cwd)` 返回 `'code-count' | 'dated-plan' | false`，且有 `.pace/disabled` 或已 enabled 时返回 `false`。
2. **提问层**（`session-start/`）：`detectSoftSignal` 命中 ∧ 未 enabled ∧ 无 disabled → 注入**指示 AI**「首次响应前用 AskUserQuestion 问是否启用」。注入是 additionalContext（用户不可见），故只能指示 AI 提问，不能直接问用户。
3. **状态 helper**（新 `set-activation.js`）：`--enable`（删 disabled + 首次触发选 root / re-enable 恢复）/ `--disable`（写 `.pace/disabled`）/ `--status`（输出当前状态机态）。统一写入 Project Root 的 `.pace/`。
4. **slash command**（新，形态 plan 阶段定 commands/ 或 user-skill）：`/paceflow enable | disable | status`，引导 AI 调用 `set-activation.js` helper + 必要时选 root。
5. **文案层**：所有 PACE deny 的 `permissionDecisionReason` 末尾加一行逃生口「不需要 PACEflow？运行 `/paceflow disable`」。

## 5. 状态机（3 态）

`deferred`（暂不）与 `disabled`（禁用）在「问一次记住」语义下行为完全一致（都不激活 + 不再主动问 + 可恢复），合并为单一 `.pace/disabled` 标记。提问选项收为 2 个：**启用 / 暂不**。

```
新项目(软信号命中, 无 disabled, 未 enabled)
  ──AskUserQuestion(启用/暂不)──┬─启用→ /paceflow enable → enabled
                               └─暂不→ set-activation --disable → disabled
enabled  ──/paceflow disable──> disabled        (artifact 全保留)
disabled ──/paceflow enable───> 恢复(既有 changes/→继承复用 / 无→首次选 root)
disabled ──下次 session───────> 静默(detectSoftSignal 见标记→不提问)
```

`disable` 只建 `.pace/disabled` 标记、**不动任何 artifact**，故 `re-enable` 删标记后 `changes/` 仍在、自动恢复——「暂停→恢复」零成本。彻底清空是独立操作（未来 `/paceflow reset`，本次 YAGNI 不做）。

## 5.1 disable 操作空间与防滥用（逃生口完整性）

逃生口与纪律存在根本张力：太易达 → AI 滥用绕过门控；太难达 → 野外用户困住（P0 原罪）。本节定两个不变量。

### 不变量 1：disable 无条件可达
`/paceflow disable` 经 `set-activation.js` 写 `.pace/disabled`（runtime 标记，**非代码文件、非 artifact**）。任何激活状态 / 任务状态下都**不被任何门控拦**：写代码 deny 只拦代码文件；bash-guard mutation gate 保护 artifact + `.pace/{locks,sequences,reservations,...}` 但**不含 `.pace/disabled`**。这是必须维持的不变量——未来改 bash-guard / pre-tool-use 不得误伤这条逃生路（测试见 §9 第 7 项）。否则野外用户「想退出却退不出」，P0 复发。

### 不变量 2：disable 服务用户、不服务 AI 绕过
disable 的意图归属必须是「**用户**不想用 PACE」，绝不是「**AI** 想跳过单次 deny」。disable 粒度是**停用整个项目 PACE**（非跳过单次），天然抑制「AI 为写一个文件废掉整个项目纪律」的滥用（代价严重不对等）。叠加三层防护：

1. **文案指向用户**：deny 逃生口措辞「**若你（用户）不需要 PACEflow 管理本项目**，可运行 `/paceflow disable`」——明确用户决策 + disable=停用整个 PACEflow。deny 主信息仍是「正确做法是建 CHG / approve-and-start」，disable 只是给真不想用的用户的退出，不是单次 deny 的绕过手段。
2. **AI 行为约束**（pace-workflow skill + `/paceflow` command prompt）：AI 被 deny 时**默认走 PACE 流程**；`disable` 只在用户**明确表达停用意图**时执行；**AI 不得为绕过单次 deny 自主 disable**。
3. **路径分流确认**：**用户主动** `/paceflow disable`（用户在终端输入 slash command）→ 直接执行（用户已表达意图，不再啰嗦确认）；**AI 自主**判断用户可能想停用 → 必须先 `AskUserQuestion` 确认。确认只加在「AI 自主」路径，用户主动路径保持流畅。

### 诚实边界
hook 在技术上**拦不住** AI 直接跑 `node set-activation.js --disable`（普通 Bash，不写代码/artifact）。不变量 2 的防护本质落在**指令层 + 文案**，而非确定性 hook——这正是 PACEflow「纪律工具，非攻击对抗器」定位的体现：防日常疏忽，不防故意绕过。若 AI 蓄意绕过，超出 PACE 确定性保障范围。

## 6. 数据流：首次野外项目（无 vault 的普通 JS 项目）

```
1. SessionStart core hook: detectSoftSignal → 'code-count'; 无 disabled, 未 enabled
2.   → 注入指示(给 AI): "检测到本项目可纳入 PACEflow 管理但未启用。响应用户前用
       AskUserQuestion 问是否启用; 启用→引导 /paceflow enable, 暂不→ set-activation --disable"
3.   → W11 不再对软信号建 changes/  (静默锁定病理根除)
4. AI 首次响应: AskUserQuestion("PACEflow 可管理本项目的开发流程(任务/变更/验证); 是否启用?"
     选项 启用 / 暂不[注: 暂不=本项目不再主动问, 随时可 /paceflow enable])
5.   用户「启用」→ AI 触发 /paceflow enable → AskUserQuestion(vault/local) → set-artifact-root → enabled
6.   用户「暂不」→ AI 运行 set-activation.js --disable → 之后静默
```

## 7. 文案（泛化：讲价值不讲机制）

- **注入指示 AI**：「检测到本项目可纳入 PACEflow 管理但未启用。在响应用户前，用 AskUserQuestion 询问是否启用；启用→引导 `/paceflow enable`，暂不→运行 `set-activation --disable`（本项目不再主动询问，随时可 `/paceflow enable`）。」**不写「N 个代码文件」**——触发原因（code-count/dated-plan）是机制细节，且 dated-plan 触发时无代码文件。
- **AI 问用户**：「PACEflow 可以管理这个项目的开发流程（任务追踪 / 变更记录 / 验证审计）。是否启用？」选项 **启用** / **暂不**（暂不 description：本项目不再主动询问，随时可 `/paceflow enable` 开启）。
- **deny 逃生口**：所有 PACE deny 末尾加「**若你（用户）不需要 PACEflow 管理本项目**，可运行 `/paceflow disable` 停用」——指向用户决策（见 §5.1 不变量 2），deny 主信息仍引导走 PACE 流程（建 CHG / approve）。

## 8. 错误处理（fail-safe 一致）

- `detectSoftSignal` 读文件失败 → 返回 `false`（不提问），与现有 hook fail-open 一致。
- `set-activation.js` 写标记失败 → 输出明确错误 + 手动建文件指引，不崩溃。
- AI 漏问（软指令不保证执行）→ 项目不激活 = 野外安全；想用的用户走 `/paceflow enable` 硬入口。
- `slash command` 在错误态（enable 已 enabled / disable 已 disabled）→ 幂等提示当前态，不报错。

## 9. 测试策略

1. `isPaceProject` 收紧：code-count/dated-plan 不再返回激活信号（单测）
2. `detectSoftSignal`：code-count/dated-plan 命中；有 `.pace/disabled` / 已 enabled 时返回 false（单测）
3. **W11 不再对软信号建 changes/**（e2e，直击 P0 病理）—— 无 vault + code-count 不建 changes/
4. 状态机三转换：enable(首次选 root / re-enable 继承)、disable、暂不(--disable)（e2e）
5. deny 文案含逃生口 `/paceflow disable`（e2e 断言）
6. **向后兼容回归**：已有 `changes/` 的项目仍激活（强信号不受收紧影响）
7. **disable 无条件可达**（§5.1 不变量 1）：已激活 + 无活跃任务项目运行 `set-activation --disable` 成功写 `.pace/disabled`、不被门控拦；写后 `isPaceProject` 返回 false（豁免生效）

## 10. 实现分期（4 个独立闭环 CHG）

| CHG | 内容 | 独立验证 | 依赖 |
|---|---|---|---|
| **A** | 激活信号收紧 + **双入口**病理根除（`isPaceProject` 移除 code-count/dated-plan + `detectSoftSignal` + W11 不建 changes/ + **移除 pre-tool-use T-079 code-count-lookahead 的 deny+createTemplates**） | 软信号不激活 + W11 不建 + lookahead 不 deny + 兼容回归 | — |
| **B** | 状态 helper `set-activation.js` + slash command `/paceflow enable\|disable\|status` + disable 防滥用约束（§5.1：command/pace-workflow skill 写入「AI 不自主 disable、用户主动直接执行、AI 自主先 AskUserQuestion 确认」） | 三子命令行为 + 状态机转换 + disable 无条件可达（已激活+无任务不被拦） | A |
| **C** | 提问层（SessionStart 注入指示 AI AskUserQuestion + 软信号命中判定） | 软信号命中注入提问指示、有标记不注入 | A |
| **D** | 所有 deny 文案加逃生口「若用户不需要 PACEflow 可 `/paceflow disable`」（指向用户决策，§5.1 不变量 2）+ deny 主信息仍引导走流程 | deny reason 含逃生口且指向用户 | B |

CHG-A 独立根治 P0/F2 静默锁定（最高优先级）；B/C/D 补全显式入口与提示。

## 11. 向后兼容

现有 paceflow 项目（含本仓库自身）有 `changes/` = `artifact` 强信号，`isPaceProject` 照常激活。CHG-A 收紧只移除 `code-count`/`dated-plan` 两个弱信号，`changes/` / 配置 / `.pace-enabled` / legacy 全部保留 → **已激活项目零影响，dogfood 安全**。只改「新的、还没建 changes/ 的 code-count/dated-plan 项目」行为。

## 12. 安全说明

本重构**降低**门控触发面（弱信号不再激活），不新增任何 deny 路径，方向是「野外更不容易被拦」。新增的 `/paceflow disable` 与逃生口文案是纯放行/退出能力。`set-activation.js` 只写 `.pace/` 运行态标记（disabled），不碰 artifact、不碰项目代码。最坏失败是「该提示没提示」（野外安全）或「该激活没激活」（用户 `/paceflow enable` 即可）。
