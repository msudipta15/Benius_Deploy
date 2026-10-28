---
name: Forward-only academic session activation
description: BENIUS policy for normal session activation and handling historical-session recovery.
---

Normal activation may advance only to the immediate next chronological Draft session for that school. Determine order from stored start dates, require valid non-overlapping date ranges and a unique timeline, and never use session names to infer order. The first activation is allowed only when the sole session is the Draft being activated. Historical-session recovery must remain a separate, explicitly controlled process.

**Why:** The owner required archived academic data to remain protected from accidental reactivation, skipped sessions, and ambiguity in date chronology while preserving first-session setup.

**How to apply:** Enforce the rule in both the Web affordance and the authoritative server transaction; keep school scope, enrollment preflight, atomic Registry synchronization, and historical records intact. Serialize session creation with activation so concurrent new sessions cannot invalidate the chosen next session.
