---
name: Super Admin bootstrap boundary
description: Provisioning and session boundary for BENIUS Super Admin authentication.
---

Super Admin accounts are created manually by an authorized owner in PostgreSQL using an Argon2id hash generated locally. Do not add public registration or account-creation endpoints. Super Admin authentication uses its own secure cookie/session system and must not alter Principal, Teacher, or Student authentication.

**Why:** The owner explicitly chose a manually bootstrapped, separate privileged identity to avoid public account creation and preserve existing school-user authentication.

**How to apply:** Keep account provisioning outside the public application. Apply schema changes and test activation only after explicit approval; keep Development and Production operations separate.
