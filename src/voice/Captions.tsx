import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { AgentActivity } from './AgentActivity'
import { latestExchange } from './latestExchange'
import type { TranscriptLine } from './transcript'

/** What the toggle says: how many lines there are while it's closed. */
export function conversationToggleLabel(open: boolean, lineCount: number): string {
  return open ? 'Hide conversation' : `Show conversation (${lineCount})`
}

/** How close to the bottom, in pixels, still counts as reading the newest line. */
const FOLLOW_SLACK = 32

const NO_EXCHANGE = latestExchange([])

type CaptionsProps = {
  /** The latest session's conversation, oldest first. It stays after the session ends, until the next press. */
  lines: readonly TranscriptLine[]
  /** A session is on. */
  live: boolean
  /** What the agent is doing, if anything (activityLabel). */
  activity?: string
  /** The customer chose to see the whole conversation. */
  expanded: boolean
  onToggle: () => void
}

/**
 * The captions above the talk button. While a session is on they show the
 * latest exchange: the customer's last line, so they can see what the agent
 * heard, the agent's reply, and while the customer waits for it, what the
 * agent is doing. Once there's a line, a toggle above them opens the whole
 * conversation instead, as a list that scrolls. After the session ends, the
 * toggle stays on its own, until the next press starts a new conversation.
 *
 * Screen readers hear the agent's reply as it arrives, from one live region:
 * each line is its own keyed span, so a new sentence is read as an addition,
 * without the ones before it. It stays on the page while the conversation is
 * open, visually hidden, so the list itself isn't a live region and nothing
 * is read twice.
 */
export function Captions({ lines, live, activity, expanded, onToggle }: CaptionsProps) {
  const conversationId = useId()
  const open = expanded && lines.length > 0
  const showsExchange = live && !open
  const { customer, agent } = live ? latestExchange(lines) : NO_EXCHANGE

  return (
    <div
      className="captions"
      data-empty={(lines.length === 0 && !activity) || undefined}
      data-open={open || undefined}
      data-ended={(!live && !open) || undefined}
    >
      {lines.length > 0 && (
        <button
          type="button"
          className="conversation-toggle"
          aria-expanded={open}
          aria-controls={conversationId}
          onClick={onToggle}
        >
          <svg className="conversation-toggle-icon" viewBox="0 0 8 10" width="8" height="10" aria-hidden="true">
            <path d="M0 0 8 5 0 10z" fill="currentColor" />
          </svg>
          {conversationToggleLabel(open, lines.length)}
        </button>
      )}
      <Conversation id={conversationId} lines={lines} open={open} />
      {showsExchange && customer && (
        <p className="caption-customer">
          <span className="visually-hidden">You said: </span>“{customer}”
        </p>
      )}
      {/* Always rendered, so screen readers know the live region before its first words. */}
      <p className={showsExchange ? 'caption-agent' : 'caption-agent visually-hidden'} aria-live="polite">
        {/* The reply as one block of text, so the box can keep its end (styles.css). */}
        <span>
          {agent.map((line) => (
            <span key={line.id}>{line.content} </span>
          ))}
        </span>
      </p>
      <AgentActivity label={activity} />
    </div>
  )
}

/**
 * The whole conversation, newest line at the bottom. Hidden while closed, so
 * the toggle always has the list it controls. Opening it shows the newest
 * line, and it follows new lines from there, unless you've scrolled up to
 * read. It can take focus, so it scrolls from the keyboard.
 */
function Conversation({ id, lines, open }: { id: string; lines: readonly TranscriptLine[]; open: boolean }) {
  const list = useRef<HTMLOListElement>(null)
  const following = useRef(true)

  useLayoutEffect(() => {
    if (open) following.current = true
  }, [open])

  useLayoutEffect(() => {
    const box = list.current
    if (open && box && following.current) box.scrollTop = box.scrollHeight
  }, [lines, open])

  // The list gets shorter when the activity line shows below it: keep the newest line in sight.
  useEffect(() => {
    const box = list.current
    if (!box) return
    const observer = new ResizeObserver(() => {
      if (following.current) box.scrollTop = box.scrollHeight
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  return (
    <ol
      id={id}
      className="conversation"
      ref={list}
      hidden={!open}
      aria-label="Conversation"
      tabIndex={0}
      onScroll={(event) => {
        const box = event.currentTarget
        following.current = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_SLACK
      }}
    >
      {lines.map((line) => (
        <li key={line.id} data-role={line.role}>
          <span className="conversation-speaker">{line.role === 'user' ? 'You' : 'Agent'}:</span> {line.content}
        </li>
      ))}
    </ol>
  )
}
