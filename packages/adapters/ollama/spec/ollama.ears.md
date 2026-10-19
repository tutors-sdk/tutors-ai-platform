---
id: OLL
port: LanguageModel
kind: adapter
status: implemented
---

# Ollama LanguageModel adapter

How the Ollama adapter answers each way the server, or the network in front of it, can
misbehave. The generic port behaviour is LM-001 to LM-006; these are the Ollama-specific cases.
Each requirement is exercised by the fault catalogue in `test/faults/`, which serves the fault
through a scripted transport and asserts the whole outcome.

- **OLL-001** If Ollama answers with a 5xx, 408 or 429 status, then the Ollama adapter shall fail with an `unavailable` port error naming the status and the start of the body.
- **OLL-002** If Ollama answers with any other status that is not a success, then the Ollama adapter shall fail with a `rejected` port error naming the status and the start of the body.
- **OLL-003** If the model list is not JSON, then the Ollama adapter shall fail with an `invalid-response` port error.
- **OLL-004** If a line of the chat response is not JSON, then the Ollama adapter shall fail with an `invalid-response` port error.
- **OLL-005** If the chat response carries an error line, then the Ollama adapter shall fail with an `unavailable` port error carrying Ollama's message.
- **OLL-006** If the chat response ends before Ollama's final line, then the Ollama adapter shall fail with an `unavailable` port error.
- **OLL-007** If the served model's digest differs from the pinned digest, then the Ollama adapter shall fail with a `rejected` port error without asking the model anything.
- **OLL-008** If the pinned model is not loaded, then the Ollama adapter shall fail with an `unavailable` port error.
- **OLL-009** If the model's output is not the response schema, then the Ollama adapter shall fail with an `invalid-response` port error.
- **OLL-010** The Ollama adapter shall decode the response as UTF-8 across any chunk boundary, including one inside a character.
- **OLL-011** The Ollama adapter shall ignore fields of the response it does not know.
- **OLL-012** The Ollama adapter shall decide how to read a response from its body, not its content type.
- **OLL-013** The Ollama adapter shall read a final line that has no trailing newline.
