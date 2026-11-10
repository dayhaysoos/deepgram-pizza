// What the agent is told when the customer changes the cart by tapping while a
// voice session is open, so it never answers from a stale cart (SPEC.md, "The
// agent always works from the current cart"). The text is sent as a mid-session
// context update.
//
// It ends by telling the agent to call view_cart before answering about the
// cart: in the owner's run the agent answered "What's my total?" from the
// update instead (right that time, but SPEC.md asks for view_cart, which reads
// the live cart even when an update was missed). Every voice session registers
// view_cart (src/voice/VoiceSession.tsx passes every tool).

import { findVariant } from '../menu/menu'
import { describeCart, describeLine, type CartChange, type CartSummary } from './cartSummary'

/** The last sentence of every tap update. */
export const CALL_VIEW_CART = 'Call view_cart before answering about the cart.'

/**
 * "Customer added 1 × Fries by tapping. Cart: 2 × Large Margherita Pizza,
 * 1 × Fries. Total $46.97. Call view_cart before answering about the cart."
 *
 * The taps: add is Add on a menu card, or Add / Add all on the suggestion card;
 * quantity is − or + in the cart drawer, with the line's new quantity; remove
 * is Remove in the cart drawer.
 */
export function describeTapChange(change: CartChange, cartAfter: CartSummary): string {
  return `Customer ${describeChange(change)} by tapping. ${describeCart(cartAfter)} ${CALL_VIEW_CART}`
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
