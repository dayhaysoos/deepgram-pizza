// What the agent is told when the customer changes the cart by tapping while a
// voice session is open, so it never answers from a stale cart (SPEC.md, "The
// agent always works from the current cart"). The text is sent as a mid-session
// context update.

import { findVariant } from '../menu/menu'
import type { CartSummary, Quantities } from './cartSummary'

/** A cart change the customer made by tapping. */
export type TapChange =
  /** Add on a menu card, or Add / Add all on the suggestion card. */
  | { type: 'add'; lines: Array<{ id: string; quantity: number }> }
  /** − or + in the cart drawer: the line's new quantity. */
  | { type: 'quantity'; id: string; quantity: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

/**
 * "Customer added 1 × Fries by tapping. Cart: 2 × Large Margherita Pizza,
 * 1 × Fries. Total $46.97."
 */
export function describeTapChange(change: TapChange, cartAfter: CartSummary): string {
  return `Customer ${describeChange(change)} by tapping. ${describeCart(cartAfter)}`
}

/**
 * The cart after a tap, worked out from the cart before it. A tap handler can't
 * read the cart back right after its action (see handlers.ts), so the update
 * describes the cart this returns.
 */
export function applyTapChange(quantities: Quantities, change: TapChange): Quantities {
  switch (change.type) {
    case 'add': {
      // A Map, not assignment, so an id like "__proto__" stays a plain key. New lines go last, as in the cart.
      const next = new Map(Object.entries(quantities))
      for (const { id, quantity } of change.lines) next.set(id, (next.get(id) ?? 0) + quantity)
      return Object.fromEntries(next)
    }
    case 'quantity':
      return { ...quantities, [change.id]: change.quantity }
    case 'remove':
      return Object.fromEntries(Object.entries(quantities).filter(([id]) => id !== change.id))
    case 'clear':
      return {}
  }
}

function describeChange(change: TapChange): string {
  switch (change.type) {
    case 'add':
      return `added ${change.lines.map((line) => `${line.quantity} × ${nameOf(line.id)}`).join(', ')}`
    case 'quantity':
      return `changed ${nameOf(change.id)} to ${change.quantity}`
    case 'remove':
      return `removed ${nameOf(change.id)}`
    case 'clear':
      return 'emptied the cart'
  }
}

function describeCart(cart: CartSummary): string {
  if (cart.lines.length === 0) return 'Cart: empty.'
  const lines = cart.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')
  return `Cart: ${lines}. Total ${cart.total}.`
}

// A product that's no longer on the menu is named by its id.
function nameOf(id: string): string {
  return findVariant(id)?.product.name ?? id
}
