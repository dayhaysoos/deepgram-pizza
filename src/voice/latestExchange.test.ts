import { describe, expect, it } from 'vitest'
import { latestExchange } from './latestExchange'

const greeting = { id: '1', role: 'assistant', content: 'Hey, welcome!' } as const
const ask = { id: '2', role: 'user', content: 'Add two large margheritas.' } as const
const answer = { id: '3', role: 'assistant', content: 'Two large margheritas, coming up.' } as const
const more = { id: '4', role: 'assistant', content: 'Anything else?' } as const
const next = { id: '5', role: 'user', content: 'Actually, make that one.' } as const

describe('latestExchange', () => {
  it('is empty before anyone speaks', () => {
    expect(latestExchange([])).toEqual({ customer: '', agent: [] })
  })

  it('shows the greeting before the customer says anything', () => {
    expect(latestExchange([greeting])).toEqual({ customer: '', agent: [greeting] })
  })

  it('shows every greeting line before the customer says anything', () => {
    const menuHint = { id: '6', role: 'assistant', content: 'Ask me about the menu.' } as const
    expect(latestExchange([greeting, menuHint])).toEqual({ customer: '', agent: [greeting, menuHint] })
  })

  it("shows the customer's line alone until the agent answers it", () => {
    expect(latestExchange([greeting, ask])).toEqual({ customer: ask.content, agent: [] })
  })

  it("shows the customer's last line and the agent's reply to it", () => {
    expect(latestExchange([greeting, ask, answer])).toEqual({ customer: ask.content, agent: [answer] })
  })

  // Deepgram may send a reply as one line or one per sentence. Each stays its
  // own line, with its id, so the captions add a new sentence without
  // re-reading the ones before it.
  it("keeps every agent line after the customer's last line, oldest first", () => {
    expect(latestExchange([greeting, ask, answer, more])).toEqual({ customer: ask.content, agent: [answer, more] })
  })

  it("clears the agent's reply when the customer speaks again", () => {
    expect(latestExchange([greeting, ask, answer, more, next])).toEqual({ customer: next.content, agent: [] })
  })
})
