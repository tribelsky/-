# ALUMA-TAG v0.1 — Miniature signal marker, NOT a resident probe

**Aim:** A project owner embeds a small, opt-in marker in an already trusted
application/CI path. Transformix can receive one minimal signed status event,
or ask for health information through a separately authorized host event hook.

**User's 'barcode' idea:** `marker.json` identifies a project and defines
the precise fields that may be returned. It is not a QR scanner, a daemon,
a privileged agent, or a source-code crawler.

## Two modes

- **Event**: an existing app's authorized build/test hook invokes
  `AlumaTag.signal('build_fail', at=...)`, and its own transport may deliver
  that signed event. The library itself contains no transport.
- **Question/answer**: an existing, owner-configured endpoint or scheduled CI
  receives a signed challenge, calls `AlumaTag.respond(...)` locally and may
  relay the whitelisted reply. Without an existing trigger/endpoint there is
  no response. Static barcodes alone cannot execute code or communicate.

Reply contains only: public tag ID, one-time query reference, clock,
health category, a Boolean change indicator and a count of failed checks.
Private code, paths, stack traces, account information and secrets are not read.

## Security and subscription prerequisites

- Default **OFF**. App owner explicitly connects and may revoke at any time.
- Public tag identifiers are not access credentials. A separate owner-controlled
  secret verifies messages. Never store production keys in the tag manifest.
- Message replay in this **demo** is detected in memory only. Production needs
  persistent nonce tracking, key rotation, TLS, endpoint authorization and
  retention limits. HMAC does not prove that a host's health metrics are true.
- No arbitrary commands, no code downloading, no remote repair, no persistent
  process and no access to third-party apps are possible from this library.
- A missing reply means 'unknown/offline', not proof that the app crashed.
- A paid resident-status subscription needs an explicit agreement, a real
  receiver, opt-in connection, billing and a functioning alert/repair workflow;
  none have been deployed in this experiment.

## Execute

```sh
python3 -m unittest discover -s aluma-tag/tests -v
python3 aluma-tag/demo.py
```

Both run without network calls or third-party libraries. GitHub Actions tests
the code in this owned branch only. No integration with the ten public
repositories has been performed or authorized.
