// The cart as quantities: what a change does to it and how it reads.
//
// A use-shopping-cart action updates the store at once, but in React the cart
// a component holds stays as it was until the next render. So the tool
// handlers and the tap updates both work out the cart after a change here, from
// the cart before it, and summarize that. Every cart tool returns the summary,
// so the agent speaks only from what a tool returned and never invents a price.

import { findVariant, formatPrice } from '../menu/menu'

/** How many of each product the cart holds, by product id, in cart order. */
export type Quantities = Record<string, number>

/** One change to the cart, from a tool call or a tap. */
export type CartChange =
  /** Adds each line's quantity to the cart, as `addItem` does: a new line goes last. */
  | { type: 'add'; lines: Array<{ id: string; quantity: number }> }
  /** Sets a line's quantity, as `setItemQuantity` does. */
  | { type: 'quantity'; id: string; quantity: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

export type CartSummary = {
  lines: Array<{ id: string; name: string; quantity: number; total: string }>
  /** How many products in all: 2 pizzas and a soda is 3. */
  count: number
  total: string
}

/** Reads id → quantity from use-shopping-cart's `cartDetails`. Nothing else in an entry is trusted. */
export function quantitiesOf(cartDetails: Readonly<Record<string, { quantity: number }>>): Quantities {
  // Object.fromEntries, not assignment, so an id like "__proto__" stays a plain key.
  return Object.fromEntries(Object.entries(cartDetails).map(([id, entry]) => [id, entry.quantity]))
}

/**
 * The cart after a change, worked out from the cart before it, which is left
 * as it was. Only arithmetic: the caller checks ids and quantities first.
 */
export function applyCartChange(quantities: Quantities, change: CartChange): Quantities {
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

/**
 * The summary of a cart. Names and prices come from the menu. A line whose
 * product is no longer on the menu (a cart saved before menu.json changed) is
 * left out, since there's no price to give for it; checkout turns it down too.
 */
export function summarizeCart(quantities: Quantities): CartSummary {
  const lines: CartSummary['lines'] = []
  let count = 0
  let cents = 0
  for (const [id, quantity] of Object.entries(quantities)) {
    const found = findVariant(id)
    if (!found) continue
    const lineCents = found.variant.price * quantity
    lines.push({ id, name: found.product.name, quantity, total: formatPrice(lineCents) })
    count += quantity
    cents += lineCents
  }
  return { lines, count, total: formatPrice(cents) }
}
