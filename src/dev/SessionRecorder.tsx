// Records the live voice session in the session log, which /dev/tools shows.
// VoiceSession.tsx renders it inside the session's AgentProvider, and loads
// it through lazy() only when import.meta.env.DEV is true, so production
// builds leave it, and the log, out.

import { useEffect, useRef } from 'react'
import { useAgentMode, useAgentSession, type AgentSettingsObject } from '@deepgram/react'
import { recordEnd, recordSession } from './recordSession'

// Leaving the page ends the session, and the page can be gone before React
// renders that end, so it's recorded on pagehide. The listener is added once,
// when this module loads, so it runs ahead of each session's own pagehide
// listener (SessionEvents in VoiceSession.tsx). That one hangs up, and the
// hang-up's log entry re-renders the panel at once, which would unmount a
// recorder whose listener hadn't run yet. VoiceSession's record of the end then
// adds nothing.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => recordEnd('pageHidden'))

export default function SessionRecorder({ settings }: { settings: AgentSettingsObject | string }) {
  const agentSession = useAgentSession()
  // The SDK's mode stays `speaking` until the agent's voice has finished playing.
  const { mode } = useAgentMode()
  const agentSpeaking = useRef(false)

  useEffect(() => {
    agentSpeaking.current = mode === 'speaking'
  }, [mode])

  // Mounted with the provider, so it hears the session from its first event.
  useEffect(
    () =>
      recordSession(agentSession, {
        settings,
        page: window.location.pathname,
        agentSpeaking: () => agentSpeaking.current,
      }),
    [agentSession, settings],
  )

  return null
}
