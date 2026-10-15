import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { toGoldenSet } from '@tutors-ai/contract';
import { EvaluateCapabilityService, type AssistStudent, type Clock, type EvaluationReport } from '@tutors-ai/core';
import { HttpAssistStudent } from './http-assist.ts';
import { accepted, summarise } from './summary.ts';

const USAGE = `Usage: tutors-ai-eval --api <inference API URL> --golden <set.json> [--previous <report.json>] [--out <report.json>] [--max-latency-ms <n>]`;

export interface CliDeps {
  readonly assist?: (api: string) => AssistStudent;
  readonly clock?: Clock;
  readonly log?: (line: string) => void;
}

/** Runs one evaluation; resolves to the process exit code. */
export async function run(argv: readonly string[], deps: CliDeps = {}): Promise<number> {
  const log = deps.log ?? console.log;
  let args;
  try {
    args = parseArgs({
      args: [...argv],
      options: {
        api: { type: 'string' },
        golden: { type: 'string' },
        previous: { type: 'string' },
        out: { type: 'string' },
        'max-latency-ms': { type: 'string', default: '30000' },
      },
    }).values;
  } catch (error) {
    log(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const maxLatencyMs = Number(args['max-latency-ms']);
  if (args.api === undefined || args.golden === undefined || !Number.isInteger(maxLatencyMs) || maxLatencyMs <= 0) {
    log(USAGE);
    return 2;
  }
  const set = toGoldenSet(JSON.parse(await readFile(args.golden, 'utf8')));
  const previous = args.previous === undefined ? undefined : (JSON.parse(await readFile(args.previous, 'utf8')) as EvaluationReport);
  const service = new EvaluateCapabilityService({
    assist: (deps.assist ?? ((api) => new HttpAssistStudent(api)))(args.api),
    clock: deps.clock ?? { now: () => new Date() },
    config: { maxLatencyMs },
  });
  const report = await service.evaluate(set, previous);
  if (args.out !== undefined) await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`);
  log(summarise(report));
  return accepted(report) ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv.slice(2));
}
