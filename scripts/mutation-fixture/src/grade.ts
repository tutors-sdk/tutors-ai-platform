/** The known-weak fixture for the mutation gate: real logic, deliberately under-tested. */
export function grade(score: number): 'fail' | 'pass' | 'distinction' {
  if (score >= 70) return 'distinction';
  if (score >= 40) return 'pass';
  return 'fail';
}
