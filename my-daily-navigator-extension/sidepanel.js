(() => {
  "use strict";

  const nodes = {
    connect: document.getElementById("connect"),
    refresh: document.getElementById("refresh"),
    status: document.getElementById("status"),
    meetings: document.getElementById("meetings"),
    dailyScore: document.getElementById("daily-score"),
    dailyBand: document.getElementById("daily-band"),
    biorhythm: document.getElementById("biorhythm"),
    biorhythmBars: document.getElementById("biorhythm-bars"),
    authorizeSync: document.getElementById("authorize-sync"),
    disconnectSync: document.getElementById("disconnect-sync"),
    bridgeStatus: document.getElementById("bridge-status"),
  };

  const t = key => chrome.i18n.getMessage(key) || key;

  function applyLocale() {
    const language = chrome.i18n.getUILanguage();
    document.documentElement.lang = language;
    document.documentElement.dir = /^he(?:-|$)/i.test(language) ? "rtl" : "ltr";
    document.querySelectorAll("[data-i18n]").forEach(node => {
      node.textContent = t(node.dataset.i18n);
    });
  }

  function bandLabel(band) {
    if (band === "high") return t("highAlignment");
    if (band === "moderate") return t("moderateAlignment");
    if (band === "challenging") return t("challengingAlignment");
    return "—";
  }

  function formatTime(value, timeZone) {
    return new Intl.DateTimeFormat(document.documentElement.lang, {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  function renderBiorhythm(meetings) {
    const bio = meetings.find(item => item.score?.components?.biorhythm?.available)?.score.components.biorhythm;
    nodes.biorhythmBars.replaceChildren();
    if (!bio) {
      nodes.biorhythm.hidden = true;
      return;
    }
    const labels = { physical: t("physical"), emotional: t("emotional"), intellectual: t("intellectual") };
    Object.entries(bio.cycles || {}).forEach(([name, cycle]) => {
      const row = document.createElement("div");
      row.className = "bio-row";
      const label = document.createElement("span");
      label.textContent = labels[name] || name;
      const track = document.createElement("div");
      track.className = "bio-track";
      const fill = document.createElement("div");
      fill.className = "bio-fill";
      fill.style.width = `${Math.max(0, Math.min(100, (cycle.percentage + 100) / 2))}%`;
      track.appendChild(fill);
      const value = document.createElement("strong");
      value.textContent = `${cycle.percentage}%`;
      row.append(label, track, value);
      nodes.biorhythmBars.appendChild(row);
    });
    nodes.biorhythm.hidden = false;
  }

  function renderAlternatives(list, container, timeZone) {
    container.replaceChildren();
    if (!list.length) {
      const item = document.createElement("li");
      item.textContent = t("calculationUnavailable");
      container.appendChild(item);
      return;
    }
    list.forEach(alternative => {
      const item = document.createElement("li");
      const date = new Intl.DateTimeFormat(document.documentElement.lang, {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(alternative.event.start));
      item.textContent = `${date} — ${alternative.score.value}/100`;
      container.appendChild(item);
    });
  }

  function meetingCard(item, timeZone) {
    const article = document.createElement("article");
    article.className = "meeting";
    const head = document.createElement("div");
    head.className = "meeting-head";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.event.title;
    const time = document.createElement("time");
    time.dateTime = item.event.start;
    time.textContent = `${formatTime(item.event.start, timeZone)}–${formatTime(item.event.end, timeZone)}`;
    copy.append(title, time);
    const score = document.createElement("span");
    score.className = `score ${item.score.band}`;
    score.textContent = Number.isFinite(item.score.value) ? `${item.score.value}/100` : "—";
    head.append(copy, score);
    article.appendChild(head);

    const factor = document.createElement("p");
    factor.className = "factor";
    factor.textContent = item.factors?.[0]?.title || t("calculationUnavailable");
    article.appendChild(factor);

    const alternatives = document.createElement("ul");
    alternatives.className = "alternatives";
    alternatives.hidden = true;
    article.appendChild(alternatives);

    if (Number.isFinite(item.score.value)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("findAlternatives");
      button.addEventListener("click", async () => {
        button.disabled = true;
        const response = await chrome.runtime.sendMessage({ type: "MCM_FIND_ALTERNATIVES", event: { id: item.event.id, summary: item.event.title, start: { dateTime: item.event.start, timeZone }, end: { dateTime: item.event.end, timeZone } }, interactive: true });
        renderAlternatives(response.ok ? response.alternatives || [] : [], alternatives, timeZone);
        alternatives.hidden = false;
        button.disabled = false;
      });
      article.appendChild(button);
    }
    return article;
  }

  function renderMeetings(meetings, timeZone) {
    nodes.meetings.replaceChildren();
    if (!meetings.length) {
      const empty = document.createElement("p");
      empty.textContent = t("noMeetings");
      nodes.meetings.appendChild(empty);
    } else {
      meetings.forEach(item => nodes.meetings.appendChild(meetingCard(item, timeZone)));
    }

    const scores = meetings.map(item => item.score?.value).filter(Number.isFinite);
    const average = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
    const band = average === null ? "unavailable" : average >= 80 ? "high" : average >= 55 ? "moderate" : "challenging";
    nodes.dailyScore.textContent = average === null ? "—" : `${average}/100`;
    nodes.dailyBand.className = `pill ${band}`;
    nodes.dailyBand.textContent = bandLabel(band);
    renderBiorhythm(meetings);
  }

  function formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat(document.documentElement.lang, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Jerusalem",
    }).format(new Date(value));
  }

  async function refreshBridgeStatus() {
    const response = await chrome.runtime.sendMessage({ type: "MCM_GET_BRIDGE_STATUS" });
    if (!response?.ok) {
      nodes.bridgeStatus.textContent = `${t("errorTitle")}: ${response?.error || "bridge-status-unavailable"}`;
      return;
    }
    nodes.disconnectSync.hidden = !response.connected;
    if (response.connected) {
      nodes.bridgeStatus.textContent = `${t("personalDataConnected")} ${formatDateTime(response.expiresAt)}`;
    } else if (response.approvalPending) {
      nodes.bridgeStatus.textContent = t("syncApprovalReady");
    } else {
      nodes.bridgeStatus.textContent = t("personalDataDisconnected");
    }
  }

  async function load(interactive = false) {
    nodes.refresh.disabled = true;
    nodes.status.textContent = t("loading");
    const response = await chrome.runtime.sendMessage({ type: "MCM_GET_TODAY", interactive });
    if (!response?.ok) {
      nodes.status.textContent = `${t("errorTitle")}: ${response?.error || "unknown-error"}`;
      nodes.connect.hidden = false;
      nodes.refresh.disabled = false;
      return;
    }
    nodes.connect.hidden = true;
    nodes.status.textContent = "";
    renderMeetings(response.meetings || [], response.timeZone);
    nodes.refresh.disabled = false;
  }

  nodes.connect.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "MCM_CONNECT_CALENDAR" });
    if (response?.ok) await load(false);
    else nodes.status.textContent = `${t("errorTitle")}: ${response?.error || "calendar-auth-required"}`;
  });
  nodes.refresh.addEventListener("click", () => load(false));
  nodes.authorizeSync.addEventListener("click", async () => {
    nodes.authorizeSync.disabled = true;
    const response = await chrome.runtime.sendMessage({ type: "MCM_AUTHORIZE_CONTEXT_SYNC" });
    nodes.bridgeStatus.textContent = response?.ok
      ? t("syncApprovalReady")
      : `${t("errorTitle")}: ${response?.error || "sync-approval-failed"}`;
    nodes.authorizeSync.disabled = false;
  });
  nodes.disconnectSync.addEventListener("click", async () => {
    nodes.disconnectSync.disabled = true;
    const response = await chrome.runtime.sendMessage({ type: "MCM_DISCONNECT_CONTEXT" });
    if (response?.ok) await refreshBridgeStatus();
    else nodes.bridgeStatus.textContent = `${t("errorTitle")}: ${response?.error || "disconnect-failed"}`;
    nodes.disconnectSync.disabled = false;
  });

  applyLocale();
  refreshBridgeStatus();
  load(false);
})();
