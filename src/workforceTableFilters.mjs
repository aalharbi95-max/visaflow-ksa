function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesChoice(value, filter) {
  return filter === "All" || String(value || "") === String(filter || "");
}

export function filterEmployeeRows(rows = [], filters = {}) {
  const query = normalize(filters.query);
  return rows.filter((item) => {
    const searchable = normalize([
      item.employee_no,
      item.employee_name,
      item.iqama_no,
      item.profession,
      item.nationality,
      item.gender,
      item.project_name,
      item.project_city,
      item.project_location,
      item.status,
    ].join(" "));
    return (!query || searchable.includes(query)) &&
      matchesChoice(item.status, filters.status || "All") &&
      matchesChoice(item.profession, filters.profession || "All") &&
      matchesChoice(item.nationality, filters.nationality || "All") &&
      matchesChoice(item.project_name, filters.project || "All");
  });
}

export function filterDemobilizationRows(rows = [], filters = {}) {
  const query = normalize(filters.query);
  return rows.filter((item) => {
    const searchable = normalize([
      item.employee_name,
      item.employee_id,
      item.iqama_no,
      item.profession,
      item.nationality,
      item.current_project,
      item.suggested_request_no,
      item.suggested_project,
      item.status,
    ].join(" "));
    return (!query || searchable.includes(query)) &&
      matchesChoice(item.status, filters.status || "All") &&
      matchesChoice(item.profession, filters.profession || "All") &&
      matchesChoice(item.nationality, filters.nationality || "All") &&
      matchesChoice(item.current_project, filters.project || "All");
  });
}

export function selectRowsForBulkExport(rows = [], selectedIds = []) {
  const selected = new Set(selectedIds.map(String));
  return selected.size > 0 ? rows.filter((row) => selected.has(String(row?.id))) : rows;
}
