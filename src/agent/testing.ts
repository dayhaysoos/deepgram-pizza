// For tests only: nothing in the app imports this file.

import { ShoppingCart } from 'use-shopping-cart/core'
import { findVariant } from '../menu/menu'
import { CURRENCY, LOCALE } from '../shop'
import type { CartStore } from './cartChanges'
import { quantitiesOf, type Quantities } from './cartSummary'

/**
 * A real use-shopping-cart store, seen the way a React component sees it:
 * `cartStore.cartDetails()` returns the cart as of the last render, and what
 * an action changes shows up there only after `render()`. Code that read the
 * cart back right after an action would get the old cart, and comparing with
 * `holds()`, what the store really holds, catches it.
 */
export function renderedStore() {
  const store = new ShoppingCart({ currency: CURRENCY, language: LOCALE, shouldPersist: false })
  let rendered = store.getState().cartDetails

  /** React re-renders: `cartDetails()` now returns what the store holds. */
  function render() {
    rendered = store.getState().cartDetails
  }

  /** The store as `createCartChanges` takes it. */
  const cartStore: CartStore = {
    cartDetails: () => rendered,
    addItem: (product, options) => store.addItem(product, options),
    setItemQuantity: (id, quantity) => store.setItemQuantity(id, quantity),
    removeItem: (id) => store.removeItem(id),
    clearCart: () => store.clearCart(),
  }

  /** Puts lines in the cart some other way than a change (a cart saved from an earlier visit, say), and renders. */
  function given(lines: Record<string, number>) {
    for (const [id, count] of Object.entries(lines)) {
      const found = findVariant(id)
      if (!found) throw new Error(`${id} isn't on the menu`)
      store.addItem(found.product, { count })
    }
    render()
  }

  /** What the store really holds now, by product id, in its order. */
  function holds(): Quantities {
    return quantitiesOf(store.getState().cartDetails)
  }

  return { store, cartStore, render, given, holds }
}
