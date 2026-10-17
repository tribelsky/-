(() => {
  "use strict";

  const ANCHOR_ID = "mcm-daily-navigator-anchor";
  let scheduled = false;

  function findHeader() {
    return document.querySelector('[role="banner"]')
      || document.querySelector('header')
      || document.querySelector('[role="main"]');
  }

  function injectAnchor() {
    scheduled = false;
    if (document.getElementById(ANCHOR_ID)) return;
    const header = findHeader();
    if (!header) return;

    const button = document.createElement("button");
    button.id = ANCHOR_ID;
    button.type = "button";
    button.textContent = "✦";
    button.title = chrome.i18n.getMessage("actionTitle");
    button.setAttribute("aria-label", chrome.i18n.getMessage("anchorAriaLabel"));
    Object.assign(button.style, {
      width: "34px",
      height: "34px",
      marginInline: "8px",
      border: "1px solid #a78642",
      borderRadius: "50%",
      background: "#10233d",
      color: "#f2c46d",
      fontSize: "20px",
      lineHeight: "30px",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.22)",
      zIndex: "20",
      flex: "0 0 auto",
    });
    button.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "MCM_OPEN_SIDE_PANEL" }).catch(() => {});
    });
    header.appendChild(button);
  }

  function scheduleInjection() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(injectAnchor);
  }

  scheduleInjection();
  const observer = new MutationObserver(scheduleInjection);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
