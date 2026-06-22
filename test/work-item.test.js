import assert from "node:assert/strict";
import test from "node:test";
import { runCliLog, readInvocations, argValue } from "./helpers.js";

const R = ["-R", "Org/Proj/Repo"];

// --- create ----------------------------------------------------------------

test("wi create builds every flag into the az args", async () => {
  const result = await runCliLog([
    "wi", "create",
    "--type", "Task",
    "--title", "Wire up gate",
    "--description", "# Hi\n\nbody",
    "--assignee", "dev@org.com",
    "--area", "Proj\\Team",
    "--iteration", "Proj\\Sprint 1",
    "--priority", "2",
    ...R,
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
  assert.equal(argValue(create, "--area"), "Proj\\Team");
  assert.equal(argValue(create, "--iteration"), "Proj\\Sprint 1");
  assert.equal(argValue(create, "--fields"), "Microsoft.VSTS.Common.Priority=2");
  assert.match(argValue(create, "--description"), /<b>Hi<\/b>/);
  assert.match(result.stdout, /created:/);
  assert.match(result.stdout, /id: 4321/);
});

test("wi create omits optional flags that were not passed", async () => {
  const result = await runCliLog(["wi", "create", "--type", "Bug", "--title", "T", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [create] = readInvocations(result.azLogFile);
  assert.equal(create.includes("--assigned-to"), false);
  assert.equal(create.includes("--fields"), false);
  assert.equal(create.includes("--description"), false);
});

test("wi create with --parent adds a parent relation after create", async () => {
  const result = await runCliLog(["wi", "create", "--type", "Task", "--title", "Child", "--parent", "99", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs.length, 2);
  assert.deepEqual(invs[1].slice(0, 4), ["boards", "work-item", "relation", "add"]);
  assert.equal(argValue(invs[1], "--relation-type"), "parent");
  assert.equal(argValue(invs[1], "--target-id"), "99");
});

test("wi create requires --type and --title", async () => {
  const noType = await runCliLog(["wi", "create", "--title", "T", ...R]);
  assert.equal(noType.status, 2, noType.stdout);
  assert.match(noType.stdout, /--type is required/);

  const noTitle = await runCliLog(["wi", "create", "--type", "Task", ...R]);
  assert.equal(noTitle.status, 2, noTitle.stdout);
  assert.match(noTitle.stdout, /--title is required/);
});

// --- update ----------------------------------------------------------------

test("wi update maps each field flag and reports the item", async () => {
  const result = await runCliLog([
    "wi", "update", "4321",
    "--title", "New",
    "--description", "plain text",
    "--assignee", "dev@org.com",
    "--state", "Active",
    "--priority", "1",
    ...R,
  ]);

  assert.equal(result.status, 0, result.stdout);
  const [update] = readInvocations(result.azLogFile);
  assert.deepEqual(update.slice(0, 5), ["boards", "work-item", "update", "--id", "4321"]);
  assert.equal(argValue(update, "--title"), "New");
  assert.equal(argValue(update, "--assigned-to"), "dev@org.com");
  assert.equal(argValue(update, "--state"), "Active");
  assert.equal(argValue(update, "--fields"), "Microsoft.VSTS.Common.Priority=1");
  assert.equal(argValue(update, "--description"), "<div>plain text</div>");
  assert.match(result.stdout, /updated:/);
});

test("wi update --parent calls relation add and still reports via show", async () => {
  const result = await runCliLog(["wi", "update", "4321", "--parent", "7", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  // No field change → no `update` call; just a relation add then a show.
  assert.equal(invs.some((i) => i[2] === "update"), false);
  assert.deepEqual(invs[0].slice(0, 4), ["boards", "work-item", "relation", "add"]);
  assert.equal(argValue(invs[0], "--relation-type"), "parent");
  assert.equal(argValue(invs[0], "--target-id"), "7");
  assert.deepEqual(invs[1].slice(0, 3), ["boards", "work-item", "show"]);
});

test("wi update --add-relation parses type:id", async () => {
  const result = await runCliLog(["wi", "update", "4321", "--add-relation", "related:888", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [rel] = readInvocations(result.azLogFile);
  assert.deepEqual(rel.slice(0, 4), ["boards", "work-item", "relation", "add"]);
  assert.equal(argValue(rel, "--relation-type"), "related");
  assert.equal(argValue(rel, "--target-id"), "888");
});

test("wi update --add-relation rejects a malformed value", async () => {
  const result = await runCliLog(["wi", "update", "4321", "--add-relation", "nope", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /--add-relation must be <type:id>/);
});

test("wi update with field change and a relation runs both", async () => {
  const result = await runCliLog(["wi", "update", "4321", "--state", "Active", "--parent", "7", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const invs = readInvocations(result.azLogFile);
  assert.equal(invs[0][2], "update");
  assert.deepEqual(invs[1].slice(0, 4), ["boards", "work-item", "relation", "add"]);
  // No extra show needed — the update response is reused.
  assert.equal(invs.some((i) => i[2] === "show"), false);
});

test("wi update with no changes is rejected before any az call", async () => {
  const result = await runCliLog(["wi", "update", "4321", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Nothing to update/);
});

// --- show ------------------------------------------------------------------

test("wi show projects id/type/state/title/assignee", async () => {
  const result = await runCliLog(["wi", "show", "4321", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [show] = readInvocations(result.azLogFile);
  assert.deepEqual(show.slice(0, 5), ["boards", "work-item", "show", "--id", "4321"]);
  assert.match(result.stdout, /work_item:/);
  assert.match(result.stdout, /type: Task/);
  assert.match(result.stdout, /state: Active/);
  assert.match(result.stdout, /assignee: Dev One/);
});

test("wi show requires a numeric id", async () => {
  const result = await runCliLog(["wi", "show", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /work item id is required/);
});

// --- delete ----------------------------------------------------------------

test("wi delete soft-deletes with --project and --yes (no --destroy)", async () => {
  const result = await runCliLog(["wi", "delete", "4321", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [del] = readInvocations(result.azLogFile);
  assert.deepEqual(del.slice(0, 7), [
    "boards", "work-item", "delete",
    "--id", "4321",
    "--project", "Proj",
  ]);
  assert.equal(del.includes("--yes"), true);
  assert.equal(del.includes("--destroy"), false);
  assert.match(result.stdout, /destroyed: false/);
  assert.match(result.stdout, /recycle bin/);
});

test("wi delete --destroy is permanent and tolerates a non-JSON az reply", async () => {
  // Live `az ... delete --destroy` prints a bare 'Deleted work item N' (not JSON).
  const result = await runCliLog(["wi", "delete", "4321", "--destroy", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [del] = readInvocations(result.azLogFile);
  assert.equal(del.includes("--destroy"), true);
  assert.equal(del.includes("--project"), true);
  assert.match(result.stdout, /destroyed: true/);
  assert.match(result.stdout, /not recoverable/);
});

// --- list / WIQL -----------------------------------------------------------

test("wi list builds project-scoped WIQL from --state and --type", async () => {
  const result = await runCliLog(["wi", "list", "--state", "Active", "--type", "Task", ...R]);

  assert.equal(result.status, 0, result.stdout);
  const [query] = readInvocations(result.azLogFile);
  assert.deepEqual(query.slice(0, 5), ["boards", "query", "--project", "Proj", "--wiql"]);
  const wiql = argValue(query, "--wiql");
  assert.match(wiql, /\[System\.TeamProject\] = 'Proj'/);
  assert.match(wiql, /\[System\.State\] = 'Active'/);
  assert.match(wiql, /\[System\.WorkItemType\] = 'Task'/);
  assert.match(wiql, /ORDER BY \[System\.ChangedDate\] DESC/);
  assert.match(result.stdout, /work_items: 1/);
});

test("wi list --assignee filters on AssignedTo", async () => {
  const result = await runCliLog(["wi", "list", "--assignee", "dev@org.com", ...R]);
  const [query] = readInvocations(result.azLogFile);
  assert.match(argValue(query, "--wiql"), /\[System\.AssignedTo\] = 'dev@org.com'/);
});

test("wi list --unassigned filters on empty AssignedTo and ignores --assignee", async () => {
  const result = await runCliLog(["wi", "list", "--unassigned", "--assignee", "dev@org.com", ...R]);
  const [query] = readInvocations(result.azLogFile);
  const wiql = argValue(query, "--wiql");
  assert.match(wiql, /\[System\.AssignedTo\] = ''/);
  assert.doesNotMatch(wiql, /dev@org\.com/);
});

test("wi list escapes single quotes in WIQL values", async () => {
  const result = await runCliLog(["wi", "list", "--assignee", "O'Brien", ...R]);
  const [query] = readInvocations(result.azLogFile);
  assert.match(argValue(query, "--wiql"), /'O''Brien'/);
});

test("wi list --query is a raw passthrough, still project-scoped on the command", async () => {
  const raw = "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 42";
  const result = await runCliLog(["wi", "list", "--query", raw, ...R]);
  const [query] = readInvocations(result.azLogFile);
  assert.equal(argValue(query, "--wiql"), raw);
  assert.equal(argValue(query, "--project"), "Proj");
});

test("wi list handles an empty result set with a count and no rows", async () => {
  const result = await runCliLog(["wi", "list", ...R], { ADO_AXI_EMPTY: "1" });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /work_items: 0/);
});

// --- routing ---------------------------------------------------------------

test("wi rejects an unknown subcommand", async () => {
  const result = await runCliLog(["wi", "frobnicate", ...R]);
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stdout, /Unknown subcommand: frobnicate/);
});
