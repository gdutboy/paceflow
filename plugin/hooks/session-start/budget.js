// session-start/budget.js — SessionStart 注入的「预算装配层」。
//
// 用途：assembleWithBudget(layers, { limitChars }) 把 buildLayers 产出的分层文本块
//   按「四层优先级 + L3 优先截断」装配成最终注入字符串。
//
// CHG-B（四层预算策略）：head（l1head 项目上下文/工作流入口 + l0 我刚在做 + l1 git + l2）
//   永不截断；L3「相关经验与提醒」用剩余预算逐条装包，超出从尾部按条截断并附「已省略 N 条」footer。
//   截断方向相对旧实现反转——旧的全局字节守卫按 golden 顺序顺序截，会先砍最该留的动态上下文（L0/L1）；
//   现在 L3 先砍、head 永不截，信噪比优先。
//
// M1（chars 单位）：计量单位从 bytes 改为 chars（String.length），对齐 Claude Code
//   per-hook 10000 characters cap。中文字符 UTF-8 占 3 bytes 但仍算 1 char，
//   用 bytes 会过于保守；cap 单位是 chars，必须用 chars 计量才能准确利用预算。
'use strict';

/**
 * 把分层文本块按「head 永不截 + L3 优先截断」装配为最终注入字符串。
 *
 * @param {{ l1head?: string[], l0?: string[], l1?: string[], l2?: string[], l3?: string[] }} layers
 *   buildLayers 的产出。l1head 是注入顺序最前的「项目上下文/工作流入口/artifact 文件/格式」块；
 *   l0「我刚在做」/ l1 git / l2 工作流；l3「相关经验与提醒」是唯一可截层。各块字符串自带换行。
 * @param {{ limitChars?: number }} [opts] - limitChars 为总字符预算（默认 Infinity 不截）。
 *   使用 String.length（chars）对齐 Claude Code per-hook 10K characters cap。
 *   head 永不截；L3 用 limitChars − headChars 的剩余预算逐条装，超出截断并标 truncated。
 * @returns {{ text: string, truncated: boolean, headOverflow: boolean, headChars: number }}
 *   text 是装配结果；truncated 表示 L3 被截或 head 超限；headOverflow 表示 head 自身超 limitChars
 *   （head 仍全保留，仅作信号供 caller 记 OVER_BUDGET）；headChars 是 head 实际字符数。
 */
function assembleWithBudget(layers, opts) {
  const limitChars = opts && Number.isFinite(opts.limitChars) ? opts.limitChars : Infinity;
  // head 永不截：l1head（项目上下文/工作流入口/格式）→ l0（我刚在做）→ l1（git）→ l2（工作流）。
  // 顺序复刻 golden（l1head→l0→l1→l2→l3），仅 L3 改为预算内逐条装。
  const head = [
    ...(layers.l1head || []),
    ...(layers.l0 || []),
    ...(layers.l1 || []),
    ...(layers.l2 || []),
  ];
  const headText = head.join('');
  // 用 String.length 计 chars，对齐 Claude Code per-hook characters cap。
  // headOverflow（CHG-20260614-10）：head 永不截（CHG-B 信噪比优先），但 head 自身超 limit 时置信号，
  //   让 caller 记 OVER_BUDGET 日志——否则整段被 Claude persist 成 2KB preview、上下文恢复残废而无任何痕迹。
  //   根治在源头（layers 给活跃 CHG 摘要 header 加 count cap 防 l0 无界）；此信号是兜底可见性。
  const headOverflow = headText.length > limitChars;
  const remain = Math.max(0, limitChars - headText.length);
  // L3「相关经验与提醒」用剩余预算逐条装包，超出即停，附「已省略 N 条」footer。
  const { kept, omitted } = packL3(layers.l3 || [], remain);
  let tail = kept.join('');
  if (omitted > 0) {
    tail += `\n=== 相关提醒已省略 ${omitted} 条（注入预算 ${limitChars} chars）===\n按需 Read 对应 artifact（findings.md / 相关讨论笔记）查看完整内容。\n`;
  }
  return { text: headText + tail, truncated: omitted > 0 || headOverflow, headOverflow, headChars: headText.length };
}

/**
 * L3 逐条装包：按字符数（String.length）累加到 remainChars，超出即停（保持原序、从尾部截），剩余计入 omitted。
 * 一旦某条超预算，其后所有条目都计 omitted（不跳过大条去装后面的小条——「从尾部按条截」语义）。
 * @param {string[]} items - L3 条目（各自带换行）
 * @param {number} remainChars - head 之后的剩余预算字符数（String.length）
 * @returns {{ kept: string[], omitted: number }}
 */
function packL3(items, remainChars) {
  const kept = [];
  let used = 0;
  let omitted = 0;
  for (const item of items) {
    // 用 item.length 计 chars，与 assembleWithBudget 的 limitChars 单位一致。
    const c = item.length;
    if (omitted === 0 && used + c <= remainChars) {
      kept.push(item);
      used += c;
    } else {
      omitted++;
    }
  }
  return { kept, omitted };
}

module.exports = { assembleWithBudget };
