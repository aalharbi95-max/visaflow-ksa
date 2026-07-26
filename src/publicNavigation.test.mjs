import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_UI_LANGUAGE,
  getUiDirection,
  resolveUiLanguage,
  shouldShowLanguageToggle,
  TEMPORARY_ENGLISH_ONLY,
} from "./languagePolicy.mjs";
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

test("temporary UI policy always resolves English despite Arabic preferences", () => {
  const arabicStorage = {
    getItem: () => "AR",
  };

  assert.equal(TEMPORARY_ENGLISH_ONLY, true);
  assert.equal(DEFAULT_UI_LANGUAGE, "EN");
  assert.equal(
    resolveUiLanguage({
      preferredLanguage: "AR",
      localStorage: arabicStorage,
      sessionStorage: arabicStorage,
      locationLike: { search: "?language=AR" },
    }),
    "EN"
  );
  assert.equal(getUiDirection("AR"), "ltr");
  assert.equal(shouldShowLanguageToggle(), false);
});

test("landing, company login, and authenticated workspace use the English-only policy", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  assert.match(
    app,
    /PUBLIC_LANDING_COPY\[effectiveLanguage\] \|\| PUBLIC_LANDING_COPY\.EN/
  );
  assert.match(app, /resolveUiLanguage\(\{\s*localStorage,/);
  assert.match(app, /\{SHOW_LANGUAGE_TOGGLE && \(\s*<div className="vf-login-language">/);
  assert.match(app, /<main className="vf-login-shell" dir=\{UI_DIRECTION\} lang="en">/);
  assert.match(app, /<div className="layout" dir=\{UI_DIRECTION\} lang="en">/);
  assert.match(app, /Company Login/);
  assert.match(app, /Agency Portal/);

  // Arabic resources remain in place so localization can be restored later.
  assert.match(app, /AR:\s*\{/);
  assert.match(app, /دخول الشركات/);
});
