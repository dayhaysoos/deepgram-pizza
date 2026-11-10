import { describe, expect, it } from 'vitest'
import { applyCartChange, summarizeCart, type CartChange } from './cartSummary'
import { describeTapChange } from './tapUpdates'

const cartAfter = summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })
const CART = 'Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97.'

describe('describeTapChange', () => {
  it('describes an add from a menu card', () => {
    expect(describeTapChange({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] }, cartAfter)).toBe(
      `Customer added 1 × Fries by tapping. ${CART}`,
    )
  })

  it('describes Add all from the suggestion card', () => {
    const lines = [
      { id: 'margherita-pizza-large', quantity: 2 },
      { id: 'fries', quantity: 1 },
    ]

    expect(describeTapChange({ type: 'add', lines }, cartAfter)).toBe(
      `Customer added 2 × Large Margherita Pizza, 1 × Fries by tapping. ${CART}`,
    )
  })

  it('describes a quantity change from + or − in the drawer', () => {
    expect(describeTapChange({ type: 'quantity', id: 'margherita-pizza-large', quantity: 2 }, cartAfter)).toBe(
      `Customer changed Large Margherita Pizza to 2 by tapping. ${CART}`,
    )
  })

  it('describes a removed line', () => {
    expect(describeTapChange({ type: 'remove', id: 'soda' }, cartAfter)).toBe(
      `Customer removed Fountain Soda by tapping. ${CART}`,
    )
  })

  it('describes an emptied cart', () => {
    expect(describeTapChange({ type: 'clear' }, summarizeCart({}))).toBe(
      'Customer emptied the cart by tapping. Cart: empty.',
    )
  })

  it('says the cart is empty after removing the last line', () => {
    expect(describeTapChange({ type: 'remove', id: 'fries' }, summarizeCart({}))).toBe(
      'Customer removed Fries by tapping. Cart: empty.',
    )
  })

  it('names a product that is no longer on the menu by its id', () => {
    expect(describeTapChange({ type: 'remove', id: 'hawaiian-pizza-large' }, summarizeCart({}))).toBe(
      'Customer removed hawaiian-pizza-large by tapping. Cart: empty.',
    )
  })

  it('is fed the cart after the tap, worked out by applyCartChange', () => {
    const change: CartChange = { type: 'add', lines: [{ id: 'fries', quantity: 1 }] }

    expect(describeTapChange(change, summarizeCart(applyCartChange({ 'margherita-pizza-large': 2 }, change)))).toBe(
      `Customer added 1 × Fries by tapping. ${CART}`,
    )
  })
})
