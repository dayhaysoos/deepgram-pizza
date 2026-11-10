import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShoppingCart } from 'use-shopping-cart/core'
import { CHECKOUT_UNAVAILABLE, type CheckoutResult } from '../checkout/checkout'
import { findVariant, menu, products } from '../menu/menu'
import { CURRENCY, LOCALE } from '../shop'
import { quantitiesOf, summarizeCart } from './cartSummary'
import { addLines, createToolHandlers, type CartPort, type ToolPorts } from './handlers'
import type { ToolName } from './tools'

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_fake'

function product(id: string) {
  const found = findVariant(id)
  if (!found) throw new Error(`${id} isn't on the menu`)
  return found.product
}

/**
 * The handlers against a real use-shopping-cart store, behaving the way they
 * will in React: a handler reads the cart as of the last render, and what its
 * actions change shows up only after the next render (here, after each call).
 * A handler that read the cart back after acting would get the old cart, and
 * the summary checks below would catch it.
 */
function setup(respond: () => Promise<CheckoutResult> = async () => ({ url: SESSION_URL })) {
  const store = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
  let rendered = store.getState().cartDetails
  const render = () => {
    rendered = store.getState().cartDetails
  }

  const cart = {
    cartDetails: vi.fn(() => rendered),
    addItem: vi.fn<CartPort['addItem']>((item, options) => store.addItem(item, options)),
    setItemQuantity: vi.fn<CartPort['setItemQuantity']>((id, quantity) => store.setItemQuantity(id, quantity)),
    removeItem: vi.fn<CartPort['removeItem']>((id) => store.removeItem(id)),
    clearCart: vi.fn<CartPort['clearCart']>(() => store.clearCart()),
  }
  const ui = { highlight: vi.fn(), showSuggestions: vi.fn(), openCart: vi.fn(), goToCheckout: vi.fn() }
  const checkout = vi.fn<ToolPorts['checkout']>(respond)
  const handlers = createToolHandlers({ cart, ui, checkout })

  async function call(name: ToolName, args: unknown = {}) {
    const result = await handlers[name](args)
    render()
    return result
  }

  /** Puts lines in the cart before the test, as if the customer had tapped them in. */
  function given(lines: Record<string, number>) {
    for (const [id, count] of Object.entries(lines)) store.addItem(product(id), { count })
    render()
  }

  /** The summary of what the store really holds now. */
  function storeSummary() {
    return summarizeCart(quantitiesOf(store.getState().cartDetails))
  }

  function noCartChanges() {
    expect(cart.addItem).not.toHaveBeenCalled()
    expect(cart.setItemQuantity).not.toHaveBeenCalled()
    expect(cart.removeItem).not.toHaveBeenCalled()
    expect(cart.clearCart).not.toHaveBeenCalled()
  }

  return { store, cart, ui, checkout, call, given, storeSummary, noCartChanges }
}

const BAD_QUANTITY = 'The quantity has to be a whole number from 1 to 20.'

describe('add_item', () => {
  it('adds the product and returns the cart', async () => {
    const { cart, call, storeSummary } = setup()

    const result = await call('add_item', { id: 'margherita-pizza-large', quantity: 2 })

    expect(cart.addItem).toHaveBeenCalledWith(product('margherita-pizza-large'), { count: 2 })
    expect(result).toEqual({
      lines: [{ id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 2, total: '$41.98' }],
      count: 2,
      total: '$41.98',
    })
    expect(result).toEqual(storeSummary())
  })

  it('adds to a line that is already in the cart', async () => {
    const { call, given, storeSummary } = setup()
    given({ fries: 1, soda: 1 })

    const result = await call('add_item', { id: 'fries', quantity: 2 })

    expect(result).toEqual(summarizeCart({ fries: 3, soda: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('takes its arguments as a JSON string too, the way the voice agent sends them', async () => {
    const { call } = setup()

    const result = await call('add_item', JSON.stringify({ id: 'fries', quantity: 1 }))

    expect(result).toEqual(summarizeCart({ fries: 1 }))
  })

  it('offers close matches for an id that is not on the menu', async () => {
    const { call, noCartChanges } = setup()

    expect(await call('add_item', { id: 'pepperoni-pizza-xl', quantity: 1 })).toEqual({
      message: "That's not on the menu. Close matches: Pepperoni Pizza (pepperoni-pizza-medium or pepperoni-pizza-large).",
    })
    expect(await call('add_item', { id: 'margarita', quantity: 1 })).toEqual({
      message:
        "That's not on the menu. Close matches: Margherita Pizza (margherita-pizza-medium or margherita-pizza-large).",
    })
    noCartChanges()
  })

  it('offers up to three close matches', async () => {
    const { call } = setup()

    const result = await call('add_item', { id: 'hawaiian-pizza', quantity: 1 })

    expect(result).toEqual({
      message:
        "That's not on the menu. Close matches: Cheese Pizza (cheese-pizza-medium or cheese-pizza-large), " +
        'Pepperoni Pizza (pepperoni-pizza-medium or pepperoni-pizza-large), ' +
        'Margherita Pizza (margherita-pizza-medium or margherita-pizza-large).',
    })
  })

  it('says so when nothing on the menu is close', async () => {
    const { call, noCartChanges } = setup()

    expect(await call('add_item', { id: 'hawaiian', quantity: 1 })).toEqual({
      message: "That's not on the menu, and nothing on it is close. Offer something we do have.",
    })
    noCartChanges()
  })

  it('asks for the size when the id is a sized item without one', async () => {
    const { call, noCartChanges } = setup()

    expect(await call('add_item', { id: 'pepperoni-pizza', quantity: 1 })).toEqual({
      message: 'Pepperoni Pizza comes in medium or large. Which one?',
    })
    expect(await call('add_item', { id: 'buffalo-wings', quantity: 1 })).toEqual({
      message: 'Buffalo Wing Dings comes in 6 pc or 12 pc. Which one?',
    })
    noCartChanges()
  })

  it('asks for an id when there is none', async () => {
    const { call, noCartChanges } = setup()
    const missing = { message: "The id is missing. Send the item's id from the menu." }

    expect(await call('add_item', { quantity: 1 })).toEqual(missing)
    expect(await call('add_item', { id: 7, quantity: 1 })).toEqual(missing)
    expect(await call('add_item', undefined)).toEqual(missing)
    expect(await call('add_item', 'not json')).toEqual(missing)
    noCartChanges()
  })

  it.each([0, -1, 2.5, 21, '2', undefined, null])('turns down quantity %j', async (quantity) => {
    const { call, noCartChanges } = setup()

    expect(await call('add_item', { id: 'fries', quantity })).toEqual({ message: BAD_QUANTITY })
    noCartChanges()
  })

  it('keeps a line at 20 or fewer, counting what is already in the cart', async () => {
    const { call, given, cart } = setup()
    given({ 'pepperoni-pizza-large': 18 })

    expect(await call('add_item', { id: 'pepperoni-pizza-large', quantity: 3 })).toEqual({
      message: 'That would make 21 × Large Pepperoni Pizza, and a line holds at most 20. There are 18 in the cart now.',
    })
    expect(cart.addItem).not.toHaveBeenCalled()

    expect(await call('add_item', { id: 'pepperoni-pizza-large', quantity: 2 })).toEqual(
      summarizeCart({ 'pepperoni-pizza-large': 20 }),
    )
  })
})

describe('add_items', () => {
  it('adds every line in one call and returns the cart', async () => {
    const { cart, call, storeSummary } = setup()

    const result = await call('add_items', {
      items: [
        { id: 'pepperoni-pizza-large', quantity: 4 },
        { id: 'buffalo-wings-12pc', quantity: 3 },
        { id: 'soda', quantity: 10 },
      ],
    })

    expect(cart.addItem.mock.calls).toEqual([
      [product('pepperoni-pizza-large'), { count: 4 }],
      [product('buffalo-wings-12pc'), { count: 3 }],
      [product('soda'), { count: 10 }],
    ])
    expect(result).toEqual(summarizeCart({ 'pepperoni-pizza-large': 4, 'buffalo-wings-12pc': 3, soda: 10 }))
    expect(result).toEqual(storeSummary())
  })

  it('adds nothing when one line is not on the menu, and names that line', async () => {
    const { call, given, noCartChanges, storeSummary } = setup()
    given({ fries: 1 })

    const result = await call('add_items', {
      items: [
        { id: 'pepperoni-pizza-large', quantity: 1 },
        { id: 'hawaiian', quantity: 1 },
      ],
    })

    expect(result).toEqual({
      message:
        'Nothing was added. Line 2 ("hawaiian"): That\'s not on the menu, and nothing on it is close. Offer something we do have.',
    })
    noCartChanges()
    expect(storeSummary()).toEqual(summarizeCart({ fries: 1 }))
  })

  it('names a line with a bad quantity or a missing size', async () => {
    const { call, noCartChanges } = setup()

    expect(
      await call('add_items', {
        items: [
          { id: 'fries', quantity: 1 },
          { id: 'soda', quantity: 1 },
          { id: 'cannoli', quantity: 0 },
        ],
      }),
    ).toEqual({ message: `Nothing was added. Line 3 ("cannoli"): ${BAD_QUANTITY}` })
    expect(await call('add_items', { items: [{ id: 'cheese-pizza', quantity: 1 }] })).toEqual({
      message: 'Nothing was added. Line 1 ("cheese-pizza"): Cheese Pizza comes in medium or large. Which one?',
    })
    expect(await call('add_items', { items: ['fries'] })).toEqual({
      message: "Nothing was added. Line 1: The id is missing. Send the item's id from the menu.",
    })
    noCartChanges()
  })

  it('adds up lines with the same id', async () => {
    const { cart, call, storeSummary } = setup()

    const result = await call('add_items', {
      items: [
        { id: 'fries', quantity: 2 },
        { id: 'soda', quantity: 1 },
        { id: 'fries', quantity: 3 },
      ],
    })

    expect(cart.addItem.mock.calls).toEqual([
      [product('fries'), { count: 5 }],
      [product('soda'), { count: 1 }],
    ])
    expect(result).toEqual(summarizeCart({ fries: 5, soda: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('keeps each line at 20 or fewer, counting repeated ids and the cart', async () => {
    const { call, given, noCartChanges } = setup()

    expect(
      await call('add_items', {
        items: [
          { id: 'fries', quantity: 15 },
          { id: 'fries', quantity: 6 },
        ],
      }),
    ).toEqual({
      message: 'Nothing was added. Line 2 ("fries"): That would make 21 × Fries, and a line holds at most 20.',
    })

    given({ fries: 10 })
    expect(
      await call('add_items', {
        items: [
          { id: 'soda', quantity: 1 },
          { id: 'fries', quantity: 11 },
        ],
      }),
    ).toEqual({
      message:
        'Nothing was added. Line 2 ("fries"): That would make 21 × Fries, and a line holds at most 20. There are 10 in the cart now.',
    })
    noCartChanges()
  })

  it('takes up to 15 lines', async () => {
    const { call, noCartChanges } = setup()
    const lines = (count: number) => products.slice(0, count).map((item) => ({ id: item.id, quantity: 1 }))

    expect(await call('add_items', { items: lines(16) })).toEqual({
      message: "Nothing was added. That's 16 lines, and one call takes at most 15.",
    })
    noCartChanges()

    expect(await call('add_items', { items: lines(15) })).toMatchObject({ count: 15 })
  })

  it.each([{}, { items: [] }, { items: 'fries' }, { items: { id: 'fries', quantity: 1 } }])(
    'asks for a list of lines when items is %j',
    async (args) => {
      const { call, noCartChanges } = setup()

      expect(await call('add_items', args)).toEqual({
        message: 'Nothing was added. Send items as a list of lines, each with an id and a quantity.',
      })
      noCartChanges()
    },
  )
})

describe('opening the cart drawer', () => {
  it('opens it the first time a voice change adds an item, and only then', async () => {
    const { call, ui } = setup()

    await call('add_item', { id: 'fries', quantity: 1 })
    expect(ui.openCart).toHaveBeenCalledTimes(1)

    await call('add_item', { id: 'soda', quantity: 1 })
    await call('add_items', { items: [{ id: 'cannoli', quantity: 1 }] })
    expect(ui.openCart).toHaveBeenCalledTimes(1)
  })

  it('opens it for add_items too', async () => {
    const { call, ui } = setup()

    await call('add_items', { items: [{ id: 'cannoli', quantity: 1 }] })

    expect(ui.openCart).toHaveBeenCalledTimes(1)
  })

  it('leaves it closed when nothing was added', async () => {
    const { call, ui, given } = setup()
    given({ fries: 1 })

    await call('add_item', { id: 'hawaiian', quantity: 1 })
    await call('add_items', { items: [{ id: 'hawaiian', quantity: 1 }] })
    await call('set_quantity', { id: 'fries', quantity: 2 })
    await call('view_cart')

    expect(ui.openCart).not.toHaveBeenCalled()
  })
})

describe('addLines, for the suggestion card’s Add all', () => {
  it('adds every line with the same checks as add_items, without opening the drawer', async () => {
    const { cart, ui, store } = setup()

    const result = addLines(cart, [
      { id: 'fries', quantity: 1 },
      { id: 'soda', quantity: 2 },
    ])

    expect(result).toEqual(summarizeCart({ fries: 1, soda: 2 }))
    expect(summarizeCart(quantitiesOf(store.getState().cartDetails))).toEqual(result)
    expect(ui.openCart).not.toHaveBeenCalled()
  })

  it('adds nothing when a line is bad', async () => {
    const { cart, noCartChanges } = setup()

    expect(
      addLines(cart, [
        { id: 'fries', quantity: 1 },
        { id: 'soda', quantity: 25 },
      ]),
    ).toEqual({ message: `Nothing was added. Line 2 ("soda"): ${BAD_QUANTITY}` })
    noCartChanges()
  })
})

describe('set_quantity', () => {
  it('sets the quantity and returns the cart', async () => {
    const { cart, call, given, storeSummary } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const result = await call('set_quantity', { id: 'margherita-pizza-large', quantity: 1 })

    expect(cart.setItemQuantity).toHaveBeenCalledWith('margherita-pizza-large', 1)
    expect(result).toEqual(summarizeCart({ 'margherita-pizza-large': 1, fries: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('lists the cart, with ids, when the item is not in it', async () => {
    const { call, given, noCartChanges } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })
    const message = {
      message:
        "That isn't in the cart. The cart has: 2 × Large Margherita Pizza (margherita-pizza-large), 1 × Fries (fries).",
    }

    expect(await call('set_quantity', { id: 'pepperoni-pizza-large', quantity: 1 })).toEqual(message)
    expect(await call('set_quantity', { id: 'margherita-pizza', quantity: 1 })).toEqual(message)
    expect(await call('set_quantity', { id: 'constructor', quantity: 1 })).toEqual(message)
    expect(await call('set_quantity', { quantity: 1 })).toEqual(message)
    noCartChanges()
  })

  it('says the cart is empty when it is', async () => {
    const { call } = setup()

    expect(await call('set_quantity', { id: 'fries', quantity: 1 })).toEqual({
      message: "That isn't in the cart. The cart is empty.",
    })
  })

  it.each([0, 21, 1.5, '1'])('turns down quantity %j and points to remove_item', async (quantity) => {
    const { call, given, noCartChanges } = setup()
    given({ fries: 2 })

    expect(await call('set_quantity', { id: 'fries', quantity })).toEqual({
      message: `${BAD_QUANTITY} To take it out of the cart, use remove_item.`,
    })
    noCartChanges()
  })
})

describe('remove_item', () => {
  it('removes the line and returns the cart', async () => {
    const { cart, call, given, storeSummary } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const result = await call('remove_item', { id: 'margherita-pizza-large' })

    expect(cart.removeItem).toHaveBeenCalledWith('margherita-pizza-large')
    expect(result).toEqual(summarizeCart({ fries: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('lists the cart when the item is not in it', async () => {
    const { call, given, noCartChanges } = setup()
    given({ fries: 1 })
    const message = { message: "That isn't in the cart. The cart has: 1 × Fries (fries)." }

    expect(await call('remove_item', { id: 'soda' })).toEqual(message)
    expect(await call('remove_item', { id: '__proto__' })).toEqual(message)
    expect(await call('remove_item', { id: 'hawaiian' })).toEqual(message)
    noCartChanges()
  })
})

describe('view_cart', () => {
  it('returns the cart and changes nothing', async () => {
    const { call, given, noCartChanges } = setup()
    given({ 'margherita-pizza-large': 1 })

    expect(await call('view_cart')).toEqual(summarizeCart({ 'margherita-pizza-large': 1 }))
    noCartChanges()
  })

  it('sees what the customer tapped in between calls', async () => {
    const { call, given } = setup()
    await call('add_item', { id: 'margherita-pizza-large', quantity: 1 })

    given({ fries: 1 })

    expect(await call('view_cart')).toMatchObject({ count: 2, total: '$25.98' })
  })

  it('returns the empty cart', async () => {
    const { call } = setup()

    expect(await call('view_cart')).toEqual({ lines: [], count: 0, total: '$0.00' })
  })
})

describe('clear_cart', () => {
  it('empties the cart and returns it', async () => {
    const { cart, call, given, storeSummary } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const result = await call('clear_cart')

    expect(cart.clearCart).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ lines: [], count: 0, total: '$0.00' })
    expect(result).toEqual(storeSummary())
  })
})

describe('find_menu_items', () => {
  function ids(result: unknown) {
    return (result as { items: Array<{ id: string }> }).items.map((item) => item.id)
  }

  it('finds vegetarian items and highlights them', async () => {
    const { call, ui, noCartChanges } = setup()

    const result = await call('find_menu_items', { tags: ['vegetarian'] })

    const found = ids(result)
    expect(found).toContain('margherita-pizza')
    expect(found).not.toContain('caesar-salad')
    expect(found).toEqual(menu.filter((item) => item.tags.includes('vegetarian')).map((item) => item.id))
    expect(ui.highlight).toHaveBeenCalledWith(found)
    noCartChanges()
  })

  it('returns each match with its variants and prices', async () => {
    const { call } = setup()

    expect(await call('find_menu_items', { query: 'margherita' })).toEqual({
      items: [
        {
          id: 'margherita-pizza',
          name: 'Margherita Pizza',
          category: 'pizza',
          description: 'Tomato sauce, fresh mozzarella and basil with a drizzle of olive oil.',
          tags: ['vegetarian'],
          variants: [
            { id: 'margherita-pizza-medium', label: 'Medium', price: '$17.99', serves: 2 },
            { id: 'margherita-pizza-large', label: 'Large', price: '$20.99', serves: 4 },
          ],
        },
      ],
    })
  })

  it('finds spicy items', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { tags: ['spicy'] }))).toEqual([
      'buffalo-chicken-pizza',
      'buffalo-wings',
      'buffalo-chicken-salad',
    ])
  })

  it('needs every tag given to match', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { tags: ['vegetarian', 'vegan'] }))).toEqual([
      'garden-salad',
      'fries',
      'soda',
      'lemonade',
    ])
  })

  it('finds items under a price in dollars, listing only the sizes that fit', async () => {
    const { call } = setup()

    const result = (await call('find_menu_items', { max_price: 10 })) as {
      items: Array<{ id: string; variants: Array<{ id: string }> }>
    }

    const found = ids(result)
    expect(found).toContain('caesar-salad')
    expect(found).toContain('greek-salad')
    expect(found).not.toContain('cheese-pizza')
    expect(found).not.toContain('italian-sub')
    expect(result.items.find((item) => item.id === 'buffalo-wings')?.variants).toEqual([
      { id: 'buffalo-wings-6pc', label: '6 pc', price: '$8.99', serves: 2 },
    ])
  })

  it('finds a category', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { category: 'drinks' }))).toEqual(['soda', 'lemonade'])
  })

  it('searches names, descriptions and ids, ignoring case', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { query: 'pepperoni' }))).toEqual(['pepperoni-pizza', 'meat-lovers-pizza'])
    expect(ids(await call('find_menu_items', { query: 'PEPPERONI' }))).toEqual(['pepperoni-pizza', 'meat-lovers-pizza'])
    expect(ids(await call('find_menu_items', { query: 'chicken pizza' }))).toEqual(['buffalo-chicken-pizza'])
    expect(ids(await call('find_menu_items', { query: 'wings' }))).toEqual([
      'buffalo-wings',
      'honey-bbq-wings',
      'garlic-parm-wings',
      'lemon-pepper-wings',
    ])
  })

  it('finds a plural in a longer word, but not in a different one', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { query: 'burgers' }))).toEqual([
      'classic-cheeseburger',
      'bacon-bbq-burger',
      'mushroom-swiss-burger',
      'black-bean-burger',
    ])
    // Mozzarella Sticks are "fried golden": that's not fries.
    expect(ids(await call('find_menu_items', { query: 'fries' }))).toEqual(['fries'])
  })

  it('combines filters', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { category: 'pizza', tags: ['vegetarian'], max_price: 19 }))).toEqual([
      'cheese-pizza',
      'margherita-pizza',
      'white-pizza',
    ])
  })

  it('treats null filters as not given', async () => {
    const { call } = setup()

    expect(ids(await call('find_menu_items', { category: null, tags: null, max_price: null, query: 'fries' }))).toEqual([
      'fries',
    ])
  })

  it('clears the highlights and says so when nothing matches', async () => {
    const { call, ui } = setup()

    expect(await call('find_menu_items', { query: 'sushi' })).toEqual({
      items: [],
      message: 'Nothing on the menu matches. Try fewer filters, or offer the closest thing we have.',
    })
    expect(ui.highlight).toHaveBeenCalledWith([])
  })

  it('asks for a filter when none is given', async () => {
    const { call, ui } = setup()

    expect(await call('find_menu_items', {})).toEqual({
      message: 'Give at least one filter: category, tags, max_price or query.',
    })
    expect(ui.highlight).not.toHaveBeenCalled()
  })

  it('lists the categories, tags or price format when a filter is wrong', async () => {
    const { call, ui } = setup()

    expect(await call('find_menu_items', { category: 'pasta' })).toEqual({
      message: 'There\'s no "pasta" category. The categories are: pizza, subs, wings, burgers, salads, sides, drinks, dessert.',
    })
    expect(await call('find_menu_items', { tags: ['vegetarian', 'gluten-free'] })).toEqual({
      message: 'There\'s no "gluten-free" tag. The tags are: vegetarian, vegan, spicy, popular.',
    })
    expect(await call('find_menu_items', { max_price: -5 })).toEqual({
      message: 'max_price has to be a price in dollars above zero, such as 10.',
    })
    expect(await call('find_menu_items', { max_price: 'ten' })).toEqual({
      message: 'max_price has to be a price in dollars above zero, such as 10.',
    })
    expect(ui.highlight).not.toHaveBeenCalled()
  })
})

describe('show_suggestions', () => {
  it('shows the cheeseburger pairings on the card, with the total if all were added, without touching the cart', async () => {
    const { call, ui, noCartChanges } = setup()

    const result = await call('show_suggestions', {
      title: 'Goes with the Classic Cheeseburger',
      reason: 'Fries and a soda, the usual.',
      items: [
        { id: 'fries', quantity: 1 },
        { id: 'soda', quantity: 1 },
      ],
    })

    expect(ui.showSuggestions).toHaveBeenCalledWith({
      title: 'Goes with the Classic Cheeseburger',
      reason: 'Fries and a soda, the usual.',
      lines: [
        { id: 'fries', name: 'Fries', quantity: 1, unitPrice: '$4.99', lineTotal: '$4.99' },
        { id: 'soda', name: 'Fountain Soda', quantity: 1, unitPrice: '$2.49', lineTotal: '$2.49' },
      ],
      total: '$7.48',
    })
    expect(result).toEqual({ shown: true, total: '$7.48' })
    noCartChanges()
  })

  it('totals a group plan', async () => {
    const { call } = setup()

    const result = await call('show_suggestions', {
      title: 'Party of 20',
      items: [
        { id: 'pepperoni-pizza-large', quantity: 4 },
        { id: 'veggie-supreme-pizza-large', quantity: 2 },
        { id: 'buffalo-wings-12pc', quantity: 3 },
      ],
    })

    expect(result).toEqual({ shown: true, total: '$177.91' })
  })

  it('leaves out a missing reason and falls back to a plain title', async () => {
    const { call, ui } = setup()

    await call('show_suggestions', { items: [{ id: 'cannoli', quantity: 2 }], reason: '  ' })

    expect(ui.showSuggestions).toHaveBeenCalledWith({
      title: 'Suggestions',
      lines: [{ id: 'cannoli', name: 'Cannoli', quantity: 2, unitPrice: '$4.99', lineTotal: '$9.98' }],
      total: '$9.98',
    })
  })

  it('merges repeated ids into one line', async () => {
    const { call, ui } = setup()

    await call('show_suggestions', {
      title: 'Snacks',
      items: [
        { id: 'fries', quantity: 1 },
        { id: 'fries', quantity: 2 },
      ],
    })

    expect(ui.showSuggestions.mock.calls[0][0].lines).toEqual([
      { id: 'fries', name: 'Fries', quantity: 3, unitPrice: '$4.99', lineTotal: '$14.97' },
    ])
  })

  it('shows nothing when a line is bad, and names it', async () => {
    const { call, ui } = setup()

    const result = await call('show_suggestions', {
      title: 'Party of 4',
      items: [
        { id: 'cheese-pizza-large', quantity: 1 },
        { id: 'hawaiian', quantity: 1 },
      ],
    })

    expect(result).toEqual({
      message:
        'Nothing was shown. Line 2 ("hawaiian"): That\'s not on the menu, and nothing on it is close. Offer something we do have.',
    })
    expect(ui.showSuggestions).not.toHaveBeenCalled()
  })

  it("doesn't check suggestions against the cart, since Add all checks again when tapped", async () => {
    const { call, given } = setup()
    given({ fries: 20 })

    expect(await call('show_suggestions', { title: 'More fries', items: [{ id: 'fries', quantity: 2 }] })).toEqual({
      shown: true,
      total: '$9.98',
    })
  })
})

describe('checkout', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says the cart is empty instead of starting checkout', async () => {
    const { call, checkout, ui } = setup()

    expect(await call('checkout')).toEqual({ message: 'The cart is empty.' })
    expect(checkout).not.toHaveBeenCalled()
    expect(ui.goToCheckout).not.toHaveBeenCalled()
  })

  it("checks out the cart and goes to Stripe's page", async () => {
    const { call, checkout, given, store, ui } = setup()
    given({ 'margherita-pizza-large': 1 })

    expect(await call('checkout')).toEqual({ ok: true })
    expect(checkout).toHaveBeenCalledWith(store.getState().cartDetails)
    expect(ui.goToCheckout).toHaveBeenCalledWith(SESSION_URL)
  })

  it('passes on the message when checkout says no', async () => {
    const { call, given, ui } = setup(async () => ({ message: "Checkout isn't set up on this shop yet." }))
    given({ fries: 1 })

    expect(await call('checkout')).toEqual({ message: "Checkout isn't set up on this shop yet." })
    expect(ui.goToCheckout).not.toHaveBeenCalled()
  })

  it('says checkout is unavailable when the request fails', async () => {
    const { call, given, ui } = setup(async () => {
      throw new Error('offline')
    })
    given({ fries: 1 })

    expect(await call('checkout')).toEqual({ message: CHECKOUT_UNAVAILABLE })
    expect(ui.goToCheckout).not.toHaveBeenCalled()
  })
})

describe('when something unexpected throws', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a message instead of throwing, so the agent can keep talking', async () => {
    const { call, cart } = setup()
    cart.addItem.mockImplementation(() => {
      throw new Error('boom')
    })

    expect(await call('add_item', { id: 'fries', quantity: 1 })).toEqual({
      message: "That didn't work. Call view_cart to see the cart, then try again.",
    })
  })
})

describe('the summaries the handlers compute', () => {
  it('match what use-shopping-cart really holds after every change', async () => {
    const { call, storeSummary } = setup()
    const steps: Array<[ToolName, unknown]> = [
      ['add_item', { id: 'margherita-pizza-large', quantity: 2 }],
      ['add_item', { id: 'fries', quantity: 1 }],
      ['set_quantity', { id: 'margherita-pizza-large', quantity: 1 }],
      ['add_items', { items: [{ id: 'soda', quantity: 2 }, { id: 'fries', quantity: 1 }, { id: 'cannoli', quantity: 1 }] }],
      ['remove_item', { id: 'fries' }],
      ['add_item', { id: 'fries', quantity: 1 }],
      ['set_quantity', { id: 'soda', quantity: 5 }],
      ['view_cart', {}],
      ['clear_cart', {}],
      ['add_items', { items: [{ id: 'pepperoni-pizza-large', quantity: 1 }, { id: 'pepperoni-pizza-large', quantity: 2 }] }],
    ]

    for (const [name, args] of steps) {
      const result = await call(name, args)
      expect(result, `${name} ${JSON.stringify(args)}`).toEqual(storeSummary())
    }
  })
})

describe('the golden path', () => {
  it('runs as tool calls', async () => {
    const { call, ui } = setup()

    const vegetarian = await call('find_menu_items', { tags: ['vegetarian'] })
    expect(vegetarian).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: 'margherita-pizza' })]) })

    await call('add_item', { id: 'margherita-pizza-large', quantity: 2 })
    expect(ui.openCart).toHaveBeenCalledTimes(1)

    expect(await call('set_quantity', { id: 'margherita-pizza-large', quantity: 1 })).toMatchObject({ count: 1 })

    const cart = await call('view_cart')
    expect(cart).toEqual({
      lines: [{ id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 1, total: '$20.99' }],
      count: 1,
      total: '$20.99',
    })
    expect(JSON.parse(JSON.stringify(cart))).toEqual(cart)

    expect(await call('checkout')).toEqual({ ok: true })
    expect(ui.goToCheckout).toHaveBeenCalledWith(SESSION_URL)
  })
})
