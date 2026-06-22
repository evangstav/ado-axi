/** Get a flag's value from `--flag value` or `--flag=value` without modifying args. */
export function getFlag(args, name) {
    const equalsPrefix = `${name}=`;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === name) {
            if (i + 1 >= args.length)
                return undefined;
            return args[i + 1];
        }
        if (arg.startsWith(equalsPrefix)) {
            return arg.slice(equalsPrefix.length);
        }
    }
    return undefined;
}
/** Check if a boolean flag is present. */
export function hasFlag(args, flag) {
    return args.includes(flag);
}
/** Get the first positional (non-`-`-prefixed) arg at or after startIndex. */
export function getPositional(args, startIndex) {
    for (let i = startIndex; i < args.length; i++) {
        if (!args[i].startsWith("-"))
            return args[i];
    }
    return undefined;
}
//# sourceMappingURL=args.js.map