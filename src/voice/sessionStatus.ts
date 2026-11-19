// The voice session's lifecycle, as one plain reducer: what the talk button
// shows (its status, and the message when a session fails), the tools the
// agent is waiting on (for the captions' activity line, AgentActivity.tsx),
// and every rule for when a session ends. No React or SDK code (only types),
// so tests run it as a list of events. VoiceSession.tsx holds it with
// `useReducer`, turns the SDK's callbacks into events, and renders from the
// state.
//
// One session per press. A press starts a session, or ends the one that's on.
// A session also ends when the customer leaves the page, after a minute with no
// speech, or when something fails, with a message the button shows until the
// next press:
// - the token server function's own message, shown as it is
// - a blocked or missing microphone
// - an Error message from Deepgram
// - any other SDK error before the session has started (the agent has its
//   settings and the microphone is on): retrying a refused token or a broken
//   connection would only repeat it, and after a microphone that failed to
//   start, AgentProvider has hung up. After, the SDK reconnects a dropped
//   connection by itself: the status is connecting again, marked
//   `reconnecting`, so the button says "Reconnecting…".
// - a disconnect once the session has started, or while reconnecting, which
//   means the SDK gave up (eight tries: a minute and a half, more when tries
//   hang). Otherwise a disconnect is AgentProvider hanging up after a failed
//   start, and the error it reports next says why.
// - a minute gone by while still connecting, or within one try at
//   reconnecting (a token request that never answers sends no events, and
//   each try starts the idle timer again): the idle timer's minute then ends
//   the session with a message instead of quietly.
//
// Page code can also ask a session to leave once the agent has spoken
// (sessionHandle.ts, for checkout by voice: SPEC.md, "Checkout"). The request
// comes from the checkout tool, before the agent has its result, so the reply
// ("Taking you to checkout now") is still to come: the session ends the next
// time the agent's voice stops, whether it finished or the customer cut it
// off. If the agent was already speaking, that's when this speech ends. The
// handle ends it anyway when its wait runs out.
//
// An ended session's state keeps what ended it (`endedBy`), and an SDK
// error's name and message (`sdkError`), for the session log on /dev/tools.

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
  /**
   * The tools the agent asked the browser to run, by name, in its last
   * FunctionCallRequest. The SDK sends no event when the browser answers, so
   * they're kept until what comes next: the agent starts speaking (its audio
   * starts playing) or sends a line, the customer starts speaking, or the
   * connection drops.
   */
  toolCalls?: string[]
  /**
   * The connection dropped and the SDK is trying again: `status` is
   * connecting, and the button says "Reconnecting…". It lasts until the agent
   * is back. If the SDK gives up, or one try goes a minute without an answer,
   * the session ends with CONNECTION_LOST.
   */
  reconnecting?: true
  /** Page code asked the session to leave: it ends the next time the agent's voice stops. */
  leaving?: true
}

/**
 * What ended a session: the type of the event that ended it. A session asked
 * to leave ends with `leaveRequested` once the agent's voice stops, or
 * `leaveTimedOut` when the handle stops waiting. `connectTimedOut` is the idle
 * timer's minute going by while the session was still connecting.
 */
export type SessionEnd =
  | 'pressed'
  | 'pageHidden'
  | 'idle'
  | 'leaveRequested'
  | 'leaveTimedOut'
  | 'connectTimedOut'
  | 'tokenFailed'
  | 'sdkError'
  | 'agentError'
  | 'disconnected'

/** An error the SDK reported, as plain data: `NotAllowedError: Permission denied`. */
export type ErrorSummary = { name: string; message: string }

export type SessionState =
  /**
   * No session. `sessionNumber` is the last one's, and `endedBy` what ended
   * it (0 and nothing before the first press).
   */
  | { status: 'idle'; sessionNumber: number; endedBy?: SessionEnd }
  /**
   * The last session failed. The button shows why until the next press.
   * `sdkError` is the SDK's error, when one ended it.
   */
  | { status: 'error'; sessionNumber: number; message: string; endedBy: SessionEnd; sdkError?: ErrorSummary }
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
  /** The customer started speaking (Deepgram's UserStartedSpeaking). */
  | { type: 'customerStartedSpeaking' }
  /** The customer's line arrived as text (their ConversationText), which Deepgram sends at the end of their turn. */
  | { type: 'customerFinishedSpeaking' }
  /** The agent's line arrived as text (its ConversationText). */
  | { type: 'agentLine' }
  /** The agent asked the browser to run tools (Deepgram's FunctionCallRequest). */
  | { type: 'toolsRequested'; names: string[] }
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
  /** Page code asked the session to leave once the agent has spoken (sessionHandle.ts). */
  | { type: 'leaveRequested' }
  /** The handle stopped waiting for the agent to finish speaking. */
  | { type: 'leaveTimedOut' }

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
  const next = nextState(state, event)
  // A session asked to leave ends when the agent's voice stops (see the top of this file).
  if (isLive(state) && state.leaving && state.status === 'speaking' && isLive(next) && next.status !== 'speaking') {
    return { status: 'idle', sessionNumber: state.sessionNumber, endedBy: 'leaveRequested' }
  }
  return next
}

function nextState(state: SessionState, event: SessionEvent): SessionState {
  if (event.type === 'pressed') {
    if (isLive(state)) return { status: 'idle', sessionNumber: state.sessionNumber, endedBy: 'pressed' }
    return { status: 'connecting', sessionNumber: state.sessionNumber + 1, settingsApplied: false, microphoneOn: false }
  }

  // Only the first end of a session counts, and a session that has ended or
  // been replaced changes nothing (its token request can answer late).
  if (!isLive(state) || event.sessionNumber !== state.sessionNumber) return state

  switch (event.type) {
    case 'agentChanged': {
      const status = liveStatus(event.state, event.mode)
      // The agent speaking means its tool calls were answered; a reconnect drops them.
      const toolCallsOver = status === 'speaking' || status === 'connecting'
      // The SDK says `reconnecting` while it waits to try again and
      // `connecting` while it tries, so a reconnect lasts until the status
      // is something else.
      const reconnecting = status === 'connecting' && (event.state === 'reconnecting' || state.reconnecting === true)
      return withReconnecting(withStatus(toolCallsOver ? withoutToolCalls(state) : state, status), reconnecting)
    }
    // The SDK's mode shows thinking only on Deepgram's AgentThinking, which
    // its docs still list but no session of ours has received, so the mode
    // goes straight from listening to speaking. The customer's line ends their
    // turn: the agent is thinking until it starts speaking (agentChanged, from
    // its audio) or the customer starts speaking again. A line that comes
    // after the agent started speaking changes nothing. As in the SDK, the
    // customer speaking means listening, even over the agent (the SDK stops
    // its audio).
    case 'customerFinishedSpeaking':
      return state.status === 'listening' ? withStatus(state, 'thinking') : state
    case 'customerStartedSpeaking':
      return state.status === 'connecting' ? state : withStatus(withoutToolCalls(state), 'listening')
    // A request's tool calls last until what comes next (see `toolCalls`).
    case 'toolsRequested':
      return event.names.length === 0 ? state : { ...state, toolCalls: event.names }
    case 'agentLine':
      return withoutToolCalls(state)
    case 'settingsApplied':
      return state.settingsApplied ? state : { ...state, settingsApplied: true }
    case 'microphoneOn':
      return state.microphoneOn ? state : { ...state, microphoneOn: true }
    case 'idle':
      // The timer counts silence. A session still connecting after a minute
      // never reached the agent, or never got back to it: say which.
      if (state.status === 'connecting') {
        return failed(state, 'connectTimedOut', state.reconnecting ? CONNECTION_LOST : VOICE_UNAVAILABLE)
      }
      return { status: 'idle', sessionNumber: state.sessionNumber, endedBy: event.type }
    case 'pageHidden':
      return { status: 'idle', sessionNumber: state.sessionNumber, endedBy: event.type }
    case 'leaveRequested':
      return state.leaving ? state : { ...state, leaving: true }
    case 'leaveTimedOut':
      return state.leaving ? { status: 'idle', sessionNumber: state.sessionNumber, endedBy: event.type } : state
    case 'tokenFailed':
      return failed(state, event.type, event.message)
    case 'agentError':
      return failed(state, event.type, VOICE_UNAVAILABLE)
    case 'sdkError': {
      const message = microphoneMessage(event.error)
      // Once the session has started, the SDK reconnects by itself, but a microphone won't fix itself.
      if (!message && hasStarted(state)) return state
      return failed(state, event.type, message ?? VOICE_UNAVAILABLE, summarize(event.error))
    }
    case 'disconnected':
      // The SDK gave up reconnecting. Otherwise, before the session has
      // started, it's AgentProvider hanging up, and the error that follows
      // says why.
      return hasStarted(state) || state.reconnecting ? failed(state, event.type, CONNECTION_LOST) : state
  }
}

/**
 * Whether the customer can talk: the agent has its settings and the
 * microphone is on. The microphone starts after the connection opens, often
 * while the browser is still asking for it, after the settings have arrived.
 */
function hasStarted(state: LiveSession): boolean {
  return state.settingsApplied && state.microphoneOn
}

/** `state` with `status`, or `state` itself when the status is already that. */
function withStatus(state: LiveSession, status: LiveStatus): LiveSession {
  return status === state.status ? state : { ...state, status }
}

/** `state` without tool calls, or `state` itself when it has none. */
function withoutToolCalls(state: LiveSession): LiveSession {
  return state.toolCalls ? { ...state, toolCalls: undefined } : state
}

/** `state` reconnecting or not, or `state` itself when it already says so. */
function withReconnecting(state: LiveSession, reconnecting: boolean): LiveSession {
  if ((state.reconnecting === true) === reconnecting) return state
  return { ...state, reconnecting: reconnecting || undefined }
}

function failed(state: LiveSession, endedBy: SessionEnd, message: string, sdkError?: ErrorSummary): SessionState {
  return { status: 'error', sessionNumber: state.sessionNumber, message, endedBy, ...(sdkError && { sdkError }) }
}

/** `error` as plain data. The SDK reports Errors (the microphone's are DOMExceptions), but anything can be thrown. */
function summarize(error: unknown): ErrorSummary {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) }
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
