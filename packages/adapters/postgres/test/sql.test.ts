import { describe, expect, it } from 'vitest';
import { schemaName } from '../src/index.ts';

describe('schemaName', () => {
  it('quotes plain identifiers and rejects anything else', () => {
    expect(schemaName('public')).toBe('"public"');
    for (const bad of ['Public', '1abc', 'a;drop table x', 'a"b', '', 'a'.repeat(64)]) {
      expect(() => schemaName(bad)).toThrow('invalid schema name');
    }
  });
});
