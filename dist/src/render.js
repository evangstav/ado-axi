import { encode } from "@toon-format/toon";
/** Join non-empty output parts with newlines. */
export function renderOutput(parts) {
    return parts.filter((p) => Boolean(p && p.length)).join("\n\n");
}
/** TOON-encode a record or list under a key. */
export function renderData(key, value) {
    return encode({ [key]: value });
}
/** A trailing block of contextual next-step suggestions. */
export function renderHelp(lines) {
    if (!lines.length)
        return "";
    return ["next:", ...lines.map((l) => `  ${l}`)].join("\n");
}
/** A definitive count line (avoids ambiguous empty output). */
export function renderCount(label, count) {
    return `${label}: ${count}`;
}
//# sourceMappingURL=render.js.map