import { useId } from 'react'
import type { TalkStatus } from './sessionStatus'

/** Each state's label, and what a press does then. */
export const TALK_LABELS: Record<TalkStatus, { label: string; hint?: string }> = {
  idle: { label: 'Talk to order' },
  connecting: { label: 'Connecting…', hint: 'Press to cancel' },
  listening: { label: 'Listening…', hint: 'Press to stop' },
  thinking: { label: 'Thinking…', hint: 'Press to stop' },
  speaking: { label: 'Speaking…', hint: 'Press to stop' },
  error: { label: 'Try again' },
}

/** Connecting again after the connection dropped mid-session. */
const RECONNECTING = { label: 'Reconnecting…', hint: 'Press to cancel' }

/** What the button says: the state's label, or "Reconnecting…" while a dropped connection is tried again. */
export function talkLabel(status: TalkStatus, reconnecting = false): { label: string; hint?: string } {
  return status === 'connecting' && reconnecting ? RECONNECTING : TALK_LABELS[status]
}

type TalkButtonProps = {
  status: TalkStatus
  /** The session is connecting again after a dropped connection. */
  reconnecting?: boolean
  /** Why the last session failed, shown above the button until the next press. */
  message?: string
  onPress: () => void
}

/**
 * The talk button: a press starts a session, and a press during one ends it.
 * Each state has its own label, colour and icon (styles.css, "Voice"), so the
 * button never looks frozen. It's a plain button, not a toggle with
 * `aria-pressed`: its label already says the state and what a press does. It
 * needs no Deepgram provider, so it renders the same with or without a session.
 */
export function TalkButton({ status, reconnecting, message, onPress }: TalkButtonProps) {
  const messageId = useId()
  const { label, hint } = talkLabel(status, reconnecting)

  return (
    <>
      {message && (
        <p className="talk-message" id={messageId} role="alert">
          {message}
        </p>
      )}
      <button
        type="button"
        className="talk-button"
        data-status={status}
        aria-describedby={message ? messageId : undefined}
        onClick={onPress}
      >
        <TalkIcon status={status} />
        <span className="talk-text">
          <span className="talk-label">{label}</span>
          {hint && (
            <>
              {' '}
              <span className="talk-hint">{hint}</span>
            </>
          )}
        </span>
      </button>
    </>
  )
}

/** A microphone, or a spinner, dots or sound bars. Decoration: the label says the same. */
function TalkIcon({ status }: { status: TalkStatus }) {
  const parts = status === 'thinking' || status === 'speaking' ? 3 : status === 'connecting' ? 1 : 0
  return (
    <span className="talk-icon" aria-hidden="true">
      {parts === 0 ? (
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      ) : (
        Array.from({ length: parts }, (_, index) => <span key={index} />)
      )}
    </span>
  )
}
