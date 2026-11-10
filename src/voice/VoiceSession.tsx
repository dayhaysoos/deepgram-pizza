// The voice conversation, wired to React and Deepgram. The rules (what the
// button shows, and when a session ends) live in sessionStatus.ts; this file
// only turns the SDK's callbacks into its events and renders from its state.
//
// VoiceSessionProvider holds the session's state for the page's lifetime, at
// the top of MenuPage. VoiceSession renders the talk button and, while a
// session is on, a Deepgram AgentProvider with the captions.
//
// One session per press. AgentProvider creates its AgentSession once, from the
// `config` of its first render, and ignores later changes. The agent's
// instructions have to carry the cart as it is when the customer presses the
// button, so each press mounts a new provider (a new `key`) with a config
// built at that moment, and ending the session unmounts it, which hangs up and
// stops the microphone and the speaker. Without a session there's no provider
// at all: nothing connects, and nothing asks for the microphone, until a press.
//
// In development, every session is also recorded in the session log that
// /dev/tools shows. Its recorder (src/dev/SessionRecorder.tsx) sits next to the
// talk button, where it sees each session start and end, and gets the live
// session's AgentSession handed up from inside its provider.

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from 'react'
import {
  AgentProvider,
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
import { activityLabel } from './AgentActivity'
import { agentSettings } from './agentSettings'
import { Captions } from './Captions'
import { getDeepgramToken } from './getDeepgramToken'
import { createIdleTimer, RESET_EVENTS, SPEECH_EVENTS } from './idleTimer'
import {
  isLive,
  NO_SESSION,
  updateSession,
  type LiveEvent,
  type SessionEvent,
  type SessionState,
} from './sessionStatus'
import { TalkButton } from './TalkButton'

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

type VoiceSessionContextValue = { state: SessionState; send: (event: SessionEvent) => void }

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null)

/**
 * Holds the voice session for the page's lifetime. It goes at the top of
 * MenuPage, above the tool handlers and the tap updates, so code that lives as
 * long as the page can reach the live session.
 */
export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [state, send] = useReducer(updateSession, NO_SESSION)
  // Step 5 adds what the page needs from a live session here, safe to call
  // when none is on: `tell(text)` for tap updates, and `leaveAfterSpeaking()`
  // for checkout.
  return <VoiceSessionContext value={{ state, send }}>{children}</VoiceSessionContext>
}

/**
 * The talk button, and while a session is on, the live Deepgram session with
 * its captions. MenuPage renders it outside the page wrapper an open cart
 * makes inert, so the conversation goes on while the cart is open.
 */
export function VoiceSession() {
  const voice = useContext(VoiceSessionContext)
  // The live session's AgentSession, for code outside its provider: the session log, in development.
  const [live, setLive] = useState<LiveAgent | null>(null)
  if (!voice) throw new Error('VoiceSession needs a <VoiceSessionProvider> above it.')
  const { state, send } = voice

  return (
    <div className="voice">
      {isLive(state) && (
        <DeepgramSession
          key={state.sessionNumber}
          sessionNumber={state.sessionNumber}
          activity={activityLabel(state)}
          send={send}
          onLive={setLive}
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
  /** What the captions say the agent is doing, if anything (activityLabel). */
  activity?: string
  send: (event: SessionEvent) => void
  /** Hears about the session's AgentSession once its provider has made it, and `null` once it's gone. */
  onLive: (live: LiveAgent | null) => void
}

/** One session's Deepgram connection: connects on mount, hangs up on unmount. */
function DeepgramSession({ sessionNumber, activity, send: sendToPage, onLive }: DeepgramSessionProps) {
  const send = useCallback(
    (event: LiveEvent) => sendToPage({ ...event, sessionNumber }),
    [sendToPage, sessionNumber],
  )
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  // Built once. This session mounts right after the press, so the agent
  // starts with the cart as it is at the press.
  const [config] = useState<AgentSessionConfig>(() => ({
    auth: { tokenFactory: () => fetchToken(send) },
    agent: agentSettings(summarizeCart(quantitiesOf(cartDetails))),
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
      <SessionEvents config={config} send={send} onLive={onLive} />
      <Captions activity={activity} />
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
  send: (event: LiveEvent) => void
  onLive: (live: LiveAgent | null) => void
}

/**
 * Hands the live session up to VoiceSession (`onLive`), and sends its changes
 * as events: the connection and the agent's mode, the settings, the
 * microphone, the customer starting and finishing a turn, the agent's lines
 * and tool requests, a disconnect, the customer leaving the page, and a
 * minute with no speech.
 */
function SessionEvents({ config, send, onLive }: SessionEventsProps) {
  const agentSession = useAgentSession()
  const { state, stop } = useAgentState()
  const { mode } = useAgentMode()
  const { micActive } = useAgentMicrophone()

  useEffect(() => {
    onLive({ session: agentSession, config })
    return () => onLive(null)
  }, [agentSession, config, onLive])

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

  useEffect(() => {
    const timer = createIdleTimer(() => send({ type: 'idle' }))
    const listeners = [
      ...SPEECH_EVENTS.map((event) => [event, () => timer.heard(event)] as const),
      ...RESET_EVENTS.map((event) => [event, timer.reset] as const),
    ]
    for (const [event, listener] of listeners) agentSession.on(event, listener)
    return () => {
      timer.stop()
      for (const [event, listener] of listeners) agentSession.off(event, listener)
    }
  }, [agentSession, send])

  return null
}
