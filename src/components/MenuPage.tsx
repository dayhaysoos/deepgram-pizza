import { useRef, type ReactNode } from 'react'
import { useShoppingCart } from 'use-shopping-cart'
import { MenuUiProvider } from '../agent/MenuUiProvider'
import { TapUpdatesProvider } from '../agent/TapUpdatesProvider'
import { ToolHandlersProvider } from '../agent/ToolHandlersProvider'
import { categories, menu } from '../menu/menu'
import { VoiceSession, VoiceSessionProvider } from '../voice/VoiceSession'
import { CartDrawer } from './CartDrawer'
import { MenuSection } from './MenuSection'
import { SiteHeader } from './SiteHeader'
import { SuggestionCard } from './SuggestionCard'
import { useHighlightScroll } from './useHighlightScroll'

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
 * The menu page: the menu, the cart drawer, the suggestion card and the talk
 * button. `/` renders it, and so does the dev-only `/dev/tools`, which adds its
 * tool panel as a child.
 */
export function MenuPage(props: MenuPageProps) {
  // The voice session, first, so everything below can reach it; what the
  // voice tools change on screen, the tool handlers that change it, and the
  // updates the agent gets when the customer taps.
  return (
    <VoiceSessionProvider>
      <MenuUiProvider>
        <ToolHandlersProvider>
          <TapUpdatesProvider>
            <MenuLayout {...props} />
          </TapUpdatesProvider>
        </ToolHandlersProvider>
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
      <CartDrawer returnFocusRef={cartButtonRef} closeButtonRef={cartCloseButtonRef} />
      {/* Outside the page too, so the conversation goes on while the cart is open.
          The session's state lives in VoiceSessionProvider, above. */}
      <VoiceSession />
      {children}
    </>
  )
}
