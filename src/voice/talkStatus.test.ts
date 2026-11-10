import { describe, expect, it } from 'vitest'
import { VOICE_UNAVAILABLE } from './deepgramToken'
import {
  explainError,
  MIC_BLOCKED,
  MIC_UNAVAILABLE,
  TALK_LABELS,
  talkStatus,
  VoiceTokenError,
  type TalkStatus,
} from './talkStatus'

describe('talkStatus', () => {
  it('shows connecting until the agent has its settings', () => {
    expect(talkStatus('idle', 'idle')).toBe('connecting')
    expect(talkStatus('connecting', 'idle')).toBe('connecting')
    // Connected, but the settings aren't applied yet.
    expect(talkStatus('connected', 'idle')).toBe('connecting')
  })

  it("shows the agent's mode once it's connected", () => {
    expect(talkStatus('connected', 'listening')).toBe('listening')
    expect(talkStatus('connected', 'thinking')).toBe('thinking')
    expect(talkStatus('connected', 'speaking')).toBe('speaking')
  })

  it('shows connecting again while the SDK reconnects', () => {
    expect(talkStatus('reconnecting', 'listening')).toBe('connecting')
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

describe('explainError', () => {
  it("passes on the token server function's message", () => {
    expect(explainError(new VoiceTokenError(VOICE_UNAVAILABLE))).toBe(VOICE_UNAVAILABLE)
  })

  it('asks for the microphone when it was blocked', () => {
    expect(explainError(new DOMException('Permission denied', 'NotAllowedError'))).toBe(MIC_BLOCKED)
    expect(explainError(new DOMException('Insecure context', 'SecurityError'))).toBe(MIC_BLOCKED)
  })

  it("says when there's no microphone it can use", () => {
    expect(explainError(new DOMException('Requested device not found', 'NotFoundError'))).toBe(MIC_UNAVAILABLE)
    expect(explainError(new DOMException('Device in use', 'NotReadableError'))).toBe(MIC_UNAVAILABLE)
  })

  it('leaves anything else to the caller', () => {
    expect(explainError(new Error('open timeout after 10000ms'))).toBeUndefined()
    expect(explainError('socket closed')).toBeUndefined()
  })
})
