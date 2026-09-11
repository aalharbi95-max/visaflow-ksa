import assert from "node:assert/strict";
import test from "node:test";
import { buildExcelSafeRows, getExcelColumnWidths, sanitizeExcelValue } from "./excelExport.mjs";

test("Excel export neutralizes formula injection and keeps normal values", () => {
  assert.equal(sanitizeExcelValue("=HYPERLINK(\"bad\")"), "'=HYPERLINK(\"bad\")");
  assert.equal(sanitizeExcelValue("  @SUM(A1)"), "'  @SUM(A1)");
  assert.equal(sanitizeExcelValue("Normal text"), "Normal text");
  assert.equal(sanitizeExcelValue(12), 12);
});

test("Excel export omits nested objects and calculates bounded widths", () => {
  const rows = buildExcelSafeRows([{ name: "Ali", payload: { secret: true }, note: "+cmd", count: 2 }]);
  assert.deepEqual(rows, [{ name: "Ali", note: "'+cmd", count: 2 }]);
  const widths = getExcelColumnWidths(rows, 10);
  assert.equal(widths.length, 3);
  assert.ok(widths.every(({ wch }) => wch <= 10));
});
