import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const extension = new URL("../my-daily-navigator-extension/", import.meta.url);
const sandbox = { Intl, Date, Math, console, globalThis: null };
sandbox.globalThis = sandbox;

for (const path of [
  "engine/astrodamos.js",
  "engine/biorhythm.js",
  "engine/moon_transit.js",
  "engine/calendar_bridge.js",
]) {
  const source = await readFile(new URL(path, extension), "utf8");
  runInNewContext(source, sandbox, { filename: path });
}

const bridge = sandbox.CalendarAstrodamosBridge;
assert.ok(bridge, "calendar bridge must load");

const context = {
  reportDate: "2026-10-14",
  activityTimingMatrix: {
    timezone: "Asia/Jerusalem",
    categories: {
      BUSINESS_CONTRACT: {
        isDataAvailable: true,
        dailySummaryScore: 78,
        hourlyScores: { "14:00": 62, "17:00": 88 },
        optimalWindows: [{ start: "16:30", end: "18:30", score: 88, ruler: "Moon trine natal Jupiter" }],
      },
      ROMANCE: {
        isDataAvailable: true,
        dailySummaryScore: 72,
        hourlyScores: { "11:00": 40, "18:00": 82, "20:00": 94 },
        optimalWindows: [{ start: "18:30", end: "21:30", score: 91, ruler: "Moon trine natal Venus" }],
      },
      GENERAL_EXECUTION: {
        isDataAvailable: true,
        dailySummaryScore: 93,
        hourlyScores: { "11:00": 93 },
        optimalWindows: [],
      },
    },
  },
};

const event = {
  id: "event-1",
  summary: "Client contract negotiation",
  start: { dateTime: "2026-10-14T14:00:00+03:00", timeZone: "Asia/Jerusalem" },
  end: { dateTime: "2026-10-14T15:00:00+03:00", timeZone: "Asia/Jerusalem" },
};

const result = bridge.evaluateCalendarEvent({
  event,
  context,
  profile: { birthDate: "1990-01-01" },
  timeZone: "Asia/Jerusalem",
});
assert.equal(result.classification.id, "BUSINESS_CONTRACT");
assert.equal(result.privacy.titleClassifiedLocally, true);
assert.equal(result.privacy.descriptionRead, false);
assert.ok(result.score.value >= 0 && result.score.value <= 100);
assert.equal(result.score.value, 62);
assert.equal(result.score.value, result.score.components.astrology.score, "the category matrix is authoritative");

const verifiedMoon = sandbox.MoonTransitEngine.resolve({
  at: event.start.dateTime,
  timeline: [{ start: "2026-10-14T13:00:00+03:00", end: "2026-10-14T15:00:00+03:00", verified: true, score: 82, sign: "Scorpio" }],
});
assert.equal(verifiedMoon.available, true);
assert.equal(verifiedMoon.score, 82);

const bioAtBirth = sandbox.BiorhythmEngine.calculate({ birthDate: "1990-01-01", at: "1990-01-01" });
assert.equal(bioAtBirth.available, true);
assert.equal(bioAtBirth.cycles.physical.percentage, 0);

const alternatives = bridge.rankCalendarAlternatives({
  event,
  context,
  profile: { birthDate: "1990-01-01" },
  timeZone: "Asia/Jerusalem",
  minimumImprovement: 0,
  freeSlots: [
    { start: "2026-10-14T17:00:00+03:00", end: "2026-10-14T18:00:00+03:00" },
  ],
});
assert.equal(alternatives.length, 1);
assert.equal(alternatives[0].event.start, "2026-10-14T17:00:00+03:00");

const romance = bridge.evaluateCalendarEvent({
  event: {
    summary: "מפגש רומנטי",
    start: { dateTime: "2026-10-14T11:00:00+03:00", timeZone: "Asia/Jerusalem" },
    end: { dateTime: "2026-10-14T12:00:00+03:00", timeZone: "Asia/Jerusalem" },
  },
  context,
});
assert.equal(romance.classification.id, "ROMANCE");
assert.equal(romance.score.value, 40);
assert.notEqual(romance.score.value, 93);

const missingRomance = bridge.evaluateCalendarEvent({
  event: {
    summary: "פגישה רומנטית",
    start: { dateTime: "2026-10-14T11:00:00+03:00", timeZone: "Asia/Jerusalem" },
    end: { dateTime: "2026-10-14T12:00:00+03:00", timeZone: "Asia/Jerusalem" },
  },
  context: {
    ...context,
    activityTimingMatrix: {
      ...context.activityTimingMatrix,
      categories: {
        ...context.activityTimingMatrix.categories,
        ROMANCE: { isDataAvailable: false, dailySummaryScore: null, hourlyScores: {}, optimalWindows: [] },
      },
    },
  },
});
assert.equal(missingRomance.score.value, null);
assert.equal(missingRomance.reason, "activity-category-unavailable");

const allDay = bridge.evaluateCalendarEvent({
  event: { summary: "Holiday", start: { date: "2026-10-14" }, end: { date: "2026-10-15" } },
  context,
});
assert.equal(allDay.score.value, null);

const manifest = JSON.parse(await readFile(new URL("manifest.json", extension), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual([...manifest.permissions].sort(), ["identity", "sidePanel", "storage"]);
assert.ok(manifest.oauth2.scopes.every(scope => !/calendar\.events(?!\.readonly)/.test(scope)), "beta scopes must remain read-only");

for (const locale of ["en", "he"]) {
  const messages = JSON.parse(await readFile(new URL(`_locales/${locale}/messages.json`, extension), "utf8"));
  assert.ok(messages.extensionName?.message);
  assert.ok(messages.privacyNote?.message);
}

const canonical = await readFile(new URL("astrodamos-engine.js", root), "utf8");
const packaged = await readFile(new URL("engine/astrodamos.js", extension), "utf8");
assert.equal(packaged, canonical, "packaged ASTRODAMOS must match the canonical engine byte-for-byte");

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "Manifest V3 read-only permissions",
    "Hebrew and English localization",
    "Local meeting classification",
    "Google Calendar event normalization",
    "ASTRODAMOS 0-100 bridge",
    "Biorhythm calculation",
    "Verified-only Moon adapter",
    "Alternative free-slot ranking",
    "Romance vocabulary and cross-category isolation",
    "Fail-closed missing romance data",
    "Canonical engine drift guard",
  ],
}, null, 2));
