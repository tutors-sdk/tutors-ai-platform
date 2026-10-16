# Only the inference API may reach the model server. Conservatively, a NetworkPolicy is taken to
# select ollama unless its podSelector pins app.kubernetes.io/name to something else, so a
# wildcard or label-set selector cannot open ollama by accident.
package main

import data.lib
import rego.v1

ollama := "ollama"

ollama_port := 11434

network_policies contains np if {
	some np in lib.docs
	np.kind == "NetworkPolicy"
}

selects_ollama(np) if lib.selected_name(np.spec.podSelector) == ollama

selects_ollama(np) if lib.selected_name(np.spec.podSelector) == ""

ingress_rules(np) := object.get(np.spec, "ingress", [])

ollama_deployed if {
	some doc in lib.docs
	doc.kind == "Deployment"
	doc.metadata.name == ollama
}

# Without a default deny, ollama is open to the whole cluster whatever else is declared.
deny contains "network: ollama is deployed but no NetworkPolicy denies all ingress by default" if {
	ollama_deployed
	not default_deny
}

default_deny if {
	some np in network_policies
	np.spec.podSelector == {}
	"Ingress" in np.spec.policyTypes
	count(ingress_rules(np)) == 0
}

# A policy that may select ollama and admits anything must name ollama explicitly...
deny contains msg if {
	some np in network_policies
	selects_ollama(np)
	count(ingress_rules(np)) > 0
	lib.selected_name(np.spec.podSelector) != ollama
	msg := sprintf("network: %s admits ingress to pods that include ollama; select a named component", [lib.name(np)])
}

# ...and admit only inference-api pods from this namespace, only on the model port.
deny contains msg if {
	some np in network_policies
	lib.selected_name(np.spec.podSelector) == ollama
	some rule in ingress_rules(np)
	not only_inference_api(rule)
	msg := sprintf("network: %s lets something other than inference-api reach ollama", [lib.name(np)])
}

deny contains msg if {
	some np in network_policies
	lib.selected_name(np.spec.podSelector) == ollama
	some rule in ingress_rules(np)
	not only_model_port(rule)
	msg := sprintf("network: %s opens ollama on a port other than %d", [lib.name(np), ollama_port])
}

only_inference_api(rule) if {
	count(object.get(rule, "from", [])) > 0
	every peer in rule.from {
		object.keys(peer) == {"podSelector"}
		peer.podSelector == {"matchLabels": {"app.kubernetes.io/name": "inference-api"}}
	}
}

only_model_port(rule) if {
	count(object.get(rule, "ports", [])) > 0
	every p in rule.ports {
		p.port == ollama_port
		object.get(p, "protocol", "TCP") == "TCP"
		not p.endPort
	}
}
