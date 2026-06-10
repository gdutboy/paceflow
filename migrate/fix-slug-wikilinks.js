#!/usr/bin/env node
// HOTFIX-20260610-01 T-003：CHG slug wikilink 断链存量迁移（一次性，幂等）。
//
// 迁移内容：
//   1. 全部 changes/{chg,hotfix}-*.md 详情文件 frontmatter 的 parent-tasks / parent-impl
//      从裸 [[task]] / [[implementation_plan]] 改为 [[<artifact-dir 目录名>/task|task]] 部分路径形态
//      （Obsidian 多项目库中裸文件名解析会命中错误项目）。
//   2. task.md / implementation_plan.md / walkthrough.md 中指向「带 slug 详情文件」的纯 ID wikilink
//      [[chg-yyyymmdd-nn]] 改为 [[<文件名 stem 全名>|chg-yyyymmdd-nn]]（Obsidian 按文件名解析，
//      纯 ID 对带 slug 文件是死链）。指向旧无 slug 文件的 wikilink 保持不变。
//
// 部署顺序约束（读端先行）：task.md / implementation_plan.md 的【活跃区】索引行默认不迁移——
//   运行中的 plugin cache 若尚未包含 T-001 解析层（parseChangeIndex 全名兼容），迁移活跃行会令
//   hook 对活跃 CHG 失明（approve / 写代码门全断）。cache 更新（push + reload）后用 --include-active
//   跑第二遍收尾。ARCHIVE 下方归档行与 walkthrough 行不参与活跃判定，随时可迁。
//
// 用法：
//   node migrate/fix-slug-wikilinks.js --artifact-dir <绝对路径> --dry-run
//   node migrate/fix-slug-wikilinks.js --artifact-dir <绝对路径>
//   node migrate/fix-slug-wikilinks.js --artifact-dir <绝对路径> --include-active   # cache 更新后第二遍

const fs = require('fs');
const path = require('path');

const DETAIL_RE = /^(chg|hotfix)-(\d{8})-(\d{2})(-[a-z0-9][a-z0-9-]*)?\.md$/i;

/** 扫描 changes/ 顶层详情文件，返回 { 纯ID小写 → 文件 stem } 映射（仅带 slug 的文件进映射）。 */
function buildSlugMap(changesDir) {
  const map = new Map();
  for (const f of fs.readdirSync(changesDir)) {
    const m = f.match(DETAIL_RE);
    if (!m || !m[4]) continue; // 无 slug 段的旧文件不需要迁移 wikilink
    const pureId = `${m[1]}-${m[2]}-${m[3]}`.toLowerCase();
    map.set(pureId, f.replace(/\.md$/i, ''));
  }
  return map;
}

/** 详情文件 parent-tasks / parent-impl 迁移；返回新文本或 null（无变化）。 */
function migrateParentLinks(content, dirName) {
  const taskLink = `[[${dirName}/task|task]]`;
  const implLink = `[[${dirName}/implementation_plan|implementation_plan]]`;
  let changed = false;
  const out = content.replace(/^(parent-tasks:\s*\[)"\[\[task\]\]"(\])\s*$/m, (mm, a, b) => {
    changed = true;
    return `${a}"${taskLink}"${b}`;
  }).replace(/^(parent-impl:\s*\[)"\[\[implementation_plan\]\]"(\])\s*$/m, (mm, a, b) => {
    changed = true;
    return `${a}"${implLink}"${b}`;
  });
  return changed ? out : null;
}

/**
 * 索引/walkthrough 文本中的纯 ID wikilink 全名化；onlyBelowArchive 时仅迁 <!-- ARCHIVE --> 之后部分。
 * 返回 { text, count }。
 */
function migrateWikilinks(content, slugMap, onlyBelowArchive) {
  let head = '';
  let body = String(content);
  if (onlyBelowArchive) {
    const marker = body.match(/^<!-- ARCHIVE -->[ \t]*$/m);
    if (!marker) return { text: content, count: 0 };
    const cut = marker.index + marker[0].length;
    head = body.slice(0, cut);
    body = body.slice(cut);
  }
  let count = 0;
  const migrated = body.replace(/\[\[((?:chg|hotfix)-\d{8}-\d{2})\]\]/gi, (mm, id) => {
    const stem = slugMap.get(id.toLowerCase());
    if (!stem) return mm; // 旧无 slug 文件：保持纯 ID
    count += 1;
    return `[[${stem}|${id.toLowerCase()}]]`;
  });
  return { text: head + migrated, count };
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const includeActive = argv.includes('--include-active');
  const dirIdx = argv.indexOf('--artifact-dir');
  const artDir = dirIdx >= 0 ? path.resolve(argv[dirIdx + 1] || '') : '';
  if (!artDir || !fs.existsSync(path.join(artDir, 'changes'))) {
    console.error('用法: node migrate/fix-slug-wikilinks.js --artifact-dir <含 changes/ 的 artifact 根目录> [--dry-run] [--include-active]');
    process.exit(2);
  }
  const changesDir = path.join(artDir, 'changes');
  const dirName = path.basename(artDir.replace(/[\\/]+$/, ''));
  const slugMap = buildSlugMap(changesDir);
  const report = [];

  // 1) 详情文件 parent 链接
  for (const f of fs.readdirSync(changesDir)) {
    if (!DETAIL_RE.test(f)) continue;
    const fp = path.join(changesDir, f);
    const content = fs.readFileSync(fp, 'utf8');
    const next = migrateParentLinks(content, dirName);
    if (next) {
      report.push(`parent-links: changes/${f}`);
      if (!dryRun) fs.writeFileSync(fp, next, 'utf8');
    }
  }

  // 2) 索引文件（活跃区默认跳过）与 walkthrough（全文迁移）
  const targets = [
    { rel: 'task.md', onlyBelowArchive: !includeActive },
    { rel: 'implementation_plan.md', onlyBelowArchive: !includeActive },
    { rel: 'walkthrough.md', onlyBelowArchive: false },
  ];
  for (const t of targets) {
    const fp = path.join(artDir, t.rel);
    if (!fs.existsSync(fp)) continue;
    const content = fs.readFileSync(fp, 'utf8');
    const { text, count } = migrateWikilinks(content, slugMap, t.onlyBelowArchive);
    if (count > 0) {
      report.push(`wikilinks×${count}: ${t.rel}${t.onlyBelowArchive ? '（仅 ARCHIVE 下方）' : ''}`);
      if (!dryRun) fs.writeFileSync(fp, text, 'utf8');
    }
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}artifact-dir: ${artDir}`);
  console.log(`带 slug 详情文件: ${slugMap.size} 个`);
  if (report.length === 0) {
    console.log('无需迁移（已是目标形态或无匹配项）。');
  } else {
    for (const r of report) console.log(`${dryRun ? '将迁移' : '已迁移'} ${r}`);
  }
  if (!includeActive) {
    console.log('提示：task.md / implementation_plan.md 活跃区索引行未迁移（部署顺序约束）；plugin cache 含 T-001 解析层后用 --include-active 跑第二遍。');
  }
}

if (require.main === module) main();
module.exports = { buildSlugMap, migrateParentLinks, migrateWikilinks };
