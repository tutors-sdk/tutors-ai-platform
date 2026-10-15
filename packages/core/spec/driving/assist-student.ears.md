---
id: AS
port: AssistStudent
kind: driving
status: implemented
---

# AssistStudent

Answer a grounded question within policy. Nothing reaches a student that cannot be traced to
course material and a named policy.

- **AS-001** If the question is empty or only whitespace, then the AssistStudent use case shall refuse with reason `empty-question` without consulting policy, material, the model, memory or evidence.
- **AS-002** If no pedagogical policy exists for the learner's course and capability level, then the AssistStudent use case shall refuse with reason `no-policy`.
- **AS-003** When a policy is found, the AssistStudent use case shall bound the exchange with the policy's depth and length limits and with the narrower of the learner's memory scope and the policy's memory scope.
- **AS-004** When assisting, the AssistStudent use case shall retrieve material for the learner's course, topic and lab, keep only material from the learner's course, keep at most the policy's material limit, and refuse with reason `no-material` without calling the model if none remains.
- **AS-005** While the bound memory scope is `none`, the AssistStudent use case shall not read learner memory; otherwise it shall recall at most the configured number of entries under the bound scope.
- **AS-006** When material has been retrieved, the AssistStudent use case shall send the model the question, the material, the bound, the recalled memory and the configured timeout, and no prompt text of its own.
- **AS-007** If the model fails with a port error, including a timeout, then the AssistStudent use case shall refuse with reason `model-unavailable`; any other error shall propagate.
- **AS-008** If the model's declared depth exceeds the bound's maximum depth, then the AssistStudent use case shall refuse with reason `depth-exceeded`.
- **AS-009** If the model's answer cites no material, then the AssistStudent use case shall refuse with reason `no-citation`.
- **AS-010** If the model's answer cites material outside the retrieved set, then the AssistStudent use case shall refuse with reason `citation-outside-material`.
- **AS-011** If the answer is longer than the policy's maximum length, then the AssistStudent use case shall truncate it to that length and mark the response as truncated.
- **AS-012** The AssistStudent use case shall return a trace with every response naming the bound, the retrieved material ids, the model name and digest, and the prompt version, as far as each was known when the response was decided.
- **AS-013** When a non-empty question is answered or refused, the AssistStudent use case shall record `assistance-requested` evidence with the outcome and any refusal reason, and when it is answered shall also record `assistance-given` evidence with the depth, policy version and model digest.
- **AS-014** The AssistStudent use case shall give the evidence it records the retention of the bound memory scope, or `session` retention when the bound memory scope is `none`.
- **AS-015** When a question is answered and the bound memory scope is not `none`, the AssistStudent use case shall remember the question and the answer as returned under the bound scope.
- **AS-016** If evidence cannot be recorded, then the AssistStudent use case shall fail the request rather than return an answer it could not record.
- **AS-017** The AssistStudent use case shall emit one telemetry span per request carrying the outcome, the refusal reason or depth, the policy version, the model digest and token counts.
