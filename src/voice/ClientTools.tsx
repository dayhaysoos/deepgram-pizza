// The agent's tools, answered in the browser. Each tool in `toolDefinitions`
// (src/agent/tools.ts) gets a client-side handler registered with the SDK's
// useAgentClientTool, which calls the page's handler for it (handlers.ts,
// read with useToolHandlers()) and answers with its result. A new tool needs
// nothing here; AGENTS.md ("Voice") lists what it does need.
//
// Rendered inside a live session's AgentProvider, so the tools are registered
// for as long as the session lasts. The same list goes to the agent as its
// functions (agentSettings.ts), so it calls only tools that are registered.

import { useCallback } from 'react'
import { useAgentClientTool, type FunctionCallItem } from '@deepgram/react'
import type { ToolHandler } from '../agent/handlers'
import { toolDefinitions, type ToolName } from '../agent/tools'
import { useToolHandlers } from '../pageContext'

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
export function ClientTools() {
  const handlers = useToolHandlers()
  return toolDefinitions.map(({ name }) => <ClientTool key={name} name={name} handler={handlers[name]} />)
}

function ClientTool({ name, handler }: { name: ToolName; handler: ToolHandler }) {
  const answer = useCallback((call: FunctionCallItem) => answerToolCall(handler, call), [handler])
  useAgentClientTool(name, answer)
  return null
}
