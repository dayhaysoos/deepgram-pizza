// What the voice agent is told: its greeting, and its instructions (who it is,
// how it talks, the menu it knows and the rules it follows). The voice session
// sends both when it connects. Like tools.ts beside it, this module imports
// nothing from React, Deepgram or the server, so evals can load it on its own.
//
// The rules follow the session's tools: a rule that names a tool is there only
// when the session has that tool, and whatever the agent can't do without its
// tools, it's told to say so. Pass the same list the session registers as
// functions (src/voice/agentSettings.ts does), so the prompt never mentions a
// tool the agent can't call. With every tool, the rules are SPEC.md's draft.
//
// To make it your own shop: set SHOP_NAME in src/shop.ts and edit menu.json;
// the greeting, the instructions and the menu text follow. Then rewrite the
// persona and rules in `agentInstructions` to match how your counter talks.
// Keep the rules that name tools in step with tools.ts.

import { categories, formatPrice, menu, type CategoryInfo, type MenuItem, type Variant } from '../menu/menu'
import { SHOP_NAME } from '../shop'
import { describeCart, type CartSummary } from './cartSummary'
import type { ToolDefinition, ToolName } from './tools'

/** What the agent says first, as soon as the session opens. */
export const GREETING = `Hey, welcome to ${SHOP_NAME}! What can I get started for you?`

/** The tools that change the cart. With any of them, the cart-change rules apply. */
const CART_TOOLS: readonly ToolName[] = ['add_item', 'add_items', 'set_quantity', 'remove_item', 'clear_cart']

type HasTool = (name: ToolName) => boolean

/**
 * The agent's instructions for a session that starts with this cart and can
 * call these tools: pass `summarizeCart(quantitiesOf(cartDetails))`, and the
 * tools the session sends as functions (none in step 4, `toolDefinitions`
 * from step 5). They end with the cart in the words the tap updates use, so
 * the updates sent mid-session read as what happened next.
 */
export function agentInstructions(cart: CartSummary, tools: readonly ToolDefinition[] = []): string {
  const names = new Set<string>(tools.map((tool) => tool.name))
  const has: HasTool = (name) => names.has(name)
  const changesCart = CART_TOOLS.some(has)

  // SPEC.md's draft, in its order. A rule that names a tool is kept only when
  // the session has that tool; some have a version for a session without it.
  const rules = compact([
    safeguardRule(has, changesCart),
    changesCart && '- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.',
    changesCart && '- After each change, confirm it with the quantity, size and name, then the new total from the tool result.',
    changesCart && '- If a sized item has no size, ask which size before adding it.',
    has('find_menu_items')
      ? '- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.'
      : '- When the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), name two or three matching items.',
    has('show_suggestions') &&
      '- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.',
    '- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.',
    groupRule(has),
    '- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.',
    "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
    '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
    has('view_cart')
      ? "- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result."
      : `- Answer anything about what's in the cart or the total from the last "Cart:" line you were given, and say the cart on screen is the up-to-date one, since the customer can change it by tapping.`,
    '- When the customer is done, ' +
      (has('view_cart') ? 'read back the order and total from view_cart, then ' : '') +
      (has('checkout') ? 'call checkout when they confirm.' : 'tell them to tap Checkout in the cart.'),
    '- Never end a reply by promising to do something later ("give me a sec", "let me check"). ' +
      (tools.length > 0 ? 'Either do it now with a tool, or answer now.' : 'Answer now.'),
  ])

  return `You work the counter at ${SHOP_NAME}, a classic neighbourhood pizzeria. You're friendly and quick, like someone who's done this a thousand times.

Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").

You only know this menu:
${describeMenu()}

Rules:
${rules.join('\n')}

Conversation started. ${describeCart(cart)}`
}

// For a group. With plan_group_order the code works out the plan and the agent
// only sums it up: in the owner's run the agent did the math itself, proposed
// about twice the food for thirty people, and took three long sentences to say
// so. Without it, the agent plans from each item's serves, as SPEC's draft said.
function groupRule(has: HasTool): string {
  if (!has('plan_group_order')) {
    return (
      "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. " +
      (has('show_suggestions') ? 'Show the plan with show_suggestions, say the total, and ' : 'Describe the plan out loud, then ') +
      (has('add_items') ? 'add it with add_items only after they agree.' : 'tell them they can add it by tapping Add on the menu.')
    )
  }
  return compact([
    '- For a group, ask at most one short question about preferences, then call plan_group_order.',
    `Sum up the plan from its summary in one short sentence, the way a person would ("Eight large pizzas, three of them veggie, plus garlic knots and sodas"), then say the total and that it's on screen.`,
    'Never read out every line or do the math out loud.',
    has('show_suggestions') && 'To change the plan ("swap a pepperoni for a margherita"), call show_suggestions with the changed lines.',
    has('add_items') ? 'Add it with add_items only after they agree.' : 'Tell them they can add it by tapping Add all on the card.',
  ]).join(' ')
}

// What the agent can't do without its tools, so it says so instead of
// pretending: in the owner's step 4 run, with no tools, the agent said
// "Adding 5 large pepperoni pizzas now" while nothing was added, and in a
// later run answered "add two margheritas" with only "You can tap Add". So it
// leads with what it can't do, and may not claim it did it either. Undefined
// when it can change the cart, show items and check the customer out.
function safeguardRule(has: HasTool, changesCart: boolean): string | undefined {
  const showsItems = has('find_menu_items') || has('show_suggestions') || has('plan_group_order')
  const cant = compact([
    !changesCart && 'add, change or remove anything in the cart',
    !showsItems && 'show items on screen',
    !has('checkout') && 'check the customer out',
  ])
  if (cant.length === 0) return undefined

  const taps = compact([!changesCart && 'Add on the menu', !has('checkout') && 'Checkout in the cart'])
  const pretending = compact([
    !changesCart && 'adding',
    !showsItems && 'showing',
    !has('view_cart') && 'checking',
    !has('find_menu_items') && 'looking something up',
  ])
  const tapInstead = taps.length > 0 ? `, then tell them they can tap ${taps.join(' and ')}, all in one sentence` : ', in one sentence'
  return compact([
    `- You can't ${orList(cant)} right now.`,
    `If the customer asks, start by saying you can't do that yet${tapInstead}.`,
    pretending.length > 0 && `Never say you're ${orList(pretending)}, or that you did.`,
  ]).join(' ')
}

// The phrases whose condition held: `cond && 'text'` leaves false when it didn't.
function compact(phrases: Array<string | false | undefined>): string[] {
  return phrases.filter((phrase) => typeof phrase === 'string')
}

// "a, b or c", the way the rules list things.
function orList(phrases: string[]): string {
  return phrases.length > 1 ? `${phrases.slice(0, -1).join(', ')} or ${phrases.at(-1)}` : phrases.join('')
}

/**
 * The menu as the agent reads it, built from menu.json: a heading per
 * category, in the menu's order, then one line per item, with each size's id
 * (the id the tools take), price and how many it serves.
 *
 *     Pizza (category pizza, Medium 14″ · Large 18″):
 *     Cheese Pizza [item cheese-pizza]: Tomato sauce and … Tags: vegetarian, popular. Medium: id cheese-pizza-medium, $15.99, serves 2. Large: id cheese-pizza-large, $18.99, serves 4. Pairs with Garlic Knots (6), Fountain Soda.
 */
export function describeMenu(): string {
  const names = new Map(menu.map((item) => [item.id, item.name]))
  const sections = (categories as readonly CategoryInfo[]).flatMap((category) => {
    const items = menu.filter((item) => item.category === category.id)
    if (items.length === 0) return []
    const heading = `${category.label} (category ${category.id}${category.note ? `, ${category.note}` : ''}):`
    return [[heading, ...items.map((item) => describeItem(item, names))].join('\n')]
  })
  return sections.join('\n\n')
}

function describeItem(item: MenuItem, names: Map<string, string>): string {
  const parts = [`${item.name} [item ${item.id}]: ${item.description}`]
  if (item.tags.length > 0) parts.push(`Tags: ${item.tags.join(', ')}.`)
  parts.push(...item.variants.map(describeVariant))
  if (item.pairsWith.length > 0) parts.push(`Pairs with ${item.pairsWith.map((id) => names.get(id) ?? id).join(', ')}.`)
  return parts.join(' ')
}

// "Large: id cheese-pizza-large, $18.99, serves 4." An item with one size has no label.
function describeVariant(variant: Variant): string {
  return `${variant.label ?? 'One size'}: id ${variant.id}, ${formatPrice(variant.price)}, serves ${variant.serves}.`
}
