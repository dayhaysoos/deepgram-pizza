// The tool handlers, wired to the live page: the cart from use-shopping-cart,
// the highlights and suggestion card from MenuUiProvider, and checkout. The
// handlers themselves (handlers.ts) know nothing about React.
//
// The page gets one set of handlers for its lifetime, shared through context:
// they remember whether a voice add has opened the drawer yet, so everything
// that calls a tool (the talk button, the dev tools panel) must use the same set.

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { redirectToCheckout, useShoppingCart } from 'use-shopping-cart'
import { startCheckout } from '../checkout/startCheckout'
import { createToolHandlers, type ToolHandler } from './handlers'
import { useMenuUi } from './MenuUiProvider'
import type { ToolName } from './tools'

/** One handler per tool, keyed by tool name. Each takes the agent's arguments and never rejects. */
export type ToolHandlers = Record<ToolName, ToolHandler>

const ToolHandlersContext = createContext<ToolHandlers | null>(null)

/** Creates the page's tool handlers. Goes inside `CartProvider` and `MenuUiProvider`. */
export function ToolHandlersProvider({ children }: { children: ReactNode }) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  // Selected one by one: the cart library keeps its actions the same for the cart's lifetime.
  const addItem = useShoppingCart((cart) => cart.addItem)
  const setItemQuantity = useShoppingCart((cart) => cart.setItemQuantity)
  const removeItem = useShoppingCart((cart) => cart.removeItem)
  const clearCart = useShoppingCart((cart) => cart.clearCart)
  // The cart library's only action that just opens the drawer (handleCartClick toggles).
  const openCart = useShoppingCart((cart) => cart.handleCartHover)
  const { highlight, showSuggestions } = useMenuUi()

  // The handlers are created once, so they read the cart through a ref that
  // always holds the cart as of the last render.
  const cartRef = useRef(cartDetails)
  useLayoutEffect(() => {
    cartRef.current = cartDetails
  }, [cartDetails])

  // The linter can't see that createToolHandlers only keeps the getter below,
  // and reads the ref when a tool runs, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [handlers] = useState(() =>
    createToolHandlers({
      cart: { cartDetails: () => cartRef.current, addItem, setItemQuantity, removeItem, clearCart },
      ui: {
        highlight,
        showSuggestions,
        openCart,
        // With voice, this will first wait for the agent to finish speaking and close the session (SPEC.md, "Checkout").
        goToCheckout: (url) => redirectToCheckout(url),
      },
      checkout: startCheckout,
    }),
  )

  return <ToolHandlersContext value={handlers}>{children}</ToolHandlersContext>
}

/** The page's tool handlers: `await handlers.add_item({ id: 'fries', quantity: 1 })`. */
export function useToolHandlers(): ToolHandlers {
  const handlers = useContext(ToolHandlersContext)
  if (!handlers) throw new Error('useToolHandlers needs a <ToolHandlersProvider> above it.')
  return handlers
}
