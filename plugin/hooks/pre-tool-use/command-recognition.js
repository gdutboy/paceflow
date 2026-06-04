// 共享命令识别原语：bash/powershell guard 共用的「段首锚点构造 / redirect 扫描 / 脚本引擎识别」。
// 这三个算法此前在 bash-guard.js 与 powershell-guard.js 各维护一份，靠手工移植，反复在锚点字符集、
// wrapper 剥离、单引号转义、引擎路径前缀等方向各漏一侧（审计 BG-01~04 / PSG-01~03）。抽成单一
// 参数化模块后，两侧 guard 只传数据（锚点字符集、转义字符、引擎集），算法只有一份，根治守卫
// 识别层「单点污染多分支 + 移植不对称」（CHG-20260604-01）。
'use strict';

// bash 命令包装器：在 mutating 动词前可合法出现的前缀命令。每项是匹配 wrapper 自身（不含尾随
// 空白）的正则源；segmentAnchorPrefix 统一在其后追加 `\s+` 并允许重复，以剥离任意层包装。
const BASH_WRAPPERS = [
  'env(?:\\s+\\w+=\\S*)*',   // env / env FOO=1 BAR=2
  'command',
  'sudo(?:\\s+-\\S+)*',      // sudo / sudo -n
  'time',
  'nohup',
  'busybox',
  'stdbuf(?:\\s+-\\S+)*',
  'nice(?:\\s+-\\S+)*',
];

// 脚本引擎默认集：可内联执行写文件代码的解释器。python\d* 覆盖 python / python3。
const DEFAULT_SCRIPT_ENGINES = ['node', 'python\\d*', 'deno', 'bun', 'ts-node'];

// 构造段首锚点正则片段：匹配「命令起始 ^ 或分隔符之后」的位置，并剥离任意层 wrapper 前缀。
// extraChars 是放进字符类的分隔符集合（如 '\\n;&|(){}'，覆盖换行/分组/&&/||）；wrappers 是
// wrapper 正则源数组；allowLoops=true 时把 `do` 也当 wrapper，覆盖 `for…; do <verb>` /
// `while…; do <verb>`（do 之前的 `;` 已被 extraChars 锚定）。返回值供调用方拼到动词正则前面，
// 例如 new RegExp(segmentAnchorPrefix(...) + 'rm\\b', 'i')。
function segmentAnchorPrefix(options = {}) {
  const { extraChars = '\\n;&|', wrappers = [], allowLoops = false } = options || {};
  const wrapperList = allowLoops ? wrappers.concat(['do']) : wrappers.slice();
  const wrapperPart = wrapperList.length ? `(?:(?:${wrapperList.join('|')})\\s+)*` : '';
  return `(?:^|[${extraChars}]\\s*)${wrapperPart}`;
}

// 扫描命令中的输出重定向目标（> / >> / >| 后的文件名）。逐字符状态机：
// - 单引号内字面（escapeChar 在单引号内不生效）——修 BG-03：单引号内反斜杠曾被无条件当转义，
//   吞掉闭合引号导致后续真实重定向漏检。
// - escapeChar 参数化：bash 用 '\\'，PowerShell 用 '`'；backtickIsQuote 区分反引号角色
//   （bash 反引号是命令替换引号，PowerShell 反引号是转义符）。
function scanRedirectTargets(command, options = {}) {
  const opts = typeof options === 'string' ? { escapeChar: options } : (options || {});
  const escapeChar = opts.escapeChar || '\\';
  const backtickIsQuote = opts.backtickIsQuote !== false;
  const c = String(command || '');
  const targets = [];
  let quote = null;
  let escaped = false;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (escaped) { escaped = false; continue; }
    if (ch === escapeChar && quote !== "'") { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || (backtickIsQuote && ch === '`')) { quote = ch; continue; }
    if (ch !== '>') continue;
    let j = i + 1;
    if (c[j] === '>') j++;       // >>
    if (c[j] === '|') j++;       // >| 强制覆盖
    while (/\s/.test(c[j] || '')) j++;
    if (!c[j] || c[j] === '&') continue;   // >& 是 fd 复制，非文件目标
    let target = '';
    if (c[j] === '"' || c[j] === "'") {
      const endQuote = c[j++];
      while (j < c.length && c[j] !== endQuote) target += c[j++];
    } else {
      while (j < c.length && !/[\s;&|<>]/.test(c[j])) target += c[j++];
    }
    if (target) {
      targets.push(target);
      i = j - 1;   // 跳过已消费的 redirect+target，避免 `>>` 被第二个 `>` 重复扫描
    }
  }
  return targets;
}

// 判定命令是否在段首调用脚本引擎（node/python/deno/bun/ts-node）。允许路径前缀（/usr/bin/node）
// 与 env 包装（env node、env FOO=1 python3）——修 BG-04：旧实现只匹配段首裸引擎名。
function commandRunsScriptEngine(command, options = {}) {
  const { anchorChars = '\\n;&|', engines = DEFAULT_SCRIPT_ENGINES } = options || {};
  const enginesAlt = engines.join('|');
  const re = new RegExp(`(?:^|[${anchorChars}]\\s*)(?:env(?:\\s+\\w+=\\S*)*\\s+)?(?:[^\\s;&|]*/)?(?:${enginesAlt})\\b`, 'i');
  return re.test(String(command || ''));
}

module.exports = {
  BASH_WRAPPERS,
  DEFAULT_SCRIPT_ENGINES,
  segmentAnchorPrefix,
  scanRedirectTargets,
  commandRunsScriptEngine,
};
