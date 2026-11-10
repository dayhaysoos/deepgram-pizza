// The cart as the agent hears it. Every cart tool returns this summary, so the
// agent speaks only from what a tool returned and never invents a price.

import { findVariant, formatPrice } from '../menu/menu'

/** How many of each product the cart holds, by product id, in cart order. */
export type Quantities = Record<string, number>

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
