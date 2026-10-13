((root, factory) => {
  const engine = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = engine;
  root.AstrodamosEngine = engine;
})(typeof globalThis !== "undefined" ? globalThis : window, () => {
  "use strict";

  const HEBREW_HOURS = Object.freeze({
    "אחת": 1, "אחד": 1, "שתיים": 2, "שתים": 2, "שתי": 2, "שניים": 2,
    "שלוש": 3, "ארבע": 4, "חמש": 5, "שש": 6, "שבע": 7,
    "שמונה": 8, "תשע": 9, "עשר": 10, "אחת עשרה": 11, "שתים עשרה": 12,
  });

  const ACTIVITIES = Object.freeze({
    business: {
      label: "פגישה עסקית",
      keywords: ["פגישה", "עסק", "לקוח", "משא ומתן", "ראיון", "שיווק", "מכירה", "חתימה"],
      planets: ["mercury", "venus", "jupiter", "saturn", "sun", "מרקורי", "ונוס", "יופיטר", "סטורן", "שמש"],
      houses: [2, 3, 6, 7, 10, 11],
    },
    conversation: {
      label: "שיחה חשובה",
      keywords: ["שיחה", "לדבר", "טלפון", "מייל", "הודעה", "תקשורת", "לשוחח"],
      planets: ["mercury", "moon", "venus", "מרקורי", "ירח", "ונוס"],
      houses: [3, 7, 11],
    },
    creative: {
      label: "עבודה יצירתית",
      keywords: ["יציר", "כתיבה", "לכתוב", "עיצוב", "מוזיקה", "צילום", "רעיון", "תוכן"],
      planets: ["mercury", "venus", "neptune", "uranus", "moon", "מרקורי", "ונוס", "נפטון", "אורנוס", "ירח"],
      houses: [3, 5, 9, 11],
    },
    action: {
      label: "יוזמה וביצוע",
      keywords: ["לבצע", "להתחיל", "יוזמה", "פעולה", "החלטה", "להשיק", "לסיים"],
      planets: ["mars", "sun", "jupiter", "saturn", "מרס", "שמש", "יופיטר", "סטורן"],
      houses: [1, 6, 10],
    },
    relationship: {
      label: "קשר ויחסים",
      keywords: ["זוג", "קשר", "יחסים", "אהבה", "רגש", "משפחה", "דייט"],
      planets: ["venus", "moon", "mercury", "mars", "ונוס", "ירח", "מרקורי", "מרס"],
      houses: [4, 5, 7, 8],
    },
    rest: {
      label: "מנוחה והתכנסות",
      keywords: ["מנוחה", "לנוח", "לישון", "בריאות", "גוף", "טיפול", "להירגע"],
      planets: ["moon", "venus", "neptune", "saturn", "ירח", "ונוס", "נפטון", "סטורן"],
      houses: [4, 6, 12],
    },
    general: {
      label: "פעילות כללית",
      keywords: [],
      planets: [],
      houses: [],
    },
  });

  const PERIODS = Object.freeze([
    { pattern: /(?:ב|ה)?בוקר/u, start: 8 * 60, end: 12 * 60 },
    { pattern: /(?:בשעות\s+)?הצהריים|בצהריים/u, start: 11 * 60, end: 14 * 60 },
    { pattern: /אחר\s*הצהריים|אחה[״"]?צ/u, start: 14 * 60, end: 18 * 60 },
    { pattern: /(?:ב|ה)?ערב/u, start: 18 * 60, end: 22 * 60 },
    { pattern: /(?:ב|ה)?לילה/u, start: 21 * 60, end: 23 * 60 + 30 },
  ]);

  const HEBREW_MONTHS = Object.freeze({
    "ינואר": 1, "פברואר": 2, "מרץ": 3, "מרס": 3, "אפריל": 4,
    "מאי": 5, "יוני": 6, "יולי": 7, "אוגוסט": 8, "ספטמבר": 9,
    "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const normalize = value => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0591-\u05C7]/g, "")
    .toLowerCase()
    .replace(/[״"'.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  function sanitizeVisibleText(value) {
    return String(value ?? "")
      .replace(/\bnot\s+good\b/gi, "")
      .replace(/\bgood\b/gi, "")
      .replace(/\bhouse\s*[:#-]?\s*(\d{1,2})\b/gi, "בית $1")
      .replace(/\bhouse\b/gi, "")
      .replace(/\b(?:trigger|instruction|prompt|system|quality|category|score|source)\s*[:=-][^\n|]*/gi, "")
      .replace(/^[\s|·–—-]*(?:house|good|not good|trigger|instruction|prompt|system|quality|category|score|source)\b.*$/gim, "")
      .replace(/\s*\|\s*/g, " · ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function israelDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      minutes: Number(values.hour) * 60 + Number(values.minute),
    };
  }

  function addDays(dateText, days) {
    const [year, month, day] = dateText.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }

  function detectActivity(question) {
    const text = normalize(question);
    let best = "general";
    let bestScore = 0;
    for (const [id, activity] of Object.entries(ACTIVITIES)) {
      if (id === "general") continue;
      const score = activity.keywords.reduce((sum, keyword) => sum + (text.includes(normalize(keyword)) ? 1 : 0), 0);
      if (score > bestScore) {
        best = id;
        bestScore = score;
      }
    }
    return best;
  }

  function parseHebrewHour(text) {
    const entries = Object.entries(HEBREW_HOURS).sort((a, b) => b[0].length - a[0].length);
    for (const [word, hour] of entries) {
      if (text.includes(word)) return hour;
    }
    return null;
  }

  function parseQuestion(question, options = {}) {
    const nowParts = israelDateParts(options.now || new Date());
    const context = options.context || {};
    const text = normalize(question);
    const tomorrow = /\bמחר\b/u.test(text);
    const targetDate = tomorrow
      ? (context.tomorrowDate || addDays(context.todayDate || nowParts.date, 1))
      : (context.todayDate || nowParts.date);
    const period = PERIODS.find(item => item.pattern.test(text)) || null;
    let exactMinutes = null;

    const numeric = text.match(/(?:בשעה\s*)?(\d{1,2})(?:[:.]([0-5]\d))?/u);
    if (numeric) {
      let hour = Number(numeric[1]);
      const minute = Number(numeric[2] || 0);
      if (hour <= 7 && period && period.start >= 11 * 60) hour += 12;
      if (hour === 12 && period?.start === 21 * 60) hour = 0;
      if (hour <= 23) exactMinutes = hour * 60 + minute;
    } else {
      let hour = parseHebrewHour(text);
      if (hour !== null) {
        if (hour <= 7 && period && period.start >= 11 * 60) hour += 12;
        exactMinutes = hour * 60;
      }
    }

    const windowStart = exactMinutes ?? period?.start ?? (tomorrow ? 8 * 60 : Math.ceil(nowParts.minutes / 30) * 30);
    const windowEnd = exactMinutes ?? period?.end ?? 21 * 60;
    return {
      question: String(question || "").trim(),
      activity: detectActivity(question),
      targetDate,
      tomorrow,
      exactMinutes,
      windowStart: clamp(windowStart, 0, 23 * 60 + 30),
      windowEnd: clamp(Math.max(windowStart, windowEnd), 0, 23 * 60 + 30),
      period: Boolean(period),
    };
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") return value;
    }
    return "";
  }

  function normalizeProcess(raw, fallbackDate = "") {
    const houseValue = Number(firstValue(raw, ["house", "transitHouse", "houseNumber", "House"]));
    return {
      id: String(firstValue(raw, ["id", "sourceId", "processId"]) || ""),
      title: sanitizeVisibleText(firstValue(raw, ["title", "caption", "name", "Caption Hebrew"])),
      text: sanitizeVisibleText(firstValue(raw, ["recommendation", "interpretation", "text", "description", "Text Male Hebrew"])),
      transit: sanitizeVisibleText(firstValue(raw, ["transitHe", "transit", "transitPlanet", "TransitPlanet"])),
      natal: sanitizeVisibleText(firstValue(raw, ["natalHe", "natal", "natalPlanet", "natalPoint", "NatalPlanet"])),
      aspect: sanitizeVisibleText(firstValue(raw, ["aspectHe", "aspect", "aspectName", "Aspect"])),
      aspectNature: sanitizeVisibleText(firstValue(raw, ["aspectNature", "quality", "nature"])),
      category: sanitizeVisibleText(firstValue(raw, ["category", "rubric", "type"])),
      house: Number.isFinite(houseValue) && houseValue >= 1 && houseValue <= 12 ? houseValue : null,
      start: firstValue(raw, ["start", "startsAt", "startTime", "from"]),
      peak: firstValue(raw, ["peak", "peaksAt", "peakTime", "exactAt"]),
      end: firstValue(raw, ["end", "endsAt", "endTime", "to"]),
      fallbackDate,
    };
  }

  function parseProcessesFromHtml(html, fallbackDate = "") {
    const source = String(html || "");
    const patterns = [
      /const\s+processes\s*=\s*(\[[\s\S]*?\])\s*;\s*const\s/u,
      /(?:window\.)?processes\s*=\s*(\[[\s\S]*?\])\s*;/u,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (!match) continue;
      try {
        const parsed = JSON.parse(match[1]);
        if (Array.isArray(parsed)) return parsed.map(item => normalizeProcess(item, fallbackDate));
      } catch {}
    }
    return [];
  }

  function collectContext(documentRef, injected = null) {
    const context = injected || (typeof globalThis !== "undefined" ? globalThis.__MCM_ASTRODAMOS_CONTEXT__ : null) || {};
    const todayDate = context.todayDate || israelDateParts().date;
    const tomorrowDate = context.tomorrowDate || addDays(todayDate, 1);
    const collected = [];

    const add = (items, fallbackDate) => {
      if (!Array.isArray(items)) return;
      items.forEach(item => collected.push(normalizeProcess(item, fallbackDate)));
    };
    add(context.today?.processes || context.todayProcesses, todayDate);
    add(context.tomorrow?.processes || context.tomorrowProcesses, tomorrowDate);

    if (documentRef?.scripts) {
      for (const script of documentRef.scripts) {
        const parsed = parseProcessesFromHtml(script.textContent || "", todayDate);
        parsed.forEach(item => collected.push(item));
      }
    }

    const unique = new Map();
    collected.forEach((process, index) => {
      const key = process.id || [process.title, process.transit, process.natal, process.aspect, process.start, process.peak, process.end, index].join("|");
      if (!unique.has(key)) unique.set(key, process);
    });
    return { todayDate, tomorrowDate, processes: [...unique.values()] };
  }

  function parseMoment(value, fallbackDate = "") {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value).trim();
    let match = text.match(/(\d{4})-(\d{2})-(\d{2})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match) return { date: `${match[1]}-${match[2]}-${match[3]}`, minutes: Number(match[4]) * 60 + Number(match[5]) };
    match = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match) return { date: `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`, minutes: Number(match[4]) * 60 + Number(match[5]) };
    match = text.match(/(\d{1,2})[./-](\d{1,2})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match && fallbackDate) {
      const year = fallbackDate.slice(0, 4);
      return { date: `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`, minutes: Number(match[3]) * 60 + Number(match[4]) };
    }
    match = text.match(/(\d{1,2})\s+ב?([א-ת]+)(?:\s+(\d{4}))?[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match && HEBREW_MONTHS[match[2]]) {
      const year = match[3] || fallbackDate.slice(0, 4);
      if (year) {
        return {
          date: `${year}-${String(HEBREW_MONTHS[match[2]]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`,
          minutes: Number(match[4]) * 60 + Number(match[5]),
        };
      }
    }
    match = text.match(/(?:^|\s)(\d{1,2}):([0-5]\d)(?:\s|$)/u);
    if (match) return { date: fallbackDate, minutes: Number(match[1]) * 60 + Number(match[2]) };
    return null;
  }

  function absoluteMinute(moment) {
    if (!moment?.date) return null;
    const [year, month, day] = moment.date.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86400000) * 1440 + moment.minutes;
  }

  function processStrength(process, date, minutes) {
    const targetAbsolute = absoluteMinute({ date, minutes });
    const start = parseMoment(process.start, process.fallbackDate || date);
    const peak = parseMoment(process.peak, process.fallbackDate || date);
    const end = parseMoment(process.end, process.fallbackDate || date);
    const startAbsolute = absoluteMinute(start);
    const peakAbsolute = absoluteMinute(peak);
    const endAbsolute = absoluteMinute(end);

    if (startAbsolute !== null && endAbsolute !== null) {
      if (targetAbsolute < startAbsolute || targetAbsolute > endAbsolute) return 0;
      if (peakAbsolute !== null) {
        const span = Math.max(60, Math.max(peakAbsolute - startAbsolute, endAbsolute - peakAbsolute));
        return clamp(1 - Math.abs(targetAbsolute - peakAbsolute) / span * 0.45, 0.55, 1);
      }
      return 0.72;
    }
    if (peakAbsolute !== null) {
      const distance = Math.abs(targetAbsolute - peakAbsolute);
      return distance <= 180 ? clamp(1 - distance / 360, 0.45, 1) : 0;
    }
    return 0;
  }

  function polarity(process) {
    const text = normalize([process.aspect, process.aspectNature].join(" "));
    if (/trine|משולש|120/.test(text)) return 1;
    if (/sextile|שישית|60/.test(text)) return 0.82;
    if (/biquintile|144|quintile|חמישית|72/.test(text)) return 0.62;
    if (/semi sextile|semisextile|חצי שישית|30/.test(text)) return 0.3;
    if (/square|ריבוע|90/.test(text)) return -1;
    if (/opposition|מולות|180/.test(text)) return -0.95;
    if (/quincunx|150/.test(text)) return -0.68;
    if (/semi square|semisquare|חצי ריבוע|45/.test(text)) return -0.55;
    if (/friction|challenge|tension|קושי|מתח|חיכוך/.test(text)) return -0.55;
    if (/supportive|harmon|תמיכה|הרמונ/.test(text)) return 0.55;
    return 0;
  }

  function relevance(process, activityId) {
    const activity = ACTIVITIES[activityId] || ACTIVITIES.general;
    if (activityId === "general") return 0.8;
    const text = normalize([process.title, process.text, process.transit, process.natal, process.category].join(" "));
    const planetHits = activity.planets.reduce((sum, planet) => sum + (text.includes(normalize(planet)) ? 1 : 0), 0);
    const keywordHits = activity.keywords.reduce((sum, keyword) => sum + (text.includes(normalize(keyword)) ? 1 : 0), 0);
    const houseHit = process.house && activity.houses.includes(process.house) ? 1 : 0;
    return clamp(0.55 + Math.min(planetHits, 2) * 0.2 + Math.min(keywordHits, 2) * 0.15 + houseHit * 0.2, 0.45, 1.35);
  }

  function evaluateMoment(processes, date, minutes, activityId = "general") {
    const active = processes.map(process => {
      const strength = processStrength(process, date, minutes);
      const aspectPolarity = polarity(process);
      const activityRelevance = relevance(process, activityId);
      return { process, strength, polarity: aspectPolarity, relevance: activityRelevance, contribution: aspectPolarity * strength * activityRelevance };
    }).filter(item => item.strength > 0 && item.relevance >= 0.45);

    if (!active.length) return { date, minutes, activity: activityId, score: null, confidence: 0, supportive: [], challenging: [], neutral: [] };
    const supportive = active.filter(item => item.contribution > 0.05).sort((a, b) => b.contribution - a.contribution);
    const challenging = active.filter(item => item.contribution < -0.05).sort((a, b) => a.contribution - b.contribution);
    const neutral = active.filter(item => Math.abs(item.contribution) <= 0.05).sort((a, b) => b.strength - a.strength);
    const supportTotal = supportive.slice(0, 4).reduce((sum, item) => sum + item.contribution, 0);
    const challengeTotal = challenging.slice(0, 4).reduce((sum, item) => sum + Math.abs(item.contribution), 0);
    const score = clamp(Math.round((6 + supportTotal * 1.25 - challengeTotal * 1.35) * 10) / 10, 1, 10);
    return {
      date,
      minutes,
      activity: activityId,
      score,
      confidence: clamp(active.length / 4, 0.25, 1),
      supportive,
      challenging,
      neutral,
    };
  }

  function formatTime(minutes) {
    const safe = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function scorePhrase(score) {
    if (score >= 8.5) return "זמן מצוין";
    if (score >= 7.5) return "זמן טוב מאוד";
    if (score >= 6.5) return "זמן טוב";
    if (score >= 5.5) return "זמן סביר";
    if (score >= 4.5) return "זמן בינוני";
    return "לא הזמן המועדף";
  }

  function processLabel(item) {
    const process = item.process;
    const title = sanitizeVisibleText(process.title);
    if (title) return title;
    const connection = [process.transit, process.aspect, process.natal].filter(Boolean).join(" · ");
    return sanitizeVisibleText(connection || "תהליך אישי פעיל");
  }

  function reasonSentence(result) {
    const support = result.supportive[0];
    const challenge = result.challenging[0];
    if (support && challenge) return `יש כאן תמיכה מצד „${processLabel(support)}”, אבל גם צורך להתחשב ב„${processLabel(challenge)}”.`;
    if (support) return `הגורם התומך המרכזי הוא „${processLabel(support)}”.`;
    if (challenge) return `הגורם שדורש זהירות הוא „${processLabel(challenge)}”.`;
    return "החישוב אינו מצביע על יתרון או קושי חד־משמעי בשעה הזאת.";
  }

  function availableDates(processes) {
    const dates = new Set();
    for (const process of processes) {
      for (const value of [process.start, process.peak, process.end]) {
        const parsed = parseMoment(value, process.fallbackDate);
        if (parsed?.date) dates.add(parsed.date);
      }
      if (process.fallbackDate) dates.add(process.fallbackDate);
    }
    return dates;
  }

  function scanAlternatives(processes, request, requestedResult, limit = 2) {
    const dates = availableDates(processes);
    const scanDates = [request.targetDate, addDays(request.targetDate, 1)].filter((date, index, list) => dates.has(date) && list.indexOf(date) === index);
    const candidates = [];
    for (const date of scanDates) {
      const start = date === request.targetDate
        ? Math.max(8 * 60, request.exactMinutes !== null ? request.exactMinutes + 30 : request.windowStart)
        : 8 * 60;
      for (let minute = start; minute <= 21 * 60; minute += 30) {
        const result = evaluateMoment(processes, date, minute, request.activity);
        if (result.score === null) continue;
        if (requestedResult?.score !== null && result.score < requestedResult.score + 0.5) continue;
        candidates.push(result);
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.minutes - b.minutes);
    const selected = [];
    for (const candidate of candidates) {
      if (selected.some(item => item.date === candidate.date && Math.abs(item.minutes - candidate.minutes) < 90)) continue;
      selected.push(candidate);
      if (selected.length === limit) break;
    }
    return selected;
  }

  function describeAlternative(result, todayDate) {
    const day = result.date === todayDate ? "היום" : result.date === addDays(todayDate, 1) ? "מחר" : result.date;
    return `${day} ב־${formatTime(result.minutes)} (${result.score}/10)`;
  }

  function detailRows(result) {
    const rows = [];
    const add = (item, tone) => {
      const process = item.process;
      const technical = [process.transit, process.aspect, process.natal].filter(Boolean).join(" · ");
      const house = process.house ? ` · בית ${process.house}` : "";
      rows.push({
        tone,
        title: processLabel(item),
        technical: sanitizeVisibleText(technical + house),
      });
    };
    result.supportive.slice(0, 3).forEach(item => add(item, "תומך"));
    result.challenging.slice(0, 3).forEach(item => add(item, "דורש זהירות"));
    result.neutral.slice(0, 2).forEach(item => add(item, "רקע"));
    return rows;
  }

  function bestActivityInWindow(processes, request) {
    const activityIds = Object.keys(ACTIVITIES).filter(id => id !== "general");
    const candidates = [];
    const start = Math.floor(request.windowStart / 30) * 30;
    const end = Math.max(start, request.windowEnd);
    for (let minutes = start; minutes <= end; minutes += 30) {
      for (const activity of activityIds) {
        const result = evaluateMoment(processes, request.targetDate, minutes, activity);
        if (result.score !== null) candidates.push(result);
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
    return candidates[0] || null;
  }

  function answerQuestion({ question, context, now = new Date() }) {
    const safeContext = context || { todayDate: israelDateParts(now).date, processes: [] };
    const request = parseQuestion(question, { now, context: safeContext });
    const processes = Array.isArray(safeContext.processes) ? safeContext.processes.map(item => normalizeProcess(item, item.fallbackDate)) : [];

    if (!request.question) return { answer: "כתוב לי מה אתה מתכנן ומתי.", details: null, request };
    if (!processes.length) {
      return {
        answer: "אין לי כרגע נתוני חישוב אישיים מספיקים כדי לענות על השעה הזאת ביושר. אני לא אשלים אותם בניחוש.",
        details: null,
        request,
      };
    }

    if (request.activity === "general") {
      const best = bestActivityInWindow(processes, request);
      if (!best) {
        return { answer: "לא נמצא חישוב שעתי מספיק לחלון שביקשת. עדיף לבחור שעה או פעילות אחרת ולבדוק שוב.", details: null, request };
      }
      const activity = ACTIVITIES[best.activity];
      const rangeLabel = request.exactMinutes !== null ? `ב־${formatTime(best.minutes)}` : `בחלון שביקשת, סביב ${formatTime(best.minutes)}`;
      const answer = `${rangeLabel}, הכיוון החזק ביותר הוא ${activity.label} — ${best.score}/10. ${reasonSentence(best)}`;
      return {
        answer: sanitizeVisibleText(answer),
        score: best.score,
        details: {
          summary: `נבדקו התהליכים האישיים הפעילים ב־${formatTime(best.minutes)} לפי שעון ישראל.`,
          rows: detailRows(best),
        },
        request: { ...request, activity: best.activity },
      };
    }

    const targetMinutes = request.exactMinutes ?? request.windowStart;
    const result = evaluateMoment(processes, request.targetDate, targetMinutes, request.activity);
    if (result.score === null) {
      return {
        answer: `אין מספיק נתוני חישוב אישיים ל${ACTIVITIES[request.activity].label} ב־${formatTime(targetMinutes)}. אני מעדיף לומר זאת מאשר לתת ציון מלאכותי.`,
        details: null,
        request,
      };
    }

    const alternatives = scanAlternatives(processes, request, result);
    const activity = ACTIVITIES[request.activity];
    let answer = `${formatTime(targetMinutes)} הוא ${scorePhrase(result.score)} ל${activity.label} — ${result.score}/10. ${reasonSentence(result)}`;
    if (alternatives.length) {
      answer += ` אם השעה גמישה, עדיף לבדוק ${alternatives.map(item => describeAlternative(item, safeContext.todayDate)).join(" או ")}.`;
    } else if (result.score >= 6.5) {
      answer += " אין כרגע חלופה מחושבת שנותנת שיפור משמעותי, ולכן אפשר להשאיר את התכנון כפי שהוא.";
    } else {
      answer += " לא מצאתי בחישוב הזמין חלופה טובה משמעותית, ולכן כדאי לבדוק יום נוסף לפני שקובעים.";
    }

    return {
      answer: sanitizeVisibleText(answer),
      score: result.score,
      alternatives,
      details: {
        summary: `הציון מבוסס על התהליכים האישיים הפעילים ב־${formatTime(targetMinutes)} ועל מידת ההתאמה שלהם ל${activity.label}.`,
        rows: detailRows(result),
      },
      request,
    };
  }

  return Object.freeze({
    ACTIVITIES,
    addDays,
    answerQuestion,
    collectContext,
    evaluateMoment,
    formatTime,
    normalizeProcess,
    parseProcessesFromHtml,
    parseQuestion,
    sanitizeVisibleText,
  });
});
