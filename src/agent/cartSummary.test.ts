import { describe, expect, it } from 'vitest'
import { ShoppingCart } from 'use-shopping-cart/core'
import { findVariant, formatPrice } from '../menu/menu'
import { CURRENCY, DELIVERY_FEE, LOCALE } from '../shop'
import { applyCartChange, describeCart, describeLine, quantitiesOf, summarizeCart } from './cartSummary'
import { spokenPrice } from './spokenPrice'

describe('summarizeCart', () => {
  it('lists each line with its name, quantity and total, in cart order, plus the count and the total, written and spoken', () => {
    expect(summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })).toEqual({
      lines: [
        { id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 2, total: '$41.98' },
        { id: 'fries', name: 'Fries', quantity: 1, total: '$4.99' },
      ],
      count: 3,
      total: '$46.97',
      totalSpoken: 'forty-six ninety-seven',
    })
  })

  it('summarizes an empty cart', () => {
    expect(summarizeCart({})).toEqual({ lines: [], count: 0, total: '$0.00', totalSpoken: 'zero dollars' })
  })

  it('leaves out lines that are no longer on the menu', () => {
    expect(summarizeCart({ 'hawaiian-pizza-large': 1, soda: 2 })).toEqual({
      lines: [{ id: 'soda', name: 'Fountain Soda', quantity: 2, total: '$4.98' }],
      count: 2,
      total: '$4.98',
      totalSpoken: 'four ninety-eight',
    })
  })
})

describe('summarizeCart, spoken', () => {
  it('says the total in the words spokenPrice uses, from a hundred dollars up too', () => {
    expect(summarizeCart({ 'meat-lovers-pizza-large': 8 }).totalSpoken).toBe('one hundred ninety-nine dollars and ninety-two cents')
    expect(summarizeCart({ soda: 4 }).totalSpoken).toBe('nine ninety-six')
  })
})

// The agent said "forty-one ninety-eight" for a delivery order, and Stripe charged $45.97 (.build/step-5b.md).
describe('summarizeCart, for delivery', () => {
  it('adds the delivery fee and the total with it, written and spoken', () => {
    expect(summarizeCart({ 'margherita-pizza-large': 2 }, 'delivery')).toEqual({
      lines: [{ id: 'margherita-pizza-large', name: 'Large Margherita Pizza', quantity: 2, total: '$41.98' }],
      count: 2,
      total: '$41.98',
      totalSpoken: 'forty-one ninety-eight',
      delivery: {
        fee: '$3.99',
        feeSpoken: 'three ninety-nine',
        totalWithDelivery: '$45.97',
        totalWithDeliverySpoken: 'forty-five ninety-seven',
      },
    })
  })

  it('takes the fee from the shop settings, and says a total from a hundred dollars up in full', () => {
    const { delivery } = summarizeCart({ 'meat-lovers-pizza-large': 4 }, 'delivery')
    expect(summarizeCart({ 'meat-lovers-pizza-large': 4 }).total).toBe('$99.96')
    expect(delivery).toEqual({
      fee: formatPrice(DELIVERY_FEE),
      feeSpoken: spokenPrice(DELIVERY_FEE),
      totalWithDelivery: formatPrice(9996 + DELIVERY_FEE),
      totalWithDeliverySpoken: 'one hundred three dollars and ninety-five cents',
    })
  })

  it('leaves the summary as it was for pickup, or before the customer has chosen', () => {
    const cart = { 'margherita-pizza-large': 2, fries: 1 }
    for (const orderType of ['pickup', null] as const) {
      expect(summarizeCart(cart, orderType)).toEqual(summarizeCart(cart))
      expect(summarizeCart(cart, orderType)).not.toHaveProperty('delivery')
    }
  })

  it('has no delivery for an empty cart, since there is nothing to deliver', () => {
    expect(summarizeCart({}, 'delivery')).toEqual(summarizeCart({}))
  })
})

describe('describeLine', () => {
  it('names a line by quantity and name', () => {
    expect(describeLine({ name: 'Large Margherita Pizza', quantity: 2 })).toBe('2 × Large Margherita Pizza')
  })
})

describe('describeCart', () => {
  it('names every line and the total', () => {
    expect(describeCart(summarizeCart({ 'margherita-pizza-large': 2, fries: 1 }))).toBe(
      'Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97.',
    )
  })

  it('says an empty cart is empty', () => {
    expect(describeCart(summarizeCart({}))).toBe('Cart: empty.')
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
      totalSpoken: 'nine ninety-eight',
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

  // That it matches use-shopping-cart's own actions is checked in cartChanges.test.ts, which runs them.
})
