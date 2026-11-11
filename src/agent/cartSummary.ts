// The cart as quantities: what a change does to it and how it reads.
//
// A use-shopping-cart action updates the store at once, but in React the cart
// a component holds stays as it was until the next render. So every change,
// from a tool or a tap, works out the cart after it here, from the cart before
// it, and summarizes that (cartChanges.ts). Every cart tool returns the
// summary, so the agent speaks only from what a tool returned and never
// invents a price. The total comes written for the screen and spoken for the
// agent to say (spokenPrice.ts). For delivery, the summary also carries the
// delivery fee and the total with it, since that's what Stripe will charge.

import { findVariant, formatPrice } from '../menu/menu'
import { DELIVERY_FEE, type OrderType } from '../shop'
import { spokenPrice } from './spokenPrice'

/** How many of each product the cart holds, by product id, in cart order. */
export type Quantities = Record<string, number>

/** A product id and how many of it: a line a tool call or a tap adds. */
export type ItemQuantity = { id: string; quantity: number }

/** One change to the cart, from a tool call or a tap. */
export type CartChange =
  /** Adds each line's quantity to the cart, as `addItem` does: a new line goes last. */
  | { type: 'add'; lines: ItemQuantity[] }
  /** Sets a line's quantity, as `setItemQuantity` does. */
  | { type: 'quantity'; id: string; quantity: number }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

export type CartSummary = {
  lines: Array<{ id: string; name: string; quantity: number; total: string }>
  /** How many products in all: 2 pizzas and a soda is 3. */
  count: number
  /** "$46.97", for the screen. */
  total: string
  /** "forty-six ninety-seven": the total as the agent says it (spokenPrice). */
  totalSpoken: string
  /** Only for a delivery order with something in the cart: the fee Stripe adds, and the total with it. */
  delivery?: DeliveryCharge
}

/** The flat delivery fee (DELIVERY_FEE in src/shop.ts) and the total with it, written and spoken. */
export type DeliveryCharge = {
  /** "$3.99" */
  fee: string
  /** "three ninety-nine" */
  feeSpoken: string
  /** "$45.97": the cart's total plus the fee, what Stripe charges. */
  totalWithDelivery: string
  /** "forty-five ninety-seven" */
  totalWithDeliverySpoken: string
}

/** "2 × Large Margherita Pizza": how the tools, the tap updates and the suggestion card name a line. */
export function describeLine({ name, quantity }: { name: string; quantity: number }): string {
  return `${quantity} × ${name}`
}

/**
 * "Cart: 2 × Large Margherita Pizza, 1 × Fries. Total $46.97." or "Cart: empty.":
 * how the tap updates and the agent's instructions give the whole cart.
 */
export function describeCart(cart: CartSummary): string {
  if (cart.lines.length === 0) return 'Cart: empty.'
  return `Cart: ${cart.lines.map(describeLine).join(', ')}. Total ${cart.total}.`
}

/** Reads id → quantity from use-shopping-cart's `cartDetails`. Nothing else in an entry is trusted. */
export function quantitiesOf(cartDetails: Readonly<Record<string, { quantity: number }>>): Quantities {
  // Object.fromEntries, not assignment, so an id like "__proto__" stays a plain key.
  return Object.fromEntries(Object.entries(cartDetails).map(([id, entry]) => [id, entry.quantity]))
}

/** How many of this product the cart holds: 0 when none. An id like "constructor" isn't found on Object.prototype. */
export function quantityOf(quantities: Quantities, id: string): number {
  return Object.hasOwn(quantities, id) ? quantities[id] : 0
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
 *
 * Pass the order type for the cart the agent reads (the cart tools and
 * view_cart): for delivery, the summary also has the fee and the total with
 * it, so the total the agent says is what Stripe charges. An empty cart has
 * nothing to deliver, so it has no fee. Leave it out for anything else, such
 * as the suggestion card's lines.
 */
export function summarizeCart(quantities: Quantities, orderType: OrderType | null = null): CartSummary {
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
  const summary: CartSummary = { lines, count, total: formatPrice(cents), totalSpoken: spokenPrice(cents) }
  if (orderType !== 'delivery' || count === 0) return summary
  const delivery: DeliveryCharge = {
    fee: formatPrice(DELIVERY_FEE),
    feeSpoken: spokenPrice(DELIVERY_FEE),
    totalWithDelivery: formatPrice(cents + DELIVERY_FEE),
    totalWithDeliverySpoken: spokenPrice(cents + DELIVERY_FEE),
  }
  return { ...summary, delivery }
}
