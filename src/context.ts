import { execFileSync } from "node:child_process";

export interface AdoContext {
  /** Organization URL, e.g. https://dev.azure.com/Ipto */
  orgUrl: string;
  /** Organization name, e.g. Ipto */
  org: string;
  /** Project name, e.g. IptoAIasset */
  project: string;
  /** Repository name, e.g. asset-mgmt-assistant-backend */
  repo: string;
  /** Personal access token, pulled from the git credential helper */
  pat: string;
  /** How the context was resolved */
  source: "flag" | "env" | "git";
}

/**
 * Resolve the Azure DevOps org/project/repo and a PAT.
 *
 * Org/project/repo priority: --repo/-R flag (org/project/repo) > AZP_REPO env > git origin.
 * The PAT is always read from the git credential helper for the org URL — the same
 * mechanism the `azp` zsh shim uses (`git credential fill` → password). This keeps the
 * token out of argv/env files and lets ado-axi run as a standalone binary.
 */
export function resolveContext(flagValue?: string): AdoContext | undefined {
  const parts = resolveOrgProjectRepo(flagValue);
  if (!parts) return undefined;

  const orgUrl = `https://dev.azure.com/${parts.org}`;
  const pat = readPat(orgUrl);
  if (!pat) return undefined;

  return { ...parts, orgUrl, pat };
}

type Parts = Pick<AdoContext, "org" | "project" | "repo" | "source">;

function resolveOrgProjectRepo(flagValue?: string): Parts | undefined {
  if (flagValue) {
    const p = parseTriple(flagValue, "flag");
    if (p) return p;
  }
  const envRepo = process.env["AZP_REPO"];
  if (envRepo) {
    const p = parseTriple(envRepo, "env");
    if (p) return p;
  }
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseRemoteUrl(url);
  } catch {
    return undefined;
  }
}

/** Parse "org/project/repo" from a flag or env value. */
function parseTriple(value: string, source: "flag" | "env"): Parts | undefined {
  const parts = value.split("/").filter(Boolean);
  if (parts.length !== 3) return undefined;
  return { org: parts[0], project: parts[1], repo: parts[2], source };
}

/**
 * Parse an Azure DevOps remote URL into org/project/repo. Handles the common forms:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 */
export function parseRemoteUrl(url: string): Parts | undefined {
  const devAzure = url.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/,
  );
  if (devAzure) {
    return {
      org: decodeURIComponent(devAzure[1]),
      project: decodeURIComponent(devAzure[2]),
      repo: decodeURIComponent(devAzure[3]),
      source: "git",
    };
  }
  const visualStudio = url.match(
    /([^/.@]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/,
  );
  if (visualStudio) {
    return {
      org: visualStudio[1],
      project: decodeURIComponent(visualStudio[2]),
      repo: decodeURIComponent(visualStudio[3]),
      source: "git",
    };
  }
  return undefined;
}

/** Pull the PAT from the git credential helper for the org URL (azp's mechanism). */
function readPat(orgUrl: string): string | undefined {
  try {
    const out = execFileSync("git", ["credential", "fill"], {
      input: `url=${orgUrl}\n\n`,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const line of out.split("\n")) {
      if (line.startsWith("password=")) {
        const pat = line.slice("password=".length).trim();
        if (pat) return pat;
      }
    }
  } catch {
    /* fall through */
  }
  return process.env["AZURE_DEVOPS_EXT_PAT"] || undefined;
}
