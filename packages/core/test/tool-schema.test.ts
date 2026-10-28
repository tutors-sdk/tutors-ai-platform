import { describe, expect, it } from 'vitest';
import { schemaViolation, unsupportedSchema } from '../src/index.ts';

describe('unsupportedSchema', () => {
  it('HAR-006 accepts every keyword in the subset', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $comment: 'c',
      title: 't',
      description: 'd',
      default: {},
      examples: [{}],
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 0, maxLength: 3, enum: ['a', 'bb', null, 1, true] },
        count: { type: 'integer', minimum: -1.5, maximum: 9 },
        tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'number' } },
        free: {},
      },
      required: ['name'],
      additionalProperties: false,
    };
    expect(unsupportedSchema(schema)).toBeNull();
  });

  it.each([
    [null, '$ is not a schema object'],
    [[], '$ is not a schema object'],
    [true, '$ is not a schema object'],
    [{ oneOf: [] }, '$ uses unsupported keyword "oneOf"'],
    [{ type: ['string', 'null'] }, '$.type must be one type name'],
    [{ type: 'date' }, '$.type must be one type name'],
    [{ minLength: -1 }, '$.minLength must be a non-negative integer'],
    [{ maxLength: 1.5 }, '$.maxLength must be a non-negative integer'],
    [{ minItems: '1' }, '$.minItems must be a non-negative integer'],
    [{ maxItems: -2 }, '$.maxItems must be a non-negative integer'],
    [{ minimum: '0' }, '$.minimum must be a finite number'],
    [{ maximum: Infinity }, '$.maximum must be a finite number'],
    [{ required: 'name' }, '$.required must be a list of names'],
    [{ required: [1] }, '$.required must be a list of names'],
    [{ additionalProperties: {} }, '$.additionalProperties must be true or false'],
    [{ enum: [] }, '$.enum must list strings, numbers, booleans or null'],
    [{ enum: 'a' }, '$.enum must list strings, numbers, booleans or null'],
    [{ enum: [{}] }, '$.enum must list strings, numbers, booleans or null'],
    [{ enum: [NaN] }, '$.enum must list strings, numbers, booleans or null'],
    [{ enum: ['a', {}] }, '$.enum must list strings, numbers, booleans or null'],
    [{ enum: [1, Infinity] }, '$.enum must list strings, numbers, booleans or null'],
    [{ properties: [] }, '$.properties must be an object'],
    [{ properties: null }, '$.properties must be an object'],
    [{ properties: { a: { pattern: 'x' } } }, '$.properties.a uses unsupported keyword "pattern"'],
    [{ properties: { a: {}, b: 3 } }, '$.properties.b is not a schema object'],
    [{ items: [{}] }, '$.items is not a schema object'],
    [{ items: { items: { format: 'uri' } } }, '$.items.items uses unsupported keyword "format"'],
  ])('HAR-006 rejects %j: %s', (schema, problem) => {
    expect(unsupportedSchema(schema)).toBe(problem);
  });
});

describe('schemaViolation', () => {
  it.each([
    ['object', {}, [], '$ must be an object'],
    ['object', {}, null, '$ must be an object'],
    ['array', [], {}, '$ must be an array'],
    ['string', '', 1, '$ must be a string'],
    ['number', 1.5, '1', '$ must be a number'],
    ['integer', 2, 2.5, '$ must be an integer'],
    ['boolean', false, 0, '$ must be a boolean'],
    ['null', null, false, '$ must be a null'],
  ] as const)('HAR-010 checks type %s', (type, good, bad, problem) => {
    expect(schemaViolation({ type }, good)).toBeNull();
    expect(schemaViolation({ type }, bad)).toBe(problem);
  });

  it('HAR-010 treats an integer as a number, and nothing but a finite number as either', () => {
    expect(schemaViolation({ type: 'number' }, 3)).toBeNull();
    expect(schemaViolation({ type: 'number' }, Infinity)).toBe('$ must be a number');
    expect(schemaViolation({ type: 'integer' }, NaN)).toBe('$ must be an integer');
    expect(schemaViolation({ type: 'string' }, undefined)).toBe('$ must be a string');
    expect(schemaViolation({ type: 'object' }, () => 1)).toBe('$ must be an object');
  });

  it('HAR-010 accepts any value when no type or other keyword is given', () => {
    for (const value of [null, 1, 'x', [], {}, true]) expect(schemaViolation({}, value)).toBeNull();
  });

  it('HAR-010 checks enum by value', () => {
    const schema = { enum: ['a', 1, null] };
    expect(schemaViolation(schema, 'a')).toBeNull();
    expect(schemaViolation(schema, null)).toBeNull();
    expect(schemaViolation(schema, '1')).toBe('$ must be one of ["a",1,null]');
  });

  it('HAR-010 counts string length in code points, inclusive at both ends', () => {
    const schema = { minLength: 2, maxLength: 3 };
    expect(schemaViolation(schema, 'a')).toBe('$ must have at least 2 characters');
    expect(schemaViolation(schema, 'ab')).toBeNull();
    expect(schemaViolation(schema, 'abc')).toBeNull();
    expect(schemaViolation(schema, 'abcd')).toBe('$ must have at most 3 characters');
    expect(schemaViolation(schema, '😀😀😀')).toBeNull();
  });

  it('HAR-010 leaves a value unbounded on the side a schema does not bound', () => {
    expect(schemaViolation({ maximum: 2 }, -1e9)).toBeNull();
    expect(schemaViolation({ minimum: 1 }, 1e9)).toBeNull();
    expect(schemaViolation({ maxLength: 2 }, '')).toBeNull();
    expect(schemaViolation({ minLength: 1 }, 'x'.repeat(1_000))).toBeNull();
    expect(schemaViolation({ maxItems: 1 }, [])).toBeNull();
    expect(schemaViolation({ minItems: 1 }, new Array(1_000).fill(0))).toBeNull();
  });

  it('HAR-010 bounds numbers inclusively', () => {
    const schema = { minimum: 1, maximum: 2 };
    expect(schemaViolation(schema, 0.5)).toBe('$ must be at least 1');
    expect(schemaViolation(schema, 1)).toBeNull();
    expect(schemaViolation(schema, 2)).toBeNull();
    expect(schemaViolation(schema, 2.5)).toBe('$ must be at most 2');
  });

  it('HAR-010 counts array items inclusively and checks every item', () => {
    const schema = { minItems: 1, maxItems: 2, items: { type: 'string' } };
    expect(schemaViolation(schema, [])).toBe('$ must have at least 1 items');
    expect(schemaViolation(schema, ['a'])).toBeNull();
    expect(schemaViolation(schema, ['a', 'b'])).toBeNull();
    expect(schemaViolation(schema, ['a', 'b', 'c'])).toBe('$ must have at most 2 items');
    expect(schemaViolation(schema, ['a', 3])).toBe('$[1] must be a string');
    expect(schemaViolation({ minItems: 1 }, [3])).toBeNull();
  });

  it('HAR-010 checks required, declared and additional properties, own properties only', () => {
    const schema = { properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    expect(schemaViolation(schema, { a: 'x' })).toBeNull();
    expect(schemaViolation(schema, {})).toBe('$.a is required');
    expect(schemaViolation(schema, Object.create({ a: 'inherited' }))).toBe('$.a is required');
    expect(schemaViolation(schema, { a: 1 })).toBe('$.a must be a string');
    expect(schemaViolation(schema, { a: 'x', b: 1 })).toBe('$.b is not allowed');
    expect(schemaViolation({ properties: { a: { type: 'string' } } }, { a: 'x', b: 1 })).toBeNull();
    expect(schemaViolation({ required: ['toString'] }, {})).toBe('$.toString is required');
    expect(schemaViolation({ properties: {}, additionalProperties: false }, { toString: 1 })).toBe('$.toString is not allowed');
  });

  it('HAR-010 names the path of a nested problem and reports the first one', () => {
    const schema = { properties: { list: { items: { properties: { n: { type: 'integer' } }, required: ['n'] } } } };
    expect(schemaViolation(schema, { list: [{ n: 1 }, { n: 1.5 }, {}] })).toBe('$.list[1].n must be an integer');
    expect(schemaViolation(schema, { list: [{ n: 1 }, {}] })).toBe('$.list[1].n is required');
  });

  it('HAR-010 applies each keyword only to values of its own kind', () => {
    const schema = { minLength: 5, minimum: 5, minItems: 5, required: ['x'], items: { type: 'string' } };
    for (const value of [1, 'a', [], {}, null, true]) {
      const expected = typeof value === 'string' ? '$ must have at least 5 characters'
        : typeof value === 'number' ? '$ must be at least 5'
        : Array.isArray(value) ? '$ must have at least 5 items'
        : value !== null && typeof value === 'object' ? '$.x is required'
        : null;
      expect(schemaViolation(schema, value)).toBe(expected);
    }
  });
});
