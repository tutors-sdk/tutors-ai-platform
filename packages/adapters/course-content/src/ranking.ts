import type { Material } from '@tutors-ai/core';

// "for" and "of" are kept: in a programming course they are keywords, not filler.
const STOP = new Set(
  'the a an and or to in on is are be it this that with as at by from how why what when do does my i you your can'.split(' '),
);

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * BM25 over the candidate set. Deliberately lexical and dependency-free for
 * phase 1; an embedding ranker is a later adapter change behind the same port.
 */
export function rank(candidates: readonly Material[], query: string): Material[] {
  const q = [...new Set(tokens(query))];
  const docs = candidates.map((m) => tokens(`${m.title} ${m.title} ${m.text}`));
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  const k1 = 1.2;
  const b = 0.75;
  const scored = candidates.map((m, i) => {
    const doc = docs[i] ?? [];
    const score = q.reduce((sum, t) => {
      const f = doc.filter((x) => x === t).length;
      if (f === 0) return sum;
      const n = df.get(t) ?? 0;
      const idf = Math.log(1 + (candidates.length - n + 0.5) / (n + 0.5));
      return sum + (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / Math.max(1, avg)));
    }, 0);
    return { m, i, score };
  });
  return scored.sort((x, y) => y.score - x.score || x.i - y.i).map((s) => s.m);
}
