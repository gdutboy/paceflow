const path = require('path');

const HOOKS_DIR = path.resolve(__dirname, '..');

const PACE_VERSION = 'v6.0.60';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md', 'corrections.md'];
const MIGRATABLE_ARTIFACT_FILES = ARTIFACT_FILES.filter(file => file !== 'spec.md' && file !== 'corrections.md');
const VAULT_PATH = process.env.PACE_VAULT_PATH || '';
const ARTIFACT_ROOT_CHOICE_FILE = 'artifact-root';
const PROJECT_ROOT_FILE = 'project-root';
const V5_MIGRATION_STATE_FILE = 'v5-migration-state';
const ARTIFACT_WRITER_LOCK_FILE = 'artifact-writer.lock';
const ARTIFACT_WRITER_LOCK_TTL_MS = Number(process.env.PACE_ARTIFACT_LOCK_TTL_MS || 30 * 60 * 1000);
const ARTIFACT_RESOURCE_LOCK_TTL_MS = Math.max(1000, Number(process.env.PACE_ARTIFACT_RESOURCE_LOCK_TTL_MS || 5 * 60 * 1000) || 5 * 60 * 1000);
const ARTIFACT_RESOURCE_LOCK_WAIT_MS = Math.max(0, Number(process.env.PACE_ARTIFACT_RESOURCE_LOCK_WAIT_MS || 2500) || 2500);
const ARTIFACT_SEQUENCE_LOCK_TTL_MS = Math.max(1000, Number(process.env.PACE_ARTIFACT_SEQUENCE_LOCK_TTL_MS || 30 * 1000) || 30 * 1000);
const ARTIFACT_SEQUENCE_LOCK_WAIT_MS = Math.max(0, Number(process.env.PACE_ARTIFACT_SEQUENCE_LOCK_WAIT_MS || 2500) || 2500);
const PLAN_SYNC_LOCK_TTL_MS = ARTIFACT_SEQUENCE_LOCK_TTL_MS;
const PLAN_SYNC_LOCK_WAIT_MS = ARTIFACT_SEQUENCE_LOCK_WAIT_MS;
const CHANGE_OWNER_TTL_MS = Math.max(60 * 1000, Number(process.env.PACE_CHANGE_OWNER_TTL_MS || 30 * 60 * 1000) || 30 * 60 * 1000);
const ARTIFACT_ROOT_CHOICE_MAX_CHARS = 4096;
const RESERVE_ARTIFACT_ID_SCRIPT = path.resolve(HOOKS_DIR, 'reserve-artifact-id.js').replace(/\\/g, '/');
const SYNC_PLAN_SCRIPT = path.resolve(HOOKS_DIR, 'sync-plan.js').replace(/\\/g, '/');
const SET_ARTIFACT_ROOT_SCRIPT = path.resolve(HOOKS_DIR, 'set-artifact-root.js').replace(/\\/g, '/');
const SET_PROJECT_ROOT_SCRIPT = path.resolve(HOOKS_DIR, 'set-project-root.js').replace(/\\/g, '/');
const PACE_ARTIFACT_ROOT_CONTENT = 'spec.md / task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**';

const ARCHIVE_MARKER = '<!-- ARCHIVE -->';
const ARCHIVE_PATTERN = /^<!-- ARCHIVE -->\r?$/m;
const COMPLETION_PHRASES = /(?:任务完成|已完成所有|全部完成|归档完毕)/;

const SKILL_DIRS = [
  'pace-workflow',
  'artifact-management',
  'pace-knowledge',
  'pace-bridge',
];

const FORMAT_SNIPPETS = {
  taskEntry: '- [ ] [[chg-YYYYMMDD-NN]] 变更标题 #change [tasks:: T-001~T-003] [worktree:: main] [branch:: main]',
  taskGroup: '任务详情不写入 task.md。请派 artifact-writer create-chg 创建 changes/chg-YYYYMMDD-NN.md，并同步 task.md / implementation_plan.md 索引。',
  implIndex: '- [/] [[chg-YYYYMMDD-NN]] 变更标题 #change [tasks:: T-001~T-003] [worktree:: main] [branch:: main]',
  implDetail: 'v6 详情文件在 changes/chg-YYYYMMDD-NN.md；implementation_plan.md 只保留 wikilink 索引。',
  approved: '<!-- APPROVED --> 位于 changes/<id>.md 的任务清单之后；approve/approve-and-start 都必须带 approval-confirmed、approval-source、approval-evidence',
  verified: '<!-- VERIFIED --> 紧邻 changes/<id>.md 内 <!-- APPROVED --> 下一行；主路径是验证结果已读取后 close-chg，暂不归档时才用 update-chg action=verify',
  statusHelp: '[ ] 未开始 | [/] 进行中 | [x] 完成 | [!] 暂停/阻塞 | [-] 跳过',
  changeStatusHelp: '[ ] 规划中 | [/] 进行中 | [x] 完成 | [-] 废弃 | [!] 暂停/阻塞',
  formatRule: 'hook 检测格式为行首 "- [/] "（Markdown checkbox），表格或 emoji 格式无法识别',
  approveAndStartOp: '批准并开始 = 派 artifact-writer approve-and-start；字段格式见 Skill(paceflow:artifact-management)',
  closeOp: '收尾 = 先运行并读取验证结果；通过后派 artifact-writer close-chg；字段格式见 Skill(paceflow:artifact-management)',
  reserveHelper: `预留编号 = 主 session 先运行 Bash: node "${RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg，并把输出原样放到 artifact-writer prompt 顶部`,
  syncPlanHelper: `同步 plan = 桥接成功后运行 Bash: node "${SYNC_PLAN_SCRIPT}" --plan "<已桥接 plan 绝对路径>"`,
  setArtifactRootHelper: `选择 artifact root = 用户选择后运行 Bash: node "${SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
  setProjectRootHelper: `声明独立 Project Root = 在子目录 cwd 运行 Bash: node "${SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
  archiveOp: '归档 = 派 artifact-writer archive-chg：详情 status→archived，task.md / implementation_plan.md 的索引行移动到 ARCHIVE 下方',
  findingsFormat: '- [状态] [[finding-id|标题]] — 摘要 [date:: YYYY-MM-DD] [impact:: P0-P3]',
  findingsDetail: 'finding 详情写入 changes/findings/<id>.md；findings.md 只保留摘要索引。',
  walkthroughDetail: '| YYYY-MM-DD | [[chg-YYYYMMDD-NN]] 完成摘要 [worktree:: main] [branch:: main] | CHG-YYYYMMDD-NN |',
  skillRef: '流程参考：先调用 Skill(paceflow:pace-workflow)；artifact/CHG 字段格式参考 Skill(paceflow:artifact-management)',
};

const SESSION_SCOPED_FLAGS = [
  'degraded',
  'task-list-used',
  'todowrite-used',
  'archive-reminded',
  'findings-reminded',
  'impl-archive-reminded',
  'cli-refresh-done',
  'walkthrough-archive-reminded',
  'findings-archive-reminded',
];

const SESSION_SCOPED_FLAG_PREFIXES = [
  'archive-reminded-',
  'status-mismatch-',
  'verify-missing-',
  'blocked-tasks-',
  'post-continue-',
];

const PLAN_DIRS = ['docs/plans', 'docs/superpowers/plans'];

module.exports = {
  PACE_VERSION,
  CODE_EXTS,
  ARTIFACT_FILES,
  MIGRATABLE_ARTIFACT_FILES,
  VAULT_PATH,
  ARTIFACT_ROOT_CHOICE_FILE,
  PROJECT_ROOT_FILE,
  V5_MIGRATION_STATE_FILE,
  ARTIFACT_WRITER_LOCK_FILE,
  ARTIFACT_WRITER_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_WAIT_MS,
  ARTIFACT_SEQUENCE_LOCK_TTL_MS,
  ARTIFACT_SEQUENCE_LOCK_WAIT_MS,
  PLAN_SYNC_LOCK_TTL_MS,
  PLAN_SYNC_LOCK_WAIT_MS,
  CHANGE_OWNER_TTL_MS,
  ARTIFACT_ROOT_CHOICE_MAX_CHARS,
  RESERVE_ARTIFACT_ID_SCRIPT,
  SYNC_PLAN_SCRIPT,
  SET_ARTIFACT_ROOT_SCRIPT,
  SET_PROJECT_ROOT_SCRIPT,
  PACE_ARTIFACT_ROOT_CONTENT,
  ARCHIVE_MARKER,
  ARCHIVE_PATTERN,
  COMPLETION_PHRASES,
  SKILL_DIRS,
  FORMAT_SNIPPETS,
  SESSION_SCOPED_FLAGS,
  SESSION_SCOPED_FLAG_PREFIXES,
  PLAN_DIRS,
};
