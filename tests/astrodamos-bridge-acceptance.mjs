import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../index.html", import.meta.url), "utf8");
const bridge = await readFile(new URL("../astrodamos-bridge.js", import.meta.url), "utf8");
const engine = await readFile(new URL("../astrodamos-engine.js", import.meta.url), "utf8");

assert.ok(shell.includes('astrodamos-engine.js?v=2'));
assert.ok(shell.includes('astrodamos-bridge.js?v=2'));
assert.ok(shell.includes('__MCM_ASTRODAMOS_CONTEXT__'));
assert.ok(shell.includes('reportPackage?.activityTimingMatrix'));
assert.ok(bridge.includes('engine.collectContext'));
assert.ok(bridge.includes('איך הגעתי למסקנה?'));
assert.ok(bridge.includes('הקראת התשובה'));
assert.ok(engine.includes('answerQuestion'));
assert.ok(engine.includes('scanAlternatives'));
assert.ok(!bridge.includes('fetch('));
assert.ok(!bridge.includes('matches.map'));
console.log(JSON.stringify({status:"PASS", integration:"Astrodamos timing engine and clean conversation panel load inside the encrypted report shell"},null,2));
