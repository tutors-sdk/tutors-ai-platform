/**
 * The gate on the catalogue itself. A fault that cites a requirement that
 * does not exist, or leaves any part of its outcome open, or repeats another
 * fault's exchange, protects nothing; the self-test holds the count of such
 * faults at zero.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { GOOD_EXCHANGE } from './catalogue.ts';
import type { Fault, TargetTraits } from './types.ts';

/** The workspace root, found by walking up, so the gate also works from Stryker's sandbox. */
function workspaceRoot(from: string): string {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
  throw new Error(`no pnpm-workspace.yaml above ${from}`);
}

const root = workspaceRoot(dirname(new URL(import.meta.url).pathname));

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? specFiles(path) : name.endsWith('.ears.md') ? [path] : [];
  });
}

/** Every EARS requirement id in the repository. */
export function requirementIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of specFiles(join(root, 'packages'))) {
    for (const [, id] of readFileSync(file, 'utf8').matchAll(/^- \*\*([A-Z]+-\d{3})\*\* /gm)) ids.add(id!);
  }
  return ids;
}

const MAX_WINDOW_MS = 1_000;

/** Everything wrong with the catalogue, one line per problem. */
export function catalogueProblems(faults: readonly Fault[], targets: readonly TargetTraits[], ids = requirementIds()): string[] {
  const problems: string[] = [];
  const seenIds = new Set<string>();
  const seenExchanges: { fault: string; target: string; exchange: unknown }[] = [];
  for (const fault of faults) {
    const at = `fault "${fault.id}"`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fault.id)) problems.push(`${at}: id is not kebab-case`);
    if (seenIds.has(fault.id)) problems.push(`${at}: id is used twice`);
    seenIds.add(fault.id);
    if (!ids.has(fault.spec)) problems.push(`${at}: cites ${fault.spec}, which no EARS specification defines`);
    const applicable = targets.filter((t) => fault.appliesTo?.(t) ?? true);
    if (applicable.length === 0) problems.push(`${at}: applies to no target`);
    for (const target of applicable) {
      const where = `${at} on "${target.name}"`;
      const exchange = fault.exchange({ target });
      if (isDeepStrictEqual(exchange, GOOD_EXCHANGE)) problems.push(`${where}: serves the good exchange unchanged`);
      const twin = seenExchanges.find((e) => e.target === target.name && isDeepStrictEqual(e.exchange, exchange));
      if (twin) problems.push(`${where}: serves the same exchange as "${twin.fault}"`);
      seenExchanges.push({ fault: fault.id, target: target.name, exchange });
      const outcome = fault.expected({ target });
      const settlement = outcome.settlement as Partial<{ resolves: unknown; rejects: { kind?: unknown; message?: unknown } }> | undefined;
      if (settlement === undefined || (settlement.resolves === undefined && settlement.rejects === undefined)) {
        problems.push(`${where}: states no settlement`);
      } else if (settlement.rejects !== undefined) {
        if (typeof settlement.rejects.kind !== 'string') problems.push(`${where}: names no error kind`);
        const message = settlement.rejects.message;
        if (!(message instanceof RegExp) || !message.source.startsWith('^')) problems.push(`${where}: the error message pattern is not anchored with ^`);
      }
      if (!Number.isInteger(outcome.requests) || outcome.requests < 1) problems.push(`${where}: states no request count`);
      const window = outcome.elapsedMs as { min?: unknown; max?: unknown } | undefined;
      if (typeof window?.min !== 'number' || typeof window.max !== 'number' || window.min < 0 || window.max < window.min) {
        problems.push(`${where}: states no elapsed-time window`);
      } else if (window.max - window.min > MAX_WINDOW_MS) {
        problems.push(`${where}: elapsed-time window is wider than ${MAX_WINDOW_MS}ms`);
      }
      if (!Array.isArray(outcome.events)) problems.push(`${where}: states no resilience events`);
    }
  }
  return problems;
}
