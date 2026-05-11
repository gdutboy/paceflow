# 严格审计报告：d6f73c1..HEAD

- **审计时间**：2026-05-10 13:52
- **范围**：6 commits，32 文件，+1851/-223
- **commit 序列**：87d6b52 → b509bae → 3b4dbe6 → bd10889 → 40c0f3a → 4f8ad3e
- **未推送**：40c0f3a、4f8ad3e（仍在 master 本地）
- **审计方法**：5 个并行 subagent 视角（CLAUDE.md 合规 / hook bug 浅扫 / git 历史模式 / 跨文件一致性 / 注释契约一致性），共 28 条原始 finding；主 session 用源码与测试逐条核对，过滤 false positive 与噪音，按 0/25/50/75/100 量表打分；只保留 ≥80 的"必修"项与 65-79 的"建议关注"项。

---

## 一、必修项（置信度 ≥ 80）

### F-1（置信度 95）v6.0.47 验证基线错报，3 个测试实际失败

`paceflow/docs/action-plan-2026-05-02.md:124-126` 当前内容：

```bash
node tests/test-hooks-e2e.js                         # 129/129 PASS
node tests/test-pace-utils.js                        # 111/111 PASS
```

实测当前 master：

| 套件 | 文档声称 | 实际 | 失败用例 |
|---|---|---|---|
| `tests/test-hooks-e2e.js` | 129/129 PASS | **129/130** | `9hab2. artifact-root=local 但 Agent prompt 写到 docs 子目录 → DENY` |
| `tests/test-pace-utils.js` | 111/111 PASS | **110/112** | `parseHookStdin 解析 session_id 且 logEntry 自动带 sid`、`getNativePlanPath: 过滤不属于当前项目的 current-native-plan` |

影响：v6.0.47 release sanity 在文档上是绿、在 CI 是红。任何升级到 v6.0.47 后跑 release sanity 的用户都会立即看到 3 个 FAIL，与 README 形成事实矛盾。

修复方向：
1. 将 action-plan 数字改为实际值（128/130 + 110/112）并标注已知失败；或
2. 修复 3 个 FAIL 后再 push 40c0f3a / 4f8ad3e；
3. 在 `tests/` 下加入 release-gate 脚本，让 plugin.json `version` bump 必须先全绿。

---

### F-2（置信度 95）`batch-archive-v5.js` 硬编码 ARTIFACT_FILES，违反 CLAUDE.md 强约束

根 `CLAUDE.md`「开发约定」段原文：

> `CODE_EXTS` 和 `ARTIFACT_FILES` 必须从 `pace-utils.js` 导出引用，禁止硬编码

实际：

`paceflow/plugin/migrate/batch-archive-v5.js:15-18`：

```js
const fs = require('fs');
const path = require('path');

const ARTIFACT_FILES = ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
```

整文件 0 处 `require('../hooks/pace-utils')`，`ARCHIVE_MARKER`、`V6_TEMPLATES`、`CORRECTIONS_TEMPLATE` 全部硬编码本地。`spec.md` 与 `corrections.md` 在 `pace-utils.js` 的 `ARTIFACT_FILES` 中存在，本脚本中 `corrections.md` 通过 `CORRECTIONS_TEMPLATE` 单独走分支，`spec.md` 完全不处理。当 `pace-utils.js` 后续增删 ARTIFACT_FILES 时，本脚本不会跟进。

修复方向：

```js
const { ARTIFACT_FILES, ARCHIVE_PATTERN, ARCHIVE_MARKER } = require('../hooks/pace-utils');
const FILES_TO_MIGRATE = ARTIFACT_FILES.filter(f => f !== 'spec.md' && f !== 'corrections.md');
```

如果存在反向依赖问题（migrate 不能依赖 hooks 运行时），则在 `pace-utils.js` 中显式划出 `MIGRATABLE_ARTIFACT_FILES` 常量并双向引用。

---

### F-3（置信度 80）`acquireArtifactWriterLock` stale 清理竞态返回假性 'locked'

`paceflow/plugin/hooks/pace-utils.js:357-376`：

```js
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
    const fd = fs.openSync(lockPath, 'wx');
    try { fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'); }
    finally { fs.closeSync(fd); }
    return { acquired: true, path: lockPath, lock: { ok: true, path: lockPath, ...payload } };
  } catch(e) {
    if (e && e.code === 'EEXIST') {
      const existing = readArtifactWriterLock(cwd);
      if (isArtifactWriterLockStale(existing, now)) {
        try { fs.unlinkSync(lockPath); continue; } catch(e2) {}   // ← 368
      }
      return { acquired: false, path: lockPath, lock: existing, reason: 'locked' };
    }
    return { acquired: false, path: lockPath, lock: null, reason: e.message || String(e) };
  }
}
```

问题：`continue` 在 `try` 块内。当两个进程同时检测到 stale 都尝试 `unlinkSync`，第二个进程的 `unlinkSync` 抛 ENOENT，被 `catch(e2) {}` 静默吞掉，控制流 fall-through 到 line 370 `return { acquired: false, ..., reason: 'locked' }`——但此时锁文件已经被释放，下一次 `wx` 一定成功。

后果：竞态下出现假性 'locked'，调用方看到 deny 后必须额外重试一次才能进。生产场景下 hook 触发频率高时会出现间歇性 deny。

修复：

```js
if (isArtifactWriterLockStale(existing, now)) {
  try { fs.unlinkSync(lockPath); }
  catch(e2) {
    if (e2.code !== 'ENOENT') {
      return { acquired: false, path: lockPath, lock: null, reason: e2.message };
    }
  }
  continue;
}
```

并在 `tests/test-pace-utils.js` 加 stale-cleanup ENOENT 竞态回归用例。

---

## 二、建议关注（置信度 65-79）

### F-4（70）`batch-archive-v5.js` docstring CLI usage 漏列 `--force`

`paceflow/plugin/migrate/batch-archive-v5.js:9-10` 当前：

```
* 用法：
*   node batch-archive-v5.js <project-vault-path> [--dry-run]
```

`b509bae` 引入了 `--force` 参数（line 131-134：`force && hasBackup` 时改用 `.v5-backup` 作为迁移源重写）。README.md:78 已文档化 `--force`，但脚本本身的 `--help` 来源（顶部 docstring）未同步，命令行用户看不到 `--force` 选项。

修复：把 docstring 用法行改为 `[--dry-run] [--force]`，并在 docstring 末尾加一段说明 `--force` 的语义和与 `.v5-backup` 的关系。

---

### F-5（75）`reserveArtifactId` 失败时 `sequences/<name>.counter` 不回滚导致编号跳号

来源：audit-contracts agent 报告（未亲眼核对源码细节）。

声称：`paceflow/plugin/hooks/pre-tool-use.js:665-667` 在 `ensureArtifactWriterBase` 失败时仅调用 `clearArtifactReservation`，不回滚 `nextSequenceNumber` 已经递增的 counter。`acquireArtifactWriterLock`（line 343-376）的契约是"失败不留副作用"，但 `reserveArtifactId` 链路打破了这个契约。

待验证：实际 `reserveArtifactId` 与 `nextSequenceNumber` 的实现，确认 counter 是否真的不回滚以及对外是否有可观察影响（重试编号跳号）。

---

### F-6（65）`KEEP_ARTIFACT_RESOURCE_LOCK` 阈值仅覆盖 `index:changes` 半完成事务

来源：audit-history agent 对 `4f8ad3e` 的分析（未亲眼核对最终代码）。

声称：`paceflow/plugin/hooks/post-tool-use-failure.js` 的 `KEEP_ARTIFACT_RESOURCE_LOCK` 仅在 `tx.touched.length < 2 && resource === 'index:changes'` 时触发；`touched.length === 0`、`>= 2` 或其他 resource 类型的中间失败仍会无条件释放 resource lock，可能让半完成事务被另一个进程接手。

待验证：读 `post-tool-use-failure.js` 当前实现 + `markIndexChangesTouchedAndMaybeRelease` 完整逻辑 + 跑边界测试。

---

## 三、已验证的 False Positive（agent 报但实际不存在）

| 原 finding | 验证结果 |
|---|---|
| `pace-utils.js:410-413` `Atomics.wait` 在主线程抛 TypeError | Node.js **允许**主线程 `Atomics.wait`，只有浏览器禁止；代码合法 |
| `README.md:70` `PLUGIN_DIR` 仍是 `6.0.43`，与 footer `6.0.47` 错位 | README 当前实际是 `6.0.47`（line 70 验证过），footer 一致 |
| `tests/agent-tests/helpers/subagent-runner.js` 头注释/JSDoc 是英文 | 文件头实测是中文（`协调器：负责加载 YAML 用例 → 准备 fixture → ...`），agent 看错 |
| `pre-tool-use.js:1009-1021` PROTECTED_ARTIFACTS deny 路径资源锁泄漏 | agent 自验后承认 `artifactRelForMutation` 已先拦截，路径不会触发 |

---

## 四、历史模式观察（不计 finding，但值得反思）

- **lock 抽象 60 天内 5 次重写**：`70f9bdb`(serialize) → `50eb0d8`(release on failure) → `e7b0517` → `40c0f3a`(+447 行：writer-lock + resource-lock + index-transaction 三层) → `4f8ad3e`(edge cases)。每次"修复"都引入新一层抽象，说明根因没收敛。
- **40c0f3a 与 4f8ad3e 同日 33 分钟内同文件二次修复**：12:42 提交 40c0f3a 后 13:15 立刻补 4f8ad3e，强烈暗示 40c0f3a 的并发覆盖测试不充分；建议下一步在 `tests/test-pace-utils.js` 补 transaction.touched=0 / >=2 边界用例。
- **30 天内 fix: 占 14/15**：节奏过紧，且 release 同时带 3 个 FAIL test —— 验证门没把住。
- **`pre-tool-use.js` denyOrHint 文案 3 commit 增量打补丁**（`bfebff1` → `87d6b52` → `3b4dbe6`）：reason 字段被反复追加 `artifact-root` / `synced-plans` 提示，建议合并审查 `denyOrHint` 调用点是否还有遗漏字段。

---

## 五、行动清单（按优先级）

1. **阻塞 release**：修复 F-1（先把 3 个 FAIL test 修了 / 或回退 v6.0.47 release tag）
2. **阻塞 release**：修复 F-2（违反 CLAUDE.md 强约束）
3. **稳定性**：修复 F-3（lock 竞态假性 deny）
4. **加测试**：在 `tests/test-pace-utils.js` 补 stale lock ENOENT 竞态、`tx.touched` 边界用例
5. **建议**：核对 F-5、F-6（如果确认存在按 F-3 同等优先级处理）
6. **文档**：F-4（docstring 加 `--force`）

未推送的 40c0f3a / 4f8ad3e 在 F-1、F-3 修好之前**不要 push 到 origin/master**，避免把"action-plan 自报全 PASS 但实际 3 FAIL + 假性 deny"扩散到远端。
