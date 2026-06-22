import { execFileSync } from "node:child_process";
import { type AdoContext } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, getPositional } from "../args.js";
import { renderOutput, renderData, renderHelp, renderCount } from "../render.js";
import {
  looksLikeGuid,
  isIdentityAuthError,
  resolveIdentityFromPrHistory,
} from "../identity.js";

export const PR_HELP = `usage: ado-axi pr <subcommand> [flags]
subcommands[7]:
  create, show <id>, list, complete <id>, abandon <id>, checks <id>, reviewer
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
examples:
  ado-axi pr create --title "Add readiness gate" --auto-complete
  ado-axi pr show 4242
  ado-axi pr list --status active
  ado-axi pr checks 4242
  ado-axi pr complete 4242 --squash
  ado-axi pr reviewer add 4242 --reviewer dev@org.com --required`;

/** TOON-shaped projection of a PR (a few fields, not the full az blob). */
function prSummary(
  pr: Record<string, unknown>,
  ctx: AdoContext,
): Record<string, unknown> {
  const repo = pr["repository"] as Record<string, unknown> | undefined;
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

function stripRef(ref: unknown): string | undefined {
  return typeof ref === "string" ? ref.replace(/^refs\/heads\//, "") : undefined;
}

/**
 * Build the human web URL deterministically from the resolved context. `az pr list`
 * returns abbreviated repo objects without a usable URL, but org/project/repo are always
 * known, so the URL never depends on the response shape.
 */
function webUrl(
  pr: Record<string, unknown>,
  ctx: AdoContext,
): string | undefined {
  const id = pr["pullRequestId"];
  if (id === undefined || id === null) return undefined;
  return `${ctx.orgUrl}/${encodeURIComponent(ctx.project)}/_git/${encodeURIComponent(ctx.repo)}/pullrequest/${id}`;
}

function currentBranch(): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

async function createPr(args: string[], ctx: AdoContext): Promise<string> {
  const source = getFlag(args, "--source") ?? getFlag(args, "-s") ?? currentBranch();
  if (!source) {
    throw new AxiError(
      "No source branch — pass --source or run inside a git checkout",
      "VALIDATION_ERROR",
    );
  }
  const target = getFlag(args, "--target") ?? getFlag(args, "-t") ?? "main";
  const title =
    getFlag(args, "--title") ?? `Merge ${source} into ${target}`;

  const azArgs = [
    "repos", "pr", "create",
    "--project", ctx.project,
    "--repository", ctx.repo,
    "--source-branch", source,
    "--target-branch", target,
    "--title", title,
  ];
  const description = getFlag(args, "--description");
  if (description) azArgs.push("--description", description);
  if (hasFlag(args, "--draft")) azArgs.push("--draft", "true");
  if (hasFlag(args, "--auto-complete")) azArgs.push("--auto-complete", "true");
  if (hasFlag(args, "--squash")) azArgs.push("--squash", "true");

  const pr = await azJson<Record<string, unknown>>(azArgs, ctx);
  const summary = prSummary(pr, ctx);
  return renderOutput([
    renderData("created", summary),
    renderHelp([
      `Track it: ado-axi pr checks ${summary.id}`,
      `Complete when policies pass: ado-axi pr complete ${summary.id}`,
    ]),
  ]);
}

async function showPr(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args);
  const pr = await azJson<Record<string, unknown>>(
    ["repos", "pr", "show", "--id", String(id)],
    ctx,
  );
  return renderOutput([renderData("pr", prSummary(pr, ctx))]);
}

async function listPrs(args: string[], ctx: AdoContext): Promise<string> {
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
  if (creator) azArgs.push("--creator", creator);
  const source = getFlag(args, "--source");
  if (source) azArgs.push("--source-branch", source);
  const target = getFlag(args, "--target");
  if (target) azArgs.push("--target-branch", target);

  const prs = await azJson<Record<string, unknown>[]>(azArgs, ctx);
  return renderOutput([
    renderCount("pull_requests", prs.length),
    renderData("pull_requests", prs.map((pr) => prSummary(pr, ctx))),
    renderHelp(
      prs.length ? [`Inspect one: ado-axi pr show <id>`] : [],
    ),
  ]);
}

async function completePr(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args);
  const azArgs = [
    "repos", "pr", "update",
    "--id", String(id),
    "--status", "completed",
  ];
  const wantsMerge = hasFlag(args, "--merge");
  const wantsSquash = hasFlag(args, "--squash");
  if (hasFlag(args, "--rebase")) {
    throw new AxiError(
      "az repos pr update does not support --rebase; use --merge or --squash",
      "VALIDATION_ERROR",
    );
  }
  if (wantsMerge && wantsSquash) {
    throw new AxiError(
      "Choose only one completion strategy: --merge or --squash",
      "VALIDATION_ERROR",
    );
  }
  azArgs.push("--squash", wantsMerge ? "false" : "true");
  if (!hasFlag(args, "--keep-source-branch")) {
    azArgs.push("--delete-source-branch", "true");
  }
  azArgs.push("--transition-work-items", "true");

  const pr = await azJson<Record<string, unknown>>(azArgs, ctx);
  return renderOutput([
    renderData("completed", prSummary(pr, ctx)),
    renderHelp([`Status is set; ADO finalizes the merge once policies pass.`]),
  ]);
}

async function abandonPr(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args);
  const pr = await azJson<Record<string, unknown>>(
    ["repos", "pr", "update", "--id", String(id), "--status", "abandoned"],
    ctx,
  );
  return renderOutput([renderData("abandoned", prSummary(pr, ctx))]);
}

/**
 * Policy evaluations are the ADO equivalent of GitHub "checks". Summarize them into a
 * single green/red verdict plus per-policy status — what a merge-poll waits on.
 */
async function checksPr(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args);
  const evals = await azJson<Record<string, unknown>[]>(
    ["repos", "pr", "policy", "list", "--id", String(id)],
    ctx,
  );
  const rows = evals.map((e) => {
    const cfg = e["configuration"] as Record<string, unknown> | undefined;
    const type = cfg?.["type"] as Record<string, unknown> | undefined;
    return {
      policy: type?.["displayName"] ?? cfg?.["id"] ?? "policy",
      status: e["status"], // approved | running | queued | rejected | notApplicable
      blocking: (cfg?.["isBlocking"] as boolean) ?? false,
    };
  });
  const blocking = rows.filter((r) => r.blocking);
  const rejected = blocking.filter((r) => r.status === "rejected");
  const pending = blocking.filter(
    (r) => r.status === "running" || r.status === "queued",
  );
  const verdict =
    rejected.length > 0 ? "failing" : pending.length > 0 ? "pending" : "passing";

  return renderOutput([
    renderData("checks", {
      pr: id,
      verdict,
      blocking: blocking.length,
      pending: pending.length,
      rejected: rejected.length,
    }),
    renderData("policies", rows),
    renderHelp(
      verdict === "passing"
        ? [`Ready: ado-axi pr complete ${id}`]
        : verdict === "pending"
          ? [`Re-check shortly: ado-axi pr checks ${id}`]
          : [`One or more blocking policies rejected the PR`],
    ),
  ]);
}

/**
 * Reviewer management. `add` accepts an email, display name, or GUID and resolves
 * it robustly: the direct value is tried first (it is what callers have), and when
 * the identity-lookup endpoint rejects a Code-scoped PAT, the person's GUID is
 * recovered from recent PR history and the add is retried — the single biggest
 * ergonomic win over raw `az`.
 */
async function reviewerCommand(args: string[], ctx: AdoContext): Promise<string> {
  const action = args[1];
  if (action === "add") return addReviewer(args, ctx);
  if (action === "list") return listReviewers(args, ctx);
  throw new AxiError(
    `Unknown reviewer action: ${action ?? "(none)"}`,
    "VALIDATION_ERROR",
    ["Available: add, list"],
  );
}

async function addReviewer(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args, 2);
  const reviewer = getFlag(args, "--reviewer");
  if (!reviewer) {
    throw new AxiError(
      "--reviewer is required (email, display name, or GUID)",
      "VALIDATION_ERROR",
    );
  }
  const required = hasFlag(args, "--required");

  const runAdd = (who: string) => {
    const azArgs = [
      "repos", "pr", "reviewer", "add",
      "--id", String(id),
      "--reviewers", who,
    ];
    if (required) azArgs.push("--required", "true");
    return azJson<unknown>(azArgs, ctx);
  };

  let resolved = reviewer;
  let raw: unknown;
  try {
    raw = await runAdd(reviewer);
  } catch (err) {
    // A GUID needs no lookup; non-identity errors (bad PR id, etc.) are real.
    if (looksLikeGuid(reviewer) || !isIdentityAuthError(err)) throw err;
    const guids = await resolveIdentityFromPrHistory(reviewer, ctx);
    if (guids.length === 0) {
      throw new AxiError(
        `Could not resolve reviewer "${reviewer}" — the identity endpoint is unauthorized and no recent pull request in ${ctx.project} matches by name or email`,
        "VALIDATION_ERROR",
        [
          "Pass the reviewer's identity GUID directly",
          "Or pick someone who appears in `ado-axi pr list --status all`",
        ],
      );
    }
    if (guids.length > 1) {
      throw new AxiError(
        `Ambiguous reviewer "${reviewer}" — matched ${guids.length} distinct identities in PR history`,
        "VALIDATION_ERROR",
        [
          `Pass the exact GUID: ${guids.join(", ")}`,
          "Or use the person's unique email instead of a display name",
        ],
      );
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

async function listReviewers(args: string[], ctx: AdoContext): Promise<string> {
  const id = requirePrId(args, 2);
  const raw = await azJson<unknown>(
    ["repos", "pr", "reviewer", "list", "--id", String(id)],
    ctx,
  );
  const rows = reviewerRows(raw);
  return renderOutput([
    renderCount("reviewers", rows.length),
    renderData("reviewers", rows),
    renderHelp(
      rows.length
        ? []
        : [`Add one: ado-axi pr reviewer add ${id} --reviewer <who>`],
    ),
  ]);
}

/** Project the az reviewer blob(s) into a TOON table. */
function reviewerRows(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      name: o["displayName"] ?? o["uniqueName"],
      id: o["id"],
      required: o["isRequired"] ?? false,
      vote: voteLabel(o["vote"]),
    };
  });
}

/** ADO encodes reviewer votes as small integers. */
function voteLabel(vote: unknown): string {
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

function requirePrId(args: string[], start = 1): number {
  const raw = getPositional(args, start);
  if (!raw || !/^\d+$/.test(raw)) {
    throw new AxiError(
      "A pull request id is required, e.g. ado-axi pr show 4242",
      "VALIDATION_ERROR",
    );
  }
  return Number(raw);
}

export async function prCommand(
  args: string[],
  ctx?: AdoContext,
): Promise<string> {
  const sub = args[0];
  if (sub === "--help" || sub === undefined) return PR_HELP;
  if (!ctx) {
    throw new AxiError(
      "No Azure DevOps context — run inside a repo with a dev.azure.com origin, set AZP_REPO=org/project/repo, or pass -R",
      "VALIDATION_ERROR",
    );
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
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available: create, show, list, complete, abandon, checks, reviewer",
      ]);
  }
}
