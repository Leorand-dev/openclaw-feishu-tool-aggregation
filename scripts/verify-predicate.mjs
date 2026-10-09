// Confirm the predicate shipped in a patched plugin bundle is the one the
// contract tests were written against.
//
//   node scripts/verify-predicate.mjs <patched.mjs> [contract.test.mjs]
//
// Exists because a patch can apply cleanly to a new bundle while its predicate
// has silently drifted. The unit tests pass either way — they test their own
// copy. This checks the shipped one.
//
// Not a substitute for `node tests/contract.test.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const [, , bundlePath, testPath = resolve(here, "..", "tests", "contract.test.mjs")] =
	process.argv;

if (!bundlePath) {
	console.error("usage: node scripts/verify-predicate.mjs <patched-bundle.mjs> [contract.test.mjs]");
	process.exit(2);
}

// Pull the predicate out of a source file by brace-balanced scan, so we do not
// have to reproduce it — whatever is in the file is what ships.
const grab = (src, label) => {
	const key = "const parseCollapsibleToolSummary = (payload, info) => ";
	const start = src.indexOf(key);
	if (start < 0) throw new Error(`${label}: parseCollapsibleToolSummary not found — is this bundle patched?`);
	let depth = 0;
	for (let k = src.indexOf("{", start + key.length); k < src.length; k++) {
		if (src[k] === "{") depth++;
		else if (src[k] === "}" && --depth === 0) return src.slice(start, src.indexOf(";", k) + 1);
	}
	throw new Error(`${label}: unbalanced braces — predicate not extractable`);
};

// Collapse whitespace and unify every spelling of the NUL separator: the plugin
// bundle emits  "\\u0000"  while a hand-written test file may contain a real
// NUL byte. Both mean the same thing.
const norm = (s) =>
	s
		.replace(/\r/g, "")
		.replace(/\x00/g, "\\0")
		.replace(/\\u0000/g, "\\0")
		.replace(/\s+/g, " ")
		.trim();

const bundle = grab(readFileSync(bundlePath, "utf8"), "bundle");
const test = grab(readFileSync(testPath, "utf8"), "contract test");

if (norm(bundle) === norm(test)) {
	console.log(`PREDICATE IDENTICAL — bundle matches ${testPath}`);
	process.exit(0);
}

console.log("PREDICATE DIFFERS — the shipped bundle no longer matches the contract tests.\n");
console.log("bundle:", norm(bundle));
console.log("\ntest  :", norm(test));
process.exit(1);