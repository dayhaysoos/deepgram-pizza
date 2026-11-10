import { describe, expect, it } from 'vitest'
import type { TalkStatus } from './sessionStatus'
import { TALK_LABELS } from './TalkButton'

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
