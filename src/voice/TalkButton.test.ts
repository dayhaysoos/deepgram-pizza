import { describe, expect, it } from 'vitest'
import type { TalkStatus } from './sessionStatus'
import { TALK_LABELS, talkLabel } from './TalkButton'

describe('talkLabel', () => {
  it("is the state's label", () => {
    expect(talkLabel('connecting')).toBe(TALK_LABELS.connecting)
    expect(talkLabel('listening')).toBe(TALK_LABELS.listening)
  })

  it('says reconnecting while a dropped connection is tried again, and how to cancel', () => {
    expect(talkLabel('connecting', true)).toEqual({ label: 'Reconnecting…', hint: 'Press to cancel' })
  })

  it("keeps the state's label once the agent is back", () => {
    expect(talkLabel('listening', true)).toBe(TALK_LABELS.listening)
  })
})

describe('TALK_LABELS', () => {
  const statuses: TalkStatus[] = ['idle', 'connecting', 'listening', 'thinking', 'speaking', 'error']

  it('gives every state its own label', () => {
    const labels = statuses.map((status) => TALK_LABELS[status].label)
    expect(new Set(labels).size).toBe(statuses.length)
  })

  it('says how to stop a live session', () => {
    expect(TALK_LABELS.connecting.hint).toBe('Press to cancel')
    for (const status of ['listening', 'thinking', 'speaking'] as const) {
      expect(TALK_LABELS[status].hint).toBe('Press to stop')
    }
  })
})
