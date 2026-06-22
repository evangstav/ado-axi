import { azJson } from "./az.js";
import { AxiError } from "./errors.js";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True when the value is already an Azure DevOps identity GUID. */
export function looksLikeGuid(value) {
    return GUID_RE.test(value.trim());
}
/**
 * Whether an `az` failure looks like the identity endpoint refusing a Code-scoped
 * PAT. `pr reviewer add` resolves the reviewer through
 * `vssps.dev.azure.com/.../_apis/Identities`, which a PAT without the Identity
 * scope cannot reach — it returns "requires user authentication". That is the
 * cue to fall back to PR-history resolution.
 */
export function isIdentityAuthError(err) {
    if (!(err instanceof AxiError))
        return false;
    if (err.code === "AUTH_REQUIRED" || err.code === "FORBIDDEN")
        return true;
    return /authenticat|identit|unauthor|VS40332|TF400813|\b401\b|\b403\b/i.test(err.message);
}
/**
 * Resolve a person reference (email / display name / GUID) to identity GUIDs by
 * scanning recent pull requests in the project. The Identities REST endpoint often
 * rejects a Code-scoped PAT, but PR history is reachable with the same token and
 * carries the identities we need (`createdBy` plus every entry in `reviewers`).
 * Matching is case-insensitive against displayName, uniqueName, and mailAddress.
 *
 * Returns the *distinct* matching GUIDs in first-seen order — usually one (the same
 * person recurs across PRs with the same id), but more than one means the reference
 * is ambiguous (e.g. two people share a display name), which the caller surfaces.
 */
export async function resolveIdentityFromPrHistory(value, ctx) {
    const prs = await azJson([
        "repos", "pr", "list",
        "--project", ctx.project,
        "--status", "all",
        "--top", "100",
    ], ctx);
    const needle = value.trim().toLowerCase();
    const matches = new Set();
    for (const pr of prs) {
        const candidates = [];
        const createdBy = pr["createdBy"];
        if (createdBy)
            candidates.push(createdBy);
        const reviewers = pr["reviewers"];
        if (Array.isArray(reviewers))
            candidates.push(...reviewers);
        for (const c of candidates) {
            const id = c["id"];
            if (typeof id !== "string" || !id)
                continue;
            const names = [c["displayName"], c["uniqueName"], c["mailAddress"]]
                .filter((n) => typeof n === "string")
                .map((n) => n.toLowerCase());
            if (names.includes(needle))
                matches.add(id);
        }
    }
    return [...matches];
}
//# sourceMappingURL=identity.js.map