// The tools the voice agent can call, in the shape Deepgram's Voice Agent API
// takes for functions: a name, a description the LLM reads to decide when to
// call it, and a JSON Schema for its parameters. A function without an
// `endpoint` is client-side: the browser runs it, through handlers.ts.
//
// The enums come from menu.json and the categories in menu.ts, so editing the
// menu updates them. This module imports nothing from React or the server, so
// evals can load it on its own.
//
// Tools that change the cart or pickup or delivery, or leave the page, set
// `defer_until_eot`: Deepgram then calls them only once the customer's turn is
// over, not while they may still be talking
// (https://developers.deepgram.com/docs/voice-agent-speculative-replies).
// view_cart and plan_group_order set it too, because they read the cart: a
// call that doesn't wait runs before the deferred ones in the same turn, so
// "add fries, what's my total?" would read the cart without the fries. The
// others are called as soon as the LLM asks, which is quicker, and harmless if
// the customer goes on talking: they read the menu, or change what's on
// screen, which the next call puts right.

import { categories, mainCategories, menu, products, tags, type MainCategory } from '../menu/menu'
import { DELIVERY_FEE, MAX_LINE_QUANTITY, ORDER_TYPES, type OrderType } from '../shop'
import { spokenPrice } from './spokenPrice'
import { orList } from './text'

/** The most lines add_items and show_suggestions take in one call, and a group plan holds. */
export const MAX_LINES_PER_CALL = 15

/** What a group's mains can be: one main category, or a mix of them. */
export type GroupMains = MainCategory | 'mix'

/**
 * What plan_group_order can plan a group's mains from: each main category in
 * menu.ts (pizza, subs), the first one the default, and a mix when there's more than one.
 */
export const GROUP_MAINS: readonly GroupMains[] = [
  ...mainCategories.map((category) => category.id),
  ...(mainCategories.length > 1 ? (['mix'] as const) : []),
]

// "What the mains are: pizza (the default), subs or mix for some of each."
const mainsDescription = `What the mains are: ${orList(
  GROUP_MAINS.map((mains, index) => (index === 0 ? `${mains} (the default)` : mains === 'mix' ? 'mix for some of each' : mains)),
)}.`

/** The part of JSON Schema these tools use. */
export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: string[]
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
}

export type ToolDefinition<Name extends string = string> = {
  name: Name
  description: string
  parameters: JsonSchema & { type: 'object'; properties: Record<string, JsonSchema> }
  /**
   * True: Deepgram holds the call until the customer's turn is confirmed,
   * instead of calling it while they may still be talking. Left out: called
   * at once. Deepgram's field name, sent as it is.
   */
  defer_until_eot?: true
}

// Keeps each tool's name as a literal type, so ToolName below lists them.
function tool<Name extends string>(definition: ToolDefinition<Name>): ToolDefinition<Name> {
  return definition
}

const id: JsonSchema = {
  type: 'string',
  enum: products.map((product) => product.id),
  description: 'The id from the menu, including the size for sized items: "pepperoni-pizza-large".',
}

const quantity: JsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_LINE_QUANTITY,
  description: `How many, from 1 to ${MAX_LINE_QUANTITY}.`,
}

const lines: JsonSchema = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_LINES_PER_CALL,
  items: { type: 'object', properties: { id, quantity }, required: ['id', 'quantity'] },
}

const noParameters: ToolDefinition['parameters'] = { type: 'object', properties: {} }

/** Two large margheritas: the cart the example totals in the agent's rules are said for. */
export const EXAMPLE_CART_CENTS = 4198

/** How the checkout line starts: they're going to pay, not done. */
export const TO_CHECKOUT = 'Taking you to checkout now so you can pay'

/** How it goes on for delivery, after the amount: Stripe's page asks for the address, never the agent. */
export const FOR_DELIVERY = 'and enter your delivery address'

/**
 * What the agent says once checkout returns ok (SPEC.md, "Checkout"), with
 * the totalSpoken it returned: "Taking you to checkout now so you can pay
 * forty-five ninety-seven and enter your delivery address." Every path to
 * Stripe ends on it, so the customer always hears what they'll pay, the
 * delivery fee included (review round 3, .build/step-5b.md).
 */
export function checkoutLine(totalSpoken: string, orderType: OrderType): string {
  return `${TO_CHECKOUT} ${totalSpoken}${orderType === 'delivery' ? ` ${FOR_DELIVERY}` : ''}.`
}

/**
 * How the rule and checkout's description put the line, after "when it
 * returns ok,". The examples are two large margheritas, the delivery one with
 * the fee from the shop settings, so they stay true when the fee changes.
 */
export const SAY_AT_CHECKOUT = `say "${TO_CHECKOUT}", then the totalSpoken it returned, word for word (for delivery it already has the fee in it), then, for delivery only, "${FOR_DELIVERY}", as one sentence: for pickup "${checkoutLine(spokenPrice(EXAMPLE_CART_CENTS), 'pickup')}", for delivery "${checkoutLine(spokenPrice(EXAMPLE_CART_CENTS + DELIVERY_FEE), 'delivery')}"`

/** Nothing is ordered until the customer pays on Stripe's page. */
export const NOT_PLACED_YET = "Never say the order is placed, done or confirmed: it isn't until they pay."

export const toolDefinitions = [
  tool({
    name: 'find_menu_items',
    description:
      "Find menu items that match what the customer is looking for, such as vegetarian, spicy, drinks or under ten dollars. The matching items light up on screen, which is enough: don't also show them with show_suggestions.",
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: categories.map((category) => category.id) },
        tags: {
          type: 'array',
          items: { type: 'string', enum: [...tags] },
          description: 'Only items with every one of these tags.',
        },
        max_price: { type: 'number', description: 'The most the customer wants to pay, in dollars: 10 for "under ten bucks".' },
        query: { type: 'string', description: 'Words to look for in item names and descriptions, such as "chicken".' },
      },
    },
  }),
  tool({
    name: 'show_suggestions',
    description:
      "Show suggested items on a card on screen: what goes with an item, recommendations, or a group plan with the customer's changes. It doesn't add anything to the cart.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short heading, such as "For your party of 20" or "Goes with the Classic Cheeseburger".' },
        items: lines,
        reason: { type: 'string', description: 'One short line on why these, such as "Two veggie pies for the vegetarians".' },
      },
      required: ['title', 'items'],
    },
  }),
  tool({
    name: 'plan_group_order',
    description:
      "Plan food for a group and show it on the card on screen: mains for about one serving per person, sides to share and a drink each, worked out from the menu, and made leaner to fit a budget if they gave one. Call it once you know how many people are eating, after one short question about what they like at most, and again when they give a budget. It doesn't add anything to the cart. The card already shows the plan, so don't call show_suggestions after it unless the customer asks for a change.",
    parameters: {
      type: 'object',
      properties: {
        people: { type: 'integer', minimum: 1, description: 'How many people are eating.' },
        vegetarians: { type: 'integer', minimum: 0, description: 'How many of them are vegetarian. Leave out if none.' },
        budget: {
          type: 'number',
          description:
            'The most the customer wants to spend, in dollars, only if they said: 250 for "about two fifty". For delivery it counts the delivery fee.',
        },
        preferences: {
          type: 'object',
          description: 'Only what the customer said. Leave out the rest.',
          properties: {
            mains: { type: 'string', enum: [...GROUP_MAINS], description: mainsDescription },
            spicy: { type: 'boolean', description: 'True when someone likes it spicy.' },
            drinks: { type: 'boolean', description: "False when they don't want drinks." },
            include: {
              type: 'array',
              items: { type: 'string', enum: menu.map((item) => item.id) },
              description: 'Items the customer asked for by name, by item id without the size: "white-pizza".',
            },
          },
        },
      },
      required: ['people'],
    },
    defer_until_eot: true,
  }),
  tool({
    name: 'add_item',
    description: 'Add an item to the cart.',
    parameters: { type: 'object', properties: { id, quantity }, required: ['id', 'quantity'] },
    defer_until_eot: true,
  }),
  tool({
    name: 'add_items',
    description:
      'Add several items to the cart in one go, such as a group plan the customer agreed to. Then name every line it added, one by one, with quantity, size and name, and the new total.',
    parameters: { type: 'object', properties: { items: lines }, required: ['items'] },
    defer_until_eot: true,
  }),
  tool({
    name: 'set_quantity',
    description: 'Change how many of an item are in the cart.',
    parameters: { type: 'object', properties: { id, quantity }, required: ['id', 'quantity'] },
    defer_until_eot: true,
  }),
  tool({
    name: 'remove_item',
    description: 'Take an item out of the cart.',
    parameters: { type: 'object', properties: { id }, required: ['id'] },
    defer_until_eot: true,
  }),
  tool({
    name: 'view_cart',
    description:
      "Read what's in the cart and the total. Call it before answering any question about what's in the cart or the total, even right after you were told the customer tapped something.",
    parameters: noParameters,
    defer_until_eot: true,
  }),
  tool({
    name: 'clear_cart',
    description: 'Empty the cart, when the customer wants to start over.',
    parameters: noParameters,
    defer_until_eot: true,
  }),
  tool({
    name: 'set_order_type',
    description: 'Record whether the order is for pickup or delivery, once the customer says which. The cart on screen shows it.',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string', enum: [...ORDER_TYPES], description: 'pickup or delivery.' } },
      required: ['type'],
    },
    defer_until_eot: true,
  }),
  tool({
    name: 'checkout',
    description: `Send the customer to the payment page, once they have confirmed their order. When it returns ok, ${SAY_AT_CHECKOUT} ${NOT_PLACED_YET} The page leaves as soon as you stop speaking.`,
    parameters: noParameters,
    defer_until_eot: true,
  }),
]

export type ToolName = (typeof toolDefinitions)[number]['name']

/**
 * What the agent says as it starts a plan, the same words every time: the app
 * sends it (Deepgram's InjectAgentMessage, src/voice/ClientTools.tsx), so it
 * doesn't rest on the LLM. The owner wanted the agent to say it's putting
 * something together before the card comes up, so the screen follows the
 * voice instead of jumping ahead of it (2026-11-11).
 */
export const PLAN_LINE = 'Let me put something together.'

/** The lines the app has the agent say when it calls a tool, by tool. Only a plan takes long enough, and puts something on screen to look at. */
export const SAID_WHEN_CALLED: Partial<Record<ToolName, string>> = { plan_group_order: PLAN_LINE }
