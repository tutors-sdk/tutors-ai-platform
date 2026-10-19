// Compliant fixture: parsing a date is fine, and so are the words in comments and strings.
export const parsed = new Date('2026-10-19T00:00:00Z');
export const fromHeader = Date.parse('Sun, 19 Oct 2026 00:00:00 GMT');
// Date.now() and setTimeout( in a comment are not code.
export const text = 'Math.random() and performance.now()';
export const pattern = /Date\.now\(\)/;
export const clock = { now: () => parsed };
