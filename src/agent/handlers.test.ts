import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckoutResult } from '../checkout/checkout'
import { menu, products } from '../menu/menu'
import { createCartChanges } from './cartChanges'
import { quantitiesOf, summarizeCart } from './cartSummary'
import { checkLinesToAdd, createToolHandlers, type Suggestions, type ToolPorts, type ToolResult } from './handlers'
import { createOrderTypeStore } from './orderType'
import { planGroupOrder } from './planGroupOrder'
import { renderedStore } from './testing'
import { checkoutLine, type ToolName } from './tools'

const SESSION_URL = 'https://checkout.stripe.com/c/pay/cs_test_fake'

/** The line the agent says once checkout returns ok, with the amount checkout returned. */
function checkoutLineFor(result: ToolResult, type: 'pickup' | 'delivery'): string {
  if (!('ok' in result) || !('totalSpoken' in result)) throw new Error(`Checkout didn't go ahead: ${JSON.stringify(result)}`)
  return checkoutLine(result.totalSpoken, type)
}

/**
 * The handlers with the page's cart changes (cartChanges.ts) over a real
 * use-shopping-cart store, behaving the way they will in React (renderedStore):
 * the cart as of the last render shows a change only after the next render
 * (here, after each `call`; `handlers` and `render` run calls that arrive before a render).
 * `cart` watches the cart port, so a test can check the change a handler asked
 * for, and compare the summary it returned with what the store holds.
 */
function setup(respond: () => Promise<CheckoutResult> = async () => ({ url: SESSION_URL })) {
  const { store, cartStore, render, given, holds } = renderedStore()
  // Pickup or delivery, in memory: no storage in Node.
  const orderType = createOrderTypeStore(null)
  const cartChanges = createCartChanges({ store: cartStore, orderType, tellAgent: () => {} })
  const cart = {
    now: vi.fn(cartChanges.now),
    cartDetails: vi.fn(cartChanges.cartDetails),
    change: vi.fn(cartChanges.change),
  }
  // Like MenuUiProvider: a card is open from showSuggestions until closeSuggestions.
  let showing = false
  const ui = {
    highlight: vi.fn(),
    showSuggestions: vi.fn<(suggestions: Suggestions) => void>(() => {
      showing = true
    }),
    closeSuggestions: vi.fn(() => {
      showing = false
    }),
    isShowingSuggestions: vi.fn(() => showing),
    openCart: vi.fn(),
    goToCheckout: vi.fn(),
  }
  const checkout = vi.fn<ToolPorts['checkout']>(respond)
  const handlers = createToolHandlers({ cart, ui, checkout, orderType })

  async function call(name: ToolName, args: unknown = {}) {
    const result = await handlers[name](args)
    render()
    return result
  }

  /** The summary of what the store really holds now. */
  function storeSummary() {
    return summarizeCart(holds())
  }

  function noCartChanges() {
    expect(cart.change).not.toHaveBeenCalled()
  }

  return { store, cart, ui, checkout, orderType, handlers, render, call, given, storeSummary, noCartChanges }
}

const BAD_QUANTITY = 'The quantity has to be a whole number from 1 to 20.'

describe('add_item', () => {
  it('adds the product and returns the cart', async () => {
    const { cart, call, storeSummary } = setup()

    const result = await call('add_item', { id: 'margherita-pizza-large', quantity: 2 })

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({ type: 'add', lines: [{ id: 'margherita-pizza-large', quantity: 2 }] })
    expect(result).toEqual({
      lines: [{ id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 2, total: '$41.98' }],
      count: 2,
      total: '$41.98',
      totalSpoken: 'forty-one ninety-eight',
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
    expect(cart.change).not.toHaveBeenCalled()

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

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({
      type: 'add',
      lines: [
        { id: 'pepperoni-pizza-large', quantity: 4 },
        { id: 'buffalo-wings-12pc', quantity: 3 },
        { id: 'soda', quantity: 10 },
      ],
    })
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

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({
      type: 'add',
      lines: [
        { id: 'fries', quantity: 5 },
        { id: 'soda', quantity: 1 },
      ],
    })
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

describe('checkLinesToAdd, for the suggestion card’s Add and Add all', () => {
  it('passes lines with the same checks as add_items, merging repeated ids', () => {
    // The card passes its own lines, which carry a name and a total too.
    const lines = summarizeCart({ soda: 2, fries: 1 }).lines

    expect(checkLinesToAdd([...lines, { id: 'soda', quantity: 1 }], { fries: 1 })).toEqual({
      lines: [
        { id: 'soda', quantity: 3 },
        { id: 'fries', quantity: 1 },
      ],
    })
  })

  it('passes none when a line is bad, counting the cart it is given', () => {
    expect(
      checkLinesToAdd(
        [
          { id: 'fries', quantity: 1 },
          { id: 'soda', quantity: 25 },
        ],
        {},
      ),
    ).toEqual({ message: `Nothing was added. Line 2 ("soda"): ${BAD_QUANTITY}` })
    expect(checkLinesToAdd([{ id: 'soda', quantity: 2 }], { soda: 19 })).toEqual({
      message:
        'Nothing was added. Line 1 ("soda"): That would make 21 × Fountain Soda, and a line holds at most 20. There are 19 in the cart now.',
    })
  })
})

describe('set_quantity', () => {
  it('sets the quantity and returns the cart', async () => {
    const { cart, call, given, storeSummary } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const result = await call('set_quantity', { id: 'margherita-pizza-large', quantity: 1 })

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({ type: 'quantity', id: 'margherita-pizza-large', quantity: 1 })
    expect(result).toEqual(summarizeCart({ 'margherita-pizza-large': 1, fries: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('lists the cart, with ids, when the item is on the menu but not in the cart', async () => {
    const { call, given, noCartChanges } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    expect(await call('set_quantity', { id: 'pepperoni-pizza-large', quantity: 1 })).toEqual({
      message:
        "That isn't in the cart. The cart has: 2 × Large Margherita Pizza (margherita-pizza-large), 1 × Fries (fries).",
    })
    noCartChanges()
  })

  it('answers an id that is not on the menu as add_item does', async () => {
    const { call, given, noCartChanges } = setup()
    given({ 'margherita-pizza-large': 2 })

    expect(await call('set_quantity', { id: 'margarita', quantity: 1 })).toEqual({
      message:
        "That's not on the menu. Close matches: Margherita Pizza (margherita-pizza-medium or margherita-pizza-large).",
    })
    expect(await call('set_quantity', { id: 'margherita-pizza', quantity: 1 })).toEqual({
      message: 'Margherita Pizza comes in medium or large. Which one?',
    })
    expect(await call('set_quantity', { id: 'constructor', quantity: 1 })).toEqual({
      message: "That's not on the menu, and nothing on it is close. Offer something we do have.",
    })
    expect(await call('set_quantity', { quantity: 1 })).toEqual({
      message: "The id is missing. Send the item's id from the menu.",
    })
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

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({ type: 'remove', id: 'margherita-pizza-large' })
    expect(result).toEqual(summarizeCart({ fries: 1 }))
    expect(result).toEqual(storeSummary())
  })

  it('lists the cart when the item is on the menu but not in the cart', async () => {
    const { call, given, noCartChanges } = setup()
    given({ fries: 1 })

    expect(await call('remove_item', { id: 'soda' })).toEqual({
      message: "That isn't in the cart. The cart has: 1 × Fries (fries).",
    })
    noCartChanges()
  })

  it('answers an id that is not on the menu as add_item does', async () => {
    const { call, given, noCartChanges } = setup()
    given({ fries: 1 })
    const nothingClose = { message: "That's not on the menu, and nothing on it is close. Offer something we do have." }

    expect(await call('remove_item', { id: 'hawaiian' })).toEqual(nothingClose)
    expect(await call('remove_item', { id: '__proto__' })).toEqual(nothingClose)
    expect(await call('remove_item', { id: 'pepperoni-pizza' })).toEqual({
      message: 'Pepperoni Pizza comes in medium or large. Which one?',
    })
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

    expect(await call('view_cart')).toEqual({ lines: [], count: 0, total: '$0.00', totalSpoken: 'zero dollars' })
  })
})

// The agent said "forty-one ninety-eight" for a delivery order, and Stripe charged $45.97 (.build/step-5b.md).
describe('the cart the agent reads, for delivery', () => {
  const DELIVERY_ON_41_98 = {
    fee: '$3.99',
    feeSpoken: 'three ninety-nine',
    totalWithDelivery: '$45.97',
    totalWithDeliverySpoken: 'forty-five ninety-seven',
  }

  it('carries the delivery fee and the total with it, after every cart tool and in view_cart', async () => {
    const { call, given, orderType } = setup()
    orderType.set('delivery')

    expect(await call('add_item', { id: 'margherita-pizza-large', quantity: 2 })).toMatchObject({
      total: '$41.98',
      totalSpoken: 'forty-one ninety-eight',
      delivery: DELIVERY_ON_41_98,
    })
    expect(await call('view_cart')).toEqual(summarizeCart({ 'margherita-pizza-large': 2 }, 'delivery'))
    expect(await call('view_cart')).toMatchObject({ delivery: DELIVERY_ON_41_98 })
    expect(await call('set_quantity', { id: 'margherita-pizza-large', quantity: 1 })).toMatchObject({
      delivery: { totalWithDelivery: '$24.98', totalWithDeliverySpoken: 'twenty-four ninety-eight' },
    })
    expect(await call('add_items', { items: [{ id: 'fries', quantity: 1 }] })).toMatchObject({
      delivery: { totalWithDelivery: '$29.97' },
    })
    expect(await call('remove_item', { id: 'fries' })).toMatchObject({ delivery: { totalWithDelivery: '$24.98' } })
    // Nothing to deliver in an empty cart.
    expect(await call('clear_cart')).toEqual(summarizeCart({}))
    given({ soda: 1 })
    expect(await call('view_cart')).toMatchObject({ delivery: { totalWithDelivery: '$6.48' } })
  })

  it('follows the choice as it is when the tool runs', async () => {
    const { call, given, orderType } = setup()
    given({ 'margherita-pizza-large': 2 })

    expect(await call('view_cart')).not.toHaveProperty('delivery')
    await call('set_order_type', { type: 'delivery' })
    expect(await call('view_cart')).toMatchObject({ delivery: DELIVERY_ON_41_98 })
    orderType.set('pickup')
    expect(await call('view_cart')).toEqual(summarizeCart({ 'margherita-pizza-large': 2 }))
  })

  it('leaves pickup as it was', async () => {
    const { call, orderType } = setup()
    orderType.set('pickup')

    expect(await call('add_item', { id: 'margherita-pizza-large', quantity: 2 })).toEqual(
      summarizeCart({ 'margherita-pizza-large': 2 }),
    )
    expect(await call('view_cart')).not.toHaveProperty('delivery')
  })
})

describe('clear_cart', () => {
  it('empties the cart and returns it', async () => {
    const { cart, call, given, storeSummary } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const result = await call('clear_cart')

    expect(cart.change).toHaveBeenCalledExactlyOnceWith({ type: 'clear' })
    expect(result).toEqual({ lines: [], count: 0, total: '$0.00', totalSpoken: 'zero dollars' })
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
        { id: 'fries', name: 'Fries', quantity: 1, total: '$4.99' },
        { id: 'soda', name: 'Fountain Soda', quantity: 1, total: '$2.49' },
      ],
      total: '$7.48',
    })
    // The card shows the written total; the agent gets the spoken one too.
    expect(result).toEqual({ shown: true, total: '$7.48', totalSpoken: 'seven forty-eight' })
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

    expect(result).toEqual({ shown: true, total: '$177.91', totalSpoken: 'one hundred seventy-seven dollars and ninety-one cents' })
  })

  it('leaves out a missing reason and falls back to a plain title', async () => {
    const { call, ui } = setup()

    await call('show_suggestions', { items: [{ id: 'cannoli', quantity: 2 }], reason: '  ' })

    expect(ui.showSuggestions).toHaveBeenCalledWith({
      title: 'Suggestions',
      lines: [{ id: 'cannoli', name: 'Cannoli', quantity: 2, total: '$9.98' }],
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
      { id: 'fries', name: 'Fries', quantity: 3, total: '$14.97' },
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
      totalSpoken: 'nine ninety-eight',
    })
  })
})

describe('plan_group_order', () => {
  it('shows the plan for the group on the card, and returns its summary, total and lines, without touching the cart', async () => {
    const { call, ui, noCartChanges } = setup()

    const result = await call('plan_group_order', JSON.stringify({ people: 30, vegetarians: 10 }))

    const plan = planGroupOrder({ people: 30, vegetarians: 10 })
    if ('message' in plan) throw new Error(plan.message)
    const priced = summarizeCart(Object.fromEntries(plan.lines.map(({ id, quantity }) => [id, quantity])))
    expect(ui.showSuggestions).toHaveBeenCalledWith({
      title: 'Party of 30',
      reason: 'Mains for 32 (12 vegetarian), sides to share and a drink each.',
      lines: priced.lines,
      total: priced.total,
    })
    expect(result).toEqual({
      shown: true,
      summary: '8 large pizzas, 3 of them vegetarian, plus garlic knots and a drink each',
      total: priced.total,
      totalSpoken: priced.totalSpoken,
      lines: priced.lines.map(({ id, name, quantity }) => ({ id, name, quantity })),
    })
    expect(result).toMatchObject({ lines: expect.arrayContaining([{ id: 'pepperoni-pizza-large', name: 'Large Pepperoni Pizza', quantity: 3 }]) })
    noCartChanges()
  })

  it("passes on the planner's message, and shows nothing, when it can't plan", async () => {
    const { call, ui } = setup()

    expect(await call('plan_group_order', { people: 10, vegetarians: 12 })).toEqual({
      message:
        "Nothing was shown. That's 12 vegetarians in a group of 10. Ask how many people in all, and how many of them are vegetarian.",
    })
    expect(await call('plan_group_order', 'not json')).toEqual({
      message: 'Nothing was shown. people has to be how many are eating: a whole number, 1 or more.',
    })
    expect(ui.showSuggestions).not.toHaveBeenCalled()
  })

  it('plans around what the cart holds, so "add all of that" fits even after the pairings added a soda', async () => {
    // The step 5 Check: the cheeseburger's pairings (fries and a soda) are in the cart, then a party of 20.
    const { call, ui, given, storeSummary } = setup()
    given({ 'classic-cheeseburger': 1, fries: 1, soda: 1 })

    const shown = await call('plan_group_order', { people: 20 })
    if (!('lines' in shown) || !('summary' in shown)) throw new Error('No plan shown')
    expect(shown.lines.filter(({ id }) => id === 'soda' || id === 'lemonade')).toEqual([
      { id: 'soda', name: 'Fountain Soda', quantity: 19 },
      { id: 'lemonade', name: 'Fresh Lemonade', quantity: 1 },
    ])

    const added = await call('add_items', { items: shown.lines.map(({ id, quantity }) => ({ id, quantity })) })

    expect(added).not.toHaveProperty('message')
    expect(added).toEqual(storeSummary())
    expect(added).toMatchObject({ lines: expect.arrayContaining([expect.objectContaining({ id: 'soda', quantity: 20 })]) })
    expect(ui.closeSuggestions).toHaveBeenCalledTimes(1)
  })

  it('closes the card when "add all of that" adds the plan, as for show_suggestions', async () => {
    const { call, ui, storeSummary } = setup()
    const shown = await call('plan_group_order', { people: 8, vegetarians: 2 })
    if (!('lines' in shown) || !('summary' in shown)) throw new Error('No plan shown')

    const added = await call('add_items', { items: shown.lines.map(({ id, quantity }) => ({ id, quantity })) })

    expect(ui.closeSuggestions).toHaveBeenCalledTimes(1)
    expect(added).toEqual(storeSummary())
    expect(added).toMatchObject({ total: shown.total })
  })
})

describe('the suggestion card after add_items', () => {
  const plan = [
    { id: 'pepperoni-pizza-large', quantity: 3 },
    { id: 'garlic-knots', quantity: 2 },
    { id: 'soda', quantity: 12 },
  ]

  it('closes when add_items adds exactly the lines it shows, in any order, as Add all would', async () => {
    const { call, ui, storeSummary } = setup()
    await call('show_suggestions', { title: 'Party of 20', items: plan })

    await call('add_items', { items: [...plan].reverse() })

    expect(ui.closeSuggestions).toHaveBeenCalledTimes(1)
    expect(storeSummary()).toEqual(summarizeCart({ soda: 12, 'garlic-knots': 2, 'pepperoni-pizza-large': 3 }))

    // The set was added and the card closed: adding the same lines again is a new order, not the card.
    await call('add_items', { items: plan })
    expect(ui.closeSuggestions).toHaveBeenCalledTimes(1)
  })

  it('matches repeated ids by their sum, as the card merges them', async () => {
    const { call, ui } = setup()
    await call('show_suggestions', { title: 'Snacks', items: [{ id: 'fries', quantity: 3 }] })

    await call('add_items', {
      items: [
        { id: 'fries', quantity: 1 },
        { id: 'fries', quantity: 2 },
      ],
    })

    expect(ui.closeSuggestions).toHaveBeenCalledTimes(1)
  })

  it('stays open when add_items adds other lines, or is refused', async () => {
    const { call, given, ui } = setup()
    await call('show_suggestions', { title: 'Party of 20', items: plan })

    await call('add_items', { items: [{ id: 'soda', quantity: 12 }] })
    await call('add_items', { items: [...plan, { id: 'cannoli', quantity: 1 }] })
    await call('add_items', { items: plan.map((line) => ({ ...line, quantity: 1 })) })
    await call('add_item', { id: 'soda', quantity: 1 })
    expect(ui.closeSuggestions).not.toHaveBeenCalled()

    given({ 'pepperoni-pizza-large': 18 })
    expect(await call('add_items', { items: plan })).toHaveProperty('message')
    expect(ui.closeSuggestions).not.toHaveBeenCalled()
  })
})

describe('several calls before React renders', () => {
  // Deepgram can send several function calls in one request, and they can all
  // run before the next render. The handlers check each call against
  // cart.now(), which counts the calls before it (cartChanges.test.ts tests
  // that). Here, `handlers` runs a call without rendering after it.

  it('lets set_quantity and remove_item change a line added just before', async () => {
    const { handlers, cart, storeSummary } = setup()

    await handlers.add_item({ id: 'margherita-pizza-large', quantity: 2 })
    await handlers.add_items({ items: [{ id: 'fries', quantity: 1 }] })
    const set = await handlers.set_quantity({ id: 'margherita-pizza-large', quantity: 1 })

    expect(cart.change).toHaveBeenLastCalledWith({ type: 'quantity', id: 'margherita-pizza-large', quantity: 1 })
    expect(set).toEqual(summarizeCart({ 'margherita-pizza-large': 1, fries: 1 }))
    expect(set).toEqual(storeSummary())

    const removed = await handlers.remove_item({ id: 'fries' })
    expect(removed).toEqual(summarizeCart({ 'margherita-pizza-large': 1 }))
    expect(removed).toEqual(storeSummary())
    expect(await handlers.view_cart({})).toEqual(storeSummary())
  })

  it('counts earlier calls toward the 20-per-line cap', async () => {
    const { handlers, cart, storeSummary } = setup()

    await handlers.add_item({ id: 'fries', quantity: 15 })

    expect(await handlers.add_item({ id: 'fries', quantity: 6 })).toEqual({
      message: 'That would make 21 × Fries, and a line holds at most 20. There are 15 in the cart now.',
    })
    expect(await handlers.add_items({ items: [{ id: 'fries', quantity: 6 }] })).toEqual({
      message:
        'Nothing was added. Line 1 ("fries"): That would make 21 × Fries, and a line holds at most 20. There are 15 in the cart now.',
    })
    expect(cart.change).toHaveBeenCalledTimes(1)
    expect(storeSummary()).toEqual(summarizeCart({ fries: 15 }))
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

  it("checks out the cart, for pickup or delivery, and goes to Stripe's page", async () => {
    const { call, checkout, given, orderType, store, ui } = setup()
    given({ 'margherita-pizza-large': 1 })
    orderType.set('delivery')

    expect(await call('checkout')).toMatchObject({ ok: true })
    expect(checkout).toHaveBeenCalledExactlyOnceWith(store.getState().cartDetails, 'delivery')
    expect(ui.goToCheckout).toHaveBeenCalledWith(SESSION_URL)
  })

  // Every path to checkout ends on the checkout line, so the amount it says
  // comes from here: review round 3 found three delivery paths that reached
  // Stripe without the total with the fee said once (.build/step-5b.md).
  it('returns the amount to pay, written and spoken: the cart total for pickup', async () => {
    const { call, given, orderType } = setup()
    given({ 'margherita-pizza-large': 2 })
    orderType.set('pickup')

    const result = await call('checkout')

    expect(result).toEqual({ ok: true, total: '$41.98', totalSpoken: 'forty-one ninety-eight' })
    expect(checkoutLineFor(result, 'pickup')).toBe('Taking you to checkout now so you can pay forty-one ninety-eight.')
  })

  it('returns the total with the delivery fee for delivery, what Stripe charges', async () => {
    const { call, given, orderType } = setup()
    given({ 'margherita-pizza-large': 2 })
    orderType.set('delivery')

    const result = await call('checkout')

    expect(result).toEqual({ ok: true, total: '$45.97', totalSpoken: 'forty-five ninety-seven' })
    const { delivery } = summarizeCart({ 'margherita-pizza-large': 2 }, 'delivery')
    expect(result).toMatchObject({ total: delivery?.totalWithDelivery, totalSpoken: delivery?.totalWithDeliverySpoken })
    expect(checkoutLineFor(result, 'delivery')).toBe(
      'Taking you to checkout now so you can pay forty-five ninety-seven and enter your delivery address.',
    )
  })

  it('says the amount for the cart it sent to checkout', async () => {
    const { checkout, given, handlers, orderType } = setup()
    given({ fries: 1 })
    orderType.set('pickup')
    // A change the last render doesn't show yet: checkout sends the rendered cart, and prices that one.
    await handlers.add_item({ id: 'soda', quantity: 1 })

    const result = await handlers.checkout({})

    const [sent] = checkout.mock.calls[0]
    expect(quantitiesOf(sent)).toEqual({ fries: 1 })
    expect(result).toEqual({ ok: true, total: '$4.99', totalSpoken: 'four ninety-nine' })
  })

  it('asks for pickup or delivery first, instead of starting checkout without it', async () => {
    const { call, checkout, given, ui } = setup()
    given({ fries: 1 })

    expect(await call('checkout')).toEqual({ message: "Ask whether it's pickup or delivery first." })
    expect(checkout).not.toHaveBeenCalled()
    expect(ui.goToCheckout).not.toHaveBeenCalled()
  })

  it('says the cart is empty before asking about pickup or delivery', async () => {
    expect(await setup().call('checkout')).toEqual({ message: 'The cart is empty.' })
  })

  it('passes on the message when checkout says no', async () => {
    const { call, given, orderType, ui } = setup(async () => ({ message: "Checkout isn't set up on this shop yet." }))
    given({ fries: 1 })
    orderType.set('pickup')

    expect(await call('checkout')).toEqual({ message: "Checkout isn't set up on this shop yet." })
    expect(ui.goToCheckout).not.toHaveBeenCalled()
  })

  // The port never rejects in the app (startCheckout turns a failed request
  // into CHECKOUT_UNAVAILABLE), but a port that breaks that promise still
  // can't silence the agent.
  it('still returns a message, without throwing, if the checkout port rejects', async () => {
    const { call, given, orderType, ui } = setup(async () => {
      throw new Error('offline')
    })
    given({ fries: 1 })
    orderType.set('pickup')

    expect(await call('checkout')).toEqual({
      message: "That didn't work. Call view_cart to see the cart, then try again.",
    })
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
    cart.change.mockImplementation(() => {
      throw new Error('boom')
    })

    expect(await call('add_item', { id: 'fries', quantity: 1 })).toEqual({
      message: "That didn't work. Call view_cart to see the cart, then try again.",
    })
  })
})

describe('set_order_type', () => {
  it('records pickup or delivery and returns it, without touching the cart', async () => {
    const { call, orderType, noCartChanges } = setup()

    expect(await call('set_order_type', { type: 'delivery' })).toEqual({ orderType: 'delivery' })
    expect(orderType.get()).toBe('delivery')
    expect(await call('set_order_type', { type: 'pickup' })).toEqual({ orderType: 'pickup' })
    expect(orderType.get()).toBe('pickup')
    noCartChanges()
  })

  it('takes the JSON string Deepgram sends', async () => {
    const { handlers, orderType } = setup()

    expect(await handlers.set_order_type('{"type":"pickup"}')).toEqual({ orderType: 'pickup' })
    expect(orderType.get()).toBe('pickup')
  })

  it('says what it takes when the type is missing or something else, and keeps the choice it had', async () => {
    const { call, orderType } = setup()
    orderType.set('pickup')
    const message = 'The type has to be "pickup" or "delivery". Ask which, if the customer hasn\'t said.'

    for (const args of [{}, { type: 'takeout' }, { type: 'Delivery' }, { type: null }, { type: ['delivery'] }]) {
      expect(await call('set_order_type', args), JSON.stringify(args)).toEqual({ message })
    }
    expect(orderType.get()).toBe('pickup')
  })

  it('lets checkout go ahead once it is set', async () => {
    const { call, given } = setup()
    given({ fries: 1 })

    expect(await call('checkout')).toEqual({ message: "Ask whether it's pickup or delivery first." })
    await call('set_order_type', { type: 'pickup' })
    expect(await call('checkout')).toEqual({ ok: true, total: '$4.99', totalSpoken: 'four ninety-nine' })
  })
})

describe('the golden path', () => {
  it('runs as tool calls', async () => {
    const { call, ui } = setup()

    expect(await call('set_order_type', { type: 'delivery' })).toEqual({ orderType: 'delivery' })

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
      totalSpoken: 'twenty ninety-nine',
      delivery: {
        fee: '$3.99',
        feeSpoken: 'three ninety-nine',
        totalWithDelivery: '$24.98',
        totalWithDeliverySpoken: 'twenty-four ninety-eight',
      },
    })
    expect(JSON.parse(JSON.stringify(cart))).toEqual(cart)

    // The checkout line says what Stripe charges: the total with the fee.
    expect(await call('checkout')).toEqual({ ok: true, total: '$24.98', totalSpoken: 'twenty-four ninety-eight' })
    expect(ui.goToCheckout).toHaveBeenCalledWith(SESSION_URL)
  })
})

describe('the plan card and the agent repeating it', () => {
  async function planFor20(call: ReturnType<typeof setup>['call']) {
    const shown = await call('plan_group_order', { people: 20 })
    if (!('lines' in shown) || !('summary' in shown)) throw new Error('No plan shown')
    return shown.lines.map(({ id, quantity }) => ({ id, quantity }))
  }

  // In real runs the agent re-showed the plan with a title of its own and no
  // reason, which would have replaced the card and lost the planner's reason.
  it('leaves the plan card as it is when the agent shows the same lines again, in any order', async () => {
    const { call, ui } = setup()
    const lines = await planFor20(call)

    const repeat = await call('show_suggestions', { title: 'Party of 20 plan', items: [...lines].reverse() })

    expect(ui.showSuggestions).toHaveBeenCalledTimes(1)
    expect(repeat).toMatchObject({ shown: true })
  })

  it('shows the plan again if the customer closed its card', async () => {
    const { call, ui } = setup()
    const lines = await planFor20(call)
    ui.closeSuggestions()

    await call('show_suggestions', { title: 'Party of 20', items: lines })

    expect(ui.showSuggestions).toHaveBeenCalledTimes(2)
  })

  it('replaces the plan card when the lines change', async () => {
    const { call, ui } = setup()
    const lines = await planFor20(call)

    await call('show_suggestions', { title: 'Party of 20', items: [...lines.slice(1), { id: 'cannoli', quantity: 2 }] })

    expect(ui.showSuggestions).toHaveBeenCalledTimes(2)
  })

  // Fries and a soda go with the cheeseburger and with the cheesesteak: the
  // second card must say it's for the cheesesteak.
  it('replaces a pairing card with another that has the same lines', async () => {
    const { call, ui } = setup()
    const pairing = [
      { id: 'fries', quantity: 1 },
      { id: 'soda', quantity: 1 },
    ]
    await call('show_suggestions', { title: 'Goes with the Classic Cheeseburger', items: pairing })

    await call('show_suggestions', { title: 'Goes with the Philly Cheesesteak', items: pairing })

    expect(ui.showSuggestions).toHaveBeenCalledTimes(2)
    expect(ui.showSuggestions.mock.calls[1][0]).toMatchObject({ title: 'Goes with the Philly Cheesesteak' })
  })
})
