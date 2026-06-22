import assert from "node:assert/strict";
import test from "node:test";
import { mapAzError } from "../dist/src/errors.js";

test("TF400813 maps to AUTH_REQUIRED", () => {
  assert.equal(mapAzError("ERROR: TF400813: not authorized", 1).code, "AUTH_REQUIRED");
});

test("a real HTTP 401 maps to AUTH_REQUIRED", () => {
  assert.equal(mapAzError("HTTP 401 Unauthorized", 1).code, "AUTH_REQUIRED");
});

test("'requires user authentication' maps to AUTH_REQUIRED", () => {
  const err = mapAzError(
    "ERROR: The requested resource requires user authentication: https://vssps.dev.azure.com/Org/_apis/Identities",
    1,
  );
  assert.equal(err.code, "AUTH_REQUIRED");
});

test("TF401232 (work item missing) maps to NOT_FOUND, not AUTH_REQUIRED", () => {
  // Regression: the bare `401` pattern used to swallow TFxxx codes containing 401.
  const err = mapAzError(
    "ERROR: TF401232: Work item 52 does not exist, or you do not have permissions to read it.",
    1,
  );
  assert.equal(err.code, "NOT_FOUND");
  assert.match(err.message, /52/);
});

test("TF401398 (branch missing) is not misread as AUTH_REQUIRED", () => {
  const err = mapAzError(
    "ERROR: TF401398: The pull request cannot be activated because the source and/or the target branch no longer exists",
    1,
  );
  assert.notEqual(err.code, "AUTH_REQUIRED");
});

test("TF401019 maps to REPO_NOT_FOUND", () => {
  assert.equal(
    mapAzError("ERROR: TF401019: The Git repository does not exist or you do not have permission", 1).code,
    "REPO_NOT_FOUND",
  );
});

test("403 maps to FORBIDDEN", () => {
  assert.equal(mapAzError("ERROR: 403 Forbidden", 1).code, "FORBIDDEN");
});

test("an active-PR conflict maps to VALIDATION_ERROR", () => {
  const err = mapAzError("ERROR: TF401179: An active pull request already exists", 1);
  assert.equal(err.code, "VALIDATION_ERROR");
});

test("unrecognized failures preserve the stderr excerpt under UNKNOWN", () => {
  const err = mapAzError("ERROR: something unexpected\nmore detail", 9);
  assert.equal(err.code, "UNKNOWN");
  assert.match(err.message, /something unexpected/);
});

test("PAT values in stderr are redacted from the surfaced message", () => {
  const err = mapAzError("ERROR: failed with token=supersecret detail", 1);
  assert.doesNotMatch(err.message, /supersecret/);
});
