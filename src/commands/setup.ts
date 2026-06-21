import { installSessionStartHooks } from "axi-sdk-js";

export const SETUP_HELP = `usage: ado-axi setup hooks
Installs the AXI session-start hook so agents get ado-axi's ambient context.`;

export async function setupCommand(args: string[]): Promise<string> {
  if (args[0] === "--help" || args[0] === undefined) return SETUP_HELP;
  if (args[0] === "hooks") {
    installSessionStartHooks();
    return "setup: hooks installed or already up to date";
  }
  return `Unknown setup command: ${args[0]}\n\n${SETUP_HELP}`;
}
