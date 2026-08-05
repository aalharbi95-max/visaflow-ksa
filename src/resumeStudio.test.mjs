import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../supabase/functions/visaflow-talent-resume-studio/index.ts", import.meta.url), "utf8");

test("resume studio never emits replacement question marks for Unicode punctuation", () => {
  assert.doesNotMatch(source, /replace\(\/\[\^\\x20-\\x7E\]\/g,\s*["']\?["']\)/);
  assert.match(source, /replace\(\/\[\\u2010-\\u2015\\u2212\]\/g, "-"\)/);
  assert.match(source, /prefix: "- "/);
});

test("resume studio strips internal AI notes and unknown placeholders", () => {
  assert.match(source, /candidate-provided/);
  assert.match(source, /preserved exactly/);
  assert.match(source, /source cv/);
  assert.match(source, /not specified\|unknown/);
  assert.match(source, /Return resume content only/);
});

test("resume studio protects PDF pagination and metadata", () => {
  assert.match(source, /ensureSpace\(Math\.min\(blockHeight/);
  assert.match(source, /Page \$\{index \+ 1\} of \$\{pages\.length\}/);
  assert.match(source, /pdf\.setTitle/);
  assert.match(source, /titleCaseName/);
});
