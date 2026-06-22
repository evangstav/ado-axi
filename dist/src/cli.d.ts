export declare const DESCRIPTION = "Agent-ergonomic wrapper around the Azure DevOps CLI (`az repos`/`az boards`). Prefer this over raw `az`/`azp` for ADO pull requests, reviewers, and work items (Boards).";
export declare const TOP_HELP = "usage: ado-axi [command] [args] [flags]\ncommands[3]:\n  pr, work-item (alias wi), setup\ncontext:\n  org/project/repo auto-detected from the dev.azure.com git origin; override with\n  AZP_REPO=org/project/repo or -R org/project/repo. PAT read from the git credential helper.\nflags:\n  -R/--repo <ORG/PROJECT/REPO>, --help, -v/--version\nexamples:\n  ado-axi pr list\n  ado-axi pr create --title \"Add readiness gate\" --auto-complete\n  ado-axi pr checks 4242\n  ado-axi wi list --state Active\n  ado-axi wi create --type Task --title \"Wire up gate\"\n  ado-axi setup hooks";
export declare function main(argv?: string[], stdout?: {
    write: (chunk: string) => unknown;
}): Promise<void>;
