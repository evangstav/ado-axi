# ado-axi

An [AXI](https://github.com/kunchenguid/axi)-compliant Azure DevOps CLI wrapper — the ADO
equivalent of [`gh-axi`](https://github.com/kunchenguid/gh-axi). It wraps `az repos` and
`az boards` with token-efficient [TOON](https://github.com/toon-format/toon) output, contextual
next-step suggestions, and structured errors, so agents can drive Azure DevOps pull requests and
work items the way `gh-axi` drives GitHub.

It also folds in the `azp` shim's auth model: organization, project, and repository are
auto-detected from the `dev.azure.com` git origin, and the PAT is read from the git
credential helper — so `ado-axi` runs as a standalone binary with no zsh function and no
token in argv or env files.

## Why

`gh-axi`'s pipeline assumes GitHub + `gh`. Repositories hosted on Azure DevOps have no PRs
through that path. `ado-axi` provides the same agent-ergonomic surface over `az repos` and
`az boards`, so tooling built on the AXI conventions (e.g. multi-agent orchestrators) can ship
to ADO repos.

## Requirements

- Node 20+
- [`az` CLI](https://learn.microsoft.com/cli/azure) with the **azure-devops** extension
  (`az extension add --name azure-devops`)
- A PAT with **Code** and **Pull Request** scopes (add **Work Items** for the `work-item`
  commands), stored in the git credential helper for your org URL
  (`https://dev.azure.com/<org>`). This is the same credential `azp` reads.

## Install

Install the published package from npm:

```sh
npm install -g ado-axi
```

Prefer the latest source? Install straight from GitHub — the compiled `dist/` is
committed, so the install uses it directly with no build step:

```sh
# straight from GitHub
npm install -g github:evangstav/ado-axi --install-links

# or pin a branch/tag/commit
npm install -g 'github:evangstav/ado-axi#main' --install-links
```

To develop locally, clone and build:

```sh
git clone https://github.com/evangstav/ado-axi.git
cd ado-axi
npm install && npm run build
npm link   # optional: exposes `ado-axi` on PATH
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
ado-axi pr complete <id> [--squash | --merge] [--keep-source-branch]
ado-axi pr checks  <id>
ado-axi pr reviewer add  <id> --reviewer <email|name|guid> [--required]
ado-axi pr reviewer list <id>
ado-axi pr comment create <id> --message <text>   # aliases: --body, --content
ado-axi pr comment create <id> --file <path>      # Markdown/plaintext from disk

ado-axi work-item create  --type <Task|Bug|Issue|Epic|…> --title <t> [--description d]
                          [--assignee who] [--parent id] [--priority n]
                          [--area a] [--iteration i]
ado-axi work-item update  <id> [--title t] [--description d] [--assignee who] [--state s]
                          [--priority n] [--parent id] [--add-relation <type:id>]
ado-axi work-item show    <id>
ado-axi work-item delete  <id> [--destroy]
ado-axi work-item list    [--assignee who] [--state s] [--type t] [--unassigned]
                          [--query "<raw WIQL>"]
# `wi` is an alias for `work-item`.

ado-axi setup hooks
```

### Mapping to `az`

| ado-axi | `az` |
|---|---|
| `pr create` | `az repos pr create --source-branch … --target-branch … --title …` |
| `pr show <id>` | `az repos pr show --id <id>` |
| `pr list` | `az repos pr list` |
| `pr complete <id>` | `az repos pr update --id <id> --status completed --squash true|false` |
| `pr checks <id>` | `az repos pr policy list --id <id>` → `passing` / `pending` / `failing` verdict |
| `pr reviewer add <id>` | `az repos pr reviewer add --id <id> --reviewers <id> [--required true]` |
| `pr reviewer list <id>` | `az repos pr reviewer list --id <id>` |
| `pr comment create <id>` | `az devops invoke --area git --resource pullRequestThreads --route-parameters project=… repositoryId=… pullRequestId=<id> --http-method POST` (REST: `POST …/_apis/git/repositories/{repo}/pullRequests/{id}/threads`) |
| `work-item create` | `az boards work-item create --type … --title … --project <project>` |
| `work-item update <id>` | `az boards work-item update --id <id> …` (+ `relation add` for `--parent`/`--add-relation`) |
| `work-item show <id>` | `az boards work-item show --id <id>` |
| `work-item delete <id>` | `az boards work-item delete --id <id> --project <project> --yes [--destroy]` |
| `work-item list` | `az boards query --wiql "<built from flags>" --project <project>` |

`pr checks` summarizes ADO **policy evaluations** (the ADO analogue of GitHub checks) into a
single verdict plus a per-policy breakdown — what a merge-poll waits on. `--auto-complete`
on `pr create` sets the PR to complete automatically once all policies pass.

`pr list` and `pr show` include the PR creator as `author` (display name) and
`author_unique` (ADO `uniqueName`, usually the email/UPN). If ADO omits the identity, the
fields are left empty rather than failing the command.

**Reviewer identity resolution.** `pr reviewer add` accepts an email, display name, or GUID.
The direct value is tried first; if the ADO identity endpoint rejects a Code-scoped PAT
(`requires user authentication`), the reviewer's GUID is recovered from recent PR history in
the project (`createdBy`/`reviewers` whose `displayName`/`uniqueName`/`mailAddress` matches)
and the add is retried — so adding a reviewer by email works even without the Identity scope.

**PR comments.** `pr comment create <id>` posts a top-level review comment to a PR. Provide
content with exactly one of `--message`/`--body`/`--content` (inline) or `--file <path>` (read
from disk, newlines preserved — useful for long review write-ups). `az repos pr` has no comment
command, so this goes through the REST **pull-request threads** resource via `az devops invoke`,
which keeps PAT/org/project/repo handling identical to every other command. Unlike work-item
descriptions, PR thread comments render **Markdown**, so the text is sent verbatim (no HTML
conversion). Scope is intentionally narrow: top-level comments only — no voting, resolving,
inline file-position comments, or editing.

**Work-item descriptions.** `--description` takes plain text or Markdown (headings, lists,
inline code, bold/italic) and is rendered to the HTML the ADO Description field expects;
callers never hand-write HTML.

**Work-item list / WIQL.** The `--assignee`/`--state`/`--type`/`--unassigned` flags build a
project-scoped WIQL query; `--query` is a raw-WIQL escape hatch (still scoped to the project).

## Examples

```sh
# from inside an Azure DevOps repo checkout
ado-axi pr list
ado-axi pr create --title "Add readiness gate" --auto-complete
ado-axi pr checks 4242
ado-axi pr complete 4242 --squash
ado-axi pr reviewer add 4242 --reviewer dev@org.com --required
ado-axi pr comment create 4242 --message "LGTM — one nit on error handling"
ado-axi pr comment create 4242 --file review.md

# work items (Boards); `wi` is an alias for `work-item`
ado-axi wi create --type Task --title "Wire up gate" --assignee me@org.com
ado-axi wi update 1234 --state Active --priority 2
ado-axi wi list --state Active --type Task
ado-axi wi list --unassigned

# from anywhere, naming the repo explicitly
ado-axi -R Ipto/IptoAIasset/asset-mgmt-assistant-backend pr list
# equivalent when flags are placed after the command:
ado-axi pr list -R Ipto/IptoAIasset/asset-mgmt-assistant-backend
```

## Status

The `pr` surface (`create`/`show`/`list`/`complete`/`checks`/`reviewer`/`comment`), the `work-item`
surface (`create`/`update`/`show`/`delete`/`list`, alias `wi`, over `az boards`), and `setup`.
Planned: `repo`, `pipeline` (`az pipelines`), and a richer TOON projection. Built on
`axi-sdk-js`; a candidate for the AXI catalog.

## License

MIT
