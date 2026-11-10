import { describe, expect, it } from 'vitest'
import { summarizeCart } from '../agent/cartSummary'
import { agentInstructions, GREETING } from '../agent/instructions'
import { products } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { agentSettings, MANAGED_PROMPT_LIMIT } from './agentSettings'

const cart = summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })

describe('agentSettings', () => {
  const settings = agentSettings(cart)

  it('listens with Flux, thinks with a managed GPT-4.1 mini and speaks with a Flux voice', () => {
    expect(settings.listen).toEqual({ provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' } })
    expect(settings.think).toMatchObject({ provider: { type: 'open_ai', model: 'gpt-4.1-mini' } })
    expect(settings.speak).toEqual({ provider: { type: 'deepgram', version: 'v2', model: 'flux-cole-en' } })
  })

  it('gives the agent its instructions with the cart from the press, and the greeting', () => {
    expect(settings.think).toMatchObject({ prompt: agentInstructions(cart) })
    expect(settings.greeting).toBe(GREETING)
  })

  it('has no tools yet', () => {
    expect(settings.think).not.toHaveProperty('functions')
  })

  it('stays within the prompt limit for managed LLMs, even with every product in the cart', () => {
    const fullCart = summarizeCart(Object.fromEntries(products.map((product) => [product.id, MAX_LINE_QUANTITY])))
    const think = agentSettings(fullCart).think

    expect(think).toMatchObject({ prompt: expect.any(String) })
    expect((think as { prompt: string }).prompt.length).toBeLessThan(MANAGED_PROMPT_LIMIT)
  })
})
