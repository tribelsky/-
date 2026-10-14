import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../astrodamos-engine.js", import.meta.url), "utf8");
const sandbox = {
  Intl,
  Date,
  console,
  globalThis: null,
};
sandbox.globalThis = sandbox;
runInNewContext(source, sandbox, { filename: "astrodamos-engine.js" });
const engine = sandbox.AstrodamosEngine;

assert.ok(engine, "engine must expose AstrodamosEngine");

const todayDate = "2026-10-13";
const tomorrowDate = "2026-10-14";
const context = {
  todayDate,
  tomorrowDate,
  reportDate: todayDate,
  activityTimingMatrix: {
    timezone: "Asia/Jerusalem",
    categories: {
      BUSINESS_CONTRACT: {
        isDataAvailable: true,
        dailySummaryScore: 80,
        hourlyScores: { "11:00": 95, "12:00": 78, "14:00": 62, "17:00": 88 },
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
        hourlyScores: { "11:00": 93, "12:00": 90, "14:00": 84 },
        optimalWindows: [],
      },
    },
  },
  processes: [],
};
const now = new Date("2026-10-13T08:00:00Z");

const parsedWords = engine.parseQuestion(
  "יש לי פגישת עסקים היום לשתים בצהריים. האם זה זמן טוב?",
  { context, now }
);
assert.equal(parsedWords.activity, "business");
assert.equal(parsedWords.exactMinutes, 14 * 60);
assert.equal(parsedWords.targetDate, todayDate);

const parsedNoon = engine.parseQuestion("מה כדאי לעשות היום בשעות הצהריים?", { context, now });
assert.equal(parsedNoon.windowStart, 11 * 60);
assert.equal(parsedNoon.windowEnd, 14 * 60);

const result = engine.answerQuestion({
  question: "יש לי פגישת עסקים היום בשעה 14:00. האם זה זמן טוב או שעדיף זמן אחר?",
  context,
  now,
});
assert.equal(typeof result.score, "number");
assert.match(result.answer, /14:00/);
assert.match(result.answer, /\/100/);
assert.ok(result.alternatives.length >= 1, "a materially better alternative should be offered");
assert.doesNotMatch(result.answer, /House|good|not good|trigger|prompt/i);
assert.equal(result.status, "AVAILABLE");

const noonResult = engine.answerQuestion({
  question: "מה כדאי לי לעשות היום בשעות הצהריים?",
  context,
  now,
});
assert.match(noonResult.answer, /התחום החזק ביותר/);
assert.doesNotMatch(noonResult.answer, /House|good|not good/i);

for (const wording of ["רומנטי", "רומנטית", "רומנטיקה", "דייט", "זוגיות"]) {
  assert.equal(engine.parseQuestion(`מפגש ${wording} היום בשעה 11:00`, { context, now }).activity, "relationship");
}

const romance = engine.answerQuestion({
  question: "איזו שעה תתאים היום למפגש רומנטי? אני יכול גם בשעה 11:00",
  context,
  now,
});
assert.equal(romance.score, 40);
assert.notEqual(romance.score, 93);
assert.match(romance.answer, /20:00|18:30|18:00/u);

const unavailableContext = structuredClone(context);
unavailableContext.activityTimingMatrix.categories.ROMANCE = {
  isDataAvailable: false,
  dailySummaryScore: null,
  hourlyScores: {},
  optimalWindows: [],
};
const unavailable = engine.answerQuestion({ question: "מתי כדאי דייט היום?", context: unavailableContext, now });
assert.equal(unavailable.status, "UNAVAILABLE");
assert.equal(unavailable.score, null);
assert.doesNotMatch(unavailable.answer, /93/u);

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "Hebrew exact-time parsing",
    "Noon-window parsing",
    "Business-meeting scoring",
    "Alternative-time proposal",
    "Natural answer with hidden calculation",
    "No internal labels in visible output",
    "Hebrew romance vocabulary",
    "Romance score isolation from execution",
    "Fail-closed missing romance data",
  ],
}, null, 2));
