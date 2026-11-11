import { describe, expect, it } from 'vitest'
import { summarizeCart } from '../agent/cartSummary'
import { agentInstructions, GREETING } from '../agent/instructions'
import { toolDefinitions } from '../agent/tools'
import { menu, products, spokenName } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { agentSettings, MANAGED_PROMPT_LIMIT, menuKeyterms } from './agentSettings'

const cart = summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })

describe('agentSettings', () => {
  const settings = agentSettings(cart)

  it('listens with Flux, listening for the menu, thinks with a managed GPT-4.1 mini and speaks with a Flux voice', () => {
    expect(settings.listen).toEqual({
      provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en', keyterms: menuKeyterms() },
    })
    expect(settings.think).toMatchObject({ provider: { type: 'open_ai', model: 'gpt-4.1-mini' } })
    expect(settings.speak).toEqual({ provider: { type: 'deepgram', version: 'v2', model: 'flux-cole-en' } })
  })

  it('gives the agent its instructions with the cart from the press, and the greeting', () => {
    expect(settings.think).toMatchObject({ prompt: agentInstructions(cart) })
    expect(settings.greeting).toBe(GREETING)
  })

  it('has no tools unless it is given some (step 4), and then sends no functions and the instructions for no tools', () => {
    expect(settings).toEqual(agentSettings(cart, []))
    expect(settings.think).not.toHaveProperty('functions')
    expect(settings.think).toMatchObject({ prompt: agentInstructions(cart, []) })
  })

  it('sends the tools it is given as functions, and the instructions written for the same tools', () => {
    expect(agentSettings(cart, toolDefinitions).think).toMatchObject({
      functions: toolDefinitions,
      prompt: agentInstructions(cart, toolDefinitions),
    })

    const some = toolDefinitions.filter((tool) => tool.name === 'view_cart' || tool.name === 'checkout')
    expect(agentSettings(cart, some).think).toMatchObject({ functions: some, prompt: agentInstructions(cart, some) })
  })

  it("sends defer_until_eot with the functions that set it, as Deepgram reads it, though the SDK's type doesn't list it yet", () => {
    const sent = JSON.parse(JSON.stringify(agentSettings(cart, toolDefinitions))) as { think: { functions: Array<Record<string, unknown>> } }
    const checkout = sent.think.functions.find((fn) => fn.name === 'checkout')
    const viewCart = sent.think.functions.find((fn) => fn.name === 'view_cart')
    const findMenuItems = sent.think.functions.find((fn) => fn.name === 'find_menu_items')
    expect(checkout).toMatchObject({ defer_until_eot: true })
    expect(viewCart).toMatchObject({ defer_until_eot: true })
    expect(findMenuItems).not.toHaveProperty('defer_until_eot')
  })

  it('listens for the menu whatever the tools', () => {
    expect(agentSettings(cart, toolDefinitions).listen).toEqual(settings.listen)
  })

  it.each([
    ['no tools', []],
    ['every tool', toolDefinitions],
  ])('stays within the prompt limit for managed LLMs, even with every product in the cart, with %s', (_, tools) => {
    const fullCart = summarizeCart(Object.fromEntries(products.map((product) => [product.id, MAX_LINE_QUANTITY])))
    const think = agentSettings(fullCart, tools).think

    expect(think).toMatchObject({ prompt: expect.any(String) })
    expect((think as { prompt: string }).prompt.length).toBeLessThan(MANAGED_PROMPT_LIMIT)
  })
})

// Flux heard "margaritas" for "margherita" in step 5's Check. Keyterms bias it toward the menu's words:
// https://developers.deepgram.com/docs/keyterm (Flux supports them; up to 100, 500 tokens in all).
describe('menuKeyterms', () => {
  it("is every item's name as the agent says it, from menu.json", () => {
    expect(menuKeyterms()).toEqual([...new Set(menu.map(spokenName))])
    expect(menuKeyterms()).toContain('margherita pizza')
    // A name with a count in it goes by its spoken name: "(6)" isn't something anyone says.
    expect(menuKeyterms()).toContain('garlic knots')
    expect(menuKeyterms().join(' ')).not.toMatch(/[()]/)
  })

  it('has no repeats or blanks, and stays well inside Deepgram\'s limits', () => {
    const terms = menuKeyterms()
    expect(new Set(terms).size).toBe(terms.length)
    expect(terms.every((term) => term.trim() === term && term !== '')).toBe(true)
    expect(terms.length).toBeLessThanOrEqual(100)
    // 500 tokens in all: fewer than 250 words leaves room even at two tokens a word.
    expect(terms.join(' ').split(' ').length).toBeLessThan(250)
  })
})
