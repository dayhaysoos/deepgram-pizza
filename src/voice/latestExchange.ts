// What the captions show: the customer's last line, and the agent's reply to it.

import type { ConversationEntry } from '@deepgram/react'

type Line = Pick<ConversationEntry, 'role' | 'content'>

/**
 * The customer's last line, and the agent's latest line after it ('' while
 * the agent hasn't answered yet). Before the customer says anything, the
 * agent's line is its greeting.
 */
export function latestExchange(conversation: readonly Line[]): { customer: string; agent: string } {
  let customer = -1
  let agent = -1
  conversation.forEach((line, index) => {
    if (line.role === 'user') customer = index
    else agent = index
  })
  return {
    customer: customer === -1 ? '' : conversation[customer].content,
    agent: agent > customer ? conversation[agent].content : '',
  }
}
