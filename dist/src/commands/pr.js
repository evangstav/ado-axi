import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, getPositional } from "../args.js";
import { renderOutput, renderData, renderHelp, renderCount } from "../render.js";
import { looksLikeGuid, isIdentityAuthError, resolveIdentityFromPrHistory, } from "../identity.js";
export const PR_HELP = `usage: ado-axi pr <subcommand> [flags]
subcommands[8]:
  create, show <id>, list, complete <id>, abandon <id>, checks <id>, reviewer, comment
flags{create}:
  -s/--source <branch> (default: current branch), -t/--target <branch> (default: main),
  --title <t>, --description <d>, --draft, --auto-complete, --squash
flags{list}:
  --status <active|completed|abandoned|all> (default active), --top <n> (default 30),
  --creator <id>, --source <branch>, --target <branch>
flags{complete}:
  --squash (default), --merge, --keep-source-branch
flags{reviewer}:
  reviewer add <id> --reviewer <email|name|guid> [--required]
  reviewer list <id>
flags{comment}:
  comment create <id> --message <text>   (aliases: --body, --content)
  comment create <id> --file <path>      (read Markdown/plaintext from disk)
examples:
  ado-axi pr create --title "Add readiness gate" --auto-complete
  ado-axi pr show 4242
  ado-axi pr list --status active
  ado-axi pr checks 4242
  ado-axi pr complete 4242 --squash
  ado-axi pr reviewer add 4242 --reviewer dev@org.com --required
  ado-axi pr comment create 4242 --message "LGTM — one nit on error handling"
  ado-axi pr comment create 4242 --file review.md`;
/** TOON-shaped projection of a PR (a few fields, not the full az blob). */
function prSummary(pr, ctx) {
    const repo = pr["repository"];
    return {
        id: pr["pullRequestId"],
        title: pr["title"],
        status: pr["status"],
        source: stripRef(pr["sourceRefName"]),
        target: stripRef(pr["targetRefName"]),
        isDraft: pr["isDraft"] ?? false,
        repo: repo?.["name"] ?? ctx.repo,
        url: webUrl(pr, ctx),
    };
}
function stripRef(ref) {
    return typeof ref === "string" ? ref.replace(/^refs\/heads\//, "") : undefined;
}
/**
 * Build the human web URL deterministically from the resolved context. `az pr list`
 * returns abbreviated repo objects without a usable URL, but org/project/repo are always
 * known, so the URL never depends on the response shape.
 */
function webUrl(pr, ctx) {
    const id = pr["pullRequestId"];
    if (id === undefined || id === null)
        return undefined;
    return `${ctx.orgUrl}/${encodeURIComponent(ctx.project)}/_git/${encodeURIComponent(ctx.repo)}/pullrequest/${id}`;
}
function currentBranch() {
    try {
        return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    }
    catch {
        return undefined;
    }
}
async function createPr(args, ctx) {
    const source = getFlag(args, "--source") ?? getFlag(args, "-s") ?? currentBranch();
    if (!source) {
        throw new AxiError("No source branch — pass --source or run inside a git checkout", "VALIDATION_ERROR");
    }
    const target = getFlag(args, "--target") ?? getFlag(args, "-t") ?? "main";
    const title = getFlag(args, "--title") ?? `Merge ${source} into ${target}`;
    const azArgs = [
        "repos", "pr", "create",
        "--project", ctx.project,
        "--repository", ctx.repo,
        "--source-branch", source,
        "--target-branch", target,
        "--title", title,
    ];
    const description = getFlag(args, "--description");
    if (description)
        azArgs.push("--description", description);
    if (hasFlag(args, "--draft"))
        azArgs.push("--draft", "true");
    if (hasFlag(args, "--auto-complete"))
        azArgs.push("--auto-complete", "true");
    if (hasFlag(args, "--squash"))
        azArgs.push("--squash", "true");
    const pr = await azJson(azArgs, ctx);
    const summary = prSummary(pr, ctx);
    return renderOutput([
        renderData("created", summary),
        renderHelp([
            `Track it: ado-axi pr checks ${summary.id}`,
            `Complete when policies pass: ado-axi pr complete ${summary.id}`,
        ]),
    ]);
}
async function showPr(args, ctx) {
    const id = requirePrId(args);
    const pr = await azJson(["repos", "pr", "show", "--id", String(id)], ctx);
    return renderOutput([renderData("pr", prSummary(pr, ctx))]);
}
async function listPrs(args, ctx) {
    const status = getFlag(args, "--status") ?? "active";
    const top = getFlag(args, "--top") ?? "30";
    const azArgs = [
        "repos", "pr", "list",
        "--project", ctx.project,
        "--repository", ctx.repo,
        "--status", status,
        "--top", top,
    ];
    const creator = getFlag(args, "--creator");
    if (creator)
        azArgs.push("--creator", creator);
    const source = getFlag(args, "--source");
    if (source)
        azArgs.push("--source-branch", source);
    const target = getFlag(args, "--target");
    if (target)
        azArgs.push("--target-branch", target);
    const prs = await azJson(azArgs, ctx);
    return renderOutput([
        renderCount("pull_requests", prs.length),
        renderData("pull_requests", prs.map((pr) => prSummary(pr, ctx))),
        renderHelp(prs.length ? [`Inspect one: ado-axi pr show <id>`] : []),
    ]);
}
async function completePr(args, ctx) {
    const id = requirePrId(args);
    const azArgs = [
        "repos", "pr", "update",
        "--id", String(id),
        "--status", "completed",
    ];
    const wantsMerge = hasFlag(args, "--merge");
    const wantsSquash = hasFlag(args, "--squash");
    if (hasFlag(args, "--rebase")) {
        throw new AxiError("az repos pr update does not support --rebase; use --merge or --squash", "VALIDATION_ERROR");
    }
    if (wantsMerge && wantsSquash) {
        throw new AxiError("Choose only one completion strategy: --merge or --squash", "VALIDATION_ERROR");
    }
    azArgs.push("--squash", wantsMerge ? "false" : "true");
    if (!hasFlag(args, "--keep-source-branch")) {
        azArgs.push("--delete-source-branch", "true");
    }
    azArgs.push("--transition-work-items", "true");
    const pr = await azJson(azArgs, ctx);
    return renderOutput([
        renderData("completed", prSummary(pr, ctx)),
        renderHelp([`Status is set; ADO finalizes the merge once policies pass.`]),
    ]);
}
async function abandonPr(args, ctx) {
    const id = requirePrId(args);
    const pr = await azJson(["repos", "pr", "update", "--id", String(id), "--status", "abandoned"], ctx);
    return renderOutput([renderData("abandoned", prSummary(pr, ctx))]);
}
/**
 * Policy evaluations are the ADO equivalent of GitHub "checks". Summarize them into a
 * single green/red verdict plus per-policy status — what a merge-poll waits on.
 */
async function checksPr(args, ctx) {
    const id = requirePrId(args);
    const evals = await azJson(["repos", "pr", "policy", "list", "--id", String(id)], ctx);
    const rows = evals.map((e) => {
        const cfg = e["configuration"];
        const type = cfg?.["type"];
        return {
            policy: type?.["displayName"] ?? cfg?.["id"] ?? "policy",
            status: e["status"], // approved | running | queued | rejected | notApplicable
            blocking: cfg?.["isBlocking"] ?? false,
        };
    });
    const blocking = rows.filter((r) => r.blocking);
    const rejected = blocking.filter((r) => r.status === "rejected");
    const pending = blocking.filter((r) => r.status === "running" || r.status === "queued");
    const verdict = rejected.length > 0 ? "failing" : pending.length > 0 ? "pending" : "passing";
    return renderOutput([
        renderData("checks", {
            pr: id,
            verdict,
            blocking: blocking.length,
            pending: pending.length,
            rejected: rejected.length,
        }),
        renderData("policies", rows),
        renderHelp(verdict === "passing"
            ? [`Ready: ado-axi pr complete ${id}`]
            : verdict === "pending"
                ? [`Re-check shortly: ado-axi pr checks ${id}`]
                : [`One or more blocking policies rejected the PR`]),
    ]);
}
/**
 * Reviewer management. `add` accepts an email, display name, or GUID and resolves
 * it robustly: the direct value is tried first (it is what callers have), and when
 * the identity-lookup endpoint rejects a Code-scoped PAT, the person's GUID is
 * recovered from recent PR history and the add is retried — the single biggest
 * ergonomic win over raw `az`.
 */
async function reviewerCommand(args, ctx) {
    const action = args[1];
    if (action === "add")
        return addReviewer(args, ctx);
    if (action === "list")
        return listReviewers(args, ctx);
    throw new AxiError(`Unknown reviewer action: ${action ?? "(none)"}`, "VALIDATION_ERROR", ["Available: add, list"]);
}
async function addReviewer(args, ctx) {
    const id = requirePrId(args, 2);
    const reviewer = getFlag(args, "--reviewer");
    if (!reviewer) {
        throw new AxiError("--reviewer is required (email, display name, or GUID)", "VALIDATION_ERROR");
    }
    const required = hasFlag(args, "--required");
    const runAdd = (who) => {
        const azArgs = [
            "repos", "pr", "reviewer", "add",
            "--id", String(id),
            "--reviewers", who,
        ];
        if (required)
            azArgs.push("--required", "true");
        return azJson(azArgs, ctx);
    };
    let resolved = reviewer;
    let raw;
    try {
        raw = await runAdd(reviewer);
    }
    catch (err) {
        // A GUID needs no lookup; non-identity errors (bad PR id, etc.) are real.
        if (looksLikeGuid(reviewer) || !isIdentityAuthError(err))
            throw err;
        const guids = await resolveIdentityFromPrHistory(reviewer, ctx);
        if (guids.length === 0) {
            throw new AxiError(`Could not resolve reviewer "${reviewer}" — the identity endpoint is unauthorized and no recent pull request in ${ctx.project} matches by name or email`, "VALIDATION_ERROR", [
                "Pass the reviewer's identity GUID directly",
                "Or pick someone who appears in `ado-axi pr list --status all`",
            ]);
        }
        if (guids.length > 1) {
            throw new AxiError(`Ambiguous reviewer "${reviewer}" — matched ${guids.length} distinct identities in PR history`, "VALIDATION_ERROR", [
                `Pass the exact GUID: ${guids.join(", ")}`,
                "Or use the person's unique email instead of a display name",
            ]);
        }
        resolved = guids[0];
        raw = await runAdd(resolved);
    }
    const rows = reviewerRows(raw);
    return renderOutput([
        renderCount("reviewers", rows.length),
        renderData("reviewers", rows),
        renderHelp([
            resolved === reviewer
                ? `Added ${reviewer} to PR ${id}`
                : `Resolved "${reviewer}" → ${resolved} via PR history, added to PR ${id}`,
        ]),
    ]);
}
async function listReviewers(args, ctx) {
    const id = requirePrId(args, 2);
    const raw = await azJson(["repos", "pr", "reviewer", "list", "--id", String(id)], ctx);
    const rows = reviewerRows(raw);
    return renderOutput([
        renderCount("reviewers", rows.length),
        renderData("reviewers", rows),
        renderHelp(rows.length
            ? []
            : [`Add one: ado-axi pr reviewer add ${id} --reviewer <who>`]),
    ]);
}
/**
 * Top-level PR comment creation.
 *
 * `az repos pr` has no `comment` subcommand, so we go through the REST API via
 * `az devops invoke` — which keeps PAT handling, org/project/repo scoping, and the
 * `-R` override identical to every other command (the request rides the same `az`
 * env-var PAT as azp). The endpoint is the pull-request *threads* resource:
 *   POST {org}/{project}/_apis/git/repositories/{repo}/pullRequests/{id}/threads
 * A top-level comment is a new thread with no thread context (no inline file
 * position), holding a single comment.
 *
 * IMPORTANT — PR thread comments render **Markdown**, not HTML. This is the opposite
 * of work-item/PR *descriptions* (see src/markdown.ts), which expect HTML. So we send
 * the caller's text verbatim and deliberately do NOT run it through
 * renderDescriptionHtml — HTML tags would show up literally in the comment.
 */
async function commentCommand(args, ctx) {
    const action = args[1];
    if (action === "create")
        return createComment(args, ctx);
    throw new AxiError(`Unknown comment action: ${action ?? "(none)"}`, "VALIDATION_ERROR", ["Available: create"]);
}
/** Resolve the single content source (`--message`/`--body`/`--content` or `--file`). */
function resolveCommentContent(args) {
    const inline = getFlag(args, "--message") ??
        getFlag(args, "--body") ??
        getFlag(args, "--content");
    const file = getFlag(args, "--file");
    if (inline !== undefined && file !== undefined) {
        throw new AxiError("Pass either --message (--body/--content) or --file, not both", "VALIDATION_ERROR");
    }
    if (inline === undefined && file === undefined) {
        throw new AxiError("Comment content is required — pass --message <text> or --file <path>", "VALIDATION_ERROR", [
            `ado-axi pr comment create <id> --message "Looks good"`,
            `ado-axi pr comment create <id> --file review.md`,
        ]);
    }
    if (file !== undefined) {
        let content;
        try {
            // Read raw so newlines are preserved exactly — long review comments depend on it.
            content = readFileSync(file, "utf-8");
        }
        catch {
            throw new AxiError(`Could not read comment file: ${file}`, "VALIDATION_ERROR");
        }
        if (content.trim().length === 0) {
            throw new AxiError(`Comment file is empty: ${file}`, "VALIDATION_ERROR");
        }
        return content;
    }
    if (inline.trim().length === 0) {
        throw new AxiError("Comment content is empty", "VALIDATION_ERROR");
    }
    return inline;
}
/**
 * The REST request body for a top-level comment thread. `commentType: "text"` and a
 * `parentCommentId` of 0 mark it as a new, non-reply user comment; `status: "active"`
 * opens a standard discussion thread. Exported indirectly via build* helpers so tests
 * can assert the exact payload (and that --file content is preserved verbatim).
 */
function buildCommentThreadBody(content) {
    return {
        comments: [{ parentCommentId: 0, content, commentType: "text" }],
        status: "active",
    };
}
/** The `az devops invoke` argv that POSTs a thread to a PR (body lives in `inFile`). */
function buildCommentInvokeArgs(ctx, prId, inFile) {
    return [
        "devops", "invoke",
        "--area", "git",
        "--resource", "pullRequestThreads",
        "--route-parameters",
        `project=${ctx.project}`,
        `repositoryId=${ctx.repo}`,
        `pullRequestId=${prId}`,
        "--api-version", "7.1-preview.1",
        "--http-method", "POST",
        "--in-file", inFile,
    ];
}
async function createComment(args, ctx) {
    const id = requirePrId(args, 2);
    const content = resolveCommentContent(args);
    const body = buildCommentThreadBody(content);
    // az devops invoke reads the request body from a file; write it, invoke, clean up.
    const dir = mkdtempSync(join(tmpdir(), "ado-axi-comment-"));
    const inFile = join(dir, "thread.json");
    let thread;
    try {
        writeFileSync(inFile, JSON.stringify(body), "utf-8");
        thread = await azJson(buildCommentInvokeArgs(ctx, id, inFile), ctx);
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
    const comments = Array.isArray(thread["comments"])
        ? thread["comments"]
        : [];
    const firstComment = comments[0];
    return renderOutput([
        renderData("comment", {
            pr: id,
            thread: thread["id"],
            comment: firstComment?.["id"],
            status: thread["status"] ?? "active",
            repo: ctx.repo,
            url: `${ctx.orgUrl}/${encodeURIComponent(ctx.project)}/_git/${encodeURIComponent(ctx.repo)}/pullrequest/${id}`,
        }),
        renderHelp([`See it in context: ado-axi pr show ${id}`]),
    ]);
}
/** Project the az reviewer blob(s) into a TOON table. */
function reviewerRows(raw) {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((r) => {
        const o = r;
        return {
            name: o["displayName"] ?? o["uniqueName"],
            id: o["id"],
            required: o["isRequired"] ?? false,
            vote: voteLabel(o["vote"]),
        };
    });
}
/** ADO encodes reviewer votes as small integers. */
function voteLabel(vote) {
    switch (vote) {
        case 10:
            return "approved";
        case 5:
            return "approved-with-suggestions";
        case -5:
            return "waiting";
        case -10:
            return "rejected";
        default:
            return "none";
    }
}
function requirePrId(args, start = 1) {
    const raw = getPositional(args, start);
    if (!raw || !/^\d+$/.test(raw)) {
        throw new AxiError("A pull request id is required, e.g. ado-axi pr show 4242", "VALIDATION_ERROR");
    }
    return Number(raw);
}
export async function prCommand(args, ctx) {
    const sub = args[0];
    if (sub === "--help" || sub === undefined)
        return PR_HELP;
    if (!ctx) {
        throw new AxiError("No Azure DevOps context — run inside a repo with a dev.azure.com origin, set AZP_REPO=org/project/repo, or pass -R", "VALIDATION_ERROR");
    }
    switch (sub) {
        case "create":
            return createPr(args, ctx);
        case "show":
            return showPr(args, ctx);
        case "list":
            return listPrs(args, ctx);
        case "complete":
            return completePr(args, ctx);
        case "abandon":
            return abandonPr(args, ctx);
        case "checks":
            return checksPr(args, ctx);
        case "reviewer":
            return reviewerCommand(args, ctx);
        case "comment":
            return commentCommand(args, ctx);
        default:
            throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
                "Available: create, show, list, complete, abandon, checks, reviewer, comment",
            ]);
    }
}
//# sourceMappingURL=pr.js.map