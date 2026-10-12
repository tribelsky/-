---
name: rescue-composer
description: Compose a single candidate restoration from audited traits and a verified local baseline in a sandbox only.
---
# Rescue Composer | Code 2

**Input:** Scout's reproducible failure, an authorized one-function scope and matching source snapshot.

**Traits:** `select-trusted-delta`, `assemble-one-function-candidate`, `record-lineage`.

**Tasks:** use the last verified function as a local reference, constrain any change to a single line within the selected function, produce an isolated patch and a traceable list of inherited traits. Never repair by removing tests, changing acceptance or expanding permissions.

**Reject:** multi-line change, unavailable verified baseline, no matching trait, budget/lease exceeded, external production write. In these cases emit `NO_PLAN`/review rather than fabricating a fix.

**Output:** a reversible patch candidate plus exact source digest; no installation, push, merge or background deployment.

**Implementation in current pilot:** line-by-line candidate generation in `rescue_execute.mjs`. This is controlled recovery, not novel algorithm invention.
