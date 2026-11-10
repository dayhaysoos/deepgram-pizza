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

import { createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode } from 'react'
import {
  AgentProvider,
  useAgentMicrophone,
  useAgentMode,
  useAgentSession,
  useAgentState,
  type AgentSessionConfig,
} from '@deepgram/react'
import { useShoppingCart } from 'use-shopping-cart'
import { quantitiesOf, summarizeCart } from '../agent/cartSummary'
import { agentSettings } from './agentSettings'
import { Captions } from './Captions'
import { getDeepgramToken } from './getDeepgramToken'
import { createIdleTimer, SPEECH_EVENTS } from './idleTimer'
import {
  isLive,
  NO_SESSION,
  updateSession,
  type LiveEvent,
  type SessionEvent,
  type SessionState,
} from './sessionStatus'
import { TalkButton } from './TalkButton'

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
  if (!voice) throw new Error('VoiceSession needs a <VoiceSessionProvider> above it.')
  const { state, send } = voice

  return (
    <div className="voice">
      {isLive(state) && <LiveSession key={state.session} session={state.session} send={send} />}
      {/* After the session, so it keeps its place (and its focus) as sessions come and go. */}
      <TalkButton
        status={state.status}
        message={state.status === 'error' ? state.message : undefined}
        onPress={() => send({ type: 'pressed' })}
      />
    </div>
  )
}

type LiveSessionProps = {
  session: number
  send: (event: SessionEvent) => void
}

/** One session: connects on mount, hangs up on unmount. */
function LiveSession({ session, send: sendToPage }: LiveSessionProps) {
  const send = useCallback((event: LiveEvent) => sendToPage({ ...event, session }), [sendToPage, session])
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
      <SessionEvents send={send} />
      <Captions />
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

/**
 * Sends the live session's changes as events: the connection and the agent's
 * mode, the settings, the microphone, a disconnect, the customer leaving the
 * page, and a minute with no speech.
 */
function SessionEvents({ send }: { send: (event: LiveEvent) => void }) {
  const agentSession = useAgentSession()
  const { state, stop } = useAgentState()
  const { mode } = useAgentMode()
  const { micActive } = useAgentMicrophone()

  useEffect(() => send({ type: 'agentChanged', state, mode }), [state, mode, send])

  useEffect(() => {
    if (micActive) send({ type: 'microphoneOn' })
  }, [micActive, send])

  // Straight from the session, so they arrive in the order they happen.
  useEffect(() => {
    const onSettingsApplied = () => send({ type: 'settingsApplied' })
    const onDisconnected = () => send({ type: 'disconnected' })
    agentSession.on('settings-applied', onSettingsApplied)
    agentSession.on('disconnected', onDisconnected)
    return () => {
      agentSession.off('settings-applied', onSettingsApplied)
      agentSession.off('disconnected', onDisconnected)
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
    const listeners = SPEECH_EVENTS.map((event) => {
      const listener = () => timer.heard(event)
      agentSession.on(event, listener)
      return () => void agentSession.off(event, listener)
    })
    return () => {
      timer.stop()
      for (const removeListener of listeners) removeListener()
    }
  }, [agentSession, send])

  return null
}
