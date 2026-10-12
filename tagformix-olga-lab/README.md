# Tagformix pilot on OLGA Chess | fault-type classification

**Owner-approved experiment:** use actual OLGA Chess source from
`tribelsky/-/olga-chess/game.html`, pinned at Git commit
`6177a9144e4b6c8035e0224b90810e2241f6966d`,
Git blob `e9874ebc58be579ce50aae89fa566b0dba1b6384`.

**Important:** This lab does **not** claim Olga has just been repaired, or that
we have deployed a live Tagformix marker. We create a lab-only checkpoint
after isolated functional checks, then inject breakages **in memory only**.

## Distinguishing three types of error

1. **Game history / gameplay** (`workflow`): damage the real `undoMove`
   function's move counter. The independent test demands board restoration,
   correct move-count reset and emptied history.
2. **Game-engine fallback** (`runtime`): damage the real
   `findBestMoveStockfish` fallback branch so it never returns a move.
   Independent test demands one valid UCI callback.
3. **Statistics persistence** (`data`): damage real `saveStats` behavior
   so localStorage is never written. Test demands one correct storage write.

All functions are extracted from the **original pinned source**, evaluated
in Node's VM with entirely synthetic state, and left untouched in the source
repository. In a meaningful test the clean function must pass and the
mutated function must fail while unrelated checks remain passing.

## Tagformix loop

Baseline 3/3 → issue **lab-only** certificate → healthy event yields no alert
→ isolated mutation fails → tagged report sends only a coarse area
(`workflow`, `runtime`, `data`) → local signed receiver verifies
the tag and determines `request_authorized_diagnosis`.

Category names are intentionally coarse. Detailed local check codes remain in
the tester's report and are not exported over the tag. The product team may
turn off category reporting or replace these categories by a reviewed schema
later. There is no free-form root-cause text in the transmitted signal.

## Limitations and gates

- The whole web app is not executed end-to-end in a browser.
- The marker is not installed into Olga's production HTML and did not send
  a network message. We do not monitor Olga in the background.
- Node VM is used to execute three pre-reviewed original app functions in
  isolation, not a guarantee of safety for arbitrary untrusted code.
- A real care certificate needs a **real before/after repair** and an
  independent verifier, not this synthetic test-baseline checkpoint.
- An actual receiver, authenticated consent, retention and anti-replay
  protections surviving restarts are needed for subscription service.
- A real deployment/repair is a separate owner-approved step.

Review evidence in `tagformix-olga-lab/out/` after running
`.github/workflows/tagformix-olga-source-fault-lab.yml`.
