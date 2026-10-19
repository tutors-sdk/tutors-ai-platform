// Compliant fixture: the same words in comments, strings and regexes, and restored mocks.
import { afterEach, describe, expect, it, vi } from 'vitest';

// it.only( and describe.skip( in a comment are not code.
const notCode = ['it.only(', "test.todo('x')", `describe.skip(`, /it\.only\(/];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('clean', () => {
  it('restores what it installs', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error');
    expect(notCode).toHaveLength(4);
  });
});
