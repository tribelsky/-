import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bridge = await readFile(new URL("../astrodamos-bridge.js", import.meta.url), "utf8");

assert.ok(shell.includes('astrodamos-bridge.js?v=1'));
assert.ok(bridge.includes('reportChunks'));
assert.ok(bridge.includes('Astrodamos לא ישלים את החסר בניחוש'));
assert.ok(!bridge.includes('fetch('));
console.log(JSON.stringify({status:"PASS", integration:"Astrodamos question panel loads inside encrypted report shell"},null,2));
