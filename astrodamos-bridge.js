(() => {
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const normalize = value => String(value || "").toLowerCase().replace(/[״"'.,!?;:()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = value => normalize(value).split(" ").filter(word => word.length > 2);
  const keywordGroups = {
    "רגש": ["ירח","רגש","ביטחון","בית","צורך","תחושה"],
    "קשר": ["ונוס","קשר","זוג","יחסים","אהבה","שותפות"],
    "פעולה": ["מרס","פעולה","יוזמה","כוח","עשייה","אומץ"],
    "שיחה": ["מרקורי","תקשורת","שיחה","לימוד","מחשבה"],
    "עבודה": ["קריירה","עבודה","מטרה","שבתאי","אחריות","הישג"],
    "זמן": ["מעבר","תהליך","היום","מחר","שיא","חלון","זמן"],
  };
  function reportChunks() {
    return [...document.querySelectorAll("h1,h2,h3,h4,.short-item,.timeline-card,.process-card,.list-panel")]
      .map(node => {
        const title = node.matches("h1,h2,h3,h4") ? node.textContent : node.querySelector("h2,h3,h4")?.textContent || "";
        const text = node.textContent || "";
        return { title:normalize(title), text:normalize(text), raw:text.replace(/\s+/g, " ").trim() };
      })
      .filter(item => item.raw.length > 50 && item.raw.length < 2500);
  }
  function search(question) {
    const wanted = new Set(tokens(question));
    for (const [trigger, words] of Object.entries(keywordGroups)) {
      if (normalize(question).includes(trigger)) words.forEach(word => wanted.add(word));
    }
    const ranked = reportChunks().map(item => {
      const haystack = item.title + " " + item.text;
      const score = [...wanted].reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0) + (item.title ? 0.4 : 0);
      return {...item, score};
    }).filter(item => item.score > 0).sort((a,b) => b.score - a.score);
    return ranked.slice(0, 2);
  }
  function inject() {
    if (document.getElementById("astrodamos-panel")) return;
    const section = document.createElement("section");
    section.id = "astrodamos-panel";
    section.innerHTML = `
      <style>
        #astrodamos-panel{margin:24px auto;padding:20px;max-width:780px;border:1px solid #b89546;border-radius:18px;background:linear-gradient(135deg,#101c31,#09101d);color:#f7f0e4;direction:rtl;text-align:right;font-family:Arial,sans-serif}
        #astrodamos-panel h2{margin:0 0 8px;color:#f2c46d;font-size:24px}#astrodamos-panel p{line-height:1.6}
        #astrodamos-question{width:100%;min-height:92px;border-radius:12px;border:1px solid #6983a2;background:#07111f;color:#fff;padding:12px;font:inherit;resize:vertical}
        #astrodamos-ask{margin-top:10px;padding:11px 18px;border:0;border-radius:12px;background:#f2c46d;color:#201606;font-weight:bold;font-size:16px;cursor:pointer}
        #astrodamos-answer{margin-top:16px;padding:14px;border-right:3px solid #5fd1f6;background:#0a1525;white-space:pre-wrap;line-height:1.7}
        #astrodamos-source{margin-top:10px;color:#b9d5e7;font-size:14px}
      </style>
      <h2>Astrodamos</h2>
      <p>שאל/י שאלה על הדוח האישי שלך. בשלב הראשון Astrodamos נשען רק על התוכן המפוענח והמאומת בדוח הנוכחי.</p>
      <textarea id="astrodamos-question" placeholder="למשל: מה חשוב לי להבין היום ביחסים או בעבודה?"></textarea>
      <button id="astrodamos-ask" type="button">שאל את Astrodamos</button>
      <div id="astrodamos-answer" aria-live="polite">מוכן לשאלה.</div>
      <div id="astrodamos-source">שקיפות: אין כאן המצאה של נתונים אסטרולוגיים חדשים; התשובה נשענת על קטעים מהדוח האישי בלבד.</div>
    `;
    const anchor = document.querySelector("#timing") || document.querySelector("main") || document.body;
    anchor.insertAdjacentElement("afterend", section);
    const input = section.querySelector("#astrodamos-question");
    const answer = section.querySelector("#astrodamos-answer");
    const ask = () => {
      const question = input.value.trim();
      if (!question) { answer.textContent = "כתוב/י את השאלה שברצונך לשאול."; return; }
      const matches = search(question);
      if (!matches.length) {
        answer.textContent = "בדוח הנוכחי אין עדיין קטע שמספיק כדי לענות על השאלה הזאת ביושר. Astrodamos לא ישלים את החסר בניחוש.";
        return;
      }
      answer.innerHTML = "<strong>מה נמצא בדוח האישי:</strong>\n\n" + matches.map(item => escapeHtml(item.raw)).join("\n\n");
    };
    section.querySelector("#astrodamos-ask").addEventListener("click", ask);
    input.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") ask(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject, {once:true});
  else inject();
})();