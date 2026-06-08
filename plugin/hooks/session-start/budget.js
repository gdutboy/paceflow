// session-start/budget.js — SessionStart 注入的「预算装配层」。
//
// 用途：assembleWithBudget(layers, { limitBytes }) 把 buildLayers 产出的四层文本块
//   装配成最终注入字符串。
//
// CHG-A（等价装配）：本阶段复刻重构前「按 golden 顺序拼接 + 全局字节守卫单点截断」的行为。
//   重构前各 section 逐个 process.stdout.write，全局 installSessionOutputGuard 累计字节、
//   超 SESSION_OUTPUT_BUDGET_BYTES 截断。这里把所有层按 golden 顺序拼成一个字符串，
//   交回编排层经同一字节守卫单次 write —— 字节边界与逐段 write 完全一致（守卫按累计字节截，
//   与 write 分块无关）。
//   注意：CHG-A 不做「L3 优先截断 / L0-L2 永不截」；那是 CHG-B（届时本函数内部实现演进、
//   签名 (layers, {limitBytes}) 不变）。
'use strict';

/**
 * 把四层文本块按 golden 顺序拼接为最终注入字符串（CHG-A 等价装配）。
 *
 * @param {{ l1head?: string[], l0?: string[], l1?: string[], l2?: string[], l3?: string[] }} layers
 *   buildLayers 的产出。l1head 是注入顺序最前的「项目上下文/工作流入口/artifact 文件/格式」块；
 *   l0/l1/l2/l3 为四层。CHG-A 拼接顺序复刻 golden：l1head → l0 → l1 → l2 → l3。
 * @param {{ limitBytes?: number }} [opts] - limitBytes 仅作占位（CHG-A 截断由编排层全局字节守卫负责）。
 * @returns {{ text: string, truncated: boolean }} text 是拼接结果；truncated 恒 false
 *   （实际截断由全局守卫在 write 时判定并标记）。
 */
function assembleWithBudget(layers, opts) {
  const all = [
    ...(layers.l1head || []),
    ...(layers.l0 || []),
    ...(layers.l1 || []),
    ...(layers.l2 || []),
    ...(layers.l3 || []),
  ];
  // CHG-A：各 section 字符串已自带换行（复刻重构前逐 write 内容），直接顺序拼接即字节等价。
  const text = all.join('');
  return { text, truncated: false };
}

module.exports = { assembleWithBudget };
