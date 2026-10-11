// Lifecycle contract for the Feishu tool-summary aggregation patch.
//
// These checks exist because the 19 predicate tests cannot see the streaming
// lifecycle at all — they exercise an extracted copy of the accept/reject
// decision. Two shipped variants got that wrong in opposite directions:
//
//   v1      aggregator called startStreaming() and idle closed the card after
//           every tool group -> one turn produced 3-4 cards.
//   方案 A  aggregator stopped calling startStreaming() -> with renderMode=auto
//           the only upstream path that opens a card is onPartialReply (first
//           text token), so tool summaries always arrived before any card
//           existed and aggregation was structurally unreachable. 119s of
//           silence, no aggregate line.
//
// The fix needs BOTH halves, so both are asserted:
//
//   * the aggregator must open the card early, or aggregation never triggers;
//   * onIdle must hold that card open across idle, or each tool group opens a
//     fresh one.
//
// Asserting either alone passes a broken variant. Checked against all three:
//
//   node tests/lifecycle.test.mjs <patched.mjs> <original.mjs>

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [, , patchedArg, originalArg] = process.argv;

const patchedPath = patchedArg ?? resolve(here, "..", "patches", "feishu-tool-aggregation-2026.10.1.patch");
if (!originalArg) {
	console.error("usage: node tests/lifecycle.test.mjs <patched.mjs> <original.mjs>");
	console.error("Both are required: the card-count invariant is about what the patch ADDS.");
	process.exit(2);
}

const patched = readFileSync(patchedPath, "utf8");
const original = readFileSync(originalArg, "utf8");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
	ok ? pass++ : fail++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

const count = (src, needle) => src.split(needle).length - 1;

// Pull a function body by brace balancing, so we never reproduce it.
const bodyOf = (src, signature) => {
	const start = src.indexOf(signature);
	if (start < 0) return "";
	let depth = 0;
	for (let i = src.indexOf("{", start); i < src.length; i++) {
		if (src[i] === "{") depth++;
		else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
	}
	return "";
};

const agg = bodyOf(patched, "const aggregateCollapsibleToolSummary = async");

// --- half 1: the aggregator must open the card early ---

check("aggregator exists", agg.length > 0);
check(
	"aggregator opens the card early (or aggregation is unreachable)",
	agg.includes("startStreaming()"),
	"方案 A removed this and killed aggregation",
);
check("aggregator awaits the start before checking", agg.includes("await streamingStartPromise"));
check(
	"aggregator still requires an active stream",
	agg.includes("if (!streaming?.isActive()) return false;"),
);

// --- half 2: idle must not close the card mid-batch ---

const idleStart = patched.indexOf("onIdle: () =>");
const idleBody = idleStart < 0 ? "" : patched.slice(idleStart, patched.indexOf("}),", idleStart) + 3);
check("onIdle handler exists", idleStart >= 0);
check(
	"onIdle holds the card open while a tool batch accumulates",
	idleBody.includes("aggregatedToolSummaryLine !== \"\"") && idleBody.includes("return;"),
	"v1 closed the card after every tool group -> 3-4 cards per turn",
);
check(
	"onIdle still queues finalisation when the reply is arriving",
	idleBody.includes("queueIdleSideEffects();"),
);
check(
	"onIdle guard releases on text, reasoning or a delivered final",
	/!streamText/.test(idleBody) && /!reasoningText/.test(idleBody) && /deliveredFinalTexts\.size === 0/.test(idleBody),
	"without every release signal the card could stay open forever",
);

// --- exactly one added startStreaming call site ---

const added = count(patched, "startStreaming()") - count(original, "startStreaming()");
check(
	"patch adds exactly one startStreaming() call site",
	added === 1,
	`added=${added} (expected 1: the aggregator)`,
);

// --- structural guards on the other edits ---

for (const [name, needle] of [
	["reply-scoped state exists", "const aggregatedToolSummaryCounts = /* @__PURE__ */ new Map();"],
	["aggregate line exists", 'let aggregatedToolSummaryLine = "";'],
	["deliver intercept exists", "parseCollapsibleToolSummary(inputPayload, info)"],
	["discard guard exists", 'const shouldDiscardStreamingPreview = aggregatedToolSummaryLine === "" &&'],
]) {
	check(name, patched.includes(needle));
}

const clears = count(patched, "aggregatedToolSummaryCounts.clear();");
check("counts cleared on both reset paths", clears >= 2, `found ${clears}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);