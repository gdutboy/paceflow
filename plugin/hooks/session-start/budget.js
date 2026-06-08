// session-start/budget.js — SessionStart 注入的「预算装配层」。
//
// 用途：assembleWithBudget(layers, { limitBytes }) 把 buildLayers 产出的分层文本块
//   按「四层优先级 + L3 优先截断」装配成最终注入字符串。
//
// CHG-B（四层预算策略）：head（l1head 项目上下文/工作流入口 + l0 我刚在做 + l1 git + l2）
//   永不截断；L3「相关经验与提醒」用剩余预算逐条装包，超出从尾部按条截断并附「已省略 N 条」footer。
//   截断方向相对旧实现反转——旧的全局字节守卫按 golden 顺序顺序截，会先砍最该留的动态上下文（L0/L1）；
//   现在 L3 先砍、head 永不截，信噪比优先。编排层的 installSessionOutputGuard 阀同步升到 128KB（CHG-B Step 3），
//   退化为「任何额外 write 的兜底」，正常装配已不触发。
'use strict';

/**
 * 把分层文本块按「head 永不截 + L3 优先截断」装配为最终注入字符串。
 *
 * @param {{ l1head?: string[], l0?: string[], l1?: string[], l2?: string[], l3?: string[] }} layers
 *   buildLayers 的产出。l1head 是注入顺序最前的「项目上下文/工作流入口/artifact 文件/格式」块；
 *   l0「我刚在做」/ l1 git / l2 工作流；l3「相关经验与提醒」是唯一可截层。各块字符串自带换行。
 * @param {{ limitBytes?: number }} [opts] - limitBytes 为总字节预算（默认 Infinity 不截）。
 *   head 永不截；L3 用 limitBytes − headBytes 的剩余预算逐条装，超出截断并标 truncated。
 * @returns {{ text: string, truncated: boolean }} text 是装配结果；truncated 表示 L3 是否被截。
 */
function assembleWithBudget(layers, opts) {
  const limitBytes = opts && Number.isFinite(opts.limitBytes) ? opts.limitBytes : Infinity;
  // head 永不截：l1head（项目上下文/工作流入口/格式）→ l0（我刚在做）→ l1（git）→ l2（工作流）。
  // 顺序复刻 golden（l1head→l0→l1→l2→l3），仅 L3 改为预算内逐条装。
  const head = [
    ...(layers.l1head || []),
    ...(layers.l0 || []),
    ...(layers.l1 || []),
    ...(layers.l2 || []),
  ];
  const headText = head.join('');
  const headBytes = Buffer.byteLength(headText, 'utf8');
  const remain = Math.max(0, limitBytes - headBytes);
  // L3「相关经验与提醒」用剩余预算逐条装包，超出即停，附「已省略 N 条」footer。
  const { kept, omitted } = packL3(layers.l3 || [], remain);
  let tail = kept.join('');
  if (omitted > 0) {
    tail += `\n=== 相关提醒已省略 ${omitted} 条（注入预算 ${limitBytes} bytes）===\n按需 Read 对应 artifact（findings.md / 相关讨论笔记）查看完整内容。\n`;
  }
  return { text: headText + tail, truncated: omitted > 0 };
}

/**
 * L3 逐条装包：按字节累加到 remainBytes，超出即停（保持原序、从尾部截），剩余计入 omitted。
 * 一旦某条超预算，其后所有条目都计 omitted（不跳过大条去装后面的小条——「从尾部按条截」语义）。
 * @param {string[]} items - L3 条目（各自带换行）
 * @param {number} remainBytes - head 之后的剩余预算字节
 * @returns {{ kept: string[], omitted: number }}
 */
function packL3(items, remainBytes) {
  const kept = [];
  let used = 0;
  let omitted = 0;
  for (const item of items) {
    const bytes = Buffer.byteLength(item, 'utf8');
    if (omitted === 0 && used + bytes <= remainBytes) {
      kept.push(item);
      used += bytes;
    } else {
      omitted++;
    }
  }
  return { kept, omitted };
}

module.exports = { assembleWithBudget };
