((root, factory) => {
  const bridge = factory(
    root.AstrodamosEngine,
    root.BiorhythmEngine,
    root.MoonTransitEngine
  );
  if (typeof module !== "undefined" && module.exports) module.exports = bridge;
  root.CalendarAstrodamosBridge = bridge;
})(typeof globalThis !== "undefined" ? globalThis : window, (astroEngine, biorhythmEngine, moonEngine) => {
  "use strict";

  const ACTIVITY_KEYWORDS = Object.freeze({
    BUSINESS_CONTRACT: [
      "business", "client", "customer", "negotiation", "contract", "sales", "interview", "presentation", "pitch",
      "עסק", "עסקית", "לקוח", "משא ומתן", "חוזה", "חתימה", "מכירה", "ראיון", "מצגת"
    ],
    ROMANCE: [
      "romance", "romantic", "date", "dating", "relationship", "partner", "love",
      "רומנטי", "רומנטית", "רומנטיקה", "דייט", "זוגיות", "זוג", "אהבה"
    ],
    SOCIAL: [
      "social", "friends", "friendship", "party", "gathering",
      "חברתי", "חברתית", "חברים", "חברות", "מסיבה", "מפגש חברים"
    ],
    CREATIVE: [
      "creative", "writing", "design", "music", "photo", "content", "brainstorm",
      "יצירה", "כתיבה", "עיצוב", "מוזיקה", "צילום", "תוכן", "סיעור"
    ],
    GENERAL_EXECUTION: [
      "launch", "start", "decision", "delivery", "execution", "deadline",
      "השקה", "התחלה", "החלטה", "מסירה", "ביצוע", "דדליין"
    ],
    WELLNESS: [
      "rest", "sleep", "health", "therapy", "recovery",
      "מנוחה", "שינה", "בריאות", "טיפול", "התאוששות"
    ],
  });

  const DEFAULT_WEIGHTS = Object.freeze({ astrology: 1, biorhythm: 0, moon: 0 });
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[״"'.,!?;:()[\]{}]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function keywordMatch(text, keyword) {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return false;
    if (/^[a-z0-9 -]+$/u.test(normalizedKeyword)) {
      const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "u").test(text);
    }
    return text.includes(normalizedKeyword);
  }

  function classifyMeeting(title) {
    const text = normalizeText(title);
    let best = { id: null, hits: 0, matches: [] };
    for (const [id, keywords] of Object.entries(ACTIVITY_KEYWORDS)) {
      const matches = keywords.filter(keyword => keywordMatch(text, keyword));
      if (matches.length > best.hits) best = { id, hits: matches.length, matches };
    }
    return {
      id: best.id,
      source: best.hits ? "local-keywords" : "unclassified",
      confidence: best.hits ? clamp(0.55 + best.hits * 0.15, 0, 0.95) : 0,
      matches: best.matches,
      needsClarification: best.hits === 0,
    };
  }

  function datePartsAt(value, timeZone) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      minutes: Number(map.hour) * 60 + Number(map.minute),
    };
  }

  function normalizeGoogleCalendarEvent(event, options = {}) {
    const timeZone = options.timeZone || event?.start?.timeZone || event?.end?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const startValue = event?.start?.dateTime || event?.start?.date || "";
    const endValue = event?.end?.dateTime || event?.end?.date || startValue;
    const startDate = new Date(startValue);
    const endDate = new Date(endValue);
    const allDay = Boolean(event?.start?.date && !event?.start?.dateTime);
    const startParts = allDay ? null : datePartsAt(startValue, timeZone);

    return {
      id: String(event?.id || ""),
      title: String(event?.summary || "Untitled event"),
      start: startValue,
      end: endValue,
      timeZone,
      allDay,
      date: startParts?.date || String(event?.start?.date || ""),
      minutes: startParts?.minutes ?? null,
      durationMinutes: Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
        ? Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000))
        : 0,
      htmlLink: event?.htmlLink || null,
      status: event?.status || null,
    };
  }

  function scoreBand(value) {
    if (value === null || value === undefined) return "unavailable";
    if (value >= 80) return "high";
    if (value >= 55) return "moderate";
    return "challenging";
  }

  function composeScore(components, requestedWeights = DEFAULT_WEIGHTS) {
    const weights = { ...DEFAULT_WEIGHTS, ...(requestedWeights || {}) };
    const active = Object.entries(components).filter(([name, component]) => {
      return component?.available && Number.isFinite(component.score) && Number(weights[name]) > 0;
    });
    if (!active.length) return null;
    const totalWeight = active.reduce((sum, [name]) => sum + Number(weights[name]), 0);
    return Math.round(active.reduce((sum, [name, component]) => sum + component.score * Number(weights[name]), 0) / totalWeight);
  }

  function astroFactors(result) {
    if (!result) return [];
    const itemToFactor = (item, tone) => ({
      tone,
      title: item.process?.title || [item.process?.transit, item.process?.aspect, item.process?.natal].filter(Boolean).join(" · ") || "Personal process",
      transit: item.process?.transit || null,
      aspect: item.process?.aspect || null,
      natal: item.process?.natal || null,
      house: item.process?.house || null,
    });
    return [
      ...(result.supportive || []).slice(0, 2).map(item => itemToFactor(item, "supportive")),
      ...(result.challenging || []).slice(0, 2).map(item => itemToFactor(item, "challenging")),
    ];
  }

  function timeKey(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function minutesFromTime(value) {
    const [hour, minute] = String(value || "").split(":").map(Number);
    return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
  }

  function resolveMatrixScore({ context, categoryId, date, minutes }) {
    const matrix = context?.activityTimingMatrix;
    if (!matrix || context?.reportDate !== date) return { available: false, reason: "timing-date-unavailable" };
    const category = matrix.categories?.[categoryId];
    if (!category?.isDataAvailable) return { available: false, reason: "activity-category-unavailable" };
    const exactKey = timeKey(minutes);
    const hourKey = timeKey(Math.floor(minutes / 60) * 60);
    const directScore = category.hourlyScores?.[exactKey] ?? category.hourlyScores?.[hourKey];
    const activeWindow = (category.optimalWindows || []).find(window => {
      const start = minutesFromTime(window.start);
      const end = minutesFromTime(window.end);
      return start !== null && end !== null && minutes >= start && minutes < end;
    });
    const score = Number.isFinite(directScore) ? directScore : activeWindow?.score;
    if (!Number.isFinite(score)) return { available: false, reason: "hourly-score-unavailable" };
    return {
      available: true,
      score,
      category,
      activeWindow: activeWindow || null,
      sourceTime: Number.isFinite(directScore) ? (category.hourlyScores?.[exactKey] !== undefined ? exactKey : hourKey) : null,
    };
  }

  function unavailableResult(normalized, classification, reason) {
    return {
      event: normalized,
      classification,
      score: { value: null, band: "unavailable", components: {} },
      factors: [],
      reason,
      privacy: {
        titleClassifiedLocally: true,
        descriptionRead: false,
        attendeesRead: false,
      },
    };
  }

  function evaluateCalendarEvent({
    event,
    context = {},
    profile = {},
    moonTimeline = [],
    scoringWeights = DEFAULT_WEIGHTS,
    timeZone,
  } = {}) {
    const normalized = normalizeGoogleCalendarEvent(event, { timeZone: context?.activityTimingMatrix?.timezone || timeZone });
    const classification = classifyMeeting(normalized.title);
    if (normalized.allDay || normalized.minutes === null || !normalized.date) {
      return unavailableResult(normalized, classification, "all-day-or-invalid-time");
    }
    if (!classification.id) return unavailableResult(normalized, classification, "activity-intent-ambiguous");
    const timing = resolveMatrixScore({
      context,
      categoryId: classification.id,
      date: normalized.date,
      minutes: normalized.minutes,
    });
    if (!timing.available) return unavailableResult(normalized, classification, timing.reason);
    const value = timing.score;
    const components = {
      astrology: {
        available: true,
        score: value,
        source: "precomputed-activity-timing-matrix",
        category: classification.id,
        sourceTime: timing.sourceTime,
      },
    };

    return {
      event: normalized,
      classification,
      score: {
        value,
        band: scoreBand(value),
        components,
      },
      factors: timing.activeWindow ? [{
        tone: "supportive",
        title: timing.activeWindow.ruler,
        category: classification.id,
        window: { start: timing.activeWindow.start, end: timing.activeWindow.end },
      }] : [],
      privacy: {
        titleClassifiedLocally: true,
        descriptionRead: false,
        attendeesRead: false,
      },
    };
  }

  function rankCalendarAlternatives({
    event,
    freeSlots = [],
    context = {},
    profile = {},
    moonTimeline = [],
    scoringWeights = DEFAULT_WEIGHTS,
    timeZone,
    limit = 3,
    minimumImprovement = 5,
  } = {}) {
    const original = evaluateCalendarEvent({ event, context, profile, moonTimeline, scoringWeights, timeZone });
    const duration = Math.max(30, original.event.durationMinutes || 60);
    const candidates = freeSlots.map(slot => {
      const start = typeof slot === "string" ? slot : slot.start;
      const providedEnd = typeof slot === "string" ? null : slot.end;
      const end = providedEnd || new Date(new Date(start).getTime() + duration * 60000).toISOString();
      const candidateEvent = { ...event, start: { dateTime: start, timeZone: timeZone || original.event.timeZone }, end: { dateTime: end, timeZone: timeZone || original.event.timeZone } };
      return evaluateCalendarEvent({ event: candidateEvent, context, profile, moonTimeline, scoringWeights, timeZone });
    }).filter(item => Number.isFinite(item.score.value));

    const baseline = Number.isFinite(original.score.value) ? original.score.value : -Infinity;
    return candidates
      .filter(item => item.score.value >= baseline + minimumImprovement)
      .sort((a, b) => b.score.value - a.score.value || new Date(a.event.start) - new Date(b.event.start))
      .slice(0, limit);
  }

  return Object.freeze({
    ACTIVITY_KEYWORDS,
    DEFAULT_WEIGHTS,
    classifyMeeting,
    composeScore,
    evaluateCalendarEvent,
    normalizeGoogleCalendarEvent,
    rankCalendarAlternatives,
    resolveMatrixScore,
    scoreBand,
  });
});
