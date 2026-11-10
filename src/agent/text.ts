// What the tools and the agent's instructions say: the message a tool answers
// with when it can't do what the agent asked, and lists written the way those
// messages and rules write them.

/**
 * A short message the agent can act on, returned instead of throwing (AGENTS.md,
 * "Tools recover; they don't throw"): "Pepperoni Pizza comes in medium or large. Which one?"
 */
export type Recovery = { message: string }

/** ["medium", "large"] → "medium or large"; three or more get commas: "a, b or c". */
export function orList(words: readonly string[]): string {
  return joinList(words, 'or')
}

/** ["garlic knots", "a drink each"] → "garlic knots and a drink each"; "a, b and c". */
export function andList(words: readonly string[]): string {
  return joinList(words, 'and')
}

function joinList(words: readonly string[], conjunction: 'and' | 'or'): string {
  return words.length <= 2 ? words.join(` ${conjunction} `) : `${words.slice(0, -1).join(', ')} ${conjunction} ${words.at(-1)}`
}
