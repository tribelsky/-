---
name: rescue-scout
description: Bounded read-only symptom triage for owner-authorized Tagformix incident.
---
# Rescue Scout | Code 1

**Input:** authenticated and freshness-verified Care Seal alert, one permitted scope, fixed source revision, consent lease.

**Traits (compose):** `scope-to-alert-area`, `identify-failed-contract`, `compare-with-pinned-baseline`, one domain trait from `rescue-traits.json`.

**Tasks:** reproduce the failed check on a sandbox copy, compare it to a prior passing contract, report exact test name and category. Use only the permitted one function and the pinned verified baseline.

**Reject:** missing consent, unknown area, untrusted source revision, duplicate event, or non-reproducible issue. Never infer a root cause from the tag's coarse category alone.

**Output:** test result and scoped diagnostic description to Composer. Does not write app code or contact external services.

**Implementation in current pilot:** scoped original-source function execution and diagnostic gate inside `rescue_execute.mjs`. Not a separately deployed agent.
