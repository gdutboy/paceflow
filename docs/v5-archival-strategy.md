# PACEflow v5 → v6 归档式迁移策略（B 方案）

> **历史文档**：本文是 v6 迁移方案设计稿。当前 legacy v5 处理以 `plugin/migrate/batch-archive-v5.js`、hook 提示和 production smoke 记录为准。
>
> **文档版本**：1.0
> **生成日期**：2026-05-02
> **状态**：待实施（拟执行于 v6-only agent Phase A 测试通过后）
> **关联文档**：
> - `docs/v6.0.0-design.md`（v6 架构设计）
> - `docs/agent-design.md`（agent 设计）
> - `docs/agent-testing-strategy.md`（测试策略）

---

## 1. 背景与决策

### 1.1 决策

**采纳 B 方案：v5 全部归档（伪迁移），活跃区清空给 v6，零内容迁移**。

放弃 v5 兼容（agent / spec / instructions 删除 v5 章节），但保留所有 v5 数据完整性（推到 ARCHIVE 区域永久可查）。

### 1.2 替代方案对比

| 方案 | 描述 | 实施时间 | Token 成本 | 风险 |
|------|------|---------|----------|------|
| A. 维持双轨 | agent 同时支持 v5 / v6 | 0（已实现） | 持续偏高 | 复杂度高 |
| B. 归档式迁移（**采纳**） | v5 全部推 ARCHIVE，新 v6 从空开始 | 2-3 小时 | 极低 | 低 |
| C. 完整内容迁移 | migrate-v6.js 解析 v5 详情段落，重组为 v6 详情文件 | ~10 小时 | 中（一次性）| 高（解析复杂） |
| D. subagent 批量迁移 | 派多 subagent 解析 v5 重组 v6 | ~2 小时 | 极高（PACEflow 360K tokens / ccauth 1.8M tokens）| 中 |

### 1.3 为什么选 B

1. **PACEflow 是单团队工具**，不需要面向社区大规模发布兼容
2. **v5 双区结构本身有缺陷**（用户痛点：归档 100K+ tokens），延续支持就是延续问题
3. **旧 CHG 极少复活**——已归档的历史数据"凝固"是合理的
4. **零解析成本**——不需要理解 v5 详情段落的多种字段命名变体（见 findings 第 514 行 H-2 三套字段名）
5. **Agent 大幅简化**：删除 v5 章节后 ~190 行 → ~140 行（-26%）

---

## 2. 核心思想：伪迁移

### 2.1 不是"移动内容"，是"划边界"

**真正迁移**（C 方案）：解析 v5 详情段落 → 生成 v6 详情文件 → 删除 v5 详情段落

**B 方案伪迁移**：把 ARCHIVE 标记位置移动到所有 v5 内容之上，标记之下都成为"历史"

### 2.2 伪迁移示例

**迁移前 task.md**：

```markdown
# 项目任务追踪

## 活跃任务

- [/] CHG-20260502-01 旧 CHG 索引行
- [/] CHG-20260502-02 另一个旧 CHG

<!-- ARCHIVE -->

- [x] CHG-20260403-01 已归档历史 1
- [x] CHG-20260321-01 已归档历史 2
```

**迁移后 task.md**：

```markdown
# 项目任务追踪

## 活跃任务


<!-- ARCHIVE -->

- [/] CHG-20260502-01 旧 CHG 索引行    <-- 推到归档区
- [/] CHG-20260502-02 另一个旧 CHG     <-- 推到归档区
- [x] CHG-20260403-01 已归档历史 1
- [x] CHG-20260321-01 已归档历史 2
```

**说明**：
- 活跃区干净，等待新 v6 wikilink 索引
- 旧 v5 索引行（含 [/] 进行中）也都推到归档区
- 历史数据完整保留
- agent 仅看活跃区（v6 wikilink），不读归档区

---

## 3. 实施步骤

### 3.1 batch-archive-v5.js 设计

简短 Node.js 脚本（< 50 行）：

```javascript
#!/usr/bin/env node
// batch-archive-v5.js
// 用法：node batch-archive-v5.js <project-vault-path> [--dry-run]

const fs = require('fs');
const path = require('path');

const ARTIFACT_FILES = ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
const ARCHIVE_MARKER = '<!-- ARCHIVE -->';

// 每个 artifact 文件的"活跃区起始模板"（保留这部分）
const ACTIVE_TEMPLATES = {
  'task.md': `# 项目任务追踪\n\n## 活跃任务\n\n`,
  'implementation_plan.md': `# 实施计划\n\n## 变更索引\n\n`,
  'walkthrough.md': `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n\n`,
  'findings.md': `# 调研记录\n\n## 摘要索引\n\n`,
};

function archiveV5(projectPath, dryRun = false) {
  for (const file of ARTIFACT_FILES) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const archiveIdx = content.indexOf(`\n${ARCHIVE_MARKER}\n`);

    let active, archive;
    if (archiveIdx >= 0) {
      active = content.substring(0, archiveIdx);
      archive = content.substring(archiveIdx + ARCHIVE_MARKER.length + 2);
    } else {
      active = content;
      archive = '';
    }

    // 提取活跃区的"标题/模板"部分（前几个空行前）
    const template = ACTIVE_TEMPLATES[file];
    const activeContent = active.substring(template.length);  // 模板之后的内容（v5 旧索引）

    const newContent = `${template}\n${ARCHIVE_MARKER}\n\n${activeContent.trim()}\n${archive ? '\n' + archive.trim() : ''}\n`;

    if (dryRun) {
      console.log(`[DRY-RUN] ${file}: would push ${activeContent.split('\n').filter(l => l.trim()).length} lines to archive`);
    } else {
      // 备份
      fs.writeFileSync(`${filePath}.v5-backup`, content, 'utf8');
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(`[DONE] ${file}: archived old content, backup at ${file}.v5-backup`);
    }
  }
}

const projectPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!projectPath) {
  console.error('用法：node batch-archive-v5.js <project-vault-path> [--dry-run]');
  process.exit(1);
}

archiveV5(projectPath, dryRun);
```

### 3.2 执行流程

```
Step 1：先在测试副本验证脚本
  └── cp -r vault/projects/paceflow-hooks /tmp/test-archive
       node batch-archive-v5.js /tmp/test-archive --dry-run
       node batch-archive-v5.js /tmp/test-archive
       人工检查 4 个文件
       ↓
Step 2：实际执行（生产 vault）
  └── node batch-archive-v5.js vault/projects/paceflow-hooks
       4 个 .v5-backup 文件备份
       ↓
Step 3：验证
  ├── 4 个主 artifact 活跃区为空（仅顶部模板）
  ├── ARCHIVE 标记之下含原 v5 数据
  ├── ARCHIVE 标记仅 1 个独占一行
  └── 无内容丢失（行数 = 原 + 模板）
       ↓
Step 4：提交（如有 git）+ Obsidian 重新索引
       ↓
Step 5：删除 .v5-backup（保留 1-2 周后清理）
```

### 3.3 特殊文件处理

#### 3.3.1 corrections.md（不存在）

PACEflow 自身 vault 当前**无** corrections.md（v5 时代将 corrections 放在 findings.md "## Corrections 记录" 区）。

处理：
1. 用 spec §5.6.5 整文件模板创建空 corrections.md
2. findings.md 中的 `## Corrections 记录` 段会随 v5 内容一起被推到 ARCHIVE 下方（保留历史，不重复迁移到 corrections.md）
3. 未来新 correction 走 v6 流程（agent 处理）

#### 3.3.2 spec.md

不动。spec.md 是项目说明，不含 CHG/finding/correction 概念。

#### 3.3.3 changes/ 子目录

PACEflow 当前 vault 已有 changes/ 子目录（PoC 创建）：
- `chg-20260502-01-poc.md`
- `findings/finding-2026-05-01-paceflow-artifact-writer-poc.md`
- `findings/finding-2026-05-01-paceflow-artifact-writer-v2-validation.md`
- `corrections/correction-2026-05-02-01-subagent-prompt-bloat.md`

这些是 v6 数据，**保留不动**。

---

## 4. 验证方案

### 4.1 自动验证（脚本）

```bash
# 验证脚本
for f in task.md implementation_plan.md walkthrough.md findings.md; do
  # 1. ARCHIVE 标记仅 1 个
  count=$(grep -c "^<!-- ARCHIVE -->$" "$f")
  echo "$f: ARCHIVE 标记数=$count（期望 1）"
  
  # 2. 无内容丢失
  original=$(wc -l < "$f.v5-backup")
  current=$(wc -l < "$f")
  echo "$f: 行数 backup=$original / current=$current（差异应 ≤ 5）"
  
  # 3. 活跃区检查（ARCHIVE 之上）
  active_lines=$(awk '/^<!-- ARCHIVE -->$/{exit} {print}' "$f" | wc -l)
  echo "$f: 活跃区 $active_lines 行（应 ≤ 10）"
done
```

### 4.2 人工抽查

| 文件 | 抽查项 |
|------|------|
| task.md | 活跃任务区为空，旧 CHG 索引在 ARCHIVE 下方 |
| implementation_plan.md | 变更索引区为空，旧 CHG 索引在 ARCHIVE 下方 |
| walkthrough.md | 最近工作表为空，旧记录在 ARCHIVE 下方 |
| findings.md | 摘要索引区为空，旧索引和详情段落都在 ARCHIVE 下方 |

### 4.3 Hook 行为验证

迁移后立即派 v6-only agent 跑测试：
- create-chg → 应只在活跃区写入 v6 wikilink
- 验证 stop hook 不再阻止（因活跃区无 [ ] 索引缺详情）

---

## 5. 回滚方案

### 5.1 单文件回滚

```bash
mv task.md task.md.v6-attempted
mv task.md.v5-backup task.md
```

### 5.2 全量回滚

```bash
for f in task.md implementation_plan.md walkthrough.md findings.md; do
  mv "$f" "$f.v6-attempted"
  mv "$f.v5-backup" "$f"
done
```

### 5.3 完全回到 v5（含 changes/）

如发现 v6 设计根本问题：
1. 全量回滚 4 个 artifact
2. 删除 `changes/` 子目录（仅含 PoC 文件，可丢失）
3. 删除 `corrections.md`（如已建）
4. 安装回 PACEflow v5.x（git checkout 5.1.4）

---

## 6. 与其他项目的关系

| 项目 | 状态 | 处理 |
|------|-----|------|
| PACEflow 自身 | v5（混合 PoC v6 changes/） | 立即执行 B 方案（dogfood）|
| ccauth | v5（findings 45KB / impl_plan 381KB）| 用户决定时机；推荐 PACEflow 验证后再做 |
| 其他用户项目 | 未知 | 用户自行评估 |

### 6.1 ccauth 执行差异

ccauth 数据更大，但脚本无差异（按文件大小线性）。预估：
- batch-archive-v5.js 跑完 ~10 秒
- 4 个 .v5-backup 总大小 ~840KB
- 验证 ~5 分钟

---

## 7. 边界与限制

### 7.1 适用场景

✅ B 方案适用：
- 旧 CHG 已完成（不再 active）
- 不需要把旧 CHG 转为 v6 wikilink 形式
- 接受旧 CHG 的归档历史在原 artifact 文件中（不在 changes/）

### 7.2 不适用场景

❌ B 方案不适用（应选 C 完整迁移）：
- 大量旧 CHG 仍 active（需要迁移到新结构继续工作）
- 需要全部历史 CHG 都用 wikilink 关联（如做 Obsidian Graph 分析）
- 有跨 artifact 的复杂关联需要保持

实际中 PACEflow 自身 + ccauth 都符合"旧 CHG 已完成"，B 方案适用。

### 7.3 历史 CHG 复活

未来如果某个旧 CHG 需要复活（罕见）：
1. 主 session 在 ARCHIVE 区找到旧 CHG
2. 派 agent 用 create-chg 创建新 v6 详情（基于旧内容）
3. 旧 ARCHIVE 区不动（保留历史）
4. 一次手动迁移成本低（< 5 分钟）

---

## 8. 时间线

| 阶段 | 时长 | 内容 |
|------|-----|------|
| **Phase v6-test** | ~30 min | 创建 v6-only 副本 agent + 跑 Phase A 测试 |
| **Phase B-prep** | ~30 min | 写 batch-archive-v5.js + dry-run 验证 |
| **Phase B-exec** | ~15 min | 生产 vault 执行 + 验证 |
| **Phase B-clean** | ~30 min | 删除 agent / spec / instructions 的 v5 章节 |
| **Phase B-test** | ~30 min | 派 Phase A 重测纯 v6（应 5/5 PASS） |
| **Phase B-commit** | ~10 min | git commit |
| **总计** | **~2.5 小时** | 完整切换 |

---

## 9. 决策检查清单

执行 B 方案前必须确认：

- [ ] PACEflow vault 已完整备份（git 或外部）
- [ ] 双轨 v3.1 agent 仍可工作（fallback 路径）
- [ ] v6-only 副本 agent Phase A 测试 5/5 PASS
- [ ] batch-archive-v5.js dry-run 输出符合预期
- [ ] 接受"旧 CHG 不转为 wikilink"的限制
- [ ] ccauth 等其他项目暂不强制同步

---

## 10. 待决策项

1. ccauth 项目是否同步执行 B 方案？（推荐：PACEflow 验证后再决定）
2. .v5-backup 保留多久？（推荐：1 个月后清理）
3. 删除 v5 兼容章节后，agent 是否升级为 v4.0？（推荐：是，作为 breaking change 标识）
4. 是否在 v6.0.0-design.md 加 "v5 兼容已废弃" 章节？（推荐：是）
