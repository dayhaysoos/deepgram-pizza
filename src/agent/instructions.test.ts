import { describe, expect, it } from 'vitest'
import { categories, formatPrice, menu, products, type MenuItem } from '../menu/menu'
import { SHOP_NAME } from '../shop'
import { describeCart, summarizeCart } from './cartSummary'
import { agentInstructions, describeMenu, GREETING } from './instructions'
import { describeTapChange } from './tapUpdates'

const emptyCart = summarizeCart({})
const prompt = agentInstructions(emptyCart)
const menuLines = describeMenu().split('\n')

// Each item has one line in the menu text, marked with its item id.
function lineOf(item: MenuItem): string {
  const found = menuLines.filter((line) => line.includes(`[item ${item.id}]`))
  expect(found, item.id).toHaveLength(1)
  return found[0]
}

describe('GREETING', () => {
  it('welcomes the customer to the shop by name', () => {
    expect(GREETING).toBe(`Hey, welcome to ${SHOP_NAME}! What can I get started for you?`)
  })
})

describe('describeMenu', () => {
  it('reads like this', () => {
    expect(menuLines.slice(0, 2)).toEqual([
      'Pizza (category pizza, Medium 14″ · Large 18″):',
      'Cheese Pizza [item cheese-pizza]: Tomato sauce and melted mozzarella on a crisp, chewy crust. Tags: vegetarian, popular. Medium: id cheese-pizza-medium, $15.99, serves 2. Large: id cheese-pizza-large, $18.99, serves 4. Pairs with Garlic Knots (6), Fountain Soda.',
    ])
    expect(menuLines).toContain('Fries [item fries]: Golden, crispy fries, lightly salted. Tags: vegetarian, vegan. One size: id fries, $4.99, serves 2.')
  })

  it("gives every item its name, description and tags, and pairsWith by the paired items' names", () => {
    for (const item of menu) {
      const line = lineOf(item)
      expect(line.startsWith(`${item.name} [item ${item.id}]: ${item.description}`), item.id).toBe(true)
      if (item.tags.length > 0) expect(line).toContain(`Tags: ${item.tags.join(', ')}.`)
      else expect(line).not.toContain('Tags:')
      const paired = item.pairsWith.map((id) => menu.find((other) => other.id === id)?.name)
      if (paired.length > 0) expect(line).toContain(`Pairs with ${paired.join(', ')}.`)
      else expect(line).not.toContain('Pairs with')
    }
  })

  it('gives every variant its id, size, menu price and serves, next to each other', () => {
    for (const item of menu) {
      for (const variant of item.variants) {
        const size = variant.label ?? 'One size'
        expect(lineOf(item)).toContain(`${size}: id ${variant.id}, ${formatPrice(variant.price)}, serves ${variant.serves}.`)
      }
    }
    // Every id the tools take is on the menu the agent reads.
    for (const product of products) expect(describeMenu()).toContain(`id ${product.id},`)
  })

  it("groups the items under their category's heading, in the menu's category order", () => {
    const headings = categories.map((category) =>
      menuLines.indexOf(`${category.label} (category ${category.id}${'note' in category ? `, ${category.note}` : ''}):`),
    )
    expect(headings.every((index) => index >= 0)).toBe(true)
    expect(headings).toEqual([...headings].sort((a, b) => a - b))

    for (const item of menu) {
      const index = menuLines.indexOf(lineOf(item))
      const under = headings.filter((heading) => heading < index).length - 1
      expect(categories[under].id, item.id).toBe(item.category)
    }
  })
})

describe('agentInstructions', () => {
  it('keeps the SPEC draft, with the shop name and the menu filled in', () => {
    expect(prompt.startsWith(`You work the counter at ${SHOP_NAME}, a classic neighbourhood pizzeria.`)).toBe(true)
    expect(prompt).toContain(`You only know this menu:\n${describeMenu()}\n\nRules:\n`)
    for (const sentence of [
      'Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").',
      '- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.',
      '- After each change, confirm it with the quantity, size and name, then the new total from the tool result.',
      '- If a sized item has no size, ask which size before adding it.',
      '- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.',
      "- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result.",
      '- When the customer is done, read back the order and total from view_cart, then call checkout when they confirm.',
    ]) {
      expect(prompt).toContain(sentence)
    }
  })

  it('leaves no placeholder unfilled', () => {
    expect(prompt).not.toMatch(/\{\{|\}\}|undefined/)
  })

  it('ends with the cart as the session starts, in the words the tap updates use', () => {
    expect(prompt.endsWith('\n\nConversation started. Cart: empty.')).toBe(true)

    const cart = summarizeCart({ 'margherita-pizza-large': 1 })
    const lastLine = agentInstructions(cart).split('\n').at(-1)
    expect(lastLine).toBe('Conversation started. Cart: 1 × Large Margherita Pizza. Total $20.99.')
    expect(lastLine).toBe(`Conversation started. ${describeCart(cart)}`)
    expect(describeTapChange({ type: 'remove', id: 'fries' }, cart)).toBe(`Customer removed Fries by tapping. ${describeCart(cart)}`)
  })

  // Deepgram's limit, with every product in the cart, is checked in src/voice/agentSettings.test.ts.
  it('stays compact: under 12,000 characters with an empty cart', () => {
    expect(prompt.length).toBeLessThan(12_000)
  })
})
