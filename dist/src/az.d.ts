import { type AdoContext } from "./context.js";
export interface ExecResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/** Execute az with `-o json` and return parsed JSON. */
export declare function azJson<T = unknown>(args: string[], ctx: AdoContext): Promise<T>;
/** Execute az and return raw stdout (no JSON parse). */
export declare function azExec(args: string[], ctx: AdoContext): Promise<string>;
