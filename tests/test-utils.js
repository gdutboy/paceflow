// test-utils.js — 测试公共工具（I-23：消除三文件重复的 test/makeTmpDir/cleanup 定义）
// 工厂函数模式：每个测试文件创建独立实例，内部维护 passed/failed/tmpDirs 状态
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * 创建测试运行器实例
 * @param {string} prefix - 临时目录前缀（区分不同测试文件的临时目录）
 * @returns {{ test: Function, makeTmpDir: Function, cleanup: Function, passed: number, failed: number, tmpDirs: string[] }}
 */
function createTestRunner(prefix = 'pace-test') {
  const ctx = { passed: 0, failed: 0, tmpDirs: [] };

  /** 创建隔离临时目录 */
  ctx.makeTmpDir = function(label) {
    const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(dir, { recursive: true });
    ctx.tmpDirs.push(dir);
    return dir;
  };

  /** 清理所有临时目录 */
  ctx.cleanup = function() {
    for (const dir of ctx.tmpDirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch(e) {}
    }
  };

  /** 运行单个测试 */
  ctx.test = function(name, fn) {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') throw new Error('async 测试 fn 返回 Promise——runner 不 await，断言可能静默丢失；改为同步断言（R-46）');
      ctx.passed++;
      console.log(`  PASS: ${name}`);
    } catch(e) {
      ctx.failed++;
      console.error(`  FAIL: ${name}`);
      console.error(`    ${e.message}`);
    }
  };

  return ctx;
}

module.exports = { createTestRunner };
