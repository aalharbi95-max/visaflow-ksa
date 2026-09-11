export function sanitizeExcelValue(value) {
  if (typeof value !== "string") return value ?? "";
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function buildExcelSafeRows(rows = []) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row || {})
      .filter(([, value]) => value === null || typeof value !== "object")
      .map(([key, value]) => [key, sanitizeExcelValue(value)]),
  ));
}

export function getExcelColumnWidths(rows = [], maximum = 42) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  return keys.map((key) => ({
    wch: Math.min(maximum, Math.max(String(key).length + 2, ...rows.map((row) => String(row?.[key] ?? "").length + 2))),
  }));
}
