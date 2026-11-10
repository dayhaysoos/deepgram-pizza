import { describe, expect, it } from 'vitest'
import { categories, mainCategories, menu, products, tags } from '../menu/menu'
import { MAX_LINE_QUANTITY } from '../shop'
import { GROUP_MAINS, MAX_LINES_PER_CALL, toolDefinitions, type ToolDefinition } from './tools'

function tool(name: string): ToolDefinition {
  const found = toolDefinitions.find((definition) => definition.name === name)
  if (!found) throw new Error(`No tool named ${name}`)
  return found
}

function property(toolName: string, name: string) {
  const schema = tool(toolName).parameters.properties?.[name]
  if (!schema) throw new Error(`${toolName} has no parameter ${name}`)
  return schema
}

const variantIds = products.map((product) => product.id)

describe('toolDefinitions', () => {
  it('has every tool in SPEC.md, and no others', () => {
    expect(toolDefinitions.map((definition) => definition.name)).toEqual([
      'find_menu_items',
      'show_suggestions',
      'plan_group_order',
      'add_item',
      'add_items',
      'set_quantity',
      'remove_item',
      'view_cart',
      'clear_cart',
      'checkout',
    ])
  })

  it('gives every tool a description and an object schema, and no endpoint (so it runs in the browser)', () => {
    for (const definition of toolDefinitions) {
      const keys = Object.keys(definition).filter((key) => key !== 'defer_until_eot')
      expect(keys.sort()).toEqual(['description', 'name', 'parameters'])
      expect(definition.description.length).toBeGreaterThan(20)
      expect(definition.parameters.type).toBe('object')
      expect(definition.parameters.properties).toBeDefined()
      for (const required of definition.parameters.required ?? []) {
        expect(definition.parameters.properties).toHaveProperty(required)
      }
    }
  })

  it("waits for the end of the customer's turn only on the tools that change the cart or leave the page", () => {
    // Deepgram calls the others as soon as the LLM asks, even if the customer goes on talking:
    // they read the menu or the cart, or change what's on screen, which the next call puts right.
    const deferred = toolDefinitions.filter((definition) => definition.defer_until_eot === true).map(({ name }) => name)
    expect(deferred).toEqual(['add_item', 'add_items', 'set_quantity', 'remove_item', 'clear_cart', 'checkout'])
    for (const definition of toolDefinitions) {
      if (!deferred.includes(definition.name)) expect(definition, definition.name).not.toHaveProperty('defer_until_eot')
    }
  })

  it('survives a JSON round trip unchanged, since it is sent to Deepgram as JSON', () => {
    expect(JSON.parse(JSON.stringify(toolDefinitions))).toEqual(toolDefinitions)
  })

  it('limits id to every variant id on the menu', () => {
    for (const name of ['add_item', 'set_quantity', 'remove_item']) {
      expect(property(name, 'id').enum).toEqual(variantIds)
    }
    for (const name of ['add_items', 'show_suggestions']) {
      expect(property(name, 'items').items?.properties?.id.enum).toEqual(variantIds)
    }
  })

  it('takes a quantity from 1 to the line cap', () => {
    const quantities = [
      property('add_item', 'quantity'),
      property('set_quantity', 'quantity'),
      property('add_items', 'items').items?.properties?.quantity,
      property('show_suggestions', 'items').items?.properties?.quantity,
    ]
    for (const quantity of quantities) {
      expect(quantity).toMatchObject({ type: 'integer', minimum: 1, maximum: MAX_LINE_QUANTITY })
    }
  })

  it('takes up to 15 lines in add_items and show_suggestions, each with an id and a quantity', () => {
    for (const name of ['add_items', 'show_suggestions']) {
      const items = property(name, 'items')
      expect(items).toMatchObject({ type: 'array', minItems: 1, maxItems: MAX_LINES_PER_CALL })
      expect(items.items?.required).toEqual(['id', 'quantity'])
    }
    expect(MAX_LINES_PER_CALL).toBe(15)
  })

  it("filters find_menu_items by the menu's categories and tags, a price in dollars and a search", () => {
    expect(property('find_menu_items', 'category').enum).toEqual(categories.map((category) => category.id))
    expect(property('find_menu_items', 'tags').items?.enum).toEqual([...tags])
    expect(property('find_menu_items', 'max_price').type).toBe('number')
    expect(property('find_menu_items', 'query').type).toBe('string')
    expect(tool('find_menu_items').parameters.required ?? []).toEqual([])
  })

  it('requires what each tool needs', () => {
    expect(tool('show_suggestions').parameters.required).toEqual(['title', 'items'])
    expect(tool('plan_group_order').parameters.required).toEqual(['people'])
    expect(tool('add_item').parameters.required).toEqual(['id', 'quantity'])
    expect(tool('add_items').parameters.required).toEqual(['items'])
    expect(tool('set_quantity').parameters.required).toEqual(['id', 'quantity'])
    expect(tool('remove_item').parameters.required).toEqual(['id'])
    for (const name of ['view_cart', 'clear_cart', 'checkout']) {
      expect(tool(name).parameters).toEqual({ type: 'object', properties: {} })
    }
  })

  it('plans a group from how many people, how many are vegetarian, and only the preferences the customer gave', () => {
    expect(property('plan_group_order', 'people')).toMatchObject({ type: 'integer', minimum: 1 })
    expect(property('plan_group_order', 'vegetarians')).toMatchObject({ type: 'integer', minimum: 0 })
    const preferences = property('plan_group_order', 'preferences')
    expect(preferences.type).toBe('object')
    expect(preferences.required).toBeUndefined()
    expect(preferences.properties?.mains.enum).toEqual([...GROUP_MAINS])
    // From the categories menu.ts plans mains from, the first the default, plus a mix of them.
    expect(GROUP_MAINS).toEqual([...mainCategories.map((category) => category.id), 'mix'])
    expect(GROUP_MAINS).toEqual(['pizza', 'subs', 'mix'])
    expect(preferences.properties?.mains.description).toBe('What the mains are: pizza (the default), subs or mix for some of each.')
    expect(preferences.properties?.spicy.type).toBe('boolean')
    expect(preferences.properties?.drinks.type).toBe('boolean')
    // Items, not sizes: the planner picks the size.
    expect(preferences.properties?.include.items?.enum).toEqual(menu.map((item) => item.id))
  })
})
