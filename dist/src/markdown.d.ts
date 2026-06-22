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
export declare function renderDescriptionHtml(text: string): string;
