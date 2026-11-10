import { useId } from 'react'
import { TALK_LABELS, type TalkStatus } from './talkStatus'

type TalkButtonProps = {
  status: TalkStatus
  /** Why the last session failed, shown above the button until the next press. */
  message?: string
  onPress: () => void
}

/**
 * The talk button: a press starts a session, and a press during one ends it.
 * Each state has its own label, colour and icon (styles.css, "Voice"), so the
 * button never looks frozen. It needs no Deepgram provider, so it renders the
 * same with or without a session.
 */
export function TalkButton({ status, message, onPress }: TalkButtonProps) {
  const messageId = useId()
  const { label, hint } = TALK_LABELS[status]
  const live = status !== 'idle' && status !== 'error'

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
        aria-pressed={live}
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
