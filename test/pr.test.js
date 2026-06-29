import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "./helpers.js";

const R = ["-R", "Org/Proj/Repo"];

test("pr list exposes author display name and unique name", async () => {
  const result = await runCli(["pr", "list", ...R]);

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pull_requests: 1/);
  assert.match(result.stdout, /author/);
  assert.match(result.stdout, /Dev One/);
  assert.match(result.stdout, /author_unique/);
  assert.match(result.stdout, /dev@org\.com/);
});

test("pr show exposes author display name and unique name", async () => {
  const result = await runCli(["pr", "show", "123", ...R]);

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /pr:/);
  assert.match(result.stdout, /author: Dev One/);
  assert.match(result.stdout, /author_unique: dev@org\.com/);
});

test("pr list keeps empty author fields when createdBy is absent", async () => {
  const result = await runCli(["pr", "list", ...R], {
    ADO_AXI_PR_NO_CREATED_BY: "1",
  });

  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /author,author_unique/);
  assert.match(result.stdout, /"",""/);
});
