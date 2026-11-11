// Pickup or delivery: the customer's choice for this order, which checkout
// needs (SPEC.md, "Pickup or delivery"). The agent asks for it in its greeting
// and records it with set_order_type; the customer can also tap Pickup or
// Delivery in the cart. The page makes one store (OrderTypeProvider) and reads
// it with useOrderType() and useOrderTypeStore() (src/pageContext.ts).
//
// The choice is saved in localStorage next to the cart, so a reload keeps it,
// and the order page forgets it with the cart once the customer has paid
// (clearSavedOrderType). Every storage call is wrapped: storage can be
// missing (on the server) or throw (blocked, or full), and then the choice
// lasts as long as the page.
//
// No React here: OrderTypeProvider wires it to the page, and
// orderType.test.ts runs it with a fake storage.

import { isOrderType, type OrderType } from '../shop'

/** The localStorage key the choice is saved under. */
export const ORDER_TYPE_KEY = 'order-type'

/** The part of the Web Storage API the store uses. */
export type OrderTypeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type OrderTypeStore = {
  /** The choice now, or null before the customer has made one. */
  get(): OrderType | null
  /** Records a choice and saves it. */
  set(type: OrderType): void
  /** Forgets the choice, saved copy included. */
  clear(): void
  /** Calls `listener` after every change. Returns the function that stops it. */
  subscribe(listener: () => void): () => void
}

/**
 * Creates the page's store, starting from the saved choice. Leave out
 * `storage` to use the browser's localStorage, when there is one.
 */
export function createOrderTypeStore(storage: OrderTypeStorage | null = browserStorage()): OrderTypeStore {
  let current = load(storage)
  const listeners = new Set<() => void>()

  function change(next: OrderType | null) {
    if (next === current) return
    current = next
    attempt(() => (next === null ? storage?.removeItem(ORDER_TYPE_KEY) : storage?.setItem(ORDER_TYPE_KEY, next)))
    for (const listener of listeners) listener()
  }

  return {
    get: () => current,
    set: (type) => change(type),
    clear: () => change(null),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Forgets the saved choice: the order page calls it beside `clearCart()`
 * once the customer has paid, so the next order asks again.
 */
export function clearSavedOrderType(storage: OrderTypeStorage | null = browserStorage()): void {
  attempt(() => storage?.removeItem(ORDER_TYPE_KEY))
}

/**
 * "Order type: delivery.", or "Order type: not chosen yet.": how the agent's
 * instructions and the tap updates say the choice.
 */
export function describeOrderType(type: OrderType | null): string {
  return `Order type: ${type ?? 'not chosen yet'}.`
}

function load(storage: OrderTypeStorage | null): OrderType | null {
  let saved: unknown = null
  attempt(() => {
    saved = storage?.getItem(ORDER_TYPE_KEY) ?? null
  })
  return isOrderType(saved) ? saved : null
}

// Reading `window.localStorage` itself throws where storage is blocked.
function browserStorage(): OrderTypeStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function attempt(action: () => void) {
  try {
    action()
  } catch (error) {
    console.warn('Pickup or delivery could not be saved or read:', error)
  }
}
