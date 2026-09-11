import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("candidate pages expose soft-delete, bulk, batch, and restore controls", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  for (const label of ["Select All", "Delete Selected", "Delete Upload Batch", "Deleted Candidates", "Restore"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /candidate_soft_delete_v1/);
  assert.match(source, /candidate_restore_v1/);
  assert.match(source, /candidate_upload_batch_begin_v1/);
  assert.match(source, /query = query\.is\("deleted_at", null\)/);
  assert.doesNotMatch(source, /from\("candidates"\)\.delete\(/);
});

test("upload batches use SHA-256 and persist batch identity before candidate insert", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /payload\.upload_batch_id = batch\.id/);
  assert.match(source, /payload\.file_hash = uploadFile\.hash/);
  assert.match(source, /payload\.uploaded_by_agency_id/);
});
