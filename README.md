# ado-axi

An [AXI](https://github.com/kunchenguid/axi)-compliant Azure DevOps CLI wrapper — the ADO
equivalent of [`gh-axi`](https://github.com/kunchenguid/gh-axi). It wraps `az repos` with
token-efficient [TOON](https://github.com/toon-format/toon) output, contextual next-step
suggestions, and structured errors, so agents can drive Azure DevOps pull requests the way
`gh-axi` drives GitHub.

It also folds in the `azp` shim's auth model: organization, project, and repository are
auto-detected from the `dev.azure.com` git origin, and the PAT is read from the git
credential helper — so `ado-axi` runs as a standalone binary with no zsh function and no
token in argv or env files.

## Why

`gh-axi`'s pipeline assumes GitHub + `gh`. Repositories hosted on Azure DevOps have no PRs
through that path. `ado-axi` provides the same agent-ergonomic surface over `az repos`, so
tooling built on the AXI conventions (e.g. multi-agent orchestrators) can ship to ADO repos.

## Requirements

- Node 20+
- [`az` CLI](https://learn.microsoft.com/cli/azure) with the **azure-devops** extension
  (`az extension add --name azure-devops`)
- A PAT with **Code** and **Pull Request** scopes, stored in the git credential helper for
  your org URL (`https://dev.azure.com/<org>`). This is the same credential `azp` reads.

## Install

```sh
npm install && npm run build
# optionally: npm link   (exposes `ado-axi` on PATH)
```

## Context resolution

Resolved in priority order:

1. `-R org/project/repo` / `--repo org/project/repo`
2. `AZP_REPO=org/project/repo` env var
3. The `origin` git remote (`https://dev.azure.com/{org}/{project}/_git/{repo}` or the
   `{org}.visualstudio.com` form)

The PAT is then pulled via `git credential fill` for `https://dev.azure.com/{org}`, falling
back to `AZURE_DEVOPS_EXT_PAT` if the helper has nothing.

## Commands

```
ado-axi pr list   [--status active|completed|abandoned|all] [--top n]
                  [--creator id] [--source branch] [--target branch]
ado-axi pr show    <id>
ado-axi pr create  [-s/--source branch] [-t/--target branch] [--title t]
                   [--description d] [--draft] [--auto-complete] [--squash]
ado-axi pr complete <id> [--squash | --merge | --rebase] [--keep-source-branch]
ado-axi pr checks  <id>
ado-axi setup hooks
```

### Mapping to `az`

| ado-axi | `az` |
|---|---|
| `pr create` | `az repos pr create --source-branch … --target-branch … --title …` |
| `pr show <id>` | `az repos pr show --id <id>` |
| `pr list` | `az repos pr list` |
| `pr complete <id>` | `az repos pr update --id <id> --status completed --merge-strategy …` |
| `pr checks <id>` | `az repos pr policy list --id <id>` → `passing` / `pending` / `failing` verdict |

`pr checks` summarizes ADO **policy evaluations** (the ADO analogue of GitHub checks) into a
single verdict plus a per-policy breakdown — what a merge-poll waits on. `--auto-complete`
on `pr create` sets the PR to complete automatically once all policies pass.

## Examples

```sh
# from inside an Azure DevOps repo checkout
ado-axi pr list
ado-axi pr create --title "Add readiness gate" --auto-complete
ado-axi pr checks 4242
ado-axi pr complete 4242 --squash

# from anywhere, naming the repo explicitly
ado-axi -R Ipto/IptoAIasset/asset-mgmt-assistant-backend pr list
```

## Status

MVP: the `pr` surface (`create`/`show`/`list`/`complete`/`checks`) plus `setup`. Planned:
`repo`, `pipeline` (`az pipelines`), and `work-item` (`az boards`) commands, and a richer
TOON projection. Built on `axi-sdk-js`; a candidate for the AXI catalog.

## License

MIT
