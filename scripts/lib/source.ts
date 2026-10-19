/** Shared by the source lints: finding files, and reading code without its comments and strings. */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

export function walk(dir: string, keep: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist' || name === 'fixtures' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? walk(path, keep) : keep(path) ? [path] : [];
  });
}

export const rel = (path: string) => relative(ROOT, path);

const REGEX_CAN_FOLLOW = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);

/**
 * Blanks out comments, string and template literals and regex literals,
 * keeping every newline, so a pattern matched on the result finds only code
 * and reports the right line.
 */
export function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  let previous = '';
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    let end = -1;
    if (ch === '/' && next === '/') end = source.indexOf('\n', i) === -1 ? source.length : source.indexOf('\n', i);
    else if (ch === '/' && next === '*') end = source.indexOf('*/', i + 2) === -1 ? source.length : source.indexOf('*/', i + 2) + 2;
    else if (ch === "'" || ch === '"' || ch === '`') {
      end = i + 1;
      while (end < source.length && source[end] !== ch) end += source[end] === '\\' ? 2 : 1;
      end += 1;
    } else if (ch === '/' && (REGEX_CAN_FOLLOW.has(previous) || /(return|typeof|in|of)$/.test(out.trimEnd()))) {
      end = i + 1;
      let inClass = false;
      while (end < source.length && source[end] !== '\n' && (inClass || source[end] !== '/')) {
        if (source[end] === '\\') end += 1;
        else if (source[end] === '[') inClass = true;
        else if (source[end] === ']') inClass = false;
        end += 1;
      }
      end += 1;
      while (/[a-z]/.test(source[end] ?? '')) end += 1;
    }
    if (end > i) {
      out += ch === '/' && next === '/' ? blank(source.slice(i, end)) : ch + blank(source.slice(i + 1, end - 1)) + (end - 1 > i ? source[end - 1] : '');
      previous = 'x';
      i = end;
      continue;
    }
    out += ch;
    if (!/\s/.test(ch)) previous = ch;
    i += 1;
  }
  return out;
}

/** 1-based line of an offset. */
export const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length;
