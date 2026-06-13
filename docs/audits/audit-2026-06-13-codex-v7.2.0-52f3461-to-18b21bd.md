# PACEflow v7.2.0 Codex 发布面全量审计

> 类型：Codex 审计
> 日期：2026-06-13
> 审计对象：远端 `origin/master`
> 审计区间：`52f3461..18b21bd`
> 当前 HEAD：`18b21bd478a6181fe703801aed816fef456a01bd`
> 发布版本：`7.2.0`

## 结论

本次审计以 `git archive origin/master` 导出的干净副本为准，覆盖 marketplace 入口、插件 runtime、hook/agent/skill/command/migrate、README/REFERENCE 用户文档和 tracked 测试面；本地未跟踪文档未纳入发布物结论。

自动化验证全部通过，manifest 与版本号一致，hook/agent/command 引用完整。但发布面仍确认 5 个问题：1 个 P1、2 个 P2、2 个 P3。建议至少修掉 P1 与两个 P2 后再把 7.2.x 作为迁移面稳定版本对外推荐。

## 远端变更面

区间 commits：

- `32063ce` chore(v7): 审计第二批 G-legacy+G-doc 消化
- `a6c7c3f` feat(v7): 审计第三批 G-template+G-schema 消化
- `095b59c` feat(v7): 审计第四批 G-migrate+G-test+G-spec 消化
- `18b21bd` release(v7.2.0): bump 五处 + changelog

变更规模：36 个 tracked 文件，257 insertions / 94 deletions。当前远端 tracked 文件数：220。

版本面检查：

- `.claude-plugin/marketplace.json:10-12` 指向 `./plugin`，版本 `7.2.0`
- `plugin/.claude-plugin/plugin.json:4` 版本 `7.2.0`
- `plugin/hooks/pace-utils/constants.js:5` 运行时 `PACE_VERSION = 'v7.2.0'`
- marketplace/plugin/hooks JSON 可解析；manifest 中 agent、commands、hook args 引用文件均存在

## 验证结果

- `node tests/test-agent-tests-helpers.js`：9/9 passed
- `node tests/test-session-layers.js`：42/42 passed
- `node tests/test-migrate-v7.js`：14/14 passed
- `node tests/test-pace-utils.js`：275/275 passed
- `node tests/test-hooks-e2e.js`：390/390 passed
- `node tests/agent-tests/run-tests.js dummy`：PASS
- `find . -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `bash -n tests/agent-tests/run-agent-cli-suite.sh`：PASS
- `claude plugin validate ./plugin`：PASS
- `git diff --check 52f3461..origin/master`：PASS

## 确认发现

### P1. `migrate-v7` 仍会静默忽略未知参数，`--dryrun` 误拼会真实迁移

证据：

- `plugin/migrate/migrate-v7.js:61-68` 的 `parseArgs` 只识别 `--cwd`、`--dry-run`、`--hygiene`、`--restore`，未知参数不 fail-fast。
- 最小复现运行 `node plugin/migrate/migrate-v7.js --cwd <tmp> --dryrun`，返回 `rc=0`，首行是 `migrate-v7 【执行迁移】`，并写入 `.pace/v7-migration-state`，`implementation_plan.md` 被改写为 v7 tombstone。

影响：

用户误以为在 dry-run 预览时会实际迁移数据。迁移脚本有备份和验收保护，但这仍是迁移 CLI 的真实写盘风险。

建议：

- 对未知参数直接非零退出并打印 usage。
- 增加 `--dryrun`、`--cwd <dir> --bogus`、`--restore --bogus` 不写盘测试。

### P2. schema 前向兼容 guard 未覆盖 artifact-writer Agent 派遣

证据：

- newer-schema 检测函数定义在 `plugin/hooks/pace-utils/change-analysis.js:291-312`。
- 普通写码路径的让位逻辑位于 `plugin/hooks/pre-tool-use.js:1394-1404`。
- artifact-writer Agent 路径在更早的 `plugin/hooks/pre-tool-use.js:419-430` 先执行 lifecycle 校验并可直接返回。
- lifecycle 必填字段校验位于 `plugin/hooks/pre-tool-use/agent-lifecycle-guard.js:556-576`。
- 最小复现：8.0 schema 项目中派 `artifact-writer` 执行不完整 `close-chg`，输出为 lifecycle deny：`缺少必填字段：verification-confirmed...`；`hasUpgradeHint=false`。

影响：

v7 hook 遇到未来 v8 artifact 时，普通写码和 Stop 已让位，但 Agent 派遣仍可能用 v7 lifecycle/模板逻辑裁判新数据。这会削弱 “schema 高于当前插件支持时流程门让位，提示升级并 reload” 的升级安全承诺。

建议：

- 在 artifact-writer Agent 分支进入 artifact-dir/lifecycle/base/reservation 前做 newer-schema 检测。
- 对 newer schema：不要派旧 artifact-writer 管理 artifact，不创建 v7 模板，只返回升级/reload 提示。
- 增加 V7F Agent 覆盖：8.0 数据下 create/update/close/archive 派遣不得走 7.0 lifecycle deny 或模板创建。

### P2/P3. `set-project-root --cwd` 缺值会把下一个 flag 当路径并写错目录

证据：

- `plugin/hooks/set-project-root.js:17-20` 对 `--mode` / `--cwd` 直接读取 `argv[++i]`，没有检查缺值或下一项是否为 flag。
- 最小复现：在临时目录运行 `node plugin/hooks/set-project-root.js --cwd --mode independent`，返回 `rc=0`，输出 `Project Root 已声明为 independent。`，实际创建的是 `<tmp>/--mode/.pace/project-root`，当前目录未写入 marker。

影响：

这是用户手动 helper 的低频路径，但一旦打错会在错误目录创建 `.pace`，造成 Project Root 认知漂移。考虑到该 helper 是运行态边界工具，建议按 mutating helper 标准 fail-closed。

建议：

- 抽一个 `readOptionValue` 或复用已有 helper 参数解析口径：值缺失、值以 `-` 开头时非零退出。
- 增加 `--cwd` 末尾缺值、`--cwd --mode independent`、`--mode --cwd x` 三类测试。

### P3. v7.2.0 当前发布文档仍残留 v6 / task-impl 目标态口径

证据：

- `README.md:140`：`pace-bridge（派 artifact writer 创建 v6 CHG）`
- `README.md:149`：`PACE v6 CHG（changes/<id>.md + task/impl 索引）`
- `REFERENCE.md:85`：`也禁止在 task/impl 中写内嵌详情`
- `README.md:416` 的 v7.2.0 changelog 声称 README/REFERENCE 已按 v7 runtime 同步，但上述当前功能段仍残留旧口径。

影响：

这是发布面用户文档漂移，不会直接破坏 hook 主路径；但 `/plan` 桥接是用户入口，继续写 `v6 CHG` 和 `task/impl 索引` 会误导用户以为新建 CHG 仍双索引。REFERENCE 的 `task/impl` 也与 v7 单索引目标态不一致。

建议：

- README 当前功能段改成 “创建当前 v7 CHG / 写入 `changes/<id>.md` + `task.md` 单索引”。
- REFERENCE 改成 “禁止在索引文件中写内嵌详情”，或明确 `task.md` 是唯一 CHG 索引。
- changelog 中 “七组 findings 全部清零” 建议改为对应批次 findings 清零，避免覆盖本次新审计结论。

### P3. manifest 声明 MIT，但发布树没有 LICENSE/COPYING 文件

证据：

- `plugin/.claude-plugin/plugin.json:10` 声明 `"license": "MIT"`。
- 在发布根干净副本执行 `find . -maxdepth 2 \( -iname 'LICENSE*' -o -iname 'COPYING*' \) -print`，无输出。

影响：

`claude plugin validate ./plugin` 不会拦截该问题，但 marketplace / GitHub 用户无法在发布树里直接看到 MIT 文本。属于合规和分发完整性问题。

建议：

- 在仓库根或 plugin 发布根加入 `LICENSE`，并确认 marketplace 打包会包含。

## 已确认修复/通过项

- 旧审计中的 quoted `status: "archived"` 迁移阻断已修复：`test-migrate-v7.js` 覆盖并通过，目标 fixture 会回填 `archived-date`。
- README/REFERENCE 中发布检查 `schema-version` 已从 6.0 对齐到 7.0：`REFERENCE.md:261`。
- PreCompact 快照退役文档已对齐当前代码：README/REFERENCE 当前描述均为 native plan 兜底检测，不写快照。
- correction project-only 口径当前发布面使用 `[scope:: project-only]`，post-tool-use 提醒和模板允许 `[knowledge:: [[note]]]` 或 `[scope:: project-only]`。
- `plugin/hooks/templates/implementation_plan.md` 已从发布树删除；`ARTIFACT_FILES` 不再包含 `implementation_plan.md`，但 `PROTECTED_ARTIFACTS` 保留 tombstone/存量保护。
- `plugin.json` agent/commands、`hooks.json` hook args 均能解析且引用文件存在。

## 边界和残余风险

- 本审计没有执行真实 Claude Code marketplace 安装/升级流程，只验证本地插件 manifest 和干净归档副本。
- 本审计没有开启真实多 session / 多 worktree dogfood，只运行 tracked harness 和定向最小复现。
- 临时测试副本中运行 E2E 会生成 `plugin/hooks/pace-hooks.log`，该文件不是远端 tracked 发布物，本审计未把它计入发布树问题。
