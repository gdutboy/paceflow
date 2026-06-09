# SessionStart 注入质量修复 — 设计文档

> **状态**：设计（pre-implementation，2026-06-10）。尚未实现，勿当现行行为。
> **背景**：本会话 SessionStart 注入审计发现的**内容质量**问题，独立于激活 UX 重构。
> **姊妹 change-set**：激活 UX 重构（`docs/superpowers/specs/2026-06-09-paceflow-activation-ux-design.md`）——P0 code-count 静默锁定 / F1 逃生口 / F2 superpowers / pre-tool-use lookahead / P0-激活 在那个文档，本文档不重复。

## 1. 背景与范围

本会话审计 SessionStart 注入，问题分两类：
- **激活 / 失败面**（弱信号倒挂、逃生口缺失）→ 已形成「激活 UX 重构」spec + plan。
- **注入内容质量**（本文档）：注入了过时 / 错误 / 冗余的内容，或该注入的内容退化。共 9 项 + 3 个结构性根因，独立于激活重构。

两个 change-set 无依赖冲突：激活重构动 `isPaceProject` / `pre-tool-use` / W11 / helper / command；本 change-set 动 `layers.js`（注入渲染）/ `collect-state.js`（git 收集）/ `bump-version.js` / vault `spec.md`。可并行或顺序执行。

## 2. 问题清单（根因 + 修法 + 是否已查证确认）

### 2.1 时效漂移（注入了过时内容）

| ID | 问题 | 根因 | 修法 | sev |
|---|---|---|---|---|
| **E1** | spec 注入版本 `v6.5.0`（真实 6.5.1） | **存量**：vault `spec.md` 未 bump；**结构性**：`bump-version.js:86-124` 只同步 repo 5 文件，从不含任何 spec.md | 存量：主 session Edit vault `spec.md`；结构性：① bump 加 vault spec.md 同步（难——各用户 vault 路径不同），或 ② spec.md 不写死版本号（推荐，去掉「当前版本 X」表述，版本以 plugin.json 为单一权威） | 🔴高 |
| **E2** | 唯一 `[ ]` finding 是已完成 backlog | **存量**：`injection-wrap-backlog` 没标 `[x]`；**结构性**：finding 完成状态无维护机制（backlog 做完没流程标 `[x]`） | 存量：派 artifact-writer `update-finding` 标 `[x]`；结构性：评估 close-chg 时提示检查关联 finding，或周期性清理（YAGNI 待定） | 🔴高 |

### 2.2 死逻辑（截断写了但不生效）

| ID | 问题 | 根因 | 修法 | sev |
|---|---|---|---|---|
| **E3** | `truncateSpec` 对真实标题失效，spec 全文注入 | `SPEC_OMIT_SECTIONS = ['目录','依赖列表']`（layers.js:614）精确匹配，真实标题是 `## 目录结构`（≠`目录`）、无独立 `## 依赖列表` → dropRanges 恒空 → 原样返回全文 | 改前缀匹配（`startsWith`）或更新表为真实标题；**并核对 `plugin/hooks/templates/spec.md` 模板标题是否同病**（影响新用户首次注入） | 🟡中低 |

### 2.3 对称 / 退化（该注入的少注入了）

| ID | 问题 | 根因 | 修法 | sev |
|---|---|---|---|---|
| **N1** | compact 比 startup 少注入相关知识（5→3）、thoughts（3→2） | `renderRelatedNotes`（layers.js:951-953）`compact?2:3` 硬编码——单 hook 时代 compact 走快照恢复、精简为省快照体积；M4 退役快照后该约束消失，精简名额却原样保留成无主残留 | 去掉 `compact?2:3` 三元，compact 名额统一到 startup（wiki 3 / knowledge 2 / thoughts 3）；补 startup/compact **注入内容逐项相等**对称测试（原对称测试只验在场不验数量）| 🔴高 |
| **M1** | git 段只有分支+commit，缺 A2（脏文件 / ahead-behind） | `collectGit`（collect-state.js:272-281）+ `renderGit`（layers.js:934-936）从未实现 design §5 A2 | `collectGit` 加 `git status --porcelain`（脏文件数）+ `rev-list --count`（ahead/behind）；`renderGit` 渲染。子进程沿用现有 `timeout` 保护 | 🟡中 |
| **M2** | walkthrough 注入 3 条，design L0 说 10 条 | `WALK_KEEP=3`（layers.js:366）M3 有意收紧体积，与 design L0「10 条」冲突 | `WALK_KEEP` 回 **10**（用户裁定）；design L0 已是 10，实现对齐即可 | 🟡中低 |

### 2.4 冗余 / cosmetic

| ID | 问题 | 根因 | 修法 | sev |
|---|---|---|---|---|
| **C2** | 活跃 CHG 摘要 `status` 字段渲染原始引号 | `renderActiveChangeSummary`（layers.js:725）`status=${s.status}` 未过 `normalizeFrontmatterStatus`（`category` 已归一化、是权威，故仅 cosmetic） | `status` 也归一化（与 `category` 同源）；create-chg 默认写无引号，仅手动加引号才显形 | 🟢低 |
| **E4** | core 段「项目上下文」与「Artifact 目录」段重复 artifact 路径 | A4 去重未做透（旧单 hook 版就有，preexisting） | 合并 / 精简「Artifact 目录」段（路径已在项目上下文段出现一次） | 🟢低 |
| **F3** | 有 vault 机器新项目 root 默认指 vault | `getArtifactDir`（pace-utils.js:528）对新项目默认 vault → 注入 Artifact Root 显示 vault 路径（被 artifact-root choice 门挡住静默写入，非污染，是默认值偏向 + 注入误导） | 新项目无显式选择时默认偏 local；与激活重构 `/paceflow enable` 选 root 流程协调（enable 时才定 root） | 🟢低-中 |

## 3. 立即修 vs CHG 修

- **立即修（存量时效，不用等 CHG）**：
  - E1 存量：主 session Edit vault `spec.md`，`v6.5.0` → `v6.5.1`（spec.md 是主 session 权限例外）
  - E2 存量：派 artifact-writer `update-finding` 把 `injection-wrap-backlog` 标 `[x]`
- **CHG 修（代码 + 测试）**：N1 / M1 / M2 / E3 / E4 / C2 / F3 + E1 结构性 + E2 结构性

## 4. CHG 分期（建议，可按偏好调粒度）

| CHG | 内容 | 闭环主题 |
|---|---|---|
| **IQ-1** | N1 compact 对称 + M2 walkthrough 回 10 + M1 git A2 | 注入完整性（该注入的注全）|
| **IQ-2** | E3 truncateSpec 前缀匹配 + 模板 spec.md 核对 + E4 去重 + C2 引号归一 | 注入精度（截断/渲染对真实产物生效）|
| **IQ-3** | E1 结构性（spec.md 去版本号硬编码）+ E2 结构性（finding 维护）+ F3 root 默认偏 local | 漂移防治（结构性根因）|

## 5. 共性根因（贯穿多项）

多项问题（E1 spec 版本 / E2 finding 状态 / E3 标题匹配 / F3 root 默认）共享一个模式——**代码/注入假设的状态 vs 真实产物状态脱节**（spec-not-product-source-of-truth）：E3 代码写 `'目录'`、产物是 `'目录结构'`；E1 代码不同步 spec.md、产物漂移；N1 约束移除后代码残留。修复时不仅改具体值，还要消除「代理信号 ≠ 真实状态」的结构（如 E1 去版本号硬编码、E3 改匹配方式），否则同类漂移会复发。

## 6. 安全说明

本 change-set 全部是注入内容质量修复，**不动门控逻辑、不新增 deny 路径**。最坏失败是「注入仍不理想」，不阻断开发、不毁 artifact。N1/M1/M2 改注入渲染（layers.js 纯函数，可 fixture 单测）；E1/F3 改默认值/同步；E3/E4/C2 改截断/渲染精度。逐项 TDD + 注入层纯函数测试。
