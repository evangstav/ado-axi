import { AxiError, exitCodeForError } from "axi-sdk-js";
export { AxiError, exitCodeForError };
const patterns = [
    {
        pattern: /TF401019|does not exist or you do not have permission/i,
        code: "REPO_NOT_FOUND",
        message: () => "Repository or project not found, or PAT lacks access",
        suggestions: () => [
            "Confirm org/project/repo with `ado-axi repo show`",
            "Check the PAT has Code (read/write) scope for this org",
        ],
    },
    {
        pattern: /pull request.*?(\d+).*?does not exist/i,
        code: "NOT_FOUND",
        message: (m) => `Pull request ${m[1]} does not exist`,
    },
    {
        // TF401232: "Work item N does not exist, or you do not have permissions…".
        // Keep this ahead of the auth pattern so the `401` in TFxxx is not misread.
        pattern: /(?:TF401232:?\s*)?work item\s+(\d+)\s+does not exist/i,
        code: "NOT_FOUND",
        message: (m) => m[1]
            ? `Work item ${m[1]} does not exist or you lack permission to read it`
            : "Work item does not exist or you lack permission to read it",
    },
    {
        // `401` is word-bounded so it matches an HTTP 401 but NOT codes like
        // TF401398/TF401232 that merely contain the digits "401".
        pattern: /TF400813|not authorized|Unauthorized|requires user authentication|\b401\b/i,
        code: "AUTH_REQUIRED",
        message: () => "Azure DevOps auth failed — PAT missing, expired, or wrong scope",
        suggestions: () => [
            "Refresh the PAT in the git credential helper for this org",
            "Ensure the PAT has the scopes the operation needs (Code, Pull Request)",
        ],
    },
    {
        pattern: /403|Forbidden/i,
        code: "FORBIDDEN",
        message: () => "Insufficient permissions for this action",
    },
    {
        pattern: /TF401179|active pull request.*already exists/i,
        code: "VALIDATION_ERROR",
        message: () => "An active pull request already exists for this source/target branch",
        suggestions: () => ["Run `ado-axi pr list` to find it"],
    },
];
function firstErrorLine(stderr) {
    return (redactSensitive(stderr)
        .trim()
        .split("\n")
        .find((l) => l.trim().length > 0) ?? "");
}
function errorExcerpt(stderr) {
    const excerpt = redactSensitive(stderr)
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join("\n");
    return excerpt.length > 500 ? `${excerpt.slice(0, 500)}...` : excerpt;
}
function redactSensitive(value) {
    return value.replace(/\b(password|token|pat|AZURE_DEVOPS_EXT_PAT)=\S+/gi, "$1=[redacted]");
}
export function mapAzError(stderr, exitCode) {
    for (const { pattern, code, message, suggestions } of patterns) {
        const match = stderr.match(pattern);
        if (match) {
            return new AxiError(message(match, stderr), code, suggestions?.(match) ?? []);
        }
    }
    if (/not found/i.test(stderr)) {
        return new AxiError(firstErrorLine(stderr), "NOT_FOUND");
    }
    return new AxiError(errorExcerpt(stderr) || `az exited with code ${exitCode}`, "UNKNOWN");
}
export function azNotInstalledError() {
    return new AxiError("az CLI (with the azure-devops extension) is not installed — see https://learn.microsoft.com/cli/azure", "AZ_NOT_INSTALLED");
}
//# sourceMappingURL=errors.js.map