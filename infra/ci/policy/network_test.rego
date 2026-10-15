package main

import rego.v1

ollama_deployment := {"kind": "Deployment", "metadata": {"name": "ollama"}, "spec": {"template": {"spec": {"containers": []}}}}

default_deny_policy := {
	"kind": "NetworkPolicy",
	"metadata": {"name": "default-deny-ingress"},
	"spec": {"podSelector": {}, "policyTypes": ["Ingress"]},
}

np(name, selector, ingress) := {
	"kind": "NetworkPolicy",
	"metadata": {"name": name},
	"spec": {"podSelector": selector, "policyTypes": ["Ingress"], "ingress": ingress},
}

by_name(n) := {"matchLabels": {"app.kubernetes.io/name": n}}

api_to_ollama := np("allow-inference-api-to-ollama", by_name("ollama"), [{
	"from": [{"podSelector": by_name("inference-api")}],
	"ports": [{"protocol": "TCP", "port": 11434}],
}])

network_denials(docs) := {msg | some msg in deny with input as wrap(docs); startswith(msg, "network:")}

test_intended_policies_pass if {
	apps_to_pg := np("allow-apps-to-postgres", by_name("postgres"), [{
		"from": [{"podSelector": by_name("inference-api")}, {"podSelector": by_name("insights-worker")}],
		"ports": [{"protocol": "TCP", "port": 5432}],
	}])
	count(network_denials([ollama_deployment, default_deny_policy, api_to_ollama, apps_to_pg])) == 0
}

test_missing_default_deny_denied if {
	some msg in network_denials([ollama_deployment, api_to_ollama])
	contains(msg, "denies all ingress")
}

test_worker_cannot_reach_ollama if {
	p := np("allow-to-ollama", by_name("ollama"), [{
		"from": [{"podSelector": by_name("inference-api")}, {"podSelector": by_name("insights-worker")}],
		"ports": [{"protocol": "TCP", "port": 11434}],
	}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "other than inference-api")
}

test_other_namespace_cannot_reach_ollama if {
	p := np("allow-to-ollama", by_name("ollama"), [{
		"from": [{"podSelector": by_name("inference-api"), "namespaceSelector": {}}],
		"ports": [{"protocol": "TCP", "port": 11434}],
	}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "other than inference-api")
}

test_allow_all_to_ollama_denied if {
	p := np("open-ollama", by_name("ollama"), [{}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "other than inference-api")
}

test_wildcard_allow_denied if {
	p := np("allow-same-namespace", {}, [{"from": [{"podSelector": {}}]}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "include ollama")
}

test_label_set_selector_denied if {
	sel := {"matchLabels": {"app.kubernetes.io/part-of": "tutors-ai-platform"}}
	p := np("allow-platform", sel, [{"from": [{"podSelector": by_name("insights-worker")}]}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "include ollama")
}

test_other_port_denied if {
	p := np("allow-inference-api-to-ollama", by_name("ollama"), [{
		"from": [{"podSelector": by_name("inference-api")}],
		"ports": [{"protocol": "TCP", "port": 22}],
	}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "port other than")
}

test_any_port_denied if {
	p := np("allow-inference-api-to-ollama", by_name("ollama"), [{"from": [{"podSelector": by_name("inference-api")}]}])
	some msg in network_denials([ollama_deployment, default_deny_policy, p])
	contains(msg, "port other than")
}
