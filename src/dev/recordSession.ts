// Records a live voice session in the session log (sessionLog.ts): every
// event the SDK's AgentSession emits except the audio, the Settings the SDK
// sent on each connect, and how the session ended. Each entry is also printed
// to the browser console: `[voice] you: …` and `[voice] agent: …` as they're
// said, and everything else at console.debug (Chrome's Verbose level).
//
// Dev only: SessionRecorder.tsx runs it, and VoiceSession.tsx loads that only
// when import.meta.env.DEV is true. No React here, so tests drive it with a
// plain event emitter.
//
// A session's section ends "session ended: why", then "disconnected", in that
// order. A failed start (a blocked microphone) disconnects before the app hears
// why, so a disconnect that comes before the end waits for it.
//
// What the SDK sends raises no event. It sends the Settings on every connect,
// reconnects included, just before it passes Welcome on, so they're recorded
// then, rebuilt the way it builds them (settingsPayload). A message the app
// sends itself (UpdatePrompt, a FunctionCallResponse) needs recording where
// it's sent, as a 'client' entry.

import type { AgentSessionConfig, AgentSessionEvents, ServerMessage, useAgentSession } from '@deepgram/react'
import { IDLE_TIMEOUT_MS } from '../voice/idleTimer'
import { isLive, type ErrorSummary, type SessionEnd, type SessionState } from '../voice/sessionStatus'
import {
  describeEntry,
  sessionLog,
  type AppEntryType,
  type LogEntry,
  type NewEntry,
  type SessionLog,
} from './sessionLog'

type AgentSession = ReturnType<typeof useAgentSession>

/**
 * Each session's number in the log. React can subscribe to the same session
 * twice (StrictMode mounts components twice in development): it's still one session.
 */
const sessionNumbers = new WeakMap<AgentSession, number>()

/** Every SDK event but the audio, which the log skips. */
type RecordedEvent = Exclude<keyof AgentSessionEvents, 'audio'>

type Options = {
  /** The config AgentProvider made the session from. */
  config: AgentSessionConfig
  /** The page the session started on. */
  page: string
  /** Whether the agent's voice is playing right now. */
  agentSpeaking: () => boolean
  log?: SessionLog
}

/**
 * Records `session` in its own section of the log, from now until the
 * returned function is called.
 */
export function recordSession(
  session: AgentSession,
  { config, page, agentSpeaking, log = sessionLog }: Options,
): () => void {
  const known = sessionNumbers.get(session)
  const sessionNumber = known ?? log.startSession({ page })
  sessionNumbers.set(session, sessionNumber)
  const record = (entry: NewEntry) => print(log.append(entry))
  const recordServer = (message: ServerMessage) =>
    record({ session: sessionNumber, direction: 'server', type: message.type, payload: message })
  const recordApp = (type: AppEntryType, payload: Record<string, unknown> = {}) =>
    record({ session: sessionNumber, direction: 'app', type, payload })
  /** Deepgram sends one Welcome per connection, so any after the first follow a reconnect. */
  let welcomes = 0

  /** Whether this session's end is in the log yet. */
  const ended = () => log.entries().some((entry) => entry.session === sessionNumber && entry.type === 'SessionEnded')
  /** A disconnect that came before the end, waiting for it. */
  let waiting: { reason: string; unsubscribe: () => void } | undefined

  function recordWaitingDisconnect() {
    if (!waiting) return
    const { reason, unsubscribe } = waiting
    waiting = undefined
    unsubscribe()
    recordApp('Disconnected', { reason })
  }

  /** Records the disconnect after the session's end, waiting for the end if it hasn't come yet. */
  function recordDisconnect(reason: string) {
    if (ended()) return recordApp('Disconnected', { reason })
    // SessionRecorder records the end once React renders it, a moment later.
    const unsubscribe = log.subscribe(() => {
      if (ended()) recordWaitingDisconnect()
    })
    waiting = { reason, unsubscribe }
  }

  // One listener per event. TypeScript checks that every event the SDK has, but the audio, is here.
  const listeners: { [Event in RecordedEvent]: (...args: AgentSessionEvents[Event]) => void } = {
    welcome(message) {
      recordServer(message)
      welcomes += 1
      const history = session.conversationHistory
      record({
        session: sessionNumber,
        direction: 'client',
        type: 'Settings',
        payload: settingsPayload(config, history),
        // An agent id can't carry context, so nothing is restored with one.
        ...(welcomes > 1 && { restoredMessages: typeof config.agent === 'string' ? 0 : history.length }),
      })
    },
    'user-started-speaking'(message) {
      record({
        session: sessionNumber,
        direction: 'server',
        type: message.type,
        payload: message,
        ...(agentSpeaking() && { interruptsAgent: true }),
      })
    },
    'settings-applied': recordServer,
    'conversation-text': recordServer,
    // Deepgram no longer sends AgentStartedSpeaking, and has sent no
    // AgentThinking in any session of ours. They're kept so the log shows
    // them if they come.
    'agent-thinking': recordServer,
    'function-call-request': recordServer,
    'agent-started-speaking': recordServer,
    'agent-audio-done': recordServer,
    'prompt-updated': recordServer,
    'speak-updated': recordServer,
    'think-updated': recordServer,
    'listen-updated': recordServer,
    'latency-report': recordServer,
    history: recordServer,
    'injection-refused': recordServer,
    error: recordServer,
    warning: recordServer,
    'function-call-response': recordServer,
    // The SDK's own connection events.
    connecting: () => recordApp('Connecting'),
    connected: () => recordApp('Connected'),
    reconnecting: (attempt, delayMs) => recordApp('Reconnecting', { attempt, delayMs }),
    disconnected: recordDisconnect,
    'sdk-error': (error) => recordApp('SdkError', { name: error.name, message: error.message }),
  }

  const events = Object.keys(listeners) as RecordedEvent[]
  // The listener table's type ties each event to its own listener; `on` can't see that through the loop.
  for (const event of events) session.on(event, listeners[event] as never)
  // AgentProvider starts connecting as soon as it mounts, a render before
  // VoiceSession hands the session over, so the first `connecting` has gone by.
  if (known === undefined && session.state === 'connecting') recordApp('Connecting')

  return () => {
    for (const event of events) session.off(event, listeners[event] as never)
    // A disconnect still waiting has no end coming (the page changed, say), so it goes in as it is.
    recordWaitingDisconnect()
    // AgentProvider hangs up a moment after it unmounts: record that too.
    if (session.state !== 'idle' && session.state !== 'disconnected') {
      session.once('disconnected', (reason) => recordApp('Disconnected', { reason }))
    }
  }
}

/**
 * The Settings message the SDK sends on every connect, rebuilt the way
 * AgentSession builds it (its private `_buildSettingsPayload` in
 * @deepgram/agents 0.1.2). After a reconnect, `history` (the session's
 * `conversationHistory`: each line, and each answered function call) goes into
 * the agent's context, after any of its own, and the greeting is left out, so
 * the agent picks up where it left off. An agent id can't carry context, so it
 * goes as it is. Fields left undefined don't go over the wire.
 */
export function settingsPayload(config: AgentSessionConfig, history: AgentSession['conversationHistory']) {
  const { agent, audio } = config
  return {
    type: 'Settings',
    experimental: config.experimental,
    tags: config.tags,
    audio: {
      input: { encoding: audio?.input?.encoding ?? 'linear16', sample_rate: audio?.input?.sampleRate ?? 16_000 },
      ...(audio?.output && { output: { encoding: audio.output.encoding, sample_rate: audio.output.sampleRate } }),
    },
    agent:
      typeof agent === 'string' || history.length === 0
        ? agent
        : {
            ...agent,
            greeting: undefined,
            context: { ...agent.context, messages: [...(agent.context?.messages ?? []), ...history] },
          },
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
  const details = state.status === 'error' ? { message: state.message, sdkError: state.sdkError } : {}
  recordEnd(state.endedBy, details, log)
}

type EndDetails = {
  /** The message the talk button shows. */
  message?: string
  /** The SDK's error, when one ended the session. */
  sdkError?: ErrorSummary
}

/**
 * Ends the open session's section of the log with why it ended: the reason in
 * words, with the SDK's error if there was one (`… (NotAllowedError: Permission
 * denied)`), and the message the talk button shows, if any. Only the first end
 * of a session counts.
 */
export function recordEnd(
  endedBy: SessionEnd,
  { message, sdkError }: EndDetails = {},
  log: SessionLog = sessionLog,
): void {
  const reason = sdkError ? `${END_REASONS[endedBy]} (${describeError(sdkError)})` : END_REASONS[endedBy]
  const entry = log.endSession({ endedBy, reason, ...(message && { message }), ...(sdkError && { sdkError }) })
  if (entry) print(entry)
}

/** `NotAllowedError: Permission denied`, or just the name when there's no message. */
function describeError({ name, message }: ErrorSummary): string {
  return message ? `${name}: ${message}` : name
}

function print(entry: LogEntry) {
  const { kind, text } = describeEntry(entry)
  if (kind === 'you' || kind === 'agent') console.log(`[voice] ${text}`)
  else console.debug(`[voice] ${text}`)
}
