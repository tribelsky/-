import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

assert.ok(inlineScripts.length > 0, "index.html must contain an inline loader script");

for (const [index, source] of inlineScripts.entries()) {
  new Script(source, { filename: `index.inline.${index + 1}.js` });
}

assert.ok(!html.includes("<\\\\/script>"), "generated script tags must close without a literal backslash");

const generatedScriptTemplates = ["mentorRetirementScript", "processTimingScript", "dailyFeedbackScript"];
for (const templateName of generatedScriptTemplates) {
  const pattern = templateName === "dailyFeedbackScript"
    ? /const dailyFeedbackScript = requestedPage === "today" \? (`[\s\S]*?`) : "";/
    : new RegExp(`const ${templateName} = (\\\`[\\s\\S]*?\\\`);`);
  const template = html.match(pattern);
  assert.ok(template, `${templateName} template must exist`);
  const generatedHtml = new Script(template[1], {
    filename: `${templateName}-template.js`,
  }).runInNewContext();
  const generatedSource = generatedHtml.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(generatedSource, `${templateName} must generate an inline script`);
  new Script(generatedSource, { filename: `generated-${templateName}.js` });
}

console.log(JSON.stringify({
  status: "PASS",
  check: "All inline and generated report scripts parse as valid JavaScript",
  scripts: inlineScripts.length + generatedScriptTemplates.length,
}, null, 2));
