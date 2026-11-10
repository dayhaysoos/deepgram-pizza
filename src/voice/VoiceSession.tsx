// The voice conversation, wired to React and Deepgram. The rules (what the
// button shows, and when a session ends) live in sessionStatus.ts; this file
// only turns the SDK's callbacks into its events and renders from its state.
//
// VoiceSessionProvider holds the session's state for the page's lifetime, at
// the top of MenuPage, and the handle (sessionHandle.ts) that page code reaches
// with useVoiceSession(): tap updates tell the agent through it, and checkout
// by voice leaves through it. VoiceSession renders the talk button, the
// captions and, while a session is on, a Deepgram AgentProvider, with the
// agent's tools registered inside it (ClientTools.tsx).
//
// One session per press. AgentProvider creates its AgentSession once, from the
// `config` of its first render, and ignores later changes. The agent's
// instructions have to carry the cart as it is when the customer presses the
// button, so each press mounts a new provider (a new `key`) with a config
// built at that moment, and ending the session unmounts it, which hangs up and
// stops the microphone and the speaker. Without a session there's no provider
// at all: nothing connects, and nothing asks for the microphone, until a press.
//
// The provider's conversation goes with it, so VoiceSession keeps a copy, the
// transcript (transcript.ts), for the captions. It stays after the session
// ends, until the next press starts a new one.
//
// In development, every session is also recorded in the session log that
// /dev/tools shows. Its recorder (src/dev/SessionRecorder.tsx) sits next to the
// talk button, where it sees each session start and end, and gets the live
// session's AgentSession handed up from inside its provider. Production builds
// have no recorder, so nothing is handed up.

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AgentProvider,
  useAgentConversation,
  useAgentMicrophone,
  useAgentMode,
  useAgentSession,
  useAgentState,
  type AgentSessionConfig,
  type ConversationTextMessage,
  type FunctionCallRequestMessage,
} from '@deepgram/react'
import { useShoppingCart } from 'use-shopping-cart'
import { quantitiesOf, summarizeCart } from '../agent/cartSummary'
import type { ToolHandlers } from '../agent/handlers'
import { toolDefinitions } from '../agent/tools'
import { activityLabel } from './AgentActivity'
import { agentSettings } from './agentSettings'
import { Captions } from './Captions'
import { ClientTools } from './ClientTools'
import { getDeepgramToken } from './getDeepgramToken'
import { createIdleTimer, RESTART_EVENTS, type IdleTimer } from './idleTimer'
import { createSessionHandle, type PromptTarget, type SessionHandle } from './sessionHandle'
import {
  isLive,
  NO_SESSION,
  updateSession,
  type LiveEvent,
  type SessionEvent,
  type SessionState,
} from './sessionStatus'
import { TalkButton } from './TalkButton'
import { NO_TRANSCRIPT, sessionLines, updateTranscript, type Transcript, type TranscriptLine } from './transcript'

// Dev only: the session log's recorder. `import.meta.env.DEV` is `false` in a
// production build, so Vite drops the import, and the log's code with it. If
// the recorder fails to load, voice works on without it.
const SessionRecorder = import.meta.env.DEV
  ? lazy(() =>
      import('../dev/SessionRecorder').catch((error: unknown) => {
        console.warn("The voice session log's recorder didn't load:", error)
        return { default: () => null }
      }),
    )
  : null

/** A live session's AgentSession, and the config its AgentProvider made it from. */
export type LiveAgent = { session: ReturnType<typeof useAgentSession>; config: AgentSessionConfig }

type VoiceSessionContextValue = {
  state: SessionState
  send: (event: SessionEvent) => void
  /** Hands the live session's AgentSession to the handle (see SessionHandleControls). */
  attach: (agent: PromptTarget) => () => void
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null)

const VoiceHandleContext = createContext<SessionHandle | null>(null)

/**
 * Holds the voice session for the page's lifetime. It goes at the top of
 * MenuPage, above the tool handlers and the tap updates, so code that lives as
 * long as the page can reach the live session through useVoiceSession().
 */
export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [state, send] = useReducer(updateSession, NO_SESSION)
  // One handle for the page's lifetime, so code below can keep hold of it.
  const [handle] = useState(() => createSessionHandle(send))
  // After the commit, so a leave resolves once an ended session's
  // AgentProvider has unmounted, which hangs up.
  useEffect(() => handle.update(state), [handle, state])

  return (
    <VoiceSessionContext value={{ state, send, attach: handle.attach }}>
      <VoiceHandleContext value={handle}>{children}</VoiceHandleContext>
    </VoiceSessionContext>
  )
}

/**
 * The page's handle on the voice session: `tell(text)` and
 * `leaveAfterSpeaking()`, safe to call whether or not a session is on. It's
 * the same object for the page's lifetime.
 */
export function useVoiceSession(): SessionHandle {
  const handle = useContext(VoiceHandleContext)
  if (!handle) throw new Error('useVoiceSession needs a <VoiceSessionProvider> above it.')
  return handle
}

/**
 * The talk button, the captions, and while a session is on, the live Deepgram
 * session, which answers the agent's tool calls with `handlers`: the page's
 * one set (useToolHandlers()), so voice and the dev tools panel share what it
 * remembers. MenuPage renders it outside the page wrapper an open cart makes
 * inert, so the conversation goes on while the cart is open. It lives as long
 * as the page, so the transcript and the toggle's choice do too.
 */
export function VoiceSession({ handlers }: { handlers: ToolHandlers }) {
  const voice = useContext(VoiceSessionContext)
  // The live session's AgentSession, for the session log's recorder. Only the
  // recorder sets it, so production doesn't re-render as sessions come and go.
  const [live, setLive] = useState<LiveAgent | null>(null)
  const [transcript, keepConversation] = useReducer(updateTranscript, NO_TRANSCRIPT)
  // Whether the captions show the whole conversation, until the customer toggles it again.
  const [expanded, setExpanded] = useState(false)
  if (!voice) throw new Error('VoiceSession needs a <VoiceSessionProvider> above it.')
  const { state, send, attach } = voice
  const sessionOn = isLive(state)
  const lines = sessionLines(transcript, state.sessionNumber)

  return (
    <div className="voice">
      {sessionOn && (
        <DeepgramSession
          key={state.sessionNumber}
          sessionNumber={state.sessionNumber}
          agentSpeaking={state.status === 'speaking'}
          handlers={handlers}
          send={send}
          attach={attach}
          onConversation={keepConversation}
          onLive={SessionRecorder ? setLive : undefined}
        />
      )}
      {/* While a session is on, and after it while there's a transcript. */}
      {(sessionOn || lines.length > 0) && (
        <Captions
          lines={lines}
          live={sessionOn}
          activity={activityLabel(state)}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
      {/* After the session, so it keeps its place (and its focus) as sessions come and go. */}
      <TalkButton
        status={state.status}
        message={state.status === 'error' ? state.message : undefined}
        onPress={() => send({ type: 'pressed' })}
      />
      {SessionRecorder && (
        <Suspense fallback={null}>
          <SessionRecorder state={state} live={live} />
        </Suspense>
      )}
    </div>
  )
}

type DeepgramSessionProps = {
  sessionNumber: number
  /** The talk button says Speaking: the agent's voice is playing. */
  agentSpeaking: boolean
  handlers: ToolHandlers
  send: (event: SessionEvent) => void
  attach: (agent: PromptTarget) => () => void
  /** Hears the session's conversation each time it changes, for the transcript. */
  onConversation: (conversation: Transcript) => void
  /** Hears about the session's AgentSession once its provider has made it, and `null` once it's gone. */
  onLive?: (live: LiveAgent | null) => void
}

/** One session's Deepgram connection: connects on mount, hangs up on unmount. */
function DeepgramSession({
  sessionNumber,
  agentSpeaking,
  handlers,
  send: sendToPage,
  attach,
  onConversation,
  onLive,
}: DeepgramSessionProps) {
  const send = useCallback(
    (event: LiveEvent) => sendToPage({ ...event, sessionNumber }),
    [sendToPage, sessionNumber],
  )
  const keepConversation = useCallback(
    (conversation: readonly TranscriptLine[]) => onConversation({ sessionNumber, lines: conversation }),
    [onConversation, sessionNumber],
  )
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  // Built once. This session mounts right after the press, so the agent
  // starts with the cart as it is at the press. Its functions are the tools
  // ClientTools registers below.
  const [config] = useState<AgentSessionConfig>(() => ({
    auth: { tokenFactory: () => fetchToken(send) },
    agent: agentSettings(summarizeCart(quantitiesOf(cartDetails)), toolDefinitions),
  }))

  return (
    <AgentProvider
      config={config}
      autoStart
      onSdkError={(error) => {
        console.warn('Deepgram voice SDK error:', error)
        send({ type: 'sdkError', error })
      }}
      onError={({ code, description }) => {
        console.error(`Deepgram voice agent error ${code}: ${description}`)
        send({ type: 'agentError' })
      }}
      onWarning={({ code, description }) => console.warn(`Deepgram voice agent warning ${code}: ${description}`)}
    >
      <ClientTools handlers={handlers} />
      <SessionEvents
        config={config}
        agentSpeaking={agentSpeaking}
        send={send}
        attach={attach}
        keepConversation={keepConversation}
        onLive={onLive}
      />
    </AgentProvider>
  )
}

/**
 * The provider's token factory, called before every connect and reconnect: a
 * fresh short-lived token from our server function, which keeps the API key.
 */
async function fetchToken(send: (event: LiveEvent) => void): Promise<string> {
  const result = await getDeepgramToken()
  if ('token' in result) return result.token
  send({ type: 'tokenFailed', message: result.message })
  // Stops the SDK from connecting. The session has already ended, with the message.
  throw new Error(`No voice token: ${result.message}`)
}

type SessionEventsProps = {
  config: AgentSessionConfig
  agentSpeaking: boolean
  send: (event: LiveEvent) => void
  attach: (agent: PromptTarget) => () => void
  keepConversation: (conversation: readonly TranscriptLine[]) => void
  onLive?: (live: LiveAgent | null) => void
}

/**
 * Hands the live session to the page's handle (`attach`), so tap updates
 * reach the agent, and up to VoiceSession (`onLive`, when it's given), with
 * its conversation each time it changes (`keepConversation`), and sends its
 * changes as events: the connection and the agent's mode, the settings, the
 * microphone, the customer starting and finishing a turn, the agent's lines
 * and tool requests, a disconnect, the customer leaving the page, and a minute
 * with no speech.
 */
function SessionEvents({ config, agentSpeaking, send, attach, keepConversation, onLive }: SessionEventsProps) {
  const agentSession = useAgentSession()
  const { state, stop } = useAgentState()
  const { mode } = useAgentMode()
  const { micActive } = useAgentMicrophone()
  const { conversation } = useAgentConversation()
  const idleTimer = useRef<IdleTimer | null>(null)

  useEffect(() => attach(agentSession), [agentSession, attach])

  useEffect(() => {
    if (!onLive) return
    onLive({ session: agentSession, config })
    return () => onLive(null)
  }, [agentSession, config, onLive])

  // The conversation goes when this session's provider does; the page keeps it.
  useEffect(() => keepConversation(conversation), [conversation, keepConversation])

  useEffect(() => send({ type: 'agentChanged', state, mode }), [state, mode, send])

  useEffect(() => {
    if (micActive) send({ type: 'microphoneOn' })
  }, [micActive, send])

  // Straight from the session, so they arrive in the order they happen.
  useEffect(() => {
    const onSettingsApplied = () => send({ type: 'settingsApplied' })
    const onDisconnected = () => send({ type: 'disconnected' })
    const onUserStartedSpeaking = () => send({ type: 'customerStartedSpeaking' })
    // The customer's line arrives at the end of their turn.
    const onConversationText = ({ role }: ConversationTextMessage) => {
      if (role === 'user') send({ type: 'customerFinishedSpeaking' })
      if (role === 'assistant') send({ type: 'agentLine' })
    }
    // Deepgram cancels a call it already sent when the customer starts
    // speaking again (FunctionCallCancelled), but @deepgram/agents 0.1.2
    // drops that message, so the handler still runs and Deepgram ignores its
    // answer. The activity line clears anyway: UserStartedSpeaking comes first.
    const onFunctionCallRequest = ({ functions }: FunctionCallRequestMessage) =>
      send({ type: 'toolsRequested', names: functions.map((call) => call.name) })
    agentSession.on('settings-applied', onSettingsApplied)
    agentSession.on('disconnected', onDisconnected)
    agentSession.on('user-started-speaking', onUserStartedSpeaking)
    agentSession.on('conversation-text', onConversationText)
    agentSession.on('function-call-request', onFunctionCallRequest)
    return () => {
      agentSession.off('settings-applied', onSettingsApplied)
      agentSession.off('disconnected', onDisconnected)
      agentSession.off('user-started-speaking', onUserStartedSpeaking)
      agentSession.off('conversation-text', onConversationText)
      agentSession.off('function-call-request', onFunctionCallRequest)
    }
  }, [agentSession, send])

  // Leaving the page: hang up right away, since no unmount may come.
  useEffect(() => {
    function onPageHide() {
      send({ type: 'pageHidden' })
      stop()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [send, stop])

  // A minute with no speech ends the session (idleTimer.ts).
  useEffect(() => {
    const timer = createIdleTimer(() => send({ type: 'idle' }))
    idleTimer.current = timer
    for (const event of RESTART_EVENTS) agentSession.on(event, timer.restart)
    return () => {
      timer.stop()
      for (const event of RESTART_EVENTS) agentSession.off(event, timer.restart)
    }
  }, [agentSession, send])

  // The count pauses while the agent speaks. This runs again whenever the
  // effect above makes a new timer, so the new one hears it too.
  useEffect(() => idleTimer.current?.setAgentSpeaking(agentSpeaking), [agentSpeaking, agentSession, send])

  return null
}
