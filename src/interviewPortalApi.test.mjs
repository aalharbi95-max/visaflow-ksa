import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureInterviewAuth,
  readAndClearInterviewInvitation,
  validateInterviewMedia,
} from "./interviewPortalApi.mjs";

test("invitation secret is read from the fragment and immediately removed", () => {
  let replaced = "";
  const secret = "a".repeat(64);
  const result = readAndClearInterviewInvitation(
    { hash: `#interview_invite=${secret}`, pathname: "/", search: "" },
    { replaceState: (_a, _b, value) => { replaced = value; } },
  );
  assert.equal(result, secret);
  assert.equal(replaced, "/");
});

test("query strings are never treated as interview invitation secrets", () => {
  assert.equal(readAndClearInterviewInvitation(
    { hash: "", pathname: "/", search: `?ai_interview=${"a".repeat(64)}` },
    { replaceState: () => assert.fail("must not rewrite without a fragment secret") },
  ), "");
});

test("media validation enforces MIME and size", () => {
  assert.deepEqual(validateInterviewMedia({ type: "audio/webm", size: 1024 }), { contentType: "audio/webm", size: 1024 });
  assert.throws(() => validateInterviewMedia({ type: "text/html", size: 10 }));
  assert.throws(() => validateInterviewMedia({ type: "audio/webm", size: 26 * 1024 * 1024 }));
});

test("interview auth reuses only its own existing session", async () => {
  let anonymousCalls = 0;
  const session = { user: { id: "portal-user" } };
  const result = await ensureInterviewAuth({
    auth: {
      getSession: async () => ({ data: { session } }),
      signInAnonymously: async () => { anonymousCalls += 1; return { data: { session }, error: null }; },
    },
  });
  assert.equal(result, session);
  assert.equal(anonymousCalls, 0);
});
