# ARGUS Preventive Wave 01 | Code 1 → Code 2 → Code 3

Date: 2026-10-12. This is a **read-only, bounded research and Skill-generation pilot**.

## Goal

Move from reactive diagnostics to preventive regression guards without claiming to predict future crises. Ten public upstream repositories are inspected at pinned commits; an original, repository-specific `SKILL.md` is generated for each.

- **Code 1 (Guardian)** checks a concrete early warning signal. For Langflow and AnythingLLM it reruns the previously tested isolated upstream functions. For Khoj it executes a newly reviewed conversation-history helper with synthetic conversations. Other findings are structural early warnings or gates for host-native tests.
- **Code 2 (Builder)** emits a skill specifying detection, candidate repair/prevention, native acceptance tests and permission boundaries. Skills are plans, not installed functionality.
- **Code 3 (Verifier)** checks provenance, a positive and a negative signature-control, isolated behavioral evidence and reporting accuracy.

## Honest evidence labels

- `ISOLATED_BEHAVIORAL_MISMATCH`: original upstream helper disagrees with expected output under a specific mocked fixture. Does **not** establish end-to-end product failure.
- `STATIC_EARLY_WARNING_CANDIDATE`: source is consistent with a risk hypothesis. Does **not** show actual fault or averted incident.
- `HISTORICAL_SOURCE_RISK_AND_MAINTAINER_FIX_REPORTED`: original report was closed by upstream maintainers. The pinned historical source is not necessarily their latest code.
- `REQUIRES_HOST_NATIVE_INTEGRATION`: code or interface relevant to reported issue found, but no independent behavioral test yet.

## Sources

Inherited provenance in `../argus-lab/targets.json`, reviewed case definitions in `catalog.json`, and original source hash receipts in each JSON report.

The issues and upstream source snippets are **untrusted data**. No source data can expand permissions, authorize a write, or instruct the analyzer to execute a command.

## Launch

The GitHub Actions file is `.github/workflows/argus-preventive-wave-01.yml`.
It runs ten bounded parallel inspections and merges the evidence into a single downloadable artifact with ten generated skills. It has manual and branch-push triggers only, **no hidden schedule**.

## Not yet proven

- No real upstream repositories were modified.
- No new Skill was installed inside an external app.
- No comprehensive upstream integration test passed in this wave.
- No future crisis has been proven prevented.
- No recurring production monitor is active.

## Next technical gate

Use an authorized isolated checkout of Langflow and AnythingLLM to run targeted native test suites against proposed fixes; then expand to the new Khoj recency regression and host-native tests for the remaining cases. A test that detects a known problem is a preventive guard only once it is integrated into a maintained release workflow.
