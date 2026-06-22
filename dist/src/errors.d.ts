import { AxiError, exitCodeForError } from "axi-sdk-js";
export type ErrorCode = "REPO_NOT_FOUND" | "NOT_FOUND" | "AUTH_REQUIRED" | "FORBIDDEN" | "VALIDATION_ERROR" | "AZ_NOT_INSTALLED" | "UNKNOWN";
export { AxiError, exitCodeForError };
export declare function mapAzError(stderr: string, exitCode: number): AxiError;
export declare function azNotInstalledError(): AxiError;
