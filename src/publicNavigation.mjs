export const PUBLIC_VIEW = Object.freeze({
  LANDING: "landing",
  LOGIN: "login",
  TALENT: "talent",
});

export function getPublicViewFromLocation(locationLike) {
  try {
    const search = new URLSearchParams(locationLike?.search || "");
    const hash = String(locationLike?.hash || "").toLowerCase();

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

  if (["#login", "#talent"].includes(String(url.hash || "").toLowerCase())) {
    url.hash = "";
  }

  if (nextView === PUBLIC_VIEW.LOGIN) url.searchParams.set("login", "1");
  if (nextView === PUBLIC_VIEW.TALENT) url.searchParams.set("talent", "1");

  return url.toString();
}
