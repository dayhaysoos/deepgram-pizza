// Every change to the cart goes through here, whether the agent asked for it
// (a tool call) or the customer tapped it: Add on a menu card, − or + or
// Remove in the cart drawer, Add or Add all on the suggestion card. A change
// runs the use-shopping-cart action for it and returns the summary of the cart
// after it. A tap also tells the voice agent, so it never answers from a stale
// cart (SPEC.md, "The agent always works from the current cart"). So does a
// tap on Pickup or Delivery in the cart drawer (`tapOrderType`), and every
// update says that choice too (tapUpdates.ts).
//
// Why it works out the cart itself: a use-shopping-cart action updates the
// store at once, but the cart a React component holds stays as it was until
// the next render, and the hook can't read the store directly
// (LIBRARY_FEEDBACK.md). So a change is applied to the cart before it
// (applyCartChange), and that's the cart summarized. Several changes can come
// before the next render (Deepgram can send several tool calls in one request,
// and a tap can come between a tool's change and the render), so the cart
// after the last change is remembered with the rendered cart it was based on.
// While `store.cartDetails()` returns that same object, nothing has rendered
// since, and the remembered cart is the current one. Once it returns a new
// object, React has rendered, and the rendered cart is trusted again.
//
// It checks nothing: callers check ids and quantities first. The tool
// handlers answer a bad call with a message (handlers.ts), and the suggestion
// card checks its lines with checkLinesToAdd. No React here: CartChangesProvider
// wires it to the page, and cartChanges.test.ts runs it against a real core
// ShoppingCart.

import type { CartDetails } from 'use-shopping-cart/core'
import { findVariant, type Product } from '../menu/menu'
import type { OrderType } from '../shop'
import {
  applyCartChange,
  quantitiesOf,
  summarizeCart,
  type CartChange,
  type CartSummary,
  type Quantities,
} from './cartSummary'
import type { OrderTypeStore } from './orderType'
import { describeOrderTypeTap, describeTapChange } from './tapUpdates'

/** use-shopping-cart: the cart as of the last render, and the actions that change it. */
export type CartStore = {
  /** `cartDetails` from `useShoppingCart()`, as of the last render. */
  cartDetails(): CartDetails
  addItem(product: Product, options: { count: number }): void
  setItemQuantity(id: string, quantity: number): void
  removeItem(id: string): void
  clearCart(): void
}

export type CartChangesPorts = {
  store: CartStore
  /**
   * Pickup or delivery (orderType.ts): every tap update says it, a change's
   * summary adds the delivery fee for delivery, and `tapOrderType` changes it.
   */
  orderType: Pick<OrderTypeStore, 'get' | 'set'>
  /** Tells the voice agent about a tap: the voice session's `tell`, which does nothing without a session. */
  tellAgent(text: string): void
  /** Also hears each tap update. The dev tools panel logs them. */
  onTapUpdate?(text: string): void
}

export type CartChanges = {
  /** The cart now, by product id, counting changes the last render doesn't show yet. */
  now(): Quantities
  /** The cart's entries as of the last render, as checkout takes them. */
  cartDetails(): CartDetails
  /**
   * Makes a change the agent asked for, and returns the summary of the cart
   * after it: for delivery, with the fee and the total with it (summarizeCart).
   */
  change(change: CartChange): CartSummary
  /**
   * Makes a change the customer tapped, as `change` does, and tells the agent:
   * "Customer added 1 × Fries by tapping. Cart: …" (tapUpdates.ts).
   */
  tap(change: CartChange): CartSummary
  /**
   * Records Pickup or Delivery tapped in the cart drawer, and tells the agent:
   * "Customer chose delivery by tapping. Cart: …". Nothing, if it's the choice already made.
   */
  tapOrderType(type: OrderType): void
}

/** Creates the page's cart changes. A page makes one and shares it, since it remembers the last change. */
export function createCartChanges({ store, orderType, tellAgent, onTapUpdate }: CartChangesPorts): CartChanges {
  // The cart after the last change, and the rendered cart it was based on.
  let last: { basedOn: CartDetails; cartAfter: Quantities } | null = null

  function cartAt(rendered: CartDetails): Quantities {
    return last?.basedOn === rendered ? last.cartAfter : quantitiesOf(rendered)
  }

  function change(cartChange: CartChange): CartSummary {
    const rendered = store.cartDetails()
    const cartAfter = applyCartChange(cartAt(rendered), cartChange)
    perform(store, cartChange)
    last = { basedOn: rendered, cartAfter }
    // The cart as the agent reads it: for delivery, with the fee and the total with it.
    return summarizeCart(cartAfter, orderType.get())
  }

  function tellAboutTap(text: string) {
    tellAgent(text)
    onTapUpdate?.(text)
  }

  return {
    now: () => cartAt(store.cartDetails()),
    cartDetails: () => store.cartDetails(),
    change,
    tap(tapped) {
      const cartAfter = change(tapped)
      // Every update carries the whole order: the SDK sends only the newest after a reconnect.
      tellAboutTap(describeTapChange(tapped, cartAfter, orderType.get()))
      return cartAfter
    },
    tapOrderType(type) {
      if (orderType.get() === type) return
      orderType.set(type)
      tellAboutTap(describeOrderTypeTap(type, summarizeCart(cartAt(store.cartDetails()))))
    },
  }
}

/** Runs the use-shopping-cart actions for a change. */
function perform(store: CartStore, change: CartChange) {
  switch (change.type) {
    case 'add': {
      // Every product first, so a line that isn't on the menu throws before anything changes.
      const adds = change.lines.map(({ id, quantity }) => ({ product: productOf(id), quantity }))
      for (const { product, quantity } of adds) store.addItem(product, { count: quantity })
      return
    }
    case 'quantity':
      return store.setItemQuantity(change.id, change.quantity)
    case 'remove':
      return store.removeItem(change.id)
    case 'clear':
      return store.clearCart()
  }
}

function productOf(id: string): Product {
  const found = findVariant(id)
  if (!found) throw new Error(`${JSON.stringify(id)} isn't on the menu. Check lines before adding them.`)
  return found.product
}
