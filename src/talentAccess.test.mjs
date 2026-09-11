import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTalentProfileLimit,
  getTalentProfileLimitValue,
  getOwnerTalentProfiles,
  getTalentEnabledPages,
  isTalentProfileUnlimited,
  isTalentEmailNotConfirmed,
  TALENT_PROFILE_UNLIMITED_SENTINEL,
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

test("Unlimited Talent access uses the stable database sentinel", () => {
  assert.equal(
    getTalentProfileLimitValue({ enabled: true, unlimited: true, limit: 25 }),
    TALENT_PROFILE_UNLIMITED_SENTINEL
  );
  assert.equal(isTalentProfileUnlimited(TALENT_PROFILE_UNLIMITED_SENTINEL), true);
  assert.equal(formatTalentProfileLimit(TALENT_PROFILE_UNLIMITED_SENTINEL), "Unlimited");
});

test("limited Talent access remains below the Unlimited sentinel", () => {
  assert.equal(getTalentProfileLimitValue({ enabled: true, limit: 75 }), 75);
  assert.equal(
    getTalentProfileLimitValue({ enabled: true, limit: TALENT_PROFILE_UNLIMITED_SENTINEL }),
    TALENT_PROFILE_UNLIMITED_SENTINEL - 1
  );
  assert.equal(getTalentProfileLimitValue({ enabled: false, unlimited: true }), 0);
});
