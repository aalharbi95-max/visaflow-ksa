import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerTalentProfiles,
  getTalentEnabledPages,
  isTalentEmailNotConfirmed,
} from "./talentAccess.mjs";

test("owner Talent dashboard keeps every profile returned by the 50-row API", () => {
  const profiles = Array.from({ length: 14 }, (_, index) => ({ id: index + 1 }));
  assert.equal(getOwnerTalentProfiles(profiles).length, 14);
});

test("owner Talent dashboard still enforces the API display ceiling", () => {
  const profiles = Array.from({ length: 70 }, (_, index) => ({ id: index + 1 }));
  assert.equal(getOwnerTalentProfiles(profiles).length, 50);
});

test("Talent authentication recognizes Supabase unconfirmed-email errors", () => {
  assert.equal(isTalentEmailNotConfirmed({ code: "email_not_confirmed" }), true);
  assert.equal(isTalentEmailNotConfirmed(new Error("Email not confirmed")), true);
  assert.equal(isTalentEmailNotConfirmed(new Error("Invalid login credentials")), false);
});

test("an enabled Talent subscription reaches every company role", () => {
  assert.deepEqual(
    getTalentEnabledPages(["Dashboard", "Reports"], { enabled: true }),
    ["Dashboard", "Reports", "Talent Marketplace"]
  );
  assert.deepEqual(
    getTalentEnabledPages(["Office Portal"], { enabled: true, isAgency: true }),
    ["Office Portal"]
  );
});
