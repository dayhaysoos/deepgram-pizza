import { describe, expect, it, vi } from 'vitest'
import { ShoppingCart } from 'use-shopping-cart/core'
import { findVariant } from '../menu/menu'
import { CURRENCY, LOCALE } from '../shop'
import { createCartChanges } from './cartChanges'
import { quantitiesOf, summarizeCart, type CartChange } from './cartSummary'

/**
 * The cart changes over a real use-shopping-cart store, behaving the way they
 * will in React: `cartDetails()` returns the cart as of the last render, and
 * what an action changes shows up there only after `render()`. A change that
 * read the cart back after acting would get the old cart, and the checks
 * against the store below would catch it.
 */
function setup() {
  const store = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
  let rendered = store.getState().cartDetails
  const render = () => {
    rendered = store.getState().cartDetails
  }
  const tellAgent = vi.fn<(text: string) => void>()
  const onTapUpdate = vi.fn<(text: string) => void>()
  const cart = createCartChanges({
    store: {
      cartDetails: () => rendered,
      addItem: (product, options) => store.addItem(product, options),
      setItemQuantity: (id, quantity) => store.setItemQuantity(id, quantity),
      removeItem: (id) => store.removeItem(id),
      clearCart: () => store.clearCart(),
    },
    tellAgent,
    onTapUpdate,
  })

  /** What the store really holds now, in its order. */
  const inStore = () => Object.entries(quantitiesOf(store.getState().cartDetails))

  /** Puts lines in the cart some other way than a change (a cart saved from an earlier visit, say), and renders. */
  function given(lines: Record<string, number>) {
    for (const [id, count] of Object.entries(lines)) store.addItem(findVariant(id)!.product, { count })
    render()
  }

  return { store, cart, render, given, tellAgent, onTapUpdate, inStore }
}

// Every kind of change, with lines added to, set, removed, and added back.
const CHANGES: CartChange[] = [
  { type: 'add', lines: [{ id: 'margherita-pizza-large', quantity: 2 }, { id: 'fries', quantity: 1 }] },
  { type: 'add', lines: [{ id: 'soda', quantity: 1 }, { id: 'fries', quantity: 2 }] },
  { type: 'quantity', id: 'fries', quantity: 5 },
  { type: 'remove', id: 'margherita-pizza-large' },
  { type: 'add', lines: [{ id: 'margherita-pizza-large', quantity: 1 }] },
  { type: 'clear' },
  { type: 'add', lines: [{ id: 'cannoli', quantity: 3 }, { id: 'pepperoni-pizza-large', quantity: 1 }] },
]

describe('change', () => {
  it("runs use-shopping-cart's actions for every kind of change, and summarizes what the store then holds", () => {
    const { cart, render, inStore, store } = setup()

    for (const change of CHANGES) {
      const summary = cart.change(change)
      render()
      expect(summary, JSON.stringify(change)).toEqual(summarizeCart(quantitiesOf(store.getState().cartDetails)))
      expect(Object.entries(cart.now()), 'line order').toEqual(inStore())
    }
  })

  it('stays right when several changes come before React renders', () => {
    const { cart, inStore, store } = setup()

    for (const change of CHANGES) {
      const summary = cart.change(change)
      expect(summary, JSON.stringify(change)).toEqual(summarizeCart(quantitiesOf(store.getState().cartDetails)))
      expect(Object.entries(cart.now()), 'line order').toEqual(inStore())
    }
  })

  it('reads the rendered cart again once React renders a change made some other way', () => {
    const { cart, render, given } = setup()
    cart.change({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })
    render()

    given({ soda: 2 })

    expect(cart.now()).toEqual({ fries: 1, soda: 2 })
    expect(cart.change({ type: 'add', lines: [{ id: 'soda', quantity: 1 }] })).toEqual(summarizeCart({ fries: 1, soda: 3 }))
  })

  it('throws for a line that is not on the menu, before changing anything', () => {
    const { cart, inStore } = setup()
    cart.change({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })

    expect(() =>
      cart.change({
        type: 'add',
        lines: [
          { id: 'soda', quantity: 1 },
          { id: 'hawaiian-pizza', quantity: 1 },
        ],
      }),
    ).toThrow('"hawaiian-pizza" isn\'t on the menu')
    expect(inStore()).toEqual([['fries', 1]])
    expect(cart.now()).toEqual({ fries: 1 })
  })

  it("doesn't tell the agent: a tool's change comes back to it as the tool's result", () => {
    const { cart, tellAgent, onTapUpdate } = setup()

    cart.change({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })

    expect(tellAgent).not.toHaveBeenCalled()
    expect(onTapUpdate).not.toHaveBeenCalled()
  })

  it('gives checkout the rendered cart', () => {
    const { cart, given, store } = setup()
    given({ fries: 1 })

    expect(cart.cartDetails()).toBe(store.getState().cartDetails)
  })
})

describe('tap', () => {
  // The five taps that change the cart, each from a cart holding 2 large margheritas and 1 fries.
  it.each<[string, CartChange, string]>([
    [
      'Add on a menu card',
      { type: 'add', lines: [{ id: 'soda', quantity: 1 }] },
      'Customer added 1 × Fountain Soda by tapping. Cart: 2 × Large Margherita Pizza, 1 × Fries, 1 × Fountain Soda. Total $49.46. Call view_cart before answering about the cart.',
    ],
    [
      '− in the cart drawer',
      { type: 'quantity', id: 'margherita-pizza-large', quantity: 1 },
      'Customer changed Large Margherita Pizza to 1 by tapping. Cart: 1 × Large Margherita Pizza, 1 × Fries. Total $25.98. Call view_cart before answering about the cart.',
    ],
    [
      '+ in the cart drawer',
      { type: 'quantity', id: 'fries', quantity: 2 },
      'Customer changed Fries to 2 by tapping. Cart: 2 × Large Margherita Pizza, 2 × Fries. Total $51.96. Call view_cart before answering about the cart.',
    ],
    [
      'Remove in the cart drawer',
      { type: 'remove', id: 'margherita-pizza-large' },
      'Customer removed Large Margherita Pizza by tapping. Cart: 1 × Fries. Total $4.99. Call view_cart before answering about the cart.',
    ],
    [
      'Add all on the suggestion card',
      { type: 'add', lines: [{ id: 'garlic-knots', quantity: 1 }, { id: 'fries', quantity: 1 }] },
      'Customer added 1 × Garlic Knots (6), 1 × Fries by tapping. Cart: 2 × Large Margherita Pizza, 2 × Fries, 1 × Garlic Knots (6). Total $57.95. Call view_cart before answering about the cart.',
    ],
  ])('%s: makes the change and tells the agent and the observer, with the cart after it', (_tap, change, told) => {
    const { cart, given, tellAgent, onTapUpdate, store } = setup()
    given({ 'margherita-pizza-large': 2, fries: 1 })

    const summary = cart.tap(change)

    expect(summary).toEqual(summarizeCart(quantitiesOf(store.getState().cartDetails)))
    expect(tellAgent).toHaveBeenCalledExactlyOnceWith(told)
    expect(onTapUpdate).toHaveBeenCalledExactlyOnceWith(told)
  })

  it('tells the agent without an observer', () => {
    const tellAgent = vi.fn<(text: string) => void>()
    const store = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
    const cart = createCartChanges({
      store: {
        cartDetails: () => store.getState().cartDetails,
        addItem: (product, options) => store.addItem(product, options),
        setItemQuantity: (id, quantity) => store.setItemQuantity(id, quantity),
        removeItem: (id) => store.removeItem(id),
        clearCart: () => store.clearCart(),
      },
      tellAgent,
    })

    cart.tap({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })

    expect(tellAgent).toHaveBeenCalledExactlyOnceWith('Customer added 1 × Fries by tapping. Cart: 1 × Fries. Total $4.99. Call view_cart before answering about the cart.')
  })
})

describe('taps and tool calls before React renders', () => {
  it('a tool call right after a tap counts the tap', () => {
    const { cart, inStore, store } = setup()

    cart.tap({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })
    expect(cart.now()).toEqual({ fries: 1 })
    const summary = cart.change({ type: 'add', lines: [{ id: 'fries', quantity: 2 }] })

    expect(summary).toEqual(summarizeCart({ fries: 3 }))
    expect(summary).toEqual(summarizeCart(quantitiesOf(store.getState().cartDetails)))
    expect(Object.entries(cart.now())).toEqual(inStore())
  })

  it('a tap right after a tool call counts the call, in what the agent is told', () => {
    const { cart, tellAgent, store } = setup()

    cart.change({ type: 'add', lines: [{ id: 'margherita-pizza-large', quantity: 2 }] })
    const summary = cart.tap({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] })

    expect(tellAgent).toHaveBeenCalledExactlyOnceWith(
      'Customer added 1 × Fries by tapping. Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97. Call view_cart before answering about the cart.',
    )
    expect(summary).toEqual(summarizeCart(quantitiesOf(store.getState().cartDetails)))
  })
})
