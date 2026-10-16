# Helpers shared by the policies. check.sh runs conftest with --combine, so input is a list of
# {path, contents} and contents is one document or, for a multi-document file, a list of them.
package lib

import rego.v1

docs contains doc if {
	some file in input
	is_array(file.contents)
	some doc in file.contents
	is_object(doc)
}

docs contains doc if {
	some file in input
	is_object(file.contents)
	doc := file.contents
}

name(doc) := sprintf("%s/%s", [doc.kind, doc.metadata.name])

template_kinds := {"Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job"}

pod_specs contains {"doc": doc, "spec": doc.spec.template.spec} if {
	some doc in docs
	doc.kind in template_kinds
}

pod_specs contains {"doc": doc, "spec": doc.spec.jobTemplate.spec.template.spec} if {
	some doc in docs
	doc.kind == "CronJob"
}

pod_specs contains {"doc": doc, "spec": doc.spec} if {
	some doc in docs
	doc.kind == "Pod"
}

# Every container, init containers included, with the pod spec and resource it belongs to.
containers contains {"doc": pod.doc, "pod": pod.spec, "container": c} if {
	some pod in pod_specs
	some field in ["containers", "initContainers"]
	some c in object.get(pod.spec, field, [])
}

# A pod selector names one component only when it pins app.kubernetes.io/name.
selected_name(selector) := object.get(object.get(selector, "matchLabels", {}), "app.kubernetes.io/name", "")
