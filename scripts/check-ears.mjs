#!/usr/bin/env node
// The EARS gate. Fails when a port has no specification, a requirement is not
// in an EARS pattern, or an implemented requirement is not traced to a test.
// See packages/core/spec/README.md.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const core = join(root, 'packages/core');
const failures = [];
const fail = (msg) => failures.push(msg);

const PATTERNS = [
  /^The .+ shall .+\.$/,
  /^When .+, the .+ shall .+\.$/,
  /^While .+, the .+ shall .+\.$/,
  /^If .+, then the .+ shall .+\.$/,
  /^Where .+, the .+ shall .+\.$/,
];

function walk(dir, keep) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? walk(path, keep) : keep(path) ? [path] : [];
  });
}

function parseSpec(path) {
  const text = readFileSync(path, 'utf8');
  const front = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!front) {
    fail(`${relative(root, path)}: missing front matter`);
    return null;
  }
  const meta = Object.fromEntries(
    front[1].split('\n').map((line) => line.split(/:\s*/, 2)).filter((kv) => kv.length === 2),
  );
  const requirements = [...text.matchAll(/^- \*\*([A-Z]+-\d{3})\*\* (.+)$/gm)].map(([, id, statement]) => ({ id, statement }));
  return { path, meta, requirements };
}

// 1. Coverage: one spec per port file.
const specs = new Map();
for (const kind of ['driving', 'driven']) {
  for (const port of walk(join(core, 'src/ports', kind), (p) => p.endsWith('.ts'))) {
    const name = basename(port, '.ts');
    const specPath = join(core, 'spec', kind, `${name}.ears.md`);
    if (!existsSync(specPath)) {
      fail(`${relative(root, port)}: no EARS specification at ${relative(root, specPath)}`);
      continue;
    }
    const spec = parseSpec(specPath);
    if (spec) specs.set(specPath, spec);
  }
}

// 2. Form.
const seen = new Map();
for (const { path, meta, requirements } of specs.values()) {
  const where = relative(root, path);
  for (const key of ['id', 'port', 'kind', 'status']) if (!meta[key]) fail(`${where}: front matter lacks "${key}"`);
  if (!['implemented', 'planned'].includes(meta.status)) fail(`${where}: status must be implemented or planned`);
  if (requirements.length === 0) fail(`${where}: no requirements`);
  for (const { id, statement } of requirements) {
    if (!id.startsWith(`${meta.id}-`)) fail(`${where}: ${id} does not use the spec prefix ${meta.id}-`);
    if (seen.has(id)) fail(`${where}: ${id} is also defined in ${seen.get(id)}`);
    seen.set(id, where);
    if (!PATTERNS.some((p) => p.test(statement))) fail(`${where}: ${id} is not in an EARS pattern: "${statement}"`);
    if (!statement.includes(' shall ')) fail(`${where}: ${id} has no "shall"`);
  }
}

// 3. Traceability for implemented specs.
const testSources = [
  ...walk(join(root, 'packages'), (p) => p.endsWith('.test.ts')),
  ...walk(join(root, 'packages/testing/src/kits'), (p) => p.endsWith('.ts')),
].map((p) => readFileSync(p, 'utf8'));
const testNames = testSources.flatMap((src) => [...src.matchAll(/\bit\(\s*(['"`])(.+?)\1/g)].map((m) => m[2]));
let traced = 0;
let total = 0;
for (const { path, meta, requirements } of specs.values()) {
  if (meta.status !== 'implemented') continue;
  for (const { id } of requirements) {
    total += 1;
    const re = new RegExp(`(^|\\s)${id}(\\s|$)`);
    if (testNames.some((name) => re.test(name))) traced += 1;
    else fail(`${relative(root, path)}: ${id} is not traced to any test name`);
  }
}

const portCount = specs.size;
if (failures.length > 0) {
  console.error(`EARS gate failed (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`EARS gate passed: ${portCount} ports specified, ${seen.size} requirements, ${traced}/${total} implemented requirements traced to tests.`);
