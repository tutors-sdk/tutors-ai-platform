# Production serves only weights named by digest (ADR 0003). Its own package, so check.sh can
# tell "production is not pinned yet" apart from every other failure (--expect-unpinned).
package pin

import data.lib
import rego.v1

production := "tutors-ai-production"

deny contains msg if {
	some doc in lib.docs
	doc.kind == "ConfigMap"
	doc.metadata.name == "model-pin"
	object.get(doc.metadata, "namespace", "") == production
	digest := object.get(doc.data, "OLLAMA_DIGEST", "")
	not regex.match(`^sha256:[0-9a-f]{64}$`, digest)
	msg := sprintf("model-pin: production OLLAMA_DIGEST is %q; run infra/openshift/pin-model.sh and commit the digest", [digest])
}

deny contains "model-pin: production has no model-pin ConfigMap" if {
	some doc in lib.docs
	doc.kind == "Namespace"
	doc.metadata.name == production
	not production_pin_present
}

production_pin_present if {
	some doc in lib.docs
	doc.kind == "ConfigMap"
	doc.metadata.name == "model-pin"
	object.get(doc.metadata, "namespace", "") == production
}
