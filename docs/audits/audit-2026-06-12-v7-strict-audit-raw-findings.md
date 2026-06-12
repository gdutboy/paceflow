# PACEflow v7.0 严格审计——原始 findings 快照（未验证）

> 日期：2026-06-12
> 状态：**原始数据，未经对抗验证**——最终裁决以验证后的审计报告为准（部分条目可能在验证层被证伪、判定为有意设计或调整 severity）
> 方法：10 维度专项审计员并行扫描（多 agent workflow wf_73bac532-388 + 单独补跑 D7/D10），规格定锚基准：
> - docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md
> - docs/superpowers/plans/2026-06-11-artifact-schema-v7-refactor.md
> - docs/paceflow-feature-reference.md（v6.7.1 行为基线）+ README.md / REFERENCE.md
> - 审计范围：git a167727..HEAD（CHG-20260611-08 ~ CHG-20260612-01，v7.0.0）
> 基线事实：5 个测试套件 729 用例全绿（275/391/42/9/12）+ claude plugin validate 通过

共 **77 条**原始 findings：P0 0 / P1 2 / P2 22 / P3 53（初判 severity，未校准）

---

## D1 hook 读端单索引（CHG-08）（5 条）

### R-01 [P3] agent 发布面仍要求验证/汇报已退役的「跨索引一致性」

- 位置：`plugin/agents/artifact-writer.md` :403（另见 plugin/agent-references/instructions/create-chg.md:154）
- 指控：v7 单索引后「跨索引一致性」校验对象已不存在（task.md 是唯一 CHG 索引，hook 读端 join/mismatch 校验整体退役），但 artifact-writer 成功报告模板仍要求输出「- 跨索引一致性: ✅」，create-chg 指令仍教 agent『验证"跨索引一致性"时，按行首格式…逐行匹配』。CHG-11『目标态 framing 全发布面重写』漏改这两处，agent 每次派遣都会读到一个无法执行的契约项（只能汇报假 ✅ 或自行臆测含义），与 v7 目标态合同不一致。
- 证据：grep -rn "跨索引" plugin/ → plugin/agents/artifact-writer.md:403:`- 跨索引一致性: ✅`；plugin/agent-references/instructions/create-chg.md:154:`验证"跨索引一致性"时，按行首格式 ^- \[[ x/!-]\] \[\[(chg|hotfix)-YYYYMMDD-NN\]\] 逐行匹配`。对照代码：plugin/hooks/pace-utils/change-analysis.js:295-296 注释『index-mismatch（旧双索引 checkbox 不一致）随双文件合并退役』；tests/test-hooks-e2e.js:6303 测试『15d. v7: impl_plan 缺行不再产生跨索引不一致提示（旧双索引 warning 退役）』。两处文本在 a167727（v6 基线）已存在，v7 重写未清理。
- 复现：grep -rn "跨索引" plugin/agents/ plugin/agent-references/；对照 plugin/hooks/pace-utils/change-analysis.js classifyChange（无 index-mismatch 分支）与 tests/test-hooks-e2e.js 15d/9hc0f 断言 mismatch 校验已退役

### R-02 [P3] REFERENCE.md 仍宣称「索引完整性三门」含已退役的 mismatch 门

- 位置：`REFERENCE.md` :199
- 指控：用户可见行为合同 REFERENCE.md 的 teammate 拒绝分档表仍写『索引完整性三门（malformed / mismatch / detail-missing）』，但 v7 已退役跨索引 mismatch deny——pre-tool-use.js 结构检查只剩 malformed（DENY_V6_INDEX_MALFORMED）与 detail-missing（DENY_V6_DETAIL_MISSING）两门。v7.0.0 的 README/REFERENCE 同步（commit 5b1cd3c，CHG-20260611-13 T-002）漏改此行，用户/维护者会预期一个不会触发的 deny 门。
- 证据：REFERENCE.md:199:`…无活跃 CHG、索引完整性三门（malformed / mismatch / detail-missing）`。代码侧 plugin/hooks/pre-tool-use.js:1422-1445 structuralCheckNeeded 块只有 taskMalformed 与 missingDetails 两个 deny；e2e 测试 9hc0f0『v7: impl_plan 空索引不再影响写码门（旧双索引 mismatch deny 退役）』通过。git show a167727:REFERENCE.md 同段文本相同，确认 v7 文档同步遗漏（非新增错误描述）。
- 复现：sed -n '195,202p' REFERENCE.md 对照 plugin/hooks/pre-tool-use.js:1422-1445；grep -n mismatch plugin/hooks/pre-tool-use.js（无 deny 路径）

### R-03 [P3] plugin/hooks/templates/implementation_plan.md 成为零消费方死模板且内容仍是 v6 索引格式

- 位置：`plugin/hooks/templates/implementation_plan.md` :1-9
- 指控：v7 把 implementation_plan.md 退役出 ARTIFACT_FILES 后，模板的两个消费点都不再触达它：createTemplates（pace-utils.js:762 `for (const file of ARTIFACT_FILES)`）与 Write 新建模板注入（pre-tool-use.js:1307 `ARTIFACT_FILES.includes(fileName)`）都只遍历 ARTIFACT_FILES；batch-archive-v5.js 用内联 V6_TEMPLATES 不读 templates/ 目录。该模板在 v7 发布面上是死文件，且内容仍是 v6 活跃索引格式（『# 实施计划 / ## 变更索引 / - [状态] [[chg-…]] 格式注释』），与设计文档 §2.1『impl_plan 仅以 tombstone 形态存在』的目标态矛盾。整个 v7 提交范围（a167727..HEAD）对 plugin/hooks/templates/ 零提交，属漏退役残留（应删除或改写为 tombstone 模板）。
- 证据：git log --oneline a167727..HEAD -- plugin/hooks/templates/ → 空输出；plugin/hooks/pace-utils/constants.js:8 ARTIFACT_FILES 不含 implementation_plan.md；模板内容含『## 变更索引』与索引行格式注释；grep -rln templates plugin/ 仅 pace-utils.js（createTemplates）与 pre-tool-use.js（INJECT_TEMPLATE），两处都以 ARTIFACT_FILES 为白名单；e2e tests/test-hooks-e2e.js:2434 断言『v7: 新项目不再创建 implementation_plan.md』。
- 复现：cat plugin/hooks/templates/implementation_plan.md；grep -n 'for (const file of ARTIFACT_FILES)' plugin/hooks/pace-utils.js；sed -n '1305,1321p' plugin/hooks/pre-tool-use.js；git log a167727..HEAD -- plugin/hooks/templates/

### R-04 [P3] 设计文档/实现计划仍写 MIGRATABLE_ARTIFACT_FILES 应移除 impl_plan，与最终实现（有意保留）漂移

- 位置：`docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md` :66（另见 docs/superpowers/plans/2026-06-11-artifact-schema-v7-refactor.md:179）
- 指控：设计文档 §2.2 处置表写『constants.js ARCHIVE_REQUIRED_FILES / MIGRATABLE_ARTIFACT_FILES | 移除 impl_plan』，实现计划 line 179 进一步声称『行 8 MIGRATABLE…是 filter 派生，自动收窄』。但最终实现有意保留：constants.js:11 MIGRATABLE_ARTIFACT_FILES 显式含 implementation_plan.md（batch-archive-v5 的 v5→v6 迁移必须迁它，按规格移除会破坏 v5 迁移），CHG-08 实施详情记录了该偏离（『MIGRATABLE_ARTIFACT_FILES 解耦为显式清单（v5→v6 迁移必含 impl_plan 防漏迁）』），且 test-pace-utils.js:3247 断言锁定保留。实现正确，但规格未回写更新——按『规格定锚』方法论这是规格-产物漂移，后续读规格的人会误以为该常量已不含 impl_plan。
- 证据：docs/superpowers/specs/...design.md:66:`| constants.js ARCHIVE_REQUIRED_FILES / MIGRATABLE_ARTIFACT_FILES | 移除 impl_plan…`；plugin/hooks/pace-utils/constants.js:11:`const MIGRATABLE_ARTIFACT_FILES = ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];`；tests/test-pace-utils.js:3247 deepStrictEqual 断言含 implementation_plan.md；Obsidian CHG-08 详情 line 43 记录该决策。
- 复现：grep -n MIGRATABLE docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md docs/superpowers/plans/2026-06-11-artifact-schema-v7-refactor.md plugin/hooks/pace-utils/constants.js tests/test-pace-utils.js

### R-05 [P3] change-analysis.js 陈旧注释仍描述已退役的 task/impl 跨索引 join

- 位置：`plugin/hooks/pace-utils/change-analysis.js` :159-161
- 指控：parseChangeIndex 上方的 HOTFIX-20260610-01 注释仍写『slug 字段拼出文件 stem 全名，供 task/impl 跨索引 join 与 changes/<slug>.md 路径提示』——v7 已退役 impl 侧与跨索引 join（同文件 326-328 行新注释明确 task.md 是唯一索引）。CHG-08 审计 P3 修正（commit 0c43dc9『锁注释准确化 + 陈旧注释清理』）漏掉此处，注释与代码可达路径不一致。
- 证据：plugin/hooks/pace-utils/change-analysis.js:161:`//   供 task/impl 跨索引 join 与 changes/<slug>.md 路径提示）。…`，而同文件 getActiveChangeEntries（326-339 行）只读 task.md 且 entry 不再含 impl 字段（V7A-1c 测试断言 `!('impl' in entries[0])` 通过）。
- 复现：sed -n '157,163p' plugin/hooks/pace-utils/change-analysis.js 对照同文件 326-339 行；node tests/test-pace-utils.js（V7A 组）

**D1-hook-read 覆盖说明**：D1（hook 读端单索引正确性，CHG-20260611-08）专项审计。检查方式与范围：1) 全量 grep：plugin/** 范围 grep implementation_plan / 跨索引 / index-transaction / implBySlug / implCheckbox / impl-archive / implIndex / implDetail，逐处判定有意保留 vs 漏退役（排除 gitignored 的 plugin/hooks/pace-hooks.log 本地日志）。2) 单读实现完整阅读：pace-utils/change-analysis.js 全文（parseChangeIndex / classifyChange / getActiveChangeEntries / summarizeActiveChanges / findActiveIndexBelowArchive）、pace-utils.js 门面全文（readActive/readFull/detectUnmigratedV6Layout/getArtifactDir/createTemplates/legacyV5FilesInDir）、pace-utils/constants.js 全文、locks.js 相关段（artifactResourceForRel / markIndexChangesTouchedAndMaybeRelease / releaseArtifactResourcesForOwner / isArtifactRuntimeControlPath）。3) 读端消费方逐个核对：pre-tool-use.js 写码门/结构门/批准门（1340-1510）与 tombstone 写保护链（1216/1231/1290/1389 + marker-guard.js + path-utils.js isArtifactRelativePath 显式认 impl_plan）、stop.js 168-280、post-tool-use.js（v7 迁移催办 + markIndexChangesTouched 释放路径）、post-tool-use-failure.js（半开保锁退役）、subagent-stop.js、session-start/collect-state.js + layers.js（格式警告迁 task.md、ARTIFACT_BLOCK_PRIORITY 无 impl、未迁移提示）、pre-compact.js/session-end.js/task-list-sync.js/sync-plan.js/reserve-artifact-id.js（grep 无 impl 引用）。4) before/after 实证：git show a167727 对照 change-analysis.js（旧双索引 join 的 Map last-wins 去重语义与 v7 单读一致，无回归）、constants.js ARCHIVE_PATTERN（活跃区切分容差差异为 v6 既有，非 v7 回归）、path-utils.js legacyV5FilesInDir 双份重复（v6 既有且 spec §2.2 明示『不动』，非 v7 问题）、REFERENCE.md/artifact-writer.md/create-chg.md 残留文本均为 v6 既有但属 v7 重写遗漏。5) 实际运行：node tests/test-pace-utils.js（275/275）、test-hooks-e2e.js（391/391，含 V7A/V7E 与 tombstone DENY_DIRECT_ARTIFACT_EDIT/WRITE 对称保护、9hc0f mismatch 退役断言）、test-session-layers.js（42/42）、test-agent-tests-helpers.js（9/9）、test-migrate-v7.js（12/12）全绿；另写 /tmp/d1-audit-run.js 真跑验证 getActiveChangeEntries 单读 task.md（ARCHIVE 区 [x] 行不进活跃 entries、entry 无 impl 字段）与 detectUnmigratedV6Layout 三态（tombstone=false / 活跃行=true / 仅归档区行=false）。确认无问题的面：getActiveChangeEntries/classifyChange 单读实现与 ARCHIVE 边界正确（fail-closed：CHG 只在 impl_plan 不在 task.md 时写码门拒绝而非放行）；index-transaction 退役干净（readArtifactIndexTransaction 已删，markIndexChangesTouchedAndMaybeRelease 是有注释的兼容薄包装，releaseArtifactResourcesForOwner 残留清理与 bash/powershell-guard 对 .pace/index-transactions 的继续防护均为有意保留）；tombstone 写保护对称（PROTECTED_ARTIFACTS 显式含 impl_plan、isArtifactRelativePath:71 显式认、Edit/MultiEdit/Write/Bash/PowerShell 五路径都挡且有 e2e 锁）；MIGRATABLE_ARTIFACT_FILES 保留 impl_plan 的实现本身正确（batch-archive-v5 依赖）；README.md 对 impl_plan 的提及（56/237/changelog）均准确。未发现 P0-P2 行为缺陷；5 条 finding 全部为发布面/规格残留漂移（P3）。已知问题（foreign worktree 搭便车、SessionStart 注入质量、tests gitignore 豁免）未重复报告。

---

## D2 frontmatter schema 封闭合同（CHG-09）（7 条）

### R-06 [P2] archived 帧 verified-date/reviewed-date 为 null 时三层校验全静默，spec 状态机表承诺的 format-violation 无任何执行者

- 位置：`plugin/hooks/pace-utils/change-analysis.js` :236-240
- 指控：SCHEMA_V7_VALUE_REQUIRED 的 archived 阶段必填集只有 ['archived-date']，未包含设计文档 §3.5 表「archived = 上行(completed 行) + archived-date」继承的 verified-date/reviewed-date 要求；artifact-writer-spec.md §4.1 状态机表（L116）明确「archived + verified-date 缺 = format-violation」。本应承担该检查的 post-tool-use.js L161 旧占位检查正则 /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/ 不匹配带 slug 的文件名（HOTFIX-20260610-01 后所有新建详情文件均带 slug），整块死路；归档后文件离开活跃索引，stop/session-start 也不再触达。结果：一个 status: archived、VERIFIED/REVIEWED 标记齐在、但 verified-date/reviewed-date 均为 null 的 7.0 帧通过全部确定性层——封闭合同对自己规格承诺的不变量出现执行空洞。
- 证据：实测（hook 进程级 harness，slug 文件名 archived 帧 + null verified-date + VERIFIED 标记）：`archived-null-verified: schema-warning: false | 占位 null 警告: false | verified-date 提及: false`。函数级：validateFrontmatterSchema('chg','archived',{...,'verified-date':'null','archived-date':'<填>'}) → {ok:true}。正则实测：/^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test('changes/chg-20260611-09-v7-schema-closed-contract-validate-frontmatter.md') → false。git show a167727 确认该正则 v6 已如此（非 v7 regression，但 v7 设计 §3.5 明文把 completed/archived 阶段配对要求记为「现有双表示不变量不变」，而该不变量的写盘层执行者对 slug 文件不可达，规格-实现合同出现内部矛盾）。
- 复现：node -e "const pu=require('/mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks/pace-utils');console.log(pu.validateFrontmatterSchema('chg','archived',{status:'archived',date:'2026-05-04','change-set':'null','change-set-seq':'null','verified-date':'null','reviewed-date':'null','archived-date':'2026-06-12T10:00:00+08:00','parent-tasks':'[\"x\"]','schema-version':'\"7.0\"'}));console.log(/^changes\\/(?:chg|hotfix)-\\d{8}-\\d{2}\\.md$/i.test('changes/chg-20260504-01-some-slug.md'))" → ok:true + false；对照 plugin/agent-references/artifact-writer-spec.md L116 与 docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §3.5 表 archived 行。

### R-07 [P2] agent.md batch 指引仍引用 v7 已删除的 type frontmatter key，且「写」与 v7「key 恒在只改值不插行」语义矛盾

- 位置：`plugin/agents/artifact-writer.md` :165
- 指控：artifact-writer agent system prompt（整读面）L165 写「每块 frontmatter 在 `type` 后写 `change-set` + `change-set-seq: i/N`」。v7 帧已删除 type key（spec §3.1 删除集），且 change-set/change-set-seq 为 key 恒在、batch 时只改值——同一发布面的 instructions/create-chg.md L186 正确表述为「把恒在的 change-set: null ... 改为 ...（两 key 恒在，只改值不插行）」。agent.md 该行与 7.0 合同及 instruction 直接冲突，是 CHG-D「目标态 framing 全发布面重写」的漏网。每次 batch create 该错误指引都在 system prompt 中可达；若 agent 照它插入第二条 change-set 行（原 null 行仍在），恰好落在封闭合同的重复 key 盲区（见另一 finding），层 1 无法打回。
- 证据：plugin/agents/artifact-writer.md L165 原文「每块 frontmatter 在 `type` 后写 `change-set` + `change-set-seq: i/N`」；git show a167727:plugin/agents/artifact-writer.md L165 逐字相同（v6 基线遗留，当时帧确有 type key 且 change-set 为可选插入）；对照 plugin/agent-references/instructions/create-chg.md L186-187（正确的 v7 表述）与 artifact-writer-spec.md §2.1（9 key 集合无 type）。V7D-1/V7D-2 测试锁只覆盖必填字段清单与 prompt 模板字段集，不覆盖此散文描述，故漏改未红灯。
- 复现：grep -n '在 \`type\` 后写' plugin/agents/artifact-writer.md；git -C /mnt/k/AI/paceflow-hooks/paceflow show a167727:plugin/agents/artifact-writer.md | grep -n 'type\` 后写'；对照 grep -n '恒在' plugin/agent-references/instructions/create-chg.md。

### R-08 [P2] REFERENCE.md 发布检查清单仍要求 schema-version 保持 "6.0"，与 v7.0 封闭合同直接矛盾

- 位置：`REFERENCE.md` :258
- 指控：REFERENCE.md §8 发布检查项「artifact frontmatter `schema-version` 仍为 `"6.0"`；不要随插件 patch 版本滚动」在 v7 发布后过时：当前发布面模板/spec/migrate 全部写 `schema-version: "7.0"`，validateFrontmatterSchema 仅对 "7.0" 帧生效。维护者按此清单做下次发布检查会校验出错误不变量。CHG-20260611-13 T-002 声称完成 README/REFERENCE v7 行为同步、CHG-20260612-01 又做了 README legacy 措辞清理，此行两轮均漏网。
- 证据：REFERENCE.md L258 原文 vs plugin/skills/artifact-management/templates/change-detail.md（schema-version: "7.0"）、plugin/agent-references/artifact-writer-spec.md §2.1-2.3（三帧均 "7.0"）、plugin/migrate/migrate-v7.js L147（schema-version → "7.0"）。grep -n '"6.0"' REFERENCE.md 仅此一处。
- 复现：grep -n 'schema-version' REFERENCE.md → L258 仍写 "6.0"；对照 grep -rn '7.0' plugin/skills/artifact-management/templates/change-detail.md。

### R-09 [P3] stop/session-start 兜底层只校验 chg 帧，finding/correction 帧无层 2/3 接线

- 位置：`plugin/hooks/stop.js` :217-224
- 指控：设计文档 §3.5 定义三层接线复用 validateFrontmatterSchema（kind = chg | finding | correction），层 2 为「collect-state / stop 兜底检测存量漂移」。实现中 stop.js L219 硬编码 kind='chg' 且只遍历活跃 CHG entries；summarizeActiveChanges（change-analysis.js L384-387，供 collect-state/layers 渲染）同样只算 chg 帧的 schemaViolation。finding/correction 帧只有层 1（post-tool-use 写盘时）覆盖；经 Obsidian/外部编辑器手改产生的 finding/correction 帧漂移（多余/缺失 key）永远不会被任何层检出（Bash 旁路写 artifact 已被 bash-guard 拦截，但外部编辑器不经过 Claude hooks）。设计未明文豁免该 kind 范围收窄，CHG-09 T-002 验收文案也未声明此取舍。
- 证据：plugin/hooks/stop.js L219: `paceUtils.validateFrontmatterSchema('chg', change.status || '', fm || {})`；change-analysis.js L385: `validateFrontmatterSchema('chg', fm.status || '', fm)`；grep -rn 'validateFrontmatterSchema' plugin/hooks/session-start/ 无 finding/correction 调用。层 1 对 finding/correction 接线本身正确（hook 进程级实测：changes/findings/ 下非法帧报 finding 合同 status(missing-key)+impact，未误用 chg 合同；合法 correction 帧静默）。
- 复现：grep -n "validateFrontmatterSchema" plugin/hooks/stop.js plugin/hooks/pace-utils/change-analysis.js plugin/hooks/session-start/*.js——确认全部硬编码 'chg'；对照设计文档 §3.5「kind = chg | finding | correction」三层接线段。

### R-10 [P3] 封闭合同对重复 key 盲区：同 key 出现两行时后值静默覆盖、校验通过

- 位置：`plugin/hooks/pace-utils/change-analysis.js` :42-51, 261-267
- 指控：parseFrontmatter 用扁平 map 逐行解析，重复 key 后值覆盖前值且不留痕迹；validateFrontmatterSchema 基于该 map 的 Object.keys 判缺失/多余，对「status: planned 与 status: in-progress 两行并存」这类损坏帧返回 ok:true。封闭合同宣称「该有的缺失=非法，不该有的出现=非法」，但同一 key 重复出现（Obsidian Properties 面板会报 YAML 错的真损坏）不可检出。该盲区与 agent.md L165 过时 batch 指引（插行而非改值）的失败模式恰好重合：agent 若误插第二条 change-set 行，层 1 无法打回。
- 证据：函数级实测：parseFrontmatter('---\nstatus: planned\nstatus: in-progress\n...全 9 key...\n---') → status='in-progress'，validateFrontmatterSchema('chg','planned',fm) → {ok:true,missing:[],unknown:[]}。
- 复现：node -e "const pu=require('/mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks/pace-utils');const fm=pu.parseFrontmatter('---\\nstatus: planned\\nstatus: in-progress\\ndate: 2026-06-12\\nchange-set: null\\nchange-set-seq: null\\nverified-date: null\\nreviewed-date: null\\narchived-date: null\\nparent-tasks: x\\nschema-version: \"7.0\"\\n---');console.log(fm.status, pu.validateFrontmatterSchema('chg','planned',fm))"

### R-11 [P3] change-set/change-set-seq 半空对（一个非 null 一个 null）通过校验，batch 成对语义不可检出

- 位置：`plugin/hooks/pace-utils/change-analysis.js` :236-240
- 指控：设计 §3.5 表 planned/in-progress 必填集注「（+ batch 创建时 change-set、change-set-seq）」——batch 成员两字段成对非 null。校验函数无法从帧本身判定是否 batch，因此未对两字段做任何值校验，但「成对不变量」（两者同 null 或同非 null）本可从 frontmatter 单独判定。当前 change-set: v7-refactor + change-set-seq: null 的半写帧通过校验，SessionStart change-set 整体进度聚合（layers.js changeSetGroups）会拿到 seq 缺失的成员，排序退化。
- 证据：函数级实测：validateFrontmatterSchema('chg','planned',{...合规帧, 'change-set':'v7-refactor'}) → {ok:true,missing:[],unknown:[]}（change-set-seq 仍为 null）。
- 复现：node -e "const pu=require('/mnt/k/AI/paceflow-hooks/paceflow/plugin/hooks/pace-utils');console.log(pu.validateFrontmatterSchema('chg','planned',{status:'planned',date:'2026-06-12','change-set':'v7-refactor','change-set-seq':'null','verified-date':'null','reviewed-date':'null','archived-date':'null','parent-tasks':'x','schema-version':'\"7.0\"'}))"

### R-12 [P3] artifact-management SKILL 编号规范仍称 correction 为「frontmatter 稳定 ID」，v7 已删 correction-id key

- 位置：`plugin/skills/artifact-management/SKILL.md` :327
- 指控：SKILL.md 编号规范 CORRECTION 条目写「frontmatter 稳定 ID」——v6 时代 correction 帧含 correction-id key 的表述残留。v7 合同 correction 帧只有 date + schema-version 两 key，spec §2.3 明文「correction-id 由文件名承载」。主 session 读 SKILL 后可能误以为 ID 写在 frontmatter（实际若 agent 写入会被层 1 当 unknown key 打回，后果被合同兜住，但发布面三方表述不一致）。CHG-10 T-002（发布面全量同步）与 CHG-11 T-001（全发布面重写）两轮均漏网。
- 证据：plugin/skills/artifact-management/SKILL.md L327「frontmatter 稳定 ID」；git show a167727:plugin/skills/artifact-management/SKILL.md L354 逐字相同（v6 遗留）；git show a167727 的 spec §2.3 确认 v6 帧确有 correction-id key，v7 spec §2.3 已删并声明文件名承载。
- 复现：grep -n 'frontmatter 稳定 ID' plugin/skills/artifact-management/SKILL.md；对照 plugin/agent-references/artifact-writer-spec.md §2.3「correction-id 由文件名承载」。

**D2-schema-contract 覆盖说明**：【检查面】D2 frontmatter schema 封闭合同（CHG-20260611-09）。1) 代码合同：plugin/hooks/pace-utils/change-analysis.js（validateFrontmatterSchema/SCHEMA_V7_KEYS/SCHEMA_V7_VALUE_REQUIRED/parseFrontmatter/frontmatterNullable/summarizeActiveChanges.schemaViolation 完整读取）+ pace-utils.js 双重 re-export 确认。2) 三层接线逐层追踪并进程级实测：post-tool-use.js L140-236（kind 由 changes/findings|corrections 路径推导——实测 finding 非法帧报 finding 合同而非误用 chg 合同、合法 correction 帧静默、chg 多余 key 即时打回）；stop.js L217-224 repair 兜底；collect-state.js→summarizeActiveChanges→layers.js L768-772 渲染链路确认接通。3) 合同三方对照：artifact-writer-spec.md §2.1-2.3（9/3/2 key + schema-keys 机器注释行）、skills/artifact-management/templates/三模板、instructions/create-chg|record-finding|record-correction|update-finding|close-chg|archive-chg|update-chg 的字段表述、agents/artifact-writer.md 字段速查——逐 key 一致（仅发现 agent.md L165 与 SKILL.md L327 两处 v6 散文残留，已列 finding）。4) 6.0 存量兼容实测：带 chg-id/type/aliases/tags/completed-date 的 6.0 帧 → skipped 'non-7.0' 零误报；无 schema-version 帧 → skipped + post-tool-use L150 单独催办（git show a167727 确认 L150 与 isChangeDetailEdit 正则 v6 已覆盖全 changes/** 路径，符合 CHG-09 T-002 记录）。5) 边界实测：CRLF+BOM 归一通过、空值/字面 null 判 missing、引号 status/schema-version 归一、cancelled/archived 的 archived-date 必填、YAML 块列表 parent-tasks 被判 missing（spec 强制 inline 形态，视为合同推向规定形态而非误报）、重复 key 与 change-set 半空对两个盲区（已列 finding）。6) migrate 验收层：migrate-v7.js rewriteFrontmatter 复用 SCHEMA_V7_KEYS 单源、验收对 r.skipped 防假绿（L343-350）。7) 测试锁核验并全量运行：test-pace-utils 275/275（V7B-1~5 矩阵、V7C-1 模板合同、V7C-2/V7D-3 规格-代码互锁）、test-hooks-e2e 391/391（V7B-6~8 三层 e2e）、test-session-layers 42/42、test-migrate-v7 12/12、test-agent-tests-helpers 9/9 全绿。8) regression 指控均做 git show a167727 before/after 对照（post-tool-use L161 死正则、agent.md L165、SKILL.md L327 均为 v6 遗留非 v7 改坏，但前者与 v7 设计 §3.5「现有双表示不变量不变」假设矛盾）。【确认无问题】9/3/2 key 集合代码-spec-模板-instructions 四方一致且有测试锁；6.0 兼容策略按设计落地；三层接线对 chg 帧真实可达（进程级证实）；post-tool-use kind 推导正确；migrate 合同单源无漂移；format-violation 走 repair 通道不 deny 写码符合设计。已知问题清单（foreign worktree 搭便车、SessionStart 注入质量、tests gitignore）未重复报告。

---

## D3 agent 写端单索引与模板同步（CHG-10）（10 条）

### R-13 [P2] record-correction 索引行模板仍是 legacy project-only 联合写法，与同文件归一表及 spec §5.5 直接矛盾

- 位置：`plugin/agent-references/instructions/record-correction.md` :114
- 指控：v7 合同（spec §5.5 + record-correction.md 自己的「knowledge-link 输入归一」表）规定 project-only 场景写 `[scope:: project-only]`，且 spec 明文「不把 scope 值塞进 [knowledge::]」；但同文件「## 索引行」段的权威输出模板仍是 `[knowledge:: [[note]] | project-only]`（v6 残留）。agent 执行 record-correction 时同文件两处指令冲突，照索引行模板写会产出 migrate-v7 刚清理掉的 legacy meta。CHG-20260611-10 T-002 自述完成「§5.5 correction 索引 [scope::] 修正 + knowledge-link 归一表改索引行 meta」，本行漏改。
- 证据：record-correction.md:56 `| knowledge-link: project-only | [scope:: project-only] |`（归一表）vs :114 `- [[correction-yyyy-mm-dd-nn-slug]] <派生的 title> [date:: YYYY-MM-DD] [knowledge:: [[note]] | project-only]`（索引行模板）。spec §5.5（artifact-writer-spec.md:190）：`[knowledge:: [[note]]]（project-only 场景改用 [scope:: project-only]，不把 scope 值塞进 [knowledge::]）`。migrate-v7.js:213 主动 `.replace('[knowledge:: project-only]', '[scope:: project-only]')`。git show a167727 确认 :114 自 v6 起未动，而归一表在 v7 被改写。
- 复现：grep -n 'knowledge::' plugin/agent-references/instructions/record-correction.md plugin/agent-references/artifact-writer-spec.md plugin/migrate/migrate-v7.js；对照 record-correction.md 第 56 行与第 114 行

### R-14 [P2] PostToolUse correction 提醒文案引导写 legacy [knowledge:: project-only]，与 v7 [scope::] 合同相反

- 位置：`plugin/hooks/post-tool-use.js` :240
- 指控：每次写 changes/corrections/* 详情文件都会触发的 runtime hook 提醒，仍教用户/主 session「在 corrections.md 索引标注 [knowledge:: project-only]」——这正是 v7 合同废弃、migrate-v7.js:213 一次性转换掉的 legacy 表示。日常可达（任何 correction 记录都触发），照做会让迁移后的数据回漂到 legacy 格式，且无任何机械校验拦截。
- 证据：post-tool-use.js:240 `warnings.push('检测到 correction 详情变更。请确认已同步写入 knowledge/ 或在 corrections.md 索引标注 [knowledge:: project-only]。');`。v7 合同：artifact-writer-spec.md:81/190 规定 `[scope:: project-only]`；migrate-v7.js:208-213 把 `[knowledge:: project-only]` 改写为 `[scope:: project-only]`（自述「[scope::] 语义修正」）。git show a167727:plugin/hooks/post-tool-use.js 第 236 行同文案，v7 全程未更新。
- 复现：grep -n 'knowledge:: project-only' plugin/hooks/post-tool-use.js plugin/migrate/migrate-v7.js；对照两处语义方向相反

### R-15 [P3] hook 初始化模板 / skill 格式参考 / v5 迁移工具共 3 处仍输出 legacy project-only 表示，与 spec §5.6.5 模板漂移

- 位置：`plugin/skills/artifact-management/references/format-reference.md` :66
- 指控：corrections.md 的 v7 权威模板（spec §5.6.5）格式注释是 `[knowledge:: [[note]]] 或 [scope:: project-only]`，但发布面另外三处仍是 legacy：(1) hooks/templates/corrections.md:7 格式注释 `[knowledge:: [[note]] | project-only]`——createTemplates（pace-utils.js:746-774）与 PreToolUse T-206 模板注入（pre-tool-use.js:1306-1320）在新项目首建 corrections.md 时原样落盘/注入；(2) format-reference.md:66 示例行 `[knowledge:: project-only]`（CHG-10 T-002 自述「format-reference 同步」但漏改）；(3) batch-archive-v5.js:42 内联模板同款注释。且 migrate-v7.js:213 的 replace 是精确串匹配 `[knowledge:: project-only]`，对注释行 `[knowledge:: [[note]] | project-only]` 不生效——迁移后 legacy 注释永久存留继续误导。
- 证据：plugin/hooks/templates/corrections.md:7 `<!-- 格式：- [[correction-yyyy-mm-dd-nn-slug]] <title> [date:: YYYY-MM-DD] [knowledge:: [[note]] | project-only] -->`；format-reference.md:66 `[knowledge:: project-only]`；batch-archive-v5.js:42 `[knowledge:: [[note]] | project-only]`；spec §5.6.5（artifact-writer-spec.md:251）`[knowledge:: [[note]]] 或 [scope:: project-only]`。Node 验证：`'[knowledge:: [[note]] | project-only]'.includes('[knowledge:: project-only]') === false`。
- 复现：grep -rn 'project-only' plugin/hooks/templates/corrections.md plugin/skills/artifact-management/references/format-reference.md plugin/migrate/batch-archive-v5.js plugin/agent-references/artifact-writer-spec.md

### R-16 [P3] update-chg update-status 步骤 3 残留孤行「datetime 格式强制」——completed-date 退役后该子流程不再写任何 datetime

- 位置：`plugin/agent-references/instructions/update-chg.md` :117
- 指控：v6 的 update-status frontmatter 联动在 status→completed 时写 `completed-date: <ISO datetime>`，「datetime 格式强制」bullet 是为它服务的。v7 退役 completed-date 后（CHG-10 审计 P1-1 修掉了 :102 的「并添加 completed-date」教学），步骤 3 的全部子项只改 status 枚举值、不写任何日期字段，但该 datetime bullet 原样留在步骤 3 内，成为无对象的悬空指令（可能误导 agent 在 update-status 时寻找/写入某个日期字段）。
- 证据：当前 update-chg.md:111-117：步骤 3 子项为「全部为 [-] → cancelled / 全部为 [x] 或 [-] → completed / 仍有 [/] → in-progress / 否则不变」+ 「**datetime 格式强制**：YYYY-MM-DDTHH:mm:ss+08:00…用 Bash: date -Iseconds…生成即可满足该格式」。git show a167727:…/update-chg.md 对照：旧版同位置有「→ completed，并添加 completed-date: <ISO 8601 datetime>」，datetime bullet 是其配套；v7 删了写入、留了格式说明。
- 复现：sed -n 104,120p plugin/agent-references/instructions/update-chg.md 与 git show a167727:plugin/agent-references/instructions/update-chg.md 同段对照

### R-17 [P3] close-chg 删除占位注释的引用文本与 create-chg 实际模板文本不一致（「在执行阶段由」vs「在收口时由」）

- 位置：`plugin/agent-references/instructions/close-chg.md` :112
- 指控：close-chg.md 步骤 1.5 要求删除「创建时的占位注释行」，引用原文为「（各任务的实施说明在执行阶段由 … 不在此预填占位符。）」；但 create-chg.md:92 模板实际写入的是「（各任务的实施说明在收口时由 `close-chg implementation-notes` 字段写入，…）」。commit 1619f4c（CHG-20260610-10）改了 create 端措辞但未同步 close 端引用。agent 按引用前缀字面定位占位行会匹配失败（前 13 个字符即不同），依赖 agent 自行模糊匹配。
- 证据：close-chg.md:112 `「（各任务的实施说明在执行阶段由 … 不在此预填占位符。）」` vs create-chg.md:92 `（各任务的实施说明在收口时由 \`close-chg implementation-notes\` 字段写入，中途可用 \`update-chg section=implementation\` append；create 阶段任务未实施，不在此预填占位符。）`。git log -L 92,92:plugin/agent-references/instructions/create-chg.md 显示 1619f4c 把「在执行阶段由」改为「在收口时由」，close-chg.md 引用未跟改。
- 复现：grep -rn '各任务的实施说明在' plugin/agent-references/instructions/

### R-18 [P3] spec §5.1 hashtag 对齐表含不可达的 `type: research → #research` 行

- 位置：`plugin/agent-references/artifact-writer-spec.md` :156
- 指控：v7 封闭合同下 CHG 帧无 type key（spec §2.1：「type 由文件名前缀承载」），文件名前缀只有 chg-/hotfix-（spec §1 文件结构），create-chg 输入 `type` 枚举也只有「默认 change，可选 hotfix」（create-chg.md:30）。§5.1 的 `type: research → #research` 行没有任何可达的产生路径（hooks 中也无 #research 消费者），是 v6 之前遗留的死规则行，与 v7 合同内部矛盾。
- 证据：artifact-writer-spec.md:154-156 hashtag 表含 `- \`type: research\` → \`#research\``；create-chg.md:30 `type（默认 change，可选 hotfix——决定文件名前缀与 hashtag）`；grep '#research' plugin/hooks/ 零命中；git show a167727 旧 spec chg 帧 `type: change # change | hotfix` 证明 v6 时该行已不可达，v7 清理 type 字段时仍未删。
- 复现：grep -rn 'research' plugin/agent-references/artifact-writer-spec.md plugin/agent-references/instructions/create-chg.md; grep -rn '#research' plugin/hooks/ --include='*.js'

### R-19 [P3] create-chg「文件名 slug」段对 reserved-file-prefix 的形状描述与 reserve helper 实际输出及同文件示例不一致

- 位置：`plugin/agent-references/instructions/create-chg.md` :68
- 指控：create-chg.md:68 描述「`reserved-file-prefix` 形如 `changes/chg-yyyymmdd-nn-`（末尾 `-`）。你按 title 生成…slug，拼成 …」；但 reserve-artifact-id.js:96 实际输出的 prompt 字段值是 `changes/chg-yyyymmdd-nn-<slug>.md`（含字面 `<slug>.md` 占位），同文件 L17 与 agents/artifact-writer.md L211 的 prompt 示例也都注明「原样含 <slug>.md 占位」。同一文件内两种互斥的字段形状描述，按 :68 字面「拼接」语义处理实际输入会得到 `…-<slug>.mdreal-slug.md` 类错误路径，依赖 agent 自行识别应替换占位符。
- 证据：create-chg.md:17 `reserved-file-prefix: <reserve helper 输出（原样含 <slug>.md 占位…）>` vs :68 `\`reserved-file-prefix\` 形如 \`changes/chg-yyyymmdd-nn-\`（末尾 \`-\`）…拼成 …`。reserve-artifact-id.js:96 `lines.push(\`reserved-file-prefix: ${reservation.filePrefix}<slug>.md\`)` + :97「原样保留末尾 <slug>.md 占位…caller 不要替换它」。
- 复现：grep -n 'reserved-file-prefix' plugin/agent-references/instructions/create-chg.md plugin/hooks/reserve-artifact-id.js

### R-20 [P3] hooks/templates/implementation_plan.md 退役死模板仍随发布面发布，且内容是 v6 活跃索引头而非 tombstone

- 位置：`plugin/hooks/templates/implementation_plan.md` :1-9
- 指控：v7 把 implementation_plan.md 退役出 ARTIFACT_FILES（constants.js:8，注释明示 CHG-20260611-08），模板的两个消费路径（createTemplates 的 ARTIFACT_FILES 循环、PreToolUse T-206 的 ARTIFACT_FILES.includes 模板注入）都不再触达它——该模板文件是 marketplace 发布面里的死文件。且其内容仍是 v6 活跃布局头（`# 实施计划 / ## 变更索引` + CHG 索引行格式注释），与 v7 tombstone 语义（migrate-v7.js TOMBSTONE「已退役…索引统一见 [[task]]」）相反；任何未来误引用都会重造触发「未迁移 v6 布局」告警的文件。
- 证据：ls plugin/hooks/templates/ 含 implementation_plan.md；constants.js:8 `ARTIFACT_FILES = ['spec.md', 'task.md', 'walkthrough.md', 'findings.md', 'corrections.md']`；pace-utils.js:762 / pre-tool-use.js:1307 均以 ARTIFACT_FILES 为模板消费白名单；grep -rln 'templates/implementation_plan' plugin/ tests/ 零命中。模板内容首行 `# 实施计划`、`## 变更索引`（v6 活跃头）。
- 复现：cat plugin/hooks/templates/implementation_plan.md; grep -n 'ARTIFACT_FILES =' plugin/hooks/pace-utils/constants.js; grep -rln 'templates/implementation_plan' plugin/ tests/

### R-21 [P3] agent 报告格式「操作」枚举只列 6/8 类指令，update-finding 同时缺正向输入模板（覆盖不对称）

- 位置：`plugin/agents/artifact-writer.md` :388
- 指控：artifact-writer.md §报告格式声明「所有 8 类指令…必须使用以下格式」，但成功模板的 `**操作**：[create-chg | update-chg | archive-chg | close-chg | record-finding | record-correction]` 枚举缺 update-finding / update-index 两类；§正向输入模板覆盖了 update-index（L354-361）却没有 update-finding 的模板（skill 侧 SKILL.md:251 也只有一句话提及无模板块）。8 类合同声明与 6 类枚举/模板覆盖不一致，update-finding 是唯一一个既无速查字段、又无输入模板的 operation。
- 证据：artifact-writer.md:367「8 类内的 operation…create-chg / update-chg / archive-chg / close-chg / record-finding / record-correction / update-finding / update-index」 vs :388 `**操作**：[create-chg | update-chg | archive-chg | close-chg | record-finding | record-correction]`；:354-361 有 update-index 模板、全文件无 update-finding 模板；grep 'update-finding' plugin/skills/ 仅 SKILL.md:251 一句提及。
- 复现：grep -n 'update-finding\|update-index\|操作**：' plugin/agents/artifact-writer.md; grep -rn 'update-finding' plugin/skills/

### R-22 [P3] record-finding 索引行 [change::] 示例缺 spec §5.4 全名+别名规则，照写对带 slug CHG 是 Obsidian 死链

- 位置：`plugin/agent-references/instructions/record-finding.md` :78
- 指控：spec §5.4 对 `[change::]` meta 明确要求「目标是带 slug 文件时用全名+别名（glob changes/chg-yyyymmdd-nn*.md 取 stem）」，update-finding.md:19 也带同款 glob-stem 规则；但 record-finding.md「## 索引行」段的 extra-meta 示例只写 `[change:: [[chg-id]]]`（status=accepted 时），未提全名+别名。create-chg.md:68 已说明「纯 ID wikilink 对带 slug 文件名是死链」——agent 在创建即 accepted 的 finding（record-finding 支持 status 输入 + related-changes）时照本文件示例写纯 ID，链接不可解析。
- 证据：record-finding.md:78 `- \`[change:: [[chg-id]]]\`（status=accepted 时）` vs spec §5.4（artifact-writer-spec.md:179）`[change:: [[<chg 详情文件名全名>|chg-id]]]（…目标是带 slug 文件时用全名+别名，旧无 slug 文件直接 [[chg-id]]——glob changes/chg-yyyymmdd-nn*.md 取 stem）` vs update-finding.md:19 同款 glob-stem 规则。三处中唯 record-finding 缺规则。
- 复现：grep -n 'change::' plugin/agent-references/instructions/record-finding.md plugin/agent-references/instructions/update-finding.md plugin/agent-references/artifact-writer-spec.md

**D3-agent-write 覆盖说明**：检查范围（D3：agent 写端单索引与模板同步，CHG-20260611-10）：通读 plugin/agents/artifact-writer.md（全文 437 行）、plugin/agent-references/artifact-writer-spec.md（全文 440 行）、instructions/ 全部 8 个文件（create-chg/update-chg/close-chg/archive-chg/record-finding/record-correction/update-finding/update-index 逐行）；plugin/skills/artifact-management/SKILL.md 模板段 + templates/{change,correction,finding}-detail.md + references/format-reference.md；plugin/hooks/templates/* 7 个文件；hooks 侧 promptTemplateForOperation（agent-lifecycle-guard.js:37-120 抽查 create/approve/approve-and-start/update-status 模板）、change-analysis.js SCHEMA_V7_KEYS/SCHEMA_V7_VALUE_REQUIRED、constants.js ARTIFACT_FILES、reserve-artifact-id.js 输出形状、migrate-v7.js DROP_KEYS 与 [scope::] 转换、post-tool-use.js correction 提醒。regression 指控均用 git show a167727:<path> 对照 v6 基线（record-correction.md / update-chg.md / create-chg.md / close-chg.md / post-tool-use.js / format-reference.md / hooks/templates/corrections.md / 旧 spec §2.1-§5.6），并读取 CHG-10 详情文件验收标准与审查记录定锚。确认无问题的面：(1) 单索引改造达标——grep implementation_plan 在 agents/ 与 agent-references/ 零命中，create/update/close/archive 四指令全部只写 task.md（update-chg v6 的「Read + Edit implementation_plan.md 同上」已删）；(2) completed-date 全发布面 grep 仅剩 migrate-v7.js:38 DROP_KEYS（迁移删除清单，合规），README/REFERENCE 无残留；(3) CHG 9-key/finding 3-key/correction 2-key 封闭合同帧在 spec §2.1-2.3、templates/change-detail.md、format-reference.md、SCHEMA_V7_KEYS（change-analysis.js:232-235）四方 key 集合与顺序逐字一致，spec :83 schema-keys 机器注释行与代码互锁（V7D-3 测试在跑）；(4) update-chg verify/review 的 frontmatter 写入位置描述（verified-date 在 change-set-seq 与 reviewed-date 之间、reviewed-date 在 verified-date 与 archived-date 之间）与 spec §2.1 顺序一致；(5) skill 最小字段模板与 agent 正向输入模板（create/approve/approve-and-start/close/verify/review/archive/record-finding/record-correction）字段逐项一致，approve-only 模板（CHG-20260612-01 锁定）三方一致；(6) 6.0 schema-version 残留在 agent/skill 面 grep 清零；(7) 测试实跑全绿：test-pace-utils 275/275、test-hooks-e2e 391/391、test-agent-tests-helpers 9/9。未深查面：migrate-v7 的迁移正确性与 frontmatter key 顺序归一（迁移产物保留 v6 相对顺序、hook 只校验集合不校验顺序，属 CHG-12 维度，本审计仅注意到 dogfood 产物 chg-20260611-10.md 顺序与 spec §2.1 不同但通过 hook）；session-start 注入质量与 foreign worktree 已知问题按指示跳过；spec §5 编号空洞（5.2/5.6.2 缺号）判定为保持跨文件 §引用稳定的合理取舍，未列 finding。

---

## D4 规范单源化与目标态 framing（CHG-11/CHG-20260612-01）（10 条）

### R-23 [P1] REFERENCE.md §8 发布检查要求 schema-version 保持 "6.0"，与 v7 封闭合同 7.0 直接矛盾

- 位置：`REFERENCE.md` :258
- 指控：发布检查清单写「artifact frontmatter `schema-version` 仍为 `"6.0"`；不要随插件 patch 版本滚动」，但 v7 全部发布面模板（change-detail/finding-detail/correction-detail/format-reference/spec §2.1）与 validateFrontmatterSchema（change-analysis.js L254 只认 '7.0'）均为 "7.0"。下次发布按此清单核对会把正确的 7.0 判为异常，或诱导回写 6.0（会被运行时合同打回）。CHG-20260611-13 T-002 自称「README/REFERENCE v7 行为同步」（commit 5b1cd3c）但只改了 3 处，本行漏改。规格内部矛盾，每个发布周期可达。
- 证据：REFERENCE.md:258 `- artifact frontmatter \`schema-version\` 仍为 \`"6.0"\`；不要随插件 patch 版本滚动`；对照 plugin/hooks/pace-utils/change-analysis.js:254 `if (normalizeFrontmatterStatus(fm['schema-version']) !== '7.0')`、plugin/skills/artifact-management/templates/change-detail.md `schema-version: "7.0"`、plugin/agent-references/artifact-writer-spec.md:57/67/76 均为 "7.0"
- 复现：grep -n 'schema-version' REFERENCE.md plugin/hooks/pace-utils/change-analysis.js plugin/skills/artifact-management/templates/change-detail.md

### R-24 [P2] agent.md「正向输入模板」close-chg 块缺 implementation-notes——锁外拷贝已实际漂移

- 位置：`plugin/agents/artifact-writer.md` :271-284
- 指控：agents/artifact-writer.md 的 `### close-chg` 完整 prompt 模板（## 正向输入模板 下）没有 implementation-notes 行，与同文件 L189 必填字段清单（含 implementation-notes）、guard 硬校验（agent-lifecycle-guard.js:564 缺失即 deny）、instructions/close-chg.md L22-23、artifact-management SKILL 模板四处不一致。这是 CHG-11 要消灭的 A1 类漂移的现存实例（a167727 之前已存在，CHG-10「7.0 模板全量同步」与 CHG-11「单源化」两轮都未修），且位于 V7D 锁外（V7D-1 只锁 §4 必填清单、V7D-2 不读 agent.md 模板），当前 275/275 全绿。
- 证据：plugin/agents/artifact-writer.md:273-284 模板字段为 verification-confirmed/complete-open-tasks/review-confirmed/review-source/review-findings/verify-summary/walkthrough-summary（无 implementation-notes）；同文件 L189 必填清单含 `implementation-notes`；plugin/hooks/pre-tool-use/agent-lifecycle-guard.js:564 `if (!promptHasNonEmptyField(text, 'implementation-notes')) missing.push('implementation-notes')`；plugin/agent-references/instructions/close-chg.md:22-23 模板含 implementation-notes；node tests/test-pace-utils.js → 275/275 绿
- 复现：sed -n '271,285p' plugin/agents/artifact-writer.md && grep -n 'implementation-notes' plugin/agents/artifact-writer.md plugin/hooks/pre-tool-use/agent-lifecycle-guard.js plugin/agent-references/instructions/close-chg.md && node tests/test-pace-utils.js | tail -1

### R-25 [P2] V7D 一致性锁只覆盖 guard↔instruction；agent.md/SKILL/pace-bridge 模板拷贝在锁外，CHG-20260612-01「三处拷贝漂移即红灯」验证主张被 mutation 证伪

- 位置：`tests/test-pace-utils.js` :3462-3494
- 指控：操作模板在发布面实有 5 份拷贝（instructions 权威、guard promptTemplateForOperation、agents/artifact-writer.md ## 正向输入模板、artifact-management SKILL 最小字段模板、pace-bridge SKILL Step 4），V7D-2 只对位 guard↔instruction 两份；commit 7369990 与 CHG-20260612-01 实施详情声称「agent.md/SKILL 拷贝经由 guard 模板间接受锁」「三处拷贝（guard/agent.md/SKILL）漂移即红灯（mutation 验证）」——实测从 agent.md approve-only 模板删除 approval-evidence 字段后 275/275 仍全绿，主张不成立；finding-2026-06-12-chg-11-audit-p3 的 actionable ② 实际只兑现了一半。另有锁外文本漂移佐证：SKILL resume 模板占位文案「当前阻塞已解除」vs instruction/agent.md「阻塞已解除」。
- 证据：mutation 实验：perl 删除 plugin/agents/artifact-writer.md `### approve only` 块的 approval-evidence 行 → node tests/test-pace-utils.js 输出 `✅ 275/275 tests passed` → git checkout 还原。tests/test-pace-utils.js:3462-3494 V7D-2 仅读 guard.promptTemplateForOperation 与 agent-references/instructions/*.md，无任何断言读 agents/artifact-writer.md 或 SKILL.md 模板块；CHG 详情声称见 /mnt/c/.../changes/chg-20260612-01-...md「agent.md/SKILL 拷贝经由 guard 模板间接受锁」与 commit 7369990 message「三处拷贝（guard/agent.md/SKILL）漂移即红灯」
- 复现：perl -0pi -e 's/(action: approve\napproval-confirmed: true\napproval-source: [^\n]+\n)approval-evidence: [^\n]+\n/$1/' plugin/agents/artifact-writer.md && node tests/test-pace-utils.js | tail -1 && git checkout -- plugin/agents/artifact-writer.md

### R-26 [P2] hook 运行时文案 13 处仍以「v6」自称当前系统——目标态 framing 重写漏掉 hooks 字符串面

- 位置：`plugin/hooks/post-tool-use.js` :195,251,260,267（另见多文件）
- 指控：CHG-11 裁定「目标态 framing 全发布面重写」（correction-2026-06-11-01），agent.md/spec/instructions/SKILL 已清理，但 hook 用户/AI 可见输出字符串仍把当前系统称为 v6：post-tool-use.js:195「v6 唯一路径是 artifact-writer…」、:251「不符合 v6 完成记录规范」、:267「先创建 v6 CHG」、stop.js:355「v6 详情文件中仍有 N 个未完成任务」、marker-guard.js:17「v6 流程 artifact 只能由…写入」、pre-tool-use.js:1548「已自动创建 v6 Artifact 模板」、:480 与 reserve-artifact-id.js:169「创建完整 v6 Artifact 基础结构」、session-start/layers.js:300「桥接为 v6 CHG」、pace-utils.js:424/435/436 v5 迁移提示「changes/ v6 详情目录」「重新走 v6 P-A-C」（v5 迁移语境提 v5 合理，但把当前目标称 v6 在 7.0.0 下已失实）。全部为日常可达的 deny/warning/注入文案。
- 证据：grep -rn 'v6' plugin/hooks/*.js plugin/hooks/pre-tool-use/*.js plugin/hooks/session-start/*.js 串字面量命中 13 处（见上列行号）；对照 plugin/hooks/pace-utils/constants.js:5 `PACE_VERSION = 'v7.0.0'`；CHG-11 范围裁定见 docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §4「范围扩充…全发布面扫描」
- 复现：grep -n 'v6' plugin/hooks/post-tool-use.js plugin/hooks/stop.js plugin/hooks/pre-tool-use.js plugin/hooks/reserve-artifact-id.js plugin/hooks/pace-utils.js plugin/hooks/pre-tool-use/marker-guard.js plugin/hooks/session-start/layers.js | grep -v '^\s*//'

### R-27 [P2] README 当前行为区残留「v6 CHG」与「task/impl 索引」——CHG-20260612-01「白名单之外零漏网」复查结论被证伪

- 位置：`README.md` :133,142
- 指控：README「特色功能」当前行为区（非 v5 对比表/changelog 白名单）：L133 Superpowers 流程图「pace-bridge（派 artifact writer 创建 v6 CHG）」、L142「一键转换为 PACE v6 CHG（`changes/<id>.md` + task/impl 索引）」——后者除版本措辞外还宣称双索引（impl 索引），与 v7「task.md 唯一 CHG 索引」合同直接冲突。CHG-20260612-01 T-001 的复查 grep 用 `implementation_plan` 字面量，匹配不到缩写「impl」，导致「白名单之外零漏网」验收结论失实。
- 证据：README.md:142 `pace-bridge skill 一键转换为 PACE v6 CHG（\`changes/<id>.md\` + task/impl 索引）`；README.md:133 `→ pace-bridge（派 artifact writer 创建 v6 CHG）`；chg-20260612-01 详情 T-001 记录「grep -n implementation_plan 复查…唯一漏网是 :237」未覆盖 :133/:142；对照 plugin/skills/pace-bridge/SKILL.md:127 已写「task.md 活跃 wikilink 索引（唯一 CHG 索引）」
- 复现：grep -n 'v6 CHG\|task/impl' README.md

### R-28 [P2] README/REFERENCE 仍宣称 PreCompact 写快照（含具体文件 pre-compact-state.json）——该机制已于 CHG-20260608-11 退役

- 位置：`README.md` :60,226,279,309；REFERENCE.md:175
- 指控：pre-compact.js 自 commit 03447f3（CHG-20260608-11 M4/T-002，先于 v7）起退役快照机制，现仅做 native plan 兜底检测，明确「不再写 .pace/pre-compact-state.json」。但 README 当前行为面 4 处仍宣称快照：L226 hook 事件表「PreCompact | 快照当前状态，防丢失」、L279 目录树注释「Compact 前快照」、L309 I/O 表「写 `.pace/pre-compact-state.json` 快照」（该文件运行时永不产生）、L60 v6 列「PreCompact 写快照，compact 后恢复当前状态」；REFERENCE.md:175 hook 表「pre-compact.js | 快照活跃 CHG、pending、approved、verified 状态」。非 v7 regression，但 CHG-13 T-002「README/REFERENCE v7 行为同步」未清理，属发布合同与代码可达行为不一致。
- 证据：plugin/hooks/pre-compact.js:1-4 头注释「原『写 artifact 状态快照…』机制已退役」、:100「快照写入已退役（不再写 .pace/pre-compact-state.json）」，全文件无 pre-compact-state.json 写入路径；README.md:309 `| PreCompact | stdin JSON | 无 stdout（写 \`.pace/pre-compact-state.json\` 快照）| N/A |`
- 复现：grep -n '快照' README.md REFERENCE.md && grep -n 'pre-compact-state' plugin/hooks/pre-compact.js

### R-29 [P2] README「8 类 hook 事件」与 hooks.json 实注册 9 事件不符；SessionEnd 在 README/REFERENCE hook 表均无行

- 位置：`README.md` :100,216
- 指控：plugin/hooks/hooks.json 实际注册 9 类事件（SessionStart/PreToolUse/PostToolUse/PostToolUseFailure/SubagentStop/Stop/PreCompact/StopFailure/SessionEnd），session-end.js（owner 降级 detached，CHG-20260611-02/03）已发布并有 e2e 覆盖（SE-1/SE-2）。README:100「安装后 8 类 hook 事件…自动注册」、README:216「### 8 类 Hook 事件覆盖完整生命周期」表无 SessionEnd 行；REFERENCE.md §5 hook 表同样缺 session-end.js 行。CHG-13 T-002 行为同步遗漏。
- 证据：grep -oE '"(SessionStart|SessionEnd|...)"' plugin/hooks/hooks.json | sort -u → 9 个事件名含 SessionEnd（hooks.json:127 注册 session-end.js）；README.md:100/216 均写「8 类」；REFERENCE.md §5 表（L166-176）无 session-end 行
- 复现：grep -c 'hooks\[\]' /dev/null; grep -oE '"(Session(Start|End)|Pre(ToolUse|Compact)|Post(ToolUse|ToolUseFailure)|SubagentStop|Stop|StopFailure)"' plugin/hooks/hooks.json | sort -u && grep -n '8 类' README.md && grep -n 'session-end' REFERENCE.md

### R-30 [P2] REFERENCE.md 标题仍为「PACEflow v6.6.1 参考手册」，7.0.0 发布同步遗漏版本锚点

- 位置：`REFERENCE.md` :1-5,166
- 指控：plugin.json/marketplace.json/PACE_VERSION 均已 bump 7.0.0（commit 5b1cd3c），同 commit 自称「REFERENCE v7 行为同步」但只改 3 处行为行，文档自身版本锚点全部漏改：L1「# PACEflow v6.6.1 参考手册」、L3「最后更新：2026-06-07」（v7 重构全部发生在 06-11/06-12）、L5「v6 决策：…」、L166 表头「| Hook | v6 职责 |」、L22「v6 迁移 guidebook」。用户打开参考手册看到的是上上个 minor 版本的自我声明。
- 证据：REFERENCE.md:1 `# PACEflow v6.6.1 参考手册`、:3 `> 最后更新：2026-06-07`；plugin/.claude-plugin/plugin.json:4 `"version": "7.0.0"`；git show 5b1cd3c -- REFERENCE.md 仅 3 hunk（术语表/目录树/create-chg 行），未触及标题区
- 复现：head -5 REFERENCE.md && grep -n version plugin/.claude-plugin/plugin.json && git show 5b1cd3c --stat

### R-31 [P3] 报告标题硬约束未按设计单源化：spec §10 已立权威节，但 3 个 instruction 仍保留 5 处措辞分叉的完整复述

- 位置：`plugin/agent-references/instructions/update-chg.md` :86,222,276；close-chg.md:57；create-chg.md:42
- 指控：设计单源化矩阵（design §4.2）将「报告标题硬约束 + CRLF/stale-read 处理块」列为一行：spec 单节 + 各 instruction 一行指针。实施只完成了 CRLF 半边（spec §9.1 + close/archive 指针），报告标题半边未做：spec §10 已是权威节，但 close-chg.md:57、create-chg.md:42、update-chg.md:86/222/276 共 5 处保留完整复述且措辞已三分叉（「无自然语言、无空行、无说明前缀」vs「无说明文字、无空行」vs「标题作为独立单行」），其余 5 个 instruction 又完全不复述——不一致应用且无任何测试锁。CHG-11 T-001 实施记录只列「CRLF 块单源 spec §9.1」，验收「重复块各仅剩权威位置一份完整版」对此项未达成。
- 证据：grep -rn '报告标题强制\|第一行字面' plugin/agent-references/instructions/*.md → 5 命中、3 种措辞；docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §4.2 表行「报告标题硬约束 + CRLF/stale-read 处理块（5+ 处已分叉）| spec 单节 | 各 instruction 改一行指针」；chg-20260611-11 详情 T-001 记录仅含「CRLF 块单源 spec §9.1」
- 复现：grep -rn '报告标题强制\|第一行字面' plugin/agent-references/instructions/ && grep -n '## 10' plugin/agent-references/artifact-writer-spec.md

### R-32 [P3] v5 迁移路径仍产出已退役的 implementation_plan.md 索引文件；templates/implementation_plan.md 为零引用死模板随发布面 ship

- 位置：`plugin/migrate/batch-archive-v5.js` :30-35
- 指控：batch-archive-v5.js 的 V6_TEMPLATES（注释自称「来自 spec §5.6」——该 spec 节 v7 已删除 impl_plan 条目 §5.6.2）仍为迁移目标创建带「## 变更索引」的 implementation_plan.md，v5 用户今天升级会得到 v7 文件模型（README L38-46、REFERENCE 目录树）中不存在的索引文件（空活跃区不触发 detectUnmigratedV6Layout 催办，长期残留）。同时 plugin/hooks/templates/implementation_plan.md 已不在 ARTIFACT_FILES（constants.js:8），createTemplates 永不复制它，全仓零代码引用，是发布面死模板。仅 v5 存量用户可达，判 P3。
- 证据：plugin/migrate/batch-archive-v5.js:33-34 `'implementation_plan.md': \`# 实施计划\n\n## 变更索引\n…\``；plugin/hooks/pace-utils/constants.js:8 ARTIFACT_FILES 无 implementation_plan.md；pace-utils.js:762 createTemplates 仅遍历 ARTIFACT_FILES；grep -rn 'templates/implementation_plan' plugin/ tests/ 零命中（模板文件无引用方）
- 复现：grep -n -A3 "'implementation_plan.md':" plugin/migrate/batch-archive-v5.js && grep -n 'ARTIFACT_FILES =' plugin/hooks/pace-utils/constants.js && grep -rn 'templates/implementation_plan' plugin/ tests/

**D4-single-source 覆盖说明**：检查面（D4 规范单源化与目标态 framing）：1) 变更态措辞全扫——grep「v5/v6/v7/不再/改为/现在/legacy/退役/不再写/帧无」覆盖 plugin/**（hooks JS 字符串、agents、agent-references、instructions、skills、commands、templates、migrate）+ README.md + REFERENCE.md，逐处区分白名单（README v5 对比表 §50-98、版本历史表 L370+、v5 迁移语境、format-reference 示例 slug）与正文残留；agent-references/agents/skills 经 CHG-11 重写后确认干净（仅示例 slug 'hooks-v6-rework' 良性），残留集中在 hook 运行时字符串与 README/REFERENCE（已报）。2) 操作模板拷贝盘点——approve-only/approve-and-start/update-status/verify/review/close-chg/create-chg 在 5 个位置（instructions 权威、guard promptTemplateForOperation、agents/artifact-writer.md 正向输入模板、artifact-management SKILL 最小字段模板、pace-bridge SKILL Step4）逐字段比对：字段名集合除 agent.md close-chg 缺 implementation-notes（已报）外一致；占位文案有 1 处微分叉（SKILL「当前阻塞已解除」）；approval-source/review-source 枚举值各处一致。3) V7D 锁范围实证——通读 V7D-1/2/3 与 V7C-1/2 断言源码，确认锁仅覆盖 guard↔instruction、agent.md §4 close-chg 必填清单、spec schema-keys↔代码；对 agent.md approve-only 模板做删字段 mutation 实跑（275/275 仍绿后还原，git status 确认工作区干净），证伪 CHG-20260612-01「三处拷贝漂移即红灯」。4) status-reason 词表——全发布面仅 status-reason 一种写法（11 处取值语义一致），guard 宽容期兼认 block-reason/pause-reason（agent-lifecycle-guard.js:403-405）与设计 D1 一致，无问题。5) 五个 command（pause/disable/resume/enable/status）逐文件通读：v7 行为描述准确（pause.md impl_plan 残留已被 2ad00d0 修掉），无 §5.1 死引用，无版本措辞残留，确认无问题。6) 其余单源化矩阵项验证落实：状态映射表（SKILL:318 指针 + change-lifecycle:3 指针→spec §4）、helper 命令来源 4 步（pace-workflow 权威 + artifact-management:21/pace-bridge:32 指针）、CRLF 块（spec §9.1 + close/archive 指针）均已落实；报告标题半边未落实（已报 P3）；spec §5.2/§5.6.2 跳号为 CHG-11 记录在案的有意决策，不算 finding。7) 9-key 合同发布面描述：change-detail/format-reference/finding-detail/correction-detail 模板与 SCHEMA_V7_KEYS 一致（V7C-1 锁覆盖），README v7.0.0 changelog「9/3/2 key」与代码一致。8) 基线验证实跑：test-pace-utils 275/275、test-hooks-e2e 391/391、test-session-layers 42/42、test-agent-tests-helpers 9/9 全绿。9) before/after 实证：agent.md close-chg 模板缺字段与 PreCompact 快照文案均经 git show a167727 / 03447f3 确认非 v7 改坏（已在 claim 中注明），REFERENCE 标题漂移经 git show 5b1cd3c 确认为同步遗漏。已知问题（foreign worktree 搭便车、SessionStart 注入质量、tests gitignore 豁免）未重复报告。

---

## D5 migrate-v7 迁移工具（CHG-12/13）（9 条）

### R-33 [P2] rewriteFrontmatter 状态判定不剥引号：status: "archived" 的 CHG 回填不触发，整库迁移被验收中止

- 位置：`plugin/migrate/migrate-v7.js` :145, 162（对照 273）
- 指控：rewriteFrontmatter 用 `line.slice(line.indexOf(':')+1).trim()` 取 status 原文（保留引号），`/^(archived|cancelled)$/.test(status)` 对带引号的 `status: "archived"` 判 false → archived-date 回填整段跳过；而验收端 validateFrontmatterSchema 内部 normalizeFrontmatterStatus 会剥引号、按 archived 要求 archived-date 非 null → 验收失败、整库还原、exit 1。同文件 main() 第 273 行 `(parseFrontmatter(raw).status||'').replace(/"/g,'')` 明确剥引号（作者已预期引号 status 存在），与 145 行判定不一致。后果 fail-safe（不损坏数据）但含此类帧的 vault 无法用本工具迁移，报错 `missing=[archived-date]` 不提示根因是回填未触发。
- 证据：migrate-v7.js:145 `if (key === 'status') status = line.slice(line.indexOf(':') + 1).trim();` + :162 `if (kind === 'chg' && /^(archived|cancelled)$/.test(status))`。实跑复现输出：`验收失败（已还原全部文件）：changes/chg-20250101-01.md: missing=[archived-date] unknown=[]`，exit=1（fixture：status: "archived"、无 archived-date、walkthrough 有对应回填行——未带引号时同 fixture 迁移成功）。
- 复现：构造 mini vault：changes/chg-20250101-01.md frontmatter 含 `status: "archived"`（带引号）、无 archived-date、schema-version "6.0"；walkthrough.md 含 `| 2025-01-02 | done | CHG-20250101-01 |` 行。跑 `node plugin/migrate/migrate-v7.js --cwd <dir>` → exit 1 + missing=[archived-date]；去掉引号重跑 → 回填成功。现成 bench：node /tmp/mig-audit-bench.js（案例1）

### R-34 [P2] 零缩进 YAML 块序列（tags:\n- item）删 key 后孤儿行残留 frontmatter，验收假绿放行损坏帧

- 位置：`plugin/migrate/migrate-v7.js` :133-141（孤儿路径 136）
- 指控：续行吞噬只认 `/^\s+\S/`（行首空白），零缩进的 YAML 块序列项 `- change` 既不匹配续行、也不匹配 key 正则 `^([A-Za-z][\w-]*):`，走 `keep.push(line)` 原样保留——`tags:`/`aliases:` key 行被 DROP 后，列表项变成 frontmatter 顶层孤儿行（无效 YAML mapping，Obsidian properties 面板解析失败）。验收无法兜底：parseFrontmatter 逐行只认 `key:` 行、孤儿行不可见，封闭合同 unknown-key 检查失明 → 报「验收 100% 通过」。这是 CHG-12 验收设计（『任一失败还原』）覆盖不到的静默损坏通道；零缩进块序列是合法 YAML（yq 等 emitter 默认形态），手编/外部工具写入即触发。
- 证据：实跑产物 frontmatter（验收绿、exit 0）：`status: completed` / `parent-tasks: [...]` 之后残留 `- change`、`- foo`、`- CHG-20250101-01` 三行孤儿，后接补缺的 `change-set: null` 等。报告输出『迁移完成：1 个文件，验收 100% 通过』。pace-utils parseFrontmatter：`const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/); if (m) out[...]`——非 key 行直接忽略。
- 复现：构造 chg 详情 frontmatter 含 `tags:\n- change\n- foo\naliases:\n- CHG-20250101-01\n`（零缩进），跑 migrate-v7 → exit 0 验收通过，cat 产物 frontmatter 可见孤儿 `- change` 行。现成 bench：node /tmp/mig-audit-bench.js（案例2）

### R-35 [P2] corrections 索引格式注释 v6 速记 `[knowledge:: [[note]] | project-only]` 残留三处发布面，migrate 清洗的脏 pattern 会被新项目再生

- 位置：`plugin/hooks/templates/corrections.md` :7（另见 agent-references/instructions/record-correction.md:114、plugin/migrate/batch-archive-v5.js:42）
- 指控：spec §3.3 / artifact-writer-spec.md:251（§5.6.5 模板）已修正为 `[knowledge:: [[note]]] 或 [scope:: project-only]`（明确『不把 scope 值塞进 [knowledge::]』），migrate-v7 repairCorrectionsIndex 专门清洗 `[knowledge:: project-only]` 脏行；但 hooks/templates/corrections.md:7 仍是 v6 合并速记——该模板被 createTemplates（每个新启用项目落盘）与 pre-tool-use.js T-206『请严格按照以下官方模板格式』注入路径分发；record-correction.md:114 的索引行模板同样保留速记（与同文件 56 行归一表自相矛盾）。新项目记录 project-only correction 时 agent 面对文件内注释+指令模板双重 v6 引导，可再生 migrate 刚清完的脏数据，且无 hook 校验 [scope::]/[knowledge::]（grep plugin/hooks 无 scope:: 消费）。另：repairCorrectionsIndex 只修索引行不修存量表头注释，已迁移 vault 的表头仍带 v6 速记。
- 证据：templates/corrections.md:7 `[knowledge:: [[note]] | project-only]` vs artifact-writer-spec.md:251 `[knowledge:: [[note]]] 或 [scope:: project-only]`；record-correction.md:114 `[knowledge:: [[note]] | project-only]` vs 同文件 :56 `knowledge-link: project-only → [scope:: project-only]`；migrate-v7.js:209-216 repairCorrectionsIndex 只处理 `^- \[\[correction-` 行。
- 复现：grep -rn 'knowledge:: \[\[note\]\] | project-only' plugin/ → 命中 templates/corrections.md:7、record-correction.md:114、batch-archive-v5.js:42；对照 grep -n 'scope::' plugin/agent-references/artifact-writer-spec.md（251 行）与 grep -rn 'scope::' plugin/hooks/（零命中）

### R-36 [P3] findings.md 表头 [change::] 声明只在 migrate 路径补齐，新项目模板与 spec §5.6.4 模板均缺，违反 spec §3.3 目标态且双处定义不单源

- 位置：`plugin/hooks/templates/findings.md` :5（另见 agent-references/artifact-writer-spec.md:235、migrate-v7.js:53）
- 指控：spec §3.3 敲定『findings.md 表头补 [change::] 第三字段声明（实际已存在使用，表头未声明）』；migrate-v7 用 FINDINGS_HEADER_COMMENT 给存量 vault 补上，但新项目分发的 hooks/templates/findings.md:5 与 agent 重建用的 spec §5.6.4 模板（artifact-writer-spec.md:235）都没有 [change::]——新建项目直接回到 v7 立项要修的『表头未声明』状态；且 record-finding.md:78 确实要求写 `[change::]` meta。同一表头注释在 migrate-v7.js:53 与两个模板三处各自维护，无一致性测试锁（V7D 组未覆盖 artifact 文件模板）。
- 证据：templates/findings.md:5 `... summary #finding [date:: YYYY-MM-DD] [impact:: P0-P3] -->`（无 [change::]）；artifact-writer-spec.md:235 同缺；migrate-v7.js:53 `FINDINGS_HEADER_COMMENT = '<!-- 格式：... [date::] [impact::] [change::] -->'`；spec §3.3 原文『表头补 [change::] 第三字段声明』。
- 复现：grep -n 'change::' plugin/hooks/templates/findings.md plugin/agent-references/artifact-writer-spec.md plugin/migrate/migrate-v7.js 并对照 docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md §3.3

### R-37 [P3] batch-archive-v5 在 v7 下产出 v6 终态布局且无 migrate-v7 衔接：空活跃区不触发未迁移催办，README v5 升级流程止步 v6

- 位置：`plugin/migrate/batch-archive-v5.js` :30-42（对照 pace-utils.js:678-686、README.md:67-84）
- 指控：v7.0.0 仍发布并在 README『v5 用户升级』中推荐 batch-archive-v5，但其 V6_TEMPLATES 写出 v6 形态：implementation_plan.md 是带『## 变更索引』的 v6 模板（非 v7 tombstone）、findings.md 表头缺 [change::]、corrections.md 表头 v6 速记。detectUnmigratedV6Layout 判据是『impl_plan 活跃区含 CHG 索引行』，fresh v5→v6 产物活跃区为空 → 永不触发 SessionStart/PostToolUse 的 migrate-v7 催办；README 推荐流程也未提示跑完 batch-archive-v5 后补跑 migrate-v7。v5 用户终态永久停留混合布局（机械上无害：v7 读端不消费 impl_plan、PROTECTED_ARTIFACTS 仍护住直写，但与 v7 终态合同不一致且无收敛路径）。
- 证据：batch-archive-v5.js:33-34 `'implementation_plan.md': '# 实施计划\n\n## 变更索引\n...'`；pace-utils.js:684 `return parseChangeIndex(activePart).length > 0;`（空活跃区 → false）；README.md:79-81 只给 batch-archive-v5 两条命令，无 migrate-v7 后续步骤。
- 复现：读 batch-archive-v5.js V6_TEMPLATES 与 pace-utils.js detectUnmigratedV6Layout；空目录放 v5 task.md 后跑 batch-archive-v5，再对产物目录调 detectUnmigratedV6Layout（或起 SessionStart）确认无迁移提示

### R-38 [P3] spec §3.1 correction 删除清单漏 project-scope（规格内部矛盾；实现 DROP_KEYS 正确）

- 位置：`docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md` :§3.1 字段表 correction 行
- 指控：spec §3.1 correction 帧删除列只列 correction-id、五文本字段、aliases、tags、knowledge-link，未列 project-scope；但 v6 correction 帧模板（a167727:artifact-writer-spec.md §2.3）实有 `project-scope: null` 字段，且 v7 保留集仅 date+schema-version——按封闭合同 project-scope 必须删。migrate-v7 DROP_KEYS.correction 已正确含 'project-scope'（否则验收 unknown 必炸），属规格表漏项、产物正确：规格与实现/旧帧三方对照下规格自身不闭合。反向地，删除列里的 aliases/tags 在 v6 correction 模板中并不存在（防御性多删无害）。
- 证据：spec §3.1：『删除：correction-id、五文本字段...、aliases、tags、knowledge-link』（无 project-scope）；git show a167727:plugin/agent-references/artifact-writer-spec.md §2.3 含 `project-scope: null`；migrate-v7.js:40 DROP_KEYS.correction 含 'project-scope'。
- 复现：对照三处：sed -n '/^### 3.1/,/^### 3.2/p' docs/superpowers/specs/2026-06-11-*.md；git show a167727:plugin/agent-references/artifact-writer-spec.md | sed -n '85,100p'；migrate-v7.js:40

### R-39 [P3] migrate 工具路径文档漂移：spec §5.1 写 plugin/hooks/migrate-v7.js，README 目录树注释 migrate/ 仍只写 v5→v6

- 位置：`docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md` :177（另见 README.md:290）
- 指控：spec §5.1 敲定工具位置为 `plugin/hooks/migrate-v7.js`，实际发布在 `plugin/migrate/migrate-v7.js`（与 batch-archive-v5 同目录，runtime 常量 MIGRATE_V7_SCRIPT 指向 ../migrate/，行为正确）；README.md:290 目录树注释 `migrate/  # v5 → v6 半自动迁移脚本` 未更新为同时承载 v6→v7 工具。纯文档/规格漂移，无运行时后果。
- 证据：spec:177 `plugin/hooks/migrate-v7.js，与 v5→v6 migrate 并列发布`；constants.js:43 `MIGRATE_V7_SCRIPT = path.resolve(HOOKS_DIR, '..', 'migrate', 'migrate-v7.js')`；README.md:290 `│   └── migrate/  #   v5 → v6 半自动迁移脚本`。
- 复现：grep -n 'plugin/hooks/migrate-v7' docs/superpowers/specs/2026-06-11-*.md; grep -n 'migrate/' README.md; ls plugin/migrate/

### R-40 [P3] --hygiene 游离在备份-验收-还原闭环之外：dry-run 不预览、删除物不入备份、--restore 不可逆

- 位置：`plugin/migrate/migrate-v7.js` :325-328, 365-386（对照 77-91）
- 指控：`--dry-run --hygiene` 组合下 dry-run 在 325 行提前 return，报告头（316-323）不含任何 hygiene 计划——用户按提示『确认无误后去掉 --dry-run 重跑』时，hygiene 的 fs.rmSync 删除全部 *.bak/*.v5-backup 与 7 个游离文档 _archive/ 改名是首次发生且无预览；这些删除/移动不写入 .pace/backups 备份，--restore（只回写备份内文件）无法还原。spec §5.2 第 5 步『本次迁移另有新备份』对 .v5-backup 不成立——迁移备份里的 task.md 是 v6 归档化转换后的形态，不是 .v5-backup 保存的 v5 精确原文。本 vault 一次性操作已执行完毕（CHG-13），但工具仍发布且 --hygiene 对任意 --cwd 生效。
- 证据：migrate-v7.js:325 `if (args.dryRun) { ...return; }` 先于 365 行 hygiene 块；372 行 `fs.rmSync(p)` 直接删除无备份；333-337 备份循环只覆盖 `changes` 数组（详情+4 索引文件）；restoreFromBackup（78-91）只遍历备份目录回写。
- 复现：阅读路径：migrate-v7.js 316-328（dry-run 报告与早退）→ 365-386（hygiene）→ 333-337（备份范围）；或 fixture 放 changes/x.bak 后跑 --dry-run --hygiene 观察报告无 hygiene 行、再真跑后确认 .pace/backups 中无 x.bak

### R-41 [P3] 测试覆盖缺口：--hygiene 与幂等重跑零用例、多结构 ARCHIVE 标记重排未锁；CHG-12 实施详情『13 用例』与实际 12 不符

- 位置：`tests/test-migrate-v7.js` :全文（V7E-1~8,12~15 共 12 用例）
- 指控：12 用例未覆盖三类已声明/已实测行为：(1) --hygiene 路径（删除 .bak/.v5-backup、游离文档移 _archive/）零用例；(2) 幂等性（已迁移 vault 重跑应 0 文件、产物字节不变——本审计手测通过，但无回归锁，CHG-13 工作记录称『幂等重跑 0/1 文件』为人工验证）；(3) findings.md 归档区含多个行首 ARCHIVE 标记的首匹配锚定（真实 vault 形态：CHG-12 审计 P3 记录『含 12 个历史 ARCHIVE 标记』；V7E-14 只锁行内文本形态）。另 CHG-12 实施详情写『tests/test-migrate-v7.js 13 用例黑盒』，提交时实为 10、现为 12（README v7.0.0 行写 12 正确），CHG 验收记录数字漂移。
- 证据：grep -c "^test(" tests/test-migrate-v7.js → 12；grep -L 'hygiene' 命中（文件内无 --hygiene 用例）；编号跳号 V7E-9~11 在 test-hooks-e2e.js:8035-8054（未迁移提示，非 migrate CLI）；CHG-12 详情 T-001 段『13 用例黑盒』vs 工作记录『test-migrate-v7 10/10』。幂等手测：同 fixture 连跑两遍，第二遍报告『待处理文件：0』、产物字节一致（/tmp/mig-audit-bench.js 案例3）。
- 复现：grep -n "test('V7E" tests/test-migrate-v7.js（无 hygiene/幂等/多标记用例）；node /tmp/mig-audit-bench.js 案例3 验证幂等行为本身无问题；CHG 详情见 /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/chg-20260611-12-*.md

**D5-migrate-tool 覆盖说明**：D5 专项（migrate-v7 迁移工具）审计覆盖：【通读全文】plugin/migrate/migrate-v7.js（395 行全部）、plugin/migrate/batch-archive-v5.js（262 行全部）、tests/test-migrate-v7.js（411 行全部 12 用例）；【调用链】pace-utils 的 parseFrontmatter / validateFrontmatterSchema / SCHEMA_V7_KEYS / SCHEMA_V7_VALUE_REQUIRED / frontmatterNullable / normalizeFrontmatterStatus（change-analysis.js:200-270）、ARCHIVE_MARKER/ARCHIVE_PATTERN（constants.js:46-47）、detectUnmigratedV6Layout（pace-utils.js:678-686）、createTemplates（pace-utils.js:747-774）、pre-tool-use.js T-206 模板注入（1306-1320）；【规格对锚】spec §2.1/§3.1/§3.2/§3.3/§5 全文、plan CHG-E 段、CHG-20260611-12/13 详情（验收标准+审查记录）、README v5 升级段与 v7.0.0 changelog 行、artifact-writer-spec.md §2.3(v6 via git show a167727)/§5.6.4/§5.6.5、record-correction.md/record-finding.md；【实际运行】node tests/test-migrate-v7.js → 12/12 绿；自建边界 bench（/tmp/mig-audit-bench.js）实跑三案例：引号 status（复现失败）、零缩进 YAML 列表（复现静默损坏+验收假绿）、幂等重跑（确认无问题）。确认无问题的面：(1) reorderFindingsIndex P0 修复干净——行内 ARCHIVE 文本（V7E-14 复刻真实形态）、多标记取首个行首锚定匹配（ARCHIVE_PATTERN 非全局 match 取 first）、无 ARCHIVE 文件原样返回、CRLF 索引文件兼容（pattern 带 \\r?）；(2) CHG-12 审计修复全部落地无残留——验收 skip 假绿已收口（r.skipped 与 !r.ok 同等失败，V7E-13 锁）、String.replace $ 模式已全部改 slice 拼接（rewriteFrontmatter:171、reorderFindingsIndex:203）、detail 文件 BOM/CRLF 归一（V7E-12 锁）且备份保真原始字节（backup 存 raw 非归一后内容）；(3) 备份-验收-还原主闭环正确：备份先于写盘、验收失败回写 c.before 原始字节、--restore 整树回写（V7E-15）、state 文件仅成功后写；(4) TOMBSTONE 与 spec §2.1 逐字一致（含 ARCHIVE 标记保留理由）；(5) DROP_KEYS 三 kind 与 v6 帧实有字段对照——chg 8 项含防御性 'id'、finding 多删 aliases/tags（v6 模板无此二字段，防御无害）、correction 含 spec 漏列的 project-scope（实现正确，规格漏项已报 finding）；(6) walkthrough 回填链：HOTFIX 大写匹配、chgId null 防卫、无记录回退执行日且报告注明 status（cancelled 语义为 spec 已裁定 fallback）；(7) 幂等性实测通过（第二遍 0 文件、产物字节一致）；(8) stripV5Tail 行首锚定防正文误切（df41ee7 修复确认）；(9) 验收循环全量重扫 collectDetailFiles（含未被改的存量 7.0 帧），漏迁通道（前导空行/损坏 frontmatter）走 abort+还原 fail-safe（V7E-13 验证）。未覆盖/受限：未对真实已迁移 vault（121 文件）做产物复检（CHG-13 已记录人工抽查）；hook 拦截 Bash 写 artifact 名文件，边界 bench 改用 Write+node 间接构造（不影响结论）。已知问题清单（foreign worktree 搭便车、SessionStart 注入质量、tests gitignore 豁免）未重复报告。

---

## D6 测试质量与假绿扫描（5 条）

### R-42 [P3] V7C-2「规格-代码互锁」实际锁的是测试内第三份硬编码拷贝，代码 SCHEMA_V7_KEYS 漂移时不红

- 位置：`tests/test-pace-utils.js` :3425-3433
- 指控：V7C-2 声称『spec §2.1 yaml 块与 SCHEMA_V7_KEYS 字段集一致（规格-代码互锁）』，但断言对象是测试内硬编码的 expected 数组（第 3431 行），而非已导出的 paceUtils.SCHEMA_V7_KEYS（plugin/hooks/pace-utils.js:119 已 export）。mutation 实证：向代码 SCHEMA_V7_KEYS.chg 加 'extra-key' 后，V7B-1/V7C-1/V7D-3 红但 V7C-2 保持绿。漂移逃逸链：维护者给代码加字段 → 修 V7D-3（更新 spec 机器注释）、修 V7C-1（更新模板）、修 V7B-1（更新测试帧）后全绿，而 spec §2.1 yaml 块（artifact-writer 写帧时阅读的人读权威模板）与测试硬编码列表双双过时仍互相相等 → 发布面 agent spec 与代码合同漂移无锁可红。这正是 v7 设计要消灭的 A1 类多拷贝漂移。修法一行：expected 改用 paceUtils.SCHEMA_V7_KEYS.chg。
- 证据：tests/test-pace-utils.js:3431: const expected = ['status', 'date', 'change-set', 'change-set-seq', 'verified-date', 'reviewed-date', 'archived-date', 'parent-tasks', 'schema-version'];（硬编码，未引用 paceUtils.SCHEMA_V7_KEYS）。mutation 运行输出：sed 向 change-analysis.js SCHEMA_V7_KEYS.chg 插入 'extra-key' 后 node tests/test-pace-utils.js → FAIL: V7B-1 / FAIL: V7C-1 / FAIL: V7D-3，272/275，V7C-2 不在 FAIL 列表（已还原）。
- 复现：grep -n "const expected" tests/test-pace-utils.js（3431 行硬编码）；grep -n "SCHEMA_V7_KEYS" plugin/hooks/pace-utils.js（119 行已导出）。复现：临时向 plugin/hooks/pace-utils/change-analysis.js 的 SCHEMA_V7_KEYS.chg 数组加一个字段，node tests/test-pace-utils.js，观察 V7C-2 仍 PASS，然后 git checkout -- 还原。

### R-43 [P3] validateFrontmatterSchema 的 cancelled 阶段必填分支零测试覆盖（删除分支三套件全绿）

- 位置：`plugin/hooks/pace-utils/change-analysis.js` :238
- 指控：SCHEMA_V7_VALUE_REQUIRED.chg.cancelled = ['archived-date']（cancelled CHG 必须有非 null archived-date）这一分支没有任何测试触达。mutation 实证：整体删除 cancelled 分支后 test-pace-utils（275）、test-migrate-v7（12）、test-hooks-e2e（391）全部保持绿。cancelled 是正常使用可达状态（CHG 取消流程产生），该校验回归（如重构时误删）不会被任何测试发现。V7B 组只覆盖了 in-progress/archived/finding/correction/未知 kind 五类。
- 证据：sed 删除 "cancelled: ['archived-date']" 后运行：✅ 275/275、✅ 12/12、✅ 391/391 全绿（已还原）。grep -rn "validateFrontmatterSchema" tests/ 的全部调用点（test-pace-utils.js 3353/3363/3366/3374/3380/3385-3397、test-migrate-v7.js 250/340）无一传入 status='cancelled'。
- 复现：临时将 plugin/hooks/pace-utils/change-analysis.js:238 的 SCHEMA_V7_VALUE_REQUIRED 中 cancelled 键删除，依次运行 node tests/test-pace-utils.js、node tests/test-migrate-v7.js、node tests/test-hooks-e2e.js，观察全绿；git checkout -- 还原。

### R-44 [P3] detectUnmigratedV6Layout 的「仅归档区有索引行不算未迁移」防护分支零覆盖（改读全文仍全绿）

- 位置：`plugin/hooks/pace-utils.js` :678-686
- 指控：detectUnmigratedV6Layout 用 ARCHIVE_PATTERN 切片只读 impl_plan 活跃区（682-684 行），代码注释明示防护目标：『读全文会把归档区旧行也算未迁移，全归档项目被永久催办』。但 e2e fixture（makeV6Project，test-hooks-e2e.js:214）的 implementation_plan.md 归档区永远为空，V7E-10 的 tombstone 变体也只是活跃区空（implIndex:''）。mutation 实证：把 activePart 改为读全文（删切片），391+275 全绿——该防护分支的回归（重构误删切片）无任何测试拦截，后果是 impl_plan 已全归档但未跑 migrate 的存量项目每 session 被永久注入迁移催办。
- 证据：plugin/hooks/pace-utils.js:682-684: const m = content.match(ARCHIVE_PATTERN); const activePart = m ? content.slice(0, m.index) : content;。mutation：替换为 const activePart = content; 后 node tests/test-hooks-e2e.js → ✅ 391/391、node tests/test-pace-utils.js → ✅ 275/275（已还原）。fixture 证据：test-hooks-e2e.js:214 impl_plan 写入 `...${implIndex}\n<!-- ARCHIVE -->\n`，ARCHIVE 下方无内容。
- 复现：临时将 plugin/hooks/pace-utils.js:683 改为 const activePart = content; 运行 node tests/test-hooks-e2e.js 观察 V7E-9/10/11 全 PASS；git checkout -- 还原。补测方向：fixture impl_plan 归档区放一条 CHG 索引行 + 活跃区为空，断言 session-start 无 migrate-v7 提示。

### R-45 [P3] test-session-layers.js 汇总行无条件打 ✅——失败时输出「✅ 41/42 tests passed」误导人读结果

- 位置：`tests/test-session-layers.js` :720-723
- 指控：test-session-layers.js 的 exit handler 汇总行硬编码 ✅ 前缀：console.log(`\n✅ ${t.passed}/${t.passed + t.failed} tests passed`)，有 fail 时仍打印 ✅（仅分子分母不等）；其余 4 个测试文件均为条件渲染 `${t.failed === 0 ? '✅' : '❌'}`。退出码本身正确（process.exitCode=1 在 exit handler 内赋值已实证生效），所以 CI 不假绿，但人读输出（如提交信息引用『✅ N/N』、grep ✅ 判断结果的脚本）会被误导，且与同仓库其余 runner footer 不一致。
- 证据：tests/test-session-layers.js:720-723: process.on('exit', () => { t.cleanup(); console.log(`\n✅ ${t.passed}/${t.passed + t.failed} tests passed`); if (t.failed > 0) process.exitCode = 1; });。对照 test-pace-utils.js:3521 / test-hooks-e2e.js:8068 均为 `${t.failed === 0 ? '✅' : '❌'}`。模拟实证：failed=1 时该 footer 输出「✅ 41/42 tests passed」且 exit=1。
- 复现：node -e "const t={passed:41,failed:1,cleanup(){}}; process.on('exit',()=>{t.cleanup();console.log('\\n✅ '+t.passed+'/'+(t.passed+t.failed)+' tests passed'); if(t.failed>0)process.exitCode=1;});"; echo exit=$? → 输出 ✅ 41/42 且 exit=1。对照阅读 tests/test-session-layers.js:722 与 tests/test-pace-utils.js:3521。

### R-46 [P3] test-utils.js runner 不支持 async 测试：async 断言失败仍打印 PASS 并 passed++，仅靠 Node unhandled-rejection 默认行为兜底退出码

- 位置：`tests/test-utils.js` :31-41
- 指控：ctx.test 同步调用 fn() 不 await：若未来有人写 test('x', async () => {...})，断言失败时该用例先被计入 passed 并打印 PASS，随后 promise rejection 以 unhandled rejection 形式崩溃进程——退出码确为 1（Node≥15 默认 throw，立即失败与 await 延迟失败两种场景均实证 exit=1），不构成 CI 假绿，但 PASS 行误标、failed 计数永远为 0、崩溃点之后的用例全部不执行且无汇总行。当前 5 个测试文件经 grep 确认零 async/await 用例，故为潜伏设计缺陷而非现行假绿。建议 runner 对 fn() 返回 Promise 时直接抛错拒绝（fail fast 显式化）。
- 证据：tests/test-utils.js:31-41: ctx.test = function(name, fn) { try { fn(); ctx.passed++; console.log(`  PASS: ${name}`); } catch(e) {...} }。实证 1（立即失败）：t.test('p', async () => { assert.ok(false) }) → 输出「PASS: p」+ passed=1 failed=0 + ERR_ASSERTION 崩溃 exit=1。实证 2（await 50ms 后失败）：同样 PASS 误标 + exit=1。grep -c "await" tests/test-hooks-e2e.js tests/test-pace-utils.js → 均为 0。
- 复现：node -e "const {createTestRunner}=require('/mnt/k/AI/paceflow-hooks/paceflow/tests/test-utils.js');const assert=require('assert');const t=createTestRunner('probe');t.test('async failure probe', async()=>{assert.ok(false,'should fail');});console.log('passed='+t.passed+' failed='+t.failed);" → 观察 PASS 行 + passed=1 failed=0 + 进程崩溃 exit=1。

**D6-test-quality 覆盖说明**：【运行验证】5 个测试文件全部实际运行且全绿，总计 729 用例：test-pace-utils.js 275/275（exit=0）、test-hooks-e2e.js 391/391（exit=0）、test-session-layers.js 42/42（exit=0）、test-agent-tests-helpers.js 9/9（exit=0）、test-migrate-v7.js 12/12（exit=0）。审计结束后重跑全部套件确认仍全绿，git status 确认工作区干净（仅预先存在的未跟踪 2026-06-12-115732-*.txt）。【runner 审计】test-utils.js（46 行全文）：同步用例失败正确计 failed 并打印 FAIL；5 个文件 footer 退出码语义逐一核验——test-pace-utils.js:3522 / test-hooks-e2e.js:8069 / test-migrate-v7.js:411 用 process.exit(1)，test-session-layers.js:722 / test-agent-tests-helpers.js:161 在 exit handler 内 process.exitCode=1（node -e 实证该写法生效 exit=1）。async 吞错探针两种场景（立即/await 延迟失败）均实证不会静默 exit 0（见 finding 5）。【假绿扫描】两种独立方法（awk 括号深度 + node split 扫描）扫全部 729 用例体：零 assert-free 用例、零 assert.ok(true)/assert(true) tautology、零空用例体、零 .only/xtest/skip 标记（skip 相关命中均为业务语义，且 test-migrate-v7.js:251 的 r.skipped===undefined 断言本身是反假绿设计）。e2e harness：runHook（test-hooks-e2e.js:35-51）正确捕获 exit code/stdout/stderr 不吞错；HOOKS_DIR 指向仓库 plugin/hooks 非 plugin cache；PACE_VAULT_PATH 隔离到 tmp 目录并在退出时还原。【mutation 抽查——全部真红且已还原，每次后 git checkout + git status 确认干净】V7A-7：PROTECTED_ARTIFACTS 删 impl_plan → 274/275 红；V7B-3/5：validateFrontmatterSchema unknown 检查改 no-op → 273/275 红（两用例）；V7C-1：change-detail.md 模板帧加 aliases → 红并精确报 unknown:['aliases']；V7D-2 含 CHG-20260612-01 新增 approve-only 锁：update-chg.md approve 模板 approval-evidence 改名 → 红且精确指向 action=approve；V7D-3：spec 机器注释删 date 字段 → 红；V7E 组：migrate-v7.js ARCHIVE 独占行锚定改 indexOf → 0/12 全组红；代码 SCHEMA_V7_KEYS 加字段 → V7B-1/V7C-1/V7D-3 三锁红（V7C-2 绿即 finding 1 证据）。【覆盖缺口确认】validateFrontmatterSchema：in-progress/archived/missing-key/missing-value/unknown/non-7.0 skip/未知 kind/finding/correction 分支均有测试；cancelled 分支零覆盖（finding 2，mutation 实证）。detectUnmigratedV6Layout：含活跃行/tombstone/文件不存在三分支有 V7E-9/10 覆盖；归档区切片防护分支零覆盖（finding 3，mutation 实证）。migrate --restore：正常路径 V7E-15 覆盖（且 mutation 验证真测脚本）；备份目录不存在 → exit 1 分支（migrate-v7.js:245-248）未测，属 trivial 防卫分支未单列 finding。schema 检查三个运行时调用点（post-tool-use.js:156→V7B-6/7、stop.js:219→V7B-8）均有 e2e 覆盖。V7E 用例 ID 1~15 跨 test-migrate-v7.js（12 个）与 test-hooks-e2e.js（V7E-9/10/11）核对无编号空洞。test-install.js 确认 untracked+gitignored，与 CLAUDE.md「本地副本」描述一致无文档漂移。【确认无问题面】runner 失败传播、断言强度、测试指向发布面（非 cache）、vault 隔离、V7A/V7B/V7C-1/V7D/V7E 锁的 mutation 有效性。【环境观察（非 D6 维度，供编排器参考，未计入 findings）】审计过程中 live PACEflow 写码门对 Edit 工具改 plugin 源码 deny（无活跃 CHG），但 Bash sed -i 改同类源码文件未被拦（仅当命令文本含 artifact 文件名字面量时被 artifact bash-guard 拦截）——若 Bash 写码检测属设计内不可判定范围则忽略，否则建议 D2/D3 维度审计员复核。

---

## D7 hook 状态机与运行时边界（6 条）

### R-47 [P2] reserve-artifact-id 重复 ID 安全网失效：existingMax 正则不匹配带 slug 的 CHG 文件名，counter 丢失时同日重复发号（已实测复现）

- 位置：`plugin/hooks/pace-utils/locks.js` :743
- 指控：create-chg 预留编号的兜底扫描 scanMaxNumberInDir 用正则 `^${lower}-${dateCompact}-(\d{2})\.md$`（数字后紧跟 .md），只匹配无 slug 的旧文件名；自 CHG-slug 改造（commit 6550ec4）后所有新 CHG 详情文件均为 `chg-YYYYMMDD-NN-<slug>.md` 形态，全部不被计入 existingMax。唯一防线只剩 .pace/sequences/ 的 counter 文件——而 .pace 被 .gitignore('*') 排除。counter 丢失/分叉（fresh clone、第二台机器共享 vault artifact root、手动清 .pace）且当日已有 CHG 时，会再次发出同一 CHG-ID；agent 用不同 slug 写入新文件不会触发 DENY_WRITE_EXISTING_ARTIFACT（文件名不同），task.md 出现两行同 ID 索引，getActiveChangeEntries 按纯 ID Map 去重会静默吞掉其中一个 entry。对照同函数 record-correction 分支（line 760）的正则 `^correction-${date}-(\d{2})-.+\.md$` 已适配 slug，CHG 分支是 slug 改造时的漏改。非 v7 回归（a167727 基线 line 767 同样代码），但属 D7 维度 reserve 原子性现行缺陷。
- 证据：实测：tmpdir 内预置 changes/chg-20260612-01-foo.md 与 chg-20260612-02-bar.md、.pace 为空，调用 pu.reserveArtifactId(dir,{operation:'create-chg',...}) 返回 `reserved: CHG-20260612-01 changes/chg-20260612-01-`——与已存在的 01 号重复。locks.js:746-748 `first = Math.max(current, existingMax || 0) + 1` 中 existingMax=0、current=0。
- 复现：node -e 脚本：mkdtemp 建 changes/chg-<今日YYYYMMDD>-01-foo.md，require plugin/hooks/pace-utils 后调 reserveArtifactId(dir,{sessionId:'x',artifactDir:dir,operation:'create-chg',prompt:'operation: create-chg'})，观察返回 id 为已存在的 -01。

### R-48 [P3] v7.0.0 运行时 hook 注入/deny 文案系统性自称「v6」并残留退役概念「索引事务」，D1 目标态 framing 重写未覆盖 hooks JS 面

- 位置：`plugin/hooks/pre-tool-use.js` :145, 480, 962, 1456, 1467, 1481, 1488-1494
- 指控：CHG-11 D1「目标态 framing 全发布面重写」的 Files 清单只含 plugin/agents、agent-references、skills、commands（commit 9e46178 stat 证实未触碰任何 hooks JS），但 hook 的 deny reason / additionalContext 与 markdown 发布面同为 model-facing prompt 注入面。结果 v7.0.0 产品的运行时文案仍系统性自称 v6：pre-tool-use.js 17 处（『创建完整 v6 Artifact 基础结构』『v6 项目没有活跃 CHG/HOTFIX』『v6 C 阶段未完成』『v6 E 阶段未就绪』『当前 v6 活跃变更』）、post-tool-use.js 5 处（『v6 唯一路径』『仍不符合 v6 完成记录规范』L251）、stop.js 2 处（『v6 详情文件中仍有 N 个未完成任务』L355）、marker-guard.js L17、reserve-artifact-id.js L169。另有 4 处 deny 文案仍宣称 hook 管理『索引事务』（pre-tool-use.js:145/962、bash-guard.js:493、powershell-guard.js:410），而 index-transaction 机制已随 CHG-08 整体退役（locks.js 不再产生新事务文件，路径保护仅为残留清理）。与 D1 Step 0 重写规则①『已退役概念的一切提及删除』及 README/REFERENCE 已完成的 v7 同步（5b1cd3c、7369990）不一致。
- 证据：grep -c 'v6' → pre-tool-use.js:17、stop.js:2、post-tool-use.js:5；grep '索引事务' plugin/ → 4 处 deny 文案命中；git show 9e46178 --stat 显示 CHG-11 改动文件全为 markdown，无 hooks JS。
- 复现：grep -rn '索引事务' plugin/hooks/；grep -n 'v6 项目\|v6 C 阶段\|v6 E 阶段\|完整 v6\|v6 唯一路径\|v6 完成记录' plugin/hooks/*.js plugin/hooks/pre-tool-use/*.js；对照 docs/superpowers/plans/...v7-refactor.md D1 Files 清单与 git show 9e46178 --stat。

### R-49 [P3] index-transaction 退役使 index:changes 锁从「操作跨度持锁」收窄为「单写即放」，两 session 并发时同一操作的多次 task.md Edit 之间出现可插入窗口

- 位置：`plugin/hooks/pace-utils/locks.js` :670-677
- 指控：v6 中 markIndexChangesTouchedAndMaybeRelease 在 task.md 写后保持 index:changes 锁（返回 index-transaction-open），直到 impl_plan 也被触碰才释放——副作用是单个 operation（如 close-chg 先删活跃区行、再插 ARCHIVE 区行的两次 Edit）期间锁持续持有，他 session 的 agent 无法插入。v7 改为每次 task.md 写后 PostToolUse 立即释放（locks.js:676 直接 releaseArtifactResourceLock），同一 operation 的两次 Edit 之间另一 session 的 artifact-writer 可获锁写入 task.md。后果上限是逻辑交错：B 的 prepend 落在 A 两次 Edit 之间，A 的第二次 Edit old_string 失配重试或两行序交错，不会撕裂单次写。spec §2.3 明确退役事务并称『两 agent 并发写 task.md 的互斥语义不变』——per-write 互斥确实不变，但操作跨度保护的收窄是 spec 兼容论证未分析的副作用。缓解面完整：per-write 锁 + 2.5s 等待、PostToolUseFailure/SubagentStop/TTL 释放链无泄漏。
- 证据：git show a167727:plugin/hooks/pace-utils/locks.js L667-689：touched 不含双文件时 `return { released: false, reason: 'index-transaction-open', ... }`（锁保持）；HEAD locks.js L670-677：同名函数直接 `return releaseArtifactResourceLock(...)`；post-tool-use.js L97-99 每次 task.md 写后调用即释放。
- 复现：对照 git show a167727:plugin/hooks/pace-utils/locks.js 与 HEAD 同文件 markIndexChangesTouchedAndMaybeRelease；构造两 owner 交替 acquire/release index:changes 验证 v7 下 A 两次写之间 B 可 acquire。

### R-50 [P3] artifactWriterCreateChgHint 仍要求 `reserved-file:` 字段，但 create-chg reservation 自 slug 改造后只产出 reserved-file-prefix

- 位置：`plugin/hooks/pre-tool-use/agent-lifecycle-guard.js` :317
- 指控：DENY_V6_NO_ACTIVE / DENY（无活跃 CHG 写码门）等 deny 文案引用的 artifactWriterCreateChgHint 模板含行 `reserved-file: <helper 输出或 hook deny 输出>`，但 helper（reserve-artifact-id.js）与 hook fallback（reservationRequiredReason）对 create-chg 都只输出 reserved-id + reserved-file-prefix（locks.js:751 create-chg reservation 只设 filePrefix，fileRel 恒缺）。该行指向的字段任何来源都不会产出；若 AI 凭模板自行编一个 reserved-file 值，explicitReservationFromPrompt 取为 fileRel 后 reservationMatchesExplicit L297 因 reservation.fileRel 为 undefined 恒不匹配 → DENY_AGENT_RESERVED_PROMPT_MISMATCH 死循环。同文件 promptTemplateForOperation 的 create-chg 模板（L69）已正确写 reserved-file-prefix，两模板不一致；V7D-2 一致性锁只覆盖 promptTemplateForOperation，未覆盖此 hint。a167727 基线已存在（非 v7 回归），属 deny 文案与 reservation 实际字段的存量漂移。
- 证据：agent-lifecycle-guard.js:317 `'reserved-file: <helper 输出或 hook deny 输出>'`；locks.js:746-753 create-chg reservations 仅 {id, filePrefix}；reserve-artifact-id.js:94 `if (reservation.fileRel)` 对 create-chg 永假；同 guard L69 正确版本为 `reserved-file-prefix: ...`。
- 复现：grep -n 'reserved-file' plugin/hooks/pre-tool-use/agent-lifecycle-guard.js plugin/hooks/reserve-artifact-id.js；node 调 pu.reserveArtifactId(...create-chg) 确认返回对象无 fileRel 只有 filePrefix。

### R-51 [P3] pre-tool-use.js 文件头注释仍描述已退役的「E 阶段 impl_plan [/] 检查」

- 位置：`plugin/hooks/pre-tool-use.js` :1
- 指控：首行注释『// PreToolUse hook：多信号三级触发 + 懒创建模板 + C 阶段批准 + E 阶段 impl_plan [/] 检查』中 E 阶段判定自 v6 起已读 task.md checkbox + changes/<id>.md frontmatter（L1474-1486），v7 后 impl_plan 更已整体退役出读端。CHG-08 R 审计专项做过『陈旧注释清理』（commit 0c43dc9），此处漏网。纯注释不影响行为，但 v7 审计基线明确『退役残留』在报告范围。
- 证据：HEAD pre-tool-use.js:1 与 git show a167727:plugin/hooks/pre-tool-use.js 首行相同；实际 E 门代码 L1474-1486 只消费 e.taskCheckbox 与 detail.frontmatter.status，grep impl 在该文件仅剩 L1/L39 注释。
- 复现：head -1 plugin/hooks/pre-tool-use.js；对照 L1474-1486 runnableEntries 判定逻辑。

### R-52 [P3] CHG-09 T-002 验收文本声称 stop/collect-state 兜底用「warnOnce 键 schema-violation-<slug>」去重，实现中该键不存在

- 位置：`plugin/hooks/stop.js` :216-223
- 指控：验收基线 chg-20260611-09-v7-schema-closed-contract-validate-frontmatter.md T-002 写明兜底检测『warnOnce 键 schema-violation-<slug>』，但 stop.js 的 schema 兜底（L216-223）走 addWarning('repair',...) 每次 Stop 重复报、collect-state 经 summarizeActiveChanges.schemaViolation 渲染也无去重；全仓 grep 'schema-violation'（kebab 键形态）零命中，constants.js SESSION_SCOPED_FLAG_PREFIXES（L91-98）亦无该前缀。行为本身与 spec §3.5『与 status-mismatch 等现有检测同级』一致（同级 repair 警告同样不去重），不是运行缺陷，但 CHG 验收记录与产物不符——按『规格内部矛盾同样是 finding』报告，建议修正 CHG 记录而非实现。
- 证据：grep -rn 'schema-violation' plugin/ tests/ 无命中（仅 camelCase schemaViolation 字段）；stop.js:219-222 直接 addWarning；vault CHG-09 详情 L18 验收文本含『warnOnce 键 schema-violation-<slug>』。
- 复现：grep -rn 'schema-violation' plugin tests；对照 /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/chg-20260611-09-*.md 任务清单 T-002 与 plugin/hooks/stop.js L216-223、plugin/hooks/pace-utils/constants.js L91-98。

**D7-hook-statemachine 覆盖说明**：D7 全维度检查（基线 git a167727..HEAD，规格 docs/superpowers/specs/2026-06-11-...-design.md + plan + CHG-08/09/11/12 vault 详情）。【全文精读】pre-tool-use.js(1676行)、pre-tool-use/{agent-lifecycle-guard,marker-guard}.js、pace-utils/{constants,locks,change-analysis,line-endings,session}.js、post-tool-use.js、post-tool-use-failure.js、stop.js、stop-failure.js、subagent-stop.js、session-end.js、pre-compact.js、print-session-context.js、reserve-artifact-id.js、session-start/collect-state.js、hooks.json；【diff 审 + 定点核】bash-guard/powershell-guard（GUARD_PROTECTED_FILES=ARTIFACT_FILES∪PROTECTED 对称补回 impl_plan，L253/421 与 PS L202/322 正则均含 impl_plan，保护无收窄）、path-utils（isArtifactRelativePath 显式保留 impl_plan，主 session Edit/Bash 直写 tombstone 仍被拦）、pace-utils.js（detectUnmigratedV6Layout 对 tombstone/仅归档区/不存在均正确返回 false；legacyV5FilesInDir 按 spec 保留双文件检测）、session-start/layers.js（grep 定点：注入与格式警告已全 task.md 化，schemaViolation 渲染接线存在）、runtime-effects（W3/W4 flag 清理；v7-migrate-reminded 已入 SESSION_SCOPED_FLAGS）。【确认无问题面】(1) 写码门/批准门/E 门判定来源统一为 getActiveChangeEntries 单读 task.md，无任何 guard 残留双索引语义（grep implCheckbox/index-mismatch 清零）；(2) Stop 未收口检测 v7 正确：classifyChange 退役 index-mismatch、schema 兜底正确 gate 在 schema-version==7.0（6.0 存量 skipped 实证于 V7B 测试）、detail-missing 时 fm={} 不误报；(3) 锁覆盖面完整：per-write index:changes 互斥保留（资源名未改保新旧互斥）、释放链四路（PostToolUse 即放/PostToolUseFailure 失败放/SubagentStop releaseArtifactResourcesForOwner 兜底/5min TTL+in-flight 1s 宽限）无泄漏路径，v6 的事务半开悬挂风险消失；(4) 归档前置门只检 task.md ARCHIVE（spec §2.2 一致）；(5) CRLF/BOM：ARCHIVE_PATTERN \r? 兼容、parseFrontmatter/hasNonNull*Date stripBom+normalize、Edit 前 artifact CRLF 机械归一保留；(6) hooks.json 注册完整（9 事件均指向存在文件；set-*/sync-plan/reserve/print-session-context/task-list-sync 为 Bash helper 或 legacy 观察器，不注册属设计；无显式 timeout，沿用默认，hook 内部 git 调用自带 1-5s timeout）；(7) 未迁移催办三处（SessionStart core/PostToolUse warnOnce/migrate-v7 存在于 plugin/migrate/）接线一致；(8) subagent-stop closeOwnerIfArchived 单索引判定正确（PSP-02 同源约束保留）。【实测】node tests/test-pace-utils.js 275/275、test-hooks-e2e.js 391/391、test-session-layers.js 42/42、test-agent-tests-helpers.js 9/9、test-migrate-v7.js 12/12 全绿；finding 1 用隔离 tmpdir 实际运行 reserveArtifactId 复现重复发号。【未深入】session-start.js 编排/budget.js 注入质量（已知 IQ change-set 排除）、migrate-v7.js 内部逻辑（D 维度归属 E 组审计，仅验证存在与清理项）、foreign worktree 写码门搭便车（已知 P3 排除）。

---

## D8 发布面一致性（10 条）

### R-53 [P2] REFERENCE.md 整体未随 v7.0.0 同步：标题仍 v6.6.1，发布检查仍要求 schema-version "6.0"（直接抵触 v7 封闭合同）

- 位置：`REFERENCE.md` :1, 3, 84, 168-176, 180-186, 221-227, 258
- 指控：REFERENCE.md 是用户可见行为合同，但 v7.0.0 发布后大面积过时且自相矛盾：(1) 标题「# PACEflow v6.6.1 参考手册」/「最后更新：2026-06-07」与 plugin.json 7.0.0 不符；(2) §8 发布检查写「artifact frontmatter schema-version 仍为 "6.0"；不要随插件 patch 版本滚动」——而 v7 封闭合同的权威 spec 与代码均为 "7.0"，且 validateFrontmatterSchema 只对 7.0 帧生效（按此检查项发布会让新 artifact 静默绕过合同校验）；(3) §5 hook 表缺已注册的 session-end.js，helper 表缺 set-activation.js；(4) §3 操作表缺 update-finding / update-index 两个已发布操作；(5) §6 安装清单缺 commands/、agent-references/、migrate/；(6) line 84 仍写「禁止在 task/impl 中写内嵌详情」（impl 已退役）。release commit 5b1cd3c 自称「README/REFERENCE v7 行为同步」，但 REFERENCE 实际只改了 5 行（术语表/目录树/create-chg 行）
- 证据：REFERENCE.md:1 `# PACEflow v6.6.1 参考手册`；REFERENCE.md:258 `artifact frontmatter \`schema-version\` 仍为 \"6.0\"`；对照 plugin/agent-references/artifact-writer-spec.md:57/67/76 `schema-version: "7.0"` 与 plugin/hooks/pace-utils/change-analysis.js:254 `if (normalizeFrontmatterStatus(fm['schema-version']) !== '7.0')`（非 7.0 跳过校验）；`git diff a167727..HEAD -- REFERENCE.md` 仅 3 处 impl_plan 删除；hooks.json 注册 SessionEnd→session-end.js 但 REFERENCE §5 表（168-176）无此行；plugin/agent-references/instructions/ 含 update-finding.md/update-index.md 但 §3 表无对应行
- 复现：head -3 REFERENCE.md; grep -n '6.0' REFERENCE.md; grep -n '7.0' plugin/agent-references/artifact-writer-spec.md; grep -n "!== '7.0'" plugin/hooks/pace-utils/change-analysis.js; git diff a167727..HEAD --stat -- REFERENCE.md

### R-54 [P2] README 激活模型描述过时：仍宣称 3+ 代码文件/Superpowers 计划自动激活与「Write 第 3 文件前瞻 deny」，实际已降级为仅提示 /paceflow:enable

- 位置：`README.md` :229-242, 335-341
- 指控：README「多信号自动激活」节（229-242）称「PACEflow 自动检测项目是否需要 PACE 流程，无需手动配置」，表中保留「Superpowers 计划 docs/plans/ → 自动桥接」「代码文件数 3+ → 兜底检测」两个激活信号；「三级触发」表（340）保留「Deny | Write 将达 3+ 代码文件阈值 | deny（前瞻检测）」。但 CHG-A A1/A3b（commit 58025b3，6.7 窗口）已明确移除这两个弱信号的激活与 deny 路径——现仅由 detectSoftSignal 产生「运行 /paceflow:enable」软提示，不激活任何门控；新增的 manifest 软信号（package.json/tsconfig.json/Cargo.toml 等，CHG-20260611-05）也完全未记载。新用户按 README 预期 3 个代码文件即被强制建 CHG，实际不会发生——核心激活合同与实际行为相反
- 证据：plugin/hooks/pace-utils.js isPaceProject 内注释：「CHG-A A1：原 dated-plan（superpowers）与 code-count（3+ 文件）两个弱信号 return 已移除…现降级到 detectSoftSignal——只提示 AI 主动询问用户，不再激活任何门控」；plugin/hooks/pre-tool-use.js:1619-1621「CHG-A A3b：原 T-079 code-count-lookahead（Write 第 3 文件达阈值即 deny + 建模板）已移除」，1629 实际输出为提醒运行 /paceflow:enable；plugin/hooks/pace-utils.js:653-654 MANIFEST_FILES 软信号无 README 记载；README.md:231「无需手动配置」/340「deny（前瞻检测）」
- 复现：grep -n 'CHG-A A1' plugin/hooks/pace-utils.js; grep -n 'CHG-A A3b' plugin/hooks/pre-tool-use.js; sed -n '229,242p;335,341p' README.md; git show 58025b3 --stat

### R-55 [P2] README/REFERENCE 完全未记载 5 个用户命令（/paceflow:enable|disable|pause|resume|status）与 session 级 pause 机制，且 README 与 disable 命令对 .pace/disabled 手写口径直接矛盾

- 位置：`README.md` :100, 319-333
- 指控：plugin.json 注册了 5 个用户命令，hook deny 文案主动引导用户运行 /paceflow:disable、/paceflow:pause（pre-tool-use.js PACE_ESCAPE_HATCH）、/paceflow:enable（软信号提示），但 README 全文与 REFERENCE 全文零提及这些命令：安装节（100）只说「8 类 hook 事件、配套 helper 脚本、4 个用户 skill 和 artifact-writer agent」；运行时状态文件表（319-333）缺 `.pace/paused-<sid>` 标志与 SessionEnd 自动失效语义。更矛盾的是 README:332 写「disabled | 豁免标记（用户手动创建 .pace/disabled 文件）」，而发布面 plugin/commands/disable.md 规则明确「helper 是唯一写入路径；不要手写 .pace/disabled，一律经 helper」——同一发布面两份用户文档互相打架
- 证据：grep -n '/paceflow:' README.md REFERENCE.md → 0 命中；plugin/.claude-plugin/plugin.json:13 注册 5 commands；plugin/hooks/pre-tool-use.js:200 `const PACE_ESCAPE_HATCH = '若你（用户）不需要 PACEflow…可运行 /paceflow:disable 停用；仅本 session 临时停用可运行 /paceflow:pause。'`；README.md:332 vs plugin/commands/disable.md「不要手写 .pace/disabled」；pause 标志实现 plugin/hooks/pace-utils/locks.js:636 `paused-${safeLockName(sid)}` 不在 README 状态表
- 复现：grep -cn 'paceflow:enable\|paceflow:pause\|paceflow:disable' README.md REFERENCE.md; grep -n 'PACE_ESCAPE_HATCH' plugin/hooks/pre-tool-use.js; sed -n '319,333p' README.md; cat plugin/commands/disable.md

### R-56 [P3] README/REFERENCE 仍称 PreCompact 写 .pace/pre-compact-state.json 快照——该机制已退役，实际仅做 native plan 兜底检测

- 位置：`README.md` :226, 309
- 指控：README Hook I/O 协议表（309）写「PreCompact | 无 stdout（写 .pace/pre-compact-state.json 快照）」、hook 表（226）写「快照当前状态，防丢失」，REFERENCE.md:175 写「pre-compact.js | 快照活跃 CHG、pending、approved、verified 状态」。实际 pre-compact.js 自 M4/T-002（commit 03447f3，CHG-20260608-11）起已退役快照机制，现仅把匹配当前项目的 native plan 路径落到 .pace/current-native-plan；README 状态文件表也未列 current-native-plan。文档描述的状态文件与行为均不存在
- 证据：plugin/hooks/pre-compact.js:1-4 头注释「原『写 artifact 状态快照供 session-start compact 恢复』机制已退役…本 hook 现仅把最近匹配当前项目的原生计划路径落到 .pace/current-native-plan」；:100「快照写入已退役（不再写 .pace/pre-compact-state.json）」；git log -S 'pre-compact-state' → 03447f3 feat(session-start): M4 退役 PreCompact 快照机制
- 复现：grep -n 'pre-compact-state' README.md REFERENCE.md plugin/hooks/pre-compact.js; head -5 plugin/hooks/pre-compact.js

### R-57 [P3] README「8 类 hook 事件」与 hooks.json 实注册 9 类不符：SessionEnd 在 README 两张 hook 表、I/O 协议表、项目结构树中全部缺席

- 位置：`README.md` :100, 216-227, 303-312, 262-284
- 指控：plugin/hooks/hooks.json 注册 9 类事件（SessionStart/PreToolUse/PostToolUse/PostToolUseFailure/SubagentStop/PreCompact/SessionEnd/Stop/StopFailure），但 README:100 与 :216 标题均称「8 类 hook 事件」，hook 职责表（218-227）与 Hook I/O 协议表（303-312）均无 SessionEnd 行（session-end.js 承担 pause 自动失效与 owner detached 降级）；项目结构树（262-284）缺 session-end.js、set-activation.js、print-session-context.js、session-start/ 子目录、pre-tool-use/command-recognition.js、commands/ 目录。SessionEnd 注册早于 v7 基线，但 v7 release 自称 README 同步仍未修正
- 证据：grep '"SessionEnd"' plugin/hooks/hooks.json → 命中（120-131 行注册 session-end.js）；grep -n '8 类' README.md → 100、216；README 结构树 262-284 无 session-end.js/set-activation.js/print-session-context.js/commands/；ls plugin/hooks/ 实际含上述全部文件
- 复现：grep -o '"[A-Za-z]*":' plugin/hooks/hooks.json | sort -u | wc -l; grep -n '8 类' README.md; sed -n '218,227p;262,284p' README.md; ls plugin/hooks/ plugin/commands/

### R-58 [P3] README 末行版本号停留 v6.7.1，与 plugin.json/marketplace.json 7.0.0 不一致；版本历史表缺 v6.5.x~v6.7.x 区段

- 位置：`README.md` :458, 376-377
- 指控：README 最后一行「**版本**: v6.7.1」未随 v7.0.0 发布更新（plugin.json、marketplace.json、constants.js PACE_VERSION 均已是 7.0.0）；同时版本历史表从 v6.4.0 直接跳到 v7.0.0，缺 v6.5.0~v6.6.1 各发布行（git 历史存在 bump 6.5.0/6.5.1/6.5.2/6.6.0/6.6.1 提交，footer 的 v6.7.1 也证明这些版本真实存在），用户无法从 README 追溯这段变更
- 证据：README.md:458 `**版本**: v6.7.1`；plugin/.claude-plugin/plugin.json:4 `"version": "7.0.0"`；.claude-plugin/marketplace.json `"version": "7.0.0"`；constants.js:5 `PACE_VERSION = 'v7.0.0'`；git log --oneline -- REFERENCE.md 显示 7a63302 bump v6.6.0→v6.6.1、8180e6c v6.5.2→v6.6.0 等；README 表 376-377 行 v7.0.0 下一行即 v6.4.0
- 复现：tail -1 README.md; grep version plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json; sed -n '376,377p' README.md

### R-59 [P3] README 主体无 v6→v7 升级指南：migrate-v7 用法只埋在版本历史表一行内，与 v5 升级节的待遇不对称

- 位置：`README.md` :67-87, 376
- 指控：v7.0.0 是 breaking change（implementation_plan 退役、9-key 封闭合同、存量必须跑 migrate-v7），但 README 主体只有详尽的「v5 用户升级」章节（67-87，含完整 batch-archive-v5 命令示例），对 v6→v7 迁移没有任何章节——migrate-v7 仅出现在版本历史表 v7.0.0 行的特性罗列里，无用法、无 dry-run/--restore 说明。用户合同层面 v6 存量用户只能依赖运行时 SessionStart 注入/PostToolUse 催办才得知迁移命令；「v6 相比 v5 改进了什么」章节框架也未升级为 v7 视角
- 证据：grep -n 'migrate-v7' README.md → 仅 376（版本历史行）；grep -n 'migrate-v7' plugin/hooks/post-tool-use.js:280 注入完整迁移命令（`node "${MIGRATE_V7_SCRIPT}" --cwd … --dry-run`）、session-start/layers.js:838-842 同理——运行时有、文档没有；README 67-87 为 v5 升级保留整节含命令块
- 复现：grep -n 'migrate-v7' README.md; sed -n '67,87p' README.md; grep -n 'migrate-v7' plugin/hooks/post-tool-use.js plugin/hooks/session-start/layers.js

### R-60 [P3] plugin/hooks/templates/implementation_plan.md 死模板残留：无任何运行时路径实例化，内容仍是 v6 双索引语义

- 位置：`plugin/hooks/templates/implementation_plan.md` :1-9
- 指控：v7 将 implementation_plan.md 退役出 ARTIFACT_FILES（constants.js:8），createTemplates 只遍历 ARTIFACT_FILES 复制模板，migrate-v7 的 tombstone 用脚本内自带 TOMBSTONE 常量——发布面没有任何代码路径会再使用此模板文件；其内容（「# 实施计划 / ## 变更索引」+ 索引行格式注释）仍宣示 v6 双索引布局，与 v7「task.md 是唯一 CHG 索引」合同矛盾。README 结构树仍按「6 个 artifact 模板」把它计为在役模板。属退役残留，应删除或改写为 tombstone 模板
- 证据：plugin/hooks/pace-utils/constants.js:8 `ARTIFACT_FILES = ['spec.md','task.md','walkthrough.md','findings.md','corrections.md']`（无 impl_plan）；pace-utils.js createTemplates `for (const file of ARTIFACT_FILES)`；plugin/migrate/migrate-v7.js:294-297 用自有 TOMBSTONE 改写不读模板；grep -rn 'templates/implementation_plan' plugin/ → 0 命中；模板内容首行 `# 实施计划` + `## 变更索引`
- 复现：cat plugin/hooks/templates/implementation_plan.md; grep -n 'ARTIFACT_FILES =' plugin/hooks/pace-utils/constants.js; grep -rn 'templates/implementation_plan' plugin/ | wc -l

### R-61 [P3] test-pace-utils.js 作为发布验证门存在偶发失败（非确定性）：同一工作区前 9 次运行 3 次红（274/275、273/275、一次 V7A-7 常量断言 FAIL），随后 23 次连续绿

- 位置：`tests/test-pace-utils.js` :3337-3342
- 指控：在未改动任何文件的情况下，node tests/test-pace-utils.js 出现非确定性失败：一次输出「FAIL: V7A-7: ARTIFACT_FILES 不含 impl_plan 但 PROTECTED_ARTIFACTS 显式保留」+「❌ 274/275」，另两次分别 274/275、273/275 且失败用例不同；之后 23 次连跑（含与 test-hooks-e2e 并发复跑）全绿，无法稳定复现。V7A-7 是纯静态常量断言，间歇失败指向环境/共享状态时序问题（WSL2 /mnt/k drvfs、或与本审计 session 自身 hook 进程并发写 plugin/hooks/pace-hooks.log/locks 有关）。作为 CLAUDE.md 钦定的发布验证命令，缺乏确定性会让 release gate 偶发假红/被迫重跑掩盖真红
- 证据：本 session 实录：run1 `❌ 274/275 tests passed`；run2（awk 过滤非 PASS 行）`FAIL: V7A-7: ARTIFACT_FILES 不含 impl_plan 但 PROTECTED_ARTIFACTS 显式保留` + `❌ 274/275`；5 连跑 loop 前两次 `❌ 274/275`、`❌ 273/275`；其后 /tmp/ptu-*.log 14 次 + /tmp/ptu2-*.log 8 次 + 并发 e2e 1 次全部 `✅ 275/275`。测试体 3337-3341 为 4 条 assert.ok 静态常量断言
- 复现：for i in $(seq 1 20); do node tests/test-pace-utils.js 2>&1 | tail -1; done（偶发；建议在有并发 hook 活动的 PACEflow 管理工作区内复跑以提高触发概率）

### R-62 [P3] set-activation.js 未知参数报错文案漏列 --pause/--resume/--session

- 位置：`plugin/hooks/set-activation.js` :240
- 指控：DENY_UNKNOWN_OPTION 错误首句写「只支持 --enable / --disable / --status / --cwd」，遗漏脚本实际支持且 commands/pause.md、resume.md 公开依赖的 --pause / --resume / --session 三个参数；虽然其后附带的 usage() 完整列出，但首句与 usage 自相矛盾，误导排错（用户/AI 可能据首句判定 --pause 不被支持）
- 证据：plugin/hooks/set-activation.js:240 `fail(args.cwd, 'DENY_UNKNOWN_OPTION', \`set-activation 不支持参数：…只支持 --enable / --disable / --status / --cwd。\n\n${usage()}\`…)` vs parseArgs（29-40）明确解析 --pause/--resume/--session、usage()（49-63）列出五个 action
- 复现：node plugin/hooks/set-activation.js --bogus --cwd /tmp 2>&1 | head -3; grep -n '只支持' plugin/hooks/set-activation.js

**D8-release-surface 覆盖说明**：D8 发布面一致性专项审计，仓库 /mnt/k/AI/paceflow-hooks/paceflow @ HEAD 7369990（v7.0.0）。【实际运行】(1) claude plugin validate ./plugin → Validation passed（exit 0）；(2) 五个测试套件实跑：test-hooks-e2e 391/391、test-session-layers 42/42、test-agent-tests-helpers 9/9、test-migrate-v7 12/12 全绿；test-pace-utils 偶发红（见 finding），稳定态 275/275，与 README v7.0.0 版本历史行宣称的 275/391/42/9/12 计数一致。【manifest/版本一致性·确认无问题】plugin/.claude-plugin/plugin.json version 7.0.0、.claude-plugin/marketplace.json 7.0.0、constants.js PACE_VERSION v7.0.0 三处一致；plugin.json agents/commands 引用的 6 个文件全部存在；hooks.json 9 类事件引用的 10 个脚本全部存在且 args exec form 与 README 2.1.139 要求描述一致；plugin/hooks/pace-hooks.log 未被 git 跟踪（.gitignore 覆盖），不入发布面。【README/REFERENCE 双向对照（抽 20+ 处）·确认无问题的面】单索引（task.md 唯一索引、4 索引文件表、Artifact Root 清单均已去 impl_plan）；9/3/2 key 封闭合同描述与 change-analysis.js SCHEMA_V7_KEYS、spec §2.1-2.3、schema-keys 机器注释行三方字面一致（V7B/V7C/V7D 互锁测试在跑且过）；stop.js background_tasks 处理与 README v2.1.145+ 描述实证相符；print-session-context.js --compact/PACE_PRINT_ONLY 与 README/REFERENCE 描述相符；batch create（reserve --count、MAX_RESERVE_COUNT=20、change-set frontmatter）REFERENCE §3.1 与 constants/locks 实现相符；README 中 batch-archive-v5/migrate 路径、PLUGIN_DIR 相对路径在 plugin/ 下全部存在（自动扫描的 MISSING 为安装相对路径假阳性，逐一人工核验）。【commands（5 个）·确认无问题】enable/disable/pause/resume/status 引用的 set-activation.js 存在；--enable/--disable/--pause/--resume/--status/--cwd/--session 参数全部实现；enable.md 宣称的三种输出串「已启用（首次）/（manual 标记）/恢复既有项目」与代码输出逐字匹配；pause.md 的 .pace/paused-* 与 locks.js paused-<sid> 实现相符；status 输出 enabled/disabled/inactive+paused 相符。【skills（4 个）·确认无问题】frontmatter（name/description/effort）规范；SessionStart/PreToolUse 注入的 Skill(paceflow:…) 四个名字与实际 skill 目录一一对应；SKILL.md 内部相对引用 references/format-reference.md、change-lifecycle.md、review-methodology.md、superpowers-integration.md 全部存在；artifact-management→pace-workflow「Helper 命令来源」锚点存在；skills/agent/instructions 已无 impl_plan/双索引/index-transaction/快照等退役概念残留（仅 pace-workflow:148 的 v5 legacy 语境引用，属合理历史语境）。【agent 发布面·确认无问题】artifact-writer.md 引用的 8 个 instructions 文件与 agent-references 目录一一对应；spec §2 v7 帧合同与模板（skills/artifact-management/templates/ 三件 7.0 帧）一致——这三件模板无运行时引用但被 V7C-1 测试互锁，判定为有意的测试单源、未列 finding。【发现问题集中在】REFERENCE.md 全篇未做 v7 同步（标题/schema-version 6.0/操作表/hook 表/安装清单）、README 激活模型与三级触发描述对应已删除的行为、5 个用户命令与 pause 机制在 README/REFERENCE 零记载且 disabled 手写口径自相矛盾、PreCompact 快照退役未同步、8 vs 9 hook 事件、footer 版本号、死模板残留、测试门偶发红、helper 报错文案——共 10 条，详见 findings。未覆盖（属其他专项维度）：hook 门控逻辑正确性、migrate-v7 转换正确性、并发/锁语义、agent contract 行为。

---

## D9 升级窗口与向后兼容（5 条）

### R-63 [P1] 升级窗口 brick 已被实测证实（旧 cache hook + 已迁移 v7 数据 = deny 写码门 + Stop 阻断），但 README/REFERENCE 对 v6→v7 升级顺序与多 session 风险零指引

- 位置：`README.md` :67（仅有「### v5 用户升级」节，无 v6→v7 对应节）
- 指控：v7.0.0 是 breaking 数据迁移版本，但用户可见文档没有任何 v6→v7 升级章节：README 只有「v5 用户升级」节（migrate-v7 仅出现在版本历史表 376 行的特性描述里），REFERENCE.md 对 migrate-v7/tombstone 零提及，CHANGELOG.md 冻结在 v5。而实测证明升级窗口存在硬 brick：v6.7.1 基线 hook（a167727，即未 reload 的旧 cache 版本）对已迁移数据（impl_plan tombstone + task.md 活跃 CHG）的 pre-tool-use 返回 permissionDecision=deny（DENY_V6_INDEX_MISMATCH），阻断一切项目文件写入；stop.js 同时 exit 2 阻断会话收尾。worktree 多 session 是 PACEflow 一级支持场景（owner 机制），用户在新 session 迁移后、任何未 reload 的旧 session 即被双重 brick；且旧 hook 的 deny 文案引导「派 artifact-writer 修复索引」——照做会向 tombstone 回填索引行，等于撤销迁移，形成迁移↔修复拉锯。「先升级 reload 全部 session、再迁移数据」这一已被项目自己实测踩过的依赖顺序（CHG-13 实施详情有记录）没有写进任何发布面文档。
- 证据：1) 旧 hook deny 实测输出：{"permissionDecision":"deny","permissionDecisionReason":"v6 索引不一致：CHG-20260501-01 必须同时存在于 task.md 与 implementation_plan.md 活跃区。\n请派 artifact-writer 修复索引..."}；旧 stop.js exit 2："[1] task.md 与 implementation_plan.md 活跃 CHG 集合不一致：CHG-20260501-01 必须同时存在。" 2) grep -n "migrate-v7\|reload\|先升级" README.md REFERENCE.md → 仅 README:376 版本历史一行特性描述，无任何步骤/顺序指引。3) vault CHG-13 实施详情 34 行自述：「升级窗口实测：旧 cache hook 跨索引校验对已迁移布局 deny 一切项目文件写入（spec §6.1『最坏软 warning』论证被证伪）」——教训已被项目记录但未传导到用户文档。
- 复现：git -C /mnt/k/AI/paceflow-hooks/paceflow archive a167727 plugin/hooks | tar -x -C /tmp/old；构造已迁移 fixture（task.md 含 `- [/] [[chg-...|CHG-...]]` 活跃行 + implementation_plan.md 为 tombstone + changes/ 内 7.0 帧详情），对 fixture cwd 运行 echo '{"tool_name":"Write","tool_input":{"file_path":"<fixture>/src.js","content":"x"}}' | node /tmp/old/plugin/hooks/pre-tool-use.js → deny；echo '{"stop_hook_active":false}' | node /tmp/old/plugin/hooks/stop.js → exit 2。再 grep README.md/REFERENCE.md 确认无升级顺序指引。

### R-64 [P2] 设计文档兼容论证（§2.1/§6.1.4「最坏软 warning 不 deny、不 brick」、§6.4「可回 v6.7.1 tag 降级不 brick」）与实测相反，且实测证伪后规格从未修订

- 位置：`docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md` :53, 200, 226
- 指控：spec 三处兼容论断均为假：§2.1（53 行）称旧 hook 对 tombstone「跨索引一致性校验最坏产生软 repair warning…不 deny、不 brick」；§6.1.4（200 行）重复同论断；§6.4（226 行）给出的回滚程序「v7.0.0 出问题可回 v6.7.1 tag（…降级不 brick）」。实测（见 F1 证据）：v6.7.1 hook 对 tombstone 布局是 pre-tool-use 硬 deny + stop exit 2 双 brick。CHG-13 实施详情已明确记录「spec §6.1『最坏软 warning』论证被证伪」，但 spec 文件 git 历史显示 F 阶段后无任何修订（最后一次改动 e7c911a 在实测之前）——按仓库 CLAUDE.md「历史设计文档保留背景时必须标明 historical」要求，这份留有错误回滚指引的文档未加勘误。任何按 §6.4 回滚 v6.7.1 的已迁移用户（vault 有活跃 CHG 时）会被写码门和 Stop 同时锁死，回滚通道本身就是 brick 路径。
- 证据：spec 53 行：「旧 session 并发时旧 hook 的跨索引一致性校验最坏产生软 repair warning（task.md 活跃集 vs tombstone 空集不一致），不 deny、不 brick。」spec 226 行：「v7.0.0 出问题可回 v6.7.1 tag（marketplace 用户侧 schema 7.0 文件对旧 hook 兼容，见 §6.1.2，降级不 brick）。」对照实测：a167727 pre-tool-use.js 1434-1446 行 DENY_V6_INDEX_MISMATCH 分支 denyOrHint(...,{hardInTeammate:true})，实跑返回 deny；git log --all -- <spec> 最新提交 e7c911a（CHG-11 期，早于 CHG-13 实测证伪），无勘误提交。
- 复现：sed -n '53p;200p;226p' docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md；git log --oneline --all -- docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md 确认无证伪后修订；再按 F1 repro 实跑 a167727 hook 对 tombstone fixture 验证 deny 级（非软 warning）。

### R-65 [P2] REFERENCE 发布检查清单仍要求 schema-version 保持 "6.0"，与 v7.0 封闭合同直接矛盾

- 位置：`REFERENCE.md` :258
- 指控：REFERENCE.md「8. 发布检查」第 2 条仍写「artifact frontmatter `schema-version` 仍为 "6.0"；不要随插件 patch 版本滚动」。v7 的核心合同恰恰是 schema-version="7.0"（SCHEMA_V7_KEYS 三 kind 都含 schema-version，validateFrontmatterSchema 仅对 normalize 后 === '7.0' 的帧生效，migrate-v7 验收把非 7.0 帧按漏迁报错）。该行是 5b1cd3c「README/REFERENCE v7 行为同步」与 CHG-20260612-01 README legacy 清理双轮清扫后的漏网残留；按此清单做发布自检会把错误的版本锚当成检查项，且若有人据此把帧写成 "6.0"，会落入 validateFrontmatterSchema 的 skip 通道，整个 v7 三层确定性校验（写盘打回/Stop 兜底/SessionStart 渲染）被静默绕过。同文件同节末行还写着「不再出现…旧口径」，自相矛盾。
- 证据：REFERENCE.md:258：「- artifact frontmatter `schema-version` 仍为 `"6.0"`；不要随插件 patch 版本滚动」。对照 plugin/hooks/pace-utils/change-analysis.js:254-256：if (normalizeFrontmatterStatus(fm['schema-version']) !== '7.0') return { ok: true, ..., skipped: 'non-7.0' }；plugin/migrate/migrate-v7.js:350 把 skipped 视为漏迁失败。grep -rn '"6\.0"' plugin/skills plugin/agent-references 无残留，确认仅此一处。
- 复现：sed -n '255,262p' REFERENCE.md；对照 grep -n 'schema-version' plugin/hooks/pace-utils/change-analysis.js 与 plugin/agent-references/artifact-writer-spec.md 的 7.0 schema 表。

### R-66 [P3] 迁移催办信号盲区：impl_plan 活跃区无 CHG 索引行的 v6 项目（全归档静默项目 / migrate 中途 crash 后）永远不被催办，6.0 存量永久绕过 v7 schema 校验

- 位置：`plugin/hooks/pace-utils.js` :678-685
- 指控：detectUnmigratedV6Layout 的唯一信号是「implementation_plan.md 活跃区含 CHG 索引行」。两类日常可达形态不命中：(a) 升级时恰好没有活跃 CHG 的 v6 项目（全部归档是项目间歇期常态）——impl_plan 活跃区为空，session-start 提示与 post-tool-use 催办都不触发，但 changes/ 下全部 6.0 帧、findings.md 活跃区滞留的 [x]/[-] 行（每 session 持续注入 context）、corrections [knowledge::] 旧语义都未迁移；(b) migrate-v7 在写完 impl_plan tombstone 后、findings/corrections 重排与验收之前 crash（写盘循环 338-340 行按 detail→task→impl_plan→findings→corrections 顺序，crash 窗口真实存在）——检测信号已消失，半迁移态永久静默。两种形态下 spec 137 行的豁免论证「未迁移的 6.0 存量不按 7.0 合同报错（migrate 提示通道负责催办迁移）」不成立：催办通道永不触发 + 校验 skip 通道叠加 = 这些文件永久脱离 v7 封闭合同管辖。无功能性 brick（实测新 hook 对 6.0 数据写码门/Stop 全部正常），故 P3。
- 证据：pace-utils.js:678-685：detectUnmigratedV6Layout 仅 parseChangeIndex(impl_plan 活跃区).length>0；collect-state.js:144-146 与 post-tool-use.js:279-280 都只依赖该函数。实测：构造 midproj fixture（impl_plan=tombstone + changes/chg-*.md schema-version "6.0" + findings.md 活跃区含 [x] 行），跑 session-start core/artifact + pre-tool-use + post-tool-use，grep -c '迁移提示|migrate-v7' = 0。spec 137 行：「校验只对 schema-version: "7.0" 的文件生效；未迁移的 6.0 存量不按 7.0 合同报错（migrate 提示通道负责催办迁移）。」
- 复现：构造 fixture：implementation_plan.md 为 tombstone（或活跃区无 CHG 行），changes/ 放一个 schema-version "6.0" 详情帧；echo '{"type":"startup"}' | node plugin/hooks/session-start.js --group core（cwd=fixture）→ 输出无「v7 迁移提示」；同 fixture 跑 post-tool-use Edit 该详情 → 无催办、无 schema 警告（skip 通道）。

### R-67 [P3] migrate-v7 重跑覆盖 .pace/v7-migration-state 使其指向空备份目录，且该状态文件无任何消费方（spec §5.3「复用 migration-state 检测模式」未兑现）

- 位置：`plugin/migrate/migrate-v7.js` :388-390
- 指控：两点不一致：(1) v7-migration-state 每次执行无条件覆盖写——对已迁移项目重跑（幂等路径，changes.length=0）会把状态覆盖为 {files:0, backupDir:<本次新建的空备份目录>}，首次迁移的真实记录与备份指针从状态文件中丢失（磁盘上时间戳备份目录仍在，但用户按状态文件找 --restore 源会找到空目录）；(2) 该状态文件写入后全插件零读取（grep 全 plugin/ 无消费方），与 spec §5.3「复用 v5→v6 的 migration-state 检测模式」不符——v5 模式的 state 是被读取且支持 ignored/declined/migrated 抑制的（pace-utils.js:404），v7 的实际检测完全基于布局信号，state 文件是死重量。
- 证据：实测连续两次执行 migrate-v7：第二次输出「迁移完成：0 个文件…备份：…/2026-06-12T04-32-46-264Z」，cat .pace/v7-migration-state → {"files":0,"backupDir":"<第二次空目录>"}，首次 backupDir 指针被覆盖。grep -rn 'v7-migration-state' plugin/ 仅 migrate-v7.js 自身（写入）；对照 spec 177 行「迁移完成写 .pace/v7-migration-state」与 §5.3「复用 v5→v6 的 migration-state 检测模式」、pace-utils.js:404 v5 state 的三态消费。
- 复现：对任一 v6 fixture 连跑两次 node plugin/migrate/migrate-v7.js --cwd <fixture>，cat <fixture>/.pace/v7-migration-state 看 backupDir 指向第二次空目录；grep -rn 'v7-migration-state' plugin/ 确认无读取方。

**D9-upgrade-compat 覆盖说明**：D9 升级窗口与向后兼容专项。检查面与方法：1) 未迁移检测三件套全读+实跑——pace-utils.js detectUnmigratedV6Layout（678-685）、session-start/collect-state.js 144-146 + layers.js 838-847 渲染、post-tool-use.js 279-280 warnOnce 催办（flag 'v7-migrate-reminded' 确认在 constants.js SESSION_SCOPED_FLAGS:88、session-start runtime-effects 每 session 清理，存储于 per-project .pace，不跨项目串）。构造 v6 未迁移 fixture 实跑当前版四个 hook：session-start core 注入「v7 迁移提示」✓、post-tool-use artifact 编辑催办一次✓、已迁移 v7 fixture 全部不触发✓（无误报）。2) 新 hook + v6 数据（前向窗口）：实跑确认完全可用不 brick——pre-tool-use 写码门按 task.md 索引 + 6.0 帧 APPROVED 正常放行/汇总，post-tool-use/stop 的 validateFrontmatterSchema（change-analysis.js 250-269）对非 7.0 帧确定性 skip 且全部为 warning 级（warnings.push/additionalContext，无 deny 路径），stop 仅按正常任务完成度阻断（与 v7 数据同行为）。3) 旧 hook + 已迁移数据（后向窗口）：git archive a167727 提取 v6.7.1 基线 hooks 实跑——pre-tool-use deny（DENY_V6_INDEX_MISMATCH）+ stop exit 2 双 brick，证实 spec §2.1/§6.1.4/§6.4 兼容论证为假（F1/F2）。4) migrate-v7.js 全文 395 行精读 + 实跑：dry-run 无副作用✓、缺 parent-tasks 验收失败自动整体还原（exit 1，chg-id 恢复）✓、成功路径备份/验收/state 写入✓、重跑幂等（0 文件）✓、--restore 实现核读（restoreFromBackup 78-91）；中间态（tombstone 已写、详情未迁）构造实测 → 催办静默（F4）；写盘顺序（详情→task→impl_plan→findings→corrections）的 crash 窗口分析。5) 文档面：README（仅 v5 升级节）、REFERENCE（零 migrate-v7、发布检查 258 行 6.0 残留=F3）、CHANGELOG（冻结 v5）、spec §2/§5/§6 全节、vault CHG-08~13/CHG-20260612-01 详情、spec git 历史（无证伪后修订）。6) 测试基线：test-migrate-v7.js 12/12、test-pace-utils.js 275/275 实跑通过。确认无问题的面：前向升级窗口（新 hook + 未迁移 v6 数据）行为完全兼容、检测无误报；多项目隔离（runtime .pace 与 artifact dir 均 per-project root 解析，path-utils resolveEffectiveProjectRoot/getProjectRuntimeDir，v6proj/v7proj 并行实测互不影响）；migrate 验收失败还原逐字节正确；plugin/skills 与 agent-references 无 \"6.0\" 残留；催办 flag 的 session 级清理链路完整。未深入：session-start 注入预算截断对迁移提示块的影响（属已知 SessionStart 注入质量 change-set，按指示不重复）；foreign worktree 搭便车（已知 P3）。

---

## D10 设计 vs 实现双向对位（10 条）

### R-68 [P2] record-correction 指令「索引行」模板仍教写 [knowledge:: project-only]，与同文件归一表及 spec [scope::] 裁定矛盾

- 位置：`plugin/agent-references/instructions/record-correction.md` :114
- 指控：设计 §3.3 裁定 project-only 场景改用 [scope:: project-only]、不把 scope 值塞进 [knowledge::]（修正 correction-04/05 语义失真），CHG-10 已把同文件归一表（L56）和 artifact-writer-spec.md §5.5（L190/L251）改为 [scope::]，但「索引行」一节的最终输出模板 L114 仍是 v7 前原文 `[knowledge:: [[note]] | project-only]`——agent 照抄该模板会重新产出 migrate 刚修掉的脏数据；文件内部自相矛盾（L56 表 vs L114 模板），且 record-correction 是全局规则强制的日常路径
- 证据：git show a167727:...record-correction.md 第 114 行与当前 HEAD 逐字相同（v7 改了 L56 归一表/L76 说明却漏改 L114）；对照 plugin/agent-references/artifact-writer-spec.md:190「project-only 场景改用 [scope:: project-only]，不把 scope 值塞进 [knowledge::]」与设计 spec §3.3（design doc L109）
- 复现：grep -n 'knowledge::' plugin/agent-references/instructions/record-correction.md → L56 输出 [scope:: project-only] 而 L114 索引行模板输出 [knowledge:: [[note]] | project-only]，两节对同一 project-only 输入给出矛盾格式

### R-69 [P3] spec 兼容论证「旧 hook 对 tombstone 最坏软 warning、不 deny 不 brick」已被 CHG-13 真跑证伪但 spec 未修订

- 位置：`docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md` :53, 200
- 指控：spec §2.1 与 §6.1.4 是「单版本一把梭」安全性论证的核心条款，声称旧版本并发 hook 读 tombstone 最坏产生软 repair warning；CHG-13 真跑实测旧 cache hook 跨索引校验对已迁移布局 deny 一切项目文件写入（写码门 brick），论证被证伪，事实只记录在 vault CHG-13 实施详情与用户 memory，spec 原文未加任何勘误标注——下次 schema 升级复用该文档的兼容推理会继承已知为假的安全论证（违反仓库 CLAUDE.md「历史设计文档须标明、避免旧语义误当当前规则」）
- 证据：spec L53「最坏产生软 repair warning（…），不 deny、不 brick」、L200「跨索引校验最坏软 warning」；vault chg-20260611-13 L34「升级窗口实测：旧 cache hook 跨索引校验对已迁移布局 deny 一切项目文件写入（spec §6.1『最坏软 warning』论证被证伪）」；git log 该 spec 在 CHG-13 之后零提交
- 复现：grep -n '不 deny、不 brick\|最坏软 warning' docs/superpowers/specs/2026-06-11-artifact-schema-v7-refactor-design.md 对照 /mnt/c/.../changes/chg-20260611-13-*.md 实施详情 T-001 段

### R-70 [P3] 计划与 CHG-08 验收声称的「Bash 直写 impl_plan 仍被 deny」e2e 断言不存在（行为实测仍在，测试锁缺失）

- 位置：`tests/test-hooks-e2e.js`
- 指控：plan 对抗自审第 5 项（1c2c8b3）明确要求「e2e 补断言：Bash echo x >> implementation_plan.md 形态写入仍被 deny」，vault CHG-08 T-003 验收也声称含该断言；实际测试套件中只有 V7A-7（常量集合单测 test-pace-utils.js:3337）与 9hc0b1（Edit/MultiEdit deny），无任何 Bash 重定向写 impl_plan 的 deny 断言——保护行为本身实测仍在（guard union + regex fallback 双通道），但承诺的回归锁缺失，未来重构 GUARD_PROTECTED_FILES 或 fallback regex 时无红灯；验收声称与产物不符
- 证据：grep -rn implementation_plan tests/*.js 全量排查无 Bash deny 断言；行为实证：用 node fixture 对 pre-tool-use.js 喂 Bash 'echo x >> implementation_plan.md' / '> ' / 'sed -i' 三种形态全部 deny=true；plan L189「e2e 补断言：Bash `echo x >> implementation_plan.md` 形态写入仍被 deny」、vault chg-20260611-08 L19 验收「+ Bash 直写 impl_plan 仍被 deny 断言」
- 复现：grep -n 'implementation_plan' tests/test-hooks-e2e.js tests/test-pace-utils.js | grep -i 'bash\|>>' → 0 命中；行为复现见 /tmp/v7-audit-bashguard-check.js（构造 v7 布局后调 pre-tool-use.js）

### R-71 [P3] spec §5.2.3「## 关联调研 空尾（如有）占位清除」未实现，migrate-v7.js 无对应逻辑且 vault 残留确认

- 位置：`plugin/migrate/migrate-v7.js`
- 指控：设计 §5.2 第 3 步「结构性脏数据修复」清单含四项，其中「`## 关联调研` 空尾『（如有）』占位清除」在 migrate-v7.js 中零实现（其余三项：弯引号、findings 三态重排+表头、[scope::] 修正均落地），迁移后 vault 中该占位仍大量残留；plan E1 的 V7E 测试组也未覆盖此项——设计敲定项静默脱落，无任何文档记录裁剪决定
- 证据：grep -n '如有\|关联调研' plugin/migrate/migrate-v7.js tests/test-migrate-v7.js → 0 命中；vault 实证：/mnt/c/.../changes/chg-20260604-01.md:64「- [[audit-2026-06-01-3625f0d]] 守卫识别层系统性缺陷审计（如有）」等多文件残留；设计 spec L183 明列该项
- 复现：对照 docs/superpowers/specs/...design.md §5.2 第 3 步清单与 migrate-v7.js 全文；grep -rn '（如有）' /mnt/c/.../paceflow-hooks/changes/ 验证迁移后残留

### R-72 [P3] findings.md 表头 [change::] 声明只在 migrate 路径落地，hook 创建模板与 spec 新建模板未同步——新项目天生带旧表头

- 位置：`plugin/hooks/templates/findings.md` :5
- 指控：设计 §3.3「findings.md 表头补 [change::] 第三字段声明」只实现于 migrate-v7.js 的 FINDINGS_HEADER_COMMENT（存量修复），但 createTemplates 用的 plugin/hooks/templates/findings.md:5 与 artifact-writer 新建 findings.md 用的 spec 模板（artifact-writer-spec.md:235）表头注释均无 [change::]；v7 后 record-finding 会写 [change::] meta（record-finding.md:29/78），新建项目将复现「实际已存在使用、表头未声明」这一 §3.3 要修的原始问题，且迁移项目与新建项目表头分叉
- 证据：plugin/hooks/templates/findings.md:5 '<!-- 格式：- [状态] [[finding-id|title]] — summary #finding [date:: YYYY-MM-DD] [impact:: P0-P3] -->' 无 [change::]；artifact-writer-spec.md:235 同样缺；migrate-v7.js:53 的 FINDINGS_HEADER_COMMENT 则含 [change::]
- 复现：grep -n 'change::' plugin/hooks/templates/findings.md plugin/agent-references/artifact-writer-spec.md plugin/migrate/migrate-v7.js 三处对照

### R-73 [P3] plugin/hooks/templates/implementation_plan.md 是退役死模板，随 marketplace 发布面残留

- 位置：`plugin/hooks/templates/implementation_plan.md`
- 指控：该模板的仅有两个消费者（pace-utils.js createTemplates L762-764、pre-tool-use.js 模板恢复 L1307-1309）都以 ARTIFACT_FILES 为遍历集合，v7 已将 implementation_plan.md 移出该集合，batch-archive-v5.js 用自己的内联模板（L33-34）不读此文件——模板文件零可达消费者，属双文件合并退役清理遗漏（spec 附录 A 消费点盘点未覆盖 templates 目录），随插件包发布
- 证据：grep -rn 'TEMPLATES_DIR' plugin/ 仅两处，均 ARTIFACT_FILES.includes 守卫；tests/test-hooks-e2e.js:2434 断言新项目不再创建 implementation_plan.md；e2e 全绿证明删除该模板无行为影响
- 复现：grep -rn 'templates' plugin/hooks/pace-utils.js plugin/hooks/pre-tool-use.js plugin/migrate/batch-archive-v5.js 追全部模板读取路径，确认无 implementation_plan.md 可达读取

### R-74 [P3] 单源化矩阵「报告标题硬约束→各 instruction 改一行指针」未落地，三处完整复述措辞各异保留

- 位置：`plugin/agent-references/instructions/create-chg.md` :42（另 close-chg.md:57、update-chg.md:86）
- 指控：设计 §4.1 矩阵把「报告标题硬约束 + CRLF/stale-read 处理块」列为同一行：spec 立单节、各 instruction 改一行指针。CRLF 半项已落地（spec §9.1 + archive/close-chg 一行指针），报告标题半项未动——spec §10 单节在（v7 前已存在），create-chg:42 / close-chg:57 / update-chg:86 仍是三段措辞互异的完整复述（「无说明文字、无空行」vs「无自然语言、无空行、无说明前缀」vs 指向 agent.md §报告格式），矩阵针对的分叉漂移风险对该项原样保留
- 证据：git show a167727 对照：close-chg.md:57 与 HEAD 逐字相同（v7 未触碰）；grep -rn '报告标题强制' plugin/ → spec §10 + 3 instruction 复述并存且无指向 spec §10 的指针；CRLF 同矩阵行则已改「权威定义见 ../artifact-writer-spec.md §9.1」
- 复现：grep -rn '报告标题强制' plugin/agent-references/ 对照设计 spec §4.1 矩阵第 4 行的处置要求

### R-75 [P3] 三层 schema 接线第 2 层兜底只覆盖 chg 帧，finding/correction 存量漂移无 Stop/SessionStart 兜底

- 位置：`plugin/hooks/stop.js` :219
- 指控：设计 §3.5 定义了 finding/correction 必填集并要求「collect-state / stop 兜底检测存量漂移」（未限定 kind），产物中第 2 层只对活跃 CHG 生效：stop.js:219 硬编码 kind='chg'、SessionStart 渲染来源 summarizeActiveChanges 的 schemaViolation 字段（layers.js:771）同样只含 CHG；finding/correction 帧只在写盘瞬间被第 1 层检查（post-tool-use.js:154-156），若 agent 忽略该次 warning，漂移帧永久无人催修。plan V7B-8 测试本就只写了 CHG 场景（收窄未回写设计文档）
- 证据：stop.js:219 `validateFrontmatterSchema('chg', change.status || '', fm || {})`；collect-state.js 全文 grep validateFrontmatterSchema 零命中；layers.js:771 仅消费 active change summaries 的 s.schemaViolation；post-tool-use.js:154-156 写盘层三 kind 全覆盖（对照差异）
- 复现：grep -n validateFrontmatterSchema plugin/hooks/stop.js plugin/hooks/session-start/collect-state.js plugin/hooks/post-tool-use.js；构造 schema-version 7.0 但含多余 key 的 changes/findings/*.md 后跑 stop.js，无 repair warning

### R-76 [P3] 测试锁第一组（agent.md ⊇ guard 校验集）从 spec 的全操作范围收窄为 close-chg 单操作

- 位置：`tests/test-pace-utils.js` :3445-3460
- 指控：设计 §4.3 第一组测试锁表述为「agent.md 必填字段清单 ⊇ guard 实际校验集（防 A1 重演）」未限定操作；V7D-1 实现只锁 close-chg 的 mentionsCloseChg 块，guard 其余必填校验集（update-chg approve 的 approval-confirmed/source/evidence L482-485、verify/review 的 review-confirmed 等 L542-544/558-565）与 agent.md 清单的一致性无锁——V7D-2 锁的是 guard 模板↔instruction 模板，不经过 agent.md，agent.md 这些段落漂移不会红灯；plan D2 写作时即收窄到 close-chg，spec 与 plan 两份基准对该锁范围表述不一致且无收窄说明
- 证据：tests/test-pace-utils.js:3448 `guardSrc.match(/if \(mentionsCloseChg\) \{/)` 仅一块；agent-lifecycle-guard.js L482-565 存在 approve/verify/review/close 多组 missing.push 校验集；设计 spec §4.3（L166）与 plan D2 V7D-1（L402-404）措辞对照
- 复现：对照 spec §4.3 三组定义与 tests/test-pace-utils.js V7D-1 实现；grep -n 'missing.push' plugin/hooks/pre-tool-use/agent-lifecycle-guard.js 列出未被 V7D-1 覆盖的校验集

### R-77 [P3] migrate 报告缺「补缺清单」：rewriteFrontmatter 返回的 added 字段从未被消费

- 位置：`plugin/migrate/migrate-v7.js` :156-171, 283-284
- 指控：设计 §5.2 第 4 步要求迁移报告输出「处理文件数 / 删除字段统计 / 补缺清单」三项；产物报告只有前两项加 archived-date 回填，rewriteFrontmatter 计算并返回的 added（补缺 key 置 null 清单）在 main() 中零消费——用户 dry-run 审报告时看不到哪些文件被补了哪些 null key（与「删除字段统计」对称的信息缺失），spec 报告合同部分交付
- 证据：migrate-v7.js:171 return 含 added；main() L283-284 只消费 r.dropped 与 r.content；grep -n 'added' 全文无其他消费点；设计 spec L184「输出迁移报告（处理文件数 / 删除字段统计 / 补缺清单）」
- 复现：grep -n '\.added\|added' plugin/migrate/migrate-v7.js；对 fixture vault 跑 --dry-run 观察报告无补缺 key 清单输出

**D10-design-conformance 覆盖说明**：D10 双向对位审计覆盖：【基准】设计 spec 245 行与 plan 484 行全文通读，plan 修订三连（1c2c8b3 对抗自审 7 项、f62a394 交叉影响 2 项、e7c911a D1 范围扩充）diff 级核对；7 个 vault CHG 详情（chg-20260611-08~13 + chg-20260612-01）验收标准段逐条对照产物。【正向（设计→产物）确认落地无问题项】§2.1 tombstone 模板逐字一致（migrate-v7.js TOMBSTONE）；§2.2 附录 A 消费点处置全落地（ARTIFACT_FILES/MIGRATABLE 解耦/ARCHIVE_REQUIRED/FORMAT_SNIPPETS implIndex+implDetail 删除/impl-archive-reminded 删除/v5 检测保留/layers 注入只剩 task.md，hook JS 内 implementation_plan 残留全部核为白名单：v5 检测、PROTECTED 声明、迁移工具、guard regex fallback）；§2.3 锁机制（artifactResourceForRel 保 index:changes 且 impl_plan 返 ''——test 1018、markIndexChangesTouchedAndMaybeRelease 直接释放保签名——V7A-6、readArtifactIndexTransaction 删净、sweep 白名单保 index-transactions——locks.js:817）；§2.4 四 instruction 单写（instructions/ 下 grep implementation_plan 清零）；§3.1 SCHEMA_V7_KEYS 与 spec 字段表逐字段一致（chg 9/finding 3/correction 2）；§3.4 worktree/branch 恒写未被条件化；§3.5 validateFrontmatterSchema 实现与 plan 代码骨架一致、第 1 层写盘打回三 kind 全覆盖、6.0 skip 通道、migrate 验收 skip 假绿已收口；§4.1 矩阵其余行落地（close-chg 模板 2→1、状态映射表指针化 change-lifecycle/SKILL、CRLF spec §9.1+指针、helper 4 步单源 pace-workflow+3 指针、schema-keys 机器注释行在 L83）；§4.2 status-reason 文档收敛（plugin/*.md 零 block-reason/pause-reason）+ finding-detail「推荐结构」措辞；§5 migrate（--cwd/--dry-run/--hygiene/--restore、备份、v7-migration-state、index-transactions 清理、弯引号+scope 修正、findings 三态重排 ARCHIVE_PATTERN 独占行锚定）；§5.3 未迁移提示（detectUnmigratedV6Layout readActive 语义、V7E-9/10/11、v7-migrate-reminded 入 SESSION_SCOPED_FLAGS）；§6 版本三处 bump 7.0.0 一致（PACE_VERSION/plugin.json/marketplace.json）。【对抗自审 7 项+交叉影响 2 项】逐项核对：Map 去重、implCheckbox 全仓清零、A1 误伤三处并 commit、guard PROTECTED 统一（GUARD_PROTECTED_FILES union）、create-chg id 表述废止、schema-keys 注释、E2 readActive、pre-tool-use:1477 连续执行无 implCheckbox、walkthroughContextForChange 单文件循环——除「Bash deny e2e 断言」一项外全落地（该项行为实测仍在、仅测试锁缺失，已列 finding）。【D1 framing 重写】负向模式词 grep（不再/已退役/7.0 帧无/v7 起）残留全为合法指针语；CRITICAL/MUST 激进措辞零残留。【反向（产物→设计）】git diff a167727..HEAD 44 文件逐一归因：path-utils.js（CHG-08 保护旁路修复，有记录）、post-tool-use-failure.js（CHG-08 半开事务退役，有记录）、pause.md（CHG-11 审计 P2，有记录）、--restore（CHG-13 真跑 P0，有记录）、approve-only 锁+README（CHG-20260612-01，有记录）、docs/audits/ticket-audit（v6 时代审计存档随 0c43dc9 落盘，自带说明，非 runtime）、.gitignore 测试豁免（已知运维事项）——无未记录 scope creep。【测试实跑】五套全绿：test-pace-utils 275/275、test-hooks-e2e 391/391、test-session-layers 42/42、test-agent-tests-helpers 9/9、test-migrate-v7 12/12，与各 CHG 工作记录声称数字一致；V7D-1/2/3、V7C-1/2、V7E-14/15 存在性逐个确认。【行为实测】Bash 三形态直写 tombstone 全 deny（fixture 复现脚本 /tmp/v7-audit-bashguard-check.js）。【已知问题排除】foreign worktree 搭便车、SessionStart IQ change-set、tests/* gitignore 豁免未重复报告。【vault 抽查】迁移产物 frontmatter（chg-08~13 全 7.0 九 key 帧）、corrections.md [scope::] 修正已生效、correction-2026-06-04-01 正文弯引号残留核为用户原话引用（frontmatter 五字段删除使原结构性问题自然消解，不计 finding）。

---

