import { describe, expect, it } from 'vitest'
import { VOICE_NOT_SET_UP, VOICE_UNAVAILABLE } from './deepgramToken'
import {
  CONNECTION_LOST,
  MIC_BLOCKED,
  MIC_UNAVAILABLE,
  NO_SESSION,
  updateSession,
  type LiveEvent,
  type SessionEvent,
  type SessionState,
} from './sessionStatus'

const press: SessionEvent = { type: 'pressed' }

/** The state after these events, from the page's first render. */
function after(...events: SessionEvent[]): SessionState {
  return events.reduce(updateSession, NO_SESSION)
}

/** The state after a press, then these events from the session it started. */
function live(...events: LiveEvent[]): SessionState {
  return after(press, ...events.map((event) => ({ ...event, sessionNumber: 1 })))
}

/** Session 1's event, for passing to updateSession by hand. */
function fromSession1(event: LiveEvent): SessionEvent {
  return { ...event, sessionNumber: 1 }
}

const settingsApplied: LiveEvent = { type: 'settingsApplied' }
const microphoneOn: LiveEvent = { type: 'microphoneOn' }
const listening: LiveEvent = { type: 'agentChanged', state: 'connected', mode: 'listening' }
const speaking: LiveEvent = { type: 'agentChanged', state: 'connected', mode: 'speaking' }
const customerStartedSpeaking: LiveEvent = { type: 'customerStartedSpeaking' }
const customerFinishedSpeaking: LiveEvent = { type: 'customerFinishedSpeaking' }
const disconnected: LiveEvent = { type: 'disconnected' }
/** The customer was asked for the microphone, and said no. */
const micBlocked: LiveEvent = { type: 'sdkError', error: new DOMException('Permission denied', 'NotAllowedError') }
const openTimeout: LiveEvent = { type: 'sdkError', error: new Error('open timeout after 10000ms') }

/** A session the customer can talk to: settings applied, microphone on, listening. */
const started = [settingsApplied, microphoneOn, listening]

describe('updateSession', () => {
  describe('a press', () => {
    it('starts a session, connecting', () => {
      expect(after(press)).toMatchObject({ status: 'connecting', sessionNumber: 1 })
    })

    it('ends the session while it connects', () => {
      expect(after(press, press)).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'pressed' })
    })

    it('ends the session once it is on', () => {
      const on = live(...started)
      expect(updateSession(on, press)).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'pressed' })
    })

    it('starts again from an error, without the message', () => {
      const failed = live({ type: 'tokenFailed', message: VOICE_UNAVAILABLE })
      expect(updateSession(failed, press)).toEqual({
        status: 'connecting',
        sessionNumber: 2,
        settingsApplied: false,
        microphoneOn: false,
      })
    })
  })

  describe("the button's status", () => {
    it('shows connecting until the agent has its settings', () => {
      expect(live({ type: 'agentChanged', state: 'idle', mode: 'idle' }).status).toBe('connecting')
      expect(live({ type: 'agentChanged', state: 'connecting', mode: 'idle' }).status).toBe('connecting')
      // Connected, but the settings aren't applied yet.
      expect(live({ type: 'agentChanged', state: 'connected', mode: 'idle' }).status).toBe('connecting')
    })

    it("shows the agent's mode once it's connected", () => {
      for (const mode of ['listening', 'thinking', 'speaking'] as const) {
        expect(live({ type: 'agentChanged', state: 'connected', mode }).status).toBe(mode)
      }
    })

    it('shows connecting again while the SDK reconnects', () => {
      expect(live(...started, { type: 'agentChanged', state: 'reconnecting', mode: 'listening' }).status).toBe(
        'connecting',
      )
    })
  })

  // A dropped connection: the SDK says `reconnecting` while it waits to try
  // again and `connecting` while it tries, so the session remembers that this
  // connecting is a reconnect, and the button can say so.
  describe('reconnecting after a dropped connection', () => {
    const waiting: LiveEvent = { type: 'agentChanged', state: 'reconnecting', mode: 'listening' }
    const trying: LiveEvent = { type: 'agentChanged', state: 'connecting', mode: 'listening' }

    it("doesn't call a first connect a reconnect", () => {
      expect(live()).not.toHaveProperty('reconnecting')
      expect(live({ type: 'agentChanged', state: 'connecting', mode: 'idle' })).not.toHaveProperty('reconnecting')
      expect(live({ type: 'agentChanged', state: 'connected', mode: 'idle' })).not.toHaveProperty('reconnecting')
    })

    it('is reconnecting from the drop, through every try', () => {
      expect(live(...started, waiting)).toMatchObject({ status: 'connecting', reconnecting: true })
      expect(live(...started, waiting, trying)).toMatchObject({ status: 'connecting', reconnecting: true })
      expect(live(...started, waiting, trying, waiting, trying)).toMatchObject({
        status: 'connecting',
        reconnecting: true,
      })
    })

    it('is over once the agent is back', () => {
      const back = live(...started, waiting, trying, listening)
      expect(back.status).toBe('listening')
      expect(back).not.toMatchObject({ reconnecting: true })
    })

    it('changes nothing when the SDK repeats itself', () => {
      const reconnecting = live(...started, waiting)
      expect(updateSession(reconnecting, fromSession1(waiting))).toBe(reconnecting)
    })

    it('ends with the connection lost when the SDK gives up', () => {
      expect(live(...started, waiting, trying, waiting, disconnected)).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: CONNECTION_LOST,
        endedBy: 'disconnected',
      })
    })

    // A drop while the browser is still asking for the microphone, or before
    // the settings: the SDK gave up all the same, and no error follows.
    it('ends with the connection lost when the SDK gives up before the session has started', () => {
      expect(live(settingsApplied, listening, waiting, trying, disconnected)).toMatchObject({
        status: 'error',
        message: CONNECTION_LOST,
        endedBy: 'disconnected',
      })
      expect(live(waiting, trying, disconnected)).toMatchObject({ status: 'error', message: CONNECTION_LOST })
    })

    // A try that hangs (its token request never answers) sends no events.
    it('says the connection was lost when a minute goes by mid-reconnect', () => {
      expect(live(...started, waiting, trying, { type: 'idle' })).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: CONNECTION_LOST,
        endedBy: 'connectTimedOut',
      })
    })
  })

  // The SDK's mode shows thinking only on Deepgram's AgentThinking, which no
  // session of ours has received, so it goes straight from listening to
  // speaking. The customer's line, which arrives at the end of their turn,
  // shows thinking in between.
  describe('thinking after the customer speaks', () => {
    it("shows thinking once the customer's line arrives", () => {
      expect(live(...started, customerFinishedSpeaking).status).toBe('thinking')
    })

    it('shows speaking once the agent starts speaking', () => {
      expect(live(...started, customerFinishedSpeaking, speaking).status).toBe('speaking')
    })

    it("stays speaking when the customer's line arrives after the agent started speaking", () => {
      const talking = live(...started, speaking)
      expect(updateSession(talking, fromSession1(customerFinishedSpeaking))).toBe(talking)
    })

    it('shows listening when the customer starts speaking again', () => {
      expect(live(...started, customerFinishedSpeaking, customerStartedSpeaking).status).toBe('listening')
    })

    it('stays connecting until the agent has its settings', () => {
      const connecting = live()
      expect(updateSession(connecting, fromSession1(customerFinishedSpeaking))).toBe(connecting)
      expect(updateSession(connecting, fromSession1(customerStartedSpeaking))).toBe(connecting)
    })

    it("keeps the SDK's own thinking", () => {
      const thinking: LiveEvent = { type: 'agentChanged', state: 'connected', mode: 'thinking' }
      expect(live(...started, thinking).status).toBe('thinking')
      expect(live(...started, thinking, customerFinishedSpeaking).status).toBe('thinking')
    })

    it('ignores a line from a session that was replaced', () => {
      const second = after(press, press, press, ...started.map((event) => ({ ...event, sessionNumber: 2 })))
      expect(second).toMatchObject({ status: 'listening', sessionNumber: 2 })
      expect(updateSession(second, fromSession1(customerFinishedSpeaking))).toBe(second)
    })
  })

  // The captions show what a requested tool is doing (AgentActivity.tsx) from
  // the agent's FunctionCallRequest until its answer comes. The SDK sends no
  // event when the browser answers, so what comes next ends it.
  describe("the agent's tool calls", () => {
    const findMenuItems: LiveEvent = { type: 'toolsRequested', names: ['find_menu_items'] }
    const agentLine: LiveEvent = { type: 'agentLine' }
    const asked = [...started, customerFinishedSpeaking, findMenuItems]

    it('keeps the names of the tools the agent asked for', () => {
      expect(live(...asked)).toMatchObject({ status: 'thinking', toolCalls: ['find_menu_items'] })
    })

    it('keeps every name of a request with several, in order', () => {
      const several: LiveEvent = { type: 'toolsRequested', names: ['view_cart', 'add_item'] }
      expect(live(...started, several)).toMatchObject({ toolCalls: ['view_cart', 'add_item'] })
    })

    it('takes the newest request over the one before', () => {
      const showSuggestions: LiveEvent = { type: 'toolsRequested', names: ['show_suggestions'] }
      expect(live(...asked, showSuggestions)).toMatchObject({ toolCalls: ['show_suggestions'] })
    })

    it('ignores a request without names', () => {
      const thinking = live(...started, customerFinishedSpeaking)
      expect(updateSession(thinking, fromSession1({ type: 'toolsRequested', names: [] }))).toBe(thinking)
    })

    it('ends when the agent starts speaking', () => {
      expect(live(...asked, speaking)).toMatchObject({ status: 'speaking', toolCalls: undefined })
    })

    it('ends when a line from the agent arrives', () => {
      expect(live(...asked, agentLine)).toMatchObject({ status: 'thinking', toolCalls: undefined })
    })

    it('ends when the customer starts speaking', () => {
      expect(live(...asked, customerStartedSpeaking)).toMatchObject({ status: 'listening', toolCalls: undefined })
    })

    it('ends when the connection drops', () => {
      const reconnecting: LiveEvent = { type: 'agentChanged', state: 'reconnecting', mode: 'listening' }
      expect(live(...asked, reconnecting)).toMatchObject({ status: 'connecting', toolCalls: undefined })
    })

    it('ends with the session', () => {
      expect(live(...asked, { type: 'idle' })).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'idle' })
      const next = updateSession(live(...asked), press)
      expect(updateSession(next, press)).toEqual({
        status: 'connecting',
        sessionNumber: 2,
        settingsApplied: false,
        microphoneOn: false,
      })
    })

    it("stays while the agent's words before the call end", () => {
      // The agent may say something ("Let me look.") before it asks for a tool.
      // Once its audio is done, the SDK's mode goes back to listening.
      expect(live(...started, speaking, findMenuItems, listening)).toMatchObject({
        status: 'listening',
        toolCalls: ['find_menu_items'],
      })
    })

    it('ignores a request from a session that was replaced', () => {
      const second = after(press, press, press, ...started.map((event) => ({ ...event, sessionNumber: 2 })))
      expect(updateSession(second, fromSession1(findMenuItems))).toBe(second)
    })

    it("keeps the same state when there's no tool call to end", () => {
      const on = live(...started)
      expect(updateSession(on, fromSession1(agentLine))).toBe(on)
    })
  })

  describe('leaving once the agent has spoken', () => {
    const leave: LiveEvent = { type: 'leaveRequested' }
    const timedOut: LiveEvent = { type: 'leaveTimedOut' }
    const left: SessionState = { status: 'idle', sessionNumber: 1, endedBy: 'leaveRequested' }
    // The checkout tool asks to leave while the agent waits for its result, before it says "Taking you to checkout".
    const asked = [...started, customerFinishedSpeaking, { type: 'toolsRequested', names: ['checkout'] } as LiveEvent]

    it('stays on while the agent works out its reply', () => {
      expect(live(...asked, leave)).toMatchObject({ status: 'thinking', leaving: true })
    })

    it('ends once the reply after the request has finished playing', () => {
      expect(live(...asked, leave, speaking)).toMatchObject({ status: 'speaking', leaving: true })
      expect(live(...asked, leave, speaking, listening)).toEqual(left)
    })

    it('ends once the speech already playing has finished, when the agent was speaking', () => {
      expect(live(...started, speaking, leave, listening)).toEqual(left)
    })

    it('ends when the customer cuts the reply off', () => {
      expect(live(...asked, leave, speaking, customerStartedSpeaking)).toEqual(left)
    })

    it('waits for a reply when the customer speaks before the agent does', () => {
      expect(live(...asked, leave, customerStartedSpeaking)).toMatchObject({ status: 'listening', leaving: true })
    })

    it('ends when the wait runs out, whatever the agent is doing', () => {
      expect(live(...asked, leave, timedOut)).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'leaveTimedOut' })
      expect(live(...asked, leave, speaking, timedOut)).toMatchObject({ status: 'idle', endedBy: 'leaveTimedOut' })
    })

    it("doesn't end a session that wasn't asked to leave", () => {
      const on = live(...started, speaking)
      expect(updateSession(on, fromSession1(listening))).toMatchObject({ status: 'listening' })
      expect(updateSession(on, fromSession1(timedOut))).toBe(on)
    })

    it('keeps the same state when asked twice', () => {
      const leaving = live(...asked, leave)
      expect(updateSession(leaving, fromSession1(leave))).toBe(leaving)
    })

    it('changes nothing without a session, or for a session that was replaced', () => {
      expect(updateSession(NO_SESSION, { type: 'leaveRequested', sessionNumber: 0 })).toBe(NO_SESSION)
      const second = after(press, press, press, ...started.map((event) => ({ ...event, sessionNumber: 2 })))
      expect(updateSession(second, fromSession1(leave))).toBe(second)
      expect(updateSession(second, fromSession1(timedOut))).toBe(second)
    })

    it('starts the next session without the request', () => {
      const next = updateSession(live(...asked, leave, speaking, listening), press)
      expect(next).not.toHaveProperty('leaving')
    })
  })

  describe('ending a session', () => {
    it('ends without a message when the customer leaves the page', () => {
      expect(live(...started, { type: 'pageHidden' })).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'pageHidden' })
    })

    it('ends without a message after a minute with no speech', () => {
      expect(live(...started, { type: 'idle' })).toEqual({ status: 'idle', sessionNumber: 1, endedBy: 'idle' })
    })

    // The timer counts silence, but a session still connecting after a minute
    // never got as far as a conversation: it says so instead of ending quietly.
    it('says voice is unavailable when a minute goes by still connecting', () => {
      expect(live({ type: 'idle' })).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: VOICE_UNAVAILABLE,
        endedBy: 'connectTimedOut',
      })
    })

    it("shows the token server function's message as it is", () => {
      expect(live({ type: 'tokenFailed', message: VOICE_NOT_SET_UP })).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: VOICE_NOT_SET_UP,
        endedBy: 'tokenFailed',
      })
    })

    it('asks for the microphone when it was blocked', () => {
      expect(live(micBlocked)).toMatchObject({ status: 'error', message: MIC_BLOCKED, endedBy: 'sdkError' })
      const insecure = new DOMException('Insecure context', 'SecurityError')
      expect(live({ type: 'sdkError', error: insecure })).toMatchObject({ status: 'error', message: MIC_BLOCKED })
    })

    it("keeps the SDK error's name and message, for the session log", () => {
      expect(live(micBlocked)).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: MIC_BLOCKED,
        endedBy: 'sdkError',
        sdkError: { name: 'NotAllowedError', message: 'Permission denied' },
      })
      expect(live({ type: 'sdkError', error: 'socket closed' })).toMatchObject({
        sdkError: { name: 'Error', message: 'socket closed' },
      })
      // Only an SDK error has one.
      expect(live({ type: 'agentError' })).not.toHaveProperty('sdkError')
    })

    it("says when there's no microphone it can use", () => {
      for (const name of ['NotFoundError', 'NotReadableError', 'OverconstrainedError']) {
        const error = new DOMException('No microphone', name)
        expect(live({ type: 'sdkError', error })).toMatchObject({ status: 'error', message: MIC_UNAVAILABLE })
      }
    })

    it('ends on an Error message from Deepgram, before or after the start', () => {
      const agentError: LiveEvent = { type: 'agentError' }
      expect(live(agentError)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE, endedBy: 'agentError' })
      expect(live(...started, agentError)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE })
    })

    it('ends on any other SDK error before the agent has its settings', () => {
      expect(live(openTimeout)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE, endedBy: 'sdkError' })
      expect(live({ type: 'sdkError', error: 'socket closed' })).toMatchObject({
        status: 'error',
        message: VOICE_UNAVAILABLE,
      })
    })

    it('lets the SDK reconnect after other SDK errors once the session has started', () => {
      const on = live(...started)
      expect(updateSession(on, fromSession1(openTimeout))).toBe(on)
    })

    // The settings usually arrive while the browser is still asking for the
    // microphone. If it then fails in a way with no message of its own,
    // AgentProvider has already hung up, and nothing will reconnect.
    it('ends on any SDK error until the microphone is on, even with the settings applied', () => {
      const aborted: LiveEvent = { type: 'sdkError', error: new DOMException('Aborted', 'AbortError') }
      expect(live(settingsApplied, listening, disconnected, aborted)).toMatchObject({
        status: 'error',
        message: VOICE_UNAVAILABLE,
        endedBy: 'sdkError',
        sdkError: { name: 'AbortError', message: 'Aborted' },
      })
    })

    it('still ends on a microphone error once the session has started', () => {
      const unplugged: LiveEvent = { type: 'sdkError', error: new DOMException('Device in use', 'NotReadableError') }
      expect(live(...started, unplugged)).toMatchObject({ status: 'error', message: MIC_UNAVAILABLE })
    })

    it('says the connection was lost when the SDK gives up, once the session has started', () => {
      expect(live(...started, disconnected)).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: CONNECTION_LOST,
        endedBy: 'disconnected',
      })
      // The microphone can come on before the settings arrive.
      expect(live(microphoneOn, settingsApplied, disconnected)).toMatchObject({ message: CONNECTION_LOST })
    })
  })

  // A start fails after the connection opens when the microphone can't start.
  // AgentProvider then hangs up first (`disconnected`) and reports why a
  // microtask later (`sdkError`), so the disconnect mustn't decide the message.
  describe('a disconnect before the session has started', () => {
    it('waits for the error that follows, before the agent has its settings', () => {
      const hungUp = live(disconnected)
      expect(hungUp.status).toBe('connecting')
      expect(updateSession(hungUp, fromSession1(micBlocked))).toMatchObject({
        status: 'error',
        message: MIC_BLOCKED,
        endedBy: 'sdkError',
      })
    })

    it('keeps the error when the disconnect comes after it', () => {
      expect(live(micBlocked, disconnected)).toMatchObject({ status: 'error', message: MIC_BLOCKED })
    })

    it("waits for the error while the browser asks for the microphone, after the agent's settings", () => {
      // The settings arrive while the permission prompt is still open.
      const asking = live(settingsApplied, listening)
      const hungUp = updateSession(asking, fromSession1(disconnected))
      expect(hungUp).toBe(asking)
      expect(updateSession(hungUp, fromSession1(micBlocked))).toMatchObject({ status: 'error', message: MIC_BLOCKED })
    })

    it('ends on any other error that follows it', () => {
      expect(live(disconnected, openTimeout)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE })
    })
  })

  describe("only the live session's events count", () => {
    it('keeps the first end of a session', () => {
      const ended = live(...started, { type: 'idle' })
      expect(updateSession(ended, fromSession1(disconnected))).toBe(ended)

      const failed = live({ type: 'tokenFailed', message: VOICE_NOT_SET_UP })
      expect(updateSession(failed, fromSession1(openTimeout))).toBe(failed)
    })

    it('ignores a session that was replaced', () => {
      // The first session's token request answers after the customer stopped and pressed again.
      const second = after(press, press, press)
      expect(second).toMatchObject({ status: 'connecting', sessionNumber: 2 })
      expect(updateSession(second, fromSession1({ type: 'tokenFailed', message: VOICE_UNAVAILABLE }))).toBe(second)
    })

    it('ignores session events when no session is on', () => {
      expect(updateSession(NO_SESSION, { type: 'idle', sessionNumber: 0 })).toBe(NO_SESSION)
    })

    it("keeps the same state when an event changes nothing, so React doesn't re-render", () => {
      const on = live(...started)
      expect(updateSession(on, fromSession1(listening))).toBe(on)
      expect(updateSession(on, fromSession1(settingsApplied))).toBe(on)
    })
  })
})
