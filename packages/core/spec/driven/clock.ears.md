---
id: CLK
port: Clock
kind: driven
status: implemented
---

# Clock

Time, so tests can make it deterministic.

- **CLK-001** The Clock adapter shall return the current time as a new value on every call.
- **CLK-002** While under test, the Clock adapter shall return a time that changes only when the test advances it.
