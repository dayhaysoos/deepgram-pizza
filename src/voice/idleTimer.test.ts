import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleTimer, IDLE_TIMEOUT_MS } from './idleTimer'

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

  it('starts counting again on speech, or a reconnect', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000)
    timer.restart()
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it("doesn't end the session while the agent speaks, however long", () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    vi.advanceTimersByTime(30_000)
    timer.setAgentSpeaking(true)
    vi.advanceTimersByTime(90_000)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('ends the session a minute after the agent stops speaking, with no speech since', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    timer.setAgentSpeaking(true)
    vi.advanceTimersByTime(90_000)
    timer.setAgentSpeaking(false)
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it("doesn't start counting on speech while the agent speaks", () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    // Its words arriving as text don't mean it stopped speaking.
    timer.setAgentSpeaking(true)
    timer.restart()
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('keeps counting when told the agent is still not speaking', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1000)
    timer.setAgentSpeaking(false)
    vi.advanceTimersByTime(1000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('never fires once stopped, whatever it hears after', () => {
    const onIdle = vi.fn()
    const timer = createIdleTimer(onIdle)

    timer.stop()
    timer.restart()
    timer.setAgentSpeaking(true)
    timer.setAgentSpeaking(false)
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
