/**
 * Render plain text or Markdown into the HTML that the Azure DevOps work-item
 * Description field expects. Callers pass human-friendly text (`--description`)
 * and never have to hand-write HTML.
 *
 * Supported: ATX headings (`#`..`######` → bold line), unordered lists
 * (`-`/`*`/`+`), ordered lists (`1.`), blank-line-separated paragraphs (joined
 * with `<br>`), inline code (`` `code` ``), bold (`**x**`), and italic
 * (`*x*` / `_x_`). Anything else is passed through as an escaped paragraph.
 */
export function renderDescriptionHtml(text) {
    const normalized = text.replace(/\r\n?/g, "\n");
    const blocks = normalized.split(/\n{2,}/);
    const html = [];
    for (const block of blocks) {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        if (lines.length === 0)
            continue;
        if (lines.every((l) => /^\s*[-*+]\s+/.test(l))) {
            const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`);
            html.push(`<ul>${items.join("")}</ul>`);
            continue;
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
            const items = lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`);
            html.push(`<ol>${items.join("")}</ol>`);
            continue;
        }
        if (lines.length === 1 && /^\s*#{1,6}\s+/.test(lines[0])) {
            html.push(`<b>${inline(lines[0].replace(/^\s*#{1,6}\s+/, ""))}</b>`);
            continue;
        }
        html.push(`<div>${lines.map(inline).join("<br>")}</div>`);
    }
    return html.join("");
}
/**
 * Escape HTML and apply inline Markdown (code, bold, italic). Code spans are
 * split out first (so their contents are escaped but not treated as markdown);
 * the surrounding text gets bold/italic applied. Splitting on the code-span
 * delimiter avoids any placeholder/sentinel that could collide with real text.
 */
function inline(text) {
    return text
        .split(/(`[^`]+`)/)
        .map((part) => {
        const code = part.match(/^`([^`]+)`$/);
        if (code)
            return `<code>${escapeHtml(code[1])}</code>`;
        return escapeHtml(part)
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            // Emphasis markers must hug their content (no `* x *`); underscores only
            // emphasize at word boundaries so `snake_case_name` is left untouched.
            .replace(/(^|[^*])\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, "$1<i>$2</i>")
            .replace(/(^|[^_\w])_(?!\s)([^_]+?)(?<!\s)_(?!\w)/g, "$1<i>$2</i>");
    })
        .join("");
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
//# sourceMappingURL=markdown.js.map