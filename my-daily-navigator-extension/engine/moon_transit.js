((root, factory) => {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  root.MoonTransitEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function resolve({ at, timeline = [] } = {}) {
    const moment = new Date(at).getTime();
    if (!Number.isFinite(moment) || !Array.isArray(timeline)) {
      return { available: false, reason: "invalid-moon-input" };
    }

    const row = timeline.find(item => {
      if (item?.verified !== true && item?.sourceVerified !== true) return false;
      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && moment >= start && moment < end;
    });

    if (!row) {
      return {
        available: false,
        reason: "verified-hourly-ephemeris-not-provided",
      };
    }

    const numericScore = Number(row.score);
    return {
      available: Number.isFinite(numericScore),
      sourceVerified: true,
      sign: row.sign || null,
      phase: row.phase || null,
      voidOfCourse: row.voidOfCourse === true,
      aspects: Array.isArray(row.aspects) ? row.aspects : [],
      score: Number.isFinite(numericScore) ? clamp(Math.round(numericScore), 0, 100) : null,
      source: row.source || "verified-hourly-ephemeris",
    };
  }

  return Object.freeze({ resolve });
});
