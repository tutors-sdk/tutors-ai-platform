import type { RequestListener } from 'node:http';
import { describe, expect, it } from 'vitest';
import { leakVerdict, soak } from './soak.ts';

const requests = Number(process.env['SOAK_REQUESTS'] ?? 20_000);
if (!Number.isInteger(requests) || requests < 1_000) throw new Error(`SOAK_REQUESTS must be an integer of at least 1000, got "${process.env['SOAK_REQUESTS']}"`);

/** Growth the soak tolerates over the whole run: well above noise, far below a real leak. */
const MAX_GROWTH_BYTES = 4 * 1024 * 1024;

describe('heap soak', () => {
  it(`holds the heap flat over ${requests} requests and leaves no timer behind`, async () => {
    const result = await soak({ requests, concurrency: 8, samples: 40 });
    const verdict = leakVerdict(result.samples, MAX_GROWTH_BYTES);
    const mib = (b: number) => (b / 1024 / 1024).toFixed(2);
    console.log(
      `soak: ${requests} requests, statuses ${JSON.stringify(result.statuses)}, heap ${mib(result.samples[0]!.heapBytes)} → ${mib(result.samples.at(-1)!.heapBytes)} MiB, ` +
        `slope ${verdict.slopeBytesPerRequest.toFixed(1)} B/request, projected ${mib(verdict.projectedGrowthBytes)} MiB`,
    );
    expect(result.statuses[200]).toBeGreaterThan(0);
    expect(result.statuses[201]).toBeGreaterThan(0);
    expect(result.statuses[400]).toBeGreaterThan(0);
    expect(result.statuses[404]).toBeGreaterThan(0);
    expect(verdict.leaking, `projected growth ${mib(verdict.projectedGrowthBytes)} MiB exceeds ${mib(MAX_GROWTH_BYTES)} MiB`).toBe(false);
    expect(result.strayTimers).toBe(0);
  });

  it('flags a planted leak that keeps 2 KiB per request', async () => {
    const retained: Buffer[] = [];
    const leak = (handler: RequestListener): RequestListener => (req, res) => {
      retained.push(Buffer.alloc(2_048, 1));
      handler(req, res);
    };
    const result = await soak({ requests: Math.min(requests, 10_000), concurrency: 8, samples: 20, wrap: leak });
    expect(leakVerdict(result.samples, MAX_GROWTH_BYTES * (Math.min(requests, 10_000) / requests)).leaking).toBe(true);
    expect(retained.length).toBe(Math.min(requests, 10_000));
  });
});
