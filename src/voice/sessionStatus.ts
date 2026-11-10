// The voice session's lifecycle, as one plain reducer: what the talk button
// shows (its status, and the message when a session fails), and every rule for
// when a session ends. No React or SDK code (only types), so tests run it as a
// list of events. VoiceSession.tsx holds it with `useReducer`, turns the SDK's
// callbacks into events, and renders from the state.
//
// One session per press. A press starts a session, or ends the one that's on.
// A session also ends when the customer leaves the page, after a minute with no
// speech, or when something fails, with a message the button shows until the
// next press:
// - the token server function's own message, shown as it is
// - a blocked or missing microphone
// - an Error message from Deepgram
// - any other SDK error before the agent has its settings: retrying a refused
//   token or a broken connection would only repeat it. After, the SDK
//   reconnects a dropped connection by itself.
// - a disconnect once the session has started, which means the SDK gave up
//   reconnecting. Before that, a disconnect is AgentProvider hanging up after a
//   failed start, and the error it reports next says why.

import type { AgentMode, AgentState } from '@deepgram/react'
import { VOICE_UNAVAILABLE } from './deepgramToken'

/** Every state the talk button shows. */
export type TalkStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

/** The states while a session is on. */
export type LiveStatus = Extract<TalkStatus, 'connecting' | 'listening' | 'thinking' | 'speaking'>

/** What the button says when the microphone is blocked. */
export const MIC_BLOCKED = 'Allow the microphone to talk to us.'

/** What the button says when there's no microphone it can use. */
export const MIC_UNAVAILABLE = "We couldn't use your microphone. Check that one is connected."

/** What the button says when the SDK gave up reconnecting. */
export const CONNECTION_LOST = 'We lost the connection. Press to talk again.'

/** A session that's on. */
export type LiveSession = {
  status: LiveStatus
  /** Which session this is: 1 for the first. */
  sessionNumber: number
  /** The agent has its settings. */
  settingsApplied: boolean
  /** The microphone is on, so AgentProvider has finished starting the session. */
  microphoneOn: boolean
}

export type SessionState =
  /** No session. `sessionNumber` is the last one's (0 before the first press). */
  | { status: 'idle'; sessionNumber: number }
  /** The last session failed. The button shows why until the next press. */
  | { status: 'error'; sessionNumber: number; message: string }
  | LiveSession

/** The page's first render: no session yet. */
export const NO_SESSION: SessionState = { status: 'idle', sessionNumber: 0 }

/** What a live session reports. */
export type LiveEvent =
  /** The SDK's connection state, or the agent's mode, changed. */
  | { type: 'agentChanged'; state: AgentState; mode: AgentMode }
  /** Deepgram applied the agent's settings. */
  | { type: 'settingsApplied' }
  /** The microphone started. */
  | { type: 'microphoneOn' }
  /** The token server function answered with a message instead of a token. */
  | { type: 'tokenFailed'; message: string }
  /** The SDK reported an error: the microphone, or a connection that failed. */
  | { type: 'sdkError'; error: unknown }
  /** Deepgram sent an Error message. Its docs say to treat each one as the end of the session. */
  | { type: 'agentError' }
  /** The connection closed: AgentProvider hung up after a failed start, or the SDK gave up reconnecting. */
  | { type: 'disconnected' }
  /** A minute went by with no speech from either side (idleTimer.ts). */
  | { type: 'idle' }
  /** The customer is leaving the page. */
  | { type: 'pageHidden' }

export type SessionEvent =
  /** The customer pressed the talk button. */
  | { type: 'pressed' }
  /** Something happened in session number `sessionNumber`. */
  | (LiveEvent & { sessionNumber: number })

export function isLive(state: SessionState): state is LiveSession {
  return state.status !== 'idle' && state.status !== 'error'
}

/** The session after `event`. Returns `state` itself when the event changes nothing. */
export function updateSession(state: SessionState, event: SessionEvent): SessionState {
  if (event.type === 'pressed') {
    if (isLive(state)) return { status: 'idle', sessionNumber: state.sessionNumber }
    return { status: 'connecting', sessionNumber: state.sessionNumber + 1, settingsApplied: false, microphoneOn: false }
  }

  // Only the first end of a session counts, and a session that has ended or
  // been replaced changes nothing (its token request can answer late).
  if (!isLive(state) || event.sessionNumber !== state.sessionNumber) return state

  switch (event.type) {
    case 'agentChanged': {
      const status = liveStatus(event.state, event.mode)
      return status === state.status ? state : { ...state, status }
    }
    case 'settingsApplied':
      return state.settingsApplied ? state : { ...state, settingsApplied: true }
    case 'microphoneOn':
      return state.microphoneOn ? state : { ...state, microphoneOn: true }
    case 'idle':
    case 'pageHidden':
      return { status: 'idle', sessionNumber: state.sessionNumber }
    case 'tokenFailed':
      return failed(state, event.message)
    case 'agentError':
      return failed(state, VOICE_UNAVAILABLE)
    case 'sdkError': {
      const message = microphoneMessage(event.error)
      if (message) return failed(state, message)
      return state.settingsApplied ? state : failed(state, VOICE_UNAVAILABLE)
    }
    case 'disconnected':
      // The microphone starts after the connection opens, often while the
      // browser is still asking for it, after the settings have arrived.
      return state.settingsApplied && state.microphoneOn ? failed(state, CONNECTION_LOST) : state
  }
}

function failed(state: LiveSession, message: string): SessionState {
  return { status: 'error', sessionNumber: state.sessionNumber, message }
}

/**
 * The button's status from the SDK's connection `state` and the agent's
 * `mode`. It counts as connecting until the agent has its settings (the SDK
 * moves `mode` from idle to listening then), and again while it reconnects.
 */
function liveStatus(state: AgentState, mode: AgentMode): LiveStatus {
  if (state !== 'connected' || mode === 'idle') return 'connecting'
  return mode
}

/** The message for a microphone problem (getUserMedia's DOMException names), or `undefined`. */
function microphoneMessage(error: unknown): string | undefined {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return MIC_BLOCKED
  if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') return MIC_UNAVAILABLE
  return undefined
}
