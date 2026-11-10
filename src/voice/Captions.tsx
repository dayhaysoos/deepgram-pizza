import { useAgentConversation } from '@deepgram/react'
import { latestExchange } from './latestExchange'

/**
 * Live captions above the talk button: the customer's last line, so they can
 * see what the agent heard, and the agent's reply. Rendered only inside a
 * live session's provider. Screen readers hear the agent's reply as it
 * changes.
 */
export function Captions() {
  const { conversation } = useAgentConversation()
  const { customer, agent } = latestExchange(conversation)

  return (
    <div className="captions" data-empty={(!customer && !agent) || undefined}>
      {customer && (
        <p className="caption-customer">
          <span className="visually-hidden">You said: </span>“{customer}”
        </p>
      )}
      {/* Always rendered, so screen readers know the live region before its first words. */}
      <p className="caption-agent" aria-live="polite">
        {agent}
      </p>
    </div>
  )
}
