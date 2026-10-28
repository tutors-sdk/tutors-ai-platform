# Tools (ADR 0008). The inference API is the only component that reaches tool servers, so its
# egress is limited to what it uses: DNS, the components it calls, and pods labelled as tool
# servers (or, in an overlay, a named external range). Nothing may open its egress to everywhere,
# and a tool server's token comes from a Secret, never from the manifest.
package main

import data.lib
import rego.v1

inference_api := "inference-api"

inference_api_deployed if {
	some doc in lib.docs
	doc.kind == "Deployment"
	doc.metadata.name == inference_api
}

egress_policy(np) if "Egress" in object.get(np.spec, "policyTypes", [])

egress_rules(np) := object.get(np.spec, "egress", [])

# Conservatively, a policy selects the API unless its podSelector names something else.
may_select_inference_api(np) if lib.selected_name(np.spec.podSelector) in {inference_api, ""}

inference_api_egress_limited if {
	some np in network_policies
	egress_policy(np)
	lib.selected_name(np.spec.podSelector) == inference_api
}

deny contains "network: inference-api is deployed but no NetworkPolicy limits its egress" if {
	inference_api_deployed
	not inference_api_egress_limited
}

deny contains msg if {
	some np in network_policies
	egress_policy(np)
	may_select_inference_api(np)
	some rule in egress_rules(np)
	open_rule(rule)
	msg := sprintf("network: %s opens egress from pods that include inference-api to everywhere; name the peers", [lib.name(np)])
}

# A rule with no peers allows every destination.
open_rule(rule) if count(object.get(rule, "to", [])) == 0

open_rule(rule) if {
	some peer in rule.to
	peer.ipBlock.cidr in {"0.0.0.0/0", "::/0"}
}

# Every pod in every namespace.
open_rule(rule) if {
	some peer in rule.to
	peer.namespaceSelector == {}
	object.get(peer, "podSelector", {}) == {}
}

deny contains msg if {
	some item in lib.containers
	some env in object.get(item.container, "env", [])
	startswith(env.name, "MCP_TOKEN_")
	not env.valueFrom.secretKeyRef
	msg := sprintf("secrets: %s in container %s of %s must come from a Secret", [env.name, item.container.name, lib.name(item.doc)])
}
