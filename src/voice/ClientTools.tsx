// The agent's tools, answered in the browser. Each tool in `toolDefinitions`
// (src/agent/tools.ts) gets a client-side handler registered with the SDK's
// useAgentClientTool, which calls the page's handler for it (handlers.ts,
// read with useToolHandlers()) and answers with its result. A new tool needs
// nothing here; AGENTS.md ("Voice") lists what it does need.
//
// A tool with a line in SAID_WHEN_CALLED ("Let me put something together."
// for a plan) has the agent say it first, through Deepgram's
// InjectAgentMessage with `queue`, which Deepgram's docs give for filler
// during function calls: it plays after anything the agent is already saying,
// and the reply to the tool's result comes after it. Deepgram refuses it
// (InjectionRefused) if the customer is mid-turn, which a deferred tool's call
// never is.
//
// Rendered inside a live session's AgentProvider, so the tools are registered
// for as long as the session lasts. The same list goes to the agent as its
// functions (agentSettings.ts), so it calls only tools that are registered.

import { useCallback } from 'react'
import { useAgentClientTool, useAgentSession, type FunctionCallItem } from '@deepgram/react'
import type { ToolHandler } from '../agent/handlers'
import { SAID_WHEN_CALLED, toolDefinitions, type ToolName } from '../agent/tools'
import { useToolHandlers } from '../pageContext'

/** The part of the SDK's AgentSession that has the agent say a line. */
export type LineSayer = { injectAgentMessage(message: string, behavior: 'queue'): void }

/**
 * The answer to one of the agent's calls: the handler's result for the call's
 * arguments (the JSON string Deepgram sends), as the JSON string a
 * FunctionCallResponse carries. The handlers never reject: a problem comes
 * back as `{ message }`, which the agent hears and acts on. With `say`, the
 * agent is given the tool's line to say first, queued (SAID_WHEN_CALLED).
 */
export async function answerToolCall(
  handler: ToolHandler,
  call: Pick<FunctionCallItem, 'arguments'>,
  say?: { line: string; agent: LineSayer },
): Promise<string> {
  say?.agent.injectAgentMessage(say.line, 'queue')
  return JSON.stringify(await handler(call.arguments))
}

/** Registers every tool with the live session, each answered by the page's handler for it. */
export function ClientTools() {
  const handlers = useToolHandlers()
  return toolDefinitions.map(({ name }) => (
    <ClientTool key={name} name={name} handler={handlers[name]} saidWhenCalled={SAID_WHEN_CALLED[name]} />
  ))
}

type ClientToolProps = { name: ToolName; handler: ToolHandler; saidWhenCalled?: string }

function ClientTool({ name, handler, saidWhenCalled }: ClientToolProps) {
  const session = useAgentSession()
  const answer = useCallback(
    (call: FunctionCallItem) =>
      answerToolCall(handler, call, saidWhenCalled ? { line: saidWhenCalled, agent: session } : undefined),
    [handler, saidWhenCalled, session],
  )
  useAgentClientTool(name, answer)
  return null
}
