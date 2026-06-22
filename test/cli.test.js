import assert from "node:assert/strict";
import test from "node:test";
import { runCli, readAzArgs, combinedOutput } from "./helpers.js";

test("supports -R before the command as documented", async () => {
  const result = await runCli(["-R", "Org/Proj/Repo", "pr", "show", "123"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readAzArgs(result.azArgsFile).slice(0, 5), [
    "repos",
    "pr",
    "show",
    "--id",
    "123",
  ]);
});

test("completes PRs with Azure CLI supported squash flags", async () => {
  const result = await runCli([
    "pr",
    "complete",
    "123",
    "--merge",
    "-R",
    "Org/Proj/Repo",
  ]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const azArgs = readAzArgs(result.azArgsFile);
  assert.equal(azArgs.includes("--merge-strategy"), false);
  assert.deepEqual(azArgs.slice(0, 6), [
    "repos",
    "pr",
    "update",
    "--id",
    "123",
    "--status",
  ]);
  assert.equal(azArgs[azArgs.indexOf("--squash") + 1], "false");
});

test("rejects unsupported rebase completion before calling az", async () => {
  const result = await runCli([
    "pr",
    "complete",
    "123",
    "--rebase",
    "-R",
    "Org/Proj/Repo",
  ]);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(combinedOutput(result), /does not support --rebase/);
});

test("unknown setup commands fail validation", async () => {
  const result = await runCli(["setup", "nope"]);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(combinedOutput(result), /Unknown setup command: nope/);
  assert.match(combinedOutput(result), /VALIDATION_ERROR/);
});

test("unknown az failures preserve actionable stderr detail", async () => {
  const result = await runCli(["pr", "show", "123", "-R", "Org/Proj/Repo"], {
    ADO_AXI_FAKE_AZ_FAIL: "1",
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(combinedOutput(result), /ERROR: first line/);
  assert.match(combinedOutput(result), /second line with detail/);
});

test("unknown top-level commands are rejected", async () => {
  const result = await runCli(["bogus"]);

  assert.notEqual(result.status, 0);
});

test("work-item and wi resolve to the same command group help", async () => {
  const wi = await runCli(["wi", "--help"]);
  const workItem = await runCli(["work-item", "--help"]);

  assert.equal(wi.status, 0, wi.stdout);
  assert.match(wi.stdout, /usage: ado-axi work-item\|wi/);
  assert.equal(wi.stdout, workItem.stdout);
});
