import { describe, expect, it } from 'vitest'
import { latestExchange } from './latestExchange'

const greeting = { role: 'assistant', content: 'Hey, welcome!' } as const
const ask = { role: 'user', content: 'Add two large margheritas.' } as const
const answer = { role: 'assistant', content: 'Two large margheritas, coming up.' } as const

describe('latestExchange', () => {
  it('is empty before anyone speaks', () => {
    expect(latestExchange([])).toEqual({ customer: '', agent: '' })
  })

  it("shows the greeting before the customer says anything", () => {
    expect(latestExchange([greeting])).toEqual({ customer: '', agent: greeting.content })
  })

  it("shows the customer's line alone until the agent answers it", () => {
    expect(latestExchange([greeting, ask])).toEqual({ customer: ask.content, agent: '' })
  })

  it("shows the customer's last line and the agent's latest line after it", () => {
    const more = { role: 'assistant', content: 'Anything else?' } as const
    expect(latestExchange([greeting, ask, answer])).toEqual({ customer: ask.content, agent: answer.content })
    expect(latestExchange([greeting, ask, answer, more])).toEqual({ customer: ask.content, agent: more.content })
  })

  it('moves on with the next exchange', () => {
    const next = { role: 'user', content: 'Actually, make that one.' } as const
    expect(latestExchange([greeting, ask, answer, next])).toEqual({ customer: next.content, agent: '' })
  })
})
