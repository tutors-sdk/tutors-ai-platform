---
id: LM
port: LanguageModel
kind: driven
status: implemented
---

# LanguageModel

An open-weight model behind any serving stack. Verified by the kit in
`packages/testing/src/kits/language-model.ts`.

- **LM-001** When asked to complete, the LanguageModel adapter shall return a declared depth from the assistance depths, non-empty text, and citations as material ids.
- **LM-002** The LanguageModel adapter shall identify the model that produced each completion by name and content digest, and name the prompt template version used.
- **LM-003** The LanguageModel adapter shall account for input and output tokens as non-negative integers.
- **LM-004** When asked to stream, the LanguageModel adapter shall yield text deltas followed by exactly one final completion whose text equals the deltas joined.
- **LM-005** If the model server cannot be reached, then the LanguageModel adapter shall fail with an `unavailable` port error.
- **LM-006** If the request timeout passes before the model answers, then the LanguageModel adapter shall fail with a `timeout` port error.
