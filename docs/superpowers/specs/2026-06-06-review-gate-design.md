# PACEflow Review Gate 设计（草案）

> 日期：2026-06-06
> 状态：草案——设计已收敛，待 codex review gate 对照研究后定稿
> 来源：GitHub issue #3 `[improvement] 4 quality gates for close-chg flow`
> 相关：`docs/action-plan-2026-05-02.md` §0.1.11（P1-design 备忘，本设计取代之）；本次 brainstorming session

---

## 0. 一句话

在 PACEflow 状态机里新增一个与 `VERIFIED` 同构的一等标记 `REVIEWED`：CHG 收口前，主 session 派一个**自选的** review agent 对本 CHG diff 做对抗审计，`close-chg` 把"审计这步跑过了"连同验证、归档一起落字。**只强制"审计步骤发生 + 记录"，从不裁决代码质量。**

---

## 1. 背景与问题

issue #3 来自真实 milestone retro：验证四项（typecheck/test/lint/format）全绿之后，独立 review 仍挖出 1 P0 + 5 P1 + 8 P2 + 8 P3，开了 4 个 hotfix 才收拾。本仓库 v6.1.4 也复现同一盲区：CHG-20260605-08 四件套全绿，靠用户追问 + 对抗 subagent 才抓到 PowerShell over-block 回归，开 HOTFIX-20260606-01 修掉。

**共性盲区**：自动化验证（VERIFIED）只覆盖"测试/构建过没过"，覆盖不了 wire-alignment drift、plan 不变量遗漏、对抗式回归这类需要"一道独立审查"才能发现的问题。而这道审查目前**没有任何结构化触发**，全靠人记得要求。

---

## 2. 设计理念（铁律，不可破）

**PACEflow 是流程执行纪律工具，不是质量控制工具。** 它只确认"AI 按流程执行了 CHG 并用标准协议记录"，从不控制/裁决代码质量——质量由 AI 能力决定，不靠流程兜。

由此推出整套设计的判据：**任何环节只能"记录某流程步骤是否执行"，不能"裁决代码是否达标"。**

- `REVIEWED` 与 `APPROVED`/`VERIFIED` 同构：`APPROVED` 证"用户批准了"，`VERIFIED` 证"验证跑了"，`REVIEWED` 证"审计跑了"。三者都**不证明**对应对象正确，只证明流程证据存在。
- hook 只机械校验"证据在不在"，绝不判内容真伪——"hooks mechanically enforce process evidence, models/humans judge content quality"（issue #3 作者评论原话）。

---

## 3. 核心机制：REVIEWED 状态机标记

### 3.1 为什么必须进状态机（而非 skill 文字）

`VERIFIED` 被可靠触发靠双保险：① 天然冲动（AI 写完自然想跑测试）；② 状态机强化——`completed 但 verified-date=null` 是机器认的"没做完"状态，`stop.js` 在此拦截，`close-chg` 要 `verification-confirmed` 才写 VERIFIED。

`review` 两样都没有：① 没有天然冲动（AI 刚写完默认代码是对的，不会自发对抗自审）；② 状态机里 `verified → archived` 之间没有 review 槽位。**正因为 review 不像 verify 那样天然，它比 verify 更需要结构化触发。** 靠 skill 文字 = 靠记得 = issue #3 警告的 "just another prompt reminder"，不可取。

### 3.2 状态机扩展

| status | verified-date | VERIFIED | reviewed-date | REVIEWED | 位置 / Stop 行为 |
|---|---|---|---|---|---|
| completed | null | 缺 | — | — | 活跃, Stop 拦"未验证" |
| completed | 非null | 有 | null | 缺 | 活跃, Stop 拦"**未审计**" ← **新增状态** |
| completed | 非null | 有 | 非null | 有 | 活跃, 待 close / archive |
| archived | 非null | 有 | 非null | 有 | ARCHIVE |

触发力来自新增的"verified 但未 reviewed"状态：`stop.js` 在你想结束会话时拦着催（与"未验证"同款）；`close-chg` 没 `review-confirmed` 不肯写 REVIEWED、不算干净闭合。review 的触发器与 verify **同源**。

### 3.3 两种"阻断"，必须分清

| | 含义 | 本设计 | 是不是质量控制 |
|---|---|---|---|
| **阻断-on-步骤** | close 前必须**记录 REVIEWED**（审计这步跑过） | **要**（这正是触发器）| 否——强制步骤发生，不判代码 |
| **阻断-on-结论** | close 前必须**修完 P0/P1** | **不要** | 是——会把质量耦合进 close |

精确表述：**强制这一步、放开这个结论。** 一个审计挖出 5 个 P0、全部 route 成 won't-fix finding，照样满足 REVIEWED——流程从没要求"修"，只要求"审了并记录怎么处置"。

---

## 4. 分层（不可越层）

**编排在 workflow（主 session），落字在 artifact-writer。**

- **审计是编排/推理**：派 subagent、读报告、判断 findings 处置 → 主 session 的活。
- **artifact-writer 永远只落字**：不跑审计、不做判断、不派 agent。它对 review gate 多出的**唯一**能力 = 写 `REVIEWED` 证据行（+ reviewed-date / review-summary），与现有 `action=verify` 写 VERIFIED 完全同构。

新增 artifact-writer 能力：
- `update-chg action=review`：独立写 `<!-- REVIEWED -->` + reviewed-date + review-summary（"记审计但暂不归档"的逃生口，对标 `action=verify`）。
- `close-chg`：主路径折叠 REVIEWED（要 `review-confirmed`），与它已折叠 VERIFIED 同理。

---

## 5. 完整流程

```
[实现] T-001..T-NNN 全部编码完成
      │
      ▼
[V 验证] 主 session 跑测试/构建, 读结果                    ← 既有, 不变
      │   └─ 不过 → 修 → 重验 (不进审计)
      ▼
[R 审计] 主 session 编排 (workflow 层, 新增):
      ① 看本 CHG diff 改了什么
      ② 按内容自选 review agent + 用通用方法论 direct 它
      ③ 派 subagent 审 diff → 读报告 (P0/P1/P2/P3)
      │
      ▼
[处置] 主 session 路由 findings (调既有 writer 操作):
      P0/P1 → 开 HOTFIX(create-chg) 或 记 won't-fix(record-finding)
      P2/P3 → record-finding 进 backlog
      │   └─ 不阻断结论: 不等 HOTFIX 修完
      ▼
[收口] artifact-writer close-chg (既有操作, 多记一行):
      收口末任务[x] + status=completed
      + verified-date + <!-- VERIFIED -->
      + reviewed-date  + <!-- REVIEWED -->   ← 唯一新增, 与 VERIFIED 并列
      + 归档 task/impl 索引 + 写 walkthrough row
      │
      ▼
CHG archived ── 干净闭合: 计划执行 + 验证 + 审计 三件事都记录在案

   └─[审计开的 HOTFIX]─ 独立走自己的生命周期
       迭代闸: 审计-findings 生出的 HOTFIX 默认不再自动重审 (深度=1), 防无止境
```

---

## 5.1 执行模型：审计 subagent 必须 inline（不可 background）

审计由主 session 用 **Task/Agent 工具 inline（foreground）派发** review subagent，**不可作为 background task / detached 进程**。理由在 Stop 的触发时机：

- 派 subagent 是一次 **tool call**——主 session 在审计期间是 **mid-turn（阻塞在 tool call 上）**，**不触发 Stop**。Stop 只在主 session 整轮结束（无更多 tool call）时 fire；subagent 结束触发的是 `SubagentStop`，与主 `Stop` 是两个不同 hook。
- 所以「subagent 在审计、主 session 已 Stop 下来等结果」这个状态**不存在**：审计作为 in-turn tool call 必然在本轮 close-chg 之前返回。Stop fire 时只有两种可能——REVIEWED 已写（放行），或审计还没做（硬拦 → 催下一轮去做），没有「停在审计中途」的中间态。
- 反例（为什么是硬约束）：若错误地把审计派成 background task，主 session 可能在审计在途时就 end-turn → Stop 撞上 REVIEWED 缺失 → 硬拦（连 3 次后 counter 降级兜底，不死锁，但体验差）。故 inline 派发是硬约束。

---

## 6. 关键决策

| 维度 | 决定 | 理由 |
|---|---|---|
| **决策模式** | 报告优先，不盲目自动修 | 自动修 = 流程替你裁决"该修" = 质量控制 + 审计→修→引新问题→再审的无止境 |
| **范围闸** | P0/P1 必须处置（HOTFIX 或 won't-fix）；P2/P3 → record-finding backlog | severity 闸，防无止境第一道 |
| **迭代闸** | 审计-findings 生出的 HOTFIX 默认不自动重审（深度=1）| 防递归不收敛，第二道 |
| **审计主体** | 主 session 按 diff **自选** review agent，**不固化**标准 agent | 固化标准 agent = 试图穷举场景 = 隐性质量标准 + 脆；自选 = 锁"审计发生"放"用什么棱镜" |
| **频率/摩擦** | REVIEWED **每个 CHG 都要**（universal）；`review-source` 随风险伸缩 | 琐碎 CHG → `review-source: manual`（瞄一眼）；有风险 → 自选独立 agent。hook 只查标记在不在、不查审计够不够狠，与 VERIFIED 同一信任模型 |

---

## 7. 审计方法论（可发布 reference）

`internal/skills/audit/` 是 paceflow 专用自审 skill（靶子是 `plugin/hooks/**` 这类插件内部，不发布），但其**方法论内核通用**，抽成一份**可发布 reference**（拟放 `plugin/skills/pace-workflow/references/review-methodology.md`），供主 session direct 自选的 review agent。`internal/skills/audit/` 可反过来引用同一份内核（去重）。

通用内核（全是"发现纪律"，无一条是"质量标准"）：

1. **独立发现，不照文档打勾**——挖问题，不对着 README 核对。
2. **证据优先级**：代码/配置 > 测试/fixture > 真实日志/session > 文档；文档不能单独定 C/H 级 bug，代码行为是 ground truth。
3. **报告全部 → 再验证**：先不预筛、后验证去重降级剔误报。历史误报率 50-80%，**验证才是核心**。
4. **三件核查武器**：路径追踪、实际 diff、设计意图查证。
5. **严重度纪律**：C 级必须证明具体触发路径，反 severity 膨胀。
6. **误报防御 7 条**：模式匹配非路径追踪 / 缺设计意图 / 未实际 diff / 严重度膨胀 / 文档驱动误判 / 过早过滤 / 大 diff stall。
7. **记录审查基线**：git HEAD + 工作区 diff 状态 + 证据来源，让审查可复现。

（与 vault `knowledge/` 里 `[[strict-audit-methodology]]` 同源。）

---

## 8. close-chg 关系（三条铁律）

1. **位置**：审计在 close-chg **之前**（workflow 一步），不在 close-chg 内部。close-chg 不跑审计、不开 HOTFIX、不判断。
2. **职责**：close-chg 比现在**只多落一行 REVIEWED**（+ reviewed-date/summary），与它早就在落的 VERIFIED 并列。
3. **不阻断结论**：findings 已在上一步路由，无论审计挖出什么，close-chg 照常归档。`close = 计划执行完 + 记录`，语义不变。

---

## 9. 发布物清单（预估）

1. 通用 review 方法论 reference（新，shipped）——抽自 internal audit 内核。
2. `pace-workflow` close 流加"审计 + 路由"步骤（skill 文档）。
3. `artifact-writer` 加 `update-chg action=review` + `close-chg` 折叠 REVIEWED（agent + agent-references）。
4. `stop.js` 加"verified 但未 reviewed"状态的拦截/催促。
5. `REFERENCE.md` 状态机表 + 操作表 + Stop 覆盖更新；`README.md` 版本历史。
6. hook 单元/E2E 测试 + agent contract 测试。

---

## 10. codex review gate 对照（已研究 2026-06-06）+ 仍开放问题

### codex-plugin-cc 的 review gate（v1.0.4）机制速记

- Stop hook（`stop-review-gate-hook.mjs`），开关开 + Codex 可用时**每次 stop 都跑**一次 Codex 审查（read-only 沙箱，app-server JSON-RPC）。审查输入**只取 `last_assistant_message` 文本**当线索，diff 不传、由 Codex 自己翻仓库。判定靠 Codex 回答**第一行** `ALLOW:`/`BLOCK:`（fail-closed：空/超时/出错都按 BLOCK）。阻断用 `{"decision":"block"}` JSON 逼 Claude 修完再 stop。默认**关闭**，项目级 `state.json` 显式开。
- **致命点：零循环 bound**——无最大轮次、无 dedup、无冷却、无预算，**且不读 Claude Code 原生防循环标志 `stop_hook_active`**。收敛 100% 寄望 Codex 自己最终回 ALLOW。README"长循环 / 烧用量 / 需主动盯"的警告是代码层面坐实的。

### 回填本设计三点

1. **实证了我们的关键分歧**：codex = 阻断-**on-结论** + per-stop + 零 bound = 用户明确要规避的"质量控制 + 无止境"。本设计阻断-**on-步骤**、per-CHG-close、带 severity 闸 + 迭代闸，是反过来的选择。
2. **marker 幂等 = 本设计的结构性免循环**：我们的 stop 拦截判据是"REVIEWED 标记**在不在**"——审一次 → 写 REVIEWED → 标记在了 → 不再催，单调收敛、天然不循环；codex 是 per-stop 无状态重判 verdict 才会循环。这是状态机 marker 路线对 codex stateless 重审路线的**架构优势**。
3. **防循环复用 stop.js 现成 counter（实测确认，非 `stop_hook_active`）**：调研 stop.js 确认它**不读** `stop_hook_active`，而用全局 `stop-block-count`——同组 warning 连阻 3 次 → 写 `degraded` → 自动降级 exit 0，再由 PostToolUse 读 `degraded` 接力软催。REVIEWED 门照抄现有 closing-required / verify 分支即**零额外代码继承**这套防循环：写了 REVIEWED → 门条件翻假（happy-path 终止，即点 2）；没写 → counter 3 次后自动松手（backstop）。codex 循环根因是 marker 记忆与 counter 皆无，PACEflow 两者都有，照抄即免疫。

### 收敛 bound 由此收口

severity 闸（P0/P1 处置、P2/P3 backlog）+ 迭代闸（HOTFIX 深度=1 不自动重审）+ **marker 幂等**（审一次写一次、不重触发），三道一起，结构上不会出现 codex 那种烧用量循环。又因有 bound + 不阻断结论，本设计可**安全默认内建**进 close 流程（codex 因危险才默认关 + 需主动盯）。

### 仍开放

- **频率 rigor 是否足**：universal REVIEWED + review-source 伸缩，会不会让琐碎 CHG 的 `manual` 退化成走过场？信任模型与 VERIFIED 一致，需 dogfood 验证。
- **REVIEWED 标记落点 / 格式**：拟写在 `changes/<id>.md` 内 `VERIFIED` 下一行，具体格式待定。

---

## 11. 下一步

1. 研究 codex-plugin-cc 的 review gate 实现（Stop hook 触发、阻断、循环/收敛、配置），回填 §10 借鉴点，必要时修订本设计。
2. 定稿后转 `writing-plans` 出实施计划。
3. 实现走 PACE `create-chg` 落地（本设计是该 CHG 的输入 spec）。
