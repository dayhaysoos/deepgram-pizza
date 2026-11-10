import { describe, expect, it } from 'vitest'
import { categories, formatPrice, menu, products, type MenuItem } from '../menu/menu'
import { SHOP_NAME } from '../shop'
import { describeCart, summarizeCart } from './cartSummary'
import { agentInstructions, describeMenu, GREETING } from './instructions'
import { describeTapChange } from './tapUpdates'
import { toolDefinitions, type ToolDefinition, type ToolName } from './tools'

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

// The rules in SPEC.md's "Agent instructions (first draft)", word for word.
const SPEC_DRAFT_RULES = [
  '- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.',
  '- After each change, confirm it with the quantity, size and name, then the new total from the tool result.',
  '- If a sized item has no size, ask which size before adding it.',
  '- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.',
  '- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.',
  '- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.',
  "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and add it with add_items only after they agree.",
  '- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.',
  "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
  '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
  "- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result.",
  '- When the customer is done, read back the order and total from view_cart, then call checkout when they confirm.',
]

const NO_STALLS_WITH_TOOLS =
  '- Never end a reply by promising to do something later ("give me a sec", "let me check"). Either do it now with a tool, or answer now.'
const NO_STALLS_WITHOUT_TOOLS = '- Never end a reply by promising to do something later ("give me a sec", "let me check"). Answer now.'

const STEP_4_SAFEGUARD =
  "- You can't add, change or remove anything in the cart, show items on screen or check the customer out right now. If the customer asks, start by saying you can't do that yet, then tell them they can tap Add on the menu and Checkout in the cart, all in one sentence. Never say you're adding, showing, checking or looking something up, or that you did."

const CART_TOOLS: ToolName[] = ['add_item', 'add_items', 'set_quantity', 'remove_item', 'clear_cart']
const toolNames = toolDefinitions.map((tool) => tool.name)
const fullPrompt = agentInstructions(emptyCart, toolDefinitions)

function only(...names: ToolName[]): ToolDefinition[] {
  return toolDefinitions.filter((tool) => names.includes(tool.name))
}

function allBut(...names: ToolName[]): ToolDefinition[] {
  return toolDefinitions.filter((tool) => !names.includes(tool.name))
}

// The tool names a prompt mentions, as whole words: `add_item` isn't found in
// `add_items`, and the Checkout button isn't the `checkout` tool.
function toolsNamedIn(text: string): string[] {
  return toolNames.filter((name) => new RegExp(`\\b${name}\\b`).test(text))
}

function rulesOf(text: string): string[] {
  const start = text.indexOf('\n\nRules:\n') + '\n\nRules:\n'.length
  return text.slice(start, text.lastIndexOf('\n\nConversation started.')).split('\n')
}

describe('agentInstructions', () => {
  it('with every tool, is the SPEC draft with the shop name, menu and cart filled in, plus the rule against stalling', () => {
    expect(fullPrompt).toBe(`You work the counter at ${SHOP_NAME}, a classic neighbourhood pizzeria. You're friendly and quick, like someone who's done this a thousand times.

Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").

You only know this menu:
${describeMenu()}

Rules:
${[...SPEC_DRAFT_RULES, NO_STALLS_WITH_TOOLS].join('\n')}

Conversation started. Cart: empty.`)
  })

  it('with no tools (step 4), names no tool and says what the agent can do instead', () => {
    expect(prompt).toBe(agentInstructions(emptyCart, []))
    expect(toolsNamedIn(prompt)).toEqual([])
    expect(prompt).not.toMatch(/\btools?\b/)
    expect(rulesOf(prompt)).toEqual([
      STEP_4_SAFEGUARD,
      '- When the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), name two or three matching items.',
      '- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.',
      "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Describe the plan out loud, then tell them they can add it by tapping Add on the menu.",
      '- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.',
      "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
      '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
      `- Answer anything about what's in the cart or the total from the last "Cart:" line you were given, and say the cart on screen is the up-to-date one, since the customer can change it by tapping.`,
      '- When the customer is done, tell them to tap Checkout in the cart.',
      NO_STALLS_WITHOUT_TOOLS,
    ])
  })

  it('names exactly the tools the SPEC draft names when it has them all', () => {
    expect(toolsNamedIn(fullPrompt)).toEqual(['find_menu_items', 'show_suggestions', 'add_items', 'view_cart', 'checkout'])
  })

  it.each(toolNames)('mentions %s only when the session has it', (name) => {
    expect(toolsNamedIn(agentInstructions(emptyCart, allBut(name)))).not.toContain(name)
    const alone = toolsNamedIn(agentInstructions(emptyCart, only(name)))
    expect(alone).toEqual(toolsNamedIn(fullPrompt).includes(name) ? [name] : [])
  })

  it("keeps each of the draft's tool rules only while the session has the tools it names", () => {
    const rule = (index: number) => SPEC_DRAFT_RULES[index]
    expect(rulesOf(agentInstructions(emptyCart, only('find_menu_items')))).toContain(rule(3))
    expect(rulesOf(agentInstructions(emptyCart, allBut('find_menu_items')))).not.toContain(rule(3))
    expect(rulesOf(agentInstructions(emptyCart, only('show_suggestions')))).toContain(rule(4))
    expect(rulesOf(agentInstructions(emptyCart, allBut('show_suggestions')))).not.toContain(rule(4))
    expect(rulesOf(agentInstructions(emptyCart, only('show_suggestions', 'add_items')))).toContain(rule(6))
    expect(rulesOf(agentInstructions(emptyCart, only('view_cart')))).toContain(rule(10))
    expect(rulesOf(agentInstructions(emptyCart, allBut('view_cart')))).not.toContain(rule(10))
    expect(rulesOf(agentInstructions(emptyCart, only('view_cart', 'checkout')))).toContain(rule(11))
  })

  it.each(CART_TOOLS)('keeps the cart-change rules, and drops the cart from the safeguard, with %s', (name) => {
    const rules = rulesOf(agentInstructions(emptyCart, only(name)))
    expect(rules).toEqual(expect.arrayContaining(SPEC_DRAFT_RULES.slice(0, 3)))
    expect(rules.join('\n')).not.toContain('add, change or remove anything in the cart')
  })

  it('without the cart tools, drops the cart-change rules and says only what is missing', () => {
    const rules = rulesOf(agentInstructions(emptyCart, allBut(...CART_TOOLS)))
    for (const rule of SPEC_DRAFT_RULES.slice(0, 3)) expect(rules).not.toContain(rule)
    expect(rules[0]).toBe(
      "- You can't add, change or remove anything in the cart right now. If the customer asks, start by saying you can't do that yet, then tell them they can tap Add on the menu, all in one sentence. Never say you're adding, or that you did.",
    )
    expect(rules).toContain(
      "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and tell them they can add it by tapping Add on the menu.",
    )
  })

  it('without checkout, points to the Checkout button instead', () => {
    const rules = rulesOf(agentInstructions(emptyCart, allBut('checkout')))
    expect(rules[0]).toBe(
      "- You can't check the customer out right now. If the customer asks, start by saying you can't do that yet, then tell them they can tap Checkout in the cart, all in one sentence.",
    )
    expect(rules).toContain('- When the customer is done, read back the order and total from view_cart, then tell them to tap Checkout in the cart.')
  })

  it('has the rule against stalling whatever the tools, with no safeguard once every tool is there', () => {
    expect(rulesOf(fullPrompt).at(-1)).toBe(NO_STALLS_WITH_TOOLS)
    expect(rulesOf(agentInstructions(emptyCart, only('view_cart'))).at(-1)).toBe(NO_STALLS_WITH_TOOLS)
    expect(rulesOf(prompt).at(-1)).toBe(NO_STALLS_WITHOUT_TOOLS)
    expect(fullPrompt).not.toContain("can't")
  })

  it.each([
    ['no tools', []],
    ['every tool', toolDefinitions],
  ])('leaves no placeholder unfilled, with %s', (_, tools) => {
    expect(agentInstructions(emptyCart, tools)).not.toMatch(/\{\{|\}\}|undefined|false/)
  })

  it('ends with the cart as the session starts, in the words the tap updates use', () => {
    expect(prompt.endsWith('\n\nConversation started. Cart: empty.')).toBe(true)

    const cart = summarizeCart({ 'margherita-pizza-large': 1 })
    for (const tools of [[], toolDefinitions]) {
      const lastLine = agentInstructions(cart, tools).split('\n').at(-1)
      expect(lastLine).toBe('Conversation started. Cart: 1 × Large Margherita Pizza. Total $20.99.')
      expect(lastLine).toBe(`Conversation started. ${describeCart(cart)}`)
    }
    expect(describeTapChange({ type: 'remove', id: 'fries' }, cart)).toBe(`Customer removed Fries by tapping. ${describeCart(cart)}`)
  })

  // Deepgram's limit, with every product in the cart, is checked in src/voice/agentSettings.test.ts.
  it('stays compact: under 12,000 characters with an empty cart', () => {
    expect(prompt.length).toBeLessThan(12_000)
    expect(fullPrompt.length).toBeLessThan(12_000)
  })
})
