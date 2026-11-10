import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { useAgentSession } from '@deepgram/react'
import { summarizeCart } from '../agent/cartSummary'
import { agentSettings } from '../voice/agentSettings'
import { CONNECTION_LOST, MIC_BLOCKED, NO_SESSION, type SessionEnd } from '../voice/sessionStatus'
import { recordEnd, recordSession, recordSessionEnd } from './recordSession'
import { createSessionLog } from './sessionLog'

type AgentSession = ReturnType<typeof useAgentSession>

/** Stands in for the SDK's AgentSession: an event emitter with a connection state. */
function fakeSession(state: AgentSession['state'] = 'connected') {
  const emitter = new EventEmitter()
  return { emitter, session: Object.assign(emitter, { state }) as unknown as AgentSession }
}

const settings = agentSettings(summarizeCart({}))

function setUp({ agentSpeaking = false } = {}) {
  const log = createSessionLog()
  const { emitter, session } = fakeSession()
  const stop = recordSession(session, { settings, page: '/dev/tools', agentSpeaking: () => agentSpeaking, log })
  return { log, emitter, session, stop }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recordSession', () => {
  it("records every event but the audio, in order, with the Settings sent right after Welcome", () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter } = setUp()

    emitter.emit('connecting')
    emitter.emit('connected')
    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-1' })
    emitter.emit('settings-applied', { type: 'SettingsApplied' })
    emitter.emit('conversation-text', { type: 'ConversationText', role: 'assistant', content: 'Hi!' })
    emitter.emit('audio', new ArrayBuffer(8))
    emitter.emit('latency-report', { type: 'LatencyReport', total_latency: 0.5 })
    emitter.emit('reconnecting', 1, 500)
    emitter.emit('sdk-error', new Error('socket closed: 1006'))
    emitter.emit('disconnected', 'socket closed: 1006')

    expect(log.entries().map(({ direction, type }) => `${direction} ${type}`)).toEqual([
      'app SessionStarted',
      'app Connecting',
      'app Connected',
      'server Welcome',
      'client Settings',
      'server SettingsApplied',
      'server ConversationText',
      'server LatencyReport',
      'app Reconnecting',
      'app SdkError',
      'app Disconnected',
    ])
    expect(log.entries()[0]?.payload).toEqual({ page: '/dev/tools' })
    expect(log.entries()[4]?.payload).toEqual({ type: 'Settings', agent: settings })
    expect(log.entries()[8]?.payload).toEqual({ attempt: 1, delayMs: 500 })
    expect(log.entries()[9]?.payload).toEqual({ name: 'Error', message: 'socket closed: 1006' })
  })

  it('records every Deepgram message the SDK passes on, as it came', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { log, emitter } = setUp()
    const messages: Array<[string, { type: string }]> = [
      ['agent-thinking', { type: 'AgentThinking' }],
      ['function-call-request', { type: 'FunctionCallRequest' }],
      ['agent-started-speaking', { type: 'AgentStartedSpeaking' }],
      ['agent-audio-done', { type: 'AgentAudioDone' }],
      ['prompt-updated', { type: 'PromptUpdated' }],
      ['speak-updated', { type: 'SpeakUpdated' }],
      ['think-updated', { type: 'ThinkUpdated' }],
      ['listen-updated', { type: 'ListenUpdated' }],
      ['history', { type: 'History' }],
      ['injection-refused', { type: 'InjectionRefused' }],
      ['error', { type: 'Error' }],
      ['warning', { type: 'Warning' }],
      ['function-call-response', { type: 'FunctionCallResponse' }],
      ['user-started-speaking', { type: 'UserStartedSpeaking' }],
    ]
    for (const [event, message] of messages) emitter.emit(event, message)

    const recorded = log.entries().slice(1)
    expect(recorded.map(({ direction, type, payload }) => ({ direction, type, payload }))).toEqual(
      messages.map(([, message]) => ({ direction: 'server', type: message.type, payload: message })),
    )
  })

  it('marks the customer starting to speak while the agent is speaking', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const speaking = setUp({ agentSpeaking: true })
    speaking.emitter.emit('user-started-speaking', { type: 'UserStartedSpeaking' })
    expect(speaking.log.entries().at(-1)).toMatchObject({ type: 'UserStartedSpeaking', interruptsAgent: true })

    const quiet = setUp({ agentSpeaking: false })
    quiet.emitter.emit('user-started-speaking', { type: 'UserStartedSpeaking' })
    expect(quiet.log.entries().at(-1)).not.toHaveProperty('interruptsAgent')
  })

  it('prints the conversation to the console, and the rest at debug level', () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {})
    const debugged = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { emitter } = setUp()

    emitter.emit('conversation-text', { type: 'ConversationText', role: 'user', content: "What's vegetarian?" })
    emitter.emit('conversation-text', { type: 'ConversationText', role: 'assistant', content: 'The margherita.' })
    emitter.emit('settings-applied', { type: 'SettingsApplied' })

    expect(logged.mock.calls).toEqual([["[voice] you: What's vegetarian?"], ['[voice] agent: The margherita.']])
    expect(debugged).toHaveBeenLastCalledWith('[voice] settings applied')
  })

  it("stops recording when stopped, but for the hang-up that follows", () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter, stop } = setUp()
    stop()

    emitter.emit('conversation-text', { type: 'ConversationText', role: 'assistant', content: 'Bye!' })
    // AgentProvider hangs up a moment after it unmounts.
    emitter.emit('disconnected', 'user requested disconnect')
    emitter.emit('disconnected', 'again')

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'Disconnected'])
    expect(emitter.listenerCount('disconnected')).toBe(0)
  })

  it('keeps one section when React subscribes twice to the same session, as StrictMode does in development', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createSessionLog()
    const { emitter, session } = fakeSession('idle')
    const options = { settings, page: '/', agentSpeaking: () => false, log }
    recordSession(session, options)()
    recordSession(session, options)
    emitter.emit('connecting')

    expect(log.entries().map(({ session, type }) => `${session} ${type}`)).toEqual(['1 SessionStarted', '1 Connecting'])
    // A new session gets a new section.
    recordSession(fakeSession().session, options)
    expect(log.entries().at(-1)).toMatchObject({ session: 2, type: 'SessionStarted' })
  })

  it('waits for no hang-up when the session is already closed', () => {
    const log = createSessionLog()
    const { emitter, session } = fakeSession('disconnected')
    recordSession(session, { settings, page: '/', agentSpeaking: () => false, log })()

    expect(emitter.eventNames()).toEqual([])
  })
})

describe('recordSessionEnd', () => {
  const ends: Array<[SessionEnd, string]> = [
    ['pressed', 'talk button pressed again'],
    ['pageHidden', 'left the page'],
    ['idle', 'no speech for 60 s'],
  ]

  it.each(ends)('says why the session ended: %s', (endedBy, reason) => {
    const log = createSessionLog()
    log.startSession()
    recordSessionEnd({ status: 'idle', sessionNumber: 1, endedBy }, log)

    expect(log.entries().at(-1)).toMatchObject({ type: 'SessionEnded', payload: { endedBy, reason } })
  })

  it('adds the message the talk button shows after a failure', () => {
    const log = createSessionLog()
    log.startSession()
    recordSessionEnd({ status: 'error', sessionNumber: 1, endedBy: 'sdkError', message: MIC_BLOCKED }, log)

    expect(log.entries().at(-1)?.payload).toEqual({
      endedBy: 'sdkError',
      reason: 'microphone or connection error',
      message: MIC_BLOCKED,
    })
  })

  it('has words for every end', () => {
    const log = createSessionLog()
    const all: SessionEnd[] = ['pressed', 'pageHidden', 'idle', 'tokenFailed', 'sdkError', 'agentError', 'disconnected']
    for (const endedBy of all) {
      log.startSession()
      recordSessionEnd({ status: 'error', sessionNumber: 1, endedBy, message: CONNECTION_LOST }, log)
      expect(log.entries().at(-1)?.payload).toMatchObject({ reason: expect.stringMatching(/\w/) })
    }
  })

  it('records only the first end of a session', () => {
    const log = createSessionLog()
    log.startSession()
    // Leaving the page is recorded on pagehide; the voice session's state says so again later.
    recordEnd('pageHidden', undefined, log)
    recordSessionEnd({ status: 'idle', sessionNumber: 1, endedBy: 'pageHidden' }, log)

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'SessionEnded'])
  })

  it('records nothing for a session that has not ended, or before the first', () => {
    const log = createSessionLog()
    log.startSession()
    recordSessionEnd(NO_SESSION, log)
    recordSessionEnd(
      { status: 'listening', sessionNumber: 1, settingsApplied: true, microphoneOn: true },
      log,
    )

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted'])
  })
})
