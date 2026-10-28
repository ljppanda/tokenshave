/** Rough token estimate. Code/text averages ~4 characters per token. */
export function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
