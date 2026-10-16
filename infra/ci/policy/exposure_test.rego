package main

import rego.v1

wrap(docs) := [{"path": "test.yaml", "contents": docs}]

test_route_denied if {
	some msg in deny with input as wrap([{"kind": "Route", "metadata": {"name": "api"}}])
	startswith(msg, "exposure:")
}

test_ingress_denied if {
	some msg in deny with input as wrap([{"kind": "Ingress", "metadata": {"name": "api"}}])
	startswith(msg, "exposure:")
}

test_load_balancer_service_denied if {
	svc := {"kind": "Service", "metadata": {"name": "api"}, "spec": {"type": "LoadBalancer"}}
	some msg in deny with input as wrap([svc])
	contains(msg, "only ClusterIP")
}

test_cluster_ip_service_allowed if {
	svc := {"kind": "Service", "metadata": {"name": "api"}, "spec": {"ports": [{"port": 8080}]}}
	count(deny) == 0 with input as wrap([svc])
}
