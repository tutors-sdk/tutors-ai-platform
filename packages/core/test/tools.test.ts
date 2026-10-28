import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalToolDefinition } from '../src/index.ts';

describe('canonical tool definitions', () => {
  it('TH-002 sorts keys at every depth and leaves out undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: null, y: 'x' }], c: undefined } })).toBe('{"a":{"d":[3,{"y":"x","z":null}]},"b":1}');
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson({ 'é': 1, Z: 2, a: 3 })).toBe('{"Z":2,"a":3,"é":1}');
  });

  it('TH-002 covers the name, title, description, input schema and read-only declaration, and nothing else', () => {
    const definition = { name: 'search', description: 'd', inputSchema: { type: 'object' }, readOnly: true };
    expect(canonicalToolDefinition(definition)).toBe('{"description":"d","inputSchema":{"type":"object"},"name":"search","readOnly":true}');
    expect(canonicalToolDefinition({ ...definition, title: 'Search' })).toBe(
      '{"description":"d","inputSchema":{"type":"object"},"name":"search","readOnly":true,"title":"Search"}',
    );
    const extra = { ...definition, server: 'docs', digest: 'sha256:1' } as typeof definition;
    expect(canonicalToolDefinition(extra)).toBe(canonicalToolDefinition(definition));
  });
});
