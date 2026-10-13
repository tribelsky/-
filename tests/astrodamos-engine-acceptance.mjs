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
const processes = [
  {
    id: "mercury-trine-sun",
    title: "House 10 good בהירות מקצועית",
    transit: "Mercury",
    natal: "Sun",
    aspect: "Trine",
    house: 10,
    start: "2026-10-13T13:00:00+03:00",
    peak: "2026-10-13T14:00:00+03:00",
    end: "2026-10-13T15:00:00+03:00",
    fallbackDate: todayDate,
  },
  {
    id: "moon-square-saturn",
    title: "not good עומס רגשי",
    transit: "Moon",
    natal: "Saturn",
    aspect: "Square",
    house: 7,
    start: "2026-10-13T13:15:00+03:00",
    peak: "2026-10-13T14:15:00+03:00",
    end: "2026-10-13T15:15:00+03:00",
    fallbackDate: todayDate,
  },
  {
    id: "venus-sextile-mercury",
    title: "תקשורת נעימה ומדויקת",
    transit: "Venus",
    natal: "Mercury",
    aspect: "Sextile",
    house: 3,
    start: "2026-10-13T16:00:00+03:00",
    peak: "2026-10-13T17:00:00+03:00",
    end: "2026-10-13T18:00:00+03:00",
    fallbackDate: todayDate,
  },
  {
    id: "jupiter-trine-mercury",
    title: "ראייה רחבה ושיחה מקדמת",
    transit: "Jupiter",
    natal: "Mercury",
    aspect: "Trine",
    house: 10,
    start: "2026-10-14T09:00:00+03:00",
    peak: "2026-10-14T10:00:00+03:00",
    end: "2026-10-14T11:00:00+03:00",
    fallbackDate: tomorrowDate,
  },
];
const context = { todayDate, tomorrowDate, processes };
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
assert.match(result.answer, /\/10/);
assert.ok(result.alternatives.length >= 1, "a materially better alternative should be offered");
assert.doesNotMatch(result.answer, /House|good|not good|trigger|prompt/i);
assert.ok(result.details?.rows?.length, "calculation details should be available on demand");
assert.ok(result.details.rows.every(row => !/House|good|not good|trigger|prompt/i.test(row.title + row.technical)));

const noonResult = engine.answerQuestion({
  question: "מה כדאי לי לעשות היום בשעות הצהריים?",
  context,
  now,
});
assert.match(noonResult.answer, /הכיוון החזק ביותר/);
assert.doesNotMatch(noonResult.answer, /House|good|not good/i);

console.log(JSON.stringify({
  status: "PASS",
  checks: [
    "Hebrew exact-time parsing",
    "Noon-window parsing",
    "Business-meeting scoring",
    "Alternative-time proposal",
    "Natural answer with hidden calculation",
    "No internal labels in visible output",
  ],
}, null, 2));
