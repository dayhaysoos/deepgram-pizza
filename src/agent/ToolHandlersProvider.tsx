// The tool handlers, wired to the live page: the cart through the page's cart
// changes (CartChangesProvider), the highlights and suggestion card from
// MenuUiProvider, pickup or delivery from OrderTypeProvider, and checkout. The handlers themselves (handlers.ts) know
// nothing about React.
//
// The page gets one set of handlers for its lifetime, read with
// useToolHandlers() (src/pageContext.ts): they remember what they did (whether
// a voice add has opened the drawer, the suggestions shown last), so
// everything that calls a tool (the voice session, the dev tools panel) must
// use the same set.
//
// Checkout waits for the voice agent: with a session on, the browser leaves
// once the agent has said it's taking the customer to checkout, and the
// session has ended (SPEC.md, "Checkout"). With none, it leaves at once.

import { useState, type ReactNode } from 'react'
import { redirectToCheckout, useShoppingCart } from 'use-shopping-cart'
import { startCheckout } from '../checkout/startCheckout'
import { ToolHandlersContext, useCartChanges, useMenuUi, useOrderTypeStore, useVoiceSession } from '../pageContext'
import { createToolHandlers } from './handlers'

/** Creates the page's tool handlers. Goes inside `CartChangesProvider`, `VoiceSessionProvider`, `MenuUiProvider` and `OrderTypeProvider`. */
export function ToolHandlersProvider({ children }: { children: ReactNode }) {
  const cartChanges = useCartChanges()
  // The cart library's only action that just opens the drawer (handleCartClick toggles).
  const openCart = useShoppingCart((cart) => cart.handleCartHover)
  const { highlight, showSuggestions, closeSuggestions, isShowingSuggestions } = useMenuUi()
  const orderType = useOrderTypeStore()
  const voiceSession = useVoiceSession()

  const [handlers] = useState(() =>
    createToolHandlers({
      cart: cartChanges,
      ui: {
        highlight,
        showSuggestions,
        closeSuggestions,
        isShowingSuggestions,
        openCart,
        // Doesn't wait itself: the checkout tool answers `{ ok: true }` now, so
        // the agent can say it's taking the customer to checkout.
        goToCheckout: (url) => void voiceSession.leaveAfterSpeaking().then(() => redirectToCheckout(url)),
      },
      orderType,
      checkout: (cartDetails, type) => startCheckout(cartDetails, type),
    }),
  )

  return <ToolHandlersContext value={handlers}>{children}</ToolHandlersContext>
}
