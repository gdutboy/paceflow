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
const { ARCHIVE_MARKER, ARCHIVE_PATTERN, MIGRATABLE_ARTIFACT_FILES, getV5MigrationStatePath } = require('../hooks/pace-utils');

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

  // frontmatter 起止 `---` 必须行首（/^---\s*$/），排除 block scalar 内缩进的 `---` 被误判为结束（TM-01）；
  // 且 frontmatter 区需至少含一行行首 YAML key，排除开头主题分隔线 `---` 被误当 frontmatter（MIGV5-03）。
  if (lines[i] !== undefined && /^---\s*$/.test(lines[i])) {
    let end = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^---\s*$/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const fmLines = end > i ? lines.slice(i + 1, end) : [];
    const looksLikeYaml = fmLines.some(line => /^[\w-]+\s*:/.test(line));
    if (end > i && looksLikeYaml) {
      result.push('### v5 原始 frontmatter', '', '```yaml');
      result.push(...fmLines);
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
    throw new Error('检测到 changes/ 已存在，目标看起来已经是 v6 或曾经迁移过。为避免重复迁移或混合 v5/v6 artifact，本次中止。确认要重跑时请显式加 --force。');
  }

  const backupConflicts = ARTIFACT_FILES
    .filter(file => fs.existsSync(path.join(projectPath, file)))
    .filter(file => fs.existsSync(path.join(projectPath, `${file}.v5-backup`)));
  if (backupConflicts.length > 0 && !force) {
    throw new Error(`检测到已有 .v5-backup：${backupConflicts.map(f => `${f}.v5-backup`).join(', ')}。为避免覆盖备份，本次中止。确认要重跑时请显式加 --force。`);
  }

  // 阶段一：全部读取 + 转换到内存，零写盘（MIGV5-02 原子性——任一失败前不触碰磁盘）
  const plan = [];
  for (const file of ARTIFACT_FILES) {
    const filePath = path.join(projectPath, file);
    if (!fs.existsSync(filePath)) {
      console.log(`[SKIP] ${file}：文件不存在`);
      continue;
    }
    const backupPath = `${filePath}.v5-backup`;
    const hasBackup = fs.existsSync(backupPath);

    // MIGV5-01：--force 且无对应 backup 时，若目标已是迁移后 v6（含 v5 历史归档标志），拒绝——
    // 否则会用已迁移的 v6 内容当 v5 源并把它写成新 backup，永久销毁原始 v5 数据。
    if (force && !hasBackup) {
      const probe = fs.readFileSync(filePath, 'utf8');
      if (probe.includes('## v5 历史归档')) {
        throw new Error(`${file}：检测到已是迁移后的 v6 内容且缺少 ${file}.v5-backup。继续会用 v6 内容当 v5 源并销毁原始数据，已中止。请先从 ${file}.v6-attempted 或版本控制恢复原始 v5 文件后重试。`);
      }
    }

    const sourcePath = force && hasBackup ? backupPath : filePath;
    const original = fs.readFileSync(sourcePath, 'utf8');
    const v5Body = transformV5Body(original);
    const newContent = `${V6_TEMPLATES[file]}${v5Body}\n`;
    const archiveCount = (newContent.match(archiveLinePattern()) || []).length;
    if (archiveCount !== 1) {
      throw new Error(`${file}：ARCHIVE 标记数 ${archiveCount}（期望 1），脚本中止`);
    }
    plan.push({ file, filePath, backupPath, hasBackup, original, newContent, v5Body });
  }

  const correctionsPath = path.join(projectPath, 'corrections.md');
  const willCreateCorrections = !fs.existsSync(correctionsPath);

  if (dryRun) {
    for (const sub of ['changes', 'changes/findings', 'changes/corrections']) {
      const fullPath = path.join(projectPath, sub);
      console.log(fs.existsSync(fullPath) ? `[SKIP] 子目录 ${sub}：已存在` : `[DRY-RUN] 子目录 ${sub}：将创建`);
    }
    for (const p of plan) {
      const sourceNote = force && p.hasBackup ? `，使用已有 ${p.file}.v5-backup 作为源` : '';
      console.log(`[DRY-RUN] ${p.file}：${p.original.length} → ${p.newContent.length} 字符 (v6 模板 ${V6_TEMPLATES[p.file].length} + v5 历史 ${p.v5Body.length})${sourceNote}`);
    }
    console.log(willCreateCorrections
      ? `[DRY-RUN] corrections.md：将创建空模板（${CORRECTIONS_TEMPLATE.length} 字符）`
      : '[DRY-RUN] corrections.md：已存在，不动');
    console.log('');
    console.log(`完成 ${plan.length}/${ARTIFACT_FILES.length} 个 artifact 文件（DRY-RUN）`);
    return { processed: plan.length, dryRun: true };
  }

  // 阶段二：批量写盘；任一步失败回滚已写改动（MIGV5-02 原子性）
  const createdDirs = [];
  const restoreFiles = [];   // 被覆盖的原 artifact（回滚时还原内容）
  const newArtifacts = [];   // 新建文件（回滚时删除）
  const rollback = () => {
    for (const r of restoreFiles) { try { fs.writeFileSync(r.filePath, r.before, 'utf8'); } catch(e) {} }
    for (const f of newArtifacts) { try { fs.unlinkSync(f); } catch(e) {} }
    for (const d of createdDirs.slice().reverse()) { try { fs.rmSync(d, { recursive: true, force: true }); } catch(e) {} }
  };

  try {
    for (const sub of ['changes', 'changes/findings', 'changes/corrections']) {
      const fullPath = path.join(projectPath, sub);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        if (!createdDirs.some(d => fullPath.startsWith(d))) createdDirs.push(fullPath);
        console.log(`[DONE] 子目录 ${sub}：已创建`);
      } else {
        console.log(`[SKIP] 子目录 ${sub}：已存在`);
      }
    }
    for (const p of plan) {
      if (!p.hasBackup) {
        fs.writeFileSync(p.backupPath, p.original, 'utf8');
        newArtifacts.push(p.backupPath);
      }
      restoreFiles.push({ filePath: p.filePath, before: p.original });
      fs.writeFileSync(p.filePath, p.newContent, 'utf8');
      const backupNote = p.hasBackup ? `使用已有 ${p.file}.v5-backup 作为源，不覆盖备份` : `备份 ${p.file}.v5-backup (${p.original.length} 字符)`;
      console.log(`[DONE] ${p.file}：${backupNote}，新文件 ${p.newContent.length} 字符`);
    }
    if (willCreateCorrections) {
      fs.writeFileSync(correctionsPath, CORRECTIONS_TEMPLATE, 'utf8');
      newArtifacts.push(correctionsPath);
      console.log('[DONE] corrections.md：已创建空模板');
    } else {
      console.log('[SKIP] corrections.md：已存在，不动');
    }
  } catch(e) {
    console.error(`[ERROR] 迁移写盘失败，正在回滚已写改动：${e.message}`);
    rollback();
    throw new Error(`迁移写盘失败已回滚：${e.message}`);
  }

  // A03：写显式 migrated state，使「迁移后不再提示」由 state 承载而非依赖 changes/ 副作用
  let statePath = '';
  try {
    statePath = getV5MigrationStatePath(projectPath);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, 'migrated\n', 'utf8');
  } catch(e) {}

  console.log('');
  console.log(`完成 ${plan.length}/${ARTIFACT_FILES.length} 个 artifact 文件`);

  if (plan.length > 0) {
    const stateRel = statePath ? path.relative(projectPath, statePath).replace(/\\/g, '/') : '.pace/v5-migration-state';
    console.log('');
    console.log('回滚方法（如需）：');
    console.log(`  cd "${projectPath}"`);
    console.log(`  for f in ${ARTIFACT_FILES.join(' ')}; do`);
    console.log('    mv "$f" "$f.v6-attempted" && mv "$f.v5-backup" "$f"');
    console.log('  done');
    console.log(`  rm -rf changes/ corrections.md "${stateRel}"   # 删除迁移新建项，使 v5 可被重新检测`);
  }

  return { processed: plan.length, dryRun: false };
}

// CLI（require.main 守卫：被 require（单元测试）时不执行 CLI，使 transformV5Body/archiveV5 可单测）
if (require.main === module) {
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

  try {
    archiveV5(projectPath, dryRun, force);
  } catch(e) {
    console.error(`[ERROR] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { transformV5Body, archiveV5 };
