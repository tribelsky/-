# My Cosmic Mentor Calendar Extension — Beta 0.2.1

This Manifest V3 extension reads Google Calendar availability and evaluates events against the precomputed ASTRODAMOS `activityTimingMatrix` supplied by My Cosmic Mentor.

## Safety and privacy boundaries

- Google Calendar access is read-only (`calendar.events.readonly` and `calendar.freebusy`).
- The extension never creates, edits, moves, or deletes calendar events.
- Calendar event classification stays inside trusted extension pages/background code.
- The website bridge sends derived category scores and windows only. It excludes natal longitudes, birth data, user identifiers, report URLs, decryption keys, and free-text processes.
- `chrome.storage.local` and `chrome.storage.session` are restricted to `TRUSTED_CONTEXTS`, so the injected Calendar content script cannot read bridge data.
- Missing, expired, or incomplete category data returns `null` / `UNAVAILABLE`; no general score is substituted.

## Required setup before canary installation

1. Upload a draft ZIP to Chrome Developer Dashboard without publishing it.
2. Reserve the item ID, retrieve the dashboard public key, and add it as the manifest `key`. Do not generate an ad-hoc private key.
3. Create a Google OAuth client for that reserved extension ID and replace the placeholder `oauth2.client_id`.
4. Copy the resulting 32-character extension ID into `../mcm-extension-config.js`.
5. Add Yair as an OAuth test user, build the canary ZIP, and load it through `chrome://extensions`.

The website bridge remains deliberately fail-closed until steps 2–4 are complete.

## Secure handoff

1. The user selects **Approve one-time sync** in the extension side panel.
2. The approved My Cosmic Mentor page sends `MCM_SYNC_INIT`.
3. The extension issues a 256-bit challenge valid for 60 seconds and binds it to origin, tab ID, and document ID in `chrome.storage.session`.
4. The page sends `MCM_CONTEXT_COMMIT` protocol `1.1.0` with the matching challenge and category matrix.
5. The extension atomically consumes the challenge and stores the normalized envelope under `mcm_bridge_envelope_v1`.

Only `https://tribelsky.github.io/-/*` is externally connectable.

## Canonical scoring path

`engine/astrodamos.js` is a packaged copy of the repository's canonical `astrodamos-engine.js`. `engine/calendar_bridge.js` maps a locally classified event to exactly one matrix category and consumes only that category's hourly score/window. A professional execution score can never become a romance score.

## Acceptance tests

From the repository root:

```bash
node tests/astrodamos-bridge-acceptance.mjs
node tests/astrodamos-engine-acceptance.mjs
node tests/calendar-extension-bridge-acceptance.mjs
node tests/mcm-shell-syntax.mjs
node tests/secure-data-bridge-acceptance.mjs
```

The automated suite covers the 14-point secure bridge contract. Final rollout still requires the reserved Chrome item ID, OAuth client, and a manual canary run before the 10-user beta.
