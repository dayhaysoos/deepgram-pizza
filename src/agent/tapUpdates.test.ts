import { describe, expect, it } from 'vitest'
import { summarizeCart, type CartChange } from './cartSummary'
import { CALL_VIEW_CART, describeOrderTypeTap, describeTapChange } from './tapUpdates'

const cartAfter = summarizeCart({ 'margherita-pizza-large': 2, fries: 1 })
const CART = 'Order type: delivery. Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97. Call view_cart before answering about the cart.'

describe('describeTapChange', () => {
  it('describes an add from a menu card', () => {
    expect(describeTapChange({ type: 'add', lines: [{ id: 'fries', quantity: 1 }] }, cartAfter, 'delivery')).toBe(
      `Customer added 1 × Fries by tapping. ${CART}`,
    )
  })

  it('describes Add all from the suggestion card', () => {
    const lines = [
      { id: 'margherita-pizza-large', quantity: 2 },
      { id: 'fries', quantity: 1 },
    ]

    expect(describeTapChange({ type: 'add', lines }, cartAfter, 'delivery')).toBe(
      `Customer added 2 × Large Margherita Pizza, 1 × Fries by tapping. ${CART}`,
    )
  })

  it('describes a quantity change from + or − in the drawer', () => {
    expect(describeTapChange({ type: 'quantity', id: 'margherita-pizza-large', quantity: 2 }, cartAfter, 'delivery')).toBe(
      `Customer changed Large Margherita Pizza to 2 by tapping. ${CART}`,
    )
  })

  it('describes a removed line', () => {
    expect(describeTapChange({ type: 'remove', id: 'soda' }, cartAfter, 'delivery')).toBe(
      `Customer removed Fountain Soda by tapping. ${CART}`,
    )
  })

  it('describes an emptied cart', () => {
    expect(describeTapChange({ type: 'clear' }, summarizeCart({}), 'pickup')).toBe(
      'Customer emptied the cart by tapping. Order type: pickup. Cart: empty. Call view_cart before answering about the cart.',
    )
  })

  it('says the cart is empty after removing the last line', () => {
    expect(describeTapChange({ type: 'remove', id: 'fries' }, summarizeCart({}), null)).toBe(
      'Customer removed Fries by tapping. Order type: not chosen yet. Cart: empty. Call view_cart before answering about the cart.',
    )
  })

  it('names a product that is no longer on the menu by its id', () => {
    expect(describeTapChange({ type: 'remove', id: 'hawaiian-pizza-large' }, summarizeCart({}), null)).toBe(
      'Customer removed hawaiian-pizza-large by tapping. Order type: not chosen yet. Cart: empty. Call view_cart before answering about the cart.',
    )
  })

  it('ends every update by telling the agent to call view_cart before it answers about the cart', () => {
    expect(CALL_VIEW_CART).toBe('Call view_cart before answering about the cart.')
    const changes: CartChange[] = [
      { type: 'add', lines: [{ id: 'fries', quantity: 1 }] },
      { type: 'quantity', id: 'fries', quantity: 2 },
      { type: 'remove', id: 'fries' },
      { type: 'clear' },
    ]
    for (const change of changes) {
      expect(describeTapChange(change, cartAfter, null).endsWith(` ${CALL_VIEW_CART}`), change.type).toBe(true)
    }
    expect(describeOrderTypeTap('pickup', cartAfter).endsWith(` ${CALL_VIEW_CART}`)).toBe(true)
  })

  // The SDK sends only the newest update after a reconnect, so each says the whole order.
  it('says pickup or delivery in every update, as the instructions end with it', () => {
    const add: CartChange = { type: 'add', lines: [{ id: 'fries', quantity: 1 }] }
    expect(describeTapChange(add, cartAfter, 'pickup')).toContain(' by tapping. Order type: pickup. Cart: ')
    expect(describeTapChange(add, cartAfter, null)).toContain(' by tapping. Order type: not chosen yet. Cart: ')
  })
})

describe('describeOrderTypeTap', () => {
  it('describes Pickup or Delivery tapped in the cart, with the cart', () => {
    expect(describeOrderTypeTap('delivery', cartAfter)).toBe(
      'Customer chose delivery by tapping. Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97. Call view_cart before answering about the cart.',
    )
    expect(describeOrderTypeTap('pickup', summarizeCart({}))).toBe(
      'Customer chose pickup by tapping. Cart: empty. Call view_cart before answering about the cart.',
    )
  })
})
