// The tool handlers, wired to the live page: the cart from use-shopping-cart,
// the highlights and suggestion card from MenuUiProvider, and checkout. The
// handlers themselves (handlers.ts) know nothing about React.
//
// The page gets one set of handlers for its lifetime, shared through context:
// they remember what they did (whether a voice add has opened the drawer, the
// suggestions shown last, a change React hasn't rendered yet), so everything
// that calls a tool (the talk button, the dev tools panel) must use the same set.
//
// Checkout waits for the voice agent: with a session on, the browser leaves
// once the agent has said it's taking the customer to checkout, and the
// session has ended (SPEC.md, "Checkout"). With none, it leaves at once.

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { redirectToCheckout, useShoppingCart } from 'use-shopping-cart'
import { startCheckout } from '../checkout/startCheckout'
import { useVoiceSession } from '../voice/VoiceSession'
import { createToolHandlers, type ToolHandlers } from './handlers'
import { useMenuUi } from './MenuUiProvider'

const ToolHandlersContext = createContext<ToolHandlers | null>(null)

/** Creates the page's tool handlers. Goes inside `CartProvider`, `VoiceSessionProvider` and `MenuUiProvider`. */
export function ToolHandlersProvider({ children }: { children: ReactNode }) {
  const cartDetails = useShoppingCart((cart) => cart.cartDetails)
  // Selected one by one: the cart library keeps its actions the same for the cart's lifetime.
  const addItem = useShoppingCart((cart) => cart.addItem)
  const setItemQuantity = useShoppingCart((cart) => cart.setItemQuantity)
  const removeItem = useShoppingCart((cart) => cart.removeItem)
  const clearCart = useShoppingCart((cart) => cart.clearCart)
  // The cart library's only action that just opens the drawer (handleCartClick toggles).
  const openCart = useShoppingCart((cart) => cart.handleCartHover)
  const { highlight, showSuggestions, closeSuggestions } = useMenuUi()
  const voiceSession = useVoiceSession()

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
        closeSuggestions,
        openCart,
        // Doesn't wait itself: the checkout tool answers `{ ok: true }` now, so
        // the agent can say it's taking the customer to checkout.
        goToCheckout: (url) => void voiceSession.leaveAfterSpeaking().then(() => redirectToCheckout(url)),
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
