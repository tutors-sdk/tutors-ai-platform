# 0003. Ollama is the first LanguageModel adapter, never the only one

Date: 2026-10-15 · Status: Accepted

## Context

Inference must use open-weight models and open-source serving, reproducibly, on one GPU worker, and
a second institution must be able to bring its own model server.

## Decision

The `LanguageModel` port takes structured input (question, material, bound, memory, timeout) and
returns a completion with declared depth, citations, token usage, model name and digest, and prompt
version. Ollama over HTTP is the first adapter (`packages/adapters/ollama`):

- Prompt templates are adapter-owned and versioned (`PROMPT_VERSION`). A prompt change is a model
  change for the purposes of evaluation.
- Output is constrained with a JSON schema whose `depth` enum stops at the bound, and `text` comes
  last so it can be streamed to the student as generated.
- Temperature is pinned to 0 with a fixed seed.
- The composition root names the model by digest. The adapter checks the served digest against the
  pinned one and refuses to answer on a mismatch, so every response can say exactly which weights
  produced it.
- Failures surface as `PortError` (`unavailable`, `timeout`, `invalid-response`, `rejected`); the
  core turns them into a `model-unavailable` refusal.

An adapter is accepted only when it passes the port's contract kit
(`packages/testing/src/kits/language-model.ts`). The Ollama adapter runs the kit against a
wire-compatible stub on every PR and against a real CPU-servable model in the integration job.

## Consequences

- Swapping Ollama for vLLM, llama.cpp server or another stack is a new adapter plus a kit run.
- The core never sees prompt text, so prompt work cannot weaken policy enforcement: the core still
  checks depth, citations and length on every answer.
