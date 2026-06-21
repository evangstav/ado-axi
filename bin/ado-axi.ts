#!/usr/bin/env node
import { main } from "../src/cli.js";

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
