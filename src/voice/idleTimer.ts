// Ends a voice session nobody is using. An open connection costs money every
// second, so after a minute with no speech from either side the session
// closes on its own. Time while the agent is speaking doesn't count: the count
// pauses, and starts again from zero when the agent stops. A reconnect starts
// it again too.
//
// Whether the agent is speaking comes from the session's status
// (sessionStatus.ts), which follows the SDK's mode: speaking from the first
// chunk of the agent's audio until it has finished playing, or until the
// customer cuts it off. Deepgram no longer sends AgentStartedSpeaking, so no
// server message says when the agent starts.
//
// The timer only counts. VoiceSession.tsx feeds it the session's events and
// the status, and sends sessionStatus.ts an `idle` event when it fires.

import type { AgentSessionEvents } from '@deepgram/react'

/** How long a session may go with no speech from either side. */
export const IDLE_TIMEOUT_MS = 60_000

/**
 * The Deepgram session events that count as speech: the customer starting to
 * speak, and either side's line arriving as text. The agent's voice counts
 * through `setAgentSpeaking`.
 */
export const SPEECH_EVENTS = ['user-started-speaking', 'conversation-text'] as const satisfies ReadonlyArray<
  keyof AgentSessionEvents
>

/**
 * The Deepgram session events that mean the connection dropped or came back.
 * The time it was down isn't the customer's silence, so the count starts again.
 */
export const RESET_EVENTS = ['reconnecting', 'settings-applied'] as const satisfies ReadonlyArray<
  keyof AgentSessionEvents
>

export type IdleTimer = {
  /** Someone spoke, or the connection came back: the count starts again, unless the agent is speaking. */
  restart: () => void
  /**
   * Whether the agent is speaking: the count pauses while it is, and starts
   * again when it stops. Saying the same thing twice changes nothing.
   */
  setAgentSpeaking: (speaking: boolean) => void
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
    restart,
    setAgentSpeaking(speaking) {
      if (speaking === agentSpeaking) return
      agentSpeaking = speaking
      restart()
    },
    stop() {
      stopped = true
      clearTimeout(timeout)
    },
  }
}
