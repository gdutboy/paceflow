/**
 * fixture-setup.js
 *
 * 把 fixtures/<name>/ 的内容拷贝到临时 vault 目录，并写入 case.setup.pre_files（如有）。
 * 变量替换：{TODAY} / {DATE_UPPER} / {ISO_DATE} / {ISO_DATETIME}。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');

function buildVariables(extra = {}) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const today = `${yyyy}${mm}${dd}`;
  const isoDate = `${yyyy}-${mm}-${dd}`;
  const isoDatetime = `${isoDate}T${hh}:${mi}:${ss}+08:00`;

  return {
    TODAY: today,
    DATE_UPPER: today,
    ISO_DATE: isoDate,
    ISO_DATETIME: isoDatetime,
    ...extra,
  };
}

function renderVariables(template, variables) {
  if (typeof template !== 'string') return template;
  let out = template;
  for (const [k, v] of Object.entries(variables)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
  }
  return out;
}

function copyFixture(fixtureName, targetDir) {
  const src = path.join(FIXTURES_ROOT, fixtureName);
  if (!fs.existsSync(src)) {
    throw new Error(`Fixture not found: ${src}`);
  }
  if (fs.existsSync(targetDir)) {
    execSync(`rm -rf "${targetDir}"`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  execSync(`cp -r "${src}/." "${targetDir}/"`);
}

/**
 * @param {string} fixtureName  fixtures/ 子目录名
 * @param {string} targetDir    临时 vault 路径（绝对路径）
 * @param {Array<{path:string,content:string}>} preFiles  可选的预置文件
 * @param {object} extraVars    额外变量（覆盖默认）
 * @param {object} caseSetupVars  case.setup.variables（其中可能含 "{TODAY}" 等占位符，需二次渲染合入）
 * @returns {{ targetDir: string, variables: object }}
 */
function setup(fixtureName, targetDir, preFiles = [], extraVars = {}, caseSetupVars = {}) {
  const variables = buildVariables(extraVars);

  // case.setup.variables 中的字段（如 date: "{TODAY}"）渲染后合入 variables
  for (const [k, v] of Object.entries(caseSetupVars)) {
    variables[k] = typeof v === 'string' ? renderVariables(v, variables) : v;
  }

  copyFixture(fixtureName, targetDir);

  for (const pf of preFiles) {
    const renderedPath = renderVariables(pf.path, variables);
    const renderedContent = renderVariables(pf.content, variables);
    const fullPath = path.join(targetDir, renderedPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, renderedContent, 'utf8');
  }

  return { targetDir, variables };
}

module.exports = { setup, buildVariables, renderVariables };
