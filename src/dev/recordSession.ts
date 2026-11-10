// Records a live voice session in the session log (sessionLog.ts): every
// event the SDK's AgentSession emits except the audio, the Settings the app
// sent, and how the session ended. Each entry is also printed to the browser
// console: `[voice] you: …` and `[voice] agent: …` as they're said, and
// everything else at console.debug (Chrome's Verbose level).
//
// Dev only: VoiceSession.tsx loads it, through SessionRecorder.tsx, only when
// import.meta.env.DEV is true. No React here, so tests drive it with a plain
// event emitter.
//
// What the app sends through the SDK raises no event. The Settings are
// recorded when Welcome arrives, because the SDK sends them right then, before
// passing Welcome on. A message the app sends itself (UpdatePrompt, a
// FunctionCallResponse) needs recording where it's sent, as a 'client' entry.

import type { AgentSessionEvents, AgentSettingsObject, ServerMessage, useAgentSession } from '@deepgram/react'
import { IDLE_TIMEOUT_MS } from '../voice/idleTimer'
import { isLive, type SessionEnd, type SessionState } from '../voice/sessionStatus'
import { describeEntry, sessionLog, type LogEntry, type NewEntry, type SessionLog } from './sessionLog'

type AgentSession = ReturnType<typeof useAgentSession>

/**
 * Each session's section of the log. In development React mounts components
 * twice (StrictMode), so the recorder subscribes to the same session twice.
 */
const sections = new WeakMap<AgentSession, number>()

/** Every SDK event but the audio, which the log skips. */
type RecordedEvent = Exclude<keyof AgentSessionEvents, 'audio'>

type Options = {
  /** The agent's settings, as the session's config passes them to the SDK. */
  settings: AgentSettingsObject | string
  /** The page the session started on. */
  page: string
  /** Whether the agent's voice is playing right now. */
  agentSpeaking: () => boolean
  log?: SessionLog
}

/**
 * Records `session` in its own section of the log, from now until the
 * returned function is called. Call it before the session connects.
 */
export function recordSession(
  session: AgentSession,
  { settings, page, agentSpeaking, log = sessionLog }: Options,
): () => void {
  const sessionNumber = sections.get(session) ?? log.startSession({ page })
  sections.set(session, sessionNumber)
  const record = (entry: Omit<NewEntry, 'session'>) => print(log.append({ session: sessionNumber, ...entry }))
  const server = (message: ServerMessage) => record({ direction: 'server', type: message.type, payload: message })

  // One listener per event. TypeScript checks that every event the SDK has, but the audio, is here.
  const listeners: { [Event in RecordedEvent]: (...args: AgentSessionEvents[Event]) => void } = {
    welcome(message) {
      server(message)
      record({ direction: 'client', type: 'Settings', payload: { type: 'Settings', agent: settings } })
    },
    'user-started-speaking'(message) {
      record({
        direction: 'server',
        type: message.type,
        payload: message,
        ...(agentSpeaking() && { interruptsAgent: true }),
      })
    },
    'settings-applied': server,
    'conversation-text': server,
    'agent-thinking': server,
    'function-call-request': server,
    'agent-started-speaking': server,
    'agent-audio-done': server,
    'prompt-updated': server,
    'speak-updated': server,
    'think-updated': server,
    'listen-updated': server,
    'latency-report': server,
    history: server,
    'injection-refused': server,
    error: server,
    warning: server,
    'function-call-response': server,
    // The SDK's own connection events.
    connecting: () => record({ direction: 'app', type: 'Connecting', payload: {} }),
    connected: () => record({ direction: 'app', type: 'Connected', payload: {} }),
    reconnecting: (attempt, delayMs) => record({ direction: 'app', type: 'Reconnecting', payload: { attempt, delayMs } }),
    disconnected: (reason) => record({ direction: 'app', type: 'Disconnected', payload: { reason } }),
    'sdk-error': (error) =>
      record({ direction: 'app', type: 'SdkError', payload: { name: error.name, message: error.message } }),
  }

  const events = Object.keys(listeners) as RecordedEvent[]
  // The listener table's type ties each event to its own listener; `on` can't see that through the loop.
  for (const event of events) session.on(event, listeners[event] as never)

  return () => {
    for (const event of events) session.off(event, listeners[event] as never)
    // AgentProvider hangs up a moment after it unmounts: record that too.
    if (session.state !== 'idle' && session.state !== 'disconnected') {
      session.once('disconnected', listeners.disconnected)
    }
  }
}

/** How each end reads in the log. */
const END_REASONS: Record<SessionEnd, string> = {
  pressed: 'talk button pressed again',
  pageHidden: 'left the page',
  idle: `no speech for ${IDLE_TIMEOUT_MS / 1000} s`,
  tokenFailed: 'the token server function failed',
  sdkError: 'microphone or connection error',
  agentError: 'Deepgram sent an Error',
  disconnected: 'the SDK gave up reconnecting',
}

/**
 * Records how the session ended, from the voice session's state
 * (sessionStatus.ts) once it has ended. A live state, or the state before the
 * first press, records nothing.
 */
export function recordSessionEnd(state: SessionState, log: SessionLog = sessionLog): void {
  if (isLive(state) || !state.endedBy) return
  recordEnd(state.endedBy, state.status === 'error' ? state.message : undefined, log)
}

/**
 * Ends the open session's section of the log with why it ended, and the
 * message the talk button shows, if any. Only the first end of a session counts.
 */
export function recordEnd(endedBy: SessionEnd, message?: string, log: SessionLog = sessionLog): void {
  const entry = log.endSession({ endedBy, reason: END_REASONS[endedBy], ...(message && { message }) })
  if (entry) print(entry)
}

function print(entry: LogEntry) {
  const { kind, text } = describeEntry(entry)
  if (kind === 'you' || kind === 'agent') console.log(`[voice] ${text}`)
  else console.debug(`[voice] ${text}`)
}
