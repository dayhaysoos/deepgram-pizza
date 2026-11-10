// The page's cart changes (cartChanges.ts), wired to use-shopping-cart, the
// voice session and the dev tools panel. Every tap that changes the cart, and
// every tool call, goes through the one set made here: useCartChanges().

import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { CartChangesContext, TapUpdateSinkContext, useVoiceSession } from '../pageContext'
import { createCartChanges } from './cartChanges'

/**
 * Gives the components below `useCartChanges()`. Goes inside `CartProvider`
 * and `VoiceSessionProvider`. The cart is read here, once, so menu cards that
 * change it don't re-render on every cart change.
 */
export function CartChangesProvider({ children }: { children: ReactNode }) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  // Selected one by one: the cart library keeps its actions the same for the cart's lifetime.
  const addItem = useShoppingCart((cart) => cart.addItem)
  const setItemQuantity = useShoppingCart((cart) => cart.setItemQuantity)
  const removeItem = useShoppingCart((cart) => cart.removeItem)
  const clearCart = useShoppingCart((cart) => cart.clearCart)
  const voiceSession = useVoiceSession()
  const sink = useContext(TapUpdateSinkContext)

  // The cart changes are created once, so they read the cart (and the sink)
  // through a ref that always holds them as of the last render.
  const latest = useRef({ cartDetails, sink })
  useLayoutEffect(() => {
    latest.current = { cartDetails, sink }
  }, [cartDetails, sink])

  // The linter can't see that createCartChanges only keeps the getters below,
  // and reads the ref when the cart changes, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [cartChanges] = useState(() =>
    createCartChanges({
      store: { cartDetails: () => latest.current.cartDetails, addItem, setItemQuantity, removeItem, clearCart },
      tellAgent: (text) => voiceSession.tell(text),
      onTapUpdate: (text) => latest.current.sink(text),
    }),
  )

  return <CartChangesContext value={cartChanges}>{children}</CartChangesContext>
}
