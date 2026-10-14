"use strict";

importScripts(
  "engine/astrodamos.js",
  "engine/biorhythm.js",
  "engine/moon_transit.js",
  "engine/calendar_bridge.js",
  "engine/secure_bridge.js"
);

const LEGACY_STORAGE_KEYS = Object.freeze({
  context: "mcmAstrodamosContext",
  profile: "mcmProfile",
  moonTimeline: "mcmMoonTimeline",
  scoringWeights: "mcmScoringWeights",
});

let commitQueue = Promise.resolve();

function serializeCommit(task) {
  const result = commitQueue.then(task, task);
  commitQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function setTrustedStorageAccess() {
  await Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: McmSecureBridge.TRUSTED_CONTEXTS }),
    chrome.storage.session.setAccessLevel({ accessLevel: McmSecureBridge.TRUSTED_CONTEXTS }),
  ]);
}

async function purgeExpiredBridge(now = Date.now()) {
  const stored = await chrome.storage.local.get(McmSecureBridge.BRIDGE_STORAGE_KEY);
  const envelope = stored[McmSecureBridge.BRIDGE_STORAGE_KEY];
  if (envelope && !McmSecureBridge.isStoredEnvelopeUsable(envelope, { now })) {
    await chrome.storage.local.remove(McmSecureBridge.BRIDGE_STORAGE_KEY);
    return true;
  }
  return false;
}

async function initializeSecureStorage() {
  await setTrustedStorageAccess();
  await purgeExpiredBridge();
}

const secureStorageReady = initializeSecureStorage();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  initializeSecureStorage().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  initializeSecureStorage().catch(() => {});
});

async function getCalendarToken(interactive) {
  const result = await chrome.identity.getAuthToken({ interactive: Boolean(interactive) });
  const token = typeof result === "string" ? result : result?.token;
  if (!token) throw new Error("calendar-auth-required");
  return token;
}

async function calendarRequest(path, token, options = {}) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    throw new Error("calendar-auth-expired");
  }
  if (!response.ok) throw new Error(`calendar-api-${response.status}`);
  return response.json();
}

function todayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

async function loadRuntimeData() {
  await secureStorageReady;
  await purgeExpiredBridge();
  const stored = await chrome.storage.local.get(McmSecureBridge.BRIDGE_STORAGE_KEY);
  return McmSecureBridge.runtimeDataFromEnvelope(stored[McmSecureBridge.BRIDGE_STORAGE_KEY]);
}

async function listTodayMeetings(interactive = false) {
  const token = await getCalendarToken(interactive);
  const bounds = todayBounds();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const query = new URLSearchParams({
    timeMin: bounds.timeMin,
    timeMax: bounds.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
    timeZone,
  });
  const payload = await calendarRequest(`/calendars/primary/events?${query}`, token);
  const runtime = await loadRuntimeData();
  const meetings = (payload.items || [])
    .filter(event => event.status !== "cancelled" && event.start?.dateTime)
    .map(event => CalendarAstrodamosBridge.evaluateCalendarEvent({ event, ...runtime, timeZone }));
  return { meetings, timeZone, date: new Date().toISOString().slice(0, 10) };
}

function overlapsBusy(start, end, busy) {
  return busy.some(item => start < new Date(item.end) && end > new Date(item.start));
}

function buildFreeSlots({ timeMin, timeMax, busy = [], durationMinutes = 60, stepMinutes = 30 }) {
  const slots = [];
  const cursor = new Date(timeMin);
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / stepMinutes) * stepMinutes, 0, 0);
  const limit = new Date(timeMax);
  while (cursor < limit) {
    const hour = cursor.getHours();
    const end = new Date(cursor.getTime() + durationMinutes * 60000);
    if (hour >= 8 && hour < 20 && end <= limit && !overlapsBusy(cursor, end, busy)) {
      slots.push({ start: cursor.toISOString(), end: end.toISOString() });
    }
    cursor.setMinutes(cursor.getMinutes() + stepMinutes);
  }
  return slots;
}

async function findAlternatives(event, interactive = false, lookaheadDays = 3) {
  const token = await getCalendarToken(interactive);
  const timeMin = new Date(Math.max(Date.now(), new Date(event?.end?.dateTime || event?.start?.dateTime || Date.now()).getTime()));
  const timeMax = new Date(timeMin);
  timeMax.setDate(timeMax.getDate() + Math.min(5, Math.max(1, Number(lookaheadDays) || 3)));
  const freeBusy = await calendarRequest("/freeBusy", token, {
    method: "POST",
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: "primary" }],
    }),
  });
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const durationMinutes = Math.max(30, Math.round((end - start) / 60000));
  const freeSlots = buildFreeSlots({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    busy: freeBusy.calendars?.primary?.busy || [],
    durationMinutes,
  });
  const runtime = await loadRuntimeData();
  const timeZone = event.start.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return CalendarAstrodamosBridge.rankCalendarAlternatives({ event, freeSlots, ...runtime, timeZone });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await secureStorageReady;
    switch (message?.type) {
      case "MCM_OPEN_SIDE_PANEL":
        if (!McmSecureBridge.isTrustedCalendarContentSender(sender, chrome.runtime.id)) throw new Error("unauthorized-calendar-sender");
        if (!sender.tab?.id) throw new Error("calendar-tab-unavailable");
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        return { ok: true };
      case "MCM_CONNECT_CALENDAR":
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        await getCalendarToken(true);
        return { ok: true };
      case "MCM_GET_TODAY":
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        return { ok: true, ...(await listTodayMeetings(Boolean(message.interactive))) };
      case "MCM_FIND_ALTERNATIVES":
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        return { ok: true, alternatives: await findAlternatives(message.event, Boolean(message.interactive), message.lookaheadDays) };
      case "MCM_AUTHORIZE_CONTEXT_SYNC": {
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        const now = Date.now();
        const approval = {
          origin: McmSecureBridge.APPROVED_ORIGIN,
          createdAt: now,
          expiresAt: now + McmSecureBridge.APPROVAL_TTL_MS,
        };
        await chrome.storage.session.set({ [McmSecureBridge.APPROVAL_STORAGE_KEY]: approval });
        return { ok: true, expiresAt: new Date(approval.expiresAt).toISOString() };
      }
      case "MCM_GET_BRIDGE_STATUS": {
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        await purgeExpiredBridge();
        const [local, session] = await Promise.all([
          chrome.storage.local.get(McmSecureBridge.BRIDGE_STORAGE_KEY),
          chrome.storage.session.get(McmSecureBridge.APPROVAL_STORAGE_KEY),
        ]);
        const envelope = local[McmSecureBridge.BRIDGE_STORAGE_KEY];
        const approval = session[McmSecureBridge.APPROVAL_STORAGE_KEY];
        return {
          ok: true,
          connected: McmSecureBridge.isStoredEnvelopeUsable(envelope),
          reportDate: envelope?.meta?.reportDate || null,
          expiresAt: envelope?.effectiveExpiresAt || null,
          approvalPending: Boolean(approval?.expiresAt > Date.now()),
          approvalExpiresAt: approval?.expiresAt ? new Date(approval.expiresAt).toISOString() : null,
        };
      }
      case "MCM_DISCONNECT_CONTEXT":
        if (!McmSecureBridge.isTrustedExtensionPageSender(sender, chrome.runtime.id, chrome.runtime.getURL(""))) throw new Error("unauthorized-extension-sender");
        await Promise.all([
          chrome.storage.local.remove(McmSecureBridge.BRIDGE_STORAGE_KEY),
          chrome.storage.session.remove([
            McmSecureBridge.APPROVAL_STORAGE_KEY,
            McmSecureBridge.CHALLENGE_STORAGE_KEY,
          ]),
        ]);
        return { ok: true };
      case "MCM_SAVE_CONTEXT":
        return { ok: false, error: "legacy-context-write-disabled" };
      default:
        return { ok: false, error: "unknown-message" };
    }
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || "unexpected-error" }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    await secureStorageReady;
    const binding = McmSecureBridge.validateExternalSender(sender);

    if (message?.type === "MCM_SYNC_INIT") {
      McmSecureBridge.validateInitMessage(message);
      const stored = await chrome.storage.session.get(McmSecureBridge.APPROVAL_STORAGE_KEY);
      const approval = stored[McmSecureBridge.APPROVAL_STORAGE_KEY];
      if (!approval || approval.origin !== binding.origin || approval.expiresAt <= Date.now()) {
        await chrome.storage.session.remove([
          McmSecureBridge.APPROVAL_STORAGE_KEY,
          McmSecureBridge.CHALLENGE_STORAGE_KEY,
        ]);
        throw new Error("sync-approval-required");
      }
      const challengeRecord = McmSecureBridge.createChallengeRecord(binding);
      await chrome.storage.session.set({ [McmSecureBridge.CHALLENGE_STORAGE_KEY]: challengeRecord });
      return {
        ok: true,
        challenge: challengeRecord.challenge,
        expiresAt: new Date(challengeRecord.expiresAt).toISOString(),
      };
    }

    if (message?.type === "MCM_CONTEXT_COMMIT") {
      return serializeCommit(async () => {
        const stored = await chrome.storage.session.get(McmSecureBridge.CHALLENGE_STORAGE_KEY);
        const challengeRecord = stored[McmSecureBridge.CHALLENGE_STORAGE_KEY];
        McmSecureBridge.validateChallengeRecord(challengeRecord, binding, message?.meta?.challenge);

        await chrome.storage.session.remove([
          McmSecureBridge.APPROVAL_STORAGE_KEY,
          McmSecureBridge.CHALLENGE_STORAGE_KEY,
        ]);

        const validated = McmSecureBridge.validateEnvelope(message);
        const envelope = McmSecureBridge.buildStoredEnvelope(validated);
        await chrome.storage.local.set({ [McmSecureBridge.BRIDGE_STORAGE_KEY]: envelope });
        await chrome.storage.local.remove(Object.values(LEGACY_STORAGE_KEYS));
        return {
          ok: true,
          reportDate: envelope.meta.reportDate,
          expiresAt: envelope.effectiveExpiresAt,
        };
      });
    }

    throw new Error("unknown-external-message");
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || "unexpected-error" }));
  return true;
});
