---
id: IS
port: InsightStore
kind: driven
status: implemented
---

# InsightStore

Where runs of the insights worker are kept for lecturers to read.

- **IS-001** When a run is saved, the InsightStore adapter shall return it as the latest run for its course, with its insights and recommendations unchanged.
- **IS-002** The InsightStore adapter shall return the most recently produced run for a course, and null for a course with no runs.
- **IS-003** The InsightStore adapter shall keep the runs of each course separate.
