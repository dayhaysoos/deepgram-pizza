// One check, shared by everything that reads JSON it didn't write: the agent's
// tool arguments, the cart the browser posts to checkout, Deepgram's answers.

/** Whether a value is a plain object, so its fields can be read: not null, and not a list. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
