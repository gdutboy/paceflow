// CHG-20260614-04：取值型 CLI flag 的下一 token peek（H-01 公共模式）。
// 合法值返回字符串；缺值——下一 token 缺失，或下一 token 以 - 开头（是另一个 flag）——返回 null，
// 由调用方计入 missingValue 并 fail-closed。杜绝裸 argv[++i] 把后续 flag 当值吞掉、或末尾缺值静默回落空串。
// 用法：const v = flagValue(argv, i); if (v === null) missing.push(arg); else { args.x = v; i++; }
function flagValue(argv, i) {
  const next = argv[i + 1];
  return (next === undefined || String(next).startsWith('-')) ? null : String(next);
}

module.exports = { flagValue };
