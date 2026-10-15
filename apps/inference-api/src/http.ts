import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import {
  CONTRACT_VERSION,
  ContractViolation,
  toAssistanceRequest,
  toAssistResponse,
  toNewEvidence,
  toRetentionBoundary,
  toRetentionResponse,
} from '@tutors-ai/contract';
import { DomainRuleViolation, PortError, type ApplyRetention, type AssistStudent, type RecordEvidence } from '@tutors-ai/core';

export const MAX_BODY_BYTES = 64 * 1024;

export interface Services {
  readonly assist: AssistStudent;
  readonly evidence: RecordEvidence;
  readonly retention: ApplyRetention;
  /** Whether every dependency the request path needs answers now. */
  ready(): Promise<boolean>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(String(body['error']));
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = req.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new HttpError(415, { error: 'unsupported-media-type', expected: 'application/json' });
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, { error: 'payload-too-large', limitBytes: MAX_BODY_BYTES });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, { error: 'payload-too-large', limitBytes: MAX_BODY_BYTES });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, { error: 'invalid-json' });
  }
}

type Route = (req: IncomingMessage) => Promise<{ status: number; body: unknown }>;

/**
 * The HTTP driving adapter. There is deliberately no streaming endpoint: the
 * core validates depth, citations and length on the complete answer, so a
 * stream would show the learner text that has not been checked yet.
 */
export function createHandler(services: Services): RequestListener {
  const routes: Record<string, Partial<Record<string, Route>>> = {
    '/v0/assist': {
      POST: async (req) => ({ status: 200, body: toAssistResponse(await services.assist.assist(toAssistanceRequest(await readJson(req)))) }),
    },
    '/v0/evidence': {
      POST: async (req) => {
        const recorded = await services.evidence.record(toNewEvidence(await readJson(req)));
        return { status: 201, body: { contractVersion: CONTRACT_VERSION, sequence: recorded.sequence, recordedAt: recorded.recordedAt.toISOString() } };
      },
    },
    '/v0/retention': {
      POST: async (req) => ({ status: 200, body: toRetentionResponse(await services.retention.apply(toRetentionBoundary(await readJson(req)))) }),
    },
    '/healthz': { GET: async () => ({ status: 200, body: { status: 'ok' } }) },
    '/readyz': {
      GET: async () => ((await services.ready().catch(() => false)) ? { status: 200, body: { status: 'ready' } } : { status: 503, body: { status: 'not-ready' } }),
    },
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const methods = routes[path];
    const handle = async () => {
      if (methods === undefined) throw new HttpError(404, { error: 'not-found' });
      const route = methods[req.method ?? 'GET'];
      if (route === undefined) throw new HttpError(405, { error: 'method-not-allowed' }, { allow: Object.keys(methods).join(', ') });
      return route(req);
    };
    handle()
      .then(({ status, body }) => send(res, status, body))
      .catch((error: unknown) => {
        const { status, body, headers } = toHttpError(error);
        send(res, status, body, headers);
      });
  };
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof ContractViolation) return new HttpError(400, { error: 'contract-violation', contractVersion: CONTRACT_VERSION, issues: error.issues });
  if (error instanceof DomainRuleViolation) return new HttpError(400, { error: 'domain-rule-violation', rule: error.rule, message: error.message });
  if (PortError.is(error)) return new HttpError(503, { error: 'dependency-unavailable', port: error.port });
  return new HttpError(500, { error: 'internal' });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Readonly<Record<string, string>> = {}): void {
  if (res.headersSent) return void res.end();
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}
