import { describe, expect, it } from 'vitest'
import { ShoppingCart } from 'use-shopping-cart/core'
import { findVariant } from '../menu/menu'
import { CURRENCY, LOCALE } from '../shop'
import { quantitiesOf, summarizeCart } from './cartSummary'

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
