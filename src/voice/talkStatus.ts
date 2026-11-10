// What the talk button shows: the session's status, its label, and the
// message when a session fails. Plain functions, so tests can check them.

import type { AgentMode, AgentState } from '@deepgram/react'

/** Every state the talk button shows. */
export type TalkStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

/** The states while a session is on. */
export type LiveStatus = Extract<TalkStatus, 'connecting' | 'listening' | 'thinking' | 'speaking'>

/** Each state's label, and what a press does then. */
export const TALK_LABELS: Record<TalkStatus, { label: string; hint?: string }> = {
  idle: { label: 'Talk to order' },
  connecting: { label: 'Connecting…', hint: 'Press to cancel' },
  listening: { label: 'Listening…', hint: 'Press to stop' },
  thinking: { label: 'Thinking…', hint: 'Press to stop' },
  speaking: { label: 'Speaking…', hint: 'Press to stop' },
  error: { label: 'Try again' },
}

/**
 * A live session's status, from the SDK's connection `state` and the agent's
 * `mode`. It counts as connecting until the agent has its settings (the SDK
 * moves `mode` from idle to listening then), and again while it reconnects.
 */
export function talkStatus(state: AgentState, mode: AgentMode): LiveStatus {
  if (state !== 'connected' || mode === 'idle') return 'connecting'
  return mode
}

/** What the button says when the microphone is blocked. */
export const MIC_BLOCKED = 'Allow the microphone to talk to us.'

/** What the button says when there's no microphone it can use. */
export const MIC_UNAVAILABLE = "We couldn't use your microphone. Check that one is connected."

/** What the button says when the SDK gave up reconnecting. */
export const CONNECTION_LOST = 'We lost the connection. Press to talk again.'

/** The token server function answered with a message to show instead of a token. */
export class VoiceTokenError extends Error {
  override name = 'VoiceTokenError'
}

/**
 * The message for an error we know: the token server's own message, or a
 * microphone problem (getUserMedia's DOMException names). Anything else
 * gets `undefined`, and the caller decides.
 */
export function explainError(error: unknown): string | undefined {
  if (error instanceof VoiceTokenError) return error.message
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_BLOCKED
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return MIC_UNAVAILABLE
  return undefined
}
