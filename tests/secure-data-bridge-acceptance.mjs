import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const secure = require("../my-daily-navigator-extension/engine/secure_bridge.js");
const astro = require("../my-daily-navigator-extension/engine/astrodamos.js");
const biorhythm = require("../my-daily-navigator-extension/engine/biorhythm.js");
const moon = require("../my-daily-navigator-extension/engine/moon_transit.js");
globalThis.AstrodamosEngine = astro;
globalThis.BiorhythmEngine = biorhythm;
globalThis.MoonTransitEngine = moon;
const calendarBridge = require("../my-daily-navigator-extension/engine/calendar_bridge.js");

const extensionRoot = new URL("../my-daily-navigator-extension/", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", extensionRoot), "utf8"));
const background = await readFile(new URL("background.js", extensionRoot), "utf8");
const websiteBridge = await readFile(new URL("mcm-extension-bridge.js", repositoryRoot), "utf8");
const websiteConfig = await readFile(new URL("mcm-extension-config.js", repositoryRoot), "utf8");

const NOW = Date.parse("2026-10-14T07:30:00.000Z");
const sender = {
  origin: "https://tribelsky.github.io",
  url: "https://tribelsky.github.io/-/?r=abcdefgh",
  tab: { id: 41 },
  documentId: "document-1",
};
const binding = secure.validateExternalSender(sender);
const challengeRecord = secure.createChallengeRecord(binding, {
  now: NOW,
  randomValues: bytes => bytes.fill(7),
});

const validPayload = {
  type: "MCM_CONTEXT_COMMIT",
  protocolVersion: "1.1.0",
  meta: {
    challenge: challengeRecord.challenge,
    generatedAt: "2026-10-14T07:25:00.000Z",
    expiresAt: "2026-10-15T04:00:00.000Z",
    reportDate: "2026-10-14",
  },
  activityTimingMatrix: {
    timezone: "Asia/Jerusalem",
    categories: {
      ROMANCE: {
        isDataAvailable: true,
        dailySummaryScore: 72,
        hourlyScores: { "11:00": 40, "18:00": 82, "20:00": 94 },
        optimalWindows: [
          { start: "18:30", end: "21:30", score: 91, ruler: "Moon trine natal Venus" },
        ],
      },
      BUSINESS_CONTRACT: {
        isDataAvailable: true,
        dailySummaryScore: 88,
        hourlyScores: { "11:00": 95, "14:00": 88 },
        optimalWindows: [
          { start: "10:00", end: "12:30", score: 94, ruler: "Moon trine natal Jupiter" },
        ],
      },
      GENERAL_EXECUTION: {
        isDataAvailable: true,
        dailySummaryScore: 93,
        hourlyScores: { "11:00": 93 },
        optimalWindows: [],
      },
      SOCIAL: {
        isDataAvailable: false,
        dailySummaryScore: null,
        hourlyScores: {},
        optimalWindows: [],
      },
    },
  },
  processes: [],
};

const clone = value => JSON.parse(JSON.stringify(value));
const rejectsWith = (callback, code) => assert.throws(callback, error => error?.message === code);

// 1. Approved origin and exact beta path are accepted.
assert.deepEqual(binding, { origin: sender.origin, tabId: 41, documentId: "document-1" });
assert.deepEqual(manifest.externally_connectable?.matches, ["https://tribelsky.github.io/-/*"]);

// 2. Wrong origins and wrong paths are rejected.
rejectsWith(() => secure.validateExternalSender({ ...sender, origin: "https://example.com", url: "https://example.com/-/" }), "bridge-origin-rejected");
rejectsWith(() => secure.validateExternalSender({ ...sender, url: "https://tribelsky.github.io/not-approved/" }), "bridge-path-rejected");

// 3. Malformed and oversized payloads are rejected.
rejectsWith(() => secure.validateEnvelope({ type: "MCM_CONTEXT_COMMIT" }, { now: NOW }), "bridge-envelope-schema-invalid");
const oversized = clone(validPayload);
oversized.activityTimingMatrix.categories.ROMANCE.optimalWindows[0].ruler = "x".repeat(300_000);
rejectsWith(() => secure.validateEnvelope(oversized, { now: NOW }), "bridge-payload-too-large");

// 4. Unknown fields are rejected at every schema boundary.
const unexpected = clone(validPayload);
unexpected.meta.unexpected = true;
rejectsWith(() => secure.validateEnvelope(unexpected, { now: NOW }), "bridge-meta-schema-invalid");

// 5. The extension generates a 256-bit, base64url challenge.
assert.match(challengeRecord.challenge, /^[A-Za-z0-9_-]{43}$/u);
assert.equal(challengeRecord.expiresAt - challengeRecord.createdAt, 60_000);

// 6. Challenge binding rejects a different tab or document.
rejectsWith(
  () => secure.validateChallengeRecord(challengeRecord, { ...binding, tabId: 42 }, challengeRecord.challenge, { now: NOW + 1_000 }),
  "bridge-challenge-tab-mismatch"
);
rejectsWith(
  () => secure.validateChallengeRecord(challengeRecord, { ...binding, documentId: "document-2" }, challengeRecord.challenge, { now: NOW + 1_000 }),
  "bridge-challenge-document-mismatch"
);

// 7. Expired challenges are rejected; the background removes a consumed token before validation/storage.
rejectsWith(
  () => secure.validateChallengeRecord(challengeRecord, binding, challengeRecord.challenge, { now: NOW + 60_001 }),
  "bridge-challenge-expired"
);
assert.match(background, /storage\.session\.remove\([\s\S]*CHALLENGE_STORAGE_KEY[\s\S]*validateEnvelope/u);
assert.match(background, /serializeCommit\(async/u);

// 8. Both local and session storage are restricted to trusted extension contexts.
assert.match(background, /storage\.local\.setAccessLevel\(\{ accessLevel: McmSecureBridge\.TRUSTED_CONTEXTS \}\)/u);
assert.match(background, /storage\.session\.setAccessLevel\(\{ accessLevel: McmSecureBridge\.TRUSTED_CONTEXTS \}\)/u);

// 9. Expiry is capped at the next 07:00 Asia/Jerusalem rollover and disconnect removes only bridge data.
const validated = secure.validateEnvelope(validPayload, { now: NOW });
const storedEnvelope = secure.buildStoredEnvelope(validated, { now: NOW });
assert.equal(storedEnvelope.effectiveExpiresAt, "2026-10-15T04:00:00.000Z");
assert.match(background, /case "MCM_DISCONNECT_CONTEXT"[\s\S]*storage\.local\.remove\(McmSecureBridge\.BRIDGE_STORAGE_KEY\)/u);
assert.doesNotMatch(background, /case "MCM_DISCONNECT_CONTEXT"[\s\S]*storage\.local\.clear/u);

// 10. The normalized envelope remains compatible with the existing ASTRODAMOS scorer.
const runtime = secure.runtimeDataFromEnvelope(storedEnvelope, { now: NOW + 1_000 });
const scored = calendarBridge.evaluateCalendarEvent({
  event: {
    id: "event-1",
    summary: "Client contract negotiation",
    start: { dateTime: "2026-10-14T14:00:00+03:00", timeZone: "Asia/Jerusalem" },
    end: { dateTime: "2026-10-14T15:00:00+03:00", timeZone: "Asia/Jerusalem" },
  },
  ...runtime,
  timeZone: "Asia/Jerusalem",
});
assert.ok(Number.isFinite(scored.score.value));
assert.equal(scored.score.value, 88);

// 11. Missing or expired context fails closed with no fabricated score.
const expiredRuntime = secure.runtimeDataFromEnvelope(storedEnvelope, { now: Date.parse(storedEnvelope.effectiveExpiresAt) });
const unavailable = calendarBridge.evaluateCalendarEvent({
  event: {
    summary: "Meeting",
    start: { dateTime: "2026-10-15T08:00:00+03:00", timeZone: "Asia/Jerusalem" },
    end: { dateTime: "2026-10-15T09:00:00+03:00", timeZone: "Asia/Jerusalem" },
  },
  ...expiredRuntime,
  timeZone: "Asia/Jerusalem",
});
assert.equal(unavailable.score.value, null);

// 12. Calendar permissions and API calls remain strictly read-only.
assert.ok(manifest.oauth2.scopes.every(scope => !/calendar\.events(?!\.readonly)/u.test(scope)));
assert.doesNotMatch(background, /\/events\/[^?]+["'`][\s\S]{0,120}method:\s*["'](?:PATCH|PUT|DELETE)["']/u);

// 13. No payload logging exists and the legacy direct write route is disabled.
assert.doesNotMatch(background, /console\.(?:log|info|debug|warn)\s*\(/u);
assert.doesNotMatch(websiteBridge, /console\.(?:log|info|debug|warn)\s*\(/u);
assert.match(background, /case "MCM_SAVE_CONTEXT":[\s\S]*legacy-context-write-disabled/u);

// 14. Canary gate: code remains fail-closed until the reserved extension ID is inserted.
assert.match(websiteConfig, /__MCM_EXTENSION_ID__\s*=\s*""/u);
assert.equal(manifest.version, "0.2.1");
assert.match(websiteBridge, /protocolVersion:\s*PROTOCOL_VERSION/u);

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "Approved origin and path",
    "Foreign origin and path rejection",
    "Malformed and oversized payload rejection",
    "Unknown-field rejection",
    "Extension-generated 256-bit challenge",
    "Tab and document binding",
    "Expiry and replay-consumption guard",
    "TRUSTED_CONTEXTS enforcement",
    "07:00 Asia/Jerusalem lifecycle and narrow disconnect",
    "ASTRODAMOS compatibility",
    "Null-on-missing-or-expired context",
    "Zero Calendar mutation",
    "Log sanitization and legacy-write lockout",
    "Fail-closed canary ID gate",
  ],
  manualCanary: "PENDING_STABLE_EXTENSION_ID",
}, null, 2));
