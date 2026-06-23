import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCliLog,
  readInvocations,
  readRequestBody,
  argValue,
} from "./helpers.js";

const R = ["-R", "Org/Proj/Repo"];

/** The route-parameters list is a run of `key=value` tokens after the flag. */
function routeParams(inv) {
  const start = inv.indexOf("--route-parameters") + 1;
  const params = {};
  for (let i = start; i < inv.length && inv[i].includes("="); i++) {
    const [k, v] = inv[i].split("=");
    params[k] = v;
  }
  return params;
}

test("comment create posts a thread via az devops invoke with --message", async () => {
  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--message", "LGTM, ship it", ...R],
  );

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 1, JSON.stringify(invs));
  const inv = invs[0];

  // Exact REST resource + method.
  assert.deepEqual(inv.slice(0, 2), ["devops", "invoke"]);
  assert.equal(argValue(inv, "--area"), "git");
  assert.equal(argValue(inv, "--resource"), "pullRequestThreads");
  assert.equal(argValue(inv, "--http-method"), "POST");

  // Route parameters scope to the resolved project/repo/PR id.
  assert.deepEqual(routeParams(inv), {
    project: "Proj",
    repositoryId: "Repo",
    pullRequestId: "4242",
  });

  // --api-version must be a numeric value Azure CLI can parse as a float for version
  // negotiation. A REST preview label like "7.1-preview.1" makes `az devops invoke` fail
  // with "could not convert string to float: '7.1.1'" before any network call, so guard it.
  const apiVersion = argValue(inv, "--api-version");
  assert.ok(apiVersion !== undefined, "--api-version must be passed");
  assert.match(
    apiVersion,
    /^\d+(\.\d+)?$/,
    `--api-version must be numeric (float-parseable), got "${apiVersion}"`,
  );
  assert.equal(apiVersion, "7.1");

  // Request body: a single Markdown text comment in a new active thread.
  const body = readRequestBody(result.azLogFile);
  assert.equal(body.status, "active");
  assert.equal(body.comments.length, 1);
  assert.equal(body.comments[0].content, "LGTM, ship it");
  assert.equal(body.comments[0].commentType, "text");

  // TOON output carries PR id, thread/comment ids, status, and a next step.
  assert.match(result.stdout, /pr: 4242/);
  assert.match(result.stdout, /thread: 900/);
  assert.match(result.stdout, /comment: 1/);
  assert.match(result.stdout, /status: active/);
  assert.match(result.stdout, /ado-axi pr show 4242/);
});

test("--body and --content are accepted as aliases for --message", async () => {
  for (const flag of ["--body", "--content"]) {
    const result = await runCliLog(
      ["pr", "comment", "create", "4242", flag, `via ${flag}`, ...R],
    );
    assert.equal(result.status, 0, result.stdout);
    const body = readRequestBody(result.azLogFile);
    assert.equal(body.comments[0].content, `via ${flag}`);
  }
});

test("--file is read verbatim and preserves multi-line content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-axi-comment-file-"));
  const file = join(dir, "review.md");
  const multiline = [
    "# Review findings",
    "",
    "- Line one with `code`",
    "- Line two",
    "",
    "Final paragraph.",
  ].join("\n");
  writeFileSync(file, multiline, "utf-8");

  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--file", file, ...R],
  );

  assert.equal(result.status, 0, result.stdout);
  const body = readRequestBody(result.azLogFile);
  // Sent as raw Markdown (no HTML conversion), newlines intact.
  assert.equal(body.comments[0].content, multiline);
  assert.equal(body.comments[0].content.split("\n").length, 6);
});

test("comment create requires a PR id", async () => {
  const result = await runCliLog(
    ["pr", "comment", "create", "--message", "hi", ...R],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /pull request id is required/i);
});

test("comment create requires a content source", async () => {
  const result = await runCliLog(["pr", "comment", "create", "4242", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /content is required/i);
});

test("comment create rejects both --message and --file", async () => {
  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--message", "hi", "--file", "x.md", ...R],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /not both/i);
});

test("comment create rejects an empty --message", async () => {
  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--message", "   ", ...R],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /empty/i);
});

test("comment create rejects an empty --file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ado-axi-comment-empty-"));
  const file = join(dir, "empty.md");
  writeFileSync(file, "\n  \n", "utf-8");

  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--file", file, ...R],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /empty/i);
});

test("comment create errors when the --file path is unreadable", async () => {
  const result = await runCliLog(
    ["pr", "comment", "create", "4242", "--file", "/nope/missing.md", ...R],
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /could not read comment file/i);
});

test("comment rejects an unknown action", async () => {
  const result = await runCliLog(["pr", "comment", "frob", "4242", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Unknown comment action: frob/);
});
