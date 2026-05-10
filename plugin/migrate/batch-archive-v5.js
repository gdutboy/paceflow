#!/usr/bin/env node
/**
 * batch-archive-v5.js
 *
 * PACEflow v5 → v6 归档式迁移（B 方案）
 * 用 v6 标准模板覆盖文件顶部，原 v5 内容以历史区形式推到 ARCHIVE 下方
 * 轻量转换 frontmatter/ARCHIVE/H1；精确原文备份到 .v5-backup，避免数据丢失
 *
 * 用法：
 *   node batch-archive-v5.js <project-vault-path> [--dry-run] [--force]
 *
 * --force：目标已存在 changes/ 或 .v5-backup 时允许重跑；如已有 .v5-backup，
 *          使用备份作为迁移源且不覆盖备份。
 *
 * 设计依据：docs/v5-archival-strategy.md（B 方案）
 */

const fs = require('fs');
const path = require('path');
const { ARCHIVE_MARKER, ARCHIVE_PATTERN, MIGRATABLE_ARTIFACT_FILES } = require('../hooks/pace-utils');

const ARTIFACT_FILES = MIGRATABLE_ARTIFACT_FILES;

function archiveLinePattern() {
  return new RegExp(ARCHIVE_PATTERN.source, 'gm');
}

// v6 标准模板（来自 agent-references/artifact-writer-spec.md §5.6）
// 顶部为活跃区（空），紧跟 ARCHIVE 标记
const V6_TEMPLATES = {
  'task.md':
    `# 项目任务追踪\n\n## 活跃任务\n\n\n${ARCHIVE_MARKER}\n\n`,
  'implementation_plan.md':
    `# 实施计划\n\n## 变更索引\n\n<!-- 格式：- [状态] [[wikilink]] 标题 #change [tasks::] -->\n\n\n${ARCHIVE_MARKER}\n\n`,
  'walkthrough.md':
    `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n\n\n${ARCHIVE_MARKER}\n\n`,
  'findings.md':
    `# 调研记录\n\n## 摘要索引\n\n<!-- 格式：- [状态] [[finding-id|title]] — summary [date::] [impact::] -->\n\n\n${ARCHIVE_MARKER}\n\n`,
};

const CORRECTIONS_TEMPLATE =
  `# Corrections 记录\n\n> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。\n\n## 索引\n\n<!-- 格式：- [[correction-id]] <title> [date::] [knowledge:: [[note]] | project-only] -->\n\n\n${ARCHIVE_MARKER}\n`;

/**
 * v5 内容预处理：
 * 1. 归档区加 v5 历史说明，避免模型把下方内容当成 v6 活跃区
 * 2. 顶部 YAML frontmatter 转成历史代码块，避免读起来像第二个活动 frontmatter
 * 3. 顶部 H1 降级为 H2 + 标记"v5 历史"，避免与 v6 模板 H1 重复
 * 4. v5 自带的 <!-- ARCHIVE --> 标记替换为分隔注释，避免与 v6 ARCHIVE 双重存在
 */
function transformV5Body(content) {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .replace(archiveLinePattern(), '<!-- v5 历史 active/archive 边界 -->');
  const lines = normalized.split('\n');
  const result = [
    '## v5 历史归档',
    '',
    '> 以下内容由 PACEflow v5→v6 迁移脚本归档保留，不参与 v6 活跃流程。',
    '> 原始精确内容保存在同名 `.v5-backup`；本区只作历史查阅。',
    '',
  ];

  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;

  if (lines[i] && lines[i].trim() === '---') {
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '---') {
        end = j;
        break;
      }
    }
    if (end > i) {
      result.push('### v5 原始 frontmatter', '', '```yaml');
      result.push(...lines.slice(i + 1, end));
      result.push('```', '');
      i = end + 1;
    }
  }

  while (i < lines.length && lines[i].trim() === '') i++;
  const body = lines.slice(i);
  for (let j = 0; j < body.length; j++) {
    if (body[j].trim() === '') continue;
    if (body[j].startsWith('# ')) {
      body[j] = '## (v5 历史) ' + body[j].substring(2);
    }
    break;
  }
  return result.concat(body).join('\n');
}

function archiveV5(projectPath, dryRun, force) {
  console.log(`项目路径：${projectPath}`);
  console.log(`模式：${dryRun ? 'DRY-RUN（不写入）' : '执行'}`);
  console.log('');

  const changesDir = path.join(projectPath, 'changes');
  if (fs.existsSync(changesDir) && !force) {
    console.error('[ERROR] 检测到 changes/ 已存在，目标看起来已经是 v6 或曾经迁移过。');
    console.error('        为避免重复迁移或混合 v5/v6 artifact，本次中止。确认要重跑时请显式加 --force。');
    process.exit(1);
  }

  const backupConflicts = ARTIFACT_FILES
    .filter(file => fs.existsSync(path.join(projectPath, file)))
    .filter(file => fs.existsSync(path.join(projectPath, `${file}.v5-backup`)));
  if (backupConflicts.length > 0 && !force) {
    console.error(`[ERROR] 检测到已有 .v5-backup：${backupConflicts.map(f => `${f}.v5-backup`).join(', ')}`);
    console.error('        为避免覆盖备份，本次中止。确认要重跑时请显式加 --force。');
    process.exit(1);
  }

  // 确保 v6 子目录结构（agent 项目检测依赖 changes/ 目录存在）
  const subDirs = ['changes', 'changes/findings', 'changes/corrections'];
  for (const sub of subDirs) {
    const fullPath = path.join(projectPath, sub);
    if (fs.existsSync(fullPath)) {
      console.log(`[SKIP] 子目录 ${sub}：已存在`);
    } else if (dryRun) {
      console.log(`[DRY-RUN] 子目录 ${sub}：将创建`);
    } else {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`[DONE] 子目录 ${sub}：已创建`);
    }
  }
  console.log('');

  let processed = 0;
  for (const file of ARTIFACT_FILES) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[SKIP] ${file}：文件不存在`);
      continue;
    }

    const backupPath = `${filePath}.v5-backup`;
    const hasBackup = fs.existsSync(backupPath);
    const sourcePath = force && hasBackup ? backupPath : filePath;
    const original = fs.readFileSync(sourcePath, 'utf8');
    const v5Body = transformV5Body(original);
    const newContent = `${V6_TEMPLATES[file]}${v5Body}\n`;

    // 健壮性：新内容必须只有 1 个 ARCHIVE 标记
    const archiveCount = (newContent.match(archiveLinePattern()) || []).length;
    if (archiveCount !== 1) {
      console.error(`[ERROR] ${file}：ARCHIVE 标记数 ${archiveCount}（期望 1），脚本中止`);
      process.exit(1);
    }

    if (dryRun) {
      const sourceNote = force && hasBackup ? `，使用已有 ${file}.v5-backup 作为源` : '';
      console.log(
        `[DRY-RUN] ${file}：${original.length} → ${newContent.length} 字符 ` +
          `(v6 模板 ${V6_TEMPLATES[file].length} + v5 历史 ${v5Body.length})${sourceNote}`,
      );
    } else {
      let backupNote;
      if (hasBackup) {
        backupNote = `使用已有 ${file}.v5-backup 作为源，不覆盖备份`;
      } else {
        fs.writeFileSync(backupPath, original, 'utf8');
        backupNote = `备份 ${file}.v5-backup (${original.length} 字符)`;
      }
      fs.writeFileSync(filePath, newContent, 'utf8');
      console.log(
        `[DONE] ${file}：${backupNote}，` +
          `新文件 ${newContent.length} 字符`,
      );
    }
    processed++;
  }

  // corrections.md：不存在则创建空模板，存在则不动
  const correctionsPath = path.join(projectPath, 'corrections.md');
  if (!fs.existsSync(correctionsPath)) {
    if (dryRun) {
      console.log(
        `[DRY-RUN] corrections.md：将创建空模板（${CORRECTIONS_TEMPLATE.length} 字符）`,
      );
    } else {
      fs.writeFileSync(correctionsPath, CORRECTIONS_TEMPLATE, 'utf8');
      console.log('[DONE] corrections.md：已创建空模板');
    }
  } else {
    const sz = fs.statSync(correctionsPath).size;
    console.log(`[SKIP] corrections.md：已存在 (${sz} 字符)，不动`);
  }

  console.log('');
  console.log(`完成 ${processed}/${ARTIFACT_FILES.length} 个 artifact 文件`);

  if (!dryRun && processed > 0) {
    console.log('');
    console.log('回滚方法（如需）：');
    console.log(`  cd "${projectPath}"`);
    console.log(`  for f in ${ARTIFACT_FILES.join(' ')}; do`);
    console.log('    mv "$f" "$f.v6-attempted" && mv "$f.v5-backup" "$f"');
    console.log('  done');
  }
}

// CLI
const projectPath = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');

if (!projectPath) {
  console.error('用法：node batch-archive-v5.js <project-vault-path> [--dry-run] [--force]');
  process.exit(1);
}

if (!fs.existsSync(projectPath)) {
  console.error(`错误：路径不存在：${projectPath}`);
  process.exit(1);
}

archiveV5(projectPath, dryRun, force);
