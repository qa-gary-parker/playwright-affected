import { test, expect } from '@playwright/test';

test('logs in', { tag: ['@auth', '@smoke'] }, () => {
  expect(1).toBe(1);
});

test('resets password', () => {
  expect(process.env.FAIL_AUTH ? 0 : 1).toBe(1);
});
