# Repository Guidelines

## Project Structure & Module Organization

`ado-axi` is a small TypeScript CLI for Azure DevOps PR workflows.

| Path | Purpose |
| --- | --- |
| `bin/ado-axi.ts` | executable entry point used by `npm run dev` |
| `src/cli.ts` | top-level command routing and help text |
| `src/commands/` | command implementations such as `pr` and `setup` |
| `src/args.ts`, `src/context.ts`, `src/az.ts` | argument parsing, repo/auth context, and `az` integration |
| `src/render.ts`, `src/errors.ts` | TOON rendering and structured error handling |
| `dist/` | generated build output; do not edit by hand |

## Build, Test, and Development Commands

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Run locally | `npm run dev -- pr list` |
| Build distributable JS and declarations | `npm run build` |
| Type-check without emitting files | `npm run typecheck` |
| Run regression tests | `npm test` |

`npm test` builds first, then runs the Node-based CLI regression suite.

## Coding Style & Naming Conventions

Use TypeScript ES modules targeting Node 20+. Keep `strict` TypeScript clean, prefer small modules with named exports, and keep command-specific logic under `src/commands/`. Use lower-case file names that describe the responsibility, such as `context.ts` or `setup.ts`. Avoid hand-editing generated files in `dist/`.

## Testing Guidelines

Tests live under `test/` and use Node's built-in `node:test` runner. Add focused CLI or module tests with names like `cli.test.js`, `pr.test.js`, or `context.test.js`. Cover argument parsing, Azure DevOps command construction, context resolution, and error rendering before changing CLI behavior.

## Commit & Pull Request Guidelines

The current history is too short to establish a durable local convention. Until one emerges, use concise intent-first commit messages and include verification in the body when useful.

Pull requests should include the user-facing CLI change, validation commands run, linked issue or context, and sample output when command behavior changes. Never include PATs or credential-helper output in PR text, logs, or fixtures.

## Security & Configuration Tips

The CLI expects Azure DevOps credentials from the git credential helper, with `AZURE_DEVOPS_EXT_PAT` only as a fallback. Do not store tokens in tracked files, shell snippets, examples, or screenshots.
