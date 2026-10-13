(() => {
  "use strict";

  function inject() {
    if (document.getElementById("astrodamos-panel")) return;

    const section = document.createElement("section");
    section.id = "astrodamos-panel";
    section.innerHTML = `
      <style>
        #astrodamos-panel{margin:24px auto;padding:20px;max-width:780px;border:1px solid #b89546;border-radius:18px;background:linear-gradient(135deg,#101c31,#09101d);color:#f7f0e4;direction:rtl;text-align:right;font-family:Arial,sans-serif}
        #astrodamos-panel h2{margin:0 0 8px;color:#f2c46d;font-size:24px}
        #astrodamos-panel p{line-height:1.6}
        #astrodamos-question{width:100%;min-height:86px;border-radius:12px;border:1px solid #6983a2;background:#07111f;color:#fff;padding:12px;font:inherit;resize:vertical}
        #astrodamos-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
        #astrodamos-ask,#astrodamos-listen{padding:11px 18px;border:0;border-radius:12px;background:#f2c46d;color:#201606;font-weight:bold;font-size:16px;cursor:pointer}
        #astrodamos-listen{background:#17324d;color:#e9f7ff;border:1px solid #4f83a8}
        #astrodamos-listen[hidden]{display:none}
        #astrodamos-examples{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
        #astrodamos-examples button{border:1px solid #415e7a;border-radius:999px;padding:7px 11px;background:#0c1b2c;color:#dbeefe;cursor:pointer;font:inherit;font-size:13px}
        #astrodamos-answer{margin-top:16px;padding:14px;border-right:3px solid #5fd1f6;background:#0a1525;white-space:pre-wrap;line-height:1.75}
        #astrodamos-details{margin-top:12px;border:1px solid #314c68;border-radius:12px;background:#081321;padding:10px 12px}
        #astrodamos-details[hidden]{display:none}
        #astrodamos-details summary{cursor:pointer;color:#bfe7fb;font-weight:bold}
        #astrodamos-details ul{margin:10px 0 0;padding:0 20px 0 0}
        #astrodamos-details li{margin:8px 0;line-height:1.55}
        #astrodamos-details .support{color:#b9f1ce}#astrodamos-details .caution{color:#ffd3a1}#astrodamos-details .background{color:#c8d6e5}
        #astrodamos-source{margin-top:12px;color:#b9d5e7;font-size:13px;line-height:1.55}
      </style>
      <h2>Astrodamos</h2>
      <p>שאל אותי מה כדאי לעשות, או אם שעה מסוימת מתאימה. אני בודק את החישוב האישי לפי השעה — לא מעתיק את הדוח.</p>
      <textarea id="astrodamos-question" placeholder="למשל: יש לי פגישת עסקים היום בשתיים בצהריים. האם זה זמן טוב?"></textarea>
      <div id="astrodamos-examples" aria-label="שאלות לדוגמה">
        <button type="button" data-question="מה כדאי לי לעשות היום בשעות הצהריים?">מה כדאי בצהריים?</button>
        <button type="button" data-question="יש לי פגישת עסקים היום בשעה 14:00. האם זה זמן טוב או שעדיף זמן אחר?">פגישה היום ב־14:00</button>
      </div>
      <div id="astrodamos-actions">
        <button id="astrodamos-ask" type="button">שאל את Astrodamos</button>
        <button id="astrodamos-listen" type="button" hidden>▶ הקראת התשובה</button>
      </div>
      <div id="astrodamos-answer" aria-live="polite">מוכן לשאלה.</div>
      <details id="astrodamos-details" hidden>
        <summary>איך הגעתי למסקנה?</summary>
        <p id="astrodamos-detail-summary"></p>
        <ul id="astrodamos-detail-list"></ul>
      </details>
      <div id="astrodamos-source">התשובה היא מסקנה חדשה מתוך החישוב האישי המאומת. הנתונים הטכניים נשארים מוסתרים, אלא אם בוחרים לפתוח את ההסבר.</div>
    `;

    const anchor = document.querySelector("#timing") || document.querySelector("main") || document.body;
    anchor.insertAdjacentElement("afterend", section);

    const input = section.querySelector("#astrodamos-question");
    const answer = section.querySelector("#astrodamos-answer");
    const details = section.querySelector("#astrodamos-details");
    const detailSummary = section.querySelector("#astrodamos-detail-summary");
    const detailList = section.querySelector("#astrodamos-detail-list");
    const listen = section.querySelector("#astrodamos-listen");
    let lastAnswer = "";

    const renderDetails = calculation => {
      detailList.replaceChildren();
      details.open = false;
      if (!calculation?.rows?.length) {
        details.hidden = true;
        return;
      }
      detailSummary.textContent = calculation.summary || "";
      for (const row of calculation.rows) {
        const item = document.createElement("li");
        item.className = row.tone === "תומך" ? "support" : row.tone === "דורש זהירות" ? "caution" : "background";
        const tone = document.createElement("strong");
        tone.textContent = `${row.tone}: `;
        item.append(tone, document.createTextNode(row.title || "תהליך אישי"));
        if (row.technical) item.append(document.createElement("br"), document.createTextNode(row.technical));
        detailList.appendChild(item);
      }
      details.hidden = false;
    };

    const ask = () => {
      const question = input.value.trim();
      if (!question) {
        answer.textContent = "כתוב לי מה אתה מתכנן ומתי.";
        details.hidden = true;
        listen.hidden = true;
        return;
      }
      const engine = globalThis.AstrodamosEngine;
      if (!engine) {
        answer.textContent = "מנוע התזמון עדיין לא נטען. נסה לפתוח מחדש את האפליקציה.";
        details.hidden = true;
        listen.hidden = true;
        return;
      }
      const context = engine.collectContext(document, globalThis.__MCM_ASTRODAMOS_CONTEXT__);
      const result = engine.answerQuestion({ question, context, now: new Date() });
      lastAnswer = result.answer;
      answer.textContent = result.answer;
      renderDetails(result.details);
      listen.hidden = !lastAnswer || !("speechSynthesis" in globalThis);
    };

    const speak = () => {
      if (!lastAnswer || !("speechSynthesis" in globalThis)) return;
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(lastAnswer);
      utterance.lang = "he-IL";
      const hebrewVoice = speechSynthesis.getVoices().find(voice => /^he(?:-|_)/i.test(voice.lang));
      if (hebrewVoice) utterance.voice = hebrewVoice;
      speechSynthesis.speak(utterance);
    };

    section.querySelector("#astrodamos-ask").addEventListener("click", ask);
    listen.addEventListener("click", speak);
    section.querySelectorAll("[data-question]").forEach(button => {
      button.addEventListener("click", () => {
        input.value = button.dataset.question || "";
        ask();
      });
    });
    input.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") ask();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, { once: true });
  else inject();
})();
