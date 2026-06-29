import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../dist/src/cli.js";

// ---------------------------------------------------------------------------
// Original single-invocation harness (used by cli.test.js). The fake `az`
// overwrites the args file, so only the last invocation is recorded — enough
// for the simple PR-routing checks.
// ---------------------------------------------------------------------------
export function makeHarness() {
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
  *"repos pr list"*)
    if [ "$ADO_AXI_PR_NO_CREATED_BY" = "1" ]; then
      printf '[{"pullRequestId":123,"title":"Demo","status":"active","sourceRefName":"refs/heads/feature/demo","targetRefName":"refs/heads/main"}]\\n'
    else
      printf '[{"pullRequestId":123,"title":"Demo","status":"active","sourceRefName":"refs/heads/feature/demo","targetRefName":"refs/heads/main","createdBy":{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com"}}]\\n'
    fi ;;
  *)
    if [ "$ADO_AXI_PR_NO_CREATED_BY" = "1" ]; then
      printf '{"pullRequestId":123,"title":"Demo","status":"active","sourceRefName":"refs/heads/feature/demo","targetRefName":"refs/heads/main"}\\n'
    else
      printf '{"pullRequestId":123,"title":"Demo","status":"active","sourceRefName":"refs/heads/feature/demo","targetRefName":"refs/heads/main","createdBy":{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com"}}\\n'
    fi ;;
esac
`,
    { mode: 0o755 },
  );

  return {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ADO_AXI_AZ_ARGS_FILE: azArgsFile,
      AZURE_DEVOPS_EXT_PAT: "dummy",
    },
    azArgsFile,
  };
}

export async function runCli(args, extraEnv = {}) {
  return runWith(makeHarness, args, extraEnv, (h) => ({
    azArgsFile: h.azArgsFile,
  }));
}

export function readAzArgs(path) {
  return readFileSync(path, "utf8").trim().split("\n");
}

export function combinedOutput(result) {
  return `${result.stdout}${result.stderr ?? ""}`;
}

// ---------------------------------------------------------------------------
// Multi-invocation harness (used by work-item / pr-reviewer suites). The fake
// `az` APPENDS each invocation behind a marker, so multi-call flows like the
// identity fallback can be asserted call-by-call. Behavior toggles via env:
//   ADO_AXI_FAIL_EMAIL_REVIEWER  reviewer add by non-GUID fails (auth)
//   ADO_AXI_AMBIGUOUS            PR history yields two distinct ids for a name
//   ADO_AXI_EMPTY               `boards query` returns no rows
//   ADO_AXI_REVIEWER_NOTFOUND    reviewer add fails with a non-auth error
// ---------------------------------------------------------------------------
export function makeLogHarness() {
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
  *"boards work-item delete"*)
    case "$*" in
      *"--destroy"*) printf 'Deleted work item 4321\\n' ;;
      *) printf 'Deleted work item 4321\\n{"code":200,"id":4321}\\n' ;;
    esac ;;
  *"boards work-item relation add"*) printf '{"id":4321}\\n' ;;
  *"boards query"*)
    if [ "$ADO_AXI_EMPTY" = "1" ]; then
      printf '[]\\n'
    else
      printf '[{"id":4321,"fields":{"System.WorkItemType":"Task","System.State":"Active","System.Title":"Wire up gate","System.AssignedTo":{"displayName":"Dev One"}}}]\\n'
    fi ;;
  *"repos pr reviewer add"*)
    if [ "$ADO_AXI_REVIEWER_NOTFOUND" = "1" ]; then
      printf 'ERROR: TF401180: The requested pull request was not found.\\n' >&2 ; exit 1
    fi
    if [ "$ADO_AXI_FAIL_EMAIL_REVIEWER" = "1" ]; then
      case "$*" in
        *"11111111-1111-1111-1111-111111111111"*) printf '[{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com","isRequired":true,"vote":0}]\\n' ;;
        *[0-9a-f]"-"[0-9a-f]*) printf '[{"id":"resolved","displayName":"Resolved Person","isRequired":false,"vote":0}]\\n' ;;
        *) printf 'ERROR: The requested resource requires user authentication: https://vssps.dev.azure.com/Org/_apis/Identities\\n' >&2 ; exit 1 ;;
      esac
    else
      printf '[{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com","isRequired":true,"vote":0}]\\n'
    fi ;;
  *"devops invoke"*)
    # Capture the --in-file request body (deleted by the CLI after the call) so tests
    # can assert the exact REST payload and that --file content is preserved.
    prev=""
    for a in "$@"; do
      [ "$prev" = "--in-file" ] && cp "$a" "$ADO_AXI_AZ_LOG_FILE.body"
      prev="$a"
    done
    printf '{"id":900,"status":"active","comments":[{"id":1,"commentType":"text"}]}\\n' ;;
  *"repos pr reviewer list"*) printf '[{"id":"22222222-2222-2222-2222-222222222222","displayName":"Dev Two","uniqueName":"dev2@org.com","isRequired":false,"vote":10}]\\n' ;;
  *"repos pr reviewer remove"*) printf '[]\\n' ;;
  *"repos pr list"*)
    if [ "$ADO_AXI_AMBIGUOUS" = "1" ]; then
      printf '[{"createdBy":{"id":"aaaaaaaa-1111-1111-1111-111111111111","displayName":"Dup Name","uniqueName":"dup1@org.com"},"reviewers":[{"id":"bbbbbbbb-2222-2222-2222-222222222222","displayName":"Dup Name","uniqueName":"dup2@org.com"}]}]\\n'
    else
      printf '[{"createdBy":{"id":"11111111-1111-1111-1111-111111111111","displayName":"Dev One","uniqueName":"dev@org.com","mailAddress":"dev@org.com"},"reviewers":[]}]\\n'
    fi ;;
  *) printf '{}\\n' ;;
esac
`,
    { mode: 0o755 },
  );

  return {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      ADO_AXI_AZ_LOG_FILE: azLogFile,
      AZURE_DEVOPS_EXT_PAT: "dummy",
    },
    azLogFile,
  };
}

export async function runCliLog(args, extraEnv = {}) {
  return runWith(makeLogHarness, args, extraEnv, (h) => ({
    azLogFile: h.azLogFile,
  }));
}

/** Split the az log into invocations, each an array of its argv lines. */
export function readInvocations(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return []; // az was never invoked, so the log file does not exist
  }
  return text
    .split("--INVOCATION--")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("\n"));
}

/** Read the captured `az devops invoke --in-file` request body (parsed JSON). */
export function readRequestBody(logPath) {
  return JSON.parse(readFileSync(`${logPath}.body`, "utf8"));
}

/** Value following `flag` within a single invocation's argv. */
export function argValue(inv, flag) {
  const i = inv.indexOf(flag);
  return i >= 0 && i + 1 < inv.length ? inv[i + 1] : undefined;
}

// Shared runner: swaps process.env for the harness, captures stdout, restores.
async function runWith(harnessFactory, args, extraEnv, extract) {
  const harness = harnessFactory();
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
    return { status: process.exitCode ?? 0, stdout, stderr: "", ...extract(harness) };
  } finally {
    process.env = originalEnv;
    process.exitCode = originalExitCode;
  }
}
