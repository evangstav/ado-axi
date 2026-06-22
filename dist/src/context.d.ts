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
export declare function resolveContext(flagValue?: string): AdoContext | undefined;
type Parts = Pick<AdoContext, "org" | "project" | "repo" | "source">;
/**
 * Parse an Azure DevOps remote URL into org/project/repo. Handles the common forms:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{user}@dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 */
export declare function parseRemoteUrl(url: string): Parts | undefined;
export {};
