/** Get a flag's value from `--flag value` or `--flag=value` without modifying args. */
export declare function getFlag(args: string[], name: string): string | undefined;
/** Check if a boolean flag is present. */
export declare function hasFlag(args: string[], flag: string): boolean;
/** Get the first positional (non-`-`-prefixed) arg at or after startIndex. */
export declare function getPositional(args: string[], startIndex: number): string | undefined;
