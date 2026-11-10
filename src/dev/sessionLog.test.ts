import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { summarizeCart } from '../agent/cartSummary'
import { agentInstructions } from '../agent/instructions'
import { agentSettings } from '../voice/agentSettings'
import {
  createSessionLog,
  describeEntry,
  droppedCount,
  formatJson,
  formatText,
  readableLog,
  STORAGE_KEY,
  type AppEntryType,
  type LogEntry,
  type LogStorage,
  type NewEntry,
} from './sessionLog'

/** A clock that starts at 13:52:17.204 local time on 2026-11-10 and moves 1 ms per reading. */
function clock() {
  let ms = new Date(2026, 10, 10, 13, 52, 17, 204).getTime()
  return () => new Date(ms++)
}

/** localStorage, in memory. */
function memoryStorage(): LogStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const settings = agentSettings(summarizeCart({}))
const prompt = agentInstructions(summarizeCart({}))

/** A short session with most of what Deepgram sends, in the order it sends it. */
function recordConversation(log = createSessionLog({ now: clock() })) {
  const session = log.startSession({ page: '/dev/tools' })
  const server = (payload: { type: string } & Record<string, unknown>, extra?: { interruptsAgent: true }) =>
    log.append({ session, direction: 'server', type: payload.type, payload, ...extra })

  log.append({ session, direction: 'app', type: 'Connecting', payload: {} })
  server({ type: 'Welcome', request_id: 'req-123' })
  log.append({ session, direction: 'client', type: 'Settings', payload: { type: 'Settings', agent: settings } })
  server({ type: 'SettingsApplied' })
  server({ type: 'ConversationText', role: 'assistant', content: "Hi, welcome to Nick's Pizza!" })
  server({ type: 'AgentStartedSpeaking', total_latency: 0.8123, ttt_latency: 0.53, tts_latency: 0.21 })
  server({ type: 'AgentAudioDone' })
  server({ type: 'UserStartedSpeaking' }, { interruptsAgent: true })
  server({ type: 'ConversationText', role: 'user', content: 'I have a party of 30. What do you recommend?' })
  server({ type: 'AgentThinking', content: '' })
  server({ type: 'LatencyReport', total_latency: 0.812, stt_latency: 0.095, ttt_text_latency: 0.52, tts_latency: 0.21 })
  server({ type: 'Warning', code: 'SLOW', description: 'The LLM is slow.' })
  server({ type: 'Error', code: 'FAILED_TO_THINK', description: 'Something broke.' })
  log.append({ session, direction: 'app', type: 'SdkError', payload: { name: 'Error', message: 'socket closed: 1006' } })
  log.endSession({ endedBy: 'pressed', reason: 'talk button pressed again' })
  return log
}

describe('the session log', () => {
  it('numbers entries in order and stamps each with the time', () => {
    const log = createSessionLog({ now: clock() })
    const session = log.startSession()
    log.append({ session, direction: 'server', type: 'SettingsApplied', payload: { type: 'SettingsApplied' } })

    expect(log.entries()).toEqual([
      {
        seq: 1,
        ts: new Date(2026, 10, 10, 13, 52, 17, 204).toISOString(),
        session: 1,
        direction: 'app',
        type: 'SessionStarted',
        payload: {},
      },
      {
        seq: 2,
        ts: new Date(2026, 10, 10, 13, 52, 17, 205).toISOString(),
        session: 1,
        direction: 'server',
        type: 'SettingsApplied',
        payload: { type: 'SettingsApplied' },
      },
    ])
  })

  it('numbers each session one more than the last', () => {
    const log = createSessionLog()
    expect(log.startSession()).toBe(1)
    expect(log.startSession()).toBe(2)
  })

  it('ends the session that was started last, once', () => {
    const log = createSessionLog()
    const session = log.startSession()
    expect(log.endSession({ reason: 'page hidden' })).toMatchObject({ session, type: 'SessionEnded' })
    // A second end for the same session (the page came back from the back/forward cache) adds nothing.
    expect(log.endSession({ reason: 'talk button pressed again' })).toBeUndefined()
    expect(log.entries().filter((entry) => entry.type === 'SessionEnded')).toHaveLength(1)
  })

  it('keeps only the newest entries past its limit', () => {
    const log = createSessionLog({ limit: 3 })
    const session = log.startSession()
    for (const type of ['A', 'B', 'C']) log.append({ session, direction: 'server', type, payload: { type } })

    expect(log.entries().map((entry) => entry.type)).toEqual(['A', 'B', 'C'])
    expect(log.entries()[0]?.seq).toBe(2)
    expect(droppedCount(log.entries())).toBe(1)
  })

  it('counts the entries it dropped, across a reload, until it is cleared', () => {
    const storage = memoryStorage()
    const log = createSessionLog({ storage: () => storage, limit: 3 })
    const session = log.startSession()
    for (const type of ['A', 'B', 'C', 'D']) log.append({ session, direction: 'server', type, payload: { type } })
    expect(droppedCount(log.entries())).toBe(2)
    expect(droppedCount(createSessionLog({ storage: () => storage, limit: 3 }).entries())).toBe(2)

    log.clear()
    log.startSession()
    expect(droppedCount(log.entries())).toBe(0)
    expect(droppedCount([])).toBe(0)
  })

  it('takes out anything shaped like a token', () => {
    const log = createSessionLog()
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTk5OTk5OTl9.c2lnbmF0dXJlLXBhcnQ'
    log.append({ session: 1, direction: 'app', type: 'SdkError', payload: { message: `bad token ${token}` } })

    expect(JSON.stringify(log.entries())).not.toContain(token)
    expect(log.entries()[0]?.payload).toEqual({ message: 'bad token [token removed]' })
  })

  describe('kept in storage', () => {
    it('survives a reload, and numbering carries on', () => {
      const storage = memoryStorage()
      recordConversation(createSessionLog({ storage: () => storage, now: clock() }))
      const before = createSessionLog({ storage: () => storage }).entries()

      const reloaded = createSessionLog({ storage: () => storage })
      expect(reloaded.entries()).toEqual(before)
      expect(reloaded.startSession()).toBe(2)
      expect(reloaded.entries().at(-1)?.seq).toBe(before.length + 1)
    })

    it('starts empty when the stored log is unreadable', () => {
      const storage = memoryStorage()
      storage.setItem(STORAGE_KEY, '{not json')
      expect(createSessionLog({ storage: () => storage }).entries()).toEqual([])

      storage.setItem(STORAGE_KEY, '{"seq":1}')
      expect(createSessionLog({ storage: () => storage }).entries()).toEqual([])
    })

    it('keeps working in memory when storage is blocked or full', () => {
      const broken: LogStorage = {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new DOMException('full', 'QuotaExceededError')
        },
        removeItem: () => {
          throw new Error('blocked')
        },
      }
      const log = createSessionLog({ storage: () => broken })
      log.startSession()
      expect(log.entries()).toHaveLength(1)
      log.clear()
      expect(log.entries()).toEqual([])

      const unavailable = createSessionLog({
        storage: () => {
          throw new Error('SecurityError')
        },
      })
      expect(unavailable.startSession()).toBe(1)
    })

    it("reads in what another tab recorded, so it shows it and doesn't write over it", () => {
      const storage = memoryStorage()
      const thisTab = createSessionLog({ storage: () => storage })
      const otherTab = createSessionLog({ storage: () => storage })
      thisTab.startSession({ page: '/' })
      otherTab.entries()

      thisTab.append({ session: 1, direction: 'app', type: 'Connected', payload: {} })
      otherTab.reload()
      expect(otherTab.entries()).toEqual(thisTab.entries())

      expect(otherTab.startSession({ page: '/dev/tools' })).toBe(2)
      thisTab.reload()
      expect(thisTab.entries().map(({ seq, session, type }) => `${seq} ${session} ${type}`)).toEqual([
        '1 1 SessionStarted',
        '2 1 Connected',
        '3 2 SessionStarted',
      ])
      expect(createSessionLog({ storage: () => storage }).entries()).toEqual(thisTab.entries())
    })

    it('reads in a clear from another tab', () => {
      const storage = memoryStorage()
      const thisTab = recordConversation(createSessionLog({ storage: () => storage }))
      createSessionLog({ storage: () => storage }).clear()
      thisTab.reload()
      expect(thisTab.entries()).toEqual([])
    })

    it('clears storage too', () => {
      const storage = memoryStorage()
      const log = recordConversation(createSessionLog({ storage: () => storage }))
      log.clear()

      expect(log.entries()).toEqual([])
      expect(createSessionLog({ storage: () => storage }).entries()).toEqual([])
    })
  })

  describe('subscribe', () => {
    it('tells listeners about every change until they unsubscribe', () => {
      const log = createSessionLog()
      const listener = vi.fn()
      const unsubscribe = log.subscribe(listener)

      const session = log.startSession()
      log.append({ session, direction: 'app', type: 'Connected', payload: {} })
      log.clear()
      expect(listener).toHaveBeenCalledTimes(3)

      unsubscribe()
      log.startSession()
      expect(listener).toHaveBeenCalledTimes(3)
    })

    it('tells listeners when it reloads, with a new list of entries', () => {
      const storage = memoryStorage()
      const log = createSessionLog({ storage: () => storage })
      const before = log.entries()
      const listener = vi.fn()
      log.subscribe(listener)

      createSessionLog({ storage: () => storage }).startSession()
      log.reload()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(log.entries()).not.toBe(before)
      expect(log.entries()).toHaveLength(1)
    })

    it('hands out the same entries until something changes, as useSyncExternalStore needs', () => {
      const log = createSessionLog()
      const first = log.entries()
      expect(log.entries()).toBe(first)
      log.startSession()
      expect(log.entries()).not.toBe(first)
    })
  })
})

describe('the readable log', () => {
  const entries = recordConversation().entries()

  it('says who said what, and what happened, one line per entry with the time', () => {
    const lines = formatText(entries).split('\n')
    expect(lines).toEqual([
      'Session 1 · 2026-11-10 · request_id req-123',
      '13:52:17.204  session started on /dev/tools',
      '13:52:17.205  connecting',
      '13:52:17.206  welcome: request_id req-123',
      expect.stringMatching(/^13:52:17\.207 {2}settings sent: /),
      '13:52:17.208  settings applied',
      "13:52:17.209  agent: Hi, welcome to Nick's Pizza!",
      '13:52:17.210  agent started speaking (total 812 ms, ttt 530 ms, tts 210 ms)',
      '13:52:17.211  agent audio done',
      '13:52:17.212  you started speaking (interrupts the agent)',
      '13:52:17.213  you: I have a party of 30. What do you recommend?',
      '13:52:17.214  agent thinking',
      '13:52:17.215  latency: total 812 ms, stt 95 ms, ttt_text 520 ms, tts 210 ms',
      '13:52:17.216  warning: The LLM is slow. (SLOW)',
      '13:52:17.217  error: Something broke. (FAILED_TO_THINK)',
      '13:52:17.218  SDK error: Error: socket closed: 1006',
      '13:52:17.219  session ended: talk button pressed again',
    ])
  })

  it('sums up the settings, and leaves the prompt itself to the JSON', () => {
    const settingsLine = formatText(entries).split('\n')[4]
    expect(settingsLine).toBe(
      `13:52:17.207  settings sent: listen deepgram flux-general-en · think open_ai gpt-4.1-mini · speak deepgram flux-cole-en · prompt ${prompt.length.toLocaleString('en-US')} characters`,
    )

    const menuLine = prompt.split('\n').find((line) => line.includes('margherita'))
    expect(menuLine).toBeTruthy()
    expect(formatText(entries)).not.toContain(menuLine)
    expect(formatJson(entries)).toContain(JSON.stringify(menuLine).slice(1, -1))
  })

  it("says when the customer starts speaking without cutting the agent off", () => {
    const log = createSessionLog({ now: clock() })
    log.append({ session: 1, direction: 'server', type: 'UserStartedSpeaking', payload: { type: 'UserStartedSpeaking' } })
    expect(formatText(log.entries()).split('\n').at(-1)).toBe('13:52:17.204  you started speaking')
  })

  it('groups the lines by session, with the session’s request_id once it arrives', () => {
    const log = createSessionLog({ now: clock() })
    log.startSession()
    const second = log.startSession()
    log.append({ session: second, direction: 'server', type: 'Welcome', payload: { type: 'Welcome', request_id: 'r2' } })

    const sections = readableLog(log.entries())
    expect(sections.map(({ session, requestIds }) => ({ session, requestIds }))).toEqual([
      { session: 1, requestIds: [] },
      { session: 2, requestIds: ['r2'] },
    ])
    expect(formatText(log.entries())).toContain('Session 1 · 2026-11-10 · no request_id yet\n')
    expect(formatText(log.entries())).toContain('\n\nSession 2 · 2026-11-10 · request_id r2\n')
  })

  // With Flux, Deepgram sends a LatencyReport with only stt_latency about every 240 ms while audio comes in.
  it('folds a run of speech-to-text-only latency reports into one line; the JSON keeps each', () => {
    const log = createSessionLog({ now: clock() })
    const stt = (seconds: number) =>
      log.append({ session: 1, direction: 'server', type: 'LatencyReport', payload: { type: 'LatencyReport', stt_latency: seconds } })
    stt(0.024)
    stt(0.031)
    stt(0.02)
    log.append({ session: 1, direction: 'server', type: 'UserStartedSpeaking', payload: { type: 'UserStartedSpeaking' } })
    stt(0.024)
    stt(0.024)

    expect(formatText(log.entries()).split('\n').slice(1)).toEqual([
      '13:52:17.204  latency: stt 20–31 ms ×3 until 13:52:17.206',
      '13:52:17.207  you started speaking',
      '13:52:17.208  latency: stt 24 ms ×2 until 13:52:17.209',
    ])
    expect(JSON.parse(formatJson(log.entries()))).toHaveLength(6)
  })

  it("notes Deepgram's History without repeating the line it saves, but shows the function calls", () => {
    const log = createSessionLog({ now: clock() })
    const history = (payload: Record<string, unknown>) =>
      log.append({ session: 1, direction: 'server', type: 'History', payload: { type: 'History', ...payload } })
    history({ role: 'assistant', content: 'Hey, welcome!' })
    history({ function_calls: [{ id: 'f1', name: 'view_cart', client_side: true, arguments: '{}', response: '{"count":0}' }] })

    expect(formatText(log.entries()).split('\n').slice(1)).toEqual([
      '13:52:17.204  history: saved the assistant line',
      '13:52:17.205  history: view_cart({}) → {"count":0}',
    ])
  })

  it('shows an event it has no words for by its type and payload', () => {
    const log = createSessionLog({ now: clock() })
    log.append({ session: 1, direction: 'server', type: 'Mystery', payload: { type: 'Mystery', n: 1 } })
    expect(formatText(log.entries())).toContain('Mystery {"type":"Mystery","n":1}')
  })

  it('has words for everything the app records', () => {
    const lines: Array<[AppEntryType, Record<string, unknown>, string]> = [
      ['SessionStarted', { page: '/' }, 'session started on /'],
      ['Connecting', {}, 'connecting'],
      ['Connected', {}, 'connected'],
      ['Reconnecting', { attempt: 2, delayMs: 1012 }, 'reconnecting (attempt 2, in 1012 ms)'],
      ['Disconnected', { reason: 'socket closed: 1006' }, 'disconnected: socket closed: 1006'],
      ['SdkError', { name: 'NotAllowedError', message: 'Permission denied' }, 'SDK error: NotAllowedError: Permission denied'],
      [
        'SessionEnded',
        { endedBy: 'sdkError', reason: 'microphone or connection error', message: 'Allow the microphone.' },
        'session ended: microphone or connection error (“Allow the microphone.”)',
      ],
    ]
    for (const [type, payload, text] of lines) {
      const entry: LogEntry = { seq: 1, ts: '2026-11-10T13:52:17.204Z', session: 1, direction: 'app', type, payload }
      expect(describeEntry(entry).text).toBe(text)
    }
  })

  it('has words for every message the app sends', () => {
    const log = createSessionLog({ now: clock() })
    const client = (type: 'UpdatePrompt' | 'FunctionCallResponse', payload: Record<string, unknown>, afterSettings?: true) =>
      log.append({ session: 1, direction: 'client', type, payload: { type, ...payload }, ...(afterSettings && { afterSettings }) })
    client('FunctionCallResponse', { id: 'fc-1', name: 'add_item', content: '{"count":2,"total":"$41.98"}' })
    client('UpdatePrompt', { prompt: 'Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.' })
    client('UpdatePrompt', { prompt: 'Customer removed Fries by tapping. Cart is empty.' }, true)

    expect(formatText(log.entries()).split('\n').slice(1)).toEqual([
      '13:52:17.204  tool add_item → {"count":2,"total":"$41.98"}',
      '13:52:17.205  told the agent: Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.',
      '13:52:17.206  told the agent once the settings were applied: Customer removed Fries by tapping. Cart is empty.',
    ])
  })

  it('takes only the app entry types it has words for, so a typo fails typecheck', () => {
    expectTypeOf<{ session: 1; direction: 'app'; type: 'Connected'; payload: object }>().toExtend<NewEntry>()
    expectTypeOf<{ session: 1; direction: 'app'; type: 'Conected'; payload: object }>().not.toExtend<NewEntry>()
    expectTypeOf<{ session: 1; direction: 'client'; type: 'UpdatePrompt'; payload: object }>().toExtend<NewEntry>()
    expectTypeOf<{ session: 1; direction: 'client'; type: 'InjectUserMessage'; payload: object }>().not.toExtend<NewEntry>()
    // Deepgram's messages keep whatever type they came with.
    expectTypeOf<{ session: 1; direction: 'server'; type: 'Mystery'; payload: object }>().toExtend<NewEntry>()
  })

  it('says when the settings were sent again after a reconnect, and how many earlier messages they restored', () => {
    const log = createSessionLog({ now: clock() })
    const resent = (restoredMessages: number) =>
      log.append({
        session: 1,
        direction: 'client',
        type: 'Settings',
        payload: { type: 'Settings', agent: settings },
        restoredMessages,
      })
    resent(4)
    resent(1)
    resent(0)

    const summary = `listen deepgram flux-general-en · think open_ai gpt-4.1-mini · speak deepgram flux-cole-en · prompt ${prompt.length.toLocaleString('en-US')} characters`
    expect(formatText(log.entries()).split('\n').slice(1)).toEqual([
      `13:52:17.204  settings re-sent after reconnect, 4 earlier messages restored: ${summary}`,
      `13:52:17.205  settings re-sent after reconnect, 1 earlier message restored: ${summary}`,
      `13:52:17.206  settings re-sent after reconnect, 0 earlier messages restored: ${summary}`,
    ])
  })

  it('says first when older entries were dropped', () => {
    const log = createSessionLog({ now: clock(), limit: 3 })
    const session = log.startSession()
    for (const type of ['A', 'B', 'C']) log.append({ session, direction: 'server', type, payload: { type } })

    expect(formatText(log.entries()).split('\n').slice(0, 3)).toEqual([
      '1 older entry was dropped; the log keeps the newest 5,000.',
      '',
      'Session 1 · 2026-11-10 · no request_id yet',
    ])
    log.append({ session, direction: 'server', type: 'D', payload: { type: 'D' } })
    expect(formatText(log.entries())).toMatch(/^2 older entries were dropped; the log keeps the newest 5,000\.\n\n/)
  })

  it('is empty with no entries', () => {
    expect(formatText([])).toBe('')
    expect(readableLog([])).toEqual([])
  })
})

describe('the JSON log', () => {
  it('is the raw entries', () => {
    const entries = recordConversation().entries()
    expect(JSON.parse(formatJson(entries)) as LogEntry[]).toEqual(entries)
  })
})
