import { execFile } from "node:child_process";
import { AxiError, azNotInstalledError, mapAzError } from "./errors.js";
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
/**
 * Build the az argument list, injecting --organization (every `az devops`/`az repos`
 * command accepts it). Project/repository scoping is added by each command since not
 * every subcommand takes them.
 */
function buildArgs(args, ctx) {
    return [...args, "--organization", ctx.orgUrl];
}
function run(args, ctx) {
    return new Promise((resolve) => {
        execFile("az", args, {
            maxBuffer: MAX_BUFFER_BYTES,
            // The PAT rides the env var the azure-devops extension reads, exactly like azp.
            env: { ...process.env, AZURE_DEVOPS_EXT_PAT: ctx.pat },
        }, (error, stdout, stderr) => {
            if (error && error.code === "ENOENT") {
                resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
                return;
            }
            const code = error
                ? (error.code ?? 1)
                : 0;
            resolve({
                stdout: stdout ?? "",
                stderr: stderr ?? "",
                exitCode: typeof code === "number" ? code : 1,
            });
        });
    });
}
/** Execute az with `-o json` and return parsed JSON. */
export async function azJson(args, ctx) {
    const result = await run(buildArgs([...args, "-o", "json"], ctx), ctx);
    if (result.stderr === "ENOENT")
        throw azNotInstalledError();
    if (result.exitCode !== 0)
        throw mapAzError(result.stderr, result.exitCode);
    try {
        return JSON.parse(result.stdout);
    }
    catch {
        throw new AxiError(`Unexpected az output: ${result.stdout.slice(0, 200)}`, "UNKNOWN");
    }
}
/** Execute az and return raw stdout (no JSON parse). */
export async function azExec(args, ctx) {
    const result = await run(buildArgs(args, ctx), ctx);
    if (result.stderr === "ENOENT")
        throw azNotInstalledError();
    if (result.exitCode !== 0)
        throw mapAzError(result.stderr, result.exitCode);
    return result.stdout;
}
//# sourceMappingURL=az.js.map