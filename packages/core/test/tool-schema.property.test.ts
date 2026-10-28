import { assertProperty, expectCounterexample } from '@tutors-ai/testing';
import { Ajv } from 'ajv';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { schemaViolation, unsupportedSchema } from '../src/index.ts';

type Schema = Record<string, unknown>;

const KEYS = ['a', 'b', 'c'];
const bound = fc.oneof(fc.integer({ min: -5, max: 5 }), fc.constantFrom(-1.5, 0.5, 2.5), fc.double({ min: -5, max: 5, noNaN: true }));
const count = fc.nat({ max: 4 });
const text = fc.string({ unit: 'binary', maxLength: 4 });

/** An object schema whose required names are drawn from its declared properties. */
function objectSchema(property: fc.Arbitrary<Schema>, minKeys: number): fc.Arbitrary<Schema> {
  return fc.dictionary(fc.constantFrom(...KEYS), property, { minKeys, maxKeys: 3 }).chain((properties) =>
    fc.record(
      {
        type: fc.constant('object'),
        properties: fc.constant(properties),
        required: fc.subarray(Object.keys(properties)),
        additionalProperties: fc.boolean(),
        description: fc.string(),
      },
      { requiredKeys: ['type', 'properties'] },
    ),
  );
}

/** Schemas drawn from the whole enforceable subset, nested a few levels deep. */
const schemas: fc.Arbitrary<Schema> = fc.letrec<{ schema: Schema }>((tie) => ({
  schema: fc.oneof(
    { maxDepth: 3, depthIdentifier: 'schema' },
    { weight: 1, arbitrary: fc.constant({}) },
    { weight: 1, arbitrary: fc.constantFrom({ type: 'boolean' }, { type: 'null' }) },
    {
      weight: 3,
      arbitrary: fc.record({ type: fc.constant('string'), minLength: count, maxLength: count, enum: fc.uniqueArray(text, { minLength: 1, maxLength: 3 }) }, { requiredKeys: ['type'] }),
    },
    {
      weight: 3,
      arbitrary: fc.record(
        { type: fc.constantFrom('number', 'integer'), minimum: fc.oneof(fc.integer({ min: -5, max: 0 }), bound), maximum: fc.oneof(fc.integer({ min: 0, max: 5 }), bound) },
        { requiredKeys: ['type'] },
      ),
    },
    {
      weight: 1,
      arbitrary: fc.record({ type: fc.constantFrom('number', 'integer'), enum: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 3 }) }),
    },
    { weight: 1, arbitrary: fc.record({ type: fc.constant('array'), items: tie('schema'), minItems: count, maxItems: count }, { requiredKeys: ['type'] }) },
    { weight: 1, arbitrary: objectSchema(tie('schema'), 0) },
  ),
})).schema;

/** Values that mostly fit the schema's shape, so deep keywords are reached, and sometimes do not. */
function valuesFor(schema: Schema): fc.Arbitrary<unknown> {
  const items = (schema['items'] ?? {}) as Schema;
  const properties = (schema['properties'] ?? {}) as Record<string, Schema>;
  const shaped: Record<string, () => fc.Arbitrary<unknown>> = {
    string: () => text,
    number: () => bound,
    integer: () => bound,
    boolean: () => fc.boolean(),
    null: () => fc.constant(null),
    array: () => fc.array(valuesFor(items), { maxLength: 4 }),
    object: () =>
      fc
        .tuple(
          fc.oneof(
            { weight: 3, arbitrary: fc.record(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, valuesFor(v)]))) },
            { weight: 1, arbitrary: fc.record(Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, valuesFor(v)])), { requiredKeys: [] }) },
          ),
          fc.oneof({ weight: 2, arbitrary: fc.constant({}) }, { weight: 1, arbitrary: fc.record({ d: fc.jsonValue({ maxDepth: 1 }) }) }),
        )
        .map(([declared, extra]) => ({ ...extra, ...declared })),
  };
  const fitting = shaped[schema['type'] as string]?.() ?? fc.jsonValue({ maxDepth: 2 });
  const listed = schema['enum'] as unknown[] | undefined;
  return fc.oneof(
    { weight: 30, arbitrary: listed === undefined ? fitting : fc.oneof(fc.constantFrom(...listed), fitting) },
    { weight: 1, arbitrary: fc.jsonValue({ maxDepth: 2 }) },
  );
}

/** A tool's input schema: always an object at the root, as MCP requires, with anything below. */
const toolSchemas: fc.Arbitrary<Schema> = objectSchema(schemas, 1);

/** One tool schema and a batch of candidate arguments for it. */
const cases = toolSchemas.chain((schema) => fc.tuple(fc.constant(schema), fc.array(valuesFor(schema), { minLength: 10, maxLength: 20 })));

type Validator = (schema: Schema, value: unknown) => boolean;

const ajv = new Ajv({ strict: false });

/** Ajv's verdict on each value, compiling the schema once. */
function reference(schema: Schema, values: readonly unknown[]): boolean[] {
  const validate = ajv.compile(schema);
  ajv.removeSchema(schema);
  return values.map((value) => validate(value));
}

const ours: Validator = (schema, value) => schemaViolation(schema, value) === null;

/** Removes or rewrites a keyword at every depth: how each known-bad validator misreads a schema. */
function rewrite(schema: Schema, change: (s: Schema) => Schema): Schema {
  const out = change({ ...schema });
  if (out['items'] !== undefined) out['items'] = rewrite(out['items'] as Schema, change);
  if (out['properties'] !== undefined) {
    out['properties'] = Object.fromEntries(Object.entries(out['properties'] as Record<string, Schema>).map(([k, v]) => [k, rewrite(v, change)]));
  }
  return out;
}
const without = (keyword: string) => (s: Schema) => {
  delete s[keyword];
  return s;
};

const KNOWN_BAD: Record<string, Validator> = {
  'ignores required': (schema, value) => ours(rewrite(schema, without('required')), value),
  'ignores additionalProperties': (schema, value) => ours(rewrite(schema, without('additionalProperties')), value),
  'ignores enum': (schema, value) => ours(rewrite(schema, without('enum')), value),
  'treats integer as number': (schema, value) => ours(rewrite(schema, (s) => (s['type'] === 'integer' ? { ...s, type: 'number' } : s)), value),
};

const agreesWithAjv = (validate: Validator) =>
  fc.property(cases, ([schema, values]) => {
    const expected = reference(schema, values);
    return values.every((value, i) => validate(schema, value) === expected[i]);
  });

describe('tool input schemas against Ajv', () => {
  it('HAR-010 accepts exactly the values Ajv accepts, for any schema in the subset', async () => {
    await assertProperty(agreesWithAjv(ours));
  });

  it('HAR-006 recognises every generated schema as enforceable, and none with a keyword outside the subset', async () => {
    await assertProperty(
      fc.property(fc.oneof(schemas, toolSchemas), fc.constantFrom('oneOf', 'pattern', 'format', '$ref', 'const'), (schema, keyword) => {
        expect(unsupportedSchema(schema)).toBeNull();
        expect(unsupportedSchema({ ...schema, [keyword]: {} })).not.toBeNull();
      }),
    );
  });

  for (const [flaw, validate] of Object.entries(KNOWN_BAD)) {
    it(`finds a counterexample against a validator that ${flaw}`, async () => {
      await expectCounterexample(agreesWithAjv(validate));
    });
  }
});
