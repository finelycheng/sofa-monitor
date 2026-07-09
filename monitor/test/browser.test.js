import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from '../lib/browser.js';

// 回归测试(Important#1):visit() 必须在 gap-sleep 之前就关掉上一条目的 ctx,
// 而不是等 sleep 结束后才关——否则挂起的旧页会和新页同时占内存。
// 用 browser.contexts() 数量断言:任意时刻至多一个 context 存活,不随 visit 次数累积。
test('visit 立即关闭上一条目的 ctx,不与下一条目双开', async () => {
  const b = await launch({ fast: true });
  try {
    await b.visit('about:blank');
    assert.equal(b.browser.contexts().length, 1);
    await b.visit('about:blank');
    assert.equal(b.browser.contexts().length, 1, '旧 ctx 应已被关闭,而非累积到 2 个');
    await b.visit('about:blank');
    assert.equal(b.browser.contexts().length, 1);
  } finally {
    await b.close();
  }
});
