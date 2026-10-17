((root, factory) => {
  const bridge = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = bridge;
  root.McmWebsiteExtensionBridge = bridge;
  if (root.document) bridge.mount();
})(typeof globalThis !== "undefined" ? globalThis : window, root => {
  "use strict";

  const PROTOCOL_VERSION = "1.1.0";
  const ACTIVITY_CATEGORIES = Object.freeze([
    "ROMANCE",
    "BUSINESS_CONTRACT",
    "SOCIAL",
    "CREATIVE",
    "WELLNESS",
    "GENERAL_EXECUTION",
  ]);
  const HEBREW_MONTHS = Object.freeze({
    ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6,
    יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
  });

  const clean = (value, max) => String(value ?? "")
    .replace(/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);

  const validExtensionId = value => /^[a-p]{32}$/u.test(String(value || ""));

  function normalizeScore(value, nullable = false) {
    if (nullable && value === null) return null;
    const score = Number(value);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("activity-timing-matrix-invalid");
    return Math.round(score * 10) / 10;
  }

  function normalizeTime(value) {
    const time = clean(value, 5);
    const match = time.match(/^(\d{2}):([0-5]\d)$/u);
    if (!match || Number(match[1]) > 23) throw new Error("activity-timing-matrix-invalid");
    return time;
  }

  function normalizeActivityTimingMatrix(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("activity-timing-matrix-unavailable");
    const timezone = clean(raw.timezone, 64);
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
    } catch {
      throw new Error("activity-timing-matrix-invalid");
    }
    if (!raw.categories || typeof raw.categories !== "object" || Array.isArray(raw.categories)) {
      throw new Error("activity-timing-matrix-invalid");
    }
    const categories = {};
    for (const categoryId of Object.keys(raw.categories)) {
      if (!ACTIVITY_CATEGORIES.includes(categoryId)) throw new Error("activity-timing-matrix-invalid");
      const source = raw.categories[categoryId];
      if (!source || typeof source !== "object" || typeof source.isDataAvailable !== "boolean") {
        throw new Error("activity-timing-matrix-invalid");
      }
      const hourlyScores = {};
      for (const [time, score] of Object.entries(source.hourlyScores || {})) {
        hourlyScores[normalizeTime(time)] = normalizeScore(score);
      }
      const optimalWindows = (source.optimalWindows || []).map(window => ({
        start: normalizeTime(window.start),
        end: normalizeTime(window.end),
        score: normalizeScore(window.score),
        ruler: clean(window.ruler, 256),
      }));
      categories[categoryId] = {
        isDataAvailable: source.isDataAvailable,
        dailySummaryScore: normalizeScore(source.dailySummaryScore, true),
        hourlyScores,
        optimalWindows,
      };
    }
    if (!Object.keys(categories).length) throw new Error("activity-timing-matrix-unavailable");
    return { timezone, categories };
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
      year: Number(values.year), month: Number(values.month), day: Number(values.day),
      hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second),
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
    const targetDate = new Date(Date.UTC(local.year, local.month - 1, local.day + (local.hour < 7 ? 0 : 1)));
    return zonedLocalToEpoch({
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate(),
      hour: 7,
    });
  }

  function isoFromLocal(dateText, hour, minute) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateText || "")) return null;
    const [year, month, day] = dateText.split("-").map(Number);
    const epoch = zonedLocalToEpoch({ year, month, day, hour, minute });
    return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
  }

  function normalizeMoment(value, fallbackDate) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(text)) {
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
    }
    let match = text.match(/(\d{4})-(\d{2})-(\d{2})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match) return isoFromLocal(`${match[1]}-${match[2]}-${match[3]}`, Number(match[4]), Number(match[5]));
    match = text.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match) return isoFromLocal(`${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`, Number(match[4]), Number(match[5]));
    match = text.match(/(\d{1,2})[./-](\d{1,2})[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match && fallbackDate) {
      return isoFromLocal(`${fallbackDate.slice(0, 4)}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`, Number(match[3]), Number(match[4]));
    }
    match = text.match(/(\d{1,2})\s+ב?([א-ת]+)(?:\s+(\d{4}))?[^\d]+(\d{1,2}):([0-5]\d)/u);
    if (match && HEBREW_MONTHS[match[2]]) {
      const year = match[3] || String(fallbackDate || "").slice(0, 4);
      if (year) return isoFromLocal(`${year}-${String(HEBREW_MONTHS[match[2]]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`, Number(match[4]), Number(match[5]));
    }
    match = text.match(/(?:^|\s)(\d{1,2}):([0-5]\d)(?:\s|$)/u);
    if (match && fallbackDate) return isoFromLocal(fallbackDate, Number(match[1]), Number(match[2]));
    return null;
  }

  function normalizeProcess(raw, index, fallbackDate, engine) {
    const process = engine.normalizeProcess(raw, raw?.fallbackDate || fallbackDate);
    const processDate = /^\d{4}-\d{2}-\d{2}$/u.test(process.fallbackDate || "") ? process.fallbackDate : fallbackDate;
    return {
      id: clean(process.id || `process-${index + 1}`, 128),
      title: clean(process.title, 256),
      text: clean(process.text, 2048),
      transit: clean(process.transit, 128),
      natal: clean(process.natal, 128),
      aspect: clean(process.aspect, 128),
      aspectNature: clean(process.aspectNature, 128),
      category: clean(process.category, 128),
      house: Number.isInteger(process.house) && process.house >= 1 && process.house <= 12 ? process.house : null,
      start: normalizeMoment(process.start, processDate),
      peak: normalizeMoment(process.peak, processDate),
      end: normalizeMoment(process.end, processDate),
      fallbackDate: processDate,
    };
  }

  function reportRevision(now) {
    const raw = clean(root.document?.querySelector('meta[name="mcm-revision"]')?.content, 128);
    return raw || new Date(now).toISOString();
  }

  function buildPayload(challenge, now = Date.now()) {
    const sourceContext = root.__MCM_ASTRODAMOS_CONTEXT__;
    if (!sourceContext) throw new Error("astrodamos-context-unavailable");
    const reportDate = clean(sourceContext.reportDate || sourceContext.todayDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(reportDate)) throw new Error("astrodamos-context-unavailable");
    const activityTimingMatrix = normalizeActivityTimingMatrix(sourceContext.activityTimingMatrix);
    const revision = reportRevision(now);
    const revisionTime = Date.parse(revision);
    const generatedAt = Number.isFinite(revisionTime) && revisionTime <= now + 5 * 60_000 && revisionTime >= now - 36 * 60 * 60_000
      ? new Date(revisionTime).toISOString()
      : new Date(now).toISOString();
    return {
      type: "MCM_CONTEXT_COMMIT",
      protocolVersion: PROTOCOL_VERSION,
      meta: {
        challenge,
        generatedAt,
        expiresAt: new Date(nextIsraelRollover(now)).toISOString(),
        reportDate,
      },
      activityTimingMatrix,
      processes: [],
    };
  }

  function sendExternalMessage(extensionId, message) {
    return new Promise((resolve, reject) => {
      const runtime = root.chrome?.runtime;
      if (!runtime?.sendMessage) {
        reject(new Error("extension-messaging-unavailable"));
        return;
      }
      runtime.sendMessage(extensionId, message, response => {
        const error = runtime.lastError;
        if (error) reject(new Error("extension-unreachable"));
        else resolve(response);
      });
    });
  }

  async function synchronize(extensionId, now = Date.now()) {
    if (!validExtensionId(extensionId)) throw new Error("extension-id-not-configured");
    const init = await sendExternalMessage(extensionId, { type: "MCM_SYNC_INIT", protocolVersion: PROTOCOL_VERSION });
    if (!init?.ok) throw new Error(init?.error || "sync-init-failed");
    if (!/^[A-Za-z0-9_-]{43}$/u.test(init.challenge || "") || Date.parse(init.expiresAt) <= now) throw new Error("sync-challenge-invalid");
    const response = await sendExternalMessage(extensionId, buildPayload(init.challenge, now));
    if (!response?.ok) throw new Error(response?.error || "sync-commit-failed");
    return response;
  }

  function userMessage(errorCode) {
    if (errorCode === "sync-approval-required") return "פתח תחילה את התוסף ואשר סנכרון חד־פעמי, ואז נסה כאן שוב.";
    if (errorCode === "extension-id-not-configured") return "החיבור ממתין למזהה התוסף הקבוע מ־Chrome Developer Dashboard.";
    if (errorCode === "extension-unreachable" || errorCode === "extension-messaging-unavailable") return "התוסף עדיין אינו מותקן או אינו זמין בדפדפן הזה.";
    if (errorCode === "astrodamos-context-unavailable") return "נתוני התזמון האישיים עדיין לא נטענו במלואם.";
    if (errorCode === "activity-timing-matrix-unavailable") return "מטריצת התזמון האישית לפי סוג פעילות עדיין לא חושבה. לא יישלח ציון חלופי או משוער.";
    if (errorCode === "activity-timing-matrix-invalid") return "מטריצת התזמון האישית אינה תקינה ולכן לא נשלחה לתוסף.";
    return "הסנכרון לא הושלם. הנתונים הקיימים לא שונו; אפשר לאשר שוב בתוסף ולנסות מחדש.";
  }

  function injectPanel() {
    if (root.document.getElementById("mcm-calendar-sync")) return;
    const section = root.document.createElement("section");
    section.id = "mcm-calendar-sync";
    section.setAttribute("aria-labelledby", "mcm-calendar-sync-title");
    section.innerHTML = `
      <style>
        #mcm-calendar-sync{margin:24px auto;padding:20px;max-width:780px;border:1px solid #547da2;border-radius:18px;background:linear-gradient(135deg,#0e2137,#08121f);color:#f7f0e4;direction:rtl;text-align:right;font-family:Arial,sans-serif}
        #mcm-calendar-sync h2{margin:0 0 8px;color:#9fd9f5;font-size:22px}
        #mcm-calendar-sync p{line-height:1.6}
        #mcm-calendar-sync button{padding:11px 18px;border:0;border-radius:12px;background:#f2c46d;color:#201606;font-weight:bold;font-size:16px;cursor:pointer}
        #mcm-calendar-sync button:disabled{cursor:not-allowed;opacity:.55}
        #mcm-calendar-sync-status{margin:12px 0 0;color:#c7d9e8;font-size:14px}
      </style>
      <h2 id="mcm-calendar-sync-title">חיבור התזמון האישי ליומן</h2>
      <p>לאחר אישור חד־פעמי בתוסף, אפשר להעביר אליו מטריצת שעות אישית ומוכנה לפי סוג פעילות. התוסף אינו מפרש טקסטים ואינו מקבל את מפת הלידה, הקישור האישי או מפתח הפענוח.</p>
      <button id="mcm-calendar-sync-button" type="button">חיבור ליומן</button>
      <p id="mcm-calendar-sync-status" role="status" aria-live="polite"></p>
    `;
    const anchor = root.document.getElementById("astrodamos-panel") || root.document.querySelector("main") || root.document.body;
    anchor.insertAdjacentElement("afterend", section);
    const button = section.querySelector("#mcm-calendar-sync-button");
    const status = section.querySelector("#mcm-calendar-sync-status");
    const extensionId = root.__MCM_EXTENSION_ID__;
    if (!validExtensionId(extensionId)) {
      button.disabled = true;
      status.textContent = userMessage("extension-id-not-configured");
      return;
    }
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "מחבר את נתוני התזמון האישיים…";
      try {
        const response = await synchronize(extensionId);
        status.textContent = `החיבור הושלם. הנתונים בתוקף עד ${new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }).format(new Date(response.expiresAt))}.`;
      } catch (error) {
        status.textContent = userMessage(error?.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  function mount() {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", injectPanel, { once: true });
    else injectPanel();
  }

  return Object.freeze({
    PROTOCOL_VERSION,
    buildPayload,
    mount,
    nextIsraelRollover,
    normalizeActivityTimingMatrix,
    normalizeMoment,
    synchronize,
    validExtensionId,
  });
});
