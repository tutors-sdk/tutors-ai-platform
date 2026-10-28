package main

import rego.v1

api_deployment := {"kind": "Deployment", "metadata": {"name": "inference-api"}, "spec": {"template": {"spec": {"containers": []}}}}

egress_np(name, selector, egress) := {
	"kind": "NetworkPolicy",
	"metadata": {"name": name},
	"spec": {"podSelector": selector, "policyTypes": ["Egress"], "egress": egress},
}

api_egress := egress_np("inference-api-egress", by_name("inference-api"), [
	{"to": [{"podSelector": by_name("ollama")}], "ports": [{"protocol": "TCP", "port": 11434}]},
	{"to": [{"podSelector": {"matchLabels": {"tutors-ai/tool-server": "true"}}}], "ports": [{"protocol": "TCP", "port": 8080}]},
])

tool_denials(docs) := {msg | some msg in deny with input as wrap(docs); contains(msg, "egress")}

test_limited_egress_passes if {
	count(tool_denials([api_deployment, api_egress])) == 0
}

test_unlimited_egress_denied if {
	some msg in tool_denials([api_deployment])
	contains(msg, "no NetworkPolicy limits its egress")
}

test_rule_without_peers_denied if {
	policy := egress_np("open", by_name("inference-api"), [{"ports": [{"protocol": "TCP", "port": 443}]}])
	some msg in tool_denials([api_deployment, api_egress, policy])
	contains(msg, "NetworkPolicy/open opens egress")
}

test_any_address_denied if {
	policy := egress_np("anywhere", {}, [{"to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}]}])
	some msg in tool_denials([api_deployment, api_egress, policy])
	contains(msg, "NetworkPolicy/anywhere opens egress")
}

test_every_namespace_denied if {
	policy := egress_np("all-namespaces", by_name("inference-api"), [{"to": [{"namespaceSelector": {}}]}])
	some msg in tool_denials([api_deployment, api_egress, policy])
	contains(msg, "NetworkPolicy/all-namespaces opens egress")
}

test_named_external_range_passes if {
	external := egress_np("tool-server-range", by_name("inference-api"), [{"to": [{"ipBlock": {"cidr": "203.0.113.0/24"}}], "ports": [{"protocol": "TCP", "port": 443}]}])
	count(tool_denials([api_deployment, api_egress, external])) == 0
}

test_open_egress_for_another_component_is_not_this_policys_concern if {
	other := egress_np("worker-open", by_name("insights-worker"), [{}])
	count(tool_denials([api_deployment, api_egress, other])) == 0
}

container_with_env(env) := {
	"kind": "Deployment",
	"metadata": {"name": "inference-api"},
	"spec": {"template": {"spec": {"containers": [{"name": "inference-api", "env": env}]}}},
}

token_denials(docs) := {msg | some msg in deny with input as wrap(docs); startswith(msg, "secrets:")}

test_token_from_secret_passes if {
	count(token_denials([container_with_env([{"name": "MCP_TOKEN_GLOSSARY", "valueFrom": {"secretKeyRef": {"name": "tool-server-tokens", "key": "MCP_TOKEN_GLOSSARY"}}}])])) == 0
}

test_literal_token_denied if {
	some msg in token_denials([container_with_env([{"name": "MCP_TOKEN_GLOSSARY", "value": "s3cret"}])])
	contains(msg, "MCP_TOKEN_GLOSSARY in container inference-api of Deployment/inference-api must come from a Secret")
}

test_token_from_config_map_denied if {
	some msg in token_denials([container_with_env([{"name": "MCP_TOKEN_GLOSSARY", "valueFrom": {"configMapKeyRef": {"name": "x", "key": "y"}}}])])
	contains(msg, "must come from a Secret")
}
