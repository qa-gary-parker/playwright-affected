import { test, expect } from '@playwright/test';

test.describe('billing', { tag: '@billing' }, () => {
  test('shows invoices', () => {
    expect(1).toBe(1);
  });

  test('upgrades plan', ({}, testInfo) => {
    expect(process.env.FLAKY_BILLING && testInfo.retry === 0 ? 0 : 1).toBe(1);
  });
});
