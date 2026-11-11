import { describe, expect, it } from 'vitest'
import { categories, findItem, formatPrice, menu, products, type MenuItem } from '../menu/menu'
import { DELIVERY_FEE, SHOP_NAME } from '../shop'
import { describeCart, summarizeCart } from './cartSummary'
import { agentInstructions, describeMenu, greeting } from './instructions'
import { describeOrderType } from './orderType'
import { spokenPrice } from './spokenPrice'
import { CALL_VIEW_CART, describeTapChange } from './tapUpdates'
import { checkoutLine, GROUP_MAINS, SAY_AT_CHECKOUT, toolDefinitions, type ToolDefinition, type ToolName } from './tools'

const emptyCart = summarizeCart({})
const prompt = agentInstructions(emptyCart)
const menuLines = describeMenu().split('\n')

// Each item has one line in the menu text, marked with its item id.
function lineOf(item: MenuItem): string {
  const found = menuLines.filter((line) => line.includes(`[item ${item.id}]`))
  expect(found, item.id).toHaveLength(1)
  return found[0]
}

describe('greeting', () => {
  // The owner's greeting (2026-11-10, .build/step-5b.md): it asks every time.
  it('welcomes the customer to the shop by name and asks pickup or delivery', () => {
    expect(greeting(null, toolDefinitions)).toBe(`Hey, welcome to ${SHOP_NAME}! Is this for pickup or delivery?`)
    expect(greeting(null, toolDefinitions)).toBe("Hey, welcome to Nick's Pizza! Is this for pickup or delivery?")
  })

  it('asks to confirm the choice already made, in the cart or an earlier session', () => {
    expect(greeting('delivery', toolDefinitions)).toBe("Hey, welcome to Nick's Pizza! Still delivery today?")
    expect(greeting('pickup', toolDefinitions)).toBe("Hey, welcome to Nick's Pizza! Still pickup today?")
  })

  it("without set_order_type, doesn't ask what it can't record", () => {
    for (const orderType of [null, 'delivery'] as const) {
      expect(greeting(orderType, allBut('set_order_type'))).toBe(`Hey, welcome to ${SHOP_NAME}! What can I get started for you?`)
      expect(greeting(orderType)).toBe(`Hey, welcome to ${SHOP_NAME}! What can I get started for you?`)
    }
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
      const paired = item.pairsWith.map((id) => findItem(id)?.name)
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

// The rules in SPEC.md's "Agent instructions (first draft)", word for word,
// with the wording recorded under Decisions since the first draft.
const ORDER_TYPE_RULE_START = '- Every order is pickup or delivery. When the customer says which, call set_order_type, then say one short line like "Great, delivery it is. What can I get you?"'
// The checkout line says the amount to pay, the fee included for delivery, so this path needs nothing more (review round 3).
const ORDER_TYPE_RULE_CHECKOUT = ', or if they were checking out, call checkout next.'
// In the voice check, "Add a large cheese pizza" before choosing got no tool
// call, and "I'll get that large cheese pizza added for you right after."
const ORDER_TYPE_RULE_ADD_FIRST =
  ' If they order something before saying which, add it with its tool right away and confirm it as usual, then ask "Pickup or delivery?" once, in the same reply; never hold an item until they answer, or promise to add it later, and don\'t call set_order_type until they say which.'
const ORDER_TYPE_RULE_ASK_FIRST = ' If they start ordering without saying, ask "Pickup or delivery?" once, in the same reply.'
const ORDER_TYPE_RULE_END =
  ' For delivery, never take an address by voice: if one comes up, say "You\'ll enter the delivery address at checkout." If asked about fees, delivery adds a flat three ninety-nine at checkout.'
const ORDER_TYPE_RULE = ORDER_TYPE_RULE_START + ORDER_TYPE_RULE_CHECKOUT + ORDER_TYPE_RULE_ADD_FIRST + ORDER_TYPE_RULE_END
// The cart tools wait for the end of the customer's turn (defer_until_eot), so what the agent says with the call
// is spoken before the result: in a text run it gave a medium's price for a large (review round 4, .build/step-5b.md).
const CHANGE_RULE =
  '- To change the cart, always use a tool, and say nothing about the change, not even its price, until it returns. Never claim you added, changed or removed something unless the tool returned it.'
const CONFIRM_RULE_START =
  '- After each change, confirm it from the tool result: the quantity, size and name of every line you added or changed, then the new total, for delivery with the fee named.'
const CONFIRM_RULE = `${CONFIRM_RULE_START} After add_items, name every line it added, one by one ("two large cheese pizzas, three large pepperoni pizzas, six garlic knots, …"), a whole group plan included, even if it takes more than two sentences; never sum them up.`
const SPOKEN_TOTAL_RULE =
  '- Say every total exactly as the totalSpoken in the tool result gives it, word for word, even a long one ("two hundred ninety-seven dollars and fifty-six cents"); never turn the digits in total into words yourself.'
// The agent said "forty-one ninety-eight" for a delivery order, and Stripe charged $45.97.
const DELIVERY_TOTAL_RULE =
  '- For delivery, a cart or a plan in a tool result also has delivery. Every time you say its total, after a change too, name the fee and give the total with it, each word for word: "forty-one ninety-eight, plus three ninety-nine for delivery, forty-five ninety-seven in all" (totalSpoken, feeSpoken, totalWithDeliverySpoken).'
const SIZE_RULE = '- If a sized item has no size, ask which size before adding it.'
const FIND_RULE_START =
  '- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.'
const FIND_RULE = `${FIND_RULE_START} They're lit up already, so don't call show_suggestions for them.`
const SHOW_RULE =
  '- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.'
const PAIRING_RULE =
  '- When asked what goes with something, call show_suggestions with the items in its pairsWith, one of each, titled like "Goes with the Classic Cheeseburger", then name them in one short sentence. When asked what you recommend, unless it\'s for a group, do the same with two or three popular items, titled "Our favourites". Never name pairings or recommendations without showing them.'
const PAIRING_RULE_WITHOUT_CARD =
  '- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.'
// The app says "Let me put something together." as a plan starts (ClientTools.tsx); a line of the agent's own would come first.
const GROUP_QUESTION =
  '- For a group, if the customer hasn\'t said what they like, ask one short question that covers it, such as "Any vegetarians, and pizza, subs or a mix?", then call plan_group_order with what you know. Never ask a second question before the plan. When you call plan_group_order, say nothing with it: "Let me put something together." is said for you while it plans.'
const PLAN_SUMMARY =
  'To present the plan, before anything is added, sum it up from its summary in one short sentence, the way a person would ("Eight large pizzas, three of them veggie, plus garlic knots and sodas"), then say its totalSpoken and that it\'s on screen; don\'t list its lines or do the math out loud.'
// In the owner's run the agent had no way to plan to a budget, and called the same plan "the best estimate" (2026-11-11).
const PLAN_BUDGET =
  "If they give a budget, before the plan or after it, call plan_group_order with it, then say in a few words what it took to fit, from the result's budget, and the total."
const PLAN_CHANGES =
  'The plan is already on screen, so call show_suggestions only when the customer asks to change it ("swap a pepperoni for a margherita"), with the changed lines.'
const PLAN_ADD = 'Add it with add_items only after they agree, then name every line it added, one by one, as after any change.'
const PLAN_ADD_BY_TAPPING = 'Tell them they can add it by tapping Add all to cart on the card.'
const GROUP_RULE = [GROUP_QUESTION, PLAN_SUMMARY, PLAN_BUDGET, PLAN_CHANGES, PLAN_ADD].join(' ')
const OFFER_RULE =
  '- Offer one pairing on your own at most once per order, after the first item is added, in one short question. When the customer asks for suggestions, always help.'
const VIEW_CART_RULE =
  "- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result."
// The checkout line says the amount checkout returns, so every path to Stripe ends on it (review round 3, .build/step-5b.md).
const SAY_AT_CHECKOUT_TEXT =
  'say "Taking you to checkout now so you can pay", then the totalSpoken it returned, word for word (for delivery it already has the fee in it), then, for delivery only, "and enter your delivery address", as one sentence: for pickup "Taking you to checkout now so you can pay forty-one ninety-eight.", for delivery "Taking you to checkout now so you can pay forty-five ninety-seven and enter your delivery address."'
const NOT_PLACED_YET_TEXT = "Never say the order is placed, done or confirmed: it isn't until they pay."
const DONE_RULE = `- When the customer is done, read back the order and total from view_cart, then call checkout when they confirm, and when it returns ok, ${SAY_AT_CHECKOUT_TEXT} ${NOT_PLACED_YET_TEXT}`

const SPEC_DRAFT_RULES = [
  ORDER_TYPE_RULE,
  CHANGE_RULE,
  CONFIRM_RULE,
  SPOKEN_TOTAL_RULE,
  DELIVERY_TOTAL_RULE,
  SIZE_RULE,
  FIND_RULE,
  SHOW_RULE,
  PAIRING_RULE,
  GROUP_RULE,
  OFFER_RULE,
  "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
  '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
  VIEW_CART_RULE,
  DONE_RULE,
]

// The group rule for a session without plan_group_order: the agent plans from serves itself.
const GROUP_RULE_WITHOUT_PLANNER =
  "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and add it with add_items only after they agree."

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

// The tool names a prompt mentions. A snake_case name counts wherever it
// stands as a whole identifier (`add_item` isn't found in `add_items`). A
// one-word name is plain English too ("pay at checkout", "Taking you to
// checkout now", the Checkout button), so it counts only where a rule calls
// it: "call checkout".
function toolsNamedIn(text: string): string[] {
  return toolNames.filter((name) => new RegExp(name.includes('_') ? `\\b${name}\\b` : `\\bcall ${name}\\b`).test(text))
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

Conversation started. Order type: not chosen yet. Cart: empty.`)
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
      '- Offer one pairing on your own at most once per order, after the first item is added, in one short question. When the customer asks for suggestions, always help.',
      "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
      '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
      `- Answer anything about what's in the cart or the total from the last "Cart:" line you were given, and say the cart on screen is the up-to-date one, since the customer can change it by tapping.`,
      '- When the customer is done, tell them to tap Checkout in the cart.',
      NO_STALLS_WITHOUT_TOOLS,
    ])
  })

  it('names exactly the tools the SPEC draft names when it has them all', () => {
    expect(rulesOf(fullPrompt)).toEqual([...SPEC_DRAFT_RULES, NO_STALLS_WITH_TOOLS])
    expect(toolsNamedIn(fullPrompt)).toEqual([
      'find_menu_items',
      'show_suggestions',
      'plan_group_order',
      'add_items',
      'view_cart',
      'set_order_type',
      'checkout',
    ])
  })

  // toolsNamedIn counts a one-word tool name only after "call". Any other use of
  // the word in the rules has to be plain English ("at checkout", "to checkout
  // now"), or the tests that use it would miss a tool.
  it('names every one-word tool after "call", so toolsNamedIn finds it', () => {
    for (const name of toolNames.filter((name) => !name.includes('_'))) {
      const mentions = rulesOf(fullPrompt).join('\n').match(new RegExp(`\\b\\w+ ${name}\\b`, 'g')) ?? []
      expect(mentions.filter((words) => !/^(at|to) /.test(words)), name).toEqual(mentions.filter((words) => words.startsWith('call ')))
      expect(mentions, name).toContain(`call ${name}`)
    }
  })

  it.each(toolNames)('mentions %s only when the session has it', (name) => {
    expect(toolsNamedIn(agentInstructions(emptyCart, allBut(name)))).not.toContain(name)
    const alone = toolsNamedIn(agentInstructions(emptyCart, only(name)))
    expect(alone).toEqual(toolsNamedIn(fullPrompt).includes(name) ? [name] : [])
  })

  it("keeps each of the draft's tool rules only while the session has the tools it names", () => {
    expect(rulesOf(agentInstructions(emptyCart, only('find_menu_items')))).toContain(FIND_RULE_START)
    expect(rulesOf(agentInstructions(emptyCart, only('find_menu_items', 'show_suggestions')))).toContain(FIND_RULE)
    expect(rulesOf(agentInstructions(emptyCart, allBut('find_menu_items'))).join('\n')).not.toContain(FIND_RULE_START)
    expect(rulesOf(agentInstructions(emptyCart, only('show_suggestions')))).toEqual(expect.arrayContaining([SHOW_RULE, PAIRING_RULE]))
    expect(rulesOf(agentInstructions(emptyCart, allBut('show_suggestions')))).not.toContain(SHOW_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('plan_group_order', 'show_suggestions', 'add_items')))).toContain(GROUP_RULE)
    expect(rulesOf(agentInstructions(emptyCart, allBut('plan_group_order')))).not.toContain(GROUP_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('view_cart')))).toContain(VIEW_CART_RULE)
    expect(rulesOf(agentInstructions(emptyCart, allBut('view_cart')))).not.toContain(VIEW_CART_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('view_cart', 'checkout')))).toContain(DONE_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('set_order_type', 'checkout', 'add_item', 'view_cart')))).toContain(ORDER_TYPE_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('set_order_type', 'checkout', 'add_item')))).toContain(ORDER_TYPE_RULE)
    expect(rulesOf(agentInstructions(emptyCart, only('set_order_type', 'checkout')))).toContain(
      ORDER_TYPE_RULE_START + ORDER_TYPE_RULE_CHECKOUT + ORDER_TYPE_RULE_ASK_FIRST + ORDER_TYPE_RULE_END,
    )
    expect(rulesOf(agentInstructions(emptyCart, only('checkout')))).toContain(
      `- When the customer is done, call checkout when they confirm, and when it returns ok, ${SAY_AT_CHECKOUT_TEXT} ${NOT_PLACED_YET_TEXT}`,
    )
    expect(rulesOf(agentInstructions(emptyCart, only('set_order_type')))).toContain(
      ORDER_TYPE_RULE_START + '.' + ORDER_TYPE_RULE_ASK_FIRST + ORDER_TYPE_RULE_END,
    )
    expect(rulesOf(agentInstructions(emptyCart, only('set_order_type', 'add_item')))).toContain(
      ORDER_TYPE_RULE_START + '.' + ORDER_TYPE_RULE_ADD_FIRST + ORDER_TYPE_RULE_END,
    )
    expect(rulesOf(agentInstructions(emptyCart, allBut('set_order_type'))).join('\n')).not.toContain('pickup or delivery')
  })

  it.each(CART_TOOLS)('keeps the cart-change rules, and drops the cart from the safeguard, with %s', (name) => {
    const rules = rulesOf(agentInstructions(emptyCart, only(name)))
    expect(rules).toEqual(expect.arrayContaining([CHANGE_RULE, SIZE_RULE, SPOKEN_TOTAL_RULE, DELIVERY_TOTAL_RULE]))
    expect(rules).toContain(name === 'add_items' ? CONFIRM_RULE : CONFIRM_RULE_START)
    expect(rules.join('\n')).not.toContain('add, change or remove anything in the cart')
  })

  it('without the cart tools, drops the cart-change rules and says only what is missing', () => {
    const rules = rulesOf(agentInstructions(emptyCart, allBut(...CART_TOOLS)))
    for (const rule of [CHANGE_RULE, CONFIRM_RULE, SIZE_RULE]) expect(rules).not.toContain(rule)
    // view_cart still returns the cart, so the delivery total stays.
    expect(rules).toContain(DELIVERY_TOTAL_RULE)
    expect(rules.join('\n')).not.toContain(CONFIRM_RULE_START)
    expect(rules[0]).toBe(
      "- You can't add, change or remove anything in the cart right now. If the customer asks, start by saying you can't do that yet, then tell them they can tap Add on the menu, all in one sentence. Never say you're adding, or that you did.",
    )
    expect(rules).toContain([GROUP_QUESTION, PLAN_SUMMARY, PLAN_BUDGET, PLAN_CHANGES, PLAN_ADD_BY_TAPPING].join(' '))
    expect(rulesOf(agentInstructions(emptyCart, allBut('plan_group_order', ...CART_TOOLS)))).toContain(
      "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and tell them they can add it by tapping Add on the menu.",
    )
  })

  it('with plan_group_order, leaves the math to the tool and asks for one short sentence; without it, keeps the rule from before', () => {
    const groupRule = (tools: ToolDefinition[]) => rulesOf(agentInstructions(emptyCart, tools)).find((rule) => rule.startsWith('- For a group'))
    expect(groupRule(toolDefinitions)).toBe(GROUP_RULE)
    expect(groupRule(allBut('plan_group_order'))).toBe(GROUP_RULE_WITHOUT_PLANNER)
    // The rest of the prompt doesn't change with it.
    expect(agentInstructions(emptyCart, allBut('plan_group_order')).replace(GROUP_RULE_WITHOUT_PLANNER, GROUP_RULE)).toBe(fullPrompt)
    // Each part follows its own tool.
    expect(groupRule(only('plan_group_order'))).toBe([GROUP_QUESTION, PLAN_SUMMARY, PLAN_BUDGET, PLAN_ADD_BY_TAPPING].join(' '))
  })

  // In step 5's Check the agent asked "how many vegetarians or spicy?", then "pizza, subs or a mix?", before planning.
  it('asks a group one question at most, covering the vegetarians and the mains, before plan_group_order', () => {
    expect(GROUP_RULE).toContain('ask one short question that covers it, such as "Any vegetarians, and pizza, subs or a mix?"')
    expect(GROUP_RULE).toContain('Never ask a second question before the plan.')
    // The mains in the question are the ones plan_group_order takes.
    expect(GROUP_MAINS).toEqual(['pizza', 'subs', 'mix'])
    expect(toolDefinitions.find((tool) => tool.name === 'plan_group_order')?.description).toContain(
      'after one short question about what they like at most',
    )
  })

  // The owner wants every line read back after "add all of that"; the one-sentence summary is for the plan before it's added.
  it('confirms every line add_items added, a group plan included, and sums up a plan only before it is added', () => {
    expect(rulesOf(fullPrompt)).toContain(CONFIRM_RULE)
    expect(CONFIRM_RULE).toContain('After add_items, name every line it added, one by one')
    expect(CONFIRM_RULE).toContain('a whole group plan included, even if it takes more than two sentences; never sum them up.')
    // The group rule says when the summary applies, and sends the add back to the confirmation.
    expect(PLAN_SUMMARY.startsWith('To present the plan, before anything is added, sum it up')).toBe(true)
    expect(GROUP_RULE.endsWith('Add it with add_items only after they agree, then name every line it added, one by one, as after any change.')).toBe(true)
    // Nothing anywhere says not to read every line, except while presenting the plan.
    const notListing = fullPrompt.split(/(?<=\.)\s+/).filter((sentence) => /don't list|never read out|not.*every line/i.test(sentence))
    expect(notListing).toEqual([expect.stringMatching(/^To present the plan, before anything is added,/)])
    expect(toolDefinitions.find((tool) => tool.name === 'add_items')?.description).toContain(
      'Then name every line it added, one by one, with quantity, size and name, and the new total.',
    )
  })

  // In step 5's Check the agent twice said "The cheeseburger pairs great with fries and a fountain soda" with no card.
  it('shows pairings and recommendations on the card, with show_suggestions', () => {
    expect(rulesOf(fullPrompt)).toContain(PAIRING_RULE)
    expect(PAIRING_RULE).toContain('call show_suggestions with the items in its pairsWith')
    expect(PAIRING_RULE).toContain('titled like "Goes with the Classic Cheeseburger"')
    expect(PAIRING_RULE).toContain('do the same with two or three popular items')
    // Its description doesn't say "call it whenever you suggest items": with that, "What's vegetarian?" opened a card too.
    expect(toolDefinitions.find((tool) => tool.name === 'show_suggestions')?.description).not.toMatch(/whenever/)
    // In a text run with these rules, "What's vegetarian?" also opened a card of three pizzas: the highlights are enough.
    expect(FIND_RULE).toContain("They're lit up already, so don't call show_suggestions for them.")
    expect(toolDefinitions.find((tool) => tool.name === 'find_menu_items')?.description).toContain(
      "The matching items light up on screen, which is enough: don't also show them with show_suggestions.",
    )
    // Without the card, it answers from pairsWith out loud, as before.
    const rules = rulesOf(agentInstructions(emptyCart, allBut('show_suggestions')))
    expect(rules).toContain(PAIRING_RULE_WITHOUT_CARD)
    expect(rules).not.toContain(PAIRING_RULE)
  })

  // In step 5's Check the agent said $20.99 as "twenty oh nine nine".
  it('says totals as the spoken total the tools return, whenever a tool returns one', () => {
    expect(rulesOf(fullPrompt)).toContain(SPOKEN_TOTAL_RULE)
    for (const name of [...CART_TOOLS, 'view_cart', 'show_suggestions', 'plan_group_order', 'checkout'] as const) {
      expect(rulesOf(agentInstructions(emptyCart, only(name))), name).toContain(SPOKEN_TOTAL_RULE)
    }
    for (const tools of [[], only('find_menu_items', 'set_order_type')]) {
      expect(rulesOf(agentInstructions(emptyCart, tools))).not.toContain(SPOKEN_TOTAL_RULE)
    }
  })

  it('with checkout, says the customer is going to pay the amount checkout returned, and never that the order is placed', () => {
    const rule = rulesOf(fullPrompt).find((line) => line.startsWith('- When the customer is done'))
    expect(rule).toContain(`call checkout when they confirm, and when it returns ok, ${SAY_AT_CHECKOUT_TEXT}`)
    expect(rule).toContain(NOT_PLACED_YET_TEXT)
    // The tool's own description says the same, so the agent reads it where it calls the tool.
    const checkout = toolDefinitions.find((tool) => tool.name === 'checkout')
    expect(checkout?.description).toBe(
      `Send the customer to the payment page, once they have confirmed their order. When it returns ok, ${SAY_AT_CHECKOUT_TEXT} ${NOT_PLACED_YET_TEXT} The page leaves as soon as you stop speaking.`,
    )
  })

  // Review round 3: three delivery paths reached Stripe without the total with
  // the fee said once, so the line every path ends on says it.
  it("puts the amount in the checkout line, from checkout's totalSpoken, and the address for delivery", () => {
    // The examples are the lines for two large margheritas, with the amounts checkout returns for them.
    const pickup = summarizeCart({ 'margherita-pizza-large': 2 }, 'pickup')
    const delivery = summarizeCart({ 'margherita-pizza-large': 2 }, 'delivery').delivery
    expect(checkoutLine(pickup.totalSpoken, 'pickup')).toBe('Taking you to checkout now so you can pay forty-one ninety-eight.')
    expect(checkoutLine(delivery?.totalWithDeliverySpoken ?? '', 'delivery')).toBe(
      'Taking you to checkout now so you can pay forty-five ninety-seven and enter your delivery address.',
    )
    expect(SAY_AT_CHECKOUT).toBe(SAY_AT_CHECKOUT_TEXT)
    expect(SAY_AT_CHECKOUT).toContain(`for pickup "${checkoutLine(pickup.totalSpoken, 'pickup')}"`)
    expect(SAY_AT_CHECKOUT).toContain(`for delivery "${checkoutLine(delivery?.totalWithDeliverySpoken ?? '', 'delivery')}"`)
    // Still never placed, done or confirmed.
    expect(DONE_RULE).not.toMatch(/"[^"]*\b(placed|done|confirmed)\b[^"]*"/)
  })

  // The agent said "forty-one ninety-eight" for a delivery order, and Stripe charged $45.97 (.build/step-5b.md).
  it('for delivery, says the total with the fee named, from the delivery the cart results carry', () => {
    expect(rulesOf(fullPrompt)).toContain(DELIVERY_TOTAL_RULE)
    // The example is what the tools return for two large margheritas, with the fee from the shop settings.
    const { totalSpoken, delivery } = summarizeCart({ 'margherita-pizza-large': 2 }, 'delivery')
    expect(DELIVERY_TOTAL_RULE).toContain(
      `"${totalSpoken}, plus ${delivery?.feeSpoken} for delivery, ${delivery?.totalWithDeliverySpoken} in all"`,
    )
    // Only with a tool that returns the cart, or a plan, which a budget counts the fee for; the card's totals have no fee.
    for (const name of [...CART_TOOLS, 'view_cart', 'plan_group_order'] as const) {
      expect(rulesOf(agentInstructions(emptyCart, only(name))), name).toContain(DELIVERY_TOTAL_RULE)
    }
    for (const tools of [[], only('show_suggestions', 'find_menu_items', 'set_order_type', 'checkout')]) {
      expect(rulesOf(agentInstructions(emptyCart, tools))).not.toContain(DELIVERY_TOTAL_RULE)
    }
  })

  it('after plan_group_order, keeps show_suggestions for changes the customer asks for, since the plan is on screen', () => {
    const groupRule = rulesOf(fullPrompt).find((line) => line.startsWith('- For a group'))
    expect(groupRule).toContain('The plan is already on screen, so call show_suggestions only when the customer asks to change it')
    expect(toolDefinitions.find((tool) => tool.name === 'plan_group_order')?.description).toContain(
      "don't call show_suggestions after it unless the customer asks for a change",
    )
  })

  it('has view_cart called before answers about the cart, even right after a tap update', () => {
    expect(rulesOf(fullPrompt)).toContain(VIEW_CART_RULE)
    expect(toolDefinitions.find((tool) => tool.name === 'view_cart')?.description).toBe(
      "Read what's in the cart and the total. Call it before answering any question about what's in the cart or the total, even right after you were told the customer tapped something.",
    )
    expect(describeTapChange({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] }, summarizeCart({ fries: 1 }), null)).toBe(
      'Customer added 1 × Fries by tapping. Order type: not chosen yet. Cart: 1 × Fries. Total $4.99. Call view_cart before answering about the cart.',
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

  it('ends with the order as the session starts, in the words the tap updates use', () => {
    expect(prompt.endsWith('\n\nConversation started. Cart: empty.')).toBe(true)

    // The cart as the voice session summarizes it at the press: with the order type, so a delivery cart has the fee.
    const cartFor = (orderType: 'pickup' | 'delivery' | null) => summarizeCart({ 'margherita-pizza-large': 1 }, orderType)
    const lastLine = (tools: ToolDefinition[], orderType: 'pickup' | 'delivery' | null = null) =>
      agentInstructions(cartFor(orderType), tools, orderType).split('\n').at(-1)
    expect(lastLine(toolDefinitions)).toBe('Conversation started. Order type: not chosen yet. Cart: 1 × Large Margherita Pizza. Total $20.99.')
    expect(lastLine(toolDefinitions, 'pickup')).toBe('Conversation started. Order type: pickup. Cart: 1 × Large Margherita Pizza. Total $20.99.')
    expect(lastLine(toolDefinitions, 'pickup')).toBe(`Conversation started. ${describeOrderType('pickup')} ${describeCart(cartFor('pickup'))}`)
    // "Order type:" only with the tool that records it. The cart's total is still what Stripe will charge.
    for (const tools of [[], allBut('set_order_type')]) {
      expect(lastLine(tools, null)).toBe('Conversation started. Cart: 1 × Large Margherita Pizza. Total $20.99.')
      expect(lastLine(tools, 'delivery')).toBe('Conversation started. Cart: 1 × Large Margherita Pizza. Total $20.99, $24.98 with delivery.')
    }
    expect(describeTapChange({ type: 'remove', id: 'fries' }, cartFor('delivery'), 'delivery')).toBe(
      `Customer removed Fries by tapping. ${describeOrderType('delivery')} ${describeCart(cartFor('delivery'))} ${CALL_VIEW_CART}`,
    )
  })

  // In the voice check of checkout paths (.build/step-5b.md) the agent said "for twenty dollars ninety-nine" on a
  // delivery order, from this line, without calling view_cart. Stripe charges the total with the fee.
  it('for delivery, ends with the total with the fee as well as the items total', () => {
    const cart = summarizeCart({ 'pepperoni-pizza-large': 1 }, 'delivery')
    expect(agentInstructions(cart, toolDefinitions, 'delivery').split('\n').at(-1)).toBe(
      'Conversation started. Order type: delivery. Cart: 1 × Large Pepperoni Pizza. Total $20.99, $24.98 with delivery.',
    )
    expect(agentInstructions(summarizeCart({}, 'delivery'), toolDefinitions, 'delivery').endsWith('\n\nConversation started. Order type: delivery. Cart: empty.')).toBe(true)
  })

  it('asks pickup or delivery, records it with set_order_type, and never takes an address by voice', () => {
    expect(rulesOf(fullPrompt)[0]).toBe(ORDER_TYPE_RULE)
    // The owner's lines (.build/step-5b.md).
    expect(ORDER_TYPE_RULE).toContain('"Great, delivery it is. What can I get you?"')
    expect(ORDER_TYPE_RULE).toContain('"You\'ll enter the delivery address at checkout."')
    expect(ORDER_TYPE_RULE).toContain('never take an address by voice')
    // After checkout asked for it, the answer goes on to checkout, which the tool refuses until it's set.
    // The checkout line says the amount, the fee included for delivery, so the rule needs no view_cart first.
    expect(ORDER_TYPE_RULE).toContain('if they were checking out, call checkout next.')
    expect(ORDER_TYPE_RULE).not.toContain('view_cart')
    // An order before the choice is added at once, then the question asked once: never held, never promised for later.
    expect(ORDER_TYPE_RULE).toContain('add it with its tool right away and confirm it as usual, then ask "Pickup or delivery?" once, in the same reply')
    expect(ORDER_TYPE_RULE).toContain('never hold an item until they answer, or promise to add it later')
    // In a text run it also recorded "pickup" on its own, before the customer said.
    expect(ORDER_TYPE_RULE).toContain("don't call set_order_type until they say which.")
    // The fee, from the shop settings, said the way the totals are.
    expect(spokenPrice(DELIVERY_FEE)).toBe('three ninety-nine')
    expect(ORDER_TYPE_RULE).toContain(`delivery adds a flat ${spokenPrice(DELIVERY_FEE)} at checkout.`)
    expect(toolDefinitions.find((tool) => tool.name === 'set_order_type')?.description).toContain('once the customer says which')
  })

  // Deepgram's limit, with every product in the cart, is checked in src/voice/agentSettings.test.ts. This is
  // our own guard against the rules growing unnoticed: 12,000 until the budget and the line said before a
  // plan (2026-11-11) took the full prompt just past it.
  it('stays compact: under 13,000 characters with an empty cart', () => {
    expect(prompt.length).toBeLessThan(13_000)
    expect(fullPrompt.length).toBeLessThan(13_000)
  })
})
