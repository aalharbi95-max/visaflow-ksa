export function normalizeWorkspaceRole(role, roleOptions = []) {
  const value = String(role || "Viewer").trim();
  if (value.toLowerCase() === "company admin") return "Admin";
  if (value === "Recruitment") return "Recruitment Officer";

  const matchedRole = roleOptions.find(
    (item) => String(item).toLowerCase() === value.toLowerCase()
  );

  return matchedRole || value || "Viewer";
}

export function getCompanyAdminPages(pages = [], platformPages = []) {
  return [...pages.filter((page) => !platformPages.includes(page)), "RequestDetails"];
}
