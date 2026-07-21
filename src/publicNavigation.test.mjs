import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicViewUrl,
  getPublicViewFromLocation,
  PUBLIC_VIEW,
} from "./publicNavigation.mjs";

test("the public landing page is the default route", () => {
  assert.equal(
    getPublicViewFromLocation({ search: "", hash: "" }),
    PUBLIC_VIEW.LANDING
  );
});

test("company login and talent routes remain independent", () => {
  assert.equal(
    getPublicViewFromLocation({ search: "?login=1", hash: "" }),
    PUBLIC_VIEW.LOGIN
  );
  assert.equal(
    getPublicViewFromLocation({ search: "?talent=1", hash: "" }),
    PUBLIC_VIEW.TALENT
  );
});

test("navigation preserves unrelated authentication callback parameters", () => {
  const talentUrl = new URL(
    buildPublicViewUrl(
      "https://visaflowksa.com/?auth_flow=candidate&recovery=1&login=1",
      PUBLIC_VIEW.TALENT
    )
  );

  assert.equal(talentUrl.searchParams.get("talent"), "1");
  assert.equal(talentUrl.searchParams.get("login"), null);
  assert.equal(talentUrl.searchParams.get("auth_flow"), "candidate");
  assert.equal(talentUrl.searchParams.get("recovery"), "1");

  const landingUrl = new URL(buildPublicViewUrl(talentUrl, PUBLIC_VIEW.LANDING));
  assert.equal(landingUrl.searchParams.get("talent"), null);
  assert.equal(landingUrl.searchParams.get("auth_flow"), "candidate");
});
