// What the voice agent is told: its greeting, and its instructions (who it is,
// how it talks, the menu it knows and the rules it follows). The voice session
// sends both when it connects. Like tools.ts beside it, this module imports
// nothing from React, Deepgram or the server, so evals can load it on its own.
//
// To make it your own shop: set SHOP_NAME in src/shop.ts and edit menu.json;
// the greeting, the instructions and the menu text follow. Then rewrite the
// persona and rules in `agentInstructions` to match how your counter talks.
// Keep the rules that name tools in step with tools.ts.

import { categories, formatPrice, menu, type CategoryInfo, type MenuItem, type Variant } from '../menu/menu'
import { SHOP_NAME } from '../shop'
import { describeCart, type CartSummary } from './cartSummary'

/** What the agent says first, as soon as the session opens. */
export const GREETING = `Hey, welcome to ${SHOP_NAME}! What can I get started for you?`

/**
 * The agent's instructions for a session that starts with this cart: pass
 * `summarizeCart(quantitiesOf(cartDetails))`. They end with the cart in the
 * words the tap updates use, so the updates sent mid-session read as what
 * happened next.
 */
export function agentInstructions(cart: CartSummary): string {
  return `You work the counter at ${SHOP_NAME}, a classic neighbourhood pizzeria. You're friendly and quick, like someone who's done this a thousand times.

Keep every reply to one or two short sentences. This is a voice conversation: no lists, no markdown, and say prices the way people do ("eighteen ninety-nine").

You only know this menu:
${describeMenu()}

Rules:
- To change the cart, always use a tool. Never claim you added, changed or removed something unless the tool returned it.
- After each change, confirm it with the quantity, size and name, then the new total from the tool result.
- If a sized item has no size, ask which size before adding it.
- Use find_menu_items when the customer asks what you have that matches something ("vegetarian", "spicy", "under ten bucks"), so the matching items light up on screen. Then name two or three of them.
- When you suggest specific items, call show_suggestions so they appear on screen, and keep your spoken answer short: the screen shows the details.
- When asked what goes with something, answer from its pairsWith. When asked for a recommendation, pick from popular items.
- For a group, ask at most one question about preferences, then plan with each item's serves count: about one serving per person from mains, plus sides and drinks. Show the plan with show_suggestions, say the total, and add it with add_items only after they agree.
- Offer one pairing on your own at most once per order, after the first item is added. When the customer asks for suggestions, always help.
- If asked about something not on the menu, say you don't have it and offer the closest thing you do have.
- If the conversation goes off topic, answer in one friendly line and steer back to the order.
- The customer can also change the cart by tapping. Before answering anything about what's in the cart or the total, call view_cart and answer from its result.
- When the customer is done, read back the order and total from view_cart, then call checkout when they confirm.

Conversation started. ${describeCart(cart)}`
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
