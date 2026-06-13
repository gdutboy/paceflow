# PACEflow Codex 审计：远端 origin/master

> 类型：Codex 审计
> 日期：2026-06-13
> 审计基线：`origin/master@52f3461`
> 范围：当前已经在远端的内容；本地未提交改动未纳入审计。

## 摘要

本次审计先刷新 `origin/master`，再用 `git archive origin/master` 导出干净副本，避免当前工作区未提交改动污染结论。远端当前 tracked 文件数：221；marketplace 发布入口为 `.claude-plugin/marketplace.json`，插件发布根为 `./plugin`。

自动化验证未发现红灯：

- `node tests/test-agent-tests-helpers.js`：9/9
- `node tests/test-pace-utils.js`：272/272
- `node tests/test-session-layers.js`：42/42
- `node tests/test-hooks-e2e.js`：389/389
- `node tests/test-migrate-v7.js`：12/12
- `node tests/agent-tests/run-tests.js dummy`：PASS
- `find . -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `bash -n tests/agent-tests/run-agent-cli-suite.sh`：PASS
- `claude plugin validate ./plugin`：PASS
- `git diff --check ed273d2..origin/master`：PASS
- JSON/manifest/hook 注册完整性脚本：`marketplace.json`、`plugin.json`、`hooks.json` 可解析；hook args、agent、command 引用文件均存在

注意：`tests/test-install.js` 不存在于远端 `origin/master`，不计入远端测试失败。

## 审计覆盖

- 远端基线：`origin/master@52f3461`。
- 发布入口：`.claude-plugin/marketplace.json`、`plugin/.claude-plugin/plugin.json`。
- 插件运行面：`plugin/hooks/**`、`plugin/commands/**`、`plugin/agents/**`、`plugin/agent-references/**`、`plugin/skills/**`、`plugin/migrate/migrate-v7.js`。
- 用户可见文档面：`README.md`、`REFERENCE.md`、`CHANGELOG.md`、`CLAUDE.md`、`CONTRIBUTING.md`，并扫描 `docs/**` 中与当前发布口径冲突的候选文本。
- 测试/验证面：tracked `tests/**` 与 `tests/agent-tests/**`，以及插件 manifest 校验。

## 确认发现

### P1. `migrate-v7` 静默忽略未知参数，误写 `--dryrun` 会直接执行迁移

证据：

- `plugin/migrate/migrate-v7.js:61-68` 的 `parseArgs` 只处理已知参数，未知参数没有 fail-fast。
- 最小复现中运行 `node plugin/migrate/migrate-v7.js --cwd <tmp> --dryrun`，输出为 `migrate-v7 【执行迁移】`，并实际改写 `implementation_plan.md`、写入 `.pace/v7-migration-state`。

影响：

用户误以为在 dry-run 预览，实际会执行迁移。虽然脚本有备份与验收还原机制，但这是迁移 CLI 的实质操作风险。

建议：

- `parseArgs` 对未知参数直接非零退出并打印 usage。
- 增加测试：`--dryrun` / `--cwd <dir> --bogus` 不得写盘。

### P1/P2. `migrate-v7` 对带引号的 archived/cancelled 状态不回填 `archived-date`

证据：

- `plugin/migrate/migrate-v7.js:145` 保存 `status` 原始字符串。
- `plugin/migrate/migrate-v7.js:162` 用未去引号的 `status` 匹配 `archived|cancelled`。
- `plugin/migrate/migrate-v7.js:163` 只识别未加引号的 `archived-date: null`。
- 最小复现中 `status: "archived"` + `archived-date: null` 迁移后验收失败并还原，错误为 `missing=[archived-date] unknown=[]`。

影响：

合法 YAML 风格的 v6 详情文件会导致 v7 迁移失败。失败不会损坏数据，但会阻断用户迁移，且报错不直接说明根因是引号形态。

建议：

- 在 `rewriteFrontmatter` 中用统一的 frontmatter scalar normalizer 处理 `status` 与 `archived-date`。
- 增加 quoted `status: "archived"`、`status: 'cancelled'`、`archived-date: "null"` 回归测试。

### P2. schema 前向兼容 guard 未覆盖 artifact-writer Agent 派遣

证据：

- `plugin/hooks/pre-tool-use.js:388` 开始的 `Agent` 路径在 newer-schema 检测前执行 artifact-writer 的 artifact-dir、lifecycle、base template、reservation、owner 等校验。
- `plugin/hooks/pre-tool-use.js:462` 可能在 8.0 schema 项目里自动创建当前 v7 基础模板。
- newer-schema guard 在 `plugin/hooks/pre-tool-use.js:1394`，只覆盖后续普通流程门。
- 现有 V7F E2E 覆盖写码、Stop、直写保护和 SessionStart，但未覆盖 artifact-writer Agent 派遣。
- 最小复现：8.0 schema 项目中，artifact-writer prompt 若不符合 7.0 lifecycle 模板，会收到旧字段 deny；若符合 7.0 模板，则会放行并自动补 v7 基础模板，而不是统一给升级提示。

影响：

v7 -> v8 升级窗口仍可能在 artifact-writer 派遣路径出现旧 hook 管理新数据的问题；这削弱了 v7.1.0 “schema 高于 hook 支持上限时流程门让位”的保证。

建议：

- 在 artifact-writer Agent 路径进入 lifecycle/base/reservation 前，检测 newer schema。
- 对 newer schema：禁止旧 hook 派 artifact-writer 管理 artifact，返回升级/reload 提示；不自动创建 v7 模板。
- 增加 V7F Agent 用例：8.0 数据下 create/update/close/archive 派遣都不得走 7.0 lifecycle 校验或模板创建。

### P2/P3. v7 发布面仍有用户可见口径漂移

证据：

- `REFERENCE.md:259` 发布检查仍要求 artifact frontmatter `schema-version` 为 `"6.0"`。
- `README.md:140`、`README.md:149` 仍写 `v6 CHG`，且 `/plan` 桥接描述仍含 `task/impl` 索引。
- `README.md:316` 仍称 PreCompact 写 `.pace/pre-compact-state.json` 快照，但代码中该机制已退役。
- `README.md:339` 写“用户手动创建 `.pace/disabled`”，而命令文档要求通过 helper，不要手写。
- `plugin/hooks/pace-utils/plans.js:208`、`plugin/hooks/session-start/layers.js:304` 的 plan bridge 运行时提示仍写“创建/桥接为 v6 CHG”。
- `plugin/hooks/pre-tool-use.js:1538`、`plugin/hooks/pre-tool-use.js:1583`、`plugin/hooks/post-tool-use.js:267` 的 deny/warn 文案仍引导“创建 v6 CHG”。
- `plugin/hooks/post-tool-use.js:239` correction 提醒仍教用户在 `corrections.md` 写 `[knowledge:: project-only]`，与 v7 的 `[scope:: project-only]` 合同冲突。
- `plugin/hooks/templates/corrections.md:7`、`plugin/skills/artifact-management/references/format-reference.md:66`、`plugin/agent-references/instructions/record-correction.md:114` 仍有 legacy correction meta 示例。

影响：

多数属于文档/提示漂移，不会直接破坏 hook 主路径；但 `schema-version "6.0"` 发布检查和 correction meta 提示会误导维护者或 artifact-writer 流程，建议在下一波文档/发布面清理中处理。

建议：

- 把 README/REFERENCE 当前行为区改为 v7 目标态措辞。
- 将 PreCompact 文档改为 “native plan 兜底检测，不再写 pre-compact-state”。
- 将 `.pace/disabled` 用户操作统一指向 `/paceflow:disable` helper。
- 将 correction project-only meta 统一改为 `[scope:: project-only]`。
- 将当前运行时提示中的“v6 CHG / v6 Artifact”按语境改为“当前合同 CHG / PACEflow Artifact”，保留真正描述历史迁移的 v6→v7 文本。

### P2/P3. `set-project-root` 的 `--cwd` 缺值会写入错误 Project Root

证据：

- `plugin/hooks/set-project-root.js:17-20` 对 `--mode` / `--cwd` 直接读取 `argv[++i]`，没有像 `set-artifact-root.js` 那样检查下一个 token 是否又是 flag。
- 最小复现：在临时目录执行 `node plugin/hooks/set-project-root.js --cwd --mode independent`，helper 返回成功并写入 `./--mode/.pace/project-root`，stdout 显示 `project-root: <tmp>/--mode`。

影响：

公开 mutating helper 的参数缺值没有 fail-closed。正常命令文档会传绝对 `--cwd`，所以触发概率低；但脚本化调用或复制错误会在错误路径创建 `.pace/project-root` 与 `.gitignore`，造成 Project Root 状态漂移。

建议：

- 复用 `set-artifact-root.js` 的 `missingValue` 解析模式。
- 增加回归测试：`--cwd --mode independent`、`--mode --cwd <dir>` 均应非零退出且不写任何 `.pace` 文件。

### P3. manifest 声明 MIT，但远端缺少许可证正文

证据：

- `plugin/.claude-plugin/plugin.json:10` 声明 `"license": "MIT"`。
- `git ls-tree --name-only origin/master` 未发现 `LICENSE`、`LICENSE.md` 或 `COPYING`。

影响：

不影响插件运行，但 marketplace/GitHub 用户只能看到 license 标识，拿不到授权正文。发布合规面不完整。

建议：

- 在仓库根目录加入 MIT `LICENSE` 文件，或移除/调整 manifest 的 license 声明。

## 已排除/已验证正常

- 远端 `plugin/.claude-plugin/plugin.json` 与 `.claude-plugin/marketplace.json` 版本均为 `7.1.0`，marketplace source 为 `./plugin`。
- `plugin/hooks/hooks.json` 注册的 hook 文件均存在。
- `plugin/.claude-plugin/plugin.json` 声明的 agent/command 文件均存在。
- `claude plugin validate ./plugin` 通过。
- v5 迁移路径退役后的主路径测试通过：`test-hooks-e2e`、`test-pace-utils` 已覆盖 v5 布局提示、Stop 不阻断、reserve/create-chg 边界等。
- reserve existingMax 带 slug 文件名修复有回归测试覆盖。

## 剩余风险

- 本次审计未运行真实 Claude Code dogfood session，只做 hook harness、CLI、静态审阅与最小复现。
- 本次没有修复问题，只记录 Codex 审计结论。
- 当前工作区有既有未提交改动；本报告新增文件之外的改动不属于本次落档动作。
