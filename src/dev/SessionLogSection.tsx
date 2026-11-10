// The dev tools panel's Session log: every voice session since the log was
// cleared, as readable lines (who said what, and when, plus what else
// happened), with buttons to copy it as text or JSON and to clear it. Opening
// the panel shows the newest line, and it follows new lines while you talk,
// unless you've scrolled up to read. Sessions from other tabs show up too.
//
// Dev only, like the rest of the panel (ToolsPanel.tsx).

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  droppedNote,
  formatJson,
  formatText,
  NO_ENTRIES,
  readableLog,
  sectionHeading,
  sessionLog,
} from './sessionLog'

/** The server has no log: it renders the section empty, and the browser fills it in after hydration. */
const serverEntries = () => NO_ENTRIES

/** How close to the bottom, in pixels, still counts as reading the newest line. */
const FOLLOW_SLACK = 32

/** `open`: whether the panel is open, so the log is on screen. */
export function SessionLogSection({ open }: { open: boolean }) {
  const entries = useSyncExternalStore(sessionLog.subscribe, sessionLog.entries, serverEntries)
  const sections = useMemo(() => readableLog(entries), [entries])
  const dropped = droppedNote(entries)
  const [status, setStatus] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  // Opening the panel goes to the newest line, and follows from there.
  useLayoutEffect(() => {
    if (open) following.current = true
  }, [open])

  useLayoutEffect(() => {
    const box = scroller.current
    if (open && box && following.current) box.scrollTop = box.scrollHeight
  }, [entries, open])

  async function copy(format: 'text' | 'JSON') {
    if (entries.length === 0) {
      setStatus('Nothing to copy yet.')
      return
    }
    try {
      await navigator.clipboard.writeText(format === 'text' ? formatText(entries) : formatJson(entries))
      setStatus(`Copied ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} as ${format}.`)
    } catch (error) {
      setStatus(`Couldn't copy: ${(error as Error).message}`)
    }
  }

  function clear() {
    sessionLog.clear()
    following.current = true
    setStatus('Cleared.')
  }

  return (
    <section className="tools-panel-section">
      <h3>Session log</h3>
      <p className="tools-panel-note">
        Every voice session since the log was cleared: what you and the agent said, and every message from Deepgram
        but the audio. It&apos;s kept in this browser, so it survives a reload.
      </p>
      <div className="tools-panel-buttons">
        <button type="button" onClick={() => copy('text')}>
          Copy as text
        </button>
        <button type="button" onClick={() => copy('JSON')}>
          Copy as JSON
        </button>
        <button type="button" onClick={clear}>
          Clear
        </button>
      </div>
      <p className="tools-panel-note" role="status">
        {status}
      </p>

      {sections.length === 0 ? (
        <p>Nothing yet. Press Talk to order to start a session.</p>
      ) : (
        <div
          className="session-log"
          ref={scroller}
          role="region"
          aria-label="Session log entries"
          // Focusable, so the log scrolls from the keyboard.
          tabIndex={0}
          onScroll={(event) => {
            const box = event.currentTarget
            following.current = box.scrollHeight - box.scrollTop - box.clientHeight < FOLLOW_SLACK
          }}
        >
          {dropped && <p className="session-log-dropped">{dropped}</p>}
          {sections.map((section) => (
            <section key={section.lines[0]?.seq ?? section.session}>
              <h4>{sectionHeading(section)}</h4>
              <ol>
                {section.lines.map((line) => (
                  <li key={line.seq} data-kind={line.kind}>
                    <time dateTime={line.ts}>{line.time}</time>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
