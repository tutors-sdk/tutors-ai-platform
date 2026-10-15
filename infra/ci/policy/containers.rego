# Every container is bounded and unprivileged, and runs an image someone chose on purpose.
package main

import data.lib
import rego.v1

deny contains msg if {
	some item in lib.containers
	some resource in ["cpu", "memory"]
	not item.container.resources.limits[resource]
	msg := sprintf("limits: container %s in %s has no %s limit", [item.container.name, lib.name(item.doc), resource])
}

deny contains msg if {
	some item in lib.containers
	not runs_as_non_root(item)
	msg := sprintf("security: container %s in %s must set runAsNonRoot: true", [item.container.name, lib.name(item.doc)])
}

deny contains msg if {
	some item in lib.containers
	object.get(item.container, ["securityContext", "allowPrivilegeEscalation"], true) != false
	msg := sprintf("security: container %s in %s must set allowPrivilegeEscalation: false", [item.container.name, lib.name(item.doc)])
}

deny contains msg if {
	some item in lib.containers
	not pinned_image(item.container.image)
	msg := sprintf("image: container %s in %s uses %s; name a tag other than latest, or a digest", [item.container.name, lib.name(item.doc), item.container.image])
}

# The container's own setting wins; otherwise the pod's applies.
runs_as_non_root(item) if item.container.securityContext.runAsNonRoot == true

runs_as_non_root(item) if {
	not has_container_setting(item.container)
	item.pod.securityContext.runAsNonRoot == true
}

has_container_setting(container) if "runAsNonRoot" in object.keys(object.get(container, "securityContext", {}))

pinned_image(image) if contains(image, "@sha256:")

pinned_image(image) if {
	not contains(image, "@")
	tag := image_tag(image)
	tag != "latest"
}

# The tag is whatever follows ':' in the last path segment, so registry ports are not tags.
image_tag(image) := tag if {
	segments := split(image, "/")
	last := segments[count(segments) - 1]
	parts := split(last, ":")
	count(parts) == 2
	tag := parts[1]
	tag != ""
}
