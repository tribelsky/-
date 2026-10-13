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

console.log(JSON.stringify({
  status: "PASS",
  check: "All inline scripts in index.html parse as valid JavaScript",
  scripts: inlineScripts.length,
}, null, 2));
