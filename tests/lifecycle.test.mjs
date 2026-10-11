// Lifecycle contract: the patch must never open a streaming card of its own.
//
// Regression test for a bug shipped on 2026-10-09 and noticed on 2026-10-11:
// aggregateCollapsibleToolSummary called startStreaming() itself. Upstream
// closes the card on idle, so every tool group opened a fresh Feishu card —
// one turn produced three or four instead of one.
//
// The predicate tests in contract.test.mjs cannot catch this: they exercise an
// extracted copy of the accept/reject decision and never touch the streaming
// lifecycle. These checks run against the shipped bundle.
//
//   node tests/lifecycle.test.mjs <patched.mjs> <original.mjs>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [, , patchedArg, originalArg] = process.argv;

const patchedPath = patchedArg ?? resolve(here, "..", "patches", "feishu-tool-aggregation-2026.10.1.patch");
const originalPath = originalArg;

if (!originalArg) {
	console.error("usage: node tests/lifecycle.test.mjs <patched.mjs> <original.mjs>");
	console.error("Both are needed: the invariant is about what the patch ADDS.");
	process.exit(2);
}

const patched = readFileSync(patchedPath, "utf8");
const original = readFileSync(originalPath, "utf8");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
	ok ? pass++ : fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

const count = (src, needle) => src.split(needle).length - 1;

// --- the invariant that broke ---

const patchedStarts = count(patched, "startStreaming()");
const originalStarts = count(original, "startStreaming()");
check(
	"patch adds no startStreaming() call site",
	patchedStarts === originalStarts,
	`patched=${patchedStarts} original=${originalStarts}`,
);

const aggregatorStart = patched.indexOf("const aggregateCollapsibleToolSummary");
const aggregator = aggregatorStart < 0 ? "" : patched.slice(aggregatorStart);
const aggregatorBody = aggregator.slice(0, aggregator.indexOf("\n\t};"));

check(
	"aggregator never calls startStreaming()",
	aggregator.length > 0 && !aggregatorBody.includes("startStreaming()"),
);

// The removed `await streamingStartPromise` is the other half of the bug: it
// blocked on a start the aggregator no longer requests. Naming it separately
// keeps this assertion from silently becoming redundant with the one above.
check(
	"aggregator never awaits streamingStartPromise",
	aggregator.length > 0 && !aggregatorBody.includes("streamingStartPromise"),
);

check(
	"aggregator still requires an active stream",
	aggregatorBody.includes("if (!streaming?.isActive()) return false;"),
);

// --- structural guards on the other six edits ---

for (const [name, needle] of [
	["reply-scoped state exists", "const aggregatedToolSummaryCounts = /* @__PURE__ */ new Map();"],
	["aggregate line exists", 'let aggregatedToolSummaryLine = "";'],
	["deliver intercept exists", "parseCollapsibleToolSummary(inputPayload, info)"],
	["discard guard exists", 'const shouldDiscardStreamingPreview = aggregatedToolSummaryLine === "" &&'],
]) {
	check(name, patched.includes(needle));
}

// Counts must clear on both reset paths, or the multiplier climbs across turns.
const clears = count(patched, "aggregatedToolSummaryCounts.clear();");
check("counts cleared on both reset paths", clears >= 2, `found ${clears}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);