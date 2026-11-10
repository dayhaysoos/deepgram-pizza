// What the captions show: the customer's last line, and the agent's reply to it.

import type { ConversationEntry } from '@deepgram/react'

type Line = Pick<ConversationEntry, 'role' | 'content'>

/**
 * The customer's last line, and the agent's reply to it: every agent line
 * after it, joined with a space ('' while the agent hasn't answered yet).
 * Deepgram may send a reply as one line or one per sentence; this is right
 * either way. Before the customer says anything, the reply is the greeting.
 */
export function latestExchange(conversation: readonly Line[]): { customer: string; agent: string } {
  let lastCustomerLine = -1
  conversation.forEach((line, index) => {
    if (line.role === 'user') lastCustomerLine = index
  })
  return {
    customer: lastCustomerLine === -1 ? '' : conversation[lastCustomerLine].content,
    agent: conversation
      .slice(lastCustomerLine + 1)
      .map((line) => line.content)
      .join(' '),
  }
}
