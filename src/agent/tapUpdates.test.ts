import { describe, expect, it } from 'vitest'
import { summarizeCart } from './cartSummary'
import { applyTapChange, describeTapChange, type TapChange } from './tapUpdates'

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
})

describe('applyTapChange', () => {
  const before = { 'margherita-pizza-large': 2, fries: 1 }

  it('adds a new line at the end, and adds to a line already in the cart', () => {
    const after = applyTapChange(before, {
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
    expect(applyTapChange(before, { type: 'quantity', id: 'margherita-pizza-large', quantity: 3 })).toEqual({
      'margherita-pizza-large': 3,
      fries: 1,
    })
  })

  it('removes a line', () => {
    expect(applyTapChange(before, { type: 'remove', id: 'fries' })).toEqual({ 'margherita-pizza-large': 2 })
  })

  it('empties the cart', () => {
    expect(applyTapChange(before, { type: 'clear' })).toEqual({})
  })

  it('leaves the cart it was given unchanged', () => {
    applyTapChange(before, { type: 'add', lines: [{ id: 'fries', quantity: 1 }] })
    applyTapChange(before, { type: 'quantity', id: 'fries', quantity: 5 })
    applyTapChange(before, { type: 'remove', id: 'fries' })

    expect(before).toEqual({ 'margherita-pizza-large': 2, fries: 1 })
  })

  it('feeds describeTapChange the cart after the tap', () => {
    const change: TapChange = { type: 'add', lines: [{ id: 'fries', quantity: 1 }] }

    expect(describeTapChange(change, summarizeCart(applyTapChange({ 'margherita-pizza-large': 2 }, change)))).toBe(
      `Customer added 1 × Fries by tapping. ${CART}`,
    )
  })
})
