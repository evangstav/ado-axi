import assert from "node:assert/strict";
import test from "node:test";
import { runCliLog, readInvocations, argValue } from "./helpers.js";

const R = ["-R", "Org/Proj/Repo"];
const GUID = "11111111-1111-1111-1111-111111111111";

test("reviewer add by email succeeds directly when identity lookup is allowed", async () => {
  const result = await runCliLog(["pr", "reviewer", "add", "4242", "--reviewer", "dev@org.com", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 1, JSON.stringify(invs));
  assert.deepEqual(invs[0].slice(0, 6), ["repos", "pr", "reviewer", "add", "--id", "4242"]);
  assert.equal(argValue(invs[0], "--reviewers"), "dev@org.com");
  assert.match(result.stdout, /reviewers: 1/);
});

test("reviewer add --required passes --required true", async () => {
  const result = await runCliLog(["pr", "reviewer", "add", "4242", "--reviewer", "dev@org.com", "--required", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [add] = readInvocations(result.azLogFile);
  assert.equal(argValue(add, "--required"), "true");
});

test("reviewer add by email resolves via PR-history GUID fallback on auth failure", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "dev@org.com", "--required", ...R],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 3, JSON.stringify(invs));
  // 1) direct email add (fails), 2) PR-history lookup, 3) retry with the GUID.
  assert.equal(argValue(invs[0], "--reviewers"), "dev@org.com");
  assert.deepEqual(invs[1].slice(0, 3), ["repos", "pr", "list"]);
  assert.equal(invs[1].includes("all"), true);
  assert.equal(argValue(invs[2], "--reviewers"), GUID);
  assert.equal(argValue(invs[2], "--required"), "true"); // required propagates to retry
  assert.match(result.stdout, /Resolved/);
});

test("reviewer add with a GUID skips the lookup entirely", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", GUID, ...R],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 1, JSON.stringify(invs));
  assert.equal(argValue(invs[0], "--reviewers"), GUID);
});

test("reviewer add surfaces an unresolvable identity with a clear error", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "ghost@org.com", ...R],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Could not resolve reviewer/);
  // It tried the direct add and the PR-history lookup, then stopped.
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.some((i) => i.slice(0, 3).join(" ") === "repos pr list"), true);
});

test("reviewer add reports ambiguity when a name matches multiple identities", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "Dup Name", ...R],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1", ADO_AXI_AMBIGUOUS: "1" },
  );

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Ambiguous reviewer/);
  // Never retried the add — bailed at the ambiguity.
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.filter((i) => i[2] === "reviewer" && i[3] === "add").length, 1);
});

test("reviewer add does NOT fall back on a non-identity error", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "999", "--reviewer", "dev@org.com", ...R],
    { ADO_AXI_REVIEWER_NOTFOUND: "1" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /not found/i);
  // The original error is surfaced; no PR-history lookup attempted.
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 1, JSON.stringify(invs));
  assert.equal(invs.some((i) => i.slice(0, 3).join(" ") === "repos pr list"), false);
});

test("reviewer add requires --reviewer", async () => {
  const result = await runCliLog(["pr", "reviewer", "add", "4242", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /--reviewer is required/);
});

test("reviewer list renders the reviewers table", async () => {
  const result = await runCliLog(["pr", "reviewer", "list", "4242", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [list] = readInvocations(result.azLogFile);
  assert.deepEqual(list.slice(0, 6), ["repos", "pr", "reviewer", "list", "--id", "4242"]);
  assert.match(result.stdout, /reviewers: 1/);
  assert.match(result.stdout, /Dev Two,.*,approved/);
});

test("reviewer rejects an unknown action", async () => {
  const result = await runCliLog(["pr", "reviewer", "frob", "4242", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Unknown reviewer action: frob/);
});
