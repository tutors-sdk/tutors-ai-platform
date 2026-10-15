package pin

import rego.v1

wrap(docs) := [{"path": "test.yaml", "contents": docs}]

pin(namespace, digest) := {
	"kind": "ConfigMap",
	"metadata": {"name": "model-pin", "namespace": namespace},
	"data": {"OLLAMA_MODEL": "qwen3.8:27b", "OLLAMA_DIGEST": digest},
}

real_digest := "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

test_unpinned_production_denied if {
	some msg in deny with input as wrap([pin("tutors-ai-production", "sha256:UNPINNED")])
	contains(msg, "UNPINNED")
}

test_short_digest_denied if {
	count(deny) == 1 with input as wrap([pin("tutors-ai-production", "sha256:abc123")])
}

test_pinned_production_passes if {
	count(deny) == 0 with input as wrap([pin("tutors-ai-production", real_digest)])
}

test_unpinned_staging_allowed if {
	count(deny) == 0 with input as wrap([pin("tutors-ai-staging", "sha256:UNPINNED")])
}

test_production_without_pin_denied if {
	ns := {"kind": "Namespace", "metadata": {"name": "tutors-ai-production"}}
	some msg in deny with input as wrap([ns])
	contains(msg, "no model-pin")
}
