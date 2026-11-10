// Records every voice session in the session log, which /dev/tools shows:
// each session's events while it's on (recordSession.ts), and how it ended.
// VoiceSession.tsx renders it next to the talk button, and loads it through
// lazy() only when import.meta.env.DEV is true, so production builds leave it,
// and the log, out.

import { useEffect, useRef } from 'react'
import type { SessionState } from '../voice/sessionStatus'
import type { LiveAgent } from '../voice/VoiceSession'
import { recordEnd, recordSession, recordSessionEnd } from './recordSession'

type Props = {
  /** The voice session's state: what the talk button shows, and what ended the last session. */
  state: SessionState
  /** The live session's AgentSession, once its AgentProvider has made it. */
  live: LiveAgent | null
}

export default function SessionRecorder({ state, live }: Props) {
  // The talk button says Speaking until the agent's voice has finished playing.
  const status = useRef(state.status)
  useEffect(() => {
    status.current = state.status
  }, [state.status])

  useEffect(() => {
    if (!live) return
    return recordSession(live.session, {
      config: live.config,
      page: window.location.pathname,
      agentSpeaking: () => status.current === 'speaking',
    })
  }, [live])

  useEffect(() => recordSessionEnd(state), [state])

  // Leaving the page ends the session, and the page can be gone before React
  // renders that end, so it's recorded on pagehide too. Only the first end of
  // a session counts.
  useEffect(() => {
    const onPageHide = () => recordEnd('pageHidden')
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [])

  return null
}
