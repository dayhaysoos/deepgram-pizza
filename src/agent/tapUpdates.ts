// What the agent is told when the customer changes the cart, or taps Pickup or
// Delivery, while a voice session is open, so it never answers from a stale
// cart (SPEC.md, "The agent always works from the current cart"). The text is
// sent as a mid-session context update. After a reconnect the SDK sends only
// the newest one, so each says the whole order: pickup or delivery, and the
// cart.
//
// It ends by telling the agent to call view_cart before answering about the
// cart: in the owner's run the agent answered "What's my total?" from the
// update instead (right that time, but SPEC.md asks for view_cart, which reads
// the live cart even when an update was missed). Every voice session registers
// view_cart (src/voice/VoiceSession.tsx passes every tool).

import { findVariant } from '../menu/menu'
import type { OrderType } from '../shop'
import { describeCart, describeLine, type CartChange, type CartSummary } from './cartSummary'
import { describeOrderType } from './orderType'

/** The last sentence of every tap update. */
export const CALL_VIEW_CART = 'Call view_cart before answering about the cart.'

/**
 * "Customer added 1 × Fries by tapping. Order type: delivery. Cart: 2 × Large
 * Margherita Pizza, 1 × Fries. Total $46.97, $50.96 with delivery. Call
 * view_cart before answering about the cart." The cart after the change is
 * summarized with the order type (cartChanges.ts), so for delivery its total
 * comes with the fee as well (describeCart).
 *
 * The taps: add is Add on a menu card, or Add / Add all on the suggestion card;
 * quantity is − or + in the cart drawer, with the line's new quantity; remove
 * is Remove in the cart drawer.
 */
export function describeTapChange(change: CartChange, cartAfter: CartSummary, orderType: OrderType | null): string {
  return `Customer ${describeChange(change)} by tapping. ${describeOrderType(orderType)} ${describeCart(cartAfter)} ${CALL_VIEW_CART}`
}

/**
 * Pickup or Delivery tapped in the cart drawer: "Customer chose delivery by
 * tapping. Cart: 1 × Fries. Total $4.99, $8.98 with delivery. Call view_cart
 * before answering about the cart." Pass the cart summarized for the new
 * choice (summarizeCart(quantities, orderType)), so a delivery cart has the fee.
 */
export function describeOrderTypeTap(orderType: OrderType, cart: CartSummary): string {
  return `Customer chose ${orderType} by tapping. ${describeCart(cart)} ${CALL_VIEW_CART}`
}

function describeChange(change: CartChange): string {
  switch (change.type) {
    case 'add':
      return `added ${change.lines.map(({ id, quantity }) => describeLine({ name: nameOf(id), quantity })).join(', ')}`
    case 'quantity':
      return `changed ${nameOf(change.id)} to ${change.quantity}`
    case 'remove':
      return `removed ${nameOf(change.id)}`
    case 'clear':
      return 'emptied the cart'
  }
}

// A product that's no longer on the menu is named by its id.
function nameOf(id: string): string {
  return findVariant(id)?.product.name ?? id
}
