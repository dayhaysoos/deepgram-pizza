// What the agent is doing while the customer waits for its reply, like a
// typing indicator in a chat: a small spinner and a label at the end of the
// captions, where the reply will appear. "Thinking…" while it thinks, or what
// the tool it asked for is doing ("Searching the menu…"). It shows after a
// short delay, so a quick reply doesn't make it flicker, and goes the moment
// the agent speaks. It blocks nothing: the menu, the cart and the suggestion
// card stay usable.

import { useEffect, useState } from 'react'
import type { ToolName } from '../agent/tools'
import { isLive, type SessionState } from './sessionStatus'

/** What the line says while the agent thinks. */
export const THINKING = 'Thinking…'

/** What the line says while each tool runs. A new tool needs its label here. */
export const TOOL_ACTIVITY: Record<ToolName, string> = {
  find_menu_items: 'Searching the menu…',
  show_suggestions: 'Putting suggestions together…',
  plan_group_order: 'Planning your order…',
  add_item: 'Adding to your cart…',
  add_items: 'Adding to your cart…',
  set_quantity: 'Updating your cart…',
  remove_item: 'Updating your cart…',
  clear_cart: 'Updating your cart…',
  view_cart: 'Checking your cart…',
  set_order_type: 'Noting pickup or delivery…',
  checkout: 'Starting checkout…',
}

/** How long the agent has to be busy before the line shows. */
const ACTIVITY_DELAY_MS = 300

/**
 * What the line says for `state`, or `undefined` when there's nothing to say:
 * while the agent speaks, while the session connects, and while the customer
 * has the floor. A tool call's label comes before thinking. With several
 * calls in one request, it's the first one's, since the browser runs them in
 * order. A tool call outlives the agent's words before it ("Let me look."),
 * which end in listening.
 */
export function activityLabel(state: SessionState): string | undefined {
  if (!isLive(state) || (state.status !== 'thinking' && state.status !== 'listening')) return undefined
  const tool = state.toolCalls?.find(isToolName)
  if (tool) return TOOL_ACTIVITY[tool]
  return state.status === 'thinking' || state.toolCalls ? THINKING : undefined
}

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_ACTIVITY, name)
}

/**
 * The line, last in the captions. It's a status region, which screen readers
 * read politely: always rendered, so they know it before its first label, and
 * they hear each label once.
 */
export function AgentActivity({ label }: { label?: string }) {
  const shown = useShownAfterDelay(label !== undefined)

  return (
    <p className="caption-activity" role="status">
      {shown && (
        <>
          <span className="caption-activity-spinner" aria-hidden="true" />
          {label}
        </>
      )}
    </p>
  )
}

/** Whether `on` has been true for ACTIVITY_DELAY_MS. False again as soon as it isn't. */
function useShownAfterDelay(on: boolean): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => setShown(true), ACTIVITY_DELAY_MS)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [on])

  return on && shown
}
