// Ends a voice session nobody is using. An open connection costs money every
// second, so after a minute with no speech from either side the session
// closes on its own. Time while the agent is speaking doesn't count. A
// reconnect cuts the agent off, so the count starts again from there.
//
// The timer only counts. VoiceSession.tsx feeds it the session's events, and
// sends sessionStatus.ts an `idle` event when it fires.

/** How long a session may go with no speech from either side. */
export const IDLE_TIMEOUT_MS = 60_000

/** The Deepgram session events that count as speech. */
export const SPEECH_EVENTS = [
  'user-started-speaking',
  'agent-started-speaking',
  'agent-audio-done',
  'conversation-text',
] as const

export type SpeechEvent = (typeof SPEECH_EVENTS)[number]

/**
 * The Deepgram session events that mean the connection dropped or came back.
 * A reconnect resends the settings but not the greeting, so if the drop came
 * while the agent was speaking, no agent-audio-done would end the pause.
 */
export const RESET_EVENTS = ['reconnecting', 'settings-applied'] as const

export type IdleTimer = {
  /** Something was said: the count starts again, and pauses while the agent speaks. */
  heard: (event: SpeechEvent) => void
  /**
   * The connection dropped or came back: whatever the agent was saying is cut
   * off, and its agent-audio-done won't come. The count starts again.
   */
  reset: () => void
  /** Stops counting for good. */
  stop: () => void
}

/** Starts counting now, and calls `onIdle` once after `timeoutMs` without speech. */
export function createIdleTimer(onIdle: () => void, timeoutMs = IDLE_TIMEOUT_MS): IdleTimer {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let agentSpeaking = false
  let stopped = false

  function restart() {
    clearTimeout(timeout)
    timeout = undefined
    if (stopped || agentSpeaking) return
    timeout = setTimeout(() => {
      stopped = true
      onIdle()
    }, timeoutMs)
  }

  restart()
  return {
    heard(event) {
      if (event === 'agent-started-speaking') agentSpeaking = true
      // The customer can cut the agent off, and then no agent-audio-done may come.
      if (event === 'agent-audio-done' || event === 'user-started-speaking') agentSpeaking = false
      restart()
    },
    reset() {
      agentSpeaking = false
      restart()
    },
    stop() {
      stopped = true
      clearTimeout(timeout)
    },
  }
}
