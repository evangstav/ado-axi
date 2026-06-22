import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { resolveContext } from "./context.js";
import { prCommand, PR_HELP } from "./commands/pr.js";
import { workItemCommand, WI_HELP } from "./commands/work-item.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";
export const DESCRIPTION = "Agent-ergonomic wrapper around the Azure DevOps CLI (`az repos`/`az boards`). Prefer this over raw `az`/`azp` for ADO pull requests, reviewers, and work items (Boards).";
const VERSION = readPackageVersion();
export const TOP_HELP = `usage: ado-axi [command] [args] [flags]
commands[3]:
  pr, work-item (alias wi), setup
context:
  org/project/repo auto-detected from the dev.azure.com git origin; override with
  AZP_REPO=org/project/repo or -R org/project/repo. PAT read from the git credential helper.
flags:
  -R/--repo <ORG/PROJECT/REPO>, --help, -v/--version
examples:
  ado-axi pr list
  ado-axi pr create --title "Add readiness gate" --auto-complete
  ado-axi pr checks 4242
  ado-axi wi list --state Active
  ado-axi wi create --type Task --title "Wire up gate"
  ado-axi setup hooks`;
const COMMAND_HELP = {
    pr: PR_HELP,
    "work-item": WI_HELP,
    wi: WI_HELP,
    setup: SETUP_HELP,
};
const COMMANDS = {
    pr: withContext("pr", prCommand),
    "work-item": withContext("work-item", workItemCommand),
    wi: withContext("wi", workItemCommand),
    setup: (args) => setupCommand(stripRepoFlag(args).strippedArgs),
};
export async function main(argv, stdout) {
    const normalizedArgv = normalizeLeadingRepoFlag(argv ?? process.argv.slice(2));
    await runAxiCli({
        argv: normalizedArgv,
        stdout,
        description: DESCRIPTION,
        version: VERSION,
        topLevelHelp: TOP_HELP,
        home: async () => `${DESCRIPTION}\n\n${TOP_HELP}`,
        commands: COMMANDS,
        getCommandHelp: (command) => COMMAND_HELP[command],
        resolveContext: ({ args }) => resolveContext(stripRepoFlag(args).repoFlag),
    });
}
function normalizeLeadingRepoFlag(args) {
    if (args.length < 2)
        return args;
    let repoFlag;
    let rest;
    const first = args[0];
    if ((first === "-R" || first === "--repo") && args[1]) {
        repoFlag = args[1];
        rest = args.slice(2);
    }
    else if (first.startsWith("-R=")) {
        repoFlag = first.slice(3);
        rest = args.slice(1);
    }
    else if (first.startsWith("--repo=")) {
        repoFlag = first.slice("--repo=".length);
        rest = args.slice(1);
    }
    if (!repoFlag || !rest?.length)
        return args;
    return [rest[0], ...rest.slice(1), "--repo", repoFlag];
}
function withContext(_command, handler) {
    return (args, ctx) => handler(stripRepoFlag(args).strippedArgs, ctx);
}
/** Pull `-R`/`--repo org/project/repo` out of args; it sets context, not a passthrough flag. */
function stripRepoFlag(args) {
    const stripped = [];
    let repoFlag;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if ((arg === "-R" || arg === "--repo") && i + 1 < args.length) {
            repoFlag = args[i + 1];
            i++;
            continue;
        }
        if (arg.startsWith("-R=")) {
            repoFlag = arg.slice(3);
            continue;
        }
        if (arg.startsWith("--repo=")) {
            repoFlag = arg.slice("--repo=".length);
            continue;
        }
        stripped.push(arg);
    }
    return { repoFlag, strippedArgs: stripped };
}
function readPackageVersion() {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
        join(here, "..", "package.json"),
        join(here, "..", "..", "package.json"),
    ]) {
        if (!existsSync(candidate))
            continue;
        const parsed = JSON.parse(readFileSync(candidate, "utf-8"));
        if (typeof parsed.version === "string" && parsed.version.length > 0) {
            return parsed.version;
        }
    }
    return "0.0.0";
}
//# sourceMappingURL=cli.js.map