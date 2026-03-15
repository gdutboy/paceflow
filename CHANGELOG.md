# Changelog

## v5.1.3 (2026-03-15)

> **2 个修复**（HOTFIX-20260315-04, HOTFIX-20260315-05），**5 文件**，T-487 ~ T-489（3 个任务）

### 概览

两个 HOTFIX 修复：审计 P0 修复（config-guard 缺 return 等 6 处）和 compact recovery 事件类型检测失败的根因修复。后者是自 v4.5.0 引入 compact 恢复功能以来一直存在的 bug。

---

### 🐛 Bug 修复

#### compact recovery 事件类型检测失败 (HOTFIX-20260315-05)
- **根因**：`parseHookStdin` 读取 `parsed.type` 但 CC SessionStart stdin 使用 `source` 字段传递事件类型（`startup`/`resume`/`clear`/`compact`）
- **影响**：compact 恢复路径（G-9 清单注入、格式参考恢复、快照消费）从 v4.5.0 引入以来**从未正确触发**
- **修复**：`pace-utils.js:535` — `type: parsed.type || ''` → `type: parsed.source || parsed.type || ''`（`source` 优先，兼容旧 `type` 字段）
- **新增测试**：2 个单元测试（source 映射 + source 优先于 type）

#### 审计 P0 修复 6 处 (HOTFIX-20260315-04)
- `config-guard.js`：非 PACE 项目 early return 缺失（执行了不必要的逻辑）
- `REFERENCE.md`：`PACE_VERSION` / `FORMAT_SNIPPETS` / `createLogger` 3 处描述修正
- `CLAUDE.md`：版本号 2 处同步
- `README.md`：E2E 测试数量修正
- `templates/knowledge-note.md`：ISO 时间戳格式修正

---

### 🧹 仓库清理

- 移除误追踪的 `tests/test-pace-utils.js`（`.gitignore` 已排除，不应在 git 中）

---

### 🧪 测试

| 类别 | v5.1.2 | v5.1.3 | 变化 |
|------|--------|--------|------|
| 单元测试 | 73 | 75 | +2 |
| E2E 测试 | 67 | 67 | — |

---

### 完整变更列表

| CHG-ID | 类型 | 标题 | Tasks |
|--------|------|------|-------|
| HOTFIX-20260315-04 | fix | 审计 P0 修复 — config-guard return + 文档版本同步 + 模板时间戳 | T-487 |
| HOTFIX-20260315-05 | fix | compact recovery 事件类型检测失败 — `source` vs `type` 字段 | T-488~T-489 |

---

## v5.1.2 (2026-03-15)

> **5 个变更**（2 CHG + 3 HOTFIX），**14 文件**，**+1,459 / -83 行**，T-463 ~ T-484（22 个任务）

### 概览

Hook 消息质量全面审计与日志体系补全。核心改动：(1) 全 hook stderr/stdout 消息审计修复 34+18 项，消除模糊措辞和格式不一致；(2) Stop hook 场景感知消息（C 阶段/全阻塞/E 阶段分支）；(3) compact 恢复路径注入 G-9 完成检查清单；(4) 7 个 hook 文件补全 ENTRY/SKIP/PASS 结构化日志 34 处 + `logEntry()` 格式化函数。

---

### ⚡ 新功能

#### Hook 日志体系全面补全 (CHG-20260315-03)
- `pace-utils.js` 新增 `logEntry(hook, action, fields)` 格式化函数，输出 `act=X | proj=Y | dur=Zms` 结构化格式
- `MAX_LOG_SIZE` 从 512KB 提升到 1MB（全覆盖后每 session ~50KB，1MB 保留 ~20 session）
- 7 个 hook 文件补全 ENTRY/SKIP/PASS 日志共 34 处：`pre-tool-use.js`（7）、`post-tool-use.js`（4）、`session-start.js`（2）、`stop.js`（5）、`todowrite-sync.js`（6）、`config-guard.js`（5）、`pre-compact.js`（3）

#### compact 恢复 G-9 完成检查清单注入 (HOTFIX-20260314-03)
- `session-start.js` compact 恢复路径追加格式快速参考 + G-9 清单（4 步完成检查），弥补 compaction 后丢失的格式记忆

#### Stop hook 场景感知消息 (HOTFIX-20260314-02)
- 未完成任务消息分 3 个场景：C 阶段等待批准 / 全部阻塞 / E 阶段执行中
- 前缀注入 3 类：空 artifact / 有 findings / 正常收尾
- findings 过期提醒 + 无 artifact 消息改写

---

### 🐛 Bug 修复

#### Hook 消息审计 34 项修复 (HOTFIX-20260315-01)
- `FORMAT_SNIPPETS` 6 项：反引号转义、findings 格式补全索引+详情要求、walkthrough 详情含验证结果
- `stop.js` 10 处：stderr 措辞从"请确认/请检查"改为具体操作指引、L149 正则修正
- `session-start.js` 8 处：compact 桥接/降级/startup 消息反引号修正
- 其余 4 个 hook 8 处：TodoWrite 映射明确化、格式指引改善

#### Hook 消息审计 P2/P3 改进 18 处 (CHG-20260315-01)
- P2：`请确认/请检查` → 具体操作 5 处 + TodoWrite 映射明确化 6 处 + `FORMAT_SNIPPETS` import bug 修复
- P3：桥接/格式/修复指引 6 处

#### 审查修复 (HOTFIX-20260315-02)
- `findingsDetail` 从 3 个词扩展为 4 必须要素模板（现象+根因+影响范围+建议方案）
- S-2/S-3 compact 桥接追加"删除 .pace/current-native-plan"步骤（修复死循环风险）
- 死 snippet 清理 2 处（`walkthroughFormat`、`implDetailRule` 零引用移除）

---

### 📝 文档

#### Hook 消息参考文档 (新增)
- `docs/hook-messages-reference.md`：596 行完整消息参考，覆盖所有 hook 的 stderr/stdout/additionalContext 输出

---

### 🧪 测试

| 类别 | v5.1.1 | v5.1.2 | 变化 |
|------|--------|--------|------|
| 单元测试 | 73 | 73 | — |
| E2E 测试 | 67 | 67 | — |

---

### 完整变更列表

| CHG-ID | 类型 | 标题 | Tasks |
|--------|------|------|-------|
| HOTFIX-20260314-02 | fix | Stop hook stderr 场景感知消息改进 | T-463~T-466 |
| HOTFIX-20260314-03 | feat | compact G-9 完成检查清单注入 | T-469~T-470 |
| HOTFIX-20260315-01 | fix | Hook 消息审计 34 项修复 | T-471~T-475 |
| CHG-20260315-01 | improve | Hook 消息审计 P2/P3 改进 18 处 | T-476~T-479 |
| HOTFIX-20260315-02 | fix | 审查修复 — findingsDetail 增强 + 死 snippet 清理 | T-480~T-481 |
| CHG-20260315-03 | feat | Hook 日志体系全面补全 — logEntry + 7 hook 34 处日志 | T-482~T-484 |
| HOTFIX-20260315-03 | chore | v5.1.2 版本升级 + createLogger JSDoc 修正 | T-485 |

---

## v5.1.1 (2026-03-14)

> **1 个变更**（CHG-20260313-05），**~10 文件**，T-456 ~ T-461（6 个任务）

### 概览

ticket24 全面审查（5-agent 并行）发现的 15W+11I 全部修复。核心改动为共享函数提取（DRY）、死代码清理、Skill/模板文本修正、文档同步和 E2E 测试扩展。

---

### 🔧 代码质量

#### 共享函数提取 DRY 重构 (T-456)
- `pace-utils.js` 新增 `detectLegacyImplFormat(text)` + `extractNewlyCompletedChgs(oldString, newString)`
- 4 个调用方内联正则替换为共享函数调用：`pre-tool-use.js`（2 处）、`post-tool-use.js`（1 处）、`session-start.js`（1 处）

#### 死代码清理 3 处 (T-457)
- `pre-tool-use.js`：移除未使用的 `findMissingImplDetails` import
- `config-guard.js`：移除未使用的 `const fs = require('fs')`
- `stop.js`：移除 teammate 路径的 `additionalContext` JSON 输出（Stop hook 不支持 additionalContext）

---

### 📝 文档与模板

#### Skill/模板文本修复 3 处 (T-458)
- `pace-bridge/SKILL.md`：任务格式 `T-NNN:` 删除冒号，统一为 `T-NNN 描述`
- `hooks/templates/walkthrough.md`：注释示例补充验证结果 + 附带修复要素
- `pace-workflow/SKILL.md`：P 阶段降级条件补充「Superpowers 插件未安装」

#### REFERENCE.md 文档同步 6 项 (T-459)
- 模板数量 5→6、PostToolUse H12 补充、FORMAT_SNIPPETS 描述、单元测试 73/17 函数、E2E 67、新增 2 函数到函数表

---

### 🧪 测试

#### E2E 新增 3 测试 + test 24 修正 (T-460)
- test 62: walkthrough 智能截断（>10 行索引 → 省略旧记录）
- test 63: Correction 双写提醒（写入 `### Correction:` → knowledge 提示）
- test 64: findings 14 天过期（超期 finding → 过期提醒）
- test 24: 断言修正，与 T-457 死代码移除一致（stdout 为空而非 additionalContext）

| 类别 | v5.1.0 | v5.1.1 | 变化 |
|------|--------|--------|------|
| E2E 测试 | 64 | 67 | +3 |

---

### 📊 审计历史

| Ticket | 日期 | 原始发现 | 修复 | 误报率 |
|--------|------|----------|------|--------|
| ticket24 | 03-13 | 0C+0H+15W+11I | 26 项全修 | — |

---

### 完整变更列表

| CHG-ID | 类型 | 标题 | Tasks |
|--------|------|------|-------|
| CHG-20260313-05 | refactor | ticket24 审计修复 — 共享函数提取 + 死代码清理 + Skill/模板/文档同步 + E2E | T-456~T-461 |

---

## v5.1.0 (2026-03-13)

> **22 个变更**（15 CHG + 4 HOTFIX + 3 docs），**37 个文件**，**+2,436 / -1,494 行**，T-378 ~ T-455（78 个任务）

### 概览

从 v5.0.2 到 v5.1.0 是一次全面的内部重构与质量提升：Skills 从 6 合并为 5 并按 Progressive Disclosure 重写、归档机制从"移动内容"改为"移动标记"、所有 hook 统一 stdin 解析、SessionStart 注入量降低 57%、经历 4 轮完整审计（ticket17/18/21+22/23）修复累计 100+ 项发现。新增 `bump-version.js` 版本自动化、`test-install.js` 安装测试 21 项、`test-utils.js` 公共测试工具，单元测试从 51 增至 73，E2E 从 57 增至 64。

---

### 🏗️ 架构变更

#### Skills 架构重设计 (CHG-20260311-01)
- **6→5 Skills 合并**：`change-management` 合并入 `artifact-management`，消除独立 Skill 的维护负担
- 全部 Skill 按 **Skill Creator + Progressive Disclosure** 方法论重构：
  - `artifact-management`：266→135 行，提取 `references/format-reference.md` + `references/change-lifecycle.md`
  - `pace-workflow`：207→139 行，提取 `references/superpowers-integration.md`
  - `paceflow-audit`：473→110 行（**-77%**），提取 `references/agent-prompts.md` + `references/audit-procedures.md`
  - `pace-knowledge`：增强 2 个 SOP（创建笔记 + 提取知识）
  - `pace-bridge`：微调交叉引用
- `install.js` / `verify.js` 适配 `references/` 子目录 + 旧 `change-management/` 清理

#### 归档机制改造 (CHG-20260313-02)
- 归档操作从**"原子化单次 Edit 移动内容"**改为**"两步移动 ARCHIVE 标记"**
  - Step 1：在目标位置插入新 `<!-- ARCHIVE -->`
  - Step 2：删除旧 `<!-- ARCHIVE -->`
- 优势：Edit 范围更小、old_string 匹配更精确、不会误删相邻内容
- 同步更新 5 处文档源：`REFERENCE.md`、`format-reference.md`、`templates/task.md`、`SKILL.md`

#### 统一 stdin 解析 (CHG-20260309-05)
- `pace-utils.js` 新增 `parseHookStdin()` / `withStdinParsed()` / `parseStdinSync()` 三个函数
- 6 个 hook 入口从各自 `process.stdin` 拼接改为统一调用
- 消除重复的 JSON.parse + 错误处理代码

---

### ⚡ 性能优化

#### SessionStart 注入量精简 -57% (CHG-20260309-04)
- `spec.md`：截掉编码规范/目录结构/依赖列表，只保留概述+技术栈
- `walkthrough.md` 索引：只保留最近 10 行（原注入全量）
- `findings.md` 索引：跳过 `[x]`/`[-]` 已解决项，只保留 `[ ]` 开放索引
- Corrections 区保持全量注入
- **注入量从 ~47KB 降至 ~20KB**，大幅减少 Compact 频率

#### Artifact 归档机制增强 (CHG-20260309-03)
- SessionStart 智能截断 3 个文件：
  - `walkthrough.md`：只注入最近 3 个详情段落
  - `findings.md`：只注入开放项（`[ ]`）详情
  - `implementation_plan.md`：只注入进行中（`[/]`）变更详情
- PostToolUse `warnOnce` 归档提醒（walkthrough 详情 >3 / findings 已解决详情）
- Stop hook 归档兜底 warning

---

### 🐛 Bug 修复

#### Codex 审计修复 (CHG-20260313-03)
- **跨平台路径**：`pace-utils.js` 新增 `normalizePath()` 导出，`pre-tool-use.js`（4 处）和 `post-tool-use.js`（2 处）从 `toLowerCase()` 改为 `normalizePath()`
- **截断移除**：`extractOpenKeys()` / `findMissingFindingsDetails()` 去掉 8 字截断，返回完整标题
- **降级文案**：`session-start.js` 降级提示文案修正
- 测试预期同步修正（C-1 单元测试 + W-2 截断测试）

#### walkthrough 截断方向 bug (HOTFIX-20260313-02)
- `session-start.js` L173-179：`cutStart`/`cutEnd` 方向反了——保留最旧 10 条而非最新 10 条
- 修正为 `dataRows[0]~[9]` 保留最新记录

#### emoji 正则修正 (HOTFIX-20260313-01)
- `pre-tool-use.js` + `session-start.js`：emoji 检测正则从 checkbox 前缀可选改回**必须强制** `/^- \[.\].*[emoji]/m`
- 防止裸 emoji 文本误触发格式警告

#### VAULT_PATH 空值守卫 (CHG-20260312-03)
- `getArtifactDir()` / `isPaceProject()` / `createTemplates()` 三处添加 `VAULT_PATH` 空值检查
- 防止未设置环境变量时生成相对路径的幽灵目录

#### config-guard 变量名修复 (HOTFIX-20260310-01)
- S-1 stdin 重构后遗漏的变量名未更新

#### walkthrough 省略行列数修复 (HOTFIX-20260309-03)
- 省略提示中行/列数计算错误

---

### 🔧 代码质量

#### ticket22 P3 代码质量改进 31 项 (CHG-20260312-04)
- **注释增强**：8 个 hook 脚本中文注释补全
- **常量化**：11 处 magic string/number 提取为常量
- **DRY 重构**：重复逻辑提取到 `pace-utils.js`（`extractOpenKeys`、`ARCHIVE_MARKER`/`ARCHIVE_PATTERN`）
- **风格统一**：7 处代码风格 + 死代码清理
- **测试基础设施**：
  - 新增 `test-utils.js` 公共测试工具模块，3 个测试文件 import 替换
  - `pre-compact` E2E 3 个新测试
  - `REFERENCE.md` 新增 8 组文档

#### ticket21+22 合并修复 (CHG-20260312-03)
- **P0**：VAULT_PATH 空值守卫 3 处
- **P1-A 代码 5 项**：emoji 正则限定行首、stop.js 交叉验证独立化、blockCount 降级重置、pre-compact 日期正则、config-guard 注释
- **P1-B 格式一致性 10 项**：impl_plan 详情 5 源统一 4 段、findings 字段名统一、索引字段补全、walkthrough 时间统一、APPROVED 空行统一、归档区对齐
- **P2 文档 6 项**：SKILL.md name 去中文、维度数修正等

#### ticket18 可操作发现修复 (CHG-20260310-02)
- `pace-utils.js`：新增 `extractOpenKeys()` 函数、`ARCHIVE_MARKER`/`ARCHIVE_PATTERN` 常量导出
- 4 个 hook DRY 替换：硬编码 `<!-- ARCHIVE -->` 改为常量引用
- `pace-workflow` E 阶段纠偏协议补充
- `REFERENCE.md` Flag 生命周期表

#### ticket23 审计修复 (CHG-20260313-04)
- `paceflow-audit/SKILL.md`：六维度→五维度同步、删除 Agent 6 表格行和流程图节点
- `install.js`：`copyDirRecursive` 排除 `pace-hooks.log` 运行时日志
- `pre-compact.js`：删除 `warningCount` 死代码（compact 恢复从未读取）

---

### 📝 文档

#### impl_plan 任务分解三要素规范 (CHG-20260313-01)
- 定义任务分解三要素：**文件定位**（`file:line`）+ **改动意图** + **验收条件**
- `FORMAT_SNIPPETS.implDetail` 追加验收模式
- 8 源同步：2 模板、2 变更模板、SKILL.md、format-reference、pace-bridge、REFERENCE

#### 模板自包含 + Skill 触发词 (CHG-20260312-02)
- 新增 `knowledge-note.md` 模板（知识库笔记格式）
- 3 个模板注释增强：`implementation_plan.md`（4 段详情示例）、`findings.md`（详情格式）、`task.md`（bridge 格式）
- 4 个 Skill description 触发词补全
- **Eval 验证**：iteration-4 with_skill 100% vs without_skill 97.9%，delta +2.1%

#### 文档修正 4 项 (CHG-20260313-04)
- `format-reference.md`：索引示例补 `— 简要描述`
- `README.md`：测试数量 61→64 E2E、20→21 安装
- `REFERENCE.md`：`extractOpenKeys` 描述从"前 8 字"改为"完整标题"
- `REFERENCE.md`：S2 flag 列表从 5 个补全到 8 个

#### 版本历史补全 (CHG-20260313-03)
- `REFERENCE.md` + `README.md` 补全 v5.0.0 ~ v5.0.2 版本历史条目

---

### 🧪 测试

#### 新增测试
| 类别 | v5.0.2 | v5.1.0 | 新增 |
|------|--------|--------|------|
| 单元测试 | 51 | 73 | +22 |
| E2E 测试 | 57 | 64 | +7 |
| 安装测试 | 0 | 21 | +21 |
| **合计** | **108** | **158** | **+50** |

- `test-install.js`：全新安装测试套件 21 项，覆盖 settings.json 合并、文件备份、模板清理、plugin 模式
- `test-utils.js`：公共测试工具模块（`createMockStdin`、`createTempDir` 等）
- `test-pace-utils.js`：新增 `extractOpenKeys`、`normalizePath`、`getProjectName` 特殊字符等 22 项
- `test-hooks-e2e.js`：新增 V 阶段 VERIFIED、walkthrough 日期、impl_plan [/]、findings 详情守门等 7 项

#### Corrections 双写 Eval (CHG-20260312-01)
- 新增第 8 个 eval（corrections-dual-write），12 assertions
- iteration-3 基准：with_skill 100% vs without_skill 71.9%，delta +28.1%

---

### 🔨 工具链

#### 版本自动化脚本 (CHG-20260309-06)
- 新增 `bump-version.js`，支持 `--dry-run`
- 自动同步 6 个文件版本号：`pace-utils.js`、`plugin.json`、`marketplace.json`、`REFERENCE.md`（×2）、`README.md`

#### verify.js 增强
- 新增 `checkPlugin` 检查组（7 项 plugin 结构验证）
- hooks.json 与 settings 一致性检查
- 版本号双向比较

---

### 📊 审计历史

本版本经历 4 轮完整 5-agent 并行审计：

| Ticket | 日期 | 原始发现 | 确认 | 误报率 | 健康度 |
|--------|------|----------|------|--------|--------|
| ticket17 | 03-09 | 1C+5H+14W+7I | 19 项修复 | — | — |
| ticket18 | 03-10 | — | DRY+常量化+纠偏协议 | — | — |
| ticket21+22 | 03-12 | 0C+1H+12W+26I | P0-P3 全修 | 4.2% | 8/10 |
| ticket23 | 03-13 | 0C+1H+20W+30I | 7 项修复 | 77% (H) | 8.4/10 |

---

### 完整变更列表

| CHG-ID | 类型 | 标题 | Tasks |
|--------|------|------|-------|
| CHG-20260309-03 | feat | Artifact 归档机制增强 — 智能截断 + 归档提醒 | T-378~T-384 |
| CHG-20260309-04 | perf | SessionStart 注入量精简 -57% | T-385~T-388 |
| HOTFIX-20260309-03 | fix | walkthrough 省略行列数修复 | T-389 |
| CHG-20260309-05 | refactor | 统一 stdin 解析 | T-390~T-393 |
| CHG-20260309-06 | feat | 版本自动化脚本 bump-version.js | T-394~T-395 |
| HOTFIX-20260310-01 | fix | config-guard 变量名修复 | T-396 |
| CHG-20260310-02 | refactor | ticket18 修复 — DRY + 常量化 + 纠偏协议 | T-397~T-403 |
| CHG-20260311-01 | refactor | Skills 架构重设计 — 6→5 合并 + Progressive Disclosure | T-404~T-410 |
| CHG-20260312-01 | test | Corrections 双写 Eval 补全 | T-411~T-415 |
| CHG-20260312-02 | docs | 模板自包含 + Skill 触发词改进 | T-416~T-421 |
| CHG-20260312-03 | fix | ticket21+22 合并修复 — VAULT_PATH 守卫 + 格式一致性 | T-422~T-431 |
| CHG-20260312-04 | refactor | ticket22 P3 代码质量改进 31 项 | T-432~T-436 |
| HOTFIX-20260313-01 | fix | emoji 正则修正 — checkbox 前缀必须强制 | T-437 |
| CHG-20260313-01 | docs | impl_plan 任务分解三要素规范 | T-438~T-440 |
| CHG-20260313-02 | refactor | 归档机制改造 — 移动标记而非内容 | T-441~T-443 |
| CHG-20260313-03 | fix | Codex 审计修复 — normalizePath + 截断移除 | T-444~T-447 |
| HOTFIX-20260313-02 | fix | walkthrough 截断方向修正 | T-448~T-451 |
| CHG-20260313-04 | fix | ticket23 审计修复 — Agent 数量 + 死代码 + 文档 | T-452~T-455 |

---

### 升级说明

- **无破坏性变更**：所有修改向后兼容
- **Plugin 用户**：`/plugin install paceflow@paceaitian-paceflow` 自动获取最新版本
- **手动安装用户**：`node paceflow/install.js --force` 覆盖更新
- **Skills**：`change-management` 已合并入 `artifact-management`，旧目录自动清理

---

**完整代码**：[paceaitian/paceflow](https://github.com/paceaitian/paceflow) | **运行时**：Node.js | **协议**：PACE (Plan-Artifact-Check-Execute-Verify)
