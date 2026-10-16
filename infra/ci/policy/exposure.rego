# Authentication is deferred (ADR 0005), so nothing may be exposed outside the cluster: no Route,
# no Ingress, and Services are ClusterIP only.
package main

import data.lib
import rego.v1

deny contains msg if {
	some doc in lib.docs
	doc.kind in {"Route", "Ingress"}
	msg := sprintf("exposure: %s is not allowed; authentication is deferred (ADR 0005)", [lib.name(doc)])
}

deny contains msg if {
	some doc in lib.docs
	doc.kind == "Service"
	type := object.get(doc.spec, "type", "ClusterIP")
	type != "ClusterIP"
	msg := sprintf("exposure: %s has type %s; only ClusterIP is allowed", [lib.name(doc), type])
}
