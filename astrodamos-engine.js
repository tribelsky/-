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
      keywords: ["עסק", "עסקית", "לקוח", "משא ומתן", "ראיון", "שיווק", "מכירה", "חתימה", "חוזה"],
      planets: ["mercury", "venus", "jupiter", "saturn", "sun", "מרקורי", "ונוס", "יופיטר", "סטורן", "שמש"],
      houses: [2, 3, 6, 7, 10, 11],
    },
    conversation: {
      label: "שיחה חשובה",
      keywords: ["שיחה", "לדבר", "טלפון", "מייל", "הודעה", "תקשורת", "לשוחח"],
      planets: ["mercury", "moon", "venus", "מרקורי", "ירח", "ונוס"],
      houses: [3, 7, 11],
    },
    social: {
      label: "מפגש חברתי",
      keywords: ["חברתי", "חברתית", "חברים", "חברות", "מסיבה", "מפגש חברים", "social", "friends", "party"],
      planets: ["moon", "sun", "venus", "jupiter", "ירח", "שמש", "ונוס", "יופיטר"],
      houses: [3, 5, 7, 11],
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
      keywords: ["זוג", "זוגיות", "קשר", "יחסים", "אהבה", "רגש", "משפחה", "דייט", "רומנטי", "רומנטית", "רומנטיקה", "romance", "romantic"],
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

  const MATRIX_CATEGORY_BY_ACTIVITY = Object.freeze({
    business: "BUSINESS_CONTRACT",
    social: "SOCIAL",
    creative: "CREATIVE",
    action: "GENERAL_EXECUTION",
    relationship: "ROMANCE",
    rest: "WELLNESS",
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
      openEnded: /מה כדאי|מה מומלץ|מה לעשות|הזמן הכי טוב|השעה הכי טובה|what should|best time/iu.test(text),
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
    return {
      todayDate,
      tomorrowDate,
      reportDate: context.reportDate || todayDate,
      activityTimingMatrix: context.activityTimingMatrix || null,
      processes: [...unique.values()],
    };
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
    return `${day} ב־${formatTime(result.minutes)} (${result.score}/100)`;
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

  function matrixTimeMinutes(value) {
    const match = String(value || "").match(/^(\d{2}):([0-5]\d)$/u);
    if (!match || Number(match[1]) > 23) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function activityForMatrixCategory(categoryId) {
    return Object.entries(MATRIX_CATEGORY_BY_ACTIVITY).find(([, matrixId]) => matrixId === categoryId)?.[0] || null;
  }

  function categoryCandidates(category, request) {
    if (!category?.isDataAvailable) return [];
    const candidates = [];
    for (const [time, score] of Object.entries(category.hourlyScores || {})) {
      const minutes = matrixTimeMinutes(time);
      if (minutes === null || !Number.isFinite(score) || minutes < request.windowStart || minutes > request.windowEnd) continue;
      candidates.push({ minutes, score, ruler: null, source: "hourly-score" });
    }
    for (const window of category.optimalWindows || []) {
      const start = matrixTimeMinutes(window.start);
      const end = matrixTimeMinutes(window.end);
      if (start === null || end === null || !Number.isFinite(window.score) || end <= request.windowStart || start > request.windowEnd) continue;
      candidates.push({
        minutes: Math.max(start, request.windowStart),
        score: window.score,
        ruler: sanitizeVisibleText(window.ruler),
        source: "optimal-window",
        window: { start: window.start, end: window.end },
      });
    }
    return candidates.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
  }

  function alternativeRequest(request, activityId) {
    return {
      ...request,
      windowStart: activityId === "relationship" ? 17 * 60 : 10 * 60,
      windowEnd: 22 * 60 + 30,
    };
  }

  function exactMatrixResult(category, minutes) {
    if (!category?.isDataAvailable) return null;
    const exactKey = formatTime(minutes);
    const hourKey = formatTime(Math.floor(minutes / 60) * 60);
    const directScore = category.hourlyScores?.[exactKey] ?? category.hourlyScores?.[hourKey];
    const window = (category.optimalWindows || []).find(item => {
      const start = matrixTimeMinutes(item.start);
      const end = matrixTimeMinutes(item.end);
      return start !== null && end !== null && minutes >= start && minutes < end;
    });
    const score = Number.isFinite(directScore) ? directScore : window?.score;
    if (!Number.isFinite(score)) return null;
    return {
      minutes,
      score,
      ruler: sanitizeVisibleText(window?.ruler || ""),
      source: Number.isFinite(directScore) ? "hourly-score" : "optimal-window",
      window: window ? { start: window.start, end: window.end } : null,
    };
  }

  function unavailableMatrixAnswer(request, activityId, reason = "activity-data-unavailable") {
    const label = ACTIVITIES[activityId]?.label || "הפעילות שביקשת";
    return {
      answer: `אין כרגע שכבת תזמון יומית־שעתית מלאה ל${label} במועד שביקשת. אני לא אחליף אותה בציון של פעילות אחרת.`,
      score: null,
      status: "UNAVAILABLE",
      reason,
      alternatives: [],
      details: null,
      request,
    };
  }

  function matrixScorePhrase(score) {
    if (score >= 85) return "חלון חזק מאוד";
    if (score >= 75) return "חלון טוב";
    if (score >= 60) return "חלון אפשרי";
    if (score >= 40) return "חלון חלש יחסית";
    return "חלון שאינו מומלץ";
  }

  function matrixDetails(result, categoryId) {
    if (!result?.ruler) return null;
    return {
      summary: `הציון נלקח ממטריצת התזמון הסמכותית של ${categoryId}, ללא פירוש טקסט של תהליכים קצרים.`,
      rows: [{ tone: "תומך", title: result.ruler, technical: result.window ? `${result.window.start}–${result.window.end}` : "" }],
    };
  }

  function answerQuestion({ question, context, now = new Date() }) {
    const safeContext = context || { todayDate: israelDateParts(now).date, processes: [] };
    const request = parseQuestion(question, { now, context: safeContext });

    if (!request.question) return { answer: "כתוב לי מה אתה מתכנן ומתי.", details: null, request };
    const matrix = safeContext.activityTimingMatrix;
    const matrixDate = safeContext.reportDate || safeContext.todayDate;
    if (!matrix || matrixDate !== request.targetDate) return unavailableMatrixAnswer(request, request.activity, "timing-date-unavailable");

    if (request.activity === "general") {
      if (!request.openEnded) {
        return {
          answer: "לא ברור לי לאיזו פעילות אתה מחפש שעה. האם הכוונה לרומנטיקה, לפגישה עסקית, למפגש חברתי, ליצירה או לבריאות ומנוחה?",
          score: null,
          status: "CLARIFICATION_REQUIRED",
          details: null,
          request,
        };
      }
      const candidates = [];
      for (const [categoryId, category] of Object.entries(matrix.categories || {})) {
        const activityId = activityForMatrixCategory(categoryId);
        if (!activityId) continue;
        const result = request.exactMinutes !== null
          ? exactMatrixResult(category, request.exactMinutes)
          : categoryCandidates(category, request)[0];
        if (result) candidates.push({ ...result, activityId, categoryId });
      }
      candidates.sort((a, b) => b.score - a.score || a.minutes - b.minutes);
      const best = candidates[0];
      if (!best) return unavailableMatrixAnswer(request, "general");
      const activity = ACTIVITIES[best.activityId];
      const answer = `בחלון שביקשת, התחום החזק ביותר הוא ${activity.label}, סביב ${formatTime(best.minutes)} — ${best.score}/100.`;
      return {
        answer: sanitizeVisibleText(answer),
        score: best.score,
        status: "AVAILABLE",
        details: matrixDetails(best, best.categoryId),
        request: { ...request, activity: best.activityId },
      };
    }

    const categoryId = MATRIX_CATEGORY_BY_ACTIVITY[request.activity];
    if (!categoryId) {
      return {
        answer: "כדי לחשב שעה נכונה צריך לחדד את סוג הפעילות: עסקית, חברתית, רומנטית, יצירתית או בריאות ומנוחה.",
        score: null,
        status: "CLARIFICATION_REQUIRED",
        details: null,
        request,
      };
    }
    const category = matrix.categories?.[categoryId];
    if (!category?.isDataAvailable) return unavailableMatrixAnswer(request, request.activity);
    const result = request.exactMinutes !== null
      ? exactMatrixResult(category, request.exactMinutes)
      : categoryCandidates(category, request)[0];
    if (!result) return unavailableMatrixAnswer(request, request.activity, "hourly-score-unavailable");

    const alternatives = categoryCandidates(category, alternativeRequest(request, request.activity))
      .filter(item => item.score > result.score && Math.abs(item.minutes - result.minutes) >= 60)
      .slice(0, 2)
      .map(item => ({ date: request.targetDate, minutes: item.minutes, score: item.score, ruler: item.ruler }));
    const activity = ACTIVITIES[request.activity];
    const range = result.window ? `${result.window.start}–${result.window.end}` : `סביב ${formatTime(result.minutes)}`;
    let answer = `${range} הוא ${matrixScorePhrase(result.score)} ל${activity.label} — ${result.score}/100.`;
    if (result.ruler) answer += ` הגורם המרכזי: ${result.ruler}.`;
    if (alternatives.length) {
      answer += ` אם השעה גמישה, עדיף לבדוק ${alternatives.map(item => describeAlternative(item, safeContext.todayDate)).join(" או ")}.`;
    }

    return {
      answer: sanitizeVisibleText(answer),
      score: result.score,
      status: "AVAILABLE",
      alternatives,
      details: matrixDetails(result, categoryId),
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
