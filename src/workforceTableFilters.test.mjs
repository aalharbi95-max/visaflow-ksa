import assert from "node:assert/strict";
import test from "node:test";
import { filterDemobilizationRows, filterEmployeeRows, selectRowsForBulkExport } from "./workforceTableFilters.mjs";

const employees = [
  { id: 1, employee_name: "Ali", profession: "Electrician", nationality: "Saudi", project_name: "North", status: "Active" },
  { id: 2, employee_name: "Ravi", profession: "Plumber", nationality: "Indian", project_name: "South", status: "Demobilized" },
];

test("employee filters combine header selections and text search", () => {
  assert.deepEqual(filterEmployeeRows(employees, { profession: "Electrician" }).map(({ id }) => id), [1]);
  assert.deepEqual(filterEmployeeRows(employees, { query: "south", status: "Demobilized" }).map(({ id }) => id), [2]);
});

test("demobilization filters include source project and suggested request search", () => {
  const rows = [
    { id: 1, employee_name: "Ali", profession: "Electrician", current_project: "North", suggested_request_no: "REQ-1", status: "Suggested" },
    { id: 2, employee_name: "Ravi", profession: "Plumber", current_project: "South", status: "Available" },
  ];
  assert.deepEqual(filterDemobilizationRows(rows, { query: "REQ-1", status: "Suggested" }).map(({ id }) => id), [1]);
  assert.deepEqual(filterDemobilizationRows(rows, { project: "South" }).map(({ id }) => id), [2]);
});

test("bulk export uses selected visible rows and otherwise exports all filtered rows", () => {
  assert.deepEqual(selectRowsForBulkExport(employees, ["2"]).map(({ id }) => id), [2]);
  assert.deepEqual(selectRowsForBulkExport(employees, []).map(({ id }) => id), [1, 2]);
});
