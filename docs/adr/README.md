# Architecture decision records

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-repository-split.md) | The AI platform is a separate repository from tutors-mono-repo | Accepted |
| [0002](0002-integration-contract-package.md) | The repositories couple only through a versioned contract package | Accepted; contract lives in this repository |
| [0003](0003-ollama-first-language-model-adapter.md) | Ollama is the first LanguageModel adapter, never the only one | Accepted |
| [0004](0004-memory-scope-model.md) | Agent memory is a typed scope selected with the capability level | Accepted |
| [0005](0005-first-release-scope.md) | First model candidate, insights in the first release, auth and release gate deferred | Accepted |
| [0006](0006-governed-memory-through-memoryhub.md) | Governed memory goes through ports, with MemoryHub as the first adapter | Accepted |

New ADRs copy the shape of these: context, decision, consequences. Number them in order.
