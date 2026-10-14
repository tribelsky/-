((root, factory) => {
  const bridge = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = bridge;
  root.McmSecureBridge = bridge;
})(typeof globalThis !== "undefined" ? globalThis : self, () => {
  "use strict";

  const PROTOCOL_VERSION = "1.1.0";
  const APPROVED_ORIGIN = "https://tribelsky.github.io";
  const APPROVED_PATH_PREFIX = "/-/";
  const BRIDGE_STORAGE_KEY = "mcm_bridge_envelope_v1";
  const APPROVAL_STORAGE_KEY = "mcm_bridge_approval_v1";
  const CHALLENGE_STORAGE_KEY = "mcm_bridge_challenge_v1";
  const CHALLENGE_TTL_MS = 60_000;
  const APPROVAL_TTL_MS = 5 * 60_000;
  const MAX_CONTEXT_TTL_MS = 24 * 60 * 60_000;
  const MAX_ENVELOPE_BYTES = 256 * 1024;
  const MAX_PROCESSES = 0;
  const MAX_HOURLY_SCORES = 96;
  const MAX_OPTIMAL_WINDOWS = 24;
  const TRUSTED_CONTEXTS = "TRUSTED_CONTEXTS";
  const ACTIVITY_CATEGORIES = Object.freeze([
    "ROMANCE",
    "BUSINESS_CONTRACT",
    "CREATIVE",
    "SOCIAL",
    "WELLNESS",
    "GENERAL_EXECUTION",
  ]);

  const fail = code => {
    throw new Error(code);
  };

  const isRecord = value => Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function assertRecord(value, code) {
    if (!isRecord(value)) fail(code);
    return value;
  }

  function assertExactKeys(value, expectedKeys, code) {
    assertRecord(value, code);
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  }

  function boundedString(value, { code, max, min = 0, allowMarkup = false } = {}) {
    if (typeof value !== "string") fail(code);
    const normalized = value.trim();
    if (normalized.length < min || normalized.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) fail(code);
    if (!allowMarkup && /[<>]/u.test(normalized)) fail(code);
    return normalized;
  }

  function dateOnly(value, code) {
    const normalized = boundedString(value, { code, max: 10, min: 10 });
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) fail(code);
    const [year, month, day] = normalized.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.toISOString().slice(0, 10) !== normalized) fail(code);
    return normalized;
  }

  function instant(value, code, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    const normalized = boundedString(value, { code, max: 40, min: 20 });
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)) fail(code);
    if (!Number.isFinite(Date.parse(normalized))) fail(code);
    return normalized;
  }

  function byteLength(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  function normalizedScore(value, code, { nullable = false } = {}) {
    if (nullable && value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) fail(code);
    return Math.round(value * 10) / 10;
  }

  function timeOfDay(value, code) {
    const normalized = boundedString(value, { code, max: 5, min: 5 });
    const match = normalized.match(/^(\d{2}):([0-5]\d)$/u);
    if (!match || Number(match[1]) > 23) fail(code);
    return normalized;
  }

  function timeMinutes(value) {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  }

  function normalizeTimingCategory(value, category) {
    assertExactKeys(value, ["dailySummaryScore", "hourlyScores", "isDataAvailable", "optimalWindows"], "bridge-timing-category-schema-invalid");
    if (typeof value.isDataAvailable !== "boolean") fail("bridge-timing-availability-invalid");
    const dailySummaryScore = normalizedScore(value.dailySummaryScore, "bridge-daily-summary-score-invalid", { nullable: true });
    assertRecord(value.hourlyScores, "bridge-hourly-scores-invalid");
    const hourlyEntries = Object.entries(value.hourlyScores);
    if (hourlyEntries.length > MAX_HOURLY_SCORES) fail("bridge-hourly-score-count-invalid");
    const hourlyScores = {};
    for (const [rawTime, rawScore] of hourlyEntries) {
      const time = timeOfDay(rawTime, "bridge-hourly-time-invalid");
      hourlyScores[time] = normalizedScore(rawScore, "bridge-hourly-score-invalid");
    }
    if (!Array.isArray(value.optimalWindows) || value.optimalWindows.length > MAX_OPTIMAL_WINDOWS) {
      fail("bridge-optimal-window-count-invalid");
    }
    const optimalWindows = value.optimalWindows.map(window => {
      assertExactKeys(window, ["end", "ruler", "score", "start"], "bridge-optimal-window-schema-invalid");
      const start = timeOfDay(window.start, "bridge-window-start-invalid");
      const end = timeOfDay(window.end, "bridge-window-end-invalid");
      if (timeMinutes(end) <= timeMinutes(start)) fail("bridge-window-order-invalid");
      return {
        start,
        end,
        score: normalizedScore(window.score, "bridge-window-score-invalid"),
        ruler: boundedString(window.ruler, { code: "bridge-window-ruler-invalid", max: 256, min: 1 }),
      };
    });
    if (!value.isDataAvailable && (dailySummaryScore !== null || hourlyEntries.length || optimalWindows.length)) {
      fail("bridge-unavailable-category-has-data");
    }
    if (value.isDataAvailable && dailySummaryScore === null) fail("bridge-available-category-summary-missing");
    if (value.isDataAvailable && !hourlyEntries.length && !optimalWindows.length) fail("bridge-available-category-times-missing");
    return { isDataAvailable: value.isDataAvailable, dailySummaryScore, hourlyScores, optimalWindows };
  }

  function normalizeTimingMatrix(value) {
    assertExactKeys(value, ["categories", "timezone"], "bridge-timing-matrix-schema-invalid");
    const timezone = boundedString(value.timezone, { code: "bridge-timezone-invalid", max: 64, min: 1 });
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
    } catch {
      fail("bridge-timezone-invalid");
    }
    assertRecord(value.categories, "bridge-timing-categories-invalid");
    const categoryNames = Object.keys(value.categories);
    if (!categoryNames.length || categoryNames.some(category => !ACTIVITY_CATEGORIES.includes(category))) {
      fail("bridge-timing-categories-invalid");
    }
    const categories = {};
    for (const category of categoryNames) {
      categories[category] = normalizeTimingCategory(value.categories[category], category);
    }
    return { timezone, categories };
  }

  function validateEnvelope(message, { now = Date.now() } = {}) {
    if (byteLength(message) > MAX_ENVELOPE_BYTES) fail("bridge-payload-too-large");
    assertExactKeys(message, ["activityTimingMatrix", "meta", "processes", "protocolVersion", "type"], "bridge-envelope-schema-invalid");
    if (message.type !== "MCM_CONTEXT_COMMIT") fail("bridge-message-type-invalid");
    if (message.protocolVersion !== PROTOCOL_VERSION) fail("bridge-protocol-version-invalid");

    assertExactKeys(message.meta, ["challenge", "expiresAt", "generatedAt", "reportDate"], "bridge-meta-schema-invalid");
    const challenge = boundedString(message.meta.challenge, { code: "bridge-challenge-invalid", max: 43, min: 43 });
    if (!/^[A-Za-z0-9_-]{43}$/u.test(challenge)) fail("bridge-challenge-invalid");
    const generatedAt = instant(message.meta.generatedAt, "bridge-generated-at-invalid");
    const expiresAt = instant(message.meta.expiresAt, "bridge-expires-at-invalid");
    const reportDate = dateOnly(message.meta.reportDate, "bridge-report-date-invalid");
    const generatedTime = Date.parse(generatedAt);
    const sourceExpiry = Date.parse(expiresAt);
    if (generatedTime > now + 5 * 60_000 || generatedTime < now - 36 * 60 * 60_000) fail("bridge-generated-at-out-of-range");
    if (sourceExpiry <= now) fail("bridge-source-expired");

    if (!Array.isArray(message.processes) || message.processes.length !== MAX_PROCESSES) fail("bridge-processes-must-be-empty");
    const activityTimingMatrix = normalizeTimingMatrix(message.activityTimingMatrix);

    return {
      type: "MCM_CONTEXT_COMMIT",
      protocolVersion: PROTOCOL_VERSION,
      meta: { challenge, generatedAt, expiresAt, reportDate },
      activityTimingMatrix,
      processes: [],
    };
  }

  function validateInitMessage(message) {
    assertExactKeys(message, ["protocolVersion", "type"], "bridge-init-schema-invalid");
    if (message.type !== "MCM_SYNC_INIT") fail("bridge-message-type-invalid");
    if (message.protocolVersion !== PROTOCOL_VERSION) fail("bridge-protocol-version-invalid");
    return true;
  }

  function validateExternalSender(sender) {
    assertRecord(sender, "bridge-sender-invalid");
    if (sender.origin !== APPROVED_ORIGIN) fail("bridge-origin-rejected");
    let url;
    try {
      url = new URL(sender.url);
    } catch {
      fail("bridge-sender-url-invalid");
    }
    if (url.origin !== APPROVED_ORIGIN || !url.pathname.startsWith(APPROVED_PATH_PREFIX)) fail("bridge-path-rejected");
    const tabId = Number(sender.tab?.id);
    if (!Number.isInteger(tabId) || tabId < 0) fail("bridge-tab-required");
    const documentId = boundedString(sender.documentId, { code: "bridge-document-required", max: 256, min: 1 });
    return { origin: sender.origin, tabId, documentId };
  }

  function isTrustedExtensionPageSender(sender, runtimeId, extensionBaseUrl) {
    if (!sender || sender.id !== runtimeId || typeof sender.url !== "string") return false;
    return sender.url.startsWith(extensionBaseUrl);
  }

  function isTrustedCalendarContentSender(sender, runtimeId) {
    if (!sender || sender.id !== runtimeId || !Number.isInteger(sender.tab?.id) || typeof sender.url !== "string") return false;
    try {
      return new URL(sender.url).origin === "https://calendar.google.com";
    } catch {
      return false;
    }
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  }

  function createChallengeRecord(binding, { now = Date.now(), randomValues = array => crypto.getRandomValues(array) } = {}) {
    const bytes = randomValues(new Uint8Array(32));
    const challenge = bytesToBase64Url(bytes);
    return {
      challenge,
      origin: binding.origin,
      tabId: binding.tabId,
      documentId: binding.documentId,
      createdAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    };
  }

  function validateChallengeRecord(record, binding, suppliedChallenge, { now = Date.now() } = {}) {
    assertRecord(record, "bridge-challenge-missing");
    if (record.expiresAt <= now || record.createdAt > now + 5_000) fail("bridge-challenge-expired");
    if (record.origin !== binding.origin) fail("bridge-challenge-origin-mismatch");
    if (record.tabId !== binding.tabId) fail("bridge-challenge-tab-mismatch");
    if (record.documentId !== binding.documentId) fail("bridge-challenge-document-mismatch");
    if (record.challenge !== suppliedChallenge) fail("bridge-challenge-token-mismatch");
    return true;
  }

  function israelParts(timestamp) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
    };
  }

  function zonedLocalToEpoch({ year, month, day, hour, minute = 0, second = 0 }) {
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = desired;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const actual = israelParts(guess);
      const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
      const adjustment = desired - actualAsUtc;
      guess += adjustment;
      if (adjustment === 0) break;
    }
    return guess;
  }

  function nextIsraelRollover(now = Date.now()) {
    const local = israelParts(now);
    const beforeRollover = local.hour < 7;
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + (beforeRollover ? 0 : 1)));
    return zonedLocalToEpoch({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: 7,
    });
  }

  function buildStoredEnvelope(validated, { now = Date.now() } = {}) {
    const effectiveExpiresAt = Math.min(
      Date.parse(validated.meta.expiresAt),
      nextIsraelRollover(now),
      now + MAX_CONTEXT_TTL_MS
    );
    if (effectiveExpiresAt <= now) fail("bridge-effective-expiry-invalid");
    return {
      schemaVersion: PROTOCOL_VERSION,
      storedAt: new Date(now).toISOString(),
      effectiveExpiresAt: new Date(effectiveExpiresAt).toISOString(),
      meta: {
        generatedAt: validated.meta.generatedAt,
        reportDate: validated.meta.reportDate,
      },
      activityTimingMatrix: validated.activityTimingMatrix,
    };
  }

  function isStoredEnvelopeUsable(envelope, { now = Date.now() } = {}) {
    if (!isRecord(envelope) || envelope.schemaVersion !== PROTOCOL_VERSION) return false;
    const expiry = Date.parse(envelope.effectiveExpiresAt);
    return Number.isFinite(expiry)
      && expiry > now
      && isRecord(envelope.activityTimingMatrix)
      && isRecord(envelope.activityTimingMatrix.categories);
  }

  function runtimeDataFromEnvelope(envelope, { now = Date.now() } = {}) {
    if (!isStoredEnvelopeUsable(envelope, { now })) {
      return {
        context: { activityTimingMatrix: null, reportDate: null },
        profile: {},
        moonTimeline: [],
        scoringWeights: { astrology: 1, biorhythm: 0, moon: 0 },
      };
    }
    return {
      context: {
        activityTimingMatrix: envelope.activityTimingMatrix,
        reportDate: envelope.meta.reportDate,
      },
      profile: {},
      moonTimeline: [],
      scoringWeights: { astrology: 1, biorhythm: 0, moon: 0 },
    };
  }

  return Object.freeze({
    ACTIVITY_CATEGORIES,
    APPROVAL_STORAGE_KEY,
    APPROVAL_TTL_MS,
    APPROVED_ORIGIN,
    APPROVED_PATH_PREFIX,
    BRIDGE_STORAGE_KEY,
    CHALLENGE_STORAGE_KEY,
    CHALLENGE_TTL_MS,
    MAX_ENVELOPE_BYTES,
    MAX_PROCESSES,
    PROTOCOL_VERSION,
    TRUSTED_CONTEXTS,
    buildStoredEnvelope,
    createChallengeRecord,
    isStoredEnvelopeUsable,
    isTrustedCalendarContentSender,
    isTrustedExtensionPageSender,
    nextIsraelRollover,
    normalizeTimingMatrix,
    runtimeDataFromEnvelope,
    validateChallengeRecord,
    validateEnvelope,
    validateExternalSender,
    validateInitMessage,
  });
});
