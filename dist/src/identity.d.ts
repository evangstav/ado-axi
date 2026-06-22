import { type AdoContext } from "./context.js";
/** True when the value is already an Azure DevOps identity GUID. */
export declare function looksLikeGuid(value: string): boolean;
/**
 * Whether an `az` failure looks like the identity endpoint refusing a Code-scoped
 * PAT. `pr reviewer add` resolves the reviewer through
 * `vssps.dev.azure.com/.../_apis/Identities`, which a PAT without the Identity
 * scope cannot reach — it returns "requires user authentication". That is the
 * cue to fall back to PR-history resolution.
 */
export declare function isIdentityAuthError(err: unknown): boolean;
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
export declare function resolveIdentityFromPrHistory(value: string, ctx: AdoContext): Promise<string[]>;
