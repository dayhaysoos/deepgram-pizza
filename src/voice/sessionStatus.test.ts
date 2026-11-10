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
      expect(after(press, press)).toEqual({ status: 'idle', sessionNumber: 1 })
    })

    it('ends the session once it is on', () => {
      const on = live(...started)
      expect(updateSession(on, press)).toEqual({ status: 'idle', sessionNumber: 1 })
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

  describe('ending a session', () => {
    it('ends without a message when the customer leaves the page', () => {
      expect(live(...started, { type: 'pageHidden' })).toEqual({ status: 'idle', sessionNumber: 1 })
    })

    it('ends without a message after a minute with no speech', () => {
      expect(live(...started, { type: 'idle' })).toEqual({ status: 'idle', sessionNumber: 1 })
    })

    it("shows the token server function's message as it is", () => {
      expect(live({ type: 'tokenFailed', message: VOICE_NOT_SET_UP })).toEqual({
        status: 'error',
        sessionNumber: 1,
        message: VOICE_NOT_SET_UP,
      })
    })

    it('asks for the microphone when it was blocked', () => {
      expect(live(micBlocked)).toMatchObject({ status: 'error', message: MIC_BLOCKED })
      const insecure = new DOMException('Insecure context', 'SecurityError')
      expect(live({ type: 'sdkError', error: insecure })).toMatchObject({ status: 'error', message: MIC_BLOCKED })
    })

    it("says when there's no microphone it can use", () => {
      for (const name of ['NotFoundError', 'NotReadableError', 'OverconstrainedError']) {
        const error = new DOMException('No microphone', name)
        expect(live({ type: 'sdkError', error })).toMatchObject({ status: 'error', message: MIC_UNAVAILABLE })
      }
    })

    it('ends on an Error message from Deepgram, before or after the start', () => {
      const agentError: LiveEvent = { type: 'agentError' }
      expect(live(agentError)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE })
      expect(live(...started, agentError)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE })
    })

    it('ends on any other SDK error before the agent has its settings', () => {
      expect(live(openTimeout)).toMatchObject({ status: 'error', message: VOICE_UNAVAILABLE })
      expect(live({ type: 'sdkError', error: 'socket closed' })).toMatchObject({
        status: 'error',
        message: VOICE_UNAVAILABLE,
      })
    })

    it('lets the SDK reconnect after other SDK errors once the agent has its settings', () => {
      const on = live(settingsApplied, listening)
      expect(updateSession(on, fromSession1(openTimeout))).toBe(on)
    })

    it('still ends on a microphone error once the session has started', () => {
      const unplugged: LiveEvent = { type: 'sdkError', error: new DOMException('Device in use', 'NotReadableError') }
      expect(live(...started, unplugged)).toMatchObject({ status: 'error', message: MIC_UNAVAILABLE })
    })

    it('says the connection was lost when the SDK gives up, once the session has started', () => {
      expect(live(...started, disconnected)).toEqual({ status: 'error', sessionNumber: 1, message: CONNECTION_LOST })
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
      expect(updateSession(hungUp, fromSession1(micBlocked))).toMatchObject({ status: 'error', message: MIC_BLOCKED })
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
