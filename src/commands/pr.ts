import { execFileSync } from "node:child_process";
import { type AdoContext } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, getPositional } from "../args.js";
import { renderOutput, renderData, renderHelp, renderCount } from "../render.js";

export const PR_HELP = `usage: ado-axi pr <subcommand> [flags]
subcommands[6]:
  create, show <id>, list, complete <id>, abandon <id>, checks <id>
flags{create}:
  -s/--source <branch> (default: current branch), -t/--target <branch> (default: main),
  --title <t>, --description <d>, --draft, --auto-complete, --squash
flags{list}:
  --status <active|completed|abandoned|all> (default active), --top <n> (default 30),
  --creator <id>, --source <branch>, --target <branch>
flags{complete}:
  --squash (default), --merge | --rebase, --keep-source-branch
examples:
  ado-axi pr create --title "Add readiness gate" --auto-complete
  ado-axi pr show 4242
  ado-axi pr list --status active
  ado-axi pr checks 4242
  ado-axi pr complete 4242 --squash`;

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
  // Merge strategy: squash by default; --merge or --rebase override.
  const strategy = hasFlag(args, "--merge")
    ? "noFastForward"
    : hasFlag(args, "--rebase")
      ? "rebase"
      : "squash";
  azArgs.push("--merge-strategy", strategy);
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

function requirePrId(args: string[]): number {
  const raw = getPositional(args, 1);
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
    default:
      throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Available: create, show, list, complete, abandon, checks",
      ]);
  }
}
