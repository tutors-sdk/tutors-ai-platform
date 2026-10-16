package main

import rego.v1

good_container := {
	"name": "app",
	"image": "quay.io/tutors-sdk/app:1.2.3",
	"resources": {"limits": {"cpu": "1", "memory": "1Gi"}},
	"securityContext": {"runAsNonRoot": true, "allowPrivilegeEscalation": false},
}

deployment(container) := {
	"kind": "Deployment",
	"metadata": {"name": "app"},
	"spec": {"template": {"spec": {"containers": [container]}}},
}

cronjob(container) := {
	"kind": "CronJob",
	"metadata": {"name": "job"},
	"spec": {"jobTemplate": {"spec": {"template": {"spec": {"containers": [container]}}}}},
}

test_good_container_passes if {
	count(deny) == 0 with input as wrap([deployment(good_container), cronjob(good_container)])
}

test_missing_memory_limit_denied if {
	c := object.union(object.remove(good_container, ["resources"]), {"resources": {"limits": {"cpu": "1"}}})
	some msg in deny with input as wrap([deployment(c)])
	contains(msg, "no memory limit")
}

test_missing_limits_in_cronjob_denied if {
	c := object.remove(good_container, ["resources"])
	some msg in deny with input as wrap([cronjob(c)])
	contains(msg, "no cpu limit")
}

test_init_container_checked if {
	init := object.remove(good_container, ["resources"])
	d := {"kind": "StatefulSet", "metadata": {"name": "db"}, "spec": {"template": {"spec": {
		"containers": [good_container],
		"initContainers": [init],
	}}}}
	some msg in deny with input as wrap([d])
	startswith(msg, "limits:")
}

test_run_as_non_root_required if {
	c := object.union(object.remove(good_container, ["securityContext"]), {"securityContext": {"allowPrivilegeEscalation": false}})
	some msg in deny with input as wrap([deployment(c)])
	contains(msg, "runAsNonRoot")
}

test_pod_level_run_as_non_root_accepted if {
	c := object.union(object.remove(good_container, ["securityContext"]), {"securityContext": {"allowPrivilegeEscalation": false}})
	d := {"kind": "Deployment", "metadata": {"name": "app"}, "spec": {"template": {"spec": {
		"securityContext": {"runAsNonRoot": true},
		"containers": [c],
	}}}}
	count(deny) == 0 with input as wrap([d])
}

test_container_cannot_undo_pod_run_as_non_root if {
	c := object.union(object.remove(good_container, ["securityContext"]), {"securityContext": {"runAsNonRoot": false, "allowPrivilegeEscalation": false}})
	d := {"kind": "Deployment", "metadata": {"name": "app"}, "spec": {"template": {"spec": {
		"securityContext": {"runAsNonRoot": true},
		"containers": [c],
	}}}}
	some msg in deny with input as wrap([d])
	contains(msg, "runAsNonRoot")
}

test_privilege_escalation_must_be_disabled if {
	c := object.union(object.remove(good_container, ["securityContext"]), {"securityContext": {"runAsNonRoot": true}})
	some msg in deny with input as wrap([deployment(c)])
	contains(msg, "allowPrivilegeEscalation")
}

test_latest_tag_denied if {
	c := object.union(good_container, {"image": "quay.io/tutors-sdk/app:latest"})
	some msg in deny with input as wrap([deployment(c)])
	startswith(msg, "image:")
}

test_untagged_image_denied if {
	c := object.union(good_container, {"image": "quay.io/tutors-sdk/app"})
	some msg in deny with input as wrap([deployment(c)])
	startswith(msg, "image:")
}

test_registry_port_is_not_a_tag if {
	c := object.union(good_container, {"image": "registry.local:5000/app"})
	some msg in deny with input as wrap([deployment(c)])
	startswith(msg, "image:")
}

test_digest_image_allowed if {
	c := object.union(good_container, {"image": "quay.io/tutors-sdk/app@sha256:0123"})
	count(deny) == 0 with input as wrap([deployment(c)])
}
