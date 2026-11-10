import { describe, expect, it } from 'vitest'
import { latestExchange } from './latestExchange'

const greeting = { role: 'assistant', content: 'Hey, welcome!' } as const
const ask = { role: 'user', content: 'Add two large margheritas.' } as const
const answer = { role: 'assistant', content: 'Two large margheritas, coming up.' } as const
const more = { role: 'assistant', content: 'Anything else?' } as const
const next = { role: 'user', content: 'Actually, make that one.' } as const

describe('latestExchange', () => {
  it('is empty before anyone speaks', () => {
    expect(latestExchange([])).toEqual({ customer: '', agent: '' })
  })

  it('shows the greeting before the customer says anything', () => {
    expect(latestExchange([greeting])).toEqual({ customer: '', agent: greeting.content })
  })

  it('shows every greeting line before the customer says anything', () => {
    const menuHint = { role: 'assistant', content: 'Ask me about the menu.' } as const
    expect(latestExchange([greeting, menuHint])).toEqual({
      customer: '',
      agent: `${greeting.content} ${menuHint.content}`,
    })
  })

  it("shows the customer's line alone until the agent answers it", () => {
    expect(latestExchange([greeting, ask])).toEqual({ customer: ask.content, agent: '' })
  })

  it("shows the customer's last line and the agent's reply to it", () => {
    expect(latestExchange([greeting, ask, answer])).toEqual({ customer: ask.content, agent: answer.content })
  })

  // Deepgram may send a reply as one line or one per sentence.
  it('joins every agent line after the customer\'s last line into one reply', () => {
    expect(latestExchange([greeting, ask, answer, more])).toEqual({
      customer: ask.content,
      agent: `${answer.content} ${more.content}`,
    })
  })

  it("clears the agent's reply when the customer speaks again", () => {
    expect(latestExchange([greeting, ask, answer, more, next])).toEqual({ customer: next.content, agent: '' })
  })
})
