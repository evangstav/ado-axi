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
