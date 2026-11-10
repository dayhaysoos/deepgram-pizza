import { describe, expect, it } from 'vitest'
import { ShoppingCart } from 'use-shopping-cart/core'
import { findVariant } from '../menu/menu'
import { CURRENCY, LOCALE } from '../shop'
import { applyCartChange, describeLine, quantitiesOf, summarizeCart, type CartChange, type Quantities } from './cartSummary'

describe('summarizeCart', () => {
  it('lists each line with its name, quantity and total, in cart order, plus the count and the total', () => {
    expect(summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })).toEqual({
      lines: [
        { id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 2, total: '$41.98' },
        { id: 'fries', name: 'Fries', quantity: 1, total: '$4.99' },
      ],
      count: 3,
      total: '$46.97',
    })
  })

  it('summarizes an empty cart', () => {
    expect(summarizeCart({})).toEqual({ lines: [], count: 0, total: '$0.00' })
  })

  it('leaves out lines that are no longer on the menu', () => {
    expect(summarizeCart({ 'hawaiian-pizza-large': 1, soda: 2 })).toEqual({
      lines: [{ id: 'soda', name: 'Fountain Soda', quantity: 2, total: '$4.98' }],
      count: 2,
      total: '$4.98',
    })
  })
})

describe('describeLine', () => {
  it('names a line by quantity and name', () => {
    expect(describeLine({ name: 'Large Margherita Pizza', quantity: 2 })).toBe('2 × Large Margherita Pizza')
  })
})

describe('quantitiesOf', () => {
  it("reads id → quantity from use-shopping-cart's cartDetails, in cart order", () => {
    const cart = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
    cart.addItem(findVariant('soda')!.product, { count: 2 })
    cart.addItem(findVariant('pepperoni-pizza-large')!.product, { count: 1 })

    expect(Object.entries(quantitiesOf(cart.getState().cartDetails))).toEqual([
      ['soda', 2],
      ['pepperoni-pizza-large', 1],
    ])
  })

  it('takes prices from the menu, not from what the cart entry claims', () => {
    const cartDetails = { fries: { id: 'fries', name: 'Free Fries', price: 0, quantity: 2 } }

    expect(summarizeCart(quantitiesOf(cartDetails))).toEqual({
      lines: [{ id: 'fries', name: 'Fries', quantity: 2, total: '$9.98' }],
      count: 2,
      total: '$9.98',
    })
  })
})

describe('applyCartChange', () => {
  const before = { 'margherita-pizza-large': 2, fries: 1 }

  it('adds a new line at the end, and adds to a line already in the cart', () => {
    const after = applyCartChange(before, {
      type: 'add',
      lines: [
        { id: 'soda', quantity: 2 },
        { id: 'fries', quantity: 1 },
      ],
    })

    expect(after).toEqual({ 'margherita-pizza-large': 2, fries: 2, soda: 2 })
    expect(Object.keys(after)).toEqual(['margherita-pizza-large', 'fries', 'soda'])
  })

  it("sets a line's quantity", () => {
    expect(applyCartChange(before, { type: 'quantity', id: 'margherita-pizza-large', quantity: 3 })).toEqual({
      'margherita-pizza-large': 3,
      fries: 1,
    })
  })

  it('removes a line', () => {
    expect(applyCartChange(before, { type: 'remove', id: 'fries' })).toEqual({ 'margherita-pizza-large': 2 })
  })

  it('empties the cart', () => {
    expect(applyCartChange(before, { type: 'clear' })).toEqual({})
  })

  it('leaves the cart it was given unchanged', () => {
    applyCartChange(before, { type: 'add', lines: [{ id: 'fries', quantity: 1 }] })
    applyCartChange(before, { type: 'quantity', id: 'fries', quantity: 5 })
    applyCartChange(before, { type: 'remove', id: 'fries' })

    expect(before).toEqual({ 'margherita-pizza-large': 2, fries: 1 })
  })

  it("matches use-shopping-cart's own actions for every kind of change, line order included", () => {
    const store = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
    const changes: CartChange[] = [
      { type: 'add', lines: [{ id: 'margherita-pizza-large', quantity: 2 }, { id: 'fries', quantity: 1 }] },
      { type: 'add', lines: [{ id: 'soda', quantity: 1 }, { id: 'fries', quantity: 2 }] },
      { type: 'quantity', id: 'fries', quantity: 5 },
      { type: 'remove', id: 'margherita-pizza-large' },
      { type: 'clear' },
      { type: 'add', lines: [{ id: 'cannoli', quantity: 3 }] },
    ]

    let quantities: Quantities = {}
    for (const change of changes) {
      quantities = applyCartChange(quantities, change)
      performOnStore(store, change)
      expect(Object.entries(quantitiesOf(store.getState().cartDetails)), JSON.stringify(change)).toEqual(
        Object.entries(quantities),
      )
    }
  })
})

/** Makes a change with use-shopping-cart's actions, the way the handlers and taps do. */
function performOnStore(store: ShoppingCart, change: CartChange) {
  switch (change.type) {
    case 'add':
      for (const { id, quantity } of change.lines) store.addItem(findVariant(id)!.product, { count: quantity })
      return
    case 'quantity':
      return store.setItemQuantity(change.id, change.quantity)
    case 'remove':
      return store.removeItem(change.id)
    case 'clear':
      return store.clearCart()
  }
}
