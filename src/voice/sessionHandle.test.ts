import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionHandle, LEAVE_CAP_MS, SHOW_CAP_MS, VOICE_LEAD_MS } from './sessionHandle'
import { NO_SESSION, updateSession, type SessionEvent, type SessionState } from './sessionStatus'

/**
 * A handle wired the way VoiceSessionProvider wires it: its events go through
 * the reducer, and it hears each new state. `agent` stands in for the SDK's
 * AgentSession.
 */
function setUp() {
  const sent: SessionEvent[] = []
  let state: SessionState = NO_SESSION
  const handle = createSessionHandle((event) => {
    sent.push(event)
    dispatch(event)
  })
  function dispatch(event: SessionEvent) {
    state = updateSession(state, event)
    handle.update(state)
  }
  const agent = { updatePrompt: vi.fn<(prompt: string) => void>() }
  /** Starts the next session as the customer would, up to listening, and returns its number. */
  function startSession() {
    dispatch({ type: 'pressed' })
    const sessionNumber = state.sessionNumber
    dispatch({ type: 'settingsApplied', sessionNumber })
    dispatch({ type: 'microphoneOn', sessionNumber })
    dispatch({ type: 'agentChanged', state: 'connected', mode: 'listening', sessionNumber })
    return sessionNumber
  }
  return { handle, sent, agent, dispatch, startSession, state: () => state }
}

/** Whether `promise` has settled, after the microtasks queued so far. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  void promise.then(() => (done = true))
  await Promise.resolve()
  await Promise.resolve()
  return done
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tell', () => {
  it("adds the text to the live agent's prompt", () => {
    const { handle, agent, startSession } = setUp()
    startSession()
    handle.attach(agent)

    handle.tell('Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.')

    expect(agent.updatePrompt).toHaveBeenCalledExactlyOnceWith(
      'Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99.',
    )
  })

  it('does nothing when no session is on', () => {
    const { handle, agent } = setUp()
    handle.attach(agent)
    expect(() => handle.tell('Customer added 1 × Fries by tapping.')).not.toThrow()
    expect(agent.updatePrompt).not.toHaveBeenCalled()
  })

  it('does nothing before the live session has handed its agent over, or after it has gone', () => {
    const { handle, agent, startSession } = setUp()
    startSession()
    handle.tell('before')
    const detach = handle.attach(agent)
    detach()
    handle.tell('after')
    expect(agent.updatePrompt).not.toHaveBeenCalled()
  })

  it("does nothing once the session has ended, even before its agent is gone", () => {
    const { handle, agent, dispatch, startSession } = setUp()
    startSession()
    handle.attach(agent)
    dispatch({ type: 'pressed' })
    handle.tell('Customer removed Fries by tapping.')
    expect(agent.updatePrompt).not.toHaveBeenCalled()
  })

  it("keeps the newest session's agent when an old one detaches late", () => {
    const { handle, agent, dispatch, startSession } = setUp()
    startSession()
    const detachFirst = handle.attach({ updatePrompt: vi.fn() })
    dispatch({ type: 'pressed' })
    startSession()
    handle.attach(agent)
    detachFirst()
    handle.tell('Customer added 1 × Fries by tapping.')
    expect(agent.updatePrompt).toHaveBeenCalledOnce()
  })
})

describe('leaveAfterSpeaking', () => {
  it('resolves at once, and sends nothing, when no session is on', async () => {
    const { handle, sent } = setUp()
    await expect(handle.leaveAfterSpeaking()).resolves.toBeUndefined()
    expect(sent).toEqual([])
  })

  it('asks the session to leave, and resolves once it has ended', async () => {
    const { handle, sent, dispatch, startSession, state } = setUp()
    const sessionNumber = startSession()

    const leaving = handle.leaveAfterSpeaking()
    expect(sent.at(-1)).toEqual({ type: 'leaveRequested', sessionNumber })
    expect(await settled(leaving)).toBe(false)

    // The agent says "Taking you to checkout now", and its voice finishes playing.
    dispatch({ type: 'agentChanged', state: 'connected', mode: 'speaking', sessionNumber })
    expect(await settled(leaving)).toBe(false)
    dispatch({ type: 'agentChanged', state: 'connected', mode: 'listening', sessionNumber })

    expect(state()).toEqual({ status: 'idle', sessionNumber, endedBy: 'leaveRequested' })
    expect(await settled(leaving)).toBe(true)
  })

  it('resolves when the session ends any other way first', async () => {
    const { handle, dispatch, startSession } = setUp()
    const sessionNumber = startSession()
    const leaving = handle.leaveAfterSpeaking()
    dispatch({ type: 'disconnected', sessionNumber })
    expect(await settled(leaving)).toBe(true)
  })

  // In the voice check of checkout paths (.build/step-5b.md) the agent read the order back and then said the
  // checkout line in one reply; the 10 s cap fired and the redirect cut the line short.
  it('waits up to 20 s, room for a read-back and the checkout line', () => {
    expect(LEAVE_CAP_MS).toBe(20_000)
  })

  it(`ends the session and resolves after ${LEAVE_CAP_MS / 1000} s, if the agent never finishes speaking`, async () => {
    const { handle, sent, startSession, state } = setUp()
    const sessionNumber = startSession()
    const leaving = handle.leaveAfterSpeaking()

    vi.advanceTimersByTime(LEAVE_CAP_MS - 1)
    expect(await settled(leaving)).toBe(false)
    vi.advanceTimersByTime(1)

    expect(sent.at(-1)).toEqual({ type: 'leaveTimedOut', sessionNumber })
    expect(state()).toMatchObject({ status: 'idle', endedBy: 'leaveTimedOut' })
    expect(await settled(leaving)).toBe(true)
  })

  it('resolves after the cap even if the session never reports its end', async () => {
    // A handle whose events go nowhere: a lost event can't hang checkout.
    const handle = createSessionHandle(() => {})
    handle.update({ status: 'speaking', sessionNumber: 1, settingsApplied: true, microphoneOn: true })
    const leaving = handle.leaveAfterSpeaking()
    vi.advanceTimersByTime(LEAVE_CAP_MS)
    expect(await settled(leaving)).toBe(true)
  })

  it('stops its timer once the session has ended', () => {
    const { handle, sent, dispatch, startSession } = setUp()
    startSession()
    void handle.leaveAfterSpeaking()
    dispatch({ type: 'pressed' })
    vi.advanceTimersByTime(LEAVE_CAP_MS)
    expect(sent.map((event) => event.type)).not.toContain('leaveTimedOut')
  })
})

// The owner found the suggestion card popping up in silence before the agent spoke disjointed (2026-11-11).
describe('showWithVoice', () => {
  it('shows at once when no session is on', () => {
    const { handle } = setUp()
    const show = vi.fn()
    handle.showWithVoice(show)
    expect(show).toHaveBeenCalledOnce()
  })

  it("shows once the agent's voice has played for a moment, not before", () => {
    const { handle, dispatch, startSession } = setUp()
    const sessionNumber = startSession()
    dispatch({ type: 'toolsRequested', names: ['plan_group_order'], sessionNumber })
    const show = vi.fn()

    handle.showWithVoice(show)
    vi.advanceTimersByTime(SHOW_CAP_MS / 2)
    expect(show).not.toHaveBeenCalled()

    dispatch({ type: 'agentChanged', state: 'connected', mode: 'speaking', sessionNumber })
    vi.advanceTimersByTime(VOICE_LEAD_MS - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(SHOW_CAP_MS)
    expect(show).toHaveBeenCalledOnce()
  })

  it('starts the lead at once when the agent is already speaking', () => {
    const { handle, dispatch, startSession } = setUp()
    const sessionNumber = startSession()
    dispatch({ type: 'agentChanged', state: 'connected', mode: 'speaking', sessionNumber })
    const show = vi.fn()

    handle.showWithVoice(show)
    vi.advanceTimersByTime(VOICE_LEAD_MS)

    expect(show).toHaveBeenCalledOnce()
  })

  it('shows after the cap if the agent never speaks', () => {
    const { handle, startSession } = setUp()
    startSession()
    const show = vi.fn()

    handle.showWithVoice(show)
    vi.advanceTimersByTime(SHOW_CAP_MS - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
  })

  it('shows at once when the session ends first', () => {
    const { handle, dispatch, startSession } = setUp()
    startSession()
    const show = vi.fn()

    handle.showWithVoice(show)
    dispatch({ type: 'pressed' })

    expect(show).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(SHOW_CAP_MS)
    expect(show).toHaveBeenCalledOnce()
  })

  it('never shows what was cancelled, as a card replaced before it came up', () => {
    const { handle, dispatch, startSession } = setUp()
    const sessionNumber = startSession()
    const replaced = vi.fn()
    const replacement = vi.fn()

    handle.showWithVoice(replaced)()
    handle.showWithVoice(replacement)
    dispatch({ type: 'agentChanged', state: 'connected', mode: 'speaking', sessionNumber })
    vi.advanceTimersByTime(SHOW_CAP_MS)

    expect(replaced).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('waits a short lead and a capped wait: the voice comes first, but never long', () => {
    expect(VOICE_LEAD_MS).toBe(400)
    expect(SHOW_CAP_MS).toBe(2_000)
  })
})

