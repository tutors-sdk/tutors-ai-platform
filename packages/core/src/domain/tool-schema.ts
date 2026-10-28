/**
 * The subset of JSON Schema the tool harness can enforce (docs/adr/0008).
 *
 * A tool's input schema comes from its server. The harness checks the model's
 * arguments against it before a call leaves the platform, so it must
 * understand every keyword the schema uses: a keyword it ignored would be a
 * constraint it silently failed to enforce. A schema that uses anything
 * outside this subset is unsupported, and the tool is withheld (HAR-005).
 */

export type JsonPrimitive = string | number | boolean | null;

export const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

/** Keywords that describe a schema without constraining a value. */
const ANNOTATIONS = ['$schema', '$comment', 'title', 'description', 'default', 'examples'];

const COUNTS = ['minLength', 'maxLength', 'minItems', 'maxItems'];
const BOUNDS = ['minimum', 'maximum'];
const KEYWORDS = new Set([...ANNOTATIONS, ...COUNTS, ...BOUNDS, 'type', 'properties', 'required', 'additionalProperties', 'enum', 'items']);

type Schema = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPrimitive = (value: unknown): value is JsonPrimitive =>
  value === null || typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value);

/** Why `schema` is outside the subset, or null when the harness can enforce all of it. */
export function unsupportedSchema(schema: unknown, path = '$'): string | null {
  if (!isRecord(schema)) return `${path} is not a schema object`;
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) return `${path} uses unsupported keyword "${key}"`;
  const { type, properties, required, additionalProperties, items } = schema;
  if (type !== undefined && !(SCHEMA_TYPES as readonly unknown[]).includes(type)) return `${path}.type must be one type name`;
  for (const key of COUNTS) {
    const n = schema[key];
    if (n !== undefined && !(Number.isInteger(n) && (n as number) >= 0)) return `${path}.${key} must be a non-negative integer`;
  }
  for (const key of BOUNDS) {
    const n = schema[key];
    if (n !== undefined && !Number.isFinite(n)) return `${path}.${key} must be a finite number`;
  }
  if (required !== undefined && !(Array.isArray(required) && required.every((r) => typeof r === 'string'))) {
    return `${path}.required must be a list of names`;
  }
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') return `${path}.additionalProperties must be true or false`;
  if (schema['enum'] !== undefined) {
    const values = schema['enum'];
    if (!(Array.isArray(values) && values.length > 0 && values.every(isPrimitive))) return `${path}.enum must list strings, numbers, booleans or null`;
  }
  if (properties !== undefined) {
    if (!isRecord(properties)) return `${path}.properties must be an object`;
    for (const [name, child] of Object.entries(properties)) {
      const problem = unsupportedSchema(child, `${path}.properties.${name}`);
      if (problem !== null) return problem;
    }
  }
  return items === undefined ? null : unsupportedSchema(items, `${path}.items`);
}

/** The JSON Schema type of a value; undefined for anything JSON cannot hold, such as Infinity. */
function typeOf(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  if (Number.isFinite(value)) return 'number';
  return typeof value === 'number' ? undefined : typeof value;
}

const matchesType = (actual: string | undefined, wanted: SchemaType) => actual === wanted || (wanted === 'number' && actual === 'integer');

/** Length as JSON Schema counts it: in code points, not UTF-16 units. */
const codePoints = (text: string) => [...text].length;

/**
 * The first way `value` breaks `schema`, or null when it conforms. `schema`
 * must be supported (see unsupportedSchema). As in JSON Schema, a keyword
 * constrains only values of the type it is about.
 */
export function schemaViolation(schema: Schema, value: unknown, path = '$'): string | null {
  const actual = typeOf(value);
  const type = schema['type'] as SchemaType | undefined;
  if (type !== undefined && !matchesType(actual, type)) return `${path} must be ${type === 'integer' || type === 'array' || type === 'object' ? 'an' : 'a'} ${type}`;
  const allowed = schema['enum'] as readonly JsonPrimitive[] | undefined;
  if (allowed !== undefined && !allowed.includes(value as JsonPrimitive)) return `${path} must be one of ${JSON.stringify(allowed)}`;
  if (actual === 'string') return countViolation(schema, codePoints(value as string), path, 'Length', 'characters');
  if (actual === 'number' || actual === 'integer') {
    const n = value as number;
    const min = schema['minimum'] as number | undefined;
    const max = schema['maximum'] as number | undefined;
    if (n < (min ?? -Infinity)) return `${path} must be at least ${min}`;
    if (n > (max ?? Infinity)) return `${path} must be at most ${max}`;
    return null;
  }
  if (actual === 'array') {
    const list = value as readonly unknown[];
    const problem = countViolation(schema, list.length, path, 'Items', 'items');
    if (problem !== null) return problem;
    const items = schema['items'] as Schema | undefined;
    if (items === undefined) return null;
    for (const [i, item] of list.entries()) {
      const itemProblem = schemaViolation(items, item, `${path}[${i}]`);
      if (itemProblem !== null) return itemProblem;
    }
    return null;
  }
  if (actual === 'object') return objectViolation(schema, value as Readonly<Record<string, unknown>>, path);
  return null;
}

function countViolation(schema: Schema, n: number, path: string, suffix: 'Length' | 'Items', unit: string): string | null {
  const min = schema[`min${suffix}`] as number | undefined;
  const max = schema[`max${suffix}`] as number | undefined;
  if (n < (min ?? 0)) return `${path} must have at least ${min} ${unit}`;
  if (n > (max ?? Infinity)) return `${path} must have at most ${max} ${unit}`;
  return null;
}

function objectViolation(schema: Schema, value: Readonly<Record<string, unknown>>, path: string): string | null {
  const properties = (schema['properties'] ?? {}) as Readonly<Record<string, Schema>>;
  for (const name of (schema['required'] ?? []) as readonly string[]) {
    if (!Object.hasOwn(value, name)) return `${path}.${name} is required`;
  }
  for (const [name, child] of Object.entries(value)) {
    if (Object.hasOwn(properties, name)) {
      const problem = schemaViolation(properties[name] as Schema, child, `${path}.${name}`);
      if (problem !== null) return problem;
    } else if (schema['additionalProperties'] === false) {
      return `${path}.${name} is not allowed`;
    }
  }
  return null;
}
