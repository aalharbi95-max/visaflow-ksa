export const PUBLIC_VIEW = Object.freeze({
  LANDING: "landing",
  LOGIN: "login",
  TALENT: "talent",
  CV_BUILDER: "cv-builder",
});

export function getPublicViewFromLocation(locationLike) {
  try {
    const search = new URLSearchParams(locationLike?.search || "");
    const hash = String(locationLike?.hash || "").toLowerCase();
    const pathname = String(locationLike?.pathname || "").replace(/\/+$/, "").toLowerCase();

    if (pathname === "/cv-builder" || search.get("cv_builder") === "1" || hash === "#cv-builder") {
      return PUBLIC_VIEW.CV_BUILDER;
    }
    if (search.get("talent") === "1" || hash === "#talent") {
      return PUBLIC_VIEW.TALENT;
    }
    if (search.get("login") === "1" || hash === "#login") {
      return PUBLIC_VIEW.LOGIN;
    }
  } catch {
    return PUBLIC_VIEW.LANDING;
  }

  return PUBLIC_VIEW.LANDING;
}

export function buildPublicViewUrl(currentHref, nextView) {
  const url = new URL(currentHref);
  url.searchParams.delete("login");
  url.searchParams.delete("talent");
  url.searchParams.delete("cv_builder");
  url.searchParams.delete("cv_builder_import");

  if (["#login", "#talent", "#cv-builder"].includes(String(url.hash || "").toLowerCase())) {
    url.hash = "";
  }

  if (nextView === PUBLIC_VIEW.LOGIN) url.searchParams.set("login", "1");
  if (nextView === PUBLIC_VIEW.TALENT) url.searchParams.set("talent", "1");
  if (nextView === PUBLIC_VIEW.CV_BUILDER) {
    url.pathname = "/cv-builder";
  } else if (url.pathname === "/cv-builder") {
    url.pathname = "/";
  }

  return url.toString();
}
