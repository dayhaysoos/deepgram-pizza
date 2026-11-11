// What the voice agent is told: its greeting, and its instructions (who it is,
// how it talks, the menu it knows and the rules it follows). The voice session
// builds both from the cart and the pickup-or-delivery choice when the
// customer presses the talk button, and sends them when it connects. Like
// tools.ts beside it, this module imports nothing from React, Deepgram or the
// server, so evals can load it on its own.
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
import { DELIVERY_FEE, SHOP_NAME, type OrderType } from '../shop'
import { describeCart, type CartSummary } from './cartSummary'
import { describeOrderType } from './orderType'
import { spokenPrice } from './spokenPrice'
import { orList } from './text'
import { GROUP_MAINS, NOT_PLACED_YET, SAY_AT_CHECKOUT, type ToolDefinition, type ToolName } from './tools'

/**
 * What the agent says first, as soon as the session opens: the owner wants it
 * to ask pickup or delivery every time, or to confirm the choice already made
 * (in the cart, or in an earlier session). Without set_order_type to record
 * the answer, it doesn't ask.
 */
export function greeting(orderType: OrderType | null, tools: readonly ToolDefinition[] = []): string {
  const welcome = `Hey, welcome to ${SHOP_NAME}!`
  if (!tools.some((tool) => tool.name === 'set_order_type')) return `${welcome} What can I get started for you?`
  return orderType ? `${welcome} Still ${orderType} today?` : `${welcome} Is this for pickup or delivery?`
}

/** The tools that change the cart. With any of them, the cart-change rules apply. */
const CART_TOOLS: readonly ToolName[] = ['add_item', 'add_items', 'set_quantity', 'remove_item', 'clear_cart']

/** The tools that return the cart, which for delivery carries the fee and the total with it (cartSummary.ts). */
const CART_READ_TOOLS: readonly ToolName[] = [...CART_TOOLS, 'view_cart']

/** The tools whose result has a total, and so a `totalSpoken` (spokenPrice.ts) for the agent to say. */
const TOTAL_TOOLS: readonly ToolName[] = [...CART_READ_TOOLS, 'show_suggestions', 'plan_group_order']

/** Two large margheritas: the cart the delivery rule's example is said for. */
const EXAMPLE_CART_CENTS = 4198

type HasTool = (name: ToolName) => boolean

/**
 * The agent's instructions for a session that starts with this cart and
 * pickup-or-delivery choice, and can call these tools: pass
 * `summarizeCart(quantitiesOf(cartDetails))`, the tools the session sends as
 * functions (none in step 4, `toolDefinitions` from step 5), and the choice
 * (null before there is one). They end with the order in the words the tap
 * updates use, so the updates sent mid-session read as what happened next.
 */
export function agentInstructions(
  cart: CartSummary,
  tools: readonly ToolDefinition[] = [],
  orderType: OrderType | null = null,
): string {
  const names = new Set<string>(tools.map((tool) => tool.name))
  const has: HasTool = (name) => names.has(name)
  const changesCart = CART_TOOLS.some(has)

  // SPEC.md's draft, in its order. A rule that names a tool is kept only when
  // the session has that tool; some have a version for a session without it.
  const rules = compact([
    safeguardRule(has, changesCart),
    has('set_order_type') && orderTypeRule(has, changesCart),
    changesCart && '- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.',
    changesCart && confirmRule(has),
    // In step 5's Check the agent wrote $20.99 as "twenty oh nine nine".
    TOTAL_TOOLS.some(has) &&
      '- Say every total exactly as the totalSpoken in the tool result gives it, word for word, even a long one ("two hundred ninety-seven dollars and fifty-six cents"); never turn the digits in total into words yourself.',
    CART_READ_TOOLS.some(has) && deliveryTotalRule(),
    changesCart && '- If a sized item has no size, ask which size before adding it.',
    has('find_menu_items')
      ? '- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.' +
        // In a text run, "What's vegetarian?" also opened a card of three pizzas once the pairing rule said to show suggestions.
        (has('show_suggestions') ? " They're lit up already, so don't call show_suggestions for them." : '')
      : '- When the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), name two or three matching items.',
    has('show_suggestions') &&
      '- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.',
    pairingRule(has),
    groupRule(has),
    '- Offer one pairing on your own at most once per order, after the first item is added, in one short question. When the customer asks for suggestions, always help.',
    "- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.",
    '- If the conversation goes off topic, answer in one friendly line and steer back to the order.',
    has('view_cart')
      ? "- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result."
      : `- Answer anything about what's in the cart or the total from the last "Cart:" line you were given, and say the cart on screen is the up-to-date one, since the customer can change it by tapping.`,
    '- When the customer is done, ' +
      (has('view_cart') ? 'read back the order and total from view_cart, then ' : '') +
      (has('checkout')
        ? `call checkout when they confirm and ${SAY_AT_CHECKOUT} ${NOT_PLACED_YET}`
        : 'tell them to tap Checkout in the cart.'),
    '- Never end a reply by promising to do something later ("give me a sec", "let me check"). ' +
      (tools.length > 0 ? 'Either do it now with a tool, or answer now.' : 'Answer now.'),
  ])

  return `You work the counter at ${SHOP_NAME}, a classic neighbourhood pizzeria. You're friendly and quick, like someone who's done this a thousand times.

Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").

You only know this menu:
${describeMenu()}

Rules:
${rules.join('\n')}

Conversation started. ${has('set_order_type') ? `${describeOrderType(orderType)} ` : ''}${describeCart(cart)}`
}

// Pickup or delivery (the owner's flow, .build/step-5b.md): the greeting
// asks, and the answer is recorded with set_order_type, then one short line
// moves on to the order. checkout refuses until it's set, so an answer given
// at that point goes back to checkout, after the total with the fee for
// delivery (review round 2: that path never said the fee). An order that comes first is
// added at once: in the voice check, "Add a large cheese pizza" before the
// choice got no tool call and "I'll get that added for you right after." No
// address by voice: Stripe's page asks for it. The fee, from the shop
// settings, is said when asked, and in every delivery total (below).
function orderTypeRule(has: HasTool, changesCart: boolean): string {
  return [
    '- Every order is pickup or delivery. When the customer says which, call set_order_type, then say one short line like "Great, delivery it is. What can I get you?"' +
      (has('checkout')
        ? ', or if they were checking out, call checkout next' +
          (has('view_cart') ? '; for delivery, first call view_cart and say the total with the fee.' : '.')
        : '.'),
    changesCart
      ? `If they order something before saying which, add it with its tool right away and confirm it as usual, then ask "Pickup or delivery?" once, in the same reply; never hold an item until they answer, or promise to add it later, and don't call set_order_type until they say which.`
      : 'If they start ordering without saying, ask "Pickup or delivery?" once, in the same reply.',
    `For delivery, never take an address by voice: if one comes up, say "You'll enter the delivery address at checkout."`,
    `If asked about fees, delivery adds a flat ${spokenPrice(DELIVERY_FEE)} at checkout.`,
  ].join(' ')
}

// For delivery, the cart the tools return also has the fee and the total with
// it (cartSummary.ts), since Stripe adds the fee: in the voice check the agent
// said "forty-one ninety-eight" and Stripe charged $45.97. The example is
// worked out from the fee, so it stays true when the fee changes.
function deliveryTotalRule(): string {
  const example = `${spokenPrice(EXAMPLE_CART_CENTS)}, plus ${spokenPrice(DELIVERY_FEE)} for delivery, ${spokenPrice(EXAMPLE_CART_CENTS + DELIVERY_FEE)} in all`
  return `- For delivery, a cart in a tool result also has delivery. Every time you say its total, after a change too, name the fee and give the total with it, each word for word: "${example}" (totalSpoken, feeSpoken, totalWithDeliverySpoken).`
}

// After a change, every line it made, add_items included: the owner wants a
// whole group plan read back line by line once it's added ("that's very
// important"). The group rule's one-sentence summary is for the plan before
// it's added, and each rule says which moment it's for, so neither reads as
// the other. For delivery the total names the fee here too: in a text run
// with only the delivery rule, one confirmation in two left it out.
function confirmRule(has: HasTool): string {
  return compact([
    '- After each change, confirm it from the tool result: the quantity, size and name of every line you added or changed, then the new total, for delivery with the fee named.',
    has('add_items') &&
      'After add_items, name every line it added, one by one ("two large cheese pizzas, three large pepperoni pizzas, six garlic knots, …"), a whole group plan included, even if it takes more than two sentences; never sum them up.',
  ]).join(' ')
}

// What goes with something, and recommendations. With show_suggestions they go
// on the card (SPEC.md, "Suggestions and group orders"): in step 5's Check the
// agent twice said "The cheeseburger pairs great with fries and a fountain
// soda" and showed nothing. A group's recommendation is plan_group_order's.
function pairingRule(has: HasTool): string {
  if (!has('show_suggestions')) {
    return '- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.'
  }
  return [
    '- When asked what goes with something, call show_suggestions with the items in its pairsWith, one of each, titled like "Goes with the Classic Cheeseburger", then name them in one short sentence.',
    `When asked what you recommend, unless it's for a group, do the same with two or three popular items, titled "Our favourites".`,
    'Never name pairings or recommendations without showing them.',
  ].join(' ')
}

// For a group. With plan_group_order the code works out the plan and the agent
// only sums it up: in the owner's run the agent did the math itself, proposed
// about twice the food for thirty people, and took three long sentences to say
// so. It asks one question at most, covering what the planner takes (in step
// 5's Check it asked two before planning). Without the tool, the agent plans
// from each item's serves, as SPEC's draft said.
function groupRule(has: HasTool): string {
  if (!has('plan_group_order')) {
    return (
      "- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. " +
      (has('show_suggestions') ? 'Show the plan with show_suggestions, say the total, and ' : 'Describe the plan out loud, then ') +
      (has('add_items') ? 'add it with add_items only after they agree.' : 'tell them they can add it by tapping Add on the menu.')
    )
  }
  return compact([
    `- For a group, if the customer hasn't said what they like, ask one short question that covers it, such as "${groupQuestion()}", then call plan_group_order with what you know.`,
    'Never ask a second question before the plan.',
    `To present the plan, before anything is added, sum it up from its summary in one short sentence, the way a person would ("Eight large pizzas, three of them veggie, plus garlic knots and sodas"), then say its totalSpoken and that it's on screen; don't list its lines or do the math out loud.`,
    has('show_suggestions') &&
      'The plan is already on screen, so call show_suggestions only when the customer asks to change it ("swap a pepperoni for a margherita"), with the changed lines.',
    has('add_items')
      ? 'Add it with add_items only after they agree, then name every line it added, one by one, as after any change.'
      : 'Tell them they can add it by tapping Add all on the card.',
  ]).join(' ')
}

// "Any vegetarians, and pizza, subs or a mix?": the vegetarians, and the mains
// plan_group_order takes (tools.ts), so a shop with other mains asks about those.
function groupQuestion(): string {
  if (GROUP_MAINS.length < 2) return 'Any vegetarians?'
  return `Any vegetarians, and ${orList(GROUP_MAINS.map((mains) => (mains === 'mix' ? 'a mix' : mains)))}?`
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
