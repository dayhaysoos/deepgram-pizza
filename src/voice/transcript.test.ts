import { describe, expect, it } from 'vitest'
import { NO_TRANSCRIPT, sessionLines, updateTranscript, type Transcript } from './transcript'

const greeting = { id: '1', role: 'assistant', content: 'Hey, welcome!' } as const
const ask = { id: '2', role: 'user', content: "What's vegetarian?" } as const
const answer = { id: '3', role: 'assistant', content: 'The Margherita and the Veggie Supreme.' } as const
const nextGreeting = { id: '4', role: 'assistant', content: 'Hey again!' } as const

/** The transcript after these updates, from the page's first render. */
function after(...updates: Transcript[]): Transcript {
  return updates.reduce(updateTranscript, NO_TRANSCRIPT)
}

describe('updateTranscript', () => {
  it('starts with no lines', () => {
    expect(NO_TRANSCRIPT).toEqual({ sessionNumber: 0, lines: [] })
  })

  it("keeps a session's conversation as it grows", () => {
    expect(
      after(
        { sessionNumber: 1, lines: [] },
        { sessionNumber: 1, lines: [greeting] },
        { sessionNumber: 1, lines: [greeting, ask, answer] },
      ),
    ).toEqual({ sessionNumber: 1, lines: [greeting, ask, answer] })
  })

  // A press starts the next session, and its provider starts with no conversation.
  it("replaces the last session's lines with the next session's", () => {
    const first = after({ sessionNumber: 1, lines: [greeting, ask, answer] })
    expect(updateTranscript(first, { sessionNumber: 2, lines: [] })).toEqual({ sessionNumber: 2, lines: [] })
    expect(updateTranscript(first, { sessionNumber: 2, lines: [nextGreeting] })).toEqual({
      sessionNumber: 2,
      lines: [nextGreeting],
    })
  })

  it("ignores an earlier session's conversation", () => {
    const second = after({ sessionNumber: 2, lines: [nextGreeting] })
    expect(updateTranscript(second, { sessionNumber: 1, lines: [greeting, ask] })).toBe(second)
  })

  it('returns the same transcript when the conversation is the same', () => {
    const conversation = [greeting, ask]
    const transcript = after({ sessionNumber: 1, lines: conversation })
    expect(updateTranscript(transcript, { sessionNumber: 1, lines: conversation })).toBe(transcript)
  })
})

describe('sessionLines', () => {
  const transcript = after({ sessionNumber: 1, lines: [greeting, ask, answer] })

  // The session's number stays the same after it ends, until the next press.
  it('shows the lines of the latest session, live or ended', () => {
    expect(sessionLines(transcript, 1)).toEqual([greeting, ask, answer])
  })

  it('shows nothing once a press starts the next session', () => {
    expect(sessionLines(transcript, 2)).toEqual([])
  })

  it('shows nothing before the first session', () => {
    expect(sessionLines(NO_TRANSCRIPT, 0)).toEqual([])
  })
})
