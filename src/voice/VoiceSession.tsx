// The voice conversation: the talk button, and while a session is on, a
// Deepgram AgentProvider with the captions.
//
// One session per press. AgentProvider creates its AgentSession once, from the
// `config` of its first render, and ignores later changes. The agent's
// instructions have to carry the cart as it is when the customer presses the
// button, so each press mounts a new provider (a new `key`) with a config
// built at that moment, and ending the session unmounts it, which hangs up and
// stops the microphone and the speaker. Without a session there's no provider
// at all: nothing connects, and nothing asks for the microphone, until a press.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AgentProvider,
  useAgentMode,
  useAgentSession,
  useAgentState,
  type AgentSessionConfig,
} from '@deepgram/react'
import { useShoppingCart } from 'use-shopping-cart'
import { quantitiesOf, summarizeCart } from '../agent/cartSummary'
import { agentSettings } from './agentSettings'
import { Captions } from './Captions'
import { VOICE_UNAVAILABLE } from './deepgramToken'
import { getDeepgramToken } from './getDeepgramToken'
import { createIdleTimer, SPEECH_EVENTS } from './idleTimer'
import { TalkButton } from './TalkButton'
import { CONNECTION_LOST, explainError, talkStatus, VoiceTokenError, type LiveStatus } from './talkStatus'

type Session =
  | { status: 'idle' }
  | { status: 'live'; id: number; config: AgentSessionConfig }
  /** The last session failed. The button shows why until the next press. */
  | { status: 'error'; message: string }

/** Ends session `id`, with a message to show if it failed. */
type EndSession = (id: number, message?: string) => void

type VoiceSessionProps = {
  /**
   * Rendered inside the live session's provider, so it mounts and unmounts
   * with each session: the place for tool registrations (`useAgentClientTool`)
   * and anything else that talks to the agent.
   */
  children?: ReactNode
}

export function VoiceSession({ children }: VoiceSessionProps) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  const [session, setSession] = useState<Session>({ status: 'idle' })
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const lastId = useRef(0)

  // Only the first end of a session counts: a later one, for a session that
  // has already ended or been replaced, changes nothing.
  const end = useCallback<EndSession>((id, message) => {
    setSession((current) => {
      if (current.status !== 'live' || current.id !== id) return current
      return message ? { status: 'error', message } : { status: 'idle' }
    })
  }, [])

  function press() {
    if (session.status === 'live') return end(session.id)
    lastId.current += 1
    setLiveStatus('connecting')
    setSession({
      status: 'live',
      id: lastId.current,
      config: {
        auth: { tokenFactory: fetchToken },
        // The cart as it is now, at the press.
        agent: agentSettings(summarizeCart(quantitiesOf(cartDetails))),
      },
    })
  }

  return (
    <div className="voice">
      {session.status === 'live' && (
        <LiveSession key={session.id} id={session.id} config={session.config} onStatus={setLiveStatus} onEnd={end}>
          <Captions />
          {children}
        </LiveSession>
      )}
      {/* After the session, so it keeps its place (and its focus) as sessions come and go. */}
      <TalkButton
        status={session.status === 'live' ? liveStatus : session.status}
        message={session.status === 'error' ? session.message : undefined}
        onPress={press}
      />
    </div>
  )
}

/**
 * The provider's token factory, called before every connect and reconnect: a
 * fresh short-lived token from our server function, which keeps the API key.
 */
async function fetchToken(): Promise<string> {
  const result = await getDeepgramToken()
  if ('message' in result) throw new VoiceTokenError(result.message)
  return result.token
}

type LiveSessionProps = {
  id: number
  config: AgentSessionConfig
  onStatus: (status: LiveStatus) => void
  onEnd: EndSession
  children: ReactNode
}

/** One session: connects on mount, hangs up on unmount. */
function LiveSession({ id, config, onStatus, onEnd, children }: LiveSessionProps) {
  const endSession = useCallback((message?: string) => onEnd(id, message), [onEnd, id])
  // Whether the agent has had its settings applied. Until then, any SDK error
  // ends the session: retrying a refused token or a broken connection would
  // only repeat it. Afterwards, the SDK reconnects a dropped socket by itself.
  const ready = useRef(false)
  const markReady = useCallback(() => {
    ready.current = true
  }, [])

  function onSdkError(error: Error) {
    const message = explainError(error)
    if (message) {
      endSession(message)
    } else if (ready.current) {
      console.warn('Voice connection problem, reconnecting:', error)
    } else {
      console.error('Voice session failed to start:', error)
      endSession(VOICE_UNAVAILABLE)
    }
  }

  return (
    <AgentProvider
      config={config}
      autoStart
      onSdkError={onSdkError}
      // Deepgram's docs: treat every Error as the end of the session.
      onError={({ code, description }) => {
        console.error(`Deepgram voice agent error ${code}: ${description}`)
        endSession(VOICE_UNAVAILABLE)
      }}
      onWarning={({ code, description }) => console.warn(`Deepgram voice agent warning ${code}: ${description}`)}
    >
      <SessionWatcher onReady={markReady} onStatus={onStatus} onEnd={endSession} />
      {children}
    </AgentProvider>
  )
}

type SessionWatcherProps = {
  onReady: () => void
  onStatus: (status: LiveStatus) => void
  onEnd: (message?: string) => void
}

/**
 * Reports the live session's status to the button, and ends the session when
 * the connection is lost for good, nobody speaks for a minute, or the
 * customer leaves the page.
 */
function SessionWatcher({ onReady, onStatus, onEnd }: SessionWatcherProps) {
  const session = useAgentSession()
  const { state, stop } = useAgentState()
  const { mode } = useAgentMode()

  const status = talkStatus(state, mode)
  useEffect(() => onStatus(status), [status, onStatus])

  useEffect(() => {
    session.on('settings-applied', onReady)
    return () => void session.off('settings-applied', onReady)
  }, [session, onReady])

  // 'disconnected' means the SDK gave up reconnecting. This runs after a
  // render, so a microphone or token error, which the provider reports just
  // after it disconnects, has already ended the session with its own message.
  useEffect(() => {
    if (state === 'disconnected') onEnd(CONNECTION_LOST)
  }, [state, onEnd])

  // Leaving the page: hang up right away, since no unmount may come.
  useEffect(() => {
    function onPageHide() {
      onEnd()
      stop()
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [onEnd, stop])

  // A minute with no speech from either side ends the session (idleTimer.ts).
  useEffect(() => {
    const timer = createIdleTimer(() => onEnd())
    const listeners = SPEECH_EVENTS.map((event) => {
      const listener = () => timer.heard(event)
      session.on(event, listener)
      return () => void session.off(event, listener)
    })
    return () => {
      timer.stop()
      for (const removeListener of listeners) removeListener()
    }
  }, [session, onEnd])

  return null
}
