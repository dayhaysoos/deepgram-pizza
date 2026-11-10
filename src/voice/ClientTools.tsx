// The agent's tools, answered in the browser. Each tool in `toolDefinitions`
// (src/agent/tools.ts) gets a client-side handler registered with the SDK's
// useAgentClientTool, which calls the page's handler for it (handlers.ts) and
// answers with its result. A new tool needs nothing here: its definition and
// its handler are enough.
//
// Rendered inside a live session's AgentProvider, so the tools are registered
// for as long as the session lasts. The same list goes to the agent as its
// functions (agentSettings.ts), so it calls only tools that are registered.

import { useCallback } from 'react'
import { useAgentClientTool, type FunctionCallItem } from '@deepgram/react'
import type { ToolHandler, ToolHandlers } from '../agent/handlers'
import { toolDefinitions } from '../agent/tools'

/**
 * The answer to one of the agent's calls: the handler's result for the call's
 * arguments (the JSON string Deepgram sends), as the JSON string a
 * FunctionCallResponse carries. The handlers never reject: a problem comes
 * back as `{ message }`, which the agent hears and acts on.
 */
export async function answerToolCall(handler: ToolHandler, call: Pick<FunctionCallItem, 'arguments'>): Promise<string> {
  return JSON.stringify(await handler(call.arguments))
}

/** Registers every tool with the live session, each answered by the page's handler for it. */
export function ClientTools({ handlers }: { handlers: ToolHandlers }) {
  return toolDefinitions.map(({ name }) => <ClientTool key={name} name={name} handler={handlers[name]} />)
}

function ClientTool({ name, handler }: { name: string; handler: ToolHandler }) {
  const answer = useCallback((call: FunctionCallItem) => answerToolCall(handler, call), [handler])
  useAgentClientTool(name, answer)
  return null
}
