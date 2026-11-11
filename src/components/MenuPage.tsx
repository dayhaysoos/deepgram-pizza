import { useRef, type ReactNode } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { CartChangesProvider } from '../agent/CartChangesProvider'
import { MenuUiProvider } from '../agent/MenuUiProvider'
import { OrderTypeProvider } from '../agent/OrderTypeProvider'
import { ToolHandlersProvider } from '../agent/ToolHandlersProvider'
import { categories, menu } from '../menu/menu'
import { VoiceSession, VoiceSessionProvider } from '../voice/VoiceSession'
import { CartDrawer } from './CartDrawer'
import { MenuSection } from './MenuSection'
import { OrderStrip } from './OrderStrip'
import { SiteHeader } from './SiteHeader'
import { SuggestionCard } from './SuggestionCard'
import { useHighlightScroll } from './useHighlightScroll'
import { useOrderBoardStore } from './useOrderBoard'

type MenuPageProps = {
  /** Shows the "Checkout cancelled" notice at the top of the menu. */
  checkoutCancelled?: boolean
  /** Called when the customer dismisses the notice, so the page can stop showing it. */
  onDismissNotice?: () => void
  /**
   * Rendered beside the page, inside the tool handlers' provider and outside
   * the wrapper an open cart makes inert. The dev tools panel goes here.
   */
  children?: ReactNode
}

/**
 * The menu page: the menu, the cart drawer (the order board), the suggestion
 * card, the order strip on phones and the talk button. `/` renders it, and so does the dev-only `/dev/tools`, which adds its
 * tool panel as a child.
 */
export function MenuPage(props: MenuPageProps) {
  // The voice session, first, so everything below can reach it; what the
  // voice tools change on screen (useMenuUi); pickup or delivery
  // (useOrderType); the cart changes, which taps and tools both go through and
  // which tell the agent about taps; and the tool handlers. src/pageContext.ts
  // has the hooks that read the others.
  return (
    <VoiceSessionProvider>
      <MenuUiProvider>
        <OrderTypeProvider>
          <CartChangesProvider>
            <ToolHandlersProvider>
              <MenuLayout {...props} />
            </ToolHandlersProvider>
          </CartChangesProvider>
        </OrderTypeProvider>
      </MenuUiProvider>
    </VoiceSessionProvider>
  )
}

function MenuLayout({ checkoutCancelled = false, onDismissNotice, children }: MenuPageProps) {
  const cartOpen = useShoppingCart((cart) => cart.shouldDisplayCart)
  const cartButtonRef = useRef<HTMLButtonElement>(null)
  const cartCloseButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useHighlightScroll(pageRef)
  // The order board: the cart drawer and, on phones, the strip show the order from it.
  const board = useOrderBoardStore()

  function dismissNotice() {
    onDismissNotice?.()
    // The Dismiss button goes with the notice. Move focus to the menu so it
    // isn't dropped on the page body.
    menuRef.current?.focus({ preventScroll: true })
  }

  return (
    <>
      {/* While the cart is open, the page behind it can't be focused or clicked. */}
      <div className="page" ref={pageRef} inert={cartOpen}>
        <SiteHeader cartButtonRef={cartButtonRef} />
        <main className="menu" ref={menuRef} tabIndex={-1}>
          {checkoutCancelled && (
            <div className="notice" role="status">
              <p>Checkout cancelled. Your cart is just as you left it.</p>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss"
                onClick={dismissNotice}
              >
                ✕
              </button>
            </div>
          )}
          {categories.map((category) => (
            <MenuSection
              key={category.id}
              category={category}
              items={menu.filter((item) => item.category === category.id)}
            />
          ))}
        </main>
      </div>
      {/* Outside the page, so it stays usable beside an open cart (styles.css says where it sits).
          When it closes, focus goes into the open cart, since the page behind it is inert. */}
      <SuggestionCard returnFocusRef={cartOpen ? cartCloseButtonRef : cartButtonRef} />
      {/* On phones, the order above the talk button, while the cart is closed. */}
      <OrderStrip board={board} />
      <CartDrawer returnFocusRef={cartButtonRef} closeButtonRef={cartCloseButtonRef} board={board} />
      {/* Outside the page too, so the conversation goes on while the cart is open.
          The session's state lives in VoiceSessionProvider, above. Its sessions
          answer the agent's tool calls with the page's one set of handlers. */}
      <VoiceSession />
      {children}
    </>
  )
}
