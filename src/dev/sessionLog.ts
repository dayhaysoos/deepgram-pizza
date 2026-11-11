// The voice session log, for development: everything that went over the
// Deepgram connection, and what the app did around it, so a conversation can
// be read back and pasted into a bug report. Deepgram keeps no transcript of a
// session, so its observability guide says to log the socket's messages on
// the client, each with a timestamp and a sequence number, keyed by the
// Welcome message's request_id, and to skip the binary audio:
// https://developers.deepgram.com/docs/voice-agent-observability
//
// recordSession.ts fills it from a live session; the panel on /dev/tools shows
// it and copies it. This module has no React or SDK code in it. It's dev only:
// nothing outside src/dev imports it except through `import.meta.env.DEV`, so
// production builds leave it out.
//
// Each entry is one of:
// - server: a message from Deepgram, as it came (Welcome, ConversationText, …)
// - client: a message the app sent: the Settings on every connect, each prompt
//   update (a tap update telling the agent about the cart), and each tool's
//   answer (FunctionCallResponse), which Deepgram echoes back as a server
//   entry; the readable log shows the two as one line
// - app: something the app saw happen: the session started or ended, and the
//   SDK's connection events and errors
//
// The log is append-only, kept in localStorage so it survives a reload or a
// redirect, and capped at the newest MAX_ENTRIES until someone clears it; the
// readable log says how many older entries it dropped. Every tab on the site
// shares it: a tab reads in what another tab recorded (on the `storage`
// event), so it shows it and doesn't write over it.

/** What the app saw happen: an `app` entry's type. */
export type AppEntryType =
  | 'SessionStarted'
  | 'Connecting'
  | 'Connected'
  | 'Reconnecting'
  | 'Disconnected'
  | 'SdkError'
  | 'SessionEnded'

/** A message the app sends: a `client` entry's type. */
export type ClientEntryType = 'Settings' | 'UpdatePrompt' | 'FunctionCallResponse'

/** What a recorder passes in: the log adds `seq` and `ts`. */
export type NewEntry = {
  /** The session it belongs to: 1 for the first since the log was cleared. */
  session: number
  /** A Deepgram message exactly as it came or went, or what the app saw. */
  payload: unknown
  /** UserStartedSpeaking only: the agent's voice was still playing, so this cut it off. */
  interruptsAgent?: true
  /** Settings only, when a reconnect sent them again: how many earlier messages they restored. */
  restoredMessages?: number
  /**
   * UpdatePrompt only: the SDK sent it right after the settings were applied,
   * where it sends the newest prompt update on every connect, not when the app gave it.
   */
  afterSettings?: true
} & (
  | { direction: 'server'; /** Deepgram's own `type` for the message. */ type: string }
  | { direction: 'client'; type: ClientEntryType }
  | { direction: 'app'; type: AppEntryType }
)

export type LogEntry = NewEntry & {
  /** Order across the whole log, from 1 after a clear. */
  seq: number
  /** When the browser recorded it, as an ISO 8601 date. Deepgram's messages carry no time of their own. */
  ts: string
}

/** The part of localStorage the log uses. */
export type LogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type SessionLog = {
  /** Every entry, oldest first. The same array until the log changes. */
  entries: () => readonly LogEntry[]
  /** Starts a new session's section with a SessionStarted entry, and returns its number. */
  startSession: (details?: Record<string, unknown>) => number
  append: (entry: NewEntry) => LogEntry
  /** Ends the session started last with a SessionEnded entry, unless it has already ended. */
  endSession: (details: Record<string, unknown>) => LogEntry | undefined
  clear: () => void
  /** Reads the entries in again from storage, which another tab may have changed. */
  reload: () => void
  /** Calls `listener` after every change. Returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void
}

/**
 * About 20 minutes of talking: while audio comes in, Deepgram sends a
 * LatencyReport about 4 times a second. Around 1 MB stored, well under
 * localStorage's 5 MB.
 */
export const MAX_ENTRIES = 5_000

export const STORAGE_KEY = 'voice-session-log'

/** A JSON Web Token, as Deepgram's short-lived tokens are. None belongs in the log. */
const TOKEN_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g

/** An empty log. One array, so `entries()` hands out the same one until something changes. */
export const NO_ENTRIES: readonly LogEntry[] = []

type Options = {
  /** Where the log is kept, read on first use and on every reload. Leave it out to keep the log in memory. */
  storage?: () => LogStorage | null | undefined
  limit?: number
  now?: () => Date
}

export function createSessionLog({ storage: getStorage, limit = MAX_ENTRIES, now = () => new Date() }: Options = {}) {
  let storage: LogStorage | null | undefined
  let entries: readonly LogEntry[] | undefined
  /** The session started last, until it ends. Only this page's, so it isn't stored. */
  let openSession: number | undefined
  const listeners = new Set<() => void>()

  // Every access to storage is wrapped: it can be blocked, full or missing
  // (a private window, the server). Then the log lives in memory until a reload.
  function load(): readonly LogEntry[] {
    try {
      storage = getStorage?.()
      const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter(isEntry).slice(-limit) : NO_ENTRIES
    } catch {
      return NO_ENTRIES
    }
  }

  function current(): readonly LogEntry[] {
    entries ??= load()
    return entries
  }

  function notify() {
    for (const listener of listeners) listener()
  }

  function change(next: readonly LogEntry[]) {
    entries = next
    try {
      if (next.length === 0) storage?.removeItem(STORAGE_KEY)
      else storage?.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Full or blocked: the entries stay in memory.
    }
    notify()
  }

  function append(entry: NewEntry): LogEntry {
    const log = current()
    const added: LogEntry = {
      seq: (log.at(-1)?.seq ?? 0) + 1,
      ts: now().toISOString(),
      ...entry,
      payload: withoutTokens(entry.payload),
    }
    change([...log.slice(Math.max(0, log.length + 1 - limit)), added])
    return added
  }

  return {
    entries: current,
    startSession(details = {}) {
      const session = (current().at(-1)?.session ?? 0) + 1
      append({ session, direction: 'app', type: 'SessionStarted', payload: details })
      openSession = session
      return session
    },
    append,
    endSession(details) {
      if (openSession === undefined) return undefined
      const session = openSession
      openSession = undefined
      return append({ session, direction: 'app', type: 'SessionEnded', payload: details })
    },
    clear() {
      // Reading first finds the storage, so this clears it even when nothing has read the log yet.
      current()
      change(NO_ENTRIES)
    },
    reload() {
      entries = load()
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  } satisfies SessionLog
}

/** The page's log, kept in this browser's localStorage. */
export const sessionLog: SessionLog = createSessionLog({
  storage: () => (typeof window === 'undefined' ? null : window.localStorage),
})

// Another tab changed the log (or cleared all of storage, when `key` is null).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) sessionLog.reload()
  })
}

/** A stored entry from an older version of this file, or another app on localhost, may not be one. */
function isEntry(value: unknown): value is LogEntry {
  return typeof field(value, 'seq') === 'number' && typeof field(value, 'session') === 'number'
}

/** `payload` as plain JSON, with anything shaped like a token taken out. */
function withoutTokens(payload: unknown): unknown {
  const json = JSON.stringify(payload ?? {})
  return JSON.parse(json.replace(TOKEN_PATTERN, '[token removed]'))
}

/**
 * How many of the oldest entries the log dropped to stay under its limit.
 * Entries are numbered from 1 after a clear, so it's the first one's number, less one.
 */
export function droppedCount(entries: readonly LogEntry[]): number {
  return (entries[0]?.seq ?? 1) - 1
}

/** `312 older entries were dropped; …`, or '' when none were. */
export function droppedNote(entries: readonly LogEntry[]): string {
  const dropped = droppedCount(entries)
  if (dropped === 0) return ''
  const count = dropped === 1 ? '1 older entry was' : `${dropped.toLocaleString('en-US')} older entries were`
  return `${count} dropped; the log keeps the newest ${MAX_ENTRIES.toLocaleString('en-US')}.`
}

// Reading it back

/** How a line reads: the customer, the agent, everything else, or a problem. */
export type LineKind = 'you' | 'agent' | 'event' | 'problem'

export type LogLine = { seq: number; ts: string; time: string; kind: LineKind; text: string }

/** One session's lines, with the request_id from each of its Welcome messages (one per connection). */
export type LogSection = { session: number; date: string; requestIds: string[]; lines: LogLine[] }

/** A tool answer the app sent, waiting for Deepgram's echo of it. */
type SentAnswer = { id: string; name: string; content: string; line: LogLine }

/**
 * The entries as sections of readable lines, one per session, in order: a
 * line per entry, except for two kinds that would bury the conversation:
 * - A run of speech-to-text-only latency reports shares one line. With Flux,
 *   Deepgram sends one about every 240 ms while audio comes in.
 * - Deepgram echoes each tool answer the app sends as a FunctionCallResponse
 *   of its own. The echo marks our line "(confirmed by Deepgram)" instead of
 *   repeating it; one that doesn't match an answer we sent gets its own line.
 * The JSON keeps every entry.
 */
export function readableLog(entries: readonly LogEntry[]): LogSection[] {
  const sections: LogSection[] = []
  let sttRun: { line: LogLine; count: number; min: number; max: number } | undefined
  let sent: SentAnswer[] = []

  for (const entry of entries) {
    let section = sections.at(-1)
    if (section?.session !== entry.session) {
      section = { session: entry.session, date: formatDate(entry.ts), requestIds: [], lines: [] }
      sections.push(section)
      sent = []
    }
    const requestId = entry.type === 'Welcome' ? text(field(entry.payload, 'request_id')) : ''
    if (requestId) section.requestIds.push(requestId)

    const answer = entry.type === 'FunctionCallResponse' ? answerOf(entry) : undefined
    if (answer && entry.direction === 'server') {
      const echoed = sent.find((ours) => isEcho(answer, ours))
      if (echoed) {
        echoed.line.text += ' (confirmed by Deepgram)'
        sent = sent.filter((ours) => ours !== echoed)
        continue
      }
    }

    const stt = sttOnlyLatency(entry)
    if (stt !== undefined && sttRun && section.lines.at(-1) === sttRun.line) {
      sttRun.count += 1
      sttRun.min = Math.min(sttRun.min, stt)
      sttRun.max = Math.max(sttRun.max, stt)
      const range = sttRun.min === sttRun.max ? `${sttRun.min}` : `${sttRun.min}–${sttRun.max}`
      sttRun.line.text = `latency: stt ${range} ms ×${sttRun.count} until ${formatTime(entry.ts)}`
      continue
    }
    const line = { seq: entry.seq, ts: entry.ts, time: formatTime(entry.ts), ...describeEntry(entry) }
    section.lines.push(line)
    if (stt !== undefined) sttRun = { line, count: 1, min: stt, max: stt }
    if (answer && entry.direction === 'client') sent.push({ ...answer, line })
  }
  return sections
}

/** A FunctionCallResponse's id (which Deepgram may leave out), name and content. */
function answerOf({ payload }: LogEntry): Omit<SentAnswer, 'line'> {
  return { id: text(field(payload, 'id')), name: text(field(payload, 'name')), content: text(field(payload, 'content')) }
}

/** Whether Deepgram's FunctionCallResponse repeats one the app sent: the same name and content, and id when both have one. */
function isEcho(echo: Omit<SentAnswer, 'line'>, ours: SentAnswer): boolean {
  return echo.name === ours.name && echo.content === ours.content && (echo.id === '' || ours.id === '' || echo.id === ours.id)
}

/** A LatencyReport's stt_latency in milliseconds, when that's all it reports. */
function sttOnlyLatency({ type, payload }: LogEntry): number | undefined {
  const seconds = field(payload, 'stt_latency')
  if (type !== 'LatencyReport' || typeof seconds !== 'number') return undefined
  return Object.keys(payload as object).every((key) => key === 'type' || key === 'stt_latency')
    ? Math.round(seconds * 1000)
    : undefined
}

/** A section's heading: `Session 3 · 2026-11-10 · request_id …`. */
export function sectionHeading({ session, date, requestIds }: LogSection): string {
  const ids = requestIds.length > 0 ? `request_id ${requestIds.join(', ')}` : 'no request_id yet'
  return `Session ${session} · ${date} · ${ids}`
}

/**
 * The whole log as plain text: a note first when older entries were dropped,
 * then a heading per session and its lines, `13:52:17.204  you: …`.
 */
export function formatText(entries: readonly LogEntry[]): string {
  const sections = readableLog(entries).map((section) =>
    [sectionHeading(section), ...section.lines.map(({ time, text }) => `${time}  ${text}`)].join('\n'),
  )
  const note = droppedNote(entries)
  return (note ? [note, ...sections] : sections).join('\n\n')
}

/** The raw entries, for a bug report. */
export function formatJson(entries: readonly LogEntry[]): string {
  return JSON.stringify(entries, null, 2)
}

type Description = { kind: LineKind; text: string }

const event = (words: string): Description => ({ kind: 'event', text: words })
const problem = (words: string): Description => ({ kind: 'problem', text: words })

/** One entry in words. */
export function describeEntry(entry: LogEntry): Description {
  const get = (key: string) => text(field(entry.payload, key))
  switch (entry.direction) {
    case 'app':
      return describeAppEntry(entry.type, get)
    case 'client':
      return event(describeClientMessage(entry, get))
    case 'server':
      return describeServerMessage(entry, get)
  }
}

/** What the app saw, in words. */
function describeAppEntry(type: AppEntryType, get: (key: string) => string): Description {
  switch (type) {
    case 'SessionStarted':
      return event(get('page') ? `session started on ${get('page')}` : 'session started')
    case 'Connecting':
      return event('connecting')
    case 'Connected':
      return event('connected')
    case 'Reconnecting':
      return event(`reconnecting (attempt ${get('attempt')}, in ${get('delayMs')} ms)`)
    case 'Disconnected':
      return event(`disconnected: ${get('reason')}`)
    case 'SdkError':
      return problem(`SDK error: ${get('name')}: ${get('message')}`)
    case 'SessionEnded':
      return event(`session ended: ${get('reason')}${get('message') ? ` (“${get('message')}”)` : ''}`)
  }
}

/** A message from Deepgram, in words. */
function describeServerMessage({ type, payload, interruptsAgent }: LogEntry, get: (key: string) => string): Description {
  switch (type) {
    case 'Welcome':
      return event(`welcome: request_id ${get('request_id')}`)
    case 'SettingsApplied':
      return event('settings applied')
    case 'ConversationText':
      return get('role') === 'user'
        ? { kind: 'you', text: `you: ${get('content')}` }
        : { kind: 'agent', text: `agent: ${get('content')}` }
    case 'UserStartedSpeaking':
      return event(interruptsAgent ? 'you started speaking (interrupts the agent)' : 'you started speaking')
    case 'AgentThinking':
      return event(get('content') ? `agent thinking: ${get('content')}` : 'agent thinking')
    case 'AgentStartedSpeaking': {
      const latencies = describeLatencies(payload, ['total', 'ttt', 'tts'])
      return event(latencies ? `agent started speaking (${latencies})` : 'agent started speaking')
    }
    case 'AgentAudioDone':
      return event('agent audio done')
    case 'LatencyReport':
      return event(
        `latency: ${describeLatencies(payload, ['total', 'stt', 'ttt_token', 'ttt_text', 'ttt_tool', 'ttt_thinking', 'tts']) || 'none'}`,
      )
    case 'FunctionCallRequest': {
      const calls = list(field(payload, 'functions')).map(
        (call) => `${text(field(call, 'name'))}(${text(field(call, 'arguments'))})`,
      )
      return event(`function call: ${calls.join('; ')}`)
    }
    case 'FunctionCallResponse':
      return event(`function result: ${get('name')} → ${get('content')}`)
    case 'PromptUpdated':
    case 'ThinkUpdated':
    case 'SpeakUpdated':
    case 'ListenUpdated':
      return event(`${type.replace('Updated', '').toLowerCase()} updated`)
    case 'History': {
      const calls = list(field(payload, 'function_calls')).map(
        (call) => `${text(field(call, 'name'))}(${text(field(call, 'arguments'))}) → ${text(field(call, 'response'))}`,
      )
      // Deepgram sends a History for every ConversationText too; the line is already in the log.
      return event(`history: ${calls.length > 0 ? calls.join('; ') : `saved the ${get('role')} line`}`)
    }
    case 'InjectionRefused':
      return problem(`injection refused: ${get('message')}`)
    case 'Error':
      return problem(`error: ${get('description')} (${get('code')})`)
    case 'Warning':
      return problem(`warning: ${get('description')} (${get('code')})`)
    default:
      return event(`${type} ${JSON.stringify(payload)}`)
  }
}

/** A message the app sent, in words. */
function describeClientMessage(entry: LogEntry & { direction: 'client' }, get: (key: string) => string): string {
  switch (entry.type) {
    case 'Settings':
      return describeSettings(entry)
    case 'UpdatePrompt':
      return `told the agent${entry.afterSettings ? ' once the settings were applied' : ''}: ${get('prompt')}`
    case 'FunctionCallResponse':
      return `tool ${get('name')} → ${get('content')}`
  }
}

/**
 * The Settings' models and prompt length, without the prompt:
 * `settings sent: listen deepgram flux-general-en · …`, and after a reconnect,
 * how many earlier messages they restored.
 */
function describeSettings({ payload, restoredMessages }: LogEntry): string {
  const agent = field(payload, 'agent')
  const think = list(field(agent, 'think'))
  const prompt = text(field(think[0], 'prompt'))
  const functions = list(field(think[0], 'functions')).length
  const summary =
    typeof agent === 'string'
      ? `agent ${agent}`
      : [
          `listen ${describeProviders(field(agent, 'listen'))}`,
          `think ${describeProviders(think)}`,
          `speak ${describeProviders(field(agent, 'speak'))}`,
          `prompt ${prompt.length.toLocaleString('en-US')} characters`,
          ...(functions > 0 ? [`${functions} functions`] : []),
        ].join(' · ')
  if (restoredMessages === undefined) return `settings sent: ${summary}`
  const restored = `${restoredMessages} earlier ${restoredMessages === 1 ? 'message' : 'messages'} restored`
  return `settings re-sent after reconnect, ${restored}: ${summary}`
}

/** `deepgram flux-general-en`, or each of a fallback list's providers. */
function describeProviders(settings: unknown): string {
  return list(settings)
    .map((setting) => {
      const provider = field(setting, 'provider')
      const model = field(provider, 'model') ?? field(provider, 'model_id') ?? field(provider, 'voice')
      return [text(field(provider, 'type')), text(model)].filter(Boolean).join(' ')
    })
    .join(' / ')
}

/** `total 812 ms, stt 95 ms`, from the `<name>_latency` fields Deepgram sends in seconds. */
function describeLatencies(payload: unknown, names: string[]): string {
  return names
    .flatMap((name) => {
      const seconds = field(payload, `${name}_latency`)
      return typeof seconds === 'number' ? [`${name} ${Math.round(seconds * 1000)} ms`] : []
    })
    .join(', ')
}

/** `7` as `07`, or as `007` with a length of 3. */
function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** `13:52:17.204`, in the browser's time zone. */
export function formatTime(ts: string): string {
  const date = new Date(ts)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** `2026-11-10`, in the browser's time zone. */
function formatDate(ts: string): string {
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Payloads are JSON from the network or from storage, so they're read defensively.

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}
