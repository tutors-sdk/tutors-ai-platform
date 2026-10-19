// Negative fixture for the suite-health lint: one violation of each rule, on known lines.
import { describe, it, test, vi } from 'vitest';

describe.only('focused suite', () => {}); // line 4: focused
it.skip('skipped test', () => {}); // line 5: skipped
test.todo('a test for later'); // line 6: skipped
it.fails('passes by failing', () => {}); // line 7: expected-failure
describe.skipIf(true)('skipped in a unit test', () => {}); // line 8: conditional-skip
vi.useFakeTimers(); // line 9: unrestored-timers
vi.spyOn(console, 'error'); // line 10: unrestored-console
