import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleTimer, IDLE_TIMEOUT_MS, SPEECH_EVENTS } from './idleTimer'

describe('createIdleTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits a minute', () => {
    expect(IDLE_TIMEOUT_MS).toBe(60_000)
  })

  it('fires once after the timeout with no speech', () => {
    const onIdle = vi.fn()
    createIdleTimer(onIdle)

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 3)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it.each(SPEECH_EVENTS.filter((event) => event !== 'agent-started-speaking'))('starts counting again on %s', (event) => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000)
    timer.heard(event)
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it("doesn't count while the agent speaks, and starts again when its audio is done", () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    timer.heard('agent-started-speaking')
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()

    // Its words arriving as text doesn't mean it stopped speaking.
    timer.heard('conversation-text')
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()

    timer.heard('agent-audio-done')
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('counts again when the customer cuts the agent off', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    timer.heard('agent-started-speaking')
    timer.heard('user-started-speaking')
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('never fires once stopped, whatever it hears after', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    timer.stop()
    timer.heard('user-started-speaking')
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('takes another timeout', () => {
    const onIdle = vi.fn()
    createIdleTimer(onIdle, 500)

    vi.advanceTimersByTime(500)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
