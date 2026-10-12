import { test, expect } from '@playwright/test';

test.describe('editor @editor', () => {
  test('opens a document @smoke', () => {
    expect(1).toBe(1);
  });

  test('saves a draft', () => {
    expect(process.env.FAIL_EDITOR ? 0 : 1).toBe(1);
  });
});
