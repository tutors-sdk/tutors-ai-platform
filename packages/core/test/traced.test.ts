import { RecordingTelemetry } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { PortError, traced } from '../src/index.ts';

describe('traced', () => {
  it('AS-018 runs a call in a child span and returns its result', async () => {
    const telemetry = new RecordingTelemetry();
    const parent = telemetry.startSpan('AssistStudent');
    expect(await traced(telemetry, parent, 'LearnerMemory.recall', async () => 42)).toBe(42);
    const [root, child] = telemetry.spans;
    expect(child).toEqual({ name: 'LearnerMemory.recall', attributes: {}, parent: root, outcome: 'ok' });
  });

  it('AS-018 ends the span with error and keeps the port error kind', async () => {
    const telemetry = new RecordingTelemetry();
    const parent = telemetry.startSpan('AssistStudent');
    await expect(
      traced(telemetry, parent, 'LanguageModel.complete', () => Promise.reject(new PortError('LanguageModel', 'timeout', 'slow'))),
    ).rejects.toThrow('slow');
    expect(telemetry.spans[1]).toMatchObject({ outcome: 'error', attributes: { 'port.error': 'timeout' } });
  });

  it('AS-018 ends the span with error and no port error kind for any other failure', async () => {
    const telemetry = new RecordingTelemetry();
    const parent = telemetry.startSpan('AssistStudent');
    await expect(traced(telemetry, parent, 'EvidenceStore.append', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(telemetry.spans[1]?.outcome).toBe('error');
    expect(Object.keys(telemetry.spans[1]?.attributes ?? { missing: true })).toEqual([]);
  });
});
