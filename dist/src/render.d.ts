/** Join non-empty output parts with newlines. */
export declare function renderOutput(parts: (string | undefined)[]): string;
/** TOON-encode a record or list under a key. */
export declare function renderData(key: string, value: unknown): string;
/** A trailing block of contextual next-step suggestions. */
export declare function renderHelp(lines: string[]): string;
/** A definitive count line (avoids ambiguous empty output). */
export declare function renderCount(label: string, count: number): string;
