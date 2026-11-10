// The tools the voice agent can call, in the shape Deepgram's Voice Agent API
// takes for functions: a name, a description the LLM reads to decide when to
// call it, and a JSON Schema for its parameters. A function without an
// `endpoint` is client-side: the browser runs it, through handlers.ts.
//
// The enums come from menu.json, so editing the menu updates them. This module
// imports nothing from React or the server, so evals can load it on its own.

import { categories, products, tags } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'

/** The most lines add_items and show_suggestions take in one call. */
export const MAX_LINES_PER_CALL = 15

/** The part of JSON Schema these tools use. */
export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'integer' | 'number'
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

export const toolDefinitions = [
  tool({
    name: 'find_menu_items',
    description:
      'Find menu items that match what the customer is looking for, such as vegetarian, spicy, drinks or under ten dollars. The matching items light up on screen.',
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
      "Show suggested items on a card on screen: pairings, recommendations or a plan for a group. It doesn't add anything to the cart.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short heading, such as "Party of 20" or "Goes with the cheeseburger".' },
        items: lines,
        reason: { type: 'string', description: 'One short line on why these, such as "Two veggie pies for the vegetarians".' },
      },
      required: ['title', 'items'],
    },
  }),
  tool({
    name: 'add_item',
    description: 'Add an item to the cart.',
    parameters: { type: 'object', properties: { id, quantity }, required: ['id', 'quantity'] },
  }),
  tool({
    name: 'add_items',
    description: 'Add several items to the cart in one go, such as a group plan the customer agreed to.',
    parameters: { type: 'object', properties: { items: lines }, required: ['items'] },
  }),
  tool({
    name: 'set_quantity',
    description: 'Change how many of an item are in the cart.',
    parameters: { type: 'object', properties: { id, quantity }, required: ['id', 'quantity'] },
  }),
  tool({
    name: 'remove_item',
    description: 'Take an item out of the cart.',
    parameters: { type: 'object', properties: { id }, required: ['id'] },
  }),
  tool({
    name: 'view_cart',
    description: "Read what's in the cart and the total. Call it before answering anything about the cart.",
    parameters: noParameters,
  }),
  tool({
    name: 'clear_cart',
    description: 'Empty the cart, when the customer wants to start over.',
    parameters: noParameters,
  }),
  tool({
    name: 'checkout',
    description: 'Send the customer to the payment page, once they have confirmed their order.',
    parameters: noParameters,
  }),
]

export type ToolName = (typeof toolDefinitions)[number]['name']
