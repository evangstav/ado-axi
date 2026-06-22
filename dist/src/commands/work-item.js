import { azJson, azExec } from "../az.js";
import { AxiError } from "../errors.js";
import { getFlag, hasFlag, getPositional } from "../args.js";
import { renderOutput, renderData, renderHelp, renderCount } from "../render.js";
import { renderDescriptionHtml } from "../markdown.js";
export const WI_HELP = `usage: ado-axi work-item|wi <subcommand> [flags]
subcommands[5]:
  create, update <id>, show <id>, delete <id>, list
flags{create}:
  --type <Issue|Task|Epic|…> (required), --title <t> (required), --description <d>,
  --assignee <email|name|guid>, --parent <id>, --priority <n>, --area <a>, --iteration <i>
flags{update}:
  --title, --description, --assignee, --state, --priority, --parent <id>,
  --add-relation <type:id>
flags{delete}:
  --destroy (permanent; default is soft-delete to the recycle bin)
flags{list}:
  --assignee <who>, --state <s>, --type <t>, --unassigned, --query <raw WIQL>
examples:
  ado-axi wi create --type Task --title "Wire up gate" --assignee me@org.com
  ado-axi wi update 1234 --state Active --priority 2
  ado-axi wi list --state Active --type Task
  ado-axi wi list --unassigned
  ado-axi wi show 1234`;
/** TOON-shaped projection of a work item (id + a few fields, not the full blob). */
function wiSummary(wi, ctx) {
    const fields = wi["fields"] ?? {};
    const id = wi["id"] ?? fields["System.Id"];
    return {
        id,
        type: fields["System.WorkItemType"],
        state: fields["System.State"],
        title: fields["System.Title"],
        assignee: assigneeName(fields["System.AssignedTo"]),
        url: wiUrl(id, ctx),
    };
}
/** AssignedTo comes back as an identity object (or, rarely, a bare string). */
function assigneeName(value) {
    if (!value)
        return undefined;
    if (typeof value === "string")
        return value;
    const o = value;
    return (o["displayName"] ?? o["uniqueName"]);
}
/** The human web URL is deterministic from context, like prSummary's. */
function wiUrl(id, ctx) {
    if (id === undefined || id === null)
        return undefined;
    return `${ctx.orgUrl}/${encodeURIComponent(ctx.project)}/_workitems/edit/${id}`;
}
async function createWi(args, ctx) {
    const type = getFlag(args, "--type");
    if (!type) {
        throw new AxiError("--type is required, e.g. --type Task (or Bug, Issue, Epic, …)", "VALIDATION_ERROR");
    }
    const title = getFlag(args, "--title");
    if (!title) {
        throw new AxiError("--title is required", "VALIDATION_ERROR");
    }
    const azArgs = [
        "boards", "work-item", "create",
        "--project", ctx.project,
        "--type", type,
        "--title", title,
    ];
    const description = getFlag(args, "--description");
    if (description)
        azArgs.push("--description", renderDescriptionHtml(description));
    const assignee = getFlag(args, "--assignee");
    if (assignee)
        azArgs.push("--assigned-to", assignee);
    const area = getFlag(args, "--area");
    if (area)
        azArgs.push("--area", area);
    const iteration = getFlag(args, "--iteration");
    if (iteration)
        azArgs.push("--iteration", iteration);
    const priority = getFlag(args, "--priority");
    if (priority) {
        azArgs.push("--fields", `Microsoft.VSTS.Common.Priority=${priority}`);
    }
    // Validate --parent before creating so a malformed id can't leave a
    // created-but-unparented work item behind (mirrors updateWi).
    const parent = getFlag(args, "--parent");
    if (parent && !/^\d+$/.test(parent)) {
        throw new AxiError(`--parent must be a numeric work item id (got "${parent}")`, "VALIDATION_ERROR");
    }
    const wi = await azJson(azArgs, ctx);
    const summary = wiSummary(wi, ctx);
    if (parent)
        await addRelation(summary.id, "parent", parent, ctx);
    return renderOutput([
        renderData("created", summary),
        renderHelp([
            `Inspect: ado-axi wi show ${summary.id}`,
            `Advance it: ado-axi wi update ${summary.id} --state Active`,
        ]),
    ]);
}
async function updateWi(args, ctx) {
    const id = requireWiId(args);
    const azArgs = ["boards", "work-item", "update", "--id", String(id)];
    const title = getFlag(args, "--title");
    if (title)
        azArgs.push("--title", title);
    const description = getFlag(args, "--description");
    if (description)
        azArgs.push("--description", renderDescriptionHtml(description));
    const assignee = getFlag(args, "--assignee");
    if (assignee)
        azArgs.push("--assigned-to", assignee);
    const state = getFlag(args, "--state");
    if (state)
        azArgs.push("--state", state);
    const priority = getFlag(args, "--priority");
    if (priority) {
        azArgs.push("--fields", `Microsoft.VSTS.Common.Priority=${priority}`);
    }
    const hasFieldChange = azArgs.length > 5;
    const parent = getFlag(args, "--parent");
    const relation = getFlag(args, "--add-relation");
    if (!hasFieldChange && !parent && !relation) {
        throw new AxiError("Nothing to update — pass at least one of --title/--description/--assignee/--state/--priority/--parent/--add-relation", "VALIDATION_ERROR");
    }
    // Validate relation inputs before any mutating az call so a malformed
    // --parent/--add-relation can't leave a partial field update behind.
    if (parent && !/^\d+$/.test(parent)) {
        throw new AxiError(`--parent must be a numeric work item id (got "${parent}")`, "VALIDATION_ERROR");
    }
    const parsedRelation = relation ? parseRelation(relation) : undefined;
    let wi;
    if (hasFieldChange)
        wi = await azJson(azArgs, ctx);
    if (parent)
        await addRelation(id, "parent", parent, ctx);
    if (parsedRelation) {
        await addRelation(id, parsedRelation.type, parsedRelation.target, ctx);
    }
    // When only relations changed, fetch the item so the summary still reflects it.
    if (!wi) {
        wi = await azJson(["boards", "work-item", "show", "--id", String(id)], ctx);
    }
    return renderOutput([
        renderData("updated", wiSummary(wi, ctx)),
        renderHelp([`Inspect: ado-axi wi show ${id}`]),
    ]);
}
async function showWi(args, ctx) {
    const id = requireWiId(args);
    const wi = await azJson(["boards", "work-item", "show", "--id", String(id)], ctx);
    return renderOutput([renderData("work_item", wiSummary(wi, ctx))]);
}
async function deleteWi(args, ctx) {
    const id = requireWiId(args);
    const destroy = hasFlag(args, "--destroy");
    // `az boards work-item delete` requires --project; resolve it from context.
    const azArgs = [
        "boards", "work-item", "delete",
        "--id", String(id),
        "--project", ctx.project,
        "--yes",
    ];
    if (destroy)
        azArgs.push("--destroy");
    // `az boards work-item delete` does not return clean JSON: `--destroy` prints a
    // bare "Deleted work item N" line, and soft-delete prepends that line before the
    // JSON body. The result isn't needed — report deterministically from context.
    await azExec(azArgs, ctx);
    return renderOutput([
        renderData("deleted", { id, destroyed: destroy }),
        renderHelp(destroy
            ? ["Permanently destroyed — not recoverable"]
            : ["Soft-deleted to the recycle bin; restore it from the ADO web UI"]),
    ]);
}
async function listWi(args, ctx) {
    const raw = getFlag(args, "--query");
    const wiql = raw ?? buildWiql(args, ctx);
    const items = await azJson(["boards", "query", "--project", ctx.project, "--wiql", wiql], ctx);
    const rows = items.map((wi) => {
        const fields = wi["fields"] ?? {};
        return {
            id: wi["id"] ?? fields["System.Id"],
            type: fields["System.WorkItemType"],
            state: fields["System.State"],
            title: fields["System.Title"],
            assignee: assigneeName(fields["System.AssignedTo"]),
        };
    });
    return renderOutput([
        renderCount("work_items", rows.length),
        renderData("work_items", rows),
        renderHelp(rows.length ? ["Inspect one: ado-axi wi show <id>"] : []),
    ]);
}
/** Build WIQL from the flag filters, scoped to the resolved project. */
function buildWiql(args, ctx) {
    const cols = "[System.Id], [System.WorkItemType], [System.State], [System.Title], [System.AssignedTo]";
    const where = [`[System.TeamProject] = '${esc(ctx.project)}'`];
    const type = getFlag(args, "--type");
    if (type)
        where.push(`[System.WorkItemType] = '${esc(type)}'`);
    const state = getFlag(args, "--state");
    if (state)
        where.push(`[System.State] = '${esc(state)}'`);
    if (hasFlag(args, "--unassigned")) {
        where.push(`[System.AssignedTo] = ''`);
    }
    else {
        const assignee = getFlag(args, "--assignee");
        if (assignee)
            where.push(`[System.AssignedTo] = '${esc(assignee)}'`);
    }
    return `SELECT ${cols} FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
}
/** Escape single quotes for WIQL string literals. */
function esc(value) {
    return value.replace(/'/g, "''");
}
/** Parse `--add-relation type:id` (e.g. `related:1234`, `parent:42`). */
function parseRelation(value) {
    const idx = value.indexOf(":");
    const type = idx >= 0 ? value.slice(0, idx).trim() : "";
    const target = idx >= 0 ? value.slice(idx + 1).trim() : "";
    if (!type || !/^\d+$/.test(target)) {
        throw new AxiError(`--add-relation must be <type:id>, e.g. related:1234 or parent:42 (got "${value}")`, "VALIDATION_ERROR");
    }
    return { type, target };
}
function addRelation(id, type, target, ctx) {
    return azJson([
        "boards", "work-item", "relation", "add",
        "--id", String(id),
        "--relation-type", type,
        "--target-id", target,
    ], ctx);
}
function requireWiId(args) {
    const raw = getPositional(args, 1);
    if (!raw || !/^\d+$/.test(raw)) {
        throw new AxiError("A work item id is required, e.g. ado-axi wi show 1234", "VALIDATION_ERROR");
    }
    return Number(raw);
}
export async function workItemCommand(args, ctx) {
    const sub = args[0];
    if (sub === "--help" || sub === undefined)
        return WI_HELP;
    if (!ctx) {
        throw new AxiError("No Azure DevOps context — run inside a repo with a dev.azure.com origin, set AZP_REPO=org/project/repo, or pass -R", "VALIDATION_ERROR");
    }
    switch (sub) {
        case "create":
            return createWi(args, ctx);
        case "update":
            return updateWi(args, ctx);
        case "show":
            return showWi(args, ctx);
        case "delete":
            return deleteWi(args, ctx);
        case "list":
            return listWi(args, ctx);
        default:
            throw new AxiError(`Unknown subcommand: ${sub}`, "VALIDATION_ERROR", [
                "Available: create, update, show, delete, list",
            ]);
    }
}
//# sourceMappingURL=work-item.js.map