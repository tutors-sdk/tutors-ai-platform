#!/usr/bin/env node
// Enforces the dependency direction of the hexagon (see docs/adr/0001 and the
// README). Production source under each package's src/ is checked; tests may
// import test tooling freely.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);

const WORKSPACE = /^@tutors-ai\//;
const isAdapter = (s) => /^@tutors-ai\/adapter-/.test(s);
const isApp = (s) => /^@tutors-ai\/app-/.test(s);

/** Each rule says, for an import specifier from that layer's src/, why it is forbidden (or null). */
const LAYERS = [
  {
    dir: 'packages/core',
    forbid: (s) =>
      s.startsWith('.') ? null : 'core imports nothing outside itself: no packages, no Node built-ins, no workspace packages',
  },
  {
    dir: 'packages/contract',
    forbid: (s) =>
      isAdapter(s) || isApp(s) || s === '@tutors-ai/testing' || s === '@tutors-ai/evaluation'
        ? 'contract may import core types and its own libraries only'
        : null,
  },
  {
    dir: 'packages/testing',
    forbid: (s) =>
      WORKSPACE.test(s) && s !== '@tutors-ai/core' ? 'testing may import core only; fakes are written against ports' : null,
  },
  {
    dir: 'packages/evaluation',
    forbid: (s) => (isAdapter(s) || isApp(s) ? 'evaluation reaches adapters only through the composition root' : null),
  },
  {
    dir: 'packages/adapters',
    perPackage: true,
    forbid: (s) =>
      WORKSPACE.test(s) && s !== '@tutors-ai/core'
        ? 'an adapter may import core ports and its own client library only'
        : null,
  },
  {
    dir: 'apps',
    perPackage: true,
    forbid: () => null,
  },
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

const IMPORT = /(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\W)import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function packagesOf(layer) {
  const base = join(root, layer.dir);
  if (!existsSync(base)) return [];
  if (!layer.perPackage) return [base];
  return readdirSync(base)
    .map((name) => join(base, name))
    .filter((p) => statSync(p).isDirectory());
}

const failures = [];
let files = 0;
for (const layer of LAYERS) {
  for (const pkg of packagesOf(layer)) {
    for (const file of walk(join(pkg, 'src'))) {
      files += 1;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT)) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (spec === undefined) continue;
        const where = relative(root, file);
        if (spec.startsWith('.')) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(pkg + '/')) failures.push(`${where}: "${spec}" reaches outside its package; import the package by name`);
          if (target.startsWith(join(root, 'infra'))) failures.push(`${where}: "${spec}" imports infra`);
          continue;
        }
        const reason = layer.forbid(spec);
        if (reason) failures.push(`${where}: "${spec}" is forbidden (${reason})`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Dependency boundaries violated (${failures.length}):\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`Dependency boundaries hold across ${files} source files.`);
