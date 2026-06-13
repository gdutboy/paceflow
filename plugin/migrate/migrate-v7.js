#!/usr/bin/env node
/**
 * migrate-v7.js
 *
 * PACEflow v6 → v7 artifact 迁移：
 * 1. 详情文件 frontmatter 瘦身到 7.0 封闭合同（删 DROP_KEYS、补缺 key 置 null、
 *    schema-version → "7.0"、archived 缺 archived-date 时从 walkthrough 回填）
 * 2. 双文件合并：implementation_plan.md 整体改写为 tombstone（task.md 是唯一 CHG 索引）
 * 3. 索引卫生：task.md 清 v5 死尾巴段；findings.md 三态重排 + 表头补 [change::]；
 *    corrections.md 索引行 [knowledge:: project-only] → [scope:: project-only] + 弯引号修复
 * 4. 运行态清理：.pace/index-transactions/ 残留目录删除
 * 5. 验收：迁移产物全量过 validateFrontmatterSchema，任一失败还原备份并报错退出
 *
 * 用法：
 *   node migrate-v7.js --cwd <项目目录> [--dry-run] [--hygiene]
 *
 * 执行前自动备份被改文件到 <runtime>/.pace/backups/v7-migration/<timestamp>/，
 * 完成后写 .pace/v7-migration-state。
 *
 * 设计依据：docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §5
 */

const fs = require('fs');
const path = require('path');
const paceUtils = require('../hooks/pace-utils');
const {
  getArtifactDir,
  getProjectRuntimeDir,
  parseFrontmatter,
  validateFrontmatterSchema,
  SCHEMA_V7_KEYS,
  ARCHIVE_MARKER,
  ARCHIVE_PATTERN,
} = paceUtils;

// 6.0 → 7.0 删除字段清单（按帧 kind）
const DROP_KEYS = {
  chg: ['chg-id', 'id', 'type', 'completed-date', 'aliases', 'tags', 'related-finding', 'parent-impl'],
  finding: ['finding-id', 'type', 'impact', 'summary', 'merges', 'merged-by', 'related-changes', 'rejection-reason', 'aliases', 'tags'],
  correction: ['correction-id', 'trigger-quote', 'wrong-behavior', 'correct-behavior', 'trigger-scenario', 'root-cause', 'knowledge-link', 'project-scope', 'aliases', 'tags'],
};

// 缺 key 时插入的默认值（chg 帧 parent-tasks 必填非 null，无法机械补值时仍补 null 让验收报错可见）
const NULL_VALUE = 'null';

const TOMBSTONE = `# 实施计划（已退役）

> v7.0 起本文件退役，CHG/HOTFIX 索引统一见 [[task]]。本文件保留仅为旧版本兼容。

${ARCHIVE_MARKER}
`;

const FINDINGS_HEADER_COMMENT = '<!-- 格式：- [状态] [[finding-id|title]] — summary #finding [date::] [impact::] [change::] -->';

// 本 vault 专属卫生（--hygiene）：游离 v5 文档移 _archive/
const HYGIENE_STRAY_DOCS = [
  'audit-prompt.md', 'paceflow-complete-flow.md', 'paceflow-flow-ascii.md',
  'ticket12.md', 'ticket14.md', 'ticket18.md', 'ticket24.md',
];

function parseArgs(argv) {
  const args = { cwd: '', dryRun: false, hygiene: false, restore: '' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--cwd') args.cwd = argv[++i] || '';
    else if (argv[i] === '--dry-run') args.dryRun = true;
    else if (argv[i] === '--hygiene') args.hygiene = true;
    else if (argv[i] === '--restore') args.restore = argv[++i] || '';
  }
  if (!args.cwd) {
    console.error('用法：node migrate-v7.js --cwd <项目目录> [--dry-run] [--hygiene] [--restore <备份目录>]');
    process.exit(1);
  }
  args.cwd = path.resolve(args.cwd);
  return args;
}

/** 从备份目录整体还原被改文件（spec §6.4：执行失败可整体还原） */
function restoreFromBackup(backupDir, artDir) {
  const restored = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      const rel = path.relative(backupDir, p);
      fs.writeFileSync(path.join(artDir, rel), fs.readFileSync(p));
      restored.push(rel);
    }
  };
  walk(backupDir);
  return restored;
}

function kindForDetailFile(relPath) {
  const base = path.basename(relPath);
  if (/^(chg|hotfix)-/.test(base)) return 'chg';
  if (/^finding-/.test(base)) return 'finding';
  if (/^correction-/.test(base)) return 'correction';
  return null;
}

/** 从详情文件名推导 CHG-ID（chg-20250101-01[-slug].md → CHG-20250101-01） */
function changeIdForFile(relPath) {
  const m = path.basename(relPath).match(/^(chg|hotfix)-(\d{8})-(\d{2})/);
  return m ? `${m[1].toUpperCase()}-${m[2]}-${m[3]}` : null;
}

/** 从 walkthrough.md 表格行回填归档日期：| YYYY-MM-DD | ... | CHG-ID | */
function backfillDateFromWalkthrough(walkthroughContent, chgId) {
  if (!walkthroughContent || !chgId) return null;
  for (const line of walkthroughContent.split('\n')) {
    const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|.*\|\s*([A-Za-z]+-\d{8}-\d{2})\s*\|\s*$/);
    if (m && m[2].toUpperCase() === chgId) return m[1];
  }
  return null;
}

/**
 * frontmatter 瘦身到 7.0 合同。逐行处理保正文字节不动：
 * 删 DROP_KEYS 行（含 YAML 多行值续行）、schema-version → "7.0"、
 * 缺 key 在 schema-version 行前插 `<key>: null`、archived/cancelled 缺 archived-date 回填。
 * @returns {{content: string, dropped: string[], added: string[], backfill: string|null}}
 */
function rewriteFrontmatter(content, kind, backfillDate) {
  const m = content.match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!m) return { content, dropped: [], added: [], backfill: null };
  const fmLines = m[1].split('\n');
  const drop = new Set(DROP_KEYS[kind] || []);
  const keep = [];
  const dropped = [];
  const seen = new Set();
  let status = '';
  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    const keyMatch = line.match(/^([A-Za-z][\w-]*):/);
    if (!keyMatch) { keep.push(line); i++; continue; }
    const key = keyMatch[1];
    // 吃掉该 key 的多行续行（行首空白开头的非空行，或零缩进块序列项 `- item`——
    // 否则删 key 时零缩进序列项变孤儿行残留破坏 frontmatter，R-34）
    let end = i + 1;
    while (end < fmLines.length && /^(\s+\S|-\s)/.test(fmLines[end])) end++;
    if (drop.has(key)) {
      dropped.push(key);
    } else {
      seen.add(key);
      // status 值剥引号后再判定（与 :273 main() 同款），否则 status: "archived" 含引号致 archived/cancelled 回填不触发
      if (key === 'status') status = line.slice(line.indexOf(':') + 1).trim().replace(/"/g, '');
      if (key === 'schema-version') {
        keep.push('schema-version: "7.0"');
      } else {
        for (let j = i; j < end; j++) keep.push(fmLines[j]);
      }
    }
    i = end;
  }
  // 补缺 key：按合同顺序，统一插在 schema-version 行之前
  const contract = SCHEMA_V7_KEYS[kind] || [];
  const added = contract.filter((k) => !seen.has(k) && k !== 'schema-version');
  if (!seen.has('schema-version')) keep.push('schema-version: "7.0"');
  const svIdx = keep.findIndex((l) => /^schema-version:/.test(l));
  keep.splice(svIdx, 0, ...added.map((k) => `${k}: ${NULL_VALUE}`));
  // archived/cancelled 回填 archived-date
  let backfill = null;
  if (kind === 'chg' && /^(archived|cancelled)$/.test(status)) {
    const adIdx = keep.findIndex((l) => /^archived-date:\s*(null)?\s*$/.test(l));
    if (adIdx !== -1) {
      backfill = backfillDate();
      keep[adIdx] = `archived-date: ${backfill.value}`;
    }
  }
  const rebuilt = `---\n${keep.join('\n')}\n---${m[2]}`;
  // 直接 slice 拼接（不走 String.replace——其替换串会把 $&/$1 当替换模式，frontmatter 含 $ 时损坏帧）
  return { content: rebuilt + content.slice(m[0].length), dropped, added, backfill };
}

/** task.md：删除「## v5 历史归档」段（行首锚定，防正文提及同字样误切）到文件尾 */
function stripV5Tail(content) {
  const m = content.match(/^## v5 历史归档\s*$/m);
  if (!m) return content;
  return content.slice(0, m.index).replace(/\n+$/, '\n');
}

/**
 * findings.md：活跃区 [x]/[-] 索引行移 ARCHIVE 下方（保相对顺序）+ 表头补 [change::]。
 * 边界定位必须用 ARCHIVE_PATTERN（独占行锚定，与 readActive 同判据）——finding summary
 * 文本可能含字面 <!-- ARCHIVE -->，indexOf 会误切在行内文本上把索引行切碎。
 */
function reorderFindingsIndex(content) {
  const m = content.match(ARCHIVE_PATTERN);
  if (!m) return content;
  let head = content.slice(0, m.index);
  let tail = content.slice(m.index);
  const moved = [];
  head = head.split('\n').filter((line) => {
    if (/^- \[[x-]\] \[\[finding-/.test(line)) { moved.push(line); return false; }
    return true;
  }).join('\n');
  if (!/\[change::\]/.test(head)) {
    head = head.replace(/<!-- 格式：[^>]*-->/, FINDINGS_HEADER_COMMENT);
  }
  if (moved.length > 0) {
    // slice 拼接（不走 String.replace——moved 行含 $ 时会被当替换模式损坏）；
    // tail 以独占行 marker 开头，插入点在 marker 行文本之后。
    const at = m[0].length;
    tail = `${tail.slice(0, at)}\n\n${moved.join('\n')}${tail.slice(at)}`;
  }
  return head + tail;
}

/** corrections.md：索引行 [knowledge:: project-only] → [scope:: project-only] + 弯引号修复 */
function repairCorrectionsIndex(content) {
  return content.split('\n').map((line) => {
    if (!/^- \[\[correction-/.test(line)) return line;
    return line
      .replace('[knowledge:: project-only]', '[scope:: project-only]')
      .replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  }).join('\n');
}

function collectDetailFiles(artDir) {
  const out = [];
  const dirs = ['changes', 'changes/findings', 'changes/corrections'];
  for (const sub of dirs) {
    const abs = path.join(artDir, sub);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      if (fs.statSync(p).isFile() && name.endsWith('.md') && kindForDetailFile(name)) {
        out.push(path.relative(artDir, p));
      }
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const artDir = getArtifactDir(args.cwd);
  const runtimeDir = getProjectRuntimeDir(args.cwd);
  if (!fs.existsSync(path.join(artDir, 'changes'))) {
    console.error(`目标不是 PACEflow 项目（无 changes/）：${artDir}`);
    process.exit(1);
  }

  if (args.restore) {
    const backupDir = path.resolve(args.restore);
    if (!fs.existsSync(backupDir)) {
      console.error(`备份目录不存在：${backupDir}`);
      process.exit(1);
    }
    const restored = restoreFromBackup(backupDir, artDir);
    console.log(`已从备份还原 ${restored.length} 个文件：\n  ${restored.join('\n  ')}`);
    return;
  }

  const todayDate = new Date();
  const executionDay = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
  const walkthroughPath = path.join(artDir, 'walkthrough.md');
  const walkthroughContent = fs.existsSync(walkthroughPath) ? fs.readFileSync(walkthroughPath, 'utf8') : '';

  // -------- 计算全部变更（in-memory），dry-run 与真跑共用 --------
  const changes = [];            // { rel, before, after }
  const droppedStats = {};       // key → count
  const backfillReport = [];     // 「CHG-ID ← 来源」
  const indexFixes = [];

  for (const rel of collectDetailFiles(artDir)) {
    const abs = path.join(artDir, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    // BOM 剥离 + CRLF → LF 归一（与 hook 对 artifact Edit 的换行归一行为一致）：
    // 否则 frontmatter 边界正则不匹配 → 文件漏迁，叠加验收 skip 通道成假绿。
    const before = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const kind = kindForDetailFile(rel);
    const chgId = changeIdForFile(rel);
    const fmStatus = (parseFrontmatter(raw).status || '').replace(/"/g, '');
    const r = rewriteFrontmatter(before, kind, () => {
      const fromWalkthrough = backfillDateFromWalkthrough(walkthroughContent, chgId);
      if (fromWalkthrough) {
        backfillReport.push(`${chgId} ← walkthrough 索引行 ${fromWalkthrough}`);
        return { value: `${fromWalkthrough}T00:00:00+08:00` };
      }
      backfillReport.push(`${chgId}（status=${fmStatus}）← 执行日 ${executionDay}（walkthrough 无记录，占位值）`);
      return { value: `${executionDay}T00:00:00+08:00` };
    });
    for (const k of r.dropped) droppedStats[k] = (droppedStats[k] || 0) + 1;
    if (r.content !== raw) changes.push({ rel, before: raw, after: r.content });
  }

  // 索引文件
  const taskPath = path.join(artDir, 'task.md');
  if (fs.existsSync(taskPath)) {
    const before = fs.readFileSync(taskPath, 'utf8');
    const after = stripV5Tail(before);
    if (after !== before) { changes.push({ rel: 'task.md', before, after }); indexFixes.push('task.md：清 v5 死尾巴段'); }
  }
  const implPath = path.join(artDir, 'implementation_plan.md');
  if (fs.existsSync(implPath)) {
    const before = fs.readFileSync(implPath, 'utf8');
    if (before !== TOMBSTONE) { changes.push({ rel: 'implementation_plan.md', before, after: TOMBSTONE }); indexFixes.push('implementation_plan.md：改写为 tombstone'); }
  }
  const findingsPath = path.join(artDir, 'findings.md');
  if (fs.existsSync(findingsPath)) {
    const before = fs.readFileSync(findingsPath, 'utf8');
    const after = reorderFindingsIndex(before);
    if (after !== before) { changes.push({ rel: 'findings.md', before, after }); indexFixes.push('findings.md：三态重排 + 表头补 [change::]'); }
  }
  const correctionsPath = path.join(artDir, 'corrections.md');
  if (fs.existsSync(correctionsPath)) {
    const before = fs.readFileSync(correctionsPath, 'utf8');
    const after = repairCorrectionsIndex(before);
    if (after !== before) { changes.push({ rel: 'corrections.md', before, after }); indexFixes.push('corrections.md：[scope::] 语义修正 + 弯引号修复'); }
  }

  const txDir = path.join(runtimeDir, 'index-transactions');
  const hasTxDir = fs.existsSync(txDir);

  // -------- 报告头 --------
  const mode = args.dryRun ? '【dry-run 预览，未写任何文件】' : '【执行迁移】';
  console.log(`migrate-v7 ${mode}`);
  console.log(`artifact 目录：${artDir}`);
  console.log(`待处理文件：${changes.length} 个`);
  console.log(`将删字段统计：${Object.entries(droppedStats).map(([k, n]) => `${k}×${n}`).join('、') || '无'}`);
  if (backfillReport.length) console.log(`archived-date 回填：\n  ${backfillReport.join('\n  ')}`);
  if (indexFixes.length) console.log(`索引修复：\n  ${indexFixes.join('\n  ')}`);
  if (hasTxDir) console.log('运行态清理：.pace/index-transactions/ 残留目录将删除');

  if (args.dryRun) {
    console.log('\ndry-run 完成。确认无误后去掉 --dry-run 重跑执行迁移。');
    return;
  }

  // -------- 备份 → 写盘 → 验收 --------
  const ts = todayDate.toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(runtimeDir, 'backups', 'v7-migration', ts);
  for (const c of changes) {
    const dest = path.join(backupDir, c.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, c.before);
  }
  for (const c of changes) {
    fs.writeFileSync(path.join(artDir, c.rel), c.after);
  }

  // 验收：全部详情文件过 7.0 封闭合同。skipped（非 7.0 帧）= 漏迁，与校验失败同等对待——
  // validateFrontmatterSchema 对非 7.0 帧返回 ok:true+skipped，只信 r.ok 会把漏迁文件假绿放行。
  const failures = [];
  for (const rel of collectDetailFiles(artDir)) {
    const content = fs.readFileSync(path.join(artDir, rel), 'utf8');
    const fm = parseFrontmatter(content);
    const kind = kindForDetailFile(rel);
    const r = validateFrontmatterSchema(kind, fm.status || '', fm);
    if (r.skipped) failures.push(`${rel}: 仍非 7.0 帧（漏迁，schema-version=${fm['schema-version'] || '缺失'}）`);
    else if (!r.ok) failures.push(`${rel}: missing=[${(r.missing || []).join(',')}] unknown=[${(r.unknown || []).join(',')}]`);
  }
  if (failures.length > 0) {
    // 还原备份
    for (const c of changes) {
      fs.writeFileSync(path.join(artDir, c.rel), c.before);
    }
    console.error(`\n验收失败（已还原全部文件）：\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }

  if (hasTxDir) fs.rmSync(txDir, { recursive: true, force: true });

  // 卫生（本 vault 专属，可选）
  if (args.hygiene) {
    const removed = [];
    const movedDocs = [];
    const sweep = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) { if (name !== '_archive') sweep(p); continue; }
        if (/\.(bak|v5-backup)$/.test(name)) { fs.rmSync(p); removed.push(path.relative(artDir, p)); }
      }
    };
    sweep(artDir);
    const archiveDir = path.join(artDir, '_archive');
    for (const name of HYGIENE_STRAY_DOCS) {
      const p = path.join(artDir, name);
      if (fs.existsSync(p)) {
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(p, path.join(archiveDir, name));
        movedDocs.push(name);
      }
    }
    console.log(`卫生：删除备份 ${removed.length} 个（${removed.join('、') || '无'}）；游离文档移 _archive/ ${movedDocs.length} 个（${movedDocs.join('、') || '无'}）`);
  }

  const statePath = path.join(runtimeDir, 'v7-migration-state');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ migratedAt: todayDate.toISOString(), files: changes.length, droppedStats, backupDir }, null, 2));

  console.log(`\n迁移完成：${changes.length} 个文件，验收 100% 通过。备份：${backupDir}`);
}

main();
