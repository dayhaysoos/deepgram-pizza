// What the captions show: the customer's last line, and the agent's reply to it.

import type { ConversationEntry } from '@deepgram/react'

type Line = Pick<ConversationEntry, 'id' | 'role' | 'content'>

/**
 * The customer's last line, and the agent's reply to it: every agent line
 * after it, oldest first (none while the agent hasn't answered yet). Deepgram
 * may send a reply as one line or one per sentence, so the reply stays a list
 * of lines, each with its stable `id`. Before the customer says anything, the
 * reply is the greeting.
 */
export function latestExchange(conversation: readonly Line[]): { customer: string; agent: Line[] } {
  let lastCustomerLine = -1
  conversation.forEach((line, index) => {
    if (line.role === 'user') lastCustomerLine = index
  })
  return {
    customer: lastCustomerLine === -1 ? '' : conversation[lastCustomerLine].content,
    agent: conversation.slice(lastCustomerLine + 1),
  }
}
