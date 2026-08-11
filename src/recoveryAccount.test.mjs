import test from "node:test";
import assert from "node:assert/strict";
import {
  getRecoveryAccountType,
  getRecoveryCompletionPath,
} from "./recoveryAccount.mjs";

test("routes candidate recovery by authenticated account metadata", () => {
  const session = {
    user: { id: "candidate-user", user_metadata: { account_type: "candidate" } },
  };
  assert.equal(getRecoveryAccountType(session), "candidate");
  assert.equal(getRecoveryCompletionPath("candidate"), "/?talent=1");
});

test("keeps company and agency recovery on workspace login", () => {
  const session = {
    user: { id: "workspace-user", user_metadata: { account_type: "company" } },
  };
  assert.equal(getRecoveryAccountType(session), "workspace");
  assert.equal(getRecoveryCompletionPath("workspace"), "/?login=1");
  assert.equal(getRecoveryAccountType(null), null);
});

