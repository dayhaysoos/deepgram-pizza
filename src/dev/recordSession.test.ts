import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionConfig, useAgentSession } from '@deepgram/react'
import { summarizeCart } from '../agent/cartSummary'
import { greeting } from '../agent/instructions'
import { agentSettings } from '../voice/agentSettings'
import { CONNECTION_LOST, MIC_BLOCKED, NO_SESSION, type SessionEnd } from '../voice/sessionStatus'
import { recordEnd, recordSession, recordSessionEnd, settingsPayload } from './recordSession'
import { createSessionLog, describeEntry } from './sessionLog'

type AgentSession = ReturnType<typeof useAgentSession>
type ContextMessage = AgentSession['conversationHistory'][number]

/**
 * Stands in for the SDK's AgentSession: an event emitter with a connection
 * state and the conversation so far, which the SDK keeps to restore on a reconnect.
 */
function fakeSession(state: AgentSession['state'] = 'connected') {
  const emitter = new EventEmitter()
  const conversationHistory: ContextMessage[] = []
  // What the app sends through: the SDK's own methods, which go over the socket.
  const updatePrompt = vi.fn<(prompt: string) => void>()
  const sendFunctionCallResponse = vi.fn<(id: string | undefined, name: string, content: string) => void>()
  return {
    emitter,
    conversationHistory,
    updatePrompt,
    sendFunctionCallResponse,
    session: Object.assign(emitter, {
      state,
      conversationHistory,
      updatePrompt,
      sendFunctionCallResponse,
    }) as unknown as AgentSession,
  }
}

const settings = agentSettings(summarizeCart({}))
/** The config VoiceSession gives AgentProvider: a token factory and the agent's settings. */
const config: AgentSessionConfig = { auth: { tokenFactory: async () => 'token' }, agent: settings }

/** The Settings the SDK sends with the config above, on a first connect. */
const firstSettings = {
  type: 'Settings',
  audio: { input: { encoding: 'linear16', sample_rate: 16_000 } },
  agent: settings,
}

function setUp({ agentSpeaking = false } = {}) {
  const log = createSessionLog()
  const fake = fakeSession()
  const stop = recordSession(fake.session, { config, page: '/dev/tools', agentSpeaking: () => agentSpeaking, log })
  return { log, stop, ...fake }
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
    ])
    expect(log.entries()[0]?.payload).toEqual({ page: '/dev/tools' })
    expect(log.entries()[4]?.payload).toEqual(firstSettings)
    expect(log.entries()[4]).not.toHaveProperty('restoredMessages')
    expect(log.entries()[8]?.payload).toEqual({ attempt: 1, delayMs: 500 })
    expect(log.entries()[9]?.payload).toEqual({ name: 'Error', message: 'socket closed: 1006' })
  })

  it('records the Settings again after a reconnect, as the SDK rebuilt them to restore the conversation', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter, conversationHistory } = setUp()

    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-1' })
    // The SDK keeps each line, and each answered function call, to restore on a reconnect.
    const lines = [
      { type: 'History', role: 'assistant', content: 'Hi!' },
      { type: 'History', role: 'user', content: "What's vegetarian?" },
    ] as const
    for (const { role, content } of lines) {
      conversationHistory.push({ type: 'History', role, content })
      emitter.emit('conversation-text', { type: 'ConversationText', role, content })
    }
    emitter.emit('reconnecting', 1, 500)
    emitter.emit('connecting')
    emitter.emit('connected')
    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-2' })

    const sent = log.entries().filter(({ type }) => type === 'Settings')
    expect(sent.map(({ payload }) => payload)).toEqual([
      firstSettings,
      { ...firstSettings, agent: { ...settings, greeting: undefined, context: { messages: lines } } },
    ])
    expect(sent[1]?.payload).not.toHaveProperty('agent.greeting')
    expect(sent[1]?.restoredMessages).toBe(2)
  })

  it('notes that the session is already connecting when recording starts after AgentProvider started it', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createSessionLog()
    recordSession(fakeSession('connecting').session, { config, page: '/', agentSpeaking: () => false, log })

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'Connecting'])
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

  // AgentProvider hangs up first when the microphone can't start, and reports
  // why a microtask later. The end, which says why, goes first.
  it('records a disconnect after the end that says why', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter } = setUp()
    emitter.emit('settings-applied', { type: 'SettingsApplied' })
    emitter.emit('disconnected', 'user requested disconnect')
    expect(log.entries().at(-1)?.type).toBe('SettingsApplied')

    const sdkError = { name: 'NotAllowedError', message: 'Permission denied' }
    recordSessionEnd({ status: 'error', sessionNumber: 1, endedBy: 'sdkError', message: MIC_BLOCKED, sdkError }, log)
    log.startSession()

    const types = log.entries().map(({ type }) => type)
    expect(types).toEqual(['SessionStarted', 'SettingsApplied', 'SessionEnded', 'Disconnected', 'SessionStarted'])
    expect(log.entries()[3]?.payload).toEqual({ reason: 'user requested disconnect' })
  })

  it('records a disconnect right away once the session has ended', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter } = setUp()
    // Leaving the page records the end before the session hangs up.
    recordEnd('pageHidden', {}, log)
    emitter.emit('disconnected', 'user requested disconnect')

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'SessionEnded', 'Disconnected'])
  })

  it('records a waiting disconnect when stopped before an end comes', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter, stop } = setUp()
    emitter.emit('disconnected', 'user requested disconnect')
    stop()
    recordEnd('pressed', {}, log)

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'Disconnected', 'SessionEnded'])
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
    const options = { config, page: '/', agentSpeaking: () => false, log }
    recordSession(session, options)()
    recordSession(session, options)
    emitter.emit('connecting')

    expect(log.entries().map(({ session, type }) => `${session} ${type}`)).toEqual(['1 SessionStarted', '1 Connecting'])
    // A new session gets a new section.
    recordSession(fakeSession().session, options)
    expect(log.entries().at(-1)).toMatchObject({ session: 2, type: 'SessionStarted' })
  })

  it('notes that a session is already connecting only once, however often React subscribes', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createSessionLog()
    const { session } = fakeSession('connecting')
    const options = { config, page: '/', agentSpeaking: () => false, log }
    recordSession(session, options)()
    recordSession(session, options)

    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted', 'Connecting'])
  })

  it('records the prompt updates and tool results the app sends, as client entries, and still sends them', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter, session, updatePrompt, sendFunctionCallResponse } = setUp()
    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-1' })
    emitter.emit('settings-applied', { type: 'SettingsApplied' })

    session.updatePrompt('Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.')
    session.sendFunctionCallResponse('fc-1', 'view_cart', '{"count":1}')

    expect(log.entries().slice(-2)).toMatchObject([
      {
        direction: 'client',
        type: 'UpdatePrompt',
        payload: { type: 'UpdatePrompt', prompt: 'Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.' },
      },
      {
        direction: 'client',
        type: 'FunctionCallResponse',
        payload: { type: 'FunctionCallResponse', id: 'fc-1', name: 'view_cart', content: '{"count":1}' },
      },
    ])
    expect(log.entries().at(-2)).not.toHaveProperty('afterSettings')
    expect(updatePrompt).toHaveBeenCalledExactlyOnceWith(
      'Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.',
    )
    expect(sendFunctionCallResponse).toHaveBeenCalledExactlyOnceWith('fc-1', 'view_cart', '{"count":1}')
  })

  it('records the newest prompt update where the SDK sends it: right after the settings are applied, on every connect', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, emitter, session } = setUp()
    const updates = () =>
      log
        .entries()
        .filter(({ type }) => type === 'UpdatePrompt' || type === 'SettingsApplied')
        .map(({ type, payload, afterSettings }) =>
          type === 'SettingsApplied' ? type : `${(payload as { prompt: string }).prompt}${afterSettings ? ' (after settings)' : ''}`,
        )

    // Before the settings are applied, the SDK keeps only the newest of each update, and sends it after them.
    session.updatePrompt('first')
    session.updatePrompt('second')
    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-1' })
    emitter.emit('settings-applied', { type: 'SettingsApplied' })
    session.updatePrompt('third')
    // A reconnect sends the Settings again, then the newest update again.
    emitter.emit('reconnecting', 1, 500)
    emitter.emit('welcome', { type: 'Welcome', request_id: 'req-2' })
    emitter.emit('settings-applied', { type: 'SettingsApplied' })

    expect(updates()).toEqual(['SettingsApplied', 'second (after settings)', 'third', 'SettingsApplied', 'third (after settings)'])
  })

  it('puts the session\'s own methods back when stopped', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const { log, session, stop, updatePrompt, sendFunctionCallResponse } = setUp()
    stop()

    expect(session.updatePrompt).toBe(updatePrompt)
    expect(session.sendFunctionCallResponse).toBe(sendFunctionCallResponse)
    session.updatePrompt('after')
    expect(log.entries().map(({ type }) => type)).toEqual(['SessionStarted'])
  })

  it('waits for no hang-up when the session is already closed', () => {
    const log = createSessionLog()
    const { emitter, session } = fakeSession('disconnected')
    recordSession(session, { config, page: '/', agentSpeaking: () => false, log })()

    expect(emitter.eventNames()).toEqual([])
  })
})

describe('settingsPayload', () => {
  it('is what the SDK sends on a first connect: the audio format, and the agent as configured', () => {
    expect(settingsPayload(config, [])).toEqual(firstSettings)
    expect(settingsPayload(config, []).agent).toBe(settings)
  })

  it('carries the audio formats, experimental flag and tags from the config, in the names Deepgram uses', () => {
    const payload = settingsPayload(
      {
        ...config,
        audio: { input: { encoding: 'mulaw', sampleRate: 8_000 }, output: { encoding: 'linear16', sampleRate: 24_000 } },
        experimental: true,
        tags: ['pizza'],
      },
      [],
    )
    expect(payload).toEqual({
      ...firstSettings,
      experimental: true,
      tags: ['pizza'],
      audio: { input: { encoding: 'mulaw', sample_rate: 8_000 }, output: { encoding: 'linear16', sample_rate: 24_000 } },
    })
  })

  it('restores the conversation so far after a reconnect, after any context of its own, and leaves out the greeting', () => {
    const history: ContextMessage[] = [{ type: 'History', role: 'assistant', content: greeting(null) }]
    const earlier: ContextMessage = { type: 'History', role: 'user', content: 'Earlier.' }
    const payload = settingsPayload({ ...config, agent: { ...settings, context: { messages: [earlier] } } }, history)

    expect(payload.agent).toEqual({ ...settings, greeting: undefined, context: { messages: [earlier, ...history] } })
    // The greeting is in the history: saying it again would greet the customer twice.
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('agent.greeting')
  })

  it("leaves an agent id as it is: there's no context to restore it into", () => {
    const history: ContextMessage[] = [{ type: 'History', role: 'assistant', content: 'Hi!' }]
    expect(settingsPayload({ ...config, agent: 'agent-uuid' }, history).agent).toBe('agent-uuid')
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
    recordSessionEnd({ status: 'error', sessionNumber: 1, endedBy: 'tokenFailed', message: CONNECTION_LOST }, log)

    expect(log.entries().at(-1)?.payload).toEqual({
      endedBy: 'tokenFailed',
      reason: 'the token server function failed',
      message: CONNECTION_LOST,
    })
  })

  it("adds the SDK error's name and message, in the reason too", () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createSessionLog()
    log.startSession()
    const sdkError = { name: 'NotAllowedError', message: 'Permission denied' }
    recordSessionEnd({ status: 'error', sessionNumber: 1, endedBy: 'sdkError', message: MIC_BLOCKED, sdkError }, log)

    const end = log.entries().at(-1)
    expect(end?.payload).toEqual({
      endedBy: 'sdkError',
      reason: 'microphone or connection error (NotAllowedError: Permission denied)',
      message: MIC_BLOCKED,
      sdkError,
    })
    expect(end && describeEntry(end).text).toBe(
      `session ended: microphone or connection error (NotAllowedError: Permission denied) (“${MIC_BLOCKED}”)`,
    )
  })

  it('has words for every end', () => {
    const log = createSessionLog()
    const all: SessionEnd[] = [
      'pressed',
      'pageHidden',
      'idle',
      'leaveRequested',
      'leaveTimedOut',
      'tokenFailed',
      'sdkError',
      'agentError',
      'disconnected',
    ]
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
    recordEnd('pageHidden', {}, log)
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
