# PACEflow v7.0 严格审计——去重 + 对抗验证后最终报告

> 日期：2026-06-12
> 输入：`audit-2026-06-12-v7-strict-audit-raw-findings.md`（77 条原始 findings，10 维度并行扫描）
> 方法：5 个对抗验证员（opus）分组独立复核——每条跑最小复现 / 路径追踪 / 设计意图查证，severity 按真实场景可达性校准（纪律工具判据：日常可达必修、故意构造才可达降级）；跨组重复由指定主验证员裁决；mutation 类主张实测验证（验毕工作区还原确认干净）。
> 增量输入：dogfood session 08227526 行为审查（306 事件全量），贡献 1 条新 finding（R-78）+ 1 条运行时实证（并入 R-48）。

## 总判

**77 条原始 findings：confirmed 61 / by-design 2 / duplicate 14 / refuted 0**，另新增 R-78（dogfood 实证）。

| | 原判 | 验证后 |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 2 | **2**（R-23 降出 P2；R-47 由 P2 升入） |
| P2 | 22 | **12** |
| P3 | 53 | **47 + R-78 = 48** |
| by-design | — | 2（R-04、R-49） |
| duplicate | — | 14 |

零证伪说明原始审计的证据质量高；但 severity 初判偏重（10 条 P2 降 P3）、去重率 18%（10 维并行扫描的同源重复），且 1 条 P2 实为漏判的 P1（R-47）。

## Severity 仲裁记录（跨组分歧）

- **R-28/R-56（PreCompact 快照文档）**：D3+D4 判 P2、D7+D8 判 P3 → **仲裁 P3**。判据：该快照文件退役正因无消费方，没有任何用户操作路径依赖它，宣称其存在不会引导错误操作（区别于 R-54/R-55 的「方向反了/操作指引矛盾」）。
- **R-29/R-57（hook 事件 8 vs 9）**：同上分歧 → **仲裁 P3**。计数与缺行不引导错误操作。

---

## P1（2 条）

### R-47 reserve-artifact-id 重复发号：existingMax 正则漏匹配带 slug 的 CHG 文件名（原判 P2 → 升 P1）
- 验证：隔离 fixture 实测复现——`.pace` 不存在 + 已有 `chg-20260612-01-foo.md`/`-02-bar.md`，`reserveArtifactId` 返回 `CHG-20260612-01`（撞号）。根因 `locks.js:743` CHG 分支正则 `^chg-DATE-(\d{2})\.md$` 要求数字后紧跟 `.md`，漏匹配 slug 文件名；correction 分支（`locks.js:760`）已适配 slug，slug 改造时 CHG 分支漏改。
- 升级理由：counter 丢失在一级支持场景日常可达（fresh clone 时 `.pace` 被 gitignore 排除 / 第二台机器共享 vault / 手清 `.pace`），任一发生且当日已有 CHG 即重发同 ID；后果是功能性 ID 重复——task.md 双行同 ID，`getActiveChangeEntries` 按纯 ID Map 静默吞掉一条 entry。非 v7 回归但现行缺陷。
- 关联：本 session 早前记录的「reservation 被并行 record-finding agent 误清致跳号」待查项可能同根（counter 状态可靠性）。

### R-63 升级窗口 brick 已实测证实，但发布面零升级顺序指引（维持 P1）
- 验证：README 仅有 `### v5 用户升级` 节，grep 全文 migrate-v7 仅版本历史表一行；旧 hook（a167727）`DENY_V6_INDEX_MISMATCH` 分支对已迁移布局（tombstone）deny 一切项目文件写入，且 deny 文案引导「派 artifact-writer 修复索引」——照做会向 tombstone 回填索引行 = 撤销迁移，形成拉锯。
- 维持理由：marketplace 升级不强制 reload 既有 session，worktree 多 session 是一级支持场景；野外 v6 用户在新 session 迁移后，任何未 reload 的旧 session 即被双 brick（PreToolUse deny + Stop exit 2），解锁路径对普通用户不可发现。「先升级并 reload 全部 session，再跑数据迁移」这一项目自己踩过两次的依赖顺序未进任何发布面文档。
- 同源：R-64（spec 兼容论证证伪未回写，P2）、R-69（dup）。

---

## P2（12 条）

| ID | 问题 | 验证要点 |
|---|---|---|
| R-06 | archived 帧 verified/reviewed-date 为 null 时三层校验全静默，spec 承诺的配对不变量无执行者 | 实跑 `validateFrontmatterSchema('chg','archived',…)` → ok:true；post-tool-use 兜底正则不匹配带 slug 文件名（整块死路） |
| R-07 | agent.md:165 batch 指引引用已删除的 `type` key 且「在 type 后写」与「key 恒在只改值」矛盾 | **增量**：L164 还把 `type` 列为可选 key——同处两个 v6 残留；照做恰落入 R-10 重复 key 盲区 |
| R-14 | PostToolUse correction 提醒文案（post-tool-use.js:240）教写 legacy `[knowledge:: project-only]`，与 migrate 刚清洗的格式相反 | 每次记 correction 必触发的运行时输出，唯一维持 P2 的 legacy 残留（其余同主题降 P3） |
| R-23 | REFERENCE.md:258 发布检查清单仍要求 schema-version 保持 "6.0"（原判 P1 → 降 P2） | 降级理由：读者是发布维护者非终端用户；回写 6.0 会被运行时 skip 不会 brick 数据。组主条目（吸收 R-08/R-65/R-53 部分） |
| R-24 | agent.md close-chg 正向输入模板缺 implementation-notes——锁外拷贝已实际漂移 | 四处对照唯 agent.md 漂移；照模板派会被 guard deny（deny 有正确提示故非 P1） |
| R-25 | CHG-20260612-01「三处拷贝漂移即红灯」验证主张被 mutation 证伪 | 实测：删 agent.md approve 块 `approval-evidence` 行 → 275/275 仍全绿。V7D-2 只锁 guard↔instruction，agent.md/SKILL 模板块在锁外；design §4.3 本就只规定 V7D-1 范围，commit message 是 overclaim |
| R-27 | README 当前行为区残留「v6 CHG」+「task/impl 索引」——CHG-20260612-01「零漏网」复查被证伪 | 复查 grep 用 `implementation_plan` 字面量匹配不到缩写「impl」，验收失实 |
| R-33 | migrate rewriteFrontmatter 状态判定不剥引号：`status: "archived"` 回填不触发 → 整库迁移验收中止 | fixture 实测 exit=1；migrate-v7.js:145 与 :273 引号处理不一致（作者已预期引号存在但漏了一处）。fail-safe 不损数据，但含引号 status 的野外 v6 vault 不可迁移且报错不揭根因 |
| R-53 | REFERENCE.md 整体未随 v7.0.0 同步：标题仍「v6.6.1 参考手册」、最后更新 2026-06-07 | 整个 v7 周期 REFERENCE 仅改 5 行；release commit 自称「REFERENCE v7 行为同步」与实际不符。吸收 R-30 |
| R-54 | README 激活模型方向反了：仍宣称 3+ 代码文件自动激活与「Write 第 3 文件前瞻 deny」，运行时已降级为仅软提示 /paceflow:enable | 激活合同方向性错误（文档说会拦、实际不拦），用户可见直接误导；新 MANIFEST_FILES 软信号零记载 |
| R-55 | 5 个用户命令（enable/disable/pause/resume/status）README/REFERENCE 全文零记载，且 README:332 教手写 `.pace/disabled` 与 disable.md:13「不要手写」直接矛盾 | 两份用户文档对同一文件的写入口径相反 |
| R-64 | spec 兼容论证（「最坏软 warning 不 deny 不 brick」「可回 v6.7.1 降级」）已被 CHG-13 真跑证伪，spec 零修订 | §6.4 的回滚指引本身就是 brick 路径；违反仓库 CLAUDE.md「历史设计文档须标 historical」。吸收 R-69 |

---

## P3（48 条，按处置分组）

### G-legacy：运行时/发布面 v6 与退役概念残留（建议一个清理 CHG）
- **R-48**（主条目，吸收 R-26 + dogfood A-1 实证）：hook JS 文案 24 处自称 v6（pre-tool-use 17、post-tool-use 5、stop 2）+ 4 处「索引事务」deny 文案残留；CHG-11 framing 重写 commit 零 hooks JS 改动——漏了运行时 prompt 注入面。**dogfood 实证：CHG-20260612-01 写码时 PreToolUse:Edit 三次注入「当前 v6 活跃变更」**。
- R-13（record-correction.md:114 索引行模板 legacy 写法，吸收 R-68；原判 P2 降 P3——同文件已有正确归一表）
- R-15（templates/corrections.md:7、format-reference.md:66、batch-archive-v5.js:42 三处 legacy `project-only` 表示）
- R-35（corrections 索引格式注释三处残留；原判 P2 降 P3——migrate 精确串 replace 对注释行不生效经 node 实测确认）
- R-05（change-analysis.js:161 跨索引 join 陈旧注释）、R-51（pre-tool-use.js:1 文件头「E 阶段 impl_plan 检查」陈旧注释）
- R-16（update-chg.md datetime 孤行）、R-17（close-chg 引用文本与 create-chg 模板不一致）、R-18（spec `type: research → #research` 死行）

### G-doc：README/REFERENCE v7 文档同步（建议一个文档 CHG，可与 P2 的 R-53/54/55 同 CHG）
- R-02（「三门」实为两门）、R-56（PreCompact 快照，吸收 R-28，仲裁 P3）、R-57（8 vs 9 事件 + 结构树缺 4 文件，吸收 R-29，仲裁 P3）、R-58（README 末行 v6.7.1 + 版本历史断档）、R-59（无 v6→v7 升级章节，与 R-63 同 CHG 修）、R-39（spec/README migrate 路径漂移）、R-12（「frontmatter 稳定 ID」过时措辞，**增量：实际 3 处**——SKILL.md:327、spec:252、templates/corrections.md:8）

### G-template：模板/合同覆盖缺口（建议一个 CHG）
- **R-21 + R-78**：update-finding/update-index 是仅有的「写入路径表有名、无字段模板」操作（agent.md 报告枚举 6/8 + SKILL 无模板块）。**R-78（新增，dogfood 实证）：主 session 因此越界 Read agent 内部 instructions（update-finding.md / update-index.md）自救——烧上下文 + 破坏「skill 面向主 session / instructions 面向 agent」职责分层**。处置：SKILL.md + agent.md 补两操作模板。
- R-19（reserved-file-prefix 形状描述同文件互斥）、R-22（record-finding [change::] 缺全名+别名规则，照写是死链）、R-31（报告标题硬约束未单源化，5 处 3 分叉，design 矩阵未完成项，吸收 R-74）
- R-20（templates/implementation_plan.md 零消费死模板 + v6 内容，吸收 R-03/R-60/R-73；design 附录 A 全消费点盘点漏了 orphan 模板，判疏漏非 by-design）、R-32（batch-archive-v5 仍产 v6 双索引布局，前半独立成立）、R-36（findings 表头 [change::] 三拷贝不单源，新项目天生旧表头，吸收 R-72）、R-50（artifactWriterCreateChgHint 仍要求 `reserved-file:`；「死循环」指控证伪为「条件可达 mismatch deny」）

### G-migrate：migrate-v7 工具（建议一个 CHG；注意剩余受众=未迁移野外 v6 项目）
- R-34（零缩进块序列孤儿行 + 验收假绿；原判 P2 降 P3——实测 PACEflow 自身帧用内联流不破，仅外部工具改写的边角形态）
- R-37（batch-archive-v5 产物空活跃区永不触发催办，v5 升级止步 v6）、R-40（--hygiene 游离备份-还原闭环：dry-run 不预览/删除物不入备份/不可还原，三子项实测全中）、R-66（催办盲区双形态实测：全归档项目 + migrate 中途 crash 均永不催办）、R-67（重跑覆盖 migration-state 指向空备份 + 该文件零消费方）、R-71（spec §5.2「（如有）占位清除」零实现，vault 残留 3 文件实证）、R-77（rewriteFrontmatter added 字段从未消费，报告缺「补缺清单」）

### G-test：测试质量（建议一个 CHG）
- R-41（--hygiene/幂等零用例 + 多 ARCHIVE 未锁 + 「13 用例」计数漂移：详情 13 vs 工作记录 10 vs README 12 vs 实际 12）
- R-42（V7C-2 锁的是测试内第三份硬编码拷贝，preload mutation 实测代码漂移不红；修法一行：expected 改用 paceUtils.SCHEMA_V7_KEYS.chg）
- R-43（cancelled 必填分支零覆盖）、R-44（detectUnmigratedV6Layout 活跃区切片防护分支零覆盖）
- R-45（test-session-layers 汇总行无条件 ✅；**增量：test-agent-tests-helpers.js:160 同 bug**——受影响 2 文件非 1；exit code 正确不假绿 CI）
- R-46（runner 不支持 async：async 失败仍 PASS+passed++，仅靠 unhandled-rejection 兜底退出码）
- **R-61**（test-pace-utils 偶发失败：4 并发 × 5 轮复现 4 次；**根因比原审计更具体——WIKI-1/WIKI-1b 直写真实共享 Obsidian vault 而非 tmpdir**，并发/vault 活动下扫描断言互扰。发布验证门假红会掩盖真红）
- R-70（「Bash 直写 impl_plan 仍被 deny」断言不存在；行为本身双通道仍在——bash-guard GUARD_PROTECTED_FILES + fallback regex）、R-76（V7D-1 从 spec 全操作范围收窄为 close-chg 单操作，无收窄说明）

### G-schema：封闭合同校验缺口（与 R-06 同 CHG 评估）
- R-09（层 2/3 兜底只接 chg 帧，finding/correction 无兜底，吸收 R-75；可达性低——需外部编辑器手改）、R-10（重复 key 后值静默覆盖盲区）、R-11（change-set/seq 半空对通过校验，显示退化非数据损坏）

### G-spec：规格回写（文档动作，可并入 G-doc）
- R-38（spec §3.1 correction 删除清单漏 project-scope；实现 DROP_KEYS 正确）、R-52（CHG-09 验收记录「warnOnce 键 schema-violation-<slug>」与产物不符——修记录非实现；行为与 spec「同级不去重」一致）
- R-62（set-activation 报错首句漏列 --pause/--resume/--session，与其下 usage 自相矛盾）

---

## by-design（2 条，不修，规格回写即可）

- **R-04**：MIGRATABLE_ARTIFACT_FILES 保留 impl_plan 是有意决策（batch-archive-v5 的 v5→v6 迁移必须迁它），CHG-08 实施详情有记录、测试有锁；design/plan 仍写「移除/filter 派生」——规格回写动作归 G-spec。
- **R-49**：index:changes 锁「操作跨度→单写即放」收窄是 impl_plan 退役的直接预期后果（无双写原子跨度可保护）；per-write 互斥保留、缓解链完整、最坏后果 benign（Edit old_string 失配重试）。

## duplicate 映射（14 条）

R-03→R-20、R-08→R-23、R-26→R-48、R-28→R-56、R-29→R-57、R-30→R-53、R-60→R-20、R-65→R-23、R-68→R-13、R-69→R-64、R-72→R-36、R-73→R-20、R-74→R-31、R-75→R-09

## dogfood session 增量（08227526，306 事件全量审查）

- **R-78**（新 finding，P3）：主 session 派 update-finding/update-index 前越界 Read agent 内部 instructions——SKILL 模板缺口（R-21）的行为学实证，合并处置。
- **A-1**：PreToolUse:Edit 注入「当前 v6 活跃变更」运行时实证 → 并入 R-48 证据链。
- **A-2**（记录，非缺陷）：首派 create-chg 未显式指定 model 撞 429 空转 213s（subagent_tokens: 0），改 model:fable 重派成功；全 session 约 30 条 429 retry。
- 正常面：dogfood 三项验证目标全部达成（SessionStart 注入收敛 / create-chg 单写 + 9 key / close-chg 折叠三标记），6 次 agent 派遣零打回、Stop 零拦截、双 hook 注入各 <10K。

## 验证过程增量情报（原始审计之外）

1. agent.md:164 把已删 `type` 列为可选 key（R-07 扩面，修复时一并）
2. 「frontmatter 稳定 ID」过时措辞共 3 处且 spec L79 与 L252 内部矛盾（R-12 扩面）
3. test-agent-tests-helpers.js:160 同样无条件 ✅（R-45 扩面，受影响 2 文件）
4. R-61 根因锁定为 WIKI 测试直写真实 vault（比原审计「pace-hooks.log 并发写」推测更具体）
5. R-25 的深层结论：design §4.3 锁范围本就有限（仅 V7D-1 close-chg ⊇ 关系），CHG-20260612-01 commit message「三处拷贝漂移即红灯」是验证 overclaim
