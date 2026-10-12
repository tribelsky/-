# ALUMA-TAG Care Seal v0.2 | Post-repair service marker

**Product idea:** after a customer application passes a bounded repair and
independent tests, Transformix gives it a digitally signed **care seal**.
If an already-authorized build/health event later shows deviation, the
tag can produce a *small signed signal* that references the last certified
baseline and roughly locates the affected subsystem. Beam then requests
more information or proposes a response, but cannot automatically intervene.

This is a **treatment receipt plus future call-back**, not a resident scanning
agent and not a promise that a complex app can never fail.

## Four stages

1. **Verified repair / seal issuance:** a separate verifier marks a particular
   repository revision, evidence SHA256, number of passing tests, and a set of
   category fingerprints. A signing key controlled by the service signs the
   receipt. A damaged/failed/unapproved repair is denied a seal.
2. **Consent-based later event:** an existing authorized host CI hook calls
   `CareSealMonitor.inspect(snapshot)`. It has no filesystem access or timer.
   "consistent" means this *limited* supplied snapshot matches the previous
   test baseline, not a complete runtime security or health attestation.
3. **Small signal:** when a check fails, the tag emits only an authenticated
   incident reference, type (`fault`, `drift`, `unknown`), coarse
   subsystem (`runtime`, `dependencies`, `data`, `integrations`,
   `workflow`, `revision`), timestamp and count of failing checks.
   The tag does not send source code, paths, database content or users.
4. **Beam return / decision:** an independently approved receiver checks
   signing key, current care-seal ID, event age and replay, then selects
   `request_authorized_diagnosis`, `review_change_and_run_prevention_tests`,
   or `request_fresh_status`. These are only decisions, **not commands**.
   The existing ALUMA-TAG status challenge can fetch a bounded later reply
   when a host-authorized path exists.

## What v0.2 does not have

- No automatic integration with the ten public GitHub applications, and no
  change in their repositories.
- No background listener, transport, periodic polling, remote code execution,
  automatic repair, production incident dashboard or live subscription billing.
- No complete end-to-end verification of a real customer app.
- Demo accepts an issuer-signed verifier assertion and synthetic hashes; a
  production system needs independently stored immutable evidence, scoped
  trust and certificate revocation/rotation.
- In-memory replay cache is not enough for production. Persist it. A real
  receiving endpoint also needs TLS, authenticated identity per customer,
  event delivery acknowledgments/retries, quotas and retention controls.
- `drift` does **not** mean failure. A missing/late message means
  "unknown", not proof of a down system.
- A digitally signed care receipt is **not a legal warranty** or a blanket
  guarantee. Service terms and coverage must be separately defined.

## Local evidence

```sh
python3 -m unittest discover -s aluma-tag/tests -v
python3 aluma-tag/care_seal_demo.py
```

The tests include unauthorized issuance, tampering, wrong app, no consent,
baseline pass, later failure, revision/dependency drift, missing data,
bounded diagnosis, authenticated reply, expiry/replay and privacy exclusions.
GitHub Actions runs in our own branch only.

## Integration plan

First connect a marker with an existing CI hook in a repository owned by
Transformix. After proving signal delivery, receiver authentication,
deduplication and business-value alerts, invite another project's owner to
install a tiny hook **with explicit opt-in**. Signed certificate remains tied
to each independently verified repair/version, not to an eternal "OK" label.
