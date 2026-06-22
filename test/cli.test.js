import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../dist/src/cli.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), "ado-axi-test-"));
  const azArgsFile = join(dir, "az-args.txt");

  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh
case "$1 $2 $3" in
  "credential fill ") exit 1 ;;
  "remote get-url origin") exit 1 ;;
  "rev-parse --abbrev-ref") printf 'feature/demo\\n'; exit 0 ;;
esac
exit 1
`,
    { mode: 0o755 },
  );

  writeFileSync(
    join(dir, "az"),
    `#!/bin/sh
if [ "$ADO_AXI_FAKE_AZ_FAIL" = "1" ]; then
  printf 'ERROR: first line\\nsecond line with detail\\n' >&2
  exit 9
fi
printf '%s\\n' "$@" > "$ADO_AXI_AZ_ARGS_FILE"
case "$*" in
  *"repos pr list"*) printf '[]\\n' ;;
  *) printf '{"pullRequestId":123,"title":"Demo","status":"active","sourceRefName":"refs/heads/feature/demo","targetRefName":"refs/heads/main"}\\n' ;;
esac
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    ADO_AXI_AZ_ARGS_FILE: azArgsFile,
    AZURE_DEVOPS_EXT_PAT: "dummy",
  };

  return { env, azArgsFile };
}

async function runCli(args, extraEnv = {}) {
  const harness = makeHarness();
  const originalEnv = process.env;
  const originalExitCode = process.exitCode;
  let stdout = "";

  process.env = { ...harness.env, ...extraEnv };
  process.exitCode = undefined;

  try {
    await main(args, {
      write: (chunk) => {
        stdout += String(chunk);
        return true;
      },
    });
    return {
      status: process.exitCode ?? 0,
      stdout,
      stderr: "",
      azArgsFile: harness.azArgsFile,
    };
  } finally {
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  }
}

function combinedOutput(result) {
  return `${result.stdout}${result.stderr}`;
}

function readAzArgs(path) {
  return readFileSync(path, "utf8").trim().split("\n");
}

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
  const result = await runCli(
    ["pr", "show", "123", "-R", "Org/Proj/Repo"],
    { ADO_AXI_FAKE_AZ_FAIL: "1" },
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(combinedOutput(result), /ERROR: first line/);
  assert.match(combinedOutput(result), /second line with detail/);
});

// ---------------------------------------------------------------------------
// work-item + pr reviewer suite. This harness records EVERY az invocation
// (the PR suite above only needs the last), so multi-call flows like the
// identity fallback can be asserted call-by-call.
// ---------------------------------------------------------------------------

function makeLogHarness() {
  const dir = mkdtempSync(join(tmpdir(), "ado-axi-wi-test-"));
  const azLogFile = join(dir, "az-log.txt");

  writeFileSync(
    join(dir, "git"),
    `#!/bin/sh
case "$1 $2 $3" in
  "credential fill ") exit 1 ;;
  "remote get-url origin") exit 1 ;;
  "rev-parse --abbrev-ref") printf 'feature/demo\\n'; exit 0 ;;
esac
exit 1
`,
    { mode: 0o755 },
  );

  writeFileSync(
    join(dir, "az"),
    `#!/bin/sh
{
  echo "--INVOCATION--"
  printf '%s\\n' "$@"
} >> "$ADO_AXI_AZ_LOG_FILE"

case "$*" in
  *"boards work-item create"*) printf '{"id":4321,"fields":{"System.WorkItemType":"Task","System.State":"New","System.Title":"Wire up gate"}}\\n' ;;
  *"boards work-item update"*) printf '{"id":4321,"fields":{"System.WorkItemType":"Task","System.State":"Active","System.Title":"Wire up gate"}}\\n' ;;
  *"boards work-item show"*) printf '{"id":4321,"fields":{"System.WorkItemType":"Task","System.State":"Active","System.Title":"Wire up gate","System.AssignedTo":{"displayName":"Dev One","uniqueName":"dev@org.com"}}}\\n' ;;
  *"boards work-item delete"*) printf '{"id":4321}\\n' ;;
  *"boards work-item relation add"*) printf '{"id":4321}\\n' ;;
  *"boards query"*) printf '[{"id":4321,"fields":{"System.WorkItemType":"Task","System.State":"Active","System.Title":"Wire up gate","System.AssignedTo":{"displayName":"Dev One"}}}]\\n' ;;
  *"repos pr reviewer add"*)
    if [ "$ADO_AXI_FAIL_EMAIL_REVIEWER" = "1" ]; then
      case "$*" in
        *"11111111-1111-1111-1111-111111111111"*) printf '[{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com","isRequired":true,"vote":0}]\\n' ;;
        *) printf 'ERROR: TF400813: requires user authentication\\n' >&2 ; exit 1 ;;
      esac
    else
      printf '[{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com","isRequired":true,"vote":0}]\\n'
    fi
    ;;
  *"repos pr reviewer list"*) printf '[{"id":"22222222-2222-2222-2222-222222222222","displayName":"Dev Two","uniqueName":"dev2@org.com","isRequired":false,"vote":10}]\\n' ;;
  *"repos pr list"*) printf '[{"createdBy":{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com"},"reviewers":[]}]\\n' ;;
  *) printf '{}\\n' ;;
esac
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    ADO_AXI_AZ_LOG_FILE: azLogFile,
    AZURE_DEVOPS_EXT_PAT: "dummy",
  };

  return { env, azLogFile };
}

async function runCliLog(args, extraEnv = {}) {
  const harness = makeLogHarness();
  const originalEnv = process.env;
  const originalExitCode = process.exitCode;
  let stdout = "";

  process.env = { ...harness.env, ...extraEnv };
  process.exitCode = undefined;

  try {
    await main(args, {
      write: (chunk) => {
        stdout += String(chunk);
        return true;
      },
    });
    return {
      status: process.exitCode ?? 0,
      stdout,
      azLogFile: harness.azLogFile,
    };
  } finally {
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  }
}

/** Split the az log into invocations, each an array of its argv lines. */
function readInvocations(path) {
  return readFileSync(path, "utf8")
    .split("--INVOCATION--")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("\n"));
}

/** Value following `flag` within a single invocation's argv. */
function argValue(inv, flag) {
  const i = inv.indexOf(flag);
  return i >= 0 && i + 1 < inv.length ? inv[i + 1] : undefined;
}

test("work-item create builds az boards work-item create with project, html, fields", async () => {
  const result = await runCliLog([
    "wi", "create",
    "--type", "Task",
    "--title", "Wire up gate",
    "--description", "# Hi\n\nsome text",
    "--assignee", "dev@org.com",
    "--priority", "2",
    "-R", "Org/Proj/Repo",
  ]);

  assert.equal(result.status, 0, result.stdout);
  const [create] = readInvocations(result.azLogFile);
  assert.deepEqual(create.slice(0, 7), [
    "boards", "work-item", "create",
    "--project", "Proj",
    "--type", "Task",
  ]);
  assert.equal(argValue(create, "--title"), "Wire up gate");
  assert.equal(argValue(create, "--assigned-to"), "dev@org.com");
  assert.equal(argValue(create, "--fields"), "Microsoft.VSTS.Common.Priority=2");
  assert.match(argValue(create, "--description"), /<b>Hi<\/b>/);
  assert.match(result.stdout, /created:/);
  assert.match(result.stdout, /id: 4321/);
});

test("work-item create with --parent adds a parent relation", async () => {
  const result = await runCliLog([
    "wi", "create",
    "--type", "Task",
    "--title", "Child",
    "--parent", "99",
    "-R", "Org/Proj/Repo",
  ]);

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 2);
  const rel = invs[1];
  assert.deepEqual(rel.slice(0, 4), ["boards", "work-item", "relation", "add"]);
  assert.equal(argValue(rel, "--relation-type"), "parent");
  assert.equal(argValue(rel, "--target-id"), "99");
});

test("work-item list builds project-scoped WIQL from flags", async () => {
  const result = await runCliLog([
    "wi", "list",
    "--state", "Active",
    "--type", "Task",
    "-R", "Org/Proj/Repo",
  ]);

  assert.equal(result.status, 0, result.stdout);
  const [query] = readInvocations(result.azLogFile);
  assert.deepEqual(query.slice(0, 5), [
    "boards", "query", "--project", "Proj", "--wiql",
  ]);
  const wiql = argValue(query, "--wiql");
  assert.match(wiql, /\[System\.TeamProject\] = 'Proj'/);
  assert.match(wiql, /\[System\.State\] = 'Active'/);
  assert.match(wiql, /\[System\.WorkItemType\] = 'Task'/);
  assert.match(result.stdout, /work_items: 1/);
});

test("work-item list --unassigned filters on empty AssignedTo", async () => {
  const result = await runCliLog(["wi", "list", "--unassigned", "-R", "Org/Proj/Repo"]);

  assert.equal(result.status, 0, result.stdout);
  const [query] = readInvocations(result.azLogFile);
  assert.match(argValue(query, "--wiql"), /\[System\.AssignedTo\] = ''/);
});

test("work-item delete passes --project and --yes; --destroy is permanent", async () => {
  const result = await runCliLog(["wi", "delete", "4321", "--destroy", "-R", "Org/Proj/Repo"]);

  assert.equal(result.status, 0, result.stdout);
  const [del] = readInvocations(result.azLogFile);
  assert.deepEqual(del.slice(0, 7), [
    "boards", "work-item", "delete",
    "--id", "4321",
    "--project", "Proj",
  ]);
  assert.equal(del.includes("--yes"), true);
  assert.equal(del.includes("--destroy"), true);
  assert.match(result.stdout, /destroyed: true/);
});

test("work-item update with no changes is rejected before calling az", async () => {
  const result = await runCliLog(["wi", "update", "4321", "-R", "Org/Proj/Repo"]);

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Nothing to update/);
});

test("work-item show projects id/type/state/title/assignee", async () => {
  const result = await runCliLog(["wi", "show", "4321", "-R", "Org/Proj/Repo"]);

  assert.equal(result.status, 0, result.stdout);
  const [show] = readInvocations(result.azLogFile);
  assert.deepEqual(show.slice(0, 5), ["boards", "work-item", "show", "--id", "4321"]);
  assert.match(result.stdout, /assignee: Dev One/);
});

test("pr reviewer add resolves an email via the PR-history GUID fallback", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "dev@org.com", "--required", "-R", "Org/Proj/Repo"],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 3, JSON.stringify(invs));
  // 1) direct email add (fails), 2) PR-history lookup, 3) retry with the GUID.
  assert.equal(argValue(invs[0], "--reviewers"), "dev@org.com");
  assert.deepEqual(invs[1].slice(0, 3), ["repos", "pr", "list"]);
  assert.equal(invs[1].includes("all"), true);
  assert.equal(argValue(invs[2], "--reviewers"), "11111111-1111-1111-1111-111111111111");
  assert.match(result.stdout, /Resolved/);
});

test("pr reviewer add surfaces an unresolvable identity", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "ghost@org.com", "--required", "-R", "Org/Proj/Repo"],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Could not resolve reviewer/);
});

test("pr reviewer add with a GUID skips the lookup entirely", async () => {
  const result = await runCliLog(
    ["pr", "reviewer", "add", "4242", "--reviewer", "11111111-1111-1111-1111-111111111111", "-R", "Org/Proj/Repo"],
    { ADO_AXI_FAIL_EMAIL_REVIEWER: "1" },
  );

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 1, JSON.stringify(invs));
  assert.deepEqual(invs[0].slice(0, 4), ["repos", "pr", "reviewer", "add"]);
});

test("pr reviewer list renders the reviewers table", async () => {
  const result = await runCliLog(["pr", "reviewer", "list", "4242", "-R", "Org/Proj/Repo"]);

  assert.equal(result.status, 0, result.stdout);
  const [list] = readInvocations(result.azLogFile);
  assert.deepEqual(list.slice(0, 6), [
    "repos", "pr", "reviewer", "list", "--id", "4242",
  ]);
  assert.match(result.stdout, /reviewers: 1/);
  assert.match(result.stdout, /Dev Two,.*,approved/);
});
