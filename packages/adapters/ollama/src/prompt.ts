import type { AssistanceDepth, CompletionRequest } from '@tutors-ai/core';

/**
 * The prompt template is adapter-owned and versioned: a change to anything in
 * this file is a prompt change and needs an evaluation run (see the README).
 */
export const PROMPT_VERSION = 'ollama-assist-0.1.0';

const DEPTH_MEANING: Record<AssistanceDepth, string> = {
  redirect: 'point the student back to the relevant part of the lab material without explaining anything',
  hint: 'give a short nudge that helps the student find the answer themselves, without stating the answer or writing code that solves it',
  explanation: 'give a worked explanation of the concept, pitched at the student, using only the material',
};

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * The JSON schema the model must answer in. Property order matters: `text`
 * comes last so it can be streamed to the student as it is generated.
 */
export function responseSchema(maxDepth: AssistanceDepth) {
  const allowed = (['redirect', 'hint', 'explanation'] as const).slice(
    0,
    ['redirect', 'hint', 'explanation'].indexOf(maxDepth) + 1,
  );
  return {
    type: 'object',
    properties: {
      depth: { type: 'string', enum: allowed },
      citations: { type: 'array', items: { type: 'string' } },
      text: { type: 'string' },
    },
    required: ['depth', 'citations', 'text'],
  } as const;
}

export function buildMessages(request: CompletionRequest): ChatMessage[] {
  const { bound, material, memory, question } = request;
  const allowed = (['redirect', 'hint', 'explanation'] as const).filter(
    (d) => ['redirect', 'hint', 'explanation'].indexOf(d) <= ['redirect', 'hint', 'explanation'].indexOf(bound.maxDepth),
  );
  const system = [
    'You are a teaching assistant inside a programming course.',
    'Use ONLY the course material provided below. If it does not cover the question, redirect the student to the closest material.',
    `You may answer at these depths: ${allowed.map((d) => `"${d}" (${DEPTH_MEANING[d]})`).join('; ')}.`,
    `Never go beyond "${bound.maxDepth}".`,
    `Keep "text" under ${bound.maxResponseChars} characters.`,
    'Cite the ids of the material you relied on in "citations"; cite at least one, and only ids listed below.',
    'Reply as JSON with "depth", "citations" and "text".',
    '',
    'Course material:',
    ...material.map((m) => `[${m.id}] ${m.title}\n${m.text}`),
  ].join('\n');

  return [
    { role: 'system', content: system },
    ...memory.flatMap((m): ChatMessage[] => [
      { role: 'user', content: m.question },
      { role: 'assistant', content: JSON.stringify({ text: m.answer }) },
    ]),
    { role: 'user', content: question },
  ];
}
