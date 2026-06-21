import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "REPO_NOT_FOUND"
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "AZ_NOT_INSTALLED"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
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
    pattern: /TF400813|not authorized|Unauthorized|401/i,
    code: "AUTH_REQUIRED",
    message: () =>
      "Azure DevOps auth failed — PAT missing, expired, or wrong scope",
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
    message: () =>
      "An active pull request already exists for this source/target branch",
    suggestions: () => ["Run `ado-axi pr list` to find it"],
  },
];

function firstErrorLine(stderr: string): string {
  return (
    redactSensitive(stderr)
      .trim()
      .split("\n")
      .find((l) => l.trim().length > 0) ?? ""
  );
}

function errorExcerpt(stderr: string): string {
  const excerpt = redactSensitive(stderr)
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
  return excerpt.length > 500 ? `${excerpt.slice(0, 500)}...` : excerpt;
}

function redactSensitive(value: string): string {
  return value.replace(
    /\b(password|token|pat|AZURE_DEVOPS_EXT_PAT)=\S+/gi,
    "$1=[redacted]",
  );
}

export function mapAzError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(
        message(match, stderr),
        code,
        suggestions?.(match) ?? [],
      );
    }
  }
  if (/not found/i.test(stderr)) {
    return new AxiError(firstErrorLine(stderr), "NOT_FOUND");
  }
  return new AxiError(
    errorExcerpt(stderr) || `az exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function azNotInstalledError(): AxiError {
  return new AxiError(
    "az CLI (with the azure-devops extension) is not installed — see https://learn.microsoft.com/cli/azure",
    "AZ_NOT_INSTALLED",
  );
}
