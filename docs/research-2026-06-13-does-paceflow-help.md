# PACEflow 是否对使用 Claude Code 有实质改进？——联网证据调研（2026-06-13）

> 本文用多源联网调研 + 对抗验证回答一个问题：PACEflow 的「确定性流程门」（hook 层 deny 强制 P-A-C-E-V-R，而非 CLAUDE.md 软指令）对使用 Claude Code 是否有实质改进。
> 所有结论 evidence-backed，附来源；每条声明经 3 票对抗验证（需 2/3 反驳才杀掉）。
> 本文属仓库维护材料（`docs/`），不随 marketplace runtime 发布。

| 元数据 | 值 |
| --- | --- |
| 日期 | 2026-06-13 |
| 方法 | deep-research harness：5 角度并行搜索 → 抓 23 源 → 提取 115 条声明 → 25 条进对抗验证 → 确认 19 / 杀掉 6 → 合成 9 条 finding |
| 规模 | 105 agent · ~2.9M tokens · 663 工具调用 · ~22 分钟 |
| 现实信号（用户补充） | 项目 GitHub 30+ star；用过的用户普遍反馈「有效」（自选样本，分母未知） |

---

## 结论（诚实版）

> **证据强力支持 PACEflow 的「前提」，但不支持它作为「通用默认」；它对谁是实质改进、对谁是负 ROI，是条件性的——分界线落在「原型 → 生产」的转换点。**

- 证据证明了「病」真实存在（AI 编码的范围蔓延/过度工程/上下文丢失/规划失败），也证明了软指令不可靠（遵守率远低于 100%），还证明了门控流程是 GitHub/Microsoft 主推的行业模式。
- 但**没有任何一条研究测量过「PACEflow 式确定性流程门能降低 revert 率 / 提升交付质量」**——从「失败类真实」到「流程门有效」是机制类比，不是因果证明。
- 最诚实的信号：对抗验证里被杀掉的声明，恰恰是试图建立「结构化流程 → 改善结果」因果链的那几条（见下）。

---

## 按 5 个子问题的证据综合

| 子问题 | 证据结论 | 置信度 | 关键来源 |
| --- | --- | --- | --- |
| ① AI 失败模式是真痛点？ | ✅ **是**。33,580 个 agentic PR：2.66% 被 revert，首因「非预期副作用与过度工程」(22.3%) ≈「功能不正确」(22.1%)；作者结论"主要栽在范围管理与上下文理解" | high (3-0) | MSR 2026《When AI Code Doesn't Stick》 |
| ① 计划丢失/灾难性遗忘 | ✅ **真实且反复**。HORIZON 3,100+ 轨迹："规划失败、内存限制、灾难性遗忘占失败轨迹相当比例"，"光堆基座模型解决不了" | high | arXiv:2604.11978 |
| ② 软指令遵守率 vs 确定性强制 | ✅ **软指令不可靠有实证**。IFEval GPT-4 严格遵守 76.89%；大规模研究 43.7%；Anthropic 官方承认 hooks"确保动作总是发生而非依赖 LLM 选择" | high (3-0) | IFEval arXiv:2311.07911 + Anthropic docs |
| ③ 同类工具的证据与采用 | ✅ **门控流程是行业模式**，PACEflow 非孤例。Spec Kit = "sequential, gated process...不可重排或合并阶段" | high (3-0) | github/spec-kit + MS Developer Blog |
| ④ 强制流程的反面成本 | ✅ **有一手 RCT 反证**。METR：资深开发者熟悉仓库用 AI 反而慢 19%，且完全感知不到（自评快 20%）。SDD 文献：单人/短命/抛弃型规格开销 > 收益 | high (3-0) | METR arXiv:2507.09089 + SDD arXiv:2602.00180 |
| ⑤ 对谁实质改进 / 对谁负 ROI | **多人 / 长生命周期 / 生产硬化 / 高 blast-radius → 实质改进**；**单人 / 短命 / 原型 / 探索 / 琐碎改动 → 负 ROI** | high (3-0) | SDD + InfoWorld + DORA 2025 |

---

## 主 session 的批判性判断（含 30-star 现实信号整合）

**1. METR 这把刀是双刃的，刀尖正对着 dogfood 场景。**
METR 证明"资深开发者 + 熟悉仓库 + AI = 慢 19% 且感知不到"。对 PACEflow：① 支持"无纪律 AI 使用会出问题"；② 更要命——dogfood 场景（单人 + 极熟自己仓库 + 大量琐碎自审改动）正是所有证据一致判定"强制全流程 = 负 ROI"的象限，而 METR 还证明**作者无法靠自评纠正这个高估**。

**2. 但 30-star + 用户反馈有效，给「无因果证据」打了一个现实补丁。**
学术界没有 RCT，但有 30+ 人用脚投票 + 口碑说有效——这是**真实但自选**的信号：说明 PACEflow 对一个小而真实的 niche 有 PMF。校准：① 自选偏差——会采用并留下来用严格流程工具的人，本就偏好纪律；② 分母未知——不知道多少人试了就走（=漏斗问题）。所以正确解读不是"已验证普适价值"，而是"**小而真实的 PMF + 漏斗受限**"。

**3. V/R 门和证据指向的"验证"不是一回事。**
HORIZON 推荐 agent 自主"执行期计划验证与修复"（验**内容**）；PACEflow V/R 门按自身设计"不做质量控制、只记录审计步骤已发生"（验**仪式**）。文献把收益归给"实质验证"，未必能被"强制走一遍仪式"捕获。**强制 ritual ≠ 捕获 benefit**——这是设计裂缝。

**4. 外部证据独立支持上一份优化评审的 C 档。**
SDD 文献的"按上下文匹配最小够用的严格度"、价值边界"原型→生产转换点"，逐字对应 `lite|full` 渐进档 + persona 定位。所以那个方向是**证据要求**的，不是锦上添花。

> 诚实定性：PACEflow 不是 snake oil（前提最被支持），但也不是已证明的普适胜利（疗效最薄弱）。诚实叙事应是"**针对已被证实的高代价失败类的纪律工具，最适合生产/协作/高风险场景**"，而非"让 AI 编码更好"的通用承诺。

---

<!-- 以下「经对抗验证的 findings」「被杀声明」「证据校准」「未解决问题」「来源」由 deep-research 输出 JSON 忠实生成，未经转写改写。 -->

## 经对抗验证的 9 条 findings（全文）

> 每条经 3 票对抗验证；`vote` 为票型；`诚实校准` 是验证 agent 主动标注的边界与不确定性。

### Finding 1　[置信度 high · 票型 3-0 (合并 claim 0,1,2)]

**声明**：AI 编码 agent 代码在真实世界被可测量地 revert，且 revert 的主因是范围/质量类失败（过度工程、非预期副作用）而非纯功能 bug——这正是强制规划/获批门旨在拦截的失败类。

**来源**：
- https://2026.msrconf.org/details/msr-2026-mining-challenge/27/When-AI-Code-Doesn-t-Stick-An-Empirical-Study-on-Reverted-Changes-Introduced-by-AI-C

**证据与诚实校准**：MSR 2026 Mining Challenge 同行评审论文《When AI Code Doesn't Stick》分析 33,580 个 agentic PR / 86,315 commit（Claude/Copilot/Cursor/Devin/Codex 五系统）：2.66% 的 agentic PR 含至少一个 reverting commit（按 agent 0.7% Codex 到 7.6% Copilot）。对 500 个 revert 的人工分类显示首因为'非预期副作用与过度工程'(22.33%)、'功能不正确'(22.13%)、'代码质量问题'(17.71%)、'依赖管理'(12.47%)。论文自身结论：'AI coding agents struggle primarily with scope management and contextual understanding, rather than purely functional defects.' 三票一致确认逐字属实。关键诚实校准：(a) 2.66% 基率本身偏低，不能据此宣称'AI agent 严重失败'；(b) 前两类差距仅 0.2pp（22.33% vs 22.13%），功能 bug 实际近乎并列第一，'主要是非功能问题'是作者措辞而非显著分离；(c) 论文证明这些失败模式存在，但未测试规划门能减少它们——'流程门旨在拦截'是研究问题方的框架而非论文发现。

### Finding 2　[置信度 high · 票型 claim 3 为 2-1，claim 4 为 3-0]

**声明**：规划缺陷（尤其子规划错误）、内存限制、灾难性遗忘是跨域反复出现的真实失败类，且学界推荐的对策是'执行期计划验证/修复 + 重新浮现长程约束的记忆机制'而非堆更强的基座模型——与 PACEflow 的验证门和上下文重注入属同一干预类。

**来源**：
- https://arxiv.org/html/2604.11978v1

**证据与诚实校准**：arXiv:2604.11978v1《The Long-Horizon Task Mirage?》(UW-Madison/Berkeley/Georgia Tech, 2026-04) 用 HORIZON benchmark 跑 3,100+ 条 GPT-5/Claude-4 轨迹，覆盖 Web/OS/Embodied/Database 四域，LLM-as-Judge 对人工标注 κ=0.84。逐字：'planning-related failures (especially subplanning errors), memory limitation, and catastrophic forgetting account for a substantial portion of failed trajectories across domains.' 第5节逐字推荐：'future agentic AI systems should emphasize hierarchical subplanning, execution-time plan verification and repair, and memory mechanisms that preserve and re-surface long-range constraints'，并明确'improving base-model capability alone is unlikely to fully address these failures.' 独立佐证：arXiv:2511.04064 报告需求遗漏占任务规划失败 27.9%。两条重要保留：(1) HORIZON 测的是通用 agent 而非编码 agent，编码覆盖极少；(2) 论文的'execution-time plan verification and repair'指 AGENT 自主对环境反馈验证并自修复——而 PACEflow 的 V 阶段是只记录'验证步骤已发生'的 deny-hook 流程纪律门（其自身设计注明'不做质量控制'），二者只是同一干预'类'，不是同一机制。该论文支持'失败模式真实+反复'的窄主张，但不支持'确定性流程门能修复它们'的强主张。

### Finding 3　[置信度 high · 票型 claim 7,17 为 3-0；claim 18 为 2-1（合并）]

**声明**：软提示/指令遵守是不完美、可测量的能力而非保证行为：基准与大规模研究均显示遵守率远低于 100%，且实践者直接报告 CLAUDE.md 被系统性忽略——支撑'CLAUDE.md 软指令无法保证流程合规'的前提。

**来源**：
- https://arxiv.org/pdf/2311.07911
- https://dev.to/minatoplanb/i-wrote-200-lines-of-rules-for-claude-code-it-ignored-them-all-4639
- https://docs.anthropic.com/en/docs/claude-code/hooks-guide

**证据与诚实校准**：IFEval (arXiv:2311.07911, Google Research)：'very few instructions are 100% verifiable objectively'，实测 GPT-4 严格 prompt-level 准确率 76.89%、PaLM 2 S 43.07%；论文明确目的是'分析哪些指令类型通常不被遵守'。实践者一手报告 (dev.to, 2026-03)：200+ 行 CLAUDE.md '每个 session 加载进上下文……我能读到，我只是不遵守它'，并有重复同一已记录错误的案例；被 anthropics/claude-code GitHub issues #15443/#19471/#36573/#32163 等独立佐证（#32163 是'用代码硬强制 CLAUDE.md'的功能请求）。Anthropic 官方文档证实二分法：hooks'提供对 Claude Code 行为的确定性控制，确保某些动作总是发生而非依赖 LLM 选择去做'。诚实校准：IFEval/dev.to 均未提 CLAUDE.md 或流程合规，'软指令→流程合规'是合理但属推断的桥接；dev.to 的'规则是请求、hook 是法律'是绝对化修辞——真实遵守率约 70-90% 而非字面归零，且 prompt 型 hook 仍路由 LLM、对判断任务并非 100% 确定。

### Finding 4　[置信度 medium · 票型 3-0 (合并 claim 15,16)]

**声明**：在 LLM 系统架构层面，软 harness（prompt 模板/重试/路由）能提升答案质量但无法保证输出满足下游硬约束；enforcement-first 架构把模型输出默认视为不可信、必须满足显式约束才放行——这是 PACEflow hook 层 deny 门拦截工具调用的概念同构。

**来源**：
- https://bh3r1th.medium.com/from-harness-to-enforcement-designing-deterministic-guardrails-for-llm-systems-6a9912ba7eba
- https://genai.owasp.org
- https://www.vldb.org/pvldb/vol18/p4073-lee.pdf

**证据与诚实校准**：Medium 博客逐字：'Harnesses help you get better answers. They do not guarantee that the answers meet the constraints your downstream systems depend on'；'retries are fundamentally probabilistic... This is not reliability. It is statistical hope'；'In an enforcement-first system, model output is treated as untrusted by default. Every response must satisfy explicit constraints before it is allowed to pass through.' 博客本身是单篇个人观点（弱源），但底层原则有权威一手佐证：OWASP GenAI Top 10 LLM05'把 LLM 所有输出当作不可信用户输入'；VLDB 2025 同行评审《Semantic Integrity Constraints》；约束解码文献（arXiv:2501.10868/2502.14905）证明 prompting'不提供保证'而生成期强制'按构造保证 100% schema 遵守'，且各大厂均已上线约束解码本身即'软提示无法保证约束'的行业证明。诚实校准：博客讲的是 LLM 输出/schema 约束，PACEflow 讲的是 agent 工作流/流程合规，桥接是机制类比；该原则限定的是'何时'有益（不能阻止全部越狱、增延迟），不否定核心原则。

### Finding 5　[置信度 high · 票型 3-0]

**声明**：门控/强制序列化的工作流是 GitHub/Microsoft 主推的行业模式而非 PACEflow 独有：Spec Kit 把 SDD 落地为 Specify→Plan→Tasks 三个必须按序完成的显式门控阶段，结构上类似 PACEflow 的 P-A-C-E 强制流程。

**来源**：
- https://github.com/github/spec-kit/blob/main/spec-driven.md
- https://developer.microsoft.com/blog/spec-driven-development-spec-kit
- https://visualstudiomagazine.com/articles/2025/09/16/github-spec-kit-experiment-a-lot-of-questions.aspx

**证据与诚实校准**：官方 github/spec-kit 仓库描述为'a sequential, gated development process with distinct phases that must follow a specific order'，并明确'Do not reorder or merge phases'。Microsoft Developer 博客逐字：'first, you create the spec with /specify. Then... /plan. Next... /tasks.' 三票一致确认。关键限定（claim 自身已含）：Spec Kit 的门控是'按约定/用户纪律'（无硬技术 deny），而 PACEflow 用 hook 层 deny——claim 只主张结构相似、不主张强制机制等价，因此成立。轻微时效：命令 2026 年演进为 /speckit.* 前缀并增加 constitution/clarify/implement 阶段，但 Specify→Plan→Tasks 门控序列仍是当前核心。

### Finding 6　[置信度 high · 票型 3-0 (合并 claim 5,6)]

**声明**：强制流程有明确的、被一手 RCT 证实的反面成本：资深开发者在熟悉仓库用 AI 反而慢 19%，且开发者无法可靠自评 AI 工作流真实效果（事前预期快 24%、亲历后仍以为快 20%，实测慢 19%）。

**来源**：
- https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- https://arxiv.org/abs/2507.09089
- https://metr.org/blog/2026-02-24-uplift-update/

**证据与诚实校准**：METR RCT (arXiv:2507.09089)：16 名资深开发者、246 个真实 backlog issue 随机分配 AI-allowed/disallowed，仓库平均 22k+ star / 1M+ LOC。逐字：'When developers are allowed to use AI tools, they take 19% longer to complete issues—a significant slowdown that goes against developer beliefs and expert forecasts'；'developers forecast... reduce completion time by 24%... estimate... reduced by 20%... actually increases... by 19%.' 三票一致。诚实校准：(a) 慢 19% 这个量级有争议且高度上下文绑定（成熟开源、高质量门、n=16），不应外推为'AI 普遍拖慢开发者'，claim 措辞正确限定为'早期-2025 AI'与'感知-现实差距'；(b) 置信区间宽 (+2% 到 +39%)；(c) METR 2026-02 更新未撤回该发现，仅说选择效应现在掩盖了提速信号。这直接支撑研究问题④的反面成本与⑤'开发者无法自评 ROI'。

### Finding 7　[置信度 high · 票型 3-0 (合并 claim 8,9,13,14)]

**声明**：规格严格度/流程强制对单人、短命、抛弃型、探索型项目是净负；正确边界是'按上下文匹配最小够用的规格严格度'而非一刀切的统一强制流程，价值边界落在'原型→生产'的转换点。

**来源**：
- https://arxiv.org/html/2602.00180v1
- https://www.infoworld.com/article/4166817/vibe-coding-or-spec-driven-development-how-to-choose.html

**证据与诚实校准**：arXiv:2602.00180v1《Spec-Driven Development》(Piskala, 2026-01-30) 逐字：'Throwaway prototypes don't justify spec investment that will be discarded. Solo, short-lived projects may find the overhead exceeds benefits when there's only one developer'；'Exploratory coding suffers from premature specification that constrains learning'；Golden Rule: 'Use the minimum level of specification rigor that removes ambiguity for your context.' InfoWorld（具名专家 Ayaz Ahmed Khan）：'Vibe coding to explore and prototype, and spec-driven development with AI to harden and ship'；'Spec-driven preserves discipline but adds overhead.' 多源独立佐证（Augment Code/IBM/LeanSpec/DORA 2025）一致主张按上下文匹配严格度、警惕过度规格化 ceremony；DORA 报告记录全门控 SDD 增加 20-40 分钟开销、'明确不适合快速 bugfix、单文件脚本、抛弃型原型'。诚实校准：源含 arXiv 预印本（非同行评审）与实践者综合，但 claim 是温和的方向性/规范启发而非异常实证主张，且被广泛非冲突佐证；无源量化盈亏平衡点。这是反对'统一确定性流程门作为默认'的最强证据。

### Finding 8　[置信度 medium · 票型 2-1]

**声明**：AI agent 在长 session 中丢失计划，因为计划只活在上下文窗口、随窗口填满与 context rot 而退化——这是 PACEflow 持久化 artifact 所针对的'丢上下文/中途迷路'失败模式的直接证据。

**来源**：
- https://www.augmentcode.com/guides/the-80-percent-problem-ai-agents-technical-debt
- https://trychroma.com/research/context-rot
- https://github.com/OthmanAdi/planning-with-files

**证据与诚实校准**：源（Augment Code, 2026-04, 厂商营销）逐字：'the plan exists only in the context window. As the window fills and context rot in long agent sessions progresses, the plan degrades or disappears.' 机制由一手研究独立佐证：Chroma《Context Rot》测 18 个前沿模型全部随输入增长退化（50K token 即可见 rot）；Stanford lost-in-the-middle 显示中段准确率掉 >30%。多源记录具体失败模式（'到第 40 条消息 agent 已忘了第 5 条说什么'）；文献处方恰是 PACEflow 设计——把计划状态外化/持久化到磁盘（'把上下文窗口当 RAM、文件系统当 disk'）。弱点：被引源是厂商营销且只引 arXiv 而无原始数据（导致 2-1 分歧），但底层机制由可复现一手研究证实，故弱源不构成对核心主张的否定。

### Finding 9　[置信度 medium · 票型 2-1]

**声明**：Microsoft/GitHub 主动预先回应了'过度工程/官僚摩擦'的反对，其首席产品工程师声明 SDD 不是穷尽式需求文档、不是瀑布规划、不是拖慢团队的官僚——承认这些是结构化流程工具公认的失败模式。

**来源**：
- https://developer.microsoft.com/blog/spec-driven-development-spec-kit
- https://visualstudiomagazine.com/articles/2025/09/16/github-spec-kit-experiment-a-lot-of-questions.aspx

**证据与诚实校准**：Den Delimarsky（GitHub/Microsoft 首席产品工程师）官方博客逐字：'Spec-Driven Development, or SDD, is not about writing exhaustive, dry requirements documents that nobody reads. It's also not about waterfall planning... And it's definitely not about creating more bureaucracy that slows engineering teams down.' 核心限定（claim 已含）：这只证明 GitHub 在营销话术上修辞性地预先回应了反对，不是 SDD 在实践中真正避免了官僚的证据。claim 是描述性的（'该工程师声明 X'），事实准确，未做'SDD 实际成功避免官僚'的更强主张。

## 对抗验证中被「杀掉」的声明（诚实度硬证据）

> 这些声明未通过 2/3 反驳门槛而被剔除。注意：试图建立「结构化流程 → 改善结果」因果链的声明几乎全军覆没——这是「这类工具普遍缺因果验证」的直接体现。

- **[0-3]** Process-level failures (environment disturbance, instruction errors, planning errors, history error accumulation) account for 72.5% of all agent failures, while design-level failures (catastrophic forgetting, memory limits, false assumptions) account for 27.5% — empirically validating that the failure modes PACEflow targets (skipping/wrong planning, losing context) are the dominant ones.
  - 源：https://arxiv.org/html/2604.11978v1
- **[0-3]** Empirical evidence for spec-driven development is admittedly nascent, with controlled studies showing human-refined specs reduce LLM-generated code errors by up to 50%.
  - 源：https://arxiv.org/html/2602.00180v1
- **[1-2]** Prompt/instruction-based context guidance is empirically unreliable: an ETH study found LLM-generated context files reduced task success rates by 3% versus no context file while raising inference cost over 20% — supporting the case that soft instructions (CLAUDE.md-style) are not a guaranteed win.
  - 源：https://www.augmentcode.com/guides/the-80-percent-problem-ai-agents-technical-debt
- **[0-3]** Structured, per-repository operating manuals materially reduced context-drift-driven failures: mabl reported context drift caused ~40% of task failures before remediation, dropping to under 5% after introducing per-repository manuals — evidence that durable structure (vs ephemeral context) improves outcomes.
  - 源：https://www.augmentcode.com/guides/the-80-percent-problem-ai-agents-technical-debt
- **[1-2]** Lightweight/unstructured AI coding is appropriate where defect blast radius is small (internal tools, first POCs), implying structured process is negative-ROI overhead in those contexts.
  - 源：https://www.infoworld.com/article/4166817/vibe-coding-or-spec-driven-development-how-to-choose.html
- **[1-2]** Retrying/re-prompting an LLM is not a reliability mechanism but 'statistical hope' — it does not fix the underlying failure mode, paralleling the argument that re-instructing an AI via system prompts does not deterministically enforce a workflow.
  - 源：https://bh3r1th.medium.com/from-harness-to-enforcement-designing-deterministic-guardrails-for-llm-systems-6a9912ba7eba

## 证据基的结构性校准（caveats）

证据基础有结构性不对称，使用时需诚实校准：(1) 机制证据 vs 因果证据的鸿沟——所有支撑 PACEflow 前提的证据都证明"目标失败类真实存在"（范围/上下文失败、软指令不可靠、计划丢失），但没有任何研究直接测量"PACEflow 式确定性流程门能降低 revert 率/提升交付质量"。从"失败类真实"到"流程门有效"是机制类比，不是因果证明。值得注意：被反驳的 claim 之一（HORIZON 的 72.5% 过程级失败占比 0-3 票否决）以及"规格能降错误 50%"(0-3 否决)、"per-repo manual 把漂移从 40% 降到 5%"(0-3 否决) 都未通过对抗验证，说明"结构化流程改善结果"的因果链最薄弱。(2) HORIZON 论文的对策本意是 AGENT 自主自修复（hierarchical subplanning + execution-time repair），而 PACEflow 的 V/R 门按其自身设计"不做质量控制、只记录审计步骤"——这是同一干预"类"但不同机制，论文实际不背书 human-in-the-loop 流程门。(3) 量级争议：MSR revert 基率仅 2.66%（前两类差距 0.2pp，功能 bug 近乎并列第一）；METR 慢 19% 的量级高度上下文绑定（n=16、成熟开源、宽 CI），不可外推为普遍真理。(4) 弱源依赖：context rot 失败模式与 enforcement-first 架构的直接引用来自厂商营销（Augment）与单篇 Medium 博客，虽有 Chroma/Stanford/OWASP/VLDB 一手佐证机制，但这两条 claim 各有一票反对（2-1）。(5) 桥接推断：IFEval/Medium 博客均未提 CLAUDE.md 或工作流合规，"软指令→流程合规"的映射是合理但属研究问题方的推断。(6) 时效：Spec Kit 命令已演进（/speckit.* 前缀、新增 constitution/clarify 阶段），METR 有 2026-02 后续更新（未撤回但重新限定范围）。

## 仍未解决的问题（证据真空区）

- 是否存在直接的对照研究/RCT 测量确定性流程门（hook 层 deny 强制 P-A-C-E-V-R）对 AI 编码产出质量、revert 率或交付速度的因果效应？现有全部证据只证明目标失败类真实存在，没有一条测量了 PACEflow 这一类干预的实际效果，因果链缺失。
- 确定性流程门的盈亏平衡点在哪里量化？SDD 文献给出定性边界（单人/短命/抛弃型为净负，多人/长生命周期/生产为正），但无源量化触发正 ROI 所需的项目规模、协作人数、维护周期或单次改动复杂度阈值。
- PACEflow 的 V/R 门只'记录审计步骤已发生'而'不做质量控制'，与 HORIZON 论文推荐的'agent 自主执行期计划验证/修复'是否会产生效果落差？记录步骤发生 vs 实质验证内容，对真实失败拦截率的差异未知。
- 在 Claude Code 具体生态下，hook 层 deny 的强制相比 CLAUDE.md 软指令的边际改进有多大？现有遵守率数据（IFEval 76.89%、大规模 43.7%）来自通用 LLM 基准，缺少针对 Claude Code agent 工作流场景、对比'有 hook 门'与'仅 CLAUDE.md'两组的实测合规率/产出对比。

## 全部来源（23）

1. https://2026.msrconf.org/details/msr-2026-mining-challenge/27/When-AI-Code-Doesn-t-Stick-An-Empirical-Study-on-Reverted-Changes-Introduced-by-AI-C
2. https://arxiv.org/html/2604.11978v1
3. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
4. https://github.com/anthropics/claude-code/issues/45427
5. https://arxiv.org/pdf/2311.07911
6. https://www.augmentcode.com/guides/the-80-percent-problem-ai-agents-technical-debt
7. https://bh3r1th.medium.com/from-harness-to-enforcement-designing-deterministic-guardrails-for-llm-systems-6a9912ba7eba
8. https://dev.to/minatoplanb/i-wrote-200-lines-of-rules-for-claude-code-it-ignored-them-all-4639
9. https://www.dotzlaw.com/insights/claude-hooks/
10. https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html
11. https://claude-codex.fr/en/advanced/methodologies-ecosystem/
12. https://claudelog.com/mechanics/plan-mode/
13. https://www.timchao.site/en/articles/sdd-tools-comparison-speckit-openspec-superpowers
14. https://isoform.ai/blog/the-limits-of-spec-driven-development
15. https://www.augmentcode.com/blog/what-spec-driven-development-gets-wrong
16. http://arcturus-labs.com/blog/2025/10/17/why-spec-driven-development-breaks-at-scale-and-how-to-fix-it/
17. https://visualstudiomagazine.com/articles/2025/09/16/github-spec-kit-experiment-a-lot-of-questions.aspx
18. https://ranthebuilder.cloud/blog/i-tested-three-spec-driven-ai-tools-here-s-my-honest-take/
19. https://www.augmentcode.com/tools/best-spec-driven-development-tools
20. https://www.augmentcode.com/guides/vibe-coding-vs-spec-driven-development
21. https://dev.to/incomplete_developer/openspec-spec-driven-development-failed-my-experiment-instructionsmd-was-simpler-and-faster-3a5d
22. https://www.infoworld.com/article/4166817/vibe-coding-or-spec-driven-development-how-to-choose.html
23. https://arxiv.org/html/2602.00180v1

---

_本文证据由后台 deep-research Workflow（run `wf_bfc42b13-db8`）生成；结论综合与批判性判断由主 session 回证据核验后撰写。证据为 2026-06 联网快照，arXiv 预印本以 v1 为准。_
