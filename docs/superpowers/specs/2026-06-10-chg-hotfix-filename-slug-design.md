# CHG/HOTFIX 文件名 slug — 设计文档

> **状态**：设计（pre-implementation，2026-06-10）。尚未实现，勿当现行行为。
> **背景**：CHG/HOTFIX 详情文件名是 `chg-yyyymmdd-nn.md`（无描述性 slug），而 finding（`finding-yyyy-mm-dd-slug.md`）/ correction（`correction-yyyy-mm-dd-nn-slug.md`）有 slug。用户希望 CHG/HOTFIX 文件系统层也自描述（`changes/` 目录 `ls` 时一眼看出内容）。

## 1. 目标

CHG/HOTFIX 详情文件名追加描述性 slug（`chg-yyyymmdd-nn-slug.md`），对称 finding/correction 的「稳定 ID + slug 文件名」范式。只补**文件系统层**可读性；frontmatter ID / wikilink / 索引行标题全部不变。

## 2. 范围决策（brainstorm 已定）

- **B（只文件名带 slug）**：wikilink 保持纯 ID `[[chg-yyyymmdd-nn]]`。因为索引行标题已含描述（`- [x] [[chg-id]] 注入/文案一致性横向核查 ... #change ...`），wikilink 再带 slug 是冗余。这避开了 A 方案最麻烦的 `parseChangeIndex` ID 提取改造。
- **A（旧 CHG 不迁移）**：glob `chg-id*.md` 同时匹配旧 `chg-20260101-01.md` 和新 `chg-20260101-01-slug.md`，新旧共存零冲突。旧 CHG 多已归档、不常 `ls`，YAGNI。

## 3. 架构：稳定 ID 与文件名解耦

| 维度 | 值 | 是否变 |
|---|---|---|
| frontmatter ID | `CHG-YYYYMMDD-NN` | 不变（稳定锚，所有 `update-chg target=` / `close-chg` / wikilink 引用不变） |
| 文件名 | `chg-yyyymmdd-nn-slug.md` | **加 slug** |
| wikilink | `[[chg-yyyymmdd-nn]]` | 不变（纯 ID） |
| 索引行标题 | `[[id]] 标题描述 #change ...` | 不变（已有描述） |
| ID→文件解析 | `detailPathForId` | **精确拼接 → glob** |

CHG 的可读性分两层：**索引层**（task.md/impl_plan/walkthrough，靠 wikilink 旁标题，早已解决）和**文件系统层**（`changes/` 目录文件名，本设计补的）。本设计只动文件系统层。

## 4. 组件（3 处改动）

1. **`change-id.js` `detailPathForId`**：当前精确拼接 `${id}.md`（change-id.js:8-15）。改为：加 `require('fs')`，先试精确 `chg-yyyymmdd-nn.md`（旧无 slug 文件命中即返回），不存在则 `readdirSync(changes/)` 找 `chg-yyyymmdd-nn` 开头 + `.md` 结尾的文件（新带 slug）。都没有则回退精确路径（让 `readChangeDetail` 的 readFileSync 走 missing 分支，fail-safe）。
2. **`locks.js` `reserveArtifactIds`**：CHG/HOTFIX 分支（locks.js:701-703）`fileRel`（精确 `chg-id.md`）→ `filePrefix`（`chg-id-`，带 slug 占位）+ `reservationMatchesArtifactRel`（735-738）改前缀匹配。**`reserve-artifact-id.js` 自动跟随**——`formatReservationBlock`(95-98) 已把 `filePrefix` 输出成 `reserved-file-prefix`、`reservationConsumed`(55-63) 已处理 `filePrefix`，无需改。抄 correction 分支（locks.js:716-718）。
3. **create-chg instruction（artifact-writer）**：按 title 生成 slug（抄 finding/correction 的 slug 生成——中文 title 语义概括为英文 kebab-case），文件名 `chg-yyyymmdd-nn-slug.md`，frontmatter ID 仍 `CHG-YYYYMMDD-NN`，索引行 wikilink 仍 `[[chg-yyyymmdd-nn]]`（纯 ID）。

**不动**：`parseChangeIndex`（wikilink 仍纯 ID，ID 提取逻辑不变）、`slugForChangeId`（wikilink 仍纯 ID）、wikilink 生成、索引行标题。

## 5. 关键实现点

- **glob 唯一性**：`nn` 是两位数，文件名 `chg-yyyymmdd-nn` 后只能跟 `-`（带 slug）或 `.md`（无 slug），不会误匹配 `chg-yyyymmdd-nnn`（`nn` 无三位）。正常一个 ID 一个文件，glob 取唯一匹配；若异常多匹配，取第一个 + log 警告（不静默歧义）。
- **slug 生成**：由 artifact-writer 按 title 生成英文 kebab-case slug（中文 title 语义概括成英文，与 finding/correction 现有行为一致——如 finding-2026-06-10-sessionstart-injection-quality-fixes 的 slug 即中文 title 的英文概括）。slug 长度、去特殊字符规则抄 finding/correction。
- **HOTFIX 同样处理**：`hotfix-yyyymmdd-nn-slug.md`；`detailPathForId` 正则已含 `hotfix-`（change-id.js:11），glob 同理。
- **向后兼容**：旧 `chg-id.md`（无 slug）被精确分支命中，glob 分支只在精确不存在时跑，新旧共存零冲突，不迁移。

## 6. 测试

- `detailPathForId` glob（单测）：① 旧 `chg-id.md` 找到 ② 新 `chg-id-slug.md` 找到 ③ ID 大小写归一 ④ 不误匹配相邻序号 ⑤ 多匹配取第一 ⑥ 都不存在回退精确路径
- reserve CHG/HOTFIX 输出 `reserved-file-prefix` 含 `<slug>`（e2e/agent test）
- create-chg 生成带 slug 文件名 + frontmatter ID 仍纯 ID + 索引 wikilink 仍纯 ID（agent test）
- **兼容回归**：现有 `chg-id.md` 仍被 `readChangeDetail` 找到（不退化）

## 7. 实现分期

单个 CHG（小改动，3 处 + 测试）：
- T-1：`detailPathForId` 改 glob（+ 兼容/边界单测）—— 核心，可独立验证（新旧都能找到）
- T-2：reserve-artifact-id.js CHG/HOTFIX → `reserved-file-prefix`
- T-3：create-chg instruction：artifact-writer 按 title 生成 slug + 文件名
- T-4：e2e/agent test 验证 create-chg 产出带 slug 文件 + 兼容回归

## 8. 向后兼容

- 稳定 ID `CHG-YYYYMMDD-NN` 不变 → `update-chg` / `close-chg` / `archive-chg` 的 `target` 引用全不受影响。
- wikilink 纯 ID 不变 → task.md/impl_plan/walkthrough 现有索引行、`parseChangeIndex`、归档移动逻辑全不受影响。
- 旧 CHG 文件不迁移，glob 兼容。
- `detailPathForId` 是唯一 ID→文件解析点（已 grep 确认），改它一处即全局兼容。

## 9. 安全说明

纯命名改进，不动门控 / 状态机 / 批准验证逻辑。`detailPathForId` glob 失败回退精确路径（fail-safe，等价旧行为）。最坏失败是「带 slug 新文件没找到」→ 回退精确路径 → readFileSync missing → `readChangeDetail` 返回 `{missing:true}`（现有 missing 处理路径），不崩溃、不误判。`readdirSync` 失败（目录不存在）被 try-catch 兜住。
