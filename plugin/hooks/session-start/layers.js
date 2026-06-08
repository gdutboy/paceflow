// session-start/layers.js — SessionStart 注入的「内容生成纯函数层」。
//
// 用途：buildLayers(state, eventType) 把 collectState 产出的纯数据渲染成四层文本块
//   { l0, l1, l2, l3 }（每层是 string[]）。本模块是纯函数：无 I/O、无 process、无 Date.now、
//   无写盘。可喂 fixture state 单测。
//
// 设计（CHG-A 等价重构）：本 CHG 严格只做「搬运 + 归类」，不改注入内容/顺序/对称。
//   各 section 的文本逐字复刻重构前 session-start.js 对应 process.stdout.write 的内容；
//   拼接顺序由 budget.js 的 assembleWithBudget 复刻 golden 基准。四层归类是为后续
//   CHG-B/C/D 的优先级/截断/对称演进预留结构，本 CHG 不依赖归类改变输出。
//
// 字节等价要点：每个 section 函数返回的字符串与重构前对应 write 调用的拼接完全一致
//   （含换行、空行、全角标点）。budget.assembleWithBudget 按 golden 顺序拼接所有层 →
//   经全局字节守卫单次输出 → 与逐段 write 字节一致。
'use strict';

// 共享的 UTF-8 字节截断（与 session-start.js / pace-utils 同算法），供 per-file 兜底截断使用。
function sliceUtf8ToBytes(str, maxBytes) {
  if (maxBytes <= 0) return '';
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(str.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo);
}

// 活跃 CHG 展示排序档位：running（正在执行）最前 → closing-required（待收尾）→ 其余（backlog/ready/blocked）。
function rankChangeCategory(category) {
  if (category === 'running') return 0;
  if (category === 'closing-required') return 1;
  return 2;
}

// 从 change-set-seq（"i/N"）提取分子 i 用于排序；无法解析回退 0。
function changeSetSeqNum(seq) {
  const m = String(seq || '').match(/^(\d+)\s*\//);
  return m ? Number(m[1]) : 0;
}

/**
 * 把 state 渲染成四层注入文本块。纯函数，无副作用。
 *
 * @param {object} state - collectState 产出的纯数据对象。
 * @param {string} eventType - SessionStart 事件类型（'startup' / 'compact' / ...）。
 * @param {object} paceUtils - pace-utils 模块（提供常量/正则/纯工具，依赖注入便于单测）。
 * @param {string} [group] - 渲染分组：'core'（默认）或 'artifact'。
 *   - core：项目上下文 / 工作流入口 / compact 快照 / Native Plan / rootChoice / Artifact 目录 /
 *           活跃 CHG 摘要 / change-set 进度 / 格式合规警告 / 跨会话提醒 / 执行上下文 /
 *           Findings 过期提醒 / git 状态 / 相关讨论
 *   - artifact：spec / task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md
 * @returns {{ l1head: string[], l0: string[], l1: string[], l2: string[], l3: string[] }}
 *   - l1head: 项目上下文 + 工作流入口 + Artifact 目录 + artifact 文件 + 格式警告（注入顺序最前）
 *   - l0: 活跃 CHG 摘要 / change-set 进度 / 跨会话提醒 / 桥接 / 执行上下文（「我刚才在做」）
 *   - l1: git 状态
 *   - l2: （CHG-A 占位，工作流入口本 CHG 仍在 l1head 复刻原位）
 *   - l3: findings 过期提醒 / 相关讨论
 *   注：CHG-A 为保 byte 等价，分层只做归类、拼接顺序仍复刻 golden（见 budget.js）。
 */
function buildLayers(state, eventType, paceUtils, group) {
  // 渲染分组守卫：仅 'artifact' 为 artifact group，其余（含未传/非法值）显式回落 'core'。
  // 用显式三元而非 `group || 'core'`——否则非法真值（如 'bogus'）会令 isCore/isArtifact 双 false、输出空注入（R 审计发现 D）。
  const g = group === 'artifact' ? 'artifact' : 'core';
  const isCore = g === 'core';
  const isArtifact = g === 'artifact';
  const ev = eventType || state.eventType;
  // B5 + 倒序对称（HOTFIX-20260608-01）：活跃 CHG 展示顺序规范化——running 优先 → 同档 CHG-ID 升序。
  // summarizeActiveChanges 继承 task.md 活跃区物理顺序（batch create prepend 致创建倒序 08→05），
  // 此处稳定排序修正，使「正在执行的」「下一个该 approve-and-start 的」排最前；惠及下游消费点
  // （活跃 CHG 摘要 / 执行上下文）。change-set 进度另按纯 seq 升序（见 renderChangeSetProgress）。
  // 浅拷贝 state 替换排序后副本，不 mutate 输入，保持纯函数。
  // B5 + 倒序对称：活跃 CHG 排序（running 优先 → 同档 CHG-ID 升序）。
  // 浅拷贝 state 替换排序后副本，不 mutate 输入，保持纯函数。
  if (state.activeChangeSummaries && state.activeChangeSummaries.length > 1) {
    state = {
      ...state,
      activeChangeSummaries: [...state.activeChangeSummaries].sort((a, b) =>
        rankChangeCategory(a.category) - rankChangeCategory(b.category)
        || String(a.id).localeCompare(String(b.id))),
    };
  }
  const l1head = [];
  const l0 = [];
  const l1 = [];
  const l2 = [];
  const l3 = [];

  // ── core 块：项目骨架（每次 session 固定需要）──────────────────────────────
  if (isCore) {
    // === 1. 项目上下文（重构前 137-139 + writeProjectContextSection 104-119）===
    const projCtx = renderProjectContext(state, paceUtils);
    if (projCtx) l1head.push(projCtx);

    // === 2. 工作流入口（重构前 141-144 + writeWorkflowEntrySection 122-134）===
    //   仅 paceSignal && !rootChoicePending && eventType !== 'compact'（A0 对称留 CHG-C）。
    const workflowEntry = renderWorkflowEntry(state, ev, paceUtils);
    if (workflowEntry) l1head.push(workflowEntry);

    // === 3. compact 快照恢复（重构前 174-261）===
    //   注：本 CHG 保留快照消费的注入文本；写盘（W7/W8/W9）在 runtime-effects。
    //   快照恢复的「读快照 + 注入」逻辑因含 .pace 读取，由编排层在 collectState 外单独处理并传入。
    const compactSnapshotText = state.compactSnapshotText || '';
    if (compactSnapshotText) l1head.push(compactSnapshotText);

    // === 4. Native Plan 桥接提醒（重构前 264-273），仅 eventType !== 'compact' ===
    const nativePlanReminder = renderNativePlanReminder(state, ev);
    if (nativePlanReminder) l1head.push(nativePlanReminder);

    // === 5. rootChoicePending 启用提示（重构前 282-300）===
    const rootChoicePrompt = state.rootChoicePromptText || '';
    if (rootChoicePrompt) l1head.push(rootChoicePrompt);

    // === 6. Artifact 目录（重构前 404-407 writeArtifactDirSection）===
    //   仅 paceSignal && task.md 存在时在此位置注入。
    if (state.artifactDirInjected) {
      l1head.push(renderArtifactDirSection(state));
    }
  }

  // ── artifact 块：增长性文件（spec / task / impl / walkthrough / findings / corrections）──
  // renderArtifactFiles 在两个 group 都需要调用，但 push 进 l1head 只在 isArtifact 时执行。
  // isCore 时 found 为 []（state.artifactFiles 由 collectState 按 group 过滤，见 T-004），
  // 此处渲染层已保证 core 不注入 artifact 文件块。
  const filesRender = renderArtifactFiles(state, paceUtils);
  if (isArtifact) {
    // === 7. artifact 文件循环（重构前 416-593）===
    for (const block of filesRender.blocks) l1head.push(block);

    // === 10. 格式合规警告（重构前 638-672）===
    // R 审计发现 A 修正：renderFormatWarnings 依赖 found（artifact 文件）+ implFullForFormat（artifact 读），
    // 必须与数据同 group。T-003 误放 core 块致 core found 恒空、双 hook 后 artifact 块又不渲染 → 格式警告全 group 丢失。
    const formatWarn = renderFormatWarnings(state, filesRender.found, paceUtils);
    if (formatWarn) l1head.push(formatWarn);
  }
  // found（含 post-截断长度）回挂 state，供编排层 INJECT 日志的 files 字段复刻重构前 found.join。
  state._found = filesRender.found;

  if (isCore) {
    // === 8. 活跃 CHG 摘要 + change-set 进度（重构前 595-629）===
    if (state.paceSignal === 'artifact') {
      const activeChgText = renderActiveChangeSummary(state);
      if (activeChgText) l0.push(activeChgText);
      const changeSetText = renderChangeSetProgress(state);
      if (changeSetText) l0.push(changeSetText);
    }

    // === 9. Artifact 目录兜底（重构前 634-636：found>0 && !artifactDirInjected）===
    // core group 时 filesRender.found 由 T-004 保证为空（artifact IO 跳过），不触发。
    // 此处保留逻辑完整性，兼容 collectState 全量读取时 core group 的安全守卫。
    if (filesRender.found.length > 0 && !state.artifactDirInjected) {
      l1head.push(renderArtifactDirSection(state));
    }

    // === 11. 跨会话提醒 + 桥接 + 执行上下文（重构前 674-755）===
    const crossSession = renderCrossSessionAndExecution(state, paceUtils);
    for (const block of crossSession) l0.push(block);

    // === 12. Git 状态（重构前 790-799）===
    const gitText = renderGit(state);
    if (gitText) l1.push(gitText);

    // === 13. 相关讨论（重构前 801-813）===
    const relatedText = renderRelatedNotes(state, ev);
    if (relatedText) l3.push(relatedText);

    // === 14. Findings 过期提醒（重构前 757-787）===
    // R 审计发现 B 修正：agedFindings 留 core group。其渲染依赖 W12 flag（findings-age）去重，
    // 而 W12 flag 当前写在 core 的 applyRuntimeEffects——渲染 group 必须与 flag 写 group 一致，
    // 否则 core 写 flag → artifact 读到已存在 → 不注入（发现 B2 时序割裂）。CHG-11/T-006 会把
    // agedFindings 渲染+读取+W12 flag 整体移 artifact，届时三者一致；本 CHG 阶段三者全留 core。
    const agedText = renderAgedFindings(state);
    if (agedText) l3.push(agedText);
  }

  return { l1head, l0, l1, l2, l3 };
}

// ============================================================================
// 各 section 渲染函数：返回字符串（含尾部换行），与重构前对应 write 调用逐字一致。
// ============================================================================

/** 项目上下文 section（重构前 writeProjectContextSection + 触发条件 137）。 */
function renderProjectContext(state, paceUtils) {
  const { paceSignal, rootChoicePending } = state;
  const { rootInfo, contextArtDir } = state.projectContext;
  const cwd = state.cwd;
  // 触发：paceSignal || rootChoicePending || mode==='inherited'
  if (!(paceSignal || rootChoicePending || rootInfo.mode === 'inherited')) return '';
  const lines = [
    '=== PACEflow 项目上下文 ===',
    `Current CWD: ${cwd.replace(/\\/g, '/')}`,
    `Project Root: ${rootInfo.projectRoot.replace(/\\/g, '/')}`,
    `Artifact Root: ${paceUtils.displayDir(contextArtDir)}`,
    `Runtime Root: ${rootInfo.runtimeRoot.replace(/\\/g, '/')}`,
    `模式: ${projectContextMode(rootInfo)}（mode=${rootInfo.mode}）`,
  ];
  if (rootInfo.mode === 'inherited') {
    lines.push(`若这是独立子项目，先运行：node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`);
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

/** 项目上下文 mode 文案（重构前 projectContextMode 96-102）。 */
function projectContextMode(rootInfo) {
  if (rootInfo.mode === 'inherited') return '继承父级 PACEflow 项目';
  if (rootInfo.mode === 'independent') return '当前 cwd 是 independent Project Root';
  if (rootInfo.mode === 'worktree') return 'git worktree 共享宿主 Project Root';
  if (rootInfo.mode === 'disabled') return '当前 Project Root 已禁用 PACEflow';
  return '当前 cwd 作为 Project Root';
}

/** 工作流入口 section（重构前 writeWorkflowEntrySection + 触发条件 141-144）。 */
function renderWorkflowEntry(state, eventType, paceUtils) {
  const { paceSignal, rootChoicePending, v5MigrationInfo } = state;
  if (!(paceSignal && !rootChoicePending && eventType !== 'compact')) return '';
  const reason = v5MigrationInfo.detected ? 'legacy-v5' : String(paceSignal);
  const lines = [
    '=== PACEflow 工作流入口 ===',
    `信号: ${reason}`,
    '收到实现、迁移、CHG、验证或归档任务时，先调用 Skill(paceflow:pace-workflow)。',
    '涉及 artifact/CHG 字段、任务状态、批准、验证或归档时，再调用 Skill(paceflow:artifact-management)。',
    `artifact-root helper: node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    `独立子项目 helper: node "${paceUtils.SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    `预留编号 helper: node "${paceUtils.RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg`,
    'reserve helper 从当前项目 cwd 和 .pace/artifact-root 解析 artifact_dir；不要搜索 plugin cache，也不要传 --artifact-dir / --artifact-root / --project-dir。',
    '',
  ];
  return lines.join('\n') + '\n';
}

/** Native Plan 桥接提醒（重构前 264-273），仅 eventType !== 'compact' 且有未桥接 plan。 */
function renderNativePlanReminder(state, eventType) {
  if (eventType === 'compact') return '';
  const planPath = state.nativePlanPath;
  if (!planPath) return '';
  return `\n=== Native Plan 桥接提醒 ===\n`
    + `检测到未桥接的原生计划文件：${planPath}\n`
    + '请调用 Skill(paceflow:pace-bridge)，按该 skill 桥接为 v6 CHG 并记录同步标记。\n\n';
}

/** Artifact 目录 section（重构前 writeArtifactDirSection 315-327 的输出部分）。 */
function renderArtifactDirSection(state) {
  const ad = state.artifactDir;
  return `=== Artifact 目录 ===\n路径: ${ad.display}\n模式: ${ad.mode}\n仅用于 PaceFlow artifacts：${ad.content}。\nartifact-root helper: node "${ad.scripts.setArtifactRoot}" --choice local 或 --choice vault\n独立子项目 helper: node "${ad.scripts.setProjectRoot}" --mode independent\n预留编号 helper: node "${ad.scripts.reserveArtifactId}" --operation create-chg\nplan 同步 helper: node "${ad.scripts.syncPlan}" --plan "<已桥接 plan 绝对路径>"\n\n`;
}

/**
 * artifact 文件循环（重构前 416-593）：逐文件输出 `=== file ===` + 截断整形后内容。
 * @returns {{ blocks: string[], found: string[] }} blocks 是各文件的输出块；found 是 `file(len)` 列表。
 */
function renderArtifactFiles(state, paceUtils) {
  const {
    ARCHIVE_PATTERN, ARCHIVE_MARKER, ARCHIVE_REQUIRED_FILES, ARCHIVE_MISSING_INJECT_LIMIT,
  } = paceUtils;
  const blocks = [];
  const found = [];
  for (const { file, full } of state.artifactFiles) {
    let block = `=== ${file} ===\n`;
    const archiveMatch = full.match(ARCHIVE_PATTERN);
    let output;
    if (archiveMatch) {
      output = full.slice(0, archiveMatch.index);
    } else if (ARCHIVE_REQUIRED_FILES.includes(file) && Buffer.byteLength(full, 'utf8') > ARCHIVE_MISSING_INJECT_LIMIT) {
      // 层2：应有 ARCHIVE 的双区文件缺标记且超限 → 截断兜底，防全文灌爆 context。
      const archiveFooter = `\n\n（⚠️ ${file} 缺少 <!-- ARCHIVE --> 标记，已截断注入以防全文灌爆 context；请派 artifact-writer 修复双区结构）\n`;
      output = sliceUtf8ToBytes(full, Math.max(0, ARCHIVE_MISSING_INJECT_LIMIT - Buffer.byteLength(archiveFooter, 'utf8')))
        + archiveFooter;
    } else {
      output = full;
    }

    // spec.md 截断（重构前 440-447）。
    if (file === 'spec.md') {
      const depsMatch = output.match(/^## 依赖列表/m);
      if (depsMatch) {
        output = output.slice(0, depsMatch.index)
          + '\n\n（已省略依赖列表，需要时 Read spec.md）\n';
      }
    }

    // walkthrough.md 智能截断（重构前 449-503）。
    if (file === 'walkthrough.md') {
      output = truncateWalkthrough(output);
    }

    // findings.md 智能截断（重构前 505-557）。
    if (file === 'findings.md') {
      output = truncateFindings(output, state, paceUtils);
    }

    // implementation_plan.md 智能截断（重构前 559-586）。
    if (file === 'implementation_plan.md') {
      output = truncateImplPlan(output);
    }

    output = foldForeignOwnedArtifactOutput(file, output, state.activeChangeSummaries);
    if (archiveMatch) output += ARCHIVE_MARKER + '\n';
    block += output;
    block += '\n\n';
    blocks.push(block);
    found.push(`${file}(${output.length})`);
  }
  return { blocks, found };
}

/** walkthrough 索引表截断：保留最近 10 行 + 删除 v6 永不触发的详情段落处理（重构前 449-503）。 */
function truncateWalkthrough(output) {
  // 索引表截断：保留表头 + 最近 10 行数据行。
  const dataRe = /^\| \d{4}-\d{2}-\d{2} \|/gm;
  const dataRows = [];
  let m;
  while ((m = dataRe.exec(output)) !== null) {
    const lineStart = output.lastIndexOf('\n', m.index) + 1;
    const lineEnd = output.indexOf('\n', lineStart);
    const line = output.slice(lineStart, lineEnd >= 0 ? lineEnd : output.length);
    const date = (line.match(/^\| (\d{4}-\d{2}-\d{2}) \|/) || [])[1] || '';
    dataRows.push({ lineStart, lineEnd, line, date, index: dataRows.length });
  }
  if (dataRows.length > 10) {
    const omitted = dataRows.length - 10;
    const keep = new Set(dataRows
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
      .slice(0, 10)
      .map(row => row.index));
    const firstRowStart = dataRows[0].lineStart;
    const last = dataRows[dataRows.length - 1];
    const lastRowEnd = last.lineEnd >= 0 ? last.lineEnd : output.length;
    const keptLines = dataRows
      .filter(row => keep.has(row.index))
      .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
      .map(row => row.line);
    output = output.slice(0, firstRowStart)
      + keptLines.join('\n') + '\n'
      + `| ... | （已省略 ${omitted} 条旧记录，需要时 Read walkthrough.md） | | | |\n`
      + output.slice(lastRowEnd >= 0 ? lastRowEnd + 1 : output.length);
  }
  // 详情截断：保留最近 3 条 `## YYYY-MM-DD` 段落（重构前 481-502；v6 数据全表格时不触发）。
  const pos = [];
  const re = /^## \d{4}-\d{2}-\d{2}/gm;
  let m2;
  while ((m2 = re.exec(output)) !== null) pos.push(m2.index);
  if (pos.length > 3) {
    const sections = pos.map((start, index) => {
      const end = index + 1 < pos.length ? pos[index + 1] : output.length;
      const headerEnd = output.indexOf('\n', start);
      const header = output.slice(start, headerEnd >= 0 ? headerEnd : end);
      const date = (header.match(/^## (\d{4}-\d{2}-\d{2})/) || [])[1] || '';
      return { text: output.slice(start, end).trimEnd(), date, index };
    });
    const latest = sections
      .sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index)
      .slice(0, 3);
    output = output.slice(0, pos[0])
      + latest.map(section => section.text).join('\n')
      + `\n（已省略 ${pos.length - 3} 条旧详情，需要时 Read walkthrough.md）\n`;
  }
  return output;
}

/** findings 智能截断（重构前 505-557）：跳过 [x]/[-] 索引+详情，保留 open + Corrections。 */
function truncateFindings(output, state, paceUtils) {
  const { extractOpenKeys, normalizeFindingKey, logEntry } = paceUtils;
  // 跳过 [x]/[-] 索引行。
  const resolvedRe = /^- \[(?:x|-)\] .+$/gm;
  const resolvedCount = (output.match(resolvedRe) || []).length;
  if (resolvedCount > 0) {
    output = output.replace(resolvedRe, '');
    output = output.replace(/\n{3,}/g, '\n\n');
    const statusLine = output.match(/^\*\*状态说明\*\*/m);
    if (statusLine) {
      output = output.slice(0, statusLine.index)
        + `（已省略 ${resolvedCount} 条已解决索引，需要时 Read findings.md）\n\n`
        + output.slice(statusLine.index);
    }
  }
  // 跳过已解决详情段落（正向匹配保留 open 项详情）。
  const openKeys = extractOpenKeys(output);
  const totalDetails = (output.match(/^### \[\d{4}-\d{2}-\d{2}\]/gm) || []).length;
  if (totalDetails > 0 && totalDetails > openKeys.length) {
    const lines = output.split('\n');
    const result = [];
    let skip = false, cnt = 0, kept = 0;
    const skippedTitles = [];
    for (const l of lines) {
      const dm = l.match(/^### \[\d{4}-\d{2}-\d{2}\] (.+)/);
      if (dm) {
        const key = normalizeFindingKey(dm[1]);
        skip = !openKeys.includes(key);
        if (skip) { cnt++; skippedTitles.push(dm[1]); continue; }
        kept++;
      } else if (skip) {
        if (/^#{2,3} /.test(l)) skip = false;
        else continue;
      }
      result.push(l);
    }
    if (openKeys.length > 0 && kept === 0 && skippedTitles.length > 0) {
      state._logs = state._logs || [];
      state._logs.push(logEntry('SessionStart', 'FINDINGS_DETAIL_MATCH_MISS', {
        proj: state.proj,
        open: openKeys.length,
        skipped: skippedTitles.slice(0, 5).join('; '),
      }));
    }
    if (cnt > 0) {
      output = result.join('\n');
      const ci = output.match(/^## Corrections/m);
      const hint = `（已省略 ${cnt} 条已解决详情，需要时 Read findings.md）\n\n`;
      output = ci ? output.slice(0, ci.index) + hint + output.slice(ci.index) : output + '\n' + hint;
    }
  }
  return output;
}

/** impl_plan 智能截断（重构前 559-586）：只注入 [/]/[ ] 索引+详情，跳过 [x]/[-]。 */
function truncateImplPlan(output) {
  const skipIds = new Set();
  (output.match(/^- \[(?:x|-)\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/gm) || []).forEach(line => {
    const id = line.match(/((?:CHG|HOTFIX)-\d{8}-\d{2})/);
    if (id) skipIds.add(id[1]);
  });
  if (skipIds.size > 0) {
    const lines = output.split('\n');
    const result = [];
    let skip = false;
    for (const l of lines) {
      const im = l.match(/^- \[.\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/);
      if (im && skipIds.has(im[1])) continue;
      const dm = l.match(/^### ((?:CHG|HOTFIX)-\d{8}-\d{2})/);
      if (dm) {
        skip = skipIds.has(dm[1]);
        if (skip) continue;
      } else if (skip) {
        if (/^(?:### |## |<!-- )/.test(l)) skip = false;
        else continue;
      }
      result.push(l);
    }
    output = result.join('\n');
    output = output.replace(/(^## 变更索引)/m, `（已省略 ${skipIds.size} 条已完成变更）\n\n$1`);
  }
  return output;
}

// --- foreign owner 折叠（重构前 349-401）---

function isForeignSummary(summary) {
  return summary.ownerDisposition === 'foreign-fresh' || summary.ownerDisposition === 'foreign-stale';
}

function foreignOwnedSummariesForInjection(summaries) {
  return summaries.filter(s => isForeignSummary(s) && s.category !== 'inconsistent');
}

function lineReferencesChangeId(line, ids) {
  if (!line || !ids || ids.size === 0) return false;
  const re = /(?:\[\[((?:chg|hotfix)-\d{8}-\d{2})(?:\|[^\]]*)?\]\]|((?:CHG|HOTFIX)-\d{8}-\d{2}))/gi;
  let m;
  while ((m = re.exec(line)) !== null) {
    const id = String(m[1] || m[2] || '').toUpperCase();
    if (ids.has(id)) return true;
  }
  return false;
}

function appendForeignFoldNote(output, count) {
  if (count <= 0) return output;
  return `${output.trimEnd()}\n\n（已折叠 ${count} 个其他 worktree/session owner 的 CHG；见下方 owner 摘要。优先回到原 worktree/session；接手必须有用户明确指令与证据。）\n`;
}

function foldForeignOwnedArtifactOutput(file, output, summaries) {
  const foreignSummaries = foreignOwnedSummariesForInjection(summaries);
  if (foreignSummaries.length === 0) return output;
  const ids = new Set(foreignSummaries.map(s => s.id).filter(Boolean));
  if (ids.size === 0) return output;
  if (file === 'task.md') {
    const filtered = output.split('\n').filter(line => !lineReferencesChangeId(line, ids)).join('\n');
    return appendForeignFoldNote(filtered, ids.size);
  }
  if (file === 'implementation_plan.md') {
    const result = [];
    let skipping = false;
    for (const line of output.split('\n')) {
      const detail = line.match(/^###\s+(?:\[\[)?((?:CHG|HOTFIX)-\d{8}-\d{2})(?:\|[^\]]*)?(?:\]\])?(?=[\s:|-]|$)/i);
      if (detail && ids.has(detail[1].toUpperCase())) {
        skipping = true;
        continue;
      }
      if (skipping && /^(?:###\s+|##\s+|<!--\s*ARCHIVE\s*-->)/i.test(line)) {
        skipping = false;
      }
      if (skipping) continue;
      if (/^-\s+\[.\]/.test(line) && lineReferencesChangeId(line, ids)) continue;
      result.push(line);
    }
    return appendForeignFoldNote(result.join('\n'), ids.size);
  }
  return output;
}

// --- 活跃 CHG 摘要 owner 展示（重构前 341-347）---
function ownerDisplay(summary) {
  const parts = [summary.ownerDisposition || 'unknown'];
  if (summary.ownerWorktree) parts.push(`worktree=${summary.ownerWorktree}`);
  if (summary.ownerBranch) parts.push(`branch=${summary.ownerBranch}`);
  if (summary.ownerState) parts.push(`state=${summary.ownerState}`);
  return parts.join(' ');
}

/** 活跃 CHG 摘要 section（重构前 595-603）。 */
function renderActiveChangeSummary(state) {
  const summaries = state.activeChangeSummaries;
  if (!(summaries.length > 0)) return '';
  let out = `=== 活跃 CHG 摘要 ===\n`;
  for (const s of summaries) {
    out += `- ${s.id} category=${s.category} status=${s.status} owner=${ownerDisplay(s)} task=[${s.taskCheckbox || '?'}] impl=[${s.implCheckbox || '?'}] pending=${s.pending ?? '?'} approved=${s.approved} verified=${s.verified} reviewed=${s.reviewed}\n  ${s.path ? s.path.replace(/\\/g, '/') : 'missing detail'}\n`;
  }
  out += `继续、恢复或收口已有 CHG 前，先 Read 对应 changes/<id>.md，确认任务清单、实施详情和工作记录；本摘要只用于定位，不替代 CHG 详情。\n`;
  out += '\n';
  return out;
}

/** change-set 整体进度 section（重构前 605-629）。 */
function renderChangeSetProgress(state) {
  const summaries = state.activeChangeSummaries;
  const changeSetGroups = new Map();
  for (const s of summaries) {
    if (!s.changeSet || isForeignSummary(s)) continue;
    if (!changeSetGroups.has(s.changeSet)) changeSetGroups.set(s.changeSet, []);
    changeSetGroups.get(s.changeSet).push(s);
  }
  if (!(changeSetGroups.size > 0)) return '';
  let out = `=== change-set 整体进度 ===\n`;
  for (const [name, members] of changeSetGroups) {
    // change-set 进度按阶段序列展示（纯 change-set-seq 升序 → 同 stop.js 成组提醒对称），
    // 不沿用 buildLayers 的 running 优先排序——进度看的是「2/5, 3/5, 4/5, 5/5」阶段顺序。
    members.sort((a, b) =>
      changeSetSeqNum(a.changeSetSeq) - changeSetSeqNum(b.changeSetSeq)
      || String(a.id).localeCompare(String(b.id)));
    const totals = [...new Set(members
      .map(m => { const mm = String(m.changeSetSeq || '').match(/\/(\d+)/); return mm ? Number(mm[1]) : 0; })
      .filter(t => t > 0))];
    const seqs = members.map(m => m.changeSetSeq || m.id).join(', ');
    const totalSuffix = (totals.length === 1 && members.length > 1) ? `，变更集共 ${totals[0]} 个` : '';
    out += `- change-set ${name}：还有 ${members.length} 个待执行（${seqs}）${totalSuffix}\n`;
  }
  out += `一个 change-set 是一组规划好的可闭环 CHG；逐个 approve-and-start 执行，勿遗漏后续阶段。\n\n`;
  return out;
}

/** 格式合规警告 section（重构前 638-672）。 */
function renderFormatWarnings(state, found, paceUtils) {
  const { ARCHIVE_PATTERN, ARCHIVE_MARKER, FORMAT_SNIPPETS, detectLegacyImplFormat } = paceUtils;
  if (!(state.paceSignal && found.length > 0)) return '';
  const formatWarnings = [];
  const implFull = state.implFullForFormat;
  if (implFull) {
    const implArchiveM = implFull.match(ARCHIVE_PATTERN);
    const implActive = implArchiveM ? implFull.slice(0, implArchiveM.index) : implFull;
    const { hasEmoji, hasTable } = detectLegacyImplFormat(implActive);
    if (hasEmoji) {
      formatWarnings.push(`implementation_plan.md 使用了 emoji 状态标记，当前索引解析无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    if (hasTable) {
      formatWarnings.push(`implementation_plan.md 使用了表格格式，当前索引解析无法识别。${FORMAT_SNIPPETS.formatRule}\n正确格式：${FORMAT_SNIPPETS.implIndex}`);
    }
    const archiveCount = (implFull.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (archiveCount > 1) {
      formatWarnings.push(`implementation_plan.md 有 ${archiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），会导致活跃区识别错误。请删除多余的标记，只保留活跃区与归档区之间的那个`);
    }
  }
  if (state.taskFullCached) {
    const taskArchiveCount = (state.taskFullCached.match(new RegExp(ARCHIVE_PATTERN.source, 'gm')) || []).length;
    if (taskArchiveCount > 1) {
      formatWarnings.push(`task.md 有 ${taskArchiveCount} 个 ${ARCHIVE_MARKER} 标记（应只有 1 个），会导致活跃区识别错误。请删除多余的标记，只保留活跃区与归档区之间的那个`);
    }
  }
  if (!(formatWarnings.length > 0)) return '';
  let out = `\n=== 格式合规警告 ===\n`;
  formatWarnings.forEach((w, i) => { out += `[${i + 1}] ${w}\n`; });
  out += `\n${FORMAT_SNIPPETS.skillRef}\n\n`;
  return out;
}

/**
 * 跨会话提醒 + 桥接 + 执行上下文（重构前 674-755）。
 * @returns {string[]} 各子 section 的文本块（按原顺序）。
 */
function renderCrossSessionAndExecution(state, paceUtils) {
  const { ARCHIVE_PATTERN, logEntry } = paceUtils;
  const blocks = [];
  if (!state.taskFullCached) return blocks;
  try {
    const taskFullCached = state.taskFullCached;
    const archMatch = taskFullCached.match(ARCHIVE_PATTERN);
    const active = archMatch ? taskFullCached.slice(0, archMatch.index) : taskFullCached;

    // 跳过任务提醒（重构前 685-692）。
    const skipped = active.match(/- \[-\] .+/g) || [];
    if (skipped.length > 0) {
      let out = `\n=== 跨会话提醒 ===\ntask.md 有 ${skipped.length} 个跳过的任务（[-]），请用 AskUserQuestion 询问用户这些跳过的任务是否需要重新开启或更新为 [x]：\n`;
      skipped.slice(-3).forEach(t => { out += `  ${t}\n`; });
      out += '\n';
      blocks.push(out);
      pushLog(state, logEntry('SessionStart', 'SKIPPED_REMINDER', { cwd: state.cwd, count: skipped.length }));
    }

    // Superpowers/native plan 桥接检测（重构前 694-706）。
    if (state.paceSignal) {
      const bridgeHint = state.bridgeHint;
      if (bridgeHint) {
        const hasActive = active && /- \[[ \/!]\]/.test(active);
        if (!hasActive) {
          let out = `\n=== Superpowers 桥接提醒 ===\n`;
          out += `检测到计划文件（${bridgeHint.fileList}）但 task.md 无活跃任务。\n`;
          out += `请在派 subagent 前执行桥接：${bridgeHint.bridgeSteps}\n\n`;
          blocks.push(out);
          pushLog(state, logEntry('SessionStart', 'SUPERPOWERS_BRIDGE_HINT', { cwd: state.cwd, plans: bridgeHint.fileList }));
        }
      }
    }

    // 执行上下文（重构前 708-753）。
    const currentCategories = new Set(['running']);
    const currentSessionSummaries = state.activeChangeSummaries.filter(s => !isForeignSummary(s));
    const blockedSessionSummaries = currentSessionSummaries.filter(s => s.category === 'blocked');
    const foreignProgressSummaries = foreignOwnedSummariesForInjection(state.activeChangeSummaries);
    const detailPending = state.activeChangeSummaries
      .filter(s => !isForeignSummary(s))
      .filter(s => currentCategories.has(s.category))
      .reduce((sum, s) => sum + (Number.isFinite(s.pending) ? s.pending : 0), 0);
    const hasCompleted = currentSessionSummaries.some(s => s.category === 'closing-required');
    const hasIndexPending = currentSessionSummaries.some(s => ['backlog', 'ready', 'running', 'blocked', 'closing-required'].includes(s.category));
    if (foreignProgressSummaries.length > 0) {
      let out = `\n=== 其他 worktree/session 活跃 CHG ===\n`;
      for (const s of foreignProgressSummaries.slice(0, 5)) {
        out += `- ${s.id} category=${s.category} owner=${ownerDisplay(s)} pending=${s.pending ?? '?'}\n`;
      }
      if (foreignProgressSummaries.length > 5) out += `- ... 另有 ${foreignProgressSummaries.length - 5} 个\n`;
      out += '这些 CHG 由其他 worktree/session 负责；当前 session 仅显示 owner 摘要。优先回到原 worktree/session，接手必须有用户明确指令与证据。\n\n';
      blocks.push(out);
      pushLog(state, logEntry('SessionStart', 'FOREIGN_CHANGE_OWNER_SUMMARY', {
        cwd: state.cwd,
        count: foreignProgressSummaries.length,
        changes: foreignProgressSummaries.slice(0, 5).map(s => s.id).join(','),
      }));
    }
    if (blockedSessionSummaries.length > 0) {
      let out = `\n=== 暂停/阻塞 CHG ===\n`;
      for (const s of blockedSessionSummaries.slice(0, 5)) {
        out += `- ${s.id} owner=${ownerDisplay(s)} blocked=${s.blocked ?? '?'} pending=${s.pending ?? '?'}\n`;
      }
      if (blockedSessionSummaries.length > 5) out += `- ... 另有 ${blockedSessionSummaries.length - 5} 个\n`;
      out += '这些 CHG 属于 deferred，不计入当前执行中的 T-NNN；恢复前先确认用户意图，必要时派 update-status 将任务重新标为 [/]。\n\n';
      blocks.push(out);
      pushLog(state, logEntry('SessionStart', 'BLOCKED_CHANGE_SUMMARY', {
        cwd: state.cwd,
        count: blockedSessionSummaries.length,
        changes: blockedSessionSummaries.slice(0, 5).map(s => s.id).join(','),
      }));
    }
    if (detailPending > 0) {
      blocks.push(`\n=== CHG 执行上下文 ===\nv6 任务权威是 changes/<id>.md 的 ## 任务清单；task.md 只是 CHG 索引。\n当前执行中的 CHG 有 ${detailPending} 个未完成 T-NNN；继续前先 Read 对应 changes/<id>.md。Claude 任务面板只是工作记忆，按需要使用。\n\n`);
    } else if (hasCompleted) {
      blocks.push(`\n=== CHG 执行上下文 ===\n活跃索引中有已完成/跳过变更待 close-chg；archive-chg 仅用于已 verified 的单独归档修复。\n\n`);
    } else if (hasIndexPending && state.paceSignal === 'artifact') {
      blocks.push(`\n=== CHG 执行上下文 ===\n当前没有执行中的未完成 T-NNN；backlog / ready / blocked 属于 deferred。Stop 会用可见提醒提示这些 deferred CHG。\n\n`);
    } else {
      blocks.push(`\n=== CHG 执行上下文 ===\n当前无活跃 CHG。\n\n`);
    }
  } catch (e) {}
  return blocks;
}

/** Findings 过期提醒 section（重构前 779-783 的输出部分；写 flag 留 effects）。 */
function renderAgedFindings(state) {
  const aged = state.agedFindings;
  if (!aged || !aged.shouldInject || !(aged.aged.length > 0)) return '';
  let out = `\n=== Findings 过期提醒 ===\n以下 findings 超过 14 天未流转，请决定采纳 [x] 或否定 [-]：\n`;
  aged.aged.forEach(f => { out += `  (${f.days}天) ${f.title}\n`; });
  out += '\n';
  return out;
}

/** Git 状态 section（重构前 790-799）。 */
function renderGit(state) {
  if (!state.git) return '';
  return `=== Git 状态 ===\n分支: ${state.git.branch}\n最近提交: ${state.git.lastCommit}\n\n`;
}

/** 相关讨论 section（重构前 801-813），startup 5 条 / compact 3 条。 */
function renderRelatedNotes(state, eventType) {
  const notes = state.relatedNotes;
  if (!(notes && notes.length > 0)) return '';
  const maxNotes = eventType === 'compact' ? 3 : 5;
  let out = `=== 相关讨论 (thoughts/ + knowledge/) ===\n`;
  notes.slice(0, maxNotes).forEach(n => {
    out += `[${n.status}] ${n.title}${n.summary ? ' — "' + n.summary + '"' : ''}\n`;
  });
  out += '\n';
  return out;
}

/**
 * compact 快照恢复注入文本（重构前 182-255）。纯函数：parsed snap + paceSignal → 字符串。
 *   写盘（W8 counter 恢复 / W9 删快照）不在此处，由 runtime-effects.js 负责。
 *
 * @param {object} snap - 已解析的合法 compact 快照对象。
 * @param {string|false} paceSignal - PACE 检测结果（决定是否注入格式速查/完成检查）。
 * @param {string} cwd - 项目工作目录（用于补充 native plan 检测；plan 路径由 state 预读传入）。
 * @param {string|null} nativePlanPath - 编排层预读的 getNativePlanPath(cwd) 结果。
 * @param {object} paceUtils - pace-utils 模块（FORMAT_SNIPPETS）。
 * @returns {string} compact 快照恢复注入文本（含尾部换行），与重构前逐 write 字节一致。
 */
function buildCompactSnapshotText(snap, paceSignal, cwd, nativePlanPath, paceUtils) {
  const { FORMAT_SNIPPETS } = paceUtils;
  let out = '';
  const lines = [`=== Compact 恢复（快照 ${snap.timestamp}）===`];
  if (snap.artifacts?.['task.md']?.inProgress?.length > 0) {
    lines.push('进行中任务:');
    snap.artifacts['task.md'].inProgress.forEach(t => lines.push(`  ${t}`));
  }
  if (snap.artifacts?.['task.md']?.pending > 0) {
    lines.push(`待办任务: ${snap.artifacts['task.md'].pending} 个`);
  }
  if (snap.activeChanges && snap.activeChanges.length > 0) {
    lines.push('活跃 CHG:');
    snap.activeChanges.forEach(c => {
      const owner = c.ownerDisposition
        ? ` owner=${[c.ownerDisposition, c.ownerWorktree ? `worktree=${c.ownerWorktree}` : '', c.ownerBranch ? `branch=${c.ownerBranch}` : '', c.ownerState ? `state=${c.ownerState}` : ''].filter(Boolean).join(' ')}`
        : '';
      lines.push(`  ${c.id} status=${c.status}${owner} pending=${c.pending} approved=${c.approved} verified=${c.verified} reviewed=${c.reviewed}`);
    });
  }
  if (snap.runtime?.degraded) {
    lines.push('Stop 检查上次仍有未解决项；本次会话会继续检查。');
  }
  // native plan 恢复提示（重构前 209-220；plan 路径由编排层预读传入，等价 getNativePlanPath）。
  const pendingNativePlans = new Set(Array.isArray(snap.nativePlans) ? snap.nativePlans : []);
  if (nativePlanPath) pendingNativePlans.add(nativePlanPath);
  if (pendingNativePlans.size > 0) {
    lines.push('');
    lines.push('检测到未桥接的原生计划文件：');
    Array.from(pendingNativePlans).forEach(p => lines.push(`  ${p}`));
    lines.push('请调用 Skill(paceflow:pace-bridge)，按该 skill 桥接为 v6 CHG 并记录同步标记。');
  }
  out += lines.join('\n') + '\n\n';
  // 格式快速参考 + CHG 完成检查（重构前 222-248）。
  if (paceSignal) {
    const formatLines = [
      '',
      '=== 格式快速参考 ===',
      `CHG 索引格式：${FORMAT_SNIPPETS.taskEntry}`,
      `实施索引格式：${FORMAT_SNIPPETS.implIndex}`,
      `任务状态：${FORMAT_SNIPPETS.statusHelp}`,
      `详情位置：changes/<id>.md`,
      `findings 格式：${FORMAT_SNIPPETS.findingsFormat}`,
      `walkthrough 索引：${FORMAT_SNIPPETS.walkthroughDetail}`,
      `批准标记：${FORMAT_SNIPPETS.approved}`,
      `验证标记：${FORMAT_SNIPPETS.verified}`,
      `审计标记：${FORMAT_SNIPPETS.reviewed}`,
      `impl_plan 规则：${FORMAT_SNIPPETS.implDetail}`,
      '',
      '=== CHG 完成检查（每个 CHG/HOTFIX 最后任务代码写完后立即执行）===',
      `1. 先运行验证并阅读结果；未读取结果前不要派 verify/close-chg`,
      `2. 验证通过后先做 R 审计：按本 CHG diff 自选 review agent 做对抗审计、路由 findings（P0/P1 开 HOTFIX 或记 won't-fix，P2/P3 派 record-finding）`,
      `3. 审计跑过后派 close-chg complete-open-tasks: true（含 review-confirmed/review-source/review-findings）— 收口最后任务、折叠 VERIFIED + REVIEWED、归档索引并写 walkthrough`,
      `4. 中间任务完成才用 update-status [x]；只记录验证/审计暂不归档才用 update-chg action=verify / action=review`,
      '5. spec.md — 同步技术栈变更（如有）',
      '',
    ];
    out += formatLines.join('\n') + '\n';
  }
  // snapshot.findings / walkthrough（重构前 249-255）。
  if (snap.findings) {
    out += `findings 状态：${snap.findings.openCount} 个开放项\n`;
  }
  if (snap.walkthrough && !snap.walkthrough.hasTodayEntry) {
    out += `⚠️ compact 前 walkthrough 无今日记录，请在完成任务后更新。${FORMAT_SNIPPETS.walkthroughDetail}\n`;
  }
  return out;
}

// --- 日志累积助手：layers 是纯函数，把要写的日志推进 state._logs，由编排层统一 flush ---
function pushLog(state, entry) {
  state._logs = state._logs || [];
  state._logs.push(entry);
}

module.exports = { buildLayers, buildCompactSnapshotText, sliceUtf8ToBytes, ownerDisplay, isForeignSummary };
